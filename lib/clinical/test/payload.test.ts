import { describe, test, expect } from 'vitest';
import { SchemaRegistry } from '../src/schemaRegistry';
import { ReportEngine } from '../src/report/reportEngine';
import { CASE_TYPES, caseTypesFor } from '../src/catalog/caseTypes';
import { PATHOLOGY_BY_CODE } from '../src/catalog/pathologies';
import {
  ClinicalPayloadError, buildReportInput, coreFromSurgery, diagnosisText, parseClinicalPayload, validateClinicalPayload
} from '../src/surgery/payload';
import { coreRight, multiProcedure } from './fixtures';

const reg = new SchemaRegistry();
const cols = { dataCirurgia: '2026-09-23', lado: 'Direito', hospital: 'Hospital Exemplo' };
const { surgery_date: _d, side: _s, hospital: _h, ...geral } = coreRight;

const full = () => ({
  regiao: 'shoulder',
  geral: structuredClone(geral),
  procedimentos: [
    { tipoCaso: 'SH_CUFF', codigo: 'SH_RCT_FULL', dados: multiProcedure.procedures.find((p) => p.pathology_code === 'SH_RCT_FULL')!.data },
    { tipoCaso: 'SH_BICEPS_SLAP', codigo: 'SH_BICEPS', dados: multiProcedure.procedures.find((p) => p.pathology_code === 'SH_BICEPS')!.data },
    { tipoCaso: 'SH_AC', codigo: 'SH_AC_OA', dados: multiProcedure.procedures.find((p) => p.pathology_code === 'SH_AC_OA')!.data }
  ],
  mapaArtroscopico: multiProcedure.arthroscopic_map,
  implantes: [
    { categoria: 'anchor', fabricante: 'Fabricante A', modelo: 'Âncora all-suture', tamanho: '2,6 mm', lote: 'L123', quantidade: 2, localizacao: 'fileira medial' },
    { categoria: 'anchor', fabricante: 'Fabricante A', modelo: 'Âncora knotless PEEK', tamanho: '4,75 mm', lote: 'L456', quantidade: 2, localizacao: 'fileira lateral' },
    { categoria: 'anchor', fabricante: 'Fabricante B', modelo: 'Âncora tenodese', lote: 'L789', quantidade: 1 }
  ]
});

describe('tipos de caso', () => {
  test('todo código citado existe no catálogo e pertence à região', () => {
    for (const ct of CASE_TYPES) for (const c of ct.codes) expect(PATHOLOGY_BY_CODE.get(c)?.region).toBe(ct.region);
  });
  test('toda patologia do catálogo é alcançável por algum tipo de caso', () => {
    const covered = new Set(CASE_TYPES.flatMap((c) => c.codes));
    const missing = [...PATHOLOGY_BY_CODE.keys()].filter((c) => !covered.has(c));
    expect(missing).toEqual([]);
  });
  test('ombro e cotovelo têm conjuntos separados', () => {
    expect(caseTypesFor('shoulder').every((c) => c.region === 'shoulder')).toBe(true);
    expect(caseTypesFor('elbow').map((c) => c.key)).toContain('EL_DISTAL_BICEPS');
  });
});

describe('parseClinicalPayload (rascunho)', () => {
  test('aceita rascunho incompleto e remove data/lado/hospital do bloco geral sem alterar a entrada', () => {
    const entrada = { surgery_date: 'x', side: 'L', positioning: 'beach_chair' };
    const p = parseClinicalPayload({ regiao: 'shoulder', geral: entrada, procedimentos: [{ tipoCaso: 'SH_CUFF', codigo: 'SH_RCT', dados: {} }] });
    expect(p.geral).toEqual({ positioning: 'beach_chair' });
    expect(entrada).toEqual({ surgery_date: 'x', side: 'L', positioning: 'beach_chair' });
    expect(p.procedimentos[0]).toMatchObject({ sequencia: 1, codigo: 'SH_RCT' });
  });
  test('recusa patologia fora do tipo, região errada e forma inválida', () => {
    expect(() => parseClinicalPayload({ regiao: 'knee' })).toThrow(ClinicalPayloadError);
    expect(() => parseClinicalPayload({ regiao: 'shoulder', procedimentos: [{ tipoCaso: 'SH_CUFF', codigo: 'SH_BICEPS', dados: {} }] })).toThrow(/fora do tipo/);
    expect(() => parseClinicalPayload({ regiao: 'shoulder', procedimentos: [{ tipoCaso: 'EL_DISTAL_BICEPS', codigo: 'EL_DBR', dados: {} }] })).toThrow(/região/);
    expect(() => parseClinicalPayload({ regiao: 'shoulder', mapaArtroscopico: [{ structure_code: 'EL_RH', status: 'normal' }] })).toThrow(/Estrutura/);
    expect(() => parseClinicalPayload({ regiao: 'shoulder', implantes: [{ categoria: 'anchor', quantidade: 0 }] })).toThrow(/quantidade/);
  });
  test('procedimento sem schema guarda só a descrição', () => {
    const p = parseClinicalPayload({ regiao: 'shoulder', procedimentos: [{ tipoCaso: 'SH_FRACTURE', codigo: 'SH_FX_PROX_HUM', dados: { descricao: 'Osteossíntese com placa bloqueada.', lixo: 1 } }] });
    expect(p.procedimentos[0].dados).toEqual({ descricao: 'Osteossíntese com placa bloqueada.' });
    const o = parseClinicalPayload({ regiao: 'elbow', procedimentos: [{ tipoCaso: 'EL_ORTHOBIO', codigo: null, dados: { descricao: 'Infiltração de PRP.' } }] });
    expect(o.procedimentos[0].codigo).toBeNull();
    expect(() => parseClinicalPayload({ regiao: 'elbow', procedimentos: [{ tipoCaso: 'EL_ORTHOBIO', codigo: 'EL_OA', dados: {} }] })).toThrow(/não usa patologia/);
  });
});

describe('validateClinicalPayload (finalização)', () => {
  test('registro completo é válido', () => {
    expect(validateClinicalPayload(reg, parseClinicalPayload(full()), cols)).toEqual([]);
  });
  test('pendências agrupadas por escopo', () => {
    const f = full();
    delete (f.geral as any).positioning;
    f.procedimentos[0].dados = { tendons: ['SSC'] } as any;
    f.procedimentos.push({ tipoCaso: 'SH_STIFF', codigo: 'SH_STIFF', dados: {} } as any);
    const g = validateClinicalPayload(reg, parseClinicalPayload(f), { ...cols, lado: null });
    expect(g.map((x) => x.scope)).toEqual(['geral', 'procedimento 1: Rotura completa do manguito rotador', 'procedimento 4: Capsulite adesiva / rigidez do ombro']);
    expect(g[0].issues.map((i) => i.field)).toEqual(expect.arrayContaining(['side', 'positioning']));
    expect(g[1].issues.map((i) => i.field)).toEqual(expect.arrayContaining(['lafosse_ssc', 'tear_type', 'procedure']));
    expect(g[2].issues[0].message_pt).toMatch(/Descreva/);
  });
  test('sem procedimentos não finaliza', () => {
    const f = full();
    f.procedimentos = [];
    expect(validateClinicalPayload(reg, parseClinicalPayload(f), cols).map((x) => x.scope)).toContain('procedimentos');
  });
  test('cotovelo: rejeita via, portal e ângulo exclusivos do ombro', () => {
    const f = {
      regiao: 'elbow',
      geral: { ...structuredClone(geral), positioning: 'supine_arm_table', beach_chair_angle_deg: 60, approach: ['deltopectoral', 'anterior_elbow_single_incision'], portals: ['neviaser'], preop_dx: ['EL_DBR'], postop_dx: ['EL_DBR'] },
      procedimentos: [{ tipoCaso: 'EL_DISTAL_BICEPS', codigo: 'EL_DBR', dados: { tear: 'complete', days_since_injury: 3, procedure: 'single_incision_repair', fixation: ['cortical_button'] } }],
      mapaArtroscopico: [{ structure_code: 'EL_RH', status: 'normal' }]
    };
    const g = validateClinicalPayload(reg, parseClinicalPayload(f), cols);
    expect(g.map((x) => x.scope)).toEqual(['geral', 'inventário artroscópico']);
    expect(g[0].issues.map((i) => i.field)).toEqual(['approach', 'portals', 'beach_chair_angle_deg', 'portals']);
    // Relatório de registro já gravado: regras de região desligadas (compatibilidade)
    expect(validateClinicalPayload(reg, parseClinicalPayload(f), cols, { regionRules: false })).toEqual([]);
    // Registro coerente de bíceps distal aberto é válido
    const ok = { ...f, geral: { ...f.geral, approach: ['anterior_elbow_single_incision'], portals: undefined, beach_chair_angle_deg: undefined }, mapaArtroscopico: [] };
    expect(validateClinicalPayload(reg, parseClinicalPayload(ok), cols)).toEqual([]);
  });
  test('categoria do implante (ex.: botão cortical) é preservada', () => {
    const p = parseClinicalPayload({ regiao: 'elbow', implantes: [{ categoria: 'button', fabricante: 'Fab', modelo: 'Botão cortical', quantidade: 1 }] });
    expect(p.implantes[0].categoria).toBe('button');
    expect(parseClinicalPayload(JSON.parse(JSON.stringify(p))).implantes[0]).toEqual(p.implantes[0]);
  });
  test('núcleo usa data, lado e hospital das colunas da cirurgia', () => {
    expect(coreFromSurgery(parseClinicalPayload(full()), cols)).toMatchObject({ surgery_date: '2026-09-23', side: 'R', hospital: 'Hospital Exemplo' });
  });
});

describe('relatório a partir do payload', () => {
  const engine = new ReportEngine();
  const parties = { patient: multiProcedure.patient, surgeon: multiProcedure.surgeon };
  test('mesmo texto do motor aplicado ao fixture de referência', () => {
    const input = buildReportInput(parseClinicalPayload(full()), cols, parties, multiProcedure.postop_plan);
    expect(engine.generate(input).text).toBe(engine.generate(multiProcedure).text);
  });
  test('procedimento de descrição livre entra com título e texto do cirurgião', () => {
    const f = full();
    f.procedimentos.push({ tipoCaso: 'SH_ORTHOBIO', codigo: null, dados: { descricao: 'Aplicação de PRP no footprint.' } } as any);
    const { text, template_versions } = engine.generate(buildReportInput(parseClinicalPayload(f), cols, parties));
    expect(text).toContain('4. Ortobiológicos\nAplicação de PRP no footprint.');
    expect(Object.keys(template_versions)).toEqual(['SH_RCT_FULL', 'SH_BICEPS', 'SH_AC_OA']);
  });
  test('diagnóstico em texto', () => {
    expect(diagnosisText(['SH_RCT_FULL', 'SH_BICEPS'])).toBe('Rotura completa do manguito rotador, Lesão do cabo longo do bíceps');
  });
});
