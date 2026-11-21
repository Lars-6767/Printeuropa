/**
 * Financiële afhandeling.
 *  - Een uitgevoerde rit wordt afgehandeld volgens de geaccepteerde afspraak (nooit herprijzen).
 *  - Facturen hebben een unieke source_key: dubbele gebeurtenissen leveren nooit een tweede factuur op.
 *  - Abonnementen worden achteraf per kalendermaand gefactureerd, pro rata per versie.
 */
import { nextNumber, one, pad, q, type Db } from "./db";
import { addDays, daysInMonth, endOfMonth, today } from "./dates";
import { emitEvent, enqueue } from "./jobs";
import { applyBp, roundHalfUp } from "./money";
import { consumeCredit } from "./credit";
import { getConfig } from "./settings";
import { audit } from "./audit";
import { createTask } from "./tasks";

export interface InvoiceLineInput { description: string; quantity?: number; unitCents: number }

export async function createInvoice(
  db: Db,
  inv: { sourceKey: string; companyId: number; subscriptionId?: number | null; appointmentId?: number | null; description: string; lines: InvoiceLineInput[]; creditsInvoiceId?: number | null },
): Promise<{ id: number; created: boolean }> {
  const pricing = await getConfig("pricing", db);
  const subtotal = inv.lines.reduce((s, l) => s + (l.quantity ?? 1) * l.unitCents, 0);
  const vat = applyBp(subtotal, pricing.vatBp);
  const row = await one<{ id: number }>(
    `INSERT INTO invoices(source_key, company_id, subscription_id, appointment_id, credits_invoice_id, status, description, subtotal_cents, vat_cents, total_cents, vat_rate_bp)
     VALUES ($1,$2,$3,$4,$5,'concept',$6,$7,$8,$9,$10) ON CONFLICT (source_key) DO NOTHING RETURNING id`,
    [inv.sourceKey, inv.companyId, inv.subscriptionId ?? null, inv.appointmentId ?? null, inv.creditsInvoiceId ?? null, inv.description, subtotal, vat, subtotal + vat, pricing.vatBp], db,
  );
  if (!row) {
    const ex = await one<{ id: number }>(`SELECT id FROM invoices WHERE source_key=$1`, [inv.sourceKey], db);
    return { id: ex!.id, created: false };
  }
  for (const l of inv.lines) {
    await q(`INSERT INTO invoice_lines(invoice_id, description, quantity, unit_cents, total_cents) VALUES ($1,$2,$3,$4,$5)`, [row.id, l.description, l.quantity ?? 1, l.unitCents, (l.quantity ?? 1) * l.unitCents], db);
  }
  await finalizeInvoice(db, row.id);
  return { id: row.id, created: true };
}

/** Concept → definitief: nummer, datum, PDF, verzending en incasso worden ingepland. */
export async function finalizeInvoice(db: Db, invoiceId: number) {
  const inv = await one<{ id: number; status: string; total_cents: number; company_id: number }>(`SELECT * FROM invoices WHERE id=$1 FOR UPDATE`, [invoiceId], db);
  if (!inv || inv.status !== "concept") return;
  const contract = await getConfig("contract", db);
  const year = today().slice(0, 4);
  const n = await nextNumber(db, `invoice-${year}`);
  const number = `F-${year}-${pad(n)}`;
  await q(`UPDATE invoices SET status='final', number=$2, issued_on=$3, due_on=$4 WHERE id=$1`, [invoiceId, number, today(), addDays(today(), contract.invoicePaymentDays)], db);
  await enqueue(db, "invoice.pdf", { invoiceId }, `invoice:${invoiceId}:pdf`);
  await emitEvent(db, "invoice.created", { invoiceId, companyId: inv.company_id }, String(invoiceId));
  if (inv.total_cents > 0) await enqueue(db, "payment.collect", { invoiceId }, `invoice:${invoiceId}:collect`);
}

/**
 * Afhandeling na uitvoering. Idempotent: alleen als financial_status nog 'pending' is.
 */
export async function settleAppointment(db: Db, appointmentId: number, actor: number | null) {
  const a = await one<any>(`SELECT * FROM appointments WHERE id=$1 FOR UPDATE`, [appointmentId], db);
  if (!a || a.execution_status !== "executed" || a.financial_status !== "pending") return { outcome: a?.financial_status ?? "unknown", changed: false };

  let outcome: string;
  if (a.type === "emptying" && a.funding === "free_combination") {
    outcome = "free_combination";
  } else if (a.type === "emptying" && a.funding === "included") {
    const ok = await consumeCredit(db, a.id, actor);
    if (!ok) {
      // Geen reservering gevonden: veilig terugvallen op de vastgelegde losse prijs en Bereyl laten controleren.
      await createTask(db, { type: "finance_check", title: `Controleer afhandeling ${a.number}: geen tegoedreservering gevonden`, companyId: a.company_id, refType: "appointment", refId: a.id, priority: "high", dedupeKey: `finance_check:${a.id}` });
      return { outcome: "pending", changed: false };
    }
    outcome = "included";
  } else if (a.price_cents === null || a.price_cents === undefined) {
    await createTask(db, { type: "finance_check", title: `Tarief voor ${typeLabel(a.type)} ${a.number} is nog niet vastgesteld`, companyId: a.company_id, refType: "appointment", refId: a.id, priority: "high", dedupeKey: `finance_price:${a.id}` });
    return { outcome: "pending", changed: false };
  } else if (a.price_cents === 0) {
    outcome = "no_charge";
  } else {
    await createInvoice(db, {
      sourceKey: `appointment:${a.id}`,
      companyId: a.company_id,
      subscriptionId: a.subscription_id,
      appointmentId: a.id,
      description: `${typeLabel(a.type)} ${a.number}`,
      lines: [{ description: a.price_detail?.label ?? `${typeLabel(a.type)} ${a.number}`, unitCents: a.price_cents }],
    });
    outcome = "invoiced";
  }
  await q(`UPDATE appointments SET financial_status=$2 WHERE id=$1`, [a.id, outcome], db);
  await audit(db, { actor, company: a.company_id, action: "appointment.settled", entityType: "appointment", entityId: a.id, data: { outcome, priceCents: a.price_cents } });
  return { outcome, changed: true };
}

export function typeLabel(t: string) {
  return ({ placement: "Plaatsing", emptying: "Leging", swap: "Omruilen", final_pickup: "Definitief ophalen" } as Record<string, string>)[t] ?? t;
}

/**
 * Maandfactuur voor één abonnement en kalendermaand (achteraf). Bedrag per versie pro rata naar dagen.
 */
export async function invoiceSubscriptionMonth(db: Db, subscriptionId: number, monthStart: string) {
  const s = await one<any>(`SELECT * FROM subscriptions WHERE id=$1`, [subscriptionId], db);
  if (!s || !s.started_at) return null;
  const monthEnd = endOfMonth(monthStart);
  const from = s.started_at > monthStart ? s.started_at : monthStart;
  const stop = s.billing_stops_at ? addDays(s.billing_stops_at, -1) : null; // laatste gefactureerde dag
  const to = stop && stop < monthEnd ? stop : monthEnd;
  if (from > to) return null;

  const versions = await q<any>(
    `SELECT * FROM subscription_versions WHERE subscription_id=$1 AND status IN ('active','superseded') ORDER BY effective_from`, [subscriptionId], db,
  );
  const dim = daysInMonth(monthStart);
  const lines: InvoiceLineInput[] = [];
  versions.forEach((v, i) => {
    const vFrom = v.effective_from > from ? v.effective_from : from;
    const nextFrom = versions[i + 1]?.effective_from ? addDays(versions[i + 1].effective_from, -1) : null;
    const vTo = nextFrom && nextFrom < to ? nextFrom : to;
    if (vFrom > vTo || v.monthly_cents === 0) return;
    const days = Math.round((Date.parse(vTo) - Date.parse(vFrom)) / 86400000) + 1;
    const cents = days === dim ? v.monthly_cents : roundHalfUp((v.monthly_cents * days) / dim);
    const label = `${v.terms.packageName} · box ${v.terms.boxLabel} · ${monthStart.slice(0, 7)}${days === dim ? "" : ` (${days}/${dim} dagen)`}`;
    lines.push({ description: label, unitCents: cents });
  });
  if (lines.length === 0) return null;
  return createInvoice(db, {
    sourceKey: `subscription:${subscriptionId}:${monthStart.slice(0, 7)}`,
    companyId: s.company_id,
    subscriptionId,
    description: `Abonnement ${monthStart.slice(0, 7)}`,
    lines,
  });
}

/** Factureert alle afgelopen maanden die nog geen factuur hebben. */
export async function runSubscriptionBilling(db: Db, upTo = today()) {
  const subs = await q<{ id: number; started_at: string }>(`SELECT id, started_at FROM subscriptions WHERE started_at IS NOT NULL`, [], db);
  let count = 0;
  const currentMonth = upTo.slice(0, 7) + "-01";
  for (const s of subs) {
    let m = s.started_at.slice(0, 7) + "-01";
    while (m < currentMonth) {
      const r = await invoiceSubscriptionMonth(db, s.id, m);
      if (r?.created) count++;
      m = addDays(endOfMonth(m), 1);
    }
  }
  return count;
}

/** Creditfactuur met reden. Zet de oorspronkelijke factuur op 'gecrediteerd'. */
export async function creditInvoice(db: Db, invoiceId: number, reason: string, actor: number) {
  if (!reason.trim()) throw new Error("Een creditering vereist een reden.");
  const inv = await one<any>(`SELECT * FROM invoices WHERE id=$1 FOR UPDATE`, [invoiceId], db);
  if (!inv || inv.status === "concept" || inv.status === "credited" || inv.credits_invoice_id) throw new Error("Deze factuur kan niet worden gecrediteerd.");
  const lines = await q<any>(`SELECT * FROM invoice_lines WHERE invoice_id=$1`, [invoiceId], db);
  const r = await createInvoice(db, {
    sourceKey: `credit:${invoiceId}`,
    companyId: inv.company_id,
    subscriptionId: inv.subscription_id,
    appointmentId: inv.appointment_id,
    creditsInvoiceId: invoiceId,
    description: `Creditfactuur voor ${inv.number}: ${reason}`,
    lines: lines.map((l) => ({ description: `Credit: ${l.description}`, quantity: l.quantity, unitCents: -l.unit_cents })),
  });
  await q(`UPDATE invoices SET status='credited' WHERE id=$1`, [invoiceId], db);
  await audit(db, { actor, company: inv.company_id, action: "invoice.credited", entityType: "invoice", entityId: invoiceId, data: { reason, creditInvoiceId: r.id } });
  return r;
}
