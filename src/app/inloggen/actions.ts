"use server";
import { one, tx } from "@/lib/db";
import { createSession, issueToken, verifyPassword, appUrl, consumeToken, confirmEmailOwnership, hashPassword, passwordProblems } from "@/lib/auth";
import { getConfig } from "@/lib/settings";
import { sendTemplatedMail } from "@/lib/mail";
import { audit } from "@/lib/audit";

function safeNext(n: FormDataEntryValue | null) {
  const s = typeof n === "string" ? n : "";
  return s.startsWith("/") && !s.startsWith("//") ? s : null;
}

// Eenvoudige rem op wachtwoordpogingen per e-mailadres (in geheugen per serverproces).
const attempts = new Map<string, { n: number; until: number }>();

export async function passwordLogin(fd: FormData) {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  const fieldErrors: Record<string, string> = {};
  if (!email) fieldErrors.email = "Vul je e-mailadres in.";
  if (!password) fieldErrors.password = "Vul je wachtwoord in.";
  if (Object.keys(fieldErrors).length) return { fieldErrors };
  const a = attempts.get(email);
  if (a && a.n >= 5 && a.until > Date.now()) return { error: "Te veel pogingen. Probeer het over een paar minuten opnieuw of log in met een e-maillink." };
  const user = await one<{ id: number; password_hash: string | null; staff_role: string | null; email_verified_at: Date | null }>(`SELECT id, password_hash, staff_role, email_verified_at FROM users WHERE email=$1 AND active`, [email]);
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    attempts.set(email, { n: (a?.n ?? 0) + 1, until: Date.now() + 5 * 60000 });
    return { error: "Deze combinatie van e-mailadres en wachtwoord klopt niet." };
  }
  attempts.delete(email);
  // Een wachtwoord kan alleen zijn ingesteld via een bevestigde e-maillink: openstaande lidmaatschappen zijn dus van deze persoon.
  if (user.email_verified_at) await tx((c) => confirmEmailOwnership(user.id, c));
  await createSession(user.id);
  return { redirect: safeNext(fd.get("next")) ?? (user.staff_role ? "/beheer" : "/portaal") };
}

/** Stuurt een inloglink. Antwoordt altijd hetzelfde, zodat niet te achterhalen is welke adressen bestaan. */
export async function requestLoginLink(fd: FormData) {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) return { fieldErrors: { email: "Vul een geldig e-mailadres in." } };
  const purpose = fd.get("purpose") === "set_password" ? "set_password" : "login";
  const next = safeNext(fd.get("next")) ?? "/portaal";
  const user = await one<{ id: number; name: string }>(`SELECT id, name FROM users WHERE email=$1 AND active`, [email]);
  if (user) {
    const contract = await getConfig("contract");
    await tx(async (c) => {
      const token = await (await import("@/lib/tokens")).issueToken(user.id, purpose, purpose === "login" ? contract.loginLinkHours : 2, c);
      const link = purpose === "login" ? appUrl(`/auth/link?token=${encodeURIComponent(token)}&next=${encodeURIComponent(next)}`) : appUrl(`/wachtwoord/instellen?token=${encodeURIComponent(token)}`);
      await sendTemplatedMail(c, {
        idempotencyKey: `auth:${purpose}:${user.id}:${Date.now()}`,
        templateKey: purpose === "login" ? "auth_login_link" : "auth_password_reset",
        to: email,
        vars: { voornaam: user.name.split(" ")[0] ?? "", portallink: link },
      });
    });
  }
  return { message: "Als dit e-mailadres bij ons bekend is, staat er binnen een paar minuten een e-mail met een persoonlijke link klaar. De link is tijdelijk geldig." };
}

export async function redeemLoginLink(fd: FormData) {
  const token = String(fd.get("token") ?? "");
  const next = safeNext(fd.get("next")) ?? "/portaal";
  const res = await tx((c) => consumeToken(token, ["login", "invite"], c));
  if (!res) return { error: "Deze link is verlopen of al gebruikt. Vraag hieronder een nieuwe aan." };
  await createSession(res.user_id);
  const u = await one<{ password_hash: string | null; staff_role: string | null }>(`SELECT password_hash, staff_role FROM users WHERE id=$1`, [res.user_id]);
  if (!u?.password_hash && !u?.staff_role) return { redirect: `/portaal/account?welkom=1&next=${encodeURIComponent(next)}` };
  return { redirect: next };
}

export async function setPasswordWithToken(fd: FormData) {
  const token = String(fd.get("token") ?? "");
  const pw = String(fd.get("password") ?? "");
  const pw2 = String(fd.get("password2") ?? "");
  const problem = passwordProblems(pw);
  if (problem) return { fieldErrors: { password: problem } };
  if (pw !== pw2) return { fieldErrors: { password2: "De wachtwoorden zijn niet gelijk." } };
  const res = await tx(async (c) => {
    const r = await consumeToken(token, ["set_password", "invite"], c);
    if (!r) return null;
    await c.query(`UPDATE users SET password_hash=$2 WHERE id=$1`, [r.user_id, await hashPassword(pw)]);
    await c.query(`DELETE FROM sessions WHERE user_id=$1`, [r.user_id]);
    await audit(c, { actor: r.user_id, action: "user.password_set", entityType: "user", entityId: r.user_id });
    return r;
  });
  if (!res) return { error: "Deze link is verlopen of al gebruikt. Vraag een nieuwe aan." };
  await createSession(res.user_id);
  return { redirect: "/portaal?ok=Je wachtwoord is ingesteld" };
}
