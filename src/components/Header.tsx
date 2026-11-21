import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { FlashRegion } from "./FlashRegion";

export async function Header({ area }: { area?: "public" | "portal" | "admin" }) {
  const user = await currentUser();
  const demo = process.env.DEMO_MODE === "true";
  return (
    <>
    <header className="site-header">
      <a href="#inhoud" className="skip">Naar de inhoud</a>
      <div className="container">
        <div className="row" style={{ gap: 10 }}>
          <Link href="/" className="logo" aria-label="Bereyl, naar de homepage">Bereyl<span className="dot" aria-hidden="true" />{area === "portal" && <small>Mijn Bereyl</small>}{area === "admin" && <small>Beheer</small>}</Link>
          {demo && <span className="demo-badge" title="Deze omgeving bevat herkenbare demonstratiegegevens">DEMO</span>}
        </div>
        <nav aria-label="Account" className="row" style={{ gap: 6 }}>
          {user ? (
            <>
              {user.staff_role && area !== "admin" && <Link className="btn btn-sm btn-secondary" href="/beheer">Beheer</Link>}
              {area !== "portal" && !user.staff_role && <Link className="btn btn-sm btn-secondary" href="/portaal">Mijn Bereyl</Link>}
              <form action="/uitloggen" method="post"><button className="btn btn-sm btn-ghost" type="submit">Uitloggen</button></form>
            </>
          ) : (
            <Link className="btn btn-sm" href="/inloggen">Inloggen</Link>
          )}
        </nav>
      </div>
    </header>
    <div className="container"><FlashRegion /></div>
    </>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="container row between">
        <span>Bereyl · Minervum 7290F, 4817 ZM Breda</span>
        <span><Link href="/prijzen">Prijzen</Link> · <Link href="/inloggen">Inloggen</Link></span>
      </div>
    </footer>
  );
}
