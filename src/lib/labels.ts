export const PM_STATUS: Record<string, string> = {
  none: "Geen PrintMasters-klant",
  interest: "Interesse in kennismaking",
  claimed: "Klant volgens opgave, controle loopt",
  verified: "Geverifieerde PrintMasters-klant",
  rejected: "Niet bevestigd",
};
export const REQUEST_STATUS: Record<string, string> = { requested: "Aangevraagd", confirmed: "Bevestigd", cancelled: "Geannuleerd", rejected: "Afgewezen" };
export const EXEC_STATUS: Record<string, string> = { pending: "Nog uit te voeren", executed: "Uitgevoerd", failed: "Niet gelukt" };
export const WEIGH_STATUS: Record<string, string> = { not_applicable: "–", pending: "Opgehaald, weging volgt", confirmed: "Gewicht bevestigd" };
export const FIN_STATUS: Record<string, string> = { pending: "Nog af te handelen", included: "Inbegrepen leging afgeboekt", free_combination: "Gratis combinatie met PrintMasters", invoiced: "Gefactureerd", no_charge: "Geen kosten" };
export const FUNDING: Record<string, string> = { included: "Inbegrepen leging uit tegoed", paid: "Betaalde leging", free_combination: "Gratis: gecombineerd met PrintMasters-levering", contract: "Volgens afspraak", none: "Geen kosten" };
export const TYPE: Record<string, string> = { placement: "Plaatsing", emptying: "Leging", swap: "Omruilen", final_pickup: "Definitief ophalen" };
export const INVOICE_STATUS: Record<string, string> = { concept: "Concept", final: "Definitief", sent: "Verzonden", paid: "Betaald", payment_failed: "Betaling mislukt", credited: "Gecrediteerd" };
export const BOX_STATUS: Record<string, string> = { in_stock: "Op voorraad", reserved: "Gereserveerd", placed: "Geplaatst", in_transit: "Onderweg / in verwerking", maintenance: "Onderhoud", retired: "Afgevoerd" };
export const SUB_STATUS: Record<string, string> = { pending_placement: "Wacht op plaatsing", active: "Actief", ending: "Opgezegd", ended: "Beëindigd" };
export const DESTINATION: Record<string, string> = { reuse: "Hergebruik", fiber: "Vervezeling", recycling: "Recycling", other: "Andere verwerking" };
export const PROPOSAL_STATUS: Record<string, string> = { open: "Wacht op akkoord", accepted: "Geaccepteerd", withdrawn: "Ingetrokken", expired: "Verlopen", superseded: "Vervangen door nieuwere versie" };
export const DAYPART_FALLBACK: Record<string, string> = { morning: "Ochtend", afternoon: "Middag" };

export function appointmentPhase(a: { request_status: string; execution_status: string; weighing_status: string }) {
  if (a.request_status === "cancelled") return "Geannuleerd";
  if (a.execution_status === "executed") return a.weighing_status === "pending" ? "Opgehaald, weging volgt" : a.weighing_status === "confirmed" ? "Gewicht bevestigd" : "Uitgevoerd";
  if (a.request_status === "confirmed") return "Bevestigd";
  return "Aangevraagd";
}
