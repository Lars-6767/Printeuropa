/**
 * Formulierbeschrijving per instellingensleutel. De generieke editor in beheer gebruikt dit voor
 * labels, uitleg, invoertypes en validatie. Bedragen worden ingevoerd in euro's en opgeslagen in centen.
 */
import type { ConfigKey } from "./config";

export type FieldSpec =
  | { k: string; type: "text" | "textarea" | "email" | "url" | "color"; label: string; help?: string; required?: boolean }
  | { k: string; type: "int" | "number"; label: string; help?: string; min?: number; max?: number; nullable?: boolean }
  | { k: string; type: "money"; label: string; help?: string; nullable?: boolean }
  | { k: string; type: "bp"; label: string; help?: string }
  | { k: string; type: "bool"; label: string; help?: string }
  | { k: string; type: "select"; label: string; help?: string; options: { v: string | null; l: string }[] }
  | { k: string; type: "strings"; label: string; help?: string }
  | { k: string; type: "group"; label: string; help?: string; fields: FieldSpec[] }
  | { k: string; type: "list"; label: string; help?: string; itemLabel: string; titleKey?: string; fields: FieldSpec[]; fixed?: boolean; newItem?: Record<string, unknown> };

const DAYS = [{ v: "mon", l: "ma" }, { v: "tue", l: "di" }, { v: "wed", l: "wo" }, { v: "thu", l: "do" }, { v: "fri", l: "vr" }, { v: "sat", l: "za" }, { v: "sun", l: "zo" }];

export const CONFIG_SCHEMA: Record<ConfigKey, FieldSpec[]> = {
  pricing: [
    { k: "vatBp", type: "bp", label: "Btw-percentage", help: "Alle tarieven zijn exclusief btw." },
    { k: "boxes", type: "list", label: "Boxformaten", itemLabel: "Box", titleKey: "label", fixed: true, fields: [
      { k: "label", type: "text", label: "Naam", required: true },
      { k: "description", type: "textarea", label: "Korte omschrijving" },
      { k: "monthlyCents", type: "money", label: "Maandprijs" },
      { k: "emptyingCents", type: "money", label: "Vaste legingsprijs (excl. vervoer)" },
      { k: "capacityKg", type: "int", label: "Adviescapaciteit (kg)", help: "Indicatieve inhoud voor het boxadvies.", min: 1 },
      { k: "dimensions", type: "text", label: "Afmetingen" },
      { k: "imageUrl", type: "text", label: "Afbeelding (URL of pad)" },
      { k: "available", type: "bool", label: "Beschikbaar voor nieuwe aanvragen" },
    ] },
    { k: "placementCents", type: "money", label: "Plaatsing (eenmalig)", nullable: true, help: "Leeg = nog vast te stellen. Wordt in het voorstel als 'nog vast te stellen' getoond." },
    { k: "placementIncludesTransport", type: "bool", label: "Plaatsingstarief is inclusief vervoer" },
    { k: "swapCents", type: "money", label: "Omruilen", nullable: true, help: "Leeg = nog vast te stellen." },
    { k: "finalPickupCents", type: "money", label: "Definitief ophalen", nullable: true, help: "Leeg = nog vast te stellen." },
  ],
  transport: [
    { k: "depotName", type: "text", label: "Naam depot" },
    { k: "depotAddress", type: "text", label: "Depotadres", required: true },
    { k: "depotLat", type: "number", label: "Breedtegraad depot" },
    { k: "depotLng", type: "number", label: "Lengtegraad depot" },
    { k: "centsPerKm", type: "money", label: "Kilometertarief", help: "Per kilometer enkele reis." },
    { k: "model", type: "select", label: "Rekenmodel", options: [{ v: "single_trip_covers_return", l: "Tarief enkele reis dekt ook de terugrit" }, { v: "return_trip", l: "Retour: afstand × 2" }] },
    { k: "kmRounding", type: "select", label: "Afronding kilometers", options: [{ v: "ceil", l: "Naar boven (hele km)" }, { v: "round", l: "Rekenkundig" }] },
    { k: "minimumCents", type: "money", label: "Minimumtarief vervoer per rit" },
    { k: "regionOverrides", type: "list", label: "Regio-afwijkingen", itemLabel: "Regio", fields: [
      { k: "fromPostcode", type: "int", label: "Van postcode (4 cijfers)", min: 1000, max: 9999 },
      { k: "toPostcode", type: "int", label: "Tot en met postcode", min: 1000, max: 9999 },
      { k: "centsPerKm", type: "money", label: "Afwijkend kilometertarief", nullable: true },
      { k: "fixedCents", type: "money", label: "Of: vast vervoersbedrag", nullable: true },
      { k: "note", type: "text", label: "Toelichting" },
    ], newItem: { fromPostcode: 4800, toPostcode: 4899, centsPerKm: null, fixedCents: null, note: "" } },
  ],
  packages: [
    { k: "discountOrderConfirmed", type: "bool", label: "Kortingsvolgorde 'Bereyl geregeld' is door Bereyl bevestigd", help: "De website noemt 30% / 25% / 30% voor 2 / 4 / 6 legingen. Publiceren kan pas na bevestiging." },
    { k: "creditPeriodMonths", type: "int", label: "Tegoedperiode (maanden)", min: 1, max: 36 },
    { k: "items", type: "list", label: "Pakketten", itemLabel: "Pakket", titleKey: "name", fields: [
      { k: "code", type: "text", label: "Code (intern, niet wijzigen bij bestaande klanten)", required: true },
      { k: "name", type: "text", label: "Naam", required: true },
      { k: "tagline", type: "text", label: "Korte tekst" },
      { k: "description", type: "textarea", label: "Uitleg" },
      { k: "kind", type: "select", label: "Soort", options: [{ v: "printmasters", l: "Met PrintMasters" }, { v: "on_demand", l: "Op aanvraag" }, { v: "scheduled", l: "Geregeld (vaste legingen)" }] },
      { k: "active", type: "bool", label: "Actief voor nieuwe aanvragen" },
      { k: "archived", type: "bool", label: "Gearchiveerd (bestaande klanten houden hun afspraak)" },
      { k: "frequencies", type: "list", label: "Frequenties", itemLabel: "Frequentie", fields: [
        { k: "perYear", type: "int", label: "Legingen per jaar", min: 1, max: 52 },
        { k: "discountBp", type: "bp", label: "Korting op vast legingsdeel" },
      ], newItem: { perYear: 4, discountBp: 2500 } },
    ], newItem: { code: "nieuw", name: "Nieuw pakket", tagline: "", description: "", kind: "on_demand", active: false, archived: false, frequencies: [] } },
  ],
  printmasters: [
    { k: "verificationIntegration", type: "select", label: "Verificatie", options: [{ v: "none", l: "Handmatig door een Bereyl-medewerker" }, { v: "printmasters_api", l: "Koppeling PrintMasters (nog niet beschikbaar)" }] },
    { k: "combinationRequires", type: "select", label: "Combinatierecht", options: [{ v: "verified", l: "Alleen geverifieerde klanten" }, { v: "verified_or_claimed", l: "Ook klanten in controle" }] },
    { k: "rules", type: "list", label: "Toekenningsregels", itemLabel: "Regel", titleKey: "name", fields: [
      { k: "code", type: "text", label: "Code", required: true },
      { k: "name", type: "text", label: "Naam" },
      { k: "kind", type: "select", label: "Soort", options: [{ v: "clothing_minimum", l: "Jaarlijkse kledingafname" }, { v: "other_products", l: "Andere PrintMasters-producten" }] },
      { k: "active", type: "bool", label: "Actief" },
      { k: "description", type: "textarea", label: "Uitleg in voorstel" },
      { k: "minimumPiecesPerYear", type: "group", label: "Kledingminimum per jaar", fields: [
        { k: "250", type: "int", label: "250 liter", nullable: true }, { k: "500", type: "int", label: "500 liter", nullable: true }, { k: "1000", type: "int", label: "1.000 liter", nullable: true },
      ] },
      { k: "minimumAnnualSpendCents", type: "money", label: "Minimale jaarafname andere producten", nullable: true, help: "Nog vast te stellen door Bereyl." },
      { k: "boxIncluded", type: "bool", label: "Box inbegrepen (geen maandprijs)" },
      { k: "freeCombinedEmptying", type: "bool", label: "Gratis leging bij combinatie met PrintMasters-levering" },
      { k: "followUpQuestion", type: "text", label: "Vervolgvraag in de keuzehulp" },
    ], newItem: { code: "nieuwe_regel", name: "Nieuwe regel", kind: "other_products", active: false, description: "", minimumPiecesPerYear: { "250": null, "500": null, "1000": null }, minimumAnnualSpendCents: null, boxIncluded: false, freeCombinedEmptying: true, followUpQuestion: "" } },
  ],
  advice: [
    { k: "kgPerPiece", type: "number", label: "Kilo per kledingstuk" },
    { k: "kgPerBag", type: "number", label: "Kilo per zak" },
    { k: "safetyMarginBp", type: "bp", label: "Benut tot dit deel van de capaciteit (veiligheidsmarge)" },
    { k: "minWeeksBetween", type: "int", label: "Minimaal aantal weken tussen legingen" },
    { k: "targetWeeksBetween", type: "int", label: "Gewenst aantal weken tussen legingen" },
    { k: "replacementPerYear", type: "list", label: "Antwoordopties vervangfrequentie", itemLabel: "Optie", titleKey: "label", fields: [{ k: "label", type: "text", label: "Tekst" }, { k: "value", type: "number", label: "Keer per jaar" }], newItem: { label: "", value: 1 } },
    { k: "questions", type: "group", label: "Vragen", fields: [
      { k: "printmasters", type: "text", label: "PrintMasters-vraag" }, { k: "inflow", type: "text", label: "Hoeveelheidsvraag" },
      { k: "employees", type: "text", label: "Medewerkers" }, { k: "replacement", type: "text", label: "Vervangfrequentie" }, { k: "stock", type: "text", label: "Opruimvoorraad" },
    ] },
  ],
  planning: [
    { k: "workAreaName", type: "text", label: "Naam werkgebied" },
    { k: "postcodeRanges", type: "list", label: "Postcodes in werkgebied", itemLabel: "Bereik", fields: [{ k: "from", type: "int", label: "Van", min: 1000, max: 9999 }, { k: "to", type: "int", label: "Tot en met", min: 1000, max: 9999 }], newItem: { from: 4000, to: 4099 } },
    { k: "days", type: "strings", label: "Rijdagen", help: `Codes gescheiden door komma's: ${DAYS.map((d) => `${d.v} (${d.l})`).join(", ")}` },
    { k: "dayparts", type: "list", label: "Dagdelen", itemLabel: "Dagdeel", titleKey: "label", fields: [{ k: "code", type: "text", label: "Code" }, { k: "label", type: "text", label: "Tekst" }], newItem: { code: "evening", label: "Avond" } },
    { k: "maxPreferences", type: "int", label: "Maximaal aantal voorkeursdagen", min: 1, max: 10 },
    { k: "minLeadDays", type: "int", label: "Minimale aanlooptijd (dagen)", min: 0 },
    { k: "changeUntilHoursBefore", type: "int", label: "Wijzigen tot (uur voor afspraak)" },
    { k: "cancelUntilHoursBefore", type: "int", label: "Annuleren tot (uur voor afspraak)" },
    { k: "showAvailabilityCalendar", type: "bool", label: "Beschikbaarheidskalender tonen", help: "Alleen aanzetten als de beschikbaarheid daadwerkelijk wordt onderhouden." },
    { k: "defaultCapacityPerDay", type: "int", label: "Standaardcapaciteit per route per dag" },
  ],
  contract: [
    { k: "proposalValidityDays", type: "int", label: "Geldigheid voorstel (dagen)", min: 1 },
    { k: "termsVersion", type: "text", label: "Voorwaardenversie", required: true, help: "Begint met 'concept' zolang de voorwaarden niet definitief zijn." },
    { k: "termsUrl", type: "url", label: "Link naar voorwaarden" },
    { k: "termsSummary", type: "textarea", label: "Samenvatting voorwaarden (portaal)" },
    { k: "startRule", type: "select", label: "Startmoment abonnement", options: [{ v: null, l: "Nog vast te stellen (voorlopig: plaatsingsdatum)" }, { v: "placement_date", l: "Plaatsingsdatum" }, { v: "acceptance_date", l: "Datum akkoord" }, { v: "first_of_next_month", l: "Eerste van de volgende maand" }] },
    { k: "billingStopRule", type: "select", label: "Einde betaling bij opzeggen", options: [{ v: null, l: "Nog vast te stellen (voorlopig: einddatum)" }, { v: "end_date", l: "Na de einddatum" }, { v: "pickup_date", l: "Op de ophaaldatum" }, { v: "end_of_month", l: "Einde van de maand van de einddatum" }] },
    { k: "noticeDays", type: "int", label: "Opzegtermijn (dagen)", nullable: true, help: "Leeg = nog vast te stellen (voorlopig 0)." },
    { k: "changeEffectiveRule", type: "select", label: "Ingang van wijzigingen", options: [{ v: "next_month", l: "Eerste van de volgende maand" }, { v: "immediately", l: "Direct" }, { v: "next_period", l: "Volgende periode" }] },
    { k: "creditOnPackageChange", type: "select", label: "Tegoed bij pakketwissel", options: [{ v: null, l: "Nog vast te stellen (voorlopig: loopt door tot einde periode)" }, { v: "keep_until_period_end", l: "Huidig tegoed loopt door tot einde periode" }, { v: "prorate", l: "Naar rato herberekenen" }, { v: "reset", l: "Nieuwe periode, oud tegoed vervalt" }] },
    { k: "creditCarryOver", type: "bool", label: "Ongebruikte legingen schuiven door naar de volgende periode" },
    { k: "invoicePaymentDays", type: "int", label: "Betaaltermijn facturen (dagen)" },
    { k: "loginLinkHours", type: "int", label: "Geldigheid inloglink in voorstel- en uitnodigingsmails (uren)", min: 1, max: 168 },
    { k: "loginRequestMinutes", type: "int", label: "Geldigheid zelf aangevraagde inloglink (minuten)", min: 5, max: 120 },
  ],
  homepage: [
    { k: "title", type: "text", label: "Hoofdtitel" }, { k: "subtitle", type: "textarea", label: "Ondertekst" },
    { k: "primaryAction", type: "text", label: "Hoofdactie" }, { k: "pricesAction", type: "text", label: "Actie prijzen" }, { k: "loginAction", type: "text", label: "Actie inloggen" },
    { k: "explanation", type: "textarea", label: "Ondersteunende uitleg" },
    { k: "showImpact", type: "bool", label: "Impactmeter tonen" }, { k: "impactLabel", type: "text", label: "Tekst bij impactmeter" }, { k: "impactEmptyText", type: "text", label: "Tekst bij nul registraties" },
  ],
  pdf: [
    { k: "logoUrl", type: "text", label: "Logo (URL)" }, { k: "accentColor", type: "color", label: "Accentkleur" },
    { k: "introText", type: "textarea", label: "Introductie voorstel" }, { k: "termsReference", type: "textarea", label: "Voorwaardenverwijzing", help: "Gebruik {{voorwaardenversie}}." },
    { k: "footer", type: "text", label: "Voettekst" },
    { k: "showAnswers", type: "bool", label: "Antwoorden tonen" }, { k: "showAdvice", type: "bool", label: "Advies tonen" }, { k: "showPrintmasters", type: "bool", label: "PrintMasters-afspraken tonen" }, { k: "showPreferences", type: "bool", label: "Plaatsingsvoorkeur tonen" },
  ],
  integrations: [
    { k: "mailFrom", type: "text", label: "Afzender", help: "Bijvoorbeeld: Bereyl <info@bereyl.com>. SMTP-gegevens staan in de serveromgeving." },
    { k: "replyTo", type: "email", label: "Reply-to" },
    { k: "internalRecipients", type: "strings", label: "Interne ontvangers", help: "E-mailadressen, gescheiden door komma's." },
    { k: "internalCopyAddress", type: "email", label: "Kopie van facturen naar" },
    { k: "routingProvider", type: "select", label: "Routeberekening", options: [{ v: "none", l: "Geen (vervoer nog vast te stellen)" }, { v: "openrouteservice", l: "openrouteservice (ORS_API_KEY)" }, { v: "demo", l: "Demo-indicatie per postcodegebied" }] },
    { k: "paymentProvider", type: "select", label: "Betaalprovider", options: [{ v: "none", l: "Nog niet gekozen" }, { v: "mollie", l: "Mollie (MOLLIE_API_KEY)" }] },
    { k: "accountingProvider", type: "select", label: "Boekhoudpakket", options: [{ v: "none", l: "Nog niet gekozen" }, { v: "exact", l: "Exact Online (nog te koppelen)" }, { v: "moneybird", l: "Moneybird (nog te koppelen)" }, { v: "twinfield", l: "Twinfield (nog te koppelen)" }] },
    { k: "invoiceSender", type: "group", label: "Factuurgegevens Bereyl", fields: [
      { k: "name", type: "text", label: "Naam" }, { k: "address", type: "text", label: "Adres" }, { k: "coc", type: "text", label: "KvK" }, { k: "vat", type: "text", label: "Btw-nummer" }, { k: "iban", type: "text", label: "IBAN" }, { k: "email", type: "email", label: "E-mail" },
    ] },
  ],
  automations: [
    { k: "rules", type: "list", label: "Gebeurtenissen", itemLabel: "Gebeurtenis", titleKey: "event", fixed: true, fields: [
      { k: "enabled", type: "bool", label: "Aan" },
      { k: "delayMinutes", type: "int", label: "Vertraging (minuten)", min: 0 },
      { k: "externalTemplate", type: "text", label: "Template klant (leeg = geen)" },
      { k: "internalTemplate", type: "text", label: "Template intern (leeg = geen)" },
      { k: "createTask", type: "bool", label: "Taak in werkvoorraad" },
      { k: "taskAssigneeRole", type: "select", label: "Toegewezen aan", options: [{ v: null, l: "–" }, { v: "planner", l: "Planner" }, { v: "admin", l: "Beheerder" }] },
      { k: "reminderDays", type: "strings", label: "Herinneringen na (dagen)", help: "Alleen voor 'Voorstel wacht op akkoord', bijv. 3, 7" },
    ] },
  ],
  impact: [
    { k: "showDestinations", type: "bool", label: "Verwerkingsbestemming tonen aan klanten" },
    { k: "methods", type: "list", label: "Rekenmethoden", itemLabel: "Methode", titleKey: "label", fields: [
      { k: "code", type: "text", label: "Code" }, { k: "label", type: "text", label: "Naam" }, { k: "unit", type: "text", label: "Eenheid" },
      { k: "active", type: "bool", label: "Actief (alleen met onderbouwde methode)" },
      { k: "factorPerKg", type: "number", label: "Factor per kg", nullable: true },
      { k: "source", type: "text", label: "Bron" }, { k: "method", type: "textarea", label: "Methode" }, { k: "version", type: "text", label: "Versie" },
    ], newItem: { code: "nieuw", label: "Nieuwe indicator", unit: "", active: false, factorPerKg: null, source: "", method: "", version: "" } },
  ],
};

/** Zet ruwe invoer (uit de editor) om naar getypeerde waarden. Geeft fouten per pad terug. */
export function coerce(fields: FieldSpec[], input: any, path = ""): { value: any; errors: Record<string, string> } {
  const out: any = {};
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const p = path ? `${path}.${f.k}` : f.k;
    const v = input?.[f.k];
    switch (f.type) {
      case "text": case "textarea": case "email": case "url": case "color": {
        const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v);
        if (f.required && !s) errors[p] = "Verplicht veld";
        if (f.type === "email" && s && !/^\S+@\S+\.\S+$/.test(s)) errors[p] = "Ongeldig e-mailadres";
        if (f.type === "color" && s && !/^#[0-9a-fA-F]{6}$/.test(s)) errors[p] = "Gebruik een kleurcode zoals #B9D53A";
        out[f.k] = f.k.endsWith("Template") && s === "" ? null : s;
        break;
      }
      case "int": case "number": {
        if (v === "" || v === null || v === undefined) {
          if ("nullable" in f && f.nullable) { out[f.k] = null; break; }
          errors[p] = "Vul een getal in"; out[f.k] = null; break;
        }
        const n = Number(String(v).replace(",", "."));
        if (!Number.isFinite(n) || (f.type === "int" && !Number.isInteger(n))) { errors[p] = f.type === "int" ? "Vul een geheel getal in" : "Vul een getal in"; out[f.k] = v; break; }
        if (f.min !== undefined && n < f.min) errors[p] = `Minimaal ${f.min}`;
        if (f.max !== undefined && n > f.max) errors[p] = `Maximaal ${f.max}`;
        out[f.k] = n;
        break;
      }
      case "money": {
        if (v === "" || v === null || v === undefined) {
          if (f.nullable) { out[f.k] = null; break; }
          errors[p] = "Vul een bedrag in"; out[f.k] = null; break;
        }
        const n = typeof v === "number" ? v : Math.round(Number(String(v).replace(/\./g, "").replace(",", ".")) * 100);
        if (!Number.isFinite(n) || n < 0) { errors[p] = "Ongeldig bedrag"; out[f.k] = v; break; }
        out[f.k] = Math.round(n);
        break;
      }
      case "bp": {
        const n = typeof v === "number" ? v : Math.round(Number(String(v).replace(",", ".")) * 100);
        if (!Number.isFinite(n) || n < 0 || n > 10000) { errors[p] = "Percentage tussen 0 en 100"; out[f.k] = v; break; }
        out[f.k] = n;
        break;
      }
      case "bool": out[f.k] = v === true || v === "on" || v === "true"; break;
      case "select": out[f.k] = v === "" || v === undefined ? null : v; if (!f.options.some((o) => o.v === out[f.k])) errors[p] = "Kies een geldige optie"; break;
      case "strings": {
        const arr = Array.isArray(v) ? v : String(v ?? "").split(/[,\n]/);
        const isNum = f.k === "reminderDays";
        out[f.k] = arr.map((x: any) => String(x).trim()).filter(Boolean).map((x: string) => (isNum ? Number(x) : x));
        if (isNum && out[f.k].some((x: number) => !Number.isFinite(x) || x <= 0)) errors[p] = "Gebruik positieve getallen";
        break;
      }
      case "group": {
        const r = coerce(f.fields, v ?? {}, p);
        out[f.k] = r.value; Object.assign(errors, r.errors);
        break;
      }
      case "list": {
        const arr = Array.isArray(v) ? v : [];
        out[f.k] = arr.map((item: any, i: number) => {
          const r = coerce(f.fields, item, `${p}.${i}`);
          Object.assign(errors, r.errors);
          // Velden die niet in het schema staan (zoals 'size' of 'event') blijven behouden
          return { ...item, ...r.value };
        });
        break;
      }
    }
  }
  return { value: { ...input, ...out }, errors };
}
