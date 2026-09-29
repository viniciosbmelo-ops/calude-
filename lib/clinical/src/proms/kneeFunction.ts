/**
 * Joelho — medidas livres de licença (sem KOOS, WOMAC, IKDC, Oxford, PROMIS,
 * Lysholm/Tegner, Kujala ou VISA-P).
 *
 * 1) SANE-joelho (Single Assessment Numeric Evaluation) — pergunta única,
 *    0–100 (% de um joelho normal), preenchida pelo paciente. Mesmo modelo e
 *    mesma função de escore do SANE de ombro/cotovelo (`scoreSANE`, 'free').
 *    Ref.: Williams GN, Taylor DC, Gangel TJ, Uhorchak JM, Arciero RA.
 *    Comparison of the single assessment numeric evaluation method and the
 *    Lysholm score. Clin Orthop Relat Res. 2000;(373):184-92. PMID 10810476.
 *
 * 2) Testes de desempenho físico recomendados pela OARSI para OA de quadril e
 *    joelho, medidos pelo clínico (sem licença):
 *    Dobson F, Hinman RS, Roos EM, et al. OARSI recommended performance-based
 *    tests to assess physical function in people diagnosed with hip or knee
 *    osteoarthritis. Osteoarthritis Cartilage. 2013;21(8):1042-52. PMID 23680877.
 *    Conjunto mínimo OARSI: sentar-levantar 30 s, caminhada rápida 40 m (4×10 m)
 *    e teste de escada; complementares: Timed Up and Go. A amplitude de
 *    movimento (goniometria) é registrada junto como medida clínica objetiva.
 *
 * Módulo puro (sem I/O): usado pela API (validação/armazenamento) e pela web
 * (formulários, rótulos, direção de melhora).
 */
import { ClinicalGuardError } from '../errors';
import { scoreSANE, type ScoreResult } from './instruments';

// ---------------- SANE-joelho ----------------

/** Código persistido do SANE-joelho em registros manuais (regen_prom_responses.instrument). */
export const SANE_KNEE_CODE = 'SANE_JOELHO';

/** Texto da pergunta única do SANE-joelho, por idioma. */
export const SANE_KNEE_QUESTION = {
  'pt-BR': 'Em uma escala de 0 a 100, sendo 100 um joelho completamente normal, como você avalia seu joelho hoje?',
  es: 'En una escala de 0 a 100, donde 100 es una rodilla completamente normal, ¿cómo evalúa su rodilla hoy?'
} as const;

/** SANE-joelho: inteiro 0–100 (100 = joelho normal). Reutiliza `scoreSANE`. */
export function scoreSANEKnee(a: { value: number }): ScoreResult {
  return { ...scoreSANE(a), instrument: SANE_KNEE_CODE };
}

// ---------------- Testes de desempenho (OARSI) ----------------

export type KneePerformanceMeasure =
  | 'CHAIR_STAND_30S'
  | 'WALK_40M'
  | 'TUG'
  | 'STAIR_CLIMB'
  | 'KNEE_FLEXION'
  | 'KNEE_EXTENSION_DEFICIT';

/** 'lower' = valor menor é melhor; 'higher' = valor maior é melhor. */
export type ImprovementDirection = 'lower' | 'higher';
export type KneeSide = 'D' | 'E';

export interface KneePerformanceDef {
  code: KneePerformanceMeasure;
  /** Unidade do valor bruto armazenado. */
  unit: 'rep' | 's' | 'deg';
  min: number;
  max: number;
  integer: boolean;
  better: ImprovementDirection;
  /** Exige lado (D/E): medidas por joelho. */
  perSide: boolean;
  /** Recomendado no conjunto OARSI (Dobson 2013). */
  oarsi: boolean;
}

/** Distância total do teste de caminhada rápida (4 × 10 m). */
export const WALK_40M_DISTANCE_M = 40;
/** Faixa aceita para o número de degraus (contexto opcional do teste de escada). */
export const STAIR_STEPS_RANGE = [1, 100] as const;

export const KNEE_PERFORMANCE_MEASURES: readonly KneePerformanceDef[] = [
  { code: 'CHAIR_STAND_30S', unit: 'rep', min: 0, max: 60, integer: true, better: 'higher', perSide: false, oarsi: true },
  { code: 'WALK_40M', unit: 's', min: 5, max: 300, integer: false, better: 'lower', perSide: false, oarsi: true },
  { code: 'TUG', unit: 's', min: 1, max: 120, integer: false, better: 'lower', perSide: false, oarsi: true },
  { code: 'STAIR_CLIMB', unit: 's', min: 1, max: 300, integer: false, better: 'lower', perSide: false, oarsi: true },
  { code: 'KNEE_FLEXION', unit: 'deg', min: 0, max: 160, integer: false, better: 'higher', perSide: true, oarsi: false },
  { code: 'KNEE_EXTENSION_DEFICIT', unit: 'deg', min: -20, max: 60, integer: false, better: 'lower', perSide: true, oarsi: false }
];

export const KNEE_PERFORMANCE_BY_CODE: ReadonlyMap<string, KneePerformanceDef> = new Map(
  KNEE_PERFORMANCE_MEASURES.map((m) => [m.code, m])
);

export function isKneePerformanceMeasure(code: unknown): code is KneePerformanceMeasure {
  return typeof code === 'string' && KNEE_PERFORMANCE_BY_CODE.has(code);
}

/** Velocidade (m/s) derivada do tempo dos 40 m; 2 casas decimais. */
export function walkSpeedMps(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new ClinicalGuardError('OUT_OF_RANGE', 'Tempo dos 40 m deve ser positivo.', 'value');
  }
  return Math.round((WALK_40M_DISTANCE_M / seconds) * 100) / 100;
}

export interface KneePerformanceInput {
  measure: unknown;
  value: unknown;
  side?: unknown;
  /** Só para STAIR_CLIMB: número de degraus (opcional). */
  steps?: unknown;
}

export interface KneePerformanceRecord {
  measure: KneePerformanceMeasure;
  value: number;
  unit: KneePerformanceDef['unit'];
  side: KneeSide | null;
  details: { steps?: number; speed_mps?: number };
}

/**
 * Valida uma medida de desempenho e devolve o registro normalizado (valor bruto
 * + unidade + detalhes derivados). Lança ClinicalGuardError — sem clamp.
 */
export function validateKneePerformance(input: KneePerformanceInput): KneePerformanceRecord {
  if (!isKneePerformanceMeasure(input.measure)) {
    throw new ClinicalGuardError('UNKNOWN_MEASURE', `Medida desconhecida: ${String(input.measure)}.`, 'measure');
  }
  const def = KNEE_PERFORMANCE_BY_CODE.get(input.measure)!;
  const v = input.value;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new ClinicalGuardError('MISSING_ITEMS', 'Informe um valor numérico.', 'value');
  }
  if (def.integer && !Number.isInteger(v)) {
    throw new ClinicalGuardError('OUT_OF_RANGE', `"${def.code}" deve ser inteiro.`, 'value');
  }
  if (v < def.min || v > def.max) {
    throw new ClinicalGuardError('OUT_OF_RANGE', `"${def.code}" deve estar entre ${def.min} e ${def.max}.`, 'value');
  }
  let side: KneeSide | null = null;
  if (def.perSide) {
    if (input.side !== 'D' && input.side !== 'E') {
      throw new ClinicalGuardError('MISSING_ITEMS', 'Informe o lado (D ou E).', 'side');
    }
    side = input.side;
  } else if (input.side !== undefined && input.side !== null && input.side !== '') {
    throw new ClinicalGuardError('OUT_OF_RANGE', `"${def.code}" não é medido por lado.`, 'side');
  }
  const details: KneePerformanceRecord['details'] = {};
  if (def.code === 'STAIR_CLIMB' && input.steps !== undefined && input.steps !== null && input.steps !== '') {
    const s = input.steps;
    if (typeof s !== 'number' || !Number.isInteger(s) || s < STAIR_STEPS_RANGE[0] || s > STAIR_STEPS_RANGE[1]) {
      throw new ClinicalGuardError('OUT_OF_RANGE', `Degraus deve ser inteiro entre ${STAIR_STEPS_RANGE[0]} e ${STAIR_STEPS_RANGE[1]}.`, 'steps');
    }
    details.steps = s;
  } else if (def.code !== 'STAIR_CLIMB' && input.steps !== undefined && input.steps !== null && input.steps !== '') {
    throw new ClinicalGuardError('OUT_OF_RANGE', 'Degraus só se aplica ao teste de escada.', 'steps');
  }
  if (def.code === 'WALK_40M') details.speed_mps = walkSpeedMps(v);
  return { measure: def.code, value: v, unit: def.unit, side, details };
}

// ---------------- Direção de melhora ----------------

export type ChangeAssessment = 'better' | 'worse' | 'same';

/** Classifica a variação (último − basal) conforme a direção de melhora da medida. */
export function assessChange(better: ImprovementDirection, delta: number): ChangeAssessment {
  if (!Number.isFinite(delta) || delta === 0) return 'same';
  const improved = better === 'lower' ? delta < 0 : delta > 0;
  return improved ? 'better' : 'worse';
}
