/**
 * Local de aplicação → região corporal → SANE, para casos regenerativos cuja
 * condição não tem região ("outras": lesão condral focal, tendinopatia,
 * bursite… e códigos legados).
 *
 * Regra (`saneForCase`):
 *   1. condição com região (joelho, ombro, …) → SANE dessa região (inalterado);
 *   2. senão, se TODOS os locais de aplicação mapeiam para o mesmo SANE → esse SANE;
 *   3. sem local, algum local não mapeado ou locais em regiões diferentes → só VAS (null).
 *
 * Cada linha de local de aplicação tem dois campos:
 *   - `estruturaAnatomica` (catálogo abaixo, código estável) — o local anatômico;
 *   - `localAplicacao` (compartimento: "Intra-articular", "Tendão patelar"…).
 * A estrutura anatômica, quando preenchida, define a região da linha; sem ela,
 * vale o compartimento (só "Tendão patelar" identifica uma região).
 *
 * Todos os itens dos dois catálogos estão aqui, mapeados ou deliberadamente sem
 * região (`region: null` + `unmappedReason`). Módulo aditivo e puro (sem I/O).
 */
import { saneForBodyRegion, type SaneRegionDef } from './regionSane';

/** Regiões do catálogo de condições que têm SANE (ver `saneForBodyRegion`). */
export type SaneBodyRegion =
  | 'joelho'
  | 'ombro'
  | 'quadril'
  | 'cotovelo'
  | 'pe_tornozelo'
  | 'punho_mao'
  | 'coluna_cervical'
  | 'coluna_toracica'
  | 'coluna_lombar';

export interface ApplicationSiteDef {
  /** Valor persistido (product_details.locaisAplicacao[].estruturaAnatomica). */
  code: string;
  label: { 'pt-BR': string; es: string };
  region: SaneBodyRegion | null;
  /** Por que o local não tem região (quando `region` é null). */
  unmappedReason?: string;
}

function site(code: string, pt: string, es: string, region: SaneBodyRegion | null, unmappedReason?: string): ApplicationSiteDef {
  return { code, label: { 'pt-BR': pt, es }, region, ...(unmappedReason ? { unmappedReason } : {}) };
}

/** Catálogo de estruturas anatômicas (local de aplicação), em ordem de exibição. */
export const APPLICATION_ANATOMICAL_SITES: readonly ApplicationSiteDef[] = [
  site('JOELHO', 'Joelho', 'Rodilla', 'joelho'),
  site('PATELA', 'Patela / femoropatelar', 'Rótula / femororrotuliana', 'joelho'),
  site('TENDAO_PATELAR', 'Tendão patelar', 'Tendón rotuliano', 'joelho'),
  site('TENDAO_QUADRICIPITAL', 'Tendão quadricipital', 'Tendón cuadricipital', 'joelho'),
  site('MENISCO', 'Menisco', 'Menisco', 'joelho'),
  site('PATA_DE_GANSO', 'Pata de ganso', 'Pata de ganso', 'joelho'),
  site('OMBRO', 'Ombro (glenoumeral)', 'Hombro (glenohumeral)', 'ombro'),
  site('MANGUITO_ROTADOR', 'Manguito rotador', 'Manguito rotador', 'ombro'),
  site('BURSA_SUBACROMIAL', 'Bursa subacromial', 'Bursa subacromial', 'ombro'),
  site('ACROMIOCLAVICULAR', 'Acromioclavicular', 'Acromioclavicular', 'ombro'),
  site('COTOVELO', 'Cotovelo', 'Codo', 'cotovelo'),
  site('EPICONDILO_LATERAL', 'Epicôndilo lateral', 'Epicóndilo lateral', 'cotovelo'),
  site('EPICONDILO_MEDIAL', 'Epicôndilo medial', 'Epicóndilo medial', 'cotovelo'),
  site('QUADRIL', 'Quadril (coxofemoral)', 'Cadera (coxofemoral)', 'quadril'),
  site('TROCANTER', 'Trocânter maior', 'Trocánter mayor', 'quadril'),
  site('TORNOZELO', 'Tornozelo', 'Tobillo', 'pe_tornozelo'),
  site('TENDAO_AQUILES', 'Tendão de Aquiles', 'Tendón de Aquiles', 'pe_tornozelo'),
  site('FASCIA_PLANTAR', 'Fáscia plantar', 'Fascia plantar', 'pe_tornozelo'),
  site('PE', 'Pé', 'Pie', 'pe_tornozelo'),
  site('PUNHO', 'Punho', 'Muñeca', 'punho_mao'),
  site('MAO', 'Mão / dedos', 'Mano / dedos', 'punho_mao'),
  site('TUNEL_DO_CARPO', 'Túnel do carpo', 'Túnel carpiano', 'punho_mao'),
  site('COLUNA_CERVICAL', 'Coluna cervical', 'Columna cervical', 'coluna_cervical'),
  site('COLUNA_TORACICA', 'Coluna torácica', 'Columna torácica', 'coluna_toracica'),
  site('COLUNA_LOMBAR', 'Coluna lombar', 'Columna lumbar', 'coluna_lombar'),
  site('SACROILIACA', 'Sacroilíaca', 'Sacroilíaca', null,
    'articulação pélvica: não é coluna nem quadril; nenhum SANE regional a cobre'),
  site('MUSCULO', 'Músculo (ventre muscular)', 'Músculo (vientre muscular)', null,
    'estrutura sem região própria: o músculo pode estar em qualquer segmento'),
  site('OUTRO', 'Outro', 'Otro', null, 'texto livre sem região definida')
];

/**
 * Compartimentos do campo `localAplicacao` (catálogo do formulário do caso).
 * Só "Tendão patelar" identifica uma região; os demais descrevem o
 * compartimento, não a articulação/segmento.
 */
export const APPLICATION_COMPARTMENTS: readonly ApplicationSiteDef[] = [
  site('Intra-articular', 'Intra-articular', 'Intraarticular', null, 'compartimento: vale para qualquer articulação'),
  site('Subcondroplastia', 'Subcondroplastia', 'Subcondroplastia', null, 'técnica/compartimento subcondral: qualquer articulação'),
  site('Tecido periarticular', 'Tecido periarticular', 'Tejido periarticular', null, 'compartimento: qualquer articulação'),
  site('Tendão patelar', 'Tendão patelar', 'Tendón rotuliano', 'joelho'),
  site('Ligamento', 'Ligamento', 'Ligamento', null, 'ligamento não especificado: qualquer articulação'),
  site('Outro', 'Outro', 'Otro', null, 'texto livre sem região definida')
];

const loose = (value: string) =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/[\s_/-]+/g, ' ');

function index(defs: readonly ApplicationSiteDef[]): ReadonlyMap<string, ApplicationSiteDef> {
  return new Map(defs.flatMap((d) => [d.code, d.label['pt-BR'], d.label.es].map((n) => [loose(n), d] as const)));
}

const ANATOMICAL_BY_NAME = index(APPLICATION_ANATOMICAL_SITES);
const COMPARTMENT_BY_NAME = index(APPLICATION_COMPARTMENTS);

/** Estrutura anatômica pelo código ou rótulo (pt-BR/es); null se desconhecida. */
export function applicationAnatomicalSite(value: unknown): ApplicationSiteDef | null {
  return typeof value === 'string' && value.trim() ? ANATOMICAL_BY_NAME.get(loose(value)) ?? null : null;
}

/** Linha de local de aplicação (mesmo formato do product_details do caso). */
export interface ApplicationSiteInput {
  localAplicacao?: string | null;
  estruturaAnatomica?: string | null;
}

/** Sem local na linha (só guia, por exemplo). */
const EMPTY = Symbol('empty');

/**
 * Região de uma linha: a estrutura anatômica define; sem ela, o compartimento.
 * Retorna null para local não mapeado e EMPTY para linha sem local.
 */
function rowRegion(row: ApplicationSiteInput): SaneBodyRegion | null | typeof EMPTY {
  const structure = typeof row.estruturaAnatomica === 'string' ? row.estruturaAnatomica.trim() : '';
  const compartment = typeof row.localAplicacao === 'string' ? row.localAplicacao.trim() : '';
  if (structure) return applicationAnatomicalSite(structure)?.region ?? null;
  if (compartment) return COMPARTMENT_BY_NAME.get(loose(compartment))?.region ?? null;
  return EMPTY;
}

/**
 * Região única dos locais de aplicação (comparada pelo SANE: cervical, torácica
 * e lombar compartilham o SANE Coluna), ou null — sem local, local não mapeado
 * ou locais em regiões com SANE diferentes.
 */
export function saneForApplicationSites(
  sites: readonly ApplicationSiteInput[] | null | undefined
): SaneRegionDef | null {
  let found: SaneRegionDef | null = null;
  for (const row of sites ?? []) {
    const region = rowRegion(row);
    if (region === EMPTY) continue;
    const sane = saneForBodyRegion(region);
    if (!sane) return null;
    if (found && found.code !== sane.code) return null;
    found = sane;
  }
  return found;
}

/**
 * SANE do caso: o da região da condição; para condições sem região, o derivado
 * dos locais de aplicação; senão null (só VAS).
 */
export function saneForCase(
  conditionRegion: string | null | undefined,
  sites: readonly ApplicationSiteInput[] | null | undefined
): SaneRegionDef | null {
  return saneForBodyRegion(conditionRegion) ?? saneForApplicationSites(sites);
}
