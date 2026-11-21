import crypto from "node:crypto";
import { notFound } from "next/navigation";
import { requireCustomer } from "@/lib/auth";
import { one } from "@/lib/db";
import { getConfigs } from "@/lib/settings";
import { PageHead } from "@/components/ui";
import { ChangeForm } from "./ChangeForm";

export default async function Wijzigen({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCustomer("customer_admin");
  const sub = await one<any>(`SELECT s.id, v.box_size, v.package_code, v.terms FROM subscriptions s JOIN subscription_versions v ON v.subscription_id=s.id AND v.status='active' WHERE s.id=$1 AND s.company_id=$2 AND s.status='active'`, [Number(sp.sub), ctx.companyId]);
  if (!sub) notFound();
  const company = await one<any>(`SELECT printmasters_status FROM companies WHERE id=$1`, [ctx.companyId]);
  const cfg = await getConfigs(["pricing", "packages", "planning"]);
  return (
    <div className="stack-lg">
      <PageHead title="Abonnement wijzigen" back={{ href: "/portaal/abonnement", label: "Abonnement" }} intro="Vergelijk formaten en pakketten. Je ziet de nieuwe prijs, ingangsdatum en wat er met je tegoed gebeurt voordat je bevestigt." />
      <ChangeForm
        subscriptionId={sub.id}
        submissionId={crypto.randomUUID()}
        current={{ boxSize: sub.box_size, packageCode: sub.package_code, frequency: sub.terms.frequencyPerYear ?? null }}
        boxes={cfg.pricing.boxes.filter((b) => b.available).map((b) => ({ size: b.size, label: b.label, imageUrl: b.imageUrl }))}
        packages={cfg.packages.items.filter((p) => p.active && !p.archived && (p.kind !== "printmasters" || company.printmasters_status === "verified")).map((p) => ({ code: p.code, name: p.name, kind: p.kind, frequencies: p.frequencies.map((f) => f.perYear) }))}
        planning={{ dayparts: cfg.planning.dayparts, days: cfg.planning.days, minLeadDays: cfg.planning.minLeadDays, max: cfg.planning.maxPreferences }}
      />
    </div>
  );
}
