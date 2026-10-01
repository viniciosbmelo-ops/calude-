/**
 * Motor do apoio à decisão: `evaluate(def, entrada)`.
 *
 * Puro e determinístico: sem relógio, sem aleatoriedade, sem IA, sem E/S.
 * Nunca decide: devolve opções com força, o trace das regras, referências e o que falta,
 * sob o rótulo fixo "Sugestão". Uma entrada ausente deixa a regra indeterminada; nunca vira false nem 0.
 */
import { ClinicalGuardError } from '../errors';
import { avaliarCond, camposDe } from './conditions';
import { hashDefinition } from './hash';
import { ROTULO_SUGESTAO } from './vocab';
import type {
  AlgorithmDef, AvisoResultado, ContextoAvaliacao, ControversiaResultado, Efeito, EntradaDef, FaltanteResultado,
  Forca, MotivoOpcao, OpcaoResultado, ParametroResultado, Referencia, ResultadoApoio, SentidoOpcao, TraceItem,
} from './types';

/**
 * 1.2.0: sentido líquido honesto (cautela ≥ favor → cautela; zona cinzenta → 'alternativa'), rótulos de enum
 * e números com vírgula no texto interpolado das regras.
 */
export const MOTOR_VERSAO = '1.2.0';

const RANK: Record<Forca, number> = { forte: 3, moderada: 2, fraca: 1, controversa: 0 };

function ausente(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

function guard(code: string, msg: string, field: string): never {
  throw new ClinicalGuardError(code, msg, field);
}

/** Confere tipo e faixa de uma entrada presente. Implausível → ClinicalGuardError (não calcula). */
function normalizarValor(e: EntradaDef, v: unknown): unknown {
  const d = e.def;
  switch (d.tipo) {
    case 'numero': {
      if (typeof v !== 'number' || !Number.isFinite(v)) guard('DS_NOT_A_NUMBER', `"${e.rotulo}" deve ser numérico.`, e.id);
      if (d.inteiro && !Number.isInteger(v)) guard('DS_NOT_INTEGER', `"${e.rotulo}" deve ser inteiro.`, e.id);
      const u = d.unidade ? ` ${d.unidade}` : '';
      if (d.min !== undefined && v < d.min) guard('DS_OUT_OF_RANGE', `"${e.rotulo}" abaixo do mínimo plausível (${d.min}${u}).`, e.id);
      if (d.max !== undefined && v > d.max) guard('DS_OUT_OF_RANGE', `"${e.rotulo}" acima do máximo plausível (${d.max}${u}).`, e.id);
      return v;
    }
    case 'booleano':
      if (typeof v !== 'boolean') guard('DS_NOT_A_BOOLEAN', `"${e.rotulo}" deve ser sim/não.`, e.id);
      return v;
    case 'enum':
      if (typeof v !== 'string' || !d.valores.includes(v)) guard('DS_INVALID_OPTION', `Valor inválido para "${e.rotulo}".`, e.id);
      return v;
    case 'lista': {
      if (!Array.isArray(v)) guard('DS_NOT_A_LIST', `"${e.rotulo}" deve ser uma lista.`, e.id);
      for (const x of v) {
        if (typeof x !== 'string' || !d.valores.includes(x)) guard('DS_INVALID_OPTION', `Valor inválido para "${e.rotulo}".`, e.id);
      }
      // Ordem canônica (a ordem declarada) e sem repetição: resultado não depende da ordem de envio
      return d.valores.filter((x) => (v as unknown[]).includes(x));
    }
  }
}

export interface EntradaNormalizada {
  valores: Record<string, unknown>;
  descartadas: string[];
}

/** Normaliza a entrada bruta contra as `EntradaDef`. Chave desconhecida → ClinicalGuardError. */
export function normalizarEntrada(def: AlgorithmDef, bruta: Record<string, unknown>, modo: 'preop' | 'registro'): EntradaNormalizada {
  if (bruta === null || typeof bruta !== 'object' || Array.isArray(bruta)) {
    throw new ClinicalGuardError('DS_INVALID_INPUT', 'Entrada do apoio à decisão deve ser um objeto.');
  }
  const porId = new Map(def.entradas.map((e) => [e.id, e]));
  for (const k of Object.keys(bruta)) {
    if (!porId.has(k)) guard('DS_UNKNOWN_INPUT', `Entrada "${k}" não pertence ao algoritmo ${def.id}.`, k);
  }
  const valores: Record<string, unknown> = {};
  const descartadas: string[] = [];
  for (const e of def.entradas) {
    const v = bruta[e.id];
    if (ausente(v)) continue;
    if (modo === 'preop' && e.momento === 'intraop') {
      descartadas.push(e.id);
      continue;
    }
    valores[e.id] = normalizarValor(e, v);
  }
  return { valores, descartadas };
}

/** Número no texto das regras (português): vírgula decimal, sem separador de milhar. */
export function numeroPtBr(n: number): string {
  return String(n).replace('.', ',');
}

/** Rótulo legível de um valor de enum/lista (o próprio valor quando a definição não traz rótulo). */
export function rotuloDoValor(e: EntradaDef | undefined, v: string): string {
  const d = e?.def;
  const r = d && (d.tipo === 'enum' || d.tipo === 'lista') ? d.rotulos : undefined;
  return r?.[v] ?? v;
}

function formatar(v: unknown, e: EntradaDef | undefined): string {
  if (typeof v === 'boolean') return v ? 'sim' : 'não';
  if (Array.isArray(v)) return v.map((x) => rotuloDoValor(e, String(x))).join(', ');
  if (typeof v === 'number') {
    const u = e?.def.tipo === 'numero' && e.def.unidade ? ` ${e.def.unidade}` : '';
    return `${numeroPtBr(v)}${u}`;
  }
  if (typeof v === 'string') return rotuloDoValor(e, v);
  return String(v);
}

function interpolar(texto: string, valores: Record<string, unknown>, porId: Map<string, EntradaDef>): string {
  return texto.replace(/\{([A-Za-z0-9_]+)\}/g, (m, id: string) => (id in valores ? formatar(valores[id], porId.get(id)) : m));
}

const refsIds = (cs: { ref: string }[]) => cs.map((c) => c.ref);
const sortUniq = (xs: string[]) => [...new Set(xs)].sort();

/**
 * Valor efetivo de cada parâmetro declarado: o do contexto (cirurgião/serviço) ou o padrão da definição.
 * Parâmetro desconhecido, não numérico ou fora da faixa declarada → ClinicalGuardError.
 */
export function resolverParametros(def: AlgorithmDef, ctx: ContextoAvaliacao['parametros'] = {}): ParametroResultado[] {
  const decl = def.parametros ?? [];
  const ids = new Set(decl.map((p) => p.id));
  for (const k of Object.keys(ctx)) {
    if (!ids.has(k)) guard('DS_UNKNOWN_PARAM', `Parâmetro "${k}" não pertence ao algoritmo ${def.id}.`, k);
  }
  return decl.map((p) => {
    const doContexto = ctx[p.id] !== undefined;
    const v = doContexto ? ctx[p.id] : p.padrao;
    const u = p.unidade ? ` ${p.unidade}` : '';
    if (typeof v !== 'number' || !Number.isFinite(v)) guard('DS_NOT_A_NUMBER', `Parâmetro "${p.rotulo}" deve ser numérico.`, p.id);
    if (p.inteiro && !Number.isInteger(v)) guard('DS_NOT_INTEGER', `Parâmetro "${p.rotulo}" deve ser inteiro.`, p.id);
    if (p.min !== undefined && v < p.min) guard('DS_OUT_OF_RANGE', `Parâmetro "${p.rotulo}" abaixo do mínimo (${p.min}${u}).`, p.id);
    if (p.max !== undefined && v > p.max) guard('DS_OUT_OF_RANGE', `Parâmetro "${p.rotulo}" acima do máximo (${p.max}${u}).`, p.id);
    return {
      id: p.id, rotulo: p.rotulo, valor: v, ...(p.unidade ? { unidade: p.unidade } : {}),
      origem: doContexto ? 'contexto' : 'padrao', status: p.status, nota: p.nota, referencias: sortUniq(refsIds(p.referencias)),
    };
  });
}

/**
 * Avalia um algoritmo. `ctx` é opcional: status padrão 'rascunho', modo padrão 'preop'
 * e hash calculado do conteúdo da definição.
 */
export function evaluate(def: AlgorithmDef, entrada: Record<string, unknown>, ctx: ContextoAvaliacao = {}): ResultadoApoio {
  const modo = ctx.modo ?? 'preop';
  const porId = new Map(def.entradas.map((e) => [e.id, e]));
  const { valores, descartadas } = normalizarEntrada(def, entrada, modo);
  const parametros = resolverParametros(def, ctx.parametros);
  const params: Record<string, number> = Object.fromEntries(parametros.map((p) => [p.id, p.valor]));

  const faltantesMap = new Map<string, Set<string>>();
  const anotarFaltantes = (campos: string[], desbloqueia: string) => {
    for (const c of campos) {
      if (!faltantesMap.has(c)) faltantesMap.set(c, new Set());
      faltantesMap.get(c)!.add(desbloqueia);
    }
  };

  // 1. Escopo
  const foraDeEscopo: ResultadoApoio['foraDeEscopo'] = [];
  const escopoIndeterminado: ResultadoApoio['escopoIndeterminado'] = [];
  for (const f of def.foraDeEscopo) {
    const r = avaliarCond(f.quando, valores, params);
    if (r.v === true) foraDeEscopo.push({ id: f.id, texto: f.texto });
    else if (r.v === 'desconhecido') {
      escopoIndeterminado.push({ id: f.id, texto: f.texto, faltando: r.faltando });
      anotarFaltantes(r.faltando, f.id);
    }
  }
  const fora = foraDeEscopo.length > 0;

  // 2. Regras
  const trace: TraceItem[] = [];
  const disparadas: typeof def.regras = [];
  let avaliadas = 0;
  let indeterminadas = 0;
  for (const regra of def.regras) {
    if (fora) {
      trace.push({ regra: regra.id, resultado: 'fora_de_escopo', valores: {}, faltando: [] });
      continue;
    }
    const r = avaliarCond(regra.quando, valores, params);
    if (r.v === 'desconhecido') {
      indeterminadas++;
      anotarFaltantes(r.faltando, regra.id);
      trace.push({ regra: regra.id, resultado: 'indeterminada', valores: r.valores, faltando: r.faltando });
      continue;
    }
    avaliadas++;
    trace.push({ regra: regra.id, resultado: r.v ? 'disparou' : 'nao_disparou', valores: r.valores, faltando: [] });
    if (r.v) disparadas.push(regra);
  }

  // 3. Avisos (regras de segurança)
  const avisos: AvisoResultado[] = disparadas
    .filter((r) => r.aviso)
    .map((r) => ({ regra: r.id, texto: interpolar(r.motivo, valores, porId), referencias: sortUniq(refsIds(r.referencias)) }));

  // 4. Agregação por opção
  const rotuloOpcao = new Map(def.opcoes.map((o) => [o.id, o.rotulo]));
  const opcoes: OpcaoResultado[] = [];
  for (const op of def.opcoes) {
    const motivos: MotivoOpcao[] = [];
    const controversias: ControversiaResultado[] = [];
    const refs: string[] = [];
    /** Maior força de cautela vinda de regra fora de zona cinzenta (-1 se nenhuma). */
    let desFirme = -1;
    for (const regra of disparadas) {
      const efeitos = regra.efeitos.filter((e) => e.opcao === op.id);
      if (!efeitos.length) continue;
      const texto = interpolar(regra.motivo, valores, porId);
      for (const e of efeitos) {
        motivos.push({ regra: regra.id, texto, forca: e.forca, efeito: e.efeito });
        if (e.efeito === 'desfavorece' && !regra.controversia) desFirme = Math.max(desFirme, RANK[e.forca]);
      }
      refs.push(...refsIds(regra.referencias));
      if (regra.controversia) {
        controversias.push({
          regra: regra.id,
          nota: regra.controversia.nota,
          alternativas: regra.controversia.alternativas.map((a) => ({
            opcao: a.opcao,
            rotulo: rotuloOpcao.get(a.opcao) ?? a.opcao,
            argumento: a.argumento,
            referencias: sortUniq(refsIds(a.referencias)),
          })),
        });
        for (const a of regra.controversia.alternativas) refs.push(...refsIds(a.referencias));
      }
    }
    if (!motivos.length) continue; // ausência de sugestão não é sugestão

    // Sentido líquido (honesto):
    // - cautela de força igual ou maior que a de qualquer efeito a favor prevalece ("Cautela", nunca "favorece");
    //   a força é a da cautela mais forte quando ela vem de regra fora de zona cinzenta, senão 'controversa';
    // - efeito a favor ligado a zona cinzenta (regra com controvérsia) é alternativa, nunca "favorece".
    const max = (ef: Efeito) => Math.max(-1, ...motivos.filter((m) => m.efeito === ef).map((m) => RANK[m.forca]));
    const fav = max('favorece');
    const des = max('desfavorece');
    const forcaDe = (rank: number) => (Object.keys(RANK) as Forca[]).find((f) => RANK[f] === rank)!;
    let sentido: SentidoOpcao;
    let forca: Forca;
    if (des >= 0 && des >= fav) {
      sentido = 'desfavorece';
      forca = desFirme === des ? forcaDe(des) : 'controversa';
    } else if (controversias.length) {
      sentido = 'alternativa';
      forca = 'controversa';
    } else {
      sentido = 'favorece';
      forca = forcaDe(fav);
    }
    opcoes.push({ opcao: op.id, rotulo: op.rotulo, forca, sentido, motivos, referencias: sortUniq(refs), controversias });
  }
  // Ordem: favorece, alternativas de zona cinzenta, cautela; depois força; depois ordem declarada.
  const ORDEM_SENTIDO: Record<SentidoOpcao, number> = { favorece: 0, alternativa: 1, desfavorece: 2 };
  const ordemDecl = new Map(def.opcoes.map((o, i) => [o.id, i]));
  opcoes.sort((a, b) =>
    ORDEM_SENTIDO[a.sentido] - ORDEM_SENTIDO[b.sentido]
    || RANK[b.forca] - RANK[a.forca]
    || ordemDecl.get(a.opcao)! - ordemDecl.get(b.opcao)!);

  // 5. Faltantes: mais regras desbloqueadas primeiro, depois ordem declarada
  const ordemEntrada = new Map(def.entradas.map((e, i) => [e.id, i]));
  // No modo preop, dado intraoperatório não é "faltante": ainda não existe.
  const faltantes: FaltanteResultado[] = [...faltantesMap.entries()]
    .filter(([id]) => !(modo === 'preop' && porId.get(id)?.momento === 'intraop'))
    .map(([id, regras]) => {
      const e = porId.get(id);
      const unidade = e?.def.tipo === 'numero' ? e.def.unidade : undefined;
      return { entrada: id, rotulo: e?.rotulo ?? id, ...(unidade ? { unidade } : {}), desbloqueia: [...regras] };
    })
    .sort((a, b) => b.desbloqueia.length - a.desbloqueia.length
      || (ordemEntrada.get(a.entrada) ?? 1e9) - (ordemEntrada.get(b.entrada) ?? 1e9));

  // 6. Referências citadas no resultado
  const citadas = new Set<string>([
    ...refsIds(def.referenciasGerais),
    ...opcoes.flatMap((o) => o.referencias),
    ...avisos.flatMap((a) => a.referencias),
    ...parametros.flatMap((p) => p.referencias),
  ]);
  const referencias: Referencia[] = def.referencias.filter((r) => citadas.has(r.id)).sort((a, b) => a.id.localeCompare(b.id));

  const entradaSnapshot: Record<string, unknown> = {};
  for (const k of Object.keys(valores).sort()) entradaSnapshot[k] = valores[k];

  return {
    rotulo: ROTULO_SUGESTAO,
    algoritmo: { id: def.id, versao: def.versao, hash: ctx.hash ?? hashDefinition(def), status: ctx.status ?? 'rascunho' },
    motor: MOTOR_VERSAO,
    modo,
    foraDeEscopo,
    escopoIndeterminado,
    opcoes: fora ? [] : opcoes,
    avisos: fora ? [] : avisos,
    faltantes,
    completude: { avaliadas, indeterminadas, total: def.regras.length },
    trace,
    referencias,
    entrada: entradaSnapshot,
    entradasDescartadas: descartadas,
    avisosGerais: [...def.avisosGerais],
    // Sempre presente (vazio quando não há parâmetros): a execução gravada guarda os limiares usados.
    parametros,
  };
}

/** Entradas lidas por uma regra (útil para UI e para os testes estruturais). */
export function entradasDaRegra(def: AlgorithmDef, regraId: string): string[] {
  const r = def.regras.find((x) => x.id === regraId);
  return r ? camposDe(r.quando) : [];
}
