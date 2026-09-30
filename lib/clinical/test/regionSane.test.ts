import { describe, test, expect } from 'vitest';
import { ClinicalGuardError } from '../src/errors';
import { SANE_KNEE_QUESTION } from '../src/proms/kneeFunction';
import {
  SANE_REGIONS,
  isSaneRegionInstrument,
  saneForBodyRegion,
  saneRegionByInstrument,
  scoreSANERegion
} from '../src/proms/regionSane';

describe('SANE por região', () => {
  test('códigos, nomes do link e chaves de pesquisa', () => {
    expect(SANE_REGIONS.map((d) => [d.code, d.scale, d.label.es, d.researchKey])).toEqual([
      ['SANE_OMBRO', 'SANE Ombro', 'SANE Hombro', 'sane_ombro'],
      ['SANE_JOELHO', 'SANE Joelho', 'SANE Rodilla', 'sane_joelho'],
      ['SANE_QUADRIL', 'SANE Quadril', 'SANE Cadera', 'sane_quadril'],
      ['SANE_COTOVELO', 'SANE Cotovelo', 'SANE Codo', 'sane_cotovelo'],
      ['SANE_TORNOZELO_PE', 'SANE Tornozelo e Pé', 'SANE Tobillo y Pie', 'sane_tornozelo_pe'],
      ['SANE_PUNHO_MAO', 'SANE Punho e Mão', 'SANE Muñeca y Mano', 'sane_punho_mao'],
      ['SANE_COLUNA', 'SANE Coluna', 'SANE Columna', 'sane_coluna']
    ]);
  });

  test('pergunta com gênero/artigo corretos (pt-BR e es)', () => {
    const q = Object.fromEntries(SANE_REGIONS.map((d) => [d.code, d.question]));
    expect(q.SANE_JOELHO).toEqual(SANE_KNEE_QUESTION);
    expect(q.SANE_OMBRO!['pt-BR']).toBe('Em uma escala de 0 a 100, sendo 100 um ombro completamente normal, como você avalia seu ombro hoje?');
    expect(q.SANE_QUADRIL!['pt-BR']).toContain('um quadril completamente normal, como você avalia seu quadril hoje?');
    expect(q.SANE_COTOVELO!['pt-BR']).toContain('um cotovelo completamente normal, como você avalia seu cotovelo hoje?');
    expect(q.SANE_TORNOZELO_PE!['pt-BR']).toContain('um tornozelo/pé completamente normal, como você avalia seu tornozelo/pé hoje?');
    expect(q.SANE_PUNHO_MAO!['pt-BR']).toContain('um punho/uma mão completamente normal, como você avalia seu punho/sua mão hoje?');
    expect(q.SANE_COLUNA!['pt-BR']).toContain('uma coluna completamente normal, como você avalia sua coluna hoje?');
    expect(q.SANE_OMBRO!.es).toContain('un hombro completamente normal, ¿cómo evalúa su hombro hoy?');
    expect(q.SANE_QUADRIL!.es).toContain('una cadera completamente normal, ¿cómo evalúa su cadera hoy?');
    expect(q.SANE_COTOVELO!.es).toContain('un codo completamente normal');
    expect(q.SANE_TORNOZELO_PE!.es).toContain('un tobillo/pie completamente normal');
    expect(q.SANE_PUNHO_MAO!.es).toContain('una muñeca/mano completamente normal');
    expect(q.SANE_COLUNA!.es).toContain('una columna completamente normal, ¿cómo evalúa su columna hoy?');
  });

  test('só a coluna é marcada com validação limitada', () => {
    expect(SANE_REGIONS.filter((d) => d.limitedValidation).map((d) => d.code)).toEqual(['SANE_COLUNA']);
  });

  test('região do catálogo → SANE (coluna unificada; "outras" sem SANE)', () => {
    expect(saneForBodyRegion('ombro')?.code).toBe('SANE_OMBRO');
    expect(saneForBodyRegion('joelho')?.code).toBe('SANE_JOELHO');
    expect(saneForBodyRegion('pe_tornozelo')?.code).toBe('SANE_TORNOZELO_PE');
    expect(saneForBodyRegion('punho_mao')?.code).toBe('SANE_PUNHO_MAO');
    for (const r of ['coluna_cervical', 'coluna_toracica', 'coluna_lombar']) expect(saneForBodyRegion(r)?.code).toBe('SANE_COLUNA');
    for (const r of ['outras', '', null, undefined, 'x']) expect(saneForBodyRegion(r)).toBeNull();
  });

  test('ambas as grafias identificam o instrumento; nomes licenciados não', () => {
    for (const d of SANE_REGIONS) {
      expect(saneRegionByInstrument(d.code)).toBe(d);
      expect(saneRegionByInstrument(d.scale)).toBe(d);
    }
    for (const n of ['SANE', 'KOOS', 'WOMAC', 'IKDC', 'ASES', 'DASH', 'sane_ombro', 42]) expect(isSaneRegionInstrument(n)).toBe(false);
  });

  test('escore inteiro 0–100 com o código da região', () => {
    expect(scoreSANERegion('SANE Coluna', { value: 55 })).toMatchObject({ instrument: 'SANE_COLUNA', score: 55, max: 100 });
    expect(() => scoreSANERegion('SANE_OMBRO', { value: 101 })).toThrow(ClinicalGuardError);
    expect(() => scoreSANERegion('SANE_OMBRO', { value: 50.5 })).toThrow(ClinicalGuardError);
    expect(() => scoreSANERegion('KOOS', { value: 50 })).toThrow();
  });
});
