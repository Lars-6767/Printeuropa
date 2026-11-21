import { describe, expect, it } from "vitest";
import { computeOffer, transportCents } from "@/lib/pricing";
import { adviseBox } from "@/lib/advice";
import { DEFAULTS } from "@/lib/config";
import { formatEuro, parseEuroInput } from "@/lib/money";

const cfg = { pricing: DEFAULTS.pricing, transport: DEFAULTS.transport, packages: DEFAULTS.packages, printmasters: DEFAULTS.printmasters };
const base = { frequencyPerYear: null, postcode: "4811 AB", printmasters: { status: "none" as const, ruleCode: null } };

describe("prijsberekening", () => {
  it("losse leging 250 liter op 10 km kost € 108 excl. btw", () => {
    const o = computeOffer(cfg, { ...base, boxSize: 250, packageCode: "on_demand", distance: { km: 10, source: "route" } });
    expect(o.singleEmptyingCents).toBe(10800);
    expect(o.monthlyCents).toBe(895);
  });

  it("vervoer: kilometers naar boven afgerond; tarief enkele reis dekt terugrit", () => {
    expect(transportCents(DEFAULTS.transport, 10, null)).toBe(3900);
    expect(transportCents({ ...DEFAULTS.transport, model: "return_trip" }, 10, null)).toBe(7800);
  });

  it("ontbrekende afstand levert nooit gratis vervoer op", () => {
    const o = computeOffer(cfg, { ...base, boxSize: 500, packageCode: "scheduled", frequencyPerYear: 4, distance: { km: null, source: "onbekend" } });
    expect(o.transportPerTripCents).toBeNull();
    expect(o.singleEmptyingCents).toBeNull();
    expect(o.monthlyCents).toBeNull();
    expect(o.transportPending).toBe(true);
  });

  it("geregeld: maandbedrag = box + (legingen × (afgeprijsd vast deel + vervoer)) / 12, half-up", () => {
    // 500 L, 4×/jaar, 25% korting, 13 km: vast 11900 → 8925; vervoer 13 × 390 = 5070
    const o = computeOffer(cfg, { ...base, boxSize: 500, packageCode: "scheduled", frequencyPerYear: 4, distance: { km: 13, source: "route" } });
    expect(o.discountedEmptyingBaseCents).toBe(8925);
    expect(o.annualEmptyingExactCents).toBe(4 * (8925 + 5070));
    expect(o.monthlyCents).toBe(1395 + Math.round((4 * (8925 + 5070)) / 12));
    expect(o.yearTotalCents).toBe(o.monthlyCents! * 12);
    expect(o.roundingDiffCents).toBe(o.yearTotalCents! - (1395 * 12 + 4 * (8925 + 5070)));
  });

  it("toont een afrondingsverschil in het jaartotaal wanneer dat ontstaat", () => {
    const o = computeOffer(cfg, { ...base, boxSize: 250, packageCode: "scheduled", frequencyPerYear: 2, distance: { km: 7, source: "route" } });
    // 2 × (4830 + 2730) = 15120 → /12 = 1260 exact; kies 6×: 6 × (4830 + 2730) = 45360 / 12 = 3780 exact. Zoek een niet-deelbare:
    const o2 = computeOffer(cfg, { ...base, boxSize: 1000, packageCode: "scheduled", frequencyPerYear: 4, distance: { km: 11, source: "route" } });
    const exact = 4 * (20900 - 5225 + 4290);
    expect(o2.annualEmptyingExactCents).toBe(exact);
    expect(o2.roundingDiffCents).toBe(Math.round(exact / 12) * 12 - exact);
    expect(o.roundingDiffCents).toBe(0);
  });

  it("kortingsvolgorde 30/25/30 uit de website wordt toegepast", () => {
    const k = (f: number) => computeOffer(cfg, { ...base, boxSize: 250, packageCode: "scheduled", frequencyPerYear: f, distance: { km: 5, source: "route" } }).discountBp;
    expect([k(2), k(4), k(6)]).toEqual([3000, 2500, 3000]);
  });

  it("PrintMasters: box inbegrepen, voorlopig tot verificatie, gratis combinatie", () => {
    const prov = computeOffer(cfg, { ...base, boxSize: 500, packageCode: "printmasters", distance: { km: 10, source: "route" }, printmasters: { status: "claimed", ruleCode: null } });
    expect(prov.boxMonthlyCents).toBe(0);
    expect(prov.printmastersProvisional).toBe(true);
    expect(prov.freeCombinedEmptying).toBe(true);
    const ok = computeOffer(cfg, { ...base, boxSize: 500, packageCode: "printmasters", distance: { km: 10, source: "route" }, printmasters: { status: "verified", ruleCode: null } });
    expect(ok.printmastersProvisional).toBe(false);
  });

  it("regio-afwijking met vast bedrag gaat voor kilometertarief", () => {
    const t = { ...DEFAULTS.transport, regionOverrides: [{ fromPostcode: 4800, toPostcode: 4899, centsPerKm: null, fixedCents: 2500, note: "" }] };
    expect(transportCents(t, 40, "4811 AB")).toBe(2500);
    expect(transportCents(t, 40, "5038 AB")).toBe(40 * 390);
  });

  it("bedragen invoeren en tonen in euro's", () => {
    expect(parseEuroInput("1.234,56")).toBe(123456);
    expect(parseEuroInput("3,90")).toBe(390);
    expect(formatEuro(10800)).toBe("€ 108,00");
    expect(formatEuro(null)).toBe("nog vast te stellen");
  });
});

describe("boxadvies", () => {
  it("adviseert op basis van instroom en tijd tussen legingen", () => {
    const a = adviseBox(DEFAULTS.advice, DEFAULTS.pricing.boxes, { unit: "kg", amount: 10 });
    expect(a?.recommended).toBe(250);
    const b = adviseBox(DEFAULTS.advice, DEFAULTS.pricing.boxes, { unit: "kg", amount: 40 });
    expect(b?.recommended).toBe(1000);
    expect(b?.reason).toMatch(/40 kg per maand/);
  });
  it("een opruimvoorraad moet in één keer passen", () => {
    const a = adviseBox(DEFAULTS.advice, DEFAULTS.pricing.boxes, { unit: "kg", amount: 5, oneOffStockKg: 120 });
    expect(a?.recommended).toBe(1000);
  });
  it("'Geen idee' rekent via medewerkers en vervangfrequentie", () => {
    const a = adviseBox(DEFAULTS.advice, DEFAULTS.pricing.boxes, { unit: "unknown", employees: 20, replacementPerYear: 2 });
    expect(a?.monthlyKg).toBeCloseTo((20 * 2 * 3 * 0.6) / 12, 1);
  });
});
