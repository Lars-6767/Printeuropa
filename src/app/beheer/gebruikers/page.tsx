import { requireStaff } from "@/lib/auth";
import { q } from "@/lib/db";
import { ActionForm, Field, Submit } from "@/components/ActionForm";
import { PageHead } from "@/components/ui";
import { inviteStaff, updateStaff } from "../actions";

const ROLES = [{ value: "admin", label: "Bereyl-beheerder" }, { value: "planner", label: "Planner" }, { value: "field", label: "Uitvoerend medewerker" }];

export default async function Gebruikers() {
  await requireStaff(["admin"]);
  const staff = await q<any>(`SELECT id, name, email, staff_role, active FROM users WHERE staff_role IS NOT NULL ORDER BY active DESC, name`);
  const customers = await q<any>(`SELECT u.name, u.email, c.name AS company, m.role, m.status FROM memberships m JOIN users u ON u.id=m.user_id JOIN companies c ON c.id=m.company_id ORDER BY c.name LIMIT 300`);
  return (
    <div className="stack-lg">
      <PageHead title="Gebruikers en rollen" back={{ href: "/beheer/instellingen", label: "Instellingen" }} intro="Beheerder: alles. Planner: werkvoorraad, planning, wegingen, klanten. Uitvoerend medewerker: eigen ritten en uitvoering. Klantbeheerder en klantmedewerker worden per bedrijf beheerd." />
      <section className="card stack">
        <h2 style={{ fontSize: "1.2rem" }}>Medewerkers</h2>
        {staff.map((s) => (
          <ActionForm key={s.id} action={updateStaff} className="row">
            <input type="hidden" name="userId" value={s.id} />
            <span style={{ flex: "1 1 240px" }}><strong>{s.name}</strong> · {s.email}</span>
            <div style={{ flex: "0 1 220px" }}><Field name="role" label="Rol" type="select" defaultValue={s.staff_role} options={ROLES} /></div>
            <label className="check"><input type="checkbox" name="active" defaultChecked={s.active} />Actief</label>
            <Submit className="btn btn-sm btn-secondary">Opslaan</Submit>
          </ActionForm>
        ))}
        <ActionForm action={inviteStaff} className="stack" resetOnSuccess>
          <h3>Medewerker uitnodigen</h3>
          <div className="grid grid-3"><Field name="name" label="Naam" required /><Field name="email" label="E-mail" type="email" required /><Field name="role" label="Rol" type="select" options={ROLES} /></div>
          <Submit className="btn btn-sm">Uitnodigen</Submit>
        </ActionForm>
      </section>
      <section className="card stack">
        <h2 style={{ fontSize: "1.2rem" }}>Klantgebruikers</h2>
        <div className="table-wrap"><table className="table small"><thead><tr><th>Naam</th><th>E-mail</th><th>Bedrijf</th><th>Rol</th><th>Status</th></tr></thead>
          <tbody>{customers.map((c, i) => <tr key={i}><td>{c.name}</td><td>{c.email}</td><td>{c.company}</td><td>{c.role === "customer_admin" ? "Klantbeheerder" : "Klantmedewerker"}</td><td>{c.status === "active" ? "Toegang bevestigd" : c.status === "pending" ? "Wacht op bevestiging" : "Ingetrokken"}</td></tr>)}</tbody></table></div>
      </section>
    </div>
  );
}
