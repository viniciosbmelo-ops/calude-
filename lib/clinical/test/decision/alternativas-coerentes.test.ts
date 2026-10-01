/**
 * Cartão de alternativa coerente nos 4 algoritmos (casos-ouro): uma opção que é alternativa de zona cinzenta e
 * também recebe efeito a favor de regra FORA da zona continua 'alternativa' (a zona não elege vencedor), e a
 * sugestão de fora da zona continua nos motivos (visível), para a interface rotulá-la pela origem.
 */
import { describe, expect, test } from 'vitest';
import { evaluate } from '../../src/decision/engine';
import { DECISION_ALGORITHMS } from '../../src/decision/registry';
import type { ResultadoApoio } from '../../src/decision/types';

const DEF = (id: string) => DECISION_ALGORITHMS.find((d) => d.id === id)!;
const TRIAGEM_FX = { fratura_exposta: false, lesao_neurovascular: false, fratura_patologica: false, politrauma: false };
const RCT_BASE = { lesao_sintomatica_confirmada: true, tipo_rotura: 'completa', hamada: 2, artrose_glenoumeral: 'ausente' };

/** [algoritmo, caso, entrada, opção com o padrão misto (ou null), regra fora da zona esperada nos motivos]. */
const CASOS: [string, string, Record<string, unknown>, string | null, string | null][] = [
  ['SH_RCT_DECISAO', 'degenerativa provável irreparável (ZC1 + N5B)',
    { ...RCT_BASE, inicio: 'degenerativo', falha_conservador: true, massiva: true, reparabilidade_estimada: 'provavel_irreparavel', pseudoparalisia: false },
    'tratamento_conservador', 'N5B'],
  ['SH_RCT_DECISAO', 'provável irreparável não degenerativa (só ZC1)',
    { ...RCT_BASE, reparabilidade_estimada: 'provavel_irreparavel', pseudoparalisia: false }, null, null],
  ['FX_UMERO_PROXIMAL', '4 partes AO C2, cirurgia escolhida (ZC-G + N8.S3)',
    { ...TRIAGEM_FX, idade: 75, mecanismo_energia: 'baixa', deslocada: true, neer_partes: 4, segmentos_deslocados: ['colo_cirurgico', 'tuberosidade_maior'], fratura_luxacao: 'nenhuma', head_split: false, ao_ota: '11C2', cirurgia_escolhida: true },
    'artroplastia_reversa', 'N8.S3.AO_C2_CIRURGIA'],
  ['EL_DBR_APOIO', 'completa aguda, baixa demanda (ZC baixa demanda + A1)',
    { tipo_ruptura: 'completa', dias_desde_lesao: 5, demanda_funcional: 'baixa', prioridade_supinacao: 'baixa', aceita_deficit_supinacao: true },
    'nao_operatorio', 'DBR.A1.NAO_OPERATORIO'],
  ['EL_DBR_APOIO', 'parcial, baixa demanda (C2 + demanda baixa)',
    { tipo_ruptura: 'parcial', pct_ruptura_parcial_rm: 30, demanda_funcional: 'baixa' }, 'nao_operatorio_inicial', 'DBR.C2.DEMANDA_BAIXA'],
  ['EL_DBR_APOIO', 'parcial, alta demanda (C2 + demanda alta)',
    { tipo_ruptura: 'parcial', pct_ruptura_parcial_rm: 70, demanda_funcional: 'alta' }, 'reparo_parcial', 'DBR.C2.DEMANDA_ALTA'],
  ['SH_INST_ANT', 'recorrente off-track (ZC-A/B/D + cautela)',
    { tipo_episodio: 'recorrente', gbl_pct: 15, track_status: 'off_track', gt_mm: 20.5, hsi_mm: 23.9, isis_total: 5 }, null, null],
  ['SH_INST_ANT', 'primeiro episódio off-track (ZC-E)',
    { tipo_episodio: 'primeiro_episodio', idade: 25, gbl_pct: 3, track_status: 'off_track' }, null, null],
];

/** Invariantes de leitura do cartão, válidos em qualquer resultado. */
function conferirCartoes(def: ReturnType<typeof DEF>, r: ResultadoApoio) {
  const disparadas = new Set(r.trace.filter((t) => t.resultado === 'disparou').map((t) => t.regra));
  for (const o of r.opcoes) {
    const zonas = new Set(o.controversias.map((c) => c.regra));
    // zona cinzenta nunca vira "favorece" (não há vencedor); a cautela firme pode prevalecer
    if (zonas.size) expect(o.sentido, o.opcao).not.toBe('favorece');
    if (o.sentido === 'alternativa') {
      expect(o.forca, o.opcao).toBe('controversa');
      expect(o.motivos.some((m) => zonas.has(m.regra) && m.efeito === 'favorece'), o.opcao).toBe(true);
    }
    // toda sugestão de fora da zona que disparou para a opção continua nos motivos
    for (const regra of def.regras.filter((x) => disparadas.has(x.id) && !x.controversia && !x.aviso)) {
      for (const ef of regra.efeitos.filter((e) => e.opcao === o.opcao)) {
        expect(o.motivos.some((m) => m.regra === regra.id && m.efeito === ef.efeito && m.forca === ef.forca), `${o.opcao}/${regra.id}`).toBe(true);
      }
    }
  }
}

describe('alternativa de zona cinzenta + sugestão de fora da zona (casos-ouro dos 4 algoritmos)', () => {
  test('os 4 algoritmos registrados estão cobertos', () => {
    expect([...new Set(CASOS.map((c) => c[0]))].sort()).toEqual(DECISION_ALGORITHMS.map((d) => d.id).sort());
  });

  test.each(CASOS)('%s: %s', (algo, _nome, entrada, opcaoMista, regraFora) => {
    const def = DEF(algo);
    const r = evaluate(def, entrada);
    expect(r.foraDeEscopo).toEqual([]);
    conferirCartoes(def, r);
    if (!opcaoMista) return;
    const o = r.opcoes.find((x) => x.opcao === opcaoMista)!;
    expect(o).toMatchObject({ sentido: 'alternativa', forca: 'controversa' });
    const fora = o.motivos.find((m) => m.regra === regraFora)!;
    expect(fora.efeito).toBe('favorece');
    expect(o.controversias.some((c) => c.regra === regraFora)).toBe(false);
  });
});
