/** Apoio à decisão: motor genérico, governança e registro. Sem conteúdo clínico nesta fase. */
export * from './types';
export { avaliarCond, camposDe } from './conditions';
export type { CondResultado } from './conditions';
export { evaluate, normalizarEntrada, entradasDaRegra, MOTOR_VERSAO } from './engine';
export { canonicalJson, sha256Hex, hashDefinition, algorithmKey } from './hash';
export { validateDefinition, entradasUsadas } from './validate';
export {
  STATUS_ALGORITMO, TRANSICOES_STATUS, isStatusAlgoritmo, podeTransitar, statusEfetivo,
} from './governance';
export type { LinhaStatus } from './governance';
export {
  DECISION_ALGORITHMS, DECISION_VERSION_LOCK, createDecisionRegistry, decisionRegistry,
} from './registry';
export type { AlgoritmoRegistrado, DecisionRegistry } from './registry';
export { ROTULO_SUGESTAO, AVISO_DECISAO_DO_CIRURGIAO, FORCA_ROTULO, EFEITO_ROTULO, STATUS_ROTULO } from './vocab';
export { concordancia } from './choice';
export type { Concordancia, EscolhaCirurgiao } from './choice';
