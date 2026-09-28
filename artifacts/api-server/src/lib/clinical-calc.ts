/**
 * Pure clinical calculation functions — osteotomy planning (DocKnee).
 *
 * Extracted from xray.ts so they can be unit-tested independently of HTTP
 * infrastructure. Every function is a pure transformation of numbers → numbers
 * (no I/O, no DB, no patient identifiers).
 *
 * References:
 *   - Paley D. "Principles of Deformity Correction" (2002)
 *   - Miniaci A et al. "Correction of lower limb malalignment" (1989)
 *   - Noyes / Barber-Westin osteotomy planning conventions
 */

// ── Paley Reconciliation ─────────────────────────────────────────────────────

/**
 * Paley HKA formula for mechanical mLDFA.
 *   HKA_fórmula = (mLDFA − 87°) + (87° − aMPTA) + JLCA
 *
 * Reference normals: mLDFA = 87°, aMPTA = 87°.
 *   Positive → Varo | Negative → Valgo | 0 → Normal alignment
 *
 * Documented examples (spec RX_PANOR §4.1):
 *   Varo:  mLDFA=91, aMPTA=82, JLCA=2  → 4+5+2 = +11° (Varo)
 *   Valgo: mLDFA=84, aMPTA=91, JLCA=0  → −3+(−4)+0 = −7° (Valgo)
 *   Normal: mLDFA=87, aMPTA=87, JLCA=0 → 0°
 */
export function calcPaleyHKA(mldfa: number, ampta: number, jlca: number): number {
  return (mldfa - 87) + (87 - ampta) + jlca;
}

// ── JLCA Correction Phenomenon ───────────────────────────────────────────────

/**
 * JLCA correction phenomenon adjustment (Paley rule).
 *
 * When JLCA > 4°, ligament tension restores some alignment post-osteotomy.
 * Subtract 50% of JLCA excess above 2° from the planned bone correction.
 *   jlcaAdjustment = max(0, (min(jlca, 10) − 2) × 0.5)  [only when capped JLCA > 4°]
 *
 * JLCA is capped at 10°; values above are likely erroneous measurements.
 *
 * Examples:
 *   JLCA=4   → threshold not exceeded → 0° adjustment
 *   JLCA=8   → (8−2)×0.5 = 3.0° subtracted from correction
 *   JLCA=15  → capped to 10 → (10−2)×0.5 = 4.0°
 */
export function calcJlcaAdjustment(jlca: number): number {
  const capped = Math.min(jlca, 10);
  if (capped <= 4) return 0;
  return Math.round((capped - 2) * 0.5 * 10) / 10;
}

// ── Total Correction ─────────────────────────────────────────────────────────

/**
 * Total osteotomy correction needed (degrees), after JLCA adjustment.
 *
 * Uses SIGNED HKA so that zero-crossing (varo→valgo or valgo→varo) is
 * accounted for correctly. This is a critical safety property:
 *
 *   signedHka=−17.8°, hkaDesejado=+1.4° (target crosses zero to slight valgo)
 *   CORRECT:  |−17.8 − 1.4| = 19.2°
 *   WRONG:    |17.8  − 1.4| = 16.4°  ← underestimates by 2×hkaDesejado
 *
 * Returns 0 when already at or beyond target (no further correction needed).
 */
export function calcAnguloTotal(
  signedHka: number,
  hkaDesejado: number,
  jlcaAdjustment: number,
): number {
  const raw = Math.abs(signedHka - hkaDesejado);
  return Math.round(Math.max(0, raw - jlcaAdjustment) * 10) / 10;
}

// ── WBL (Weight-Bearing Line) ─────────────────────────────────────────────────

/**
 * Weight-bearing line percentage (pre-operative).
 * Formula: WBL = 50 + signedHKA × 1.6
 *   Normal knee (HKA=0°) → WBL = 50% (through centre of joint)
 *   Varo (HKA<0°)         → WBL < 50% (medial shift)
 *   Valgo (HKA>0°)        → WBL > 50% (lateral shift)
 */
export function calcWBLPre(signedHka: number): number {
  return Math.round((50 + signedHka * 1.6) * 10) / 10;
}

// ── Wedge Size Helpers ────────────────────────────────────────────────────────

/**
 * Tibial wedge size (mm) for a given correction angle.
 * Rule of thumb (validated): 1° ≈ 1 mm of tibial opening/closing.
 */
export function calcWedgeTib(deg: number): number {
  return Math.round(deg * 1.0 * 10) / 10;
}

/**
 * Femoral wedge size (mm) for a given correction angle.
 * Rule of thumb (validated): 1° ≈ 1.26 mm of femoral wedge.
 */
export function calcWedgeFem(deg: number): number {
  return Math.round(deg * 1.26 * 10) / 10;
}

// ── Miniaci DFO Planning ──────────────────────────────────────────────────────

/**
 * @deprecated Chen formula (0.97×deg+0.15) — validated only for tibial OWHTO
 * in varo knees (Chen 2025, PMID 39944774). Out of scope for femur and valgus.
 * Use the geometric Miniaci reverse (dfo-geometry.ts) for DFO instead.
 * Kept for backward-compat with existing unit tests and AI prompt fallback.
 */
export function calcMiniaci(deg: number): number {
  return Math.round(Math.abs(0.97 * deg + 0.15) * 10) / 10;
}

/**
 * Graduated JLCA adjustment for DFO (Miniaci reverse, Prompt 1 spec).
 *
 * Discrete table (distinct from Paley's continuous HTO formula):
 *   JLCA ≤ 3° → 0 | 4–6° → 1 | 7–8° → 2 | ≥ 9° → 3
 *
 * Returns a positive value to SUBTRACT from α:  αAlvo = α − result.
 */
export function calcJlcaAjusteGraduadoDFO(jlca: number): number {
  const j = Math.abs(jlca);
  if (j <= 3) return 0;
  if (j <= 6) return 1;
  if (j <= 8) return 2;
  return 3;
}

export type DFOHeightResult = {
  alturaOsteotomia: string;    // e.g. "5.5–6.5" (cm range)
  alturaSeveridade: string;    // "Leve" | "Moderado (padrão)" | "Severo" | "Muito severo"
  localizacaoProximal: string; // cm proximal to joint line, e.g. "1.6–2.1"
};

/**
 * DFO osteotomy height classification from a Miniaci wedge angle.
 *
 * Height table (spec RX_PANOR):
 *   ≤8°  → 5–5.5 cm   (Leve)
 *   ≤12° → 5.5–6.5 cm (Moderado)
 *   ≤15° → 6.5–7.5 cm (Severo)
 *   >15° → 7.5–8 cm   (Muito severo)
 */
export function calcDFOHeight(miniaci: number): DFOHeightResult {
  if (miniaci <= 8)  return { alturaOsteotomia: "5–5.5",   alturaSeveridade: "Leve",              localizacaoProximal: "1.5–2.0" };
  if (miniaci <= 12) return { alturaOsteotomia: "5.5–6.5", alturaSeveridade: "Moderado (padrão)", localizacaoProximal: "1.6–2.1" };
  if (miniaci <= 15) return { alturaOsteotomia: "6.5–7.5", alturaSeveridade: "Severo",            localizacaoProximal: "1.7–2.2" };
  return               { alturaOsteotomia: "7.5–8",   alturaSeveridade: "Muito severo",      localizacaoProximal: "1.7–2.2" };
}

/**
 * Combined: Miniaci formula + height classification.
 * Equivalent to the inline `calcDFOPlan` previously used in xray.ts.
 */
export function calcDFOPlan(deg: number): {
  miniaci: number;
  alturaOsteotomia: string;
  alturaSeveridade: string;
  localizacaoProximal: string;
} {
  const miniaci = calcMiniaci(deg);
  return { miniaci, ...calcDFOHeight(miniaci) };
}

// ── Varo/Valgo Classification ─────────────────────────────────────────────────

/**
 * Deformity direction from signed HKA (negative=Varo, positive=Valgo, 0=Normal).
 */
export function classifyDeformity(signedHka: number): "Varo" | "Valgo" | "Normal" {
  if (signedHka < 0) return "Varo";
  if (signedHka > 0) return "Valgo";
  return "Normal";
}

/**
 * Severity grade from HKA magnitude.
 *   Grau I: 0–5°  |  Grau II: 5–10°  |  Grau III: >10°
 */
export function classifyGrau(hkaMagnitude: number): "Normal" | "I" | "II" | "III" {
  if (hkaMagnitude === 0) return "Normal";
  if (hkaMagnitude <= 5)  return "I";
  if (hkaMagnitude <= 10) return "II";
  return "III";
}

// ── Dupla Osteotomy Weight Split ─────────────────────────────────────────────

/**
 * Proportional weight split between femoral and tibial correction
 * in a double osteotomy, based on each component's deviation from Paley normal (87°).
 *
 * Returns { pesoFem, pesoTib } where pesoFem + pesoTib = 1.
 * When both deviations are zero, defaults to 50/50 split.
 */
export function calcDuplaWeightSplit(
  mldfa: number,
  ampta: number,
): { pesoFem: number; pesoTib: number } {
  const desvioFem = Math.abs(mldfa - 87);
  const desvioTib = Math.abs(ampta - 87);
  const total = (desvioFem + desvioTib) || 1;
  return {
    pesoFem: desvioFem / total,
    pesoTib: desvioTib / total,
  };
}
