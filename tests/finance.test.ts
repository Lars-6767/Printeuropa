import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { pool, tx, one, q } from "@/lib/db";
import { resetDb, activeCustomer, emptying } from "./helpers";
import { reserveCredit, releaseCredit, creditSummary, correctCredit } from "@/lib/credit";
import { settleAppointment, createInvoice, runSubscriptionBilling } from "@/lib/billing";
import { handlePaymentEvent } from "@/lib/payments";
import { canAccessFile } from "@/lib/access";

beforeAll(async () => { await resetDb(); });
afterAll(async () => { await pool().end(); });

describe("legingstegoed", () => {
  let ctx: Awaited<ReturnType<typeof activeCustomer>>;
  beforeEach(async () => { ctx = await activeCustomer(`Tegoed ${Math.random()}`); });

  it("gelijktijdige bevestigingen kunnen niet overboeken", async () => {
    const ids = await Promise.all(Array.from({ length: 7 }, () => emptying(ctx)));
    const results = await Promise.all(ids.map((id) => tx((c) => reserveCredit(c, ctx.subscriptionId, id, null))));
    expect(results.filter(Boolean)).toHaveLength(4);
    const s = await creditSummary(pool(), ctx.subscriptionId);
    expect(s.available).toBe(0);
    expect(s.reserved).toBe(4);
  });

  it("annuleren geeft tegoed terug; herhaald reserveren boekt niet dubbel", async () => {
    const id = await emptying(ctx);
    await tx((c) => reserveCredit(c, ctx.subscriptionId, id, null));
    await tx((c) => reserveCredit(c, ctx.subscriptionId, id, null));
    expect((await creditSummary(pool(), ctx.subscriptionId)).available).toBe(3);
    await tx((c) => releaseCredit(c, id, null));
    await tx((c) => releaseCredit(c, id, null));
    const s = await creditSummary(pool(), ctx.subscriptionId);
    expect([s.available, s.reserved]).toEqual([4, 0]);
  });

  it("correctie vereist reden en kan tegoed niet negatief maken", async () => {
    const period = await one<{ id: number }>(`SELECT id FROM credit_periods WHERE subscription_id=$1`, [ctx.subscriptionId]);
    await expect(tx((c) => correctCredit(c, period!.id, -1, "", 1))).rejects.toThrow(/reden/);
    await expect(tx((c) => correctCredit(c, period!.id, -5, "te veel", 1))).rejects.toThrow(/negatief/);
  });
});

describe("financiële afhandeling", () => {
  it("uitgevoerde inbegrepen leging wordt afgeboekt, één keer", async () => {
    const ctx = await activeCustomer("Afhandeling inbegrepen");
    const id = await emptying(ctx);
    await tx((c) => reserveCredit(c, ctx.subscriptionId, id, null));
    await q(`UPDATE appointments SET request_status='confirmed', execution_status='executed' WHERE id=$1`, [id]);
    const r1 = await tx((c) => settleAppointment(c, id, null));
    const r2 = await tx((c) => settleAppointment(c, id, null));
    expect(r1).toEqual({ outcome: "included", changed: true });
    expect(r2.changed).toBe(false);
    expect((await creditSummary(pool(), ctx.subscriptionId)).used).toBe(1);
    expect((await one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM invoices WHERE appointment_id=$1`, [id]))!.n).toBe(0);
  });

  it("betaalde rit: gelijktijdige afhandeling levert precies één factuur", async () => {
    const ctx = await activeCustomer("Afhandeling betaald");
    const id = await emptying(ctx, "paid", 10800);
    await q(`UPDATE appointments SET request_status='confirmed', execution_status='executed' WHERE id=$1`, [id]);
    await Promise.all([1, 2, 3].map(() => tx((c) => settleAppointment(c, id, null))));
    const inv = await q<any>(`SELECT * FROM invoices WHERE appointment_id=$1`, [id]);
    expect(inv).toHaveLength(1);
    expect([inv[0].subtotal_cents, inv[0].vat_cents, inv[0].total_cents]).toEqual([10800, 2268, 13068]);
    expect(inv[0].status).toBe("final");
  });

  it("geaccepteerde prijs blijft leidend na algemene prijswijziging", async () => {
    const ctx = await activeCustomer("Prijs leidend");
    const id = await emptying(ctx, "paid", 10800);
    const pricing = await one<any>(`SELECT data FROM config_versions WHERE key='pricing' AND status='published'`);
    pricing.data.boxes[0].emptyingCents = 99900;
    await q(`UPDATE config_versions SET data=$1 WHERE key='pricing' AND status='published'`, [pricing.data]);
    await q(`UPDATE appointments SET request_status='confirmed', execution_status='executed' WHERE id=$1`, [id]);
    await tx((c) => settleAppointment(c, id, null));
    expect((await one<any>(`SELECT subtotal_cents FROM invoices WHERE appointment_id=$1`, [id])).subtotal_cents).toBe(10800);
  });

  it("factuur met dezelfde bron wordt niet dubbel aangemaakt", async () => {
    const ctx = await activeCustomer("Bronsleutel");
    const a = await tx((c) => createInvoice(c, { sourceKey: "test:x", companyId: ctx.companyId, description: "x", lines: [{ description: "x", unitCents: 100 }] }));
    const b = await tx((c) => createInvoice(c, { sourceKey: "test:x", companyId: ctx.companyId, description: "x", lines: [{ description: "x", unitCents: 100 }] }));
    expect(a.created).toBe(true);
    expect(b).toEqual({ id: a.id, created: false });
  });

  it("dubbele provider-berichten: één statuswijziging en één faalmelding", async () => {
    const ctx = await activeCustomer("Betaalberichten");
    const inv = await tx((c) => createInvoice(c, { sourceKey: "test:pay", companyId: ctx.companyId, description: "x", lines: [{ description: "x", unitCents: 1000 }] }));
    await q(`INSERT INTO payments(invoice_id, provider, provider_payment_id, status, amount_cents) VALUES ($1,'demo','p1','pending',1210)`, [inv.id]);
    const r1 = await tx((c) => handlePaymentEvent(c, "demo", "evt1", "p1", "failed", {}));
    const r2 = await tx((c) => handlePaymentEvent(c, "demo", "evt1", "p1", "failed", {}));
    expect(r1.duplicate).toBe(false);
    expect(r2.duplicate).toBe(true);
    expect((await one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM jobs WHERE idempotency_key LIKE 'event:payment.failed:%'`))!.n).toBe(1);
    await tx((c) => handlePaymentEvent(c, "demo", "evt2", "p1", "paid", {}));
    await tx((c) => handlePaymentEvent(c, "demo", "evt3", "p1", "failed", {}));
    expect((await one<any>(`SELECT status FROM invoices WHERE id=$1`, [inv.id])).status).toBe("paid");
  });

  it("maandfacturatie is idempotent en stopt na de einddatum", async () => {
    const ctx = await activeCustomer("Maandfactuur");
    await q(`UPDATE subscriptions SET started_at='2026-08-15', billing_stops_at='2026-10-16' WHERE id=$1`, [ctx.subscriptionId]);
    await q(`UPDATE subscription_versions SET effective_from='2026-08-15' WHERE subscription_id=$1`, [ctx.subscriptionId]);
    await tx((c) => runSubscriptionBilling(c, "2026-12-05"));
    await tx((c) => runSubscriptionBilling(c, "2026-12-05"));
    const inv = await q<any>(`SELECT source_key, subtotal_cents FROM invoices WHERE subscription_id=$1 ORDER BY source_key`, [ctx.subscriptionId]);
    // aug: 17/31 dagen, sep: volledig, okt: 15/31 dagen (stopt na 15 okt), nov: geen
    expect(inv.map((i) => i.source_key.split(":")[2])).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(inv.map((i) => i.subtotal_cents)).toEqual([Math.round((3000 * 17) / 31), 3000, Math.round((3000 * 15) / 31)]);
  });
});

describe("toegangsgrenzen documenten", () => {
  it("klant ziet alleen eigen bestanden en vrijgegeven certificaten", async () => {
    const a = await activeCustomer("Klant A");
    const b = await activeCustomer("Klant B");
    const f = async (company: number | null, kind: string) => (await one<{ id: number }>(`INSERT INTO files(company_id, kind, path, filename, mime, size_bytes, sha256) VALUES ($1,$2,'x','x','application/pdf',1,'x') RETURNING id`, [company, kind]))!.id;
    const ownPdf = await f(a.companyId, "invoice_pdf");
    const otherPdf = await f(b.companyId, "invoice_pdf");
    const certFile = await f(null, "certificate");
    const cert = await one<{ id: number }>(`INSERT INTO certificates(title, kind, file_id) VALUES ('c','batch',$1) RETURNING id`, [certFile]);
    await q(`INSERT INTO certificate_releases(certificate_id, company_id) VALUES ($1,$2)`, [cert!.id, a.companyId]);
    const asA = { staffRole: null, companyIds: [a.companyId] };
    const asB = { staffRole: null, companyIds: [b.companyId] };
    expect(await canAccessFile(ownPdf, asA)).toBe(true);
    expect(await canAccessFile(otherPdf, asA)).toBe(false);
    expect(await canAccessFile(certFile, asA)).toBe(true);
    expect(await canAccessFile(certFile, asB)).toBe(false);
    expect(await canAccessFile(ownPdf, { staffRole: "field", companyIds: [] })).toBe(false);
    expect(await canAccessFile(ownPdf, { staffRole: "admin", companyIds: [] })).toBe(true);
    expect(await canAccessFile(ownPdf, { staffRole: null, companyIds: [] })).toBe(false);
  });
});
