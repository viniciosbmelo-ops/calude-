import type { ScopedMessages } from "@/lib/i18n";

/** Copy for the DocRegen home dashboard (regenerative medicine & pain). */
export const dashboardMessages = {
  "pt-BR": {
    subtitle: "Resumo da sua prática em medicina regenerativa e dor",
    doctorPrefix: "Dr(a).",
    newRegenCase: "Novo caso", newPatient: "Novo paciente", newAppointment: "Agendar",
    kpiRegenCases: "Casos regenerativos", kpiRegenCasesHint: "{active} ativos · {month} proced. no mês",
    kpiPendingProms: "PROMs pendentes", kpiPendingPromsHint: "{overdue} a enviar · {awaiting} sem resposta",
    kpiUpcoming: "Consultas em 7 dias", kpiUpcomingHint: "{total} agendadas no total",
    kpiPreConsults: "Pré-consultas aguardando", kpiPreConsultsHint: "{answered} respondidas recentemente",
    upcomingTitle: "Próximos agendamentos", upcomingEmpty: "Nenhum agendamento futuro.", viewAgenda: "Ver agenda",
    followupsTitle: "Follow-ups regenerativos pendentes", followupsEmpty: "Nenhum PROM pendente. Tudo em dia!", viewFollowups: "Central de follow-ups",
    overdueTag: "A enviar", awaitingTag: "Sem resposta",
    preConsultTitle: "Pré-consultas", preConsultAwaiting: "Aguardando o paciente", preConsultAnswered: "Respondidas",
    preConsultEmpty: "Nenhuma pré-consulta em andamento.", preConsultExpires: "expira em {date}", preConsultSubmitted: "enviada em {date}",
    avgVas: "VAS médio", adverseEvents: "Eventos adversos", totalProcedures: "Procedimentos", outcomesTitle: "Indicadores regenerativos", viewCases: "Ver casos",
    patient: "Paciente", today: "Hoje", tomorrow: "Amanhã", loadError: "Não foi possível carregar parte do painel.", retry: "Tentar novamente",
    typeConsulta: "Consulta", typeRetorno: "Retorno", typeRegen: "Procedimento regenerativo", typeOutro: "Outro",
  },
  es: {
    subtitle: "Resumen de su práctica en medicina regenerativa y dolor",
    doctorPrefix: "Dr(a).",
    newRegenCase: "Nuevo caso", newPatient: "Nuevo paciente", newAppointment: "Agendar",
    kpiRegenCases: "Casos regenerativos", kpiRegenCasesHint: "{active} activos · {month} proced. en el mes",
    kpiPendingProms: "PROMs pendientes", kpiPendingPromsHint: "{overdue} por enviar · {awaiting} sin respuesta",
    kpiUpcoming: "Citas en 7 días", kpiUpcomingHint: "{total} agendadas en total",
    kpiPreConsults: "Preconsultas en espera", kpiPreConsultsHint: "{answered} respondidas recientemente",
    upcomingTitle: "Próximas citas", upcomingEmpty: "No hay citas futuras.", viewAgenda: "Ver agenda",
    followupsTitle: "Seguimientos regenerativos pendientes", followupsEmpty: "No hay PROMs pendientes. ¡Todo al día!", viewFollowups: "Central de seguimientos",
    overdueTag: "Por enviar", awaitingTag: "Sin respuesta",
    preConsultTitle: "Preconsultas", preConsultAwaiting: "Esperando al paciente", preConsultAnswered: "Respondidas",
    preConsultEmpty: "No hay preconsultas en curso.", preConsultExpires: "vence el {date}", preConsultSubmitted: "enviada el {date}",
    avgVas: "VAS medio", adverseEvents: "Eventos adversos", totalProcedures: "Procedimientos", outcomesTitle: "Indicadores regenerativos", viewCases: "Ver casos",
    patient: "Paciente", today: "Hoy", tomorrow: "Mañana", loadError: "No se pudo cargar parte del panel.", retry: "Intentar de nuevo",
    typeConsulta: "Consulta", typeRetorno: "Control", typeRegen: "Procedimiento regenerativo", typeOutro: "Otro",
  },
} satisfies ScopedMessages<Record<string, string>>;
