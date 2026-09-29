/**
 * Vocabulário exibido pelo apoio à decisão. Passa pela guarda de termos
 * (scripts/check-forbidden-terms.ts): só linguagem de sugestão, nunca de prescrição.
 */
import type { Efeito, Forca, StatusAlgoritmo } from './types';

/** Rótulo fixo de todo resultado do motor. */
export const ROTULO_SUGESTAO = 'Sugestão' as const;

export const AVISO_DECISAO_DO_CIRURGIAO = 'Sugestão baseada em literatura. A decisão é do cirurgião.';

export const FORCA_ROTULO: Record<Forca, string> = {
  forte: 'Força da sugestão: forte',
  moderada: 'Força da sugestão: moderada',
  fraca: 'Força da sugestão: fraca',
  controversa: 'Controverso: a literatura diverge',
};

export const EFEITO_ROTULO: Record<Efeito, string> = {
  favorece: 'A literatura favorece',
  desfavorece: 'Cautela',
};

export const STATUS_ROTULO: Record<StatusAlgoritmo, string> = {
  rascunho: 'Rascunho, não revisado',
  revisado: 'Revisado, não ativo',
  ativo: 'Ativo',
  aposentado: 'Aposentado',
};
