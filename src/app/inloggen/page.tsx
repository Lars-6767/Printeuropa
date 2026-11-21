import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/Header";
import { ActionForm, Field, Submit } from "@/components/ActionForm";
import { passwordLogin, requestLoginLink } from "./actions";

export const metadata: Metadata = { title: "Inloggen" };

export default async function Inloggen({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return (
    <>
      <Header />
      <main id="inhoud">
        <div className="container narrow stack-lg">
          <h1>Inloggen bij Mijn Bereyl</h1>
          {sp.verlopen && <p className="notice notice-warn" role="status">Deze inloglink is verlopen of al gebruikt. Vraag hieronder eenvoudig een nieuwe aan.</p>}
          <div className="grid grid-2" style={{ alignItems: "start" }}>
            <section className="card stack" aria-labelledby="link-titel">
              <h2 id="link-titel" style={{ fontSize: "1.25rem" }}>Inloggen met een e-maillink</h2>
              <p className="muted small">Geen wachtwoord nodig. We sturen een persoonlijke, tijdelijke link.</p>
              <ActionForm action={requestLoginLink} className="stack" persistKey="login-link">
                <input type="hidden" name="next" value={sp.next ?? ""} />
                <Field name="email" label="E-mailadres" type="email" autoComplete="email" required />
                <Submit>Stuur mij een inloglink</Submit>
              </ActionForm>
            </section>
            <section className="card stack" aria-labelledby="pw-titel">
              <h2 id="pw-titel" style={{ fontSize: "1.25rem" }}>Inloggen met wachtwoord</h2>
              <ActionForm action={passwordLogin} className="stack">
                <input type="hidden" name="next" value={sp.next ?? ""} />
                <Field name="email" label="E-mailadres" type="email" autoComplete="username" required />
                <Field name="password" label="Wachtwoord" type="password" autoComplete="current-password" required />
                <Submit>Inloggen</Submit>
              </ActionForm>
              <p className="small"><Link href="/wachtwoord">Wachtwoord vergeten of nog niet ingesteld?</Link></p>
            </section>
          </div>
          <p className="muted small">Nog geen klant? <Link href="/keuzehulp">Vind je box</Link> en vraag een voorstel aan.</p>
        </div>
      </main>
    </>
  );
}
