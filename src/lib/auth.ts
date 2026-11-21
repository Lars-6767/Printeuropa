import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { one, q, type Db } from "./db";
import { randomToken, sha256 } from "./tokens";
export * from "./tokens";

export const SESSION_COOKIE = "bereyl_session";
export const COMPANY_COOKIE = "bereyl_company";
const SESSION_DAYS = 30;

export type StaffRole = "admin" | "planner" | "field";
export interface User {
  id: number;
  email: string;
  name: string;
  phone: string | null;
  staff_role: StaffRole | null;
  password_hash: string | null;
  email_verified_at: Date | null;
}
export interface Membership { company_id: number; company_name: string; role: "customer_admin" | "customer_member"; status: string }

export async function createSession(userId: number) {
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await q(`INSERT INTO sessions(id, user_id, expires_at) VALUES ($1,$2,$3)`, [sha256(token), userId, expires]);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await q(`DELETE FROM sessions WHERE id=$1`, [sha256(token)]);
  jar.delete(SESSION_COOKIE);
  jar.delete(COMPANY_COOKIE);
}

export async function currentUser(): Promise<User | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return one<User>(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id=$1 AND s.expires_at > now() AND u.active`,
    [sha256(token)],
  );
}

export async function requireUser(next?: string): Promise<User> {
  const u = await currentUser();
  if (!u) redirect(`/inloggen${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  return u;
}

export async function requireStaff(roles: StaffRole[] = ["admin", "planner", "field"]): Promise<User> {
  const u = await requireUser("/beheer");
  if (!u.staff_role || !roles.includes(u.staff_role)) redirect("/geen-toegang");
  return u;
}

export async function activeMemberships(userId: number, db?: Db): Promise<Membership[]> {
  return q<Membership>(
    `SELECT m.company_id, c.name AS company_name, m.role, m.status FROM memberships m JOIN companies c ON c.id=m.company_id
     WHERE m.user_id=$1 AND m.status='active' ORDER BY c.name`,
    [userId], db,
  );
}

/** Klantcontext voor het portaal: gebruiker + gekozen bedrijf. Alleen bevestigde lidmaatschappen geven toegang. */
export async function requireCustomer(minRole: "customer_member" | "customer_admin" = "customer_member") {
  const user = await requireUser("/portaal");
  const ms = await activeMemberships(user.id);
  if (ms.length === 0) {
    if (user.staff_role) redirect("/beheer");
    redirect("/portaal/geen-bedrijf");
  }
  const jar = await cookies();
  const chosen = Number(jar.get(COMPANY_COOKIE)?.value);
  const m = ms.find((x) => x.company_id === chosen) ?? ms[0];
  if (minRole === "customer_admin" && m.role !== "customer_admin") redirect("/portaal?melding=alleen-beheerder");
  return { user, membership: m, memberships: ms, companyId: m.company_id, isAdmin: m.role === "customer_admin" };
}

export async function clientMeta() {
  const h = await headers();
  return { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null, userAgent: h.get("user-agent") };
}

