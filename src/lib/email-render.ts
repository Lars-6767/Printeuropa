/** Opbouw en weergave van e-mailtemplates (blokken) in Bereyl-opmaak. Puur: ook bruikbaar in de editor-preview. */

export type EmailBlock =
  | { type: "heading"; text: string }
  | { type: "text"; text: string }
  | { type: "image"; url: string; alt: string }
  | { type: "summary"; rows: { label: string; value: string }[] }
  | { type: "button"; label: string; url: string }
  | { type: "contact"; text: string };

export const VARIABLES: { name: string; label: string; example: string }[] = [
  { name: "bedrijfsnaam", label: "Bedrijfsnaam", example: "Bouwbedrijf De Vries" },
  { name: "voornaam", label: "Voornaam", example: "Sanne" },
  { name: "locatie", label: "Locatie", example: "Hoofdvestiging" },
  { name: "plaats", label: "Plaats", example: "Breda" },
  { name: "boxformaat", label: "Boxformaat", example: "500 liter" },
  { name: "abonnementsnaam", label: "Abonnement", example: "Bereyl geregeld" },
  { name: "aanvraagnummer", label: "Aanvraagnummer", example: "AV-2026-0042" },
  { name: "afspraaknummer", label: "Afspraaknummer", example: "AF-2026-0108" },
  { name: "prijs", label: "Prijs excl. btw", example: "€ 31,50" },
  { name: "btw", label: "Btw", example: "€ 6,62" },
  { name: "afstand", label: "Afstand", example: "12 km" },
  { name: "datum", label: "Datum", example: "dinsdag 8 december 2026" },
  { name: "dagdeel", label: "Dagdeel", example: "Ochtend (8–12 uur)" },
  { name: "voorkeuren", label: "Voorkeuren", example: "di 8 dec ochtend, do 10 dec" },
  { name: "gewicht", label: "Gewicht", example: "84 kg" },
  { name: "tegoed", label: "Tegoed", example: "Nog 2 legingen beschikbaar" },
  { name: "oude_prijs", label: "Oude prijs", example: "€ 13,95" },
  { name: "nieuwe_prijs", label: "Nieuwe prijs", example: "€ 22,95" },
  { name: "ingangsdatum", label: "Ingangsdatum", example: "1 januari 2027" },
  { name: "einddatum", label: "Einddatum", example: "31 januari 2027" },
  { name: "eindkosten", label: "Eindkosten", example: "€ 119,00" },
  { name: "factuurnummer", label: "Factuurnummer", example: "F-2026-0012" },
  { name: "bedrag", label: "Bedrag incl. btw", example: "€ 16,88" },
  { name: "certificaat", label: "Certificaat", example: "Verwerkingscertificaat partij P-2026-003" },
  { name: "voorwaardenversie", label: "Voorwaardenversie", example: "2026-11" },
  { name: "toelichting", label: "Toelichting", example: "Combinatie met PrintMasters-levering" },
  { name: "portallink", label: "Veilige portallink", example: "https://mijn.bereyl.com/auth/link?token=…" },
];
const KNOWN = new Set(VARIABLES.map((v) => v.name));

export function usedVariables(subject: string, blocks: EmailBlock[]): string[] {
  const text = subject + " " + JSON.stringify(blocks);
  return [...new Set([...text.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]))];
}

export function validateTemplate(subject: string, blocks: EmailBlock[]): string[] {
  const errs: string[] = [];
  if (!subject.trim()) errs.push("Onderwerp ontbreekt.");
  for (const v of usedVariables(subject, blocks)) if (!KNOWN.has(v)) errs.push(`Onbekende variabele {{${v}}}.`);
  for (const b of blocks) {
    if (b.type === "button" && (!b.label.trim() || !b.url.trim())) errs.push("Een knop heeft een tekst en een link nodig.");
    if (b.type === "image" && !b.url.trim()) errs.push("Een afbeelding heeft een adres nodig.");
  }
  const raw = subject + JSON.stringify(blocks);
  if ((raw.match(/\{\{/g) ?? []).length !== (raw.match(/\}\}/g) ?? []).length) errs.push("Een variabele is niet goed afgesloten ({{ … }}).");
  return errs;
}

export function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function fill(text: string, vars: Record<string, string>, missing: Set<string>, escape = true) {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, name) => {
    const v = vars[name];
    if (v === undefined || v === null || v === "") {
      missing.add(name);
      return "–";
    }
    return escape ? esc(v) : v;
  });
}

export function renderEmail(subject: string, blocks: EmailBlock[], vars: Record<string, string>) {
  const missing = new Set<string>();
  const subj = fill(subject, vars, missing, false);
  const body = blocks.map((b) => renderBlock(b, vars, missing)).join("\n");
  const html = `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(subj)}</title></head>
<body style="margin:0;background:#F2F0E8;font-family:Helvetica,Arial,sans-serif;color:#283106">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F2F0E8;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#F8F7F2;border-radius:16px;padding:32px 28px">
<tr><td style="padding-bottom:20px;font-size:22px;font-weight:700;letter-spacing:-0.5px;color:#283106">Bereyl<span style="display:inline-block;width:8px;height:8px;background:#B9D53A;border-radius:50%;margin-left:4px"></span></td></tr>
${body}
</table>
<p style="font-size:12px;color:#5E6448;margin-top:16px">Bereyl · Minervum 7290F, 4817 ZM Breda</p>
</td></tr></table></body></html>`;
  return { subject: subj, html, missing: [...missing] };
}

function renderBlock(b: EmailBlock, vars: Record<string, string>, missing: Set<string>): string {
  const f = (t: string) => fill(t, vars, missing).replace(/\n/g, "<br>");
  switch (b.type) {
    case "heading":
      return `<tr><td style="font-size:24px;font-weight:700;line-height:1.25;padding:4px 0 12px">${f(b.text)}</td></tr>`;
    case "text":
      return `<tr><td style="font-size:16px;line-height:1.55;padding:0 0 14px">${f(b.text)}</td></tr>`;
    case "image":
      return `<tr><td style="padding:0 0 16px"><img src="${esc(fill(b.url, vars, missing, false))}" alt="${esc(b.alt)}" style="max-width:100%;border-radius:12px"></td></tr>`;
    case "summary":
      return `<tr><td style="padding:4px 0 18px"><table role="presentation" width="100%" style="background:#D1D8BD;border-radius:12px;padding:12px 16px;font-size:15px">${b.rows
        .map((r) => `<tr><td style="padding:4px 0;color:#5E6448">${esc(r.label)}</td><td style="padding:4px 0;text-align:right;font-weight:600">${f(r.value)}</td></tr>`)
        .join("")}</table></td></tr>`;
    case "button":
      return `<tr><td style="padding:6px 0 20px"><a href="${esc(fill(b.url, vars, missing, false))}" style="display:inline-block;background:#283106;color:#F8F7F2;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:999px;font-size:16px">${f(b.label)}</a></td></tr>`;
    case "contact":
      return `<tr><td style="font-size:14px;line-height:1.5;color:#5E6448;border-top:1px solid #D1D8BD;padding-top:14px">${f(b.text)}</td></tr>`;
  }
}

export function sampleVariables(): Record<string, string> {
  return Object.fromEntries(VARIABLES.map((v) => [v.name, v.example]));
}
