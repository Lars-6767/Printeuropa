"use client";
import { useState } from "react";
import { useFormState } from "./ActionForm";

export function PreferencePicker({ flexible, slots, dayparts, days, minLeadDays, max, onChange, error }: {
  flexible: boolean; slots: { date: string; daypart: string | null }[]; dayparts: { code: string; label: string }[]; days: string[]; minLeadDays: number; max: number;
  onChange: (flexible: boolean, slots: { date: string; daypart: string | null }[]) => void; error?: string;
}) {
  const min = new Date(Date.now() + minLeadDays * 86400000).toISOString().slice(0, 10);
  const dayNames: Record<string, string> = { mon: "maandag", tue: "dinsdag", wed: "woensdag", thu: "donderdag", fri: "vrijdag", sat: "zaterdag", sun: "zondag" };
  const list = slots.length ? slots : [{ date: "", daypart: null }];
  return (
    <div className="stack" data-field="preferences.slots" tabIndex={-1}>
      <label className="choice"><input type="checkbox" checked={flexible} onChange={(e) => onChange(e.target.checked, slots)} /><span className="title">Het maakt ons niet uit, plan ons in overleg in</span></label>
      {!flexible && (
        <div className="stack">
          <p className="small muted">We rijden op {days.map((d) => dayNames[d]).join(", ")}. Kies een datum vanaf {min}.</p>
          {list.map((sl, i) => (
            <div key={i} className="card grid grid-2" style={{ padding: 16 }}>
              <div className="field">
                <label htmlFor={`pref-date-${i}`}>Voorkeursdag {i + 1}</label>
                <input id={`pref-date-${i}`} type="date" min={min} value={sl.date} onChange={(e) => { const n = [...list]; n[i] = { ...n[i], date: e.target.value }; onChange(false, n); }} aria-invalid={error ? true : undefined} />
              </div>
              <div className="field">
                <label htmlFor={`pref-dp-${i}`}>Dagdeel <span className="muted small">(optioneel)</span></label>
                <select id={`pref-dp-${i}`} value={sl.daypart ?? ""} onChange={(e) => { const n = [...list]; n[i] = { ...n[i], daypart: e.target.value || null }; onChange(false, n); }}>
                  <option value="">Hele dag</option>
                  {dayparts.map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}
                </select>
              </div>
              {list.length > 1 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(false, list.filter((_, j) => j !== i))}>Verwijder voorkeur {i + 1}</button>}
            </div>
          ))}
          {list.length < max && <button type="button" className="btn btn-secondary btn-sm" onClick={() => onChange(false, [...list, { date: "", daypart: null }])}>+ Nog een voorkeursdag</button>}
        </div>
      )}
      {error && <span className="error" role="alert">{error}</span>}
    </div>
  );
}

/** Variant voor formulieren met FormData: bewaart de keuze in een verborgen veld 'preferences' (JSON). */
export function PreferenceFields(props: { dayparts: { code: string; label: string }[]; days: string[]; minLeadDays: number; max: number; error?: string; initialFlexible?: boolean }) {
  const [flexible, setFlexible] = useState(props.initialFlexible ?? false);
  const [slots, setSlots] = useState<{ date: string; daypart: string | null }[]>([]);
  const { fieldErrors } = useFormState();
  return (
    <>
      <input type="hidden" name="preferences" value={JSON.stringify({ flexible, slots: slots.filter((s) => s.date) })} />
      <PreferencePicker flexible={flexible} slots={slots} dayparts={props.dayparts} days={props.days} minLeadDays={props.minLeadDays} max={props.max} error={props.error ?? fieldErrors.preferences}
        onChange={(f, s) => { setFlexible(f); setSlots(s); }} />
    </>
  );
}
