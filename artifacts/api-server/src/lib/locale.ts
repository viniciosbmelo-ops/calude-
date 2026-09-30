import { db, doctorsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { CLINIC_TIME_ZONE } from "./calendar-date";

export type SupportedLocale = "pt-BR" | "es";

/** Only doctor-owned settings may be used to select communication language. */
export function resolveDoctorLocale(idioma: unknown): SupportedLocale {
  return typeof idioma === "string" && /^es(?:-[a-z]{2})?$/i.test(idioma.trim())
    ? "es"
    : "pt-BR";
}

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Formats a date for documents. Calendar dates ("YYYY-MM-DD", as PostgreSQL
 * `date` columns are returned) are formatted from their Y/M/D parts in UTC so
 * the server timezone can never shift them a day. Instants (issue dates such as
 * `new Date()`, timestamps) format on the clinic calendar (America/Sao_Paulo),
 * so a document issued at 23:30 in Brasília never shows the next day even when
 * the server runs in UTC. Returns "" for unparseable input instead of throwing.
 */
export function localeDate(value: Date | string | number, locale: SupportedLocale): string {
  const formatLocale = locale === "es" ? "es-ES" : "pt-BR";
  if (typeof value === "string") {
    const match = DATE_ONLY_RE.exec(value.trim());
    if (match) {
      const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
      if (Number.isNaN(utc.getTime())) return "";
      return new Intl.DateTimeFormat(formatLocale, { timeZone: "UTC" }).format(utc);
    }
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(formatLocale, { timeZone: CLINIC_TIME_ZONE }).format(date);
}

export async function localeForDoctorId(doctorId: number | null | undefined): Promise<SupportedLocale> {
  if (!doctorId) return "pt-BR";
  const [doctor] = await db
    .select({ idioma: doctorsTable.idioma })
    .from(doctorsTable)
    .where(eq(doctorsTable.id, doctorId))
    .limit(1);
  return resolveDoctorLocale(doctor?.idioma);
}