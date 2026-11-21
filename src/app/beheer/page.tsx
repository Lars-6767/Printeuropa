import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { q, one } from "@/lib/db";
import { activationIssues } from "@/lib/settings";
import { formatDateTime } from "@/lib/dates";
import { ActionForm, Submit } from "@/components/ActionForm";
import { PageHead, Pill } from "@/components/ui";
import { taskAssignMe, taskDone } from "./actions";

export default async function Werkvoorraad({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const u = await requireStaff();
  if (u.staff_role === "field") redirect("/beheer/uitvoering");
  const counts = await one<any>(`SELECT
    (SELECT COUNT(*) FROM proposals WHERE status='open' AND kind='new') AS open_proposals,
    (SELECT COUNT(*) FROM companies WHERE printmasters_status='claimed') AS pm_verify,
    (SELECT COUNT(*) FROM tasks WHERE status='open' AND type='printmasters_interest') AS pm_intro,
    (SELECT COUNT(*) FROM appointments WHERE request_status='requested') AS to_confirm,
    (SELECT COUNT(*) FROM appointments WHERE type='swap' AND execution_status='pending' AND request_status <> 'cancelled') AS swaps,
    (SELECT COUNT(*) FROM collections WHERE status='picked_up') AS weighings,
    (SELECT COUNT(*) FROM processing_batches b WHERE b.status='processed' AND NOT EXISTS (SELECT 1 FROM certificates c WHERE c.batch_id=b.id AND c.status='released')) AS certs,
    (SELECT COUNT(*) FROM jobs WHERE status='failed') + (SELECT COUNT(*) FROM email_log WHERE status='failed') AS failures,
    (SELECT COUNT(*) FROM requests WHERE kind='outside_area' AND status='new') AS outside`);
  const type = sp.type ?? null;
  const tasks = await q<any>(`SELECT t.*, c.name AS company_name, u.name AS owner_name FROM tasks t LEFT JOIN companies c ON c.id=t.company_id LEFT JOIN users u ON u.id=t.owner_user_id
    WHERE t.status='open' AND ($1::text IS NULL OR t.type=$1) ORDER BY CASE t.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, t.due_at NULLS LAST, t.id LIMIT 200`, [type]);
  const issues = await activationIssues();
  const tiles: [string, number, string][] = [
    ["Nieuwe aanvragen / open akkoorden", counts.open_proposals, "/beheer/klanten?filter=open"],
    ["PrintMasters te verifiëren", counts.pm_verify, "/beheer?type=printmasters_verify"],
    ["Kennismakingsverzoeken", counts.pm_intro, "/beheer?type=printmasters_interest"],
    ["Te bevestigen afspraken", counts.to_confirm, "/beheer/planning"],
    ["Boxwissels", counts.swaps, "/beheer/planning?type=swap"],
    ["Ontbrekende wegingen", counts.weighings, "/beheer/wegingen"],
    ["Certificaten gereed", counts.certs, "/beheer/partijen"],
    ["Mislukte automatiseringen", counts.failures, "/beheer/wachtrij"],
    ["Buiten werkgebied", counts.outside, "/beheer?type=outside_area_request"],
  ];
  return (
    <div className="stack-lg">
      <PageHead title="Werkvoorraad" intro="Alles wat aandacht nodig heeft op één plek." />
      <div className="grid grid-3">
        {tiles.map(([l, n, href]) => (
          <Link key={l} href={href} className="card" style={{ textDecoration: "none" }}>
            <p className="small muted" style={{ margin: 0 }}>{l}</p>
            <p className="price-big" style={{ margin: 0 }}>{n}</p>
          </Link>
        ))}
      </div>
      <section className="card stack">
        <div className="row between"><h2 style={{ margin: 0 }}>Taken{type ? ` · ${type}` : ""}</h2>{type && <Link href="/beheer">Alle taken</Link>}</div>
        {tasks.length === 0 ? <p className="muted">Geen openstaande taken.</p> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Prioriteit</th><th>Taak</th><th>Klant</th><th>Eigenaar</th><th>Vervalt</th><th /></tr></thead>
            <tbody>{tasks.map((t) => (
              <tr key={t.id}>
                <td><Pill tone={t.priority === "high" ? "danger" : t.priority === "low" ? "muted" : undefined}>{t.priority === "high" ? "Hoog" : t.priority === "low" ? "Laag" : "Normaal"}</Pill></td>
                <td>{t.title}{t.detail && <div className="tiny muted">{t.detail}</div>}</td>
                <td>{t.company_id ? <Link href={`/beheer/klanten/${t.company_id}`}>{t.company_name}</Link> : "–"}</td>
                <td>{t.owner_name ?? <ActionForm action={taskAssignMe}><input type="hidden" name="id" value={t.id} /><Submit className="btn btn-ghost btn-sm">Neem op</Submit></ActionForm>}</td>
                <td className="nowrap small">{formatDateTime(t.due_at)}</td>
                <td><ActionForm action={taskDone}><input type="hidden" name="id" value={t.id} /><Submit className="btn btn-sm btn-secondary">Afgerond</Submit></ActionForm></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
      {issues.length > 0 && (
        <section className="card stack" aria-labelledby="activatie">
          <h2 id="activatie">Activatiepunten</h2>
          <p className="small muted">Deze instellingen moet Bereyl nog vaststellen of koppelen. Tot die tijd draait de applicatie met herkenbare concept- en demowaarden.</p>
          <ul className="stack" style={{ paddingLeft: 18 }}>{issues.map((i, k) => <li key={k}><Pill tone="warn">{i.area}</Pill> {i.message} <Link href={i.href}>Instellen</Link></li>)}</ul>
        </section>
      )}
    </div>
  );
}
