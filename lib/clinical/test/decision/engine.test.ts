/** Semântica do motor, com o algoritmo FALSO de teste (fixtures.ts). */
import { describe, expect, test } from 'vitest';
import { ClinicalGuardError } from '../../src/errors';
import { avaliarCond } from '../../src/decision/conditions';
import { comUnidade, evaluate, MOTOR_VERSAO } from '../../src/decision/engine';
import { concordancia } from '../../src/decision/choice';
import { canonicalJson, hashDefinition, sha256Hex } from '../../src/decision/hash';
import { podeTransitar, statusEfetivo } from '../../src/decision/governance';
import type { Cond, V3 } from '../../src/decision/types';
import { FAKE, clone } from './fixtures';

const opcao = (r: ReturnType<typeof evaluate>, id: string) => r.opcoes.find((o) => o.opcao === id);
const trace = (r: ReturnType<typeof evaluate>, id: string) => r.trace.find((t) => t.regra === id)!.resultado;

describe('lógica de três valores (Kleene)', () => {
  // Folhas com valor conhecido: x=1 → T/F; campo "z" ausente → desconhecido
  const T: Cond = { campo: 'x', op: '==', valor: 1 };
  const F: Cond = { campo: 'x', op: '==', valor: 2 };
  const U: Cond = { campo: 'z', op: '==', valor: 1 };
  const leaf: Record<string, Cond> = { T, F, U };
  const v = (c: Cond): V3 => avaliarCond(c, { x: 1 }).v;
  const toV = (k: string): V3 => (k === 'T' ? true : k === 'F' ? false : 'desconhecido');
  const AND: Record<string, string> = { TT: 'T', TF: 'F', TU: 'U', FT: 'F', FF: 'F', FU: 'F', UT: 'U', UF: 'F', UU: 'U' };
  const OR: Record<string, string> = { TT: 'T', TF: 'T', TU: 'T', FT: 'T', FF: 'F', FU: 'U', UT: 'T', UF: 'U', UU: 'U' };

  test.each(Object.entries(AND))('all %s → %s', (k, r) => {
    expect(v({ all: [leaf[k[0]], leaf[k[1]]] })).toBe(toV(r));
  });
  test.each(Object.entries(OR))('any %s → %s', (k, r) => {
    expect(v({ any: [leaf[k[0]], leaf[k[1]]] })).toBe(toV(r));
  });
  test('not preserva desconhecido', () => {
    expect(v({ not: T })).toBe(false);
    expect(v({ not: F })).toBe(true);
    expect(v({ not: U })).toBe('desconhecido');
  });
  test('comparação com campo ausente é desconhecida e informa o campo faltante', () => {
    for (const op of ['<', '<=', '>', '>=', '==', '!='] as const) {
      const r = avaliarCond({ campo: 'z', op, valor: 0 }, {});
      expect(r).toEqual({ v: 'desconhecido', faltando: ['z'], valores: {} });
    }
    expect(avaliarCond({ campo: 'z', op: 'in', valores: [0] }, {}).v).toBe('desconhecido');
    expect(avaliarCond({ campo: 'z', op: 'contem', valor: 'a' }, {}).v).toBe('desconhecido');
    expect(avaliarCond({ campo: 'z', op: 'entre', min: 0, max: 1 }, {}).v).toBe('desconhecido');
  });
  test('all desconhecido acumula os faltantes; falso domina e zera faltantes', () => {
    const r = avaliarCond({ all: [{ campo: 'a', op: '>', valor: 1 }, { campo: 'b', op: '>', valor: 1 }] }, {});
    expect(r.faltando).toEqual(['a', 'b']);
    expect(avaliarCond({ all: [F, U] }, { x: 1 }).faltando).toEqual([]);
  });
  test('entre: limite inferior incluso, superior excluso salvo incluiMax', () => {
    const c = (x: number, incluiMax?: boolean) => avaliarCond({ campo: 'x', op: 'entre', min: 15, max: 25, incluiMax }, { x }).v;
    expect([c(14.9), c(15), c(24.9), c(25), c(25, true)]).toEqual([false, true, true, false, true]);
  });
});

describe('evaluate: ausência nunca dispara', () => {
  test('entrada vazia: nenhuma opção, todas as regras indeterminadas, nada vira false ou 0', () => {
    const r = evaluate(FAKE, {});
    expect(r.opcoes).toEqual([]);
    expect(r.avisos).toEqual([]);
    expect(r.trace.every((t) => t.resultado === 'indeterminada')).toBe(true);
    expect(r.completude).toEqual({ avaliadas: 0, indeterminadas: FAKE.regras.length, total: FAKE.regras.length });
    expect(r.entrada).toEqual({});
  });

  test('not(solo in encharcado) com solo ausente fica indeterminada, não dispara', () => {
    const r = evaluate(FAKE, { temperatura: 20 });
    expect(trace(r, 'R.SOLO')).toBe('indeterminada');
    expect(opcao(r, 'podar')!.motivos.map((m) => m.regra)).toEqual(['R.MORNO']);
  });

  const CASOS: Record<string, unknown>[] = [
    { temperatura: 32, solo: 'seco', chuva: 0, geada: false, ferramentas: ['lona'], area_coberta: false },
    { temperatura: 3, solo: 'encharcado', chuva: 40, geada: true, ferramentas: [], area_coberta: false },
    { temperatura: 20, solo: 'umido', chuva: 12, geada: false, ferramentas: ['mangueira'] },
  ];
  test.each(CASOS)('remover qualquer entrada não faz disparar regra que dependa dela (caso %#)', (caso) => {
    const base = evaluate(FAKE, caso);
    for (const k of Object.keys(caso)) {
      const sem = { ...caso };
      delete sem[k];
      const r = evaluate(FAKE, sem);
      for (const t of r.trace) {
        const antes = base.trace.find((x) => x.regra === t.regra)!.resultado;
        if (t.resultado === 'disparou') expect(antes, `${k} → ${t.regra}`).toBe('disparou');
      }
    }
  });

  test('null, undefined e texto vazio contam como ausentes', () => {
    const r = evaluate(FAKE, { temperatura: null, solo: '', chuva: undefined });
    expect(r.entrada).toEqual({});
    expect(r.faltantes.map((f) => f.entrada)).toContain('temperatura');
  });
});

describe('evaluate: resultado e agregação', () => {
  test('rótulo fixo "Sugestão", hash, versão do motor, avisos gerais', () => {
    const r = evaluate(FAKE, {});
    expect(r.rotulo).toBe('Sugestão');
    expect(r.algoritmo).toEqual({ id: FAKE.id, versao: FAKE.versao, hash: hashDefinition(FAKE), status: 'rascunho' });
    expect(r.motor).toBe(MOTOR_VERSAO);
    // 1.1.0: o resultado gravado sempre traz `parametros` (lista vazia quando a definição não declara)
    // 1.2.0: sentido líquido honesto ('alternativa' para zona cinzenta), rótulos de enum e vírgula decimal no texto
    // 1.2.1: '%' colado ao número no texto interpolado ("15%")
    // 1.3.0: faltante de entrada `critica` sai marcado
    expect(MOTOR_VERSAO).toBe('1.3.0');
    expect(Array.isArray(r.parametros)).toBe(true);
    expect(r.modo).toBe('preop');
    expect(r.avisosGerais).toEqual(FAKE.avisosGerais);
    const ctx = evaluate(FAKE, {}, { status: 'ativo', hash: 'abc', modo: 'registro' });
    expect(ctx.algoritmo.status).toBe('ativo');
    expect(ctx.algoritmo.hash).toBe('abc');
    expect(ctx.modo).toBe('registro');
  });

  test('saída não tem campos de escolha: nenhuma opção "vencedora"', () => {
    const r = evaluate(FAKE, { temperatura: 32, solo: 'seco' });
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/"(escolhida|recomendada|indicado|vencedora)"/);
  });

  test('regra disparada: opção com força, motivo interpolado com unidade, referências e trace com valores', () => {
    const r = evaluate(FAKE, { temperatura: 32, solo: 'seco' });
    expect(opcao(r, 'regar')).toEqual({
      opcao: 'regar', rotulo: 'Regar', forca: 'forte', sentido: 'favorece',
      motivos: [{ regra: 'R.CALOR', texto: 'Temperatura 32 °C com solo seco.', forca: 'forte', efeito: 'favorece' }],
      referencias: ['Alfa2001'], controversias: [],
    });
    expect(r.trace.find((t) => t.regra === 'R.CALOR')).toEqual({ regra: 'R.CALOR', resultado: 'disparou', valores: { temperatura: 32, solo: 'seco' }, faltando: [] });
    expect(r.referencias.map((x) => x.id)).toEqual(['Alfa2001', 'Beta2002', 'Gama2003']);
  });

  test('força da opção = maior força entre os efeitos que a favorecem', () => {
    const r = evaluate(FAKE, { chuva: 20, temperatura: 3 });
    const esperar = opcao(r, 'esperar')!;
    expect(esperar.forca).toBe('moderada');
    expect(esperar.motivos.map((m) => [m.regra, m.forca])).toEqual([['R.CHUVA', 'moderada'], ['R.FRIO', 'fraca']]);
  });

  test('cautela de força igual ou maior que o favor → "Cautela" com a força da cautela, nunca "favorece"', () => {
    const r = evaluate(FAKE, { temperatura: 32, solo: 'seco', chuva: 20 });
    const regar = opcao(r, 'regar')!;
    expect(regar).toMatchObject({ sentido: 'desfavorece', forca: 'forte' });
    expect(regar.motivos.map((m) => m.efeito)).toEqual(['favorece', 'desfavorece']);
    // cautela listada depois das favorecidas
    expect(r.opcoes.map((o) => o.opcao).indexOf('regar')).toBe(r.opcoes.length - 1);
  });

  test('cautela mais fraca que o favor: sentido "favorece" com a força do favor, os dois lados nos motivos', () => {
    const d = clone(FAKE);
    d.regras.find((x) => x.id === 'R.CHUVA')!.efeitos[0].forca = 'moderada';
    const regar = opcao(evaluate(d, { temperatura: 32, solo: 'seco', chuva: 20 }), 'regar')!;
    expect(regar).toMatchObject({ sentido: 'favorece', forca: 'forte' });
    expect(regar.motivos.map((m) => m.efeito)).toEqual(['favorece', 'desfavorece']);
  });

  test('cautela vinda só de zona cinzenta → "Cautela" com força controversa', () => {
    const d = clone(FAKE);
    d.regras.find((x) => x.id === 'R.GEADA')!.efeitos = [{ opcao: 'cobrir', efeito: 'desfavorece', forca: 'moderada' }];
    expect(opcao(evaluate(d, { geada: true }), 'cobrir')).toMatchObject({ sentido: 'desfavorece', forca: 'controversa' });
    // ...mas uma cautela fora de zona cinzenta de mesma força define a força
    d.regras.find((x) => x.id === 'R.LONA')!.efeitos = [{ opcao: 'cobrir', efeito: 'desfavorece', forca: 'moderada' }];
    expect(opcao(evaluate(d, { geada: true, ferramentas: ['lona'] }), 'cobrir')).toMatchObject({ sentido: 'desfavorece', forca: 'moderada' });
  });

  test('só desfavorece → cautela (sentido desfavorece), listada depois das que a literatura favorece', () => {
    const r = evaluate(FAKE, { chuva: 20 });
    expect(opcao(r, 'regar')).toMatchObject({ forca: 'forte', sentido: 'desfavorece' });
    expect(r.opcoes.map((o) => o.opcao)).toEqual(['esperar', 'regar']);
  });

  test('regra com controvérsia torna a opção controversa e expõe alternativas com referências', () => {
    const r = evaluate(FAKE, { geada: true, ferramentas: ['lona'] });
    const cobrir = opcao(r, 'cobrir')!;
    expect(cobrir.forca).toBe('controversa');
    // zona cinzenta: alternativa, nunca "favorece" (mesmo com R.LONA moderada a favor)
    expect(cobrir.sentido).toBe('alternativa');
    expect(cobrir.controversias).toEqual([{
      regra: 'R.GEADA', nota: FAKE.regras[2].controversia!.nota,
      alternativas: [{ opcao: 'podar', rotulo: 'Podar', argumento: 'Podar reduz a área exposta.', referencias: ['Beta2002'] }],
    }]);
    expect(cobrir.referencias).toEqual(['Beta2002', 'Gama2003']);
  });

  test('ordenação: favorece, depois alternativas de zona cinzenta, depois cautela', () => {
    const r = evaluate(FAKE, { geada: true, chuva: 20, solo: 'umido' });
    expect(r.opcoes.map((o) => [o.opcao, o.sentido])).toEqual([
      ['esperar', 'favorece'],
      ['podar', 'favorece'],
      ['cobrir', 'alternativa'],
      ['regar', 'desfavorece'],
    ]);
  });

  test('texto interpolado: rótulo do valor de enum/lista e número com vírgula decimal', () => {
    const d = clone(FAKE);
    const solo = d.entradas.find((e) => e.id === 'solo')!;
    if (solo.def.tipo === 'enum') solo.def.rotulos = { seco: 'Seco ao toque' };
    const ferr = d.entradas.find((e) => e.id === 'ferramentas')!;
    if (ferr.def.tipo === 'lista') ferr.def.rotulos = { lona: 'Lona plástica', regador: 'Regador manual' };
    const r = evaluate(d, { temperatura: 32.5, solo: 'seco', ferramentas: ['lona', 'regador'] });
    expect(opcao(r, 'regar')!.motivos[0].texto).toBe('Temperatura 32,5 °C com solo Seco ao toque.');
    expect(opcao(r, 'cobrir')!.motivos[0].texto).toBe('Ferramentas: Regador manual, Lona plástica.');
    // a entrada gravada continua com os valores internos
    expect(r.entrada.solo).toBe('seco');
  });

  test('unidade: "%" colado ao número (também "% da espessura"); demais unidades após espaço', () => {
    expect(comUnidade('15', '%')).toBe('15%');
    expect(comUnidade('13,5', '%')).toBe('13,5%');
    expect(comUnidade('60', '% da espessura')).toBe('60% da espessura');
    expect(comUnidade('23,9', 'mm')).toBe('23,9 mm');
    expect(comUnidade('5')).toBe('5');
    const d = clone(FAKE);
    const t = d.entradas.find((e) => e.id === 'temperatura')!;
    if (t.def.tipo === 'numero') t.def.unidade = '%';
    expect(opcao(evaluate(d, { temperatura: 32.5, solo: 'seco' }), 'regar')!.motivos[0].texto).toMatch(/32,5% com solo/);
  });

  test('concordância: alternativa de zona cinzenta conta como sugestão; opção sob cautela não', () => {
    const r = evaluate(FAKE, { geada: true });
    expect(r.opcoes.every((o) => o.sentido !== 'favorece' || o.opcao === 'esperar')).toBe(true);
    expect(concordancia(evaluate(FAKE, { geada: true, temperatura: 10 }), { opcao: 'cobrir' })).toBe('diverge');
    const soZona = evaluate(clone({ ...FAKE, regras: FAKE.regras.filter((x) => x.id === 'R.GEADA') }), { geada: true });
    expect(soZona.opcoes.map((o) => o.sentido)).toEqual(['alternativa']);
    expect(concordancia(soZona, { opcao: 'cobrir' })).toBe('concorda');
    expect(concordancia(evaluate(FAKE, { chuva: 20, temperatura: 10 }), { opcao: 'regar' })).toBe('diverge');
  });

  test('ordenação: força decrescente, depois ordem declarada', () => {
    const r = evaluate(FAKE, { temperatura: 20, solo: 'umido', chuva: 12, ferramentas: ['lona'] });
    expect(r.opcoes.map((o) => [o.opcao, o.forca, o.sentido])).toEqual([
      ['esperar', 'moderada', 'favorece'],
      ['cobrir', 'moderada', 'favorece'],
      ['podar', 'moderada', 'favorece'],
      ['regar', 'forte', 'desfavorece'],
    ]);
  });

  test('faltantes: cada entrada ausente lista as regras que desbloqueia, mais regras primeiro', () => {
    const r = evaluate(FAKE, { solo: 'seco', geada: false, chuva: 0, ferramentas: [], area_coberta: false });
    expect(r.faltantes).toEqual([
      { entrada: 'temperatura', rotulo: 'Temperatura', unidade: '°C', desbloqueia: ['R.CALOR', 'R.FRIO', 'R.MORNO'] },
    ]);
    // R.CALOR: solo=umido já torna o "all" falso → não depende mais da temperatura
    const r2 = evaluate(FAKE, { solo: 'umido', area_coberta: false });
    expect(r2.faltantes.find((f) => f.entrada === 'temperatura')!.desbloqueia).toEqual(['R.FRIO', 'R.MORNO']);
  });

  test('faltante de entrada `critica` sai marcado; entrada presente ou não crítica, não', () => {
    const def = clone(FAKE);
    def.entradas.find((e) => e.id === 'temperatura')!.critica = true;
    const r = evaluate(def, { solo: 'seco', geada: false, chuva: 0, ferramentas: [], area_coberta: false });
    expect(r.faltantes).toEqual([
      { entrada: 'temperatura', rotulo: 'Temperatura', unidade: '°C', desbloqueia: ['R.CALOR', 'R.FRIO', 'R.MORNO'], critica: true },
    ]);
    expect(evaluate(def, { temperatura: 10 }).faltantes.some((f) => f.critica)).toBe(false);
    expect(evaluate(FAKE, {}).faltantes.some((f) => 'critica' in f)).toBe(false);
    // A marca entra no hash: mudar a criticidade exige nova versão
    expect(hashDefinition(def)).not.toBe(hashDefinition(FAKE));
  });

  test('regra de aviso gera aviso, não opção', () => {
    const r = evaluate(FAKE, { vento_medido: 80 }, { modo: 'registro' });
    expect(r.avisos).toEqual([{ regra: 'R.VENTO', texto: 'Vento de 80 km/h no local.', referencias: ['Beta2002'] }]);
    expect(r.opcoes).toEqual([]);
  });

  test('modo preop descarta entradas intraoperatórias (ficam ausentes)', () => {
    const r = evaluate(FAKE, { vento_medido: 80 }, { modo: 'preop' });
    expect(r.entradasDescartadas).toEqual(['vento_medido']);
    expect(r.entrada).toEqual({});
    expect(trace(r, 'R.VENTO')).toBe('indeterminada');
    expect(r.avisos).toEqual([]);
    expect(r.faltantes.map((f) => f.entrada)).not.toContain('vento_medido');
    expect(evaluate(FAKE, {}, { modo: 'registro' }).faltantes.map((f) => f.entrada)).toContain('vento_medido');
  });

  test('fora de escopo: nenhuma opção nem aviso; regras marcadas fora_de_escopo', () => {
    const r = evaluate(FAKE, { area_coberta: true, temperatura: 32, solo: 'seco', vento_medido: 90 }, { modo: 'registro' });
    expect(r.foraDeEscopo).toEqual([{ id: 'ESC.COBERTA', texto: FAKE.foraDeEscopo[0].texto }]);
    expect(r.opcoes).toEqual([]);
    expect(r.avisos).toEqual([]);
    expect(r.trace.every((t) => t.resultado === 'fora_de_escopo')).toBe(true);
  });

  test('escopo sem dado não é tratado como "dentro": fica indeterminado e o dado entra nos faltantes', () => {
    const r = evaluate(FAKE, { temperatura: 32, solo: 'seco' });
    expect(r.escopoIndeterminado).toEqual([{ id: 'ESC.COBERTA', texto: FAKE.foraDeEscopo[0].texto, faltando: ['area_coberta'] }]);
    expect(r.faltantes.find((f) => f.entrada === 'area_coberta')!.desbloqueia).toEqual(['ESC.COBERTA']);
  });
});

describe('evaluate: guardas de entrada', () => {
  const guard = (entrada: Record<string, unknown>, code: string) => {
    try {
      evaluate(FAKE, entrada, { modo: 'registro' });
    } catch (e) {
      expect(e).toBeInstanceOf(ClinicalGuardError);
      expect((e as ClinicalGuardError).code).toBe(code);
      return;
    }
    throw new Error('deveria lançar ClinicalGuardError');
  };
  test('fora da faixa plausível', () => guard({ temperatura: 80 }, 'DS_OUT_OF_RANGE'));
  test('abaixo do mínimo', () => guard({ chuva: -1 }, 'DS_OUT_OF_RANGE'));
  test('número como texto não é convertido', () => guard({ temperatura: '30' }, 'DS_NOT_A_NUMBER'));
  test('NaN', () => guard({ temperatura: Number.NaN }, 'DS_NOT_A_NUMBER'));
  test('inteiro exigido', () => guard({ vento_medido: 10.5 }, 'DS_NOT_INTEGER'));
  test('booleano como texto', () => guard({ geada: 'sim' }, 'DS_NOT_A_BOOLEAN'));
  test('valor fora do enum', () => guard({ solo: 'arenoso' }, 'DS_INVALID_OPTION'));
  test('lista com valor inválido', () => guard({ ferramentas: ['pa'] }, 'DS_INVALID_OPTION'));
  test('entrada desconhecida', () => guard({ umidade: 3 }, 'DS_UNKNOWN_INPUT'));
});

describe('determinismo e hash', () => {
  test('duas avaliações idênticas; ordem da lista e das chaves não altera o resultado', () => {
    const a = evaluate(FAKE, { temperatura: 20, ferramentas: ['lona', 'mangueira'], solo: 'umido' });
    const b = evaluate(FAKE, { solo: 'umido', ferramentas: ['mangueira', 'lona', 'lona'], temperatura: 20 });
    expect(b).toEqual(a);
    expect(canonicalJson(b)).toBe(canonicalJson(a));
  });
  test('avaliar não altera a definição nem a entrada', () => {
    const def = clone(FAKE);
    const entrada = { temperatura: 32, solo: 'seco', ferramentas: ['lona', 'regador'] };
    const copia = clone(entrada);
    evaluate(def, entrada);
    expect(def).toEqual(FAKE);
    expect(entrada).toEqual(copia);
  });
  test('SHA-256 puro confere com vetores conhecidos', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  test('hash independe da ordem das chaves e muda com qualquer conteúdo', () => {
    const reordenado = Object.fromEntries(Object.entries(FAKE).reverse()) as typeof FAKE;
    expect(hashDefinition(reordenado)).toBe(hashDefinition(FAKE));
    const mudado = clone(FAKE);
    mudado.referencias[0].nivel = 'II';
    expect(hashDefinition(mudado)).not.toBe(hashDefinition(FAKE));
  });
});

describe('governança', () => {
  test('transições permitidas', () => {
    expect(podeTransitar('rascunho', 'revisado')).toBe(true);
    expect(podeTransitar('revisado', 'ativo')).toBe(true);
    expect(podeTransitar('revisado', 'rascunho')).toBe(true);
    expect(podeTransitar('ativo', 'aposentado')).toBe(true);
    expect(podeTransitar('rascunho', 'ativo')).toBe(false);
    expect(podeTransitar('aposentado', 'ativo')).toBe(false);
  });
  test('status efetivo: sem linha ou com hash diferente do código vale rascunho', () => {
    expect(statusEfetivo(undefined, 'h')).toBe('rascunho');
    expect(statusEfetivo({ status: 'ativo', hash: 'outro' }, 'h')).toBe('rascunho');
    expect(statusEfetivo({ status: 'ativo', hash: 'h' }, 'h')).toBe('ativo');
    expect(statusEfetivo({ status: 'xyz', hash: 'h' }, 'h')).toBe('rascunho');
  });
});
