import type { Locale } from "@/lib/i18n";

export type OrientationTab = "pre" | "pos";

export interface OrientationBootstrap {
  procKey: string;
  tab: OrientationTab;
  doctorLocale: Locale;
}

/**
 * A bearer token is authoritative: query values are legacy-only and must never
 * override claims returned by the server bootstrap endpoint.
 */
export function resolveOrientationBootstrap(
  token: string | null,
  queryProcKey: string | null,
  queryTab: string | null,
  signed: OrientationBootstrap | null,
): OrientationBootstrap | null {
  if (token) return signed;
  return {
    procKey: queryProcKey ?? "prp_articular",
    tab: queryTab === "pre" ? "pre" : "pos",
    doctorLocale: "pt-BR",
  };
}