// Hulpfuncties voor de end-to-end-controle via de echte schermen.
import pg from "pg";
import fs from "node:fs";

export const BASE = process.env.E2E_BASE ?? "http://localhost:3000";
export const db = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://bereyl:bereyl@localhost:5432/bereyl" });
export const q = async (sql, p = []) => (await db.query(sql, p)).rows;
export const one = async (sql, p = []) => (await q(sql, p))[0];
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const log = (...a) => console.log("•", ...a);
const results = [];
export function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✔" : "✘"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}
export function summary(file) {
  if (file) fs.writeFileSync(file, JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} controles geslaagd`);
}

/** Wacht tot de worker alle jobs heeft verwerkt die klaar staan. */
export async function drain(timeout = 30000) {
  const t = Date.now();
  while (Date.now() - t < timeout) {
    const r = await one(`SELECT COUNT(*)::int AS n FROM jobs WHERE status IN ('queued','running') AND run_at <= now()`);
    if (r.n === 0) return;
    await sleep(300);
  }
  throw new Error("Worker verwerkt de wachtrij niet");
}

export async function mailTo(email, templateKey) {
  await drain();
  return one(`SELECT * FROM email_log WHERE to_address=$1 AND template_key=$2 ORDER BY id DESC LIMIT 1`, [email, templateKey]);
}
export function linkFrom(html) {
  const m = html.match(/href="([^"]*\/auth\/link\?token=[^"]+)"/);
  return m ? m[1].replace(/&amp;/g, "&") : null;
}

/** Eerstvolgende werkdagen vanaf n dagen in de toekomst (YYYY-MM-DD). */
export function weekdays(fromDays, count) {
  const out = [];
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + fromDays);
  while (out.length < count) {
    const wd = d.getUTCDay();
    if (wd >= 1 && wd <= 5) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export async function login(page, email, password = "Bereyl-demo-2026") {
  await page.goto(`${BASE}/inloggen`);
  const form = page.locator("form").filter({ has: page.getByLabel("Wachtwoord", { exact: true }) });
  await form.getByLabel("E-mailadres").fill(email);
  await form.getByLabel("Wachtwoord", { exact: true }).fill(password);
  await form.getByRole("button", { name: "Inloggen" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/inloggen"), { timeout: 15000 });
}
export async function logout(page) {
  await page.context().clearCookies();
}
