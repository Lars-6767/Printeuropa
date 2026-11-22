import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { q } from "@/lib/db";
import { getConfig } from "@/lib/settings";
import { EVENTS } from "@/lib/config";
import { PageHead, Pill } from "@/components/ui";

export default async function Emails() {
  await requireStaff(["admin"]);
  const rows = await q<any>(`SELECT key, audience, name, MAX(version) FILTER (WHERE status='published') AS published, BOOL_OR(status='draft') AS has_draft FROM email_templates GROUP BY key, audience, name ORDER BY audience, name`);
  const auto = await getConfig("automations");
  const usedBy = (key: string) => auto.rules.filter((r) => r.externalTemplate === key || r.internalTemplate === key).map((r) => `${EVENTS.find((e) => e.code === r.event)?.label ?? r.event}${r.enabled ? "" : " (uit)"}`);
  return (
    <div className="stack-lg">
      <PageHead title="E-mails" back={{ href: "/beheer/instellingen", label: "Instellingen" }} intro="Klant- en interne berichten. Iedere verzending legt de gebruikte templateversie vast." />
      <div className="table-wrap card" style={{ padding: 8 }}><table className="table small">
        <thead><tr><th>Template</th><th>Voor</th><th>Gebruikt bij</th><th>Versie</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.key}><td><Link href={`/beheer/emails/${r.key}`}>{r.name}</Link></td><td>{r.audience === "internal" ? "Intern" : "Klant"}</td><td>{usedBy(r.key).join(", ") || (r.key.startsWith("auth_") ? "Inloggen" : "–")}</td><td>{r.published}{r.has_draft && <> <Pill tone="warn">Concept</Pill></>}</td></tr>)}</tbody>
      </table></div>
    </div>
  );
}
