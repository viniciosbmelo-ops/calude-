/**
 * Progresso do questionário do paciente (link clássico de follow-up).
 *
 * O paciente só responde às escalas que lhe foram enviadas (escalasEnviadas)
 * e que o formulário público sabe exibir. Respostas de outras escalas no mesmo
 * follow-up (p. ex. Constant-Murley gravado pelo médico) NÃO contam: a
 * conclusão e o progresso são calculados por identidade de escala, nunca por
 * contagem de respostas.
 */
export interface PatientQuestionnaireProgress {
  /** Escalas do paciente, na ordem enviada, sem duplicatas. */
  scales: string[];
  /** Subconjunto de `scales` já respondido. */
  completed: string[];
  /** Subconjunto de `scales` ainda pendente. */
  pending: string[];
  /** Índice (em `scales`) da primeira pendente, ou -1. */
  firstPendingIdx: number;
  /** Todas as escalas do paciente respondidas (falso quando não há escalas). */
  allDone: boolean;
}

export function patientScaleList(
  escalasEnviadas: readonly string[] | null | undefined,
  isPatientScale: (name: string) => boolean,
): string[] {
  return [...new Set((escalasEnviadas ?? []).filter(isPatientScale))];
}

export function patientQuestionnaireProgress(
  scales: readonly string[],
  answered: readonly string[] | null | undefined,
): PatientQuestionnaireProgress {
  const answeredSet = new Set(answered ?? []);
  const list = [...new Set(scales)];
  const completed = list.filter((s) => answeredSet.has(s));
  const pending = list.filter((s) => !answeredSet.has(s));
  return {
    scales: list,
    completed,
    pending,
    firstPendingIdx: pending.length > 0 ? list.indexOf(pending[0]!) : -1,
    allDone: list.length > 0 && pending.length === 0,
  };
}
