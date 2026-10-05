/**
 * Anonimização (LGPD) do histórico do apoio à decisão.
 *
 * Quando o paciente é anonimizado, as execuções gravadas mantêm a trilha de auditoria (algoritmo, versão, hash,
 * motor, status, modo, opções e forças do resultado, datas e a escolha do cirurgião), mas perdem as entradas que
 * vêm do cadastro do paciente (tabagismo, diabetes, dominância, nível de atividade…) e a idade: elas saem da
 * entrada, da proveniência, dos conflitos e da cópia da entrada dentro do resultado (`entrada`, `trace[].valores`
 * e textos de motivos/avisos que interpolam o valor).
 *
 * A lista de campos NÃO é escrita à mão por algoritmo: deriva das definições registradas (origem `paciente`, ou
 * derivada de um campo `paciente.*`) mais a idade. Na execução gravada, qualquer entrada cuja proveniência
 * registrada seja `paciente` também sai (cobre versões antigas que não estão mais no registro).
 */
import type { AlgorithmDef } from './types';
import { DECISION_ALGORITHMS, decisionRegistry } from './registry';
import { interpolarTexto } from './engine';

/** Sempre removida: a idade identifica, mesmo quando calculada (data de nascimento × data da cirurgia). */
const SEMPRE: readonly string[] = ['idade'];

/** Texto que substitui um valor removido em textos já interpolados. */
export const TEXTO_ANONIMIZADO = '[anonimizado]';

/** Entradas de uma definição que vêm do cadastro do paciente (direta ou derivada de `paciente.*`), mais a idade. */
export function camposPerfilPacienteDe(def: AlgorithmDef): string[] {
  const ids = def.entradas
    .filter((e) => e.origem.de === 'paciente' || (e.origem.de === 'derivada' && /\bpaciente\./.test(e.origem.funcao)))
    .map((e) => e.id);
  return [...new Set([...ids, ...SEMPRE])].sort();
}

/** Algoritmo (todas as versões registradas) → entradas do perfil do paciente. */
export const CAMPOS_PERFIL_PACIENTE_POR_ALGORITMO: Readonly<Record<string, readonly string[]>> = (() => {
  const por: Record<string, Set<string>> = {};
  for (const def of DECISION_ALGORITHMS) {
    const s = (por[def.id] ??= new Set());
    for (const c of camposPerfilPacienteDe(def)) s.add(c);
  }
  return Object.fromEntries(Object.entries(por).map(([id, s]) => [id, Object.freeze([...s].sort())]));
})();

/** União de todos os algoritmos: usada para um algoritmo que não está mais no registro. */
export const CAMPOS_PERFIL_PACIENTE: readonly string[] = Object.freeze(
  [...new Set([...SEMPRE, ...Object.values(CAMPOS_PERFIL_PACIENTE_POR_ALGORITMO).flat()])].sort(),
);

type Registro = Record<string, unknown>;
const isRegistro = (v: unknown): v is Registro => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Campos a remover de uma execução: os do algoritmo (ou a união, se desconhecido) + toda entrada cuja proveniência
 * gravada aponta para o paciente (`de: 'paciente'`, ou `origem: 'paciente'` em formato antigo).
 */
export function camposPerfilPaciente(algoritmoId: string, proveniencia?: unknown): string[] {
  const campos = new Set(CAMPOS_PERFIL_PACIENTE_POR_ALGORITMO[algoritmoId] ?? CAMPOS_PERFIL_PACIENTE);
  if (isRegistro(proveniencia)) {
    for (const [id, p] of Object.entries(proveniencia)) {
      if (isRegistro(p) && (p['de'] === 'paciente' || p['origem'] === 'paciente')) campos.add(id);
    }
  }
  return [...campos].sort();
}

export interface ExecucaoAnonimizavel {
  algoritmoId: string;
  algoritmoVersao: string;
  algoritmoHash: string;
  entrada: unknown;
  proveniencia: unknown;
  conflitos: unknown;
  resultado: unknown;
}

export interface ExecucaoAnonimizada {
  entrada: Registro;
  proveniencia: Registro;
  conflitos: unknown[] | null;
  resultado: Registro;
  camposRemovidos: string[];
}

function sem(obj: unknown, campos: ReadonlySet<string>): Registro {
  if (!isRegistro(obj)) return {};
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !campos.has(k)));
}

/**
 * Remove de uma execução gravada as entradas do perfil do paciente e marca o resultado como anonimizado.
 * Pura e idempotente. Mantém algoritmo/versão/hash/motor/status/modo (colunas) e, no resultado, opções, forças,
 * avisos, faltantes, parâmetros e referências; textos que interpolavam um valor removido são reescritos com
 * `TEXTO_ANONIMIZADO` (pela definição registrada de mesmo hash; sem ela, o texto inteiro é substituído).
 */
export function anonimizarExecucao(exec: ExecucaoAnonimizavel, em: Date): ExecucaoAnonimizada {
  const lista = camposPerfilPaciente(exec.algoritmoId, exec.proveniencia);
  const campos = new Set(lista);
  const entrada = sem(exec.entrada, campos);
  const proveniencia = sem(exec.proveniencia, campos);
  const conflitos = Array.isArray(exec.conflitos)
    ? exec.conflitos.filter((c) => !(isRegistro(c) && typeof c['entrada'] === 'string' && campos.has(c['entrada'])))
    : null;

  const res: Registro = isRegistro(exec.resultado) ? { ...exec.resultado } : {};
  const entradaRes = sem(res['entrada'], campos);
  if ('entrada' in res) res['entrada'] = entradaRes;

  // Regras cujo trace usou um campo removido: o texto delas pode carregar o valor.
  const regrasAfetadas = new Set<string>();
  if (Array.isArray(res['trace'])) {
    res['trace'] = (res['trace'] as unknown[]).map((t) => {
      if (!isRegistro(t)) return t;
      const valores = isRegistro(t['valores']) ? t['valores'] : {};
      if (Object.keys(valores).some((k) => campos.has(k)) && typeof t['regra'] === 'string') regrasAfetadas.add(t['regra']);
      return { ...t, valores: sem(valores, campos) };
    });
  }

  const reg = decisionRegistry.get(exec.algoritmoId, exec.algoritmoVersao);
  const def = reg && reg.hash === exec.algoritmoHash ? reg.def : undefined;
  const motivoDe = new Map(def?.regras.map((r) => [r.id, r.motivo]) ?? []);
  const placeholder = new RegExp(`\\{(${lista.map((c) => c.replace(/[^A-Za-z0-9_]/g, '')).join('|')})\\}`, 'g');
  const reescrever = (regra: unknown, texto: unknown): unknown => {
    if (typeof regra !== 'string' || typeof texto !== 'string') return texto;
    const modelo = motivoDe.get(regra);
    if (def && modelo !== undefined) {
      placeholder.lastIndex = 0;
      if (!placeholder.test(modelo)) return texto;
      return interpolarTexto(def, modelo.replace(placeholder, TEXTO_ANONIMIZADO), entradaRes);
    }
    return regrasAfetadas.has(regra) ? TEXTO_ANONIMIZADO : texto;
  };

  if (Array.isArray(res['avisos'])) {
    res['avisos'] = (res['avisos'] as unknown[]).map((a) => (isRegistro(a) ? { ...a, texto: reescrever(a['regra'], a['texto']) } : a));
  }
  if (Array.isArray(res['opcoes'])) {
    res['opcoes'] = (res['opcoes'] as unknown[]).map((o) => {
      if (!isRegistro(o) || !Array.isArray(o['motivos'])) return o;
      return {
        ...o,
        motivos: (o['motivos'] as unknown[]).map((m) => (isRegistro(m) ? { ...m, texto: reescrever(m['regra'], m['texto']) } : m)),
      };
    });
  }

  const anteriores = Array.isArray(res['camposRemovidos']) ? (res['camposRemovidos'] as unknown[]).filter((c): c is string => typeof c === 'string') : [];
  res['anonimizado'] = true;
  res['anonimizadoEm'] = typeof res['anonimizadoEm'] === 'string' ? res['anonimizadoEm'] : em.toISOString();
  res['camposRemovidos'] = [...new Set([...anteriores, ...lista])].sort();

  return { entrada, proveniencia, conflitos, resultado: res, camposRemovidos: lista };
}

