import { describe, test, expect } from 'vitest';
import { ClinicalGuardError } from '../src/errors';
import { INSTRUMENTS, canSendToPatient, isInstrumentEnabled, scheduleTimepoints, scoreConstant, scoreRowe, scoreSANE } from '../src/proms/instruments';
import { PATHOLOGIES } from '../src/catalog/pathologies';
import * as clinical from '../src/index';

describe('SANE', () => {
  test('limites', () => {
    expect(scoreSANE({ value: 0 }).score).toBe(0);
    expect(scoreSANE({ value: 100 }).score).toBe(100);
    expect(() => scoreSANE({ value: 101 })).toThrow(ClinicalGuardError);
    expect(() => scoreSANE({ value: 50.5 })).toThrow(ClinicalGuardError);
  });
});

describe('Constant-Murley', () => {
  const full = { pain: 15, sleep: 2, work: 4, recreation: 4, hand_position: 'above_head' as const, flexion_deg: 170, abduction_deg: 170, er_achieved: ['hand_behind_head_elbow_forward', 'hand_behind_head_elbow_back', 'hand_on_head_elbow_forward', 'hand_on_head_elbow_back', 'full_elevation_from_head'] as any, ir_position: 'interscapular_T7' as const, strength_kg: 12 };
  test('máximo = 100 (12 kg ≥ 25 lb)', () => {
    const r = scoreConstant(full);
    expect(r.score).toBe(100);
    expect(r.subscores).toMatchObject({ pain: 15, adl: 20, rom: 40, strength: 25 });
  });
  test('força: 1 ponto por libra, arredondado para baixo', () => {
    expect(scoreConstant({ ...full, strength_kg: 5 }).subscores.strength).toBe(11); // 11,02 lb
    expect(scoreConstant({ ...full, strength_kg: 0 }).subscores.strength).toBe(0);
  });
  test('bandas de elevação', () => {
    const f = (deg: number) => scoreConstant({ ...full, flexion_deg: deg }).subscores.flexion;
    expect([f(30), f(31), f(60), f(90), f(120), f(150), f(151)]).toEqual([0, 2, 2, 4, 6, 8, 10]);
  });
  test('sem força: NÃO normaliza para 100', () => {
    const { strength_kg, ...noStrength } = full;
    const r = scoreConstant(noStrength);
    expect(r.max).toBe(75);
    expect(r.score).toBe(75);
    expect(r.flags).toContain('constant_no_strength');
    expect(r.version).toBe('constant-1987-no-strength');
  });
  test('mínimo', () => {
    const r = scoreConstant({ pain: 0, sleep: 0, work: 0, recreation: 0, hand_position: 'waist', flexion_deg: 0, abduction_deg: 0, er_achieved: [], ir_position: 'lateral_thigh', strength_kg: 0 });
    expect(r.score).toBe(2); // mão até a cintura = 2
  });
  test('entradas inválidas', () => {
    expect(() => scoreConstant({ ...full, hand_position: 'moon' as any })).toThrow(/hand_position/);
    expect(() => scoreConstant({ ...full, er_achieved: ['x'] as any })).toThrow(/RE inválida/);
    expect(() => scoreConstant({ ...full, er_achieved: undefined as any })).toThrow(/RE atingidas/);
    expect(() => scoreConstant({ ...full, flexion_deg: 200 })).toThrow(ClinicalGuardError);
    expect(() => scoreConstant({ ...full, strength_kg: 80 })).toThrow(ClinicalGuardError);
  });
  test('RE duplicada não conta duas vezes', () => {
    const r = scoreConstant({ ...full, er_achieved: ['hand_behind_head_elbow_forward', 'hand_behind_head_elbow_forward'] as any });
    expect(r.subscores.external_rotation).toBe(2);
  });
});

describe('Rowe', () => {
  test('100 e 0', () => {
    expect(scoreRowe({ stability: 'no_recurrence', motion: 'full', function: 'no_limitation' }).score).toBe(100);
    expect(scoreRowe({ stability: 'recurrent_dislocation', motion: 'no_er', function: 'marked' }).score).toBe(0);
  });
  test('inválido', () => expect(() => scoreRowe({ stability: 'x' as any, motion: 'full', function: 'mild' })).toThrow(/stability/));
});

describe('licenças e envio', () => {
  test('todo instrumento em INSTRUMENTS tem licença free', () => {
    expect(INSTRUMENTS.map((i) => i.code)).toEqual(['SANE', 'CONSTANT', 'ROWE']);
    for (const i of INSTRUMENTS) expect(i.license_status, i.code).toBe('free');
  });
  test('todo proms_default do catálogo existe em INSTRUMENTS e é free', () => {
    const byCode = new Map(INSTRUMENTS.map((i) => [i.code, i]));
    for (const p of PATHOLOGIES) {
      for (const code of p.proms_default ?? []) {
        expect(byCode.get(code)?.license_status, `${p.code} → ${code}`).toBe('free');
        expect(isInstrumentEnabled(code)).toBe(true);
      }
    }
  });
  test('escalas que exigem licença foram removidas (sem registro nem escore)', () => {
    for (const c of ['ASES', 'MEPS', 'OSS', 'OES', 'DASH', 'QUICKDASH', 'WOSI']) {
      expect(INSTRUMENTS.some((i) => i.code === c)).toBe(false);
      expect(isInstrumentEnabled(c)).toBe(false);
      expect(canSendToPatient(c)).toBe(false);
    }
    expect(clinical).not.toHaveProperty('scoreASES');
    expect(clinical).not.toHaveProperty('scoreMEPS');
    expect(isInstrumentEnabled('SANE')).toBe(true);
    expect(isInstrumentEnabled('NAO_EXISTE')).toBe(false);
  });
  test('instrumento misto/clínico nunca vai ao paciente', () => {
    expect(canSendToPatient('CONSTANT')).toBe(false);
    expect(canSendToPatient('ROWE')).toBe(false);
    expect(canSendToPatient('SANE')).toBe(true);
    expect(canSendToPatient('XYZ')).toBe(false);
  });
});

describe('timepoints', () => {
  test('datas a partir da cirurgia', () => {
    const t = scheduleTimepoints('2026-09-23');
    expect(t.map((x) => x.code)).toEqual(['6w', '3m', '6m', '12m', '24m']);
    expect(t[0]).toEqual({ code: '6w', due: '2026-11-04', window_start: '2026-10-21', window_end: '2026-11-18' });
    expect(t[3].due).toBe('2027-09-23');
  });
  test('data inválida', () => expect(() => scheduleTimepoints('23/09/2026')).toThrow(/YYYY-MM-DD/));
});
