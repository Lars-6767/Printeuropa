import crypto from "node:crypto";
import Link from "next/link";
import { requireCustomer } from "@/lib/auth";
import { companyOverview } from "@/lib/portal";
import { getConfig } from "@/lib/settings";
import { PageHead, Empty } from "@/components/ui";
import { EmptyingForm } from "./EmptyingForm";

export default async function NieuweLeging({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCustomer();
  const o = await companyOverview(ctx.companyId);
  const planning = await getConfig("planning");
  const locs = o.subscriptions.filter((s) => s.status === "active" || s.status === "ending").map((s) => ({ id: s.location_id, name: `${s.location_name} (${s.terms?.boxLabel})` }));
  return (
    <div className="stack-lg">
      <PageHead title="Leging aanvragen" back={{ href: "/portaal/afspraken", label: "Afspraken" }} intro="Kies een of meer voorkeursdagen. Bereyl bevestigt de afspraak. Bij een leging nemen we de volle box mee en zetten we een lege terug." />
      {locs.length === 0 ? <Empty title="Nog geen actieve box" action={<Link className="btn" href="/portaal">Naar overzicht</Link>}>Een leging aanvragen kan zodra de box geplaatst is.</Empty> : (
        <EmptyingForm locations={locs} initialLocation={Number(sp.locatie) || locs[0].id} submissionId={crypto.randomUUID()}
          planning={{ dayparts: planning.dayparts, days: planning.days, minLeadDays: planning.minLeadDays, max: planning.maxPreferences }} />
      )}
    </div>
  );
}
