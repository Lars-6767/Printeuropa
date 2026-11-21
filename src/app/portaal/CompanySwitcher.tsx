"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { switchCompany } from "./actions";

export function CompanySwitcher({ current, options }: { current: number; options: { id: number; name: string }[] }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="field" style={{ maxWidth: 360, marginBottom: 16 }}>
      <label htmlFor="company-switch">Bedrijf</label>
      <select id="company-switch" defaultValue={current} disabled={pending} onChange={(e) => start(async () => { await switchCompany(Number(e.target.value)); router.refresh(); })}>
        {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </div>
  );
}
