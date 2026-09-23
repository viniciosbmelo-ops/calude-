import { ClinicalGuardError } from '../src/clinical/errors';
import { canSendToPatient, isInstrumentEnabled, scheduleTimepoints, scoreASES, scoreConstant, scoreMEPS, scoreRowe, scoreSANE } from '../src/clinical/proms/instruments';

describe('SANE', () => {
  test('limites', () => {
    expect(scoreSANE({ value: 0 }).score).toBe(0);
    expect(scoreSANE({ value: 100 }).score).toBe(100);
    expect(() => scoreSANE({ value: 101 })).toThrow(ClinicalGuardError);
    expect(() => scoreSANE({ value: 50.5 })).toThrow(ClinicalGuardError);
  });
});

describe('ASES (paciente)', () => {
  test('mínimo 0 e máximo 100', () => {
    expect(scoreASES({ pain_vas: 10, adl: Array(10).fill(0) }).score).toBe(0);
    expect(scoreASES({ pain_vas: 0, adl: Array(10).fill(3) }).score).toBe(100);
  });
  test('caso intermediário: dor 4, função soma 18 → 30 + 30 = 60', () => {
    const r = scoreASES({ pain_vas: 4, adl: [2, 2, 2, 2, 2, 2, 2, 2, 1, 1] });
    expect(r.subscores).toEqual({ pain: 30, function: 30 });
    expect(r.score).toBe(60);
  });
  test('item faltante ou fora de faixa', () => {
    expect(() => scoreASES({ pain_vas: 3, adl: Array(9).fill(3) })).toThrow(/10 itens/);
    expect(() => scoreASES({ pain_vas: 3, adl: [...Array(9).fill(3), 4] })).toThrow(/adl\[9\]/);
    expect(() => scoreASES({ pain_vas: 11, adl: Array(10).fill(3) })).toThrow(ClinicalGuardError);
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

describe('MEPS', () => {
  const allTasks = { can_comb_hair: true, can_feed: true, can_hygiene: true, can_shirt: true, can_shoes: true };
  test('máximo 100', () => expect(scoreMEPS({ pain: 'none', arc_deg: 130, stability: 'stable', ...allTasks }).score).toBe(100));
  test('bandas de arco: >100 = 20; 50–100 = 15; <50 = 5', () => {
    const m = (a: number) => scoreMEPS({ pain: 'none', arc_deg: a, stability: 'stable', ...allTasks }).subscores.motion;
    expect([m(101), m(100), m(50), m(49)]).toEqual([20, 15, 15, 5]);
  });
  test('mínimo 5', () => expect(scoreMEPS({ pain: 'severe', arc_deg: 10, stability: 'gross_instability', can_comb_hair: false, can_feed: false, can_hygiene: false, can_shirt: false, can_shoes: false }).score).toBe(5));
  test('item faltante', () => expect(() => scoreMEPS({ pain: 'none', arc_deg: 100, stability: 'stable', ...allTasks, can_shoes: undefined as any })).toThrow(/can_shoes/));
});

describe('Rowe', () => {
  test('100 e 0', () => {
    expect(scoreRowe({ stability: 'no_recurrence', motion: 'full', function: 'no_limitation' }).score).toBe(100);
    expect(scoreRowe({ stability: 'recurrent_dislocation', motion: 'no_er', function: 'marked' }).score).toBe(0);
  });
  test('inválido', () => expect(() => scoreRowe({ stability: 'x' as any, motion: 'full', function: 'mild' })).toThrow(/stability/));
});

describe('licenças e envio', () => {
  test('licenciados bloqueados', () => {
    for (const c of ['OSS', 'OES', 'DASH', 'QUICKDASH', 'WOSI']) expect(isInstrumentEnabled(c)).toBe(false);
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
