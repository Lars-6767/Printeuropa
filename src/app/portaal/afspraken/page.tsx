import Link from "next/link";
import { requireCustomer } from "@/lib/auth";
import { appointmentsFor, companyOverview } from "@/lib/portal";
import { formatDate } from "@/lib/dates";
import { formatEuro, formatKg } from "@/lib/money";
import { appointmentPhase, FUNDING, TYPE } from "@/lib/labels";
import { getConfig } from "@/lib/settings";
import { PageHead, Empty, Pill, Flash } from "@/components/ui";
import { LocationFilter } from "../LocationFilter";

export default async function Afspraken({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCustomer();
  const loc = sp.locatie ? Number(sp.locatie) : null;
  const [list, o, planning] = await Promise.all([appointmentsFor(ctx.companyId, loc), companyOverview(ctx.companyId), getConfig("planning")]);
  const open = list.filter((a) => a.execution_status === "pending" && a.request_status !== "cancelled");
  const done = list.filter((a) => !(a.execution_status === "pending" && a.request_status !== "cancelled"));
  const hasActive = o.subscriptions.some((s) => s.status === "active" || s.status === "ending");
  const dp = (c: string | null) => planning.dayparts.find((d) => d.code === c)?.label ?? "";
  const row = (a: any) => (
    <li key={a.id} className="card stack" style={{ padding: 18 }}>
      <div className="row between">
        <strong>{TYPE[a.type]} · {a.number}</strong>
        <Pill tone={a.request_status === "confirmed" ? "ok" : a.request_status === "cancelled" ? "muted" : "warn"}>{appointmentPhase(a)}</Pill>
      </div>
      <p className="small" style={{ margin: 0 }}>
        {a.planned_date ? `${formatDate(a.planned_date, { weekday: true })} ${dp(a.planned_daypart)}` : a.request_status === "cancelled" ? "Geannuleerd" : "Datum volgt: Bereyl bevestigt"} · {a.location_name}
      </p>
      {a.type === "emptying" && <p className="small muted" style={{ margin: 0 }}>{FUNDING[a.funding] ?? ""}{a.funding === "paid" && a.price_cents !== null ? `: ${formatEuro(a.price_cents)} excl. btw` : ""}{a.combine_printmasters && a.combination_status === "requested" ? " · Combinatie aangevraagd" : ""}</p>}
      {a.net_weight_grams ? <p className="small" style={{ margin: 0 }}>Gewicht: {formatKg(a.net_weight_grams)}</p> : null}
      {a.execution_status === "pending" && a.request_status !== "cancelled" && <div><Link className="btn btn-sm btn-secondary" href={`/portaal/afspraken/${a.id}`}>Bekijk of wijzig</Link></div>}
    </li>
  );
  return (
    <div className="stack-lg">
      <PageHead title="Afspraken" intro="Plaatsing, legingen, omruilen en definitief ophalen. Bereyl bevestigt iedere afspraak." actions={hasActive ? <Link className="btn" href="/portaal/afspraken/nieuw">Leging aanvragen</Link> : undefined} />
      <Flash searchParams={sp} />
      {o.locations.length > 1 && <LocationFilter locations={o.locations} current={loc} />}
      <section className="stack" aria-labelledby="lopend">
        <h2 id="lopend">Lopend</h2>
        {open.length ? <ul className="stack" style={{ listStyle: "none", padding: 0 }}>{open.map(row)}</ul> : <Empty title="Geen lopende afspraken">{hasActive ? "Is de box vol? Vraag een leging aan." : "Na akkoord op je voorstel verschijnt hier de plaatsing."}</Empty>}
      </section>
      {done.length > 0 && (
        <section className="stack" aria-labelledby="historie">
          <h2 id="historie">Historie</h2>
          <ul className="stack" style={{ listStyle: "none", padding: 0 }}>{done.map(row)}</ul>
        </section>
      )}
    </div>
  );
}
