"use client";
/**
 * Formulier dat een server action aanroept zonder de velden te wissen.
 * - Foutmeldingen verschijnen naast het betreffende veld (FieldError / Field leest de context).
 * - Met persistKey worden ingevulde waarden bewaard bij teruggaan en vernieuwen (sessionStorage).
 */
import { createContext, useContext, useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { flash } from "./FlashRegion";

export type ActionResult = { ok?: boolean; error?: string; fieldErrors?: Record<string, string | undefined>; message?: string; redirect?: string } | void;

const Ctx = createContext<{ fieldErrors: Record<string, string | undefined>; pending: boolean }>({ fieldErrors: {}, pending: false });
export const useFormState = () => useContext(Ctx);

export function ActionForm({
  action, children, className, persistKey, resetOnSuccess, confirm, id,
}: {
  action: (fd: FormData) => Promise<ActionResult>;
  children: React.ReactNode;
  className?: string;
  persistKey?: string;
  resetOnSuccess?: boolean;
  confirm?: string;
  id?: string;
}) {
  const [state, setState] = useState<Exclude<ActionResult, void>>({});
  const [pending, start] = useTransition();
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!persistKey || !ref.current) return;
    try {
      const raw = sessionStorage.getItem(`form:${persistKey}`);
      if (!raw) return;
      const data = JSON.parse(raw) as Record<string, string | string[]>;
      for (const el of Array.from(ref.current.elements) as HTMLInputElement[]) {
        if (!el.name || el.type === "password" || el.type === "file" || el.type === "hidden" || !(el.name in data)) continue;
        const v = data[el.name];
        if (el.type === "checkbox" || el.type === "radio") el.checked = Array.isArray(v) ? v.includes(el.value) : v === el.value;
        else el.value = Array.isArray(v) ? v[0] : v;
      }
    } catch { /* opslag niet beschikbaar */ }
  }, [persistKey]);

  function save() {
    if (!persistKey || !ref.current) return;
    const out: Record<string, string | string[]> = {};
    for (const el of Array.from(ref.current.elements) as HTMLInputElement[]) {
      if (!el.name || el.type === "password" || el.type === "file" || el.type === "hidden") continue;
      if (el.type === "checkbox" || el.type === "radio") {
        if (!el.checked) continue;
        const prev = out[el.name];
        out[el.name] = el.type === "checkbox" ? [...(Array.isArray(prev) ? prev : prev ? [prev] : []), el.value] : el.value;
      } else out[el.name] = el.value;
    }
    try { sessionStorage.setItem(`form:${persistKey}`, JSON.stringify(out)); } catch { /* ignore */ }
  }

  return (
    <Ctx.Provider value={{ fieldErrors: state.fieldErrors ?? {}, pending }}>
      <form
        id={id}
        ref={ref}
        className={className}
        noValidate
        onInput={save}
        onChange={save}
        onSubmit={(e) => {
          e.preventDefault();
          if (confirm && !window.confirm(confirm)) return;
          const fd = new FormData(e.currentTarget);
          start(async () => {
            try {
              const r = (await action(fd)) ?? {};
              const success = r.ok !== false && !r.error && !r.fieldErrors;
              // Succesmeldingen verschijnen in de vaste meldingenregio (blijven zichtbaar als dit formulier verdwijnt)
              setState(success ? { ...r, message: undefined } : r);
              if (success) {
                if (persistKey) try { sessionStorage.removeItem(`form:${persistKey}`); } catch { /* ignore */ }
                if (resetOnSuccess) ref.current?.reset();
                if (r.message && !r.redirect) flash(r.message);
                if (r.redirect) router.push(r.redirect);
                else router.refresh();
              } else {
                const first = r.fieldErrors ? Object.keys(r.fieldErrors)[0] : null;
                const el = first ? (ref.current?.querySelector(`[name="${CSS.escape(first)}"]`) as HTMLElement | null) : null;
                (el ?? statusRef.current)?.focus();
              }
            } catch (err) {
              setState({ error: err instanceof Error && err.message && !err.message.includes("NEXT_") ? err.message : "Er ging iets mis. Probeer het opnieuw." });
              statusRef.current?.focus();
            }
          });
        }}
      >
        <div ref={statusRef} tabIndex={-1} aria-live="polite">
          {state.error && <p className="notice notice-danger" role="alert">{state.error}</p>}
          {state.message && !state.error && <p className="notice notice-ok">{state.message}</p>}
        </div>
        {children}
      </form>
    </Ctx.Provider>
  );
}

export function FieldError({ name }: { name: string }) {
  const { fieldErrors } = useFormState();
  const msg = fieldErrors[name];
  return msg ? <span className="error" id={`${name}-error`}>{msg}</span> : null;
}

export function Field({
  name, label, help, type = "text", defaultValue, required, autoComplete, options, inputMode, placeholder, rows, min, max, step,
}: {
  name: string; label: string; help?: string; type?: string; defaultValue?: string | number | null; required?: boolean; autoComplete?: string;
  options?: { value: string; label: string }[]; inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"]; placeholder?: string; rows?: number; min?: number | string; max?: number | string; step?: number | string;
}) {
  const { fieldErrors } = useFormState();
  const err = fieldErrors[name];
  const uid = useId();
  const id = `f-${name.replace(/[^\w-]/g, "_")}-${uid.replace(/[^\w]/g, "")}`;
  const describedBy = [help ? `${id}-help` : null, err ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  const common = { id, name, required, "aria-invalid": err ? true : undefined, "aria-describedby": describedBy } as const;
  return (
    <div className="field">
      <label htmlFor={id}>{label}{required ? "" : <span className="muted small"> (optioneel)</span>}</label>
      {type === "select" ? (
        <select {...common} defaultValue={defaultValue ?? undefined}>{options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
      ) : type === "textarea" ? (
        <textarea {...common} defaultValue={defaultValue ?? undefined} rows={rows ?? 3} placeholder={placeholder} />
      ) : (
        <input {...common} type={type} defaultValue={defaultValue ?? undefined} autoComplete={autoComplete} inputMode={inputMode} placeholder={placeholder} min={min} max={max} step={step} />
      )}
      {help && <span className="help" id={`${id}-help`}>{help}</span>}
      {err && <span className="error" id={`${id}-error`}>{err}</span>}
    </div>
  );
}

export function Submit({ children, className = "btn", pendingText }: { children: React.ReactNode; className?: string; pendingText?: string }) {
  const { pending } = useFormState();
  return <button type="submit" className={className} disabled={pending} aria-busy={pending}>{pending ? pendingText ?? "Even geduld…" : children}</button>;
}
