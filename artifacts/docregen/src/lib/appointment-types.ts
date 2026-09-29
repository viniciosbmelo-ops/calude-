import { operationalAgendaMessages } from "@/locales/operational-agenda";

/**
 * Appointment types offered in DocRegen. Values are persisted verbatim in the
 * shared appointments table, so they must never be translated.
 */
export const APPOINTMENT_TYPES = ["consulta", "retorno", "procedimento regenerativo", "outro"] as const;

/**
 * Surgical appointment types that DocKnee still creates in the shared
 * database. DocRegen no longer offers them, but keeps their labels so existing
 * appointments remain readable and editable without losing their type.
 */
export const LEGACY_SURGICAL_APPOINTMENT_TYPES = ["avaliação pré-op", "avaliação pós-op", "curativo"] as const;

export const APPOINTMENT_STATUSES = ["agendado", "confirmado", "cancelado", "realizado", "faltou"] as const;

/** Options for the type selector; an existing legacy value stays selectable while editing. */
export function selectableAppointmentTypes(current?: string | null): string[] {
  const options: string[] = [...APPOINTMENT_TYPES];
  if (current && !options.includes(current)) options.push(current);
  return options;
}

// ─── Display labels (shared by the doctor's agenda and the secretary portal) ──

const TYPE_LABEL_KEYS = {
  consulta: "typeConsulta",
  retorno: "typeRetorno",
  "procedimento regenerativo": "typeRegen",
  "avaliação pré-op": "typePreop",
  "avaliação pós-op": "typePostop",
  curativo: "typeCurativo",
  outro: "typeOutro",
} as const;

const STATUS_LABEL_KEYS = {
  agendado: "statusAgendado",
  confirmado: "statusConfirmado",
  cancelado: "statusCancelado",
  realizado: "statusRealizado",
  faltou: "statusFaltou",
} as const;

type AgendaLocale = keyof typeof operationalAgendaMessages;

function agendaCatalog(locale: string) {
  const key: AgendaLocale = locale.startsWith("es") ? "es" : "pt-BR";
  return operationalAgendaMessages[key];
}

/** Human label for a persisted appointment type ("retorno" → "Retorno"). */
export function appointmentTypeLabel(value: string | null | undefined, locale = "pt-BR"): string {
  if (!value) return "";
  const key = TYPE_LABEL_KEYS[value as keyof typeof TYPE_LABEL_KEYS];
  return key ? agendaCatalog(locale)[key] : value;
}

/** Human label for a persisted appointment status ("agendado" → "Agendado"). */
export function appointmentStatusLabel(value: string | null | undefined, locale = "pt-BR"): string {
  if (!value) return "";
  const key = STATUS_LABEL_KEYS[value as keyof typeof STATUS_LABEL_KEYS];
  return key ? agendaCatalog(locale)[key] : value;
}
