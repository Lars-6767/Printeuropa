/**
 * Betaalprovider-laag. Ondersteunt Mollie (incasso via mandaat) en een duidelijk gemarkeerde demo-provider.
 * Provider-events worden met hun unieke id opgeslagen: dubbele berichten hebben geen effect.
 */
import { one, q, type Db } from "./db";
import { emitEvent } from "./jobs";
import { getConfig } from "./settings";
import { createTask } from "./tasks";
import { audit } from "./audit";

export type ProviderName = "mollie" | "demo";

export async function activeProvider(db?: Db): Promise<{ name: ProviderName | null; message: string }> {
  const integ = await getConfig("integrations", db);
  if (integ.paymentProvider === "mollie") {
    return process.env.MOLLIE_API_KEY ? { name: "mollie", message: "Mollie actief" } : { name: null, message: "Mollie gekozen, maar MOLLIE_API_KEY ontbreekt" };
  }
  if (process.env.DEMO_MODE === "true") return { name: "demo", message: "Demo-betaalprovider (er wordt niets echt geïncasseerd)" };
  return { name: null, message: "Geen betaalprovider gekozen" };
}

async function mollie(path: string, init: { method?: string; body?: unknown } = {}) {
  const res = await fetch(`https://api.mollie.com/v2${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${process.env.MOLLIE_API_KEY}`, "Content-Type": "application/json" },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Mollie ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function validMandate(db: Db, companyId: number) {
  return one<any>(`SELECT * FROM mandates WHERE company_id=$1 AND status='valid' ORDER BY id DESC LIMIT 1`, [companyId], db);
}

/** Start incasso voor een definitieve factuur. Zonder geldig mandaat: zichtbare taak met herstelactie. */
export async function collectInvoice(db: Db, invoiceId: number) {
  const inv = await one<any>(`SELECT * FROM invoices WHERE id=$1`, [invoiceId], db);
  if (!inv || !["final", "sent", "payment_failed"].includes(inv.status) || inv.total_cents <= 0) return { skipped: true };
  const existing = await one(`SELECT 1 FROM payments WHERE invoice_id=$1 AND status IN ('open','pending','paid')`, [invoiceId], db);
  if (existing) return { skipped: true };
  const provider = await activeProvider(db);
  if (!provider.name) {
    await createTask(db, { type: "payment_setup", title: `Incasso ${inv.number} niet gestart: ${provider.message}`, companyId: inv.company_id, refType: "invoice", refId: invoiceId, dedupeKey: `collect:${invoiceId}` });
    return { skipped: true };
  }
  const mandate = await validMandate(db, inv.company_id);
  if (!mandate) {
    await createTask(db, { type: "mandate_missing", title: `Incasso ${inv.number} niet mogelijk: incassotoestemming ontbreekt`, companyId: inv.company_id, refType: "invoice", refId: invoiceId, dedupeKey: `mandate_missing:${invoiceId}` });
    return { skipped: true };
  }
  let providerPaymentId: string;
  if (provider.name === "mollie") {
    const p = await mollie("/payments", {
      method: "POST",
      body: {
        amount: { currency: "EUR", value: (inv.total_cents / 100).toFixed(2) },
        description: `Bereyl ${inv.number}`,
        sequenceType: "recurring",
        customerId: mandate.details?.customerId,
        mandateId: mandate.provider_mandate_id,
        webhookUrl: `${process.env.APP_URL}/api/betalingen/webhook/mollie`,
        metadata: { invoiceId },
      },
    });
    providerPaymentId = p.id;
  } else {
    providerPaymentId = `demo_${invoiceId}_${Date.now()}`;
  }
  await q(`INSERT INTO payments(invoice_id, provider, provider_payment_id, status, amount_cents) VALUES ($1,$2,$3,'pending',$4) ON CONFLICT DO NOTHING`, [invoiceId, provider.name, providerPaymentId, inv.total_cents], db);
  return { providerPaymentId };
}

/**
 * Verwerkt een statusbericht van de provider. eventId moet uniek zijn per bericht;
 * een herhaald bericht wordt herkend en heeft geen effect.
 */
export async function handlePaymentEvent(db: Db, provider: ProviderName, eventId: string, providerPaymentId: string, status: "paid" | "failed" | "pending", payload: unknown) {
  const ins = await one<{ id: number }>(
    `INSERT INTO payment_events(provider, provider_event_id, payload) VALUES ($1,$2,$3) ON CONFLICT (provider, provider_event_id) DO NOTHING RETURNING id`,
    [provider, eventId, JSON.stringify(payload ?? {})], db,
  );
  if (!ins) return { duplicate: true };
  const pay = await one<any>(`SELECT * FROM payments WHERE provider=$1 AND provider_payment_id=$2 FOR UPDATE`, [provider, providerPaymentId], db);
  if (!pay) throw new Error(`Onbekende betaling ${providerPaymentId}`);
  if (pay.status === status || pay.status === "paid") {
    await q(`UPDATE payment_events SET processed_at=now() WHERE id=$1`, [ins.id], db);
    return { duplicate: false, unchanged: true };
  }
  await q(`UPDATE payments SET status=$2, updated_at=now() WHERE id=$1`, [pay.id, status], db);
  const inv = await one<any>(`SELECT * FROM invoices WHERE id=$1`, [pay.invoice_id], db);
  if (status === "paid") {
    await q(`UPDATE invoices SET status='paid' WHERE id=$1 AND status <> 'credited'`, [inv.id], db);
  } else if (status === "failed") {
    await q(`UPDATE invoices SET status='payment_failed' WHERE id=$1 AND status <> 'credited'`, [inv.id], db);
    await emitEvent(db, "payment.failed", { invoiceId: inv.id, companyId: inv.company_id }, `payment:${pay.id}`);
  }
  await audit(db, { company: inv.company_id, action: `payment.${status}`, entityType: "invoice", entityId: inv.id, data: { provider, providerPaymentId, eventId } });
  await q(`UPDATE payment_events SET processed_at=now() WHERE id=$1`, [ins.id], db);
  return { duplicate: false, unchanged: false };
}

/** Haalt bij Mollie de actuele status op (webhook bevat alleen het id). */
export async function fetchMollieStatus(paymentId: string): Promise<{ status: "paid" | "failed" | "pending"; mandateId: string | null }> {
  const p = await mollie(`/payments/${encodeURIComponent(paymentId)}`);
  const status = p.status === "paid" ? "paid" : ["failed", "canceled", "expired"].includes(p.status) ? "failed" : "pending";
  return { status, mandateId: p.mandateId ?? null };
}

/** Incassotoestemming. Bij Mollie via een eerste betaling; bij de demo-provider direct (gemarkeerd als demo). */
export async function startMandate(db: Db, companyId: number, userId: number): Promise<{ redirectUrl?: string; demo?: boolean; error?: string }> {
  const provider = await activeProvider(db);
  if (!provider.name) return { error: provider.message };
  if (provider.name === "demo") {
    await q(`INSERT INTO mandates(company_id, provider, provider_mandate_id, status, details) VALUES ($1,'demo',$2,'valid',$3)`, [companyId, `demo_mdt_${companyId}_${Date.now()}`, JSON.stringify({ demo: true, by: userId })], db);
    await audit(db, { actor: userId, company: companyId, action: "mandate.demo_created", entityType: "company", entityId: companyId });
    return { demo: true };
  }
  const company = await one<any>(`SELECT * FROM companies WHERE id=$1`, [companyId], db);
  const customer = await mollie("/customers", { method: "POST", body: { name: company.name, email: company.invoice_email ?? undefined, metadata: { companyId } } });
  const payment = await mollie("/payments", {
    method: "POST",
    body: {
      amount: { currency: "EUR", value: "0.01" },
      description: "Bereyl incassotoestemming",
      sequenceType: "first",
      customerId: customer.id,
      redirectUrl: `${process.env.APP_URL}/portaal/facturen?machtiging=terug`,
      webhookUrl: `${process.env.APP_URL}/api/betalingen/webhook/mollie`,
      metadata: { companyId, purpose: "mandate" },
    },
  });
  await q(`INSERT INTO mandates(company_id, provider, provider_mandate_id, status, details) VALUES ($1,'mollie',NULL,'pending',$2)`, [companyId, JSON.stringify({ customerId: customer.id, firstPaymentId: payment.id })], db);
  return { redirectUrl: payment._links?.checkout?.href };
}
