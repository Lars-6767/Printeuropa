"use server";
import { cookies } from "next/headers";
import { z } from "zod";
import { requireCustomer, COMPANY_COOKIE, clientMeta, hashPassword, passwordProblems, activeMemberships, requireUser } from "@/lib/auth";
import { one, q, tx } from "@/lib/db";
import { acceptProposal } from "@/lib/proposals";
import { cancelAppointment, changePreferences, previewEmptying, requestEmptying } from "@/lib/appointments";
import { cancelSubscription, previewChange, requestChange } from "@/lib/subscriptions";
import { normalizePostcode } from "@/lib/workarea";
import { getConfigs } from "@/lib/settings";
import { calculateDistance } from "@/lib/distance";
import { emitEvent } from "@/lib/jobs";
import { audit } from "@/lib/audit";
import { startMandate, handlePaymentEvent, activeProvider } from "@/lib/payments";
import { storeFile, validateUpload } from "@/lib/storage";
import { formatEuro } from "@/lib/money";
import type { BoxSize } from "@/lib/config";

type R = { ok?: boolean; error?: string; fieldErrors?: Record<string, string>; message?: string; redirect?: string };

function prefs(fd: FormData) {
  try {
    const p = JSON.parse(String(fd.get("preferences") ?? "{}"));
    return { flexible: Boolean(p.flexible), slots: Array.isArray(p.slots) ? p.slots.filter((s: any) => typeof s?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.date)).map((s: any) => ({ date: s.date, daypart: typeof s.daypart === "string" ? s.daypart : null })) : [] };
  } catch {
    return { flexible: false, slots: [] };
  }
}

async function ownLocation(companyId: number, locationId: number) {
  return one<{ id: number }>(`SELECT id FROM locations WHERE id=$1 AND company_id=$2`, [locationId, companyId]);
}

export async function switchCompany(companyId: number) {
  const user = await requireUser();
  const ms = await activeMemberships(user.id);
  if (!ms.some((m) => m.company_id === companyId)) return;
  (await cookies()).set(COMPANY_COOKIE, String(companyId), { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" });
}

export async function acceptAction(fd: FormData): Promise<R> {
  const ctx = await requireCustomer("customer_admin");
  const proposalId = Number(fd.get("proposalId"));
  if (fd.get("agree") !== "on") return { fieldErrors: { agree: "Bevestig dat je akkoord gaat met het voorstel en de voorwaarden." } };
  const r = await acceptProposal(proposalId, ctx.user.id, ctx.companyId, await clientMeta());
  if ("error" in r && r.error) return { error: r.error };
  return { redirect: `/portaal/voorstel/${proposalId}?akkoord=1` };
}

export async function previewEmptyingAction(locationId: number, combine: boolean) {
  const ctx = await requireCustomer();
  if (!(await ownLocation(ctx.companyId, locationId))) return { error: "Onbekende locatie" };
  const db = (await import("@/lib/db")).pool();
  const r = await previewEmptying(db, ctx.companyId, locationId, combine);
  if ("error" in r) return { error: r.error };
  return { funding: r.funding, priceCents: r.priceCents, explanation: r.explanation, combinable: r.combinable, available: r.credit.available, reserved: r.credit.reserved, pending: r.credit.pendingRequests, periodStart: r.credit.period?.starts_on ?? null, periodEnd: r.credit.period?.ends_on ?? null };
}

export async function requestEmptyingAction(fd: FormData): Promise<R> {
  const ctx = await requireCustomer();
  const locationId = Number(fd.get("locationId"));
  if (!(await ownLocation(ctx.companyId, locationId))) return { fieldErrors: { locationId: "Kies een locatie." } };
  const p = prefs(fd);
  const r = await tx((c) => requestEmptying(c, {
    companyId: ctx.companyId, locationId, userId: ctx.user.id, prefs: p, combine: fd.get("combine") === "on",
    deliveryRef: String(fd.get("deliveryRef") ?? "").trim() || null, note: String(fd.get("note") ?? "").trim() || null,
    sourceKey: `portal:${String(fd.get("submissionId"))}`,
  }));
  if ("error" in r && r.error) return r.error.includes("voorkeur") || r.error.includes("datum") || r.error.includes("dag") ? { fieldErrors: { preferences: r.error } } : { error: r.error };
  return { redirect: `/portaal/afspraken?ok=${encodeURIComponent(`Aanvraag ${(r as any).number} is ontvangen. Bereyl bevestigt de datum.`)}` };
}

export async function changePreferencesAction(fd: FormData): Promise<R> {
  const ctx = await requireCustomer();
  const r = await tx((c) => changePreferences(c, Number(fd.get("appointmentId")), ctx.companyId, ctx.user.id, prefs(fd)));
  if ("error" in r && r.error) return { error: r.error };
  return { redirect: "/portaal/afspraken?ok=Je wijziging is doorgegeven" };
}

export async function cancelAppointmentAction(fd: FormData): Promise<R> {
  const ctx = await requireCustomer();
  const r = await tx((c) => cancelAppointment(c, Number(fd.get("appointmentId")), { userId: ctx.user.id, staff: false, companyId: ctx.companyId }, String(fd.get("reason") ?? "Geannuleerd door klant")));
  if ("error" in r && r.error) return { error: r.error };
  return { redirect: "/portaal/afspraken?ok=De afspraak is geannuleerd" };
}

export async function previewChangeAction(subscriptionId: number, sel: { boxSize: number; packageCode: string; frequencyPerYear: number | null }) {
  const ctx = await requireCustomer("customer_admin");
  const db = (await import("@/lib/db")).pool();
  const r = await previewChange(db, ctx.companyId, subscriptionId, { ...sel, boxSize: sel.boxSize as BoxSize });
  if ("error" in r) return { ok: false as const, error: r.error ?? "Onbekende fout" };
  return {
    ok: true as const,
    currentMonthly: r.current.monthly_cents, currentBox: r.current.box_size, currentPackage: r.current.terms.packageName,
    newMonthly: r.offer.monthlyCents, newOffer: r.offer, effective: r.effective, swapNeeded: r.swapNeeded, swapCents: r.swapCents,
    planned: r.planned, creditText: r.creditText, blocker: r.blocker, scheduled: r.scheduled ? { effective: r.scheduled.effective_from, monthly: r.scheduled.monthly_cents } : null,
  };
}

export async function requestChangeAction(fd: FormData): Promise<R> {
  const ctx = await requireCustomer("customer_admin");
  const subId = Number(fd.get("subscriptionId"));
  const sel = { boxSize: Number(fd.get("boxSize")) as BoxSize, packageCode: String(fd.get("packageCode")), frequencyPerYear: fd.get("frequency") ? Number(fd.get("frequency")) : null };
  if (fd.get("confirm") !== "on") return { fieldErrors: { confirm: "Bevestig dat je akkoord gaat met de nieuwe prijs en ingangsdatum." } };
  const meta = await clientMeta();
  const r = await tx((c) => requestChange(c, ctx.companyId, subId, ctx.user.id, sel, prefs(fd), meta, `portal:${String(fd.get("submissionId"))}`));
  if ("error" in r && r.error) return { error: r.error };
  return { redirect: "/portaal/abonnement?ok=Je wijziging is vastgelegd. Je ontvangt een bevestiging per e-mail." };
}

export async function cancelSubscriptionAction(fd: FormData): Promise<R> {
  const ctx = await requireCustomer("customer_admin");
  if (fd.get("confirm") !== "on") return { fieldErrors: { confirm: "Bevestig dat je wilt stoppen." } };
  const r = await tx((c) => cancelSubscription(c, ctx.companyId, Number(fd.get("subscriptionId")), ctx.user.id, prefs(fd), String(fd.get("reason") ?? "").trim() || null));
  if ("error" in r && r.error) return r.error.includes("voorkeur") || r.error.includes("datum") ? { fieldErrors: { preferences: r.error } } : { error: r.error };
  return { redirect: "/portaal/abonnement?ok=Je opzegging is ontvangen. We plannen het ophalen van de box." };
}

const companySchema = z.object({
  invoice_email: z.string().trim().toLowerCase().email("Vul een geldig factuurmailadres in"),
  invoice_attn: z.string().trim().max(200).optional().default(""),
  invoice_street: z.string().trim().min(3, "Vul het factuuradres in"),
  invoice_postcode: z.string().trim().refine((v) => normalizePostcode(v) !== null, "Vul een geldige postcode in"),
  invoice_city: z.string().trim().min(2, "Vul de plaats in"),
  coc_number: z.string().trim().max(20).optional().default(""),
  vat_number: z.string().trim().max(30).optional().default(""),
});

export async function updateCompanyAction(fd: FormData): Promise<R> {
  const ctx = await requireCustomer("customer_admin");
  const p = companySchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return { fieldErrors: Object.fromEntries(p.error.issues.map((i) => [i.path.join("."), i.message])) };
  const d = p.data;
  await tx(async (c) => {
    await c.query(`UPDATE companies SET invoice_email=$2, invoice_attn=$3, invoice_street=$4, invoice_postcode=$5, invoice_city=$6, coc_number=$7, vat_number=$8 WHERE id=$1`,
      [ctx.companyId, d.invoice_email, d.invoice_attn || null, d.invoice_street, normalizePostcode(d.invoice_postcode), d.invoice_city, d.coc_number || null, d.vat_number || null]);
    await audit(c, { actor: ctx.user.id, company: ctx.companyId, action: "company.updated", entityType: "company", entityId: ctx.companyId, data: d });
  });
  return { message: "Bedrijfsgegevens opgeslagen." };
}

const locSchema = z.object({
  name: z.string().trim().min(2, "Geef de locatie een naam"),
  street: z.string().trim().min(3, "Vul straat en huisnummer in"),
  postcode: z.string().trim().refine((v) => normalizePostcode(v)?.length === 7, "Vul een geldige postcode in (1234 AB)"),
  city: z.string().trim().min(2, "Vul de plaats in"),
  instructions: z.string().trim().max(1000).optional().default(""),
  contact_name: z.string().trim().max(200).optional().default(""),
  contact_phone: z.string().trim().max(30).optional().default(""),
});

export async function saveLocationAction(fd: FormData): Promise<R> {
  const ctx = await requireCustomer("customer_admin");
  const id = fd.get("id") ? Number(fd.get("id")) : null;
  const p = locSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return { fieldErrors: Object.fromEntries(p.error.issues.map((i) => [i.path.join("."), i.message])) };
  const d = p.data;
  const pc = normalizePostcode(d.postcode)!;
  if (id) {
    const loc = await one<any>(`SELECT * FROM locations WHERE id=$1 AND company_id=$2`, [id, ctx.companyId]);
    if (!loc) return { error: "Onbekende locatie" };
    const addressChanged = loc.postcode !== pc || loc.street !== d.street;
    const active = await one(`SELECT 1 FROM subscriptions WHERE location_id=$1 AND status IN ('active','ending','pending_placement')`, [id]);
    if (addressChanged && active) return { error: "Het adres van een locatie met een actieve box wijzig je via Bereyl, omdat het vervoerstarief ervan afhangt. Instructies en contactpersoon kun je wel aanpassen." };
    await tx(async (c) => {
      await c.query(`UPDATE locations SET name=$2, street=$3, postcode=$4, city=$5, instructions=$6, contact_name=$7, contact_phone=$8 WHERE id=$1`, [id, d.name, d.street, pc, d.city, d.instructions || null, d.contact_name || null, d.contact_phone || null]);
      await audit(c, { actor: ctx.user.id, company: ctx.companyId, action: "location.updated", entityType: "location", entityId: id, data: d });
    });
    return { message: "Locatie opgeslagen." };
  }
  const cfg = await getConfigs(["transport", "integrations"]);
  const dist = await calculateDistance(cfg.transport, cfg.integrations, { street: d.street, postcode: pc, city: d.city });
  await tx(async (c) => {
    const r = await one<{ id: number }>(`INSERT INTO locations(company_id, name, street, postcode, city, instructions, contact_name, contact_phone, distance_km, distance_source, distance_calculated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now()) RETURNING id`,
      [ctx.companyId, d.name, d.street, pc, d.city, d.instructions || null, d.contact_name || null, d.contact_phone || null, dist.km, dist.source], c);
    await audit(c, { actor: ctx.user.id, company: ctx.companyId, action: "location.added", entityType: "location", entityId: r!.id, data: d });
  });
  return { message: "Locatie toegevoegd. Wil je hier ook een box? Neem contact op of vraag een voorstel aan.", ok: true };
}

export async function inviteMemberAction(fd: FormData): Promise<R> {
  const ctx = await requireCustomer("customer_admin");
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const name = String(fd.get("name") ?? "").trim();
  const role = fd.get("role") === "customer_admin" ? "customer_admin" : "customer_member";
  if (!/^\S+@\S+\.\S+$/.test(email)) return { fieldErrors: { email: "Vul een geldig e-mailadres in." } };
  if (name.length < 2) return { fieldErrors: { name: "Vul een naam in." } };
  await tx(async (c) => {
    let u = await one<{ id: number }>(`SELECT id FROM users WHERE email=$1`, [email], c);
    if (!u) u = await one<{ id: number }>(`INSERT INTO users(email, name) VALUES ($1,$2) RETURNING id`, [email, name], c);
    await c.query(`INSERT INTO memberships(user_id, company_id, role, status, invited_by) VALUES ($1,$2,$3,'pending',$4) ON CONFLICT (user_id, company_id) DO UPDATE SET role=EXCLUDED.role, status=CASE WHEN memberships.status='revoked' THEN 'pending' ELSE memberships.status END`, [u!.id, ctx.companyId, role, ctx.user.id]);
    await emitEvent(c, "member.invited", { companyId: ctx.companyId, inviteeUserId: u!.id }, `${ctx.companyId}:${u!.id}:${Date.now()}`);
    await audit(c, { actor: ctx.user.id, company: ctx.companyId, action: "member.invited", entityType: "user", entityId: u!.id, data: { email, role } });
  });
  return { message: `${name} is uitgenodigd. De toegang wordt actief zodra de uitnodiging via e-mail is bevestigd.`, ok: true };
}

export async function revokeMemberAction(fd: FormData): Promise<R> {
  const ctx = await requireCustomer("customer_admin");
  const userId = Number(fd.get("userId"));
  if (userId === ctx.user.id) return { error: "Je kunt je eigen toegang niet intrekken." };
  await tx(async (c) => {
    await c.query(`UPDATE memberships SET status='revoked' WHERE user_id=$1 AND company_id=$2`, [userId, ctx.companyId]);
    await audit(c, { actor: ctx.user.id, company: ctx.companyId, action: "member.revoked", entityType: "user", entityId: userId });
  });
  return { message: "Toegang ingetrokken." };
}

export async function publicImpactAction(fd: FormData): Promise<R> {
  const ctx = await requireCustomer("customer_admin");
  const enabled = fd.get("public_enabled") === "on";
  const file = fd.get("logo");
  let logoId: number | null = null;
  if (file instanceof File && file.size > 0) {
    const buf = Buffer.from(await file.arrayBuffer());
    const v = validateUpload("logo", buf);
    if (!v.ok) return { fieldErrors: { logo: v.error } };
    logoId = await storeFile((await import("@/lib/db")).pool(), { companyId: ctx.companyId, kind: "logo", filename: file.name, mime: v.mime, data: buf, uploadedBy: ctx.user.id });
  }
  await tx(async (c) => {
    const co = await one<any>(`SELECT name, public_slug FROM companies WHERE id=$1`, [ctx.companyId], c);
    const slug = co.public_slug ?? `${co.name.toLowerCase().normalize("NFD").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}-${ctx.companyId}`;
    await c.query(`UPDATE companies SET public_enabled=$2, public_show_name=$3, public_show_logo=$4, public_show_totals=$5, public_slug=$6, logo_file_id=COALESCE($7, logo_file_id) WHERE id=$1`,
      [ctx.companyId, enabled, fd.get("public_show_name") === "on", fd.get("public_show_logo") === "on", fd.get("public_show_totals") === "on", slug, logoId]);
    await audit(c, { actor: ctx.user.id, company: ctx.companyId, action: "company.public_impact", entityType: "company", entityId: ctx.companyId, data: { enabled } });
  });
  return { message: enabled ? "Je publieke impactpagina is bijgewerkt." : "De publieke impactpagina staat uit." };
}

export async function setOwnPasswordAction(fd: FormData): Promise<R> {
  const user = await requireUser();
  const pw = String(fd.get("password") ?? "");
  const problem = passwordProblems(pw);
  if (problem) return { fieldErrors: { password: problem } };
  if (pw !== String(fd.get("password2") ?? "")) return { fieldErrors: { password2: "De wachtwoorden zijn niet gelijk." } };
  await q(`UPDATE users SET password_hash=$2 WHERE id=$1`, [user.id, await hashPassword(pw)]);
  const next = String(fd.get("next") ?? "");
  return { redirect: next.startsWith("/") && !next.startsWith("//") ? next : "/portaal?ok=Je wachtwoord is ingesteld" };
}

export async function startMandateAction(): Promise<R> {
  const ctx = await requireCustomer("customer_admin");
  const r = await tx((c) => startMandate(c, ctx.companyId, ctx.user.id));
  if (r.error) return { error: `Incasso is nog niet beschikbaar: ${r.error}. Bereyl neemt contact op.` };
  if (r.redirectUrl) return { redirect: r.redirectUrl };
  return { message: "Demo: incassotoestemming vastgelegd bij de demo-betaalprovider. Er wordt niets echt geïncasseerd." };
}

export async function payInvoiceAction(fd: FormData): Promise<R> {
  const ctx = await requireCustomer();
  const inv = await one<any>(`SELECT * FROM invoices WHERE id=$1 AND company_id=$2`, [Number(fd.get("invoiceId")), ctx.companyId]);
  if (!inv || !["final", "sent", "payment_failed"].includes(inv.status)) return { error: "Deze factuur kan niet (meer) worden betaald." };
  const provider = await activeProvider();
  if (!provider.name) return { error: `Online betalen is nog niet beschikbaar (${provider.message}). Maak het bedrag van ${formatEuro(inv.total_cents)} over o.v.v. ${inv.number}.` };
  if (provider.name === "demo") {
    const pid = `demo_pay_${inv.id}_${Date.now()}`;
    await tx(async (c) => {
      await c.query(`INSERT INTO payments(invoice_id, provider, provider_payment_id, status, amount_cents) VALUES ($1,'demo',$2,'open',$3)`, [inv.id, pid, inv.total_cents]);
      await handlePaymentEvent(c, "demo", `${pid}:paid`, pid, "paid", { demo: true });
    });
    return { message: "Demo-betaling verwerkt. Er is niets echt betaald." };
  }
  return { error: "Online betalen via Mollie wordt geactiveerd zodra Bereyl de koppeling heeft ingericht." };
}
