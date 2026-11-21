"use client";
/** Toont bevestigingen ook als het formulier na de actie uit beeld verdwijnt (bijv. een afgehandelde taak). */
import { useEffect, useState } from "react";

export function flash(message: string) {
  window.dispatchEvent(new CustomEvent("bereyl:flash", { detail: message }));
}

export function FlashRegion() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const on = (e: Event) => {
      setMsg((e as CustomEvent<string>).detail);
      clearTimeout(t);
      t = setTimeout(() => setMsg(null), 10000);
    };
    window.addEventListener("bereyl:flash", on);
    return () => { window.removeEventListener("bereyl:flash", on); clearTimeout(t); };
  }, []);
  return (
    <div role="status" aria-live="polite" style={{ position: "sticky", top: 72, zIndex: 15, marginTop: 12 }}>
      {msg && (
        <div className="notice notice-ok row between" style={{ boxShadow: "var(--shadow)", marginBottom: 12 }}>
          <span>{msg}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMsg(null)} aria-label="Melding sluiten">×</button>
        </div>
      )}
    </div>
  );
}
