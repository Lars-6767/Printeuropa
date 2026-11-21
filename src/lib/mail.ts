/** Verzending en logging van e-mail. Zonder SMTP-configuratie worden berichten gelogd met status 'not_configured'. */
import nodemailer, { type Transporter } from "nodemailer";
import { one, q, type Db } from "./db";
import { renderEmail, type EmailBlock } from "./email-render";
import { getConfig } from "./settings";
import { readFile } from "./storage";

export interface TemplateRow { id: number; key: string; audience: string; name: string; version: number; status: string; subject: string; blocks: EmailBlock[]; attachments: string[] }

export async function publishedTemplate(key: string, db?: Db) {
  return one<TemplateRow>(`SELECT * FROM email_templates WHERE key=$1 AND status='published'`, [key], db);
}

export function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST);
}

let transport: Transporter | null = null;
function getTransport() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
    });
  }
  return transport;
}

export interface SendInput {
  idempotencyKey: string;
  templateKey: string;
  to: string;
  cc?: string | null;
  companyId?: number | null;
  vars: Record<string, string>;
  attachments?: { fileId: number; filename: string }[];
  test?: boolean;
  template?: Pick<TemplateRow, "subject" | "blocks" | "version">;   // voor testmails van een concept
}

/** Idempotent: een tweede aanroep met dezelfde sleutel verstuurt niets opnieuw als het al gelukt is. */
export async function sendTemplatedMail(db: Db, input: SendInput): Promise<{ status: string; id: number }> {
  const existing = await one<{ id: number; status: string }>(`SELECT id, status FROM email_log WHERE idempotency_key=$1`, [input.idempotencyKey], db);
  if (existing && (existing.status === "sent" || existing.status === "test")) return existing;

  const tpl = input.template ?? (await publishedTemplate(input.templateKey, db));
  if (!tpl) throw new Error(`Geen gepubliceerde template '${input.templateKey}'`);
  const integ = await getConfig("integrations", db);
  const r = renderEmail(tpl.subject, tpl.blocks, input.vars);
  const replyTo = integ.replyTo || null;
  const warning = r.missing.length ? `Ontbrekende variabelen: ${r.missing.join(", ")}` : null;

  let id = existing?.id;
  if (!id) {
    const row = await one<{ id: number }>(
      `INSERT INTO email_log(idempotency_key, template_key, template_version, company_id, to_address, cc, reply_to, subject, html, attachments, status, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'queued',$11)
       ON CONFLICT (idempotency_key) DO UPDATE SET html=EXCLUDED.html RETURNING id`,
      [input.idempotencyKey, input.templateKey, tpl.version, input.companyId ?? null, input.to, input.cc ?? null, replyTo, r.subject, r.html, JSON.stringify(input.attachments ?? []), warning], db,
    );
    id = row!.id;
  }

  if (!smtpConfigured()) {
    await q(`UPDATE email_log SET status=$2, attempts=attempts+1, error=$3 WHERE id=$1`, [id, input.test ? "test" : "not_configured", ["Mailkoppeling (SMTP) ontbreekt: bericht alleen gelogd.", warning].filter(Boolean).join(" ")], db);
    return { status: input.test ? "test" : "not_configured", id };
  }

  try {
    const atts = [];
    for (const a of input.attachments ?? []) {
      const f = await one<{ path: string; mime: string }>(`SELECT path, mime FROM files WHERE id=$1`, [a.fileId], db);
      if (f) atts.push({ filename: a.filename, content: await readFile(f.path), contentType: f.mime });
    }
    await getTransport().sendMail({
      from: integ.mailFrom,
      to: input.to,
      cc: input.cc ?? undefined,
      replyTo: replyTo ?? undefined,
      subject: r.subject,
      html: r.html,
      attachments: atts,
      headers: { "X-Bereyl-Message": input.idempotencyKey },
    });
    await q(`UPDATE email_log SET status=$2, attempts=attempts+1, sent_at=now(), error=$3 WHERE id=$1`, [id, input.test ? "test" : "sent", warning], db);
    return { status: "sent", id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await q(`UPDATE email_log SET status='failed', attempts=attempts+1, error=$2 WHERE id=$1`, [id, msg], db);
    throw e;
  }
}
