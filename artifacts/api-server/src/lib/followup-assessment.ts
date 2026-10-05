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

/** Fuso da clínica: "hoje" para vencido/agendado é o dia de calendário aqui. */
export const CLINIC_TIME_ZONE = "America/Sao_Paulo";

/**
 * Data de hoje ("YYYY-MM-DD") no fuso da clínica. `new Date().toISOString()`
 * usa UTC, que já é "amanhã" a partir das 21h em São Paulo.
 */
export function clinicToday(now: Date = new Date(), timeZone: string = CLINIC_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * Uma data agendada (somente data) está vencida apenas quando é anterior a hoje;
 * a agendada para hoje está "a enviar", não vencida.
 */
export function isScheduledDateOverdue(scheduledDate: string | null | undefined, today: string): boolean {
  return Boolean(scheduledDate) && String(scheduledDate).slice(0, 10) < today;
}

/**
 * Uma notificação agendada está "a enviar" quando sua data é hoje ou anterior,
 * sempre no dia de calendário da clínica (`clinicToday`), nunca no dia UTC —
 * senão, depois das 21h em São Paulo, o questionário de amanhã sairia na véspera.
 */
export function isScheduledDateDueToSend(scheduledDate: string | null | undefined, today: string): boolean {
  return Boolean(scheduledDate) && String(scheduledDate).slice(0, 10) <= today;
}

export type FollowupOverviewBucket = "respondidos" | "aguardando" | "vencidos" | "agendados";

/**
 * Classifica uma notificação agendada para o painel de seguimentos.
 * "respondidos" exige desfecho ou resposta de escala (mesma definição dos relatórios);
 * questionário enviado sem resposta conta como "aguardando".
 * `today` é a data de calendário da clínica (ver `clinicToday`); agendada para
 * hoje fica em "agendados" (a enviar), só datas anteriores contam como "vencidos".
 */
export function classifyFollowupNotification(
  row: { status: string; scheduledDate: string | null; followupId: number | null },
  answered: boolean,
  today: string,
): FollowupOverviewBucket {
  if (row.followupId !== null && answered) return "respondidos";
  if (row.followupId !== null || row.status === "sent") return "aguardando";
  if (isScheduledDateOverdue(row.scheduledDate, today)) return "vencidos";
  return "agendados";
}
