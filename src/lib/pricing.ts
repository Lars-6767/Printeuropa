/**
 * Prijsberekening. Puur en deterministisch: dezelfde invoer geeft op scherm, in het voorstel
 * en op de factuur hetzelfde bedrag. Definitieve bedragen worden altijd op de server berekend.
 *
 * Afrondingsregel (expliciet, 'monthly_half_up'):
 *  1. Afstand: enkele reis in km, naar boven afgerond (instelbaar).
 *  2. Vervoer per rit = km × kilometertarief (in centen, exact), minimaal het minimumtarief.
 *  3. Afgeprijsd legingsdeel = vaste legingsprijs × (1 − korting), per leging half-up afgerond op centen.
 *  4. Maandbedrag geregeld = boxprijs + half-up(jaarlijks legingsbedrag / 12).
 *  5. Jaartotaal = 12 × maandbedrag. Het verschil met het exacte jaarbedrag wordt als
 *     afrondingsverschil getoond.
 */
import type { BoxSize, PackageConfig, PackagesConfig, PricingConfig, PrintmastersConfig, TransportConfig } from "./config";
import { applyBp, roundHalfUp } from "./money";

export interface DistanceInfo {
  km: number | null;          // afgeronde enkele-reisafstand; null = onbekend
  rawKm?: number | null;
  source: "route" | "postcode_indicatie" | "demo" | "handmatig" | "onbekend";
}

export interface PrintmastersInput {
  status: "none" | "interest" | "claimed" | "verified" | "rejected";
  ruleCode: string | null;
}

export interface OfferInput {
  boxSize: BoxSize;
  packageCode: string;
  frequencyPerYear: number | null;
  postcode: string | null;
  distance: DistanceInfo;
  printmasters: PrintmastersInput;
}

export interface OfferLine { label: string; cents: number | null; note?: string; kind: "monthly" | "per_emptying" | "one_off" | "info" }

export interface Offer {
  boxSize: BoxSize;
  boxLabel: string;
  packageCode: string;
  packageName: string;
  packageKind: PackageConfig["kind"];
  frequencyPerYear: number | null;
  vatBp: number;
  distance: DistanceInfo;
  centsPerKm: number;
  transportPerTripCents: number | null;
  transportPending: boolean;
  boxMonthlyCents: number;
  boxListMonthlyCents: number;
  boxIncluded: boolean;
  emptyingBaseCents: number;
  singleEmptyingCents: number | null;     // losse leging incl. vervoer, excl. btw
  discountBp: number;
  discountedEmptyingBaseCents: number | null;
  includedPerYear: number;
  annualEmptyingExactCents: number | null;
  monthlyCents: number | null;            // excl. btw; null = nog vast te stellen
  monthlyVatCents: number | null;
  yearTotalCents: number | null;          // 12 × maandbedrag
  yearExactCents: number | null;
  roundingDiffCents: number | null;
  freeCombinedEmptying: boolean;
  printmastersProvisional: boolean;       // voordeel nog niet geverifieerd
  printmastersRule: string | null;
  placementCents: number | null;
  swapCents: number | null;
  finalPickupCents: number | null;
  lines: OfferLine[];
  notes: string[];
  errors: string[];
}

export function postcodeNumber(postcode: string | null | undefined): number | null {
  if (!postcode) return null;
  const m = postcode.replace(/\s/g, "").match(/^(\d{4})/);
  return m ? Number(m[1]) : null;
}

export function roundKm(rawKm: number, rule: TransportConfig["kmRounding"]): number {
  return rule === "ceil" ? Math.ceil(rawKm - 1e-9) : Math.round(rawKm);
}

/** Vervoer voor één rit. Geeft null als de afstand onbekend is: een ontbrekende afstand is nooit gratis. */
export function transportCents(t: TransportConfig, km: number | null, postcode: string | null): number | null {
  const pc = postcodeNumber(postcode);
  const override = pc === null ? undefined : t.regionOverrides.find((r) => pc >= r.fromPostcode && pc <= r.toPostcode);
  if (override?.fixedCents !== undefined && override?.fixedCents !== null) return override.fixedCents;
  if (km === null || km === undefined || !Number.isFinite(km)) return null;
  const rate = override?.centsPerKm ?? t.centsPerKm;
  const trips = t.model === "return_trip" ? 2 : 1;
  const cents = km * rate * trips;
  return Math.max(cents, t.minimumCents);
}

export function findPackage(pk: PackagesConfig, code: string): PackageConfig | undefined {
  return pk.items.find((p) => p.code === code);
}

export function activePrintmastersRule(pm: PrintmastersConfig, code: string | null) {
  if (code) {
    const r = pm.rules.find((r) => r.code === code);
    if (r) return r;
  }
  return pm.rules.find((r) => r.active) ?? null;
}

export function computeOffer(
  cfg: { pricing: PricingConfig; transport: TransportConfig; packages: PackagesConfig; printmasters: PrintmastersConfig },
  input: OfferInput,
): Offer {
  const errors: string[] = [];
  const notes: string[] = [];
  const box = cfg.pricing.boxes.find((b) => b.size === input.boxSize);
  if (!box) throw new Error(`Onbekend boxformaat ${input.boxSize}`);
  const pkg = findPackage(cfg.packages, input.packageCode);
  if (!pkg) throw new Error(`Onbekend pakket ${input.packageCode}`);

  const tripCents = transportCents(cfg.transport, input.distance.km, input.postcode);
  const transportPending = tripCents === null;
  if (transportPending) notes.push("Vervoer is nog vast te stellen: de afstand kon niet worden berekend.");
  else if (input.distance.source === "postcode_indicatie") notes.push("Vervoer is een indicatie op basis van de postcode.");
  else if (input.distance.source === "demo") notes.push("Demo: de afstand is een indicatie uit de demo-routeberekening.");

  const singleEmptying = tripCents === null ? null : box.emptyingCents + tripCents;

  let boxMonthly = box.monthlyCents;
  let boxIncluded = false;
  let freeCombined = false;
  let provisional = false;
  let ruleName: string | null = null;
  let discountBp = 0;
  let included = 0;
  let annualExact: number | null = 0;
  let discounted: number | null = null;
  let frequency: number | null = null;

  if (pkg.kind === "printmasters") {
    const rule = activePrintmastersRule(cfg.printmasters, input.printmasters.ruleCode);
    if (!rule) {
      errors.push("Er is geen actieve PrintMasters-regel ingesteld.");
    } else {
      ruleName = rule.name;
      boxIncluded = rule.boxIncluded;
      freeCombined = rule.freeCombinedEmptying;
      if (boxIncluded) boxMonthly = 0;
      provisional = input.printmasters.status !== "verified";
      if (provisional) notes.push("Voorlopig PrintMasters-voordeel: Bereyl controleert jullie klantstatus. Daarna ontvang je de definitieve prijs ter akkoord.");
      if (input.printmasters.status === "rejected") {
        errors.push("De PrintMasters-afspraak is niet bevestigd. Kies een ander pakket.");
      }
    }
  } else if (pkg.kind === "scheduled") {
    frequency = input.frequencyPerYear ?? pkg.frequencies[0]?.perYear ?? null;
    const f = pkg.frequencies.find((x) => x.perYear === frequency);
    if (!f) {
      errors.push("Kies een geldige frequentie.");
    } else {
      discountBp = f.discountBp;
      included = f.perYear;
      discounted = box.emptyingCents - applyBp(box.emptyingCents, discountBp);
      annualExact = tripCents === null ? null : included * (discounted + tripCents);
    }
  }

  let monthly: number | null;
  let yearExact: number | null;
  if (pkg.kind === "scheduled") {
    monthly = annualExact === null ? null : boxMonthly + roundHalfUp(annualExact / 12);
    yearExact = annualExact === null ? null : boxMonthly * 12 + annualExact;
  } else {
    monthly = boxMonthly;
    yearExact = boxMonthly * 12;
  }
  const yearTotal = monthly === null ? null : monthly * 12;
  const roundingDiff = yearTotal === null || yearExact === null ? null : yearTotal - yearExact;

  const lines: OfferLine[] = [];
  lines.push({
    kind: "monthly",
    label: `Box ${box.label}`,
    cents: boxMonthly,
    note: boxIncluded ? `Inbegrepen via PrintMasters (normaal ${fmt(box.monthlyCents)} per maand)` : "per maand",
  });
  if (pkg.kind === "scheduled" && discounted !== null) {
    lines.push({
      kind: "monthly",
      label: `${included} legingen per jaar inbegrepen`,
      cents: annualExact === null ? null : roundHalfUp(annualExact / 12),
      note: `${included} × (${fmt(discounted)} legingsdeel na ${discountBp / 100}% korting + ${tripCents === null ? "vervoer nog vast te stellen" : fmt(tripCents) + " vervoer"}) / 12`,
    });
  }
  lines.push({
    kind: "per_emptying",
    label: pkg.kind === "scheduled" ? "Extra leging" : "Losse leging",
    cents: singleEmptying,
    note: `${fmt(box.emptyingCents)} vast + ${tripCents === null ? "vervoer nog vast te stellen" : `${input.distance.km} km × ${fmt(cfg.transport.centsPerKm)} = ${fmt(tripCents)} vervoer`}`,
  });
  if (freeCombined) {
    lines.push({ kind: "per_emptying", label: "Leging gecombineerd met PrintMasters-levering", cents: 0, note: "Gratis, verbruikt geen betaald leegmoment" });
  }
  lines.push({ kind: "one_off", label: "Plaatsing", cents: cfg.pricing.placementCents, note: cfg.pricing.placementCents === null ? "Nog vast te stellen door Bereyl" : "eenmalig" });

  return {
    boxSize: box.size,
    boxLabel: box.label,
    packageCode: pkg.code,
    packageName: pkg.name,
    packageKind: pkg.kind,
    frequencyPerYear: frequency,
    vatBp: cfg.pricing.vatBp,
    distance: input.distance,
    centsPerKm: cfg.transport.centsPerKm,
    transportPerTripCents: tripCents,
    transportPending,
    boxMonthlyCents: boxMonthly,
    boxListMonthlyCents: box.monthlyCents,
    boxIncluded,
    emptyingBaseCents: box.emptyingCents,
    singleEmptyingCents: singleEmptying,
    discountBp,
    discountedEmptyingBaseCents: discounted,
    includedPerYear: included,
    annualEmptyingExactCents: annualExact,
    monthlyCents: monthly,
    monthlyVatCents: monthly === null ? null : applyBp(monthly, cfg.pricing.vatBp),
    yearTotalCents: yearTotal,
    yearExactCents: yearExact,
    roundingDiffCents: roundingDiff,
    freeCombinedEmptying: freeCombined,
    printmastersProvisional: provisional,
    printmastersRule: ruleName,
    placementCents: cfg.pricing.placementCents,
    swapCents: cfg.pricing.swapCents,
    finalPickupCents: cfg.pricing.finalPickupCents,
    lines,
    notes,
    errors,
  };
}

/** Prijs van één losse leging volgens een vastgelegde (geaccepteerde) afspraak. */
export function agreedSingleEmptyingCents(terms: Offer): number | null {
  return terms.singleEmptyingCents;
}

function fmt(c: number) {
  const e = (c / 100).toFixed(2).replace(".", ",");
  return `€ ${e.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}
