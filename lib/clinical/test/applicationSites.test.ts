import { describe, test, expect } from 'vitest';
import {
  APPLICATION_ANATOMICAL_SITES,
  APPLICATION_COMPARTMENTS,
  applicationAnatomicalSite,
  saneForApplicationSites,
  saneForCase
} from '../src/proms/applicationSites';

/** Tabela esperada: cada local → SANE (null = deliberadamente sem região → só VAS). */
const EXPECTED_ANATOMICAL: Record<string, string | null> = {
  JOELHO: 'SANE Joelho',
  PATELA: 'SANE Joelho',
  TENDAO_PATELAR: 'SANE Joelho',
  TENDAO_QUADRICIPITAL: 'SANE Joelho',
  MENISCO: 'SANE Joelho',
  PATA_DE_GANSO: 'SANE Joelho',
  OMBRO: 'SANE Ombro',
  MANGUITO_ROTADOR: 'SANE Ombro',
  BURSA_SUBACROMIAL: 'SANE Ombro',
  ACROMIOCLAVICULAR: 'SANE Ombro',
  COTOVELO: 'SANE Cotovelo',
  EPICONDILO_LATERAL: 'SANE Cotovelo',
  EPICONDILO_MEDIAL: 'SANE Cotovelo',
  QUADRIL: 'SANE Quadril',
  TROCANTER: 'SANE Quadril',
  TORNOZELO: 'SANE Tornozelo e Pé',
  TENDAO_AQUILES: 'SANE Tornozelo e Pé',
  FASCIA_PLANTAR: 'SANE Tornozelo e Pé',
  PE: 'SANE Tornozelo e Pé',
  PUNHO: 'SANE Punho e Mão',
  MAO: 'SANE Punho e Mão',
  TUNEL_DO_CARPO: 'SANE Punho e Mão',
  COLUNA_CERVICAL: 'SANE Coluna',
  COLUNA_TORACICA: 'SANE Coluna',
  COLUNA_LOMBAR: 'SANE Coluna',
  SACROILIACA: null,
  MUSCULO: null,
  OUTRO: null
};

const EXPECTED_COMPARTMENT: Record<string, string | null> = {
  'Intra-articular': null,
  Subcondroplastia: null,
  'Tecido periarticular': null,
  'Tendão patelar': 'SANE Joelho',
  Ligamento: null,
  Outro: null
};

describe('local de aplicação → região → SANE', () => {
  test('catálogos completos: todo local está na tabela esperada', () => {
    expect(APPLICATION_ANATOMICAL_SITES.map((s) => s.code).sort()).toEqual(Object.keys(EXPECTED_ANATOMICAL).sort());
    expect(APPLICATION_COMPARTMENTS.map((s) => s.code).sort()).toEqual(Object.keys(EXPECTED_COMPARTMENT).sort());
  });

  test('todo local sem região tem motivo; todo local mapeado não tem', () => {
    for (const s of [...APPLICATION_ANATOMICAL_SITES, ...APPLICATION_COMPARTMENTS]) {
      if (s.region === null) expect(s.unmappedReason, s.code).toBeTruthy();
      else expect(s.unmappedReason, s.code).toBeUndefined();
    }
  });

  for (const [code, scale] of Object.entries(EXPECTED_ANATOMICAL)) {
    test(`estrutura ${code} → ${scale ?? 'só VAS'}`, () => {
      expect(saneForApplicationSites([{ estruturaAnatomica: code }])?.scale ?? null).toBe(scale);
    });
  }

  for (const [value, scale] of Object.entries(EXPECTED_COMPARTMENT)) {
    test(`compartimento ${value} → ${scale ?? 'só VAS'}`, () => {
      expect(saneForApplicationSites([{ localAplicacao: value }])?.scale ?? null).toBe(scale);
    });
  }

  test('estrutura aceita código ou rótulo pt-BR/es, sem diferenciar acentos/caixa', () => {
    expect(applicationAnatomicalSite('TENDAO_AQUILES')?.code).toBe('TENDAO_AQUILES');
    expect(applicationAnatomicalSite('Tendão de Aquiles')?.code).toBe('TENDAO_AQUILES');
    expect(applicationAnatomicalSite('tendon de aquiles')?.code).toBe('TENDAO_AQUILES');
    expect(applicationAnatomicalSite('Rodilla')?.code).toBe('JOELHO');
    expect(applicationAnatomicalSite('Clavícula')).toBeNull();
    expect(applicationAnatomicalSite('')).toBeNull();
    expect(applicationAnatomicalSite(undefined)).toBeNull();
  });

  test('a estrutura define a linha; sem ela vale o compartimento', () => {
    expect(saneForApplicationSites([{ localAplicacao: 'Intra-articular', estruturaAnatomica: 'JOELHO' }])?.scale).toBe('SANE Joelho');
    expect(saneForApplicationSites([{ localAplicacao: 'Tendão patelar', estruturaAnatomica: 'OUTRO' }])).toBeNull();
    expect(saneForApplicationSites([{ localAplicacao: 'Intra-articular' }])).toBeNull();
    expect(saneForApplicationSites([{ estruturaAnatomica: 'Clavícula' }])).toBeNull();
  });

  test('vários locais: mesma região → SANE; regiões diferentes ou algum não mapeado → só VAS', () => {
    expect(saneForApplicationSites([{ estruturaAnatomica: 'JOELHO' }, { estruturaAnatomica: 'PATELA' }])?.scale).toBe('SANE Joelho');
    expect(saneForApplicationSites([{ estruturaAnatomica: 'COLUNA_CERVICAL' }, { estruturaAnatomica: 'COLUNA_LOMBAR' }])?.scale).toBe('SANE Coluna');
    expect(saneForApplicationSites([{ estruturaAnatomica: 'JOELHO' }, { estruturaAnatomica: 'OMBRO' }])).toBeNull();
    expect(saneForApplicationSites([{ estruturaAnatomica: 'JOELHO' }, { localAplicacao: 'Ligamento' }])).toBeNull();
  });

  test('linhas sem local (só guia) são ignoradas; sem local → só VAS', () => {
    expect(saneForApplicationSites([{ localAplicacao: '', estruturaAnatomica: '' }, { estruturaAnatomica: 'TORNOZELO' }])?.scale).toBe('SANE Tornozelo e Pé');
    expect(saneForApplicationSites([])).toBeNull();
    expect(saneForApplicationSites(null)).toBeNull();
    expect(saneForApplicationSites([{ localAplicacao: '  ' }])).toBeNull();
  });

  test('saneForCase: condição com região prevalece; sem região usa os locais', () => {
    expect(saneForCase('ombro', [{ estruturaAnatomica: 'JOELHO' }])?.scale).toBe('SANE Ombro');
    expect(saneForCase('outras', [{ estruturaAnatomica: 'JOELHO' }])?.scale).toBe('SANE Joelho');
    expect(saneForCase(undefined, [{ estruturaAnatomica: 'TENDAO_AQUILES' }])?.scale).toBe('SANE Tornozelo e Pé');
    expect(saneForCase('outras', [])).toBeNull();
    expect(saneForCase('outras', [{ estruturaAnatomica: 'JOELHO' }, { estruturaAnatomica: 'COTOVELO' }])).toBeNull();
  });
});
