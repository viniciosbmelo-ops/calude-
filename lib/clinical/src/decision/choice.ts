/**
 * Concordância entre a escolha do cirurgião e a sugestão. A escolha é sempre ação explícita
 * do usuário; divergir é dado, não erro.
 */
import type { Forca, ResultadoApoio } from './types';

export type Concordancia = 'concorda' | 'diverge' | 'sem_sugestao';
export type EscolhaCirurgiao = { opcao: string } | { outra: string };

const RANK: Record<Forca, number> = { forte: 3, moderada: 2, fraca: 1, controversa: 0 };

/**
 * 'sem_sugestao' quando nenhuma opção foi favorecida; 'concorda' quando a opção escolhida está
 * entre as favorecidas de maior força; 'diverge' nos demais casos (inclusive "outra").
 */
export function concordancia(resultado: Pick<ResultadoApoio, 'opcoes'>, escolha: EscolhaCirurgiao): Concordancia {
  const favorecidas = resultado.opcoes.filter((o) => o.sentido === 'favorece');
  if (!favorecidas.length) return 'sem_sugestao';
  if (!('opcao' in escolha)) return 'diverge';
  const topo = Math.max(...favorecidas.map((o) => RANK[o.forca]));
  return favorecidas.some((o) => o.opcao === escolha.opcao && RANK[o.forca] === topo) ? 'concorda' : 'diverge';
}
