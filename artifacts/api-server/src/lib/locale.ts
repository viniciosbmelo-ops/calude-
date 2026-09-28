import { db, doctorsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export type SupportedLocale = "pt-BR" | "es";

/** Only doctor-owned settings may be used to select communication language. */
export function resolveDoctorLocale(idioma: unknown): SupportedLocale {
  return typeof idioma === "string" && /^es(?:-[a-z]{2})?$/i.test(idioma.trim())
    ? "es"
    : "pt-BR";
}

export function localeDate(value: Date | string | number, locale: SupportedLocale): string {
  return new Intl.DateTimeFormat(locale === "es" ? "es-ES" : "pt-BR").format(new Date(value));
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