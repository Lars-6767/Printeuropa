import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { q } from "@/lib/db";
import { formatDate, today, addDays } from "@/lib/dates";
import { TYPE } from "@/lib/labels";
import { PageHead, Empty, Pill, Flash } from "@/components/ui";

export default async function Uitvoering({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const u = await requireStaff();
  const mine = u.staff_role === "field" || sp.mijn === "1";
  const list = await q<any>(`SELECT a.*, c.name AS company_name, l.street, l.postcode, l.city, l.instructions FROM appointments a JOIN companies c ON c.id=a.company_id JOIN locations l ON l.id=a.location_id
    WHERE a.request_status='confirmed' AND a.execution_status='pending' AND a.planned_date <= $1 AND ($2::int IS NULL OR a.assigned_user_id=$2 OR a.assigned_user_id IS NULL)
    ORDER BY a.planned_date, a.planned_daypart NULLS LAST`, [addDays(today(), 7), mine ? u.id : null]);
  return (
    <div className="stack-lg narrow" style={{ margin: "0 auto" }}>
      <PageHead title="Uitvoering" intro="Open een afspraak, registreer de boxen, maak foto's en leg de uitvoering vast." />
      <Flash searchParams={sp} />
      {list.length === 0 ? <Empty title="Geen ritten gepland">Bevestigde afspraken voor de komende week verschijnen hier.</Empty> : (
        <ul className="stack" style={{ listStyle: "none", padding: 0 }}>
          {list.map((a) => (
            <li key={a.id}>
              <Link href={`/beheer/uitvoering/${a.id}`} className="card stack" style={{ display: "block", textDecoration: "none" }}>
                <div className="row between"><strong>{TYPE[a.type]} · {a.company_name}</strong><Pill tone={a.planned_date < today() ? "danger" : a.planned_date === today() ? "accent" : undefined}>{formatDate(a.planned_date, { weekday: true, short: true })}</Pill></div>
                <span className="small">{a.street}, {a.postcode} {a.city}</span>
                {a.instructions && <span className="small muted">{a.instructions}</span>}
                <span className="small">{a.number} · {a.type === "swap" ? `${a.box_size} → ${a.new_box_size} L` : `${a.box_size} L`}{a.combine_printmasters ? " · samen met PrintMasters-levering" : ""}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
