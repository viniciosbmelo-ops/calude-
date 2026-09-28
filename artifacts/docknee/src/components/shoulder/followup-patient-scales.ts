/**
 * Resumo do que o paciente respondeu pelo link (scale_responses) ao lado do
 * valor registrado pelo médico no follow-up. A resposta do paciente nunca
 * substitui o vasDor do médico; quando diferem, o cartão mostra os dois.
 */
export type PatientScaleLike = { escala: string; score: number | null };

export type FollowupPainDisplay =
  | { kind: "single"; value: number | null }
  | { kind: "both"; clinician: number; patient: number }
  | { kind: "patientOnly"; patient: number };

function patientScore(scales: readonly PatientScaleLike[] | null | undefined, name: string): number | null {
  const s = (scales ?? []).find((x) => x.escala === name);
  return s && s.score != null && Number.isFinite(s.score) ? s.score : null;
}

export function followupPainDisplay(
  vasDor: number | null | undefined,
  escalasPaciente: readonly PatientScaleLike[] | null | undefined,
): FollowupPainDisplay {
  const patient = patientScore(escalasPaciente, "VAS Dor");
  const clinician = vasDor ?? null;
  if (patient == null) return { kind: "single", value: clinician };
  if (clinician == null) return { kind: "patientOnly", patient };
  if (Math.round(patient) === clinician || patient === clinician) return { kind: "single", value: clinician };
  return { kind: "both", clinician, patient };
}

export function followupPatientSane(escalasPaciente: readonly PatientScaleLike[] | null | undefined): number | null {
  return patientScore(escalasPaciente, "SANE");
}
