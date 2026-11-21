import { requireCustomer, appUrl } from "@/lib/auth";
import { companyOverview } from "@/lib/portal";
import { q } from "@/lib/db";
import { ActionForm, Field, Submit } from "@/components/ActionForm";
import { PageHead, Pill } from "@/components/ui";
import { inviteMemberAction, publicImpactAction, revokeMemberAction, saveLocationAction, updateCompanyAction } from "../actions";

export default async function Bedrijf() {
  const ctx = await requireCustomer();
  const o = await companyOverview(ctx.companyId);
  const c = o.company;
  const members = await q<any>(`SELECT u.id, u.name, u.email, m.role, m.status FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.company_id=$1 AND m.status <> 'revoked' ORDER BY u.name`, [ctx.companyId]);
  const ro = !ctx.isAdmin;
  return (
    <div className="stack-lg">
      <PageHead title="Bedrijfsgegevens" intro={ro ? "Alleen de beheerder van jullie account kan gegevens wijzigen." : "Contacten, locaties, factuuradres en instructies."} />
      <section className="card stack">
        <h2 style={{ fontSize: "1.2rem" }}>{c.name}</h2>
        <ActionForm action={updateCompanyAction} className="stack">
          <div className="grid grid-2">
            <Field name="invoice_email" label="Factuurmailadres" type="email" required defaultValue={c.invoice_email} />
            <Field name="invoice_attn" label="T.a.v." defaultValue={c.invoice_attn} />
            <Field name="invoice_street" label="Factuuradres" required defaultValue={c.invoice_street} />
            <Field name="invoice_postcode" label="Postcode" required defaultValue={c.invoice_postcode} />
            <Field name="invoice_city" label="Plaats" required defaultValue={c.invoice_city} />
            <Field name="coc_number" label="KvK-nummer" defaultValue={c.coc_number} />
            <Field name="vat_number" label="Btw-nummer" defaultValue={c.vat_number} />
          </div>
          {!ro && <Submit className="btn btn-secondary">Opslaan</Submit>}
        </ActionForm>
      </section>
      <section className="stack">
        <h2>Locaties</h2>
        <div className="grid grid-2">
          {o.locations.map((l) => (
            <div key={l.id} className="card">
              <ActionForm action={saveLocationAction} className="stack">
                <input type="hidden" name="id" value={l.id} />
                <Field name="name" label="Naam" required defaultValue={l.name} />
                <Field name="street" label="Straat en huisnummer" required defaultValue={l.street} />
                <div className="grid grid-2">
                  <Field name="postcode" label="Postcode" required defaultValue={l.postcode} />
                  <Field name="city" label="Plaats" required defaultValue={l.city} />
                </div>
                <Field name="instructions" label="Locatie-instructies" type="textarea" defaultValue={l.instructions} />
                <div className="grid grid-2">
                  <Field name="contact_name" label="Contactpersoon ter plaatse" defaultValue={l.contact_name} />
                  <Field name="contact_phone" label="Telefoon" type="tel" defaultValue={l.contact_phone} />
                </div>
                {!ro && <Submit className="btn btn-secondary btn-sm">Locatie opslaan</Submit>}
              </ActionForm>
            </div>
          ))}
          {!ro && (
            <div className="card">
              <h3>Locatie toevoegen</h3>
              <ActionForm action={saveLocationAction} className="stack" resetOnSuccess>
                <Field name="name" label="Naam" required />
                <Field name="street" label="Straat en huisnummer" required />
                <div className="grid grid-2"><Field name="postcode" label="Postcode" required /><Field name="city" label="Plaats" required /></div>
                <Field name="instructions" label="Locatie-instructies" type="textarea" />
                <Submit className="btn btn-sm">Locatie toevoegen</Submit>
              </ActionForm>
            </div>
          )}
        </div>
      </section>
      <section className="card stack">
        <h2 style={{ fontSize: "1.2rem" }}>Contactpersonen en toegang</h2>
        <ul className="stack" style={{ listStyle: "none", padding: 0 }}>
          {members.map((m) => (
            <li key={m.id} className="row between">
              <span><strong>{m.name}</strong> · {m.email} <Pill tone={m.status === "active" ? "ok" : "warn"}>{m.status === "active" ? (m.role === "customer_admin" ? "Beheerder" : "Medewerker") : "Uitnodiging verstuurd"}</Pill></span>
              {!ro && m.id !== ctx.user.id && <ActionForm action={revokeMemberAction} confirm={`Toegang van ${m.name} intrekken?`}><input type="hidden" name="userId" value={m.id} /><Submit className="btn btn-sm btn-ghost">Toegang intrekken</Submit></ActionForm>}
            </li>
          ))}
        </ul>
        {!ro && (
          <ActionForm action={inviteMemberAction} className="stack" resetOnSuccess>
            <h3>Collega uitnodigen</h3>
            <div className="grid grid-3">
              <Field name="name" label="Naam" required />
              <Field name="email" label="E-mailadres" type="email" required />
              <Field name="role" label="Rol" type="select" options={[{ value: "customer_member", label: "Medewerker (legingen aanvragen, inzien)" }, { value: "customer_admin", label: "Beheerder (ook akkoord, wijzigen, stoppen)" }]} />
            </div>
            <Submit className="btn btn-secondary btn-sm">Uitnodiging versturen</Submit>
          </ActionForm>
        )}
      </section>
      <section className="card stack" id="publiek">
        <h2 style={{ fontSize: "1.2rem" }}>Publieke impactpagina</h2>
        <p className="small muted">Laat zien wat jullie inzamelen. Jij kiest wat zichtbaar is. Foto&rsquo;s, documenten en facturen blijven altijd privé.</p>
        {c.public_enabled && c.public_slug && <p className="small">Jullie pagina: <a href={`/impact/${c.public_slug}`} target="_blank" rel="noopener">{appUrl(`/impact/${c.public_slug}`)}</a></p>}
        <ActionForm action={publicImpactAction} className="stack">
          <label className="check"><input type="checkbox" name="public_enabled" defaultChecked={c.public_enabled} disabled={ro} />Publieke impactpagina aan</label>
          <label className="check"><input type="checkbox" name="public_show_name" defaultChecked={c.public_show_name} disabled={ro} />Toon bedrijfsnaam</label>
          <label className="check"><input type="checkbox" name="public_show_logo" defaultChecked={c.public_show_logo} disabled={ro} />Toon logo</label>
          <label className="check"><input type="checkbox" name="public_show_totals" defaultChecked={c.public_show_totals} disabled={ro} />Toon totalen (kilo&rsquo;s en legingen)</label>
          {!ro && <Field name="logo" label="Logo uploaden (PNG, JPG, SVG of WebP, max 10 MB)" type="file" />}
          {!ro && <Submit className="btn btn-secondary btn-sm">Opslaan</Submit>}
        </ActionForm>
      </section>
    </div>
  );
}
