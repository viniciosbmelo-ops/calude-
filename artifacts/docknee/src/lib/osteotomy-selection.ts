import type { OpcaoId } from "./level-decision";

export type PrimaryNivelClass = 'DOUBLE_LEVEL' | 'SINGLE_FEMORAL' | 'SINGLE_TIBIAL' | 'WITHIN_NORMAL';

/**
 * Maps persisted server option ids to level-engine options. A DFO is anatomical
 * in a single-femoral case; the HKA-neutral DFO is reserved for an explicit
 * single-level choice outside that anatomy.
 */
export function getNivelOverrideForOsteotomia(
  optionId: unknown,
  primaryClass: PrimaryNivelClass | undefined,
): OpcaoId | null {
  const id = String(optionId ?? "");
  if (id.startsWith("dupla")) return "DUPLO_NIVEL";
  if (id.startsWith("hto")) return "TIBIAL_ANATOMICA";
  if (id.startsWith("dfo")) {
    return primaryClass === "SINGLE_FEMORAL"
      ? "FEMORAL_ANATOMICA"
      : "FEMORAL_HKA_NEUTRO";
  }
  return null;
}

/** Resolves legacy option ids using the current anatomy-based level decision. */
export function preferredOsteotomiaIndex(
  opcoes: Array<Record<string, unknown>>,
  primaryClass: PrimaryNivelClass | undefined,
): number {
  const matches = primaryClass === 'DOUBLE_LEVEL'
    ? (id: string) => id.startsWith("dupla")
    : primaryClass === 'SINGLE_FEMORAL'
      ? (id: string) => id.startsWith("dfo")
      : primaryClass === 'SINGLE_TIBIAL'
        ? (id: string) => id.startsWith("hto")
        : null;
  if (matches) {
    const idx = opcoes.findIndex((option) => matches(String(option.id ?? "")));
    if (idx >= 0) return idx;
  }
  return opcoes.findIndex((option) => option.padrao === true);
}

export function isOptionCompatibleWithPrimaryClass(
  optionId: unknown,
  primaryClass: PrimaryNivelClass,
): boolean {
  const id = String(optionId ?? "");
  if (primaryClass === 'DOUBLE_LEVEL') return id.startsWith("dupla");
  if (primaryClass === 'SINGLE_FEMORAL') return id.startsWith("dfo");
  if (primaryClass === 'SINGLE_TIBIAL') return id.startsWith("hto");
  return true;
}