import Link from "next/link";
export default function GeenBedrijf() {
  return (
    <div className="container narrow"><div className="card stack">
      <h1>Nog geen bedrijf gekoppeld</h1>
      <p>Je account is nog niet aan een bedrijf gekoppeld. Open de link uit je voorstel- of uitnodigingsmail om de toegang te bevestigen, of vraag een voorstel aan.</p>
      <div className="row"><Link className="btn" href="/keuzehulp">Vind mijn box</Link><Link className="btn btn-secondary" href="/inloggen">Nieuwe inloglink</Link></div>
    </div></div>
  );
}
