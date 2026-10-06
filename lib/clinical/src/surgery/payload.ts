/**
 * Dados clínicos de uma cirurgia de ombro/cotovelo (coluna surgeries.dados_clinicos).
 *
 * Data, lado e hospital NÃO ficam aqui: são colunas da cirurgia (DocSholder) e entram
 * no núcleo cirúrgico (CORE_SURGERY) por `coreFromSurgery`, sem duplicar a informação.
 *
 * Rascunho: `parseClinicalPayload` só garante a FORMA (tipos e limites).
 * Finalização: `validateClinicalPayload` exige tudo válido pelos schemas.
 *
 * Versões: a v2 acrescenta o bloco opcional `avaliacaoPreop` (avaliação pré-operatória).
 * Payloads v1 (sem o bloco) continuam aceitos na leitura, na gravação, na finalização e no relatório.
 * O bloco pré-operatório NÃO entra no texto do relatório cirúrgico.
 */
import type { ArthroMapEntry, ReportInput, ReportImplant } from '../report/reportEngine';
import { ARTHRO_STRUCTURES, PATHOLOGY_BY_CODE, Region } from '../catalog/pathologies';
import { CASE_TYPE_BY_KEY, diagnosisSchemaId, intraopSchemaId } from '../catalog/caseTypes';
import type { SchemaRegistry, ValidationIssue } from '../schemaRegistry';
import { coreRegionIssues, isOpenOnly } from './coreOptions';
import { semCamposDoCadastro } from '../patient/profile';

export const CLINICAL_PAYLOAD_VERSION = 2;
/** Versões de payload aceitas na leitura (a v1 não tem `avaliacaoPreop`). */
export const SUPPORTED_PAYLOAD_VERSIONS = [1, 2] as const;
/**
 * Schema dos campos comuns da avaliação pré-operatória. A v2 tem só a data da avaliação: lado dominante,
 * tabagismo, diabetes e nível de atividade passaram para o cadastro do paciente (ver patient/profile.ts).
 */
export const PREOP_COMMON_SCHEMA = 'PREOP_COMMON.v2';
/** Limite de sub-blocos por patologia na avaliação pré-operatória. */
export const MAX_PREOP_BLOCKS = 10;
export const MAX_FREE_TEXT = 4000;
/** Tamanho máximo (bytes do JSON) de `avaliacaoPreop.comum` e de cada `patologias[].dados`, também no rascunho. */
export const MAX_PREOP_JSON_BYTES = 64 * 1024;
/** Profundidade máxima de aninhamento (o próprio objeto conta 1) de `comum` e de cada `patologias[].dados`. */
export const MAX_PREOP_DEPTH = 5;

export type SurgerySideLabel = 'Direito' | 'Esquerdo';

export interface ClinicalProcedure {
  /** Chave do tipo de caso (CASE_TYPES.key) */
  tipoCaso: string;
  /** Código da patologia do catálogo; null nos tipos só de descrição livre */
  codigo: string | null;
  sequencia: number;
  /** Dados do schema intraoperatório, ou { descricao } quando não há schema */
  dados: Record<string, any>;
}

export interface ClinicalImplant {
  categoria: string;
  fabricante: string;
  modelo: string;
  tamanho?: string;
  lote?: string;
  serie?: string;
  validade?: string;
  quantidade: number;
  localizacao?: string;
  codigoBarras?: string;
}

export interface ClinicalMapEntry extends ArthroMapEntry {
  justification?: string;
}

/** Sub-bloco da avaliação pré-operatória de uma patologia, validado pelo `<código>.diagnosis.vN` do catálogo. */
export interface PreopPathologyAssessment {
  /** Código da patologia do catálogo (ex.: SH_RCT_FULL); define o schema */
  codigo: string;
  /** Id do schema de diagnóstico (PATHOLOGIES[].diagnosis), ex.: SH_RCT.diagnosis.v1 */
  schema: string;
  dados: Record<string, any>;
}

/**
 * Avaliação pré-operatória (payload v2). Tudo opcional; a validação cobre só tipo e faixa.
 * `comum` segue PREOP_COMMON.v2 (data da avaliação). Lado dominante, tabagismo, diabetes e nível de atividade
 * ficam no cadastro do paciente; payloads gravados com eles (v1 do schema) são lidos sem esses campos.
 * `patologias` tem no máximo um sub-bloco por schema de diagnóstico.
 */
export interface PreopAssessment {
  comum: Record<string, any>;
  patologias: PreopPathologyAssessment[];
}

export interface ClinicalPayload {
  versao: number;
  regiao: Region;
  /** Campos do CORE_SURGERY exceto surgery_date, side e hospital */
  geral: Record<string, any>;
  procedimentos: ClinicalProcedure[];
  mapaArtroscopico: ClinicalMapEntry[];
  implantes: ClinicalImplant[];
  /** v2: avaliação pré-operatória; ausente nos payloads v1 e quando nada foi preenchido */
  avaliacaoPreop?: PreopAssessment;
}

export interface SurgeryColumns {
  dataCirurgia?: string | null;
  lado?: string | null;
  hospital?: string | null;
}

export interface IssueGroup {
  scope: string;
  issues: ValidationIssue[];
}

export class ClinicalPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClinicalPayloadError';
  }
}

/** Categorias de implante aceitas (valor gravado em implantes[].categoria). */
export const IMPLANT_CATEGORIES = ['anchor', 'screw', 'plate', 'button', 'prosthesis_component', 'graft', 'suture_tape', 'other'] as const;
const MAP_STATUSES = ['normal', 'lesion', 'treated', 'not_evaluated'] as const;

function isObj(v: unknown): v is Record<string, any> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
const optStr = (v: unknown, max: number, field: string): string | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string' || v.length > max) throw new ClinicalPayloadError(`${field}: texto até ${max} caracteres.`);
  return v;
};

export function sideCode(lado: string | null | undefined): 'R' | 'L' | undefined {
  if (lado === 'Direito') return 'R';
  if (lado === 'Esquerdo') return 'L';
  return undefined;
}

/** Garante a forma do payload (rascunho). Lança ClinicalPayloadError com mensagem em PT-BR. */
export function parseClinicalPayload(raw: unknown): ClinicalPayload {
  if (!isObj(raw)) throw new ClinicalPayloadError('dadosClinicos deve ser um objeto.');
  if (raw.versao !== undefined && !(SUPPORTED_PAYLOAD_VERSIONS as readonly unknown[]).includes(raw.versao)) {
    throw new ClinicalPayloadError(`Versão de dadosClinicos não suportada: ${String(raw.versao)}.`);
  }
  if (raw.regiao !== 'shoulder' && raw.regiao !== 'elbow') throw new ClinicalPayloadError('Região deve ser ombro ou cotovelo.');
  const regiao: Region = raw.regiao;
  if (raw.geral !== undefined && !isObj(raw.geral)) throw new ClinicalPayloadError('geral deve ser um objeto.');
  // Cópia: nunca altera o objeto recebido
  const { surgery_date: _d, side: _s, hospital: _h, ...geral } = (raw.geral ?? {}) as Record<string, any>;

  const procs = raw.procedimentos ?? [];
  if (!Array.isArray(procs) || procs.length > 20) throw new ClinicalPayloadError('procedimentos: lista de até 20 itens.');
  const procedimentos: ClinicalProcedure[] = procs.map((p: unknown, i: number) => {
    if (!isObj(p)) throw new ClinicalPayloadError(`Procedimento ${i + 1} inválido.`);
    const ct = typeof p.tipoCaso === 'string' ? CASE_TYPE_BY_KEY.get(p.tipoCaso) : undefined;
    if (!ct || ct.region !== regiao) throw new ClinicalPayloadError(`Procedimento ${i + 1}: tipo de caso inválido para a região.`);
    let codigo: string | null = null;
    if (ct.freeOnly) {
      if (p.codigo !== null && p.codigo !== undefined) throw new ClinicalPayloadError(`Procedimento ${i + 1}: ${ct.label} não usa patologia do catálogo.`);
    } else {
      if (typeof p.codigo !== 'string' || !ct.codes.includes(p.codigo)) throw new ClinicalPayloadError(`Procedimento ${i + 1}: patologia fora do tipo ${ct.label}.`);
      codigo = p.codigo;
    }
    const dados = p.dados ?? {};
    if (!isObj(dados)) throw new ClinicalPayloadError(`Procedimento ${i + 1}: dados devem ser um objeto.`);
    if (!(codigo && intraopSchemaId(codigo))) {
      const descricao = optStr(dados.descricao, MAX_FREE_TEXT, `Procedimento ${i + 1}`);
      return { tipoCaso: ct.key, codigo, sequencia: i + 1, dados: descricao === undefined ? {} : { descricao } };
    }
    return { tipoCaso: ct.key, codigo, sequencia: i + 1, dados };
  });

  const mapRaw = raw.mapaArtroscopico ?? [];
  if (!Array.isArray(mapRaw)) throw new ClinicalPayloadError('mapaArtroscopico deve ser uma lista.');
  const valid = ARTHRO_STRUCTURES[regiao];
  const seen = new Set<string>();
  const mapaArtroscopico: ClinicalMapEntry[] = mapRaw.map((m: unknown) => {
    if (!isObj(m) || typeof m.structure_code !== 'string' || !(m.structure_code in valid)) throw new ClinicalPayloadError('Estrutura artroscópica inválida para a região.');
    if (seen.has(m.structure_code)) throw new ClinicalPayloadError(`Estrutura repetida: ${m.structure_code}`);
    seen.add(m.structure_code);
    if (!(MAP_STATUSES as readonly string[]).includes(m.status)) throw new ClinicalPayloadError(`Situação inválida em ${valid[m.structure_code]}.`);
    const e: ClinicalMapEntry = { structure_code: m.structure_code, status: m.status };
    const f = optStr(m.finding_text, 300, 'Achado');
    const j = optStr(m.justification, 300, 'Justificativa');
    if (f) e.finding_text = f;
    if (j) e.justification = j;
    return e;
  });

  const impRaw = raw.implantes ?? [];
  if (!Array.isArray(impRaw) || impRaw.length > 60) throw new ClinicalPayloadError('implantes: lista de até 60 itens.');
  const implantes: ClinicalImplant[] = impRaw.map((m: unknown, i: number) => {
    if (!isObj(m)) throw new ClinicalPayloadError(`Implante ${i + 1} inválido.`);
    if (!(IMPLANT_CATEGORIES as readonly string[]).includes(m.categoria)) throw new ClinicalPayloadError(`Implante ${i + 1}: categoria inválida.`);
    const fabricante = optStr(m.fabricante, 120, `Implante ${i + 1} fabricante`) ?? '';
    const modelo = optStr(m.modelo, 120, `Implante ${i + 1} modelo`) ?? '';
    const quantidade = m.quantidade ?? 1;
    if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > 50) throw new ClinicalPayloadError(`Implante ${i + 1}: quantidade de 1 a 50.`);
    const validade = optStr(m.validade, 10, `Implante ${i + 1} validade`);
    if (validade && !/^\d{4}-\d{2}-\d{2}$/.test(validade)) throw new ClinicalPayloadError(`Implante ${i + 1}: validade AAAA-MM-DD.`);
    const out: ClinicalImplant = { categoria: m.categoria, fabricante, modelo, quantidade };
    const extras: [keyof ClinicalImplant, number][] = [['tamanho', 40], ['lote', 60], ['serie', 60], ['localizacao', 120], ['codigoBarras', 500]];
    for (const [k, max] of extras) {
      const v = optStr(m[k], max, `Implante ${i + 1} ${k}`);
      if (v) (out as any)[k] = v;
    }
    if (validade) out.validade = validade;
    return out;
  });

  const out: ClinicalPayload = { versao: CLINICAL_PAYLOAD_VERSION, regiao, geral, procedimentos, mapaArtroscopico, implantes };
  const avaliacaoPreop = parsePreopAssessment(raw.avaliacaoPreop, regiao);
  if (avaliacaoPreop) out.avaliacaoPreop = avaliacaoPreop;
  return out;
}

/** Profundidade de objetos/arrays aninhados (escalar = 0); para de descer ao passar de `limite`. */
function profundidade(v: unknown, limite: number): number {
  if (typeof v !== 'object' || v === null) return 0;
  if (limite <= 0) return 1;
  let max = 0;
  for (const filho of Object.values(v)) {
    const d = profundidade(filho, limite - 1);
    if (d > max) max = d;
    if (max >= limite) break;
  }
  return 1 + max;
}

/** Limita aninhamento e tamanho de um objeto livre da avaliação pré-operatória (rascunho e finalização). */
function limitarObjetoPreop(obj: Record<string, unknown>, campo: string): void {
  if (profundidade(obj, MAX_PREOP_DEPTH) > MAX_PREOP_DEPTH) {
    throw new ClinicalPayloadError(`${campo}: aninhamento de até ${MAX_PREOP_DEPTH} níveis.`);
  }
  if (new TextEncoder().encode(JSON.stringify(obj)).length > MAX_PREOP_JSON_BYTES) {
    throw new ClinicalPayloadError(`${campo}: até ${MAX_PREOP_JSON_BYTES / 1024} KB.`);
  }
}

/**
 * Forma do bloco `avaliacaoPreop` (rascunho). Tipos e faixas dos campos ficam para a finalização
 * (schemas PREOP_COMMON.v2 e `<código>.diagnosis.vN`), como nos dados intraoperatórios.
 * Campos comuns que passaram para o cadastro do paciente (lado dominante, tabagismo, diabetes, nível de
 * atividade) são descartados: payloads antigos continuam válidos e não duplicam o cadastro.
 * Bloco vazio (sem campos comuns nem sub-blocos) é omitido: o payload fica igual ao de um v1.
 * Já no rascunho, `comum` e cada `dados` têm teto de tamanho (MAX_PREOP_JSON_BYTES) e de aninhamento
 * (MAX_PREOP_DEPTH), e a lista de patologias tem no máximo MAX_PREOP_BLOCKS itens.
 */
function parsePreopAssessment(raw: unknown, regiao: Region): PreopAssessment | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isObj(raw)) throw new ClinicalPayloadError('avaliacaoPreop deve ser um objeto.');
  const comumRaw = raw.comum ?? {};
  if (!isObj(comumRaw)) throw new ClinicalPayloadError('avaliacaoPreop.comum deve ser um objeto.');
  limitarObjetoPreop(comumRaw, 'avaliacaoPreop.comum');
  const comum = semCamposDoCadastro(comumRaw);
  const list = raw.patologias ?? [];
  if (!Array.isArray(list) || list.length > MAX_PREOP_BLOCKS) throw new ClinicalPayloadError(`avaliacaoPreop.patologias: lista de até ${MAX_PREOP_BLOCKS} itens.`);
  const seen = new Set<string>();
  const patologias: PreopPathologyAssessment[] = list.map((e: unknown, i: number) => {
    const n = `Avaliação pré-operatória ${i + 1}`;
    if (!isObj(e)) throw new ClinicalPayloadError(`${n} inválida.`);
    const def = typeof e.codigo === 'string' ? PATHOLOGY_BY_CODE.get(e.codigo) : undefined;
    if (!def || def.region !== regiao) throw new ClinicalPayloadError(`${n}: patologia inválida para a região.`);
    const schema = diagnosisSchemaId(def.code);
    if (!schema) throw new ClinicalPayloadError(`${n}: ${def.name_pt} não tem avaliação pré-operatória estruturada.`);
    if (e.schema !== undefined && e.schema !== schema) throw new ClinicalPayloadError(`${n}: schema deve ser ${schema}.`);
    if (seen.has(schema)) throw new ClinicalPayloadError(`${n}: avaliação repetida para ${schema}.`);
    seen.add(schema);
    const dados = e.dados ?? {};
    if (!isObj(dados)) throw new ClinicalPayloadError(`${n}: dados devem ser um objeto.`);
    limitarObjetoPreop(dados, `${n}: dados`);
    return { codigo: def.code, schema, dados: { ...dados } };
  });
  if (Object.keys(comum).length === 0 && patologias.length === 0) return undefined;
  return { comum, patologias };
}

/** Sub-bloco pré-operatório de uma patologia (pelo schema de diagnóstico do código), se houver. */
export function preopFor(p: Pick<ClinicalPayload, 'avaliacaoPreop'>, codigo: string): PreopPathologyAssessment | undefined {
  const schema = diagnosisSchemaId(codigo);
  return schema ? p.avaliacaoPreop?.patologias.find((e) => e.schema === schema) : undefined;
}

/** Núcleo cirúrgico completo (CORE_SURGERY) a partir dos dados gerais + colunas da cirurgia. */
export function coreFromSurgery(p: ClinicalPayload, cols: SurgeryColumns): Record<string, any> {
  const core: Record<string, any> = { ...p.geral };
  if (cols.dataCirurgia) core.surgery_date = cols.dataCirurgia;
  const side = sideCode(cols.lado);
  if (side) core.side = side;
  if (cols.hospital) core.hospital = cols.hospital;
  return core;
}

export interface ValidateClinicalOptions {
  /**
   * Regras por região / tipo de acesso (coreRegionIssues e inventário artroscópico em cirurgia aberta).
   * Padrão: true (gravação). O relatório de registros já gravados usa false, para que cirurgias
   * antigas continuem gerando relatório.
   */
  regionRules?: boolean;
}

/** Validação completa para finalizar: núcleo, cada procedimento, avaliação pré-operatória (tipo e faixa) e implantes. */
export function validateClinicalPayload(registry: SchemaRegistry, p: ClinicalPayload, cols: SurgeryColumns, opts: ValidateClinicalOptions = {}): IssueGroup[] {
  const groups: IssueGroup[] = [];
  const coreData = coreFromSurgery(p, cols);
  const core = registry.validate('CORE_SURGERY.v1', coreData);
  const coreIssues = [...(core.valid ? [] : core.issues), ...(opts.regionRules === false ? [] : coreRegionIssues(p.regiao, coreData))];
  if (coreIssues.length) groups.push({ scope: 'geral', issues: coreIssues });
  if (opts.regionRules !== false && p.mapaArtroscopico.length > 0 && isOpenOnly(coreData)) {
    groups.push({ scope: 'inventário artroscópico', issues: [{ field: 'mapaArtroscopico', keyword: 'dependencies', message_pt: 'Inventário artroscópico registrado em cirurgia sem acesso artroscópico.' }] });
  }
  if (p.procedimentos.length === 0) {
    groups.push({ scope: 'procedimentos', issues: [{ field: 'procedimentos', keyword: 'minItems', message_pt: 'Registre ao menos um procedimento.' }] });
  }
  for (const proc of p.procedimentos) {
    const scope = `procedimento ${proc.sequencia}: ${procedureName(proc)}`;
    const schema = proc.codigo ? intraopSchemaId(proc.codigo) : null;
    if (schema) {
      const v = registry.validate(schema, proc.dados);
      if (!v.valid) groups.push({ scope, issues: v.issues });
    } else if (typeof proc.dados.descricao !== 'string' || proc.dados.descricao.trim().length < 3) {
      groups.push({ scope, issues: [{ field: 'descricao', keyword: 'required', message_pt: 'Descreva o procedimento realizado.' }] });
    }
  }
  if (p.avaliacaoPreop) {
    const common = registry.validate(PREOP_COMMON_SCHEMA, p.avaliacaoPreop.comum);
    if (!common.valid) groups.push({ scope: 'avaliação pré-operatória', issues: common.issues });
    for (const e of p.avaliacaoPreop.patologias) {
      const v = registry.validate(e.schema, e.dados);
      if (!v.valid) groups.push({ scope: `avaliação pré-operatória: ${PATHOLOGY_BY_CODE.get(e.codigo)?.name_pt ?? e.codigo}`, issues: v.issues });
    }
  }
  p.implantes.forEach((m, i) => {
    const issues: ValidationIssue[] = [];
    if (!m.fabricante.trim()) issues.push({ field: 'fabricante', keyword: 'required', message_pt: 'Fabricante obrigatório.' });
    if (!m.modelo.trim()) issues.push({ field: 'modelo', keyword: 'required', message_pt: 'Modelo obrigatório.' });
    if (issues.length) groups.push({ scope: `implante ${i + 1}`, issues });
  });
  return groups;
}

export function procedureName(proc: Pick<ClinicalProcedure, 'codigo' | 'tipoCaso'>): string {
  if (proc.codigo) return PATHOLOGY_BY_CODE.get(proc.codigo)?.name_pt ?? proc.codigo;
  return CASE_TYPE_BY_KEY.get(proc.tipoCaso)?.label ?? proc.tipoCaso;
}

/** Nomes dos diagnósticos (códigos do núcleo) para a coluna texto `diagnostico`. */
export function diagnosisText(codes: readonly string[]): string {
  return codes.map((c) => PATHOLOGY_BY_CODE.get(c)?.name_pt ?? c).join(', ');
}

export function buildReportInput(
  p: ClinicalPayload,
  cols: SurgeryColumns,
  parties: { patient: ReportInput['patient']; surgeon: ReportInput['surgeon'] },
  postopPlan?: string
): ReportInput {
  const implants: ReportImplant[] = p.implantes.map((m) => {
    const out: ReportImplant = { manufacturer: m.fabricante, model: m.modelo, quantity: m.quantidade };
    if (m.tamanho) out.size = m.tamanho;
    if (m.lote) out.lot = m.lote;
    if (m.serie) out.serial = m.serie;
    if (m.localizacao) out.location = m.localizacao;
    return out;
  });
  return {
    region: p.regiao,
    ...parties,
    core: coreFromSurgery(p, cols),
    arthroscopic_map: p.mapaArtroscopico.map(({ structure_code, status, finding_text }) => (finding_text ? { structure_code, status, finding_text } : { structure_code, status })),
    procedures: p.procedimentos.map((proc) => {
      const schema = proc.codigo ? intraopSchemaId(proc.codigo) : null;
      if (schema) return { pathology_code: proc.codigo!, sequence: proc.sequencia, schema_version: Number(/\.v(\d+)$/.exec(schema)![1]), data: proc.dados };
      return { pathology_code: proc.codigo ?? undefined, title: procedureName(proc), sequence: proc.sequencia, schema_version: 0, data: {}, free_text: String(proc.dados.descricao ?? '') };
    }),
    implants,
    postop_plan: postopPlan
  };
}
