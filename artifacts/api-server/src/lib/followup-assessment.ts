/**
 * Um registro de follow-up é criado quando o questionário é enviado ao paciente
 * (ou quando o médico abre uma avaliação manual). Ele conta como avaliação
 * respondida quando tem algum desfecho registrado OU ao menos uma resposta de
 * escala (scale_responses — p. ex. SANE respondido pelo paciente).
 */
export function hasRecordedAssessment(followup: {
  id?: number | null;
  vasDor?: number | null;
  admFlexao?: number | null;
  admExtensao?: number | null;
  complicacoes?: readonly string[] | null;
  retornoEsporte?: boolean | null;
  nivelRetorno?: string | null;
  falha?: boolean | null;
  falhaType?: string | null;
  /** Há ao menos uma linha em scale_responses para este follow-up. */
  hasScaleResponses?: boolean | null;
}): boolean {
  if (followup.id == null) return false;
  return followup.hasScaleResponses === true
    || followup.vasDor != null
    || followup.admFlexao != null
    || followup.admExtensao != null
    || (followup.complicacoes?.length ?? 0) > 0
    || followup.retornoEsporte != null
    || Boolean(followup.nivelRetorno)
    || followup.falha != null
    || Boolean(followup.falhaType);
}

export type FollowupOverviewBucket = "respondidos" | "aguardando" | "vencidos" | "agendados";

/**
 * Classifica uma notificação agendada para o painel de seguimentos.
 * "respondidos" exige desfecho ou resposta de escala (mesma definição dos relatórios);
 * questionário enviado sem resposta conta como "aguardando".
 */
export function classifyFollowupNotification(
  row: { status: string; scheduledDate: string | null; followupId: number | null },
  answered: boolean,
  today: string,
): FollowupOverviewBucket {
  if (row.followupId !== null && answered) return "respondidos";
  if (row.followupId !== null || row.status === "sent") return "aguardando";
  if (row.scheduledDate && row.scheduledDate <= today) return "vencidos";
  return "agendados";
}
