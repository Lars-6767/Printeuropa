"use server";
import crypto from "node:crypto";
import { z } from "zod";
import { nextNumber, one, pad, tx } from "@/lib/db";
import { emitEvent } from "@/lib/jobs";
import { normalizePostcode } from "@/lib/workarea";
import { today } from "@/lib/dates";

const schema = z.object({
  company: z.string().trim().min(2, "Vul de bedrijfsnaam in"),
  name: z.string().trim().min(2, "Vul je naam in"),
  email: z.string().trim().toLowerCase().email("Vul een geldig e-mailadres in"),
  phone: z.string().trim().min(8, "Vul een telefoonnummer in"),
  street: z.string().trim().min(3, "Vul het adres in"),
  postcode: z.string().trim().refine((v) => normalizePostcode(v) !== null, "Vul een geldige postcode in"),
  city: z.string().trim().min(2, "Vul de plaats in"),
  box: z.enum(["250", "500", "1000", "advies"]),
  amount: z.string().trim().max(200).optional().default(""),
  note: z.string().trim().max(2000).optional().default(""),
  submissionId: z.string().uuid(),
});

export async function submitOutsideArea(fd: FormData) {
  const p = schema.safeParse(Object.fromEntries(fd));
  if (!p.success) return { fieldErrors: Object.fromEntries(p.error.issues.map((i) => [i.path.join("."), i.message])) };
  const d = p.data;
  await tx(async (c) => {
    const dup = await one(`SELECT 1 FROM requests WHERE submission_id=$1`, [d.submissionId], c);
    if (dup) return;
    const year = today().slice(0, 4);
    const number = `AV-${year}-${pad(await nextNumber(c, `request-${year}`))}`;
    const r = await one<{ id: number }>(
      `INSERT INTO requests(number, submission_id, kind, answers, contact) VALUES ($1,$2,'outside_area',$3,$4) RETURNING id`,
      [number, d.submissionId, JSON.stringify({ street: d.street, postcode: normalizePostcode(d.postcode), city: d.city, box: d.box, amount: d.amount, note: d.note }), JSON.stringify({ company: d.company, name: d.name, email: d.email, phone: d.phone })], c,
    );
    await emitEvent(c, "outside_area.request", { requestId: r!.id }, String(r!.id));
  });
  return { redirect: "/maatwerk?ok=1" };
}

export async function newSubmissionId() {
  return crypto.randomUUID();
}
