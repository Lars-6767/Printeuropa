/**
 * Volledige klantreis via de echte schermen (Playwright). Vereist een draaiende app (npm start) en worker (npm run worker).
 * Gebruik: node e2e/journey.mjs   (zet vooraf een schone database: npm run db:reset)
 */
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { BASE, q, one, check, drain, mailTo, linkFrom, weekdays, login, logout, log, summary, db, sleep } from "./lib.mjs";

const SHOTS = process.env.E2E_SHOTS ?? null;
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };
const stamp = Date.now().toString().slice(-6);
const CUSTOMER = `inkoop+${stamp}@bouwbedrijf-test.nl`;
const PM_CUSTOMER = `facilitair+${stamp}@pm-klant-test.nl`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.setDefaultTimeout(15000);

async function quiz(p, o) {
  await p.goto(`${BASE}/prijzen?box=${o.priceBox}`);
  await p.getByRole("link", { name: `Kies ${o.priceBox === 1000 ? "1.000" : o.priceBox} liter` }).click();
  await p.waitForURL(/keuzehulp/);
  await p.evaluate(() => sessionStorage.clear());
  await p.reload();
  await p.getByText(o.pm, { exact: true }).click();
  if (o.pmPieces) await p.getByLabel(/kledingstukken nemen jullie per jaar/).fill(String(o.pmPieces));
  await p.getByRole("button", { name: "Volgende" }).click();
  await p.getByText("In kilo's", { exact: true }).click();
  await p.getByLabel("Kilo per maand").fill(String(o.kgPerMonth));
  await p.getByRole("button", { name: "Volgende" }).click();
  await p.getByText(/^Met ongeveer/).waitFor();
  const adviceText = await p.getByText(/^Met ongeveer/).textContent();
  await p.getByText(`${o.box === 1000 ? "1.000" : o.box} liter`, { exact: true }).click();
  await p.getByRole("button", { name: "Naar pakket en prijs" }).click();
  await p.getByText(o.pkg, { exact: true }).click();
  if (o.freq) await p.getByText(`${o.freq}× per jaar`, { exact: true }).click();
  await p.getByLabel("Postcode van de plaatsingslocatie").fill(o.postcode);
  await p.getByText("per maand, exclusief").waitFor();
  await sleep(600);
  const price = await p.locator(".price-big").first().textContent();
  await p.getByRole("button", { name: "Ziet er goed uit, verder" }).click();
  await p.getByLabel("Bedrijfsnaam").fill(o.company);
  await p.getByLabel("Contactpersoon").fill(o.contact);
  await p.getByLabel("E-mailadres").fill(o.email);
  await p.getByLabel("Telefoonnummer voor afstemming").fill("0761234567");
  await p.getByRole("button", { name: "Volgende" }).click();
  await p.getByRole("textbox", { name: "Straat en huisnummer", exact: true }).fill(o.street);
  await p.getByRole("textbox", { name: "Plaats", exact: true }).fill(o.city);
  await p.getByLabel(/Locatie-instructies/).fill("Melden bij de receptie");
  await p.getByRole("button", { name: "Volgende" }).click();
  const days = weekdays(4, 2);
  await p.getByLabel("Voorkeursdag 1").fill(days[0]);
  await p.getByLabel("Dagdeel").first().selectOption("morning");
  await p.getByRole("button", { name: "+ Nog een voorkeursdag" }).click();
  await p.getByLabel("Voorkeursdag 2").fill(days[1]);
  await p.getByRole("button", { name: "Volgende" }).click();
  await p.getByRole("heading", { name: "Nog één stap dichter bij een duurzame toekomst" }).waitFor();
  return { adviceText, price, days };
}

try {
  // ---------- 1. Prijzen, keuzehulp, ander formaat, voorstel ----------
  await page.goto(`${BASE}/prijzen?box=abc`);
  check("Ongeldige websiteparameter box wordt gemeld", await page.getByText("Het boxformaat ‘abc’ bestaat niet").isVisible());
  await page.goto(`${BASE}/`);
  check("Homepage toont hoofdtitel en Inloggen op mobiel", (await page.getByRole("heading", { name: "Meld je aan bij Bereyl" }).isVisible()) && (await page.getByRole("link", { name: "Inloggen" }).first().isVisible()));
  await shot(page, "01-home");

  const r1 = await quiz(page, { priceBox: 250, pm: "Nee, alleen Bereyl", kgPerMonth: 30, box: 250, pkg: "Bereyl geregeld", freq: 4, postcode: "4811 AB", company: `Bouwbedrijf Test ${stamp}`, contact: "Sanne de Vries", email: CUSTOMER, street: "Stationsplein 1", city: "Breda" });
  check("Advies wordt getoond met reden", /Met ongeveer 30 kg per maand/.test(r1.adviceText ?? ""), r1.adviceText);
  check("Prijs zichtbaar vóór contactgegevens", Boolean(r1.price), r1.price);
  await shot(page, "02-samenvatting");
  // Dubbel klikken op verzenden mag geen tweede aanvraag opleveren
  await page.getByRole("button", { name: "Stuur mijn voorstel" }).evaluate((b) => { b.click(); b.click(); });
  await page.waitForURL(/verzonden/);
  const reqNr = new URL(page.url()).searchParams.get("nr");
  const reqs = await q(`SELECT r.*, p.offer FROM requests r JOIN proposals p ON p.request_id=r.id WHERE r.contact->>'email'=$1`, [CUSTOMER]);
  check("Eén aanvraag, klantdossier en voorstelversie", reqs.length === 1, reqNr);
  check("Afwijkend formaat (250 L) in voorstel", reqs[0].offer.boxSize === 250 && reqs[0].answers.advice.recommended !== 250, `advies ${reqs[0].answers.advice.recommended} L, gekozen 250 L`);
  check("Twee voorkeursdagen opgeslagen", reqs[0].answers.preferences.slots.length === 2);

  const mail = await mailTo(CUSTOMER, "proposal_ready");
  check("Voorstelmail met PDF-bijlage", Boolean(mail) && mail.attachments.length === 1 && mail.subject === "Jouw Bereyl-voorstel staat klaar", mail?.status);
  const pdf = await one(`SELECT f.* FROM proposals p JOIN files f ON f.id=p.pdf_file_id JOIN requests r ON r.id=p.request_id WHERE r.number=$1`, [reqNr]);
  check("Voorstel-PDF aangemaakt", Boolean(pdf) && pdf.size_bytes > 2000, pdf?.filename);

  // ---------- 2. Inloggen via persoonlijke link en akkoord ----------
  const link = linkFrom(mail.html);
  await page.goto(link);
  await page.getByRole("button", { name: "Doorgaan naar Mijn Bereyl" }).click();
  await page.waitForURL(/portaal\/voorstel/);
  await shot(page, "03-voorstel");
  const pdfResp = await page.request.get(`${BASE}/api/files/${pdf.id}`);
  check("Klant kan eigen voorstel-PDF openen", pdfResp.status() === 200 && pdfResp.headers()["content-type"] === "application/pdf");
  await page.getByLabel(/Ik ga akkoord met dit voorstel/).check();
  await page.getByRole("button", { name: "Akkoord en plaatsing aanvragen" }).evaluate((b) => { b.click(); b.click(); });
  await page.getByText("Bedankt voor je akkoord").waitFor();
  const a1 = await q(`SELECT a.* FROM acceptances a JOIN proposals p ON p.id=a.proposal_id JOIN requests r ON r.id=p.request_id WHERE r.number=$1`, [reqNr]);
  const placement = await q(`SELECT ap.* FROM appointments ap JOIN companies c ON c.id=ap.company_id WHERE c.name=$1 AND ap.type='placement'`, [`Bouwbedrijf Test ${stamp}`]);
  check("Akkoord vastgelegd met versie, voorwaarden en bedragen (één keer)", a1.length === 1 && a1[0].proposal_version === 1 && a1[0].terms_version && a1[0].amounts.monthlyCents > 0, JSON.stringify(a1[0]?.amounts));
  check("Precies één plaatsingsopdracht", placement.length === 1);
  const accMail = await mailTo(CUSTOMER, "acceptance_confirmation");
  check("Akkoordbevestiging met akkoordbewijs verstuurd", Boolean(accMail) && accMail.attachments.length === 1);
  const companyId = placement[0].company_id;
  const customerCookies = await ctx.cookies();

  // ---------- 3. Bereyl bevestigt en plaatst de box ----------
  const staff = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const sp = await staff.newPage();
  sp.setDefaultTimeout(15000);
  await login(sp, "planner@bereyl.test");
  await sp.goto(`${BASE}/beheer/planning`);
  const card = sp.locator("article").filter({ hasText: placement[0].number });
  await card.getByRole("button", { name: "Bevestigen" }).click();
  await sp.getByText(/Afspraak bevestigd/).waitFor();
  await shot(sp, "04-planning");
  await logout(sp);
  await login(sp, "chauffeur@bereyl.test");
  await sp.goto(`${BASE}/beheer/uitvoering/${placement[0].id}`);
  await sp.getByLabel("Geplaatste box").selectOption({ index: 1 });
  await sp.getByRole("button", { name: "Uitvoering vastleggen" }).click();
  await sp.waitForURL(/beheer\/uitvoering\?ok/);
  await page.goto(`${BASE}/portaal/boxen`);
  check("Klant ziet de geplaatste box in het portaal", await page.getByText("Geplaatst", { exact: true }).isVisible());
  await shot(page, "05-boxen");
  const sub = await one(`SELECT * FROM subscriptions WHERE company_id=$1`, [companyId]);
  check("Abonnement actief met tegoedperiode", sub.status === "active" && Boolean(await one(`SELECT 1 FROM credit_periods WHERE subscription_id=$1 AND included=4`, [sub.id])));
  await drain();
  check("Welkomstbericht na plaatsing", Boolean(await mailTo(CUSTOMER, "box_placed")));

  console.log("\n--- deel 1 klaar ---");
  globalThis.E2E = { companyId, subId: sub.id, page, staff, sp, ctx, browser, CUSTOMER, PM_CUSTOMER, stamp, quiz, shot };
  const { part2 } = await import("./journey-part2.mjs");
  await part2(globalThis.E2E);
} catch (e) {
  console.error(e);
  await page.screenshot({ path: "/tmp/e2e-fout.png", fullPage: true }).catch(() => {});
  check("Script zonder fouten doorlopen", false, e.message);
} finally {
  summary(process.env.E2E_RESULTS);
  await browser.close();
  await db.end();
}
