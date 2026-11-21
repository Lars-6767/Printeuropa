/** Aanvragen, voorstellen en akkoord. */
import { z } from "zod";
import { nextNumber, one, pad, q, tx, type Db } from "./db";
import { getConfigs } from "./settings";
import { computeOffer, type DistanceInfo, type Offer, type OfferInput } from "./pricing";
import { adviseBox } from "./advice";
import { calculateDistance } from "./distance";
import { inWorkArea, normalizePostcode } from "./workarea";
import { addDays, today } from "./dates";
import { emitEvent, enqueue } from "./jobs";
import { audit } from "./audit";
import { createTask, closeTasks } from "./tasks";
import type { BoxSize } from "./config";

const slot = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), daypart: z.string().nullable() });

export const quizSchema = z.object({
  submissionId: z.string().uuid(),
  printmasters: z.enum(["customer", "intro", "no"]),
  pmFollowUp: z.object({ piecesPerYear: z.coerce.number().int().min(0).nullable().optional(), products: z.string().max(500).optional() }).optional(),
  inflow: z.object({
    unit: z.enum(["kg", "pieces", "bags", "unknown"]),
    amount: z.coerce.number().min(0).nullable().optional(),
    employees: z.coerce.number().int().min(0).nullable().optional(),
    replacementPerYear: z.coerce.number().min(0).nullable().optional(),
    oneOffStockKg: z.coerce.number().min(0).nullable().optional(),
  }),
  boxSize: z.coerce.number().refine((v) => [250, 500, 1000].includes(v), "Kies een boxformaat"),
  packageCode: z.string().min(1, "Kies een pakket"),
  frequencyPerYear: z.coerce.number().int().nullable().optional(),
  company: z.object({
    name: z.string().trim().min(2, "Vul de bedrijfsnaam in").max(200),
    contactName: z.string().trim().min(2, "Vul de naam van de contactpersoon in").max(200),
    email: z.string().trim().toLowerCase().email("Vul een geldig e-mailadres in"),
    phone: z.string().trim().min(8, "Vul een telefoonnummer in voor afstemming").max(30),
    coc: z.string().trim().max(20).optional().default(""),
  }),
  location: z.object({
    street: z.string().trim().min(3, "Vul straat en huisnummer in").max(200),
    postcode: z.string().trim().refine((v) => normalizePostcode(v) !== null && normalizePostcode(v)!.length === 7, "Vul een geldige postcode in (1234 AB)"),
    city: z.string().trim().min(2, "Vul de plaats in").max(100),
    instructions: z.string().trim().max(1000).optional().default(""),
    note: z.string().trim().max(1000).optional().default(""),
  }),
  invoice: z.object({
    differentAddress: z.boolean().default(false),
    attn: z.string().trim().max(200).optional().default(""),
    street: z.string().trim().max(200).optional().default(""),
    postcode: z.string().trim().max(10).optional().default(""),
    city: z.string().trim().max(100).optional().default(""),
    email: z.string().trim().toLowerCase().max(200).optional().default(""),
  }).superRefine((v, ctx) => {
    if (v.differentAddress) {
      if (v.street.length < 3) ctx.addIssue({ code: "custom", path: ["street"], message: "Vul het factuuradres in" });
      if (!normalizePostcode(v.postcode)) ctx.addIssue({ code: "custom", path: ["postcode"], message: "Vul een geldige postcode in" });
      if (v.city.length < 2) ctx.addIssue({ code: "custom", path: ["city"], message: "Vul de plaats in" });
    }
    if (v.email && !z.string().email().safeParse(v.email).success) ctx.addIssue({ code: "custom", path: ["email"], message: "Vul een geldig factuurmailadres in" });
  }),
  preferences: z.object({ flexible: z.boolean(), slots: z.array(slot).max(10) }).superRefine((v, ctx) => {
    if (!v.flexible && v.slots.length === 0) ctx.addIssue({ code: "custom", path: ["slots"], message: "Kies minimaal één voorkeursdag of laat ons in overleg plannen" });
  }),
});
export type QuizInput = z.infer<typeof quizSchema>;

export function pmStatusFromAnswer(a: QuizInput["printmasters"]): "claimed" | "interest" | "none" {
  return a === "customer" ? "claimed" : a === "intro" ? "interest" : "none";
}

/** Berekening voor de keuzehulp. Wordt bij iedere wijziging opnieuw op de server uitgevoerd. */
export async function quote(input: {
  boxSize: BoxSize; packageCode: string; frequencyPerYear: number | null; postcode: string | null; street?: string; city?: string;
  printmasters: QuizInput["printmasters"]; inflow?: QuizInput["inflow"];
}, db?: Db) {
  const cfg = await getConfigs(["pricing", "transport", "packages", "printmasters", "advice", "planning", "integrations"], db);
  const pc = input.postcode ? normalizePostcode(input.postcode) : null;
  let distance: DistanceInfo = { km: null, source: "onbekend" };
  let outside = false;
  if (pc) {
    outside = !inWorkArea(cfg.planning, pc);
    distance = await calculateDistance(cfg.transport, cfg.integrations, { postcode: pc, street: input.street, city: input.city });
    if (distance.source === "route" && !input.street) distance.source = "postcode_indicatie";
  }
  const pmStatus = pmStatusFromAnswer(input.printmasters);
  const base: Omit<OfferInput, "boxSize"> = { packageCode: input.packageCode, frequencyPerYear: input.frequencyPerYear, postcode: pc, distance, printmasters: { status: pmStatus, ruleCode: null } };
  const offers = cfg.pricing.boxes.filter((b) => b.available).map((b) => computeOffer(cfg, { ...base, boxSize: b.size }));
  const advice = input.inflow ? adviseBox(cfg.advice, cfg.pricing.boxes, input.inflow, cfg.packages.items.find((p) => p.kind === "scheduled")?.frequencies.map((f) => f.perYear)) : null;
  return { offers, offer: offers.find((o) => o.boxSize === input.boxSize) ?? offers[0], advice, outside, distance, refs: cfg.refs };
}

export interface SubmitResult { ok: true; requestNumber: string; outside?: false; existing: boolean }

/** Verstuurt de aanvraag. Idempotent op submissionId: herhaald verzenden geeft dezelfde aanvraag terug. */
export async function submitProposalRequest(input: QuizInput): Promise<SubmitResult | { ok: false; outside: true }> {
  const existing = await one<{ number: string }>(`SELECT number FROM requests WHERE submission_id=$1`, [input.submissionId]);
  if (existing) return { ok: true, requestNumber: existing.number, existing: true };

  const pc = normalizePostcode(input.location.postcode)!;
  const quoteRes = await quote({
    boxSize: input.boxSize as BoxSize, packageCode: input.packageCode, frequencyPerYear: input.frequencyPerYear ?? null,
    postcode: pc, street: input.location.street, city: input.location.city, printmasters: input.printmasters, inflow: input.inflow,
  });
  if (quoteRes.outside) return { ok: false, outside: true };
  const offer = quoteRes.offer;
  if (offer.errors.length) throw new Error(offer.errors.join(" "));

  try {
    return await insertRequest(input, quoteRes, pc);
  } catch (e: any) {
    // Gelijktijdige dubbelklik: de unieke submission_id voorkomt een tweede aanvraag
    if (e?.code === "23505") {
      const ex = await one<{ number: string }>(`SELECT number FROM requests WHERE submission_id=$1`, [input.submissionId]);
      if (ex) return { ok: true, requestNumber: ex.number, existing: true };
    }
    throw e;
  }
}

async function insertRequest(input: QuizInput, quoteRes: Awaited<ReturnType<typeof quote>>, pc: string): Promise<SubmitResult> {
  const offer = quoteRes.offer;
  return tx(async (c) => {
    // Tweede controle binnen de transactie (gelijktijdige dubbelklik)
    const again = await one<{ number: string }>(`SELECT number FROM requests WHERE submission_id=$1`, [input.submissionId], c);
    if (again) return { ok: true as const, requestNumber: again.number, existing: true };
    const cfg = await getConfigs(["contract"], c);
    const year = today().slice(0, 4);
    const number = `AV-${year}-${pad(await nextNumber(c, `request-${year}`))}`;
    const pmStatus = pmStatusFromAnswer(input.printmasters);

    const company = await one<{ id: number }>(
      `INSERT INTO companies(name, coc_number, invoice_email, invoice_attn, invoice_street, invoice_postcode, invoice_city, printmasters_status, printmasters_note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [
        input.company.name, input.company.coc || null, input.invoice.email || input.company.email,
        input.invoice.attn || input.company.contactName,
        input.invoice.differentAddress ? input.invoice.street : input.location.street,
        input.invoice.differentAddress ? normalizePostcode(input.invoice.postcode) : pc,
        input.invoice.differentAddress ? input.invoice.city : input.location.city,
        pmStatus,
        input.pmFollowUp ? JSON.stringify(input.pmFollowUp) : null,
      ], c,
    );
    const location = await one<{ id: number }>(
      `INSERT INTO locations(company_id, name, street, postcode, city, instructions, contact_name, contact_phone, distance_km, distance_source, distance_calculated_at)
       VALUES ($1,'Hoofdlocatie',$2,$3,$4,$5,$6,$7,$8,$9, now()) RETURNING id`,
      [company!.id, input.location.street, pc, input.location.city, input.location.instructions || null, input.company.contactName, input.company.phone, offer.distance.km, offer.distance.source], c,
    );
    // Gebruiker: bestaand of nieuw. Het lidmaatschap blijft 'pending' tot de toegang via e-mail is bevestigd.
    let user = await one<{ id: number }>(`SELECT id FROM users WHERE email=$1`, [input.company.email], c);
    if (!user) user = await one<{ id: number }>(`INSERT INTO users(email, name, phone) VALUES ($1,$2,$3) RETURNING id`, [input.company.email, input.company.contactName, input.company.phone], c);
    await q(`INSERT INTO memberships(user_id, company_id, role, status) VALUES ($1,$2,'customer_admin','pending') ON CONFLICT DO NOTHING`, [user!.id, company!.id], c);

    const answers = { printmasters: input.printmasters, pmFollowUp: input.pmFollowUp, inflow: input.inflow, advice: quoteRes.advice, location: { instructions: input.location.instructions, note: input.location.note }, preferences: input.preferences };
    const contact = { name: input.company.contactName, email: input.company.email, phone: input.company.phone, userId: user!.id };
    const req = await one<{ id: number }>(
      `INSERT INTO requests(number, submission_id, company_id, kind, answers, contact) VALUES ($1,$2,$3,'proposal',$4,$5) RETURNING id`,
      [number, input.submissionId, company!.id, JSON.stringify(answers), JSON.stringify(contact)], c,
    );
    const offerSnapshot = { ...offer, input: { boxSize: input.boxSize, packageCode: input.packageCode, frequencyPerYear: input.frequencyPerYear ?? null } };
    const proposal = await one<{ id: number }>(
      `INSERT INTO proposals(request_id, company_id, location_id, kind, version, status, provisional, offer, monthly_cents, valid_until, terms_version, config_refs)
       VALUES ($1,$2,$3,'new',1,'open',$4,$5,$6,$7,$8,$9) RETURNING id`,
      [req!.id, company!.id, location!.id, offer.printmastersProvisional, JSON.stringify(offerSnapshot), offer.monthlyCents ?? 0, addDays(today(), cfg.contract.proposalValidityDays), cfg.contract.termsVersion, JSON.stringify(quoteRes.refs)], c,
    );

    await createTask(c, { type: "new_request", title: `Nieuwe aanvraag ${number}: ${input.company.name}`, companyId: company!.id, refType: "proposal", refId: proposal!.id, priority: "normal", dedupeKey: `new_request:${req!.id}` });
    if (pmStatus === "claimed") {
      await createTask(c, { type: "printmasters_verify", title: `PrintMasters-klantstatus controleren: ${input.company.name}`, detail: input.pmFollowUp ? JSON.stringify(input.pmFollowUp) : undefined, companyId: company!.id, refType: "company", refId: company!.id, priority: "high", dedupeKey: `pm_verify:${company!.id}` });
    }
    if (pmStatus === "interest") {
      await emitEvent(c, "printmasters.interest", { companyId: company!.id, userId: user!.id }, `company:${company!.id}`);
    }
    if (offer.transportPending) {
      await createTask(c, { type: "distance_missing", title: `Afstand vaststellen voor ${input.company.name} (${pc})`, companyId: company!.id, refType: "location", refId: location!.id, priority: "high", dedupeKey: `distance:${location!.id}` });
    }
    await enqueue(c, "proposal.pdf", { proposalId: proposal!.id }, `proposal:${proposal!.id}:pdf`);
    await emitEvent(c, "proposal.requested", { proposalId: proposal!.id, companyId: company!.id, userId: user!.id }, `proposal:${proposal!.id}`);
    await audit(c, { company: company!.id, action: "request.submitted", entityType: "request", entityId: req!.id, data: { number, boxSize: input.boxSize, packageCode: input.packageCode, monthlyCents: offer.monthlyCents } });
    return { ok: true as const, requestNumber: number, existing: false };
  });
}

/**
 * Nieuwe voorstelversie op basis van de huidige gepubliceerde instellingen (bijv. na PrintMasters-controle,
 * vastgestelde afstand of persoonlijke afspraak). De vorige open versie wordt 'vervangen'.
 */
export async function reissueProposal(db: Db, proposalId: number, actor: number | null, overrides: { boxSize?: BoxSize; packageCode?: string; frequencyPerYear?: number | null; personal?: { monthlyCents?: number | null; singleEmptyingCents?: number | null; note?: string } } = {}) {
  const old = await one<any>(`SELECT p.*, l.postcode, l.distance_km, l.distance_source, c.printmasters_status, c.printmasters_rule_code
    FROM proposals p JOIN locations l ON l.id=p.location_id JOIN companies c ON c.id=p.company_id WHERE p.id=$1 FOR UPDATE OF p`, [proposalId], db);
  if (!old) throw new Error("Voorstel niet gevonden");
  if (old.status !== "open") throw new Error("Alleen een openstaand voorstel kan opnieuw worden uitgebracht.");
  const cfg = await getConfigs(["pricing", "transport", "packages", "printmasters", "contract"], db);
  const inp = old.offer.input ?? {};
  let pkg = overrides.packageCode ?? inp.packageCode;
  if (old.printmasters_status === "rejected" && cfg.packages.items.find((p) => p.code === pkg)?.kind === "printmasters") pkg = "on_demand";
  const offer: Offer & Record<string, any> = computeOffer(cfg, {
    boxSize: (overrides.boxSize ?? inp.boxSize) as BoxSize,
    packageCode: pkg,
    frequencyPerYear: overrides.frequencyPerYear !== undefined ? overrides.frequencyPerYear : inp.frequencyPerYear,
    postcode: old.postcode,
    distance: { km: old.distance_km, source: old.distance_source ?? "onbekend" },
    printmasters: { status: old.printmasters_status, ruleCode: old.printmasters_rule_code },
  });
  if (overrides.personal) applyPersonal(offer, overrides.personal);
  const snapshot = { ...offer, input: { boxSize: offer.boxSize, packageCode: offer.packageCode, frequencyPerYear: offer.frequencyPerYear } };
  await q(`UPDATE proposals SET status='superseded' WHERE id=$1`, [proposalId], db);
  const np = await one<{ id: number }>(
    `INSERT INTO proposals(request_id, company_id, location_id, subscription_id, kind, version, status, provisional, offer, monthly_cents, valid_until, terms_version, config_refs, effective_from, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,'open',$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [old.request_id, old.company_id, old.location_id, old.subscription_id, old.kind, old.version + 1, offer.printmastersProvisional, JSON.stringify(snapshot), offer.monthlyCents ?? 0, addDays(today(), cfg.contract.proposalValidityDays), cfg.contract.termsVersion, JSON.stringify(cfg.refs), old.effective_from, actor], db,
  );
  await enqueue(db, "proposal.pdf", { proposalId: np!.id }, `proposal:${np!.id}:pdf`);
  await audit(db, { actor, company: old.company_id, action: "proposal.reissued", entityType: "proposal", entityId: np!.id, data: { previous: proposalId, monthlyCents: offer.monthlyCents, personal: overrides.personal ?? null } });
  return np!.id;
}

/** Persoonlijke prijsafspraak: overschrijft maandbedrag en/of losse legingsprijs en markeert de afspraak. */
export function applyPersonal(offer: Offer & Record<string, any>, p: { monthlyCents?: number | null; singleEmptyingCents?: number | null; note?: string }) {
  offer.personal = { ...p, listMonthlyCents: offer.monthlyCents, listSingleEmptyingCents: offer.singleEmptyingCents };
  if (p.monthlyCents !== undefined && p.monthlyCents !== null) {
    offer.monthlyCents = p.monthlyCents;
    offer.monthlyVatCents = Math.round((p.monthlyCents * offer.vatBp) / 10000);
    offer.yearTotalCents = p.monthlyCents * 12;
    offer.yearExactCents = offer.yearTotalCents;
    offer.roundingDiffCents = 0;
  }
  if (p.singleEmptyingCents !== undefined && p.singleEmptyingCents !== null) offer.singleEmptyingCents = p.singleEmptyingCents;
  offer.notes = [...offer.notes, `Persoonlijke prijsafspraak${p.note ? `: ${p.note}` : ""}.`];
}

export function acceptBlockers(p: { status: string; valid_until: string; provisional: boolean; offer: Offer }): string | null {
  if (p.status === "accepted") return null;
  if (p.status !== "open") return "Dit voorstel is niet meer geldig.";
  if (p.valid_until < today()) return "Dit voorstel is verlopen. Vraag Bereyl om een nieuw voorstel.";
  if (p.provisional) return "Bereyl controleert eerst jullie PrintMasters-afspraak. Daarna ontvang je de definitieve prijs om akkoord te geven.";
  if (p.offer.transportPending || p.offer.monthlyCents === null) return "Bereyl stelt eerst de vervoersprijs vast. Daarna ontvang je een definitief voorstel.";
  return null;
}

/**
 * Akkoord. Idempotent: herhaald klikken levert hetzelfde akkoord, dezelfde opdracht en dezelfde documenten op.
 */
export async function acceptProposal(proposalId: number, userId: number, companyId: number, meta: { ip: string | null; userAgent: string | null }) {
  return tx(async (c) => {
    const p = await one<any>(`SELECT p.*, r.answers FROM proposals p LEFT JOIN requests r ON r.id=p.request_id WHERE p.id=$1 AND p.company_id=$2 FOR UPDATE OF p`, [proposalId, companyId], c);
    if (!p) throw new Error("Voorstel niet gevonden");
    const existing = await one<{ id: number }>(`SELECT id FROM acceptances WHERE proposal_id=$1`, [proposalId], c);
    if (existing) return { acceptanceId: existing.id, already: true };
    const blocker = acceptBlockers(p);
    if (blocker) return { error: blocker };

    const o: Offer & Record<string, any> = p.offer;
    const amounts = { monthlyCents: o.monthlyCents, singleEmptyingCents: o.singleEmptyingCents, transportPerTripCents: o.transportPerTripCents, placementCents: o.placementCents, includedPerYear: o.includedPerYear, vatBp: o.vatBp, personal: o.personal ?? null };
    const acc = await one<{ id: number }>(
      `INSERT INTO acceptances(proposal_id, user_id, proposal_version, terms_version, amounts, ip, user_agent) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [proposalId, userId, p.version, p.terms_version, JSON.stringify(amounts), meta.ip, meta.userAgent], c,
    );
    await q(`UPDATE proposals SET status='accepted' WHERE id=$1`, [proposalId], c);
    await enqueue(c, "acceptance.pdf", { acceptanceId: acc!.id }, `acceptance:${acc!.id}:pdf`);

    if (p.kind === "new") {
      const sub = await one<{ id: number }>(`INSERT INTO subscriptions(company_id, location_id, status) VALUES ($1,$2,'pending_placement') RETURNING id`, [p.company_id, p.location_id], c);
      await q(
        `INSERT INTO subscription_versions(subscription_id, version, status, effective_from, proposal_id, terms, box_size, package_code, monthly_cents)
         VALUES ($1,1,'active',$2,$3,$4,$5,$6,$7)`,
        [sub!.id, today(), proposalId, JSON.stringify(o), o.boxSize, o.packageCode, o.monthlyCents], c,
      );
      const prefs = p.answers?.preferences ?? { flexible: true, slots: [] };
      const year = today().slice(0, 4);
      const num = `AF-${year}-${pad(await nextNumber(c, `appointment-${year}`))}`;
      const appt = await one<{ id: number }>(
        `INSERT INTO appointments(number, source_key, company_id, location_id, subscription_id, type, flexible, preferences, note, funding, price_cents, price_detail, box_size, created_by)
         VALUES ($1,$2,$3,$4,$5,'placement',$6,$7,$8,'contract',$9,$10,$11,$12) ON CONFLICT (source_key) DO NOTHING RETURNING id`,
        [num, `proposal:${proposalId}:placement`, p.company_id, p.location_id, sub!.id, prefs.flexible, JSON.stringify(prefs.slots ?? []), p.answers?.location?.note || null, o.placementCents, JSON.stringify({ label: `Plaatsing box ${o.boxLabel}` }), o.boxSize, userId], c,
      );
      await audit(c, { actor: userId, company: p.company_id, action: "proposal.accepted", entityType: "proposal", entityId: proposalId, data: { ...amounts, subscriptionId: sub!.id, appointmentId: appt?.id } });
    } else {
      const { applyAcceptedChange } = await import("./subscriptions");
      await applyAcceptedChange(c, p, userId);
    }
    await closeTasks(c, "proposal", proposalId);
    await emitEvent(c, "proposal.accepted", { proposalId, acceptanceId: acc!.id, companyId: p.company_id, userId }, `proposal:${proposalId}`);
    return { acceptanceId: acc!.id, already: false };
  });
}

export async function expireProposals(db: Db) {
  const r = await q(`UPDATE proposals SET status='expired' WHERE status='open' AND valid_until < $1 RETURNING id`, [today()], db);
  return r.length;
}
