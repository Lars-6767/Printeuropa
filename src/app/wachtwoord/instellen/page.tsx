import { redirect } from "next/navigation";
import { Header } from "@/components/Header";
import { ActionForm, Field, Submit } from "@/components/ActionForm";
import { peekToken } from "@/lib/auth";
import { setPasswordWithToken } from "@/app/inloggen/actions";

export default async function Instellen({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const info = sp.token ? await peekToken(sp.token) : null;
  if (!info || info.expired || info.used) redirect("/wachtwoord?verlopen=1");
  return (
    <>
      <Header />
      <main id="inhoud">
        <div className="container narrow">
          <div className="card stack">
            <h1>Kies een wachtwoord</h1>
            <p className="muted">Voor {info.email}. Minimaal 10 tekens.</p>
            <ActionForm action={setPasswordWithToken} className="stack">
              <input type="hidden" name="token" value={sp.token} />
              <input type="text" name="username" autoComplete="username" defaultValue={info.email} hidden readOnly />
              <Field name="password" label="Nieuw wachtwoord" type="password" autoComplete="new-password" required />
              <Field name="password2" label="Herhaal wachtwoord" type="password" autoComplete="new-password" required />
              <Submit>Wachtwoord opslaan</Submit>
            </ActionForm>
          </div>
        </div>
      </main>
    </>
  );
}
