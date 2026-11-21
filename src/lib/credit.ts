/**
 * Legingstegoed. Iedere mutatie wordt vastgelegd met oorzaak en afspraak.
 *  - beschikbaar = som(delta_available), ingepland = som(delta_reserved)
 *  - reserveren bij bevestiging, verbruiken bij uitvoering, teruggeven bij annulering
 * Overboeking wordt voorkomen door de periode-rij te vergrendelen (SELECT … FOR UPDATE).
 * Iedere mutatie heeft een unieke sleutel, zodat herhaalde acties niets dubbel boeken.
 */
import { one, q, type Db } from "./db";
import { addDays, addMonths, today } from "./dates";

export interface CreditPeriod { id: number; subscription_id: number; starts_on: string; ends_on: string; included: number; closed: boolean }
export interface CreditSummary { period: CreditPeriod | null; available: number; reserved: number; used: number; pendingRequests: number }

export async function periodFor(db: Db, subscriptionId: number, date = today()): Promise<CreditPeriod | null> {
  return one<CreditPeriod>(
    `SELECT * FROM credit_periods WHERE subscription_id=$1 AND starts_on <= $2 AND ends_on >= $2 ORDER BY starts_on DESC LIMIT 1`,
    [subscriptionId, date], db,
  );
}

export async function openPeriod(db: Db, subscriptionId: number, startsOn: string, months: number, included: number, actor: number | null, reason: string) {
  const endsOn = addDays(addMonths(startsOn, months), -1);
  const p = await one<CreditPeriod>(
    `INSERT INTO credit_periods(subscription_id, starts_on, ends_on, included) VALUES ($1,$2,$3,$4)
     ON CONFLICT (subscription_id, starts_on) DO UPDATE SET included = credit_periods.included RETURNING *`,
    [subscriptionId, startsOn, endsOn, included], db,
  );
  if (included > 0) {
    await mutate(db, { periodId: p!.id, kind: "grant", dAvail: included, reason, actor, key: `period:${p!.id}:grant` });
  }
  return p!;
}

async function mutate(db: Db, m: { periodId: number; kind: string; dAvail?: number; dRes?: number; reason: string; actor?: number | null; appointmentId?: number | null; key: string }) {
  const r = await one<{ id: number }>(
    `INSERT INTO credit_mutations(period_id, appointment_id, kind, delta_available, delta_reserved, reason, actor_user_id, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
    [m.periodId, m.appointmentId ?? null, m.kind, m.dAvail ?? 0, m.dRes ?? 0, m.reason, m.actor ?? null, m.key], db,
  );
  return Boolean(r);
}

export async function balances(db: Db, periodId: number) {
  const r = await one<{ available: number; reserved: number; used: number }>(
    `SELECT COALESCE(SUM(delta_available),0) AS available, COALESCE(SUM(delta_reserved),0) AS reserved,
            COUNT(*) FILTER (WHERE kind='consume') AS used
     FROM credit_mutations WHERE period_id=$1`, [periodId], db,
  );
  return r!;
}

export async function creditSummary(db: Db, subscriptionId: number): Promise<CreditSummary> {
  const period = await periodFor(db, subscriptionId);
  if (!period) return { period: null, available: 0, reserved: 0, used: 0, pendingRequests: 0 };
  const b = await balances(db, period.id);
  const pending = await one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM appointments WHERE subscription_id=$1 AND type='emptying' AND request_status='requested' AND funding='included'`,
    [subscriptionId], db,
  );
  return { period, available: b.available, reserved: b.reserved, used: b.used, pendingRequests: pending!.n };
}

/** Reserveert één inbegrepen leging. Geeft false terug als er geen tegoed meer is. */
export async function reserveCredit(db: Db, subscriptionId: number, appointmentId: number, actor: number | null, date?: string): Promise<boolean> {
  const period = (date && (await periodFor(db, subscriptionId, date))) || (await periodFor(db, subscriptionId));
  if (!period) return false;
  // Vergrendel de periode: gelijktijdige bevestigingen wachten op elkaar.
  await q(`SELECT id FROM credit_periods WHERE id=$1 FOR UPDATE`, [period.id], db);
  const already = await one(`SELECT 1 FROM credit_mutations WHERE idempotency_key=$1`, [`appt:${appointmentId}:reserve`], db);
  if (already) return true;
  const b = await balances(db, period.id);
  if (b.available <= 0) return false;
  return mutate(db, { periodId: period.id, kind: "reserve", dAvail: -1, dRes: 1, reason: "Afspraak bevestigd", actor, appointmentId, key: `appt:${appointmentId}:reserve` });
}

async function reservationOf(db: Db, appointmentId: number) {
  return one<{ period_id: number }>(`SELECT period_id FROM credit_mutations WHERE idempotency_key=$1`, [`appt:${appointmentId}:reserve`], db);
}

export async function releaseCredit(db: Db, appointmentId: number, actor: number | null, reason = "Afspraak geannuleerd") {
  const res = await reservationOf(db, appointmentId);
  if (!res) return false;
  const consumed = await one(`SELECT 1 FROM credit_mutations WHERE idempotency_key=$1`, [`appt:${appointmentId}:consume`], db);
  if (consumed) return false;
  return mutate(db, { periodId: res.period_id, kind: "release", dAvail: 1, dRes: -1, reason, actor, appointmentId, key: `appt:${appointmentId}:release` });
}

export async function consumeCredit(db: Db, appointmentId: number, actor: number | null) {
  const res = await reservationOf(db, appointmentId);
  if (!res) return false;
  const released = await one(`SELECT 1 FROM credit_mutations WHERE idempotency_key=$1`, [`appt:${appointmentId}:release`], db);
  if (released) return false;
  return mutate(db, { periodId: res.period_id, kind: "consume", dRes: -1, reason: "Leging uitgevoerd", actor, appointmentId, key: `appt:${appointmentId}:consume` });
}

export async function correctCredit(db: Db, periodId: number, delta: number, reason: string, actor: number) {
  if (!reason.trim()) throw new Error("Een correctie vereist een reden.");
  if (!Number.isInteger(delta) || delta === 0) throw new Error("Geef een geheel aantal (positief of negatief).");
  await q(`SELECT id FROM credit_periods WHERE id=$1 FOR UPDATE`, [periodId], db);
  const b = await balances(db, periodId);
  if (b.available + delta < 0) throw new Error("Het beschikbare tegoed kan niet negatief worden.");
  return mutate(db, { periodId, kind: "correction", dAvail: delta, reason, actor, key: `correction:${periodId}:${Date.now()}:${Math.random()}` });
}

/** Sluit verlopen perioden af en opent de volgende. Ongebruikt tegoed vervalt tenzij doorschuiven aan staat. */
export async function rollPeriods(db: Db, carryOver: boolean, months: number) {
  const ended = await q<CreditPeriod & { included_next: number }>(
    `SELECT cp.*, sv.terms->>'includedPerYear' AS included_next FROM credit_periods cp
     JOIN subscriptions s ON s.id = cp.subscription_id
     JOIN subscription_versions sv ON sv.subscription_id = s.id AND sv.status='active'
     WHERE cp.closed = false AND cp.ends_on < $1 AND s.status IN ('active','ending')`,
    [today()], db,
  );
  for (const p of ended) {
    await q(`SELECT id FROM credit_periods WHERE id=$1 FOR UPDATE`, [p.id], db);
    const b = await balances(db, p.id);
    const next = addDays(p.ends_on, 1);
    if (b.available > 0) {
      await mutate(db, { periodId: p.id, kind: "expire", dAvail: -b.available, reason: carryOver ? "Doorgeschoven naar volgende periode" : "Periode verlopen: ongebruikt tegoed vervalt", key: `period:${p.id}:expire` });
    }
    const np = await openPeriod(db, p.subscription_id, next, months, Number(p.included_next ?? 0), null, "Nieuwe tegoedperiode");
    if (carryOver && b.available > 0) {
      await mutate(db, { periodId: np.id, kind: "carry_over", dAvail: b.available, reason: `Doorgeschoven uit periode ${p.starts_on}`, key: `period:${p.id}:carry` });
    }
    await q(`UPDATE credit_periods SET closed=true WHERE id=$1`, [p.id], db);
  }
  return ended.length;
}

export function creditText(s: CreditSummary) {
  if (!s.period) return "Geen inbegrepen legingen";
  const n = s.available;
  return `Nog ${n} ${n === 1 ? "leging" : "legingen"} beschikbaar${s.reserved ? `, ${s.reserved} ingepland` : ""}`;
}
