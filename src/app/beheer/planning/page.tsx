import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { q } from "@/lib/db";
import { getConfig } from "@/lib/settings";
import { formatDate, today, addDays } from "@/lib/dates";
import { formatEuro } from "@/lib/money";
import { prefsText } from "@/lib/documents";
import { FUNDING, TYPE } from "@/lib/labels";
import { ActionForm, Field, Submit } from "@/components/ActionForm";
import { PageHead, Pill, Empty, Flash } from "@/components/ui";
import { cancelAppointmentStaff, confirmAppointmentAction } from "../actions";

export default async function Planning({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  await requireStaff(["admin", "planner"]);
  const planning = await getConfig("planning");
  const day = sp.datum && /^\d{4}-\d{2}-\d{2}$/.test(sp.datum) ? sp.datum : today();
  const [requested, routes, staff, dayList, load] = await Promise.all([
    q<any>(`SELECT a.*, c.name AS company_name, l.name AS location_name, l.street, l.postcode, l.city, l.instructions, c.printmasters_status
      FROM appointments a JOIN companies c ON c.id=a.company_id JOIN locations l ON l.id=a.location_id
      WHERE (a.request_status='requested' OR a.id=$1) AND ($2::text IS NULL OR a.type=$2) ORDER BY a.created_at`, [Number(sp.id) || 0, sp.type ?? null]),
    q<any>(`SELECT * FROM staff_routes WHERE active ORDER BY id`),
    q<any>(`SELECT id, name FROM users WHERE staff_role IS NOT NULL AND active ORDER BY name`),
    q<any>(`SELECT a.*, c.name AS company_name, l.name AS location_name, l.street, l.postcode, l.city, l.instructions, r.name AS route_name, u.name AS employee
      FROM appointments a JOIN companies c ON c.id=a.company_id JOIN locations l ON l.id=a.location_id LEFT JOIN staff_routes r ON r.id=a.route_id LEFT JOIN users u ON u.id=a.assigned_user_id
      WHERE a.planned_date=$1 AND a.request_status='confirmed' ORDER BY r.name NULLS LAST, a.planned_daypart NULLS LAST`, [day]),
    q<any>(`SELECT planned_date, route_id, COUNT(*) AS n FROM appointments WHERE request_status='confirmed' AND planned_date BETWEEN $1 AND $2 GROUP BY 1,2`, [today(), addDays(today(), 13)]),
  ]);
  const dp = (c: string | null) => planning.dayparts.find((d) => d.code === c)?.label ?? "Hele dag";
  const days = Array.from({ length: 14 }, (_, i) => addDays(today(), i));
  const doubles = new Set(dayList.map((a) => a.location_id).filter((id, i, arr) => arr.indexOf(id) !== i));
  return (
    <div className="stack-lg">
      <PageHead title="Planning" intro="Bevestig aanvragen, plan per route of medewerker en bekijk het dagoverzicht." />
      <Flash searchParams={sp} />
      <section className="card stack">
        <h2 style={{ fontSize: "1.2rem" }}>Bezetting komende 14 dagen</h2>
        <div className="table-wrap"><table className="table small">
          <thead><tr><th>Route</th>{days.map((d) => <th key={d} className="nowrap"><Link href={`/beheer/planning?datum=${d}`}>{formatDate(d, { weekday: true, short: true })}</Link></th>)}</tr></thead>
          <tbody>{routes.map((r) => <tr key={r.id}><td className="nowrap">{r.name}</td>{days.map((d) => { const n = Number(load.find((x) => x.planned_date === d && x.route_id === r.id)?.n ?? 0); return <td key={d} style={n >= r.capacity_per_day ? { background: "var(--danger-bg)", fontWeight: 700 } : undefined}>{n}/{r.capacity_per_day}</td>; })}</tr>)}</tbody>
        </table></div>
      </section>

      <section className="stack">
        <h2>Te bevestigen ({requested.filter((a) => a.request_status === "requested").length})</h2>
        {requested.length === 0 && <Empty title="Alles is bevestigd" />}
        {requested.map((a) => {
          const first = (a.preferences ?? [])[0];
          return (
            <article key={a.id} className="card stack">
              <div className="row between">
                <strong>{TYPE[a.type]} {a.number} · <Link href={`/beheer/klanten/${a.company_id}`}>{a.company_name}</Link></strong>
                <span>{a.type === "swap" && <Pill tone="warn">Boxwissel {a.box_size} → {a.new_box_size} L</Pill>} {a.combine_printmasters && <Pill tone="accent">Combinatie aangevraagd</Pill>} {a.request_status === "confirmed" && <Pill tone="ok">Bevestigd {formatDate(a.planned_date, { short: true })}</Pill>}</span>
              </div>
              <span className="small">{a.location_name} · {a.street}, {a.postcode} {a.city}{a.instructions ? ` · ${a.instructions}` : ""}</span>
              <span className="small"><strong>Voorkeur:</strong> {prefsText(a.preferences ?? [], a.flexible, planning.dayparts)}{a.note ? ` · Opmerking: ${a.note}` : ""}</span>
              <span className="small"><strong>Afhandeling:</strong> {FUNDING[a.funding] ?? a.funding}{a.price_cents !== null && a.funding !== "included" ? ` · ${formatEuro(a.price_cents)}` : ""}{a.printmasters_delivery_ref ? ` · PrintMasters-levering: ${a.printmasters_delivery_ref}` : ""}</span>
              <ActionForm action={confirmAppointmentAction} className="stack">
                <input type="hidden" name="appointmentId" value={a.id} />
                <div className="grid grid-4">
                  <Field name="date" label="Datum" type="date" required defaultValue={a.planned_date ?? first?.date ?? ""} />
                  <Field name="daypart" label="Dagdeel" type="select" defaultValue={a.planned_daypart ?? first?.daypart ?? ""} options={[{ value: "", label: "Hele dag" }, ...planning.dayparts.map((d) => ({ value: d.code, label: d.label }))]} />
                  <Field name="routeId" label="Route" type="select" defaultValue={a.route_id ? String(a.route_id) : String(routes[0]?.id ?? "")} options={[{ value: "", label: "–" }, ...routes.map((r) => ({ value: String(r.id), label: r.name }))]} />
                  <Field name="assignedUserId" label="Medewerker" type="select" defaultValue={a.assigned_user_id ? String(a.assigned_user_id) : String(routes[0]?.employee_user_id ?? "")} options={[{ value: "", label: "–" }, ...staff.map((s) => ({ value: String(s.id), label: s.name }))]} />
                </div>
                {a.combine_printmasters && <Field name="combinationStatus" label="Combinatie met PrintMasters-levering" type="select" defaultValue="confirmed" options={[{ value: "confirmed", label: "Afgestemd: gecombineerd met levering" }, { value: "declined", label: "Niet mogelijk: losse leging (tegoed of betaald)" }]} />}
                <label className="check small"><input type="checkbox" name="force" />Toch inplannen bij waarschuwing (vol of dubbel)</label>
                <div className="row"><Submit className="btn btn-sm">{a.request_status === "confirmed" ? "Planning wijzigen" : "Bevestigen"}</Submit></div>
              </ActionForm>
              <details><summary className="small" style={{ cursor: "pointer" }}>Annuleren</summary>
                <ActionForm action={cancelAppointmentStaff} className="row" confirm="Afspraak annuleren?"><input type="hidden" name="appointmentId" value={a.id} /><Field name="reason" label="Reden" /><Submit className="btn btn-sm btn-danger">Annuleren</Submit></ActionForm>
              </details>
            </article>
          );
        })}
      </section>

      <section className="card stack" aria-labelledby="dag">
        <div className="row between">
          <h2 id="dag" style={{ margin: 0 }}>Dagoverzicht {formatDate(day, { weekday: true })}</h2>
          <form className="row"><label htmlFor="datum" className="sr-only">Datum</label><input id="datum" type="date" name="datum" defaultValue={day} style={{ width: "auto" }} /><button className="btn btn-sm btn-secondary">Toon</button></form>
        </div>
        {dayList.length === 0 ? <p className="muted">Geen afspraken op deze dag.</p> : (
          <div className="table-wrap"><table className="table small">
            <thead><tr><th>Route</th><th>Dagdeel</th><th>Afspraak</th><th>Locatie en instructies</th><th>Medewerker</th><th>Status</th></tr></thead>
            <tbody>{dayList.map((a) => (
              <tr key={a.id}>
                <td>{a.route_name ?? "–"}</td><td>{dp(a.planned_daypart)}</td>
                <td><Link href={`/beheer/uitvoering/${a.id}`}>{TYPE[a.type]} {a.number}</Link><div className="tiny">{a.company_name} · {a.box_size} L</div></td>
                <td>{a.street}, {a.postcode} {a.city}{a.instructions && <div className="tiny muted">{a.instructions}</div>}{doubles.has(a.location_id) && <div><Pill tone="danger">Dubbele planning op deze locatie</Pill></div>}</td>
                <td>{a.employee ?? "–"}</td>
                <td>{a.execution_status === "executed" ? <Pill tone="ok">Uitgevoerd</Pill> : <Pill>Gepland</Pill>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}
