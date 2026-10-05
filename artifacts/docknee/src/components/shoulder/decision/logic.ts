/**
 * Apoio à decisão na interface: funções puras (sem React) para o formulário de entrada, a leitura do
 * resultado do motor, a escolha do cirurgião e a aplicabilidade no registro cirúrgico.
 *
 * Regra central do formulário: campo vazio fica AUSENTE (não informado) e nunca é enviado como 0,
 * false ou lista vazia. O motor trata a ausência como "indeterminado".
 */
import {
  CAMPOS_PERFIL_CLINICO,
  PATHOLOGY_BY_CODE,
  perfilClinicoDe,
  type CampoPerfilClinico,
  type PerfilClinicoPaciente,
  TRANSICOES_STATUS,
  comUnidade,
  type AlgorithmDef,
  type EntradaDef,
  type Forca,
  type MotivoOpcao,
  type OpcaoResultado,
  type ParametroResultado,
  type PreopAssessment,
  type Referencia,
  type ResultadoApoio,
  type SentidoOpcao,
  type StatusAlgoritmo,
  type TraceItem,
} from "@workspace/clinical/web";

type Obj = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Formulário de entrada
// ---------------------------------------------------------------------------

/** Valor bruto de um campo: texto (número, sim/não, enum) ou seleção múltipla (lista). */
export type FieldValue = string | string[];
export type FormValues = Record<string, FieldValue | undefined>;

export type FieldErrorCode = "nan" | "inteiro" | "min" | "max";
export interface FieldError {
  code: FieldErrorCode;
  limit?: number;
}

export const BOOL_SIM = "sim";
export const BOOL_NAO = "nao";

/** Entradas exibidas no modo: no `preop`, as intraoperatórias são omitidas (o motor as descartaria). */
export function visibleInputs(def: Pick<AlgorithmDef, "entradas">, modo: "preop" | "registro"): EntradaDef[] {
  return def.entradas.filter((e) => modo === "registro" || e.momento !== "intraop");
}

/**
 * Converte um valor bruto. `{ missing: true }` quando o campo está vazio: não entra na entrada enviada.
 * Número com vírgula decimal é aceito ("17,5").
 */
export function parseField(
  e: EntradaDef,
  raw: FieldValue | undefined,
): { missing: true } | { missing: false; value: unknown } | { missing: false; error: FieldError } {
  const d = e.def;
  if (raw === undefined) return { missing: true };
  if (Array.isArray(raw)) {
    if (d.tipo !== "lista") return { missing: true };
    const vals = d.valores.filter((v) => raw.includes(v));
    return vals.length ? { missing: false, value: vals } : { missing: true };
  }
  const s = raw.trim();
  if (s === "") return { missing: true };
  switch (d.tipo) {
    case "numero": {
      const n = Number(s.replace(",", "."));
      if (!Number.isFinite(n)) return { missing: false, error: { code: "nan" } };
      if (d.inteiro && !Number.isInteger(n)) return { missing: false, error: { code: "inteiro" } };
      if (d.min !== undefined && n < d.min) return { missing: false, error: { code: "min", limit: d.min } };
      if (d.max !== undefined && n > d.max) return { missing: false, error: { code: "max", limit: d.max } };
      return { missing: false, value: n };
    }
    case "booleano":
      if (s === BOOL_SIM) return { missing: false, value: true };
      if (s === BOOL_NAO) return { missing: false, value: false };
      return { missing: true };
    case "enum":
      return d.valores.includes(s) ? { missing: false, value: s } : { missing: true };
    case "lista":
      return d.valores.includes(s) ? { missing: false, value: [s] } : { missing: true };
  }
}

/**
 * Entrada a enviar ao servidor: só os campos preenchidos e válidos das entradas visíveis no modo.
 * Com algum erro, `entrada` não deve ser enviada.
 */
export function buildEntrada(
  entradas: readonly EntradaDef[],
  values: FormValues,
): { entrada: Record<string, unknown>; errors: Record<string, FieldError>; missing: string[] } {
  const entrada: Record<string, unknown> = {};
  const errors: Record<string, FieldError> = {};
  const missing: string[] = [];
  for (const e of entradas) {
    const r = parseField(e, values[e.id]);
    if (r.missing) missing.push(e.id);
    else if ("error" in r) errors[e.id] = r.error;
    else entrada[e.id] = r.value;
  }
  return { entrada, errors, missing };
}

/** Valor bruto do formulário a partir de um valor já tipado (pré-preenchimento). `undefined` se não servir. */
export function toFieldValue(e: EntradaDef, v: unknown): FieldValue | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const d = e.def;
  switch (d.tipo) {
    case "numero":
      if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
      if ((d.min !== undefined && v < d.min) || (d.max !== undefined && v > d.max)) return undefined;
      if (d.inteiro && !Number.isInteger(v)) return undefined;
      return String(v);
    case "booleano":
      return typeof v === "boolean" ? (v ? BOOL_SIM : BOOL_NAO) : undefined;
    case "enum":
      return typeof v === "string" && d.valores.includes(v) ? v : undefined;
    case "lista": {
      const arr = Array.isArray(v) ? v : [v];
      const vals = d.valores.filter((x) => arr.includes(x));
      return vals.length ? vals : undefined;
    }
  }
}

// ---------------------------------------------------------------------------
// Aplicabilidade e mapeamento a partir do registro cirúrgico
// ---------------------------------------------------------------------------

/** Mesma patologia, ou uma é subtipo (parent) da outra no catálogo. */
export function pathologyMatches(a: string, b: string): boolean {
  if (a === b) return true;
  return PATHOLOGY_BY_CODE.get(a)?.parent === b || PATHOLOGY_BY_CODE.get(b)?.parent === a;
}

/** Algoritmos cujas `patologias` casam com alguma patologia do caso. */
export function applicableAlgorithms<T extends { patologias: readonly string[] }>(algos: readonly T[], caseCodes: readonly string[]): T[] {
  return algos.filter((a) => a.patologias.some((p) => caseCodes.some((c) => pathologyMatches(p, c))));
}

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function getPath(o: unknown, path: string[]): unknown {
  let cur: unknown = o;
  for (const k of path) {
    if (!isObj(cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}

export interface RegistroContexto {
  preop?: PreopAssessment;
  /** Cadastro do paciente (lado dominante, tabagismo, diabetes, nível de atividade): origens `paciente`. */
  paciente?: PerfilClinicoPaciente;
  geral?: Obj;
  procedimentos?: readonly { codigo: string | null; dados: Obj }[];
}

const ENTRY_RE = /^(avaliacaoPreop|procedimentos)\[([A-Za-z0-9_]+)\]\.(.+)$/;

/**
 * Resolve o `caminho` de uma origem declarada no registro atual:
 * - `avaliacaoPreop[COD].campo` → sub-bloco pré-operatório da patologia COD (ou de um subtipo);
 * - `avaliacaoPreop.comum.campo` → dados comuns;
 * - `procedimentos[COD].dados.campo` → dados intraoperatórios;
 * - `geral.campo` → dados gerais.
 */
export function resolveCaminho(caminho: string, ctx: RegistroContexto): unknown {
  const m = ENTRY_RE.exec(caminho);
  if (m) {
    const [, raiz, cod, resto] = m;
    const parts = resto.split(".");
    if (raiz === "avaliacaoPreop") {
      const bloco = ctx.preop?.patologias.find((p) => pathologyMatches(p.codigo, cod));
      return bloco ? getPath(bloco.dados, parts) : undefined;
    }
    const proc = ctx.procedimentos?.find((p) => p.codigo && pathologyMatches(p.codigo, cod));
    return proc ? getPath(proc, parts) : undefined;
  }
  const parts = caminho.split(".");
  if (parts[0] === "avaliacaoPreop") return getPath(ctx.preop, parts.slice(1));
  if (parts[0] === "geral") return getPath(ctx.geral, parts.slice(1));
  return undefined;
}

/** Valor de uma origem `paciente` no cadastro (só os campos do perfil clínico; idade fica com o servidor). */
export function resolvePaciente(campo: string, ctx: RegistroContexto): unknown {
  const perfil = perfilClinicoDe(ctx.paciente);
  return (CAMPOS_PERFIL_CLINICO as readonly string[]).includes(campo) ? perfil[campo as CampoPerfilClinico] : undefined;
}

/**
 * Pré-preenchimento do formulário a partir do registro: origens `payload`/`intraop` (caminho no registro da
 * cirurgia) e `paciente` (cadastro do paciente), só com valor válido.
 */
export function prefillFromRegistro(def: Pick<AlgorithmDef, "entradas">, ctx: RegistroContexto): FormValues {
  const out: FormValues = {};
  for (const e of def.entradas) {
    const bruto = e.origem.de === "payload" || e.origem.de === "intraop"
      ? resolveCaminho(e.origem.caminho, ctx)
      : e.origem.de === "paciente" ? resolvePaciente(e.origem.campo, ctx) : undefined;
    if (bruto === undefined) continue;
    const v = toFieldValue(e, bruto);
    if (v !== undefined) out[e.id] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------

export const FORCAS: readonly Forca[] = ["forte", "moderada", "fraca", "controversa"];
const RANK_FORCA: Record<Forca, number> = { forte: 3, moderada: 2, fraca: 1, controversa: 0 };

/**
 * Sentido exibido de uma opção. O motor ≥1.2.0 já entrega o sentido líquido; resultados gravados antes traziam
 * "favorece" com força "controversa" tanto para alternativas de zona cinzenta quanto para cautela de força igual
 * ou maior que o favor. Nesses, o sentido é reconstruído dos motivos (cautela ≥ favor → cautela; senão alternativa).
 */
export function displayDirection(o: Pick<OpcaoResultado, "sentido" | "forca" | "motivos">): SentidoOpcao {
  if (o.sentido !== "favorece" || o.forca !== "controversa") return o.sentido;
  const max = (ef: MotivoOpcao["efeito"]) => Math.max(-1, ...o.motivos.filter((m) => m.efeito === ef).map((m) => RANK_FORCA[m.forca]));
  const des = max("desfavorece");
  return des >= 0 && des >= max("favorece") ? "desfavorece" : "alternativa";
}

/**
 * Sentido exibido ao lado de um motivo. Além dos sentidos da opção, "fora_da_zona": efeito a favor vindo de regra
 * FORA de zona cinzenta, num cartão exibido como alternativa de zona cinzenta.
 */
export type SentidoMotivo = SentidoOpcao | "fora_da_zona";

const zonasDa = (o: Pick<OpcaoResultado, "controversias">) => new Set((o.controversias ?? []).map((c) => c.regra));

/**
 * Rótulo exibido de um motivo, sempre coerente com o cabeçalho do cartão:
 * - efeito a favor vindo de zona cinzenta → "alternativa", sem força;
 * - no cartão de alternativa (`sentidoOpcao` = 'alternativa'), efeito a favor vindo de regra fora da zona cinzenta →
 *   "fora_da_zona" com a força: a sugestão continua visível, identificada pela origem, e nunca como "favorece",
 *   o que contradiria o cabeçalho e elegeria um vencedor dentro da zona cinzenta;
 * - os demais mantêm efeito e força.
 */
export function motiveTag(
  o: Pick<OpcaoResultado, "controversias">,
  m: Pick<MotivoOpcao, "regra" | "efeito" | "forca">,
  sentidoOpcao?: SentidoOpcao,
): { sentido: SentidoMotivo; forca?: Forca } {
  if (m.efeito === "favorece" && zonasDa(o).has(m.regra)) return { sentido: "alternativa" };
  if (m.efeito === "favorece" && sentidoOpcao === "alternativa") return { sentido: "fora_da_zona", forca: m.forca };
  return { sentido: m.efeito, forca: m.forca };
}

/**
 * Motivos com os do sentido exibido primeiro (a cautela que define a opção não fica escondida no fim). No cartão de
 * alternativa, com as zonas da opção: os motivos da zona cinzenta, depois as sugestões de fora da zona, depois cautela.
 */
export function orderedMotives<T extends Pick<MotivoOpcao, "efeito" | "regra">>(
  motivos: readonly T[],
  sentido: SentidoOpcao,
  o?: Pick<OpcaoResultado, "controversias">,
): T[] {
  const zonas = o ? zonasDa(o) : new Set<string>();
  const rank = (m: T) => {
    if (sentido === "desfavorece") return m.efeito === "desfavorece" ? 0 : 1;
    if (m.efeito === "desfavorece") return 2;
    return sentido === "alternativa" && o && !zonas.has(m.regra) ? 1 : 0;
  };
  return [...motivos].sort((a, b) => rank(a) - rank(b));
}

/** Evidência própria desta opção dentro de cada zona cinzenta em que ela é alternativa. */
export function alternativeEvidence(o: Pick<OpcaoResultado, "opcao" | "controversias">): { regra: string; argumento: string; referencias: string[] }[] {
  return (o.controversias ?? []).flatMap((c) => c.alternativas
    .filter((a) => a.opcao === o.opcao)
    .map((a) => ({ regra: c.regra, argumento: a.argumento, referencias: [...a.referencias] })));
}

/** Link público da referência: PubMed quando há PMID, senão DOI. */
export function referenceHref(r: Pick<Referencia, "pmid" | "doi">): string | undefined {
  if (r.pmid) return `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(r.pmid)}/`;
  if (r.doi) return `https://doi.org/${r.doi}`;
  return undefined;
}

/** Identificadores exibidos como texto: "PMID 123 · DOI 10.x/y". */
export function referenceIds(r: Pick<Referencia, "pmid" | "doi">): string {
  return [r.pmid ? `PMID ${r.pmid}` : null, r.doi ? `DOI ${r.doi}` : null].filter(Boolean).join(" · ");
}

export function referenceMap(res: Pick<ResultadoApoio, "referencias">): Map<string, Referencia> {
  return new Map(res.referencias.map((r) => [r.id, r]));
}

export interface ControversyView {
  regra: string;
  nota: string;
  alternativas: { opcao: string; rotulo: string; argumento: string; referencias: string[] }[];
}

/** Controvérsias de todas as opções, sem repetir a mesma regra. */
export function collectControversies(opcoes: readonly OpcaoResultado[]): ControversyView[] {
  const seen = new Map<string, ControversyView>();
  for (const o of opcoes) {
    for (const c of o.controversias ?? []) if (!seen.has(c.regra)) seen.set(c.regra, c);
  }
  return [...seen.values()];
}

export type TraceGroup = TraceItem["resultado"];
export const TRACE_ORDER: readonly TraceGroup[] = ["disparou", "indeterminada", "fora_de_escopo", "nao_disparou"];

/** Trace agrupado na ordem de leitura: aplicadas, indeterminadas, fora de escopo, não aplicadas. */
export function groupTrace(trace: readonly TraceItem[]): { grupo: TraceGroup; itens: TraceItem[] }[] {
  return TRACE_ORDER
    .map((grupo) => ({ grupo, itens: trace.filter((t) => t.resultado === grupo) }))
    .filter((g) => g.itens.length > 0);
}

/** Título legível de uma regra (ou critério de escopo), quando a definição está disponível. */
/**
 * Códigos internos das regras (ex.: "N4.OFF_TRACK.BANKART_ISOLADO") só aparecem para administradores ou em
 * execuções de revisão. Continuam gravados no resultado e nas respostas da API; só a exibição muda.
 */
export function shouldShowRuleCodes(viewer: { isAdmin?: boolean | null; modo?: string | null }): boolean {
  return viewer.isAdmin === true || viewer.modo === "revisao";
}

export function ruleTitle(def: Pick<AlgorithmDef, "regras" | "foraDeEscopo"> | undefined, id: string): string {
  if (!def) return id;
  return def.regras.find((r) => r.id === id)?.titulo ?? def.foraDeEscopo.find((f) => f.id === id)?.texto ?? id;
}

export function formatTraceValue(v: unknown, locale?: string, rotulos?: Readonly<Record<string, string>>): string {
  if (v === undefined || v === null) return "—";
  if (Array.isArray(v)) return v.map((x) => valueLabel(String(x), rotulos)).join(", ");
  if (typeof v === "boolean") return v ? "✓" : "✗";
  if (typeof v === "number") return formatDecimal(v, locale);
  if (typeof v === "string") return valueLabel(v, rotulos);
  return String(v);
}

/** Número no idioma da tela (vírgula decimal em pt-BR/es), sem separador de milhar. Sem idioma: como está. */
export function formatDecimal(n: number, locale?: string): string {
  if (!locale) return String(n);
  return new Intl.NumberFormat(locale, { useGrouping: false, maximumFractionDigits: 10 }).format(n);
}

/** Rótulo de um valor de enum/lista (pt-BR, da definição); o próprio valor quando não há rótulo. */
export function valueLabel(v: string, rotulos?: Readonly<Record<string, string>>): string {
  return rotulos?.[v] ?? v;
}

/** Rótulos de valores declarados para uma entrada enum/lista. */
export function valueLabelsOf(e: EntradaDef | undefined): Readonly<Record<string, string>> | undefined {
  return e && (e.def.tipo === "enum" || e.def.tipo === "lista") ? e.def.rotulos : undefined;
}

// ---------------------------------------------------------------------------
// Proveniência, conflitos com o registro e parâmetros usados
// ---------------------------------------------------------------------------

/** Proveniência como vem da API (`de` é string para tolerar valores novos). */
export interface ProvenienciaView {
  de: string;
  caminho?: string;
  nota?: string;
}

/** Conflito como vem da API: valor digitado descartado porque o registro salvo prevaleceu. */
export interface ConflitoView {
  entrada: string;
  usado: unknown;
  origemUsada: string;
  descartado: unknown;
  origemDescartada: string;
}

/** Agrupamento exibido ao usuário: do registro salvo, digitado, ou calculado a partir do registro. */
export type ProvenanceKind = "registro" | "manual" | "derivado";

/** payload/intraop/paciente → registro; derivada → derivado; manual ou desconhecido → manual. */
export function provenanceKind(de: string | undefined): ProvenanceKind {
  if (de === "payload" || de === "intraop" || de === "paciente") return "registro";
  if (de === "derivada") return "derivado";
  return "manual";
}

/** Rótulos usados na formatação de valores (vêm do arquivo de textos, para manter pt-BR/es). */
export interface ValueLabels {
  yes: string;
  no: string;
  /** Idioma da tela para formatar números (vírgula decimal). */
  locale?: string;
}

/**
 * Valor legível de uma entrada: Sim/Não para booleanos, rótulo do valor de enum/lista, número no idioma da tela,
 * unidade quando houver.
 */
export function formatInputValue(v: unknown, labels: ValueLabels, unidade?: string, rotulos?: Readonly<Record<string, string>>): string {
  if (v === undefined || v === null || v === "") return "—";
  if (typeof v === "boolean") return v ? labels.yes : labels.no;
  if (Array.isArray(v)) return v.length ? v.map((x) => valueLabel(String(x), rotulos)).join(", ") : "—";
  if (typeof v === "object") return JSON.stringify(v);
  const txt = typeof v === "number" ? formatDecimal(v, labels.locale) : valueLabel(String(v), rotulos);
  return comUnidade(txt, unidade);
}

function entradaDef(def: Pick<AlgorithmDef, "entradas"> | undefined, id: string): EntradaDef | undefined {
  return def?.entradas.find((e) => e.id === id);
}

function unidadeDe(e: EntradaDef | undefined): string | undefined {
  return e?.def.tipo === "numero" ? e.def.unidade : undefined;
}

export interface ConflictLine {
  entrada: string;
  rotulo: string;
  /** Valor digitado pelo cirurgião (descartado). */
  digitado: string;
  /** Valor usado, do registro salvo. */
  usado: string;
  /** Origem detalhada do valor usado (payload, intraop, paciente, derivada...). */
  origem: string;
  kind: ProvenanceKind;
  caminho?: string;
}

/** Linhas do aviso de conflitos, na ordem das entradas da definição (as desconhecidas ao fim). */
export function conflictLines(
  conflitos: readonly ConflitoView[] | undefined,
  def: Pick<AlgorithmDef, "entradas"> | undefined,
  labels: ValueLabels,
  proveniencia?: Readonly<Record<string, ProvenienciaView>>,
): ConflictLine[] {
  if (!conflitos?.length) return [];
  const ordem = (id: string) => {
    const i = def?.entradas.findIndex((e) => e.id === id) ?? -1;
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...conflitos]
    .sort((a, b) => ordem(a.entrada) - ordem(b.entrada))
    .map((c) => {
      const e = entradaDef(def, c.entrada);
      const u = unidadeDe(e);
      const caminho = proveniencia?.[c.entrada]?.caminho;
      return {
        entrada: c.entrada,
        rotulo: e?.rotulo ?? c.entrada,
        digitado: formatInputValue(c.descartado, labels, u, valueLabelsOf(e)),
        usado: formatInputValue(c.usado, labels, u, valueLabelsOf(e)),
        origem: c.origemUsada,
        kind: provenanceKind(c.origemUsada),
        ...(caminho ? { caminho } : {}),
      };
    });
}

export interface UsedInputLine {
  id: string;
  rotulo: string;
  valor: string;
  /** Ausente quando a proveniência não foi registrada (execuções antigas). */
  kind?: ProvenanceKind;
  caminho?: string;
  nota?: string;
  /** Este valor substituiu um valor digitado diferente. */
  emConflito: boolean;
}

/** "Dados usados": entradas efetivamente avaliadas, na ordem da definição, com a origem de cada uma. */
export function usedInputLines(
  entrada: Readonly<Record<string, unknown>>,
  def: Pick<AlgorithmDef, "entradas"> | undefined,
  labels: ValueLabels,
  proveniencia?: Readonly<Record<string, ProvenienciaView>>,
  conflitos?: readonly Pick<ConflitoView, "entrada">[],
): UsedInputLine[] {
  const ids = Object.keys(entrada);
  const defOrder = (def?.entradas ?? []).map((e) => e.id).filter((id) => ids.includes(id));
  const rest = ids.filter((id) => !defOrder.includes(id)).sort();
  const emConflito = new Set((conflitos ?? []).map((c) => c.entrada));
  return [...defOrder, ...rest].map((id) => {
    const e = entradaDef(def, id);
    const p = proveniencia?.[id];
    return {
      id,
      rotulo: e?.rotulo ?? id,
      valor: formatInputValue(entrada[id], labels, unidadeDe(e), valueLabelsOf(e)),
      ...(p ? { kind: provenanceKind(p.de) } : {}),
      ...(p?.caminho ? { caminho: p.caminho } : {}),
      ...(p?.nota ? { nota: p.nota } : {}),
      emConflito: emConflito.has(id),
    };
  });
}

export interface ParameterLine {
  id: string;
  rotulo: string;
  valor: string;
  origem: ParametroResultado["origem"];
  pendente: boolean;
  nota: string;
  referencias: string[];
}

/** Parâmetros usados, com valor e unidade; `pendente` marca o padrão provisório ainda sem decisão do cirurgião. */
export function parameterLines(parametros: readonly ParametroResultado[] | undefined, locale?: string): ParameterLine[] {
  return (parametros ?? []).map((p) => ({
    id: p.id,
    rotulo: p.rotulo,
    valor: comUnidade(formatDecimal(p.valor, locale), p.unidade),
    origem: p.origem,
    pendente: p.status === "pendente_decisao_cirurgiao",
    nota: p.nota,
    referencias: [...p.referencias],
  }));
}

/** Metadados de uma execução (resposta da avaliação ou linha gravada), lidos com tolerância a campos ausentes. */
export interface ExecutionMeta {
  proveniencia?: Record<string, ProvenienciaView>;
  conflitos: ConflitoView[];
  parametrosIgnorados: boolean;
}

export function readExecutionMeta(x: unknown): ExecutionMeta {
  const o = isObj(x) ? x : {};
  let proveniencia: Record<string, ProvenienciaView> | undefined;
  if (isObj(o.proveniencia)) {
    proveniencia = {};
    for (const [k, v] of Object.entries(o.proveniencia)) {
      if (isObj(v) && typeof v.de === "string") {
        proveniencia[k] = {
          de: v.de,
          ...(typeof v.caminho === "string" ? { caminho: v.caminho } : {}),
          ...(typeof v.nota === "string" ? { nota: v.nota } : {}),
        };
      }
    }
  }
  const conflitos = Array.isArray(o.conflitos)
    ? o.conflitos.filter((c): c is ConflitoView => isObj(c) && typeof c.entrada === "string" && typeof c.origemUsada === "string")
      .map((c) => ({ entrada: c.entrada, usado: c.usado, origemUsada: c.origemUsada, descartado: c.descartado, origemDescartada: String(c.origemDescartada ?? "manual") }))
    : [];
  return { ...(proveniencia ? { proveniencia } : {}), conflitos, parametrosIgnorados: o.parametrosIgnorados === true };
}

// ---------------------------------------------------------------------------
// Escolha do cirurgião
// ---------------------------------------------------------------------------

/** Valor do seletor para "outra conduta" (não colide com ids de opção, que não têm ':'). */
export const CHOICE_OTHER = "__outra__";

export interface ChoiceState {
  /** Nada pré-selecionado: começa `null`. */
  selecao: string | null;
  outra: string;
  justificativa: string;
}

export const emptyChoice = (): ChoiceState => ({ selecao: null, outra: "", justificativa: "" });

export type ChoiceBody = { opcao: string; justificativa?: string } | { outra: string; justificativa?: string };
export type ChoiceProblem = "sem_selecao" | "outra_vazia" | "opcao_desconhecida" | "muito_longo";

export const MAX_OUTRA = 500;
export const MAX_JUSTIFICATIVA = 2000;

/** Corpo do POST /escolha: exatamente um de `opcao` ou `outra`; justificativa só quando preenchida. */
export function buildChoicePayload(state: ChoiceState, opcoesValidas: readonly string[]): { ok: true; body: ChoiceBody } | { ok: false; problem: ChoiceProblem } {
  if (!state.selecao) return { ok: false, problem: "sem_selecao" };
  const just = state.justificativa.trim();
  if (just.length > MAX_JUSTIFICATIVA) return { ok: false, problem: "muito_longo" };
  const extra = just ? { justificativa: just } : {};
  if (state.selecao === CHOICE_OTHER) {
    const outra = state.outra.trim();
    if (!outra) return { ok: false, problem: "outra_vazia" };
    if (outra.length > MAX_OUTRA) return { ok: false, problem: "muito_longo" };
    return { ok: true, body: { outra, ...extra } };
  }
  if (!opcoesValidas.includes(state.selecao)) return { ok: false, problem: "opcao_desconhecida" };
  return { ok: true, body: { opcao: state.selecao, ...extra } };
}

/** Texto da escolha registrada: rótulo da opção (do resultado gravado) ou o texto livre. */
export function choiceLabel(escolha: { opcao: string | null; outra: string | null }, resultado: Pick<ResultadoApoio, "opcoes">): string {
  if (escolha.outra) return escolha.outra;
  return resultado.opcoes.find((o) => o.opcao === escolha.opcao)?.rotulo ?? escolha.opcao ?? "";
}

// ---------------------------------------------------------------------------
// Governança e erros
// ---------------------------------------------------------------------------

export function transitionsFrom(status: StatusAlgoritmo): readonly StatusAlgoritmo[] {
  return TRANSICOES_STATUS[status] ?? [];
}

export interface ApiErrorView {
  status?: number;
  message: string;
  code?: string;
  field?: string;
}

/** Normaliza um erro do cliente gerado (ApiError com `data.error/code/field`) ou um Error qualquer. */
export function describeApiError(err: unknown): ApiErrorView {
  const e = err as { status?: unknown; data?: unknown; message?: unknown } | null;
  const data = isObj(e?.data) ? e!.data as Obj : undefined;
  const status = typeof e?.status === "number" ? e.status : undefined;
  const message = typeof data?.error === "string" ? data.error : typeof e?.message === "string" ? e.message : String(err);
  return {
    ...(status !== undefined ? { status } : {}),
    message,
    ...(typeof data?.code === "string" ? { code: data.code } : {}),
    ...(typeof data?.field === "string" ? { field: data.field } : {}),
  };
}
