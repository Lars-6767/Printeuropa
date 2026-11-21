import { requireStaff } from "@/lib/auth";
import { priceUpdateCandidates } from "@/lib/price-updates";
import { formatEuro } from "@/lib/money";
import { firstOfNextMonth, today, addDays } from "@/lib/dates";
import { ActionForm, Field, FieldError, Submit } from "@/components/ActionForm";
import { PageHead, Pill } from "@/components/ui";
import { createPriceUpdates } from "../actions";

export default async function Prijswijziging() {
  await requireStaff(["admin"]);
  const list = await priceUpdateCandidates();
  const changed = list.filter((c) => c.next !== null && c.next !== c.current);
  return (
    <div className="stack-lg">
      <PageHead title="Prijswijziging bestaande klanten" back={{ href: "/beheer/instellingen", label: "Instellingen" }} intro="Nieuwe algemene prijzen gelden standaard alleen voor nieuwe aanbiedingen. Hier stuur je bestaande klanten een wijzigingsvoorstel. Tot de klant akkoord geeft, blijft de vastgelegde prijs gelden." />
      <ActionForm action={createPriceUpdates} className="stack-lg">
        <div className="table-wrap card" style={{ padding: 8 }}><table className="table small">
          <thead><tr><th><span className="sr-only">Selecteer</span></th><th>Klant</th><th>Abonnement</th><th>Nu per maand</th><th>Nieuw per maand</th><th>Losse leging</th><th>Opmerking</th></tr></thead>
          <tbody>{list.map((c) => {
            const differs = c.next !== null && c.next !== c.current;
            return (
              <tr key={c.id}>
                <td><input type="checkbox" name="subscriptionIds" value={c.id} defaultChecked={differs && !c.conflict} disabled={!differs} aria-label={`Selecteer ${c.company_name}`} /></td>
                <td>{c.company_name}</td>
                <td>{c.terms.packageName} · {c.terms.boxLabel}</td>
                <td>{formatEuro(c.current)}</td>
                <td>{differs ? <strong>{formatEuro(c.next)}</strong> : <span className="muted">gelijk</span>}</td>
                <td>{formatEuro(c.currentSingle)} → {formatEuro(c.nextSingle)}</td>
                <td>{c.conflict ? <Pill tone="warn">{c.conflict}</Pill> : null}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
        <section className="card stack">
          <h2 style={{ fontSize: "1.2rem" }}>Communicatie en bevestiging</h2>
          <p className="small">{changed.length} klant(en) krijgen bij selectie een wijzigingsvoorstel per e-mail (template &lsquo;Voorstel klaar&rsquo;) met de oude en nieuwe prijs en de ingangsdatum. De klant bevestigt in Mijn Bereyl. Persoonlijke prijsafspraken zijn standaard niet geselecteerd; een expliciete klantafspraak gaat voor op een algemene regel.</p>
          <Field name="effective" label="Ingangsdatum" type="date" required defaultValue={firstOfNextMonth(addDays(today(), 30))} />
          <label className="check"><input type="checkbox" name="checked" />Ik heb de betrokken klanten, ingangsdatum en klantcommunicatie gecontroleerd</label>
          <FieldError name="checked" />
          <Submit className="btn">Verstuur wijzigingsvoorstellen</Submit>
        </section>
      </ActionForm>
    </div>
  );
}
