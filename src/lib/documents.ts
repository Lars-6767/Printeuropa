/** Genereert en bewaart PDF's (voorstel, akkoordbewijs, factuur, klantverklaring). Idempotent per document. */
import { one, q, type Db } from "./db";
import { buildPdf, type PdfSection } from "./pdf";
import { getConfig } from "./settings";
import { storeFile } from "./storage";
import { formatEuro, formatKg } from "./money";
import { formatDate, formatDateTime } from "./dates";
import type { Offer } from "./pricing";
import { FUNDING, PM_STATUS } from "./labels";

export function prefsText(prefs: { date: string; daypart: string | null }[], flexible: boolean, dayparts: { code: string; label: string }[]) {
  if (flexible || prefs.length === 0) return "Het maakt ons niet uit, plan ons in overleg in";
  return prefs.map((p) => `${formatDate(p.date, { weekday: true, short: true })}${p.daypart ? " " + (dayparts.find((d) => d.code === p.daypart)?.label ?? p.daypart).toLowerCase() : ""}`).join(", ");
}

export function offerRows(o: Offer): [string, string][] {
  const rows: [string, string][] = [
    ["Box", o.boxLabel],
    ["Pakket", o.packageName + (o.frequencyPerYear ? ` · ${o.frequencyPerYear} legingen per jaar` : "")],
    ["Maandbedrag", o.monthlyCents === null ? "nog vast te stellen" : `${formatEuro(o.monthlyCents)} excl. btw (${formatEuro(o.monthlyCents + (o.monthlyVatCents ?? 0))} incl. ${o.vatBp / 100}% btw)`],
  ];
  if (o.boxIncluded) rows.push(["Box", `Inbegrepen via PrintMasters (normaal ${formatEuro(o.boxListMonthlyCents)} per maand)`]);
  if (o.includedPerYear) rows.push(["Inbegrepen legingen", `${o.includedPerYear} per jaar (tegoedperiode van 12 maanden)`]);
  rows.push([o.packageKind === "scheduled" ? "Extra leging" : "Losse leging", o.singleEmptyingCents === null ? "nog vast te stellen" : `${formatEuro(o.singleEmptyingCents)} excl. btw`]);
  rows.push(["Vervoer per rit", o.transportPerTripCents === null ? "nog vast te stellen" : `${formatEuro(o.transportPerTripCents)} (${o.distance.km} km enkele reis × ${formatEuro(o.centsPerKm)}; dekt ook de terugrit${o.distance.source === "route" ? "" : ", indicatie"})`]);
  if (o.freeCombinedEmptying) rows.push(["Gecombineerde leging", "Gratis bij combinatie met een PrintMasters-levering; verbruikt geen betaald leegmoment"]);
  rows.push(["Plaatsing", o.placementCents === null ? "nog vast te stellen door Bereyl" : `${formatEuro(o.placementCents)} eenmalig`]);
  if (o.yearTotalCents !== null) rows.push(["Jaarindicatie", `${formatEuro(o.yearTotalCents)} excl. btw (12 × maandbedrag)${o.roundingDiffCents ? `; afrondingsverschil ${formatEuro(o.roundingDiffCents)} t.o.v. exacte berekening` : ""}`]);
  return rows;
}

export async function ensureProposalPdf(db: Db, proposalId: number): Promise<number> {
  const p = await one<any>(`SELECT p.*, r.number AS request_number, r.answers, r.contact, c.name AS company_name, c.printmasters_status,
    l.name AS loc_name, l.street, l.postcode, l.city
    FROM proposals p LEFT JOIN requests r ON r.id=p.request_id JOIN companies c ON c.id=p.company_id LEFT JOIN locations l ON l.id=p.location_id WHERE p.id=$1`, [proposalId], db);
  if (!p) throw new Error("Voorstel niet gevonden");
  if (p.pdf_file_id) return p.pdf_file_id;
  const cfg = await getConfig("pdf", db);
  const planning = await getConfig("planning", db);
  const o: Offer = p.offer;
  const sections: PdfSection[] = [];
  sections.push({ title: "Bedrijf en contact", rows: [["Bedrijf", p.company_name], ["Contactpersoon", p.contact?.name ?? ""], ["E-mail", p.contact?.email ?? ""], ["Telefoon", p.contact?.phone ?? ""]] });
  sections.push({ title: "Locatie", rows: [["Plaatsingsadres", [p.street, `${p.postcode} ${p.city}`].filter(Boolean).join(", ")], ...(p.answers?.location?.instructions ? [["Instructies", p.answers.location.instructions] as [string, string]] : [])] });
  if (cfg.showAnswers && p.answers?.inflow) {
    const i = p.answers.inflow;
    const unit: Record<string, string> = { kg: "kg per maand", pieces: "kledingstukken per maand", bags: "zakken per maand", unknown: "geschat" };
    sections.push({ title: "Jullie antwoorden", rows: [
      ["Werken met PrintMasters", { customer: "Ja, we zijn klant", intro: "Nog niet, ik wil kennismaken", no: "Nee, alleen Bereyl" }[p.answers.printmasters as string] ?? "–"],
      ["Hoeveelheid", i.unit === "unknown" ? `${i.employees ?? "?"} medewerkers, ${i.replacementPerYear ?? "?"}× per jaar vervangen` : `${i.amount} ${unit[i.unit]}`],
      ...(i.oneOffStockKg ? [["Eenmalige opruimvoorraad", `${i.oneOffStockKg} kg`] as [string, string]] : []),
    ] });
  }
  if (cfg.showAdvice && p.answers?.advice) {
    sections.push({ title: "Ons advies", text: `${p.answers.advice.reason} ${p.answers.advice.estimateNote ?? ""}${p.answers.advice.recommended !== o.boxSize ? ` Jullie kozen voor ${o.boxLabel} in plaats van het advies (${p.answers.advice.recommended} liter).` : ""}` });
  }
  sections.push({ title: "Gekozen box en pakket", rows: offerRows(o) });
  if (cfg.showPrintmasters && (o.packageKind === "printmasters" || p.printmasters_status !== "none")) {
    sections.push({ title: "PrintMasters-afspraken", rows: [
      ["Status", PM_STATUS[p.printmasters_status] ?? p.printmasters_status],
      ["Regel", o.printmastersRule ?? "–"],
      ["Voordeel", o.printmastersProvisional ? "Voorlopig: definitieve prijs volgt na controle" : o.packageKind === "printmasters" ? "Toegekend" : "Niet van toepassing in dit pakket"],
    ] });
  }
  if (cfg.showPreferences && p.answers?.preferences) {
    sections.push({ title: "Plaatsingsvoorkeur", text: `${prefsText(p.answers.preferences.slots ?? [], p.answers.preferences.flexible, planning.dayparts)}. Dit is een voorkeur: Bereyl bevestigt de afspraak.` });
  }
  if (o.notes.length) sections.push({ title: "Toelichting", text: o.notes.join(" ") });
  sections.push({ title: "Geldigheid en vervolgstap", text: `Dit voorstel is geldig tot en met ${formatDate(p.valid_until)}. Open Mijn Bereyl en kies 'Akkoord en plaatsing aanvragen'. Daarna stemmen we de plaatsing met jullie af. Alle bedragen zijn exclusief btw tenzij anders vermeld.` });

  const pdf = await buildPdf({
    cfg,
    title: p.kind === "new" ? "Voorstel Bereyl-inzameling" : "Wijzigingsvoorstel",
    subtitle: `${p.company_name} · ${o.boxLabel} · ${p.city ?? ""}`,
    meta: [["Aanvraagnummer", p.request_number ?? "–"], ["Voorstelversie", String(p.version)], ["Datum", formatDate(p.created_at)], ["Geldig tot", formatDate(p.valid_until)]],
    intro: cfg.introText,
    sections,
    footerNote: cfg.termsReference.replace("{{voorwaardenversie}}", p.terms_version),
  });
  const fileId = await storeFile(db, { companyId: p.company_id, kind: "proposal_pdf", filename: `Bereyl-voorstel-${p.request_number ?? p.id}-v${p.version}.pdf`, mime: "application/pdf", data: pdf });
  await q(`UPDATE proposals SET pdf_file_id=$2 WHERE id=$1 AND pdf_file_id IS NULL`, [proposalId, fileId], db);
  const again = await one<{ pdf_file_id: number }>(`SELECT pdf_file_id FROM proposals WHERE id=$1`, [proposalId], db);
  return again!.pdf_file_id;
}

export async function ensureAcceptancePdf(db: Db, acceptanceId: number): Promise<number> {
  const a = await one<any>(`SELECT a.*, u.name AS user_name, u.email, p.offer, p.company_id, p.version AS pversion, p.kind, c.name AS company_name, r.number AS request_number
    FROM acceptances a JOIN users u ON u.id=a.user_id JOIN proposals p ON p.id=a.proposal_id JOIN companies c ON c.id=p.company_id LEFT JOIN requests r ON r.id=p.request_id WHERE a.id=$1`, [acceptanceId], db);
  if (a.pdf_file_id) return a.pdf_file_id;
  const cfg = await getConfig("pdf", db);
  const pdf = await buildPdf({
    cfg,
    title: "Akkoordbewijs",
    subtitle: a.company_name,
    meta: [["Aanvraagnummer", a.request_number ?? "–"], ["Voorstelversie", String(a.proposal_version)], ["Voorwaardenversie", a.terms_version], ["Akkoord gegeven door", `${a.user_name} (${a.email})`], ["Tijdstip", formatDateTime(a.accepted_at)]],
    sections: [{ title: "Overeengekomen bedragen", rows: offerRows(a.offer) }],
    footerNote: "Dit akkoordbewijs legt de overeengekomen bedragen vast. Latere algemene prijswijzigingen veranderen deze afspraak alleen via een nieuwe, bevestigde wijziging.",
  });
  const fileId = await storeFile(db, { companyId: a.company_id, kind: "acceptance_pdf", filename: `Bereyl-akkoord-${a.request_number ?? a.proposal_id}-v${a.proposal_version}.pdf`, mime: "application/pdf", data: pdf });
  await q(`UPDATE acceptances SET pdf_file_id=$2 WHERE id=$1 AND pdf_file_id IS NULL`, [acceptanceId, fileId], db);
  return (await one<{ pdf_file_id: number }>(`SELECT pdf_file_id FROM acceptances WHERE id=$1`, [acceptanceId], db))!.pdf_file_id;
}

export async function ensureInvoicePdf(db: Db, invoiceId: number): Promise<number> {
  const inv = await one<any>(`SELECT i.*, c.name AS company_name, c.invoice_attn, c.invoice_street, c.invoice_postcode, c.invoice_city, c.vat_number
    FROM invoices i JOIN companies c ON c.id=i.company_id WHERE i.id=$1`, [invoiceId], db);
  if (inv.pdf_file_id) return inv.pdf_file_id;
  if (!inv.number) throw new Error("Factuur is nog geen definitieve factuur");
  const lines = await q<any>(`SELECT * FROM invoice_lines WHERE invoice_id=$1 ORDER BY id`, [invoiceId], db);
  const cfg = await getConfig("pdf", db);
  const integ = await getConfig("integrations", db);
  const s = integ.invoiceSender;
  const pdf = await buildPdf({
    cfg,
    title: inv.total_cents < 0 ? `Creditfactuur ${inv.number}` : `Factuur ${inv.number}`,
    subtitle: inv.description,
    meta: [
      ["Aan", [inv.company_name, inv.invoice_attn, inv.invoice_street, [inv.invoice_postcode, inv.invoice_city].filter(Boolean).join(" ")].filter(Boolean).join("\n")],
      ...(inv.vat_number ? [["Btw-nummer klant", inv.vat_number] as [string, string]] : []),
      ["Factuurdatum", formatDate(inv.issued_on)],
      ["Vervaldatum", formatDate(inv.due_on)],
      ["Van", [s.name, s.address, s.coc ? `KvK ${s.coc}` : "KvK nog in te vullen", s.vat ? `Btw ${s.vat}` : "Btw-nummer nog in te vullen"].join("\n")],
    ],
    sections: [
      { title: "Specificatie", rows: lines.map((l) => [l.description, `${l.quantity > 1 ? `${l.quantity} × ${formatEuro(l.unit_cents)} = ` : ""}${formatEuro(l.total_cents)}`] as [string, string]) },
      { title: "Totaal", rows: [["Subtotaal", formatEuro(inv.subtotal_cents)], [`Btw ${inv.vat_rate_bp / 100}%`, formatEuro(inv.vat_cents)], ["Totaal", formatEuro(inv.total_cents)]] },
    ],
    footerNote: `Het bedrag wordt automatisch geïncasseerd wanneer een incassomachtiging actief is. Anders graag overmaken naar ${s.iban || "(IBAN nog in te vullen)"} o.v.v. ${inv.number}.`,
  });
  const fileId = await storeFile(db, { companyId: inv.company_id, kind: "invoice_pdf", filename: `Bereyl-${inv.number}.pdf`, mime: "application/pdf", data: pdf });
  await q(`UPDATE invoices SET pdf_file_id=$2 WHERE id=$1 AND pdf_file_id IS NULL`, [invoiceId, fileId], db);
  return (await one<{ pdf_file_id: number }>(`SELECT pdf_file_id FROM invoices WHERE id=$1`, [invoiceId], db))!.pdf_file_id;
}

export async function ensureStatementPdf(db: Db, releaseId: number): Promise<number> {
  const r = await one<any>(`SELECT cr.*, c.title, c.batch_id, co.name AS company_name, b.number AS batch_number, b.processor, b.destination, b.destination_note
    FROM certificate_releases cr JOIN certificates c ON c.id=cr.certificate_id JOIN companies co ON co.id=cr.company_id LEFT JOIN processing_batches b ON b.id=c.batch_id WHERE cr.id=$1`, [releaseId], db);
  if (r.statement_file_id) return r.statement_file_id;
  const cols = await q<any>(`SELECT collected_at, net_weight_grams FROM collections WHERE company_id=$1 AND batch_id=$2 AND status='weight_confirmed' ORDER BY collected_at`, [r.company_id, r.batch_id], db);
  const total = cols.reduce((s, c) => s + (c.net_weight_grams ?? 0), 0);
  const cfg = await getConfig("pdf", db);
  const dest: Record<string, string> = { reuse: "Hergebruik", fiber: "Vervezeling", recycling: "Recycling", other: "Andere verwerking" };
  const pdf = await buildPdf({
    cfg,
    title: "Verklaring van verwerking",
    subtitle: r.company_name,
    meta: [["Partij", r.batch_number ?? "–"], ["Certificaat", r.title], ["Verwerkingspartij", r.processor ?? "–"], ["Bestemming", dest[r.destination] ?? "Nog niet bevestigd"]],
    sections: [{ title: "Jullie inzamelingen in deze partij", rows: [...cols.map((c) => [formatDate(c.collected_at), formatKg(c.net_weight_grams)] as [string, string]), ["Totaal", formatKg(total)]] }],
    footerNote: "Deze verklaring hoort bij het gedeelde partijcertificaat en vermeldt uitsluitend de inzamelingen van jullie organisatie.",
  });
  const fileId = await storeFile(db, { companyId: r.company_id, kind: "statement", filename: `Bereyl-verklaring-${r.batch_number ?? r.certificate_id}.pdf`, mime: "application/pdf", data: pdf });
  await q(`UPDATE certificate_releases SET statement_file_id=$2 WHERE id=$1 AND statement_file_id IS NULL`, [releaseId, fileId], db);
  return (await one<{ statement_file_id: number }>(`SELECT statement_file_id FROM certificate_releases WHERE id=$1`, [releaseId], db))!.statement_file_id;
}

export { FUNDING };
