import { describe, test, expect } from 'vitest';
import { SchemaRegistry } from '../src/schemaRegistry';
import { ReportEngine } from '../src/report/reportEngine';
import { PATHOLOGY_BY_CODE } from '../src/catalog/pathologies';
import { diagnosisSchemaId } from '../src/catalog/caseTypes';
import { toIssues } from '../src/ajvMessages';
import {
  CLINICAL_PAYLOAD_VERSION, ClinicalPayloadError, PREOP_COMMON_SCHEMA, buildReportInput, parseClinicalPayload, preopFor, validateClinicalPayload
} from '../src/surgery/payload';
import { coreRight, multiProcedure } from './fixtures';

const reg = new SchemaRegistry();
const cols = { dataCirurgia: '2026-09-23', lado: 'Direito', hospital: 'Hospital Exemplo' };
const { surgery_date: _d, side: _s, hospital: _h, ...geral } = coreRight;
const dataOf = (code: string) => multiProcedure.procedures.find((p) => p.pathology_code === code)!.data;

/** Payload v1 como gravado antes do bloco pré-operatório. */
const v1 = () => ({
  versao: 1,
  regiao: 'shoulder',
  geral: structuredClone(geral),
  procedimentos: [
    { tipoCaso: 'SH_CUFF', codigo: 'SH_RCT_FULL', dados: dataOf('SH_RCT_FULL') },
    { tipoCaso: 'SH_BICEPS_SLAP', codigo: 'SH_BICEPS', dados: dataOf('SH_BICEPS') },
    { tipoCaso: 'SH_AC', codigo: 'SH_AC_OA', dados: dataOf('SH_AC_OA') }
  ],
  mapaArtroscopico: multiProcedure.arthroscopic_map,
  implantes: [{ categoria: 'anchor', fabricante: 'Fabricante A', modelo: 'Âncora all-suture', quantidade: 2 }]
});

const comum = { data_avaliacao: '2026-08-30', lado_dominante: 'R', tabagismo: 'ex_tabagista', diabetes: false, nivel_atividade: 'trabalhador_bracal' };
const rct = {
  inicio: 'agudo_sobre_cronico', semanas_desde_lesao: 10, tipo_rotura_rm: 'completa', tendoes_rm: ['SSP', 'ISP'], tamanho_ap_mm_rm: 28,
  retracao_patte_rm: 2, goutallier: { SSP: 2, ISP: 1, SSC: 0, TM: 0 }, tangent_sign: false, hamada: 2, distancia_acromioumeral_mm: 7.5,
  pseudoparalisia: false, er_lag_sign: false, belly_press_lift_off: false, tratamento_conservador_meses: 4, reparo_previo: false
};
const inst = { event_type: 'dislocation', gbl_metodo: 'ct_3d_en_face', gbl_pct_direto: 12.5, n_luxacoes: 4, meses_desde_primeiro_episodio: 18, bankart_previo_falhou: false };
const fx = {
  neer_partes: 3, fratura_luxacao: 'nenhuma', head_split: false, ao_ota: '11B1', desvio_tuberosidade_maior_mm: 8, desvio_diafisario_mm: 12,
  angulo_cervicodiafisario_graus: 115, extensao_metafisaria_posteromedial_mm: 4, dobradica_medial_desviada_mm: 3, cominuicao_calcar: true,
  asa: 2, independencia_previa: true, cognicao_preservada: true, fratura_exposta: false, lesao_neurovascular: false
};
const dbr = { data_lesao: '2026-09-10', tipo_rm: 'completa', retracao_cm_rm: 4, lacerto_integro_rm: false, hook_test: true, ocupacao_demanda: 'bracal', uso_anabolizantes: false };

/** v2: mesmo registro com avaliação pré-operatória. */
const v2 = () => ({
  ...v1(),
  versao: 2,
  avaliacaoPreop: {
    comum: structuredClone(comum),
    patologias: [
      { codigo: 'SH_RCT_FULL', schema: 'SH_RCT.diagnosis.v1', dados: structuredClone(rct) },
      { codigo: 'SH_INST_ANT', dados: structuredClone(inst) },
      { codigo: 'SH_FX_PROX_HUM', schema: 'SH_FX_PROX_HUM.diagnosis.v1', dados: structuredClone(fx) }
    ]
  }
});

const engine = new ReportEngine();
const parties = { patient: multiProcedure.patient, surgeon: multiProcedure.surgeon };

describe('catálogo: avaliação pré-operatória dos primeiros algoritmos', () => {
  test('instabilidade anterior, manguito (e subtipos), fratura do úmero proximal e bíceps distal têm schema de diagnóstico', () => {
    expect(diagnosisSchemaId('SH_INST_ANT')).toBe('SH_INST_ANT.diagnosis.v2');
    for (const c of ['SH_RCT', 'SH_RCT_FULL', 'SH_RCT_MASSIVE', 'SH_RCT_SUBSCAP', 'SH_RCT_REVISION']) expect(diagnosisSchemaId(c)).toBe('SH_RCT.diagnosis.v1');
    expect(diagnosisSchemaId('SH_FX_PROX_HUM')).toBe('SH_FX_PROX_HUM.diagnosis.v1');
    expect(diagnosisSchemaId('EL_DBR')).toBe('EL_DBR.diagnosis.v1');
    expect(diagnosisSchemaId('SH_STIFF')).toBeNull();
    for (const p of PATHOLOGY_BY_CODE.values()) if (p.diagnosis) expect(reg.get(p.diagnosis)).toBeDefined();
  });
  test('schemas pré-operatórios não têm campos obrigatórios (tudo opcional)', () => {
    for (const id of [PREOP_COMMON_SCHEMA, 'SH_INST_ANT.diagnosis.v2', 'SH_RCT.diagnosis.v1', 'SH_FX_PROX_HUM.diagnosis.v1', 'EL_DBR.diagnosis.v1']) {
      expect(reg.validate(id, {})).toEqual({ valid: true, issues: [] });
      expect((reg.get(id) as any).required).toBeUndefined();
    }
  });
  test('SH_INST_ANT.diagnosis.v2 é superconjunto da v1', () => {
    const p1 = Object.keys((reg.get('SH_INST_ANT.diagnosis.v1') as any).properties);
    const p2 = Object.keys((reg.get('SH_INST_ANT.diagnosis.v2') as any).properties);
    expect(p2).toEqual(expect.arrayContaining(p1));
  });
  test('classificações com os valores canônicos', () => {
    const prop = (id: string, ...path: string[]) => path.reduce((s: any, k) => s.properties[k], reg.get(id));
    expect(prop('SH_RCT.diagnosis.v1', 'goutallier', 'SSP').enum).toEqual([0, 1, 2, 3, 4]);
    expect(Object.keys(prop('SH_RCT.diagnosis.v1', 'goutallier').properties)).toEqual(['SSP', 'ISP', 'SSC', 'TM']);
    expect(prop('SH_RCT.diagnosis.v1', 'hamada').enum).toEqual([1, 2, 3, 4, 5]);
    expect(prop('SH_RCT.diagnosis.v1', 'retracao_patte_rm').enum).toEqual([1, 2, 3]);
    expect(prop('SH_FX_PROX_HUM.diagnosis.v1', 'neer_partes').enum).toEqual([1, 2, 3, 4]);
    expect(prop(PREOP_COMMON_SCHEMA, 'nivel_atividade').enum).toEqual(['sedentario', 'recreativo', 'competitivo', 'trabalhador_bracal']);
  });
});

describe('payload v1 continua válido', () => {
  test('parse, finalização e relatório sem alteração', () => {
    const p = parseClinicalPayload(v1());
    expect(p.versao).toBe(CLINICAL_PAYLOAD_VERSION);
    expect('avaliacaoPreop' in p).toBe(false);
    expect(validateClinicalPayload(reg, p, cols)).toEqual([]);
    const text = engine.generate(buildReportInput(p, cols, parties)).text;
    const semVersao = parseClinicalPayload({ ...v1(), versao: undefined });
    expect(engine.generate(buildReportInput(semVersao, cols, parties)).text).toBe(text);
  });
  test('bloco vazio é omitido (payload igual ao v1)', () => {
    const base = parseClinicalPayload(v1());
    expect(parseClinicalPayload({ ...v1(), avaliacaoPreop: null })).toEqual(base);
    expect(parseClinicalPayload({ ...v1(), avaliacaoPreop: {} })).toEqual(base);
    expect(parseClinicalPayload({ ...v1(), avaliacaoPreop: { comum: {}, patologias: [] } })).toEqual(base);
  });
  test('versão desconhecida é recusada', () => {
    expect(() => parseClinicalPayload({ ...v1(), versao: 3 })).toThrow(/Versão/);
  });
});

describe('payload v2 com avaliação pré-operatória', () => {
  test('ida e volta: parse → JSON → parse preserva o bloco e preenche o schema', () => {
    const p = parseClinicalPayload(v2());
    expect(p.versao).toBe(2);
    expect(p.avaliacaoPreop!.comum).toEqual(comum);
    expect(p.avaliacaoPreop!.patologias.map((e) => [e.codigo, e.schema])).toEqual([
      ['SH_RCT_FULL', 'SH_RCT.diagnosis.v1'], ['SH_INST_ANT', 'SH_INST_ANT.diagnosis.v2'], ['SH_FX_PROX_HUM', 'SH_FX_PROX_HUM.diagnosis.v1']
    ]);
    expect(parseClinicalPayload(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(validateClinicalPayload(reg, p, cols)).toEqual([]);
  });
  test('não altera o objeto recebido', () => {
    const raw = v2();
    const copy = structuredClone(raw);
    const p = parseClinicalPayload(raw);
    p.avaliacaoPreop!.comum.diabetes = true;
    p.avaliacaoPreop!.patologias[0].dados.hamada = 5;
    expect(raw).toEqual(copy);
  });
  test('cotovelo: bíceps distal', () => {
    const p = parseClinicalPayload({
      regiao: 'elbow', procedimentos: [{ tipoCaso: 'EL_DISTAL_BICEPS', codigo: 'EL_DBR', dados: {} }],
      avaliacaoPreop: { patologias: [{ codigo: 'EL_DBR', dados: dbr }] }
    });
    expect(p.avaliacaoPreop).toEqual({ comum: {}, patologias: [{ codigo: 'EL_DBR', schema: 'EL_DBR.diagnosis.v1', dados: dbr }] });
    expect(validateClinicalPayload(reg, p, cols).map((g) => g.scope)).not.toContain(expect.stringMatching(/pré-operatória/));
  });
  test('relatório cirúrgico não inclui a avaliação pré-operatória', () => {
    const withPreop = engine.generate(buildReportInput(parseClinicalPayload(v2()), cols, parties)).text;
    const without = engine.generate(buildReportInput(parseClinicalPayload(v1()), cols, parties)).text;
    expect(withPreop).toBe(without);
  });
  test('preopFor encontra o sub-bloco pelo schema do código (subtipos do manguito compartilham)', () => {
    const p = parseClinicalPayload(v2());
    expect(preopFor(p, 'SH_RCT_MASSIVE')?.dados.hamada).toBe(2);
    expect(preopFor(p, 'SH_STIFF')).toBeUndefined();
    expect(preopFor(parseClinicalPayload(v1()), 'SH_RCT_FULL')).toBeUndefined();
  });
  test('forma: patologia sem schema, região errada, schema divergente, repetição e tipos', () => {
    const withBlocks = (patologias: unknown, extra: Record<string, unknown> = {}) => ({ ...v1(), avaliacaoPreop: { patologias, ...extra } });
    expect(() => parseClinicalPayload({ ...v1(), avaliacaoPreop: [] })).toThrow(ClinicalPayloadError);
    expect(() => parseClinicalPayload(withBlocks([], { comum: 'x' }))).toThrow(/comum/);
    expect(() => parseClinicalPayload(withBlocks({}))).toThrow(/lista/);
    expect(() => parseClinicalPayload(withBlocks([{ codigo: 'SH_STIFF', dados: {} }]))).toThrow(/não tem avaliação/);
    expect(() => parseClinicalPayload(withBlocks([{ codigo: 'EL_DBR', dados: {} }]))).toThrow(/região/);
    expect(() => parseClinicalPayload(withBlocks([{ codigo: 'XX', dados: {} }]))).toThrow(/região/);
    expect(() => parseClinicalPayload(withBlocks([{ codigo: 'SH_INST_ANT', schema: 'SH_INST_ANT.diagnosis.v1', dados: {} }]))).toThrow(/schema deve ser SH_INST_ANT.diagnosis.v2/);
    expect(() => parseClinicalPayload(withBlocks([{ codigo: 'SH_RCT', dados: {} }, { codigo: 'SH_RCT_FULL', dados: {} }]))).toThrow(/repetida/);
    expect(() => parseClinicalPayload(withBlocks([{ codigo: 'SH_RCT', dados: [] }]))).toThrow(/objeto/);
    expect(() => parseClinicalPayload(withBlocks(Array.from({ length: 11 }, () => ({ codigo: 'SH_RCT', dados: {} }))))).toThrow(/até 10/);
  });
});

describe('validação de tipo e faixa na finalização', () => {
  const issuesOf = (patch: (p: ReturnType<typeof v2>) => void) => {
    const raw = v2();
    patch(raw);
    return validateClinicalPayload(reg, parseClinicalPayload(raw), cols);
  };
  const fields = (groups: ReturnType<typeof issuesOf>, scope: string) => groups.find((g) => g.scope === scope)?.issues.map((i) => i.field) ?? [];

  test('campos comuns: data, enum, booleano e campo desconhecido', () => {
    const g = issuesOf((p) => { Object.assign(p.avaliacaoPreop.comum, { data_avaliacao: '2026-13-40', nivel_atividade: 'atleta_elite', diabetes: 'sim', peso: 80 }); });
    expect(g.map((x) => x.scope)).toEqual(['avaliação pré-operatória']);
    expect(fields(g, 'avaliação pré-operatória')).toEqual(expect.arrayContaining(['data_avaliacao', 'nivel_atividade', 'diabetes', 'peso']));
  });
  test('percentual 0–100, mm ≥ 0, inteiros e classificações fora da faixa', () => {
    const g = issuesOf((p) => {
      Object.assign(p.avaliacaoPreop.patologias[0].dados, { tamanho_ap_mm_rm: -1, hamada: 6, retracao_patte_rm: 4, goutallier: { SSP: 5, XX: 1 }, tratamento_conservador_meses: -2 });
      Object.assign(p.avaliacaoPreop.patologias[1].dados, { gbl_pct_direto: 100.1, n_luxacoes: 2.5, meses_desde_primeiro_episodio: -1, gbl_metodo: 'rx' });
      Object.assign(p.avaliacaoPreop.patologias[2].dados, { neer_partes: 5, desvio_tuberosidade_maior_mm: -0.5, impressao_cabeca_pct: 120, ao_ota: '12A1' });
    });
    expect(g.map((x) => x.scope)).toEqual([
      'avaliação pré-operatória: Rotura completa do manguito rotador',
      'avaliação pré-operatória: Instabilidade glenoumeral anterior',
      'avaliação pré-operatória: Fratura do úmero proximal'
    ]);
    expect(fields(g, g[0].scope)).toEqual(expect.arrayContaining(['tamanho_ap_mm_rm', 'hamada', 'retracao_patte_rm', 'goutallier.SSP', 'goutallier.XX', 'tratamento_conservador_meses']));
    expect(fields(g, g[1].scope)).toEqual(expect.arrayContaining(['gbl_pct_direto', 'n_luxacoes', 'meses_desde_primeiro_episodio', 'gbl_metodo']));
    expect(fields(g, g[2].scope)).toEqual(expect.arrayContaining(['neer_partes', 'desvio_tuberosidade_maior_mm', 'impressao_cabeca_pct', 'ao_ota']));
  });
  test('limites exatos aceitos (0 e 100%, 0 mm)', () => {
    const g = issuesOf((p) => {
      Object.assign(p.avaliacaoPreop.patologias[1].dados, { gbl_pct_direto: 100, n_luxacoes: 0 });
      Object.assign(p.avaliacaoPreop.patologias[2].dados, { desvio_tuberosidade_maior_mm: 0, impressao_cabeca_pct: 0 });
    });
    expect(g).toEqual([]);
  });
  test('bíceps distal: percentual e retração', () => {
    const p = parseClinicalPayload({
      regiao: 'elbow', procedimentos: [{ tipoCaso: 'EL_DISTAL_BICEPS', codigo: 'EL_DBR', dados: {} }],
      avaliacaoPreop: { patologias: [{ codigo: 'EL_DBR', dados: { partial_pct_rm: 150, retracao_cm_rm: -1, hook_test: 'positivo' } }] }
    });
    const g = validateClinicalPayload(reg, p, cols).find((x) => x.scope === 'avaliação pré-operatória: Rotura do tendão distal do bíceps');
    expect(g?.issues.map((i) => i.field)).toEqual(expect.arrayContaining(['partial_pct_rm', 'retracao_cm_rm', 'hook_test']));
  });
  test('validador pré-compilado (navegador) dá o mesmo resultado que o do servidor', async () => {
    const { validators } = await import('../src/generated/validators.js');
    const samples: [string, unknown][] = [
      [PREOP_COMMON_SCHEMA, { data_avaliacao: 'x', lado_dominante: 'ambidestro' }],
      ['SH_RCT.diagnosis.v1', { goutallier: { SSP: 9 }, hamada: 0 }],
      ['SH_INST_ANT.diagnosis.v2', { gbl_pct_direto: -3, n_luxacoes: 1.5 }],
      ['SH_FX_PROX_HUM.diagnosis.v1', fx],
      ['EL_DBR.diagnosis.v1', { partial_pct_rm: 101 }]
    ];
    for (const [id, data] of samples) {
      const v = validators[id];
      expect(v(data) ? [] : toIssues(v.errors)).toEqual(reg.validate(id, data).issues);
    }
  });
});
