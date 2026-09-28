/**
 * Opções do núcleo cirúrgico (CORE_SURGERY) conforme a região e o tipo de acesso.
 *
 * O schema CORE_SURGERY.v1 é único para ombro e cotovelo: as listas `approach` e `portals`
 * trazem as opções das duas regiões juntas. Aqui elas são apenas SEPARADAS por região —
 * nenhuma opção nova é criada (o teste coreOptions.test.ts garante que a partição cobre
 * exatamente os valores do schema). O schema e o formato gravado não mudam.
 *
 * Tipo de acesso: registrado em `approach`. "arthroscopic" presente = cirurgia artroscópica
 * (isolada ou associada a acesso aberto); ausente = cirurgia puramente aberta.
 */
import type { Region } from '../catalog/pathologies';
import type { ValidationIssue } from '../ajvMessages';
import labels from '../labels.pt.json';

type Obj = Record<string, any>;
const L = labels as unknown as Record<string, Record<string, string>>;

export const ARTHROSCOPIC_APPROACH = 'arthroscopic';

/**
 * Partição das listas existentes do CORE_SURGERY.v1 por região (mesma ordem do schema).
 * Um valor pode pertencer às duas regiões: "arthroscopic" e a via "posterior" (padrão no
 * cotovelo para úmero distal / olécrano).
 */
export const CORE_OPTIONS_BY_REGION: Record<'approach' | 'portals', Record<Region, readonly string[]>> = {
  approach: {
    shoulder: ['arthroscopic', 'deltopectoral', 'anterolateral_deltoid_split', 'superolateral', 'posterior', 'open_subpectoral'],
    elbow: [
      'arthroscopic', 'posterior', 'kocher', 'kaplan', 'boyd', 'medial_flexor_pronator_split', 'triceps_sparing', 'triceps_split',
      'olecranon_osteotomy', 'anterior_elbow_single_incision', 'double_incision_elbow'
    ]
  },
  portals: {
    shoulder: ['posterior', 'anterior', 'anterolateral', 'lateral', 'neviaser', 'portal_5h', 'portal_7h', 'posterolateral'],
    // Portais de cotovelo: prefixo "el_" no schema
    elbow: ['el_anteromedial', 'el_proximal_anterolateral', 'el_posterolateral', 'el_transtricipital', 'el_soft_spot']
  }
};

const REGION_PT: Record<Region, string> = { shoulder: 'ombro', elbow: 'cotovelo' };

/** Há registro do tipo de acesso (lista `approach` preenchida)? */
export function hasAccessType(geral: Obj | null | undefined): boolean {
  return Array.isArray(geral?.approach) && geral!.approach.length > 0;
}

/** A cirurgia teve tempo artroscópico (approach inclui "arthroscopic")? */
export function isArthroscopic(geral: Obj | null | undefined): boolean {
  return Array.isArray(geral?.approach) && geral!.approach.includes(ARTHROSCOPIC_APPROACH);
}

/** Cirurgia registrada como puramente aberta (tipo de acesso informado, sem "arthroscopic"). */
export function isOpenOnly(geral: Obj | null | undefined): boolean {
  return hasAccessType(geral) && !isArthroscopic(geral);
}

/**
 * Campos do núcleo que não se aplicam às escolhas atuais (ocultos no formulário e
 * removidos do payload): ângulo da cadeira de praia sem posição em cadeira de praia;
 * portais sem acesso artroscópico.
 */
export function inapplicableCoreFields(geral: Obj | null | undefined): string[] {
  const out: string[] = [];
  if (geral?.positioning !== 'beach_chair') out.push('beach_chair_angle_deg');
  if (!isArthroscopic(geral)) out.push('portals');
  return out;
}

/** Remove os campos que não se aplicam (ver inapplicableCoreFields). Não altera o objeto recebido. */
export function withoutInapplicableCore<T extends Obj>(geral: T): T {
  const out: Obj = { ...geral };
  for (const f of inapplicableCoreFields(geral)) delete out[f];
  return out as T;
}

/** Remove valores de via de acesso/portais que pertencem à outra região. */
export function withoutOtherRegionOptions<T extends Obj>(region: Region, geral: T): T {
  const out: Obj = { ...geral };
  for (const field of ['approach', 'portals'] as const) {
    if (!Array.isArray(out[field])) continue;
    const allowed = CORE_OPTIONS_BY_REGION[field][region];
    const kept = (out[field] as unknown[]).filter((v) => allowed.includes(String(v)));
    if (kept.length) out[field] = kept;
    else delete out[field];
  }
  return out as T;
}

/**
 * Cópia do schema CORE_SURGERY com as opções de via de acesso e portais da região.
 * Valores já gravados fora da região continuam visíveis para que possam ser desmarcados
 * (e coreRegionIssues aponta a pendência).
 */
export function coreSchemaForRegion(schema: Obj, region: Region, geral: Obj = {}): Obj {
  const props: Obj = { ...(schema.properties ?? {}) };
  for (const field of ['approach', 'portals'] as const) {
    const sub = props[field];
    if (!sub?.items?.enum) continue;
    const allowed = CORE_OPTIONS_BY_REGION[field][region];
    const current: unknown[] = Array.isArray(geral[field]) ? geral[field] : [];
    const en = (sub.items.enum as string[]).filter((v) => allowed.includes(v) || current.includes(v));
    props[field] = { ...sub, items: { ...sub.items, enum: en } };
  }
  return { ...schema, properties: props };
}

/**
 * Regras do núcleo que dependem da região / do tipo de acesso (não expressas no JSON Schema).
 * Usadas ao gravar como completo e no formulário (mesmas pendências nos dois lados).
 */
export function coreRegionIssues(region: Region, geral: Obj | null | undefined): ValidationIssue[] {
  const g = geral ?? {};
  const issues: ValidationIssue[] = [];
  for (const field of ['approach', 'portals'] as const) {
    if (!Array.isArray(g[field])) continue;
    const allowed = CORE_OPTIONS_BY_REGION[field][region];
    const bad = (g[field] as unknown[]).map(String).filter((v) => !allowed.includes(v));
    if (bad.length) {
      const what = field === 'approach' ? 'Via de acesso' : 'Portal';
      const names = bad.map((v) => L[field]?.[v] ?? v).join(', ');
      issues.push({ field, keyword: 'region', message_pt: `${what} não se aplica ao ${REGION_PT[region]}: ${names}.` });
    }
  }
  if (g.beach_chair_angle_deg !== undefined && g.positioning !== 'beach_chair') {
    issues.push({ field: 'beach_chair_angle_deg', keyword: 'dependencies', message_pt: 'Ângulo da cadeira de praia só se aplica ao posicionamento em cadeira de praia.' });
  }
  if (Array.isArray(g.portals) && g.portals.length > 0 && hasAccessType(g) && !isArthroscopic(g)) {
    issues.push({ field: 'portals', keyword: 'dependencies', message_pt: 'Portais só se aplicam a cirurgia com acesso artroscópico.' });
  }
  return issues;
}
