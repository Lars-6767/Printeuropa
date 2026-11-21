import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { one, q } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { TYPE, FUNDING } from "@/lib/labels";
import { ActionForm, Field, Submit, FieldError } from "@/components/ActionForm";
import { PageHead, KV, Pill } from "@/components/ui";
import { executeAction } from "../../actions";

export default async function Uitvoeren({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireStaff();
  const a = await one<any>(`SELECT a.*, c.name AS company_name, l.name AS location_name, l.street, l.postcode, l.city, l.instructions, l.contact_name, l.contact_phone
    FROM appointments a JOIN companies c ON c.id=a.company_id JOIN locations l ON l.id=a.location_id WHERE a.id=$1`, [Number(id)]);
  if (!a) notFound();
  const atLocation = await q<any>(`SELECT id, number, size FROM boxes WHERE location_id=$1 AND status='placed' ORDER BY number`, [a.location_id]);
  const placeSize = a.type === "swap" ? a.new_box_size : a.box_size;
  const stock = await q<any>(`SELECT id, number, size FROM boxes WHERE status IN ('in_stock','reserved') AND size=$1 ORDER BY number LIMIT 50`, [placeSize]);
  const done = a.execution_status === "executed";
  return (
    <div className="stack-lg narrow" style={{ margin: "0 auto" }}>
      <PageHead title={`${TYPE[a.type]} · ${a.company_name}`} back={{ href: "/beheer/uitvoering", label: "Uitvoering" }} actions={done ? <Pill tone="ok">Uitgevoerd</Pill> : undefined} />
      <div className="card">
        <KV rows={[
          ["Afspraak", `${a.number} · ${formatDate(a.planned_date, { weekday: true })}`],
          ["Adres", `${a.street}, ${a.postcode} ${a.city}`],
          ["Instructies", a.instructions ?? "–"],
          ["Contact ter plaatse", [a.contact_name, a.contact_phone].filter(Boolean).join(" · ") || "–"],
          ["Box", a.type === "swap" ? `${a.box_size} L ophalen, ${a.new_box_size} L plaatsen` : `${a.box_size} L`],
          ["Afhandeling", FUNDING[a.funding] ?? "Volgens afspraak"],
        ]} />
      </div>
      {done ? <p className="notice notice-ok">Deze afspraak is al vastgelegd. Opnieuw vastleggen is niet nodig.</p> : (
        <ActionForm action={executeAction} className="card stack">
          <input type="hidden" name="appointmentId" value={a.id} />
          {a.type !== "placement" && (
            <Field name="boxTakenId" label="Meegenomen box" type="select" required defaultValue={atLocation[0] ? String(atLocation[0].id) : ""} options={[{ value: "", label: "Kies box" }, ...atLocation.map((b) => ({ value: String(b.id), label: `${b.number} (${b.size} L)` }))]} />
          )}
          {a.type !== "final_pickup" && (
            <Field name="boxPlacedId" label={a.type === "placement" ? "Geplaatste box" : "Teruggeplaatste lege box"} type="select" required options={[{ value: "", label: "Kies box" }, ...stock.map((b) => ({ value: String(b.id), label: `${b.number} (${b.size} L)` }))]} />
          )}
          <div className="field">
            <label htmlFor="photos">Foto&rsquo;s <span className="muted small">(optioneel)</span></label>
            <input id="photos" name="photos" type="file" accept="image/*" capture="environment" multiple aria-describedby="photos-error" />
            <FieldError name="photos" />
          </div>
          {a.combine_printmasters && <label className="check"><input type="checkbox" name="combinationDone" defaultChecked />Uitgevoerd samen met de PrintMasters-levering</label>}
          <Field name="note" label="Opmerking" type="textarea" />
          <Submit className="btn btn-block" pendingText="Vastleggen…">Uitvoering vastleggen</Submit>
        </ActionForm>
      )}
    </div>
  );
}
