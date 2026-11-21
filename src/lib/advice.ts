/** Boxadvies op basis van instroom en verwachte tijd tussen legingen. Puur en testbaar. */
import type { AdviceConfig, BoxConfig, BoxSize } from "./config";

export type InflowUnit = "kg" | "pieces" | "bags" | "unknown";

export interface InflowInput {
  unit: InflowUnit;
  amount?: number | null;         // per maand
  employees?: number | null;
  replacementPerYear?: number | null;
  oneOffStockKg?: number | null;
}

export function monthlyKg(cfg: AdviceConfig, i: InflowInput): number | null {
  switch (i.unit) {
    case "kg": return i.amount && i.amount > 0 ? i.amount : null;
    case "pieces": return i.amount && i.amount > 0 ? i.amount * cfg.kgPerPiece : null;
    case "bags": return i.amount && i.amount > 0 ? i.amount * cfg.kgPerBag : null;
    case "unknown": {
      if (!i.employees || !i.replacementPerYear) return null;
      // Per vervangronde komt per medewerker ongeveer 3 kledingstukken vrij.
      const piecesPerYear = i.employees * i.replacementPerYear * 3;
      return (piecesPerYear * cfg.kgPerPiece) / 12;
    }
  }
}

export interface Advice {
  monthlyKg: number;
  recommended: BoxSize;
  weeksBetween: Record<number, number>;
  emptyingsPerYear: number;
  suggestedFrequency: number | null;
  reason: string;
  estimateNote: string;
}

export function adviseBox(cfg: AdviceConfig, boxes: BoxConfig[], input: InflowInput, frequencies: number[] = [2, 4, 6]): Advice | null {
  const kg = monthlyKg(cfg, input);
  if (kg === null) return null;
  const available = boxes.filter((b) => b.available).sort((a, b) => a.size - b.size);
  if (available.length === 0) return null;
  const weeklyKg = (kg * 12) / 52;
  const margin = cfg.safetyMarginBp / 10000;
  const weeksBetween: Record<number, number> = {};
  for (const b of available) weeksBetween[b.size] = (b.capacityKg * margin) / weeklyKg;

  // Kleinste box die minstens de doeltermijn meegaat; anders de grootste.
  let choice = available.find((b) => weeksBetween[b.size] >= cfg.targetWeeksBetween)
    ?? available.find((b) => weeksBetween[b.size] >= cfg.minWeeksBetween)
    ?? available[available.length - 1];

  // Een eenmalige opruimvoorraad moet in één keer passen.
  const stock = input.oneOffStockKg ?? 0;
  if (stock > 0) {
    const fits = available.find((b) => b.size >= choice.size && b.capacityKg * margin >= stock);
    if (fits) choice = fits;
  }

  const usable = choice.capacityKg * margin;
  const emptyingsPerYear = Math.max(1, Math.ceil((kg * 12) / usable));
  const suggestedFrequency = frequencies.find((f) => f >= emptyingsPerYear) ?? null;
  const weeks = Math.round(weeksBetween[choice.size]);

  const reason = weeks >= 52
    ? `Met ongeveer ${round1(kg)} kg per maand gaat een ${choice.label} ruim een jaar mee voordat hij vol is.`
    : `Met ongeveer ${round1(kg)} kg per maand is een ${choice.label} na ongeveer ${weeks} weken vol, dus zo'n ${emptyingsPerYear} legingen per jaar.`;

  return {
    monthlyKg: round1(kg),
    recommended: choice.size,
    weeksBetween,
    emptyingsPerYear,
    suggestedFrequency,
    reason,
    estimateNote: `Schatting: we rekenen met ${available.map((b) => `${b.capacityKg} kg voor ${b.label}`).join(", ")}. De werkelijke impact komt uit de weging.`,
  };
}

function round1(n: number) { return Math.round(n * 10) / 10; }
