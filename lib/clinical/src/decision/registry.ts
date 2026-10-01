/**
 * Registro dos algoritmos disponíveis no código e lock de versões.
 * Registrar NÃO ativa: o status vem do banco (sem linha = rascunho), e só admin vê rascunhos.
 * Regenerar o lock: `pnpm --filter @workspace/clinical run lock:decision`.
 */
import type { AlgorithmDef } from './types';
import type { MapeadorEntrada } from './mapping';
import { algorithmKey, hashDefinition } from './hash';
import { ALGORITMOS_REGISTRADOS } from './algorithms';
import LOCK from './versions.lock.json';

export const DECISION_ALGORITHMS: readonly AlgorithmDef[] = ALGORITMOS_REGISTRADOS.map((a) => a.def);

/** 'ID@versão' → mapeador do registro cirúrgico (fora do hash). */
export const DECISION_MAPPERS: Readonly<Record<string, MapeadorEntrada>> = Object.fromEntries(
  ALGORITMOS_REGISTRADOS.flatMap((a) => (a.mapear ? [[algorithmKey(a.def), a.mapear]] : [])),
);

/** 'ID@versão' → SHA-256 do conteúdo canônico. */
export const DECISION_VERSION_LOCK: Readonly<Record<string, string>> = LOCK as Record<string, string>;

export interface AlgoritmoRegistrado {
  def: AlgorithmDef;
  /** Hash calculado do conteúdo em execução. */
  hash: string;
  /** Hash gravado no lock (undefined se a versão não está no lock). */
  hashLock?: string;
  /** Mapeador payload clínico + paciente → entrada. Não entra no hash. */
  mapear?: MapeadorEntrada;
}

export interface DecisionRegistry {
  list(): AlgoritmoRegistrado[];
  get(id: string, versao: string): AlgoritmoRegistrado | undefined;
}

export function createDecisionRegistry(
  defs: readonly AlgorithmDef[],
  lock: Readonly<Record<string, string>> = {},
  mappers: Readonly<Record<string, MapeadorEntrada>> = {},
): DecisionRegistry {
  const entries: AlgoritmoRegistrado[] = defs.map((def) => {
    const mapear = mappers[algorithmKey(def)] as MapeadorEntrada | undefined;
    return { def, hash: hashDefinition(def), hashLock: lock[algorithmKey(def)], ...(mapear ? { mapear } : {}) };
  });
  const byKey = new Map(entries.map((e) => [algorithmKey(e.def), e]));
  if (byKey.size !== entries.length) throw new Error('Algoritmo registrado em duplicidade (mesmo id e versão).');
  return {
    list: () => [...entries],
    get: (id, versao) => byKey.get(algorithmKey({ id, versao })),
  };
}

export const decisionRegistry: DecisionRegistry = createDecisionRegistry(
  DECISION_ALGORITHMS, DECISION_VERSION_LOCK, DECISION_MAPPERS,
);
