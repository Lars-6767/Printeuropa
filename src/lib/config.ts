/**
 * Beheerbare configuratie. Iedere sleutel wordt in config_versions bewaard met versies
 * (concept → gepubliceerd → gearchiveerd). De waarden hieronder zijn de startgegevens
 * uit de bestaande tarievenpagina (21 november 2026). Velden met `null` zijn nog door
 * Bereyl in te vullen en verschijnen als activatiepunt in Beheer.
 */

export type BoxSize = 250 | 500 | 1000;
export const BOX_SIZES: BoxSize[] = [250, 500, 1000];

export interface BoxConfig {
  size: BoxSize;
  label: string;
  description: string;
  monthlyCents: number;
  emptyingCents: number;      // vaste legingsprijs exclusief vervoer
  capacityKg: number;         // indicatieve inhoud voor advies
  dimensions: string;
  imageUrl: string;
  available: boolean;
}

export interface PricingConfig {
  vatBp: number;                   // 2100 = 21%
  boxes: BoxConfig[];
  placementCents: number | null;   // nog vast te stellen
  placementIncludesTransport: boolean;
  swapCents: number | null;
  finalPickupCents: number | null;
  extraTripsIncludeTransport: boolean;
  roundingRule: "monthly_half_up";
}

export interface TransportConfig {
  depotName: string;
  depotAddress: string;
  depotLat: number;
  depotLng: number;
  centsPerKm: number;
  model: "single_trip_covers_return" | "return_trip";
  kmRounding: "ceil" | "round";
  minimumCents: number;
  regionOverrides: { fromPostcode: number; toPostcode: number; centsPerKm: number | null; fixedCents: number | null; note: string }[];
}

export interface PackageFrequency { perYear: number; discountBp: number }
export interface PackageConfig {
  code: string;
  name: string;
  tagline: string;
  description: string;
  kind: "printmasters" | "on_demand" | "scheduled";
  active: boolean;
  archived: boolean;
  frequencies: PackageFrequency[];
}
export interface PackagesConfig {
  discountOrderConfirmed: boolean;
  creditPeriodMonths: number;
  items: PackageConfig[];
}

export interface PrintmastersRule {
  code: string;
  name: string;
  kind: "clothing_minimum" | "other_products";
  active: boolean;
  description: string;
  minimumPiecesPerYear: Record<string, number | null>;  // per boxformaat
  minimumAnnualSpendCents: number | null;
  boxIncluded: boolean;
  freeCombinedEmptying: boolean;
  followUpQuestion: string;
}
export interface PrintmastersConfig {
  verificationIntegration: "none" | "printmasters_api";
  combinationRequires: "verified" | "verified_or_claimed";
  rules: PrintmastersRule[];
}

export interface AdviceConfig {
  kgPerPiece: number;
  kgPerBag: number;
  replacementPerYear: { label: string; value: number }[];
  safetyMarginBp: number;       // gebruik zoveel % van de capaciteit
  minWeeksBetween: number;      // niet vaker dan dit legen
  targetWeeksBetween: number;
  questions: { inflow: string; printmasters: string; employees: string; replacement: string; stock: string };
}

export interface PlanningConfig {
  workAreaName: string;
  postcodeRanges: { from: number; to: number }[];
  days: string[];
  dayparts: { code: string; label: string }[];
  maxPreferences: number;
  minLeadDays: number;
  changeUntilHoursBefore: number;
  cancelUntilHoursBefore: number;
  showAvailabilityCalendar: boolean;
  defaultCapacityPerDay: number;
}

export interface ContractConfig {
  proposalValidityDays: number;
  termsVersion: string;
  termsUrl: string;
  termsSummary: string;
  startRule: "placement_date" | "acceptance_date" | "first_of_next_month" | null;
  billingStopRule: "end_date" | "pickup_date" | "end_of_month" | null;
  noticeDays: number | null;
  changeEffectiveRule: "next_month" | "immediately" | "next_period";
  creditOnPackageChange: "keep_until_period_end" | "prorate" | "reset" | null;
  creditCarryOver: boolean;
  invoicePaymentDays: number;
  loginLinkHours: number;
}

export interface HomepageConfig {
  title: string;
  subtitle: string;
  primaryAction: string;
  pricesAction: string;
  loginAction: string;
  explanation: string;
  showImpact: boolean;
  impactLabel: string;
  impactEmptyText: string;
}

export interface PdfConfig {
  logoUrl: string;
  accentColor: string;
  introText: string;
  termsReference: string;
  footer: string;
  showAnswers: boolean;
  showAdvice: boolean;
  showPrintmasters: boolean;
  showPreferences: boolean;
}

export interface IntegrationsConfig {
  mailFrom: string;
  replyTo: string;
  internalRecipients: string[];
  internalCopyAddress: string;
  routingProvider: "none" | "openrouteservice" | "demo";
  paymentProvider: "none" | "mollie";
  accountingProvider: "none" | "exact" | "moneybird" | "twinfield";
  invoiceSender: { name: string; address: string; coc: string; vat: string; iban: string; email: string };
  storage: "local";
}

export interface AutomationRule {
  event: string;
  enabled: boolean;
  delayMinutes: number;
  externalTemplate: string | null;
  internalTemplate: string | null;
  createTask: boolean;
  taskAssigneeRole: "admin" | "planner" | null;
  reminderDays: number[];
}
export interface AutomationsConfig { rules: AutomationRule[] }

export interface ImpactMethod {
  code: string;
  label: string;
  unit: string;
  active: boolean;
  factorPerKg: number | null;
  source: string;
  method: string;
  version: string;
}
export interface ImpactConfig { methods: ImpactMethod[]; showDestinations: boolean }

export interface ConfigMap {
  pricing: PricingConfig;
  transport: TransportConfig;
  packages: PackagesConfig;
  printmasters: PrintmastersConfig;
  advice: AdviceConfig;
  planning: PlanningConfig;
  contract: ContractConfig;
  homepage: HomepageConfig;
  pdf: PdfConfig;
  integrations: IntegrationsConfig;
  automations: AutomationsConfig;
  impact: ImpactConfig;
}
export type ConfigKey = keyof ConfigMap;

export const EVENTS: { code: string; label: string }[] = [
  { code: "proposal.requested", label: "Voorstel aangevraagd" },
  { code: "proposal.reminder", label: "Voorstel wacht op akkoord" },
  { code: "printmasters.interest", label: "PrintMasters-interesse" },
  { code: "printmasters.verified", label: "PrintMasters gecontroleerd" },
  { code: "proposal.accepted", label: "Akkoord" },
  { code: "appointment.requested", label: "Afspraak aangevraagd" },
  { code: "appointment.confirmed", label: "Afspraak bevestigd of gewijzigd" },
  { code: "appointment.cancelled", label: "Afspraak geannuleerd" },
  { code: "box.placed", label: "Box geplaatst" },
  { code: "emptying.executed", label: "Leging uitgevoerd" },
  { code: "weight.confirmed", label: "Gewicht bevestigd" },
  { code: "certificate.released", label: "Certificaat vrijgegeven" },
  { code: "subscription.changed", label: "Abonnement gewijzigd" },
  { code: "subscription.cancelled", label: "Opgezegd" },
  { code: "invoice.created", label: "Factuur aangemaakt" },
  { code: "payment.failed", label: "Betaling mislukt" },
  { code: "outside_area.request", label: "Aanvraag buiten werkgebied" },
  { code: "member.invited", label: "Medewerker uitgenodigd" },
];

// Hulptabellen voor de standaardautomatiseringen.
const EXTERNAL_TEMPLATE_FOR: Record<string, string> = {
  "proposal.requested": "proposal_ready",
  "proposal.reminder": "proposal_reminder",
  "printmasters.interest": "printmasters_interest",
  "printmasters.verified": "printmasters_verified",
  "proposal.accepted": "acceptance_confirmation",
  "appointment.requested": "appointment_requested",
  "appointment.confirmed": "appointment_confirmed",
  "appointment.cancelled": "appointment_cancelled",
  "box.placed": "box_placed",
  "emptying.executed": "emptying_settled",
  "weight.confirmed": "weight_confirmed",
  "certificate.released": "certificate_released",
  "subscription.changed": "subscription_changed",
  "subscription.cancelled": "subscription_cancelled",
  "invoice.created": "invoice_created",
  "payment.failed": "payment_failed",
  "outside_area.request": "outside_area_received",
  "member.invited": "member_invited",
};
const INTERNAL_TEMPLATE_FOR: Record<string, string> = {
  "proposal.requested": "internal_new_request",
  "printmasters.interest": "internal_printmasters_interest",
  "proposal.accepted": "internal_accepted",
  "appointment.requested": "internal_appointment_requested",
  "subscription.changed": "internal_subscription_changed",
  "subscription.cancelled": "internal_subscription_cancelled",
  "payment.failed": "internal_payment_failed",
  "outside_area.request": "internal_outside_area",
};
const TASK_FOR = ["printmasters.interest", "payment.failed", "outside_area.request"];

const boxImg = (s: number) => `/boxes/box-${s}.svg`;

export const DEFAULTS: ConfigMap = {
  pricing: {
    vatBp: 2100,
    boxes: [
      { size: 250, label: "250 liter", description: "Voor kleine teams en een enkele vestiging.", monthlyCents: 895, emptyingCents: 6900, capacityKg: 50, dimensions: "", imageUrl: boxImg(250), available: true },
      { size: 500, label: "500 liter", description: "Voor teams met regelmatig wisselende werkkleding.", monthlyCents: 1395, emptyingCents: 11900, capacityKg: 100, dimensions: "", imageUrl: boxImg(500), available: true },
      { size: 1000, label: "1.000 liter", description: "Voor grote organisaties en opruimacties.", monthlyCents: 2295, emptyingCents: 20900, capacityKg: 200, dimensions: "", imageUrl: boxImg(1000), available: true },
    ],
    placementCents: null,
    placementIncludesTransport: true,
    swapCents: null,
    finalPickupCents: null,
    extraTripsIncludeTransport: true,
    roundingRule: "monthly_half_up",
  },
  transport: {
    depotName: "Bereyl depot Breda",
    depotAddress: "Minervum 7290F, 4817 ZM Breda",
    depotLat: 51.5853,
    depotLng: 4.8041,
    centsPerKm: 390,
    model: "single_trip_covers_return",
    kmRounding: "ceil",
    minimumCents: 0,
    regionOverrides: [],
  },
  packages: {
    discountOrderConfirmed: false,
    creditPeriodMonths: 12,
    items: [
      {
        code: "printmasters", name: "Met PrintMasters", kind: "printmasters", active: true, archived: false,
        tagline: "Box inbegrepen bij jullie PrintMasters-afspraak",
        description: "De box is inbegrepen bij een actieve PrintMasters-afspraak. Combineer een leging met een PrintMasters-levering en de leging is gratis. Losse legingen betaal je per keer.",
        frequencies: [],
      },
      {
        code: "on_demand", name: "Bereyl op aanvraag", kind: "on_demand", active: true, archived: false,
        tagline: "Een vaste prijs per maand, legen wanneer jullie willen",
        description: "Je betaalt per maand voor de box en per leging een vast bedrag plus vervoer.",
        frequencies: [],
      },
      {
        code: "scheduled", name: "Bereyl geregeld", kind: "scheduled", active: true, archived: false,
        tagline: "Vaste legingen per jaar met korting",
        description: "Een vast aantal legingen per jaar inbegrepen in het maandbedrag, met korting op het vaste legingsdeel.",
        frequencies: [
          { perYear: 2, discountBp: 3000 },
          { perYear: 4, discountBp: 2500 },
          { perYear: 6, discountBp: 3000 },
        ],
      },
    ],
  },
  printmasters: {
    verificationIntegration: "none",
    combinationRequires: "verified",
    rules: [
      {
        code: "clothing_minimum", name: "Jaarlijkse kledingafname", kind: "clothing_minimum", active: true,
        description: "Bij een jaarlijkse afname van minimaal het aantal kledingstukken per boxformaat is de box inbegrepen.",
        minimumPiecesPerYear: { "250": 30, "500": 40, "1000": 50 },
        minimumAnnualSpendCents: null, boxIncluded: true, freeCombinedEmptying: true,
        followUpQuestion: "Hoeveel kledingstukken nemen jullie per jaar af bij PrintMasters?",
      },
      {
        code: "other_products", name: "Regelmatige afname andere PrintMasters-producten", kind: "other_products", active: false,
        description: "Nog vast te stellen door Bereyl: voordeel bij regelmatige afname van andere producten dan kleding.",
        minimumPiecesPerYear: { "250": null, "500": null, "1000": null },
        minimumAnnualSpendCents: null, boxIncluded: false, freeCombinedEmptying: true,
        followUpQuestion: "Welke producten nemen jullie regelmatig af bij PrintMasters?",
      },
    ],
  },
  advice: {
    kgPerPiece: 0.6,
    kgPerBag: 5,
    replacementPerYear: [
      { label: "Eén keer per jaar", value: 1 },
      { label: "Twee keer per jaar", value: 2 },
      { label: "Vaker dan twee keer per jaar", value: 4 },
    ],
    safetyMarginBp: 8000,
    minWeeksBetween: 6,
    targetWeeksBetween: 13,
    questions: {
      inflow: "Hoeveel kleding komt er per maand vrij?",
      printmasters: "Werken jullie al met PrintMasters?",
      employees: "Hoeveel medewerkers dragen werkkleding?",
      replacement: "Hoe vaak wordt werkkleding vervangen?",
      stock: "Is er eenmalig een opruimvoorraad?",
    },
  },
  planning: {
    workAreaName: "Noord-Brabant",
    postcodeRanges: [
      { from: 4250, to: 4299 },
      { from: 4600, to: 4689 },
      { from: 4700, to: 4999 },
      { from: 5000, to: 5299 },
      { from: 5340, to: 5799 },
      { from: 5820, to: 5846 },
    ],
    days: ["mon", "tue", "wed", "thu", "fri"],
    dayparts: [
      { code: "morning", label: "Ochtend (8–12 uur)" },
      { code: "afternoon", label: "Middag (12–17 uur)" },
    ],
    maxPreferences: 5,
    minLeadDays: 2,
    changeUntilHoursBefore: 48,
    cancelUntilHoursBefore: 24,
    showAvailabilityCalendar: false,
    defaultCapacityPerDay: 8,
  },
  contract: {
    proposalValidityDays: 30,
    termsVersion: "concept-2026-11",
    termsUrl: "",
    termsSummary: "De boxvoorwaarden zijn nog in concept. Bereyl stelt de definitieve voorwaarden vast vóór activatie.",
    startRule: null,
    billingStopRule: null,
    noticeDays: null,
    changeEffectiveRule: "next_month",
    creditOnPackageChange: null,
    creditCarryOver: false,
    invoicePaymentDays: 14,
    loginLinkHours: 72,
  },
  homepage: {
    title: "Meld je aan bij Bereyl",
    subtitle: "Ontdek welke box bij jullie past, bekijk je prijs en regel de plaatsing",
    primaryAction: "Vind mijn box",
    pricesAction: "Bekijk de prijzen",
    loginAction: "Inloggen",
    explanation: "Bereyl zamelt bedrijfskleding in via boxen van 250, 500 en 1.000 liter. Iedere partij wordt gewogen en krijgt een nieuwe bestemming: hergebruik of recycling.",
    showImpact: true,
    impactLabel: "kilo bedrijfskleding ingezameld",
    impactEmptyText: "De teller staat klaar. Jullie eerste leging zet hem in beweging.",
  },
  pdf: {
    logoUrl: "",
    accentColor: "#B9D53A",
    introText: "Bedankt voor jullie aanvraag. In dit voorstel staat welke box we adviseren, wat het kost en hoe we verder gaan.",
    termsReference: "Op dit voorstel zijn de Bereyl-boxvoorwaarden van toepassing (versie {{voorwaardenversie}}).",
    footer: "Bereyl · Minervum 7290F, 4817 ZM Breda",
    showAnswers: true,
    showAdvice: true,
    showPrintmasters: true,
    showPreferences: true,
  },
  integrations: {
    mailFrom: "Bereyl <noreply@bereyl.example>",
    replyTo: "",
    internalRecipients: [],
    internalCopyAddress: "",
    routingProvider: "demo",
    paymentProvider: "none",
    accountingProvider: "none",
    invoiceSender: { name: "Bereyl", address: "Minervum 7290F, 4817 ZM Breda", coc: "", vat: "", iban: "", email: "" },
    storage: "local",
  },
  automations: {
    rules: EVENTS.map((e) => ({
      event: e.code,
      enabled: true,
      delayMinutes: 0,
      externalTemplate: EXTERNAL_TEMPLATE_FOR[e.code] ?? null,
      internalTemplate: INTERNAL_TEMPLATE_FOR[e.code] ?? null,
      createTask: TASK_FOR.includes(e.code),
      taskAssigneeRole: TASK_FOR.includes(e.code) ? "planner" : null,
      reminderDays: e.code === "proposal.reminder" ? [3, 7] : [],
    })),
  },
  impact: {
    showDestinations: true,
    methods: [
      { code: "co2", label: "CO₂-besparing", unit: "kg CO₂-eq", active: false, factorPerKg: null, source: "", method: "", version: "" },
      { code: "water", label: "Waterbesparing", unit: "liter", active: false, factorPerKg: null, source: "", method: "", version: "" },
    ],
  },
};

export const CONFIG_LABELS: Record<ConfigKey, { title: string; intro: string }> = {
  pricing: { title: "Boxen en tarieven", intro: "Maandprijs, vaste legingsprijs, eenmalige kosten en btw per boxformaat." },
  transport: { title: "Vervoer", intro: "Depot, kilometertarief, afronding en regio-afwijkingen. Het tarief per kilometer enkele reis dekt ook de terugrit." },
  packages: { title: "Abonnementen", intro: "Pakketten, inbegrepen legingen, frequenties en kortingen." },
  printmasters: { title: "PrintMasters", intro: "Toekenningsregels, kledingminima, verificatie en combinatierechten." },
  advice: { title: "Boxadvies", intro: "Vragen, omrekeningen, capaciteit en veiligheidsmarge voor de keuzehulp." },
  planning: { title: "Planning en werkgebied", intro: "Werkgebied, dagen, dagdelen, capaciteit en regels voor wijzigen en annuleren." },
  contract: { title: "Contractafspraken", intro: "Geldigheid voorstel, voorwaardenversie, start, beëindiging en tegoedregels." },
  homepage: { title: "Homepage", intro: "Hoofdtekst, acties en weergave van de impactmeter." },
  pdf: { title: "PDF's", intro: "Logo, kleuren, teksten en zichtbare onderdelen in het voorstel." },
  integrations: { title: "Koppelingen", intro: "Mail, betalingen, boekhouding, routeberekening en factuurgegevens. Geheime sleutels staan in de serveromgeving." },
  automations: { title: "Automatiseringen", intro: "Per gebeurtenis: aan/uit, vertraging, templates, taken en herinneringen." },
  impact: { title: "Impact", intro: "Rekenmethoden voor CO₂ en water. Standaard inactief totdat een onderbouwde methode is ingevoerd." },
};
