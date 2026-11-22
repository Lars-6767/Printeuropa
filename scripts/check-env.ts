/**
 * Startcontrole voor productie. Inloggen kan alleen via e-mail, dus zonder werkende
 * mailkoppeling start de applicatie niet.
 */
import "./load-env";
import nodemailer from "nodemailer";

const errors: string[] = [];
const warnings: string[] = [];
const env = process.env;

if (!env.DATABASE_URL) errors.push("DATABASE_URL ontbreekt.");
if (!env.APP_URL || !env.APP_URL.startsWith("https://")) errors.push("APP_URL moet het publieke https-adres zijn, bijv. https://mijn.bereyl.com");
if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASSWORD) errors.push("SMTP_HOST, SMTP_USER en SMTP_PASSWORD zijn verplicht: inloggen gaat uitsluitend via e-mail.");
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
    await nodemailer.createTransport({
      host: env.SMTP_HOST, port: Number(env.SMTP_PORT ?? 587), secure: env.SMTP_SECURE === "true",
      auth: { user: env.SMTP_USER!, pass: env.SMTP_PASSWORD! },
    }).verify();
    console.log("[controle] mailserver bereikbaar");
  } catch (e) {
    console.error(`[controle] FOUT: mailserver niet bereikbaar of inlog geweigerd: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
  console.log("[controle] productie-instellingen in orde");
}
main();
