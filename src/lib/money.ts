/** Alle bedragen zijn integer centen. Weergave altijd via deze helpers. */

export function formatEuro(cents: number | null | undefined, opts: { plain?: boolean } = {}): string {
  if (cents === null || cents === undefined) return "nog vast te stellen";
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const euros = Math.floor(abs / 100);
  const rest = abs % 100;
  const e = euros.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const s = `${e},${rest.toString().padStart(2, "0")}`;
  return `${neg ? "-" : ""}${opts.plain ? "" : "€ "}${s}`;
}

/** Bankiersafronding is niet gebruikelijk op facturen; we ronden half-up af (0,5 cent → omhoog). */
export function roundHalfUp(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x) + 1e-9);
}

/** Percentage in basispunten (2100 = 21%) toepassen op centen, half-up afgerond. */
export function applyBp(cents: number, bp: number): number {
  return roundHalfUp((cents * bp) / 10000);
}

export function vatOf(cents: number, vatBp: number): number {
  return applyBp(cents, vatBp);
}

export function parseEuroInput(v: string): number | null {
  const s = v.trim().replace(/€/g, "").replace(/\s/g, "");
  if (!s) return null;
  // Accepteer 1.234,56 en 1234.56
  const normalized = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return roundHalfUp(n * 100);
}

export function formatKg(grams: number | null | undefined): string {
  if (grams === null || grams === undefined) return "–";
  const kg = grams / 1000;
  return `${kg.toLocaleString("nl-NL", { maximumFractionDigits: kg < 1000 ? 1 : 0 })} kg`;
}
