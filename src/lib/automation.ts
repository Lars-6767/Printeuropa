/**
 * Verwerking van jobs. Automatiseringsregels (beheer) bepalen per gebeurtenis welke berichten en taken volgen.
 * Berichtjobs veroorzaken zelf geen nieuwe gebeurtenissen: circulaire triggers zijn daardoor onmogelijk.
 */
import { one, q, tx, type Db } from "./db";
import { claimJob, enqueue, failJob, finishJob, releaseStaleJobs, type JobRow } from "./jobs";
import { getConfig, getConfigs } from "./settings";
import { sendTemplatedMail } from "./mail";
import { createTask } from "./tasks";
import { ensureAcceptancePdf, ensureInvoicePdf, ensureProposalPdf, ensureStatementPdf, prefsText } from "./documents";
import { appUrl, issueToken } from "./tokens";
import { formatEuro, formatKg } from "./money";
import { addDays, formatDate, today } from "./dates";
import { creditSummary, creditText, rollPeriods } from "./credit";
import { collectInvoice } from "./payments";
import { runSubscriptionBilling } from "./billing";
import { activateScheduledVersions } from "./subscriptions";
import { expireProposals } from "./proposals";
import { FUNDING } from "./labels";

type Ctx = { vars: Record<string, string>; companyId: number | null; recipients: { email: string; userId: number | null }[]; attachments: { fileId: number; filename: string }[]; linkPath: string; stop?: string };

export async function processNext(): Promise<boolean> {
  const db = (await import("./db")).pool();
  await releaseStaleJobs(db);
  const job = await claimJob(db);
  if (!job) return false;
  try {
    const result = await tx((c) => handle(c, job));
    await finishJob(db, job.id, result === "skipped" ? "skipped" : "done", result);
  } catch (e) {
    console.error(`[job ${job.id} ${job.type}]`, e);
    await failJob(db, job, e);
  }
  return true;
}

async function handle(db: Db, job: JobRow): Promise<unknown> {
  const p = job.payload;
  switch (job.type) {
    case "event": return handleEvent(db, p, job.idempotency_key);
    case "mail": return handleMail(db, p, job.idempotency_key);
    case "proposal.pdf": return { fileId: await ensureProposalPdf(db, p.proposalId) };
    case "acceptance.pdf": return { fileId: await ensureAcceptancePdf(db, p.acceptanceId) };
    case "invoice.pdf": return { fileId: await ensureInvoicePdf(db, p.invoiceId) };
    case "statement.pdf": return { fileId: await ensureStatementPdf(db, p.releaseId) };
    case "payment.collect": return collectInvoice(db, p.invoiceId);
    case "daily": return runDaily(db, p.date);
    default: throw new Error(`Onbekend jobtype ${job.type}`);
  }
}

async function handleEvent(db: Db, p: any, key: string) {
  const cfg = await getConfig("automations", db);
  const rule = cfg.rules.find((r) => r.event === p.event);
  if (!rule || !rule.enabled) return "skipped";
  const runAt = rule.delayMinutes > 0 ? new Date(Date.now() + rule.delayMinutes * 60000) : undefined;
  if (rule.externalTemplate) await enqueue(db, "mail", { ...p, template: rule.externalTemplate, audience: "external" }, `${key}:mail:${rule.externalTemplate}`, runAt);
  if (rule.internalTemplate) await enqueue(db, "mail", { ...p, template: rule.internalTemplate, audience: "internal" }, `${key}:mail:${rule.internalTemplate}`, runAt);
  if (rule.createTask) {
    const titles: Record<string, string> = {
      "printmasters.interest": "Kennismaking PrintMasters: contact opnemen of bezoek plannen",
      "payment.failed": "Betaling mislukt: herstelactie nodig",
      "outside_area.request": "Maatwerkvoorstel buiten werkgebied maken",
    };
    const company = p.companyId ? await one<{ name: string }>(`SELECT name FROM companies WHERE id=$1`, [p.companyId], db) : null;
    await createTask(db, {
      type: p.event.replace(".", "_"), title: `${titles[p.event] ?? p.event}${company ? ` · ${company.name}` : ""}`, companyId: p.companyId ?? null,
      refType: p.invoiceId ? "invoice" : p.requestId ? "request" : "company", refId: p.invoiceId ?? p.requestId ?? p.companyId, priority: "high", dedupeKey: `${key}:task`,
    });
  }
  // Herinneringen bij openstaand voorstel: stoppen vanzelf na akkoord, intrekken of verlopen (gecontroleerd bij verzending).
  if (p.event === "proposal.requested") {
    const rem = cfg.rules.find((r) => r.event === "proposal.reminder");
    if (rem?.enabled) {
      for (const d of rem.reminderDays) {
        await enqueue(db, "event", { event: "proposal.reminder", proposalId: p.proposalId, companyId: p.companyId, userId: p.userId, reminderDay: d }, `event:proposal.reminder:${p.proposalId}:${d}`, new Date(Date.now() + d * 86400000));
      }
    }
  }
  return { rule: rule.event };
}

async function handleMail(db: Db, p: any, key: string) {
  const ctx = await buildContext(db, p);
  if (ctx.stop) return { skipped: ctx.stop };
  const integ = await getConfig("integrations", db);
  if (p.audience === "internal") {
    if (integ.internalRecipients.length === 0) return { skipped: "Geen interne ontvangers ingesteld" };
    ctx.recipients = integ.internalRecipients.map((email) => ({ email, userId: null }));
    ctx.attachments = [];
  }
  if (ctx.recipients.length === 0) throw new Error("Geen ontvanger gevonden voor dit bericht");
  const tpl = await one<{ attachments: string[] }>(`SELECT attachments FROM email_templates WHERE key=$1 AND status='published'`, [p.template], db);
  const wantsAttachments = tpl?.attachments ?? [];
  const atts = ctx.attachments.filter((a: any) => wantsAttachments.includes(a.kind ?? ""));
  for (const r of ctx.recipients) {
    const vars = { ...ctx.vars };
    if (r.userId) {
      const contract = await getConfig("contract", db);
      const token = await issueToken(r.userId, p.event === "member.invited" ? "invite" : "login", contract.loginLinkHours * 60, db);
      vars.portallink = appUrl(`/auth/link?token=${encodeURIComponent(token)}&next=${encodeURIComponent(ctx.linkPath)}`);
      const u = await one<{ name: string }>(`SELECT name FROM users WHERE id=$1`, [r.userId], db);
      vars.voornaam = (u?.name ?? "").split(" ")[0] || vars.voornaam || "";
    } else {
      vars.portallink = appUrl(ctx.linkPath);
    }
    const cc = p.audience === "external" && p.template === "invoice_created" ? integ.internalCopyAddress || null : null;
    await sendTemplatedMail(db, { idempotencyKey: `${key}:${r.email}`, templateKey: p.template, to: r.email, cc, companyId: ctx.companyId, vars, attachments: atts });
  }
  return { sent: ctx.recipients.length };
}

async function companyAdmins(db: Db, companyId: number) {
  return q<{ email: string; userId: number }>(
    `SELECT u.email, u.id AS "userId" FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.company_id=$1 AND m.role='customer_admin' AND m.status IN ('active','pending') AND u.active`, [companyId], db,
  );
}

async function buildContext(db: Db, p: any): Promise<Ctx> {
  const vars: Record<string, string> = {};
  const ctx: Ctx = { vars, companyId: p.companyId ?? null, recipients: [], attachments: [], linkPath: "/portaal" };
  const cfg = await getConfigs(["planning", "packages", "contract"], db);
  if (p.companyId) {
    const c = await one<any>(`SELECT * FROM companies WHERE id=$1`, [p.companyId], db);
    vars.bedrijfsnaam = c.name;
    const loc = await one<any>(`SELECT * FROM locations WHERE company_id=$1 ORDER BY id LIMIT 1`, [p.companyId], db);
    if (loc) { vars.locatie = loc.name; vars.plaats = loc.city; vars.afstand = loc.distance_km ? `${loc.distance_km} km` : "nog vast te stellen"; }
    if (p.userId) {
      const u = await one<any>(`SELECT id, email FROM users WHERE id=$1`, [p.userId], db);
      if (u) ctx.recipients = [{ email: u.email, userId: u.id }];
    }
    if (ctx.recipients.length === 0) ctx.recipients = await companyAdmins(db, p.companyId);
  }
  vars.voorwaardenversie = cfg.contract.termsVersion;

  if (p.proposalId) {
    const pr = await one<any>(`SELECT p.*, r.number AS request_number, r.answers FROM proposals p LEFT JOIN requests r ON r.id=p.request_id WHERE p.id=$1`, [p.proposalId], db);
    // Herinnering alleen zolang het voorstel openstaat en geldig is
    if (p.event === "proposal.reminder") {
      const latest = await one<any>(`SELECT * FROM proposals WHERE request_id=$1 ORDER BY version DESC LIMIT 1`, [pr.request_id], db);
      if (!latest || latest.status !== "open" || latest.valid_until < today()) return { ...ctx, stop: "Voorstel niet meer open" };
    }
    vars.aanvraagnummer = pr.request_number ?? "";
    vars.boxformaat = pr.offer.boxLabel;
    vars.abonnementsnaam = pr.offer.packageName;
    vars.prijs = pr.offer.monthlyCents === null ? "nog vast te stellen" : formatEuro(pr.offer.monthlyCents);
    vars.btw = pr.offer.monthlyVatCents === null ? "" : formatEuro(pr.offer.monthlyVatCents);
    vars.voorkeuren = pr.answers?.preferences ? prefsText(pr.answers.preferences.slots ?? [], pr.answers.preferences.flexible, cfg.planning.dayparts) : "";
    ctx.linkPath = `/portaal/voorstel/${pr.id}`;
    if (pr.status === "superseded") {
      const latest = await one<any>(`SELECT id FROM proposals WHERE request_id=$1 ORDER BY version DESC LIMIT 1`, [pr.request_id], db);
      if (latest) ctx.linkPath = `/portaal/voorstel/${latest.id}`;
    }
    const fileId = await ensureProposalPdf(db, pr.id);
    ctx.attachments.push({ fileId, filename: `Bereyl-voorstel-${pr.request_number ?? pr.id}.pdf`, kind: "proposal_pdf" } as any);
  }
  if (p.acceptanceId) {
    const fileId = await ensureAcceptancePdf(db, p.acceptanceId);
    ctx.attachments.push({ fileId, filename: "Bereyl-akkoordbewijs.pdf", kind: "acceptance_pdf" } as any);
    ctx.linkPath = "/portaal/afspraken";
  }
  if (p.appointmentId) {
    const a = await one<any>(`SELECT a.*, l.name AS loc_name FROM appointments a JOIN locations l ON l.id=a.location_id WHERE a.id=$1`, [p.appointmentId], db);
    if (p.event === "appointment.confirmed" && a.request_status !== "confirmed") return { ...ctx, stop: "Afspraak niet (meer) bevestigd" };
    vars.afspraaknummer = a.number;
    vars.locatie = a.loc_name;
    vars.datum = a.planned_date ? formatDate(a.planned_date, { weekday: true }) : formatDate(a.executed_at ?? a.created_at, { weekday: true });
    vars.dagdeel = cfg.planning.dayparts.find((d) => d.code === a.planned_daypart)?.label ?? "In overleg";
    vars.voorkeuren = prefsText(a.preferences ?? [], a.flexible, cfg.planning.dayparts);
    const fin = a.funding === "paid" ? `${FUNDING.paid}: ${a.price_cents === null ? "prijs nog vast te stellen" : formatEuro(a.price_cents) + " excl. btw"}` : FUNDING[a.funding] ?? "";
    vars.toelichting = [fin, p.note].filter(Boolean).join(". ");
    if (a.subscription_id) vars.tegoed = creditText(await creditSummary(db, a.subscription_id));
    ctx.linkPath = "/portaal/afspraken";
  }
  if (p.collectionId) {
    const c = await one<any>(`SELECT * FROM collections WHERE id=$1`, [p.collectionId], db);
    vars.gewicht = formatKg(c.net_weight_grams);
    vars.datum = formatDate(c.collected_at, { weekday: true });
    ctx.linkPath = "/portaal/impact";
  }
  if (p.invoiceId) {
    const inv = await one<any>(`SELECT * FROM invoices WHERE id=$1`, [p.invoiceId], db);
    vars.factuurnummer = inv.number ?? "";
    vars.bedrag = formatEuro(inv.total_cents);
    vars.btw = formatEuro(inv.vat_cents);
    vars.toelichting = inv.description;
    if (p.event === "invoice.created") {
      const fileId = await ensureInvoicePdf(db, inv.id);
      ctx.attachments.push({ fileId, filename: `Bereyl-${inv.number}.pdf`, kind: "invoice_pdf" } as any);
      const c = await one<any>(`SELECT invoice_email FROM companies WHERE id=$1`, [inv.company_id], db);
      if (c?.invoice_email) ctx.recipients = [{ email: c.invoice_email, userId: null }];
    }
    ctx.linkPath = "/portaal/facturen";
  }
  if (p.certificateId) {
    const cert = await one<any>(`SELECT title FROM certificates WHERE id=$1`, [p.certificateId], db);
    vars.certificaat = cert.title;
    ctx.linkPath = "/portaal/documenten";
  }
  if (p.subscriptionId) {
    if (p.oldMonthlyCents !== undefined) vars.oude_prijs = formatEuro(p.oldMonthlyCents);
    if (p.newMonthlyCents !== undefined) vars.nieuwe_prijs = formatEuro(p.newMonthlyCents);
    if (p.effective) vars.ingangsdatum = formatDate(p.effective);
    if (p.endDate) vars.einddatum = formatDate(p.endDate);
    if (p.event === "subscription.cancelled") {
      vars.eindkosten = p.pickupCents === null || p.pickupCents === undefined ? "Ophaalkosten nog vast te stellen door Bereyl" : `${formatEuro(p.pickupCents)} excl. btw voor het ophalen`;
      const fp = await one<any>(`SELECT * FROM appointments WHERE subscription_id=$1 AND type='final_pickup' ORDER BY id DESC LIMIT 1`, [p.subscriptionId], db);
      if (fp) vars.voorkeuren = prefsText(fp.preferences ?? [], fp.flexible, cfg.planning.dayparts);
    }
    if (p.proposalId) {
      const pr = await one<any>(`SELECT offer FROM proposals WHERE id=$1`, [p.proposalId], db);
      vars.boxformaat = pr.offer.boxLabel; vars.abonnementsnaam = pr.offer.packageName;
    }
    vars.toelichting = p.note ?? vars.toelichting ?? "";
    ctx.linkPath = "/portaal/abonnement";
  }
  if (p.event === "printmasters.verified") vars.toelichting = p.note ?? "";
  if (p.requestId && p.event === "outside_area.request") {
    const r = await one<any>(`SELECT * FROM requests WHERE id=$1`, [p.requestId], db);
    vars.bedrijfsnaam = r.contact.company; vars.plaats = r.answers.city; vars.voornaam = (r.contact.name ?? "").split(" ")[0];
    ctx.recipients = [{ email: r.contact.email, userId: null }];
  }
  if (p.event === "member.invited" && p.inviteeUserId) {
    const u = await one<any>(`SELECT id, email FROM users WHERE id=$1`, [p.inviteeUserId], db);
    ctx.recipients = [{ email: u.email, userId: u.id }];
  }
  return ctx;
}

/** Dagelijkse taken. Plant zichzelf opnieuw in voor de volgende dag. */
export async function runDaily(db: Db, date: string) {
  const cfg = await getConfigs(["contract", "packages"], db);
  const expired = await expireProposals(db);
  const activated = await activateScheduledVersions(db);
  const rolled = await rollPeriods(db, cfg.contract.creditCarryOver, cfg.packages.creditPeriodMonths);
  const invoices = await runSubscriptionBilling(db);
  await enqueue(db, "daily", { date: addDays(date, 1) }, `daily:${addDays(date, 1)}`, new Date(addDays(date, 1) + "T02:00:00+01:00"));
  return { expired, activated, rolled, invoices };
}

export async function ensureDailyScheduled(db: Db) {
  await enqueue(db, "daily", { date: today() }, `daily:${today()}`);
}
