import Link from "next/link";
import type { Metadata } from "next";
import { Header, Footer } from "@/components/Header";
import { getConfigs } from "@/lib/settings";
import { formatEuro } from "@/lib/money";
import { computeOffer } from "@/lib/pricing";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Prijzen" };

export default async function Prijzen({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const cfg = await getConfigs(["pricing", "packages", "transport", "printmasters"]);
  const raw = sp.box;
  const valid = raw === "250" || raw === "500" || raw === "1000";
  const selected = valid ? Number(raw) : 500;
  const boxes = cfg.pricing.boxes.filter((b) => b.available);
  const pkgs = cfg.packages.items.filter((p) => p.active && !p.archived);
  const vat = cfg.pricing.vatBp / 100;
  const example = computeOffer(cfg, { boxSize: 250, packageCode: "on_demand", frequencyPerYear: null, postcode: null, distance: { km: 10, source: "handmatig" }, printmasters: { status: "none", ruleCode: null } });

  return (
    <>
      <Header />
      <main id="inhoud">
        <div className="container stack-lg">
          <div className="page-head">
            <h1>Prijzen</h1>
            <p className="muted">Alle bedragen zijn exclusief {vat}% btw. Een maatje groter kan altijd.</p>
            {raw && !valid && <p className="notice notice-warn" role="status">Het boxformaat &lsquo;{raw}&rsquo; bestaat niet. Kies 250, 500 of 1.000 liter.</p>}
          </div>

          <section aria-labelledby="formaten" className="stack">
            <h2 id="formaten">Boxformaten</h2>
            <div className="grid grid-3">
              {boxes.map((b) => (
                <article key={b.size} className="card stack" style={b.size === selected ? { outline: "3px solid var(--ink)" } : undefined} aria-current={b.size === selected ? "true" : undefined}>
                  <img src={b.imageUrl} alt="" width={160} height={170} className="box-visual" style={{ maxWidth: 140 }} />
                  <h3>{b.label}</h3>
                  <p className="muted small">{b.description}</p>
                  <p><span className="price-big">{formatEuro(b.monthlyCents)}</span> <span className="muted">per maand</span></p>
                  <p className="small">Losse leging {formatEuro(b.emptyingCents)} + vervoer</p>
                  <p className="tiny muted">Indicatief ongeveer {b.capacityKg} kg kleding</p>
                  <Link className={b.size === selected ? "btn" : "btn btn-secondary"} href={`/keuzehulp?box=${b.size}`}>Kies {b.label}</Link>
                </article>
              ))}
            </div>
          </section>

          <section aria-labelledby="pakketten" className="stack">
            <h2 id="pakketten">Pakketten</h2>
            <div className="grid grid-3">
              {pkgs.map((p) => (
                <article key={p.code} className="card stack">
                  <h3>{p.name}</h3>
                  <p className="muted">{p.tagline}</p>
                  <p className="small">{p.description}</p>
                  {p.kind === "scheduled" && (
                    <ul className="small">{p.frequencies.map((f) => <li key={f.perYear}>{f.perYear} legingen per jaar: {f.discountBp / 100}% korting op het vaste legingsdeel</li>)}</ul>
                  )}
                  {p.kind === "printmasters" && (
                    <ul className="small">{cfg.printmasters.rules.filter((r) => r.active).map((r) => <li key={r.code}>{r.name}: {r.kind === "clothing_minimum" ? boxes.map((b) => `${b.label} vanaf ${r.minimumPiecesPerYear[String(b.size)] ?? "?"} stuks per jaar`).join(", ") : r.description}</li>)}</ul>
                  )}
                  <Link className="btn btn-secondary" href={`/keuzehulp?box=${selected}&pakket=${p.code}`}>Bereken mijn prijs</Link>
                </article>
              ))}
            </div>
          </section>

          <section className="card stack" aria-labelledby="vervoer">
            <h2 id="vervoer">Vervoer</h2>
            <p>Vervoer kost {formatEuro(cfg.transport.centsPerKm)} per kilometer enkele reis vanaf ons depot ({cfg.transport.depotAddress}). Dit tarief dekt ook de terugrit. We ronden de afstand naar boven af op hele kilometers.</p>
            <p className="muted small">Voorbeeld: een losse leging van een 250 literbox op 10 km afstand kost {formatEuro(example.emptyingBaseCents)} + 10 × {formatEuro(cfg.transport.centsPerKm)} = <strong>{formatEuro(example.singleEmptyingCents)}</strong> exclusief btw. In de keuzehulp berekenen we de afstand naar jullie adres.</p>
            <div><Link className="btn" href={`/keuzehulp?box=${selected}`}>Vind mijn box</Link></div>
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
