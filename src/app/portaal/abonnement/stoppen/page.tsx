import { notFound } from "next/navigation";
import { requireCustomer } from "@/lib/auth";
import { getConfig } from "@/lib/settings";
import { pool } from "@/lib/db";
import { previewCancel } from "@/lib/subscriptions";
import { formatEuro } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { ActionForm, Field, FieldError, Submit } from "@/components/ActionForm";
import { PreferenceFields } from "@/components/PreferencePicker";
import { PageHead, KV } from "@/components/ui";
import { cancelSubscriptionAction } from "../../actions";

export default async function Stoppen({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCustomer("customer_admin");
  const pv = await previewCancel(pool(), ctx.companyId, Number(sp.sub));
  if ("error" in pv) notFound();
  const planning = await getConfig("planning");
  return (
    <div className="stack-lg">
      <PageHead title="Abonnement stoppen en box laten ophalen" back={{ href: "/portaal/abonnement", label: "Abonnement" }} intro="Jammer dat jullie stoppen. Hieronder zie je wat er gebeurt. Jullie historie, facturen en certificaten blijven beschikbaar." />
      <section className="card stack">
        <KV rows={[
          ["Einddatum", formatDate(pv.endDate)],
          ["Abonnementsfacturatie en incasso stoppen", pv.billingStop ? `na ${formatDate(pv.endDate)}` : "op de dag dat we de box ophalen"],
          ["Ophaalkosten", pv.pickupCents === null ? "Nog vast te stellen door Bereyl" : `${formatEuro(pv.pickupCents)} excl. btw`],
          ["Nog te factureren", pv.openCosts.length ? pv.openCosts.map((a: any) => a.number).join(", ") : "Niets"],
          ["Verlenging", "Er ontstaat geen nieuwe jaarverplichting"],
        ]} />
        {(pv.provisionalRules.stop || pv.provisionalRules.notice) && <p className="small muted">De opzegregels zijn nog in concept bij Bereyl. Je ontvangt een bevestiging met de definitieve einddatum.</p>}
      </section>
      <ActionForm action={cancelSubscriptionAction} className="stack-lg">
        <input type="hidden" name="subscriptionId" value={pv.sub.id} />
        <section className="card stack">
          <h2 style={{ fontSize: "1.2rem" }}>Wanneer kunnen we de box ophalen?</h2>
          <PreferenceFields dayparts={planning.dayparts} days={planning.days} minLeadDays={planning.minLeadDays} max={planning.maxPreferences} />
          <Field name="reason" label="Wil je ons vertellen waarom jullie stoppen?" type="textarea" />
        </section>
        <label className="check"><input type="checkbox" name="confirm" />Ik wil het abonnement stoppen per {formatDate(pv.endDate)} en de box laten ophalen.</label>
        <FieldError name="confirm" />
        <Submit className="btn btn-danger btn-block">Abonnement stoppen en box laten ophalen</Submit>
      </ActionForm>
    </div>
  );
}
