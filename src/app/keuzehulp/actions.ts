"use server";
import { quote, quizSchema, submitProposalRequest } from "@/lib/proposals";
import type { BoxSize } from "@/lib/config";

export async function quoteAction(input: {
  boxSize: number; packageCode: string; frequencyPerYear: number | null; postcode: string | null; street?: string; city?: string;
  printmasters: "customer" | "intro" | "no"; inflow?: any;
}) {
  try {
    const r = await quote({ ...input, boxSize: input.boxSize as BoxSize });
    return { ok: true as const, offers: r.offers, advice: r.advice, outside: r.outside, distance: r.distance };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Berekening mislukt" };
  }
}

export async function submitAction(raw: unknown) {
  const parsed = quizSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) {
      const k = i.path.join(".");
      if (!fieldErrors[k]) fieldErrors[k] = i.message;
    }
    return { ok: false as const, fieldErrors };
  }
  try {
    const r = await submitProposalRequest(parsed.data);
    if (!r.ok) return { ok: false as const, outside: true };
    return { ok: true as const, requestNumber: r.requestNumber, existing: r.existing };
  } catch (e) {
    console.error(e);
    return { ok: false as const, error: "Het versturen is niet gelukt. Je gegevens zijn bewaard; probeer het opnieuw." };
  }
}
