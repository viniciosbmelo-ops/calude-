/**
 * Regenerative follow-up schedule.
 *
 * The base schedule applies to every regenerative case. Product-specific
 * checkpoints are added only when the case actually uses that product: the
 * 6-week hyaluronic-acid review ("6 semanas (HA)") belongs to viscosupplement
 * cases and must never appear for PRP-only (or other biologic) cases.
 */
export type RegenFollowupSlot = {
  periodo: string;
  days: number;
  scales: string[];
  /** When set, the slot is scheduled only if the case uses one of these product codes. */
  products?: readonly string[];
};

export const HYALURONIC_ACID_PRODUCT_CODES = ["AH"] as const;

export const REGEN_FOLLOWUP_SCHEDULE: readonly RegenFollowupSlot[] = [
  { periodo: "Pré-op (Baseline)", days: 0, scales: ["VAS Dor"] },
  { periodo: "1 mês", days: 30, scales: ["VAS Dor"] },
  { periodo: "6 semanas (HA)", days: 42, scales: ["VAS Dor"], products: HYALURONIC_ACID_PRODUCT_CODES },
  { periodo: "3 meses", days: 90, scales: ["VAS Dor"] },
  { periodo: "6 meses ★", days: 180, scales: ["VAS Dor"] },
  { periodo: "12 meses", days: 365, scales: ["VAS Dor"] },
  { periodo: "24 meses", days: 730, scales: ["VAS Dor"] },
  { periodo: "4 anos", days: 1460, scales: ["VAS Dor"] },
];

/** Follow-up slots that apply to a case using the given product codes. */
export function regenFollowupScheduleFor(
  productCodes: Iterable<string | null | undefined>,
): RegenFollowupSlot[] {
  const used = new Set<string>();
  for (const code of productCodes) {
    if (typeof code === "string" && code.trim()) used.add(code.trim().toUpperCase());
  }
  return REGEN_FOLLOWUP_SCHEDULE.filter(
    (slot) => !slot.products || slot.products.some((code) => used.has(code)),
  );
}

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Adds `days` to a calendar date ("YYYY-MM-DD") without any timezone math.
 * Invalid or missing input falls back to `today` (also a calendar date).
 */
export function addDaysToCalendarDate(baseDate: string | null | undefined, days: number, today: string): string {
  const match = DATE_ONLY_RE.exec((baseDate ?? "").trim().slice(0, 10)) ?? DATE_ONLY_RE.exec(today);
  if (!match) throw new Error("invalid calendar date");
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return utc.toISOString().slice(0, 10);
}

/** Today's calendar date ("YYYY-MM-DD") on the clinic calendar (America/Sao_Paulo). */
export function clinicToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
