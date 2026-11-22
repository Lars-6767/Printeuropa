"use server";
import { one, tx } from "@/lib/db";
import { createSession, consumeToken, clientMeta, appUrl } from "@/lib/auth";
import { issueToken, loginRequestAllowed } from "@/lib/tokens";
import { getConfig } from "@/lib/settings";
import { sendTemplatedMail } from "@/lib/mail";
import { audit } from "@/lib/audit";

function safeNext(n: FormDataEntryValue | null) {
  const s = typeof n === "string" ? n : "";
  return s.startsWith("/") && !s.startsWith("//") ? s : null;
}

/**
 * Inloggen gebeurt uitsluitend met een persoonlijke, eenmalige link per e-mail.
 * Het antwoord is altijd hetzelfde, zodat niet te achterhalen is welke adressen bestaan.
 */
export async function requestLoginLink(fd: FormData) {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { fieldErrors: { email: "Vul een geldig e-mailadres in." } };
  const next = safeNext(fd.get("next")) ?? "/portaal";
  const { ip } = await clientMeta();
  const neutral = { message: `Als ${email} bij ons bekend is, staat er binnen een paar minuten een e-mail met een inloglink klaar. Kijk ook in je spam. De link werkt één keer.` };
  if (!(await loginRequestAllowed(email, ip))) return { error: "Je hebt net al een paar links aangevraagd. Gebruik de laatste e-mail of probeer het over een kwartier opnieuw." };
  const user = await one<{ id: number; name: string }>(`SELECT id, name FROM users WHERE email=$1 AND active`, [email]);
  if (!user) return neutral;
  const contract = await getConfig("contract");
  await tx(async (c) => {
    const token = await issueToken(user.id, "login", contract.loginRequestMinutes, c);
    await sendTemplatedMail(c, {
      idempotencyKey: `auth:login:${user.id}:${Date.now()}`,
      templateKey: "auth_login_link",
      to: email,
      vars: { voornaam: user.name.split(" ")[0] ?? "", portallink: appUrl(`/auth/link?token=${encodeURIComponent(token)}&next=${encodeURIComponent(next)}`) },
    });
    await audit(c, { actor: user.id, action: "auth.link_requested", entityType: "user", entityId: user.id, data: { ip } });
  });
  return neutral;
}

export async function redeemLoginLink(fd: FormData) {
  const token = String(fd.get("token") ?? "");
  const next = safeNext(fd.get("next")) ?? "/portaal";
  const { ip, userAgent } = await clientMeta();
  const res = await tx(async (c) => {
    const r = await consumeToken(token, ["login", "invite"], c);
    if (r) await audit(c, { actor: r.user_id, action: "auth.login", entityType: "user", entityId: r.user_id, data: { ip, userAgent } });
    return r;
  });
  if (!res) return { redirect: "/inloggen?verlopen=1" };
  await createSession(res.user_id);
  const u = await one<{ staff_role: string | null }>(`SELECT staff_role FROM users WHERE id=$1`, [res.user_id]);
  return { redirect: u?.staff_role && next === "/portaal" ? "/beheer" : next };
}
