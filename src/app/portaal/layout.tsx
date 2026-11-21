import { Header } from "@/components/Header";
import { AppNav } from "@/components/AppNav";
import { requireCustomer } from "@/lib/auth";
import { CompanySwitcher } from "./CompanySwitcher";

export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCustomer();
  return (
    <div className="shell">
      <div>
        <Header area="portal" />
        <AppNav label="Mijn Bereyl" items={[
          { href: "/portaal", label: "Overzicht", exact: true },
          { href: "/portaal/boxen", label: "Mijn boxen" },
          { href: "/portaal/afspraken", label: "Afspraken" },
          { href: "/portaal/impact", label: "Mijn impact" },
          { href: "/portaal/abonnement", label: "Abonnement" },
          { href: "/portaal/facturen", label: "Facturen" },
          { href: "/portaal/documenten", label: "Documenten" },
          { href: "/portaal/bedrijf", label: "Bedrijfsgegevens" },
        ]} />
      </div>
      <main id="inhoud">
        <div className="container">
          {ctx.memberships.length > 1 && <CompanySwitcher current={ctx.companyId} options={ctx.memberships.map((m) => ({ id: m.company_id, name: m.company_name }))} />}
          {children}
        </div>
      </main>
    </div>
  );
}
