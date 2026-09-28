import { describe, test, expect } from 'vitest';
import core from '../src/schemas/CORE_SURGERY.v1.json';
import labels from '../src/labels.pt.json';
import {
  CORE_OPTIONS_BY_REGION, coreRegionIssues, coreSchemaForRegion, inapplicableCoreFields, isArthroscopic, isOpenOnly,
  withoutInapplicableCore, withoutOtherRegionOptions
} from '../src/surgery/coreOptions';

const schemaEnum = (f: 'approach' | 'portals') => (core as any).properties[f].items.enum as string[];

describe('opções do núcleo por região', () => {
  test.each(['approach', 'portals'] as const)('%s: partição cobre exatamente os valores do schema (nada inventado, nada perdido)', (f) => {
    const union = new Set([...CORE_OPTIONS_BY_REGION[f].shoulder, ...CORE_OPTIONS_BY_REGION[f].elbow]);
    expect([...union].sort()).toEqual([...schemaEnum(f)].sort());
  });
  test('cotovelo não oferece opções exclusivas do ombro', () => {
    const s = coreSchemaForRegion(core, 'elbow');
    const approach = s.properties.approach.items.enum as string[];
    const portals = s.properties.portals.items.enum as string[];
    expect(approach).not.toContain('deltopectoral');
    expect(portals).not.toContain('neviaser');
    expect(approach).toContain('anterior_elbow_single_incision');
    // "posterolateral" aparecia duas vezes (portal de ombro e portal de cotovelo, mesmo rótulo)
    const portalLabels = portals.map((p) => (labels as any).portals[p]);
    expect(portalLabels.filter((l: string) => l === 'posterolateral')).toHaveLength(1);
    expect(portals).toContain('el_posterolateral');
    expect(coreSchemaForRegion(core, 'shoulder').properties.portals.items.enum).not.toContain('el_posterolateral');
  });
  test('via posterior disponível para ombro e cotovelo', () => {
    expect(CORE_OPTIONS_BY_REGION.approach.shoulder).toContain('posterior');
    expect(CORE_OPTIONS_BY_REGION.approach.elbow).toContain('posterior');
    expect(coreSchemaForRegion(core, 'elbow').properties.approach.items.enum).toContain('posterior');
    expect(coreSchemaForRegion(core, 'shoulder').properties.approach.items.enum).toContain('posterior');
    expect(withoutOtherRegionOptions('elbow', { approach: ['posterior', 'olecranon_osteotomy'] })).toEqual({ approach: ['posterior', 'olecranon_osteotomy'] });
    expect(coreRegionIssues('elbow', { approach: ['posterior'] })).toEqual([]);
    expect(coreRegionIssues('shoulder', { approach: ['posterior'] })).toEqual([]);
  });
  test('rótulos de portais sem duplicata dentro de cada região', () => {
    for (const r of ['shoulder', 'elbow'] as const) {
      const ls = CORE_OPTIONS_BY_REGION.portals[r].map((p) => (labels as any).portals[p]);
      expect(new Set(ls).size).toBe(ls.length);
    }
  });
  test('schema original não é alterado e valores gravados fora da região continuam visíveis', () => {
    const before = JSON.stringify(core);
    const s = coreSchemaForRegion(core, 'elbow', { approach: ['deltopectoral'] });
    expect(s.properties.approach.items.enum).toContain('deltopectoral');
    expect(JSON.stringify(core)).toBe(before);
  });
  test('ângulo da cadeira de praia e portais só quando se aplicam', () => {
    expect(inapplicableCoreFields({ positioning: 'supine_arm_table', approach: ['anterior_elbow_single_incision'] })).toEqual(['beach_chair_angle_deg', 'portals']);
    expect(inapplicableCoreFields({ positioning: 'beach_chair', approach: ['arthroscopic'] })).toEqual([]);
    expect(withoutInapplicableCore({ positioning: 'supine', beach_chair_angle_deg: 70, approach: ['kocher'], portals: ['el_soft_spot'] }))
      .toEqual({ positioning: 'supine', approach: ['kocher'] });
  });
  test('troca de região remove valores da outra região', () => {
    expect(withoutOtherRegionOptions('elbow', { approach: ['arthroscopic', 'deltopectoral'], portals: ['neviaser'] })).toEqual({ approach: ['arthroscopic'] });
  });
  test('tipo de acesso', () => {
    expect(isArthroscopic({ approach: ['arthroscopic', 'open_subpectoral'] })).toBe(true);
    expect(isOpenOnly({ approach: ['anterior_elbow_single_incision'] })).toBe(true);
    expect(isOpenOnly({})).toBe(false); // sem registro: não presume aberta
  });
});

describe('coreRegionIssues', () => {
  test('cotovelo com via, portal e ângulo de ombro', () => {
    const issues = coreRegionIssues('elbow', { positioning: 'supine_arm_table', beach_chair_angle_deg: 60, approach: ['arthroscopic', 'deltopectoral'], portals: ['neviaser', 'el_soft_spot'] });
    expect(issues.map((i) => i.field)).toEqual(['approach', 'portals', 'beach_chair_angle_deg']);
    expect(issues[0].message_pt).toContain('deltopeitoral');
    expect(issues[1].message_pt).toContain('de Neviaser');
  });
  test('portais em cirurgia aberta', () => {
    expect(coreRegionIssues('elbow', { approach: ['anterior_elbow_single_incision'], portals: ['el_posterolateral'] }).map((i) => i.field)).toEqual(['portals']);
  });
  test('registro coerente não tem pendências', () => {
    expect(coreRegionIssues('elbow', { positioning: 'supine_arm_table', approach: ['anterior_elbow_single_incision'] })).toEqual([]);
    expect(coreRegionIssues('shoulder', { positioning: 'beach_chair', beach_chair_angle_deg: 70, approach: ['arthroscopic'], portals: ['posterior'] })).toEqual([]);
  });
});
