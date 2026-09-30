import { describe, test, expect } from 'vitest';
import {
  APPLICATION_ANATOMICAL_SITES,
  APPLICATION_COMPARTMENTS,
  APPLICATION_SITE_GROUPS,
  LEGACY_APPLICATION_ANATOMICAL_SITES,
  applicationAnatomicalSite,
  applicationAnatomicalSiteLabel,
  groupedApplicationAnatomicalSites,
  saneForApplicationSites,
  saneForCase
} from '../src/proms/applicationSites';

const OMBRO = 'SANE Ombro';
const COTOVELO = 'SANE Cotovelo';
const PUNHO_MAO = 'SANE Punho e Mão';
const QUADRIL = 'SANE Quadril';
const JOELHO = 'SANE Joelho';
const PE = 'SANE Tornozelo e Pé';
const COLUNA = 'SANE Coluna';

/**
 * Catálogo atual: código → [grupo, rótulo pt-BR, rótulo es, SANE (null = só VAS)].
 * Cada linha é um teste; o catálogo deve conter exatamente estes códigos.
 */
const EXPECTED_ANATOMICAL: Record<string, [string, string, string, string | null]> = {
  OMBRO_GLENOUMERAL: ['ombro', 'Articulação glenoumeral', 'Articulación glenohumeral', OMBRO],
  OMBRO_BURSA_SASD: ['ombro', 'Bursa subacromial-subdeltoidea', 'Bursa subacromial-subdeltoidea', OMBRO],
  OMBRO_ACROMIOCLAVICULAR: ['ombro', 'Articulação acromioclavicular', 'Articulación acromioclavicular', OMBRO],
  OMBRO_SUPRAESPINAL: ['ombro', 'Tendão do supraespinal / manguito rotador', 'Tendón del supraespinoso / manguito rotador', OMBRO],
  OMBRO_CABECA_LONGA_BICEPS: ['ombro', 'Cabeça longa do bíceps (sulco bicipital)', 'Porción larga del bíceps (corredera bicipital)', OMBRO],
  OMBRO_NERVO_SUPRAESCAPULAR: ['ombro', 'Nervo supraescapular', 'Nervio supraescapular', OMBRO],
  COTOVELO_ARTICULACAO: ['cotovelo', 'Articulação do cotovelo', 'Articulación del codo', COTOVELO],
  COTOVELO_EPICONDILO_LATERAL: ['cotovelo', 'Epicôndilo lateral (tendão extensor comum)', 'Epicóndilo lateral (tendón extensor común)', COTOVELO],
  COTOVELO_EPICONDILO_MEDIAL: ['cotovelo', 'Epicôndilo medial (tendão flexor comum)', 'Epicóndilo medial (tendón flexor común)', COTOVELO],
  COTOVELO_BURSA_OLECRANIANA: ['cotovelo', 'Bursa olecraniana', 'Bursa olecraniana', COTOVELO],
  PUNHO_RADIOCARPAL: ['punho_mao', 'Articulação radiocarpal', 'Articulación radiocarpiana', PUNHO_MAO],
  PUNHO_DE_QUERVAIN: ['punho_mao', '1º compartimento extensor (De Quervain)', '1.er compartimento extensor (De Quervain)', PUNHO_MAO],
  PUNHO_TUNEL_DO_CARPO: ['punho_mao', 'Túnel do carpo', 'Túnel carpiano', PUNHO_MAO],
  MAO_TRAPEZIOMETACARPIANA: ['punho_mao', 'Articulação trapeziometacarpiana (rizartrose)', 'Articulación trapeciometacarpiana (rizartrosis)', PUNHO_MAO],
  MAO_POLIA_A1: ['punho_mao', 'Polia A1 (dedo em gatilho)', 'Polea A1 (dedo en gatillo)', PUNHO_MAO],
  MAO_INTERFALANGICAS_MCF: ['punho_mao', 'Articulações interfalângicas/metacarpofalângicas', 'Articulaciones interfalángicas/metacarpofalángicas', PUNHO_MAO],
  QUADRIL_COXOFEMORAL: ['quadril', 'Articulação coxofemoral', 'Articulación coxofemoral', QUADRIL],
  QUADRIL_TROCANTER_BURSA: ['quadril', 'Trocânter maior / bursa trocantérica', 'Trocánter mayor / bursa trocantérea', QUADRIL],
  QUADRIL_GLUTEO_MEDIO_MINIMO: ['quadril', 'Tendão do glúteo médio/mínimo', 'Tendón del glúteo medio/menor', QUADRIL],
  QUADRIL_ISQUIOTIBIAIS_PROXIMAIS: ['quadril', 'Isquiotibiais proximais', 'Isquiotibiales proximales', QUADRIL],
  QUADRIL_ILIOPSOAS: ['quadril', 'Iliopsoas / bursa iliopectínea', 'Iliopsoas / bursa iliopectínea', QUADRIL],
  JOELHO_TIBIOFEMORAL: ['joelho', 'Intra-articular (tibiofemoral)', 'Intraarticular (tibiofemoral)', JOELHO],
  JOELHO_FEMOROPATELAR: ['joelho', 'Articulação femoropatelar', 'Articulación femororrotuliana', JOELHO],
  JOELHO_TENDAO_PATELAR: ['joelho', 'Tendão patelar', 'Tendón rotuliano', JOELHO],
  JOELHO_TENDAO_QUADRICIPITAL: ['joelho', 'Tendão quadricipital', 'Tendón cuadricipital', JOELHO],
  JOELHO_MENISCO_MEDIAL: ['joelho', 'Menisco medial', 'Menisco medial', JOELHO],
  JOELHO_MENISCO_LATERAL: ['joelho', 'Menisco lateral', 'Menisco lateral', JOELHO],
  JOELHO_PATA_DE_GANSO: ['joelho', 'Pata de ganso', 'Pata de ganso', JOELHO],
  JOELHO_LIGAMENTO_COLATERAL_MEDIAL: ['joelho', 'Ligamento colateral medial', 'Ligamento colateral medial', JOELHO],
  JOELHO_GORDURA_HOFFA: ['joelho', 'Gordura de Hoffa', 'Grasa de Hoffa', JOELHO],
  JOELHO_CISTO_BAKER: ['joelho', 'Cisto de Baker', 'Quiste de Baker', JOELHO],
  JOELHO_OSSO_SUBCONDRAL: ['joelho', 'Osso subcondral (subcondroplastia)', 'Hueso subcondral (subcondroplastia)', JOELHO],
  TORNOZELO_TIBIOTARSICA: ['pe_tornozelo', 'Articulação tibiotársica', 'Articulación tibiotarsiana', PE],
  TORNOZELO_SUBTALAR: ['pe_tornozelo', 'Articulação subtalar', 'Articulación subastragalina', PE],
  TORNOZELO_TENDAO_AQUILES: ['pe_tornozelo', 'Tendão de Aquiles', 'Tendón de Aquiles', PE],
  PE_FASCIA_PLANTAR: ['pe_tornozelo', 'Fáscia plantar', 'Fascia plantar', PE],
  PE_PRIMEIRA_MTF: ['pe_tornozelo', '1ª articulação metatarsofalângica', '1.ª articulación metatarsofalángica', PE],
  PE_SEIO_DO_TARSO: ['pe_tornozelo', 'Seio do tarso', 'Seno del tarso', PE],
  COLUNA_FACETARIA_CERVICAL: ['coluna', 'Facetária cervical', 'Facetaria cervical', COLUNA],
  COLUNA_FACETARIA_TORACICA: ['coluna', 'Facetária torácica', 'Facetaria torácica', COLUNA],
  COLUNA_FACETARIA_LOMBAR: ['coluna', 'Facetária lombar', 'Facetaria lumbar', COLUNA],
  COLUNA_PERIDURAL: ['coluna', 'Peridural', 'Epidural', COLUNA],
  COLUNA_INTRADISCAL: ['coluna', 'Discal (intradiscal)', 'Discal (intradiscal)', COLUNA],
  SACROILIACA: ['pelve', 'Articulação sacroilíaca', 'Articulación sacroilíaca', null],
  MUSCULO: ['outros', 'Músculo (especificar)', 'Músculo (especificar)', null],
  OUTRO: ['outros', 'Outro (especificar)', 'Otro (especificar)', null]
};

/** Códigos da primeira versão (aliases legados): mesmo SANE de antes. */
const EXPECTED_LEGACY: Record<string, string | null> = {
  JOELHO: JOELHO,
  PATELA: JOELHO,
  TENDAO_PATELAR: JOELHO,
  TENDAO_QUADRICIPITAL: JOELHO,
  MENISCO: JOELHO,
  PATA_DE_GANSO: JOELHO,
  OMBRO: OMBRO,
  MANGUITO_ROTADOR: OMBRO,
  BURSA_SUBACROMIAL: OMBRO,
  ACROMIOCLAVICULAR: OMBRO,
  COTOVELO: COTOVELO,
  EPICONDILO_LATERAL: COTOVELO,
  EPICONDILO_MEDIAL: COTOVELO,
  QUADRIL: QUADRIL,
  TROCANTER: QUADRIL,
  TORNOZELO: PE,
  TENDAO_AQUILES: PE,
  FASCIA_PLANTAR: PE,
  PE: PE,
  PUNHO: PUNHO_MAO,
  MAO: PUNHO_MAO,
  TUNEL_DO_CARPO: PUNHO_MAO,
  COLUNA_CERVICAL: COLUNA,
  COLUNA_TORACICA: COLUNA,
  COLUNA_LOMBAR: COLUNA,
  // Mantidos no catálogo atual (mesmo código, rótulo "(especificar)").
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
    const current = new Set(APPLICATION_ANATOMICAL_SITES.map((s) => s.code));
    expect(
      [...LEGACY_APPLICATION_ANATOMICAL_SITES.map((s) => s.code), ...['SACROILIACA', 'MUSCULO', 'OUTRO'].filter((c) => current.has(c))].sort()
    ).toEqual(Object.keys(EXPECTED_LEGACY).sort());
  });

  test('códigos únicos entre catálogo atual e legado', () => {
    const codes = [...APPLICATION_ANATOMICAL_SITES, ...LEGACY_APPLICATION_ANATOMICAL_SITES].map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  test('todo local sem região tem motivo; todo local mapeado não tem', () => {
    for (const s of [...APPLICATION_ANATOMICAL_SITES, ...LEGACY_APPLICATION_ANATOMICAL_SITES, ...APPLICATION_COMPARTMENTS]) {
      if (s.region === null) expect(s.unmappedReason, s.code).toBeTruthy();
      else expect(s.unmappedReason, s.code).toBeUndefined();
    }
  });

  test('grupos: ordem de exibição, cada estrutura atual em um grupo, nenhum grupo vazio', () => {
    expect(APPLICATION_SITE_GROUPS.map((g) => g.code)).toEqual([
      'ombro', 'cotovelo', 'punho_mao', 'quadril', 'joelho', 'pe_tornozelo', 'coluna', 'pelve', 'outros'
    ]);
    const grouped = groupedApplicationAnatomicalSites();
    expect(grouped.flatMap((g) => g.sites.map((s) => s.code))).toEqual(APPLICATION_ANATOMICAL_SITES.map((s) => s.code));
    for (const g of grouped) {
      expect(g.sites.length, g.group.code).toBeGreaterThan(0);
      expect(g.group.label['pt-BR']).toBeTruthy();
      expect(g.group.label.es).toBeTruthy();
    }
    expect(Object.fromEntries(grouped.map((g) => [g.group.code, g.sites.length]))).toEqual({
      ombro: 6, cotovelo: 4, punho_mao: 6, quadril: 5, joelho: 11, pe_tornozelo: 6, coluna: 5, pelve: 1, outros: 2
    });
  });

  test('só "Músculo" e "Outro" pedem texto livre; legados nunca são oferecidos', () => {
    expect(APPLICATION_ANATOMICAL_SITES.filter((s) => s.freeText).map((s) => s.code)).toEqual(['MUSCULO', 'OUTRO']);
    expect(APPLICATION_ANATOMICAL_SITES.some((s) => s.legacy)).toBe(false);
    expect(LEGACY_APPLICATION_ANATOMICAL_SITES.every((s) => s.legacy && !s.group)).toBe(true);
  });

  for (const [code, [group, pt, es, scale]] of Object.entries(EXPECTED_ANATOMICAL)) {
    test(`estrutura ${code} (${group}) → ${scale ?? 'só VAS'}; rótulos pt-BR/es`, () => {
      const d = applicationAnatomicalSite(code);
      expect(d?.code).toBe(code);
      expect(d?.group).toBe(group);
      expect(d?.label).toEqual({ 'pt-BR': pt, es });
      expect(applicationAnatomicalSiteLabel(code, 'pt-BR')).toBe(pt);
      expect(applicationAnatomicalSiteLabel(code, 'es')).toBe(es);
      expect(saneForApplicationSites([{ estruturaAnatomica: code }])?.scale ?? null).toBe(scale);
    });
  }

  for (const [code, scale] of Object.entries(EXPECTED_LEGACY)) {
    test(`legado ${code} carrega, tem rótulo e → ${scale ?? 'só VAS'}`, () => {
      const d = applicationAnatomicalSite(code);
      expect(d?.code).toBe(code);
      expect(d?.label['pt-BR']).toBeTruthy();
      expect(d?.label.es).toBeTruthy();
      expect(applicationAnatomicalSiteLabel(code, 'pt-BR')).not.toBe(code);
      expect(saneForApplicationSites([{ estruturaAnatomica: code }])?.scale ?? null).toBe(scale);
    });
  }

  test('rótulos legados preservados (exibição de registros antigos)', () => {
    expect(applicationAnatomicalSiteLabel('JOELHO', 'pt-BR')).toBe('Joelho');
    expect(applicationAnatomicalSiteLabel('MENISCO', 'es')).toBe('Menisco');
    expect(applicationAnatomicalSiteLabel('MAO', 'pt-BR')).toBe('Mão / dedos');
    expect(applicationAnatomicalSiteLabel('COLUNA_LOMBAR', 'es')).toBe('Columna lumbar');
    expect(applicationAnatomicalSiteLabel('Clavícula', 'pt-BR')).toBe('Clavícula');
  });

  for (const [value, scale] of Object.entries(EXPECTED_COMPARTMENT)) {
    test(`compartimento ${value} → ${scale ?? 'só VAS'}`, () => {
      expect(saneForApplicationSites([{ localAplicacao: value }])?.scale ?? null).toBe(scale);
    });
  }

  test('estrutura aceita código ou rótulo pt-BR/es, sem diferenciar acentos/caixa', () => {
    expect(applicationAnatomicalSite('TENDAO_AQUILES')?.code).toBe('TENDAO_AQUILES');
    // Rótulos resolvem para o catálogo atual; códigos legados, para si mesmos.
    expect(applicationAnatomicalSite('Tendão de Aquiles')?.code).toBe('TORNOZELO_TENDAO_AQUILES');
    expect(applicationAnatomicalSite('tendon de aquiles')?.code).toBe('TORNOZELO_TENDAO_AQUILES');
    expect(applicationAnatomicalSite('Tendão patelar')?.code).toBe('JOELHO_TENDAO_PATELAR');
    expect(applicationAnatomicalSite('TENDAO_PATELAR')?.code).toBe('TENDAO_PATELAR');
    expect(applicationAnatomicalSite('polea a1 (dedo en gatillo)')?.code).toBe('MAO_POLIA_A1');
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

  test('novos códigos: Polia A1 → Punho e Mão; Facetária lombar → Coluna; Sacroilíaca → só VAS', () => {
    expect(saneForCase('outras', [{ estruturaAnatomica: 'MAO_POLIA_A1' }])?.scale).toBe(PUNHO_MAO);
    expect(saneForCase('outras', [{ estruturaAnatomica: 'COLUNA_FACETARIA_LOMBAR' }])?.scale).toBe(COLUNA);
    expect(saneForCase('outras', [{ estruturaAnatomica: 'SACROILIACA' }])).toBeNull();
    // Peridural/discal (sem nível) e facetária cervical compartilham o SANE Coluna.
    expect(saneForApplicationSites([{ estruturaAnatomica: 'COLUNA_PERIDURAL' }, { estruturaAnatomica: 'COLUNA_FACETARIA_CERVICAL' }])?.scale).toBe(COLUNA);
    // Novo + legado na mesma região → SANE; regiões diferentes → só VAS.
    expect(saneForApplicationSites([{ estruturaAnatomica: 'JOELHO_MENISCO_MEDIAL' }, { estruturaAnatomica: 'MENISCO' }])?.scale).toBe(JOELHO);
    expect(saneForApplicationSites([{ estruturaAnatomica: 'MAO_POLIA_A1' }, { estruturaAnatomica: 'COTOVELO_BURSA_OLECRANIANA' }])).toBeNull();
    expect(saneForApplicationSites([{ estruturaAnatomica: 'MUSCULO' }])).toBeNull();
  });

  test('saneForCase: condição com região prevalece; sem região usa os locais', () => {
    expect(saneForCase('ombro', [{ estruturaAnatomica: 'JOELHO' }])?.scale).toBe('SANE Ombro');
    expect(saneForCase('outras', [{ estruturaAnatomica: 'JOELHO' }])?.scale).toBe('SANE Joelho');
    expect(saneForCase(undefined, [{ estruturaAnatomica: 'TENDAO_AQUILES' }])?.scale).toBe('SANE Tornozelo e Pé');
    expect(saneForCase('outras', [])).toBeNull();
    expect(saneForCase('outras', [{ estruturaAnatomica: 'JOELHO' }, { estruturaAnatomica: 'COTOVELO' }])).toBeNull();
  });
});
