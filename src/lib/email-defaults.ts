/** Startinhoud van alle e-mailtemplates. Beheer kan deze als nieuwe versie aanpassen en publiceren. */
import type { EmailBlock } from "./email-render";

export interface TemplateDefault { key: string; audience: "external" | "internal"; name: string; subject: string; blocks: EmailBlock[]; attachments?: string[] }

const contact: EmailBlock = { type: "contact", text: "Vragen? Beantwoord deze e-mail of bel ons. We denken graag mee." };
const btn = (label: string): EmailBlock => ({ type: "button", label, url: "{{portallink}}" });

export const TEMPLATE_DEFAULTS: TemplateDefault[] = [
  {
    key: "proposal_ready", audience: "external", name: "Voorstel klaar", subject: "Jouw Bereyl-voorstel staat klaar", attachments: ["proposal_pdf"],
    blocks: [
      { type: "text", text: "Hoi {{voornaam}}, leuk dat jullie met Bereyl willen inzamelen. In de bijlage vind je het voorstel voor jullie {{boxformaat}}-box in {{plaats}}. Open Mijn Bereyl om de gegevens te bekijken en akkoord te geven. Daarna stemmen we de plaatsing met jullie af." },
      { type: "summary", rows: [{ label: "Aanvraag", value: "{{aanvraagnummer}}" }, { label: "Pakket", value: "{{abonnementsnaam}}" }, { label: "Per maand", value: "{{prijs}} excl. btw" }] },
      btn("Bekijk mijn voorstel"),
      { type: "text", text: "Deze link is persoonlijk en tijdelijk geldig. Verlopen? Vraag op de inlogpagina eenvoudig een nieuwe aan." },
      contact,
    ],
  },
  {
    key: "proposal_reminder", audience: "external", name: "Herinnering voorstel", subject: "Je voorstel wacht nog op akkoord",
    blocks: [
      { type: "text", text: "Hoi {{voornaam}}, het voorstel voor jullie {{boxformaat}}-box staat nog voor je klaar. Geef akkoord in Mijn Bereyl, dan plannen we de plaatsing." },
      btn("Bekijk mijn voorstel"), contact,
    ],
  },
  {
    key: "printmasters_interest", audience: "external", name: "PrintMasters-kennismaking ontvangen", subject: "We nemen contact met je op over PrintMasters",
    blocks: [{ type: "text", text: "Hoi {{voornaam}}, bedankt voor je interesse in PrintMasters. Een collega neemt contact op voor een kennismaking of bezoek." }, contact],
  },
  {
    key: "printmasters_verified", audience: "external", name: "PrintMasters gecontroleerd", subject: "Jullie PrintMasters-afspraak is gecontroleerd",
    blocks: [{ type: "text", text: "Hoi {{voornaam}}, we hebben jullie PrintMasters-afspraak gecontroleerd. {{toelichting}} Bekijk de definitieve prijs in Mijn Bereyl." }, btn("Bekijk mijn voorstel"), contact],
  },
  {
    key: "acceptance_confirmation", audience: "external", name: "Akkoordbevestiging", subject: "Bedankt voor je akkoord", attachments: ["acceptance_pdf"],
    blocks: [
      { type: "heading", text: "Klaar voor een nieuwe ronde?" },
      { type: "text", text: "Hoi {{voornaam}}, we hebben jullie akkoord ontvangen. In de bijlage staat het akkoordbewijs. We nemen de plaatsing van de {{boxformaat}}-box in {{plaats}} nu in behandeling en bevestigen de afspraak zo snel mogelijk." },
      { type: "summary", rows: [{ label: "Pakket", value: "{{abonnementsnaam}}" }, { label: "Per maand", value: "{{prijs}} excl. btw" }, { label: "Voorkeur", value: "{{voorkeuren}}" }] },
      btn("Volg de plaatsing"), contact,
    ],
  },
  {
    key: "appointment_requested", audience: "external", name: "Afspraak aangevraagd", subject: "We hebben je aanvraag ontvangen",
    blocks: [
      { type: "text", text: "Hoi {{voornaam}}, we hebben je aanvraag {{afspraaknummer}} ontvangen. Bereyl bevestigt de definitieve datum." },
      { type: "summary", rows: [{ label: "Voorkeuren", value: "{{voorkeuren}}" }, { label: "Locatie", value: "{{locatie}}" }, { label: "Afhandeling", value: "{{toelichting}}" }] },
      btn("Bekijk mijn afspraken"), contact,
    ],
  },
  {
    key: "appointment_confirmed", audience: "external", name: "Afspraak bevestigd", subject: "Je afspraak staat vast: {{datum}}",
    blocks: [
      { type: "text", text: "Hoi {{voornaam}}, je afspraak {{afspraaknummer}} is bevestigd." },
      { type: "summary", rows: [{ label: "Datum", value: "{{datum}}" }, { label: "Dagdeel", value: "{{dagdeel}}" }, { label: "Locatie", value: "{{locatie}}" }, { label: "Afhandeling", value: "{{toelichting}}" }] },
      btn("Bekijk mijn afspraken"), contact,
    ],
  },
  {
    key: "appointment_cancelled", audience: "external", name: "Afspraak geannuleerd", subject: "Je afspraak is geannuleerd",
    blocks: [{ type: "text", text: "Hoi {{voornaam}}, afspraak {{afspraaknummer}} is geannuleerd. Eventueel gereserveerd tegoed is weer beschikbaar: {{tegoed}}." }, btn("Naar Mijn Bereyl"), contact],
  },
  {
    key: "box_placed", audience: "external", name: "Box geplaatst", subject: "Jullie Bereyl-box staat klaar",
    blocks: [
      { type: "heading", text: "Welkom bij Bereyl" },
      { type: "text", text: "Hoi {{voornaam}}, de {{boxformaat}}-box staat bij {{locatie}}. Is hij vol? Vraag in Mijn Bereyl een leging aan. Daar zie je ook jullie tegoed, afspraken en impact." },
      btn("Open Mijn Bereyl"), contact,
    ],
  },
  {
    key: "emptying_settled", audience: "external", name: "Leging afgehandeld", subject: "Weer een lading met een toekomst",
    blocks: [
      { type: "text", text: "Hoi {{voornaam}}, we hebben de box bij {{locatie}} geleegd op {{datum}}. Het gewicht volgt na weging." },
      { type: "summary", rows: [{ label: "Afhandeling", value: "{{toelichting}}" }, { label: "Tegoed", value: "{{tegoed}}" }] },
      btn("Bekijk de afhandeling"), contact,
    ],
  },
  {
    key: "weight_confirmed", audience: "external", name: "Gewicht bevestigd", subject: "{{gewicht}} kleding met een toekomst",
    blocks: [
      { type: "heading", text: "Weer een lading met een toekomst" },
      { type: "text", text: "Hoi {{voornaam}}, de leging van {{datum}} bij {{locatie}} is gewogen: {{gewicht}}. Bekijk jullie totale impact in Mijn Bereyl." },
      btn("Bekijk mijn impact"), contact,
    ],
  },
  {
    key: "certificate_released", audience: "external", name: "Certificaat vrijgegeven", subject: "Er staat een nieuw certificaat voor jullie klaar",
    blocks: [{ type: "text", text: "Hoi {{voornaam}}, {{certificaat}} staat voor jullie klaar in Mijn Bereyl onder Documenten." }, btn("Bekijk het certificaat"), contact],
  },
  {
    key: "subscription_changed", audience: "external", name: "Abonnement gewijzigd", subject: "Je abonnement is gewijzigd",
    blocks: [
      { type: "text", text: "Hoi {{voornaam}}, je wijziging is vastgelegd." },
      { type: "summary", rows: [{ label: "Was", value: "{{oude_prijs}} per maand" }, { label: "Wordt", value: "{{nieuwe_prijs}} per maand" }, { label: "Nieuw abonnement", value: "{{abonnementsnaam}} · {{boxformaat}}" }, { label: "Ingangsdatum", value: "{{ingangsdatum}}" }] },
      { type: "text", text: "{{toelichting}}" },
      btn("Bekijk mijn abonnement"), contact,
    ],
  },
  {
    key: "subscription_cancelled", audience: "external", name: "Opzegging bevestigd", subject: "We hebben je opzegging ontvangen",
    blocks: [
      { type: "text", text: "Hoi {{voornaam}}, jammer dat jullie stoppen. We halen de box op en stoppen de abonnementsfacturatie op de afgesproken datum." },
      { type: "summary", rows: [{ label: "Einddatum", value: "{{einddatum}}" }, { label: "Ophaalvoorkeur", value: "{{voorkeuren}}" }, { label: "Eindkosten", value: "{{eindkosten}}" }] },
      { type: "text", text: "Jullie historie, facturen en certificaten blijven beschikbaar in Mijn Bereyl." },
      btn("Bekijk de ophaalafspraak"), contact,
    ],
  },
  {
    key: "invoice_created", audience: "external", name: "Factuur", subject: "Factuur {{factuurnummer}} van Bereyl", attachments: ["invoice_pdf"],
    blocks: [{ type: "text", text: "Beste {{bedrijfsnaam}}, in de bijlage vind je factuur {{factuurnummer}} van {{bedrag}} (incl. btw). {{toelichting}}" }, btn("Bekijk mijn facturen"), contact],
  },
  {
    key: "payment_failed", audience: "external", name: "Betaling mislukt", subject: "De betaling van factuur {{factuurnummer}} is niet gelukt",
    blocks: [{ type: "text", text: "Beste {{bedrijfsnaam}}, de incasso van factuur {{factuurnummer}} ({{bedrag}}) is niet gelukt. Betaal de factuur via Mijn Bereyl." }, btn("Betaal de factuur"), contact],
  },
  {
    key: "outside_area_received", audience: "external", name: "Aanvraag buiten werkgebied", subject: "We maken een voorstel op maat",
    blocks: [{ type: "text", text: "Hoi {{voornaam}}, jullie locatie in {{plaats}} ligt buiten ons standaard werkgebied. We bekijken de mogelijkheden en sturen een voorstel op maat." }, contact],
  },
  {
    key: "member_invited", audience: "external", name: "Uitnodiging collega", subject: "Je bent uitgenodigd voor Mijn Bereyl",
    blocks: [{ type: "text", text: "Hoi {{voornaam}}, je bent uitgenodigd om Mijn Bereyl te gebruiken voor {{bedrijfsnaam}}." }, btn("Uitnodiging accepteren"), contact],
  },
  {
    key: "auth_login_link", audience: "external", name: "Inloglink", subject: "Je inloglink voor Mijn Bereyl",
    blocks: [{ type: "text", text: "Hoi {{voornaam}}, met de knop hieronder log je in bij Mijn Bereyl. De link is persoonlijk, werkt één keer en is 30 minuten geldig." }, btn("Inloggen bij Mijn Bereyl"), { type: "contact", text: "Heb je geen inloglink aangevraagd? Dan kun je deze e-mail negeren." }],
  },
  // ---- intern
  { key: "internal_new_request", audience: "internal", name: "Intern: nieuwe aanvraag", subject: "Nieuwe aanvraag {{aanvraagnummer}} · {{bedrijfsnaam}}", blocks: [{ type: "summary", rows: [{ label: "Bedrijf", value: "{{bedrijfsnaam}}" }, { label: "Box", value: "{{boxformaat}} · {{abonnementsnaam}}" }, { label: "Plaats", value: "{{plaats}}" }, { label: "Per maand", value: "{{prijs}}" }] }] },
  { key: "internal_printmasters_interest", audience: "internal", name: "Intern: PrintMasters-interesse", subject: "PrintMasters-interesse · {{bedrijfsnaam}}", blocks: [{ type: "text", text: "{{bedrijfsnaam}} wil kennismaken met PrintMasters. Er staat een taak in de werkvoorraad." }] },
  { key: "internal_accepted", audience: "internal", name: "Intern: akkoord", subject: "Akkoord ontvangen · {{bedrijfsnaam}}", blocks: [{ type: "text", text: "{{bedrijfsnaam}} heeft akkoord gegeven op {{aanvraagnummer}}. De plaatsingsopdracht staat klaar om te bevestigen." }] },
  { key: "internal_appointment_requested", audience: "internal", name: "Intern: afspraak aangevraagd", subject: "Nieuwe afspraakaanvraag {{afspraaknummer}}", blocks: [{ type: "summary", rows: [{ label: "Bedrijf", value: "{{bedrijfsnaam}}" }, { label: "Locatie", value: "{{locatie}}" }, { label: "Voorkeuren", value: "{{voorkeuren}}" }, { label: "Afhandeling", value: "{{toelichting}}" }] }] },
  { key: "internal_subscription_changed", audience: "internal", name: "Intern: abonnement gewijzigd", subject: "Abonnement gewijzigd · {{bedrijfsnaam}}", blocks: [{ type: "summary", rows: [{ label: "Oud", value: "{{oude_prijs}}" }, { label: "Nieuw", value: "{{nieuwe_prijs}}" }, { label: "Ingang", value: "{{ingangsdatum}}" }] }, { type: "text", text: "{{toelichting}}" }] },
  { key: "internal_subscription_cancelled", audience: "internal", name: "Intern: opzegging", subject: "Opzegging · {{bedrijfsnaam}}", blocks: [{ type: "text", text: "{{bedrijfsnaam}} heeft opgezegd per {{einddatum}}. De ophaalopdracht staat klaar." }] },
  { key: "internal_payment_failed", audience: "internal", name: "Intern: betaling mislukt", subject: "Betaling mislukt · {{factuurnummer}}", blocks: [{ type: "text", text: "De betaling van {{factuurnummer}} ({{bedrag}}) van {{bedrijfsnaam}} is mislukt. Zie de werkvoorraad." }] },
  { key: "internal_outside_area", audience: "internal", name: "Intern: buiten werkgebied", subject: "Maatwerkaanvraag buiten werkgebied · {{bedrijfsnaam}}", blocks: [{ type: "text", text: "{{bedrijfsnaam}} uit {{plaats}} vraagt een voorstel op maat. Zie de werkvoorraad." }] },
];
