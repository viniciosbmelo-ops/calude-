/**
 * SH_INST_ANT_METRICS v0.1.0
 * Calcula e EXIBE métricas de instabilidade anterior. Não emite conduta.
 *
 * Referências (numeração da especificação v1):
 *  [1]  Di Giacomo G, et al. Arthroscopy. 2014;30(1):90-8. PMID 24384275 — GT = 0.83·D − d; HSI > GT → off-track
 *  [2]  Shaha JS, et al. Am J Sports Med. 2015;43(7):1719-25. PMID 25883168 — limiar subcrítico 13,5%
 *  [3]  Balg F, Boileau P. J Bone Joint Surg Br. 2007;89(11):1470-7. PMID 17998184 — ISIS
 *  [21] Yamamoto N, et al. J Shoulder Elbow Surg. 2007;16(5):649-56. PMID 17644006 — conceito de glenoid track
 *  [22] Burkhart SS, De Beer JF. Arthroscopy. 2000;16(7):677-94. PMID 11027751
 */
import { ClinicalGuardError, assertFinite, round } from '../errors';

export const MODULE_ID = 'SH_INST_ANT_METRICS';
export const MODULE_VERSION = '0.1.0';
export const OUTPUTS_ARE_RECOMMENDATIONS = false as const;

/** Faixa de sanidade de UNIDADE (pega cm digitado como mm). Não é faixa de normalidade. */
export const GLENOID_DIAMETER_SANITY_MM = { min: 15, max: 40 } as const;
export const HSI_SANITY_MM = { min: 0, max: 50 } as const;
export const GT_COEFFICIENT = 0.83;
export const SUBCRITICAL_THRESHOLD_PCT = 13.5;

export interface BoneInput {
  /** Diâmetro do círculo inferior da glenoide (mm), TC 3D en face */
  D_mm?: number;
  /** Largura do defeito anterior (mm) */
  d_mm?: number;
  /** Hill-Sachs interval = largura do HS + ponte óssea (mm) */
  hsi_mm?: number;
}

export interface IsisInput {
  age_at_surgery?: number;
  sport_competitive?: boolean;
  sport_contact_or_forced_overhead?: boolean;
  hyperlaxity?: boolean;
  hs_visible_ap_er?: boolean;
  glenoid_contour_loss_ap?: boolean;
}

export type Track = 'on_track' | 'off_track';

export interface InfoFlag {
  id: string;
  level: 'info';
  text_pt: string;
  refs: number[];
}

export interface MetricsResult {
  module: string;
  version: string;
  outputs_are_recommendations: false;
  gbl_pct: number | null;
  gt_mm: number | null;
  hsi_mm: number | null;
  track: Track | null;
  margin_mm: number | null;
  isis: number | null;
  isis_components: Record<string, number> | null;
  flags: InfoFlag[];
  missing: string[];
  refs: Record<string, number[]>;
}

function guardBone(D: number, d: number): void {
  if (D < GLENOID_DIAMETER_SANITY_MM.min || D > GLENOID_DIAMETER_SANITY_MM.max) {
    throw new ClinicalGuardError(
      'G2',
      `Diâmetro glenoidal fora da faixa anatômica plausível (${GLENOID_DIAMETER_SANITY_MM.min}–${GLENOID_DIAMETER_SANITY_MM.max} mm) — conferir unidade.`,
      'D_mm'
    );
  }
  if (d < 0) throw new ClinicalGuardError('G1', 'Defeito glenoidal negativo — medida inválida.', 'd_mm');
  if (d >= D) throw new ClinicalGuardError('G1', 'Defeito maior ou igual ao diâmetro — medida inválida.', 'd_mm');
}

export function glenoidBoneLossPct(D_mm: number, d_mm: number): number {
  assertFinite(D_mm, 'D_mm');
  assertFinite(d_mm, 'd_mm');
  guardBone(D_mm, d_mm);
  return round((d_mm / D_mm) * 100, 1);
}

export function glenoidTrack(D_mm: number, d_mm: number): number {
  assertFinite(D_mm, 'D_mm');
  assertFinite(d_mm, 'd_mm');
  guardBone(D_mm, d_mm);
  return round(GT_COEFFICIENT * D_mm - d_mm, 1);
}

export function trackStatus(gt_mm: number, hsi_mm: number): { track: Track; margin_mm: number } {
  assertFinite(gt_mm, 'gt_mm');
  assertFinite(hsi_mm, 'hsi_mm');
  if (hsi_mm < HSI_SANITY_MM.min || hsi_mm > HSI_SANITY_MM.max) {
    throw new ClinicalGuardError('G3', 'HSI implausível (0–50 mm) — conferir medida.', 'hsi_mm');
  }
  // Igualdade = on-track (definição: off-track somente se HSI > GT)
  return { track: hsi_mm > gt_mm ? 'off_track' : 'on_track', margin_mm: round(gt_mm - hsi_mm, 1) };
}

const ISIS_FIELDS: (keyof IsisInput)[] = [
  'age_at_surgery',
  'sport_competitive',
  'sport_contact_or_forced_overhead',
  'hyperlaxity',
  'hs_visible_ap_er',
  'glenoid_contour_loss_ap'
];

export function isisScore(input: Required<IsisInput>): { total: number; components: Record<string, number> } {
  assertFinite(input.age_at_surgery, 'age_at_surgery');
  if (input.age_at_surgery < 10 || input.age_at_surgery > 100) {
    throw new ClinicalGuardError('G4', 'Idade implausível para ISIS.', 'age_at_surgery');
  }
  const components = {
    age_le_20: input.age_at_surgery <= 20 ? 2 : 0,
    sport_competitive: input.sport_competitive ? 2 : 0,
    sport_contact_or_forced_overhead: input.sport_contact_or_forced_overhead ? 1 : 0,
    hyperlaxity: input.hyperlaxity ? 1 : 0,
    hs_visible_ap_er: input.hs_visible_ap_er ? 2 : 0,
    glenoid_contour_loss_ap: input.glenoid_contour_loss_ap ? 2 : 0
  };
  const total = Object.values(components).reduce((a, b) => a + b, 0);
  return { total, components };
}

/**
 * Avalia tudo que for possível com os dados presentes.
 * Dados ausentes NÃO são estimados: entram em `missing`.
 */
export function evaluateInstabilityMetrics(bone: BoneInput, isis: IsisInput): MetricsResult {
  const missing: string[] = [];
  const flags: InfoFlag[] = [];
  let gbl_pct: number | null = null;
  let gt_mm: number | null = null;
  let track: Track | null = null;
  let margin_mm: number | null = null;

  const hasBone = bone.D_mm !== undefined && bone.d_mm !== undefined;
  if (!hasBone) {
    if (bone.D_mm === undefined) missing.push('D_mm');
    if (bone.d_mm === undefined) missing.push('d_mm');
  } else {
    gbl_pct = glenoidBoneLossPct(bone.D_mm!, bone.d_mm!);
    gt_mm = glenoidTrack(bone.D_mm!, bone.d_mm!);
    if (gbl_pct >= SUBCRITICAL_THRESHOLD_PCT) {
      flags.push({
        id: 'I4_FLAG_SUBCRITICAL',
        level: 'info',
        text_pt:
          'Perda glenoidal ≥13,5% — faixa associada a pior WOSI após Bankart artroscópico em coorte militar (Shaha 2015). Limiares variam entre estudos e métodos de medida.',
        refs: [2]
      });
    }
  }

  if (bone.hsi_mm === undefined) {
    missing.push('hsi_mm');
  } else if (gt_mm !== null) {
    const t = trackStatus(gt_mm, bone.hsi_mm);
    track = t.track;
    margin_mm = t.margin_mm;
  }

  let isisTotal: number | null = null;
  let isisComponents: Record<string, number> | null = null;
  const isisMissing = ISIS_FIELDS.filter((f) => isis[f] === undefined);
  if (isisMissing.length === 0) {
    const r = isisScore(isis as Required<IsisInput>);
    isisTotal = r.total;
    isisComponents = r.components;
  } else {
    missing.push(...isisMissing.map((f) => `isis.${f}`));
  }

  return {
    module: MODULE_ID,
    version: MODULE_VERSION,
    outputs_are_recommendations: OUTPUTS_ARE_RECOMMENDATIONS,
    gbl_pct,
    gt_mm,
    hsi_mm: bone.hsi_mm ?? null,
    track,
    margin_mm,
    isis: isisTotal,
    isis_components: isisComponents,
    flags,
    missing,
    refs: { gbl_pct: [1, 22], gt_mm: [1, 21], track: [1], isis: [3] }
  };
}
