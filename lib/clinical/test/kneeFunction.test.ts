import { describe, test, expect } from 'vitest';
import { ClinicalGuardError } from '../src/errors';
import {
  KNEE_PERFORMANCE_MEASURES,
  SANE_KNEE_CODE,
  SANE_KNEE_QUESTION,
  assessChange,
  scoreSANEKnee,
  validateKneePerformance,
  walkSpeedMps
} from '../src/proms/kneeFunction';

describe('SANE-joelho', () => {
  test('reusa o SANE: inteiro 0–100', () => {
    expect(scoreSANEKnee({ value: 0 })).toMatchObject({ instrument: SANE_KNEE_CODE, score: 0, max: 100 });
    expect(scoreSANEKnee({ value: 100 }).score).toBe(100);
    expect(() => scoreSANEKnee({ value: 101 })).toThrow(ClinicalGuardError);
    expect(() => scoreSANEKnee({ value: -1 })).toThrow(ClinicalGuardError);
    expect(() => scoreSANEKnee({ value: 70.5 })).toThrow(ClinicalGuardError);
  });
  test('pergunta em pt-BR e es cita o joelho/rodilla normal', () => {
    expect(SANE_KNEE_QUESTION['pt-BR']).toContain('100 um joelho completamente normal');
    expect(SANE_KNEE_QUESTION.es).toContain('rodilla completamente normal');
  });
});

describe('Testes de desempenho OARSI', () => {
  test('faixas, unidades e direção por medida', () => {
    const summary = Object.fromEntries(KNEE_PERFORMANCE_MEASURES.map((m) => [m.code, [m.unit, m.min, m.max, m.better, m.perSide]]));
    expect(summary).toEqual({
      CHAIR_STAND_30S: ['rep', 0, 60, 'higher', false],
      WALK_40M: ['s', 5, 300, 'lower', false],
      TUG: ['s', 1, 120, 'lower', false],
      STAIR_CLIMB: ['s', 1, 300, 'lower', false],
      KNEE_FLEXION: ['deg', 0, 160, 'higher', true],
      KNEE_EXTENSION_DEFICIT: ['deg', -20, 60, 'lower', true]
    });
  });

  test('sentar-levantar exige inteiro 0–60', () => {
    expect(validateKneePerformance({ measure: 'CHAIR_STAND_30S', value: 12 })).toEqual({
      measure: 'CHAIR_STAND_30S', value: 12, unit: 'rep', side: null, details: {}
    });
    expect(() => validateKneePerformance({ measure: 'CHAIR_STAND_30S', value: 12.5 })).toThrow(ClinicalGuardError);
    expect(() => validateKneePerformance({ measure: 'CHAIR_STAND_30S', value: 61 })).toThrow(/entre 0 e 60/);
  });

  test('40 m deriva velocidade (m/s)', () => {
    expect(walkSpeedMps(32)).toBe(1.25);
    expect(validateKneePerformance({ measure: 'WALK_40M', value: 25 }).details).toEqual({ speed_mps: 1.6 });
    expect(() => validateKneePerformance({ measure: 'WALK_40M', value: 4.9 })).toThrow(ClinicalGuardError);
    expect(() => walkSpeedMps(0)).toThrow(ClinicalGuardError);
  });

  test('TUG 1–120 s', () => {
    expect(validateKneePerformance({ measure: 'TUG', value: 9.4 }).value).toBe(9.4);
    expect(() => validateKneePerformance({ measure: 'TUG', value: 0.5 })).toThrow(ClinicalGuardError);
    expect(() => validateKneePerformance({ measure: 'TUG', value: 121 })).toThrow(ClinicalGuardError);
  });

  test('escada aceita degraus opcionais (inteiro 1–100) e só nela', () => {
    expect(validateKneePerformance({ measure: 'STAIR_CLIMB', value: 14.2, steps: 11 }).details).toEqual({ steps: 11 });
    expect(validateKneePerformance({ measure: 'STAIR_CLIMB', value: 14.2 }).details).toEqual({});
    expect(() => validateKneePerformance({ measure: 'STAIR_CLIMB', value: 14.2, steps: 0 })).toThrow(/Degraus/);
    expect(() => validateKneePerformance({ measure: 'TUG', value: 10, steps: 9 })).toThrow(/escada/);
  });

  test('ADM exige lado e respeita faixas', () => {
    expect(validateKneePerformance({ measure: 'KNEE_FLEXION', value: 115, side: 'D' })).toMatchObject({ unit: 'deg', side: 'D' });
    expect(() => validateKneePerformance({ measure: 'KNEE_FLEXION', value: 115 })).toThrow(/lado/);
    expect(() => validateKneePerformance({ measure: 'KNEE_FLEXION', value: 161, side: 'E' })).toThrow(ClinicalGuardError);
    expect(validateKneePerformance({ measure: 'KNEE_EXTENSION_DEFICIT', value: -5, side: 'E' }).value).toBe(-5);
    expect(() => validateKneePerformance({ measure: 'KNEE_EXTENSION_DEFICIT', value: -21, side: 'E' })).toThrow(ClinicalGuardError);
    expect(() => validateKneePerformance({ measure: 'TUG', value: 10, side: 'D' })).toThrow(/lado/);
  });

  test('medida desconhecida ou valor ausente', () => {
    expect(() => validateKneePerformance({ measure: 'KOOS', value: 50 })).toThrow(/desconhecida/);
    expect(() => validateKneePerformance({ measure: 'TUG', value: '10' })).toThrow(ClinicalGuardError);
    expect(() => validateKneePerformance({ measure: 'TUG', value: Number.NaN })).toThrow(ClinicalGuardError);
  });
});

describe('Direção de melhora', () => {
  test('menor é melhor (TUG, 40 m, escada, déficit de extensão)', () => {
    expect(assessChange('lower', -2)).toBe('better');
    expect(assessChange('lower', 3)).toBe('worse');
  });
  test('maior é melhor (sentar-levantar, flexão, SANE)', () => {
    expect(assessChange('higher', 4)).toBe('better');
    expect(assessChange('higher', -4)).toBe('worse');
    expect(assessChange('higher', 0)).toBe('same');
  });
});
