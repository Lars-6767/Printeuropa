/** Datums als 'YYYY-MM-DD' (Europe/Amsterdam). */
const TZ = "Europe/Amsterdam";

export function today(): string {
  return toISODate(new Date());
}
export function toISODate(d: Date): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return p;
}
export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function addMonths(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00Z");
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}
export function firstOfNextMonth(iso: string): string {
  const d = new Date(iso.slice(0, 7) + "-01T12:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}
export function endOfMonth(iso: string): string {
  const d = new Date(iso.slice(0, 7) + "-01T12:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}
export function daysInMonth(iso: string) {
  return Number(endOfMonth(iso).slice(8, 10));
}
export function formatDate(iso: string | Date | null | undefined, opts: { weekday?: boolean; short?: boolean } = {}): string {
  if (!iso) return "–";
  const d = typeof iso === "string" ? new Date(iso.length === 10 ? iso + "T12:00:00Z" : iso) : iso;
  return new Intl.DateTimeFormat("nl-NL", {
    timeZone: TZ,
    weekday: opts.weekday ? (opts.short ? "short" : "long") : undefined,
    day: "numeric",
    month: opts.short ? "short" : "long",
    year: opts.short ? undefined : "numeric",
  }).format(d);
}
export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "–";
  return new Intl.DateTimeFormat("nl-NL", { timeZone: TZ, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(d));
}
export function weekdayCode(iso: string): string {
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date(iso + "T12:00:00Z").getUTCDay()];
}
