import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/Header";
import { ActionForm, Field, Submit } from "@/components/ActionForm";
import { requestLoginLink } from "./actions";

export const metadata: Metadata = { title: "Inloggen" };

export default async function Inloggen({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return (
    <>
      <Header />
      <main id="inhoud">
        <div className="container narrow stack-lg">
          <div>
            <h1>Inloggen bij Mijn Bereyl</h1>
            <p className="muted">Vul je e-mailadres in. We sturen je een persoonlijke link waarmee je direct bent ingelogd. Je hebt geen wachtwoord nodig.</p>
          </div>
          {sp.verlopen && <p className="notice notice-warn" role="status">Deze inloglink is verlopen of al gebruikt. Vraag hieronder eenvoudig een nieuwe aan.</p>}
          <section className="card stack" aria-label="Inloglink aanvragen">
            <ActionForm action={requestLoginLink} className="stack" persistKey="login-link">
              <input type="hidden" name="next" value={sp.next ?? ""} />
              <Field name="email" label="E-mailadres" type="email" autoComplete="email" required />
              <Submit pendingText="Link versturen…">Stuur mij een inloglink</Submit>
            </ActionForm>
            <ul className="small muted" style={{ paddingLeft: 18, margin: 0 }}>
              <li>De link werkt één keer en is kort geldig.</li>
              <li>Open de link op het apparaat waarop je wilt inloggen.</li>
              <li>Geen e-mail? Kijk in je spam of vraag na een paar minuten een nieuwe link aan.</li>
            </ul>
          </section>
          <p className="muted small">Nog geen klant? <Link href="/keuzehulp">Vind je box</Link> en vraag een voorstel aan.</p>
        </div>
      </main>
    </>
  );
}
