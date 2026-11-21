import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { CONFIG_LABELS, type ConfigKey } from "@/lib/config";
import { q } from "@/lib/db";
import { PageHead, Pill } from "@/components/ui";

export default async function Instellingen() {
  await requireStaff(["admin"]);
  const drafts = await q<{ key: string }>(`SELECT key FROM config_versions WHERE status='draft'`);
  const tplDrafts = await q<{ n: number }>(`SELECT COUNT(*) AS n FROM email_templates WHERE status='draft'`);
  const extra: [string, string, string][] = [
    ["/beheer/emails", "E-mails", "Templates met visuele editor, voorbeeld, testmail en versies."],
    ["/beheer/prijswijziging", "Prijswijziging bestaande klanten", "Nieuwe algemene prijzen via een afzonderlijk, te bevestigen wijzigingsvoorstel."],
    ["/beheer/gebruikers", "Gebruikers", "Rollen, medewerkers, uitnodigingen en toegangsrechten."],
    ["/beheer/koppelingen", "Koppelingen", "Mail, betalingen, boekhouding, routeberekening, opslag en verbindingsstatus."],
    ["/beheer/wachtrij", "Wachtrij en e-maillog", "Automatiseringen, verzendlog, foutredenen en opnieuw proberen."],
    ["/beheer/audit", "Auditlog", "Alle beheeracties met auteur en tijdstip."],
  ];
  return (
    <div className="stack-lg">
      <PageHead title="Instellingen" intro="Wijzigingen worden eerst als concept opgeslagen. Bekijk het voorbeeld en publiceer daarna. Iedere versie blijft bewaard en kan worden teruggezet." />
      <div className="grid grid-3">
        {(Object.keys(CONFIG_LABELS) as ConfigKey[]).map((k) => (
          <Link key={k} href={`/beheer/instellingen/${k}`} className="card stack" style={{ textDecoration: "none" }}>
            <strong>{CONFIG_LABELS[k].title} {drafts.some((d) => d.key === k) && <Pill tone="warn">Concept</Pill>}</strong>
            <span className="small muted">{CONFIG_LABELS[k].intro}</span>
          </Link>
        ))}
        {extra.map(([href, t, d]) => (
          <Link key={href} href={href} className="card stack" style={{ textDecoration: "none" }}>
            <strong>{t} {href === "/beheer/emails" && Number(tplDrafts[0].n) > 0 && <Pill tone="warn">Concept</Pill>}</strong><span className="small muted">{d}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
