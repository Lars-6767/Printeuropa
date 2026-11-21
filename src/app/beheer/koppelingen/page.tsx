import { requireStaff } from "@/lib/auth";
import { getConfigs } from "@/lib/settings";
import { routingStatus, calculateDistance } from "@/lib/distance";
import { activeProvider } from "@/lib/payments";
import { smtpConfigured } from "@/lib/mail";
import { one } from "@/lib/db";
import { PageHead, Pill } from "@/components/ui";
import Link from "next/link";

export default async function Koppelingen({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  await requireStaff(["admin"]);
  const cfg = await getConfigs(["integrations", "transport"]);
  const routing = routingStatus(cfg.integrations);
  const pay = await activeProvider();
  const mailFails = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM email_log WHERE status='failed'`);
  const test = sp.postcode ? await calculateDistance(cfg.transport, cfg.integrations, { postcode: sp.postcode, street: sp.straat }) : null;
  const rows: [string, boolean, string, string][] = [
    ["E-mail (SMTP)", smtpConfigured(), smtpConfigured() ? `Actief via ${process.env.SMTP_HOST}. Afzender: ${cfg.integrations.mailFrom}. Mislukte verzendingen: ${mailFails!.n}` : "Niet gekoppeld. Berichten worden gelogd maar niet verzonden. Stel SMTP_HOST, SMTP_USER en SMTP_PASSWORD in op de server.", "SMTP_HOST"],
    ["Betalingen en incasso", pay.name === "mollie", pay.message + (pay.name === "demo" ? " — niet voor echte incasso." : ""), "MOLLIE_API_KEY"],
    ["Boekhouding", false, cfg.integrations.accountingProvider === "none" ? "Nog niet gekozen. Facturen worden in de applicatie gemaakt en als PDF bewaard." : `${cfg.integrations.accountingProvider} gekozen; de koppeling moet nog worden gebouwd. Facturen blijven intussen in de applicatie.`, "ACCOUNTING_API_KEY"],
    ["Routeberekening", routing.ready && routing.provider === "openrouteservice", routing.message, "ORS_API_KEY"],
    ["Opslag", true, `Lokale afgeschermde opslag in ${process.env.STORAGE_DIR ?? "./storage"}. Neem deze map op in de back-up.`, "STORAGE_DIR"],
  ];
  return (
    <div className="stack-lg">
      <PageHead title="Koppelingen" back={{ href: "/beheer/instellingen", label: "Instellingen" }} intro="Geheime sleutels staan in de serveromgeving, niet in de broncode of de database. Hier zie je de verbindingsstatus." />
      <div className="stack">{rows.map(([n, ok, msg, env]) => (
        <div key={n} className="card row between">
          <div style={{ flex: "1 1 320px" }}><strong>{n}</strong><p className="small" style={{ margin: 0 }}>{msg}</p><p className="tiny muted" style={{ margin: 0 }}>Serverinstelling: {env}</p></div>
          <Pill tone={ok ? "ok" : "warn"}>{ok ? "Actief" : "Niet actief"}</Pill>
        </div>
      ))}</div>
      <section className="card stack">
        <h2 style={{ fontSize: "1.2rem" }}>Routeberekening testen</h2>
        <form className="row"><input name="postcode" placeholder="Postcode" defaultValue={sp.postcode} style={{ maxWidth: 160 }} aria-label="Postcode" /><input name="straat" placeholder="Straat en huisnummer (optioneel)" defaultValue={sp.straat} style={{ maxWidth: 280 }} aria-label="Straat" /><button className="btn btn-sm btn-secondary">Bereken</button></form>
        {test && <p>{test.km === null ? "Geen afstand: vervoer wordt 'nog vast te stellen'." : `${test.km} km enkele reis (bron: ${test.source}${test.rawKm ? `, exact ${test.rawKm} km` : ""})`}</p>}
      </section>
      <p className="small">Keuzes voor provider en afzender wijzig je in <Link href="/beheer/instellingen/integrations">Instellingen → Koppelingen</Link>.</p>
    </div>
  );
}
