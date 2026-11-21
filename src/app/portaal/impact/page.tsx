import { requireCustomer } from "@/lib/auth";
import { companyImpact } from "@/lib/impact";
import { companyOverview } from "@/lib/portal";
import { formatKg } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { DESTINATION } from "@/lib/labels";
import { PageHead, Empty, Pill } from "@/components/ui";
import { LocationFilter } from "../LocationFilter";
import Link from "next/link";

export default async function Impact({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCustomer();
  const loc = sp.locatie ? Number(sp.locatie) : null;
  const from = sp.van && /^\d{4}-\d{2}-\d{2}$/.test(sp.van) ? sp.van : undefined;
  const to = sp.tot && /^\d{4}-\d{2}-\d{2}$/.test(sp.tot) ? sp.tot : undefined;
  const [imp, o] = await Promise.all([companyImpact(ctx.companyId, { from, to, locationId: loc }), companyOverview(ctx.companyId)]);
  return (
    <div className="stack-lg">
      <PageHead title="Mijn impact" intro="Inzamelen en verwerken zijn twee stappen: eerst wegen we wat we ophalen, daarna bevestigt de verwerker wat ermee gebeurt." />
      <form className="card grid grid-3" method="get" style={{ alignItems: "end" }}>
        <div className="field"><label htmlFor="van">Van</label><input id="van" type="date" name="van" defaultValue={from} /></div>
        <div className="field"><label htmlFor="tot">Tot en met</label><input id="tot" type="date" name="tot" defaultValue={to} /></div>
        {loc && <input type="hidden" name="locatie" value={loc} />}
        <button className="btn btn-secondary" type="submit">Filter periode</button>
      </form>
      {o.locations.length > 1 && <LocationFilter locations={o.locations} current={loc} />}
      <div className="grid grid-3">
        <div className="card"><p className="small muted">Ingezameld (gewogen)</p><p className="impact-number" style={{ fontSize: "2.6rem" }}>{formatKg(imp.grams)}</p></div>
        <div className="card"><p className="small muted">Uitgevoerde legingen</p><p className="impact-number" style={{ fontSize: "2.6rem" }}>{imp.executedEmptyings}</p></div>
        <div className="card">
          <p className="small muted">Verwerking (bevestigd)</p>
          {imp.byDestination.length ? imp.byDestination.map((d) => <p key={d.destination} style={{ margin: 0 }}><strong>{DESTINATION[d.destination]}</strong>: {formatKg(d.grams)}</p>) : <p className="muted small">Nog geen verwerking bevestigd.</p>}
        </div>
      </div>
      {imp.indicators.length > 0 && (
        <div className="card-soft stack">
          {imp.indicators.map((m) => <p key={m.code} style={{ margin: 0 }}><strong>{m.label}</strong>: ongeveer {m.value.toLocaleString("nl-NL")} {m.unit} <span className="small muted">(schatting · methode {m.method}, versie {m.version}, bron {m.source})</span></p>)}
        </div>
      )}
      <section className="stack">
        <h2>Historie</h2>
        {imp.history.length === 0 ? <Empty title="Nog geen inzamelingen">Na de eerste leging zie je hier datum, foto&rsquo;s en gewicht.</Empty> : (
          <div className="table-wrap card" style={{ padding: 8 }}>
            <table className="table">
              <thead><tr><th>Datum</th><th>Vestiging</th><th>Status</th><th>Gewicht</th><th>Verwerking</th><th>Foto&rsquo;s</th></tr></thead>
              <tbody>{imp.history.map((h) => (
                <tr key={h.id}>
                  <td className="nowrap">{formatDate(h.collected_at, { short: true })}</td>
                  <td>{h.location_name}</td>
                  <td>{h.status === "weight_confirmed" ? <Pill tone="ok">Gewicht bevestigd</Pill> : <Pill tone="warn">Opgehaald, weging volgt</Pill>}</td>
                  <td>{h.status === "weight_confirmed" ? formatKg(h.net_weight_grams) : "–"}{Number(h.corrections) > 0 && <span className="tiny muted"> (gecorrigeerd)</span>}</td>
                  <td>{h.batch_status === "processed" && h.destination ? DESTINATION[h.destination] : <span className="muted">Nog niet bevestigd</span>}</td>
                  <td>{(h.photos ?? []).map((f: number, i: number) => <a key={f} href={`/api/files/${f}`} target="_blank" rel="noopener">Foto {i + 1} </a>)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
      <p className="small"><Link href="/portaal/documenten">Certificaten en verklaringen</Link> · <Link href="/portaal/bedrijf#publiek">Publieke impactpagina instellen</Link></p>
    </div>
  );
}
