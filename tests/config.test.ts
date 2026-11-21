import { describe, expect, it } from "vitest";
import { validateForPublish } from "@/lib/settings";
import { coerce, CONFIG_SCHEMA } from "@/lib/config-schema";
import { DEFAULTS } from "@/lib/config";
import { validateTemplate, renderEmail } from "@/lib/email-render";

describe("instellingen publiceren", () => {
  it("kortingsvolgorde moet bevestigd zijn vóór publicatie", () => {
    expect(validateForPublish("packages", DEFAULTS.packages).join(" ")).toMatch(/Bevestig de kortingsvolgorde/);
    expect(validateForPublish("packages", { ...DEFAULTS.packages, discountOrderConfirmed: true })).toEqual([]);
  });
  it("actieve regel voor andere PrintMasters-producten vereist een vastgestelde waarde", () => {
    const pm = structuredClone(DEFAULTS.printmasters);
    pm.rules[1].active = true;
    expect(validateForPublish("printmasters", pm).join(" ")).toMatch(/nog niet vastgesteld/);
  });
  it("CO₂-methode kan niet actief zonder bron, methode en versie", () => {
    const imp = structuredClone(DEFAULTS.impact);
    imp.methods[0].active = true;
    expect(validateForPublish("impact", imp).length).toBeGreaterThan(0);
  });
  it("editorinvoer in euro's en procenten wordt centen en basispunten", () => {
    const r = coerce(CONFIG_SCHEMA.transport, { ...DEFAULTS.transport, centsPerKm: "4,50", minimumCents: "" });
    expect(r.value.centsPerKm).toBe(450);
    expect(r.errors["minimumCents"]).toBeDefined();
    const p = coerce(CONFIG_SCHEMA.pricing, { ...DEFAULTS.pricing, swapCents: "", vatBp: "21" });
    expect(p.value.swapCents).toBeNull();
    expect(p.value.vatBp).toBe(2100);
  });
});

describe("e-mailtemplates", () => {
  it("onbekende variabelen worden geweigerd", () => {
    expect(validateTemplate("Hoi {{voornam}}", [])).toEqual(["Onbekende variabele {{voornam}}."]);
  });
  it("variabelen worden ingevuld en ge-escaped", () => {
    const r = renderEmail("Hoi {{voornaam}}", [{ type: "text", text: "Bedrijf: {{bedrijfsnaam}}" }], { voornaam: "Sanne", bedrijfsnaam: "<Test & Co>" });
    expect(r.subject).toBe("Hoi Sanne");
    expect(r.html).toContain("&lt;Test &amp; Co&gt;");
  });
});
