import Link from "next/link";
import { Header, Footer } from "@/components/Header";
import { getConfig } from "@/lib/settings";
import { publicTotal } from "@/lib/impact";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [home, pricing, total] = await Promise.all([getConfig("homepage"), getConfig("pricing"), publicTotal()]);
  const kg = Math.round(total.grams / 1000);
  return (
    <>
      <Header />
      <main id="inhoud">
        <div className="container stack-lg">
          <section className="hero-card grid grid-2" style={{ alignItems: "center" }} aria-labelledby="hoofdtitel">
            <div className="stack">
              <h1 id="hoofdtitel">{home.title}</h1>
              <p style={{ fontSize: "1.2rem" }} className="muted">{home.subtitle}</p>
              <div className="row">
                <Link className="btn" href="/keuzehulp">{home.primaryAction}</Link>
                <Link className="btn btn-secondary" href="/prijzen">{home.pricesAction}</Link>
                <Link className="btn btn-ghost" href="/inloggen">{home.loginAction}</Link>
              </div>
            </div>
            <img className="box-visual" src={pricing.boxes[1]?.imageUrl ?? "/boxes/box-500.svg"} alt="Een Bereyl-inzamelbox" width={280} height={300} />
          </section>

          {home.showImpact && (
            <section className="card-soft grid grid-2" aria-labelledby="impact-titel" style={{ alignItems: "center" }}>
              <div>
                <h2 id="impact-titel" className="sr-only">Impact</h2>
                {total.grams > 0 ? (
                  <>
                    <p className="impact-number" aria-live="polite">{kg.toLocaleString("nl-NL")}</p>
                    <p style={{ fontWeight: 700 }}>{home.impactLabel}</p>
                    {total.includesDemo && <p className="small"><span className="demo-badge">DEMO</span> Inclusief demonstratiegegevens.</p>}
                  </>
                ) : (
                  <>
                    <p className="impact-number">0</p>
                    <p style={{ fontWeight: 700 }}>{home.impactLabel}</p>
                    <p className="muted">{home.impactEmptyText}</p>
                  </>
                )}
              </div>
              <p className="muted">Het totaal is de som van alle bevestigde wegingen. Geschatte hoeveelheden tellen niet mee.</p>
            </section>
          )}

          <section className="grid grid-3" aria-label="Zo werkt het">
            <div className="card"><h3>1. Vind je box</h3><p className="muted">Een paar vragen over jullie werkkleding en je ziet direct welke box past en wat het kost.</p></div>
            <div className="card"><h3>2. Geef akkoord</h3><p className="muted">Je ontvangt een voorstel als PDF en geeft akkoord in Mijn Bereyl. Wij plannen de plaatsing.</p></div>
            <div className="card"><h3>3. Laat legen</h3><p className="muted">Is de box vol? Vraag een leging aan. Na weging zie je jullie impact terug.</p></div>
          </section>
          <p className="muted">{home.explanation}</p>
        </div>
      </main>
      <Footer />
    </>
  );
}
