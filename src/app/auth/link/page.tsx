import { redirect } from "next/navigation";
import { Header } from "@/components/Header";
import { ActionForm, Submit } from "@/components/ActionForm";
import { peekToken } from "@/lib/auth";
import { redeemLoginLink } from "@/app/inloggen/actions";

/**
 * De link opent een bevestigingsscherm in plaats van direct in te loggen.
 * Zo verbruiken e-mailscanners die links vooraf openen de link niet.
 */
export default async function AuthLink({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const token = sp.token ?? "";
  const info = token ? await peekToken(token) : null;
  if (!info || info.expired || info.used) redirect("/inloggen?verlopen=1");
  return (
    <>
      <Header />
      <main id="inhoud">
        <div className="container narrow">
          <div className="hero-card stack">
            <h1>Welkom bij Mijn Bereyl</h1>
            <p>Je logt in als <strong>{info.email}</strong>.</p>
            <ActionForm action={redeemLoginLink} className="stack">
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="next" value={sp.next ?? "/portaal"} />
              <Submit>Doorgaan naar Mijn Bereyl</Submit>
            </ActionForm>
          </div>
        </div>
      </main>
    </>
  );
}
