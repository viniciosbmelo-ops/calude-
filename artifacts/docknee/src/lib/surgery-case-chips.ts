/**
 * Splits a surgery's case type and procedure types into display chips without
 * repeating the same label: procedure chips are kept (richer styling), and the
 * separate case-type chip only appears when it differs from every procedure.
 */
export function surgeryCaseTypeChips(
  surgery: { tipoCaso?: string | null; tiposProcedimento?: string[] | null },
  label: (key: string) => string,
): { caseTypeChip: string | null; procedureChips: string[] } {
  const procedureChips: string[] = [];
  const seen = new Set<string>();
  for (const key of surgery.tiposProcedimento ?? []) {
    const text = label(key);
    const norm = text.trim().toLocaleLowerCase();
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    procedureChips.push(text);
  }
  const caseText = surgery.tipoCaso ? label(surgery.tipoCaso) : "";
  const caseNorm = caseText.trim().toLocaleLowerCase();
  const caseTypeChip = caseNorm && !seen.has(caseNorm) ? caseText : null;
  return { caseTypeChip, procedureChips };
}
