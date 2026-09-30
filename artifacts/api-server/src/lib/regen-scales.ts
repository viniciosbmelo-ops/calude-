/**
 * Scales the DocKnee regenerative module actually offers.
 *
 * Only these names may be written from a client. Licensed or retired
 * instruments (KOOS, WOMAC, IKDC, ASES, DASH…) are rejected; rows already
 * stored under old names are left untouched and still displayed.
 */

// ─── Regen follow-up schedule ─────────────────────────────────────────────────
// Escalas do joelho (WOMAC, IKDC, KOOS-12, Tegner) retiradas; só dor (VAS)
// até as escalas de ombro/cotovelo serem definidas.
export const REGEN_FOLLOWUP_SCHEDULE = [
  { periodo: "Pré-op (Baseline)",  days: 0,    scales: ["VAS Dor"] },
  { periodo: "1 mês",              days: 30,   scales: ["VAS Dor"] },
  { periodo: "6 semanas (HA)",     days: 42,   scales: ["VAS Dor"] },
  { periodo: "3 meses",            days: 90,   scales: ["VAS Dor"] },
  { periodo: "6 meses ★",          days: 180,  scales: ["VAS Dor"] },
  { periodo: "12 meses",           days: 365,  scales: ["VAS Dor"] },
  { periodo: "24 meses",           days: 730,  scales: ["VAS Dor"] },
  { periodo: "4 anos",             days: 1460, scales: ["VAS Dor"] },
];

/** Scales the patient answers through the regen follow-up link. */
export const REGEN_PATIENT_SCALES: ReadonlySet<string> = new Set(
  REGEN_FOLLOWUP_SCHEDULE.flatMap((slot) => slot.scales),
);

export function isRegenPatientScale(scale: unknown): scale is string {
  return typeof scale === "string" && REGEN_PATIENT_SCALES.has(scale);
}

/** Legacy notifications may list retired scales: never ask the patient for them. */
export function filterRegenPatientScales(scales: readonly unknown[] | null | undefined): string[] {
  return [...new Set((scales ?? []).filter(isRegenPatientScale))];
}

/** Instruments the physician can record manually on a regen case (case page PROM form). */
export const REGEN_PROM_INSTRUMENTS = ["VAS"] as const;
