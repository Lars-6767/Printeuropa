import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { ActionForm, Field, Submit } from "@/components/ActionForm";
import { setOwnPasswordAction } from "../actions";

export default async function Account({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const next = sp.next ?? "/portaal";
  return (
    <div className="container narrow stack-lg">
      {sp.welkom && <div className="next-action stack"><h1 style={{ margin: 0 }}>Welkom bij Mijn Bereyl</h1><p className="muted" style={{ margin: 0 }}>Je bent ingelogd. Wil je ook een wachtwoord instellen? Dat mag, maar inloggen met een e-maillink blijft altijd mogelijk.</p><div><Link className="btn" href={next}>Ga verder zonder wachtwoord</Link></div></div>}
      <section className="card stack">
        <h2>{user.password_hash ? "Wachtwoord wijzigen" : "Wachtwoord instellen"}</h2>
        <ActionForm action={setOwnPasswordAction} className="stack">
          <input type="hidden" name="next" value={next} />
          <input type="text" name="username" autoComplete="username" defaultValue={user.email} hidden readOnly />
          <Field name="password" label="Nieuw wachtwoord" type="password" autoComplete="new-password" required help="Minimaal 10 tekens." />
          <Field name="password2" label="Herhaal wachtwoord" type="password" autoComplete="new-password" required />
          <Submit className="btn btn-secondary">Wachtwoord opslaan</Submit>
        </ActionForm>
      </section>
    </div>
  );
}
