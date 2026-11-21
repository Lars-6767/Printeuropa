"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

export function LocationFilter({ locations, current }: { locations: { id: number; name: string; city: string }[]; current: number | null }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  return (
    <div className="field" style={{ maxWidth: 360 }}>
      <label htmlFor="loc-filter">Vestiging</label>
      <select id="loc-filter" value={current ?? ""} onChange={(e) => { const n = new URLSearchParams(sp.toString()); if (e.target.value) n.set("locatie", e.target.value); else n.delete("locatie"); router.push(`${path}?${n}`); }}>
        <option value="">Alle vestigingen samen</option>
        {locations.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.city})</option>)}
      </select>
    </div>
  );
}
