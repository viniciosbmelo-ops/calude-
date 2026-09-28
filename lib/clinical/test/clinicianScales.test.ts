import { describe, test, expect } from 'vitest';
import { ClinicalGuardError } from '../src/errors';
import { scoreConstant, scoreRowe } from '../src/proms/instruments';
import {
  CLINICIAN_SCALE_ITEMS, applicableClinicianScales, constantMax, isClinicianScaleEnabled, promsDefaultFor,
  scoreClinicianScale, surgeryPathologyCodes
} from '../src/proms/clinicianScales';

const constantFull = {
  pain: 15, sleep: 2, work: 4, recreation: 4, hand_position: 'above_head',
  flexion_deg: 170, abduction_deg: 170,
  er_achieved: ['hand_behind_head_elbow_forward', 'hand_behind_head_elbow_back', 'hand_on_head_elbow_forward', 'hand_on_head_elbow_back', 'full_elevation_from_head'],
  ir_position: 'interscapular_T7'
};

describe('escalas do médico — habilitação', () => {
  test('só Constant e Rowe (free, clínico/misto); ASES/MEPS/SANE fora', () => {
    expect(isClinicianScaleEnabled('CONSTANT')).toBe(true);
    expect(isClinicianScaleEnabled('ROWE')).toBe(true);
    expect(isClinicianScaleEnabled('ASES')).toBe(false);
    expect(isClinicianScaleEnabled('MEPS')).toBe(false);
    expect(isClinicianScaleEnabled('SANE')).toBe(false);
    expect(isClinicianScaleEnabled('OSS')).toBe(false);
  });
});

describe('escalas aplicáveis pela patologia', () => {
  test('subtipo herda proms_default do parent', () => {
    expect(promsDefaultFor('SH_RCT_FULL')).toEqual(promsDefaultFor('SH_RCT'));
    expect(promsDefaultFor('SH_STIFF')).toEqual([]);
  });
  test('códigos gravados em dadosClinicos', () => {
    expect(applicableClinicianScales({ dadosClinicos: { procedimentos: [{ tipoCaso: 'SH_CUFF', codigo: 'SH_RCT_FULL' }] } })).toEqual(['CONSTANT']);
    expect(applicableClinicianScales({ dadosClinicos: { procedimentos: [{ tipoCaso: 'SH_INSTABILITY', codigo: 'SH_INST_ANT' }] } })).toEqual(['ROWE']);
    expect(applicableClinicianScales({ dadosClinicos: { geral: { postop_dx: ['SH_ARTHROPLASTY', 'SH_INST_ANT'] } } })).toEqual(['CONSTANT', 'ROWE']);
    expect(applicableClinicianScales({ dadosClinicos: { procedimentos: [{ tipoCaso: 'SH_BICEPS_SLAP', codigo: 'SH_BICEPS' }] } })).toEqual([]);
    expect(applicableClinicianScales({ dadosClinicos: { procedimentos: [{ tipoCaso: 'EL_DISTAL_BICEPS', codigo: 'EL_DBR' }] } })).toEqual([]);
  });
  test('códigos registrados têm precedência sobre o tipo de caso', () => {
    expect(applicableClinicianScales({ dadosClinicos: { procedimentos: [{ codigo: 'SH_BICEPS' }] }, tiposProcedimento: ['SH_CUFF'] })).toEqual([]);
  });
  test('só tipos de caso: patologia padrão do catálogo', () => {
    expect(surgeryPathologyCodes({ tiposProcedimento: ['SH_CUFF', 'SH_ARTHROPLASTY', 'X'] })).toEqual(['SH_RCT', 'SH_ARTHROPLASTY']);
    expect(applicableClinicianScales({ tiposProcedimento: ['SH_CUFF'] })).toEqual(['CONSTANT']);
    expect(applicableClinicianScales({ tiposProcedimento: ['SH_INSTABILITY'] })).toEqual(['ROWE']);
    expect(applicableClinicianScales({ tiposProcedimento: ['SH_OTHER'] })).toEqual([]);
    expect(applicableClinicianScales({ dadosClinicos: null, tiposProcedimento: null })).toEqual([]);
  });
});

describe('itens e escore', () => {
  test('itens derivados das constantes do escore', () => {
    const fields = CLINICIAN_SCALE_ITEMS.CONSTANT.map((i) => i.field);
    expect(fields).toEqual(['pain', 'sleep', 'work', 'recreation', 'hand_position', 'flexion_deg', 'abduction_deg', 'er_achieved', 'ir_position', 'strength_kg']);
    expect(CLINICIAN_SCALE_ITEMS.ROWE.map((i) => i.field)).toEqual(['stability', 'motion', 'function']);
    expect(constantMax(false)).toBe(75);
    expect(constantMax(true)).toBe(100);
  });
  test('Constant sem dinamômetro = mesmo resultado do pacote, sobre 75', () => {
    const { answers, result } = scoreClinicianScale('CONSTANT', { ...constantFull, strength_kg: null, extra: 'x' });
    expect(answers).not.toHaveProperty('extra');
    expect(answers).not.toHaveProperty('strength_kg');
    expect(result).toEqual(scoreConstant(constantFull as any));
    expect(result.score).toBe(75);
    expect(result.max).toBe(75);
  });
  test('Constant com dinamômetro, sobre 100', () => {
    const { result } = scoreClinicianScale('CONSTANT', { ...constantFull, strength_kg: 12 });
    expect(result.max).toBe(100);
    expect(result.score).toBe(100);
  });
  test('Rowe', () => {
    const { result } = scoreClinicianScale('ROWE', { stability: 'no_recurrence', motion: 'er_75', function: 'mild' });
    expect(result).toEqual(scoreRowe({ stability: 'no_recurrence', motion: 'er_75', function: 'mild' }));
    expect(result.score).toBe(90);
  });
  test('rejeições', () => {
    expect(() => scoreClinicianScale('ASES', { pain_vas: 0, adl: Array(10).fill(3) })).toThrow(ClinicalGuardError);
    expect(() => scoreClinicianScale('ROWE', { stability: 'constructor', motion: 'full', function: 'mild' })).toThrow(ClinicalGuardError);
    expect(() => scoreClinicianScale('CONSTANT', { ...constantFull, hand_position: 'toString' })).toThrow(ClinicalGuardError);
    expect(() => scoreClinicianScale('CONSTANT', { ...constantFull, pain: 16 })).toThrow(ClinicalGuardError);
    expect(() => scoreClinicianScale('CONSTANT', { ...constantFull, er_achieved: undefined })).toThrow(ClinicalGuardError);
    expect(() => scoreClinicianScale('ROWE', null)).toThrow(ClinicalGuardError);
  });
});
