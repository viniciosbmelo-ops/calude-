import type { Locale } from "@/lib/i18n";

type PublicErrorResponse = {
  error?: unknown;
};

/**
 * API errors in this flow are catalog-backed, patient-safe messages. Keep a
 * local fallback for malformed/unavailable responses rather than rendering
 * arbitrary response data.
 */
export function publicRegenServerError(
  payload: PublicErrorResponse,
  fallback: string,
): string {
  return typeof payload.error === "string" && payload.error.length > 0 && payload.error.length <= 500
    ? payload.error
    : fallback;
}

export function publicRegenFallbackLocale(locale: unknown): Locale {
  return locale === "es" ? "es" : "pt-BR";
}