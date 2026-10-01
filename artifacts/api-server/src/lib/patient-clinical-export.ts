/**
 * Perfil clínico do paciente (lado dominante, tabagismo, diabetes, nível de atividade) nas exportações LGPD.
 * São dados de saúde do titular: entram no acesso (Art. 18) e na portabilidade. Na anonimização são mantidos,
 * como os demais dados clínicos (Art. 16), porque não identificam o paciente.
 */
export interface PatientClinicalColumns {
  ladoDominante: string | null;
  tabagismo: string | null;
  diabetes: boolean | null;
  nivelAtividade: string | null;
}

export function patientClinicalExport(p: PatientClinicalColumns): PatientClinicalColumns {
  return {
    ladoDominante: p.ladoDominante ?? null,
    tabagismo: p.tabagismo ?? null,
    diabetes: p.diabetes ?? null,
    nivelAtividade: p.nivelAtividade ?? null,
  };
}

/** Coluna DADO_EXTRA do CSV: `chave=valor` separados por `|`, vazio quando não informado. */
export function patientClinicalCsvExtra(p: PatientClinicalColumns): string {
  const c = patientClinicalExport(p);
  return [
    `ladoDominante=${c.ladoDominante ?? ""}`,
    `tabagismo=${c.tabagismo ?? ""}`,
    `diabetes=${c.diabetes === null ? "" : c.diabetes ? "sim" : "nao"}`,
    `nivelAtividade=${c.nivelAtividade ?? ""}`,
  ].join("|");
}
