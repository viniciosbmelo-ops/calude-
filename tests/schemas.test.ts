import * as fs from 'fs';
import * as path from 'path';
import { SchemaRegistry, validateAgainstSchema } from '../src/clinical/schemaRegistry';
import { PATHOLOGIES } from '../src/clinical/catalog/pathologies';
import labels from '../src/clinical/labels.pt.json';

const reg = new SchemaRegistry();
const fields = (r: ReturnType<SchemaRegistry['validate']>) => r.issues.map((i) => i.field);

describe('SchemaRegistry', () => {
  test('todos os schemas compilam', () => {
    expect(reg.ids()).toEqual([
      'CORE_SURGERY.v1', 'EL_DBR.intraop.v1', 'SH_AC_DISL.intraop.v1', 'SH_ARTHROPLASTY.intraop.v1',
      'SH_BICEPS.intraop.v1', 'SH_INST_ANT.diagnosis.v1', 'SH_INST_ANT.intraop.v1', 'SH_RCT.intraop.v1'
    ]);
  });
  test('toda patologia com intraop/diagnosis aponta para schema existente e template existente', () => {
    for (const p of PATHOLOGIES) {
      if (p.intraop) expect(reg.get(p.intraop)).toBeDefined();
      if (p.diagnosis) expect(reg.get(p.diagnosis)).toBeDefined();
      if (p.report_template) expect(fs.existsSync(path.join(__dirname, '../src/clinical/report/templates', `${p.report_template}.hbs`))).toBe(true);
    }
  });
  test('schema inexistente', () => {
    expect(reg.validate('XX.v9', {}).issues[0].field).toBe('(schema)');
  });
  test('registro duplicado é rejeitado', () => {
    expect(() => reg.register(reg.get('SH_RCT.intraop.v1')!)).toThrow(/duplicado/);
    expect(() => reg.register({})).toThrow(/sem \$id/);
  });
});

describe('SH_RCT.intraop.v1', () => {
  const ok = { tendons: ['SSP', 'ISP'], tear_type: 'full_thickness', size_ap_mm: 28, retraction_ml_mm: 22, patte: 2, tissue_quality: 'fair', mobility: 'reducible_with_tension', procedure: 'transosseous_equivalent_knotless', medial_row_anchors: 2, lateral_row_anchors: 2, suture_config: 'medial_knotless', repair_coverage: 'complete', repair_tension: 'acceptable' };
  test('válido', () => expect(reg.validate('SH_RCT.intraop.v1', ok).valid).toBe(true));
  test('rotura total sem tamanho → 422 em size_ap_mm', () => {
    const { size_ap_mm, ...d } = ok;
    const r = reg.validate('SH_RCT.intraop.v1', d);
    expect(r.valid).toBe(false);
    expect(fields(r)).toContain('size_ap_mm');
    expect(r.issues.find((i) => i.field === 'size_ap_mm')!.message_pt).toMatch(/obrigatório/);
  });
  test('SSC selecionado exige Lafosse', () => {
    expect(fields(reg.validate('SH_RCT.intraop.v1', { ...ok, tendons: ['SSC'] }))).toContain('lafosse_ssc');
    expect(reg.validate('SH_RCT.intraop.v1', { ...ok, tendons: ['SSC'], lafosse_ssc: 'III' }).valid).toBe(true);
  });
  test('parcial exige Ellman; não exige tamanho', () => {
    const d = { tendons: ['SSP'], tear_type: 'partial_articular', procedure: 'debridement_only' };
    expect(fields(reg.validate('SH_RCT.intraop.v1', d))).toEqual(['ellman_grade']);
    expect(reg.validate('SH_RCT.intraop.v1', { ...d, ellman_grade: 2 }).valid).toBe(true);
  });
  test('dupla fileira exige âncora lateral ≥1', () => {
    expect(fields(reg.validate('SH_RCT.intraop.v1', { ...ok, lateral_row_anchors: 0 }))).toContain('lateral_row_anchors');
  });
  test('SCR exige enxerto', () => {
    expect(fields(reg.validate('SH_RCT.intraop.v1', { ...ok, procedure: 'superior_capsular_reconstruction' }))).toContain('graft');
  });
  test('campo desconhecido e valores fora de faixa', () => {
    const r = reg.validate('SH_RCT.intraop.v1', { ...ok, foo: 1, size_ap_mm: 200, tendons: [] });
    expect(fields(r)).toEqual(expect.arrayContaining(['foo', 'size_ap_mm', 'tendons']));
    expect(r.issues.map((i) => i.message_pt).join(' ')).toMatch(/máximo|previsto|pelo menos/);
  });
  test('convergência de margens exige nº de pontos', () => {
    expect(fields(reg.validate('SH_RCT.intraop.v1', { ...ok, procedure: 'margin_convergence_plus_repair' }))).toContain('margin_convergence_sutures');
  });
});

describe('SH_INST_ANT', () => {
  test('Latarjet exige dados do enxerto', () => {
    const r = reg.validate('SH_INST_ANT.intraop.v1', { labral_lesion: ['bankart'], procedure: 'latarjet_open' });
    expect(fields(r)).toContain('coracoid_graft');
  });
  test('Latarjet completo válido', () => {
    const r = reg.validate('SH_INST_ANT.intraop.v1', { labral_lesion: ['bony_bankart'], procedure: 'latarjet_open', coracoid_graft: { fixation: 'two_screws', position_relative_to_glenoid: 'flush', subscap_approach: 'split', graft_length_mm: 22 } });
    expect(r.valid).toBe(true);
  });
  test('remplissage exige âncoras', () => {
    expect(fields(reg.validate('SH_INST_ANT.intraop.v1', { labral_lesion: ['bankart'], procedure: 'bankart_plus_remplissage' }))).toEqual(expect.arrayContaining(['remplissage', 'anchors_count']));
  });
  test('diagnóstico: TC disponível exige D e d', () => {
    expect(fields(reg.validate('SH_INST_ANT.diagnosis.v1', { event_type: 'dislocation', episodes: 'gt_5', ct_available: true }))).toEqual(expect.arrayContaining(['D_mm', 'd_mm']));
  });
  test('diagnóstico: D em cm é rejeitado no schema', () => {
    expect(fields(reg.validate('SH_INST_ANT.diagnosis.v1', { event_type: 'dislocation', episodes: 'first', D_mm: 2.8 }))).toContain('D_mm');
  });
});

describe('outros schemas', () => {
  test('AC: ressecção da clavícula distal não exige Rockwood', () => {
    expect(reg.validate('SH_AC_DISL.intraop.v1', { procedure: 'distal_clavicle_excision', resection_mm: 7 }).valid).toBe(true);
    expect(fields(reg.validate('SH_AC_DISL.intraop.v1', { procedure: 'cc_button_fixation', button_systems: 1 }))).toEqual(expect.arrayContaining(['rockwood', 'chronicity']));
  });
  test('prótese reversa exige parâmetros-chave', () => {
    const r = reg.validate('SH_ARTHROPLASTY.intraop.v1', { etiology: 'cuff_tear_arthropathy', prosthesis_type: 'reverse_tsa', approach: 'deltopectoral', subscapularis_management: 'peel' });
    expect(fields(r)).toEqual(expect.arrayContaining(['glenoid_component', 'glenosphere_diameter_mm', 'humeral_neck_shaft_deg', 'screws_count', 'executed_version_deg']));
  });
  test('bíceps distal parcial exige %', () => {
    expect(fields(reg.validate('EL_DBR.intraop.v1', { tear: 'partial', days_since_injury: 10, procedure: 'single_incision_repair', fixation: ['cortical_button'] }))).toEqual(['partial_pct']);
  });
  test('tenodese exige local e fixação', () => {
    expect(fields(reg.validate('SH_BICEPS.intraop.v1', { procedure: 'tenodesis' }))).toEqual(expect.arrayContaining(['tenodesis_site', 'tenodesis_fixation']));
  });
  test('core: dx precisa seguir padrão de código', () => {
    const r = reg.validate('CORE_SURGERY.v1', { surgery_date: '2026-09-23', side: 'R', positioning: 'beach_chair', anesthesia: { type: 'general' }, approach: ['arthroscopic'], preop_dx: ['lachman'], postop_dx: ['SH_RCT'] });
    expect(fields(r)).toContain('preop_dx.0');
  });
  test('core: data inválida', () => {
    const r = reg.validate('CORE_SURGERY.v1', { surgery_date: '23/09/2026', side: 'R', positioning: 'beach_chair', anesthesia: { type: 'general' }, approach: ['arthroscopic'], preop_dx: ['SH_RCT'], postop_dx: ['SH_RCT'] });
    expect(r.issues.find((i) => i.field === 'surgery_date')!.message_pt).toMatch(/Formato/);
  });
});

describe('rótulos PT-BR', () => {
  const selfLabeled = /^([IVX]+|[A-D][0-9]?|\d+(\.\d+)?)$/;
  function walk(s: any, field: string, out: [string, string][]) {
    if (!s || typeof s !== 'object') return;
    if (Array.isArray(s.enum) && field) for (const v of s.enum) out.push([field, String(v)]);
    if (s.properties) for (const [k, v] of Object.entries(s.properties)) walk(v, k, out);
    if (s.items) walk(s.items, field, out);
  }
  test('todo valor de enum tem rótulo (exceto códigos autoexplicativos)', () => {
    const L = labels as Record<string, Record<string, string>>;
    const missing: string[] = [];
    for (const id of reg.ids()) {
      const pairs: [string, string][] = [];
      walk(reg.get(id), '', pairs);
      for (const [f, v] of pairs) if (!selfLabeled.test(v) && !L[f]?.[v] && !L._default[v]) missing.push(`${id}:${f}.${v}`);
    }
    expect(missing).toEqual([]);
  });
});

describe('middleware Express', () => {
  const mw = validateAgainstSchema(reg, (req) => req.params.schema);
  const res = () => { const r: any = {}; r.status = jest.fn(() => r); r.json = jest.fn(() => r); return r; };
  test('422 quando inválido', () => {
    const r = res(); const next = jest.fn();
    mw({ params: { schema: 'SH_RCT.intraop.v1' }, body: { data: {} } }, r, next);
    expect(r.status).toHaveBeenCalledWith(422);
    expect(next).not.toHaveBeenCalled();
  });
  test('next quando válido', () => {
    const r = res(); const next = jest.fn();
    mw({ params: { schema: 'SH_BICEPS.intraop.v1' }, body: { data: { procedure: 'tenotomy' } } }, r, next);
    expect(next).toHaveBeenCalled();
  });
});
