"use client";
import { useEffect, useState, useTransition } from "react";
import { ActionForm, Field, Submit } from "@/components/ActionForm";
import { PreferenceFields } from "@/components/PreferencePicker";
import { formatEuro } from "@/lib/money";
import { previewEmptyingAction, requestEmptyingAction } from "../../actions";

type Preview = Awaited<ReturnType<typeof previewEmptyingAction>>;

export function EmptyingForm({ locations, initialLocation, submissionId, planning }: {
  locations: { id: number; name: string }[]; initialLocation: number; submissionId: string;
  planning: { dayparts: { code: string; label: string }[]; days: string[]; minLeadDays: number; max: number };
}) {
  const [loc, setLoc] = useState(initialLocation);
  const [combine, setCombine] = useState(false);
  const [pv, setPv] = useState<Preview | null>(null);
  const [, start] = useTransition();
  useEffect(() => { start(async () => setPv(await previewEmptyingAction(loc, combine))); }, [loc, combine]);
  const p = pv && !("error" in pv && pv.error) ? (pv as Exclude<Preview, { error: string }>) : null;
  return (
    <ActionForm action={requestEmptyingAction} className="stack-lg" persistKey="leging">
      <input type="hidden" name="submissionId" value={submissionId} />
      <div className="card stack">
        {locations.length > 1 ? (
          <div className="field">
            <label htmlFor="loc">Locatie</label>
            <select id="loc" name="locationId" value={loc} onChange={(e) => setLoc(Number(e.target.value))}>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
          </div>
        ) : <input type="hidden" name="locationId" value={loc} />}
        {p?.combinable && (
          <label className="choice">
            <input type="checkbox" name="combine" checked={combine} onChange={(e) => setCombine(e.target.checked)} />
            <span className="title">Combineer met PrintMasters-levering</span>
            <span className="sub">Gratis leging tijdens een PrintMasters-levering. De planner stemt dit af.</span>
          </label>
        )}
        {combine && <Field name="deliveryRef" label="Bekende PrintMasters-levering" help="Ordernummer of verwachte leverdatum, als je die weet." />}
        {pv && "error" in pv && pv.error && <p className="notice notice-warn">{pv.error}</p>}
        {p && (
          <div className="card-soft stack" aria-live="polite">
            <p style={{ margin: 0, fontWeight: 800 }}>{p.funding === "paid" ? (p.priceCents === null ? "Prijs nog vast te stellen" : `${formatEuro(p.priceCents)} excl. btw`) : "Geen extra kosten"}</p>
            <p className="small" style={{ margin: 0 }}>{p.explanation}</p>
            {p.periodEnd && <p className="small muted" style={{ margin: 0 }}>Nog {p.available} {p.available === 1 ? "leging" : "legingen"} beschikbaar · {p.reserved} ingepland{p.pending ? ` · ${p.pending} aangevraagd` : ""} · tegoedperiode {p.periodStart} t/m {p.periodEnd}</p>}
          </div>
        )}
      </div>
      <div className="card stack">
        <h2 style={{ fontSize: "1.2rem" }}>Wanneer komt het uit?</h2>
        <PreferenceFields dayparts={planning.dayparts} days={planning.days} minLeadDays={planning.minLeadDays} max={planning.max} />
        <Field name="note" label="Opmerking voor de chauffeur" type="textarea" />
      </div>
      <Submit className="btn btn-block">Leging aanvragen</Submit>
    </ActionForm>
  );
}
