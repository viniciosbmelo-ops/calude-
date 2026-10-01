/**
 * Avaliação pré-operatória (payload v2, `avaliacaoPreop`): estado do formulário e regras de exibição.
 * Sem React, para teste unitário. Os campos vêm dos schemas do núcleo (PREOP_COMMON.v2 e `<código>.diagnosis.vN`).
 * Lado dominante, tabagismo, diabetes e nível de atividade são do cadastro do paciente (só leitura aqui).
 */
import { diagnosisSchemaId, semCamposDoCadastro, type PreopAssessment } from "@workspace/clinical/web";

type Obj = Record<string, any>;

export interface PreopBlock {
  /** Schema de diagnóstico do sub-bloco (ex.: SH_RCT.diagnosis.v1) */
  schema: string;
  /** Patologia do procedimento que abriu o sub-bloco */
  codigo: string;
}

/** Estado do formulário. Sub-blocos ocultos continuam no estado (trocar e voltar não perde o que foi digitado). */
export interface PreopState {
  comum: Obj;
  bySchema: Record<string, Obj>;
}

export const emptyPreopState = (): PreopState => ({ comum: {}, bySchema: {} });

/**
 * Sub-blocos visíveis: um por schema de diagnóstico das patologias dos procedimentos escolhidos,
 * na ordem dos procedimentos. Patologias sem schema (ou tipos só de descrição livre) não abrem sub-bloco;
 * subtipos que compartilham schema (ex.: manguito) abrem um único sub-bloco.
 */
export function visiblePreopBlocks(procs: readonly { codigo: string | null | undefined }[]): PreopBlock[] {
  const out: PreopBlock[] = [];
  for (const p of procs) {
    const schema = p.codigo ? diagnosisSchemaId(p.codigo) : null;
    if (schema && !out.some((b) => b.schema === schema)) out.push({ schema, codigo: p.codigo! });
  }
  return out;
}

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Estado a partir do `dadosClinicos.avaliacaoPreop` gravado (v1 sem o bloco → vazio).
 * Registros antigos com lado dominante, tabagismo, diabetes ou nível de atividade no bloco comum: esses campos
 * são descartados (agora vêm do cadastro do paciente) e não voltam a ser enviados.
 */
export function preopStateFromPayload(raw: unknown): PreopState {
  if (!isObj(raw)) return emptyPreopState();
  const bySchema: Record<string, Obj> = {};
  for (const e of Array.isArray(raw.patologias) ? raw.patologias : []) {
    if (!isObj(e) || typeof e.codigo !== "string") continue;
    const schema = diagnosisSchemaId(e.codigo);
    if (schema && isObj(e.dados)) bySchema[schema] = e.dados;
  }
  return { comum: isObj(raw.comum) ? semCamposDoCadastro(raw.comum) : {}, bySchema };
}

const hasData = (o: Obj | undefined): o is Obj => !!o && Object.values(o).some((v) => v !== undefined && v !== "");
const clean = (o: Obj): Obj => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ""));

/**
 * Bloco a enviar: só os sub-blocos visíveis e preenchidos; `undefined` quando nada foi preenchido
 * (o payload fica igual ao de um registro sem avaliação pré-operatória).
 */
export function buildPreopPayload(state: PreopState, blocks: readonly PreopBlock[]): PreopAssessment | undefined {
  const comum = clean(state.comum);
  const patologias = blocks
    .filter((b) => hasData(state.bySchema[b.schema]))
    .map((b) => ({ codigo: b.codigo, schema: b.schema, dados: clean(state.bySchema[b.schema]) }));
  if (Object.keys(comum).length === 0 && patologias.length === 0) return undefined;
  return { comum, patologias };
}
