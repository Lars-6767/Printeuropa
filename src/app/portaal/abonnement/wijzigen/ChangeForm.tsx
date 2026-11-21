"use client";
import { useEffect, useState, useTransition } from "react";
import { ActionForm, FieldError, Submit } from "@/components/ActionForm";
import { PreferenceFields } from "@/components/PreferencePicker";
import { formatEuro } from "@/lib/money";
import { previewChangeAction, requestChangeAction } from "../../actions";

type Pv = Awaited<ReturnType<typeof previewChangeAction>>;

export function ChangeForm(props: {
  subscriptionId: number; submissionId: string;
  current: { boxSize: number; packageCode: string; frequency: number | null };
  boxes: { size: number; label: string; imageUrl: string }[];
  packages: { code: string; name: string; kind: string; frequencies: number[] }[];
  planning: { dayparts: { code: string; label: string }[]; days: string[]; minLeadDays: number; max: number };
}) {
  const [box, setBox] = useState(props.current.boxSize);
  const [pkg, setPkg] = useState(props.current.packageCode);
  const [freq, setFreq] = useState<number | null>(props.current.frequency);
  const [pv, setPv] = useState<Pv | null>(null);
  const [loading, start] = useTransition();
  const pk = props.packages.find((p) => p.code === pkg);
  useEffect(() => {
    const f = pk?.kind === "scheduled" ? freq ?? pk.frequencies[0] ?? null : null;
    start(async () => setPv(await previewChangeAction(props.subscriptionId, { boxSize: box, packageCode: pkg, frequencyPerYear: f })));
  }, [box, pkg, freq, pk, props.subscriptionId]);
  const p = pv && pv.ok ? pv : null;
  return (
    <ActionForm action={requestChangeAction} className="stack-lg">
      <input type="hidden" name="subscriptionId" value={props.subscriptionId} />
      <input type="hidden" name="submissionId" value={props.submissionId} />
      <input type="hidden" name="boxSize" value={box} />
      <input type="hidden" name="packageCode" value={pkg} />
      <input type="hidden" name="frequency" value={pk?.kind === "scheduled" ? freq ?? pk.frequencies[0] ?? "" : ""} />
      <fieldset className="stack">
        <legend>Formaat</legend>
        <div className="choices choices-3">
          {props.boxes.map((b) => (
            <label key={b.size} className="choice">
              <input type="radio" name="_box" checked={box === b.size} onChange={() => setBox(b.size)} />
              {b.size === props.current.boxSize && <span className="badge pill">Huidig</span>}
              <span className="title">{b.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="stack">
        <legend>Pakket</legend>
        <div className="choices choices-3">
          {props.packages.map((x) => (
            <label key={x.code} className="choice">
              <input type="radio" name="_pkg" checked={pkg === x.code} onChange={() => { setPkg(x.code); if (x.kind === "scheduled" && !freq) setFreq(x.frequencies[0] ?? null); }} />
              {x.code === props.current.packageCode && <span className="badge pill">Huidig</span>}
              <span className="title">{x.name}</span>
            </label>
          ))}
        </div>
        {pk?.kind === "scheduled" && (
          <div className="row">{pk.frequencies.map((f) => <label key={f} className="check"><input type="radio" name="_freq" checked={freq === f} onChange={() => setFreq(f)} />{f}× per jaar</label>)}</div>
        )}
      </fieldset>
      <section className="card stack" aria-live="polite" aria-busy={loading}>
        <h2 style={{ fontSize: "1.2rem" }}>Wat verandert er?</h2>
        {pv && !pv.ok && <p className="notice notice-danger">{pv.error}</p>}
        {p && (
          <>
            <dl className="kv">
              <dt>Nu</dt><dd>{p.currentPackage} · {p.currentBox} liter · {formatEuro(p.currentMonthly)} per maand</dd>
              <dt>Nieuw</dt><dd>{p.newOffer.packageName} · {p.newOffer.boxLabel} · {p.newMonthly === null ? "nog vast te stellen" : `${formatEuro(p.newMonthly)} per maand`} (excl. btw)</dd>
              <dt>Ingangsdatum</dt><dd>{p.effective}</dd>
              <dt>Inbegrepen legingen</dt><dd>{p.newOffer.includedPerYear ? `${p.newOffer.includedPerYear} per jaar` : "Geen; losse leging " + formatEuro(p.newOffer.singleEmptyingCents)}</dd>
              <dt>Tegoed</dt><dd>{p.creditText}</dd>
              {p.swapNeeded && <><dt>Omruilen</dt><dd>We wisselen de box fysiek om. Omruilkosten: {p.swapCents === null ? "nog vast te stellen door Bereyl" : `${formatEuro(p.swapCents)} excl. btw`}</dd></>}
              <dt>Geplande afspraken</dt><dd>{p.planned.length ? p.planned.map((a: any) => a.number).join(", ") + " blijven staan" : "Geen"}</dd>
              {p.scheduled && <><dt>Let op</dt><dd>Deze wijziging vervangt de eerder geplande wijziging per {p.scheduled.effective}.</dd></>}
            </dl>
            {p.blocker && <p className="notice notice-warn">{p.blocker}</p>}
          </>
        )}
      </section>
      {p?.swapNeeded && (
        <section className="card stack">
          <h2 style={{ fontSize: "1.2rem" }}>Wanneer kunnen we omruilen?</h2>
          <PreferenceFields dayparts={props.planning.dayparts} days={props.planning.days} minLeadDays={props.planning.minLeadDays} max={props.planning.max} />
        </section>
      )}
      {p && !p.blocker && (
        <div className="stack">
          <label className="check"><input type="checkbox" name="confirm" />Ik ga akkoord met de nieuwe prijs en ingangsdatum.</label>
          <FieldError name="confirm" />
          <Submit className="btn btn-block">Wijziging bevestigen</Submit>
        </div>
      )}
    </ActionForm>
  );
}
