import { notFound } from "next/navigation";
import { requireCustomer } from "@/lib/auth";
import { one } from "@/lib/db";
import { getConfig } from "@/lib/settings";
import { formatDate } from "@/lib/dates";
import { formatEuro } from "@/lib/money";
import { prefsText } from "@/lib/documents";
import { appointmentPhase, FUNDING, TYPE } from "@/lib/labels";
import { ActionForm, Field, Submit } from "@/components/ActionForm";
import { PreferenceFields } from "@/components/PreferencePicker";
import { PageHead, KV, Pill } from "@/components/ui";
import { cancelAppointmentAction, changePreferencesAction } from "../../actions";

export default async function Afspraak({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCustomer();
  const a = await one<any>(`SELECT a.*, l.name AS location_name FROM appointments a JOIN locations l ON l.id=a.location_id WHERE a.id=$1 AND a.company_id=$2`, [Number(id), ctx.companyId]);
  if (!a) notFound();
  const planning = await getConfig("planning");
  const editable = a.execution_status === "pending" && ["requested", "confirmed"].includes(a.request_status);
  return (
    <div className="stack-lg">
      <PageHead title={`${TYPE[a.type]} ${a.number}`} back={{ href: "/portaal/afspraken", label: "Afspraken" }} actions={<Pill>{appointmentPhase(a)}</Pill>} />
      <div className="card">
        <KV rows={[
          ["Locatie", a.location_name],
          ["Datum", a.planned_date ? `${formatDate(a.planned_date, { weekday: true })} ${planning.dayparts.find((d) => d.code === a.planned_daypart)?.label ?? ""}` : "Nog niet bevestigd"],
          ["Voorkeuren", prefsText(a.preferences ?? [], a.flexible, planning.dayparts)],
          ["Afhandeling", `${FUNDING[a.funding] ?? "Volgens afspraak"}${a.funding === "paid" || a.funding === "contract" ? ` · ${formatEuro(a.price_cents)}${a.price_cents !== null ? " excl. btw" : ""}` : ""}`],
          ...(a.combine_printmasters ? [["PrintMasters", a.combination_status === "confirmed" ? "Combinatie bevestigd" : "Combinatie aangevraagd"] as [string, string]] : []),
        ]} />
      </div>
      {editable && (
        <>
          <section className="card stack">
            <h2 style={{ fontSize: "1.2rem" }}>Voorkeur wijzigen</h2>
            <p className="small muted">Wijzigen kan tot {planning.changeUntilHoursBefore} uur voor een bevestigde afspraak. De afspraak gaat dan terug naar &lsquo;aangevraagd&rsquo; en Bereyl bevestigt opnieuw.</p>
            <ActionForm action={changePreferencesAction} className="stack">
              <input type="hidden" name="appointmentId" value={a.id} />
              <PreferenceFields dayparts={planning.dayparts} days={planning.days} minLeadDays={planning.minLeadDays} max={planning.maxPreferences} />
              <Submit className="btn btn-secondary">Wijziging doorgeven</Submit>
            </ActionForm>
          </section>
          {(a.type === "emptying" || a.type === "swap") && (
            <section className="card stack">
              <h2 style={{ fontSize: "1.2rem" }}>Annuleren</h2>
              <p className="small muted">Annuleren kan tot {planning.cancelUntilHoursBefore} uur voor de afspraak. Gereserveerd tegoed komt dan weer vrij.</p>
              <ActionForm action={cancelAppointmentAction} className="stack" confirm="Weet je zeker dat je deze afspraak wilt annuleren?">
                <input type="hidden" name="appointmentId" value={a.id} />
                <Field name="reason" label="Reden" />
                <Submit className="btn btn-danger">Afspraak annuleren</Submit>
              </ActionForm>
            </section>
          )}
        </>
      )}
    </div>
  );
}
