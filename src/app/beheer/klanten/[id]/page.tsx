import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { q, one } from "@/lib/db";
import { getConfigs } from "@/lib/settings";
import { formatEuro, formatKg } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { PM_STATUS, PROPOSAL_STATUS, SUB_STATUS, INVOICE_STATUS, TYPE, appointmentPhase, FIN_STATUS, FUNDING } from "@/lib/labels";
import { balances } from "@/lib/credit";
import { pool } from "@/lib/db";
import { ActionForm, Field, Submit } from "@/components/ActionForm";
import { PageHead, Pill, KV } from "@/components/ui";
import { creditCorrection, creditInvoiceAction, reissueProposalAction, setLocationDistance, setPrintmastersStatus, withdrawProposal } from "../../actions";

export default async function Dossier({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await requireStaff(["admin", "planner"]);
  const cid = Number(id);
  const c = await one<any>(`SELECT * FROM companies WHERE id=$1`, [cid]);
  if (!c) notFound();
  const cfg = await getConfigs(["printmasters", "packages", "pricing"]);
  const [members, locations, boxes, subs, proposals, appts, invoices, files, tasks, timeline] = await Promise.all([
    q<any>(`SELECT u.name, u.email, u.phone, m.role, m.status FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.company_id=$1`, [cid]),
    q<any>(`SELECT * FROM locations WHERE company_id=$1 ORDER BY id`, [cid]),
    q<any>(`SELECT b.*, l.name AS location_name FROM boxes b LEFT JOIN locations l ON l.id=b.location_id WHERE b.company_id=$1`, [cid]),
    q<any>(`SELECT s.*, l.name AS location_name FROM subscriptions s JOIN locations l ON l.id=s.location_id WHERE s.company_id=$1 ORDER BY s.id`, [cid]),
    q<any>(`SELECT p.*, r.number AS request_number FROM proposals p LEFT JOIN requests r ON r.id=p.request_id WHERE p.company_id=$1 ORDER BY p.id DESC`, [cid]),
    q<any>(`SELECT a.*, l.name AS location_name FROM appointments a JOIN locations l ON l.id=a.location_id WHERE a.company_id=$1 ORDER BY a.id DESC`, [cid]),
    q<any>(`SELECT * FROM invoices WHERE company_id=$1 ORDER BY id DESC`, [cid]),
    q<any>(`SELECT * FROM files WHERE company_id=$1 AND kind <> 'photo' ORDER BY id DESC LIMIT 50`, [cid]),
    q<any>(`SELECT * FROM tasks WHERE company_id=$1 ORDER BY status, id DESC LIMIT 30`, [cid]),
    q<any>(`SELECT * FROM (
        SELECT a.created_at AS at, coalesce(u.name, 'Systeem') AS who, a.action AS what, a.data::text AS detail FROM audit_log a LEFT JOIN users u ON u.id=a.actor_user_id WHERE a.company_id=$1
        UNION ALL SELECT e.created_at, 'E-mail', e.subject || ' → ' || e.to_address, e.status || coalesce(' · ' || e.error, '') FROM email_log e WHERE e.company_id=$1
      ) t ORDER BY at DESC LIMIT 150`, [cid]),
  ]);
  for (const s of subs) {
    s.versions = await q<any>(`SELECT * FROM subscription_versions WHERE subscription_id=$1 ORDER BY version`, [s.id]);
    s.periods = await q<any>(`SELECT * FROM credit_periods WHERE subscription_id=$1 ORDER BY starts_on DESC`, [s.id]);
    for (const p of s.periods) {
      p.bal = await balances(pool(), p.id);
      p.mutations = await q<any>(`SELECT m.*, a.number FROM credit_mutations m LEFT JOIN appointments a ON a.id=m.appointment_id WHERE period_id=$1 ORDER BY m.id`, [p.id]);
    }
  }
  const pkgOptions = cfg.packages.items.filter((p) => !p.archived).map((p) => ({ value: p.code, label: p.name }));
  return (
    <div className="stack-lg">
      <PageHead title={c.name} back={{ href: "/beheer/klanten", label: "Klanten" }} intro={<>{c.is_demo && <span className="demo-badge">DEMO</span>} Factuur: {c.invoice_email} · {c.invoice_street}, {c.invoice_postcode} {c.invoice_city}{c.coc_number ? ` · KvK ${c.coc_number}` : ""}</>} />

      <div className="grid grid-2" style={{ alignItems: "start" }}>
        <section className="card stack">
          <h2 style={{ fontSize: "1.2rem" }}>PrintMasters</h2>
          <p><Pill tone={c.printmasters_status === "verified" ? "ok" : c.printmasters_status === "claimed" ? "warn" : undefined}>{PM_STATUS[c.printmasters_status]}</Pill></p>
          {c.printmasters_note && <p className="small muted">Klantopgave: {c.printmasters_note}</p>}
          <ActionForm action={setPrintmastersStatus} className="stack">
            <input type="hidden" name="companyId" value={cid} />
            <Field name="status" label="Status na controle" type="select" defaultValue={c.printmasters_status} options={Object.entries(PM_STATUS).map(([value, label]) => ({ value, label }))} />
            <Field name="ruleCode" label="Toegekende regel" type="select" defaultValue={c.printmasters_rule_code ?? ""} options={[{ value: "", label: "Actieve standaardregel" }, ...cfg.printmasters.rules.map((r) => ({ value: r.code, label: `${r.name}${r.active ? "" : " (inactief)"}` }))]} />
            <Field name="note" label="Controle-notitie" />
            <Submit className="btn btn-secondary btn-sm">Status opslaan</Submit>
          </ActionForm>
          <p className="tiny muted">Bij &lsquo;geverifieerd&rsquo; of &lsquo;niet bevestigd&rsquo; krijgt een open voorstel automatisch een nieuwe, definitieve versie.</p>
        </section>
        <section className="card stack">
          <h2 style={{ fontSize: "1.2rem" }}>Contacten</h2>
          <ul>{members.map((m, i) => <li key={i}>{m.name} · {m.email}{m.phone ? ` · ${m.phone}` : ""} <Pill tone={m.status === "active" ? "ok" : "warn"}>{m.role === "customer_admin" ? "beheerder" : "medewerker"} · {m.status === "active" ? "toegang bevestigd" : m.status}</Pill></li>)}</ul>
          <h3>Boxen</h3>
          {boxes.length ? <ul>{boxes.map((b) => <li key={b.id}><Link href={`/beheer/boxen/${b.id}`}>{b.number}</Link> · {b.size} L · {b.location_name}</li>)}</ul> : <p className="muted small">Geen geplaatste boxen.</p>}
        </section>
      </div>

      <section className="stack">
        <h2>Locaties</h2>
        <div className="grid grid-2">{locations.map((l) => (
          <div key={l.id} className="card stack">
            <strong>{l.name}</strong>
            <span className="small">{l.street}, {l.postcode} {l.city}</span>
            {l.instructions && <span className="small muted">Instructies: {l.instructions}</span>}
            <span className="small">Afstand: {l.distance_km === null ? <Pill tone="danger">onbekend: vervoer nog vast te stellen</Pill> : `${l.distance_km} km enkele reis (${l.distance_source})`}</span>
            <ActionForm action={setLocationDistance} className="row" >
              <input type="hidden" name="locationId" value={l.id} />
              <input type="hidden" name="mode" value="manual" />
              <div style={{ flex: "1 1 120px" }}><Field name="km" label="Afstand (km)" /></div>
              <Submit className="btn btn-sm btn-secondary">Vastleggen</Submit>
            </ActionForm>
            <ActionForm action={setLocationDistance}><input type="hidden" name="locationId" value={l.id} /><input type="hidden" name="mode" value="calculate" /><Submit className="btn btn-ghost btn-sm">Opnieuw berekenen via routeberekening</Submit></ActionForm>
          </div>
        ))}</div>
      </section>

      <section className="stack">
        <h2>Voorstellen en persoonlijke prijsafspraken</h2>
        {proposals.map((p) => (
          <div key={p.id} className="card stack">
            <div className="row between">
              <strong>{p.kind === "new" ? "Voorstel" : p.kind === "change" ? "Wijziging" : "Prijswijziging"} {p.request_number ?? ""} v{p.version}</strong>
              <span><Pill tone={p.status === "open" ? "accent" : p.status === "accepted" ? "ok" : "muted"}>{PROPOSAL_STATUS[p.status]}</Pill>{p.provisional && <> <Pill tone="warn">Voorlopig PM-voordeel</Pill></>}{p.offer.personal && <> <Pill>Persoonlijk</Pill></>}</span>
            </div>
            <span className="small">{p.offer.boxLabel} · {p.offer.packageName}{p.offer.frequencyPerYear ? ` · ${p.offer.frequencyPerYear}×/jaar` : ""} · {p.offer.monthlyCents === null ? "maandbedrag nog vast te stellen" : `${formatEuro(p.offer.monthlyCents)}/mnd`} · losse leging {formatEuro(p.offer.singleEmptyingCents)} · afstand {p.offer.distance?.km ?? "?"} km · geldig t/m {formatDate(p.valid_until)} · configuratie {JSON.stringify(p.config_refs)}</span>
            {p.pdf_file_id && <a className="small" href={`/api/files/${p.pdf_file_id}`} target="_blank" rel="noopener">PDF</a>}
            {p.status === "open" && (
              <details>
                <summary className="small" style={{ cursor: "pointer", fontWeight: 700 }}>Nieuwe versie maken (eventueel met persoonlijke afspraak)</summary>
                <ActionForm action={reissueProposalAction} className="stack" >
                  <input type="hidden" name="proposalId" value={p.id} />
                  <div className="grid grid-3">
                    <Field name="boxSize" label="Box" type="select" defaultValue={String(p.offer.boxSize)} options={cfg.pricing.boxes.map((b) => ({ value: String(b.size), label: b.label }))} />
                    <Field name="packageCode" label="Pakket" type="select" defaultValue={p.offer.packageCode} options={pkgOptions} />
                    <Field name="frequency" label="Frequentie (geregeld)" defaultValue={p.offer.frequencyPerYear ?? ""} />
                    <Field name="monthly" label="Persoonlijk maandbedrag (€)" help="Leeg = standaardtarief" />
                    <Field name="single" label="Persoonlijke losse leging (€)" help="Leeg = standaardtarief" />
                    <Field name="note" label="Reden persoonlijke afspraak" />
                  </div>
                  <Submit className="btn btn-sm">Nieuwe versie versturen</Submit>
                </ActionForm>
                <ActionForm action={withdrawProposal} confirm="Voorstel intrekken?"><input type="hidden" name="proposalId" value={p.id} /><Submit className="btn btn-ghost btn-sm">Voorstel intrekken</Submit></ActionForm>
              </details>
            )}
          </div>
        ))}
      </section>

      <section className="stack">
        <h2>Abonnementen en tegoed</h2>
        {subs.map((s) => (
          <div key={s.id} className="card stack">
            <div className="row between"><strong>{s.location_name}</strong><Pill>{SUB_STATUS[s.status]}</Pill></div>
            <span className="small">Start {formatDate(s.started_at)}{s.end_date ? ` · einde ${formatDate(s.end_date)}` : ""}{s.billing_stops_at ? ` · facturatie stopt per ${formatDate(s.billing_stops_at)}` : ""}</span>
            <div className="table-wrap"><table className="table small"><thead><tr><th>Versie</th><th>Status</th><th>Ingang</th><th>Afspraak</th><th>Maand</th></tr></thead>
              <tbody>{s.versions.map((v: any) => <tr key={v.id}><td>{v.version}</td><td>{v.status}</td><td>{formatDate(v.effective_from, { short: true })}</td><td>{v.terms.packageName} · {v.terms.boxLabel}{v.terms.personal ? " · persoonlijk" : ""}</td><td>{formatEuro(v.monthly_cents)}</td></tr>)}</tbody></table></div>
            {s.periods.map((p: any) => (
              <details key={p.id}>
                <summary style={{ cursor: "pointer" }}><strong>Tegoedperiode {formatDate(p.starts_on, { short: true })} – {formatDate(p.ends_on, { short: true })}</strong>: {p.bal.available} beschikbaar, {p.bal.reserved} ingepland, {p.bal.used} gebruikt {p.closed && "(afgesloten)"}</summary>
                <ul className="small">{p.mutations.map((m: any) => <li key={m.id}>{formatDateTime(m.created_at)} · {m.kind} · beschikbaar {m.delta_available >= 0 ? "+" : ""}{m.delta_available}, ingepland {m.delta_reserved >= 0 ? "+" : ""}{m.delta_reserved} · {m.reason}{m.number ? ` · ${m.number}` : ""}</li>)}</ul>
                {u.staff_role === "admin" && (
                  <ActionForm action={creditCorrection} className="row">
                    <input type="hidden" name="periodId" value={p.id} />
                    <div style={{ flex: "0 1 140px" }}><Field name="delta" label="Correctie (+/−)" /></div>
                    <div style={{ flex: "1 1 240px" }}><Field name="reason" label="Reden" required /></div>
                    <Submit className="btn btn-sm btn-secondary">Corrigeren</Submit>
                  </ActionForm>
                )}
              </details>
            ))}
          </div>
        ))}
      </section>

      <section className="card stack">
        <h2 style={{ fontSize: "1.2rem" }}>Afspraken</h2>
        <div className="table-wrap"><table className="table small"><thead><tr><th>Nr</th><th>Type</th><th>Status</th><th>Datum</th><th>Afhandeling</th><th>Financieel</th></tr></thead>
          <tbody>{appts.map((a) => <tr key={a.id}><td><Link href={`/beheer/planning?id=${a.id}`}>{a.number}</Link></td><td>{TYPE[a.type]}</td><td>{appointmentPhase(a)}</td><td>{a.planned_date ? formatDate(a.planned_date, { short: true }) : "–"}</td><td>{FUNDING[a.funding] ?? a.funding}{a.price_cents !== null ? ` · ${formatEuro(a.price_cents)}` : ""}</td><td>{FIN_STATUS[a.financial_status]}</td></tr>)}</tbody></table></div>
      </section>

      <section className="card stack">
        <h2 style={{ fontSize: "1.2rem" }}>Facturen en incasso</h2>
        <div className="table-wrap"><table className="table small"><thead><tr><th>Nr</th><th>Omschrijving</th><th>Totaal</th><th>Status</th><th /></tr></thead>
          <tbody>{invoices.map((i) => <tr key={i.id}><td>{i.pdf_file_id ? <a href={`/api/files/${i.pdf_file_id}`} target="_blank" rel="noopener">{i.number}</a> : i.number ?? "concept"}</td><td>{i.description}</td><td>{formatEuro(i.total_cents)}</td><td>{INVOICE_STATUS[i.status]}</td>
            <td>{u.staff_role === "admin" && !["credited", "concept"].includes(i.status) && !i.credits_invoice_id && <details><summary className="small" style={{ cursor: "pointer" }}>Crediteren</summary><ActionForm action={creditInvoiceAction} className="stack" confirm="Creditfactuur aanmaken?"><input type="hidden" name="invoiceId" value={i.id} /><Field name="reason" label="Reden" required /><Submit className="btn btn-sm btn-danger">Creditfactuur maken</Submit></ActionForm></details>}</td></tr>)}</tbody></table></div>
      </section>

      <div className="grid grid-2" style={{ alignItems: "start" }}>
        <section className="card stack">
          <h2 style={{ fontSize: "1.2rem" }}>Documenten</h2>
          <ul className="small">{files.map((f) => <li key={f.id}><a href={`/api/files/${f.id}`} target="_blank" rel="noopener">{f.filename}</a> · {f.kind} · {formatDate(f.created_at, { short: true })}</li>)}</ul>
          <h2 style={{ fontSize: "1.2rem" }}>Taken</h2>
          <ul className="small">{tasks.map((t) => <li key={t.id}>{t.status === "open" ? <Pill tone="warn">open</Pill> : <Pill tone="muted">{t.status}</Pill>} {t.title}</li>)}</ul>
        </section>
        <section className="card stack">
          <h2 style={{ fontSize: "1.2rem" }}>Tijdlijn</h2>
          <ul className="timeline small">{timeline.map((t, i) => <li key={i}><strong>{formatDateTime(t.at)}</strong> · {t.who}: {t.what}{t.detail && t.detail !== "null" ? <div className="tiny muted" style={{ wordBreak: "break-word" }}>{t.detail.slice(0, 240)}</div> : null}</li>)}</ul>
        </section>
      </div>
    </div>
  );
}
