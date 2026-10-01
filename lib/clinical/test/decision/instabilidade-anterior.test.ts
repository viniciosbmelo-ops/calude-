/**
 * SH_INST_ANT (rascunho): casos-ouro em cada lado de cada limiar, zonas cinzentas, ausência que nunca
 * dispara, mapeamento do payload v2 e validação estrutural. Importa a definição direto (não registrada).
 */
import { describe, expect, test } from 'vitest';
import { evaluate } from '../../src/decision/engine';
import { algorithmKey, hashDefinition } from '../../src/decision/hash';
import { validateDefinition } from '../../src/decision/validate';
import type { ResultadoApoio } from '../../src/decision/types';
import {
  INSTABILIDADE_ANTERIOR as DEF, entradaInstabilidadeAnterior, idadeEmAnos, tipoEpisodio,
} from '../../src/decision/algorithms/instabilidade-anterior';
import { ClinicalGuardError } from '../../src/errors';
import { scan } from '../../scripts/check-forbidden-terms';

const disparou = (r: ResultadoApoio) => r.trace.filter((t) => t.resultado === 'disparou').map((t) => t.regra);
const fired = (e: Record<string, unknown>, ctx = {}) => disparou(evaluate(DEF, e, ctx));
const opcao = (r: ResultadoApoio, id: string) => r.opcoes.find((o) => o.opcao === id);

const REC = { tipo_episodio: 'recorrente' };

describe('estrutura', () => {
  test('validateDefinition sem problemas (lock fornecido inline)', () => {
    expect(validateDefinition(DEF)).toEqual([]);
    expect(validateDefinition(DEF, { [algorithmKey(DEF)]: hashDefinition(DEF) })).toEqual([]);
  });

  test('rascunho: versão 0.x e resultado com status rascunho', () => {
    expect(DEF.versao.startsWith('0.')).toBe(true);
    expect(evaluate(DEF, {}).algoritmo.status).toBe('rascunho');
  });

  test('todas as decisões abertas são parâmetros pendentes de decisão do cirurgião, com padrão da especificação', () => {
    const p = Object.fromEntries((DEF.parametros ?? []).map((x) => [x.id, x]));
    expect(Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v.padrao]))).toEqual({
      gbl_critico_pct: 20, gbl_zc_a_inferior_pct: 10, near_track_dtd_mm: 8, isis_corte_alto: 6, isis_corte_baixo: 3,
    });
    for (const x of Object.values(p)) {
      expect(x.status).toBe('pendente_decisao_cirurgiao');
      expect(x.nota).toMatch(/Pendente de decisão do cirurgião/);
    }
    const r = evaluate(DEF, {});
    expect(r.parametros?.map((x) => x.status)).toEqual(Array(5).fill('pendente_decisao_cirurgiao'));
  });

  test('parâmetros entram no hash', () => {
    const outro = { ...DEF, parametros: DEF.parametros!.map((x) => (x.id === 'gbl_critico_pct' ? { ...x, padrao: 25 } : x)) };
    expect(hashDefinition(outro)).not.toBe(hashDefinition(DEF));
  });

  test('toda regra cita referência com PMID/DOI e nível; toda zona cinzenta tem controvérsia', () => {
    const refs = new Map(DEF.referencias.map((r) => [r.id, r]));
    for (const r of DEF.regras) {
      expect(r.referencias.every((c) => { const x = refs.get(c.ref); return x && (x.pmid || x.doi) && x.nivel; }), r.id).toBe(true);
      if (/ZC_/.test(r.id)) expect(r.controversia?.alternativas.length, r.id).toBeGreaterThan(0);
    }
  });

  test('ISIS é entrada manual (total), não calculado de itens', () => {
    const isis = DEF.entradas.find((e) => e.id === 'isis_total')!;
    expect(isis.origem).toEqual({ de: 'manual' });
    expect(DEF.entradas.some((e) => /hs_rx|contorno|isis_item/.test(e.id))).toBe(false);
  });

  test('guarda de termos passa', () => {
    expect(scan()).toEqual([]);
  });
});

describe('limiares: um caso de cada lado', () => {
  test('GBL crítica 20%: 19,9 → ZC-A; 20 → crítica', () => {
    expect(fired({ ...REC, gbl_pct: 19.9 })).toEqual(expect.arrayContaining(['N3.ZC_A']));
    expect(fired({ ...REC, gbl_pct: 19.9 })).not.toContain('N3.GBL_CRITICA');
    const r = evaluate(DEF, { ...REC, gbl_pct: 20 });
    expect(disparou(r)).toContain('N3.GBL_CRITICA');
    expect(disparou(r)).not.toContain('N3.ZC_A');
    expect(opcao(r, 'latarjet')).toMatchObject({ sentido: 'favorece', forca: 'forte' });
    expect(opcao(r, 'bankart_artro')).toMatchObject({ sentido: 'desfavorece', forca: 'forte' });
  });

  test('parâmetro sobrescrito no contexto (25%): 22 vira ZC-A', () => {
    expect(fired({ ...REC, gbl_pct: 22 })).toContain('N3.GBL_CRITICA');
    const r = evaluate(DEF, { ...REC, gbl_pct: 22 }, { parametros: { gbl_critico_pct: 25 } });
    expect(disparou(r)).toContain('N3.ZC_A');
    expect(r.parametros?.find((p) => p.id === 'gbl_critico_pct')).toMatchObject({ valor: 25, origem: 'contexto' });
  });

  test('limite inferior da ZC-A 10%: 9,9 fora; 10 dentro', () => {
    expect(fired({ ...REC, gbl_pct: 9.9 })).not.toContain('N3.ZC_A');
    expect(fired({ ...REC, gbl_pct: 10 })).toContain('N3.ZC_A');
  });

  test('near-track 8 mm: DTD 7,9 → ZC-C; 8 → não', () => {
    const base = { ...REC, gbl_pct: 5, track_status: 'on_track' };
    expect(fired({ ...base, dtd_mm: 7.9 })).toContain('N4.ZC_C');
    expect(fired({ ...base, dtd_mm: 8 })).not.toContain('N4.ZC_C');
  });

  test('ISIS corte alto (>6): 6 → ZC-D; 7 → alto', () => {
    expect(fired({ ...REC, isis_total: 6 })).toContain('N5.ZC_D');
    expect(fired({ ...REC, isis_total: 6 })).not.toContain('N5.ISIS_ALTO');
    const r = evaluate(DEF, { ...REC, isis_total: 7 });
    expect(disparou(r)).toContain('N5.ISIS_ALTO');
    expect(disparou(r)).not.toContain('N5.ZC_D');
    expect(opcao(r, 'bankart_artro')).toMatchObject({ sentido: 'desfavorece', forca: 'forte' });
  });

  test('ISIS corte baixo (≤3): 3 → baixo; 4 → ZC-D', () => {
    const base = { ...REC, gbl_pct: 5, track_status: 'on_track', dtd_mm: 12 };
    const r3 = evaluate(DEF, { ...base, isis_total: 3 });
    expect(disparou(r3)).toContain('N5.ISIS_BAIXO');
    expect(disparou(r3)).not.toContain('N5.ZC_D');
    expect(opcao(r3, 'bankart_artro')).toMatchObject({ sentido: 'favorece', forca: 'moderada' });
    expect(fired({ ...base, isis_total: 4 })).toContain('N5.ZC_D');
    expect(fired({ ...base, isis_total: 4 })).not.toContain('N5.ISIS_BAIXO');
  });

  test('ISIS baixo exige GBL <10% (literal da NMA): 9,9 dispara; 10 não', () => {
    const base = { ...REC, isis_total: 2, hill_sachs_presente: false };
    expect(fired({ ...base, gbl_pct: 9.9 })).toContain('N5.ISIS_BAIXO');
    expect(fired({ ...base, gbl_pct: 10 })).not.toContain('N5.ISIS_BAIXO');
  });

  test('ISIS baixo: on-track com DTD no limiar near-track (8) dispara; 7,9 não', () => {
    const base = { ...REC, isis_total: 2, gbl_pct: 5, track_status: 'on_track' };
    expect(fired({ ...base, dtd_mm: 8 })).toContain('N5.ISIS_BAIXO');
    expect(fired({ ...base, dtd_mm: 7.9 })).not.toContain('N5.ISIS_BAIXO');
  });

  test('idade: 19 → pediátrico; 20 → adulto (ZC-E); risco <20 só em 19', () => {
    const base = { tipo_episodio: 'primeiro_episodio', gbl_pct: 0 };
    const f19 = fired({ ...base, idade: 19 });
    expect(f19).toEqual(expect.arrayContaining(['N2A.PEDIATRICO', 'N5.RISCO.IDADE']));
    expect(f19).not.toContain('N2B.ZC_E');
    const f20 = fired({ ...base, idade: 20 });
    expect(f20).toContain('N2B.ZC_E');
    expect(f20).not.toContain('N2A.PEDIATRICO');
    expect(f20).not.toContain('N5.RISCO.IDADE');
  });

  test('ZC-E exige GBL abaixo do limite inferior da ZC-A: 9,9 dispara; 10 não', () => {
    const base = { tipo_episodio: 'primeiro_episodio', idade: 30 };
    expect(fired({ ...base, gbl_pct: 9.9 })).toContain('N2B.ZC_E');
    expect(fired({ ...base, gbl_pct: 10 })).not.toContain('N2B.ZC_E');
  });

  test('luxações >1: 1 não; 2 sim. Tempo >6 meses: 6 não; 6,5 sim', () => {
    expect(fired({ n_luxacoes: 1 })).not.toContain('N5.RISCO.LUXACOES');
    expect(fired({ n_luxacoes: 2 })).toContain('N5.RISCO.LUXACOES');
    expect(fired({ meses_desde_primeiro_episodio: 6 })).not.toContain('N5.RISCO.ATRASO');
    expect(fired({ meses_desde_primeiro_episodio: 6.5 })).toContain('N5.RISCO.ATRASO');
  });
});

describe('zonas cinzentas: controversa com alternativas', () => {
  const casos: [string, string, Record<string, unknown>, string[]][] = [
    ['ZC-A', 'N3.ZC_A', { ...REC, gbl_pct: 15 }, ['latarjet', 'bankart_remplissage', 'bankart_artro', 'estabilizacao_dinamica']],
    ['ZC-B', 'N4.ZC_B', { ...REC, gbl_pct: 5, track_status: 'off_track' }, ['bankart_remplissage', 'latarjet', 'latarjet_remplissage']],
    ['ZC-C', 'N4.ZC_C', { ...REC, gbl_pct: 5, track_status: 'on_track', dtd_mm: 4 }, ['bankart_artro', 'bankart_remplissage']],
    ['ZC-D', 'N5.ZC_D', { ...REC, isis_total: 5 }, ['bankart_artro', 'bankart_remplissage', 'latarjet']],
    ['ZC-E', 'N2B.ZC_E', { tipo_episodio: 'primeiro_episodio', idade: 25, gbl_pct: 3 }, ['bankart_artro', 'conservador']],
    ['ZC-F contato', 'N5.ZC_F.CONTATO', { ...REC, esporte_contato_ou_arremesso: true }, ['bankart_artro']],
    ['ZC-F hiperlaxidade', 'N5.ZC_F.HIPERLAXIDADE', { ...REC, hiperlaxidade: true }, ['bankart_artro']],
  ];
  test.each(casos)('%s', (_n, regra, entrada, alternativas) => {
    const r = evaluate(DEF, entrada);
    expect(disparou(r)).toContain(regra);
    for (const id of alternativas) {
      const o = opcao(r, id)!;
      expect(o, id).toBeDefined();
      expect(o.forca, id).toBe('controversa');
      const c = o.controversias.find((x) => x.regra === regra)!;
      expect(c.nota.length).toBeGreaterThan(20);
      expect(c.alternativas.map((a) => a.opcao)).toEqual(expect.arrayContaining(alternativas));
      for (const a of c.alternativas) expect(a.referencias.length).toBeGreaterThan(0);
    }
  });

  test('ZC-B: Bankart isolado não é alternativa e aparece como cautela forte (regra separada)', () => {
    const r = evaluate(DEF, { ...REC, gbl_pct: 5, track_status: 'off_track' });
    const zcb = DEF.regras.find((x) => x.id === 'N4.ZC_B')!;
    expect(zcb.controversia!.alternativas.map((a) => a.opcao)).not.toContain('bankart_artro');
    expect(opcao(r, 'bankart_artro')).toMatchObject({ sentido: 'desfavorece', forca: 'forte' });
    expect(disparou(r)).toContain('L7.CONFIABILIDADE_TRACK');
  });

  test('nenhuma zona cinzenta marca vencedora: todas as alternativas saem como controversa', () => {
    const r = evaluate(DEF, { ...REC, gbl_pct: 15 });
    expect(r.opcoes.every((o) => o.forca === 'controversa')).toBe(true);
    // zona cinzenta nunca leva "favorece": sai como alternativa
    expect(r.opcoes.every((o) => o.sentido === 'alternativa')).toBe(true);
  });

  test('caso-ouro off-track (GBL subcrítica na ZC-A, ISIS intermediário): Bankart isolado sai como cautela forte, nunca "favorece"', () => {
    const r = evaluate(DEF, { ...REC, gbl_pct: 15, track_status: 'off_track', gt_mm: 20.5, hsi_mm: 23.9, isis_total: 5 });
    // regras que, isoladas, favoreceriam o Bankart (ZC-A e ZC-D) disparam junto com a cautela off-track
    expect(disparou(r)).toEqual(expect.arrayContaining(['N3.ZC_A', 'N5.ZC_D', 'N4.OFF_TRACK.BANKART_ISOLADO', 'N4.ZC_B']));
    const bankart = opcao(r, 'bankart_artro')!;
    expect(bankart).toMatchObject({ sentido: 'desfavorece', forca: 'forte' });
    expect(bankart.motivos.find((m) => m.regra === 'N4.OFF_TRACK.BANKART_ISOLADO')).toMatchObject({ efeito: 'desfavorece', forca: 'forte' });
    expect(r.opcoes[r.opcoes.length - 1].opcao).toBe('bankart_artro');
    // as alternativas da ZC-B ficam como alternativas, sem "favorece"
    for (const id of ['bankart_remplissage', 'latarjet', 'latarjet_remplissage']) {
      expect(opcao(r, id), id).toMatchObject({ sentido: 'alternativa', forca: 'controversa' });
    }
    expect(r.opcoes.filter((o) => o.sentido === 'favorece')).toEqual([]);
    // texto da cautela com vírgula decimal (pt-BR)
    expect(bankart.motivos.find((m) => m.regra === 'N4.OFF_TRACK.BANKART_ISOLADO')!.texto).toContain('HSI 23,9 mm > GT 20,5 mm');
    // percentual sem espaço, como no resto da tela ("GBL 15%", nunca "GBL 15 %")
    const textos = r.opcoes.flatMap((o) => o.motivos.map((m) => m.texto));
    expect(textos.some((t) => t.includes('GBL 15%'))).toBe(true);
    for (const t of [...textos, ...r.avisos.map((x) => x.texto)]) expect(t).not.toMatch(/\d %/);
  });

  test('caso-ouro off-track em primeiro episódio sem perda óssea (ZC-E forte a favor): cautela forte prevalece', () => {
    const r = evaluate(DEF, { tipo_episodio: 'primeiro_episodio', idade: 25, gbl_pct: 3, track_status: 'off_track' });
    expect(disparou(r)).toEqual(expect.arrayContaining(['N2B.ZC_E', 'N4.OFF_TRACK.BANKART_ISOLADO']));
    expect(opcao(r, 'bankart_artro')).toMatchObject({ sentido: 'desfavorece', forca: 'forte' });
    expect(opcao(r, 'conservador')).toMatchObject({ sentido: 'alternativa', forca: 'controversa' });
  });

  test('aviso do track usa rótulo legível (sem id interno)', () => {
    const r = evaluate(DEF, { ...REC, track_status: 'off_track' });
    const a = r.avisos.find((x) => x.regra === 'L7.CONFIABILIDADE_TRACK')!;
    expect(a.texto).toContain('Off-track');
    expect(a.texto).not.toContain('off_track');
  });
});

describe('outros ramos', () => {
  test('falha após partes moles → Latarjet moderada; falha após coracoide → sem regras de GBL/track', () => {
    const r = evaluate(DEF, { tipo_episodio: 'falha_pos_estabilizacao_partes_moles', gbl_pct: 5 });
    expect(opcao(r, 'latarjet')).toMatchObject({ sentido: 'favorece', forca: 'moderada' });
    const c = fired({ tipo_episodio: 'falha_pos_transferencia_coracoide', gbl_pct: 30, track_status: 'off_track', isis_total: 9 });
    expect(c).toContain('N9.FALHA_CORACOIDE');
    for (const x of ['N3.GBL_CRITICA', 'N4.OFF_TRACK.BANKART_ISOLADO', 'N4.ZC_B', 'N5.ISIS_ALTO']) expect(c).not.toContain(x);
  });

  test('perda crítica + off-track gera aviso sobre remplissage associado', () => {
    expect(fired({ ...REC, gbl_pct: 25, track_status: 'off_track' })).toContain('N3.GBL_CRITICA.OFF_TRACK');
  });

  test('avisos: epilepsia, ALPSA, Bankart ósseo, esporte competitivo', () => {
    const r = evaluate(DEF, { epilepsia: true, lesoes_partes_moles: ['alpsa', 'bony_bankart'], esporte_competitivo: true });
    expect(r.avisos.map((a) => a.regra).sort()).toEqual(['N10.EPILEPSIA', 'N5.RISCO.ALPSA', 'N5.RISCO.ESPORTE_COMPETITIVO', 'N6.BANKART_OSSEO']);
    expect(r.opcoes).toEqual([]);
  });

  test('instabilidade voluntária: fora do escopo, sem opções', () => {
    const r = evaluate(DEF, { instabilidade_voluntaria: true, ...REC, gbl_pct: 30 });
    expect(r.foraDeEscopo.map((f) => f.id)).toEqual(['ESC.VOLUNTARIA']);
    expect(r.opcoes).toEqual([]);
  });
});

describe('ausência nunca dispara', () => {
  test('entrada vazia: nenhuma regra dispara, nenhuma opção', () => {
    const r = evaluate(DEF, {});
    expect(disparou(r)).toEqual([]);
    expect(r.opcoes).toEqual([]);
    expect(r.avisos).toEqual([]);
    expect(r.completude.avaliadas).toBe(0);
  });

  const CASOS: Record<string, unknown>[] = [
    { ...REC, gbl_pct: 22, track_status: 'off_track', dtd_mm: -2, gt_mm: 20, hsi_mm: 22, isis_total: 7, idade: 18, esporte_competitivo: true, esporte_contato_ou_arremesso: true, hiperlaxidade: true, n_luxacoes: 3, meses_desde_primeiro_episodio: 12, lesoes_partes_moles: ['alpsa'], epilepsia: true },
    { tipo_episodio: 'primeiro_episodio', idade: 25, gbl_pct: 5, track_status: 'on_track', dtd_mm: 4, isis_total: 5, hill_sachs_presente: true },
    { ...REC, gbl_pct: 8, track_status: 'on_track', dtd_mm: 12, isis_total: 2, instabilidade_voluntaria: false },
  ];
  test.each(CASOS.map((c, i) => [i, c] as const))('caso %i: remover qualquer entrada não faz disparar regra nova', (_i, caso) => {
    const antes = new Set(fired(caso));
    for (const k of Object.keys(caso)) {
      const sem = { ...caso };
      delete sem[k];
      const depois = fired(sem);
      for (const regra of depois) expect(antes.has(regra), `sem ${k}: ${regra}`).toBe(true);
      // regra de condição simples sobre a entrada removida fica indeterminada, nunca "não disparou"
      const r = evaluate(DEF, sem);
      for (const regra of DEF.regras.filter((x) => 'campo' in x.quando && x.quando.campo === k)) {
        expect(r.trace.find((t) => t.regra === regra.id)?.resultado, `${regra.id} sem ${k}`).toBe('indeterminada');
      }
    }
  });

  test('GBL ausente deixa as regras de GBL indeterminadas e lista GBL como faltante', () => {
    const r = evaluate(DEF, { ...REC });
    for (const id of ['N3.GBL_CRITICA', 'N3.ZC_A']) expect(r.trace.find((t) => t.regra === id)?.resultado).toBe('indeterminada');
    expect(r.faltantes.find((f) => f.entrada === 'gbl_pct')?.desbloqueia).toEqual(expect.arrayContaining(['N3.GBL_CRITICA', 'N3.ZC_A']));
  });
});

describe('mapeamento do payload v2', () => {
  const payload = {
    avaliacaoPreop: {
      comum: { data_avaliacao: '2026-03-10' },
      patologias: [{
        codigo: 'SH_INST_ANT', schema: 'SH_INST_ANT.diagnosis.v2',
        dados: {
          episodes: '2_to_5', prior_surgery: 'none', sport_competitive: true, sport_contact_or_forced_overhead: false,
          n_luxacoes: 3, meses_desde_primeiro_episodio: 14, soft_tissue_lesions: ['bankart', 'alpsa'],
          D_mm: 28, d_mm: 4.2, hsi_mm: 20, gbl_pct_direto: 18,
        },
      }],
    },
  };

  test('valores, derivadas e proveniência', () => {
    const m = entradaInstabilidadeAnterior(payload, { dataNascimento: '2004-05-20', manual: { isis_total: 5 } });
    expect(m.entrada).toEqual({
      esporte_competitivo: true, esporte_contato_ou_arremesso: false, n_luxacoes: 3, meses_desde_primeiro_episodio: 14,
      lesoes_partes_moles: ['bankart', 'alpsa'], D_mm: 28, d_mm: 4.2, hsi_mm: 20,
      idade: 21, tipo_episodio: 'recorrente', gbl_pct: 15, gt_mm: 19.0, track_status: 'off_track', dtd_mm: -1,
      isis_total: 5,
    });
    expect(m.proveniencia).toMatchObject({
      esporte_competitivo: 'payload', D_mm: 'payload', idade: 'paciente', tipo_episodio: 'derivada',
      gbl_pct: 'derivada', gt_mm: 'derivada', track_status: 'derivada', dtd_mm: 'derivada', isis_total: 'manual',
    });
    expect(m.conflitos).toEqual([{ entrada: 'gbl_pct', usado: 15, descartado: 18, origemDescartada: 'payload' }]);
    // A entrada mapeada é aceita pelo motor
    const r = evaluate(DEF, m.entrada);
    expect(disparou(r)).toEqual(expect.arrayContaining(['N3.ZC_A', 'N4.ZC_B', 'N4.OFF_TRACK.BANKART_ISOLADO', 'N5.ZC_D', 'N5.RISCO.ALPSA']));
  });

  test('campos inexistentes ficam ausentes (nunca 0/false)', () => {
    const m = entradaInstabilidadeAnterior({ avaliacaoPreop: { comum: {}, patologias: [{ codigo: 'SH_INST_ANT', schema: 'SH_INST_ANT.diagnosis.v2', dados: { D_mm: 28 } }] } });
    expect(m.entrada).toEqual({ D_mm: 28 });
    expect(entradaInstabilidadeAnterior({}).entrada).toEqual({});
  });

  test('GBL direta do laudo quando não há D e d', () => {
    const m = entradaInstabilidadeAnterior({ avaliacaoPreop: { comum: {}, patologias: [{ codigo: 'SH_INST_ANT', schema: 'SH_INST_ANT.diagnosis.v2', dados: { gbl_pct_direto: 12 } }] } });
    expect(m.entrada).toEqual({ gbl_pct: 12 });
    expect(m.proveniencia).toEqual({ gbl_pct: 'payload' });
  });

  test('manual não sobrescreve payload: divergência vira conflito', () => {
    const m = entradaInstabilidadeAnterior(payload, { manual: { n_luxacoes: 1, hill_sachs_presente: true } });
    expect(m.entrada.n_luxacoes).toBe(3);
    expect(m.entrada.hill_sachs_presente).toBe(true);
    expect(m.conflitos).toContainEqual({ entrada: 'n_luxacoes', usado: 3, descartado: 1, origemDescartada: 'manual' });
    expect(() => entradaInstabilidadeAnterior(payload, { manual: { foo: 1 } })).toThrow(ClinicalGuardError);
  });

  test('medida implausível lança ClinicalGuardError', () => {
    const p = { avaliacaoPreop: { comum: {}, patologias: [{ codigo: 'SH_INST_ANT', schema: 'SH_INST_ANT.diagnosis.v2', dados: { D_mm: 28, d_mm: 30 } }] } };
    expect(() => entradaInstabilidadeAnterior(p)).toThrow(ClinicalGuardError);
  });

  test('tipo de episódio', () => {
    expect(tipoEpisodio({ episodes: 'first' })).toBe('primeiro_episodio');
    expect(tipoEpisodio({ episodes: 'gt_5', prior_surgery: 'none' })).toBe('recorrente');
    expect(tipoEpisodio({ episodes: 'gt_5' })).toBeUndefined();
    expect(tipoEpisodio({ episodes: '2_to_5', n_cirurgias_estabilizacao_previas: 0 })).toBe('recorrente');
    expect(tipoEpisodio({ prior_surgery: 'open_bankart' })).toBe('falha_pos_estabilizacao_partes_moles');
    expect(tipoEpisodio({ prior_surgery: 'latarjet' })).toBe('falha_pos_transferencia_coracoide');
    expect(tipoEpisodio({ prior_surgery: 'other', episodes: 'gt_5' })).toBeUndefined();
    expect(tipoEpisodio({})).toBeUndefined();
  });

  test('idade em anos completos', () => {
    expect(idadeEmAnos('2000-06-15', '2020-06-14')).toBe(19);
    expect(idadeEmAnos('2000-06-15', '2020-06-15')).toBe(20);
    expect(idadeEmAnos('2000-06-15', undefined)).toBeUndefined();
    expect(idadeEmAnos('15/06/2000', '2020-06-15')).toBeUndefined();
  });
});
