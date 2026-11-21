# Mijn Bereyl

Webapplicatie voor Bereyl. Ze bestaat uit een publieke homepage met prijzen en keuzehulp, het klantportaal Mijn Bereyl en een beheersysteem met CRM, planning, uitvoering, wegingen, certificaten, facturatie en instellingen.

**Stack:** Next.js 15 (App Router, server actions) · TypeScript · PostgreSQL (`pg`, plain SQL-migraties) · achtergrondworker met transactionele outbox · pdfkit · nodemailer · zod.

## Installatie

Benodigd: Node 20+ en PostgreSQL 14+.

```bash
npm install
cp .env.example .env           # vul DATABASE_URL, APP_URL en SESSION_SECRET in
npm run db:migrate             # schema
npm run db:seed                # startconfiguratie, e-mailtemplates, medewerkers, routes, boxen
npm run dev                    # http://localhost:3000
npm run worker                 # in een tweede terminal: PDF's, e-mail, facturen, betalingen, dagtaken
```

Met `DEMO_MODE=true` zet de seed er een herkenbaar demobedrijf bij (gemarkeerd met "DEMO"). Medewerkers krijgen dan het wachtwoord `Bereyl-demo-2026`:

| Rol | Account |
|---|---|
| Beheerder | admin@bereyl.test |
| Planner | planner@bereyl.test |
| Uitvoerend medewerker | chauffeur@bereyl.test |
| Demoklant | demo-klant@voorbeeld.test |

Buiten de demomodus stel je wachtwoorden in via "Wachtwoord vergeten" of zet je `SEED_PASSWORD`.

Productie: `npm run build && npm start`. Laat daarnaast `npm run worker` continu draaien, bijvoorbeeld als systemd-service of tweede container. Neem de database en de map `STORAGE_DIR` op in de back-up.

## Controles

```bash
npm test                 # vitest; gebruikt database bereyl_test (TEST_DATABASE_URL)
npm run typecheck
# Volledige klantreis via de echte schermen. App en worker moeten draaien; schone database:
npm run db:reset && node e2e/journey.mjs
```

De unittests dekken:
- prijsberekening en afronding (onder meer het voorbeeld van € 108);
- overboeking van tegoed bij gelijktijdige bevestigingen;
- dubbele facturen en betaalberichten;
- toegangsgrenzen van documenten;
- publicatieregels en e-mailtemplates.

`e2e/journey.mjs` voert 65 controles uit en loopt de opleverroutes uit hoofdstuk 18 door. Alle 65 controles slaagden.

## Externe koppelingen en activatiepunten

Geheime sleutels staan alleen in de serveromgeving. De keuzes (provider, afzender, ontvangers) maak je in **Beheer → Instellingen → Koppelingen**. De verbindingsstatus staat onder **Beheer → Koppelingen**. Ontbrekende waarden verschijnen als *activatiepunten* in de werkvoorraad.

| Koppeling | Variabelen | Zonder configuratie |
|---|---|---|
| E-mail (SMTP) | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE` | Berichten worden gelogd ("niet verzonden: mailkoppeling ontbreekt") en zijn te bekijken in Beheer → Wachtrij |
| Routeberekening | `ORS_API_KEY` (openrouteservice) | Vervoer staat op "nog vast te stellen". In demomodus is er een indicatie per postcodegebied. Een ontbrekende afstand is nooit gratis |
| Betalingen/incasso | `MOLLIE_API_KEY` + provider "Mollie" kiezen | In demomodus is er een gemarkeerde demo-provider. Anders zie je een taak "Incasso niet gestart" |
| Boekhouding | `ACCOUNTING_PROVIDER`, `ACCOUNTING_API_KEY` | Nog niet gebouwd. Facturen en PDF's worden in de applicatie gemaakt en bewaard |
| Opslag | `STORAGE_DIR` | Lokale, afgeschermde map. Bestanden worden alleen via `/api/files/:id` met rechtencontrole geserveerd |

Door Bereyl nog vast te stellen (zie hoofdstuk 17). Deze staan als conceptinstelling klaar:
- de PrintMasters-regel voor andere producten;
- bevestiging van de kortingsvolgorde 30/25/30 (publiceren is geblokkeerd tot die bevestigd is);
- tarieven voor plaatsing, omruilen en ophalen;
- startmoment van het abonnement, einde van de betaling en tegoed bij pakketwissel;
- definitieve voorwaarden;
- factuurgegevens;
- interne e-mailadressen.

Zolang een tarief ontbreekt, staat het als "nog vast te stellen" in voorstel en portaal. Een uitgevoerde rit zonder tarief krijgt een controletaak; die rit wordt dus niet gratis.

## Architectuur in het kort

- `src/lib/pricing.ts` bevat de pure prijsberekening. Het voorstel slaat een volledige momentopname op (`proposals.offer`). Na akkoord gaat die naar `subscription_versions.terms`. Een uitgevoerde rit wordt altijd geprijsd vanuit die vastgelegde afspraak.
- `src/lib/config.ts`, `config-schema.ts` en `settings.ts` regelen alle beheerbare instellingen. Elke instelling heeft versies (concept → gepubliceerd → gearchiveerd) die je kunt terugzetten. De beheereditor wordt gegenereerd uit het schema.
- `src/lib/jobs.ts` en `automation.ts` vormen de outbox. Mutatie en job worden in één transactie opgeslagen. Elke job heeft een unieke sleutel, zodat opnieuw uitvoeren veilig is. Berichtjobs starten geen nieuwe gebeurtenissen, waardoor circulaire triggers niet kunnen ontstaan.
- `src/lib/credit.ts` houdt het tegoed bij als mutatielog. De periode-rij wordt vergrendeld, zodat er niet overboekt kan worden.
- `src/lib/billing.ts` en `payments.ts`: facturen zijn uniek per bron (`source_key`) en provider-events uniek per id. Abonnementen worden achteraf per kalendermaand en pro rata gefactureerd.
- Rechten: rollen admin/planner/field en customer_admin/customer_member worden op de server gecontroleerd. Een klant krijgt pas toegang tot bedrijfsgegevens nadat de e-maillink bevestigd is.
- Het gebruikte boxbeeld is een tijdelijke illustratie in `public/boxes`. Vervang het in **Beheer → Instellingen → Boxen en tarieven** door de echte Bereyl-afbeeldingen. Logo en kleuren voor de PDF stel je in onder PDF's.

## Bekende beperkingen

- Een koppeling met de PrintMasters-leverplanning en een boekhoudkoppeling zijn voorbereid, maar niet gebouwd.
- De Mollie-flow (mandaat via eerste betaling, recurring incasso, webhook) is volgens de API geïmplementeerd, maar niet live getest.
- De beschikbaarheidskalender staat standaard uit, totdat Bereyl de beschikbaarheid daadwerkelijk bijhoudt.
