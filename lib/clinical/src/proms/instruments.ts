/**
 * Escores v1 — somente instrumentos de uso livre (seção 9 da especificação).
 * Escalas que exigem licença (ou com termos não confirmados) não fazem parte do pacote.
 *
 * Regra de itens faltantes: nenhum destes instrumentos imputa valores na v1 —
 * item faltante → ClinicalGuardError. (Conservador; revisar por instrumento se necessário.)
 *
 * Refs: Constant — Constant CR, Murley AH. Clin Orthop Relat Res. 1987;(214):160-4 (PMID 3791738)
 *       Rowe — Rowe CR, Patel D, Southmayd WW. J Bone Joint Surg Am. 1978 [REF-PENDENTE — validar PMID]
 */
import { ClinicalGuardError, assertFinite } from '../errors';

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
  { code: 'CONSTANT', name_pt: 'Constant-Murley', region: ['shoulder'], respondent: 'mixed', license_status: 'free' },
  { code: 'ROWE', name_pt: 'Escore de Rowe', region: ['shoulder'], respondent: 'mixed', license_status: 'free' }
];

/** Só instrumentos 'free' são expostos (guarda mantida: escala que exija licença não deve entrar em INSTRUMENTS). */
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
  // hasOwn: `in` aceitaria chaves do protótipo ("constructor", "toString").
  if (typeof v !== 'string' || !Object.prototype.hasOwnProperty.call(allowed, v)) {
    throw new ClinicalGuardError('OUT_OF_RANGE', `"${field}" inválido. Opções: ${Object.keys(allowed).join(', ')}.`, field);
  }
  return allowed[v as T];
}

// ---------------- SANE ----------------
export function scoreSANE(a: { value: number }): ScoreResult {
  const v = intIn(a.value, 0, 100, 'value');
  return { instrument: 'SANE', version: '1', score: v, max: 100, subscores: {}, flags: [] };
}

// ---------------- Constant-Murley ----------------
const ELEVATION_BANDS = (deg: number): number => (deg <= 30 ? 0 : deg <= 60 ? 2 : deg <= 90 ? 4 : deg <= 120 ? 6 : deg <= 150 ? 8 : 10);
/** Opções/pontos dos itens categóricos do Constant (exportados para a UI; fonte única com o escore). */
export const CONSTANT_HAND_POSITION = { waist: 2, xiphoid: 4, neck: 6, top_of_head: 8, above_head: 10 } as const;
export const CONSTANT_IR_POSITION = { lateral_thigh: 0, buttock: 2, lumbosacral: 4, waist_L3: 6, T12: 8, interscapular_T7: 10 } as const;
export const CONSTANT_ER_ITEMS = ['hand_behind_head_elbow_forward', 'hand_behind_head_elbow_back', 'hand_on_head_elbow_forward', 'hand_on_head_elbow_back', 'full_elevation_from_head'] as const;
/** Pontos por posição de RE atingida. */
export const CONSTANT_ER_POINTS = 2;
/** Faixas aceitas dos itens numéricos do Constant [mín, máx]. */
export const CONSTANT_RANGES = {
  pain: [0, 15],
  sleep: [0, 2],
  work: [0, 4],
  recreation: [0, 4],
  flexion_deg: [0, 180],
  abduction_deg: [0, 180],
  strength_kg: [0, 50]
} as const;
/** Máximo com força medida (dinamômetro) e sem ela (subtotal sobre 75, sem normalizar). */
export const CONSTANT_MAX_WITH_STRENGTH = 100;
export const CONSTANT_MAX_WITHOUT_STRENGTH = 75;
const HAND_POSITION = CONSTANT_HAND_POSITION;
const IR_POSITION = CONSTANT_IR_POSITION;
const ER_ITEMS = CONSTANT_ER_ITEMS;
const R = CONSTANT_RANGES;
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
  const pain = intIn(a.pain, R.pain[0], R.pain[1], 'pain');
  const adl = intIn(a.sleep, R.sleep[0], R.sleep[1], 'sleep') + intIn(a.work, R.work[0], R.work[1], 'work') + intIn(a.recreation, R.recreation[0], R.recreation[1], 'recreation') + oneOf(a.hand_position, HAND_POSITION, 'hand_position');
  const flex = ELEVATION_BANDS(numIn(a.flexion_deg, R.flexion_deg[0], R.flexion_deg[1], 'flexion_deg'));
  const abd = ELEVATION_BANDS(numIn(a.abduction_deg, R.abduction_deg[0], R.abduction_deg[1], 'abduction_deg'));
  if (!Array.isArray(a.er_achieved)) throw new ClinicalGuardError('MISSING_ITEMS', 'Informar posições de RE atingidas (lista, pode ser vazia).', 'er_achieved');
  const erSet = new Set(a.er_achieved);
  for (const e of erSet) if (!(ER_ITEMS as readonly string[]).includes(e)) throw new ClinicalGuardError('OUT_OF_RANGE', `Posição de RE inválida: ${e}`, 'er_achieved');
  const er = erSet.size * CONSTANT_ER_POINTS;
  const ir = oneOf(a.ir_position, IR_POSITION, 'ir_position');
  const rom = flex + abd + er + ir;

  const flags: string[] = [];
  let strength = 0;
  let max: number = CONSTANT_MAX_WITH_STRENGTH;
  let version = 'constant-1987';
  if (a.strength_kg === undefined) {
    // NÃO normalizar para 100: registra subtotal sobre 75 e marca
    max = CONSTANT_MAX_WITHOUT_STRENGTH;
    version = 'constant-1987-no-strength';
    flags.push('constant_no_strength');
  } else {
    const kg = numIn(a.strength_kg, R.strength_kg[0], R.strength_kg[1], 'strength_kg');
    // 1 ponto por libra (Constant 1987), arredondado para baixo, teto 25
    strength = Math.min(25, Math.floor(kg * LB_PER_KG));
  }
  const subscores = { pain, adl, rom, flexion: flex, abduction: abd, external_rotation: er, internal_rotation: ir, strength };
  return { instrument: 'CONSTANT', version, score: pain + adl + rom + strength, max, subscores, flags };
}

// ---------------- Rowe ----------------
/** Opções/pontos dos itens do Rowe (exportados para a UI; fonte única com o escore). */
export const ROWE_OPTIONS = {
  stability: { no_recurrence: 50, apprehension_positions: 30, subluxation: 10, recurrent_dislocation: 0 },
  motion: { full: 20, er_75: 15, er_50: 5, no_er: 0 },
  function: { no_limitation: 30, mild: 25, moderate: 10, marked: 0 }
} as const;

export function scoreRowe(a: {
  stability: keyof typeof ROWE_OPTIONS.stability;
  motion: keyof typeof ROWE_OPTIONS.motion;
  function: keyof typeof ROWE_OPTIONS.function;
}): ScoreResult {
  const stability = oneOf(a.stability, ROWE_OPTIONS.stability, 'stability');
  const motion = oneOf(a.motion, ROWE_OPTIONS.motion, 'motion');
  const fn = oneOf(a.function, ROWE_OPTIONS.function, 'function');
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
