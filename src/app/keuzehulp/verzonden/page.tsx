import Link from "next/link";
import { Header } from "@/components/Header";

export default async function Verzonden({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return (
    <>
      <Header />
      <main id="inhoud">
        <div className="container narrow">
          <div className="hero-card stack">
            <span className="pill pill-accent">Aanvraag {sp.nr}</span>
            <h1>Je voorstel is onderweg</h1>
            <p>We sturen het voorstel als PDF naar je e-mail, samen met een persoonlijke link naar Mijn Bereyl. Daar bekijk je alles rustig en geef je akkoord.</p>
            <ol className="steps">
              <li>Open de e-mail &lsquo;Jouw Bereyl-voorstel staat klaar&rsquo;.</li>
              <li>Klik op &lsquo;Bekijk mijn voorstel&rsquo; en kies &lsquo;Akkoord en plaatsing aanvragen&rsquo;.</li>
              <li>Wij bevestigen de plaatsingsafspraak.</li>
            </ol>
            <p className="muted small">Geen e-mail ontvangen? Kijk in je spam of vraag via de inlogpagina een nieuwe inloglink aan.</p>
            <div className="row"><Link className="btn" href="/inloggen">Naar inloggen</Link><Link className="btn btn-ghost" href="/">Naar de homepage</Link></div>
          </div>
        </div>
      </main>
    </>
  );
}
