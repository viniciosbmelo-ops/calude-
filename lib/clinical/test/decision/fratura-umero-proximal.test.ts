/** Fratura do úmero proximal (rascunho): casos-ouro por ramo, parâmetros, mensagem fixa, módulo informativo e mapeamento. */
import { describe, expect, test } from 'vitest';
import { evaluate } from '../../src/decision/engine';
import { validateDefinition, entradasUsadas } from '../../src/decision/validate';
import type { ResultadoApoio } from '../../src/decision/types';
import {
  FX_UMERO_PROXIMAL as DEF, MENSAGEM_FIXA_IDOSO, mapearEntradaFxUmeroProximal,
} from '../../src/decision/algorithms/fratura-umero-proximal';

type Entrada = Record<string, unknown>;

const disparadas = (r: ResultadoApoio) => r.trace.filter((t) => t.resultado === 'disparou').map((t) => t.regra).sort();
const opcoes = (r: ResultadoApoio) => Object.fromEntries(r.opcoes.map((o) => [o.opcao, o.forca]));
const avisos = (r: ResultadoApoio) => r.avisos.map((a) => a.regra).sort();
const temMensagemFixa = (r: ResultadoApoio) => r.avisos.some((a) => a.regra === 'N7.MENSAGEM_FIXA' && a.texto === MENSAGEM_FIXA_IDOSO);

/** Sem critérios de exclusão; resto por caso. */
const TRIAGEM: Entrada = { fratura_exposta: false, lesao_neurovascular: false, fratura_patologica: false, politrauma: false };
const IDOSO_2P: Entrada = {
  ...TRIAGEM, idade: 70, mecanismo_energia: 'baixa', deslocada: true, neer_partes: 2,
  segmentos_deslocados: ['colo_cirurgico'], fratura_luxacao: 'nenhuma', head_split: false,
};
const IDOSO_3P: Entrada = { ...IDOSO_2P, neer_partes: 3, segmentos_deslocados: ['colo_cirurgico', 'tuberosidade_maior'] };

const GOLDEN: { nome: string; entrada: Entrada; regras: string[]; opcoes: Record<string, string> }[] = [
  {
    nome: 'ZC-A fratura-luxação', entrada: { ...IDOSO_3P, fratura_luxacao: 'posterior' },
    regras: ['N1.ZC_A.FRATURA_LUXACAO', 'N9.INFO.PLACA_ACIMA_60'],
    opcoes: { reducao_fixacao: 'controversa', artroplastia: 'controversa' },
  },
  {
    nome: 'ZC-B head-split', entrada: { ...IDOSO_3P, head_split: true },
    regras: ['N2.ZC_B.HEAD_SPLIT', 'N9.INFO.PLACA_ACIMA_60'],
    opcoes: { reducao_fixacao: 'controversa', artroplastia: 'controversa' },
  },
  {
    nome: 'S1 não deslocada', entrada: { ...IDOSO_2P, deslocada: false, neer_partes: 1, segmentos_deslocados: [] },
    regras: ['N3.S1.NAO_DESLOCADA'],
    opcoes: { nao_operatorio: 'fraca' },
  },
  {
    nome: 'ZC-C tuberosidade maior isolada', entrada: { ...IDOSO_2P, segmentos_deslocados: ['tuberosidade_maior'] },
    regras: ['N4.ZC_C.TM_ISOLADA', 'N9.INFO.PLACA_ACIMA_60'],
    opcoes: { nao_operatorio: 'controversa', fixacao_tuberosidade: 'controversa' },
  },
  {
    nome: 'ZC-D jovem', entrada: { ...IDOSO_3P, idade: 45 },
    regras: ['N6.ZC_D.JOVEM_OU_ALTA_ENERGIA'],
    opcoes: { nao_operatorio: 'controversa', placa_bloqueada: 'controversa', haste_intramedular: 'controversa' },
  },
  {
    nome: 'ZC-D alta energia em idoso', entrada: { ...IDOSO_3P, mecanismo_energia: 'alta' },
    regras: ['N6.ZC_D.JOVEM_OU_ALTA_ENERGIA', 'N9.INFO.PLACA_ACIMA_60'],
    opcoes: { nao_operatorio: 'controversa', placa_bloqueada: 'controversa', haste_intramedular: 'controversa' },
  },
  {
    nome: 'S2 idoso 2 partes', entrada: IDOSO_2P,
    regras: ['N7.MENSAGEM_FIXA', 'N7.S2.DUAS_PARTES', 'N9.INFO.PLACA_ACIMA_60'],
    opcoes: { nao_operatorio: 'forte' },
  },
  {
    nome: 'ZC-E idoso 2 partes com cirurgia escolhida', entrada: { ...IDOSO_2P, cirurgia_escolhida: true },
    regras: ['N7.MENSAGEM_FIXA', 'N7.S2.DUAS_PARTES', 'N7.ZC_E.FIXACAO_DUAS_PARTES', 'N9.INFO.PLACA_ACIMA_60'],
    opcoes: { nao_operatorio: 'forte', placa_bloqueada: 'controversa', haste_intramedular: 'controversa' },
  },
  {
    nome: 'ZC-G idoso 3 partes', entrada: IDOSO_3P,
    regras: ['N7.MENSAGEM_FIXA', 'N8.ZC_G.TRES_QUATRO_PARTES', 'N9.INFO.PLACA_ACIMA_60'],
    opcoes: { nao_operatorio: 'controversa', placa_bloqueada: 'controversa', artroplastia_reversa: 'controversa', hemiartroplastia: 'controversa' },
  },
  {
    nome: 'ZC-F ≥80 anos 4 partes', entrada: { ...IDOSO_3P, idade: 82, neer_partes: 4 },
    regras: ['N7.MENSAGEM_FIXA', 'N8.ZC_F.OITENTA_MAIS', 'N8.ZC_G.TRES_QUATRO_PARTES', 'N9.INFO.PLACA_ACIMA_60'],
    opcoes: { nao_operatorio: 'controversa', placa_bloqueada: 'controversa', artroplastia_reversa: 'controversa', hemiartroplastia: 'controversa' },
  },
  {
    nome: 'S3 AO 11C2 com cirurgia escolhida', entrada: { ...IDOSO_3P, idade: 75, neer_partes: 4, ao_ota: '11C2', cirurgia_escolhida: true },
    regras: ['N7.MENSAGEM_FIXA', 'N8.S3.AO_C2_CIRURGIA', 'N8.ZC_G.TRES_QUATRO_PARTES', 'N9.INFO.PLACA_ACIMA_60'],
    opcoes: { nao_operatorio: 'controversa', placa_bloqueada: 'controversa', artroplastia_reversa: 'controversa', hemiartroplastia: 'controversa' },
  },
  {
    nome: 'ZC-H AO 11B2 com cirurgia escolhida', entrada: { ...IDOSO_3P, idade: 75, ao_ota: '11B2', cirurgia_escolhida: true },
    regras: ['N7.MENSAGEM_FIXA', 'N8.ZC_G.TRES_QUATRO_PARTES', 'N8.ZC_H.AO_B2_CIRURGIA', 'N9.INFO.PLACA_ACIMA_60'],
    opcoes: { nao_operatorio: 'controversa', placa_bloqueada: 'controversa', artroplastia_reversa: 'controversa', hemiartroplastia: 'controversa' },
  },
  {
    nome: 'idoso deslocada sem colo cirúrgico (fora da população)', entrada: { ...IDOSO_2P, segmentos_deslocados: ['colo_anatomico'] },
    regras: ['N7.FORA_POPULACAO', 'N9.INFO.HERTEL', 'N9.INFO.PLACA_ACIMA_60'],
    opcoes: {},
  },
];

describe('definição', () => {
  test('validateDefinition não aponta problemas', () => {
    expect(validateDefinition(DEF)).toEqual([]);
  });

  test('toda regra cita ≥1 referência com PMID/DOI e nível de evidência', () => {
    const refs = new Map(DEF.referencias.map((r) => [r.id, r]));
    for (const r of DEF.regras) {
      expect(r.referencias.length, r.id).toBeGreaterThan(0);
      for (const c of r.referencias) {
        const ref = refs.get(c.ref)!;
        expect(ref.pmid || ref.doi, `${r.id} → ${c.ref}`).toBeTruthy();
        expect(ref.nivel, `${r.id} → ${c.ref}`).toBeTruthy();
      }
    }
  });

  test('é rascunho: versão 0.x e parâmetros pendentes de decisão do cirurgião', () => {
    expect(DEF.versao.startsWith('0.')).toBe(true);
    const idade = DEF.parametros!.find((p) => p.id === 'idade_populacao_evidencia')!;
    expect(idade.padrao).toBe(60);
    expect(idade.status).toBe('pendente_decisao_cirurgiao');
    expect(DEF.parametros!.find((p) => p.id === 'limiar_dti')!.padrao).toBe(1.44);
  });

  test('zonas cinzentas não escolhem vencedora: mesma força em todos os efeitos, cada opção com alternativa', () => {
    const zcs = DEF.regras.filter((r) => r.controversia);
    expect(zcs.map((r) => r.id.split('.')[1]).sort()).toEqual(['ZC_A', 'ZC_B', 'ZC_C', 'ZC_D', 'ZC_E', 'ZC_F', 'ZC_G', 'ZC_H']);
    for (const r of zcs) {
      expect(new Set(r.efeitos.map((e) => `${e.efeito}/${e.forca}`)).size, r.id).toBe(1);
      expect(r.controversia!.alternativas.map((a) => a.opcao).sort(), r.id).toEqual(r.efeitos.map((e) => e.opcao).sort());
    }
  });

  test('medidas "requer texto completo" ou sem limiar validado não são lidas por nenhuma regra', () => {
    const usadas = new Set(entradasUsadas(DEF));
    for (const id of ['dobradica_medial_desviada_mm', 'desvio_tuberosidade_maior_mm', 'espessura_cortical_mm', 'dias_desde_lesao', 'asa', 'demanda_funcional']) {
      expect(usadas.has(id), id).toBe(false);
    }
  });

  test('textos exibidos usam só linguagem de sugestão', () => {
    const textos = [
      ...DEF.regras.flatMap((r) => [r.titulo, r.motivo, r.controversia?.nota ?? '', ...(r.controversia?.alternativas.map((a) => a.argumento) ?? [])]),
      ...DEF.foraDeEscopo.map((f) => f.texto), ...DEF.avisosGerais, ...DEF.opcoes.map((o) => o.rotulo),
      ...DEF.parametros!.map((p) => p.nota),
    ].join('\n');
    expect(textos).not.toMatch(/indicad|recomend|contraindic|sugere-se|indica[çc][ãa]o/i);
  });
});

describe('casos-ouro por ramo', () => {
  test.each(GOLDEN)('$nome', ({ entrada, regras, opcoes: esperado }) => {
    const r = evaluate(DEF, entrada);
    expect(r.rotulo).toBe('Sugestão');
    expect(r.foraDeEscopo).toEqual([]);
    expect(disparadas(r)).toEqual([...regras].sort());
    expect(opcoes(r)).toEqual(esperado);
    for (const o of r.opcoes) expect(o.sentido).toBe('favorece');
  });

  test.each(['fratura_exposta', 'lesao_neurovascular', 'fratura_patologica', 'politrauma'])('N0: %s → fora do escopo, sem opções', (campo) => {
    const r = evaluate(DEF, { ...IDOSO_2P, [campo]: true });
    expect(r.foraDeEscopo).toHaveLength(1);
    expect(r.foraDeEscopo[0].texto).toMatch(/Fora do escopo do algoritmo/i);
    expect(r.opcoes).toEqual([]);
    expect(r.avisos).toEqual([]);
    expect(r.trace.every((t) => t.resultado === 'fora_de_escopo')).toBe(true);
  });

  test('S3 mantém o motivo moderado da RSA sem torná-la vencedora (continua controversa pela ZC-G)', () => {
    const r = evaluate(DEF, GOLDEN.find((g) => g.nome.startsWith('S3'))!.entrada);
    const rsa = r.opcoes.find((o) => o.opcao === 'artroplastia_reversa')!;
    expect(rsa.forca).toBe('controversa');
    expect(rsa.motivos.some((m) => m.regra === 'N8.S3.AO_C2_CIRURGIA' && m.forca === 'moderada')).toBe(true);
  });

  test('deslocamento incoerente com Neer gera aviso de cautela', () => {
    const r = evaluate(DEF, { ...IDOSO_3P, deslocada: false });
    expect(avisos(r)).toContain('DADOS.DESLOCAMENTO_INCONSISTENTE');
  });
});

describe('parâmetro de idade da população de evidência', () => {
  test('padrão 60: 59 anos → ZC-D; 60 anos → ramo idoso com mensagem fixa', () => {
    const r59 = evaluate(DEF, { ...IDOSO_2P, idade: 59 });
    expect(disparadas(r59)).toContain('N6.ZC_D.JOVEM_OU_ALTA_ENERGIA');
    expect(disparadas(r59)).not.toContain('N7.S2.DUAS_PARTES');
    expect(temMensagemFixa(r59)).toBe(false);

    const r60 = evaluate(DEF, { ...IDOSO_2P, idade: 60 });
    expect(disparadas(r60)).not.toContain('N6.ZC_D.JOVEM_OU_ALTA_ENERGIA');
    expect(disparadas(r60)).toContain('N7.S2.DUAS_PARTES');
    expect(temMensagemFixa(r60)).toBe(true);
  });

  test('resultado expõe o valor usado, a origem e o status pendente', () => {
    const p = evaluate(DEF, IDOSO_2P).parametros!.find((x) => x.id === 'idade_populacao_evidencia')!;
    expect(p).toMatchObject({ valor: 60, origem: 'padrao', status: 'pendente_decisao_cirurgiao', unidade: 'anos' });
  });

  test('sobrescrito para 65 pelo contexto: 64 → ZC-D; 65 → ramo idoso', () => {
    const ctx = { parametros: { idade_populacao_evidencia: 65 } };
    const r64 = evaluate(DEF, { ...IDOSO_2P, idade: 64 }, ctx);
    expect(disparadas(r64)).toContain('N6.ZC_D.JOVEM_OU_ALTA_ENERGIA');
    expect(temMensagemFixa(r64)).toBe(false);
    expect(r64.parametros!.find((x) => x.id === 'idade_populacao_evidencia')).toMatchObject({ valor: 65, origem: 'contexto' });
    const r65 = evaluate(DEF, { ...IDOSO_2P, idade: 65 }, ctx);
    expect(temMensagemFixa(r65)).toBe(true);
  });
});

describe('mensagem fixa (N7)', () => {
  test.each([
    ['2 partes', IDOSO_2P],
    ['2 partes com cirurgia escolhida', { ...IDOSO_2P, cirurgia_escolhida: true }],
    ['3 partes', IDOSO_3P],
    ['4 partes, ≥80', { ...IDOSO_3P, neer_partes: 4, idade: 90 }],
    ['4 partes, AO 11C2, cirurgia escolhida', { ...IDOSO_3P, neer_partes: 4, idade: 75, ao_ota: '11C2', cirurgia_escolhida: true }],
  ])('exibida sempre no ramo idoso: %s', (_n, entrada) => {
    const r = evaluate(DEF, entrada);
    expect(temMensagemFixa(r)).toBe(true);
  });

  test('texto cita Cochrane e PROFHER com PMID', () => {
    expect(MENSAGEM_FIXA_IDOSO).toMatch(/35727196/);
    expect(MENSAGEM_FIXA_IDOSO).toMatch(/28249980/);
  });

  test.each([
    ['jovem', { ...IDOSO_2P, idade: 40 }],
    ['alta energia', { ...IDOSO_2P, mecanismo_energia: 'alta' }],
    ['não deslocada', { ...IDOSO_2P, deslocada: false, neer_partes: 1 }],
    ['fratura-luxação', { ...IDOSO_2P, fratura_luxacao: 'anterior' }],
  ])('não aparece fora do ramo: %s', (_n, entrada) => {
    expect(temMensagemFixa(evaluate(DEF, entrada))).toBe(false);
  });
});

describe('módulo informativo (N9) nunca produz opções', () => {
  test('estrutura: toda regra N9 é aviso sem efeitos', () => {
    const n9 = DEF.regras.filter((r) => r.id.startsWith('N9.'));
    expect(n9.length).toBe(4);
    for (const r of n9) {
      expect(r.aviso, r.id).toBe(true);
      expect(r.efeitos, r.id).toEqual([]);
    }
  });

  test('preditores presentes disparam avisos e não mudam as opções', () => {
    for (const base of [IDOSO_2P, IDOSO_3P, { ...IDOSO_3P, idade: 45 }]) {
      const sem = evaluate(DEF, { ...base, hertel_calcar_mm: 12, dobradica_medial_rompida: false, dti: 1.8, cominuicao_medial: false });
      const com = evaluate(DEF, { ...base, hertel_calcar_mm: 5, dobradica_medial_rompida: true, dti: 1.2, cominuicao_medial: true });
      expect(com.opcoes).toEqual(sem.opcoes);
      expect(avisos(com)).toEqual(expect.arrayContaining(['N9.INFO.HERTEL', 'N9.INFO.DTI', 'N9.INFO.SUPORTE_MEDIAL']));
      expect(avisos(sem)).not.toContain('N9.INFO.HERTEL');
      expect(avisos(sem)).not.toContain('N9.INFO.DTI');
    }
  });

  test('só com preditores (sem o resto do caso) não há opção alguma', () => {
    const r = evaluate(DEF, { deslocada: true, hertel_calcar_mm: 5, dti: 1.1, cominuicao_medial: true, idade: 70 });
    expect(r.opcoes).toEqual([]);
    expect(avisos(r)).toEqual(['N9.INFO.DTI', 'N9.INFO.HERTEL', 'N9.INFO.PLACA_ACIMA_60', 'N9.INFO.SUPORTE_MEDIAL']);
  });

  test('limiar do DTI é parâmetro (padrão 1,44)', () => {
    expect(avisos(evaluate(DEF, { ...IDOSO_2P, dti: 1.43 }))).toContain('N9.INFO.DTI');
    expect(avisos(evaluate(DEF, { ...IDOSO_2P, dti: 1.44 }))).not.toContain('N9.INFO.DTI');
    expect(avisos(evaluate(DEF, { ...IDOSO_2P, dti: 1.43 }, { parametros: { limiar_dti: 1.4 } }))).not.toContain('N9.INFO.DTI');
  });
});

describe('entradas ausentes nunca disparam regras', () => {
  test('entrada vazia: nada dispara, sem opções nem avisos', () => {
    const r = evaluate(DEF, {});
    expect(disparadas(r)).toEqual([]);
    expect(r.opcoes).toEqual([]);
    expect(r.avisos).toEqual([]);
    expect(r.foraDeEscopo).toEqual([]);
    expect(r.completude.indeterminadas).toBe(DEF.regras.length);
  });

  test.each(GOLDEN)('remover qualquer entrada de "$nome" não faz disparar regra nova', ({ entrada }) => {
    const base = new Set(disparadas(evaluate(DEF, entrada)));
    for (const k of Object.keys(entrada)) {
      const sem = { ...entrada };
      delete sem[k];
      for (const id of disparadas(evaluate(DEF, sem))) expect(base.has(id), `sem ${k}: ${id}`).toBe(true);
    }
  });

  test('sem idade, nenhum ramo dependente de idade dispara e a idade aparece como faltante', () => {
    const { idade: _i, ...sem } = IDOSO_2P;
    const r = evaluate(DEF, sem);
    expect(disparadas(r)).toEqual([]);
    expect(r.faltantes[0].entrada).toBe('idade');
  });
});

describe('mapeamento payload → entradas', () => {
  const payload = (dados: Record<string, unknown>) => ({
    avaliacaoPreop: { comum: {}, patologias: [{ codigo: 'SH_FX_PROX_HUM', schema: 'SH_FX_PROX_HUM.diagnosis.v1', dados }] },
  });

  test('lê o sub-bloco do payload v2 com proveniência e renomeia os campos do schema', () => {
    const { entrada, proveniencia } = mapearEntradaFxUmeroProximal(payload({
      neer_partes: 3, fratura_luxacao: 'nenhuma', head_split: false, ao_ota: '11C2',
      extensao_metafisaria_posteromedial_mm: 6, dobradica_medial_desviada_mm: 5, deltoid_tuberosity_index: 1.3,
      cominuicao_calcar: true, espessura_cortical_combinada_mm: 4, fratura_exposta: false, lesao_neurovascular: false, politrauma: false,
      desvio_tuberosidade_maior_mm: 0, dias_desde_lesao: 4, asa: 2,
    }), { idade: 77, manual: { mecanismo_energia: 'baixa', segmentos_deslocados: ['colo_cirurgico', 'tuberosidade_maior'], fratura_patologica: false } });

    expect(entrada).toMatchObject({
      idade: 77, neer_partes: 3, hertel_calcar_mm: 6, dti: 1.3, cominuicao_medial: true, espessura_cortical_mm: 4,
      dobradica_medial_desviada_mm: 5, desvio_tuberosidade_maior_mm: 0, deslocada: true, mecanismo_energia: 'baixa',
    });
    expect(proveniencia.neer_partes).toEqual({ de: 'payload', caminho: 'avaliacaoPreop[SH_FX_PROX_HUM].dados.neer_partes' });
    expect(proveniencia.hertel_calcar_mm).toEqual({ de: 'payload', caminho: 'avaliacaoPreop[SH_FX_PROX_HUM].dados.extensao_metafisaria_posteromedial_mm' });
    expect(proveniencia.idade).toEqual({ de: 'paciente', campo: 'idade' });
    expect(proveniencia.mecanismo_energia).toEqual({ de: 'manual' });
    expect(proveniencia.deslocada).toMatchObject({ de: 'derivada', dependeDe: ['neer_partes'] });
    // mm da dobradiça nunca vira "rompida" (corte >2 mm requer texto completo)
    expect('dobradica_medial_rompida' in entrada).toBe(false);

    const r = evaluate(DEF, entrada);
    expect(disparadas(r)).toEqual(expect.arrayContaining(['N7.MENSAGEM_FIXA', 'N8.ZC_G.TRES_QUATRO_PARTES', 'N9.INFO.HERTEL', 'N9.INFO.DTI']));
  });

  test('ausente, nulo, texto vazio e lista vazia ficam ausentes (nunca 0 nem false); 0 medido é mantido', () => {
    const { entrada, proveniencia } = mapearEntradaFxUmeroProximal(
      payload({ neer_partes: null, ao_ota: '', desvio_tuberosidade_maior_mm: 0 }),
      { idade: null, manual: { segmentos_deslocados: [], cirurgia_escolhida: null } },
    );
    expect(entrada).toEqual({ desvio_tuberosidade_maior_mm: 0 });
    expect(Object.keys(proveniencia)).toEqual(['desvio_tuberosidade_maior_mm']);
  });

  test('sem avaliação pré-operatória: só idade e respostas manuais', () => {
    const { entrada } = mapearEntradaFxUmeroProximal({}, { idade: 50, manual: { deslocada: false } });
    expect(entrada).toEqual({ idade: 50, deslocada: false });
  });

  test('resposta manual de "deslocada" prevalece sobre a derivação por Neer', () => {
    const { entrada, proveniencia } = mapearEntradaFxUmeroProximal(payload({ neer_partes: 2 }), { manual: { deslocada: false } });
    expect(entrada.deslocada).toBe(false);
    expect(proveniencia.deslocada).toEqual({ de: 'manual' });
    expect(avisos(evaluate(DEF, entrada))).toContain('DADOS.DESLOCAMENTO_INCONSISTENTE');
  });

  test('toda chave produzida é entrada declarada (evaluate não rejeita)', () => {
    const { entrada } = mapearEntradaFxUmeroProximal(payload({ neer_partes: 1, fratura_luxacao: 'nenhuma', head_split: false }), {
      idade: 30, manual: { mecanismo_energia: 'alta', dobradica_medial_rompida: true, demanda_funcional: 'alta', cirurgia_escolhida: false, fratura_patologica: false },
    });
    const ids = new Set(DEF.entradas.map((e) => e.id));
    for (const k of Object.keys(entrada)) expect(ids.has(k), k).toBe(true);
    expect(disparadas(evaluate(DEF, entrada))).toEqual(['N3.S1.NAO_DESLOCADA']);
  });
});
