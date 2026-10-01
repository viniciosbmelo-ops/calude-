/**
 * Apoio à decisão: tipos públicos da definição declarativa e do resultado.
 *
 * O algoritmo é DADO (serializável, revisável pelo cirurgião, travado por hash).
 * O motor (`engine.ts`) só interpreta. Nenhum conteúdo clínico vive aqui.
 */

// ---- Vocabulário fechado ----
export type Forca = 'forte' | 'moderada' | 'fraca' | 'controversa';
/** "desfavorece" = cautela. Nunca exibido como proibição. */
export type Efeito = 'favorece' | 'desfavorece';
/** Nível de evidência (JBJS / OCEBM). */
export type NivelEvidencia = 'I' | 'II' | 'III' | 'IV' | 'V';
export type TipoEstudo =
  | 'ECR' | 'metanalise' | 'revisao_sistematica' | 'coorte' | 'caso_controle'
  | 'serie_casos' | 'biomecanico' | 'diretriz' | 'consenso' | 'opiniao';
export type StatusAlgoritmo = 'rascunho' | 'revisado' | 'ativo' | 'aposentado';
/** Momento em que o motor é chamado. `preop` descarta entradas intraoperatórias. */
export type ModoAvaliacao = 'preop' | 'registro';

// ---- Referências ----
export interface Referencia {
  /** Chave estável citada pelas regras, ex.: 'Autor2020'. */
  id: string;
  /** Citação completa (Vancouver). */
  citacao: string;
  /** Ao menos um de `pmid` / `doi` (teste estrutural). */
  pmid?: string;
  doi?: string;
  nivel: NivelEvidencia;
  tipo: TipoEstudo;
  conflitoInteresse?: string;
}

/** Citação de uma referência do algoritmo; `nota` = o que exatamente a fonte sustenta. */
export interface CitRef {
  ref: string;
  nota?: string;
}

// ---- Entradas ----
export type TipoEntrada =
  | { tipo: 'numero'; unidade?: string; min?: number; max?: number; inteiro?: boolean }
  | { tipo: 'booleano' }
  | { tipo: 'enum'; valores: readonly string[] }
  | { tipo: 'lista'; valores: readonly string[] };

export type OrigemEntrada =
  | { de: 'payload'; caminho: string }
  | { de: 'intraop'; caminho: string }
  | { de: 'paciente'; campo: string }
  | { de: 'derivada'; funcao: string; dependeDe: string[] }
  | { de: 'manual' };

export type Proveniencia = OrigemEntrada['de'];

export interface EntradaDef {
  id: string;
  rotulo: string;
  def: TipoEntrada;
  origem: OrigemEntrada;
  /** Momento clínico em que o dado existe. No modo `preop`, entradas `intraop` são descartadas. */
  momento: 'preop' | 'intraop';
}

// ---- Condições (declarativas, serializáveis) ----
export type OpComparacao = '<' | '<=' | '>' | '>=' | '==' | '!=';
export type Cond =
  | { all: Cond[] }
  | { any: Cond[] }
  | { not: Cond }
  | { campo: string; op: OpComparacao; valor: number | string | boolean }
  | { campo: string; op: 'in'; valores: (string | number)[] }
  | { campo: string; op: 'contem'; valor: string }
  | { campo: string; op: 'entre'; min: number; max: number; incluiMax?: boolean }
  /** Compara uma entrada numérica com um PARÂMETRO do algoritmo (limiar configurável, ver `ParametroDef`). */
  | { campo: string; op: OpComparacaoNumerica; param: string };

export type OpComparacaoNumerica = '<' | '<=' | '>' | '>=';

// ---- Parâmetros (limiares configuráveis) ----
/**
 * Limiar que a literatura não fixa (decisão em aberto). A definição traz o valor padrão (entra no hash);
 * o cirurgião ou o serviço pode sobrescrever em `ContextoAvaliacao.parametros`. O valor usado sai no resultado.
 */
export interface ParametroDef {
  id: string;
  rotulo: string;
  unidade?: string;
  min?: number;
  max?: number;
  inteiro?: boolean;
  padrao: number;
  /** 'pendente_decisao_cirurgiao': padrão provisório, ainda não escolhido pelo cirurgião/serviço. */
  status: 'definido' | 'pendente_decisao_cirurgiao';
  /** O que o parâmetro significa e as alternativas da literatura. */
  nota: string;
  referencias: CitRef[];
}

// ---- Opções ----
export interface OpcaoDef {
  id: string;
  rotulo: string;
  /** Valores de `procedure` do schema intraoperatório correspondentes (concordância automática). */
  procedimentosIntraop?: string[];
  naoCirurgica?: boolean;
}

// ---- Regras ----
export interface EfeitoDef {
  opcao: string;
  efeito: Efeito;
  forca: Exclude<Forca, 'controversa'>;
}

export interface ControversiaDef {
  nota: string;
  alternativas: { opcao: string; argumento: string; referencias: CitRef[] }[];
}

export interface RegraDef {
  id: string;
  titulo: string;
  quando: Cond;
  /** Vazio só em regras de `aviso`. */
  efeitos: EfeitoDef[];
  /** Pode interpolar entradas: "{idade}". */
  motivo: string;
  referencias: CitRef[];
  controversia?: ControversiaDef;
  /** Regra de segurança: não mexe em opções, gera aviso. */
  aviso?: boolean;
  /** Obrigatória quando um efeito `forte` não tem referência de nível I/II, diretriz ou consenso. */
  justificativaForca?: string;
}

export interface ForaDeEscopoDef {
  id: string;
  texto: string;
  quando: Cond;
}

export interface AlgorithmDef {
  id: string;
  /** semver */
  versao: string;
  patologias: string[];
  titulo: string;
  escopo: string;
  foraDeEscopo: ForaDeEscopoDef[];
  entradas: EntradaDef[];
  /** Limiares configuráveis citados por condições `{ campo, op, param }`. */
  parametros?: ParametroDef[];
  opcoes: OpcaoDef[];
  regras: RegraDef[];
  /** Bibliografia do algoritmo; as regras citam por `id`. */
  referencias: Referencia[];
  avisosGerais: string[];
  referenciasGerais: CitRef[];
}

// ---- Resultado ----
export type V3 = true | false | 'desconhecido';

export interface TraceItem {
  regra: string;
  resultado: 'disparou' | 'nao_disparou' | 'indeterminada' | 'fora_de_escopo';
  valores: Record<string, unknown>;
  faltando: string[];
}

export interface MotivoOpcao {
  regra: string;
  texto: string;
  forca: Exclude<Forca, 'controversa'>;
  efeito: Efeito;
}

export interface ControversiaResultado {
  regra: string;
  nota: string;
  alternativas: { opcao: string; rotulo: string; argumento: string; referencias: string[] }[];
}

export interface OpcaoResultado {
  opcao: string;
  rotulo: string;
  forca: Forca;
  sentido: Efeito;
  motivos: MotivoOpcao[];
  referencias: string[];
  controversias: ControversiaResultado[];
}

export interface AvisoResultado {
  regra: string;
  texto: string;
  referencias: string[];
}

export interface FaltanteResultado {
  entrada: string;
  rotulo: string;
  unidade?: string;
  /** Regras (e critérios de escopo) que ficariam avaliáveis com esta entrada. */
  desbloqueia: string[];
}

export interface ResultadoApoio {
  rotulo: 'Sugestão';
  algoritmo: { id: string; versao: string; hash: string; status: StatusAlgoritmo };
  motor: string;
  modo: ModoAvaliacao;
  foraDeEscopo: { id: string; texto: string }[];
  /** Critérios de escopo que não puderam ser confirmados por falta de dado. */
  escopoIndeterminado: { id: string; texto: string; faltando: string[] }[];
  opcoes: OpcaoResultado[];
  avisos: AvisoResultado[];
  faltantes: FaltanteResultado[];
  /** Contagem, não escore. */
  completude: { avaliadas: number; indeterminadas: number; total: number };
  trace: TraceItem[];
  referencias: Referencia[];
  entrada: Record<string, unknown>;
  /** Entradas recebidas mas descartadas (ex.: intraoperatórias no modo `preop`). */
  entradasDescartadas: string[];
  avisosGerais: string[];
  /** Só quando a definição declara parâmetros: valor efetivamente usado e de onde veio. */
  parametros?: ParametroResultado[];
}

export interface ParametroResultado {
  id: string;
  rotulo: string;
  valor: number;
  unidade?: string;
  origem: 'padrao' | 'contexto';
  status: ParametroDef['status'];
  nota: string;
  referencias: string[];
}

export interface ContextoAvaliacao {
  status?: StatusAlgoritmo;
  /** Se omitido, é calculado do conteúdo da definição. */
  hash?: string;
  modo?: ModoAvaliacao;
  /** Sobrescreve o padrão de parâmetros declarados (id → valor). Id desconhecido ou fora da faixa → erro. */
  parametros?: Readonly<Record<string, number>>;
}
