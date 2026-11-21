"use server";
import { requireStaff, issueToken, appUrl } from "@/lib/auth";
import { one, q, tx, pool, nextNumber, pad } from "@/lib/db";
import { CONFIG_SCHEMA, coerce } from "@/lib/config-schema";
import type { ConfigKey } from "@/lib/config";
import { saveDraft, publishDraft, discardDraft, restoreVersion, validateForPublish, getConfig } from "@/lib/settings";
import { confirmAppointment, cancelAppointment, executeAppointment, confirmWeight, correctWeight } from "@/lib/appointments";
import { reissueProposal } from "@/lib/proposals";
import { correctCredit } from "@/lib/credit";
import { creditInvoice, runSubscriptionBilling, settleAppointment } from "@/lib/billing";
import { handlePaymentEvent } from "@/lib/payments";
import { retryJob, emitEvent, enqueue } from "@/lib/jobs";
import { createBatch, releaseCertificate } from "@/lib/impact";
import { storeFile, validateUpload } from "@/lib/storage";
import { audit } from "@/lib/audit";
import { closeTasks } from "@/lib/tasks";
import { sendTemplatedMail } from "@/lib/mail";
import { validateTemplate, sampleVariables, type EmailBlock } from "@/lib/email-render";
import { calculateDistance } from "@/lib/distance";
import { roundKm } from "@/lib/pricing";
import { getConfigs } from "@/lib/settings";
import { parseEuroInput } from "@/lib/money";
import { today } from "@/lib/dates";

type R = { ok?: boolean; error?: string; fieldErrors?: Record<string, string>; message?: string; redirect?: string };
const ADMIN = ["admin"] as const;
const PLAN = ["admin", "planner"] as const;

// ---------- Instellingen ----------
export async function saveConfigDraft(key: ConfigKey, json: string, note: string) {
  const u = await requireStaff([...ADMIN]);
  let parsed: any;
  try { parsed = JSON.parse(json); } catch { return { error: "Ongeldige invoer" }; }
  const r = coerce(CONFIG_SCHEMA[key], parsed);
  if (Object.keys(r.errors).length) return { errors: r.errors };
  await saveDraft(key, r.value, u.id, note || undefined);
  const warnings = validateForPublish(key, r.value);
  return { ok: true, message: warnings.length ? `Concept opgeslagen. Vóór publiceren nog oplossen: ${warnings.join(" ")}` : "Concept opgeslagen. Bekijk het voorbeeld en publiceer wanneer je klaar bent." };
}

export async function publishConfig(fd: FormData): Promise<R> {
  const u = await requireStaff([...ADMIN]);
  const key = String(fd.get("key")) as ConfigKey;
  const eff = String(fd.get("effectiveFrom") ?? "") || null;
  const r = await publishDraft(key, u.id, eff);
  if (!r.ok) return { error: `Publiceren kan nog niet: ${r.errors.join(" ")}` };
  return { message: `Versie ${r.version} is gepubliceerd. Nieuwe aanbiedingen gebruiken deze instellingen; geaccepteerde afspraken blijven ongewijzigd.` };
}
export async function discardConfig(fd: FormData): Promise<R> {
  const u = await requireStaff([...ADMIN]);
  await discardDraft(String(fd.get("key")) as ConfigKey, u.id);
  return { message: "Concept verwijderd." };
}
export async function restoreConfig(fd: FormData): Promise<R> {
  const u = await requireStaff([...ADMIN]);
  await restoreVersion(String(fd.get("key")) as ConfigKey, Number(fd.get("version")), u.id);
  return { message: "De eerdere versie staat klaar als concept. Controleer en publiceer om terug te zetten." };
}

// ---------- Werkvoorraad ----------
export async function taskDone(fd: FormData): Promise<R> {
  const u = await requireStaff();
  await tx(async (c) => {
    await c.query(`UPDATE tasks SET status='done', done_at=now() WHERE id=$1`, [Number(fd.get("id"))]);
    await audit(c, { actor: u.id, action: "task.done", entityType: "task", entityId: Number(fd.get("id")) });
  });
  return {};
}
export async function taskAssignMe(fd: FormData): Promise<R> {
  const u = await requireStaff();
  await q(`UPDATE tasks SET owner_user_id=$2 WHERE id=$1`, [Number(fd.get("id")), u.id]);
  return {};
}

// ---------- Klanten ----------
export async function setPrintmastersStatus(fd: FormData): Promise<R> {
  const u = await requireStaff([...PLAN]);
  const companyId = Number(fd.get("companyId"));
  const status = String(fd.get("status"));
  if (!["verified", "rejected", "none", "interest", "claimed"].includes(status)) return { error: "Ongeldige status" };
  const note = String(fd.get("note") ?? "").trim();
  await tx(async (c) => {
    await c.query(`UPDATE companies SET printmasters_status=$2, printmasters_rule_code=COALESCE(NULLIF($3,''), printmasters_rule_code) WHERE id=$1`, [companyId, status, String(fd.get("ruleCode") ?? "")]);
    await closeTasks(c, "company", companyId, ["printmasters_verify"]);
    // Openstaand voorstel opnieuw uitbrengen met definitieve prijs
    const open = await one<{ id: number }>(`SELECT id FROM proposals WHERE company_id=$1 AND status='open' AND kind='new' ORDER BY id DESC LIMIT 1`, [companyId], c);
    let newId: number | null = null;
    if (open && (status === "verified" || status === "rejected")) newId = await reissueProposal(c, open.id, u.id);
    if (status === "verified" || status === "rejected") {
      await emitEvent(c, "printmasters.verified", { companyId, proposalId: newId ?? undefined, note: status === "verified" ? "Het PrintMasters-voordeel is toegekend." : "We konden geen actieve PrintMasters-afspraak bevestigen; het voorstel is aangepast naar 'Bereyl op aanvraag'." }, `${companyId}:${status}:${Date.now()}`);
    }
    await audit(c, { actor: u.id, company: companyId, action: "printmasters.status", entityType: "company", entityId: companyId, data: { status, note, reissued: newId } });
  });
  return { message: "PrintMasters-status bijgewerkt." };
}

export async function setLocationDistance(fd: FormData): Promise<R> {
  const u = await requireStaff([...PLAN]);
  const locationId = Number(fd.get("locationId"));
  const mode = String(fd.get("mode"));
  const loc = await one<any>(`SELECT * FROM locations WHERE id=$1`, [locationId]);
  if (!loc) return { error: "Onbekende locatie" };
  let km: number | null; let source: string;
  if (mode === "calculate") {
    const cfg = await getConfigs(["transport", "integrations"]);
    const d = await calculateDistance(cfg.transport, cfg.integrations, loc);
    km = d.km; source = d.source;
    if (km === null) return { error: "Routeberekening niet beschikbaar. Vul de afstand handmatig in." };
  } else {
    const raw = Number(String(fd.get("km") ?? "").replace(",", "."));
    if (!(raw > 0 && raw < 1000)) return { fieldErrors: { km: "Vul een afstand in kilometers in." } };
    const t = await getConfig("transport");
    km = roundKm(raw, t.kmRounding); source = "handmatig";
  }
  await tx(async (c) => {
    await c.query(`UPDATE locations SET distance_km=$2, distance_source=$3, distance_calculated_at=now() WHERE id=$1`, [locationId, km, source]);
    await closeTasks(c, "location", locationId, ["distance_missing"]);
    const open = await q<{ id: number }>(`SELECT id FROM proposals WHERE location_id=$1 AND status='open'`, [locationId], c);
    for (const p of open) await reissueProposal(c, p.id, u.id);
    if (open.length) await emitEvent(c, "proposal.requested", { proposalId: (await one<{ id: number }>(`SELECT id FROM proposals WHERE location_id=$1 AND status='open' ORDER BY id DESC LIMIT 1`, [locationId], c))!.id, companyId: loc.company_id }, `distance:${locationId}:${Date.now()}`);
    await audit(c, { actor: u.id, company: loc.company_id, action: "location.distance_set", entityType: "location", entityId: locationId, data: { km, source, reissued: open.length } });
  });
  return { message: `Afstand vastgesteld op ${km} km. Openstaande voorstellen zijn opnieuw uitgebracht.` };
}

export async function reissueProposalAction(fd: FormData): Promise<R> {
  const u = await requireStaff([...PLAN]);
  const id = Number(fd.get("proposalId"));
  const personalMonthly = parseEuroInput(String(fd.get("monthly") ?? ""));
  const personalSingle = parseEuroInput(String(fd.get("single") ?? ""));
  const note = String(fd.get("note") ?? "").trim();
  const boxSize = fd.get("boxSize") ? Number(fd.get("boxSize")) : undefined;
  const packageCode = String(fd.get("packageCode") ?? "") || undefined;
  const freq = fd.get("frequency") ? Number(fd.get("frequency")) : undefined;
  const personal = personalMonthly !== null || personalSingle !== null ? { monthlyCents: personalMonthly, singleEmptyingCents: personalSingle, note } : undefined;
  if (personal && !note) return { fieldErrors: { note: "Leg vast waarom deze persoonlijke afspraak geldt." } };
  try {
    await tx(async (c) => {
      const p = await one<any>(`SELECT company_id FROM proposals WHERE id=$1`, [id], c);
      const newId = await reissueProposal(c, id, u.id, { boxSize: boxSize as any, packageCode, frequencyPerYear: freq, personal });
      await emitEvent(c, "proposal.requested", { proposalId: newId, companyId: p.company_id }, `reissue:${newId}`);
    });
  } catch (e) { return { error: e instanceof Error ? e.message : "Mislukt" }; }
  return { message: "Nieuwe voorstelversie verstuurd naar de klant." };
}

export async function withdrawProposal(fd: FormData): Promise<R> {
  const u = await requireStaff([...PLAN]);
  const id = Number(fd.get("proposalId"));
  await tx(async (c) => {
    await c.query(`UPDATE proposals SET status='withdrawn' WHERE id=$1 AND status='open'`, [id]);
    await audit(c, { actor: u.id, action: "proposal.withdrawn", entityType: "proposal", entityId: id });
  });
  return { message: "Voorstel ingetrokken. Herinneringen stoppen automatisch." };
}

export async function creditCorrection(fd: FormData): Promise<R> {
  const u = await requireStaff([...ADMIN]);
  const delta = Number(fd.get("delta"));
  const reason = String(fd.get("reason") ?? "");
  try {
    await tx(async (c) => {
      await correctCredit(c, Number(fd.get("periodId")), delta, reason, u.id);
      const p = await one<any>(`SELECT s.company_id FROM credit_periods cp JOIN subscriptions s ON s.id=cp.subscription_id WHERE cp.id=$1`, [Number(fd.get("periodId"))], c);
      await audit(c, { actor: u.id, company: p.company_id, action: "credit.corrected", entityType: "credit_period", entityId: Number(fd.get("periodId")), data: { delta, reason } });
    });
  } catch (e) { return { error: e instanceof Error ? e.message : "Mislukt" }; }
  return { message: "Tegoed gecorrigeerd en vastgelegd." };
}

// ---------- Planning en uitvoering ----------
export async function confirmAppointmentAction(fd: FormData): Promise<R> {
  const u = await requireStaff([...PLAN]);
  const date = String(fd.get("date") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { fieldErrors: { date: "Kies een datum." } };
  const comb = String(fd.get("combinationStatus") ?? "");
  const apptId = Number(fd.get("appointmentId"));
  const routeId = fd.get("routeId") ? Number(fd.get("routeId")) : null;
  if (fd.get("force") !== "on") {
    const { planningWarnings, locationDoublePlanned } = await import("@/lib/appointments");
    const warnings = await planningWarnings(pool(), date, routeId, apptId);
    const a = await one<any>(`SELECT location_id FROM appointments WHERE id=$1`, [apptId]);
    const dbl = a ? await locationDoublePlanned(pool(), a.location_id, date, apptId) : null;
    if (dbl) warnings.push(`Op deze locatie staat op ${date} al afspraak ${dbl.number} gepland (dubbele planning).`);
    if (warnings.length) return { error: `${warnings.join(" ")} Vink 'Toch inplannen' aan om door te gaan.` };
  }
  const r = await tx((c) => confirmAppointment(c, Number(fd.get("appointmentId")), u.id, {
    date, daypart: String(fd.get("daypart") ?? "") || null,
    routeId: fd.get("routeId") ? Number(fd.get("routeId")) : null,
    assignedUserId: fd.get("assignedUserId") ? Number(fd.get("assignedUserId")) : null,
    combinationStatus: comb === "confirmed" || comb === "declined" ? comb : null,
  }));
  if ("error" in r && r.error) return { error: r.error };
  return { redirect: `/beheer/planning?ok=${encodeURIComponent(`Afspraak bevestigd${r.notes?.length ? `. ${r.notes.join(" ")}` : ""}. De klant ontvangt een bevestiging.`)}` };
}

export async function cancelAppointmentStaff(fd: FormData): Promise<R> {
  const u = await requireStaff([...PLAN]);
  const r = await tx((c) => cancelAppointment(c, Number(fd.get("appointmentId")), { userId: u.id, staff: true }, String(fd.get("reason") ?? "Geannuleerd door Bereyl")));
  if ("error" in r && r.error) return { error: r.error };
  return { redirect: `/beheer/planning?ok=${encodeURIComponent("Afspraak geannuleerd; gereserveerd tegoed is vrijgegeven.")}` };
}

export async function executeAction(fd: FormData): Promise<R> {
  const u = await requireStaff();
  const appointmentId = Number(fd.get("appointmentId"));
  const a = await one<any>(`SELECT * FROM appointments WHERE id=$1`, [appointmentId]);
  if (!a) return { error: "Afspraak niet gevonden" };
  if (u.staff_role === "field" && a.assigned_user_id && a.assigned_user_id !== u.id) return { error: "Deze afspraak is aan een andere medewerker toegewezen." };
  const photoIds: number[] = [];
  for (const f of fd.getAll("photos")) {
    if (!(f instanceof File) || f.size === 0) continue;
    const buf = Buffer.from(await f.arrayBuffer());
    const v = validateUpload("photo", buf);
    if (!v.ok) return { fieldErrors: { photos: `${f.name}: ${v.error}` } };
    photoIds.push(await storeFile(pool(), { companyId: a.company_id, kind: "photo", filename: f.name, mime: v.mime, data: buf, uploadedBy: u.id }));
  }
  const r = await tx((c) => executeAppointment(c, appointmentId, u.id, {
    boxTakenId: fd.get("boxTakenId") ? Number(fd.get("boxTakenId")) : null,
    boxPlacedId: fd.get("boxPlacedId") ? Number(fd.get("boxPlacedId")) : null,
    photoFileIds: photoIds, note: String(fd.get("note") ?? "").trim() || null,
    combinationDone: a.combine_printmasters ? fd.get("combinationDone") === "on" : undefined,
  }));
  if ("error" in r && r.error) return { error: r.error };
  return { redirect: `/beheer/uitvoering?ok=${encodeURIComponent(`${a.number} vastgelegd${(r as any).already ? " (was al vastgelegd)" : ""}.`)}` };
}

export async function settleAgain(fd: FormData): Promise<R> {
  const u = await requireStaff([...ADMIN]);
  const r = await tx((c) => settleAppointment(c, Number(fd.get("appointmentId")), u.id));
  return { message: `Afhandeling: ${r.outcome}${r.changed ? "" : " (geen wijziging)"}` };
}

export async function setAppointmentPrice(fd: FormData): Promise<R> {
  const u = await requireStaff([...ADMIN]);
  const cents = parseEuroInput(String(fd.get("price") ?? ""));
  const reason = String(fd.get("reason") ?? "").trim();
  if (cents === null) return { fieldErrors: { price: "Vul een bedrag in." } };
  if (!reason) return { fieldErrors: { reason: "Vul een reden in." } };
  await tx(async (c) => {
    const a = await one<any>(`SELECT * FROM appointments WHERE id=$1 FOR UPDATE`, [Number(fd.get("appointmentId"))], c);
    if (a.financial_status !== "pending") throw new Error("De afspraak is al financieel afgehandeld. Gebruik een creditfactuur.");
    await c.query(`UPDATE appointments SET price_cents=$2 WHERE id=$1`, [a.id, cents]);
    await audit(c, { actor: u.id, company: a.company_id, action: "appointment.price_set", entityType: "appointment", entityId: a.id, data: { from: a.price_cents, to: cents, reason } });
    if (a.execution_status === "executed") await settleAppointment(c, a.id, u.id);
  });
  return { message: "Tarief vastgelegd." };
}

export async function weighAction(fd: FormData): Promise<R> {
  const u = await requireStaff([...PLAN]);
  const kg = Number(String(fd.get("kg") ?? "").replace(",", "."));
  if (!(kg > 0)) return { fieldErrors: { kg: "Vul het nettogewicht in kilo in." } };
  const r = await tx((c) => confirmWeight(c, Number(fd.get("collectionId")), Math.round(kg * 1000), u.id));
  if ("error" in r && r.error) return { error: r.error };
  return { redirect: `/beheer/wegingen?ok=${encodeURIComponent("Gewicht bevestigd. Impact en klantmail zijn bijgewerkt.")}` };
}

export async function correctWeightAction(fd: FormData): Promise<R> {
  const u = await requireStaff([...ADMIN]);
  const kg = Number(String(fd.get("kg") ?? "").replace(",", "."));
  if (!(kg >= 0)) return { fieldErrors: { kg: "Vul een gewicht in." } };
  const r = await tx((c) => correctWeight(c, Number(fd.get("collectionId")), Math.round(kg * 1000), String(fd.get("reason") ?? ""), u.id));
  if ("error" in r && r.error) return { error: r.error };
  return { message: "Correctie vastgelegd. Publieke en persoonlijke totalen zijn bijgewerkt." };
}

// ---------- Partijen en certificaten ----------
export async function createBatchAction(fd: FormData): Promise<R> {
  const u = await requireStaff([...ADMIN]);
  const processor = String(fd.get("processor") ?? "").trim();
  if (!processor) return { fieldErrors: { processor: "Vul de verwerkingspartij in." } };
  const id = await tx((c) => createBatch(c, processor, u.id));
  return { redirect: `/beheer/partijen/${id}` };
}
export async function assignToBatch(fd: FormData): Promise<R> {
  const u = await requireStaff([...ADMIN]);
  const batchId = Number(fd.get("batchId"));
  const ids = fd.getAll("collectionIds").map(Number).filter(Boolean);
  await tx(async (c) => {
    await c.query(`UPDATE collections SET batch_id=$1 WHERE id = ANY($2) AND status='weight_confirmed' AND batch_id IS NULL`, [batchId, ids]);
    await audit(c, { actor: u.id, action: "batch.assigned", entityType: "batch", entityId: batchId, data: { ids } });
  });
  return { message: `${ids.length} inzameling(en) gekoppeld.` };
}
export async function updateBatch(fd: FormData): Promise<R> {
  const u = await requireStaff([...ADMIN]);
  const id = Number(fd.get("batchId"));
  const destination = String(fd.get("destination") ?? "") || null;
  const processed = fd.get("processed") === "on";
  await tx(async (c) => {
    await c.query(`UPDATE processing_batches SET destination=$2, destination_note=$3, status=$4, processed_at=CASE WHEN $4='processed' THEN COALESCE(processed_at, current_date) ELSE NULL END WHERE id=$1`, [id, destination, String(fd.get("note") ?? "") || null, processed ? "processed" : "open"]);
    await audit(c, { actor: u.id, action: "batch.updated", entityType: "batch", entityId: id, data: { destination, processed } });
  });
  return { message: "Partij bijgewerkt." };
}
export async function uploadCertificate(fd: FormData): Promise<R> {
  const u = await requireStaff([...ADMIN]);
  const batchId = Number(fd.get("batchId"));
  const title = String(fd.get("title") ?? "").trim();
  const file = fd.get("file");
  if (!title) return { fieldErrors: { title: "Geef het certificaat een titel." } };
  if (!(file instanceof File) || file.size === 0) return { fieldErrors: { file: "Kies een PDF." } };
  const buf = Buffer.from(await file.arrayBuffer());
  const v = validateUpload("certificate", buf);
  if (!v.ok) return { fieldErrors: { file: v.error } };
  await tx(async (c) => {
    const fid = await storeFile(c, { companyId: null, kind: "certificate", filename: file.name, mime: v.mime, data: buf, uploadedBy: u.id });
    const r = await one<{ id: number }>(`INSERT INTO certificates(batch_id, title, kind, file_id, created_by) VALUES ($1,$2,'batch',$3,$4) RETURNING id`, [batchId, title, fid, u.id], c);
    await audit(c, { actor: u.id, action: "certificate.uploaded", entityType: "certificate", entityId: r!.id, data: { batchId, title } });
  });
  return { message: "Certificaat geüpload. Kies hieronder de ontvangers en geef vrij." };
}
export async function releaseCertificateAction(fd: FormData): Promise<R> {
  const u = await requireStaff([...ADMIN]);
  const ids = fd.getAll("companyIds").map(Number).filter(Boolean);
  if (fd.get("checked") !== "on") return { fieldErrors: { checked: "Bevestig dat je het document en de ontvangers hebt gecontroleerd." } };
  const r = await tx((c) => releaseCertificate(c, Number(fd.get("certificateId")), ids, fd.get("statements") === "on", u.id));
  if ("error" in r && r.error) return { error: r.error };
  return { message: `Certificaat vrijgegeven aan ${ids.length} klant(en).` };
}

// ---------- Facturen ----------
export async function creditInvoiceAction(fd: FormData): Promise<R> {
  const u = await requireStaff([...ADMIN]);
  try { await tx((c) => creditInvoice(c, Number(fd.get("invoiceId")), String(fd.get("reason") ?? ""), u.id)); }
  catch (e) { return { error: e instanceof Error ? e.message : "Mislukt" }; }
  return { message: "Creditfactuur aangemaakt." };
}
export async function runBillingAction(): Promise<R> {
  await requireStaff([...ADMIN]);
  const n = await tx((c) => runSubscriptionBilling(c));
  return { message: `${n} nieuwe abonnementsfactu(u)r(en) aangemaakt voor afgelopen maanden.` };
}
export async function retryCollect(fd: FormData): Promise<R> {
  await requireStaff([...ADMIN]);
  const id = Number(fd.get("invoiceId"));
  await enqueue(pool(), "payment.collect", { invoiceId: id }, `invoice:${id}:collect:${Date.now()}`);
  await closeTasks(pool(), "invoice", id);
  return { message: "Incasso opnieuw ingepland." };
}
/** Alleen in demo-modus: simuleert een (eventueel herhaald) bericht van de betaalprovider. */
export async function simulatePayment(fd: FormData): Promise<R> {
  await requireStaff([...ADMIN]);
  if (process.env.DEMO_MODE !== "true") return { error: "Alleen beschikbaar in demo-modus." };
  const pay = await one<any>(`SELECT * FROM payments WHERE invoice_id=$1 ORDER BY id DESC LIMIT 1`, [Number(fd.get("invoiceId"))]);
  if (!pay) return { error: "Er is nog geen incasso gestart (controleer mandaat en betaalprovider)." };
  const status = fd.get("status") === "failed" ? "failed" : "paid";
  const r = await tx((c) => handlePaymentEvent(c, pay.provider, `${pay.provider_payment_id}:${status}`, pay.provider_payment_id, status, { simulated: true }));
  return { message: r.duplicate ? "Dubbel bericht herkend: geen effect." : `Betaling verwerkt als '${status}'.` };
}

// ---------- Wachtrij en e-mail ----------
export async function retryJobAction(fd: FormData): Promise<R> {
  await requireStaff([...ADMIN]);
  await retryJob(pool(), Number(fd.get("jobId")));
  return { message: "Opnieuw ingepland." };
}
export async function retryEmail(fd: FormData): Promise<R> {
  await requireStaff([...ADMIN]);
  const e = await one<any>(`SELECT * FROM email_log WHERE id=$1`, [Number(fd.get("emailId"))]);
  if (!e) return { error: "Niet gevonden" };
  await q(`UPDATE jobs SET status='queued', run_at=now(), attempts=0 WHERE type='mail' AND $1 LIKE idempotency_key || ':%'`, [e.idempotency_key]);
  return { message: "Bericht opnieuw ingepland." };
}

export async function saveTemplateDraft(key: string, subject: string, blocksJson: string, attachments: string[]) {
  const u = await requireStaff([...ADMIN]);
  let blocks: EmailBlock[];
  try { blocks = JSON.parse(blocksJson); } catch { return { error: "Ongeldige blokken" }; }
  const errs = validateTemplate(subject, blocks);
  if (errs.length) return { error: errs.join(" ") };
  await tx(async (c) => {
    const base = await one<any>(`SELECT * FROM email_templates WHERE key=$1 ORDER BY version DESC LIMIT 1`, [key], c);
    if (!base) throw new Error("Onbekende template");
    const draft = await one<any>(`SELECT id FROM email_templates WHERE key=$1 AND status='draft'`, [key], c);
    if (draft) await c.query(`UPDATE email_templates SET subject=$2, blocks=$3, attachments=$4, created_by=$5, created_at=now() WHERE id=$1`, [draft.id, subject, JSON.stringify(blocks), JSON.stringify(attachments), u.id]);
    else await c.query(`INSERT INTO email_templates(key, audience, name, version, status, subject, blocks, attachments, created_by) VALUES ($1,$2,$3,$4,'draft',$5,$6,$7,$8)`, [key, base.audience, base.name, base.version + 1, subject, JSON.stringify(blocks), JSON.stringify(attachments), u.id]);
    await audit(c, { actor: u.id, action: "template.draft_saved", entityType: "template", data: { key } });
  });
  return { ok: true, message: "Concept opgeslagen." };
}
export async function publishTemplate(fd: FormData): Promise<R> {
  const u = await requireStaff([...ADMIN]);
  const key = String(fd.get("key"));
  const r = await tx(async (c) => {
    const d = await one<any>(`SELECT * FROM email_templates WHERE key=$1 AND status='draft'`, [key], c);
    if (!d) return { error: "Geen concept om te publiceren." };
    const errs = validateTemplate(d.subject, d.blocks);
    if (errs.length) return { error: errs.join(" ") };
    await c.query(`UPDATE email_templates SET status='archived' WHERE key=$1 AND status='published'`, [key]);
    await c.query(`UPDATE email_templates SET status='published', published_at=now() WHERE id=$1`, [d.id]);
    await audit(c, { actor: u.id, action: "template.published", entityType: "template", entityId: d.id, data: { key, version: d.version } });
    return { message: `Versie ${d.version} gepubliceerd. Nieuwe berichten gebruiken deze versie.` };
  });
  return r;
}
export async function restoreTemplate(fd: FormData): Promise<R> {
  const u = await requireStaff([...ADMIN]);
  const key = String(fd.get("key"));
  const v = await one<any>(`SELECT * FROM email_templates WHERE key=$1 AND version=$2`, [key, Number(fd.get("version"))]);
  if (!v) return { error: "Versie niet gevonden" };
  const r = await saveTemplateDraft(key, v.subject, JSON.stringify(v.blocks), v.attachments);
  await audit(pool(), { actor: u.id, action: "template.restored", entityType: "template", data: { key, version: v.version } });
  return r.error ? { error: r.error } : { message: `Versie ${v.version} staat klaar als concept.` };
}
export async function sendTestMail(key: string, to: string, subject: string, blocksJson: string) {
  const u = await requireStaff([...ADMIN]);
  if (!/^\S+@\S+\.\S+$/.test(to)) return { error: "Vul een geldig testadres in." };
  const blocks = JSON.parse(blocksJson) as EmailBlock[];
  const errs = validateTemplate(subject, blocks);
  if (errs.length) return { error: errs.join(" ") };
  const r = await sendTemplatedMail(pool(), { idempotencyKey: `test:${key}:${Date.now()}`, templateKey: key, to, vars: { ...sampleVariables(), portallink: appUrl("/portaal") }, test: true, template: { subject, blocks, version: 0 } });
  await audit(pool(), { actor: u.id, action: "template.test_sent", entityType: "template", data: { key, to } });
  return { ok: true, message: r.status === "test" && !process.env.SMTP_HOST ? "Testmail vastgelegd in het e-maillog. Er is geen mailserver gekoppeld, dus het bericht is niet echt verstuurd." : `Testmail verstuurd naar ${to}.` };
}

// ---------- Gebruikers ----------
export async function inviteStaff(fd: FormData): Promise<R> {
  const u = await requireStaff([...ADMIN]);
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const name = String(fd.get("name") ?? "").trim();
  const role = String(fd.get("role"));
  if (!/^\S+@\S+\.\S+$/.test(email)) return { fieldErrors: { email: "Vul een geldig e-mailadres in." } };
  if (!["admin", "planner", "field"].includes(role)) return { fieldErrors: { role: "Kies een rol." } };
  await tx(async (c) => {
    const user = await one<{ id: number }>(`INSERT INTO users(email, name, staff_role) VALUES ($1,$2,$3) ON CONFLICT (email) DO UPDATE SET staff_role=EXCLUDED.staff_role, active=true RETURNING id`, [email, name || email, role], c);
    const token = await issueToken(user!.id, "set_password", 72, c);
    await sendTemplatedMail(c, { idempotencyKey: `staff_invite:${user!.id}:${Date.now()}`, templateKey: "auth_password_reset", to: email, vars: { voornaam: name.split(" ")[0] ?? "", portallink: appUrl(`/wachtwoord/instellen?token=${encodeURIComponent(token)}`) } });
    await audit(c, { actor: u.id, action: "staff.invited", entityType: "user", entityId: user!.id, data: { email, role } });
  });
  return { message: `${email} is uitgenodigd als ${role}.` };
}
export async function updateStaff(fd: FormData): Promise<R> {
  const u = await requireStaff([...ADMIN]);
  const id = Number(fd.get("userId"));
  const role = String(fd.get("role"));
  const active = fd.get("active") === "on";
  if (id === u.id && (role !== "admin" || !active)) return { error: "Je kunt je eigen beheerrechten niet intrekken." };
  await tx(async (c) => {
    await c.query(`UPDATE users SET staff_role=$2, active=$3 WHERE id=$1 AND staff_role IS NOT NULL`, [id, role, active]);
    if (!active) await c.query(`DELETE FROM sessions WHERE user_id=$1`, [id]);
    await audit(c, { actor: u.id, action: "staff.updated", entityType: "user", entityId: id, data: { role, active } });
  });
  return { message: "Medewerker bijgewerkt." };
}

// ---------- Boxen ----------
export async function addBoxes(fd: FormData): Promise<R> {
  const u = await requireStaff([...ADMIN]);
  const size = Number(fd.get("size"));
  const n = Number(fd.get("count"));
  if (![250, 500, 1000].includes(size)) return { fieldErrors: { size: "Kies een formaat." } };
  if (!(n >= 1 && n <= 100)) return { fieldErrors: { count: "Tussen 1 en 100." } };
  await tx(async (c) => {
    for (let i = 0; i < n; i++) {
      const num = await nextNumber(c, "box");
      await c.query(`INSERT INTO boxes(number, size, status) VALUES ($1,$2,'in_stock')`, [`BX-${pad(num)}`, size]);
    }
    await audit(c, { actor: u.id, action: "boxes.added", data: { size, n } });
  });
  return { message: `${n} box(en) toegevoegd.` };
}
export async function updateBox(fd: FormData): Promise<R> {
  const u = await requireStaff([...PLAN]);
  const id = Number(fd.get("boxId"));
  const status = String(fd.get("status"));
  if (!["in_stock", "reserved", "maintenance", "retired", "in_transit"].includes(status)) return { error: "Een box plaats je via een uitgevoerde afspraak." };
  await tx(async (c) => {
    await c.query(`UPDATE boxes SET status=$2, note=$3 WHERE id=$1 AND status <> 'placed'`, [id, status, String(fd.get("note") ?? "") || null]);
    await audit(c, { actor: u.id, action: "box.updated", entityType: "box", entityId: id, data: { status } });
  });
  return { message: "Box bijgewerkt." };
}

// ---------- Prijswijziging bestaande klanten ----------
export async function createPriceUpdates(fd: FormData): Promise<R> {
  const u = await requireStaff([...ADMIN]);
  const ids = fd.getAll("subscriptionIds").map(Number).filter(Boolean);
  const effective = String(fd.get("effective") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effective) || effective <= today()) return { fieldErrors: { effective: "Kies een ingangsdatum in de toekomst." } };
  if (!ids.length) return { error: "Selecteer minimaal één klant." };
  if (fd.get("checked") !== "on") return { fieldErrors: { checked: "Bevestig dat de klantcommunicatie en bevestiging zijn gecontroleerd." } };
  const { createPriceUpdateProposal } = await import("@/lib/price-updates");
  let n = 0;
  await tx(async (c) => { for (const id of ids) if (await createPriceUpdateProposal(c, id, effective, u.id)) n++; });
  return { message: `${n} wijzigingsvoorstel(len) verstuurd. Tot akkoord blijft de huidige prijs gelden.` };
}
