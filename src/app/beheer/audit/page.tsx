import { requireStaff } from "@/lib/auth";
import { q } from "@/lib/db";
import { formatDateTime } from "@/lib/dates";
import { PageHead } from "@/components/ui";

export default async function Audit() {
  await requireStaff(["admin"]);
  const rows = await q<any>(`SELECT a.*, u.name AS who, c.name AS company FROM audit_log a LEFT JOIN users u ON u.id=a.actor_user_id LEFT JOIN companies c ON c.id=a.company_id ORDER BY a.id DESC LIMIT 300`);
  return (
    <div className="stack-lg">
      <PageHead title="Auditlog" back={{ href: "/beheer/instellingen", label: "Instellingen" }} />
      <div className="table-wrap card" style={{ padding: 8 }}><table className="table small"><thead><tr><th>Tijd</th><th>Wie</th><th>Actie</th><th>Klant</th><th>Details</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}><td className="nowrap">{formatDateTime(r.created_at)}</td><td>{r.who ?? "Systeem/klant"}</td><td>{r.action}</td><td>{r.company ?? "–"}</td><td className="tiny" style={{ wordBreak: "break-word", maxWidth: 420 }}>{r.data ? JSON.stringify(r.data).slice(0, 300) : ""}</td></tr>)}</tbody></table></div>
    </div>
  );
}
