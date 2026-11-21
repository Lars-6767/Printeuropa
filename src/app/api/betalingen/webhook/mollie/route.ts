/** Mollie-webhook. Mollie stuurt alleen het betaling-id; de status wordt bij Mollie opgehaald (niet vertrouwd uit de request). */
import { NextResponse } from "next/server";
import { tx, one, q } from "@/lib/db";
import { fetchMollieStatus, handlePaymentEvent } from "@/lib/payments";

export async function POST(req: Request) {
  if (!process.env.MOLLIE_API_KEY) return new NextResponse("Niet geconfigureerd", { status: 503 });
  const form = await req.formData();
  const id = String(form.get("id") ?? "");
  if (!/^tr_\w+$/.test(id)) return new NextResponse("Ongeldig", { status: 400 });
  const { status, mandateId } = await fetchMollieStatus(id);
  const known = await one(`SELECT 1 FROM payments WHERE provider='mollie' AND provider_payment_id=$1`, [id]);
  if (!known) {
    // Eerste betaling voor een incassomachtiging
    const m = await one<any>(`SELECT * FROM mandates WHERE provider='mollie' AND details->>'firstPaymentId'=$1`, [id]);
    if (m && status === "paid") await q(`UPDATE mandates SET status='valid', provider_mandate_id=$2 WHERE id=$1`, [m.id, mandateId]);
    if (m && status === "failed") await q(`UPDATE mandates SET status='missing' WHERE id=$1`, [m.id]);
    return new NextResponse("ok");
  }
  if (status === "pending") return new NextResponse("ok");
  await tx((c) => handlePaymentEvent(c, "mollie", `${id}:${status}`, id, status, { id }));
  return new NextResponse("ok");
}
