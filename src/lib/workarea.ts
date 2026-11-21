import type { PlanningConfig } from "./config";
import { postcodeNumber } from "./pricing";

export function normalizePostcode(v: string): string | null {
  const m = v.toUpperCase().replace(/\s/g, "").match(/^([1-9]\d{3})([A-Z]{2})?$/);
  if (!m) return null;
  return m[2] ? `${m[1]} ${m[2]}` : m[1];
}

export function inWorkArea(cfg: PlanningConfig, postcode: string): boolean {
  const n = postcodeNumber(postcode);
  if (n === null) return false;
  return cfg.postcodeRanges.some((r) => n >= r.from && n <= r.to);
}
