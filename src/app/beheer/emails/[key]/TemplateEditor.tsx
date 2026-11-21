"use client";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { renderEmail, sampleVariables, validateTemplate, type EmailBlock } from "@/lib/email-render";
import { saveTemplateDraft, sendTestMail } from "../../actions";

const NEW: Record<EmailBlock["type"], EmailBlock> = {
  heading: { type: "heading", text: "Nieuwe kop" },
  text: { type: "text", text: "Nieuwe tekst" },
  image: { type: "image", url: "https://", alt: "" },
  summary: { type: "summary", rows: [{ label: "Label", value: "{{prijs}}" }] },
  button: { type: "button", label: "Open Mijn Bereyl", url: "{{portallink}}" },
  contact: { type: "contact", text: "Vragen? Beantwoord deze e-mail." },
};
const TYPE_LABEL: Record<string, string> = { heading: "Kop", text: "Tekst", image: "Afbeelding of logo", summary: "Samenvatting", button: "Knop", contact: "Contactgegevens" };

export function TemplateEditor({ templateKey, initialSubject, initialBlocks, initialAttachments, variables }: {
  templateKey: string; initialSubject: string; initialBlocks: EmailBlock[]; initialAttachments: string[]; variables: { name: string; label: string; example: string }[];
}) {
  const [subject, setSubject] = useState(initialSubject);
  const [blocks, setBlocks] = useState<EmailBlock[]>(initialBlocks);
  const [attachments, setAttachments] = useState<string[]>(initialAttachments);
  const [view, setView] = useState<"mobile" | "desktop">("mobile");
  const [testTo, setTestTo] = useState("");
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const [pending, start] = useTransition();
  const router = useRouter();
  const lastField = useRef<{ el: HTMLInputElement | HTMLTextAreaElement; apply: (v: string) => void } | null>(null);

  const preview = useMemo(() => renderEmail(subject, blocks, sampleVariables()), [subject, blocks]);
  const errors = validateTemplate(subject, blocks);

  const upd = (i: number, b: EmailBlock) => setBlocks((cur) => cur.map((x, j) => (j === i ? b : x)));
  const move = (i: number, d: number) => setBlocks((cur) => { const n = [...cur]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); return n; });
  const track = (apply: (v: string) => void) => ({ onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => { lastField.current = { el: e.currentTarget, apply }; } });
  function insertVar(name: string) {
    const f = lastField.current;
    if (!f) { setMsg({ err: "Klik eerst in een tekstveld." }); return; }
    const el = f.el; const s = el.selectionStart ?? el.value.length; const e = el.selectionEnd ?? s;
    const v = el.value.slice(0, s) + `{{${name}}}` + el.value.slice(e);
    f.apply(v);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + name.length + 4, s + name.length + 4); });
  }

  return (
    <div className="grid grid-2" style={{ alignItems: "start" }}>
      <div className="stack">
        <div aria-live="polite">{msg.ok && <p className="notice notice-ok">{msg.ok}</p>}{msg.err && <p className="notice notice-danger" role="alert">{msg.err}</p>}</div>
        <div className="field">
          <label htmlFor="tpl-subject">Onderwerp</label>
          <input id="tpl-subject" value={subject} onChange={(e) => setSubject(e.target.value)} {...track(setSubject)} />
        </div>
        <details className="card" open>
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>Variabelen invoegen</summary>
          <p className="tiny muted">Klik in een tekstveld en kies een variabele. Tussen haakjes de voorbeeldwaarde.</p>
          <div className="row" style={{ gap: 6 }}>{variables.map((v) => <button key={v.name} type="button" className="btn btn-sm btn-secondary" title={`Voorbeeld: ${v.example}`} onClick={() => insertVar(v.name)}>{v.label}</button>)}</div>
        </details>
        {blocks.map((b, i) => (
          <div key={i} className="card stack" style={{ padding: 16 }}>
            <div className="row between">
              <strong>{TYPE_LABEL[b.type]}</strong>
              <div className="row" style={{ gap: 4 }}>
                <button type="button" className="btn btn-ghost btn-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Blok omhoog">↑</button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={i === blocks.length - 1} onClick={() => move(i, 1)} aria-label="Blok omlaag">↓</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBlocks(blocks.filter((_, j) => j !== i))}>Verwijder</button>
              </div>
            </div>
            {(b.type === "heading" || b.type === "text" || b.type === "contact") && (
              <textarea aria-label={`${TYPE_LABEL[b.type]} tekst`} value={b.text} onChange={(e) => upd(i, { ...b, text: e.target.value })} {...track((v) => upd(i, { ...b, text: v }))} />
            )}
            {b.type === "button" && (<>
              <input aria-label="Knoptekst" value={b.label} onChange={(e) => upd(i, { ...b, label: e.target.value })} {...track((v) => upd(i, { ...b, label: v }))} />
              <input aria-label="Link" value={b.url} onChange={(e) => upd(i, { ...b, url: e.target.value })} {...track((v) => upd(i, { ...b, url: v }))} />
            </>)}
            {b.type === "image" && (<>
              <input aria-label="Afbeeldingsadres" value={b.url} onChange={(e) => upd(i, { ...b, url: e.target.value })} />
              <input aria-label="Alternatieve tekst" value={b.alt} onChange={(e) => upd(i, { ...b, alt: e.target.value })} placeholder="Omschrijving voor schermlezers" />
            </>)}
            {b.type === "summary" && (<>
              {b.rows.map((r, k) => (
                <div key={k} className="row" style={{ flexWrap: "nowrap" }}>
                  <input aria-label={`Label regel ${k + 1}`} value={r.label} onChange={(e) => upd(i, { ...b, rows: b.rows.map((x, m) => (m === k ? { ...x, label: e.target.value } : x)) })} />
                  <input aria-label={`Waarde regel ${k + 1}`} value={r.value} onChange={(e) => upd(i, { ...b, rows: b.rows.map((x, m) => (m === k ? { ...x, value: e.target.value } : x)) })} {...track((v) => upd(i, { ...b, rows: b.rows.map((x, m) => (m === k ? { ...x, value: v } : x)) }))} />
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => upd(i, { ...b, rows: b.rows.filter((_, m) => m !== k) })} aria-label={`Verwijder regel ${k + 1}`}>×</button>
                </div>
              ))}
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => upd(i, { ...b, rows: [...b.rows, { label: "", value: "" }] })}>+ Regel</button>
            </>)}
          </div>
        ))}
        <div className="row" style={{ gap: 6 }}>{(Object.keys(NEW) as EmailBlock["type"][]).map((t) => <button key={t} type="button" className="btn btn-sm btn-secondary" onClick={() => setBlocks([...blocks, structuredClone(NEW[t])])}>+ {TYPE_LABEL[t]}</button>)}</div>
        <fieldset className="card stack" style={{ padding: 16 }}>
          <legend>Bijlagen</legend>
          {[["proposal_pdf", "Voorstel-PDF"], ["acceptance_pdf", "Akkoordbewijs"], ["invoice_pdf", "Factuur-PDF"]].map(([k, l]) => (
            <label key={k} className="check"><input type="checkbox" checked={attachments.includes(k)} onChange={(e) => setAttachments(e.target.checked ? [...attachments, k] : attachments.filter((x) => x !== k))} />{l}</label>
          ))}
        </fieldset>
        {errors.length > 0 && <div className="notice notice-warn"><ul style={{ margin: 0 }}>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
        <button className="btn" type="button" disabled={pending} onClick={() => start(async () => {
          const r = await saveTemplateDraft(templateKey, subject, JSON.stringify(blocks), attachments);
          setMsg(r.error ? { err: r.error } : { ok: r.message }); if (!r.error) router.refresh();
        })}>Opslaan als concept</button>
        <div className="card stack" style={{ padding: 16 }}>
          <label htmlFor="test-to" className="label">Testmail sturen naar</label>
          <div className="row" style={{ flexWrap: "nowrap" }}>
            <input id="test-to" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="naam@bereyl.com" />
            <button type="button" className="btn btn-secondary btn-sm" disabled={pending} onClick={() => start(async () => { const r = await sendTestMail(templateKey, testTo, subject, JSON.stringify(blocks)); setMsg(r.error ? { err: r.error } : { ok: r.message }); })}>Verstuur test</button>
          </div>
          <a className="small" href="/beheer/voorbeeld-pdf" target="_blank" rel="noopener">Voorbeeld-PDF openen</a>
        </div>
      </div>
      <div className="stack" style={{ position: "sticky", top: 80 }}>
        <div className="row" role="group" aria-label="Weergave">
          <button type="button" className={`btn btn-sm ${view === "mobile" ? "" : "btn-secondary"}`} aria-pressed={view === "mobile"} onClick={() => setView("mobile")}>Mobiel</button>
          <button type="button" className={`btn btn-sm ${view === "desktop" ? "" : "btn-secondary"}`} aria-pressed={view === "desktop"} onClick={() => setView("desktop")}>Desktop</button>
        </div>
        <p className="small"><strong>Onderwerp:</strong> {preview.subject}</p>
        <iframe title="Voorbeeld van de e-mail" srcDoc={preview.html} sandbox="" style={{ width: view === "mobile" ? 375 : "100%", maxWidth: "100%", height: 640, border: "1px solid var(--line)", borderRadius: 12, background: "#fff" }} />
      </div>
    </div>
  );
}
