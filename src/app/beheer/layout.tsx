import { Header } from "@/components/Header";
import { AppNav } from "@/components/AppNav";
import { requireStaff } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const u = await requireStaff();
  const all = [
    { href: "/beheer", label: "Werkvoorraad", exact: true, roles: ["admin", "planner"] },
    { href: "/beheer/planning", label: "Planning", roles: ["admin", "planner"] },
    { href: "/beheer/uitvoering", label: "Uitvoering", roles: ["admin", "planner", "field"] },
    { href: "/beheer/wegingen", label: "Wegingen", roles: ["admin", "planner"] },
    { href: "/beheer/klanten", label: "Klanten", roles: ["admin", "planner"] },
    { href: "/beheer/boxen", label: "Boxen", roles: ["admin", "planner"] },
    { href: "/beheer/partijen", label: "Partijen", roles: ["admin"] },
    { href: "/beheer/facturen", label: "Facturen", roles: ["admin"] },
    { href: "/beheer/instellingen", label: "Instellingen", roles: ["admin"] },
  ];
  return (
    <div className="shell">
      <div>
        <Header area="admin" />
        <AppNav label="Beheer" items={all.filter((i) => i.roles.includes(u.staff_role!))} />
      </div>
      <main id="inhoud"><div className="container">{children}</div></main>
    </div>
  );
}
