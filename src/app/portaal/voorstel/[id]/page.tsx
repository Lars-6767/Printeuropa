import { notFound } from "next/navigation";
import Link from "next/link";
import { requireCustomer } from "@/lib/auth";
import { one } from "@/lib/db";
import { getConfig } from "@/lib/settings";
import { acceptBlockers } from "@/lib/proposals";
import { offerRows, prefsText } from "@/lib/documents";
import { formatDate, formatDateTime } from "@/lib/dates";
import { PROPOSAL_STATUS, PM_STATUS } from "@/lib/labels";
import { ActionForm, Submit, FieldError } from "@/components/ActionForm";
import { PageHead, Pill, KV } from "@/components/ui";
import { acceptAction } from "../../actions";

export default async function Voorstel({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireCustomer();
  const p = await one<any>(`SELECT p.*, r.number AS request_number, r.answers, c.printmasters_status FROM proposals p LEFT JOIN requests r ON r.id=p.request_id JOIN companies c ON c.id=p.company_id WHERE p.id=$1 AND p.company_id=$2`, [Number(id), ctx.companyId]);
  if (!p) notFound();
  const newer = await one<{ id: number }>(`SELECT id FROM proposals WHERE request_id=$1 AND version > $2 ORDER BY version DESC LIMIT 1`, [p.request_id, p.version]);
  const acc = await one<any>(`SELECT a.*, u.name FROM acceptances a JOIN users u ON u.id=a.user_id WHERE proposal_id=$1`, [p.id]);
  const contract = await getConfig("contract");
  const planning = await getConfig("planning");
  const blocker = acceptBlockers(p);
  return (
    <div className="stack-lg">
      <PageHead title={p.kind === "new" ? "Jullie voorstel" : "Wijzigingsvoorstel"} back={{ href: "/portaal", label: "Overzicht" }} intro={`Aanvraag ${p.request_number ?? "–"} · versie ${p.version} · geldig t/m ${formatDate(p.valid_until)}`} actions={<Pill tone={p.status === "accepted" ? "ok" : p.status === "open" ? "accent" : "muted"}>{PROPOSAL_STATUS[p.status]}</Pill>} />
      {sp.akkoord && <p className="notice notice-ok" role="status">Bedankt voor je akkoord! We hebben de plaatsing aangevraagd en sturen een bevestiging per e-mail. Klaar voor een nieuwe ronde?</p>}
      {newer && <p className="notice notice-warn">Er is een nieuwere versie van dit voorstel. <Link href={`/portaal/voorstel/${newer.id}`}>Bekijk de nieuwste versie</Link></p>}
      <div className="grid grid-2" style={{ alignItems: "start" }}>
        <section className="card stack">
          <h2>{p.offer.boxLabel} · {p.offer.packageName}</h2>
          <KV rows={offerRows(p.offer)} />
          {p.offer.notes?.map((n: string, i: number) => <p key={i} className="small notice notice-warn" style={{ margin: 0 }}>{n}</p>)}
          {p.pdf_file_id ? <a className="btn btn-secondary btn-sm" href={`/api/files/${p.pdf_file_id}`} target="_blank" rel="noopener">Download voorstel (PDF)</a> : <p className="small muted">De PDF wordt aangemaakt…</p>}
        </section>
        <section className="card stack">
          {(p.offer.packageKind === "printmasters" || p.printmasters_status !== "none") && <KV rows={[["PrintMasters", PM_STATUS[p.printmasters_status]], ["Voordeel", p.provisional ? "Voorlopig, wordt gecontroleerd" : p.offer.packageKind === "printmasters" ? "Toegekend" : "–"]]} />}
          {p.answers?.preferences && <KV rows={[["Plaatsingsvoorkeur", prefsText(p.answers.preferences.slots ?? [], p.answers.preferences.flexible, planning.dayparts)]]} />}
          <div className="stack">
            <h3>Voorwaarden</h3>
            <p className="small">{contract.termsSummary}</p>
            <p className="small muted">Voorwaardenversie {p.terms_version}{contract.termsUrl ? <> · <a href={contract.termsUrl} target="_blank" rel="noopener">Lees de voorwaarden</a></> : null}</p>
          </div>
          {acc ? (
            <div className="notice notice-ok">
              <p style={{ margin: 0 }}><strong>Akkoord gegeven</strong> door {acc.name} op {formatDateTime(acc.accepted_at)} (voorstelversie {acc.proposal_version}, voorwaarden {acc.terms_version}).</p>
              {acc.pdf_file_id && <a href={`/api/files/${acc.pdf_file_id}`} target="_blank" rel="noopener">Akkoordbewijs (PDF)</a>}
            </div>
          ) : blocker ? (
            <p className="notice notice-warn">{blocker}</p>
          ) : !ctx.isAdmin ? (
            <p className="notice">Alleen de beheerder van jullie account kan akkoord geven.</p>
          ) : (
            <ActionForm action={acceptAction} className="stack">
              <input type="hidden" name="proposalId" value={p.id} />
              <label className="check"><input type="checkbox" name="agree" aria-describedby="agree-error" />Ik ga akkoord met dit voorstel, de genoemde bedragen en de boxvoorwaarden (versie {p.terms_version}).</label>
              <FieldError name="agree" />
              <Submit className="btn btn-block" pendingText="Akkoord verwerken…">Akkoord en plaatsing aanvragen</Submit>
            </ActionForm>
          )}
        </section>
      </div>
    </div>
  );
}
