/**
 * Vocabulário exibido pelo apoio à decisão. Passa pela guarda de termos
 * (scripts/check-forbidden-terms.ts): só linguagem de sugestão, nunca de prescrição.
 */
import type { Efeito, Forca, SentidoOpcao, StatusAlgoritmo, TipoEstudo } from './types';

/** Rótulo fixo de todo resultado do motor. */
export const ROTULO_SUGESTAO = 'Sugestão' as const;

/**
 * Aviso obrigatório em todo algoritmo registrado (teste estrutural): os níveis de evidência das
 * referências foram atribuídos pela equipe a partir do desenho de estudo e ainda não foram conferidos.
 */
export const AVISO_NIVEIS_EVIDENCIA =
  'Níveis de evidência atribuídos pela equipe, pendentes de revisão do cirurgião.';

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

/** Sentido líquido da opção no resultado. A alternativa de zona cinzenta nunca leva o rótulo "favorece". */
export const SENTIDO_ROTULO: Record<SentidoOpcao, string> = {
  favorece: 'A literatura favorece',
  alternativa: 'Alternativa (zona cinzenta)',
  desfavorece: 'Cautela',
};

/** Tipo de estudo das referências, para exibição. */
export const TIPO_ESTUDO_ROTULO: Record<TipoEstudo, string> = {
  ECR: 'Ensaio clínico randomizado',
  metanalise: 'Metanálise',
  revisao_sistematica: 'Revisão sistemática',
  coorte: 'Coorte',
  caso_controle: 'Caso-controle',
  serie_casos: 'Série de casos',
  biomecanico: 'Estudo biomecânico',
  diretriz: 'Diretriz',
  consenso: 'Consenso',
  opiniao: 'Opinião de especialista',
};

export const STATUS_ROTULO: Record<StatusAlgoritmo, string> = {
  rascunho: 'Rascunho, não revisado',
  revisado: 'Revisado, não ativo',
  ativo: 'Ativo',
  aposentado: 'Aposentado',
};
