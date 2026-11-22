/**
 * Startgegevens: gepubliceerde configuratie (versie 1), e-mailtemplates, medewerkers, routes en fysieke boxen.
 * Met DEMO_MODE=true of --demo komt er ook een herkenbaar demobedrijf bij.
 */
import "./load-env";
import { pool, q, one } from "../src/lib/db";
import { DEFAULTS, type ConfigKey } from "../src/lib/config";
import { TEMPLATE_DEFAULTS } from "../src/lib/email-defaults";

async function main() {
  const db = pool();
  for (const key of Object.keys(DEFAULTS) as ConfigKey[]) {
    await q(`INSERT INTO config_versions(key, version, status, data, note, published_at) VALUES ($1,1,'published',$2,'Startgegevens tarievenpagina 21-11-2026', now()) ON CONFLICT (key, version) DO NOTHING`, [key, JSON.stringify(DEFAULTS[key])], db);
  }
  for (const t of TEMPLATE_DEFAULTS) {
    await q(`INSERT INTO email_templates(key, audience, name, version, status, subject, blocks, attachments, published_at) VALUES ($1,$2,$3,1,'published',$4,$5,$6, now()) ON CONFLICT (key, version) DO NOTHING`,
      [t.key, t.audience, t.name, t.subject, JSON.stringify(t.blocks), JSON.stringify(t.attachments ?? [])], db);
  }
  const demo = process.env.DEMO_MODE === "true" || process.argv.includes("--demo");
  // Testmedewerkers alleen in demo-modus. De eerste echte beheerder maak je met: npm run admin -- jouw@email.nl "Naam"
  const staff: [string, string, string][] = demo ? [
    ["admin@bereyl.test", "Beheerder Bereyl", "admin"],
    ["planner@bereyl.test", "Planner Bereyl", "planner"],
    ["chauffeur@bereyl.test", "Chauffeur Bereyl", "field"],
  ] : [];
  for (const [email, name, role] of staff) {
    await q(`INSERT INTO users(email, name, staff_role, email_verified_at) VALUES ($1,$2,$3, now()) ON CONFLICT (email) DO NOTHING`, [email, name, role], db);
  }
  const driver = await one<{ id: number }>(`SELECT id FROM users WHERE email='chauffeur@bereyl.test'`, [], db);
  const routes = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM staff_routes`, [], db);
  if (!routes!.n) {
    await q(`INSERT INTO staff_routes(name, employee_user_id, capacity_per_day) VALUES ('Route West (Breda e.o.)', $1, 8), ('Route Oost (Eindhoven e.o.)', NULL, 8)`, [driver?.id ?? null], db);
  }
  const boxes = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM boxes`, [], db);
  if (!boxes!.n) {
    let i = 1;
    for (const size of [250, 500, 1000]) for (let k = 0; k < 8; k++) {
      await q(`INSERT INTO boxes(number, size, status) VALUES ($1,$2,'in_stock')`, [`BX-${String(i++).padStart(4, "0")}`, size], db);
    }
    await q(`INSERT INTO counters(name, value) VALUES ('box', $1) ON CONFLICT (name) DO UPDATE SET value=EXCLUDED.value`, [i - 1], db);
  }
  if (demo) await seedDemo();
  console.log(`[seed] klaar${demo ? ` (met demogegevens; testmedewerkers ${staff.map((s) => s[0]).join(", ")})` : ""}. Inloggen gaat via een e-maillink; maak een beheerder met: npm run admin -- e-mail "Naam"`);
  await db.end();
}

/** Een duidelijk herkenbaar demobedrijf met historie (is_demo = true; telt niet mee buiten demo-modus). */
async function seedDemo() {
  const db = pool();
  const exists = await one(`SELECT 1 FROM companies WHERE is_demo`, [], db);
  if (exists) return;
  const c = await one<{ id: number }>(`INSERT INTO companies(name, invoice_email, invoice_street, invoice_postcode, invoice_city, printmasters_status, is_demo, public_slug)
    VALUES ('DEMO – Installatiebedrijf Voorbeeld', 'demo-facturen@voorbeeld.test', 'Voorbeeldstraat 1', '4811 AA', 'Breda', 'verified', true, 'demo-voorbeeld') RETURNING id`, [], db);
  const l = await one<{ id: number }>(`INSERT INTO locations(company_id, name, street, postcode, city, distance_km, distance_source) VALUES ($1,'Hoofdvestiging','Voorbeeldstraat 1','4811 AA','Breda',4,'demo') RETURNING id`, [c!.id], db);
  const u = await one<{ id: number }>(`INSERT INTO users(email, name, email_verified_at) VALUES ('demo-klant@voorbeeld.test','Demo Klant', now()) ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name RETURNING id`, [], db);
  await q(`INSERT INTO memberships(user_id, company_id, role, status, confirmed_at) VALUES ($1,$2,'customer_admin','active', now()) ON CONFLICT DO NOTHING`, [u!.id, c!.id], db);
  const box = await one<{ id: number }>(`UPDATE boxes SET status='placed', company_id=$1, location_id=$2 WHERE id=(SELECT id FROM boxes WHERE size=500 AND status='in_stock' ORDER BY id DESC LIMIT 1) RETURNING id`, [c!.id, l!.id], db);
  const s = await one<{ id: number }>(`INSERT INTO subscriptions(company_id, location_id, status, started_at) VALUES ($1,$2,'active', current_date - 120) RETURNING id`, [c!.id, l!.id], db);
  const terms = { boxSize: 500, boxLabel: "500 liter", packageCode: "scheduled", packageName: "Bereyl geregeld", packageKind: "scheduled", frequencyPerYear: 4, includedPerYear: 4, monthlyCents: 3957, singleEmptyingCents: 13460, transportPerTripCents: 1560, freeCombinedEmptying: false, finalPickupCents: null, swapCents: null, vatBp: 2100, demo: true };
  await q(`INSERT INTO subscription_versions(subscription_id, version, status, effective_from, terms, box_size, package_code, monthly_cents) VALUES ($1,1,'active', current_date - 120, $2, 500, 'scheduled', 3957)`, [s!.id, JSON.stringify(terms)], db);
  const p = await one<{ id: number }>(`INSERT INTO credit_periods(subscription_id, starts_on, ends_on, included) VALUES ($1, current_date - 120, current_date + 244, 4) RETURNING id`, [s!.id], db);
  await q(`INSERT INTO credit_mutations(period_id, kind, delta_available, reason, idempotency_key) VALUES ($1,'grant',4,'Demo: start abonnement',$2)`, [p!.id, `demo:${p!.id}:grant`], db);
  for (const [days, kg] of [[90, 78], [45, 92]] as const) {
    const a = await one<{ id: number }>(`INSERT INTO appointments(number, company_id, location_id, subscription_id, type, request_status, execution_status, weighing_status, financial_status, funding, planned_date, executed_at, box_size)
      VALUES ($1,$2,$3,$4,'emptying','confirmed','executed','confirmed','included','included', current_date - $5::int, now() - ($5 || ' days')::interval, 500) RETURNING id`, [`DEMO-${days}`, c!.id, l!.id, s!.id, days], db);
    await q(`INSERT INTO credit_mutations(period_id, appointment_id, kind, delta_available, delta_reserved, reason, idempotency_key) VALUES ($1,$2,'consume',-1,0,'Demo: leging uitgevoerd',$3)`, [p!.id, a!.id, `demo:${a!.id}:consume`], db);
    await q(`INSERT INTO collections(appointment_id, company_id, location_id, collected_at, box_placed_id, status, net_weight_grams, weighed_at) VALUES ($1,$2,$3, now() - ($4 || ' days')::interval, $5, 'weight_confirmed', $6, now())`, [a!.id, c!.id, l!.id, days, box!.id, kg * 1000], db);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
