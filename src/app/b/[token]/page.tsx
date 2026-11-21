import { redirect } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/Header";
import { currentUser } from "@/lib/auth";
import { one } from "@/lib/db";

/** QR-code op de box. Alleen een bevoegde medewerker komt in het boxdossier; de code zelf geeft geen toegang. */
export default async function BoxQr({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await currentUser();
  if (user?.staff_role) {
    const box = await one<{ id: number }>(`SELECT id FROM boxes WHERE qr_token=$1`, [token]);
    if (box) redirect(`/beheer/boxen/${box.id}`);
  }
  return (
    <>
      <Header />
      <main id="inhoud">
        <div className="container narrow">
          <div className="card stack">
            <h1>Bereyl-box</h1>
            <p>Deze box hoort bij Bereyl. Medewerkers loggen in om het boxdossier te openen.</p>
            <p>Is de box vol? Vraag een leging aan in Mijn Bereyl.</p>
            <div className="row"><Link className="btn" href={`/inloggen?next=${encodeURIComponent(`/b/${token}`)}`}>Inloggen</Link></div>
          </div>
        </div>
      </main>
    </>
  );
}
