/**
 * Condições declarativas avaliadas em lógica de três valores (Kleene).
 * Campo ausente → 'desconhecido'. Nunca vira false nem 0.
 */
import type { Cond, V3 } from './types';

export interface CondResultado {
  v: V3;
  /** Entradas cuja ausência deixou a condição desconhecida (vazio se v ≠ 'desconhecido'). */
  faltando: string[];
  /** Valores lidos durante a avaliação (para o trace). */
  valores: Record<string, unknown>;
}

export type Valores = Readonly<Record<string, unknown>>;

/** Campos referenciados por uma condição, em ordem de aparição, sem repetição. */
export function camposDe(c: Cond, out: string[] = []): string[] {
  if ('all' in c) c.all.forEach((x) => camposDe(x, out));
  else if ('any' in c) c.any.forEach((x) => camposDe(x, out));
  else if ('not' in c) camposDe(c.not, out);
  else if (!out.includes(c.campo)) out.push(c.campo);
  return out;
}

function uniq(xs: string[]): string[] {
  return [...new Set(xs)];
}

function num(v: unknown, campo: string): number {
  if (typeof v !== 'number') throw new Error(`Condição numérica sobre "${campo}", que não é número.`);
  return v;
}

function folha(c: Extract<Cond, { campo: string }>, x: unknown): boolean {
  switch (c.op) {
    case '==': return x === c.valor;
    case '!=': return x !== c.valor;
    case '<': return num(x, c.campo) < num(c.valor, c.campo);
    case '<=': return num(x, c.campo) <= num(c.valor, c.campo);
    case '>': return num(x, c.campo) > num(c.valor, c.campo);
    case '>=': return num(x, c.campo) >= num(c.valor, c.campo);
    case 'in': return c.valores.some((v) => v === x);
    case 'contem':
      if (!Array.isArray(x)) throw new Error(`Condição "contem" sobre "${c.campo}", que não é lista.`);
      return x.includes(c.valor);
    case 'entre': {
      const n = num(x, c.campo);
      return n >= c.min && (c.incluiMax ? n <= c.max : n < c.max);
    }
  }
}

export function avaliarCond(c: Cond, valores: Valores): CondResultado {
  if ('all' in c || 'any' in c) {
    const isAll = 'all' in c;
    const filhos = (isAll ? c.all : c.any).map((x) => avaliarCond(x, valores));
    const lidos = Object.assign({}, ...filhos.map((f) => f.valores)) as Record<string, unknown>;
    // all: falso domina; any: verdadeiro domina
    const dominante = isAll ? false : true;
    if (filhos.some((f) => f.v === dominante)) return { v: dominante, faltando: [], valores: lidos };
    const desconhecidos = filhos.filter((f) => f.v === 'desconhecido');
    if (desconhecidos.length) {
      return { v: 'desconhecido', faltando: uniq(desconhecidos.flatMap((f) => f.faltando)), valores: lidos };
    }
    return { v: !dominante, faltando: [], valores: lidos };
  }
  if ('not' in c) {
    const r = avaliarCond(c.not, valores);
    return { ...r, v: r.v === 'desconhecido' ? 'desconhecido' : !r.v };
  }
  const x = valores[c.campo];
  if (x === undefined) return { v: 'desconhecido', faltando: [c.campo], valores: {} };
  return { v: folha(c, x), faltando: [], valores: { [c.campo]: x } };
}
