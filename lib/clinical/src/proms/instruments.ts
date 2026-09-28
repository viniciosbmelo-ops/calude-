/**
 * Escores v1 — somente instrumentos de uso livre (seção 9 da especificação).
 * Licenciados (Oxford, DASH/QuickDASH, WOSI…) ficam FORA até contrato por escrito.
 *
 * Regra de itens faltantes: nenhum destes instrumentos imputa valores na v1 —
 * item faltante → ClinicalGuardError. (Conservador; revisar por instrumento se necessário.)
 *
 * Refs: ASES — Richards RR, et al. J Shoulder Elbow Surg. 1994;3(6):347-52 (PMID 22958838)
 *       Constant — Constant CR, Murley AH. Clin Orthop Relat Res. 1987;(214):160-4 (PMID 3791738)
 *       MEPS — Morrey BF, An KN, Chao EYS. In: The Elbow and its Disorders (livro) [REF-PENDENTE p/ edição]
 *       Rowe — Rowe CR, Patel D, Southmayd WW. J Bone Joint Surg Am. 1978 [REF-PENDENTE — validar PMID]
 */
import { ClinicalGuardError, assertFinite, round } from '../errors';

export type Respondent = 'patient' | 'clinician' | 'mixed';
export type LicenseStatus = 'free' | 'licensed' | 'pending';

export interface ScoreResult {
  instrument: string;
  version: string;
  score: number;
  max: number;
  subscores: Record<string, number>;
  flags: string[];
}

export interface InstrumentMeta {
  code: string;
  name_pt: string;
  region: ('shoulder' | 'elbow')[];
  respondent: Respondent;
  license_status: LicenseStatus;
}

export const INSTRUMENTS: InstrumentMeta[] = [
  { code: 'SANE', name_pt: 'Single Assessment Numeric Evaluation', region: ['shoulder', 'elbow'], respondent: 'patient', license_status: 'free' },
  { code: 'ASES', name_pt: 'ASES — parte do paciente', region: ['shoulder'], respondent: 'patient', license_status: 'pending' },
  { code: 'CONSTANT', name_pt: 'Constant-Murley', region: ['shoulder'], respondent: 'mixed', license_status: 'free' },
  { code: 'MEPS', name_pt: 'Mayo Elbow Performance Score', region: ['elbow'], respondent: 'clinician', license_status: 'pending' },
  { code: 'ROWE', name_pt: 'Escore de Rowe', region: ['shoulder'], respondent: 'mixed', license_status: 'free' },
  // Bloqueados até licença:
  { code: 'OSS', name_pt: 'Oxford Shoulder Score', region: ['shoulder'], respondent: 'patient', license_status: 'licensed' },
  { code: 'OES', name_pt: 'Oxford Elbow Score', region: ['elbow'], respondent: 'patient', license_status: 'licensed' },
  { code: 'QUICKDASH', name_pt: 'QuickDASH', region: ['shoulder', 'elbow'], respondent: 'patient', license_status: 'licensed' },
  { code: 'DASH', name_pt: 'DASH', region: ['shoulder', 'elbow'], respondent: 'patient', license_status: 'licensed' },
  { code: 'WOSI', name_pt: 'Western Ontario Shoulder Instability Index', region: ['shoulder'], respondent: 'patient', license_status: 'pending' }
];

/** Só instrumentos 'free' são expostos. ASES/MEPS ficam 'pending' até confirmação dos termos — troque para 'free' após confirmar. */
export function isInstrumentEnabled(code: string): boolean {
  return INSTRUMENTS.find((i) => i.code === code)?.license_status === 'free';
}

/** Paciente nunca recebe instrumentos de preenchimento clínico/misto. */
export function canSendToPatient(code: string): boolean {
  const m = INSTRUMENTS.find((i) => i.code === code);
  return !!m && m.respondent === 'patient' && m.license_status === 'free';
}

function intIn(v: unknown, min: number, max: number, field: string): number {
  assertFinite(v, field);
  if (!Number.isInteger(v) || v < min || v > max) {
    throw new ClinicalGuardError('OUT_OF_RANGE', `"${field}" deve ser inteiro entre ${min} e ${max}.`, field);
  }
  return v;
}
function numIn(v: unknown, min: number, max: number, field: string): number {
  assertFinite(v, field);
  if (v < min || v > max) throw new ClinicalGuardError('OUT_OF_RANGE', `"${field}" deve estar entre ${min} e ${max}.`, field);
  return v;
}
function oneOf<T extends string>(v: unknown, allowed: Record<T, number>, field: string): number {
  if (typeof v !== 'string' || !(v in allowed)) {
    throw new ClinicalGuardError('OUT_OF_RANGE', `"${field}" inválido. Opções: ${Object.keys(allowed).join(', ')}.`, field);
  }
  return allowed[v as T];
}

// ---------------- SANE ----------------
export function scoreSANE(a: { value: number }): ScoreResult {
  const v = intIn(a.value, 0, 100, 'value');
  return { instrument: 'SANE', version: '1', score: v, max: 100, subscores: {}, flags: [] };
}

// ---------------- ASES (paciente) ----------------
// pain: VAS 0–10 (10 = pior dor). adl: 10 itens 0–3 (0 = incapaz, 3 = sem dificuldade).
export function scoreASES(a: { pain_vas: number; adl: number[] }): ScoreResult {
  const pain = numIn(a.pain_vas, 0, 10, 'pain_vas');
  if (!Array.isArray(a.adl) || a.adl.length !== 10) {
    throw new ClinicalGuardError('MISSING_ITEMS', 'ASES exige os 10 itens de função respondidos.', 'adl');
  }
  const adlSum = a.adl.reduce((s, v, i) => s + intIn(v, 0, 3, `adl[${i}]`), 0);
  const painScore = (10 - pain) * 5; // 0–50
  const functionScore = (adlSum * 5) / 3; // 0–50
  return {
    instrument: 'ASES',
    version: 'patient-1994',
    score: round(painScore + functionScore, 1),
    max: 100,
    subscores: { pain: round(painScore, 1), function: round(functionScore, 1) },
    flags: []
  };
}

// ---------------- Constant-Murley ----------------
const ELEVATION_BANDS = (deg: number): number => (deg <= 30 ? 0 : deg <= 60 ? 2 : deg <= 90 ? 4 : deg <= 120 ? 6 : deg <= 150 ? 8 : 10);
const HAND_POSITION = { waist: 2, xiphoid: 4, neck: 6, top_of_head: 8, above_head: 10 } as const;
const IR_POSITION = { lateral_thigh: 0, buttock: 2, lumbosacral: 4, waist_L3: 6, T12: 8, interscapular_T7: 10 } as const;
const ER_ITEMS = ['hand_behind_head_elbow_forward', 'hand_behind_head_elbow_back', 'hand_on_head_elbow_forward', 'hand_on_head_elbow_back', 'full_elevation_from_head'] as const;
export const LB_PER_KG = 2.20462;

export interface ConstantInput {
  pain: number; // 0–15 (15 = sem dor)
  sleep: number; // 0–2
  work: number; // 0–4
  recreation: number; // 0–4
  hand_position: keyof typeof HAND_POSITION;
  flexion_deg: number;
  abduction_deg: number;
  er_achieved: (typeof ER_ITEMS)[number][];
  ir_position: keyof typeof IR_POSITION;
  /** Força em abdução a 90° no plano escapular (kg). Omitir se não medida com dinamômetro. */
  strength_kg?: number;
}

export function scoreConstant(a: ConstantInput): ScoreResult {
  const pain = intIn(a.pain, 0, 15, 'pain');
  const adl = intIn(a.sleep, 0, 2, 'sleep') + intIn(a.work, 0, 4, 'work') + intIn(a.recreation, 0, 4, 'recreation') + oneOf(a.hand_position, HAND_POSITION, 'hand_position');
  const flex = ELEVATION_BANDS(numIn(a.flexion_deg, 0, 180, 'flexion_deg'));
  const abd = ELEVATION_BANDS(numIn(a.abduction_deg, 0, 180, 'abduction_deg'));
  if (!Array.isArray(a.er_achieved)) throw new ClinicalGuardError('MISSING_ITEMS', 'Informar posições de RE atingidas (lista, pode ser vazia).', 'er_achieved');
  const erSet = new Set(a.er_achieved);
  for (const e of erSet) if (!(ER_ITEMS as readonly string[]).includes(e)) throw new ClinicalGuardError('OUT_OF_RANGE', `Posição de RE inválida: ${e}`, 'er_achieved');
  const er = erSet.size * 2;
  const ir = oneOf(a.ir_position, IR_POSITION, 'ir_position');
  const rom = flex + abd + er + ir;

  const flags: string[] = [];
  let strength = 0;
  let max = 100;
  let version = 'constant-1987';
  if (a.strength_kg === undefined) {
    // NÃO normalizar para 100: registra subtotal sobre 75 e marca
    max = 75;
    version = 'constant-1987-no-strength';
    flags.push('constant_no_strength');
  } else {
    const kg = numIn(a.strength_kg, 0, 50, 'strength_kg');
    // 1 ponto por libra (Constant 1987), arredondado para baixo, teto 25
    strength = Math.min(25, Math.floor(kg * LB_PER_KG));
  }
  const subscores = { pain, adl, rom, flexion: flex, abduction: abd, external_rotation: er, internal_rotation: ir, strength };
  return { instrument: 'CONSTANT', version, score: pain + adl + rom + strength, max, subscores, flags };
}

// ---------------- MEPS ----------------
export function scoreMEPS(a: {
  pain: 'none' | 'mild' | 'moderate' | 'severe';
  arc_deg: number;
  stability: 'stable' | 'moderate_instability' | 'gross_instability';
  can_comb_hair: boolean;
  can_feed: boolean;
  can_hygiene: boolean;
  can_shirt: boolean;
  can_shoes: boolean;
}): ScoreResult {
  const pain = oneOf(a.pain, { none: 45, mild: 30, moderate: 15, severe: 0 }, 'pain');
  const arcDeg = numIn(a.arc_deg, 0, 160, 'arc_deg');
  const motion = arcDeg > 100 ? 20 : arcDeg >= 50 ? 15 : 5;
  const stability = oneOf(a.stability, { stable: 10, moderate_instability: 5, gross_instability: 0 }, 'stability');
  const tasks = ['can_comb_hair', 'can_feed', 'can_hygiene', 'can_shirt', 'can_shoes'] as const;
  for (const t of tasks) if (typeof a[t] !== 'boolean') throw new ClinicalGuardError('MISSING_ITEMS', `MEPS: item "${t}" não respondido.`, t);
  const fn = tasks.filter((t) => a[t]).length * 5;
  return { instrument: 'MEPS', version: '1', score: pain + motion + stability + fn, max: 100, subscores: { pain, motion, stability, function: fn }, flags: [] };
}

// ---------------- Rowe ----------------
export function scoreRowe(a: {
  stability: 'no_recurrence' | 'apprehension_positions' | 'subluxation' | 'recurrent_dislocation';
  motion: 'full' | 'er_75' | 'er_50' | 'no_er';
  function: 'no_limitation' | 'mild' | 'moderate' | 'marked';
}): ScoreResult {
  const stability = oneOf(a.stability, { no_recurrence: 50, apprehension_positions: 30, subluxation: 10, recurrent_dislocation: 0 }, 'stability');
  const motion = oneOf(a.motion, { full: 20, er_75: 15, er_50: 5, no_er: 0 }, 'motion');
  const fn = oneOf(a.function, { no_limitation: 30, mild: 25, moderate: 10, marked: 0 }, 'function');
  return { instrument: 'ROWE', version: '1978', score: stability + motion + fn, max: 100, subscores: { stability, motion, function: fn }, flags: [] };
}

// ---------------- Timepoints ----------------
export const TIMEPOINTS = [
  { code: 'preop', days: null as number | null, tolerance_days: 0 },
  { code: '6w', days: 42, tolerance_days: 14 },
  { code: '3m', days: 91, tolerance_days: 14 },
  { code: '6m', days: 182, tolerance_days: 30 },
  { code: '12m', days: 365, tolerance_days: 30 },
  { code: '24m', days: 730, tolerance_days: 30 }
];

/** Datas-alvo a partir da data da cirurgia (YYYY-MM-DD), em UTC, sem depender do relógio do sistema. */
export function scheduleTimepoints(surgeryDateIso: string): { code: string; due: string; window_start: string; window_end: string }[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(surgeryDateIso);
  if (!m) throw new ClinicalGuardError('BAD_DATE', 'Data da cirurgia deve ser YYYY-MM-DD.', 'surgery_date');
  const base = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  const DAY = 86400000;
  return TIMEPOINTS.filter((t) => t.days !== null).map((t) => ({
    code: t.code,
    due: iso(base + t.days! * DAY),
    window_start: iso(base + (t.days! - t.tolerance_days) * DAY),
    window_end: iso(base + (t.days! + t.tolerance_days) * DAY)
  }));
}
