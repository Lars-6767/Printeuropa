/** Abonnement wijzigen en stoppen. Actieve en geplande versies houden wijzigingen consistent. */
import { nextNumber, one, pad, q, type Db } from "./db";
import { getConfig, getConfigs } from "./settings";
import { computeOffer, type Offer } from "./pricing";
import { addDays, endOfMonth, firstOfNextMonth, today } from "./dates";
import { emitEvent } from "./jobs";
import { audit } from "./audit";
import { activeVersion, validatePreferences, type PreferenceInput } from "./appointments";
import { balances, openPeriod, periodFor } from "./credit";
import type { BoxSize } from "./config";
import { formatEuro } from "./money";

export async function effectiveDateForChange(db: Db) {
  const c = await getConfig("contract", db);
  if (c.changeEffectiveRule === "immediately") return today();
  if (c.changeEffectiveRule === "next_period") return firstOfNextMonth(today());
  return firstOfNextMonth(today());
}

/** Toont vóór bevestiging: huidige/nieuwe prijs, ingangsdatum, tegoed, geplande afspraken en omruilkosten. */
export async function previewChange(db: Db, companyId: number, subscriptionId: number, sel: { boxSize: BoxSize; packageCode: string; frequencyPerYear: number | null }) {
  const sub = await one<any>(`SELECT s.*, l.postcode, l.distance_km, l.distance_source, c.printmasters_status, c.printmasters_rule_code
    FROM subscriptions s JOIN locations l ON l.id=s.location_id JOIN companies c ON c.id=s.company_id WHERE s.id=$1 AND s.company_id=$2`, [subscriptionId, companyId], db);
  if (!sub || sub.status !== "active") return { error: "Alleen een actief abonnement kan worden gewijzigd." };
  const current = await activeVersion(db, subscriptionId);
  const scheduled = await one<any>(`SELECT * FROM subscription_versions WHERE subscription_id=$1 AND status='scheduled'`, [subscriptionId], db);
  const cfg = await getConfigs(["pricing", "transport", "packages", "printmasters", "contract"], db);
  const offer = computeOffer(cfg, {
    boxSize: sel.boxSize, packageCode: sel.packageCode, frequencyPerYear: sel.frequencyPerYear,
    postcode: sub.postcode, distance: { km: sub.distance_km, source: sub.distance_source ?? "onbekend" },
    printmasters: { status: sub.printmasters_status, ruleCode: sub.printmasters_rule_code },
  });
  const effective = await effectiveDateForChange(db);
  const swapNeeded = sel.boxSize !== current.box_size;
  const planned = await q<any>(`SELECT number, type, planned_date, request_status FROM appointments WHERE subscription_id=$1 AND execution_status='pending' AND request_status IN ('requested','confirmed') ORDER BY planned_date NULLS LAST`, [subscriptionId], db);
  const period = await periodFor(db, subscriptionId);
  const bal = period ? await balances(db, period.id) : null;
  const rule = cfg.contract.creditOnPackageChange ?? "keep_until_period_end";
  const creditText = !period
    ? offer.includedPerYear ? `Vanaf ${effective}: ${offer.includedPerYear} inbegrepen legingen per jaar.` : "Geen inbegrepen legingen."
    : rule === "keep_until_period_end"
      ? `Jullie huidige tegoed (${bal!.available} beschikbaar, ${bal!.reserved} ingepland) blijft geldig tot ${period.ends_on}. Daarna geldt ${offer.includedPerYear} per jaar.`
      : rule === "reset"
        ? `Op ${effective} start een nieuwe tegoedperiode met ${offer.includedPerYear} legingen. Ongebruikt tegoed (${bal!.available}) vervalt.`
        : `Op ${effective} wordt het tegoed naar rato herberekend op basis van ${offer.includedPerYear} legingen per jaar.`;
  const same = current.box_size === sel.boxSize && current.package_code === sel.packageCode && (current.terms.frequencyPerYear ?? null) === (offer.frequencyPerYear ?? null);
  return {
    sub, current, scheduled, offer, effective, swapNeeded,
    swapCents: swapNeeded ? cfg.pricing.swapCents : null,
    planned, creditText, same,
    blocker: same ? "Dit is jullie huidige abonnement." : offer.errors[0] ?? (offer.monthlyCents === null ? "De nieuwe prijs kan nog niet worden berekend (vervoer onbekend). Neem contact op met Bereyl." : offer.printmastersProvisional ? "Dit pakket vraagt eerst een gecontroleerde PrintMasters-afspraak." : null),
  };
}

/** Klant bevestigt de wijziging: wijzigingsvoorstel + akkoord + geplande versie (+ omruilopdracht). */
export async function requestChange(db: Db, companyId: number, subscriptionId: number, userId: number, sel: { boxSize: BoxSize; packageCode: string; frequencyPerYear: number | null }, prefs: PreferenceInput, meta: { ip: string | null; userAgent: string | null }, sourceKey: string) {
  const dup = await one<{ id: number }>(`SELECT p.id FROM proposals p WHERE p.subscription_id=$1 AND p.offer->>'sourceKey' = $2`, [subscriptionId, sourceKey], db);
  if (dup) return { ok: true, existing: true };
  const pv = await previewChange(db, companyId, subscriptionId, sel);
  if ("error" in pv) return { error: pv.error };
  if (pv.blocker) return { error: pv.blocker };
  if (pv.swapNeeded) {
    const err = await validatePreferences(db, prefs);
    if (err) return { error: err };
  }
  const contract = await getConfig("contract", db);
  const refs = await getConfigs(["pricing", "transport", "packages"], db);
  const snapshot = { ...pv.offer, input: sel, sourceKey, swapCents: pv.swapCents };
  const prop = await one<{ id: number }>(
    `INSERT INTO proposals(company_id, location_id, subscription_id, kind, version, status, provisional, offer, monthly_cents, valid_until, terms_version, config_refs, effective_from, created_by)
     VALUES ($1,$2,$3,'change',1,'open',false,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [companyId, pv.sub.location_id, subscriptionId, JSON.stringify(snapshot), pv.offer.monthlyCents, today(), contract.termsVersion, JSON.stringify(refs.refs), pv.effective, userId], db,
  );
  // De klant bevestigt hier expliciet; dat is het akkoord op het wijzigingsvoorstel.
  const { acceptProposalInTx } = await import("./subscriptions-accept");
  await acceptProposalInTx(db, prop!.id, userId, meta, { prefs });
  return { ok: true, proposalId: prop!.id };
}

/** Verwerkt een geaccepteerd wijzigings- of prijsvoorstel. */
export async function applyAcceptedChange(db: Db, p: any, userId: number, extra?: { prefs?: PreferenceInput }) {
  const subId = p.subscription_id;
  const current = await activeVersion(db, subId);
  const o: Offer & Record<string, any> = p.offer;
  const effective = p.effective_from ?? (await effectiveDateForChange(db));
  // Eén geplande versie tegelijk: een nieuwe wijziging vervangt de vorige geplande.
  await q(`UPDATE subscription_versions SET status='cancelled' WHERE subscription_id=$1 AND status='scheduled'`, [subId], db);
  const max = await one<{ v: number }>(`SELECT MAX(version) AS v FROM subscription_versions WHERE subscription_id=$1`, [subId], db);
  const immediate = effective <= today();
  if (immediate) await q(`UPDATE subscription_versions SET status='superseded' WHERE id=$1`, [current.id], db);
  await q(
    `INSERT INTO subscription_versions(subscription_id, version, status, effective_from, proposal_id, terms, box_size, package_code, monthly_cents)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [subId, max!.v + 1, immediate ? "active" : "scheduled", effective, p.id, JSON.stringify(o), o.boxSize, o.packageCode, o.monthlyCents], db,
  );
  let swapNumber: string | null = null;
  if (o.boxSize !== current.box_size) {
    const year = today().slice(0, 4);
    swapNumber = `AF-${year}-${pad(await nextNumber(db, `appointment-${year}`))}`;
    const prefs = extra?.prefs ?? { flexible: true, slots: [] };
    await q(
      `INSERT INTO appointments(number, source_key, company_id, location_id, subscription_id, type, flexible, preferences, funding, price_cents, price_detail, box_size, new_box_size, created_by)
       VALUES ($1,$2,$3,$4,$5,'swap',$6,$7,'contract',$8,$9,$10,$11,$12) ON CONFLICT (source_key) DO NOTHING`,
      [swapNumber, `proposal:${p.id}:swap`, p.company_id, p.location_id, subId, prefs.flexible, JSON.stringify(prefs.slots), o.swapCents ?? null, JSON.stringify({ label: `Omruilen ${current.box_size} → ${o.boxSize} liter` }), current.box_size, o.boxSize, userId], db,
    );
  }
  await emitEvent(db, "subscription.changed", {
    subscriptionId: subId, companyId: p.company_id, proposalId: p.id, userId,
    oldMonthlyCents: current.monthly_cents, newMonthlyCents: o.monthlyCents, effective,
    note: [swapNumber ? `Voor het nieuwe formaat plannen we een omruilafspraak (${swapNumber}); omruilkosten: ${o.swapCents === null || o.swapCents === undefined ? "nog vast te stellen" : formatEuro(o.swapCents)}.` : "", p.kind === "price_update" ? "Dit betreft een prijswijziging door Bereyl." : ""].filter(Boolean).join(" "),
  }, `proposal:${p.id}`);
  await audit(db, { actor: userId, company: p.company_id, action: "subscription.change_accepted", entityType: "subscription", entityId: subId, data: { from: { box: current.box_size, pkg: current.package_code, monthly: current.monthly_cents }, to: { box: o.boxSize, pkg: o.packageCode, monthly: o.monthlyCents }, effective } });
}

/** Dagelijks: geplande versies worden actief op hun ingangsdatum; tegoed volgens de ingestelde regel. */
export async function activateScheduledVersions(db: Db) {
  const due = await q<any>(`SELECT * FROM subscription_versions WHERE status='scheduled' AND effective_from <= $1`, [today()], db);
  const contract = await getConfig("contract", db);
  const packages = await getConfig("packages", db);
  for (const v of due) {
    await q(`UPDATE subscription_versions SET status='superseded' WHERE subscription_id=$1 AND status='active'`, [v.subscription_id], db);
    await q(`UPDATE subscription_versions SET status='active' WHERE id=$1`, [v.id], db);
    const rule = contract.creditOnPackageChange ?? "keep_until_period_end";
    if (rule !== "keep_until_period_end") {
      const period = await periodFor(db, v.subscription_id);
      if (period) {
        const b = await balances(db, period.id);
        if (b.available > 0) await q(`INSERT INTO credit_mutations(period_id, kind, delta_available, reason, idempotency_key) VALUES ($1,'expire',$2,'Pakketwissel',$3) ON CONFLICT DO NOTHING`, [period.id, -b.available, `period:${period.id}:switch:${v.id}`], db);
        await q(`UPDATE credit_periods SET closed=true, ends_on=$2 WHERE id=$1`, [period.id, addDays(v.effective_from, -1)], db);
      }
      const included = Number(v.terms.includedPerYear ?? 0);
      const n = rule === "prorate" && period ? Math.round((included * monthsBetween(v.effective_from, period.ends_on)) / 12) : included;
      await openPeriod(db, v.subscription_id, v.effective_from, rule === "prorate" && period ? Math.max(1, monthsBetween(v.effective_from, period.ends_on)) : packages.creditPeriodMonths, n, null, "Pakketwissel");
    }
  }
  return due.length;
}
function monthsBetween(a: string, b: string) {
  return Math.max(0, (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7)) + 1);
}

export async function previewCancel(db: Db, companyId: number, subscriptionId: number) {
  const sub = await one<any>(`SELECT * FROM subscriptions WHERE id=$1 AND company_id=$2`, [subscriptionId, companyId], db);
  if (!sub || !["active", "pending_placement"].includes(sub.status)) return { error: "Dit abonnement kan niet (meer) worden opgezegd." };
  const contract = await getConfig("contract", db);
  const v = await activeVersion(db, subscriptionId);
  const endDate = addDays(today(), contract.noticeDays ?? 0);
  const stopRule = contract.billingStopRule ?? "end_date";
  const billingStop = stopRule === "end_of_month" ? addDays(endOfMonth(endDate), 1) : stopRule === "pickup_date" ? null : addDays(endDate, 1);
  const terms: Offer & Record<string, any> = v.terms;
  const pickupCents: number | null = terms.finalPickupCents ?? null;
  const unbilled = await q<any>(`SELECT number, type FROM appointments WHERE subscription_id=$1 AND execution_status='executed' AND financial_status='pending'`, [subscriptionId], db);
  return {
    sub, version: v, endDate, billingStop, stopRule, pickupCents,
    provisionalRules: { notice: contract.noticeDays === null, stop: contract.billingStopRule === null, pickup: pickupCents === null },
    openCosts: unbilled,
  };
}

export async function cancelSubscription(db: Db, companyId: number, subscriptionId: number, userId: number, prefs: PreferenceInput, reason: string | null) {
  const pv = await previewCancel(db, companyId, subscriptionId);
  if ("error" in pv) return { error: pv.error };
  const err = await validatePreferences(db, prefs);
  if (err) return { error: err };
  await q(`UPDATE subscriptions SET status='ending', end_date=$2, billing_stops_at=$3 WHERE id=$1`, [subscriptionId, pv.endDate, pv.billingStop], db);
  await q(`UPDATE subscription_versions SET status='cancelled' WHERE subscription_id=$1 AND status='scheduled'`, [subscriptionId], db);
  // Openstaande (nog niet uitgevoerde) legingen blijven staan; de klant kan ze zelf annuleren.
  const year = today().slice(0, 4);
  const number = `AF-${year}-${pad(await nextNumber(db, `appointment-${year}`))}`;
  await q(
    `INSERT INTO appointments(number, source_key, company_id, location_id, subscription_id, type, flexible, preferences, note, funding, price_cents, price_detail, box_size, created_by)
     VALUES ($1,$2,$3,$4,$5,'final_pickup',$6,$7,$8,'contract',$9,$10,$11,$12) ON CONFLICT (source_key) DO NOTHING`,
    [number, `subscription:${subscriptionId}:final_pickup`, companyId, pv.sub.location_id, subscriptionId, prefs.flexible, JSON.stringify(prefs.slots), reason, pv.pickupCents, JSON.stringify({ label: "Definitief ophalen box" }), pv.version.box_size, userId], db,
  );
  await emitEvent(db, "subscription.cancelled", { subscriptionId, companyId, userId, endDate: pv.endDate, pickupCents: pv.pickupCents }, String(subscriptionId));
  await audit(db, { actor: userId, company: companyId, action: "subscription.cancelled", entityType: "subscription", entityId: subscriptionId, data: { endDate: pv.endDate, billingStop: pv.billingStop, reason } });
  return { ok: true, endDate: pv.endDate };
}
