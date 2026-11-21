import crypto from "node:crypto";
import { Header } from "@/components/Header";
import { ActionForm, Field, Submit } from "@/components/ActionForm";
import { getConfig } from "@/lib/settings";
import { submitOutsideArea } from "./actions";

export const dynamic = "force-dynamic";

export default async function Maatwerk({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const planning = await getConfig("planning");
  return (
    <>
      <Header />
      <main id="inhoud">
        <div className="container narrow">
          {sp.ok ? (
            <div className="hero-card stack"><h1>Bedankt!</h1><p>We hebben je aanvraag ontvangen en sturen een voorstel op maat. Je hoort binnenkort van ons.</p></div>
          ) : (
            <div className="card stack">
              <h1>Voorstel op maat</h1>
              <p className="muted">Jullie locatie ligt buiten ons standaard werkgebied ({planning.workAreaName}). Vul je gegevens in, dan kijken we wat mogelijk is.</p>
              <ActionForm action={submitOutsideArea} className="stack" persistKey="maatwerk">
                <input type="hidden" name="submissionId" value={crypto.randomUUID()} />
                <Field name="company" label="Bedrijfsnaam" required autoComplete="organization" />
                <Field name="name" label="Contactpersoon" required autoComplete="name" />
                <Field name="email" label="E-mailadres" type="email" required autoComplete="email" />
                <Field name="phone" label="Telefoonnummer" type="tel" required autoComplete="tel" />
                <Field name="street" label="Straat en huisnummer" required autoComplete="street-address" />
                <div className="grid grid-2">
                  <Field name="postcode" label="Postcode" required defaultValue={sp.postcode} autoComplete="postal-code" />
                  <Field name="city" label="Plaats" required autoComplete="address-level2" />
                </div>
                <Field name="box" label="Gewenste box" type="select" defaultValue={sp.box || "advies"} required options={[{ value: "advies", label: "Weet ik nog niet, graag advies" }, { value: "250", label: "250 liter" }, { value: "500", label: "500 liter" }, { value: "1000", label: "1.000 liter" }]} />
                <Field name="amount" label="Hoeveel kleding komt er ongeveer vrij?" placeholder="Bijvoorbeeld 40 kg per maand" />
                <Field name="note" label="Opmerkingen" type="textarea" />
                <Submit>Vraag een voorstel op maat</Submit>
              </ActionForm>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
