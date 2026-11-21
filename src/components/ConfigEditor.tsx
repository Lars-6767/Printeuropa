"use client";
/** Generieke editor voor beheerinstellingen op basis van CONFIG_SCHEMA. */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { FieldSpec } from "@/lib/config-schema";

type Res = { ok?: boolean; error?: string; errors?: Record<string, string>; message?: string };

function moneyStr(v: any) { return typeof v === "number" ? (v / 100).toFixed(2).replace(".", ",") : v ?? ""; }
function bpStr(v: any) { return typeof v === "number" ? String(v / 100).replace(".", ",") : v ?? ""; }

export function ConfigEditor({ schema, initial, save, labels }: { schema: FieldSpec[]; initial: any; save: (json: string, note: string) => Promise<Res>; labels?: Record<string, string> }) {
  const [data, setData] = useState<any>(initial);
  const [note, setNote] = useState("");
  const [res, setRes] = useState<Res>({});
  const [pending, start] = useTransition();
  const router = useRouter();
  const errors = res.errors ?? {};

  function setAt(path: (string | number)[], value: any) {
    setData((cur: any) => {
      const copy = structuredClone(cur);
      let o = copy;
      for (let i = 0; i < path.length - 1; i++) o = o[path[i]];
      o[path[path.length - 1]] = value;
      return copy;
    });
  }
  function getAt(path: (string | number)[]) { return path.reduce((o: any, k) => o?.[k], data); }

  function render(fields: FieldSpec[], base: (string | number)[]): React.ReactNode {
    return fields.map((f) => {
      const path = [...base, f.k];
      const id = `cfg-${path.join("-")}`;
      const key = path.join(".");
      const err = errors[key];
      const v = getAt(path);
      const common = { id, "aria-invalid": err ? true : undefined, "aria-describedby": err ? `${id}-err` : f.help ? `${id}-help` : undefined } as const;
      const help = f.help ? <span className="help" id={`${id}-help`}>{f.help}</span> : null;
      const errEl = err ? <span className="error" id={`${id}-err`}>{err}</span> : null;
      if (f.type === "bool") return <div key={key}><label className="check"><input type="checkbox" {...common} checked={Boolean(v)} onChange={(e) => setAt(path, e.target.checked)} />{f.label}</label>{help}{errEl}</div>;
      if (f.type === "group") return <fieldset key={key} className="card-soft stack" style={{ padding: 16 }}><legend>{f.label}</legend>{help}<div className="grid grid-3">{render(f.fields, path)}</div></fieldset>;
      if (f.type === "list") {
        const arr: any[] = Array.isArray(v) ? v : [];
        return (
          <fieldset key={key} className="stack">
            <legend>{f.label}</legend>{help}
            {arr.map((item, i) => (
              <div key={i} className="card stack" style={{ padding: 16 }}>
                <div className="row between">
                  <strong>{f.titleKey ? labels?.[item[f.titleKey]] ?? item[f.titleKey] : `${f.itemLabel} ${i + 1}`}</strong>
                  {!f.fixed && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAt(path, arr.filter((_, j) => j !== i))}>Verwijder</button>}
                </div>
                <div className="grid grid-2">{render(f.fields, [...path, i])}</div>
              </div>
            ))}
            {!f.fixed && <div><button type="button" className="btn btn-secondary btn-sm" onClick={() => setAt(path, [...arr, structuredClone(f.newItem ?? {})])}>+ {f.itemLabel} toevoegen</button></div>}
          </fieldset>
        );
      }
      let input: React.ReactNode;
      if (f.type === "select") {
        input = <select {...common} value={v ?? ""} onChange={(e) => setAt(path, e.target.value === "" ? null : e.target.value)}>{f.options.map((o) => <option key={String(o.v)} value={o.v ?? ""}>{o.l}</option>)}</select>;
      } else if (f.type === "textarea") {
        input = <textarea {...common} value={v ?? ""} onChange={(e) => setAt(path, e.target.value)} />;
      } else if (f.type === "money") {
        input = <div className="row" style={{ flexWrap: "nowrap", gap: 6 }}><span aria-hidden="true">€</span><input {...common} inputMode="decimal" value={moneyStr(v)} placeholder={f.nullable ? "nog vast te stellen" : ""} onChange={(e) => setAt(path, e.target.value)} /></div>;
      } else if (f.type === "bp") {
        input = <div className="row" style={{ flexWrap: "nowrap", gap: 6 }}><input {...common} inputMode="decimal" value={bpStr(v)} onChange={(e) => setAt(path, e.target.value)} /><span aria-hidden="true">%</span></div>;
      } else if (f.type === "strings") {
        input = <input {...common} value={Array.isArray(v) ? v.join(", ") : v ?? ""} onChange={(e) => setAt(path, e.target.value)} />;
      } else {
        input = <input {...common} type={f.type === "int" || f.type === "number" ? "text" : f.type === "color" ? "text" : f.type} inputMode={f.type === "int" ? "numeric" : f.type === "number" ? "decimal" : undefined} value={v ?? ""} onChange={(e) => setAt(path, e.target.value)} />;
      }
      return <div key={key} className="field"><label htmlFor={id}>{f.label}</label>{input}{help}{errEl}</div>;
    });
  }

  return (
    <form className="stack-lg" noValidate onSubmit={(e) => {
      e.preventDefault();
      start(async () => { const r = await save(JSON.stringify(data), note); setRes(r); if (r.ok) router.refresh(); });
    }}>
      <div aria-live="polite">
        {res.error && <p className="notice notice-danger" role="alert">{res.error}</p>}
        {res.errors && Object.keys(res.errors).length > 0 && <p className="notice notice-danger" role="alert">Controleer de gemarkeerde velden ({Object.keys(res.errors).length}).</p>}
        {res.message && <p className="notice notice-ok">{res.message}</p>}
      </div>
      {render(schema, [])}
      <div className="field"><label htmlFor="cfg-note">Toelichting bij deze wijziging</label><input id="cfg-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Bijvoorbeeld: nieuw kilometertarief per 1 januari" /></div>
      <div className="row"><button className="btn" type="submit" disabled={pending}>{pending ? "Opslaan…" : "Opslaan als concept"}</button></div>
    </form>
  );
}
