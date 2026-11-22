/**
 * Startcontrole voor productie. Inloggen kan alleen via e-mail, dus zonder werkende
 * mailkoppeling (Microsoft 365 of SMTP) start de applicatie niet.
 */
import "./load-env";
import { mailProvider, mailProviderLabel, verifyMail } from "../src/lib/mail-transport";

const errors: string[] = [];
const warnings: string[] = [];
const env = process.env;

if (!env.DATABASE_URL) errors.push("DATABASE_URL ontbreekt.");
if (!env.APP_URL || !env.APP_URL.startsWith("https://")) errors.push("APP_URL moet het publieke https-adres zijn, bijv. https://mijn.bereyl.com");
if (!mailProvider()) errors.push("Er is geen mailkoppeling: vul MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET en MAIL_SENDER in (Microsoft 365). Inloggen gaat uitsluitend via e-mail.");
if (!env.MAIL_FROM) errors.push("MAIL_FROM ontbreekt, bijv. Bereyl <noreply@bereyl.com>.");
if (env.DEMO_MODE === "true") errors.push("DEMO_MODE staat aan. Zet DEMO_MODE=false voor de live omgeving.");
if (!env.ORS_API_KEY) warnings.push("ORS_API_KEY ontbreekt: vervoersprijzen blijven 'nog vast te stellen' tot Bereyl de afstand invult.");
if (!env.MOLLIE_API_KEY) warnings.push("MOLLIE_API_KEY ontbreekt: automatische incasso staat uit; facturen worden wel gemaakt en verstuurd.");

async function main() {
  for (const w of warnings) console.warn(`[controle] let op: ${w}`);
  if (errors.length) {
    for (const e of errors) console.error(`[controle] FOUT: ${e}`);
    process.exit(1);
  }
  try {
    await verifyMail();
    console.log(`[controle] mailkoppeling werkt: ${mailProviderLabel()}`);
  } catch (e) {
    console.error(`[controle] FOUT: mailkoppeling werkt niet: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
  console.log("[controle] productie-instellingen in orde");
}
main();
