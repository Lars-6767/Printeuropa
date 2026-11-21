/** Afspraken: aanvragen, bevestigen, wijzigen, annuleren, uitvoeren en wegen. */
import { nextNumber, one, pad, q, type Db } from "./db";
import { getConfig, getConfigs } from "./settings";
import { creditSummary, releaseCredit, reserveCredit, openPeriod } from "./credit";
import { settleAppointment } from "./billing";
import { emitEvent } from "./jobs";
import { audit } from "./audit";
import { createTask, closeTasks } from "./tasks";
import { today, addDays, weekdayCode } from "./dates";
import type { Offer } from "./pricing";
import { formatEuro } from "./money";

export type Funding = "included" | "paid" | "free_combination" | "contract" | "none";

export async function activeVersion(db: Db, subscriptionId: number) {
  return one<any>(`SELECT * FROM subscription_versions WHERE subscription_id=$1 AND status='active'`, [subscriptionId], db);
}

export async function subscriptionForLocation(db: Db, companyId: number, locationId: number) {
  return one<any>(`SELECT * FROM subscriptions WHERE company_id=$1 AND location_id=$2 AND status IN ('active','ending','pending_placement') ORDER BY id DESC LIMIT 1`, [companyId, locationId], db);
}

/** Mag dit bedrijf een leging combineren met een PrintMasters-levering? */
export async function canCombine(db: Db, companyId: number, terms: Offer) {
  const pm = await getConfig("printmasters", db);
  const c = await one<{ printmasters_status: string }>(`SELECT printmasters_status FROM companies WHERE id=$1`, [companyId], db);
  const statusOk = c!.printmasters_status === "verified" || (pm.combinationRequires === "verified_or_claimed" && c!.printmasters_status === "claimed");
  return statusOk && terms.freeCombinedEmptying;
}

/** Laat vóór de aanvraag zien welke prijs en welk tegoed worden gebruikt. */
export async function previewEmptying(db: Db, companyId: number, locationId: number, combine: boolean) {
  const sub = await subscriptionForLocation(db, companyId, locationId);
  if (!sub || sub.status === "pending_placement") return { error: "Er staat nog geen actieve box op deze locatie." };
  const v = await activeVersion(db, sub.id);
  const terms: Offer = v.terms;
  const credit = await creditSummary(db, sub.id);
  const combinable = await canCombine(db, companyId, terms);
  const freeForRequest = credit.available - credit.pendingRequests;
  let funding: Funding;
  let priceCents: number | null;
  let explanation: string;
  if (combine && combinable) {
    funding = "free_combination"; priceCents = 0;
    explanation = "Gratis: gecombineerd met een PrintMasters-levering. Dit verbruikt geen inbegrepen leging.";
  } else if (credit.period && freeForRequest > 0) {
    funding = "included"; priceCents = 0;
    explanation = `Inbegrepen: we gebruiken 1 van jullie ${credit.available} beschikbare legingen (periode t/m ${credit.period.ends_on}).`;
  } else {
    funding = "paid"; priceCents = terms.singleEmptyingCents;
    explanation = priceCents === null ? "Losse leging: de prijs wordt nog vastgesteld." : `Losse leging: ${formatEuro(priceCents)} excl. btw volgens jullie afspraak.`;
  }
  return { subscription: sub, terms, credit, combinable, funding, priceCents, explanation };
}

export interface PreferenceInput { flexible: boolean; slots: { date: string; daypart: string | null }[] }

export async function validatePreferences(db: Db, prefs: PreferenceInput): Promise<string | null> {
  const planning = await getConfig("planning", db);
  if (!prefs.flexible && prefs.slots.length === 0) return "Kies minimaal één voorkeursdag of laat ons in overleg plannen.";
  if (prefs.slots.length > planning.maxPreferences) return `Kies maximaal ${planning.maxPreferences} voorkeuren.`;
  const min = addDays(today(), planning.minLeadDays);
  for (const s of prefs.slots) {
    if (s.date < min) return `Kies een datum vanaf ${min}.`;
    if (!planning.days.includes(weekdayCode(s.date))) return "Op een van de gekozen dagen plannen we geen ritten.";
    if (s.daypart && !planning.dayparts.some((d) => d.code === s.daypart)) return "Onbekend dagdeel.";
  }
  return null;
}

async function newNumber(db: Db) {
  const year = today().slice(0, 4);
  return `AF-${year}-${pad(await nextNumber(db, `appointment-${year}`))}`;
}

/** Klant vraagt een leging aan. sourceKey voorkomt dubbele afspraken bij herhaald verzenden. */
export async function requestEmptying(db: Db, a: { companyId: number; locationId: number; userId: number; prefs: PreferenceInput; combine: boolean; deliveryRef?: string | null; note?: string | null; sourceKey: string }) {
  const dup = await one<{ id: number; number: string }>(`SELECT id, number FROM appointments WHERE source_key=$1`, [a.sourceKey], db);
  if (dup) return { id: dup.id, number: dup.number, existing: true };
  const err = await validatePreferences(db, a.prefs);
  if (err) return { error: err };
  const pv = await previewEmptying(db, a.companyId, a.locationId, a.combine);
  if ("error" in pv) return { error: pv.error };
  const open = await one(`SELECT 1 FROM appointments WHERE subscription_id=$1 AND type='emptying' AND request_status IN ('requested') AND execution_status='pending'`, [pv.subscription.id], db);
  if (open) return { error: "Er staat al een leging aangevraagd voor deze box. Wijzig die aanvraag of wacht op bevestiging." };
  const number = await newNumber(db);
  const row = await one<{ id: number }>(
    `INSERT INTO appointments(number, source_key, company_id, location_id, subscription_id, type, flexible, preferences, note, combine_printmasters, printmasters_delivery_ref, combination_status, funding, price_cents, price_detail, box_size, created_by)
     VALUES ($1,$2,$3,$4,$5,'emptying',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
    [number, a.sourceKey, a.companyId, a.locationId, pv.subscription.id, a.prefs.flexible, JSON.stringify(a.prefs.slots), a.note ?? null,
      pv.funding === "free_combination", a.deliveryRef ?? null, pv.funding === "free_combination" ? "requested" : null,
      pv.funding, pv.funding === "paid" ? pv.priceCents : pv.terms.singleEmptyingCents,
      JSON.stringify({ label: `Leging box ${pv.terms.boxLabel}`, agreedSingleEmptyingCents: pv.terms.singleEmptyingCents, explanation: pv.explanation }), pv.terms.boxSize, a.userId], db,
  );
  await emitEvent(db, "appointment.requested", { appointmentId: row!.id, companyId: a.companyId, userId: a.userId }, String(row!.id));
  await audit(db, { actor: a.userId, company: a.companyId, action: "appointment.requested", entityType: "appointment", entityId: row!.id, data: { funding: pv.funding, priceCents: pv.priceCents } });
  return { id: row!.id, number, existing: false };
}

/** Klant wijzigt voorkeuren. Een bevestigde afspraak gaat terug naar 'aangevraagd' en gereserveerd tegoed komt vrij. */
export async function changePreferences(db: Db, appointmentId: number, companyId: number, userId: number, prefs: PreferenceInput) {
  const a = await one<any>(`SELECT * FROM appointments WHERE id=$1 AND company_id=$2 FOR UPDATE`, [appointmentId, companyId], db);
  if (!a || a.execution_status !== "pending" || !["requested", "confirmed"].includes(a.request_status)) return { error: "Deze afspraak kan niet meer worden gewijzigd." };
  const planning = await getConfig("planning", db);
  if (a.request_status === "confirmed" && a.planned_date && hoursUntil(a.planned_date) < planning.changeUntilHoursBefore) {
    return { error: `Wijzigen kan tot ${planning.changeUntilHoursBefore} uur voor de afspraak. Neem contact op met Bereyl.` };
  }
  const err = await validatePreferences(db, prefs);
  if (err) return { error: err };
  if (a.request_status === "confirmed") await releaseCredit(db, a.id, userId, "Afspraak gewijzigd door klant");
  await q(`UPDATE appointments SET preferences=$2, flexible=$3, request_status='requested', planned_date=NULL, planned_daypart=NULL, confirmed_at=NULL WHERE id=$1`, [a.id, JSON.stringify(prefs.slots), prefs.flexible], db);
  // Reserveringssleutels zijn eenmalig; bij opnieuw bevestigen wordt een nieuwe sleutel gebruikt via 'rebook'.
  await q(`UPDATE credit_mutations SET idempotency_key = idempotency_key || ':' || id WHERE appointment_id=$1 AND kind IN ('reserve','release')`, [a.id], db);
  await emitEvent(db, "appointment.requested", { appointmentId: a.id, companyId, userId }, `${a.id}:changed:${Date.now()}`);
  await audit(db, { actor: userId, company: companyId, action: "appointment.preferences_changed", entityType: "appointment", entityId: a.id, data: prefs });
  return { ok: true };
}

function hoursUntil(date: string) {
  return (Date.parse(date + "T08:00:00+01:00") - Date.now()) / 3600000;
}

export async function cancelAppointment(db: Db, appointmentId: number, actor: { userId: number; staff: boolean; companyId?: number }, reason: string) {
  const a = await one<any>(`SELECT * FROM appointments WHERE id=$1 FOR UPDATE`, [appointmentId], db);
  if (!a) return { error: "Afspraak niet gevonden" };
  if (!actor.staff && a.company_id !== actor.companyId) return { error: "Geen toegang" };
  if (a.request_status === "cancelled") return { ok: true, already: true };
  if (a.execution_status !== "pending") return { error: "Een uitgevoerde afspraak kan niet worden geannuleerd." };
  if (!actor.staff) {
    if (a.type === "placement" || a.type === "final_pickup") return { error: "Neem contact op met Bereyl om deze afspraak te annuleren." };
    const planning = await getConfig("planning", db);
    if (a.planned_date && hoursUntil(a.planned_date) < planning.cancelUntilHoursBefore) return { error: `Annuleren kan tot ${planning.cancelUntilHoursBefore} uur voor de afspraak.` };
  }
  await releaseCredit(db, a.id, actor.userId);
  await q(`UPDATE appointments SET request_status='cancelled', cancelled_at=now(), cancel_reason=$2, financial_status='no_charge' WHERE id=$1`, [a.id, reason || null], db);
  await emitEvent(db, "appointment.cancelled", { appointmentId: a.id, companyId: a.company_id }, String(a.id));
  await audit(db, { actor: actor.userId, company: a.company_id, action: "appointment.cancelled", entityType: "appointment", entityId: a.id, data: { reason } });
  return { ok: true };
}

/** Bereyl bevestigt (of wijzigt) de planning. Een inbegrepen leging reserveert dan tegoed. */
export async function confirmAppointment(db: Db, appointmentId: number, staffId: number, p: { date: string; daypart: string | null; routeId: number | null; assignedUserId: number | null; combinationStatus?: "confirmed" | "declined" | null }) {
  const a = await one<any>(`SELECT * FROM appointments WHERE id=$1 FOR UPDATE`, [appointmentId], db);
  if (!a || a.request_status === "cancelled" || a.execution_status !== "pending") return { error: "Deze afspraak kan niet (meer) worden bevestigd." };
  const notes: string[] = [];
  let funding: Funding = a.funding;
  let price = a.price_cents;
  if (a.type === "emptying" && a.combine_printmasters && p.combinationStatus === "declined") {
    funding = "included"; // opnieuw beoordelen hieronder
    notes.push("Combinatie met PrintMasters-levering niet mogelijk.");
  }
  if (a.type === "emptying" && funding === "included") {
    const ok = await reserveCredit(db, a.subscription_id, a.id, staffId, p.date);
    if (!ok) {
      funding = "paid";
      price = a.price_detail?.agreedSingleEmptyingCents ?? a.price_cents;
      notes.push("Geen inbegrepen leging meer beschikbaar: afgehandeld als losse leging volgens afspraak.");
    }
  }
  const wasConfirmed = a.request_status === "confirmed";
  await q(
    `UPDATE appointments SET request_status='confirmed', planned_date=$2, planned_daypart=$3, route_id=$4, assigned_user_id=$5, confirmed_at=now(), confirmed_by=$6,
       funding=$7, price_cents=$8, combination_status=COALESCE($9, combination_status), combine_printmasters = CASE WHEN $9='declined' THEN false ELSE combine_printmasters END
     WHERE id=$1`,
    [a.id, p.date, p.daypart, p.routeId, p.assignedUserId, staffId, funding, price, p.combinationStatus ?? null], db,
  );
  await emitEvent(db, "appointment.confirmed", { appointmentId: a.id, companyId: a.company_id, note: notes.join(" ") }, `${a.id}:${p.date}:${p.daypart ?? ""}:${Date.now()}`);
  await closeTasks(db, "appointment", a.id, ["confirm_appointment"]);
  await audit(db, { actor: staffId, company: a.company_id, action: wasConfirmed ? "appointment.rescheduled" : "appointment.confirmed", entityType: "appointment", entityId: a.id, data: { ...p, funding, price, notes } });
  return { ok: true, notes };
}

/** Planningswaarschuwing: dubbele planning en capaciteit per route/dag. */
export async function planningWarnings(db: Db, date: string, routeId: number | null, excludeId?: number) {
  const warnings: string[] = [];
  if (routeId) {
    const r = await one<{ capacity_per_day: number; name: string }>(`SELECT capacity_per_day, name FROM staff_routes WHERE id=$1`, [routeId], db);
    const n = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM appointments WHERE planned_date=$1 AND route_id=$2 AND request_status='confirmed' AND id <> COALESCE($3, 0)`, [date, routeId, excludeId ?? null], db);
    if (r && n!.n >= r.capacity_per_day) warnings.push(`${r.name} zit op ${date} al vol (${n!.n}/${r.capacity_per_day}).`);
  }
  return warnings;
}

export async function locationDoublePlanned(db: Db, locationId: number, date: string, excludeId: number) {
  return one<{ number: string }>(`SELECT number FROM appointments WHERE location_id=$1 AND planned_date=$2 AND request_status='confirmed' AND id<>$3 LIMIT 1`, [locationId, date, excludeId], db);
}

/**
 * Uitvoering vastleggen door een medewerker. Idempotent: een tweede keer vastleggen verandert niets.
 * Een latere weging verandert de uitvoeringsstatus niet.
 */
export async function executeAppointment(db: Db, appointmentId: number, staffId: number, x: { boxTakenId: number | null; boxPlacedId: number | null; photoFileIds: number[]; note: string | null; combinationDone?: boolean }) {
  const a = await one<any>(`SELECT * FROM appointments WHERE id=$1 FOR UPDATE`, [appointmentId], db);
  if (!a) return { error: "Afspraak niet gevonden" };
  if (a.execution_status === "executed") return { ok: true, already: true };
  if (a.request_status !== "confirmed") return { error: "Alleen een bevestigde afspraak kan worden uitgevoerd." };
  const contract = await getConfig("contract", db);
  const needsTaken = a.type !== "placement";
  const needsPlaced = a.type === "placement" || a.type === "swap" || a.type === "emptying";
  if (needsTaken && !x.boxTakenId) return { error: "Kies de meegenomen box." };
  if (needsPlaced && !x.boxPlacedId) return { error: "Kies de geplaatste box." };

  if (x.boxPlacedId) {
    const b = await one<any>(`SELECT * FROM boxes WHERE id=$1 FOR UPDATE`, [x.boxPlacedId], db);
    const expectSize = a.type === "swap" ? a.new_box_size : a.box_size;
    if (!b || !["in_stock", "reserved"].includes(b.status)) return { error: "De geplaatste box is niet beschikbaar." };
    if (expectSize && b.size !== expectSize) return { error: `De geplaatste box moet ${expectSize} liter zijn.` };
  }
  if (x.boxTakenId) {
    const b = await one<any>(`SELECT * FROM boxes WHERE id=$1 FOR UPDATE`, [x.boxTakenId], db);
    if (!b || b.location_id !== a.location_id) return { error: "De meegenomen box staat niet op deze locatie." };
    await q(`UPDATE boxes SET status='in_transit', location_id=NULL, company_id=NULL WHERE id=$1`, [x.boxTakenId], db);
  }
  if (x.boxPlacedId) {
    await q(`UPDATE boxes SET status='placed', location_id=$2, company_id=$3 WHERE id=$1`, [x.boxPlacedId, a.location_id, a.company_id], db);
  }

  // Gecombineerde leging toch niet samen met levering uitgevoerd → opnieuw beoordelen volgens afspraak.
  if (a.type === "emptying" && a.funding === "free_combination" && x.combinationDone === false) {
    const ok = await reserveCredit(db, a.subscription_id, a.id, staffId);
    const newFunding = ok ? "included" : "paid";
    await q(`UPDATE appointments SET funding=$2, price_cents=$3, combination_status='declined' WHERE id=$1`, [a.id, newFunding, ok ? a.price_cents : a.price_detail?.agreedSingleEmptyingCents ?? a.price_cents], db);
  }

  const collects = a.type !== "placement";
  await q(
    `UPDATE appointments SET execution_status='executed', executed_at=now(), executed_by=$2, weighing_status=$3 WHERE id=$1`,
    [a.id, staffId, collects ? "pending" : "not_applicable"], db,
  );
  if (collects) {
    const col = await one<{ id: number }>(
      `INSERT INTO collections(appointment_id, company_id, location_id, collected_at, box_taken_id, box_placed_id, employee_user_id, status, note)
       VALUES ($1,$2,$3,now(),$4,$5,$6,'picked_up',$7) ON CONFLICT (appointment_id) DO NOTHING RETURNING id`,
      [a.id, a.company_id, a.location_id, x.boxTakenId, x.boxPlacedId, staffId, x.note], db,
    );
    for (const f of x.photoFileIds) await q(`INSERT INTO collection_photos(collection_id, file_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [col!.id, f], db);
    await createTask(db, { type: "weighing_missing", title: `Weging invoeren voor ${a.number}`, companyId: a.company_id, refType: "collection", refId: col!.id, dueAt: new Date(Date.now() + 3 * 86400000), dedupeKey: `weigh:${col!.id}` });
  }

  if (a.type === "placement") {
    const startRule = contract.startRule ?? "placement_date";
    const v = await activeVersion(db, a.subscription_id);
    const start = startRule === "acceptance_date" ? v.effective_from : startRule === "first_of_next_month" ? firstOfNext(today()) : today();
    await q(`UPDATE subscriptions SET status='active', started_at=$2 WHERE id=$1 AND status='pending_placement'`, [a.subscription_id, start], db);
    await q(`UPDATE subscription_versions SET effective_from=$2 WHERE id=$1`, [v.id, start], db);
    const pk = await getConfigs(["packages"], db);
    const included = Number(v.terms.includedPerYear ?? 0);
    await openPeriod(db, a.subscription_id, start, pk.packages.creditPeriodMonths, included, staffId, "Start abonnement");
    await emitEvent(db, "box.placed", { appointmentId: a.id, companyId: a.company_id }, String(a.id));
  }
  if (a.type === "emptying") await emitEvent(db, "emptying.executed", { appointmentId: a.id, companyId: a.company_id }, String(a.id));
  if (a.type === "final_pickup") {
    await q(`UPDATE subscriptions SET status='ended', billing_stops_at = COALESCE(billing_stops_at, $2::date + 1) WHERE id=$1`, [a.subscription_id, today()], db);
  }
  await audit(db, { actor: staffId, company: a.company_id, action: "appointment.executed", entityType: "appointment", entityId: a.id, data: x });
  const settle = await settleAppointment(db, a.id, staffId);
  return { ok: true, financial: settle.outcome };
}

function firstOfNext(iso: string) {
  const d = new Date(iso.slice(0, 7) + "-01T12:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}

export async function confirmWeight(db: Db, collectionId: number, grams: number, staffId: number) {
  if (!Number.isInteger(grams) || grams <= 0 || grams > 2_000_000) return { error: "Vul een geldig nettogewicht in." };
  const c = await one<any>(`SELECT * FROM collections WHERE id=$1 FOR UPDATE`, [collectionId], db);
  if (!c) return { error: "Inzameling niet gevonden" };
  if (c.status === "weight_confirmed") return { error: "Het gewicht is al bevestigd. Gebruik een correctie met reden." };
  await q(`UPDATE collections SET status='weight_confirmed', net_weight_grams=$2, weighed_at=now() WHERE id=$1`, [collectionId, grams], db);
  await q(`UPDATE appointments SET weighing_status='confirmed' WHERE id=$1`, [c.appointment_id], db);
  if (c.box_taken_id) await q(`UPDATE boxes SET status='in_stock' WHERE id=$1 AND status='in_transit'`, [c.box_taken_id], db);
  await closeTasks(db, "collection", collectionId, ["weighing_missing"]);
  await emitEvent(db, "weight.confirmed", { collectionId, appointmentId: c.appointment_id, companyId: c.company_id }, String(collectionId));
  await audit(db, { actor: staffId, company: c.company_id, action: "weight.confirmed", entityType: "collection", entityId: collectionId, data: { grams } });
  return { ok: true };
}

export async function correctWeight(db: Db, collectionId: number, grams: number, reason: string, staffId: number) {
  if (!reason.trim()) return { error: "Een correctie vereist een reden." };
  if (!Number.isInteger(grams) || grams < 0) return { error: "Vul een geldig gewicht in." };
  const c = await one<any>(`SELECT * FROM collections WHERE id=$1 FOR UPDATE`, [collectionId], db);
  if (!c || c.status !== "weight_confirmed") return { error: "Alleen een bevestigd gewicht kan worden gecorrigeerd." };
  await q(`INSERT INTO weight_corrections(collection_id, old_grams, new_grams, reason, user_id) VALUES ($1,$2,$3,$4,$5)`, [collectionId, c.net_weight_grams, grams, reason, staffId], db);
  await q(`UPDATE collections SET net_weight_grams=$2 WHERE id=$1`, [collectionId, grams], db);
  await audit(db, { actor: staffId, company: c.company_id, action: "weight.corrected", entityType: "collection", entityId: collectionId, data: { from: c.net_weight_grams, to: grams, reason } });
  return { ok: true };
}
