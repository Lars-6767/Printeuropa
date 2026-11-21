/** Achtergrondworker: verwerkt de jobwachtrij (PDF's, e-mail, facturen, betalingen, dagelijkse taken). */
import "./load-env";
import { processNext, ensureDailyScheduled } from "../src/lib/automation";
import { pool } from "../src/lib/db";

const once = process.argv.includes("--once");
let stopping = false;
process.on("SIGINT", () => (stopping = true));
process.on("SIGTERM", () => (stopping = true));

async function main() {
  await ensureDailyScheduled(pool());
  console.log("[worker] gestart");
  while (!stopping) {
    const didWork = await processNext();
    if (!didWork) {
      if (once) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  await pool().end();
}
main().catch((e) => { console.error(e); process.exit(1); });
