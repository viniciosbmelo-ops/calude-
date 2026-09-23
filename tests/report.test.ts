import { createHash } from 'crypto';
import { ReportEngine, enumLabel, listPt, normalize, reportHash } from '../src/clinical/report/reportEngine';
import { coreRight, multiProcedure } from './fixtures';

const engine = new ReportEngine();

describe('ReportEngine — determinismo', () => {
  test('100 gerações idênticas (hash)', () => {
    const hashes = new Set<string>();
    for (let i = 0; i < 100; i++) hashes.add(createHash('sha256').update(engine.generate(multiProcedure).text).digest('hex'));
    expect(hashes.size).toBe(1);
  });
  test('ordem de entrada de procedimentos/mapa não altera saída', () => {
    const shuffled = { ...multiProcedure, procedures: [...multiProcedure.procedures].reverse(), arthroscopic_map: [...multiProcedure.arthroscopic_map!].reverse() };
    expect(engine.generate(shuffled).text).toBe(engine.generate(multiProcedure).text);
  });
  test('não chama relógio do sistema', () => {
    const spy = jest.spyOn(Date, 'now');
    engine.generate(multiProcedure);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('ReportEngine — conteúdo', () => {
  const { text, template_versions } = engine.generate(multiProcedure);

  test('snapshot completo', () => {
    expect(text).toMatchSnapshot();
  });
  test('cabeçalho', () => {
    expect(text).toContain('Data: 23/09/2026 — Hospital Exemplo');
    expect(text).toContain('Lado: direito');
    expect(text).toContain('Cirurgião: Dr. Vinicios Barreto Melo (CRM 13416-ES)');
    expect(text).toContain('Diagnóstico pós-operatório: Rotura completa do manguito rotador, Lesão do cabo longo do bíceps e Artrose acromioclavicular');
    expect(text).toContain('Tempo cirúrgico: 85 min');
    expect(text).toContain('Anestesia geral associada a bloqueio interescalênico, hipotensão controlada (PAM alvo 65 mmHg). Paciente posicionado em cadeira de praia a 70°.');
  });
  test('manguito', () => {
    expect(text).toContain('Identificada rotura de espessura total do supraespinal e infraespinal, medindo 28 mm no sentido anteroposterior e 22 mm de retração (Patte 2), com configuração em "L".');
    expect(text).toContain('Reparo em equivalente transósseo sem nós com 2 âncoras na fileira medial e 2 na fileira lateral, sem nós mediais.');
    expect(text).toContain('Convergência de margens com 2 pontos.');
  });
  test('procedimentos numerados na ordem de sequence', () => {
    const i1 = text.indexOf('1. Rotura completa do manguito rotador');
    const i2 = text.indexOf('2. Lesão do cabo longo do bíceps');
    const i3 = text.indexOf('3. Artrose acromioclavicular');
    expect(i1).toBeGreaterThan(0);
    expect(i2).toBeGreaterThan(i1);
    expect(i3).toBeGreaterThan(i2);
  });
  test('AC artrose sem frase de luxação; decimal com vírgula', () => {
    expect(text).not.toContain('Luxação acromioclavicular');
    expect(text).toContain('Procedimento realizado: ressecção da extremidade distal da clavícula (7,5 mm).');
  });
  test('mapa artroscópico: lesões, normais agrupados e não avaliados', () => {
    expect(text).toContain('- Cabo longo do bíceps intra-articular: lesão tratada — tendinopatia com rotura parcial de 40%.');
    expect(text).toContain('Sem alterações: cartilagem da cabeça umeral e cartilagem glenoidal.');
    expect(text).toContain('Não avaliados: labrum posterior.');
  });
  test('implantes e rodapé', () => {
    expect(text).toContain('- 2× Fabricante A Âncora all-suture (2,6 mm) — lote L123 — fileira medial');
    expect(text).toContain('Sem intercorrências.');
    expect(text).toContain('Tipoia com almofada de abdução de 15°.');
    expect(text).toContain('CONDUTA PÓS-OPERATÓRIA\nProtocolo de reparo do manguito rotador (padrão).');
  });
  test('template_versions', () => {
    expect(template_versions).toEqual({ SH_RCT_FULL: 1, SH_BICEPS: 1, SH_AC_OA: 1 });
  });
  test('sem espaços duplos nem espaço antes de pontuação', () => {
    expect(text).not.toMatch(/ {2}/);
    expect(text).not.toMatch(/ [.,;]/);
    expect(text).not.toMatch(/\n{3}/);
  });
});

describe('Instabilidade — espelhamento do relógio', () => {
  const inst = (side: 'R' | 'L') => ({
    region: 'shoulder' as const,
    patient: { name: 'P' },
    surgeon: { name: 'S' },
    core: { ...coreRight, side, preop_dx: ['SH_INST_ANT'], postop_dx: ['SH_INST_ANT'] },
    procedures: [{ pathology_code: 'SH_INST_ANT', sequence: 1, schema_version: 1, data: { labral_lesion: ['bankart', 'alpsa'], labral_extent_clock: { from_h: 2, to_h: 6 }, procedure: 'bankart_plus_remplissage', anchors_count: 3, anchor_positions_clock: [5.5, 4, 3], capsular_plication: true, remplissage: { anchors: 2, technique: 'double_pulley' }, hill_sachs_engaging_dynamic: 'engaging' } }]
  });
  test('ombro direito', () => {
    const t = engine.generate(inst('R')).text;
    expect(t).toContain('Identificada(s) lesão de Bankart e lesão ALPSA, estendendo-se da posição de 2h à de 6h.');
    expect(t).toContain('com 3 âncoras nas posições 5,5h, 4h e 3h, com plicatura capsular.');
    expect(t).toContain('Remplissage com 2 âncoras, técnica em duplo polia.');
    expect(t).toContain('Lesão de Hill-Sachs com engajamento ao teste dinâmico.');
  });
  test('ombro esquerdo espelha (h → 12 − h)', () => {
    const t = engine.generate(inst('L')).text;
    expect(t).toContain('da posição de 10h à de 6h');
    expect(t).toContain('nas posições 6,5h, 8h e 9h');
  });
  test('Latarjet', () => {
    const d = inst('R');
    d.procedures[0].data = { labral_lesion: ['bony_bankart'], procedure: 'latarjet_open', coracoid_graft: { graft_length_mm: 22, fixation: 'two_screws', screw_size_mm: '3,5', subscap_approach: 'split', position_relative_to_glenoid: 'flush', height_clock: '3h–5h', bankart_capsule_repair_to_stump: true } } as any;
    const t = engine.generate(d).text;
    expect(t).toContain('Enxerto do processo coracoide de 22 mm, acesso por divulsão do subescapular, posicionado nivelado à superfície glenoidal entre 3h–5h e fixado com dois parafusos (3,5 mm).');
  });
});

describe('Outros templates', () => {
  const one = (code: string, data: any, core: any = {}) =>
    engine.generate({ region: code.startsWith('EL') ? 'elbow' : 'shoulder', patient: { name: 'P' }, surgeon: { name: 'S' }, core: { ...coreRight, ...core, preop_dx: [code], postop_dx: [code] }, procedures: [{ pathology_code: code, sequence: 1, schema_version: 1, data }] }).text;

  test('luxação AC com % de aumento CC', () => {
    const t = one('SH_AC_DISL', { rockwood: 'V', chronicity: 'acute', cc_distance_injured_mm: 22, cc_distance_contralateral_mm: 10, procedure: 'cc_plus_ac_cerclage', button_systems: 2, clavicle_tunnels: 2 });
    expect(t).toContain('Luxação acromioclavicular aguda, tipo V de Rockwood. Distância coracoclavicular de 22 mm (contralateral 10 mm; aumento de 120%).');
    expect(t).toContain('com 2 sistemas de botões e 2 túneis claviculares.');
  });
  test('prótese reversa: planejado vs executado', () => {
    const t = one('SH_ARTHROPLASTY', { etiology: 'cuff_tear_arthropathy', hamada: 4, prosthesis_type: 'reverse_tsa', approach: 'deltopectoral', subscapularis_management: 'peel', subscapularis_repaired: true, planning_source: '3d_software', glenoid_component: 'baseplate_standard', baseplate_diameter_mm: 25, screws_count: 4, planned_version_deg: -5, executed_version_deg: -3, planned_inclination_deg: 0, executed_inclination_deg: 0, glenosphere_diameter_mm: 36, glenosphere_lateralization_mm: 4, humeral_design: 'short_stem', humeral_fixation: 'press_fit', humeral_neck_shaft_deg: 135, polyethylene_thickness_mm: 6, stability_test: 'stable' });
    expect(t).toContain('Realizada artroplastia total reversa por via deltopeitoral, com manejo do subescapular por desinserção (peel) (reparado ao final).');
    expect(t).toContain('Versão glenoidal final -3° (planejada -5°); inclinação 0° (planejada 0°).');
    expect(t).toContain('Baseplate padrão de 25 mm, 4 parafusos.');
  });
  test('ângulo 0° e excentricidade 0 são impressos (não tratados como vazio)', () => {
    const t = one('SH_ARTHROPLASTY', { etiology: 'primary_oa', walch: 'B2', prosthesis_type: 'anatomic_tsa', approach: 'deltopectoral', subscapularis_management: 'lesser_tuberosity_osteotomy', glenoid_component: 'cemented_pegged', executed_version_deg: 0, humeral_retroversion_deg: 0 });
    expect(t).toContain('Versão glenoidal final 0°.');
    expect(t).toContain('glenoide Walch B2');
  });
  test('bloqueio isolado', () => {
    const t = one('SH_BICEPS', { procedure: 'tenotomy' }, { anesthesia: { type: 'block_only', block: 'interscalene' } });
    expect(t).toContain('Bloqueio anestésico interescalênico.');
  });
  test('bíceps distal', () => {
    const t = one('EL_DBR', { tear: 'complete', days_since_injury: 1, retraction_cm: 4, lacertus_intact: false, procedure: 'single_incision_repair', fixation: ['cortical_button', 'interference_screw'], reinsertion_position: 'anatomic_ulnar_tuberosity', lcfn_identified: true }, { positioning: 'supine_arm_table', approach: ['anterior_elbow_single_incision'], tourniquet: { used: true, pressure_mmHg: 250, time_min: 55 }, portals: [] });
    expect(t).toContain('Rotura completa do tendão distal do bíceps, 1 dia após a lesão, retração de 4 cm.');
    expect(t).toContain('fixação com botão cortical e parafuso de interferência');
    expect(t).toContain('Garrote pneumático a 250 mmHg por 55 min.');
  });
  test('manguito: desbridamento parcial', () => {
    const t = one('SH_RCT_PARTIAL', { tendons: ['SSP'], tear_type: 'partial_articular', ellman_grade: 1, procedure: 'debridement_only' });
    expect(t).toContain('Identificada lesão parcial da face articular do supraespinal, grau 1 de Ellman. Realizado desbridamento, sem reparo.');
  });
  test('SCR com enxerto e intercorrência', () => {
    const t = one('SH_RCT_MASSIVE', { tendons: ['SSP', 'ISP'], tear_type: 'full_thickness', size_ap_mm: 45, patte: 3, tissue_quality: 'poor', mobility: 'irreducible', procedure: 'superior_capsular_reconstruction', graft: { type: 'dermal_allograft', thickness_mm: 3, glenoid_anchors: 2, humeral_anchors: 4 } }, { intraop_complications: ['conversion_to_open'], intraop_complications_note: 'Por visualização inadequada.', drain: true });
    expect(t).toContain('Procedimento realizado: reconstrução capsular superior. Utilizado aloenxerto dérmico de 3 mm de espessura, fixado com 2 âncoras na glenoide e 4 no úmero.');
    expect(t).toContain('Conversão para cirurgia aberta. Por visualização inadequada.');
    expect(t).toContain('Dreno instalado.');
  });
});

describe('Erros e utilitários', () => {
  test('patologia sem template', () => {
    expect(() => engine.generate({ ...multiProcedure, procedures: [{ pathology_code: 'SH_STIFF', sequence: 1, schema_version: 1, data: {} }] })).toThrow(/sem template/);
  });
  test('estrutura artroscópica de outra região', () => {
    expect(() => engine.generate({ ...multiProcedure, arthroscopic_map: [{ structure_code: 'EL_RH', status: 'normal' }] })).toThrow(/desconhecida/);
  });
  test('código de diagnóstico desconhecido', () => {
    expect(() => engine.generate({ ...multiProcedure, core: { ...coreRight, preop_dx: ['XX_FOO'] } })).toThrow(/desconhecido/);
  });
  test('listPt / enumLabel / normalize', () => {
    expect(listPt([])).toBe('');
    expect(listPt(['a'])).toBe('a');
    expect(listPt(['a', 'b', 'c'])).toBe('a, b e c');
    expect(enumLabel('tendons', 'SSP')).toBe('supraespinal');
    expect(enumLabel('qualquer', 'none')).toBe('nenhum');
    expect(enumLabel('qualquer', 'XYZ')).toBe('XYZ');
    expect(normalize('a  b .\n\n\n\nc\r\n')).toBe('a b.\n\nc\n');
  });
  test('hash de assinatura é canônico (ordem de chaves irrelevante)', () => {
    const a = reportHash({ surgery_id: 's1', version: 1, template_versions: { A: 1, B: 2 }, final_text: 'x', signed_by: 'u', signed_at: '2026-09-23T12:00:00Z' });
    const b = reportHash({ signed_at: '2026-09-23T12:00:00Z', signed_by: 'u', final_text: 'x', template_versions: { B: 2, A: 1 }, version: 1, surgery_id: 's1' });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(reportHash({ surgery_id: 's1', version: 1, template_versions: { A: 1, B: 2 }, final_text: 'x ', signed_by: 'u', signed_at: '2026-09-23T12:00:00Z' })).not.toBe(a);
  });
});
