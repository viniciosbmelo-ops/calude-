/**
 * Testes estruturais: rodam sobre TODO algoritmo registrado (DECISION_ALGORITHMS)
 * e sobre o algoritmo falso de teste. Não dependem de conteúdo clínico.
 */
import { describe, expect, test } from 'vitest';
import { DECISION_ALGORITHMS, DECISION_VERSION_LOCK, createDecisionRegistry } from '../../src/decision/registry';
import { algorithmKey, hashDefinition } from '../../src/decision/hash';
import { camposDe } from '../../src/decision/conditions';
import { validateDefinition } from '../../src/decision/validate';
import type { AlgorithmDef } from '../../src/decision/types';
import { FAKE, FAKE_LOCK, clone } from './fixtures';

const TODOS: { nome: string; def: AlgorithmDef; lock: Readonly<Record<string, string>> }[] = [
  ...DECISION_ALGORITHMS.map((def) => ({ nome: algorithmKey(def), def, lock: DECISION_VERSION_LOCK })),
  { nome: `${algorithmKey(FAKE)} (teste)`, def: FAKE, lock: FAKE_LOCK },
];

describe.each(TODOS)('estrutura de $nome', ({ def, lock }) => {
  const refs = new Map(def.referencias.map((r) => [r.id, r]));

  test('toda regra tem ≥1 referência com PMID ou DOI e nível de evidência', () => {
    for (const r of def.regras) {
      const ok = r.referencias.map((c) => refs.get(c.ref)).filter((x) => x && (x.pmid || x.doi) && x.nivel);
      expect(ok.length, `regra ${r.id}`).toBeGreaterThan(0);
    }
  });

  test('toda entrada usada por regra ou escopo está declarada', () => {
    const declaradas = new Set(def.entradas.map((e) => e.id));
    for (const r of def.regras) for (const c of camposDe(r.quando)) expect(declaradas.has(c), `regra ${r.id}: ${c}`).toBe(true);
    for (const f of def.foraDeEscopo) for (const c of camposDe(f.quando)) expect(declaradas.has(c), `escopo ${f.id}: ${c}`).toBe(true);
  });

  test('hash gravado no lock confere com o conteúdo', () => {
    expect(lock[algorithmKey(def)]).toBe(hashDefinition(def));
  });

  test('opções citadas por regras (efeitos e alternativas) existem', () => {
    const opcoes = new Set(def.opcoes.map((o) => o.id));
    for (const r of def.regras) {
      for (const e of r.efeitos) expect(opcoes.has(e.opcao), `regra ${r.id}: ${e.opcao}`).toBe(true);
      for (const a of r.controversia?.alternativas ?? []) expect(opcoes.has(a.opcao), `regra ${r.id}: ${a.opcao}`).toBe(true);
    }
  });

  test('todo valor de enum/lista tem rótulo legível', () => {
    if (def === FAKE) return; // o exemplo de teste não exibe rótulos
    for (const e of def.entradas) {
      if (e.def.tipo !== 'enum' && e.def.tipo !== 'lista') continue;
      for (const v of e.def.valores) expect(e.def.rotulos?.[v]?.trim(), `${e.id}: ${v}`).toBeTruthy();
    }
  });

  test('textos exibidos não citam ids internos (parâmetros, entradas, valores de enum, opções)', () => {
    const ids = new Set<string>([
      ...(def.parametros ?? []).map((p) => p.id),
      ...def.entradas.filter((e) => e.id.includes('_')).map((e) => e.id),
      ...def.entradas.flatMap((e) => (e.def.tipo === 'enum' || e.def.tipo === 'lista' ? e.def.valores.filter((v) => v.includes('_')) : [])),
      ...def.opcoes.filter((o) => o.id.includes('_')).map((o) => o.id),
    ]);
    const textos: [string, string][] = [
      ['titulo', def.titulo], ['escopo', def.escopo],
      ...def.foraDeEscopo.map((f): [string, string] => [f.id, f.texto]),
      ...def.avisosGerais.map((a, i): [string, string] => [`aviso geral ${i}`, a]),
      ...def.entradas.map((e): [string, string] => [`entrada ${e.id}`, e.rotulo]),
      ...def.opcoes.map((o): [string, string] => [`opção ${o.id}`, o.rotulo]),
      ...(def.parametros ?? []).flatMap((p): [string, string][] => [[`parâmetro ${p.id}`, p.rotulo], [`parâmetro ${p.id}`, p.nota]]),
      ...def.regras.flatMap((r): [string, string][] => [
        [r.id, r.titulo], [r.id, r.motivo.replace(/\{[A-Za-z0-9_]+\}/g, '')],
        ...(r.controversia ? [[r.id, r.controversia.nota] as [string, string], ...r.controversia.alternativas.map((a): [string, string] => [r.id, a.argumento])] : []),
      ]),
    ];
    for (const [onde, t] of textos) for (const id of ids) expect(new RegExp(`\\b${id}\\b`).test(t), `${onde}: "${id}"`).toBe(false);
  });

  test('validateDefinition completo não aponta problemas', () => {
    expect(validateDefinition(def, lock)).toEqual([]);
  });
});

describe('lock de versões', () => {
  test('toda entrada do lock corresponde a um algoritmo registrado', () => {
    const registrados = new Set(DECISION_ALGORITHMS.map(algorithmKey));
    expect(Object.keys(DECISION_VERSION_LOCK).filter((k) => !registrados.has(k))).toEqual([]);
  });

  test('registro não aceita id@versão duplicado', () => {
    expect(() => createDecisionRegistry([FAKE, clone(FAKE)])).toThrow(/duplicidade/);
  });

  test('registro expõe hash do código e hash do lock', () => {
    const reg = createDecisionRegistry([FAKE], FAKE_LOCK);
    const e = reg.get(FAKE.id, FAKE.versao)!;
    expect(e.hash).toBe(hashDefinition(FAKE));
    expect(e.hashLock).toBe(FAKE_LOCK[algorithmKey(FAKE)]);
    expect(reg.get(FAKE.id, '9.9.9')).toBeUndefined();
  });
});

describe('validateDefinition detecta definições quebradas', () => {
  const issues = (mut: (d: AlgorithmDef) => void, lock?: Record<string, string>) => {
    const d = clone(FAKE);
    mut(d);
    return validateDefinition(d, lock).join('\n');
  };

  test('rótulo de valor fora do enum ou vazio', () => {
    const msg = issues((d) => {
      const solo = d.entradas.find((e) => e.id === 'solo')!;
      if (solo.def.tipo === 'enum') solo.def.rotulos = { seco: 'Seco', lamacento: 'Lama', umido: ' ' };
    });
    expect(msg).toMatch(/entrada solo: rótulo para valor "lamacento" fora do enum/);
    expect(msg).toMatch(/entrada solo: rótulo vazio para "umido"/);
  });
  test('regra sem referência', () => {
    expect(issues((d) => { d.regras[0].referencias = []; })).toMatch(/R\.CALOR: sem referência/);
  });
  test('referência sem PMID nem DOI', () => {
    expect(issues((d) => { delete d.referencias[0].pmid; })).toMatch(/Alfa2001: sem PMID nem DOI/);
  });
  test('regra só com referência sem PMID/DOI', () => {
    expect(issues((d) => { delete d.referencias[0].pmid; d.regras[0].referencias = [{ ref: 'Alfa2001' }]; }))
      .toMatch(/R\.CALOR: nenhuma referência com PMID\/DOI/);
  });
  test('referência sem nível de evidência', () => {
    expect(issues((d) => { (d.referencias[1] as { nivel?: string }).nivel = undefined; })).toMatch(/Beta2002: nível/);
  });
  test('PMID e DOI mal formados', () => {
    const t = issues((d) => { d.referencias[0].pmid = 'PMID 123'; d.referencias[1].doi = 'doi:10.1/x'; });
    expect(t).toMatch(/PMID inválido/);
    expect(t).toMatch(/DOI inválido/);
  });
  test('referência citada e não declarada', () => {
    expect(issues((d) => { d.regras[1].referencias.push({ ref: 'Inexistente' }); })).toMatch(/"Inexistente" não declarada/);
  });
  test('entrada não declarada numa regra e no escopo', () => {
    const t = issues((d) => {
      d.regras[0].quando = { campo: 'umidade', op: '>', valor: 1 };
      d.foraDeEscopo[0].quando = { campo: 'estufa', op: '==', valor: true };
    });
    expect(t).toMatch(/R\.CALOR: entrada "umidade" não declarada/);
    expect(t).toMatch(/ESC\.COBERTA: entrada "estufa" não declarada/);
  });
  test('opção inexistente em efeito e em alternativa de controvérsia', () => {
    const t = issues((d) => {
      d.regras[0].efeitos[0].opcao = 'replantar';
      d.regras[2].controversia!.alternativas[0].opcao = 'mudar';
    });
    expect(t).toMatch(/opção "replantar" não declarada/);
    expect(t).toMatch(/alternativa com opção "mudar"/);
  });
  test('hash divergente do lock (conteúdo mudou sem nova versão) e versão fora do lock', () => {
    expect(issues((d) => { d.regras[0].titulo = 'Outro título'; }, FAKE_LOCK)).toMatch(/conteúdo mudou sem mudar a versão/);
    expect(issues((d) => { d.versao = '1.0.1'; }, FAKE_LOCK)).toMatch(/ausente do versions\.lock\.json/);
  });
  test('valor fora do enum, comparação numérica sobre enum e booleano comparado com texto', () => {
    const t = issues((d) => {
      d.regras[0].quando = { all: [{ campo: 'solo', op: '==', valor: 'arenoso' }, { campo: 'solo', op: '>', valor: 2 }] };
      d.regras[2].quando = { campo: 'geada', op: '==', valor: 'sim' };
    });
    expect(t).toMatch(/"arenoso" fora do enum/);
    expect(t).toMatch(/comparação numérica sobre "solo"/);
    expect(t).toMatch(/"geada" é booleano/);
  });
  test('efeito forte sem evidência de nível I/II exige justificativaForca', () => {
    expect(issues((d) => { d.regras[4].efeitos[0].forca = 'forte'; })).toMatch(/R\.SOLO: efeito "forte"/);
    expect(issues((d) => { d.regras[4].efeitos[0].forca = 'forte'; d.regras[4].justificativaForca = 'Motivo explícito.'; })).toBe('');
  });
  test('controvérsia sem nota ou alternativa sem referência', () => {
    const t = issues((d) => { d.regras[2].controversia!.nota = ' '; d.regras[2].controversia!.alternativas[0].referencias = []; });
    expect(t).toMatch(/controvérsia sem nota/);
    expect(t).toMatch(/alternativa "podar" sem referência/);
  });
  test('ids duplicados e motivo que interpola entrada não declarada', () => {
    const t = issues((d) => { d.regras[1].id = 'R.CALOR'; d.regras[0].motivo = 'Valor {umidade}.'; });
    expect(t).toMatch(/regra "R\.CALOR" duplicada/);
    expect(t).toMatch(/interpola "umidade"/);
  });
});
