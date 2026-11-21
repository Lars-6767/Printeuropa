import Link from "next/link";
import { requireCustomer } from "@/lib/auth";
import { companyOverview } from "@/lib/portal";
import { companyImpact } from "@/lib/impact";
import { formatEuro, formatKg } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { creditText } from "@/lib/credit";
import { appointmentPhase, TYPE } from "@/lib/labels";
import { Flash, Pill } from "@/components/ui";

export default async function Overzicht({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCustomer();
  const o = await companyOverview(ctx.companyId);
  const impact = await companyImpact(ctx.companyId);
  const placement = o.upcoming.find((a) => a.type === "placement");
  const active = o.subscriptions.filter((s) => s.status === "active" || s.status === "ending");
  const next = o.upcoming.find((a) => a.type !== "placement") ?? placement;
  const proposal = o.openProposals[0];
  const firstName = ctx.user.name.split(" ")[0];

  let action: { title: string; text: string; href: string; label: string };
  if (proposal && proposal.kind !== "change") {
    action = proposal.provisional
      ? { title: "We controleren jullie PrintMasters-afspraak", text: "Daarna ontvang je de definitieve prijs om akkoord te geven. Je kunt het voorstel alvast bekijken.", href: `/portaal/voorstel/${proposal.id}`, label: "Bekijk het voorstel" }
      : { title: "Je voorstel staat klaar", text: `${proposal.offer.boxLabel} · ${proposal.offer.packageName} · ${proposal.offer.monthlyCents === null ? "prijs nog vast te stellen" : formatEuro(proposal.offer.monthlyCents) + " per maand excl. btw"}`, href: `/portaal/voorstel/${proposal.id}`, label: "Bekijk mijn voorstel" };
  } else if (placement) {
    action = { title: placement.request_status === "confirmed" ? `Plaatsing op ${formatDate(placement.planned_date, { weekday: true })}` : "We plannen de plaatsing", text: placement.request_status === "confirmed" ? "De afspraak staat vast. Je ontvangt een herinnering." : "We hebben je voorkeur ontvangen en bevestigen de datum zo snel mogelijk.", href: "/portaal/afspraken", label: "Volg de plaatsing" };
  } else if (active.length) {
    action = { title: "Is de box vol?", text: active[0].credit ? creditText(active[0].credit) + "." : "Vraag een leging aan wanneer het jullie uitkomt.", href: "/portaal/afspraken/nieuw", label: "Leging aanvragen" };
  } else {
    action = { title: "Welkom bij Mijn Bereyl", text: "Er staat nog geen box of voorstel klaar. Vraag een voorstel aan om te beginnen.", href: "/keuzehulp", label: "Vind mijn box" };
  }

  return (
    <div className="stack-lg">
      <Flash searchParams={sp} />
      {sp.melding === "alleen-beheerder" && <p className="notice notice-warn">Deze actie is alleen beschikbaar voor de beheerder van jullie account.</p>}
      <div>
        <h1>Hoi {firstName}</h1>
        <p className="muted">{o.company.name}</p>
      </div>
      <section className="next-action stack" aria-labelledby="volgende">
        <h2 id="volgende" style={{ margin: 0 }}>{action.title}</h2>
        <p className="muted" style={{ margin: 0 }}>{action.text}</p>
        <div><Link className="btn" href={action.href}>{action.label}</Link></div>
      </section>

      {!active.length && !placement && proposal && (
        <section className="card stack" aria-labelledby="hoe">
          <h2 id="hoe" style={{ fontSize: "1.2rem" }}>Wat gebeurt er nu?</h2>
          <ol className="steps">
            <li>Je bekijkt het voorstel en kiest &lsquo;Akkoord en plaatsing aanvragen&rsquo;.</li>
            <li>Bereyl bevestigt de plaatsingsafspraak op een van je voorkeursdagen.</li>
            <li>We plaatsen de box. Daarna vraag je hier legingen aan en volg je jullie impact.</li>
          </ol>
        </section>
      )}

      <div className="grid grid-3">
        <section className="card" aria-labelledby="impact-k">
          <h2 id="impact-k" className="small muted" style={{ fontSize: ".9rem" }}>Ingezameld</h2>
          <p className="price-big">{formatKg(impact.grams)}</p>
          <p className="small muted">{impact.executedEmptyings} legingen · <Link href="/portaal/impact">Mijn impact</Link></p>
        </section>
        <section className="card" aria-labelledby="afspraak-k">
          <h2 id="afspraak-k" className="small muted" style={{ fontSize: ".9rem" }}>Volgende afspraak</h2>
          {next ? (
            <>
              <p style={{ fontWeight: 800, fontSize: "1.2rem", margin: 0 }}>{TYPE[next.type]} · {next.planned_date ? formatDate(next.planned_date, { weekday: true, short: true }) : "datum volgt"}</p>
              <p className="small"><Pill>{appointmentPhase(next)}</Pill> {next.location_name}</p>
            </>
          ) : <p className="muted">Geen afspraken gepland.</p>}
        </section>
        <section className="card" aria-labelledby="tegoed-k">
          <h2 id="tegoed-k" className="small muted" style={{ fontSize: ".9rem" }}>Tegoed</h2>
          {active.length ? active.map((s) => (
            <div key={s.id}>
              <p style={{ fontWeight: 800, margin: 0 }}>{s.credit?.period ? `Nog ${s.credit.available} ${s.credit.available === 1 ? "leging" : "legingen"} beschikbaar` : "Losse legingen"}</p>
              <p className="small muted">{s.credit?.period ? `${s.credit.reserved} ingepland · periode ${formatDate(s.credit.period.starts_on, { short: true })} t/m ${formatDate(s.credit.period.ends_on)}` : s.location_name}</p>
            </div>
          )) : <p className="muted">Nog geen actief abonnement.</p>}
        </section>
      </div>
    </div>
  );
}
