import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { q } from "@/lib/db";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatKg } from "@/lib/money";
import { ActionForm, Field, Submit } from "@/components/ActionForm";
import { PageHead, Empty, Flash } from "@/components/ui";
import { correctWeightAction, weighAction } from "../actions";

export default async function Wegingen({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const u = await requireStaff(["admin", "planner"]);
  const open = await q<any>(`SELECT c.*, co.name AS company_name, a.number, b.number AS box FROM collections c JOIN companies co ON co.id=c.company_id JOIN appointments a ON a.id=c.appointment_id LEFT JOIN boxes b ON b.id=c.box_taken_id WHERE c.status='picked_up' ORDER BY c.collected_at`);
  const done = await q<any>(`SELECT c.*, co.name AS company_name, a.number, (SELECT json_agg(json_build_object('at', w.created_at, 'old', w.old_grams, 'new', w.new_grams, 'reason', w.reason)) FROM weight_corrections w WHERE w.collection_id=c.id) AS corrections
    FROM collections c JOIN companies co ON co.id=c.company_id JOIN appointments a ON a.id=c.appointment_id WHERE c.status='weight_confirmed' ORDER BY c.weighed_at DESC LIMIT 50`);
  return (
    <div className="stack-lg">
      <PageHead title="Wegingen" intro="Opgehaald, weging volgt → Gewicht bevestigd. Een weging verandert de uitvoeringsstatus niet." />
      <Flash searchParams={sp} />
      <section className="stack">
        <h2>Te wegen ({open.length})</h2>
        {open.length === 0 ? <Empty title="Geen ontbrekende wegingen" /> : (
          <div className="grid grid-2">{open.map((c) => (
            <div key={c.id} className="card stack">
              <strong><Link href={`/beheer/klanten/${c.company_id}`}>{c.company_name}</Link> · {c.number}</strong>
              <span className="small">Opgehaald {formatDateTime(c.collected_at)}{c.box ? ` · box ${c.box}` : ""}</span>
              <ActionForm action={weighAction} className="row">
                <input type="hidden" name="collectionId" value={c.id} />
                <div style={{ flex: "1 1 140px" }}><Field name="kg" label="Nettogewicht (kg)" required /></div>
                <Submit className="btn btn-sm">Gewicht bevestigen</Submit>
              </ActionForm>
            </div>
          ))}</div>
        )}
      </section>
      <section className="card stack">
        <h2 style={{ fontSize: "1.2rem" }}>Recent bevestigd</h2>
        <div className="table-wrap"><table className="table small"><thead><tr><th>Klant</th><th>Afspraak</th><th>Datum</th><th>Gewicht</th><th>Correcties</th>{u.staff_role === "admin" && <th>Corrigeren</th>}</tr></thead>
          <tbody>{done.map((c) => (
            <tr key={c.id}>
              <td>{c.company_name}</td><td>{c.number}</td><td>{formatDate(c.collected_at, { short: true })}</td><td>{formatKg(c.net_weight_grams)}</td>
              <td>{(c.corrections ?? []).map((w: any, i: number) => <div key={i} className="tiny">{formatKg(w.old)} → {formatKg(w.new)}: {w.reason}</div>)}</td>
              {u.staff_role === "admin" && <td><details><summary style={{ cursor: "pointer" }}>Correctie</summary><ActionForm action={correctWeightAction} className="stack"><input type="hidden" name="collectionId" value={c.id} /><Field name="kg" label="Nieuw gewicht (kg)" required /><Field name="reason" label="Reden" required /><Submit className="btn btn-sm btn-secondary">Vastleggen</Submit></ActionForm></details></td>}
            </tr>
          ))}</tbody></table></div>
      </section>
    </div>
  );
}
