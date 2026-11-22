import fs from "node:fs";
import { BASE, q, one, check, drain, mailTo, linkFrom, weekdays, login, logout, log, sleep } from "./lib.mjs";

async function fillPrefs(p, days) {
  await p.getByLabel("Voorkeursdag 1").fill(days[0]);
  if (days[1]) {
    await p.getByRole("button", { name: "+ Nog een voorkeursdag" }).click();
    await p.getByLabel("Voorkeursdag 2").fill(days[1]);
  }
}
async function asStaff(sp, email) { await logout(sp); await login(sp, email); }
async function confirmIn(sp, number, opts = {}) {
  await sp.goto(`${BASE}/beheer/planning`);
  const card = sp.locator("article").filter({ hasText: number });
  if (opts.combination) await card.getByLabel("Combinatie met PrintMasters-levering").selectOption(opts.combination);
  const dateInput = card.getByLabel("Datum", { exact: true });
  if (!(await dateInput.inputValue())) await dateInput.fill(opts.date ?? weekdays(10, 1)[0]);
  await card.getByRole("button", { name: /Bevestigen|Planning wijzigen/ }).click();
  await sp.waitForURL(/planning\?ok=/);
}
async function execute(sp, id, o = {}) {
  await sp.goto(`${BASE}/beheer/uitvoering/${id}`);
  if (o.taken !== false && (await sp.getByLabel("Meegenomen box").count())) await sp.getByLabel("Meegenomen box").selectOption({ index: 1 });
  if (await sp.getByLabel(/Geplaatste box|Teruggeplaatste lege box/).count()) await sp.getByLabel(/Geplaatste box|Teruggeplaatste lege box/).selectOption({ index: 1 });
  if (o.photo) await sp.getByLabel(/Foto/).setInputFiles(o.photo);
  if (o.combinationDone === false) await sp.getByLabel("Uitgevoerd samen met de PrintMasters-levering").uncheck();
  // Dubbel vastleggen mag niets dubbel boeken
  await sp.getByRole("button", { name: "Uitvoering vastleggen" }).evaluate((b) => { b.click(); b.click(); });
  await sp.waitForURL(/uitvoering\?ok=/);
}
async function requestEmptying(page, days, combine = false) {
  await page.goto(`${BASE}/portaal/afspraken/nieuw`);
  if (combine) await page.getByText("Combineer met PrintMasters-levering", { exact: true }).click();
  await page.locator(".card-soft").first().waitFor();
  await sleep(400);
  const preview = await page.locator(".card-soft").first().textContent();
  await fillPrefs(page, days);
  await page.getByRole("button", { name: "Leging aanvragen" }).click();
  await page.waitForURL(/afspraken\?ok=/);
  return preview;
}

export async function part2(E) {
  const { page, sp, browser, CUSTOMER, PM_CUSTOMER, stamp, quiz, shot, companyId, subId } = E;
  const photo = "/tmp/claude-0/-home-user-Printeuropa/0e760245-79e9-539d-882f-234508a5f002/scratchpad/foto.png";
  fs.writeFileSync(photo, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));

  // ---------- 4. Inbegrepen leging met meerdere voorkeursdagen ----------
  const pv1 = await requestEmptying(page, weekdays(5, 2));
  check("Vóór aanvraag zichtbaar welk tegoed wordt gebruikt", /Inbegrepen: we gebruiken 1 van jullie 4/.test(pv1), pv1.trim().slice(0, 90));
  const e1 = await one(`SELECT * FROM appointments WHERE company_id=$1 AND type='emptying' ORDER BY id DESC LIMIT 1`, [companyId]);
  check("Aanvraag met meerdere voorkeursdagen", e1.preferences.length === 2 && e1.funding === "included");
  await asStaff(sp, "planner@bereyl.test");
  await confirmIn(sp, e1.number);
  const c1 = await one(`SELECT COALESCE(SUM(delta_available),0)::int AS a, COALESCE(SUM(delta_reserved),0)::int AS r FROM credit_mutations m JOIN credit_periods p ON p.id=m.period_id WHERE p.subscription_id=$1`, [subId]);
  check("Bevestiging reserveert één inbegrepen leging", c1.a === 3 && c1.r === 1, `beschikbaar ${c1.a}, ingepland ${c1.r}`);
  await page.goto(`${BASE}/portaal`);
  check("Portaal toont tegoed en ingepland apart", await page.getByText("1 ingepland").first().isVisible());
  await asStaff(sp, "chauffeur@bereyl.test");
  await execute(sp, e1.id, { photo });
  const e1b = await one(`SELECT * FROM appointments WHERE id=$1`, [e1.id]);
  const c1b = await one(`SELECT COALESCE(SUM(delta_available),0)::int AS a, COALESCE(SUM(delta_reserved),0)::int AS r, COUNT(*) FILTER (WHERE kind='consume')::int AS used FROM credit_mutations m JOIN credit_periods p ON p.id=m.period_id WHERE p.subscription_id=$1`, [subId]);
  const inv1 = await one(`SELECT COUNT(*)::int AS n FROM invoices WHERE appointment_id=$1`, [e1.id]);
  check("Uitvoering verbruikt het inbegrepen moment (geen factuur)", e1b.financial_status === "included" && c1b.used === 1 && c1b.r === 0 && inv1.n === 0, `beschikbaar ${c1b.a}`);
  check("Dubbel vastleggen gaf één inzameling", (await one(`SELECT COUNT(*)::int AS n FROM collections WHERE appointment_id=$1`, [e1.id])).n === 1);
  check("Status 'Opgehaald, weging volgt'", e1b.execution_status === "executed" && e1b.weighing_status === "pending");

  // ---------- 5. Extra betaalde rit ----------
  await asStaff(sp, "admin@bereyl.test");
  await sp.goto(`${BASE}/beheer/klanten/${companyId}`);
  await sp.getByText(/^Tegoedperiode/).click();
  await sp.getByLabel("Correctie (+/−)").fill("-3");
  await sp.getByLabel("Reden").first().fill("Test: tegoed opgebruikt voor extra rit");
  await sp.getByRole("button", { name: "Corrigeren" }).click();
  await sp.getByText("Tegoed gecorrigeerd").waitFor();
  check("Tegoedcorrectie met reden gelogd", Boolean(await one(`SELECT 1 FROM credit_mutations WHERE kind='correction' AND reason LIKE 'Test:%' AND actor_user_id IS NOT NULL`)));
  const pv2 = await requestEmptying(page, weekdays(6, 1));
  check("Prijs van extra leging vóór aanvraag getoond", /€ 80,70/.test(pv2), pv2.trim().slice(0, 80));
  const e2 = await one(`SELECT * FROM appointments WHERE company_id=$1 AND type='emptying' ORDER BY id DESC LIMIT 1`, [companyId]);
  await asStaff(sp, "planner@bereyl.test");
  await confirmIn(sp, e2.number);
  await asStaff(sp, "chauffeur@bereyl.test");
  await execute(sp, e2.id);
  await drain();
  const inv2 = await q(`SELECT * FROM invoices WHERE appointment_id=$1`, [e2.id]);
  check("Extra rit gefactureerd volgens afspraak (€ 80,70 + btw)", inv2.length === 1 && inv2[0].subtotal_cents === 8070 && inv2[0].total_cents === 9765 && inv2[0].number, inv2[0]?.number);
  // Herhaalde afhandeling mag geen tweede factuur opleveren
  await sp.goto(`${BASE}/beheer/uitvoering/${e2.id}`);
  check("Herhaald openen toont 'al vastgelegd'", await sp.getByText("Deze afspraak is al vastgelegd").isVisible());
  await asStaff(sp, "admin@bereyl.test");
  await sp.goto(`${BASE}/beheer/facturen`);
  await sp.getByRole("button", { name: "Maandfacturatie nu uitvoeren" }).click();
  await sleep(800);
  check("Herhaalde actie: nog steeds één factuur voor de rit", (await one(`SELECT COUNT(*)::int AS n FROM invoices WHERE appointment_id=$1`, [e2.id])).n === 1);
  const invMail = await mailTo((await one(`SELECT invoice_email FROM companies WHERE id=$1`, [companyId])).invoice_email, "invoice_created");
  check("Factuur verstuurd naar factuurmailadres met PDF", Boolean(invMail) && invMail.attachments.length === 1);
  check("Incasso zonder mandaat geeft zichtbare taak", Boolean(await one(`SELECT 1 FROM tasks WHERE type='mandate_missing' AND ref_id=$1 AND status='open'`, [inv2[0].id])));
  // Mandaat (demo-provider) en incasso, inclusief dubbel provider-bericht
  await page.goto(`${BASE}/portaal/facturen`);
  await page.getByRole("button", { name: "Incasso machtigen" }).click();
  await page.getByText(/Facturen worden automatisch geïncasseerd/).waitFor();
  check("Incassotoestemming vastgelegd via (demo-)betaalprovider", Boolean(await one(`SELECT 1 FROM mandates WHERE company_id=$1 AND status='valid'`, [companyId])));
  await sp.goto(`${BASE}/beheer/facturen`);
  const row = sp.locator("tr").filter({ hasText: inv2[0].number });
  await row.getByRole("button", { name: "Incasso opnieuw" }).click();
  for (let i = 0; i < 40 && !(await one(`SELECT 1 FROM payments WHERE invoice_id=$1`, [inv2[0].id])); i++) await sleep(250);
  await sp.goto(`${BASE}/beheer/facturen`);
  await sp.locator("tr").filter({ hasText: inv2[0].number }).getByRole("button", { name: "Demo: betaald" }).click();
  await sleep(800);
  await sp.goto(`${BASE}/beheer/facturen`);
  await sp.locator("tr").filter({ hasText: inv2[0].number }).getByRole("button", { name: "Demo: herhaal bericht" }).click();
  await sp.getByText("Dubbel bericht herkend").waitFor();
  const pays = await q(`SELECT * FROM payments WHERE invoice_id=$1`, [inv2[0].id]);
  check("Dubbel betaalbericht: één betaling, factuur betaald", pays.length === 1 && pays[0].status === "paid" && (await one(`SELECT status FROM invoices WHERE id=$1`, [inv2[0].id])).status === "paid");

  // ---------- 6. Gratis PrintMasters-combinatie (tweede klant) ----------
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p2 = await ctx2.newPage(); p2.setDefaultTimeout(15000);
  await quiz(p2, { priceBox: 500, pm: "Ja, we zijn klant", pmPieces: 60, kgPerMonth: 60, box: 500, pkg: "Met PrintMasters", postcode: "5038 AB", company: `Zorggroep Test ${stamp}`, contact: "Ahmed Yilmaz", email: PM_CUSTOMER, street: "Spoorlaan 10", city: "Tilburg" });
  await p2.getByRole("button", { name: "Stuur mijn voorstel" }).click();
  await p2.waitForURL(/verzonden/);
  const m2 = await mailTo(PM_CUSTOMER, "proposal_ready");
  await p2.goto(linkFrom(m2.html));
  await p2.getByRole("button", { name: "Doorgaan naar Mijn Bereyl" }).click();
  await p2.waitForURL(/portaal\/voorstel/);
  check("Voorlopig PrintMasters-voordeel blokkeert akkoord tot controle", await p2.getByText(/Bereyl controleert eerst jullie PrintMasters-afspraak/).waitFor({ timeout: 8000 }).then(() => true, () => false));
  const co2 = (await one(`SELECT id FROM companies WHERE name=$1`, [`Zorggroep Test ${stamp}`])).id;
  check("CRM-taak voor PrintMasters-verificatie", Boolean(await one(`SELECT 1 FROM tasks WHERE type='printmasters_verify' AND company_id=$1`, [co2])));
  await sp.goto(`${BASE}/beheer/klanten/${co2}`);
  await sp.getByLabel("Status na controle").selectOption("verified");
  await sp.getByRole("button", { name: "Status opslaan" }).click();
  await sp.getByText("PrintMasters-status bijgewerkt").waitFor();
  const v2 = await one(`SELECT * FROM proposals WHERE company_id=$1 AND status='open'`, [co2]);
  check("Na verificatie nieuw definitief voorstel (box inbegrepen)", v2.version === 2 && !v2.provisional && v2.offer.boxMonthlyCents === 0, `v${v2.version}`);
  await p2.goto(`${BASE}/portaal/voorstel/${v2.id}`);
  await p2.getByLabel(/Ik ga akkoord met dit voorstel/).check();
  await p2.getByRole("button", { name: "Akkoord en plaatsing aanvragen" }).click();
  await p2.getByText("Bedankt voor je akkoord").waitFor();
  const pl2 = await one(`SELECT * FROM appointments WHERE company_id=$1 AND type='placement'`, [co2]);
  await asStaff(sp, "planner@bereyl.test"); await confirmIn(sp, pl2.number);
  await asStaff(sp, "chauffeur@bereyl.test"); await execute(sp, pl2.id);
  const pv3 = await requestEmptying(p2, weekdays(7, 1), true);
  check("Combinatie toont 'Gratis' vóór aanvraag", /Gratis: gecombineerd met een PrintMasters-levering/.test(pv3));
  await p2.goto(`${BASE}/portaal/afspraken`);
  check("Klant ziet 'Combinatie aangevraagd'", await p2.getByText(/Combinatie aangevraagd/).first().isVisible());
  const e3 = await one(`SELECT * FROM appointments WHERE company_id=$1 AND type='emptying'`, [co2]);
  await asStaff(sp, "planner@bereyl.test"); await confirmIn(sp, e3.number, { combination: "confirmed" });
  await asStaff(sp, "chauffeur@bereyl.test"); await execute(sp, e3.id);
  const e3b = await one(`SELECT * FROM appointments WHERE id=$1`, [e3.id]);
  const e3m = await one(`SELECT COUNT(*)::int AS n FROM credit_mutations WHERE appointment_id=$1`, [e3.id]);
  check("Gratis combinatie: geen factuur en geen tegoedverbruik", e3b.financial_status === "free_combination" && e3m.n === 0 && (await one(`SELECT COUNT(*)::int AS n FROM invoices WHERE appointment_id=$1`, [e3.id])).n === 0);

  // ---------- 7. Fysieke boxwissel via abonnement wijzigen ----------
  await page.goto(`${BASE}/portaal/abonnement/wijzigen?sub=${subId}`);
  await page.getByText("500 liter", { exact: true }).click();
  await page.getByText(/Omruilen/).first().waitFor();
  const changeText = await page.locator("section.card").first().textContent();
  check("Wijziging toont huidige en nieuwe prijs, ingang, tegoed en omruilkosten", /Nu.*€ 30,10/.test(changeText) && /Ingangsdatum/.test(changeText) && /Tegoed/.test(changeText) && /Omruilkosten: nog vast te stellen/.test(changeText));
  await page.getByText("Het maakt ons niet uit, plan ons in overleg in", { exact: true }).click();
  await page.getByLabel(/Ik ga akkoord met de nieuwe prijs/).check();
  await page.getByRole("button", { name: "Wijziging bevestigen" }).click();
  await page.waitForURL(/abonnement\?ok=/);
  const swap = await one(`SELECT * FROM appointments WHERE company_id=$1 AND type='swap'`, [companyId]);
  const sched = await one(`SELECT * FROM subscription_versions WHERE subscription_id=$1 AND status='scheduled'`, [subId]);
  check("Omruilopdracht en geplande abonnementsversie", Boolean(swap) && Boolean(sched) && sched.box_size === 500);
  check("Wijzigingsmail met oude en nieuwe prijs", /€ 30,10/.test((await mailTo(CUSTOMER, "subscription_changed"))?.html ?? ""));
  await asStaff(sp, "planner@bereyl.test"); await confirmIn(sp, swap.number);
  await asStaff(sp, "chauffeur@bereyl.test"); await execute(sp, swap.id);
  const boxes = await q(`SELECT size FROM boxes WHERE location_id=(SELECT location_id FROM subscriptions WHERE id=$1) AND status='placed'`, [subId]);
  check("Na boxwissel staat er een 500 liter-box", boxes.length === 1 && boxes[0].size === 500);
  check("Omruilen zonder vastgesteld tarief geeft taak i.p.v. gratis", Boolean(await one(`SELECT 1 FROM tasks WHERE type='finance_check' AND ref_id=$1`, [swap.id])));

  // ---------- 8. Wegingen, correctie en impacttotalen ----------
  const homeBefore = await (await fetch(`${BASE}/`)).text();
  await asStaff(sp, "planner@bereyl.test");
  const cols = await q(`SELECT c.id, a.number, a.id AS aid FROM collections c JOIN appointments a ON a.id=c.appointment_id WHERE c.status='picked_up' ORDER BY c.id`);
  const kgById = { [e1.id]: 42.5, [e2.id]: 38, [swap.id]: 20, [e3.id]: 55 };
  const kgs = cols.map((c) => kgById[c.aid] ?? 10);
  for (let i = 0; i < cols.length; i++) {
    await sp.goto(`${BASE}/beheer/wegingen`);
    const card = sp.locator(".card").filter({ hasText: cols[i].number });
    await card.getByLabel("Nettogewicht (kg)").fill(String(kgs[i] ?? 10).replace(".", ","));
    await card.getByRole("button", { name: "Gewicht bevestigen" }).click();
    await sp.waitForURL(/wegingen\?ok=/);
  }
  const e1after = await one(`SELECT execution_status, weighing_status FROM appointments WHERE id=$1`, [e1.id]);
  check("Latere weging zet de rit niet terug naar openstaand", e1after.execution_status === "executed" && e1after.weighing_status === "confirmed");
  const pub1 = await one(`SELECT SUM(net_weight_grams)::int AS g FROM confirmed_weights`);
  await page.goto(`${BASE}/portaal/impact`);
  check("Persoonlijke impact toont 100,5 kg", await page.getByText("100,5 kg").first().isVisible());
  await shot(page, "06-impact");
  await asStaff(sp, "admin@bereyl.test");
  await sp.goto(`${BASE}/beheer/wegingen`);
  const row1 = sp.locator("tr").filter({ hasText: e1.number });
  await row1.getByText("Correctie").click();
  await row1.getByLabel("Nieuw gewicht (kg)").fill("40");
  await row1.getByLabel("Reden").fill("Tarra van de box niet afgetrokken");
  await row1.getByRole("button", { name: "Vastleggen" }).click();
  await sp.getByText("Correctie vastgelegd").waitFor();
  const pub2 = await one(`SELECT SUM(net_weight_grams)::int AS g FROM confirmed_weights`);
  await page.goto(`${BASE}/portaal/impact`);
  const homeAfter = await (await fetch(`${BASE}/`)).text();
  const kg = (h) => Number((h.match(/class="impact-number"[^>]*>([\d.]+)</) ?? [])[1]?.replace(/\./g, ""));
  check("Correctie werkt door in persoonlijke en publieke totalen", pub2.g === pub1.g - 2500 && (await page.getByText("98 kg").first().isVisible()) && kg(homeAfter) === Math.round(pub2.g / 1000), `publiek ${kg(homeBefore)} → ${kg(homeAfter)} kg`);

  // ---------- 9. Certificaat voor meerdere klanten en toegangsgrenzen ----------
  await sp.goto(`${BASE}/beheer/partijen`);
  await sp.getByLabel("Verwerkingspartij").fill("Vezelfabriek Test BV");
  await sp.getByRole("button", { name: "Nieuwe partij" }).click();
  await sp.waitForURL(/partijen\/\d+/);
  for (const lbl of await sp.locator("label").filter({ has: sp.locator("input[name=collectionIds]") }).all()) {
    if (!(await lbl.textContent()).includes("DEMO")) await lbl.locator("input").check();
  }
  await sp.getByRole("button", { name: "Koppel aan partij" }).click();
  await sp.getByText(/inzameling\(en\) gekoppeld/).waitFor();
  await sp.getByLabel("Werkelijke bestemming").selectOption("fiber");
  await sp.getByLabel("Verwerking bevestigd door de verwerker").check();
  await sp.getByRole("button", { name: "Opslaan" }).first().click();
  await sp.getByText("Partij bijgewerkt").waitFor();
  const samplePdf = (await one(`SELECT path FROM files WHERE kind='proposal_pdf' LIMIT 1`)).path;
  await sp.getByLabel("PDF").setInputFiles(`${process.env.STORAGE_DIR ?? "./storage"}/${samplePdf}`);
  await sp.getByRole("button", { name: "Uploaden" }).click();
  await sp.getByText("Certificaat geüpload").waitFor();
  await sp.getByLabel("Ik heb het document en de gekoppelde klanten gecontroleerd").check();
  await sp.getByRole("button", { name: "Vrijgeven aan geselecteerde klanten" }).click();
  await sp.getByText(/Certificaat vrijgegeven aan 2 klant/).waitFor();
  await drain();
  const cert = await one(`SELECT * FROM certificates ORDER BY id DESC LIMIT 1`);
  const rel = await q(`SELECT * FROM certificate_releases WHERE certificate_id=$1`, [cert.id]);
  check("Eén certificaat vrijgegeven aan twee klanten met klantverklaring", rel.length === 2 && rel.every((r) => r.statement_file_id));
  const own = await page.request.get(`${BASE}/api/files/${cert.file_id}`);
  const st1 = rel.find((r) => r.company_id === companyId).statement_file_id;
  const st2 = rel.find((r) => r.company_id === co2).statement_file_id;
  const other = await page.request.get(`${BASE}/api/files/${st2}`);
  const pdf2 = (await one(`SELECT pdf_file_id FROM proposals WHERE company_id=$1 AND pdf_file_id IS NOT NULL LIMIT 1`, [co2])).pdf_file_id;
  const other2 = await page.request.get(`${BASE}/api/files/${pdf2}`);
  check("Klant ziet gedeeld certificaat en eigen verklaring", own.status() === 200 && (await page.request.get(`${BASE}/api/files/${st1}`)).status() === 200);
  check("Klant ziet géén verklaring of voorstel van een andere klant", other.status() === 404 && other2.status() === 404);
  const demoCtx = await browser.newContext(); const dp = await demoCtx.newPage();
  await login(dp, "demo-klant@voorbeeld.test");
  check("Niet-geselecteerde klant heeft geen toegang tot het certificaat", (await dp.request.get(`${BASE}/api/files/${cert.file_id}`)).status() === 404);
  const anon = await fetch(`${BASE}/api/files/${cert.file_id}`);
  check("Zonder inloggen geen toegang tot documenten", anon.status === 401);
  await demoCtx.close();
  await page.goto(`${BASE}/portaal/impact`);
  check("Bevestigde verwerking (vervezeling) zichtbaar bij klant", await page.getByText("Vervezeling").first().isVisible());

  // ---------- 10. Stoppen als klant ----------
  await page.goto(`${BASE}/portaal/abonnement/stoppen?sub=${subId}`);
  await shot(page, "07-stoppen");
  check("Stoppen toont einddatum, eindkosten en einde incasso", (await page.getByText("Einddatum", { exact: true }).first().isVisible()) && (await page.getByText(/Ophaalkosten/).isVisible()) && (await page.getByText(/Abonnementsfacturatie en incasso stoppen/).isVisible()));
  await fillPrefs(page, weekdays(5, 2));
  await page.getByLabel(/Ik wil het abonnement stoppen/).check();
  await page.getByRole("button", { name: "Abonnement stoppen en box laten ophalen" }).click();
  await page.waitForURL(/abonnement\?ok=/);
  const subEnd = await one(`SELECT * FROM subscriptions WHERE id=$1`, [subId]);
  const fp = await one(`SELECT * FROM appointments WHERE subscription_id=$1 AND type='final_pickup'`, [subId]);
  const cancelledSched = await one(`SELECT COUNT(*)::int AS n FROM subscription_versions WHERE subscription_id=$1 AND status='scheduled'`, [subId]);
  check("Opzegging: einddatum, stop facturatie, ophaalopdracht, geplande wijziging vervalt", subEnd.status === "ending" && subEnd.end_date && subEnd.billing_stops_at && Boolean(fp) && fp.preferences.length === 2 && cancelledSched.n === 0);
  check("Opzegbevestiging verstuurd", Boolean(await mailTo(CUSTOMER, "subscription_cancelled")));
  await page.goto(`${BASE}/portaal/documenten`);
  check("Historie en documenten blijven toegankelijk na opzeggen", await page.getByText("Certificaten en verklaringen").isVisible());

  // ---------- 11. Beheer: kilometerprijs en e-mailtemplate ----------
  await asStaff(sp, "admin@bereyl.test");
  await sp.goto(`${BASE}/beheer/instellingen/transport`);
  await sp.getByLabel("Kilometertarief").fill("4,50");
  await sp.getByLabel("Toelichting bij deze wijziging").fill("Nieuw kilometertarief");
  await sp.getByRole("button", { name: "Opslaan als concept" }).click();
  await sp.getByText(/Concept opgeslagen/).waitFor();
  await sp.reload();
  check("Voorbeeldberekening toont effect op drie formaten", await sp.getByText("Voorbeeldberekening: gepubliceerd → concept").isVisible());
  await shot(sp, "08-instellingen");
  await sp.getByRole("button", { name: "Publiceer concept" }).click();
  await sp.getByText(/Versie 2 is gepubliceerd/).waitFor();
  await sp.goto(`${BASE}/beheer/emails/proposal_ready`);
  await sp.getByLabel("Onderwerp").fill("Jouw Bereyl-voorstel staat klaar, {{voornaam}}");
  await sp.getByRole("button", { name: "Opslaan als concept" }).click();
  await sp.getByText("Concept opgeslagen.").waitFor();
  await sp.getByLabel("Testmail sturen naar").fill("test@bereyl.test");
  await sp.getByRole("button", { name: "Verstuur test" }).click();
  await sp.getByText(/Testmail vastgelegd|Testmail verstuurd/).waitFor();
  check("Testmail vastgelegd", Boolean(await one(`SELECT 1 FROM email_log WHERE to_address='test@bereyl.test' AND status='test'`)));
  await sp.reload();
  await shot(sp, "09-email-editor");
  await sp.getByRole("button", { name: /Publiceer v2/ }).click();
  await sp.getByText(/Versie 2 gepubliceerd/).waitFor();
  const NEW = `nieuw+${stamp}@klant-test.nl`;
  const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 } }); const p3 = await ctx3.newPage(); p3.setDefaultTimeout(15000);
  await quiz(p3, { priceBox: 500, pm: "Nee, alleen Bereyl", kgPerMonth: 40, box: 500, pkg: "Bereyl op aanvraag", postcode: "4811 AB", company: `Nieuwe Klant ${stamp}`, contact: "Lisa Jansen", email: NEW, street: "Markt 2", city: "Breda" });
  await p3.getByRole("button", { name: "Stuur mijn voorstel" }).click();
  await p3.waitForURL(/verzonden/);
  const newProp = await one(`SELECT p.offer FROM proposals p JOIN companies c ON c.id=p.company_id WHERE c.name=$1`, [`Nieuwe Klant ${stamp}`]);
  check("Nieuw voorstel gebruikt nieuw kilometertarief (3 km × € 4,50)", newProp.offer.centsPerKm === 450 && newProp.offer.transportPerTripCents === 1350, `vervoer ${newProp.offer.transportPerTripCents}`);
  const oldTerms = await one(`SELECT terms FROM subscription_versions WHERE subscription_id=$1 AND version=1`, [subId]);
  check("Eerder geaccepteerd voorstel behoudt vastgelegde prijs", oldTerms.terms.centsPerKm === 390 && oldTerms.terms.monthlyCents === 3010);
  const nm = await mailTo(NEW, "proposal_ready");
  check("Nieuwe templateversie gebruikt bij verzending", nm.template_version === 2 && nm.subject === "Jouw Bereyl-voorstel staat klaar, Lisa", nm.subject);

  // ---------- 12. Inloggen alleen via e-mail ----------
  const anonCtx = await browser.newContext(); const ap = await anonCtx.newPage();
  await ap.goto(`${BASE}/inloggen`);
  check("Inlogpagina heeft geen wachtwoordveld", (await ap.locator("input[type=password]").count()) === 0);
  const used = (await q(`SELECT html FROM email_log WHERE template_key='auth_login_link' ORDER BY id LIMIT 1`))[0];
  await ap.goto(linkFrom(used.html));
  check("Een gebruikte inloglink werkt niet opnieuw", /inloggen\?verlopen=1/.test(ap.url()));
  for (let i = 0; i < 6; i++) {
    await ap.goto(`${BASE}/inloggen`);
    await ap.getByLabel("E-mailadres").fill("onbekend@voorbeeld.nl");
    await ap.getByRole("button", { name: "Stuur mij een inloglink" }).click();
    await sleep(400);
  }
  check("Te veel linkaanvragen worden afgeremd", await ap.getByText(/net al een paar links aangevraagd/).isVisible());
  check("Onbekend adres krijgt geen mail (en geen verraderlijke melding)", !(await one(`SELECT 1 FROM email_log WHERE to_address='onbekend@voorbeeld.nl'`)));
  await anonCtx.close();

  // ---------- 13. Rechten ----------
  await asStaff(sp, "chauffeur@bereyl.test");
  await sp.goto(`${BASE}/beheer/instellingen`);
  check("Uitvoerend medewerker heeft geen toegang tot instellingen", /geen-toegang/.test(sp.url()));
  await sp.goto(`${BASE}/beheer/klanten/${companyId}`);
  check("Uitvoerend medewerker heeft geen toegang tot klantdossier", /geen-toegang/.test(sp.url()));
  await p2.goto(`${BASE}/portaal/voorstel/${(await one(`SELECT id FROM proposals WHERE company_id=$1 LIMIT 1`, [companyId])).id}`);
  check("Klant kan voorstel van ander bedrijf niet openen", (await p2.getByText(/404|niet gevonden|could not be found/i).count()) > 0);
  const jobsFailed = await one(`SELECT COUNT(*)::int AS n FROM jobs WHERE status='failed'`);
  check("Geen mislukte automatiseringen", jobsFailed.n === 0, `${jobsFailed.n} mislukt`);
  await ctx2.close(); await ctx3.close();
}
