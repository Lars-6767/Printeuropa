/** Algemene prijswijziging doorvoeren bij bestaande klanten via een afzonderlijk, te bevestigen wijzigingsvoorstel. */
import { one, q, type Db } from "./db";
import { getConfigs } from "./settings";
import { computeOffer, type Offer } from "./pricing";
import { addDays, today } from "./dates";
import { emitEvent, enqueue } from "./jobs";
import { audit } from "./audit";

export async function priceUpdateCandidates(db?: Db) {
  const cfg = await getConfigs(["pricing", "transport", "packages", "printmasters"], db);
  const subs = await q<any>(`SELECT s.id, s.company_id, c.name AS company_name, c.printmasters_status, c.printmasters_rule_code, l.postcode, l.distance_km, l.distance_source,
      v.terms, v.monthly_cents, v.box_size, v.package_code,
      (SELECT 1 FROM proposals p WHERE p.subscription_id=s.id AND p.status='open' LIMIT 1) AS has_open
    FROM subscriptions s JOIN companies c ON c.id=s.company_id JOIN locations l ON l.id=s.location_id JOIN subscription_versions v ON v.subscription_id=s.id AND v.status='active'
    WHERE s.status='active' ORDER BY c.name`, [], db);
  return subs.map((s) => {
    const t: Offer & Record<string, any> = s.terms;
    let next: Offer | null = null; let error: string | null = null;
    try {
      next = computeOffer(cfg, { boxSize: s.box_size, packageCode: s.package_code, frequencyPerYear: t.frequencyPerYear ?? null, postcode: s.postcode, distance: { km: s.distance_km, source: s.distance_source ?? "onbekend" }, printmasters: { status: s.printmasters_status, ruleCode: s.printmasters_rule_code } });
    } catch (e) { error = e instanceof Error ? e.message : "Fout"; }
    const conflict = t.personal ? "Persoonlijke prijsafspraak: wordt standaard niet gewijzigd" : s.has_open ? "Er staat al een open voorstel" : t.demo ? "Demogegevens" : error;
    return { ...s, current: s.monthly_cents, next: next?.monthlyCents ?? null, nextSingle: next?.singleEmptyingCents ?? null, currentSingle: t.singleEmptyingCents, conflict, offer: next };
  });
}

export async function createPriceUpdateProposal(db: Db, subscriptionId: number, effective: string, actor: number) {
  const list = await priceUpdateCandidates(db);
  const c = list.find((x) => x.id === subscriptionId);
  if (!c || !c.offer || c.next === null || c.next === c.current) return false;
  const cfg = await getConfigs(["contract"], db);
  const sub = await one<any>(`SELECT * FROM subscriptions WHERE id=$1`, [subscriptionId], db);
  const p = await one<{ id: number }>(
    `INSERT INTO proposals(company_id, location_id, subscription_id, kind, version, status, provisional, offer, monthly_cents, valid_until, terms_version, config_refs, effective_from, created_by)
     VALUES ($1,$2,$3,'price_update',1,'open',false,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [sub.company_id, sub.location_id, subscriptionId, JSON.stringify({ ...c.offer, input: { boxSize: c.box_size, packageCode: c.package_code, frequencyPerYear: c.terms.frequencyPerYear ?? null } }), c.next, addDays(today(), cfg.contract.proposalValidityDays), cfg.contract.termsVersion, JSON.stringify({}), effective, actor], db,
  );
  await enqueue(db, "proposal.pdf", { proposalId: p!.id }, `proposal:${p!.id}:pdf`);
  await emitEvent(db, "proposal.requested", { proposalId: p!.id, companyId: sub.company_id }, `proposal:${p!.id}`);
  await audit(db, { actor, company: sub.company_id, action: "price_update.proposed", entityType: "subscription", entityId: subscriptionId, data: { from: c.current, to: c.next, effective } });
  return true;
}
