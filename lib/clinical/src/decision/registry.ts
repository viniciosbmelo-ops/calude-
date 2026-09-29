/**
 * Registro dos algoritmos disponíveis no código e lock de versões.
 * Nenhum algoritmo clínico nesta fase: o conteúdo entra depois, a partir de especificações verificadas.
 * Regenerar o lock: `pnpm --filter @workspace/clinical run lock:decision`.
 */
import type { AlgorithmDef } from './types';
import { algorithmKey, hashDefinition } from './hash';
import LOCK from './versions.lock.json';

export const DECISION_ALGORITHMS: readonly AlgorithmDef[] = [];

/** 'ID@versão' → SHA-256 do conteúdo canônico. */
export const DECISION_VERSION_LOCK: Readonly<Record<string, string>> = LOCK as Record<string, string>;

export interface AlgoritmoRegistrado {
  def: AlgorithmDef;
  /** Hash calculado do conteúdo em execução. */
  hash: string;
  /** Hash gravado no lock (undefined se a versão não está no lock). */
  hashLock?: string;
}

export interface DecisionRegistry {
  list(): AlgoritmoRegistrado[];
  get(id: string, versao: string): AlgoritmoRegistrado | undefined;
}

export function createDecisionRegistry(
  defs: readonly AlgorithmDef[],
  lock: Readonly<Record<string, string>> = {},
): DecisionRegistry {
  const entries = defs.map((def) => ({ def, hash: hashDefinition(def), hashLock: lock[algorithmKey(def)] }));
  const byKey = new Map(entries.map((e) => [algorithmKey(e.def), e]));
  if (byKey.size !== entries.length) throw new Error('Algoritmo registrado em duplicidade (mesmo id e versão).');
  return {
    list: () => [...entries],
    get: (id, versao) => byKey.get(algorithmKey({ id, versao })),
  };
}

export const decisionRegistry: DecisionRegistry = createDecisionRegistry(DECISION_ALGORITHMS, DECISION_VERSION_LOCK);
