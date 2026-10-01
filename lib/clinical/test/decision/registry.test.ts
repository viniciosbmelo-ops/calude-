/**
 * Registro dos algoritmos clínicos: chaves únicas, lock, aplicabilidade (códigos reais do catálogo),
 * aviso de níveis de evidência, formato dos caminhos de origem e mapeamento no servidor (mescla com manual).
 */
import { describe, expect, test } from 'vitest';
import {
  DECISION_ALGORITHMS, DECISION_MAPPERS, DECISION_VERSION_LOCK, createDecisionRegistry, decisionRegistry,
} from '../../src/decision/registry';
import { algorithmKey, hashDefinition } from '../../src/decision/hash';
import { statusEfetivo } from '../../src/decision/governance';
import { montarEntrada } from '../../src/decision/mapping';
import { evaluate } from '../../src/decision/engine';
import { AVISO_NIVEIS_EVIDENCIA } from '../../src/decision/vocab';
import { PATHOLOGY_BY_CODE } from '../../src/catalog/pathologies';

/** Família de códigos do catálogo aceita por algoritmo. */
const FAMILIA: Record<string, RegExp> = {
  SH_INST_ANT: /^SH_INST_ANT/,
  SH_RCT_DECISAO: /^SH_RCT/,
  FX_UMERO_PROXIMAL: /^SH_FX_PROX_HUM$/,
  EL_DBR_APOIO: /^EL_DBR$/,
};

/** Formatos de caminho que o pré-preenchimento da interface entende. */
const CAMINHO_RE = [
  /^avaliacaoPreop\[([A-Za-z0-9_]+)\]\.[A-Za-z0-9_.]+$/,
  /^avaliacaoPreop\.comum\.[A-Za-z0-9_.]+$/,
  /^procedimentos\[([A-Za-z0-9_]+)\]\.dados\.[A-Za-z0-9_.]+$/,
  /^geral\.[A-Za-z0-9_.]+$/,
];

describe('registro', () => {
  test('os quatro algoritmos estão registrados, com chaves únicas', () => {
    const chaves = DECISION_ALGORITHMS.map(algorithmKey);
    expect(new Set(chaves).size).toBe(chaves.length);
    expect(new Set(DECISION_ALGORITHMS.map((d) => d.id)).size).toBe(chaves.length);
    expect(DECISION_ALGORITHMS.map((d) => d.id).sort()).toEqual(Object.keys(FAMILIA).sort());
  });

  test('lock: exatamente as versões registradas, com o hash do conteúdo', () => {
    expect(Object.keys(DECISION_VERSION_LOCK).sort()).toEqual(DECISION_ALGORITHMS.map(algorithmKey).sort());
    for (const d of DECISION_ALGORITHMS) expect(DECISION_VERSION_LOCK[algorithmKey(d)], algorithmKey(d)).toBe(hashDefinition(d));
  });

  test('registrar não ativa: sem linha de status, toda versão é rascunho', () => {
    for (const e of decisionRegistry.list()) expect(statusEfetivo(undefined, e.hash)).toBe('rascunho');
  });

  test('todo algoritmo expõe o mapeador fora do hash', () => {
    for (const d of DECISION_ALGORITHMS) {
      const e = decisionRegistry.get(d.id, d.versao)!;
      expect(typeof e.mapear, algorithmKey(d)).toBe('function');
      expect(e.hash).toBe(createDecisionRegistry([d]).get(d.id, d.versao)!.hash);
      expect(JSON.stringify(d)).not.toContain('mapear');
    }
    expect(Object.keys(DECISION_MAPPERS).sort()).toEqual(DECISION_ALGORITHMS.map(algorithmKey).sort());
  });
});

describe.each(DECISION_ALGORITHMS.map((def) => ({ nome: algorithmKey(def), def })))('$nome', ({ def }) => {
  test('aplicabilidade: patologias com códigos reais do catálogo, da família do algoritmo', () => {
    expect(def.patologias.length).toBeGreaterThan(0);
    for (const p of def.patologias) {
      expect(PATHOLOGY_BY_CODE.has(p), p).toBe(true);
      expect(p).toMatch(FAMILIA[def.id]);
    }
  });

  test('aviso: níveis de evidência atribuídos pela equipe, pendentes de revisão do cirurgião', () => {
    expect(AVISO_NIVEIS_EVIDENCIA).toContain('atribuídos pela equipe, pendentes de revisão do cirurgião');
    expect(def.avisosGerais).toContain(AVISO_NIVEIS_EVIDENCIA);
  });

  test('caminhos de origem no formato do pré-preenchimento, apontando para a patologia do algoritmo', () => {
    for (const e of def.entradas) {
      if (e.origem.de !== 'payload' && e.origem.de !== 'intraop') continue;
      const caminho = e.origem.caminho;
      const m = CAMINHO_RE.map((re) => re.exec(caminho)).find(Boolean);
      expect(m, `${e.id}: ${caminho}`).toBeTruthy();
      const cod = m![1];
      if (cod) {
        const familia = (c: string) => [c, PATHOLOGY_BY_CODE.get(c)?.parent].filter(Boolean);
        expect(def.patologias.some((p) => familia(p).includes(cod) || familia(cod).includes(p)), `${e.id}: ${cod}`).toBe(true);
      }
    }
  });

  test('sem registro, o mapeador devolve entrada vazia aceita pelo motor', () => {
    const m = montarEntrada(def, decisionRegistry.get(def.id, def.versao)!.mapear, { payload: {} });
    expect(m.conflitos).toEqual([]);
    expect(() => evaluate(def, m.entrada)).not.toThrow();
  });
});

describe('montarEntrada: registro prevalece sobre o manual', () => {
  const inst = decisionRegistry.get('SH_INST_ANT', '0.1.0')!;
  const payload = {
    avaliacaoPreop: {
      comum: { data_avaliacao: '2026-03-10' },
      patologias: [{ codigo: 'SH_INST_ANT', schema: 'SH_INST_ANT.diagnosis.v2', dados: { n_luxacoes: 3, D_mm: 28, d_mm: 4.2, hsi_mm: 20 } }],
    },
  };

  test('manual preenche o que falta; divergência vira conflito; idade vem da data de nascimento', () => {
    const m = montarEntrada(inst.def, inst.mapear, { payload, dataNascimento: '2004-05-20', dataReferencia: '2026-04-01' }, {
      n_luxacoes: 1, isis_total: 4, gbl_pct: 30, idade: 40,
    });
    expect(m.entrada).toMatchObject({ n_luxacoes: 3, isis_total: 4, gbl_pct: 15, idade: 21 });
    expect(m.proveniencia.n_luxacoes).toEqual({ de: 'payload', caminho: 'avaliacaoPreop[SH_INST_ANT].n_luxacoes' });
    expect(m.proveniencia.isis_total).toEqual({ de: 'manual' });
    expect(m.proveniencia.gbl_pct.de).toBe('derivada');
    expect(m.proveniencia.idade.de).toBe('paciente');
    expect(m.conflitos).toEqual(expect.arrayContaining([
      { entrada: 'n_luxacoes', usado: 3, origemUsada: 'payload', descartado: 1, origemDescartada: 'manual' },
      { entrada: 'gbl_pct', usado: 15, origemUsada: 'derivada', descartado: 30, origemDescartada: 'manual' },
      { entrada: 'idade', usado: 21, origemUsada: 'paciente', descartado: 40, origemDescartada: 'manual' },
    ]));
    expect(m.conflitos).toHaveLength(3);
  });

  test('manual igual ao registro não gera conflito; sem contexto, tudo é manual', () => {
    expect(montarEntrada(inst.def, inst.mapear, { payload }, { n_luxacoes: 3 }).conflitos).toEqual([]);
    const s = montarEntrada(inst.def, inst.mapear, undefined, { n_luxacoes: 2 });
    expect(s).toEqual({ entrada: { n_luxacoes: 2 }, proveniencia: { n_luxacoes: { de: 'manual' } }, conflitos: [] });
  });

  test('manguito: derivada do registro (GFDI) prevalece sobre GFDI manual', () => {
    const rct = decisionRegistry.get('SH_RCT_DECISAO', '0.1.0')!;
    const p = { avaliacaoPreop: { comum: {}, patologias: [{ codigo: 'SH_RCT_FULL', schema: 'SH_RCT.diagnosis.v1', dados: { goutallier: { SSP: 2, ISP: 2, SSC: 2 } } }] } };
    const m = montarEntrada(rct.def, rct.mapear, { payload: p }, { gfdi: 3.5 });
    expect(m.entrada.gfdi).toBe(2);
    expect(m.conflitos).toEqual([{ entrada: 'gfdi', usado: 2, origemUsada: 'derivada', descartado: 3.5, origemDescartada: 'manual' }]);
  });
});
