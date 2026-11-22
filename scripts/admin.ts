/**
 * Maakt (of bevestigt) een Bereyl-beheerder en geeft een eenmalige inloglink.
 * Gebruik op de server: npm run admin -- naam@bereyl.com "Voornaam Achternaam"
 * De link wordt ook per e-mail verstuurd als SMTP is ingesteld.
 */
import "./load-env";
import { pool, one, tx } from "../src/lib/db";
import { issueToken, appUrl } from "../src/lib/tokens";
import { sendTemplatedMail } from "../src/lib/mail";

async function main() {
  const [email, name = "Beheerder"] = process.argv.slice(2);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { console.error('Gebruik: npm run admin -- e-mail "Naam"'); process.exit(1); }
  const link = await tx(async (c) => {
    const u = await one<{ id: number }>(`INSERT INTO users(email, name, staff_role, active) VALUES ($1,$2,'admin',true)
      ON CONFLICT (email) DO UPDATE SET staff_role='admin', active=true RETURNING id`, [email.toLowerCase(), name], c);
    const token = await issueToken(u!.id, "invite", 60, c);
    const url = appUrl(`/auth/link?token=${encodeURIComponent(token)}&next=%2Fbeheer`);
    await sendTemplatedMail(c, { idempotencyKey: `admin_cli:${u!.id}:${Date.now()}`, templateKey: "auth_login_link", to: email.toLowerCase(), vars: { voornaam: name.split(" ")[0], portallink: url } });
    return url;
  });
  console.log(`Beheerder ${email} staat klaar. Eenmalige inloglink (60 minuten geldig):\n${link}`);
  await pool().end();
}
main().catch((e) => { console.error(e); process.exit(1); });
