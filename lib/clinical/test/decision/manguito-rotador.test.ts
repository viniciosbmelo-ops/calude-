/** Algoritmo do manguito rotador (rascunho): casos-ouro, zonas cinzentas, ausência, mapeamento e estrutura. */
import { describe, expect, test } from 'vitest';
import { evaluate, entradasDaRegra } from '../../src/decision/engine';
import { entradasUsadas, validateDefinition } from '../../src/decision/validate';
import { MANGUITO_ROTADOR as DEF, mapearEntradaManguito } from '../../src/decision/algorithms/manguito-rotador';
import type { ResultadoApoio } from '../../src/decision/types';

type Entrada = Record<string, unknown>;
const run = (e: Entrada, parametros?: Record<string, number>) => evaluate(DEF, e, parametros ? { parametros } : {});
const disparadas = (r: ResultadoApoio) => r.trace.filter((t) => t.resultado === 'disparou').map((t) => t.regra).sort();
const res = (r: ResultadoApoio, id: string) => r.trace.find((t) => t.regra === id)!.resultado;
const op = (r: ResultadoApoio, id: string) => r.opcoes.find((o) => o.opcao === id);

// Casos-ouro por ramo
const COMPLETA_BASE: Entrada = { lesao_sintomatica_confirmada: true, tipo_rotura: 'completa', hamada: 2, artrose_glenoumeral: 'ausente' };
const GOLDEN: Record<string, Entrada> = {
  parcialArticularMaisMetade: { lesao_sintomatica_confirmada: true, tipo_rotura: 'parcial_articular', parcial_profundidade_pct: 60, falha_conservador: true, conservador_meses: 4 },
  parcialBursalAteMetade: { tipo_rotura: 'parcial_bursal', ellman: 2, falha_conservador: true },
  artropatia: { tipo_rotura: 'completa', hamada: 4 },
  artroseSemHamada: { tipo_rotura: 'completa', artrose_glenoumeral: 'grave' },
  traumatica: { ...COMPLETA_BASE, inicio: 'traumatico_agudo', reparabilidade_estimada: 'provavel_reparavel' },
  degenerativaFalha: { ...COMPLETA_BASE, inicio: 'degenerativo', falha_conservador: true, reparabilidade_estimada: 'provavel_reparavel' },
  degenerativaFalhaIrreparavel: { ...COMPLETA_BASE, inicio: 'degenerativo', falha_conservador: true, massiva: true, reparabilidade_estimada: 'provavel_irreparavel', pseudoparalisia: false },
  agudoSobreCronico: { ...COMPLETA_BASE, inicio: 'agudo_sobre_cronico' },
  reparavelPequena: { ...COMPLETA_BASE, reparabilidade_estimada: 'provavel_reparavel', tamanho_ap_mm: 25, diabetes: true, csa_graus: 42 },
  reparavelGrande: { ...COMPLETA_BASE, reparabilidade_estimada: 'provavel_reparavel', tamanho_ap_mm: 35, massiva: true },
  irreparavelZC1: { ...COMPLETA_BASE, reparabilidade_estimada: 'provavel_irreparavel', pseudoparalisia: false, goutallier_ssp: 3, tabagismo: 'atual', redondo_menor_trofismo: 'atrofico', deltoide_funcional: false, reparo_previo: true },
  sscIrreparavel: { ...COMPLETA_BASE, reparabilidade_estimada: 'provavel_irreparavel', subescapular_status: 'irreparavel', pseudoparalisia: false },
  sscReparavel: { ...COMPLETA_BASE, reparabilidade_estimada: 'provavel_irreparavel', subescapular_status: 'completo_reparavel' },
  pseudoparalisia: { ...COMPLETA_BASE, reparabilidade_estimada: 'provavel_irreparavel', pseudoparalisia: true },
  fatores: { ...COMPLETA_BASE, tangent_sign: true, tamanho_coronal_mm: 30, goutallier_isp: 2, gfdi: 1.2, modalidade_graduacao: 'RM', dah_mm: 5.5 },
};

describe('validação estrutural', () => {
  test('validateDefinition passa (sem lock: rascunho não registrado)', () => {
    expect(validateDefinition(DEF)).toEqual([]);
  });
  test('toda regra cita referência com PMID/DOI e nível', () => {
    const refs = new Map(DEF.referencias.map((r) => [r.id, r]));
    for (const r of DEF.regras) {
      expect(r.referencias.length, r.id).toBeGreaterThan(0);
      for (const c of r.referencias) {
        const x = refs.get(c.ref)!;
        expect(x.pmid || x.doi, `${r.id}/${c.ref}`).toBeTruthy();
        expect(x.nivel, `${r.id}/${c.ref}`).toBeTruthy();
      }
    }
  });
  test('idade não entra em nenhuma condição (idade contínua, sem corte)', () => {
    expect(entradasUsadas(DEF)).not.toContain('idade');
    const a = run({ ...GOLDEN.irreparavelZC1, idade: 45 });
    const b = run({ ...GOLDEN.irreparavelZC1, idade: 82 });
    expect(disparadas(a)).toEqual(disparadas(b));
    expect(a.opcoes).toEqual(b.opcoes);
  });
  test('Hamada entra só como grau registrado, nunca derivado da DAH em mm', () => {
    for (const r of DEF.regras) {
      if (entradasDaRegra(DEF, r.id).includes('dah_mm')) expect(r.aviso, r.id).toBe(true);
    }
    const r = run({ tipo_rotura: 'completa', dah_mm: 3 });
    expect(res(r, 'N4.1')).toBe('indeterminada');
  });
  test('vocabulário: nenhum texto de prescrição na definição', () => {
    const txt = JSON.stringify(DEF);
    expect(txt).not.toMatch(/contraindica|indicad[oa]|indica[çc][ãa]o|recomend|recommend|padr[ãa]o[- ]ouro/i);
  });
});

describe('casos-ouro por ramo', () => {
  test('parcial articular >50% com falha do conservador', () => {
    const r = run(GOLDEN.parcialArticularMaisMetade);
    expect(disparadas(r)).toEqual(['N2.1', 'N2.1b', 'N2.2', 'N2.3', 'ZC.PARCIAL_ARTICULAR'].sort());
    expect(op(r, 'tratamento_conservador')).toMatchObject({ forca: 'moderada', sentido: 'favorece' });
    expect(op(r, 'injecao_prp')).toMatchObject({ forca: 'moderada', sentido: 'favorece' });
    expect(op(r, 'reparo_lesao_parcial')).toMatchObject({ forca: 'fraca', sentido: 'favorece' });
    expect(op(r, 'reparo_transtendao')).toMatchObject({ forca: 'controversa', sentido: 'desfavorece' });
    expect(op(r, 'completar_e_reparar')).toMatchObject({ forca: 'controversa', sentido: 'desfavorece' });
    expect(r.avisos.map((a) => a.regra)).toEqual(['N2.1b']);
    // Nenhuma regra de lesão completa dispara
    expect(disparadas(r).some((id) => /^(N4|N5|N7|ZC1|ZC2)/.test(id))).toBe(false);
  });

  test('parcial ≤50% com falha: aviso de decisão individual, sem reparo sugerido', () => {
    const r = run(GOLDEN.parcialBursalAteMetade);
    expect(res(r, 'N2.4')).toBe('disparou');
    // Ellman 2 sem % de profundidade: ">50%" fica desconhecido (não vira falso nem dispara)
    expect(res(r, 'N2.3')).toBe('indeterminada');
    expect(op(r, 'reparo_lesao_parcial')).toBeUndefined();
    expect(res(r, 'ZC.PARCIAL_ARTICULAR')).toBe('nao_disparou');
    expect(res(run({ ...GOLDEN.parcialBursalAteMetade, parcial_profundidade_pct: 40 }), 'N2.3')).toBe('nao_disparou');
  });

  test('artropatia (Hamada ≥3 registrado): RSA favorecida, cautela com preservadoras', () => {
    const r = run(GOLDEN.artropatia);
    expect(op(r, 'rsa')).toMatchObject({ forca: 'fraca', sentido: 'favorece' });
    for (const id of ['ltt', 'scr', 'balao']) expect(op(r, id)?.sentido, id).toBe('desfavorece');
    expect(r.avisos.map((a) => a.regra)).toContain('N4.3');
    for (const id of ['N5A', 'N5B', 'N7.1', 'ZC1', 'ZC1-P']) expect(res(r, id), id).toBe('nao_disparou');
  });

  test('artrose grave sem Hamada basta para a via da artropatia (any)', () => {
    const r = run(GOLDEN.artroseSemHamada);
    expect(res(r, 'N4.1')).toBe('disparou');
    expect(res(r, 'N4.3')).toBe('indeterminada');
  });

  test('traumática aguda vs degenerativa', () => {
    const t = run(GOLDEN.traumatica);
    expect(res(t, 'N5A')).toBe('disparou');
    expect(res(t, 'N5B')).toBe('nao_disparou');
    expect(op(t, 'reparo_artroscopico')).toMatchObject({ forca: 'fraca', sentido: 'favorece' });
    expect(op(t, 'tratamento_conservador')).toBeUndefined();

    const d = run(GOLDEN.degenerativaFalha);
    expect(disparadas(d)).toEqual(expect.arrayContaining(['N5B', 'N5B.FALHA', 'N5B.ALERTA']));
    expect(res(d, 'N5A')).toBe('nao_disparou');
    expect(op(d, 'tratamento_conservador')?.sentido).toBe('favorece');
    expect(op(d, 'reparo_artroscopico')?.sentido).toBe('favorece');

    const a = run(GOLDEN.agudoSobreCronico);
    expect(a.avisos.map((v) => v.regra)).toEqual(['N5A.AGUDO_CRONICO']);
    expect(a.opcoes).toEqual([]);
  });

  test('roteamento N6: degenerativa com falha e "provavelmente irreparável" (massiva, sem artrose) não sugere reparo artroscópico', () => {
    const r = run(GOLDEN.degenerativaFalhaIrreparavel);
    expect(res(r, 'N5B.FALHA')).toBe('nao_disparou');
    expect(res(r, 'N7.1')).toBe('nao_disparou');
    expect(op(r, 'reparo_artroscopico')).toBeUndefined();
    expect(res(r, 'ZC1')).toBe('disparou');
    // nenhuma opção aparece como "favorece": tudo é alternativa da ZC1/ZC2 (ou cautela)
    expect(r.opcoes.filter((o) => o.sentido === 'favorece')).toEqual([]);
    expect(r.opcoes[0].sentido).toBe('alternativa');
    expect(op(r, 'tratamento_conservador')).toMatchObject({ sentido: 'alternativa', forca: 'controversa' });
    // traumática aguda estimada irreparável: N5A também não vaza
    const t = run({ ...GOLDEN.degenerativaFalhaIrreparavel, inicio: 'traumatico_agudo' });
    expect(res(t, 'N5A')).toBe('nao_disparou');
    expect(op(t, 'reparo_artroscopico')).toBeUndefined();
  });

  test('roteamento N6: degenerativa com falha e "provavelmente reparável" sugere reparo artroscópico (N5B.FALHA + N7.1)', () => {
    const r = run(GOLDEN.degenerativaFalha);
    expect(disparadas(r)).toEqual(expect.arrayContaining(['N5B.FALHA', 'N7.1']));
    expect(op(r, 'reparo_artroscopico')).toMatchObject({ sentido: 'favorece', forca: 'fraca' });
    expect(op(r, 'reparo_artroscopico')!.motivos.map((m) => m.regra).sort()).toEqual(['N5B.FALHA', 'N7.1']);
    // sem a estimativa de reparabilidade a regra fica indeterminada (não vira sugestão por omissão)
    const semEstimativa = run({ ...GOLDEN.degenerativaFalha, reparabilidade_estimada: undefined });
    expect(res(semEstimativa, 'N5B.FALHA')).toBe('indeterminada');
    expect(semEstimativa.faltantes.find((f) => f.entrada === 'reparabilidade_estimada')!.desbloqueia).toContain('N5B.FALHA');
  });

  test('lesão completa sem reparabilidade estimada: faltante crítico (aviso destacado), sem tornar o campo obrigatório', () => {
    const r = run(COMPLETA_BASE);
    const f = r.faltantes.find((x) => x.entrada === 'reparabilidade_estimada')!;
    expect(f.critica).toBe(true);
    expect(f.desbloqueia).toEqual(expect.arrayContaining(['N7.1']));
    expect(r.trace.find((t) => t.regra === 'N7.1')!.resultado).toBe('indeterminada');
    // Com a estimativa informada, nenhum faltante crítico
    expect(run(GOLDEN.reparavelPequena).faltantes.filter((x) => x.critica)).toEqual([]);
  });

  test('reparável <3 cm: zona de técnica simples vs dupla, ambas controversas', () => {
    const r = run(GOLDEN.reparavelPequena);
    expect(disparadas(r)).toEqual(expect.arrayContaining(['N7.1', 'ZC.TECNICA_MENOR_3CM', 'ZC.AUGMENTATION', 'N7.3', 'N7.FATORES_PRESENTES', 'N7.CSA']));
    expect(res(r, 'ZC.TECNICA_3CM_OU_MAIS')).toBe('nao_disparou');
    expect(op(r, 'reparo_fileira_simples')?.forca).toBe('controversa');
    expect(op(r, 'reparo_dupla_fileira')?.forca).toBe('controversa');
    expect(op(r, 'reparo_artroscopico')?.sentido).toBe('favorece');
    // Irreparável não entra
    for (const id of ['ZC1', 'ZC1-P', 'ZC2.IRREPARAVEL']) expect(res(r, id), id).toBe('nao_disparou');
  });

  test('reparável ≥3 cm e massiva', () => {
    const r = run(GOLDEN.reparavelGrande);
    expect(res(r, 'ZC.TECNICA_3CM_OU_MAIS')).toBe('disparou');
    expect(res(r, 'N7.MASSIVA')).toBe('disparou');
    const dupla = op(r, 'reparo_dupla_fileira')!;
    expect(dupla.forca).toBe('controversa');
    expect(dupla.controversias.find((c) => c.regra === 'ZC.TECNICA_3CM_OU_MAIS')!.alternativas.map((a) => a.opcao))
      .toEqual(['reparo_dupla_fileira', 'reparo_fileira_simples']);
  });

  test('irreparável sem pseudoparalisia: ZC1 e ZC2 sem vencedora, cautelas filtradas pelo paciente', () => {
    const r = run(GOLDEN.irreparavelZC1);
    expect(disparadas(r)).toEqual(expect.arrayContaining(['ZC1', 'ZC2.IRREPARAVEL', 'LTT.TABAGISMO', 'LTT.REDONDO_MENOR', 'LTT.DELTOIDE', 'BALAO.AXILAR', 'SCR.GOUTALLIER3', 'ZC2.REVISAO', 'ZC.GOUTALLIER3']));
    expect(res(r, 'ZC1-P')).toBe('nao_disparou');
    const zc1 = ['reparo_parcial', 'scr', 'ltt', 'balao', 'desbridamento_tenotomia', 'rsa', 'ponte_enxerto', 'tratamento_conservador'];
    // Alternativa de zona cinzenta, ou cautela quando uma cautela do paciente (fora da zona) iguala o favor
    for (const id of zc1) {
      const o = op(r, id)!;
      if (o.sentido === 'alternativa') expect(o.forca, id).toBe('controversa');
      else {
        expect(o.sentido, id).toBe('desfavorece');
        expect(o.motivos.some((m) => m.efeito === 'desfavorece' && !/^ZC/.test(m.regra)), id).toBe(true);
      }
    }
    for (const id of ['ltt', 'scr', 'balao']) expect(op(r, id)?.sentido, id).toBe('desfavorece');
    for (const id of ['reparo_parcial', 'desbridamento_tenotomia', 'rsa', 'ponte_enxerto', 'tratamento_conservador']) {
      expect(op(r, id)?.sentido, id).toBe('alternativa');
    }
    expect(op(r, 'ltt')!.motivos.filter((m) => m.efeito === 'desfavorece').map((m) => m.regra).sort())
      .toEqual(['LTT.DELTOIDE', 'LTT.REDONDO_MENOR', 'LTT.TABAGISMO']);
  });

  test('subescapular irreparável: cautela com balão, zona SSC e aviso de risco', () => {
    const r = run(GOLDEN.sscIrreparavel);
    expect(disparadas(r)).toEqual(expect.arrayContaining(['BALAO.SSC', 'ZC.SSC_IRREPARAVEL', 'N8.SSC_IRREPARAVEL', 'ZC1']));
    expect(op(r, 'aldtm')?.forca).toBe('controversa');
    const balao = op(r, 'balao')!;
    expect(balao.motivos.find((m) => m.regra === 'BALAO.SSC')).toMatchObject({ efeito: 'desfavorece', forca: 'fraca' });
    expect(res(r, 'ZC.SSC_REPARAVEL_LTT')).toBe('nao_disparou');
  });

  test('subescapular reparável com LTT: controverso', () => {
    const r = run(GOLDEN.sscReparavel);
    expect(res(r, 'ZC.SSC_REPARAVEL_LTT')).toBe('disparou');
    expect(op(r, 'ltt')?.forca).toBe('controversa');
    expect(res(r, 'BALAO.SSC')).toBe('nao_disparou');
  });

  test('pseudoparalisia: ZC1-P, cautela com balão e aviso de definição', () => {
    const r = run(GOLDEN.pseudoparalisia);
    expect(disparadas(r)).toEqual(expect.arrayContaining(['ZC1-P', 'BALAO.PSEUDO', 'PSEUDO.DEFINICAO', 'ZC2.IRREPARAVEL']));
    expect(res(r, 'ZC1')).toBe('nao_disparou');
    expect(op(r, 'rsa')?.forca).toBe('controversa');
    expect(op(r, 'scr')?.forca).toBe('controversa');
    expect(op(r, 'balao')?.sentido).toBe('desfavorece');
    expect(r.avisos.find((a) => a.regra === 'PSEUDO.DEFINICAO')!.texto).toMatch(/Pendente de decisão do cirurgião/);
  });

  test('balão: cautelas redigidas como "cautela", nunca proibição', () => {
    for (const id of ['BALAO.ARTROSE', 'BALAO.SSC', 'BALAO.PSEUDO', 'BALAO.AXILAR']) {
      const r = DEF.regras.find((x) => x.id === id)!;
      expect(r.motivo, id).toMatch(/^Cautela/);
      expect(r.efeitos, id).toEqual([{ opcao: 'balao', efeito: 'desfavorece', forca: 'fraca' }]);
    }
  });

  test('fatores de reparabilidade: avisos informativos, sem veredito', () => {
    const r = run(GOLDEN.fatores);
    expect(disparadas(r)).toEqual(expect.arrayContaining(['N6.PARK', 'N6.TANGENT', 'N6.GORDURA', 'N6.MODALIDADE', 'DAH.LACUNA']));
    expect(r.opcoes).toEqual([]);
  });

  test('fora de escopo sem lesão confirmada', () => {
    const r = run({ ...GOLDEN.traumatica, lesao_sintomatica_confirmada: false });
    expect(r.foraDeEscopo.map((f) => f.id)).toEqual(['ESC.SEM_LESAO']);
    expect(r.opcoes).toEqual([]);
  });
});

describe('zonas cinzentas', () => {
  const zonas = DEF.regras.filter((r) => r.id.startsWith('ZC'));

  test('as zonas da spec existem', () => {
    const ids = zonas.map((z) => z.id);
    for (const id of ['ZC1', 'ZC1-P', 'ZC2.IRREPARAVEL', 'ZC.TECNICA_MENOR_3CM', 'ZC.TECNICA_3CM_OU_MAIS', 'ZC.PARCIAL_ARTICULAR', 'ZC.AUGMENTATION']) {
      expect(ids, id).toContain(id);
    }
  });

  test.each(zonas.filter((z) => !z.aviso).map((z) => [z.id, z] as const))('%s tem controvérsia com alternativas referenciadas', (_id, z) => {
    expect(z.controversia?.nota.trim()).toBeTruthy();
    expect(z.controversia!.alternativas.length).toBeGreaterThanOrEqual(2);
    for (const a of z.controversia!.alternativas) expect(a.referencias.length).toBeGreaterThan(0);
  });

  test('ao disparar, toda opção afetada por zona cinzenta sai "controversa" com as alternativas', () => {
    const vistas = new Set<string>();
    for (const e of Object.values(GOLDEN)) {
      const r = run(e);
      for (const z of zonas.filter((x) => !x.aviso)) {
        if (res(r, z.id) !== 'disparou') continue;
        vistas.add(z.id);
        for (const ef of z.efeitos) {
          const o = op(r, ef.opcao)!;
          // 'controversa' (alternativa ou cautela vinda da zona), ou cautela de força definida por regra fora da zona
          const cautelaFirme = o.sentido === 'desfavorece' && o.motivos.some((m) => m.efeito === 'desfavorece' && !zonas.some((x) => x.id === m.regra));
          if (!cautelaFirme) expect(o.forca, `${z.id}/${ef.opcao}`).toBe('controversa');
          expect(o.sentido, `${z.id}/${ef.opcao}`).not.toBe('favorece');
          const c = o.controversias.find((x) => x.regra === z.id)!;
          expect(c.alternativas.length).toBe(z.controversia!.alternativas.length);
        }
      }
    }
    expect([...vistas].sort()).toEqual(zonas.filter((x) => !x.aviso).map((x) => x.id).sort());
  });

  test('ZC2 no reparável é informativa e não usa idade', () => {
    const z = DEF.regras.find((r) => r.id === 'ZC2.REPARAVEL')!;
    expect(z.aviso).toBe(true);
    expect(entradasDaRegra(DEF, z.id)).not.toContain('idade');
  });
});

describe('ausência nunca dispara', () => {
  test('entrada vazia: nenhuma regra dispara, nenhuma opção, nenhum aviso', () => {
    const r = run({});
    expect(disparadas(r)).toEqual([]);
    expect(r.opcoes).toEqual([]);
    expect(r.avisos).toEqual([]);
    expect(r.completude).toEqual({ avaliadas: 0, indeterminadas: DEF.regras.length, total: DEF.regras.length });
  });

  test('remover qualquer campo nunca faz uma regra passar a disparar', () => {
    for (const [nome, e] of Object.entries(GOLDEN)) {
      const base = new Set(disparadas(run(e)));
      for (const k of Object.keys(e)) {
        const { [k]: _omit, ...sem } = e;
        const novas = disparadas(run(sem)).filter((id) => !base.has(id));
        expect(novas, `${nome} sem ${k}`).toEqual([]);
      }
    }
  });

  test('sem reparabilidade estimada, ramos N7/N8 ficam indeterminados e pedem o dado', () => {
    const r = run({ ...COMPLETA_BASE, inicio: 'degenerativo' });
    for (const id of ['N7.1', 'ZC1', 'ZC2.IRREPARAVEL']) expect(res(r, id), id).toBe('indeterminada');
    expect(r.faltantes.map((f) => f.entrada)).toContain('reparabilidade_estimada');
  });
});

describe('parâmetros (pendentes de decisão do cirurgião)', () => {
  test('DAH 5–6 mm: padrão da spec marca a lacuna; resultado expõe valor e status', () => {
    expect(res(run({ dah_mm: 5.5 }), 'DAH.LACUNA')).toBe('disparou');
    expect(res(run({ dah_mm: 6 }), 'DAH.LACUNA')).toBe('disparou');
    expect(res(run({ dah_mm: 7 }), 'DAH.LACUNA')).toBe('nao_disparou');
    const r = run({ dah_mm: 5.5 });
    expect(r.parametros?.map((p) => [p.id, p.valor, p.origem, p.status])).toEqual([
      ['dah_lacuna_min_mm', 5, 'padrao', 'pendente_decisao_cirurgiao'],
      ['dah_lacuna_max_mm', 6, 'padrao', 'pendente_decisao_cirurgiao'],
    ]);
  });
  test('cirurgião pode sobrescrever a faixa', () => {
    const r = run({ dah_mm: 6.5 }, { dah_lacuna_max_mm: 7 });
    expect(res(r, 'DAH.LACUNA')).toBe('disparou');
    expect(r.parametros!.find((p) => p.id === 'dah_lacuna_max_mm')!.origem).toBe('contexto');
  });
});

describe('mapeamento payload → entrada', () => {
  const payload = {
    avaliacaoPreop: {
      comum: { data_avaliacao: '2026-03-10' },
      patologias: [{
        codigo: 'SH_RCT', schema: 'SH_RCT.diagnosis.v1',
        dados: {
          inicio: 'degenerativo', tipo_rotura_rm: 'completa', tendoes_rm: ['SSP', 'ISP'], tamanho_ap_mm_rm: 32,
          retracao_patte_rm: 2, goutallier: { SSP: 2, ISP: 3, SSC: 1 }, tangent_sign: true, hamada: 2,
          distancia_acromioumeral_mm: 7.5, pseudoparalisia: false, elevacao_ativa_graus: 150, elevacao_passiva_graus: 170,
          tratamento_conservador_meses: 8, reparo_previo: false, deltoide_funcional: true,
        },
      }],
    },
  };

  test('copia campos do pré-op, deriva GFDI e massiva, e registra proveniência', () => {
    const { entrada, proveniencia } = mapearEntradaManguito(payload, {
      paciente: { idade: 63.5, tabagismo: 'atual', diabetes: false, nivelAtividade: 'recreativo' },
      manual: { artrose_glenoumeral: 'ausente', reparabilidade_estimada: 'provavel_irreparavel', hamada: 4 },
    });
    expect(entrada).toMatchObject({
      inicio: 'degenerativo', tipo_rotura: 'completa', tendoes: ['SSP', 'ISP'], tamanho_ap_mm: 32, patte: 2,
      goutallier_ssp: 2, goutallier_isp: 3, goutallier_ssc: 1, tangent_sign: true, hamada: 2, dah_mm: 7.5,
      pseudoparalisia: false, conservador_meses: 8, reparo_previo: false, deltoide_funcional: true,
      tabagismo: 'atual', diabetes: false, nivel_atividade: 'recreativo', idade: 63.5,
      artrose_glenoumeral: 'ausente', reparabilidade_estimada: 'provavel_irreparavel', gfdi: 2, massiva: true,
    });
    expect(proveniencia.tipo_rotura).toEqual({ origem: 'payload', caminho: 'avaliacaoPreop[SH_RCT].tipo_rotura_rm' });
    expect(proveniencia.goutallier_isp.caminho).toMatch(/goutallier\.ISP$/);
    expect(proveniencia.tabagismo).toEqual({ origem: 'paciente', caminho: 'paciente.tabagismo', nota: 'cadastro do paciente' });
    expect(proveniencia.diabetes).toEqual({ origem: 'paciente', caminho: 'paciente.diabetes', nota: 'cadastro do paciente' });
    expect(proveniencia.nivel_atividade).toEqual({ origem: 'paciente', caminho: 'paciente.nivelAtividade', nota: 'cadastro do paciente' });
    expect(proveniencia.idade).toEqual({ origem: 'paciente', caminho: 'idade' });
    expect(proveniencia.artrose_glenoumeral).toEqual({ origem: 'manual' });
    expect(proveniencia.gfdi.origem).toBe('derivada');
    expect(proveniencia.massiva.origem).toBe('derivada');
    // Manual não sobrescreve o payload
    expect(proveniencia.hamada.origem).toBe('payload');
    // Campos não informados ficam ausentes (nunca 0/false)
    for (const k of ['goutallier_tm', 'ellman', 'parcial_profundidade_pct', 'tamanho_coronal_mm', 'falha_conservador', 'subescapular_status', 'imc']) {
      expect(k in entrada, k).toBe(false);
    }
    // A entrada mapeada é aceita pelo motor
    const r = evaluate(DEF, entrada);
    expect(res(r, 'ZC1')).toBe('disparou');
  });

  test('tabagismo, diabetes e nível de atividade vêm só do cadastro do paciente (campos antigos do pré-op são ignorados)', () => {
    const antigo = { avaliacaoPreop: { comum: { tabagismo: 'atual', diabetes: true, nivel_atividade: 'competitivo' }, patologias: [] } };
    expect(mapearEntradaManguito(antigo).entrada).toEqual({});
    // Valor fora do enum no cadastro (texto livre legado) fica ausente
    const r = mapearEntradaManguito({}, { paciente: { nivelAtividade: 'Sedentário' as never, diabetes: true } });
    expect(r.entrada).toEqual({ diabetes: true });
  });

  test('payload sem avaliação pré-op → entrada vazia (nada vira 0)', () => {
    expect(mapearEntradaManguito({})).toEqual({ entrada: {}, proveniencia: {} });
    const r = evaluate(DEF, mapearEntradaManguito({}).entrada);
    expect(disparadas(r)).toEqual([]);
  });

  test('derivações em três valores: GFDI só com SSP/ISP/SSC; massiva indeterminada sem dados', () => {
    const p = { avaliacaoPreop: { comum: {}, patologias: [{ codigo: 'SH_RCT', schema: 'SH_RCT.diagnosis.v1', dados: { tipo_rotura_rm: 'completa', goutallier: { SSP: 2, ISP: 2 } } }] } };
    const { entrada } = mapearEntradaManguito(p);
    expect('gfdi' in entrada).toBe(false);
    expect('massiva' in entrada).toBe(false);
    const parcial = { avaliacaoPreop: { comum: {}, patologias: [{ codigo: 'SH_RCT', schema: 'SH_RCT.diagnosis.v1', dados: { tipo_rotura_rm: 'parcial_bursal' } }] } };
    expect(mapearEntradaManguito(parcial).entrada.massiva).toBe(false);
    const umTendao = { avaliacaoPreop: { comum: {}, patologias: [{ codigo: 'SH_RCT', schema: 'SH_RCT.diagnosis.v1', dados: { tipo_rotura_rm: 'completa', tendoes_rm: ['SSP'], tamanho_ap_mm_rm: 20 } }] } };
    // Coronal ausente: não dá para afirmar "não massiva"
    expect('massiva' in mapearEntradaManguito(umTendao).entrada).toBe(false);
    expect(mapearEntradaManguito(umTendao, { manual: { tamanho_coronal_mm: 20 } }).entrada.massiva).toBe(false);
  });

  test('código filho do grupo usa o mesmo sub-bloco', () => {
    expect(mapearEntradaManguito(payload, { codigo: 'SH_RCT_MASSIVE' }).entrada.tipo_rotura).toBe('completa');
  });
});

describe('reparabilidade_estimada ausente', () => {
  // Casos completos (lesão completa, sem artropatia, sem pseudoparalisia, SSC íntegro) sem a estimativa de reparabilidade.
  const COMPLETO: Entrada = { ...COMPLETA_BASE, tamanho_ap_mm: 25, massiva: false, pseudoparalisia: false, subescapular_status: 'integro' };
  const CASOS: Record<string, { entrada: Entrada; regraInicio: string }> = {
    degenerativa: { entrada: { ...COMPLETO, inicio: 'degenerativo', falha_conservador: true, conservador_meses: 6 }, regraInicio: 'N5B.FALHA' },
    traumatica: { entrada: { ...COMPLETO, inicio: 'traumatico_agudo', semanas_desde_lesao: 2 }, regraInicio: 'N5A' },
  };
  const OPCOES_REPARO = ['reparo_artroscopico', 'reparo_fileira_simples', 'reparo_dupla_fileira', 'augmentation', 'reparo_parcial', 'reparo_lesao_parcial'];

  for (const [nome, { entrada, regraInicio }] of Object.entries(CASOS)) {
    test(`${nome}: regras de reparo ficam indeterminadas, nenhuma opção de reparo e a entrada aparece como faltante`, () => {
      const r = run(entrada);
      const regrasReparo = [regraInicio, 'N7.1', 'ZC.TECNICA_MENOR_3CM', 'ZC.AUGMENTATION'];
      for (const id of regrasReparo) {
        expect(entradasDaRegra(DEF, id), id).toContain('reparabilidade_estimada');
        expect(res(r, id), id).toBe('indeterminada');
      }
      // Técnica ≥3 cm também espera a estimativa quando o tamanho não a exclui
      expect(res(run({ ...entrada, tamanho_ap_mm: 35 }), 'ZC.TECNICA_3CM_OU_MAIS')).toBe('indeterminada');

      for (const id of OPCOES_REPARO) expect(op(r, id), id).toBeUndefined();

      const faltante = r.faltantes.find((f) => f.entrada === 'reparabilidade_estimada');
      expect(faltante).toBeDefined();
      expect(faltante!.desbloqueia).toEqual(expect.arrayContaining(regrasReparo));

      // Com a estimativa "provavelmente reparável" as mesmas regras se resolvem e o reparo aparece como sugestão
      const comEstimativa = run({ ...entrada, reparabilidade_estimada: 'provavel_reparavel' });
      for (const id of regrasReparo) expect(res(comEstimativa, id), id).toBe('disparou');
      expect(op(comEstimativa, 'reparo_artroscopico')?.sentido).toBe('favorece');
      expect(comEstimativa.faltantes.some((f) => f.entrada === 'reparabilidade_estimada')).toBe(false);
    });
  }
});
