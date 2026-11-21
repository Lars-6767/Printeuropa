import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { one, q, type Db } from "./db";

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}
export function sha256(v: string) {
  return crypto.createHash("sha256").update(v).digest("hex");
}

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 12);
}
export async function verifyPassword(pw: string, hash: string | null) {
  if (!hash) return false;
  return bcrypt.compare(pw, hash);
}
export function passwordProblems(pw: string): string | null {
  if (pw.length < 10) return "Kies een wachtwoord van minimaal 10 tekens.";
  if (/^(.)\1+$/.test(pw)) return "Kies een minder voorspelbaar wachtwoord.";
  return null;
}

export async function issueToken(userId: number, purpose: "login" | "set_password" | "invite", hours: number, db?: Db) {
  const token = randomToken();
  await q(`INSERT INTO auth_tokens(user_id, purpose, token_hash, expires_at) VALUES ($1,$2,$3, now() + ($4 || ' hours')::interval)`, [userId, purpose, sha256(token), String(hours)], db);
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

export function appUrl(path = "") {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "") + path;
}
