/**
 * Governança: o conteúdo e a versão ficam no código (travados por hash);
 * o status fica no banco, só de inserção, e a linha mais recente vale.
 *
 * O QUE O HASH COBRE: só a definição (`AlgorithmDef`: entradas, regras, opções, textos, limiares). Mudar
 * qualquer coisa nela muda o hash, o lock (`versions.lock.json`) acusa a divergência e o status gravado
 * deixa de valer (volta a rascunho até nova revisão).
 *
 * O QUE O HASH NÃO COBRE: os mapeadores de entrada (`DECISION_MAPPERS` em registry.ts, o `mapear` de cada
 * algoritmo em algorithms/), que traduzem o registro cirúrgico + cadastro do paciente em entrada. Mudar um
 * mapeador pode mudar a sugestão de uma versão já `ativa` sem mudar o hash nem o status. Por isso:
 *   - toda mudança em mapeador exige revisão clínica manual (como uma mudança de regra);
 *   - se a mudança altera que valor chega a alguma entrada, publique uma NOVA versão do algoritmo
 *     (incremente `versao`, regenere o lock) e passe-a por rascunho → revisado → ativo; a versão
 *     anterior continua com o mapeador antigo ou é aposentada;
 *   - refatoração sem efeito (mesma entrada para todo registro) dispensa nova versão, mas precisa de teste
 *     que prove a equivalência.
 * O banco também guarda as tabelas de auditoria só de inserção (lib/db/pre-push/0002_apoio_decisao_insert_only.sql).
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
