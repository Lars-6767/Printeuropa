import Link from "next/link";
import { requireCustomer } from "@/lib/auth";
import { companyOverview } from "@/lib/portal";
import { formatEuro } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { SUB_STATUS } from "@/lib/labels";
import { offerRows } from "@/lib/documents";
import { PageHead, Empty, Pill, KV, Flash } from "@/components/ui";

export default async function Abonnement({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCustomer();
  const o = await companyOverview(ctx.companyId);
  return (
    <div className="stack-lg">
      <PageHead title="Abonnement" intro="Pakket, tarieven, periode en legingstegoed. Wijzigen of stoppen regel je hier zelf." />
      <Flash searchParams={sp} />
      {o.subscriptions.length === 0 && <Empty title="Nog geen abonnement">Na akkoord op je voorstel staat je abonnement hier.</Empty>}
      {o.subscriptions.map((s) => (
        <section key={s.id} className="card stack">
          <div className="row between">
            <h2 style={{ margin: 0 }}>{s.terms?.packageName} · {s.terms?.boxLabel}</h2>
            <Pill tone={s.status === "active" ? "ok" : s.status === "ending" ? "warn" : "muted"}>{SUB_STATUS[s.status]}</Pill>
          </div>
          <p className="muted small" style={{ margin: 0 }}>{s.location_name}, {s.city}{s.started_at ? ` · gestart ${formatDate(s.started_at)}` : ""}{s.end_date ? ` · einddatum ${formatDate(s.end_date)}` : ""}</p>
          <div className="grid grid-2">
            <div className="stack">
              <h3>Lopende afspraak</h3>
              <KV rows={offerRows(s.terms).filter(([k]) => !["Jaarindicatie"].includes(k))} />
            </div>
            <div className="stack">
              <h3>Legingstegoed</h3>
              {s.credit?.period ? (
                <>
                  <p style={{ fontWeight: 800, fontSize: "1.2rem", margin: 0 }}>Nog {s.credit.available} {s.credit.available === 1 ? "leging" : "legingen"} beschikbaar</p>
                  <p className="small" style={{ margin: 0 }}>{s.credit.reserved} ingepland · {s.credit.used} gebruikt</p>
                  <p className="small muted">Periode {formatDate(s.credit.period.starts_on)} t/m {formatDate(s.credit.period.ends_on)}. Ongebruikte legingen schuiven niet automatisch door.</p>
                </>
              ) : <p className="muted small">{s.status === "pending_placement" ? "Het tegoed start bij plaatsing." : "Dit pakket heeft geen inbegrepen legingen; je betaalt per leging."}</p>}
              {s.scheduled && (
                <div className="notice">
                  <strong>Gepland per {formatDate(s.scheduled.effective_from)}:</strong> {s.scheduled.package_name} · {s.scheduled.box_size} liter · {formatEuro(s.scheduled.monthly_cents)} per maand
                </div>
              )}
            </div>
          </div>
          {ctx.isAdmin && s.status === "active" && (
            <div className="row">
              <Link className="btn btn-secondary" href={`/portaal/abonnement/wijzigen?sub=${s.id}`}>Pakket of formaat wijzigen</Link>
              <Link className="btn btn-ghost" href={`/portaal/abonnement/stoppen?sub=${s.id}`}>Abonnement stoppen en box laten ophalen</Link>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
