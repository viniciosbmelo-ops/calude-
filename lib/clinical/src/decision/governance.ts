/**
 * Governança: o conteúdo e a versão ficam no código (travados por hash);
 * o status fica no banco, só de inserção, e a linha mais recente vale.
 */
import type { StatusAlgoritmo } from './types';

export const STATUS_ALGORITMO: readonly StatusAlgoritmo[] = ['rascunho', 'revisado', 'ativo', 'aposentado'];

/** rascunho → revisado → ativo → aposentado; revisado pode voltar a rascunho. */
export const TRANSICOES_STATUS: Readonly<Record<StatusAlgoritmo, readonly StatusAlgoritmo[]>> = {
  rascunho: ['revisado'],
  revisado: ['rascunho', 'ativo'],
  ativo: ['aposentado'],
  aposentado: [],
};

export function isStatusAlgoritmo(x: unknown): x is StatusAlgoritmo {
  return typeof x === 'string' && (STATUS_ALGORITMO as readonly string[]).includes(x);
}

export function podeTransitar(de: StatusAlgoritmo, para: StatusAlgoritmo): boolean {
  return TRANSICOES_STATUS[de].includes(para);
}

export interface LinhaStatus {
  status: string;
  hash: string;
}

/**
 * Status efetivo de uma versão: a linha mais recente, desde que registrada para o MESMO hash
 * do código em execução. Sem linha, ou com hash diferente, vale 'rascunho'.
 * `maisRecente` deve ser a última linha inserida para (algoritmo, versão), ou undefined.
 */
export function statusEfetivo(maisRecente: LinhaStatus | undefined, hashCodigo: string): StatusAlgoritmo {
  if (!maisRecente || maisRecente.hash !== hashCodigo || !isStatusAlgoritmo(maisRecente.status)) return 'rascunho';
  return maisRecente.status;
}
