/**
 * Escalas preenchidas pelo MÉDICO no retorno (Constant-Murley, Rowe…).
 *
 * Quais escalas valem para uma cirurgia sai do catálogo: `proms_default` das patologias
 * registradas (subtipo sem `proms_default` herda do `parent`). Só entram instrumentos
 * de preenchimento clínico/misto, com licença 'free' e com função de escore no pacote.
 * Itens e faixas vêm das constantes exportadas por ./instruments (mesma fonte do escore).
 */
import { ClinicalGuardError } from '../errors';
import { PATHOLOGY_BY_CODE } from '../catalog/pathologies';
import { CASE_TYPE_BY_KEY } from '../catalog/caseTypes';
import {
  CONSTANT_ER_ITEMS,
  CONSTANT_ER_POINTS,
  CONSTANT_HAND_POSITION,
  CONSTANT_IR_POSITION,
  CONSTANT_MAX_WITHOUT_STRENGTH,
  CONSTANT_MAX_WITH_STRENGTH,
  CONSTANT_RANGES,
  INSTRUMENTS,
  ROWE_OPTIONS,
  scoreConstant,
  scoreMEPS,
  scoreRowe,
  type ConstantInput,
  type ScoreResult
} from './instruments';

export type ClinicianItem =
  | { field: string; kind: 'integer' | 'number'; min: number; max: number; optional?: boolean }
  | { field: string; kind: 'choice'; options: { value: string; points: number }[] }
  | { field: string; kind: 'multi'; options: { value: string; points: number }[] };

const choices = (o: Record<string, number>) => Object.entries(o).map(([value, points]) => ({ value, points }));
const range = (field: keyof typeof CONSTANT_RANGES, kind: 'integer' | 'number', optional?: boolean): ClinicianItem => ({
  field,
  kind,
  min: CONSTANT_RANGES[field][0],
  max: CONSTANT_RANGES[field][1],
  ...(optional ? { optional } : {})
});

/** Itens de cada escala clínica, na ordem do escore. Derivados das constantes do escore. */
export const CLINICIAN_SCALE_ITEMS: Readonly<Record<string, readonly ClinicianItem[]>> = {
  CONSTANT: [
    range('pain', 'integer'),
    range('sleep', 'integer'),
    range('work', 'integer'),
    range('recreation', 'integer'),
    { field: 'hand_position', kind: 'choice', options: choices(CONSTANT_HAND_POSITION) },
    range('flexion_deg', 'number'),
    range('abduction_deg', 'number'),
    { field: 'er_achieved', kind: 'multi', options: CONSTANT_ER_ITEMS.map((value) => ({ value, points: CONSTANT_ER_POINTS })) },
    { field: 'ir_position', kind: 'choice', options: choices(CONSTANT_IR_POSITION) },
    range('strength_kg', 'number', true)
  ],
  ROWE: [
    { field: 'stability', kind: 'choice', options: choices(ROWE_OPTIONS.stability) },
    { field: 'motion', kind: 'choice', options: choices(ROWE_OPTIONS.motion) },
    { field: 'function', kind: 'choice', options: choices(ROWE_OPTIONS.function) }
  ]
};

/** Máximo do Constant conforme a variante (com/sem dinamômetro). */
export function constantMax(withDynamometer: boolean): number {
  return withDynamometer ? CONSTANT_MAX_WITH_STRENGTH : CONSTANT_MAX_WITHOUT_STRENGTH;
}

// Funções de escore das escalas de preenchimento clínico/misto do pacote.
// MEPS está aqui mas segue bloqueado pela licença ('pending') em isClinicianScaleEnabled.
const SCORERS: Readonly<Record<string, (answers: Record<string, unknown>) => ScoreResult>> = {
  CONSTANT: (a) => scoreConstant(a as unknown as ConstantInput),
  ROWE: (a) => scoreRowe(a as unknown as Parameters<typeof scoreRowe>[0]),
  MEPS: (a) => scoreMEPS(a as unknown as Parameters<typeof scoreMEPS>[0])
};

/** Escala clínica/mista, com licença 'free', com escore e itens definidos no pacote. */
export function isClinicianScaleEnabled(code: string): boolean {
  const m = INSTRUMENTS.find((i) => i.code === code);
  return !!m && m.respondent !== 'patient' && m.license_status === 'free' && code in SCORERS && code in CLINICIAN_SCALE_ITEMS;
}

/** proms_default da patologia; subtipo sem lista própria herda do parent. */
export function promsDefaultFor(code: string): string[] {
  const seen = new Set<string>();
  let p = PATHOLOGY_BY_CODE.get(code);
  while (p && !seen.has(p.code)) {
    if (p.proms_default) return [...p.proms_default];
    seen.add(p.code);
    p = p.parent ? PATHOLOGY_BY_CODE.get(p.parent) : undefined;
  }
  return [];
}

export interface SurgeryScaleSource {
  /** surgeries.dados_clinicos (ClinicalPayload) — pode ser nulo ou incompleto */
  dadosClinicos?: unknown;
  /** surgeries.tipos_procedimento (chaves de CASE_TYPES) */
  tiposProcedimento?: readonly string[] | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Códigos de patologia da cirurgia: procedimentos[].codigo + geral.preop_dx/postop_dx.
 * Sem nenhum código registrado, usa a patologia padrão (primeira) de cada tipo de caso.
 */
export function surgeryPathologyCodes(src: SurgeryScaleSource): string[] {
  const out = new Set<string>();
  const add = (c: unknown) => { if (typeof c === 'string' && PATHOLOGY_BY_CODE.has(c)) out.add(c); };
  const d = src.dadosClinicos;
  if (isObj(d)) {
    if (Array.isArray(d.procedimentos)) for (const p of d.procedimentos) if (isObj(p)) add(p.codigo);
    if (isObj(d.geral)) {
      for (const k of ['preop_dx', 'postop_dx'] as const) {
        const list = d.geral[k];
        if (Array.isArray(list)) list.forEach(add);
      }
    }
  }
  if (out.size === 0) {
    for (const key of src.tiposProcedimento ?? []) add(CASE_TYPE_BY_KEY.get(key)?.codes[0]);
  }
  return [...out];
}

/** Escalas do médico aplicáveis à cirurgia, na ordem de INSTRUMENTS. */
export function applicableClinicianScales(src: SurgeryScaleSource): string[] {
  const wanted = new Set<string>();
  for (const code of surgeryPathologyCodes(src)) {
    const region = PATHOLOGY_BY_CODE.get(code)!.region;
    for (const inst of promsDefaultFor(code)) {
      const meta = INSTRUMENTS.find((i) => i.code === inst);
      if (meta && meta.region.includes(region) && isClinicianScaleEnabled(inst)) wanted.add(inst);
    }
  }
  return INSTRUMENTS.map((i) => i.code).filter((c) => wanted.has(c));
}

/**
 * Valida e pontua as respostas de uma escala clínica com a função do pacote.
 * Retorna só os campos conhecidos (descarta o resto). Lança ClinicalGuardError.
 */
export function scoreClinicianScale(code: string, raw: unknown): { answers: Record<string, unknown>; result: ScoreResult } {
  if (!isClinicianScaleEnabled(code)) throw new ClinicalGuardError('SCALE_NOT_ENABLED', `Escala "${code}" não habilitada para preenchimento clínico.`, code);
  if (!isObj(raw)) throw new ClinicalGuardError('MISSING_ITEMS', `Respostas de "${code}" devem ser um objeto.`, code);
  const answers: Record<string, unknown> = {};
  for (const item of CLINICIAN_SCALE_ITEMS[code]) {
    const v = raw[item.field];
    if (v === undefined || v === null || v === '') {
      if (item.kind !== 'choice' && item.kind !== 'multi' && item.optional) continue;
    }
    answers[item.field] = v;
  }
  return { answers, result: SCORERS[code](answers) };
}
