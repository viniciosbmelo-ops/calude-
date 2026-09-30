/**
 * SANE por região (Single Assessment Numeric Evaluation) — pergunta única,
 * 0–100 (% de uma região normal), preenchida pelo paciente. Livre de licença.
 * Mesmo modelo e mesma função de escore (`scoreSANE`) do SANE de ombro/cotovelo
 * e do SANE-joelho (`kneeFunction.ts`, reutilizado aqui sem alteração).
 *
 * Ref.: Williams GN, Gangel TJ, Arciero RA, Uhorchak JM, Taylor DC.
 * Comparison of the Single Assessment Numeric Evaluation method and two
 * shoulder rating scales. Am J Sports Med. 1999;27(2):214-21 (ombro);
 * Williams GN et al. Clin Orthop Relat Res. 2000;(373):184-92 (joelho).
 * O SANE é usado sobretudo em ombro, joelho e quadril; para cotovelo,
 * tornozelo/pé e punho/mão há uso na literatura com menos estudos; para a
 * COLUNA a validação é limitada — por isso `limitedValidation` (a interface
 * clínica exibe uma nota discreta).
 *
 * Tradução para o espanhol: tradução própria (não é uma versão validada).
 *
 * Módulo aditivo e puro (sem I/O). Usado pelo DocRegen (API e web); não altera
 * o comportamento de nenhum outro consumidor de `@workspace/clinical`.
 */
import { scoreSANE, type ScoreResult } from './instruments';
import { SANE_KNEE_CODE, SANE_KNEE_QUESTION } from './kneeFunction';

export type SaneRegionCode =
  | 'SANE_OMBRO'
  | 'SANE_JOELHO'
  | 'SANE_QUADRIL'
  | 'SANE_COTOVELO'
  | 'SANE_TORNOZELO_PE'
  | 'SANE_PUNHO_MAO'
  | 'SANE_COLUNA';

export interface SaneRegionDef {
  /** Código persistido em registros manuais (regen_prom_responses.instrument). */
  code: SaneRegionCode;
  /** Nome da escala no link do paciente (regen_scale_responses.nome_escala). */
  scale: string;
  /** Chave das colunas da exportação de pesquisa (`<key>_baseline` etc.). */
  researchKey: string;
  label: { 'pt-BR': string; es: string };
  question: { 'pt-BR': string; es: string };
  /** Título/descrição curtos exibidos ao paciente acima da pergunta. */
  title: { 'pt-BR': string; es: string };
  description: { 'pt-BR': string; es: string };
  /** Validação limitada na literatura para esta região (coluna). */
  limitedValidation: boolean;
}

const SLIDER_PT = 'Mova o controle deslizante de 0 a 100.';
const SLIDER_ES = 'Mueva el control deslizante de 0 a 100.';

function def(
  code: SaneRegionCode,
  scale: string,
  labelEs: string,
  question: SaneRegionDef['question'],
  title: SaneRegionDef['title'],
  about: SaneRegionDef['description'],
  limitedValidation = false
): SaneRegionDef {
  return {
    code,
    scale,
    researchKey: code.toLowerCase(),
    label: { 'pt-BR': scale, es: labelEs },
    question,
    title,
    description: {
      'pt-BR': `Uma única pergunta sobre como ${about['pt-BR']} hoje. ${SLIDER_PT}`,
      es: `Una sola pregunta sobre cómo ${about.es} hoy. ${SLIDER_ES}`
    },
    limitedValidation
  };
}

/** Catálogo em ordem de exibição. O SANE-joelho mantém código e texto já existentes. */
export const SANE_REGIONS: readonly SaneRegionDef[] = [
  def(
    'SANE_OMBRO', 'SANE Ombro', 'SANE Hombro',
    {
      'pt-BR': 'Em uma escala de 0 a 100, sendo 100 um ombro completamente normal, como você avalia seu ombro hoje?',
      es: 'En una escala de 0 a 100, donde 100 es un hombro completamente normal, ¿cómo evalúa su hombro hoy?'
    },
    { 'pt-BR': 'Avaliação do ombro (SANE)', es: 'Evaluación del hombro (SANE)' },
    { 'pt-BR': 'está o seu ombro', es: 'está su hombro' }
  ),
  def(
    SANE_KNEE_CODE as 'SANE_JOELHO', 'SANE Joelho', 'SANE Rodilla',
    { 'pt-BR': SANE_KNEE_QUESTION['pt-BR'], es: SANE_KNEE_QUESTION.es },
    { 'pt-BR': 'Avaliação do joelho (SANE)', es: 'Evaluación de la rodilla (SANE)' },
    { 'pt-BR': 'está o seu joelho', es: 'está su rodilla' }
  ),
  def(
    'SANE_QUADRIL', 'SANE Quadril', 'SANE Cadera',
    {
      'pt-BR': 'Em uma escala de 0 a 100, sendo 100 um quadril completamente normal, como você avalia seu quadril hoje?',
      es: 'En una escala de 0 a 100, donde 100 es una cadera completamente normal, ¿cómo evalúa su cadera hoy?'
    },
    { 'pt-BR': 'Avaliação do quadril (SANE)', es: 'Evaluación de la cadera (SANE)' },
    { 'pt-BR': 'está o seu quadril', es: 'está su cadera' }
  ),
  def(
    'SANE_COTOVELO', 'SANE Cotovelo', 'SANE Codo',
    {
      'pt-BR': 'Em uma escala de 0 a 100, sendo 100 um cotovelo completamente normal, como você avalia seu cotovelo hoje?',
      es: 'En una escala de 0 a 100, donde 100 es un codo completamente normal, ¿cómo evalúa su codo hoy?'
    },
    { 'pt-BR': 'Avaliação do cotovelo (SANE)', es: 'Evaluación del codo (SANE)' },
    { 'pt-BR': 'está o seu cotovelo', es: 'está su codo' }
  ),
  def(
    'SANE_TORNOZELO_PE', 'SANE Tornozelo e Pé', 'SANE Tobillo y Pie',
    {
      'pt-BR': 'Em uma escala de 0 a 100, sendo 100 um tornozelo/pé completamente normal, como você avalia seu tornozelo/pé hoje?',
      es: 'En una escala de 0 a 100, donde 100 es un tobillo/pie completamente normal, ¿cómo evalúa su tobillo/pie hoy?'
    },
    { 'pt-BR': 'Avaliação do tornozelo e pé (SANE)', es: 'Evaluación del tobillo y pie (SANE)' },
    { 'pt-BR': 'estão o seu tornozelo e o seu pé', es: 'están su tobillo y su pie' }
  ),
  def(
    'SANE_PUNHO_MAO', 'SANE Punho e Mão', 'SANE Muñeca y Mano',
    {
      'pt-BR': 'Em uma escala de 0 a 100, sendo 100 um punho/uma mão completamente normal, como você avalia seu punho/sua mão hoje?',
      es: 'En una escala de 0 a 100, donde 100 es una muñeca/mano completamente normal, ¿cómo evalúa su muñeca/mano hoy?'
    },
    { 'pt-BR': 'Avaliação do punho e mão (SANE)', es: 'Evaluación de la muñeca y mano (SANE)' },
    { 'pt-BR': 'estão o seu punho e a sua mão', es: 'están su muñeca y su mano' }
  ),
  def(
    'SANE_COLUNA', 'SANE Coluna', 'SANE Columna',
    {
      'pt-BR': 'Em uma escala de 0 a 100, sendo 100 uma coluna completamente normal, como você avalia sua coluna hoje?',
      es: 'En una escala de 0 a 100, donde 100 es una columna completamente normal, ¿cómo evalúa su columna hoy?'
    },
    { 'pt-BR': 'Avaliação da coluna (SANE)', es: 'Evaluación de la columna (SANE)' },
    { 'pt-BR': 'está a sua coluna', es: 'está su columna' },
    true
  )
];

const BY_NAME: ReadonlyMap<string, SaneRegionDef> = new Map(
  SANE_REGIONS.flatMap((d) => [[d.code, d] as const, [d.scale, d] as const])
);

/** Definição pelo código manual ("SANE_OMBRO") ou pelo nome do link ("SANE Ombro"). */
export function saneRegionByInstrument(name: unknown): SaneRegionDef | null {
  return typeof name === 'string' ? BY_NAME.get(name) ?? null : null;
}

export function isSaneRegionInstrument(name: unknown): boolean {
  return saneRegionByInstrument(name) !== null;
}

/**
 * Região anatômica (grupos do catálogo de condições) → SANE recomendado.
 * Cervical, torácica, lombar e coluna sem nível compartilham o SANE Coluna. Regiões sem
 * articulação/segmento definido ("outras") não têm SANE: só VAS.
 */
const BY_BODY_REGION: Readonly<Record<string, SaneRegionCode>> = {
  ombro: 'SANE_OMBRO',
  joelho: 'SANE_JOELHO',
  quadril: 'SANE_QUADRIL',
  cotovelo: 'SANE_COTOVELO',
  pe_tornozelo: 'SANE_TORNOZELO_PE',
  punho_mao: 'SANE_PUNHO_MAO',
  coluna_cervical: 'SANE_COLUNA',
  coluna_toracica: 'SANE_COLUNA',
  coluna_lombar: 'SANE_COLUNA',
  // Coluna sem nível definido (local de aplicação peridural/intradiscal).
  coluna: 'SANE_COLUNA'
};

export function saneForBodyRegion(region: string | null | undefined): SaneRegionDef | null {
  const code = region ? BY_BODY_REGION[region] : undefined;
  return code ? BY_NAME.get(code)! : null;
}

/** Escore: inteiro 0–100 (100 = região normal). Reutiliza `scoreSANE`. */
export function scoreSANERegion(instrument: string, a: { value: number }): ScoreResult {
  const d = saneRegionByInstrument(instrument);
  if (!d) throw new Error(`SANE desconhecido: ${instrument}`);
  return { ...scoreSANE(a), instrument: d.code };
}
