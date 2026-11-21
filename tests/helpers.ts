import fs from "node:fs";
import path from "node:path";
import { pool, q, one } from "@/lib/db";
import { DEFAULTS, type ConfigKey } from "@/lib/config";
import { TEMPLATE_DEFAULTS } from "@/lib/email-defaults";

/** Lege testdatabase met schema en startconfiguratie. */
export async function resetDb() {
  const db = pool();
  await db.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await db.query(fs.readFileSync(path.resolve("db/migrations/001_init.sql"), "utf8"));
  for (const key of Object.keys(DEFAULTS) as ConfigKey[]) {
    await q(`INSERT INTO config_versions(key, version, status, data) VALUES ($1,1,'published',$2)`, [key, JSON.stringify(DEFAULTS[key])]);
  }
  for (const t of TEMPLATE_DEFAULTS) {
    await q(`INSERT INTO email_templates(key, audience, name, version, status, subject, blocks, attachments) VALUES ($1,$2,$3,1,'published',$4,$5,$6)`, [t.key, t.audience, t.name, t.subject, JSON.stringify(t.blocks), JSON.stringify(t.attachments ?? [])]);
  }
}

/** Bedrijf met actief abonnement 'Bereyl geregeld' (4 legingen) en tegoedperiode. */
export async function activeCustomer(name = "Testbedrijf") {
  const c = await one<{ id: number }>(`INSERT INTO companies(name, invoice_email) VALUES ($1,'factuur@test.nl') RETURNING id`, [name]);
  const l = await one<{ id: number }>(`INSERT INTO locations(company_id, name, street, postcode, city, distance_km, distance_source) VALUES ($1,'Hoofd','Straat 1','4811 AB','Breda',10,'handmatig') RETURNING id`, [c!.id]);
  const s = await one<{ id: number }>(`INSERT INTO subscriptions(company_id, location_id, status, started_at) VALUES ($1,$2,'active', current_date) RETURNING id`, [c!.id, l!.id]);
  const terms = { boxSize: 250, boxLabel: "250 liter", packageCode: "scheduled", packageName: "Bereyl geregeld", packageKind: "scheduled", includedPerYear: 4, singleEmptyingCents: 10800, freeCombinedEmptying: false, monthlyCents: 3000 };
  await q(`INSERT INTO subscription_versions(subscription_id, version, status, effective_from, terms, box_size, package_code, monthly_cents) VALUES ($1,1,'active',current_date,$2,250,'scheduled',3000)`, [s!.id, JSON.stringify(terms)]);
  const { openPeriod } = await import("@/lib/credit");
  await openPeriod(pool(), s!.id, new Date().toISOString().slice(0, 10), 12, 4, null, "test");
  return { companyId: c!.id, locationId: l!.id, subscriptionId: s!.id };
}

export async function emptying(ctx: { companyId: number; locationId: number; subscriptionId: number }, funding = "included", price = 10800) {
  const n = Math.random().toString(36).slice(2, 8);
  const a = await one<{ id: number }>(
    `INSERT INTO appointments(number, company_id, location_id, subscription_id, type, funding, price_cents, price_detail, box_size)
     VALUES ($1,$2,$3,$4,'emptying',$5,$6,$7,250) RETURNING id`,
    [`T-${n}`, ctx.companyId, ctx.locationId, ctx.subscriptionId, funding, price, JSON.stringify({ agreedSingleEmptyingCents: 10800 })],
  );
  return a!.id;
}
