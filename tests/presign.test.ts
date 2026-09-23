import { runPresignChecklist, PresignInput } from '../src/clinical/presign/checklist';

const base: PresignInput = {
  episode_side: 'R',
  core: { side: 'R', postop_dx: ['SH_RCT_FULL'], start_time: '2026-09-23T10:00:00Z', end_time: '2026-09-23T11:00:00Z', antibiotic: { drug: 'cefazolina', minutes_before_incision: 30 } },
  procedures: [{ pathology_code: 'SH_RCT_FULL', data: {} }],
  implants: [{ category: 'anchor', lot: 'L1' }],
  arthroscopic_map: [{ structure_code: 'GH_SSP_ART', status: 'treated' }]
};
const rules = (i: PresignInput) => runPresignChecklist(i).issues.map((x) => `${x.severity}:${x.rule}`);

describe('checklist pré-assinatura', () => {
  test('caso limpo pode assinar', () => expect(runPresignChecklist(base)).toEqual({ canSign: true, issues: [] }));
  test('lado divergente bloqueia', () => {
    const r = runPresignChecklist({ ...base, core: { ...base.core, side: 'L' } });
    expect(r.canSign).toBe(false);
    expect(rules({ ...base, core: { ...base.core, side: 'L' } })).toContain('BLOCKER:SIDE_MISMATCH');
  });
  test('dx pós-op vazio / desconhecido', () => {
    expect(rules({ ...base, core: { ...base.core, postop_dx: [] } })).toContain('BLOCKER:POSTOP_DX_EMPTY');
    expect(rules({ ...base, core: { ...base.core, postop_dx: ['KN_LCA'] } })).toContain('BLOCKER:POSTOP_DX_UNKNOWN');
  });
  test('sem procedimento', () => expect(rules({ ...base, procedures: [] })).toContain('BLOCKER:NO_PROCEDURE'));
  test('implante sem lote: aviso; prótese sem lote: bloqueio', () => {
    expect(rules({ ...base, implants: [{ category: 'anchor' }] })).toEqual(['WARNING:IMPLANT_NO_LOT']);
    const r = runPresignChecklist({ ...base, implants: [{ category: 'prosthesis_component', lot: ' ' }] });
    expect(r.canSign).toBe(false);
  });
  test('lesão sem conduta: aviso; com justificativa: ok', () => {
    expect(rules({ ...base, arthroscopic_map: [{ structure_code: 'GH_LAB_SUP', status: 'lesion' }] })).toEqual(['WARNING:LESION_WITHOUT_ACTION']);
    expect(rules({ ...base, arthroscopic_map: [{ structure_code: 'GH_LAB_SUP', status: 'lesion', justification: 'SLAP I degenerativo, conduta expectante' }] })).toEqual([]);
  });
  test('tempos', () => {
    expect(rules({ ...base, core: { ...base.core, end_time: '2026-09-23T09:00:00Z' } })).toContain('BLOCKER:TIME_INVALID');
    expect(rules({ ...base, core: { ...base.core, end_time: '2026-09-23T10:03:00Z' } })).toContain('WARNING:TIME_IMPLAUSIBLE');
    expect(rules({ ...base, core: { ...base.core, end_time: '2026-09-23T17:00:00Z' } })).toContain('WARNING:TIME_IMPLAUSIBLE');
  });
  test('antibiótico sem horário', () => {
    expect(rules({ ...base, core: { ...base.core, antibiotic: { drug: 'cefazolina' } } })).toEqual(['WARNING:ANTIBIOTIC_NO_TIME']);
  });
});
