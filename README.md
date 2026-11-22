# Mijn Bereyl

Webapplicatie voor Bereyl. Ze bestaat uit een publieke homepage met prijzen en keuzehulp, het klantportaal Mijn Bereyl en een beheersysteem met CRM, planning, uitvoering, wegingen, certificaten, facturatie en instellingen.

**Stack:** Next.js 15 (App Router, server actions) · TypeScript · PostgreSQL (`pg`, plain SQL-migraties) · achtergrondworker met transactionele outbox · pdfkit · nodemailer · zod.

## Installatie

Benodigd: Node 20+ en PostgreSQL 14+.

```bash
npm install
cp .env.example .env           # vul DATABASE_URL en APP_URL in
npm run db:migrate             # schema
npm run db:seed                # startconfiguratie, e-mailtemplates, medewerkers, routes, boxen
npm run dev                    # http://localhost:3000 (inloggen: link uit Beheer → Wachtrij of tabel email_log)
npm run worker                 # in een tweede terminal: PDF's, e-mail, facturen, betalingen, dagtaken
```

## Inloggen: alleen via e-mail

Er bestaan geen wachtwoorden. Iedereen (klant en medewerker) logt in met een persoonlijke link die per e-mail wordt verstuurd:

- De link werkt één keer en is kort geldig. Zelf aangevraagd: 30 minuten. In voorstel- en uitnodigingsmails: 72 uur. Beide instelbaar onder Beheer → Instellingen → Contractafspraken.
- De link opent eerst een bevestigingsscherm, zodat virusscanners in mailprogramma's hem niet "opgebruiken".
- Aanvragen worden afgeremd: 5 per e-mailadres per kwartier en 30 per IP-adres per uur.
- De melding na een aanvraag is altijd gelijk, zodat niet af te leiden is welke adressen bestaan.
- Een klant wordt pas aan bedrijfsgegevens gekoppeld nadat de link in de mail is gebruikt.
- De eerste beheerder maak je op de server met `npm run admin -- naam@bereyl.com "Naam"`. Daarna nodig je collega's uit via Beheer → Gebruikers.

Zonder mailserver kan niemand inloggen. In productie weigert de app daarom te starten zonder werkende SMTP-koppeling (`npm run check:prod`). Lokaal (`DEMO_MODE=true`) staan de inlogmails in Beheer → Wachtrij en in de tabel `email_log`. De demo-seed maakt testmedewerkers `admin@`, `planner@` en `chauffeur@bereyl.test` aan, plus `demo-klant@voorbeeld.test`.

## Live zetten

Benodigd: een server met Docker (bijv. een VPS in de EU met 2 vCPU en 4 GB), een (sub)domein zoals `mijn.bereyl.com` en een SMTP-dienst voor e-mail.

```bash
git clone <repo> && cd Printeuropa
cp .env.production.example .env.production   # domein, e-mail en databasewachtwoord invullen
docker compose --env-file .env.production up -d --build
docker compose exec app npm run admin -- naam@bereyl.com "Naam"
```

- Zet een DNS A-record van het domein naar de server. Caddy regelt het HTTPS-certificaat automatisch.
- Stel bij de e-maildienst SPF en DKIM in voor het afzenderdomein, anders belanden inlogmails in de spam.
- De `backup`-service maakt dagelijks een databasedump en een archief van de bestanden, en bewaart die 30 dagen in het volume `backups`. Kopieer ze ook naar een andere locatie.
- Updaten: `git pull && docker compose --env-file .env.production up -d --build`. Migraties draaien automatisch.

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

`e2e/journey.mjs` voert 69 controles uit en loopt de opleverroutes uit hoofdstuk 18 door, inclusief inloggen via e-mail. Alle 69 controles slaagden.

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
- Huisstijl: logo en lettertypen (Newsreader, Red Hat Display) komen van bereyl.com. Het boxbeeld is nog een tijdelijke illustratie in `public/boxes`. Vervang het in **Beheer → Instellingen → Boxen en tarieven** door de echte Bereyl-afbeeldingen. Logo en kleuren voor de PDF stel je in onder PDF's.

## Bekende beperkingen

- Een koppeling met de PrintMasters-leverplanning en een boekhoudkoppeling zijn voorbereid, maar niet gebouwd.
- De Mollie-flow (mandaat via eerste betaling, recurring incasso, webhook) is volgens de API geïmplementeerd, maar niet live getest.
- De beschikbaarheidskalender staat standaard uit, totdat Bereyl de beschikbaarheid daadwerkelijk bijhoudt.
