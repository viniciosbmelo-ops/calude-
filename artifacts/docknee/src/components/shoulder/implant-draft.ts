/**
 * Estado do formulário de implante (sem React, para teste).
 * A categoria começa VAZIA: antes vinha pré-selecionada como "anchor", e todo implante cuja
 * categoria não era trocada explicitamente (ex.: um botão cortical) era gravado como âncora.
 */
import { IMPLANT_CATEGORIES as CATEGORY_KEYS, type ClinicalImplant } from "@workspace/clinical/web";

const CATEGORY_LABELS: Record<(typeof CATEGORY_KEYS)[number], string> = {
  anchor: "Âncora", screw: "Parafuso", plate: "Placa", button: "Botão",
  prosthesis_component: "Componente protético", graft: "Enxerto", suture_tape: "Fio/fita", other: "Outro",
};

/** [valor gravado, rótulo] na ordem das categorias aceitas pelo núcleo clínico. */
export const IMPLANT_CATEGORIES: [string, string][] = CATEGORY_KEYS.map((k): [string, string] => [k, CATEGORY_LABELS[k]]);

export const implantCategoryLabel = (c: string) => IMPLANT_CATEGORIES.find(([k]) => k === c)?.[1] ?? c;

export function emptyImplantDraft(): ClinicalImplant {
  return { categoria: "", fabricante: "", modelo: "", quantidade: 1 };
}

export function canAddImplant(d: ClinicalImplant | null): boolean {
  return Boolean(d && IMPLANT_CATEGORIES.some(([k]) => k === d.categoria) && d.fabricante.trim() && d.modelo.trim());
}

/** Linha secundária exibida na lista de implantes. */
export function implantSummary(m: ClinicalImplant): string {
  return `${implantCategoryLabel(m.categoria)}${m.lote ? ` · lote ${m.lote}` : " · sem lote"}${m.serie ? ` · série ${m.serie}` : ""}${m.validade ? ` · validade ${m.validade}` : ""}${m.localizacao ? ` · ${m.localizacao}` : ""}`;
}
