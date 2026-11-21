import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { q } from "@/lib/db";
import { formatKg } from "@/lib/money";
import { DESTINATION } from "@/lib/labels";
import { ActionForm, Field, Submit } from "@/components/ActionForm";
import { PageHead, Pill } from "@/components/ui";
import { createBatchAction } from "../actions";

export default async function Partijen() {
  await requireStaff(["admin"]);
  const batches = await q<any>(`SELECT b.*, COUNT(c.id) AS n, COALESCE(SUM(c.net_weight_grams),0) AS grams, COUNT(DISTINCT c.company_id) AS companies,
    (SELECT COUNT(*) FROM certificates ce WHERE ce.batch_id=b.id AND ce.status='released') AS released
    FROM processing_batches b LEFT JOIN collections c ON c.batch_id=b.id GROUP BY b.id ORDER BY b.id DESC`);
  return (
    <div className="stack-lg">
      <PageHead title="Verwerkingspartijen en certificaten" intro="Koppel gewogen inzamelingen van meerdere klanten aan een partij, leg de bestemming vast en geef certificaten vrij." />
      <ActionForm action={createBatchAction} className="card row">
        <div style={{ flex: "1 1 260px" }}><Field name="processor" label="Verwerkingspartij" required /></div>
        <Submit className="btn">Nieuwe partij</Submit>
      </ActionForm>
      <div className="table-wrap card" style={{ padding: 8 }}><table className="table">
        <thead><tr><th>Partij</th><th>Verwerker</th><th>Inzamelingen</th><th>Gewicht</th><th>Bestemming</th><th>Certificaat</th></tr></thead>
        <tbody>{batches.map((b) => <tr key={b.id}><td><Link href={`/beheer/partijen/${b.id}`}>{b.number}</Link></td><td>{b.processor}</td><td>{b.n} ({b.companies} klanten)</td><td>{formatKg(b.grams)}</td><td>{b.status === "processed" ? DESTINATION[b.destination] ?? "–" : <Pill tone="warn">Open</Pill>}</td><td>{Number(b.released) ? <Pill tone="ok">Vrijgegeven</Pill> : b.status === "processed" ? <Pill tone="accent">Gereed voor certificaat</Pill> : "–"}</td></tr>)}</tbody>
      </table></div>
    </div>
  );
}
