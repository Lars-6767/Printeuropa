import "./load-env";
import fs from "node:fs";
import path from "node:path";
import { pool } from "../src/lib/db";

async function main() {
  const db = pool();
  if (process.argv.includes("--reset")) {
    console.log("[migrate] database leegmaken");
    await db.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  }
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const dir = path.resolve("db/migrations");
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const done = await db.query(`SELECT 1 FROM schema_migrations WHERE name=$1`, [f]);
    if (done.rowCount) continue;
    console.log(`[migrate] ${f}`);
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(fs.readFileSync(path.join(dir, f), "utf8"));
      await client.query(`INSERT INTO schema_migrations(name) VALUES ($1)`, [f]);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  await db.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
