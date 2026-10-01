/**
 * Apoio à decisão na interface: funções puras (sem React) para o formulário de entrada, a leitura do
 * resultado do motor, a escolha do cirurgião e a aplicabilidade no registro cirúrgico.
 *
 * Regra central do formulário: campo vazio fica AUSENTE (não informado) e nunca é enviado como 0,
 * false ou lista vazia. O motor trata a ausência como "indeterminado".
 */
import {
  PATHOLOGY_BY_CODE,
  TRANSICOES_STATUS,
  type AlgorithmDef,
  type EntradaDef,
  type Forca,
  type OpcaoResultado,
  type ParametroResultado,
  type PreopAssessment,
  type Referencia,
  type ResultadoApoio,
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

/** Pré-preenchimento do formulário a partir do registro: só origens `payload`/`intraop` com valor válido. */
export function prefillFromRegistro(def: Pick<AlgorithmDef, "entradas">, ctx: RegistroContexto): FormValues {
  const out: FormValues = {};
  for (const e of def.entradas) {
    if (e.origem.de !== "payload" && e.origem.de !== "intraop") continue;
    const v = toFieldValue(e, resolveCaminho(e.origem.caminho, ctx));
    if (v !== undefined) out[e.id] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------

export const FORCAS: readonly Forca[] = ["forte", "moderada", "fraca", "controversa"];

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
export function ruleTitle(def: Pick<AlgorithmDef, "regras" | "foraDeEscopo"> | undefined, id: string): string {
  if (!def) return id;
  return def.regras.find((r) => r.id === id)?.titulo ?? def.foraDeEscopo.find((f) => f.id === id)?.texto ?? id;
}

export function formatTraceValue(v: unknown): string {
  if (v === undefined || v === null) return "—";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "boolean") return v ? "✓" : "✗";
  return String(v);
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
}

/** Valor legível de uma entrada: Sim/Não para booleanos, lista com vírgulas, unidade quando houver. */
export function formatInputValue(v: unknown, labels: ValueLabels, unidade?: string): string {
  if (v === undefined || v === null || v === "") return "—";
  if (typeof v === "boolean") return v ? labels.yes : labels.no;
  if (Array.isArray(v)) return v.length ? v.map(String).join(", ") : "—";
  if (typeof v === "object") return JSON.stringify(v);
  return unidade ? `${String(v)} ${unidade}` : String(v);
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
        digitado: formatInputValue(c.descartado, labels, u),
        usado: formatInputValue(c.usado, labels, u),
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
      valor: formatInputValue(entrada[id], labels, unidadeDe(e)),
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
export function parameterLines(parametros: readonly ParametroResultado[] | undefined): ParameterLine[] {
  return (parametros ?? []).map((p) => ({
    id: p.id,
    rotulo: p.rotulo,
    valor: p.unidade ? `${p.valor} ${p.unidade}` : String(p.valor),
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
