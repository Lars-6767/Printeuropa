/**
 * Afstandsberekening vanaf het depot. Providers:
 *  - openrouteservice: geocoding + wegafstand (ORS_API_KEY vereist)
 *  - demo: indicatie op basis van postcodegebied (alleen voor demonstratie, duidelijk gemarkeerd)
 *  - none: afstand onbekend → vervoer 'nog vast te stellen'
 * Bij uitval valt de berekening terug op 'onbekend'; nooit op 0 km.
 */
import type { IntegrationsConfig, TransportConfig } from "./config";
import { roundKm, type DistanceInfo } from "./pricing";

// Benaderde middelpunten van postcodegebieden (PC2) in en rond Noord-Brabant.
const PC2_CENTROIDS: Record<string, [number, number]> = {
  "42": [51.80, 4.97], "46": [51.49, 4.29], "47": [51.53, 4.46], "48": [51.59, 4.78], "49": [51.64, 4.86],
  "50": [51.56, 5.08], "51": [51.66, 5.05], "52": [51.69, 5.30], "53": [51.76, 5.52], "54": [51.66, 5.62],
  "55": [51.42, 5.40], "56": [51.44, 5.48], "57": [51.48, 5.66], "58": [51.65, 5.95],
};

function haversineKm(a: [number, number], b: [number, number]) {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function routingStatus(integ: IntegrationsConfig): { provider: string; ready: boolean; message: string } {
  if (integ.routingProvider === "openrouteservice") {
    return process.env.ORS_API_KEY
      ? { provider: "openrouteservice", ready: true, message: "Sleutel aanwezig" }
      : { provider: "openrouteservice", ready: false, message: "ORS_API_KEY ontbreekt in de serveromgeving" };
  }
  if (integ.routingProvider === "demo") {
    return process.env.DEMO_MODE === "true"
      ? { provider: "demo", ready: true, message: "Demo-indicatie per postcodegebied (niet voor echte offertes)" }
      : { provider: "demo", ready: false, message: "Demo-routeberekening werkt alleen met DEMO_MODE=true" };
  }
  return { provider: "none", ready: false, message: "Geen routeberekening ingesteld: vervoer wordt 'nog vast te stellen'" };
}

export async function calculateDistance(
  transport: TransportConfig,
  integ: IntegrationsConfig,
  address: { street?: string; postcode: string; city?: string },
): Promise<DistanceInfo> {
  try {
    if (integ.routingProvider === "openrouteservice" && process.env.ORS_API_KEY) {
      const km = await orsDistance(transport, address);
      if (km !== null) {
        const full = Boolean(address.street && address.street.trim());
        return { km: roundKm(km, transport.kmRounding), rawKm: km, source: full ? "route" : "postcode_indicatie" };
      }
    }
    if (integ.routingProvider === "demo" && process.env.DEMO_MODE === "true") {
      const pc2 = address.postcode.replace(/\s/g, "").slice(0, 2);
      const c = PC2_CENTROIDS[pc2];
      if (c) {
        const raw = Math.max(3, haversineKm([transport.depotLat, transport.depotLng], c) * 1.25);
        return { km: roundKm(raw, transport.kmRounding), rawKm: Math.round(raw * 10) / 10, source: "demo" };
      }
    }
  } catch (e) {
    console.error("[distance] berekening mislukt", e);
  }
  return { km: null, rawKm: null, source: "onbekend" };
}

async function orsDistance(transport: TransportConfig, a: { street?: string; postcode: string; city?: string }): Promise<number | null> {
  const key = process.env.ORS_API_KEY!;
  const text = [a.street, a.postcode, a.city].filter(Boolean).join(", ");
  const geo = await fetch(`https://api.openrouteservice.org/geocode/search?api_key=${encodeURIComponent(key)}&text=${encodeURIComponent(text)}&boundary.country=NL&size=1`, { signal: AbortSignal.timeout(8000) });
  if (!geo.ok) return null;
  const gj = await geo.json();
  const coords = gj?.features?.[0]?.geometry?.coordinates;
  if (!coords) return null;
  const route = await fetch(
    `https://api.openrouteservice.org/v2/directions/driving-car?api_key=${encodeURIComponent(key)}&start=${transport.depotLng},${transport.depotLat}&end=${coords[0]},${coords[1]}`,
    { signal: AbortSignal.timeout(8000) },
  );
  if (!route.ok) return null;
  const rj = await route.json();
  const meters = rj?.features?.[0]?.properties?.summary?.distance;
  return typeof meters === "number" ? meters / 1000 : null;
}
