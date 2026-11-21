import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { q } from "@/lib/db";
import { BOX_STATUS } from "@/lib/labels";
import { ActionForm, Field, Submit } from "@/components/ActionForm";
import { PageHead, Pill } from "@/components/ui";
import { addBoxes } from "../actions";

export default async function Boxen() {
  const u = await requireStaff(["admin", "planner"]);
  const boxes = await q<any>(`SELECT b.*, c.name AS company_name, l.name AS location_name FROM boxes b LEFT JOIN companies c ON c.id=b.company_id LEFT JOIN locations l ON l.id=b.location_id ORDER BY b.number`);
  const summary = await q<any>(`SELECT size, status, COUNT(*) AS n FROM boxes GROUP BY 1,2 ORDER BY 1,2`);
  return (
    <div className="stack-lg">
      <PageHead title="Fysieke boxen" intro="Boxnummers, status en locatie. Plaatsen en ophalen gebeurt via uitgevoerde afspraken." />
      <p className="small">{summary.map((s) => `${s.size} L ${BOX_STATUS[s.status].toLowerCase()}: ${s.n}`).join(" · ")}</p>
      {u.staff_role === "admin" && (
        <ActionForm action={addBoxes} className="card row">
          <div style={{ flex: "1 1 160px" }}><Field name="size" label="Formaat" type="select" options={[{ value: "250", label: "250 liter" }, { value: "500", label: "500 liter" }, { value: "1000", label: "1.000 liter" }]} /></div>
          <div style={{ flex: "1 1 120px" }}><Field name="count" label="Aantal" defaultValue={1} /></div>
          <Submit className="btn btn-sm">Boxen toevoegen</Submit>
        </ActionForm>
      )}
      <div className="table-wrap card" style={{ padding: 8 }}><table className="table small">
        <thead><tr><th>Nummer</th><th>Formaat</th><th>Status</th><th>Klant / locatie</th></tr></thead>
        <tbody>{boxes.map((b) => <tr key={b.id}><td><Link href={`/beheer/boxen/${b.id}`}>{b.number}</Link></td><td>{b.size} L</td><td><Pill tone={b.status === "placed" ? "ok" : b.status === "in_stock" ? undefined : "warn"}>{BOX_STATUS[b.status]}</Pill></td><td>{b.company_name ? <Link href={`/beheer/klanten/${b.company_id}`}>{b.company_name}</Link> : "–"}{b.location_name ? ` · ${b.location_name}` : ""}</td></tr>)}</tbody>
      </table></div>
    </div>
  );
}
