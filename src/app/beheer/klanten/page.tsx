import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { q } from "@/lib/db";
import { PageHead, Pill } from "@/components/ui";
import { PM_STATUS, SUB_STATUS } from "@/lib/labels";

export default async function Klanten({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  await requireStaff(["admin", "planner"]);
  const term = (sp.q ?? "").trim();
  const like = `%${term}%`;
  const rows = await q<any>(`SELECT c.id, c.name, c.printmasters_status, c.is_demo,
      (SELECT string_agg(DISTINCT l.postcode || ' ' || l.city, ', ') FROM locations l WHERE l.company_id=c.id) AS places,
      (SELECT string_agg(DISTINCT s.status, ',') FROM subscriptions s WHERE s.company_id=c.id) AS sub_statuses,
      (SELECT COUNT(*) FROM proposals p WHERE p.company_id=c.id AND p.status='open') AS open_proposals,
      (SELECT MAX(r.number) FROM requests r WHERE r.company_id=c.id) AS request_number
    FROM companies c
    WHERE $1 = '' OR c.name ILIKE $2
      OR EXISTS (SELECT 1 FROM locations l WHERE l.company_id=c.id AND (replace(l.postcode,' ','') ILIKE replace($2,' ','') OR l.city ILIKE $2))
      OR EXISTS (SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.company_id=c.id AND (u.name ILIKE $2 OR u.email ILIKE $2))
      OR EXISTS (SELECT 1 FROM requests r WHERE r.company_id=c.id AND r.number ILIKE $2)
      OR EXISTS (SELECT 1 FROM boxes b WHERE b.company_id=c.id AND b.number ILIKE $2)
      OR EXISTS (SELECT 1 FROM appointments a WHERE a.company_id=c.id AND a.number ILIKE $2)
    ORDER BY ${sp.filter === "open" ? "open_proposals DESC," : ""} c.id DESC LIMIT 200`, [term, like]);
  const outside = await q<any>(`SELECT * FROM requests WHERE kind='outside_area' ORDER BY id DESC LIMIT 20`);
  return (
    <div className="stack-lg">
      <PageHead title="Klanten" intro="Zoek op bedrijfsnaam, postcode, contactpersoon, aanvraag-, afspraak- of boxnummer." />
      <form className="row" role="search">
        <label htmlFor="zoek" className="sr-only">Zoeken</label>
        <input id="zoek" type="search" name="q" defaultValue={term} placeholder="Bijv. 4811, AV-2026-0001, BX-0004" style={{ maxWidth: 420 }} />
        <button className="btn" type="submit">Zoeken</button>
      </form>
      <div className="table-wrap card" style={{ padding: 8 }}>
        <table className="table">
          <thead><tr><th>Bedrijf</th><th>Locaties</th><th>Abonnement</th><th>PrintMasters</th><th>Aanvraag</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td><Link href={`/beheer/klanten/${r.id}`}>{r.name}</Link> {r.is_demo && <span className="demo-badge">DEMO</span>}{Number(r.open_proposals) > 0 && <> <Pill tone="accent">Open voorstel</Pill></>}</td>
              <td className="small">{r.places}</td>
              <td className="small">{(r.sub_statuses ?? "").split(",").filter(Boolean).map((s: string) => SUB_STATUS[s]).join(", ") || "–"}</td>
              <td className="small">{PM_STATUS[r.printmasters_status]}</td>
              <td className="small nowrap">{r.request_number ?? "–"}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {outside.length > 0 && (
        <section className="card stack">
          <h2 style={{ fontSize: "1.2rem" }}>Aanvragen buiten werkgebied (CRM)</h2>
          <ul>{outside.map((r) => <li key={r.id}><strong>{r.contact.company}</strong> · {r.contact.name} · {r.contact.email} · {r.contact.phone} · {r.answers.postcode} {r.answers.city} · box {r.answers.box} · {r.answers.amount} <span className="muted small">({r.number})</span></li>)}</ul>
        </section>
      )}
    </div>
  );
}
