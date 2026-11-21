import { requireStaff } from "@/lib/auth";
import { q } from "@/lib/db";
import { formatDateTime } from "@/lib/dates";
import { ActionForm, Submit } from "@/components/ActionForm";
import { PageHead, Pill } from "@/components/ui";
import { retryEmail, retryJobAction } from "../actions";

export default async function Wachtrij({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  await requireStaff(["admin"]);
  const jobs = await q<any>(`SELECT * FROM jobs WHERE status IN ('failed','queued','running') OR (status IN ('done','skipped') AND finished_at > now() - interval '2 days') ORDER BY CASE status WHEN 'failed' THEN 0 WHEN 'running' THEN 1 WHEN 'queued' THEN 2 ELSE 3 END, id DESC LIMIT 150`);
  const mails = await q<any>(`SELECT e.*, c.name AS company_name FROM email_log e LEFT JOIN companies c ON c.id=e.company_id ORDER BY e.id DESC LIMIT 100`);
  const show = sp.mail ? mails.find((m) => String(m.id) === sp.mail) : null;
  return (
    <div className="stack-lg">
      <PageHead title="Wachtrij en e-maillog" back={{ href: "/beheer/instellingen", label: "Instellingen" }} intro="Iedere automatisering heeft een unieke sleutel: opnieuw proberen levert nooit dubbele berichten, facturen of betalingen op." />
      <section className="card stack">
        <h2 style={{ fontSize: "1.2rem" }}>Automatiseringen</h2>
        <div className="table-wrap"><table className="table small"><thead><tr><th>Status</th><th>Type</th><th>Sleutel</th><th>Gepland</th><th>Pogingen</th><th>Fout</th><th /></tr></thead>
          <tbody>{jobs.map((j) => <tr key={j.id}><td><Pill tone={j.status === "failed" ? "danger" : j.status === "done" ? "ok" : j.status === "skipped" ? "muted" : "warn"}>{j.status}</Pill></td><td>{j.type}{j.payload?.event ? ` · ${j.payload.event}` : ""}{j.payload?.template ? ` · ${j.payload.template}` : ""}</td><td className="tiny" style={{ wordBreak: "break-all" }}>{j.idempotency_key}</td><td className="nowrap">{formatDateTime(j.run_at)}</td><td>{j.attempts}</td><td className="tiny error-text">{j.last_error}{j.status === "skipped" && j.result ? <span className="muted"> {JSON.stringify(j.result)}</span> : null}</td>
            <td>{["failed", "skipped"].includes(j.status) && <ActionForm action={retryJobAction}><input type="hidden" name="jobId" value={j.id} /><Submit className="btn btn-sm btn-secondary">Opnieuw</Submit></ActionForm>}</td></tr>)}</tbody></table></div>
      </section>
      <section className="card stack">
        <h2 style={{ fontSize: "1.2rem" }}>E-maillog</h2>
        <div className="table-wrap"><table className="table small"><thead><tr><th>Tijd</th><th>Aan</th><th>Onderwerp</th><th>Template</th><th>Status</th><th /></tr></thead>
          <tbody>{mails.map((m) => <tr key={m.id}><td className="nowrap">{formatDateTime(m.created_at)}</td><td>{m.to_address}{m.cc ? ` (cc ${m.cc})` : ""}</td><td><a href={`/beheer/wachtrij?mail=${m.id}#bericht`}>{m.subject}</a>{m.attachments?.length ? <span className="tiny muted"> · {m.attachments.length} bijlage(n)</span> : null}</td><td>{m.template_key} v{m.template_version}</td>
            <td><Pill tone={m.status === "sent" ? "ok" : m.status === "failed" ? "danger" : "warn"}>{m.status === "not_configured" ? "niet verzonden: mailkoppeling ontbreekt" : m.status}</Pill>{m.error && <div className="tiny muted">{m.error}</div>}</td>
            <td>{m.status === "failed" && <ActionForm action={retryEmail}><input type="hidden" name="emailId" value={m.id} /><Submit className="btn btn-sm btn-secondary">Opnieuw</Submit></ActionForm>}</td></tr>)}</tbody></table></div>
      </section>
      {show && (
        <section className="card stack" id="bericht">
          <h2 style={{ fontSize: "1.2rem" }}>{show.subject}</h2>
          <p className="small">Aan {show.to_address} · template {show.template_key} v{show.template_version}{show.attachments?.length ? ` · bijlagen: ${show.attachments.map((a: any) => a.filename).join(", ")}` : ""}</p>
          {show.attachments?.map((a: any) => <a key={a.fileId} className="small" href={`/api/files/${a.fileId}`} target="_blank" rel="noopener">{a.filename}</a>)}
          <iframe title="Inhoud e-mail" srcDoc={show.html} sandbox="allow-popups allow-popups-to-escape-sandbox" style={{ width: "100%", height: 600, border: "1px solid var(--line)", borderRadius: 12, background: "#fff" }} />
        </section>
      )}
    </div>
  );
}
