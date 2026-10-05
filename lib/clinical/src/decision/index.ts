/** Apoio à decisão: motor genérico, governança, registro e mapeamento do registro cirúrgico. */
export * from './types';
export { avaliarCond, camposDe } from './conditions';
export type { CondResultado, Parametros } from './conditions';
export { evaluate, normalizarEntrada, entradasDaRegra, resolverParametros, rotuloDoValor, numeroPtBr, comUnidade, interpolarTexto, MOTOR_VERSAO } from './engine';
export {
  CAMPOS_PERFIL_PACIENTE, CAMPOS_PERFIL_PACIENTE_POR_ALGORITMO, camposPerfilPacienteDe, camposPerfilPaciente,
  anonimizarExecucao, TEXTO_ANONIMIZADO,
} from './anonimizacao';
export type { ExecucaoAnonimizavel, ExecucaoAnonimizada } from './anonimizacao';
export { canonicalJson, sha256Hex, hashDefinition, algorithmKey } from './hash';
export { validateDefinition, entradasUsadas } from './validate';
export {
  STATUS_ALGORITMO, TRANSICOES_STATUS, isStatusAlgoritmo, podeTransitar, statusEfetivo,
} from './governance';
export type { LinhaStatus } from './governance';
export {
  DECISION_ALGORITHMS, DECISION_MAPPERS, DECISION_VERSION_LOCK, createDecisionRegistry, decisionRegistry,
} from './registry';
export { montarEntrada, idadeEmAnos, dataReferenciaDe } from './mapping';
export type {
  ContextoMapeamento, ConflitoMapeamento, EntradaMontada, MapeadorEntrada, ProvenienciaEntrada, ResultadoMapeador,
} from './mapping';
export type { AlgoritmoRegistrado, DecisionRegistry } from './registry';
export {
  ROTULO_SUGESTAO, AVISO_DECISAO_DO_CIRURGIAO, AVISO_NIVEIS_EVIDENCIA, FORCA_ROTULO, EFEITO_ROTULO, SENTIDO_ROTULO, TIPO_ESTUDO_ROTULO, STATUS_ROTULO,
} from './vocab';
export { concordancia } from './choice';
export type { Concordancia, EscolhaCirurgiao } from './choice';
