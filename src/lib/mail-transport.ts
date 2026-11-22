/**
 * Verzendkanaal voor e-mail.
 *  - microsoft: Microsoft 365 via de Graph API (app-registratie, aanbevolen). Variabelen:
 *      MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MAIL_SENDER (postbus, bijv. noreply@bereyl.com)
 *  - smtp: elke SMTP-dienst. Variabelen: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_SECURE
 * Zonder configuratie worden berichten alleen gelogd.
 */
import nodemailer, { type Transporter } from "nodemailer";

export interface OutgoingMail {
  from: string;
  to: string;
  cc?: string | null;
  replyTo?: string | null;
  subject: string;
  html: string;
  attachments: { filename: string; content: Buffer; contentType: string }[];
  messageKey: string;
}

export type MailProvider = "microsoft" | "smtp" | null;

export function mailProvider(env = process.env): MailProvider {
  if (env.MS_TENANT_ID && env.MS_CLIENT_ID && env.MS_CLIENT_SECRET && env.MAIL_SENDER) return "microsoft";
  if (env.SMTP_HOST) return "smtp";
  return null;
}

export function mailProviderLabel(env = process.env) {
  const p = mailProvider(env);
  if (p === "microsoft") return `Microsoft 365 (Graph) vanuit ${env.MAIL_SENDER}`;
  if (p === "smtp") return `SMTP via ${env.SMTP_HOST}`;
  return null;
}

// ---------- Microsoft Graph ----------
let cachedToken: { value: string; expires: number } | null = null;

export async function graphToken(env = process.env, fetchFn: typeof fetch = fetch): Promise<string> {
  if (cachedToken && cachedToken.expires > Date.now() + 60_000) return cachedToken.value;
  const res = await fetchFn(`https://login.microsoftonline.com/${encodeURIComponent(env.MS_TENANT_ID!)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.MS_CLIENT_ID!,
      client_secret: env.MS_CLIENT_SECRET!,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error(`Microsoft-aanmelding mislukt (${res.status}): ${body.error_description ?? body.error ?? "onbekende fout"}`);
  cachedToken = { value: body.access_token, expires: Date.now() + Number(body.expires_in ?? 3600) * 1000 };
  return cachedToken.value;
}

export function graphMessage(m: OutgoingMail) {
  const addr = (a: string) => ({ emailAddress: { address: a.trim() } });
  return {
    message: {
      subject: m.subject,
      body: { contentType: "HTML", content: m.html },
      toRecipients: m.to.split(",").filter(Boolean).map(addr),
      ccRecipients: (m.cc ?? "").split(",").filter((x) => x.trim()).map(addr),
      replyTo: m.replyTo ? [addr(m.replyTo)] : [],
      internetMessageHeaders: [{ name: "X-Bereyl-Message", value: m.messageKey.slice(0, 900) }],
      attachments: m.attachments.map((a) => ({
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: a.filename,
        contentType: a.contentType,
        contentBytes: a.content.toString("base64"),
      })),
    },
    saveToSentItems: true,
  };
}

async function sendGraph(m: OutgoingMail, env = process.env, fetchFn: typeof fetch = fetch) {
  const token = await graphToken(env, fetchFn);
  const res = await fetchFn(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(env.MAIL_SENDER!)}/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(graphMessage(m)),
    signal: AbortSignal.timeout(30000),
  });
  if (res.status !== 202) {
    const t = await res.text().catch(() => "");
    throw new Error(`Microsoft 365 weigerde het bericht (${res.status}): ${t.slice(0, 400)}`);
  }
}

// ---------- SMTP ----------
let smtp: Transporter | null = null;
function smtpTransport() {
  if (!smtp) {
    smtp = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
    });
  }
  return smtp;
}

export async function deliver(m: OutgoingMail) {
  const p = mailProvider();
  if (p === "microsoft") return sendGraph(m);
  if (p === "smtp") {
    await smtpTransport().sendMail({
      from: m.from, to: m.to, cc: m.cc ?? undefined, replyTo: m.replyTo ?? undefined, subject: m.subject, html: m.html,
      attachments: m.attachments, headers: { "X-Bereyl-Message": m.messageKey },
    });
    return;
  }
  throw new Error("Geen mailkoppeling ingesteld");
}

/** Controle bij opstarten: kan er verbinding worden gemaakt? */
export async function verifyMail() {
  const p = mailProvider();
  if (p === "microsoft") { await graphToken(); return; }
  if (p === "smtp") { await smtpTransport().verify(); return; }
  throw new Error("Geen mailkoppeling ingesteld");
}
