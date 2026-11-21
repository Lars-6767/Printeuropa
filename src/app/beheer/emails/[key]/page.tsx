import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { q, one } from "@/lib/db";
import { getConfig } from "@/lib/settings";
import { EVENTS } from "@/lib/config";
import { VARIABLES } from "@/lib/email-render";
import { formatDateTime } from "@/lib/dates";
import { ActionForm, Submit } from "@/components/ActionForm";
import { PageHead, Pill } from "@/components/ui";
import { TemplateEditor } from "./TemplateEditor";
import { publishTemplate, restoreTemplate } from "../../actions";

export default async function TemplatePage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  await requireStaff(["admin"]);
  const versions = await q<any>(`SELECT t.*, u.name AS author FROM email_templates t LEFT JOIN users u ON u.id=t.created_by WHERE key=$1 ORDER BY version DESC`, [key]);
  if (!versions.length) notFound();
  const draft = versions.find((v) => v.status === "draft");
  const pub = versions.find((v) => v.status === "published");
  const base = draft ?? pub ?? versions[0];
  const auto = await getConfig("automations");
  const used = auto.rules.filter((r) => r.externalTemplate === key || r.internalTemplate === key);
  const sent = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM email_log WHERE template_key=$1`, [key]);
  return (
    <div className="stack-lg">
      <PageHead title={base.name} back={{ href: "/beheer/emails", label: "E-mails" }}
        intro={`${base.audience === "internal" ? "Intern bericht" : "Bericht aan klant"} · gebruikt bij: ${used.map((r) => EVENTS.find((e) => e.code === r.event)?.label).join(", ") || "–"} · ${sent!.n} keer verstuurd`}
        actions={<span>Gepubliceerd: v{pub?.version ?? "–"} {draft && <Pill tone="warn">Concept v{draft.version}</Pill>}</span>} />
      <TemplateEditor templateKey={key} initialSubject={base.subject} initialBlocks={base.blocks} initialAttachments={base.attachments ?? []} variables={VARIABLES} />
      {draft && (
        <ActionForm action={publishTemplate} className="card row">
          <input type="hidden" name="key" value={key} />
          <p style={{ margin: 0, flex: 1 }}>Concept v{draft.version} is klaar? Na publiceren gebruiken nieuwe berichten deze versie.</p>
          <Submit className="btn">Publiceer v{draft.version}</Submit>
        </ActionForm>
      )}
      <section className="card stack">
        <h2 style={{ fontSize: "1.2rem" }}>Versies</h2>
        <ul className="small">{versions.map((v) => <li key={v.id}>v{v.version} · {v.status} · {v.author ?? "Systeem"} · {formatDateTime(v.published_at ?? v.created_at)} · &ldquo;{v.subject}&rdquo; {v.status === "archived" && <ActionForm action={restoreTemplate}><input type="hidden" name="key" value={key} /><input type="hidden" name="version" value={v.version} /><Submit className="btn btn-ghost btn-sm">Terugzetten als concept</Submit></ActionForm>}</li>)}</ul>
      </section>
    </div>
  );
}
