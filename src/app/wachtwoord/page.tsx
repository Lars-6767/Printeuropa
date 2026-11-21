import { Header } from "@/components/Header";
import { ActionForm, Field, Submit } from "@/components/ActionForm";
import { requestLoginLink } from "@/app/inloggen/actions";

export default function Wachtwoord() {
  return (
    <>
      <Header />
      <main id="inhoud">
        <div className="container narrow">
          <div className="card stack">
            <h1>Wachtwoord instellen of herstellen</h1>
            <p className="muted">We sturen een link waarmee je een (nieuw) wachtwoord kiest. Inloggen met een e-maillink blijft ook altijd mogelijk.</p>
            <ActionForm action={requestLoginLink} className="stack">
              <input type="hidden" name="purpose" value="set_password" />
              <Field name="email" label="E-mailadres" type="email" autoComplete="email" required />
              <Submit>Stuur mij een link</Submit>
            </ActionForm>
          </div>
        </div>
      </main>
    </>
  );
}
