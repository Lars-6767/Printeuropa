import Link from "next/link";
import { requireCustomer } from "@/lib/auth";
import { boxesFor, companyOverview } from "@/lib/portal";
import { PageHead, Empty, Pill } from "@/components/ui";
import { LocationFilter } from "../LocationFilter";
import { SUB_STATUS } from "@/lib/labels";

export default async function Boxen({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCustomer();
  const loc = sp.locatie ? Number(sp.locatie) : null;
  const [boxes, o] = await Promise.all([boxesFor(ctx.companyId, loc), companyOverview(ctx.companyId)]);
  const pending = o.subscriptions.filter((s) => s.status === "pending_placement" && (!loc || s.location_id === loc));
  return (
    <div className="stack-lg">
      <PageHead title="Mijn boxen" intro="Formaat, boxnummer, locatie en status van jullie boxen." />
      {o.locations.length > 1 && <LocationFilter locations={o.locations} current={loc} />}
      {boxes.length === 0 && pending.length === 0 && <Empty title="Nog geen box geplaatst" action={<Link className="btn" href="/portaal">Naar het overzicht</Link>}>Na akkoord en plaatsing zie je hier jullie box.</Empty>}
      <div className="grid grid-2">
        {pending.map((s) => (
          <article key={`p${s.id}`} className="card stack">
            <h2 style={{ fontSize: "1.2rem" }}>{s.terms?.boxLabel} · {s.location_name}</h2>
            <p><Pill tone="warn">{SUB_STATUS[s.status]}</Pill></p>
            <p className="small muted">We plaatsen de box zodra de afspraak is bevestigd.</p>
          </article>
        ))}
        {boxes.map((b) => (
          <article key={b.id} className="card stack">
            <div className="row between"><h2 style={{ fontSize: "1.2rem", margin: 0 }}>{b.size} liter</h2><Pill tone="ok">Geplaatst</Pill></div>
            <dl className="kv"><dt>Boxnummer</dt><dd>{b.number}</dd><dt>Locatie</dt><dd>{b.location_name}, {b.street}, {b.city}</dd></dl>
            <div className="row">
              <Link className="btn btn-sm" href={`/portaal/afspraken/nieuw?locatie=${b.location_id}`}>Leging aanvragen</Link>
              {ctx.isAdmin && <Link className="btn btn-sm btn-secondary" href="/portaal/abonnement">Formaat wijzigen</Link>}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
