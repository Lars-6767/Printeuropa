import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { getConfig, getConfigs } from "@/lib/settings";
import { buildPdf } from "@/lib/pdf";
import { computeOffer } from "@/lib/pricing";
import { offerRows } from "@/lib/documents";

/** Voorbeeld-PDF met de actuele (gepubliceerde) PDF- en prijsinstellingen en voorbeeldgegevens. */
export async function GET() {
  const u = await currentUser();
  if (!u?.staff_role) return new NextResponse("Geen toegang", { status: 403 });
  const cfg = await getConfig("pdf");
  const c = await getConfigs(["pricing", "transport", "packages", "printmasters"]);
  const o = computeOffer(c, { boxSize: 500, packageCode: "scheduled", frequencyPerYear: 4, postcode: "4811", distance: { km: 12, source: "handmatig" }, printmasters: { status: "none", ruleCode: null } });
  const pdf = await buildPdf({ cfg, title: "Voorstel Bereyl-inzameling (VOORBEELD)", subtitle: "Voorbeeldbedrijf · 500 liter · Breda", meta: [["Aanvraagnummer", "AV-VOORBEELD"], ["Geldig tot", "voorbeeld"]], intro: cfg.introText, sections: [{ title: "Gekozen box en pakket", rows: offerRows(o) }], footerNote: cfg.termsReference.replace("{{voorwaardenversie}}", "voorbeeld") });
  return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": "inline; filename=voorbeeld.pdf" } });
}
