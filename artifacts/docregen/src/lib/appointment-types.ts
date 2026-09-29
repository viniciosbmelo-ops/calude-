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
