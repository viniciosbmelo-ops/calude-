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
 * Cada linha de local de aplicação tem até três campos:
 *   - `estruturaAnatomica` (catálogo abaixo, código estável) — o alvo anatômico;
 *   - `estruturaAnatomicaDetalhe` — texto livre de "Músculo (especificar)" /
 *     "Outro (especificar)" (não entra no mapeamento nem na exportação);
 *   - `localAplicacao` (compartimento: "Intra-articular", "Tendão patelar"…).
 * A estrutura anatômica, quando preenchida, define a região da linha; sem ela,
 * vale o compartimento (só "Tendão patelar" identifica uma região).
 *
 * Catálogo atual (`APPLICATION_ANATOMICAL_SITES`): principais alvos de
 * infiltração/terapia regenerativa por articulação, agrupados por região
 * (`APPLICATION_SITE_GROUPS`). Códigos da primeira versão do catálogo
 * (JOELHO, MENISCO, OMBRO…) continuam válidos como aliases legados
 * (`LEGACY_APPLICATION_ANATOMICAL_SITES`): carregam, exibem o rótulo antigo e
 * mapeiam para a mesma região, mas não são oferecidos em novos registros.
 *
 * Todos os itens estão aqui, mapeados ou deliberadamente sem região
 * (`region: null` + `unmappedReason`). Módulo aditivo e puro (sem I/O).
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
  | 'coluna_lombar'
  /** Coluna sem nível definido (peridural, intradiscal): mesmo SANE Coluna. */
  | 'coluna';

/** Grupos de exibição do seletor de estrutura anatômica (cabeçalhos de região). */
export type ApplicationSiteGroup =
  | 'ombro'
  | 'cotovelo'
  | 'punho_mao'
  | 'quadril'
  | 'joelho'
  | 'pe_tornozelo'
  | 'coluna'
  | 'pelve'
  | 'outros';

export interface ApplicationSiteGroupDef {
  code: ApplicationSiteGroup;
  label: { 'pt-BR': string; es: string };
}

/** Grupos em ordem de exibição. */
export const APPLICATION_SITE_GROUPS: readonly ApplicationSiteGroupDef[] = [
  { code: 'ombro', label: { 'pt-BR': 'Ombro', es: 'Hombro' } },
  { code: 'cotovelo', label: { 'pt-BR': 'Cotovelo', es: 'Codo' } },
  { code: 'punho_mao', label: { 'pt-BR': 'Punho e Mão', es: 'Muñeca y Mano' } },
  { code: 'quadril', label: { 'pt-BR': 'Quadril', es: 'Cadera' } },
  { code: 'joelho', label: { 'pt-BR': 'Joelho', es: 'Rodilla' } },
  { code: 'pe_tornozelo', label: { 'pt-BR': 'Tornozelo e Pé', es: 'Tobillo y Pie' } },
  { code: 'coluna', label: { 'pt-BR': 'Coluna', es: 'Columna' } },
  { code: 'pelve', label: { 'pt-BR': 'Pelve', es: 'Pelvis' } },
  { code: 'outros', label: { 'pt-BR': 'Outros', es: 'Otros' } }
];

export interface ApplicationSiteDef {
  /** Valor persistido (product_details.locaisAplicacao[].estruturaAnatomica). */
  code: string;
  label: { 'pt-BR': string; es: string };
  region: SaneBodyRegion | null;
  /** Grupo de exibição (só no catálogo de estruturas anatômicas). */
  group?: ApplicationSiteGroup;
  /** Pede texto livre complementar ("especificar"). */
  freeText?: boolean;
  /** Código da versão anterior do catálogo: aceito, não oferecido. */
  legacy?: boolean;
  /** Por que o local não tem região (quando `region` é null). */
  unmappedReason?: string;
}

function site(code: string, pt: string, es: string, region: SaneBodyRegion | null, unmappedReason?: string): ApplicationSiteDef {
  return { code, label: { 'pt-BR': pt, es }, region, ...(unmappedReason ? { unmappedReason } : {}) };
}

type SiteRow = [code: string, pt: string, es: string, region?: SaneBodyRegion | null, unmappedReason?: string];

function inGroup(group: ApplicationSiteGroup, region: SaneBodyRegion | null, rows: SiteRow[]): ApplicationSiteDef[] {
  return rows.map(([code, pt, es, rowRegion, reason]) => ({
    ...site(code, pt, es, rowRegion === undefined ? region : rowRegion, reason),
    group
  }));
}

/** Catálogo de estruturas anatômicas (local de aplicação), agrupado e em ordem de exibição. */
export const APPLICATION_ANATOMICAL_SITES: readonly ApplicationSiteDef[] = [
  ...inGroup('ombro', 'ombro', [
    ['OMBRO_GLENOUMERAL', 'Articulação glenoumeral', 'Articulación glenohumeral'],
    ['OMBRO_BURSA_SASD', 'Bursa subacromial-subdeltoidea', 'Bursa subacromial-subdeltoidea'],
    ['OMBRO_ACROMIOCLAVICULAR', 'Articulação acromioclavicular', 'Articulación acromioclavicular'],
    ['OMBRO_SUPRAESPINAL', 'Tendão do supraespinal / manguito rotador', 'Tendón del supraespinoso / manguito rotador'],
    ['OMBRO_CABECA_LONGA_BICEPS', 'Cabeça longa do bíceps (sulco bicipital)', 'Porción larga del bíceps (corredera bicipital)'],
    ['OMBRO_NERVO_SUPRAESCAPULAR', 'Nervo supraescapular', 'Nervio supraescapular']
  ]),
  ...inGroup('cotovelo', 'cotovelo', [
    ['COTOVELO_ARTICULACAO', 'Articulação do cotovelo', 'Articulación del codo'],
    ['COTOVELO_EPICONDILO_LATERAL', 'Epicôndilo lateral (tendão extensor comum)', 'Epicóndilo lateral (tendón extensor común)'],
    ['COTOVELO_EPICONDILO_MEDIAL', 'Epicôndilo medial (tendão flexor comum)', 'Epicóndilo medial (tendón flexor común)'],
    ['COTOVELO_BURSA_OLECRANIANA', 'Bursa olecraniana', 'Bursa olecraniana']
  ]),
  ...inGroup('punho_mao', 'punho_mao', [
    ['PUNHO_RADIOCARPAL', 'Articulação radiocarpal', 'Articulación radiocarpiana'],
    ['PUNHO_DE_QUERVAIN', '1º compartimento extensor (De Quervain)', '1.er compartimento extensor (De Quervain)'],
    ['PUNHO_TUNEL_DO_CARPO', 'Túnel do carpo', 'Túnel carpiano'],
    ['MAO_TRAPEZIOMETACARPIANA', 'Articulação trapeziometacarpiana (rizartrose)', 'Articulación trapeciometacarpiana (rizartrosis)'],
    ['MAO_POLIA_A1', 'Polia A1 (dedo em gatilho)', 'Polea A1 (dedo en gatillo)'],
    ['MAO_INTERFALANGICAS_MCF', 'Articulações interfalângicas/metacarpofalângicas', 'Articulaciones interfalángicas/metacarpofalángicas']
  ]),
  ...inGroup('quadril', 'quadril', [
    ['QUADRIL_COXOFEMORAL', 'Articulação coxofemoral', 'Articulación coxofemoral'],
    ['QUADRIL_TROCANTER_BURSA', 'Trocânter maior / bursa trocantérica', 'Trocánter mayor / bursa trocantérea'],
    ['QUADRIL_GLUTEO_MEDIO_MINIMO', 'Tendão do glúteo médio/mínimo', 'Tendón del glúteo medio/menor'],
    ['QUADRIL_ISQUIOTIBIAIS_PROXIMAIS', 'Isquiotibiais proximais', 'Isquiotibiales proximales'],
    ['QUADRIL_ILIOPSOAS', 'Iliopsoas / bursa iliopectínea', 'Iliopsoas / bursa iliopectínea']
  ]),
  ...inGroup('joelho', 'joelho', [
    ['JOELHO_TIBIOFEMORAL', 'Intra-articular (tibiofemoral)', 'Intraarticular (tibiofemoral)'],
    ['JOELHO_FEMOROPATELAR', 'Articulação femoropatelar', 'Articulación femororrotuliana'],
    ['JOELHO_TENDAO_PATELAR', 'Tendão patelar', 'Tendón rotuliano'],
    ['JOELHO_TENDAO_QUADRICIPITAL', 'Tendão quadricipital', 'Tendón cuadricipital'],
    ['JOELHO_MENISCO_MEDIAL', 'Menisco medial', 'Menisco medial'],
    ['JOELHO_MENISCO_LATERAL', 'Menisco lateral', 'Menisco lateral'],
    ['JOELHO_PATA_DE_GANSO', 'Pata de ganso', 'Pata de ganso'],
    ['JOELHO_LIGAMENTO_COLATERAL_MEDIAL', 'Ligamento colateral medial', 'Ligamento colateral medial'],
    ['JOELHO_GORDURA_HOFFA', 'Gordura de Hoffa', 'Grasa de Hoffa'],
    ['JOELHO_CISTO_BAKER', 'Cisto de Baker', 'Quiste de Baker'],
    ['JOELHO_OSSO_SUBCONDRAL', 'Osso subcondral (subcondroplastia)', 'Hueso subcondral (subcondroplastia)']
  ]),
  ...inGroup('pe_tornozelo', 'pe_tornozelo', [
    ['TORNOZELO_TIBIOTARSICA', 'Articulação tibiotársica', 'Articulación tibiotarsiana'],
    ['TORNOZELO_SUBTALAR', 'Articulação subtalar', 'Articulación subastragalina'],
    ['TORNOZELO_TENDAO_AQUILES', 'Tendão de Aquiles', 'Tendón de Aquiles'],
    ['PE_FASCIA_PLANTAR', 'Fáscia plantar', 'Fascia plantar'],
    ['PE_PRIMEIRA_MTF', '1ª articulação metatarsofalângica', '1.ª articulación metatarsofalángica'],
    ['PE_SEIO_DO_TARSO', 'Seio do tarso', 'Seno del tarso']
  ]),
  ...inGroup('coluna', null, [
    ['COLUNA_FACETARIA_CERVICAL', 'Facetária cervical', 'Facetaria cervical', 'coluna_cervical'],
    ['COLUNA_FACETARIA_TORACICA', 'Facetária torácica', 'Facetaria torácica', 'coluna_toracica'],
    ['COLUNA_FACETARIA_LOMBAR', 'Facetária lombar', 'Facetaria lumbar', 'coluna_lombar'],
    ['COLUNA_PERIDURAL', 'Peridural', 'Epidural', 'coluna'],
    ['COLUNA_INTRADISCAL', 'Discal (intradiscal)', 'Discal (intradiscal)', 'coluna']
  ]),
  ...inGroup('pelve', null, [
    ['SACROILIACA', 'Articulação sacroilíaca', 'Articulación sacroilíaca', null,
      'articulação pélvica: não é coluna nem quadril; nenhum SANE regional a cobre']
  ]),
  ...inGroup('outros', null, [
    ['MUSCULO', 'Músculo (especificar)', 'Músculo (especificar)', null,
      'estrutura sem região própria: o músculo pode estar em qualquer segmento'],
    ['OUTRO', 'Outro (especificar)', 'Otro (especificar)', null, 'texto livre sem região definida']
  ]).map((d) => ({ ...d, freeText: true }))
];

/**
 * Códigos da primeira versão do catálogo, mantidos para registros já salvos:
 * mesmo rótulo e mesma região de antes. Não aparecem no seletor para novos
 * registros (SACROILIACA, MUSCULO e OUTRO seguem no catálogo atual).
 */
export const LEGACY_APPLICATION_ANATOMICAL_SITES: readonly ApplicationSiteDef[] = [
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
  site('COLUNA_LOMBAR', 'Coluna lombar', 'Columna lumbar', 'coluna_lombar')
].map((d) => ({ ...d, legacy: true }));

/** Estruturas do catálogo atual agrupadas por região, em ordem de exibição. */
export function groupedApplicationAnatomicalSites(): { group: ApplicationSiteGroupDef; sites: ApplicationSiteDef[] }[] {
  return APPLICATION_SITE_GROUPS.map((group) => ({
    group,
    sites: APPLICATION_ANATOMICAL_SITES.filter((s) => s.group === group.code)
  }));
}

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

/**
 * Índice por código e rótulos (pt-BR/es), sem diferenciar acentos/caixa.
 * Códigos têm precedência sobre rótulos e o catálogo atual sobre o legado
 * (ex.: o código legado TENDAO_PATELAR continua resolvendo para si mesmo,
 * enquanto o rótulo "Tendão patelar" resolve para o item atual).
 */
function index(...lists: (readonly ApplicationSiteDef[])[]): ReadonlyMap<string, ApplicationSiteDef> {
  const map = new Map<string, ApplicationSiteDef>();
  const add = (key: string, d: ApplicationSiteDef) => {
    if (!map.has(key)) map.set(key, d);
  };
  for (const d of lists.flat()) add(d.code, d);
  for (const defs of lists) {
    for (const d of defs) add(loose(d.code), d);
    for (const d of defs) {
      add(loose(d.label['pt-BR']), d);
      add(loose(d.label.es), d);
    }
  }
  return map;
}

const ANATOMICAL_BY_NAME = index(APPLICATION_ANATOMICAL_SITES, LEGACY_APPLICATION_ANATOMICAL_SITES);
const COMPARTMENT_BY_NAME = index(APPLICATION_COMPARTMENTS);

/**
 * Estrutura anatômica (atual ou legada) pelo código exato ou pelo código/rótulo
 * (pt-BR/es) sem diferenciar acentos/caixa; null se desconhecida.
 */
export function applicationAnatomicalSite(value: unknown): ApplicationSiteDef | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return ANATOMICAL_BY_NAME.get(value.trim()) ?? ANATOMICAL_BY_NAME.get(loose(value)) ?? null;
}

/** Rótulo de exibição de uma estrutura (código atual/legado) no idioma; desconhecida → o próprio valor. */
export function applicationAnatomicalSiteLabel(value: string, locale: string): string {
  const d = applicationAnatomicalSite(value);
  if (!d) return value;
  return locale.startsWith('es') ? d.label.es : d.label['pt-BR'];
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
