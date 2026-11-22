import crypto from "node:crypto";
import { one, q, type Db } from "./db";

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}
export function sha256(v: string) {
  return crypto.createHash("sha256").update(v).digest("hex");
}

/** Eenmalige inloglink. Alleen de hash wordt opgeslagen. */
export async function issueToken(userId: number, purpose: "login" | "invite", minutes: number, db?: Db) {
  const token = randomToken();
  await q(`INSERT INTO auth_tokens(user_id, purpose, token_hash, expires_at) VALUES ($1,$2,$3, now() + ($4 || ' minutes')::interval)`, [userId, purpose, sha256(token), String(Math.round(minutes))], db);
  return token;
}

/** Verbruikt een token (eenmalig). Bevestigt het e-mailadres en activeert openstaande lidmaatschappen. */
export async function consumeToken(token: string, purposes: string[], db: Db) {
  const row = await one<{ id: number; user_id: number; purpose: string }>(
    `UPDATE auth_tokens SET used_at = now() WHERE token_hash=$1 AND used_at IS NULL AND expires_at > now() AND purpose = ANY($2)
     RETURNING id, user_id, purpose`,
    [sha256(token), purposes], db,
  );
  if (!row) return null;
  await confirmEmailOwnership(row.user_id, db);
  return row;
}

export async function confirmEmailOwnership(userId: number, db: Db) {
  await q(`UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id=$1`, [userId], db);
  // Koppeling aan bedrijfsgegevens pas na bevestigde toegang
  await q(`UPDATE memberships SET status='active', confirmed_at=now() WHERE user_id=$1 AND status='pending'`, [userId], db);
}

export async function peekToken(token: string) {
  return one<{ purpose: string; expired: boolean; used: boolean; email: string }>(
    `SELECT t.purpose, t.expires_at < now() AS expired, t.used_at IS NOT NULL AS used, u.email
     FROM auth_tokens t JOIN users u ON u.id=t.user_id WHERE token_hash=$1`,
    [sha256(token)],
  );
}

/** Maximaal 5 linkaanvragen per e-mailadres per 15 minuten en 30 per IP per uur. */
export async function loginRequestAllowed(email: string, ip: string | null, db?: Db) {
  const r = await one<{ by_email: number; by_ip: number }>(
    `SELECT (SELECT COUNT(*) FROM login_requests WHERE email=$1 AND created_at > now() - interval '15 minutes')::int AS by_email,
            (SELECT COUNT(*) FROM login_requests WHERE ip=$2 AND created_at > now() - interval '1 hour')::int AS by_ip`, [email, ip], db);
  await q(`INSERT INTO login_requests(email, ip) VALUES ($1,$2)`, [email, ip], db);
  await q(`DELETE FROM login_requests WHERE created_at < now() - interval '2 days'`, [], db);
  return r!.by_email < 5 && (ip === null || r!.by_ip < 30);
}

export function appUrl(path = "") {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "") + path;
}
