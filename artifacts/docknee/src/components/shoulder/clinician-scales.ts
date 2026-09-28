/**
 * Lógica (sem React) das escalas do médico no formulário de retorno.
 * Itens, faixas e escore vêm do @workspace/clinical; a prévia é só visual —
 * o servidor recalcula o escore ao salvar.
 */
import {
  CLINICIAN_SCALE_ITEMS,
  ClinicalGuardError,
  constantMax,
  scoreClinicianScale,
  type ClinicianItem,
  type ScoreResult,
} from "@workspace/clinical/web";

export type ScaleDraft = {
  /** Valor digitado/selecionado por campo; `multi` guarda a lista de opções marcadas. */
  values: Record<string, string | string[]>;
  /** Só Constant: força medida com dinamômetro (máximo 100) ou não (máximo 75). */
  withDynamometer: boolean;
};

export function scaleItems(code: string): readonly ClinicianItem[] {
  return CLINICIAN_SCALE_ITEMS[code] ?? [];
}

export function emptyDraft(code: string): ScaleDraft {
  const values: ScaleDraft["values"] = {};
  for (const item of scaleItems(code)) values[item.field] = item.kind === "multi" ? [] : "";
  return { values, withDynamometer: false };
}

/** Itens exibidos: sem dinamômetro o campo de força some (variante sobre 75, como no pacote). */
export function visibleItems(code: string, draft: ScaleDraft): ClinicianItem[] {
  return scaleItems(code).filter((i) => !(code === "CONSTANT" && i.field === "strength_kg" && !draft.withDynamometer));
}

/** Máximo aplicável antes de pontuar (Constant depende da variante). */
export function scaleMax(code: string, draft: ScaleDraft): number | null {
  if (code === "CONSTANT") return constantMax(draft.withDynamometer);
  if (code === "ROWE") return 100;
  return null;
}

/** O médico mexeu em algum item? Escala intocada não é enviada. */
export function isDraftTouched(draft: ScaleDraft): boolean {
  return Object.values(draft.values).some((v) => (Array.isArray(v) ? v.length > 0 : v.trim() !== ""));
}

/** Converte o rascunho em respostas no formato das funções de escore. */
export function draftToAnswers(code: string, draft: ScaleDraft): Record<string, unknown> {
  const answers: Record<string, unknown> = {};
  for (const item of visibleItems(code, draft)) {
    const v = draft.values[item.field];
    if (item.kind === "multi") {
      answers[item.field] = Array.isArray(v) ? v : [];
    } else if (item.kind === "choice") {
      answers[item.field] = typeof v === "string" && v !== "" ? v : undefined;
    } else {
      const text = typeof v === "string" ? v.trim().replace(",", ".") : "";
      answers[item.field] = text === "" ? undefined : Number(text);
    }
  }
  return answers;
}

export type DraftEvaluation =
  | { kind: "ok"; answers: Record<string, unknown>; result: ScoreResult }
  | { kind: "incomplete"; field: string }
  | { kind: "invalid"; field: string };

/** Prévia do escore com a função do pacote; devolve o primeiro campo vazio ou inválido. */
export function evaluateDraft(code: string, draft: ScaleDraft): DraftEvaluation {
  const answers = draftToAnswers(code, draft);
  const missing = visibleItems(code, draft).find((i) => i.kind !== "multi" && answers[i.field] === undefined);
  if (missing) return { kind: "incomplete", field: missing.field };
  try {
    const { result } = scoreClinicianScale(code, answers);
    return { kind: "ok", answers, result };
  } catch (err) {
    if (err instanceof ClinicalGuardError) return { kind: "invalid", field: err.field ?? code };
    throw err;
  }
}

/** Monta `escalasClinicas` para o POST; escalas não tocadas ficam de fora. */
export function buildClinicianScalesPayload(
  drafts: Record<string, ScaleDraft>,
  applicable: readonly string[],
): { ok: true; payload: Record<string, Record<string, unknown>> } | { ok: false; scale: string; field: string } {
  const payload: Record<string, Record<string, unknown>> = {};
  for (const code of applicable) {
    const draft = drafts[code];
    if (!draft || !isDraftTouched(draft)) continue;
    const ev = evaluateDraft(code, draft);
    if (ev.kind !== "ok") return { ok: false, scale: code, field: ev.field };
    payload[code] = ev.answers;
  }
  return { ok: true, payload };
}

export const itemLabelKey = (code: string, field: string) => `cs_${code}_${field}`;
export const optionLabelKey = (code: string, field: string, value: string) => `cs_${code}_${field}__${value}`;
export const scaleNameKey = (code: string) => `cs_scale_${code}`;
/** Dica de sentido da faixa (qual extremo é melhor), quando o item tem uma. */
export const itemHintKey = (code: string, field: string) => `cs_hint_${code}_${field}`;

/**
 * Itens numéricos subjetivos do Constant: no escore original (Constant & Murley 1987)
 * o valor maior é o melhor (15 = sem dor, 2 = sono sem interrupção, 4 = trabalho /
 * lazer plenos) — o escore soma os valores diretamente. Cada um tem dica de sentido.
 */
export const ITEMS_WITH_DIRECTION_HINT: Readonly<Record<string, readonly string[]>> = {
  CONSTANT: ["pain", "sleep", "work", "recreation"],
};

export const hasDirectionHint = (code: string, field: string) =>
  ITEMS_WITH_DIRECTION_HINT[code]?.includes(field) ?? false;
