import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { one, q } from "@/lib/db";
import { formatKg } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { DESTINATION } from "@/lib/labels";
import { ActionForm, Field, Submit, FieldError } from "@/components/ActionForm";
import { PageHead, Pill } from "@/components/ui";
import { assignToBatch, releaseCertificateAction, updateBatch, uploadCertificate } from "../../actions";

export default async function Partij({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireStaff(["admin"]);
  const b = await one<any>(`SELECT * FROM processing_batches WHERE id=$1`, [Number(id)]);
  if (!b) notFound();
  const [inBatch, available, certs] = await Promise.all([
    q<any>(`SELECT c.*, co.name AS company_name FROM collections c JOIN companies co ON co.id=c.company_id WHERE c.batch_id=$1 ORDER BY co.name`, [b.id]),
    q<any>(`SELECT c.*, co.name AS company_name FROM collections c JOIN companies co ON co.id=c.company_id WHERE c.batch_id IS NULL AND c.status='weight_confirmed' ORDER BY c.collected_at`, []),
    q<any>(`SELECT ce.*, (SELECT json_agg(json_build_object('company', co.name, 'at', cr.released_at, 'statement', cr.statement_file_id)) FROM certificate_releases cr JOIN companies co ON co.id=cr.company_id WHERE cr.certificate_id=ce.id) AS releases FROM certificates ce WHERE ce.batch_id=$1 ORDER BY ce.id`, [b.id]),
  ]);
  const companies = [...new Map(inBatch.map((c) => [c.company_id, c.company_name])).entries()];
  return (
    <div className="stack-lg">
      <PageHead title={`Partij ${b.number}`} back={{ href: "/beheer/partijen", label: "Partijen" }} intro={`Verwerker: ${b.processor}`} />
      <section className="card stack">
        <h2 style={{ fontSize: "1.2rem" }}>Bestemming</h2>
        <ActionForm action={updateBatch} className="stack">
          <input type="hidden" name="batchId" value={b.id} />
          <div className="grid grid-2">
            <Field name="destination" label="Werkelijke bestemming" type="select" defaultValue={b.destination ?? ""} options={[{ value: "", label: "Nog niet bekend" }, ...Object.entries(DESTINATION).map(([value, label]) => ({ value, label }))]} />
            <Field name="note" label="Toelichting" defaultValue={b.destination_note} />
          </div>
          <label className="check"><input type="checkbox" name="processed" defaultChecked={b.status === "processed"} />Verwerking bevestigd door de verwerker</label>
          <Submit className="btn btn-sm btn-secondary">Opslaan</Submit>
        </ActionForm>
      </section>
      <section className="card stack">
        <h2 style={{ fontSize: "1.2rem" }}>Inzamelingen in deze partij ({inBatch.length} · {formatKg(inBatch.reduce((s, c) => s + c.net_weight_grams, 0))})</h2>
        <ul className="small">{inBatch.map((c) => <li key={c.id}>{c.company_name} · {formatDate(c.collected_at, { short: true })} · {formatKg(c.net_weight_grams)}</li>)}</ul>
        {available.length > 0 && (
          <ActionForm action={assignToBatch} className="stack">
            <input type="hidden" name="batchId" value={b.id} />
            <fieldset className="stack"><legend>Gewogen inzamelingen zonder partij</legend>
              {available.map((c) => <label key={c.id} className="check"><input type="checkbox" name="collectionIds" value={c.id} />{c.company_name} · {formatDate(c.collected_at, { short: true })} · {formatKg(c.net_weight_grams)}</label>)}
            </fieldset>
            <Submit className="btn btn-sm">Koppel aan partij</Submit>
          </ActionForm>
        )}
      </section>
      <section className="card stack">
        <h2 style={{ fontSize: "1.2rem" }}>Certificaten</h2>
        {certs.map((ce) => (
          <div key={ce.id} className="card-soft stack">
            <div className="row between"><strong>{ce.title}</strong><Pill tone={ce.status === "released" ? "ok" : "warn"}>{ce.status === "released" ? "Vrijgegeven" : "Concept"}</Pill></div>
            {ce.file_id && <a href={`/api/files/${ce.file_id}`} target="_blank" rel="noopener">Bekijk het certificaat (PDF)</a>}
            {(ce.releases ?? []).length > 0 && <ul className="small">{ce.releases.map((r: any, i: number) => <li key={i}>{r.company} · {formatDate(r.at, { short: true })}{r.statement ? <> · <a href={`/api/files/${r.statement}`} target="_blank" rel="noopener">verklaring</a></> : null}</li>)}</ul>}
            <ActionForm action={releaseCertificateAction} className="stack">
              <input type="hidden" name="certificateId" value={ce.id} />
              <fieldset className="stack"><legend>Ontvangers (alleen geselecteerde klanten krijgen toegang)</legend>
                {companies.map(([cid, name]) => <label key={cid} className="check"><input type="checkbox" name="companyIds" value={cid} defaultChecked />{name}</label>)}
              </fieldset>
              <label className="check"><input type="checkbox" name="statements" defaultChecked />Maak per klant een klantspecifieke verklaring met eigen inzamelingen</label>
              <label className="check"><input type="checkbox" name="checked" />Ik heb het document en de gekoppelde klanten gecontroleerd</label>
              <FieldError name="checked" />
              <Submit className="btn btn-sm">Vrijgeven aan geselecteerde klanten</Submit>
            </ActionForm>
          </div>
        ))}
        <ActionForm action={uploadCertificate} className="stack">
          <input type="hidden" name="batchId" value={b.id} />
          <h3>Certificaat toevoegen</h3>
          <Field name="title" label="Titel" required defaultValue={`Verwerkingscertificaat partij ${b.number}`} />
          <Field name="file" label="PDF" type="file" required />
          <Submit className="btn btn-sm btn-secondary">Uploaden</Submit>
        </ActionForm>
      </section>
    </div>
  );
}
