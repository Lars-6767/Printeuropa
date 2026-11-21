import { requireCustomer } from "@/lib/auth";
import { documentsFor } from "@/lib/portal";
import { getConfig } from "@/lib/settings";
import { formatDate } from "@/lib/dates";
import { PROPOSAL_STATUS } from "@/lib/labels";
import { PageHead, Empty } from "@/components/ui";

export default async function Documenten() {
  const ctx = await requireCustomer();
  const [d, contract] = await Promise.all([documentsFor(ctx.companyId), getConfig("contract")]);
  const link = (id: number | null, label: string) => id ? <a href={`/api/files/${id}`} target="_blank" rel="noopener">{label}</a> : <span className="muted">wordt aangemaakt</span>;
  return (
    <div className="stack-lg">
      <PageHead title="Documenten" intro="Voorstellen, akkoorden, voorwaarden, facturen en certificaten." />
      <section className="card stack">
        <h2 style={{ fontSize: "1.2rem" }}>Certificaten en verklaringen</h2>
        {d.certificates.length === 0 ? <p className="muted">Nog geen certificaten vrijgegeven.</p> : (
          <ul>{d.certificates.map((c, i) => <li key={i}>{link(c.file_id, c.title)}{c.statement_file_id && <> · {link(c.statement_file_id, "Verklaring voor jullie organisatie")}</>} <span className="small muted">({formatDate(c.released_at, { short: true })}{c.batch_number ? `, partij ${c.batch_number}` : ""})</span></li>)}</ul>
        )}
      </section>
      <section className="card stack">
        <h2 style={{ fontSize: "1.2rem" }}>Voorstellen en akkoorden</h2>
        {d.proposals.length === 0 ? <p className="muted">Geen voorstellen.</p> : (
          <ul>{d.proposals.map((p) => <li key={p.id}>{link(p.pdf_file_id, `${p.kind === "new" ? "Voorstel" : "Wijzigingsvoorstel"} ${p.number ?? ""} versie ${p.version}`)} <span className="small muted">({PROPOSAL_STATUS[p.status]}, {formatDate(p.created_at, { short: true })})</span></li>)}</ul>
        )}
        {d.acceptances.length > 0 && <ul>{d.acceptances.map((a) => <li key={a.id}>{link(a.pdf_file_id, `Akkoordbewijs ${a.number ?? ""} versie ${a.proposal_version}`)} <span className="small muted">(door {a.user_name}, {formatDate(a.accepted_at, { short: true })})</span></li>)}</ul>}
      </section>
      <section className="card stack">
        <h2 style={{ fontSize: "1.2rem" }}>Voorwaarden</h2>
        <p className="small">{contract.termsSummary}</p>
        <p className="small muted">Actuele versie: {contract.termsVersion}{contract.termsUrl ? <> · <a href={contract.termsUrl} target="_blank" rel="noopener">Bekijk</a></> : null}</p>
      </section>
      <section className="card stack">
        <h2 style={{ fontSize: "1.2rem" }}>Facturen</h2>
        {d.invoices.length === 0 ? <p className="muted">Nog geen facturen.</p> : <ul>{d.invoices.map((i) => <li key={i.id}>{link(i.pdf_file_id, i.number)}</li>)}</ul>}
      </section>
    </div>
  );
}
