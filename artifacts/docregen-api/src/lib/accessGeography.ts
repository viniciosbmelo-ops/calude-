import { isIP } from "node:net";
import geoIp from "geoip-lite";
import type { Lookup } from "geoip-lite";

export type AccessType = "site" | "platform";

export interface AccessGeography {
  countryCode: string | null;
  regionCode: string | null;
}

export interface AccessGeographyDescription {
  kind: "state" | "country" | "unknown";
  code: string | null;
  label: string;
}

type LookupFn = (ip: string) => Pick<Lookup, "country" | "region"> | null;

const PUBLIC_SITE_PATHS = new Set(["/", "/login", "/register", "/forgot-password"]);

const BRAZILIAN_STATES = new Set([
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO",
  "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI",
  "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
]);

const BRAZILIAN_STATE_NAMES: Record<string, string> = {
  AC: "Acre",
  AL: "Alagoas",
  AP: "Amapá",
  AM: "Amazonas",
  BA: "Bahia",
  CE: "Ceará",
  DF: "Distrito Federal",
  ES: "Espírito Santo",
  GO: "Goiás",
  MA: "Maranhão",
  MT: "Mato Grosso",
  MS: "Mato Grosso do Sul",
  MG: "Minas Gerais",
  PA: "Pará",
  PB: "Paraíba",
  PR: "Paraná",
  PE: "Pernambuco",
  PI: "Piauí",
  RJ: "Rio de Janeiro",
  RN: "Rio Grande do Norte",
  RS: "Rio Grande do Sul",
  RO: "Rondônia",
  RR: "Roraima",
  SC: "Santa Catarina",
  SP: "São Paulo",
  SE: "Sergipe",
  TO: "Tocantins",
};

const countryNames = new Intl.DisplayNames(["pt-BR"], { type: "region" });

export function classifyVisitPath(path: string | null): AccessType {
  return path != null && PUBLIC_SITE_PATHS.has(path) ? "site" : "platform";
}

export function normalizeClientIp(rawIp: string | null | undefined): string | null {
  if (!rawIp) return null;

  let ip = rawIp.trim();
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  if (ip.startsWith("[") && ip.endsWith("]")) ip = ip.slice(1, -1);

  return isIP(ip) ? ip : null;
}

export function resolveAccessGeography(
  rawIp: string | null | undefined,
  lookup: LookupFn = geoIp.lookup,
): AccessGeography {
  const ip = normalizeClientIp(rawIp);
  if (!ip) return { countryCode: null, regionCode: null };

  try {
    const result = lookup(ip);
    const countryCode = result?.country?.trim().toUpperCase() ?? "";
    if (!/^[A-Z]{2}$/.test(countryCode)) {
      return { countryCode: null, regionCode: null };
    }

    if (countryCode !== "BR") {
      return { countryCode, regionCode: null };
    }

    const regionCode = result?.region?.trim().toUpperCase() ?? "";
    return {
      countryCode,
      regionCode: BRAZILIAN_STATES.has(regionCode) ? regionCode : null,
    };
  } catch {
    return { countryCode: null, regionCode: null };
  }
}

export function describeAccessGeography(
  rawCountryCode: string | null | undefined,
  rawRegionCode: string | null | undefined,
): AccessGeographyDescription {
  const countryCode = rawCountryCode?.trim().toUpperCase() ?? "";
  const regionCode = rawRegionCode?.trim().toUpperCase() ?? "";

  if (countryCode === "BR" && BRAZILIAN_STATES.has(regionCode)) {
    return {
      kind: "state",
      code: regionCode,
      label: `${BRAZILIAN_STATE_NAMES[regionCode]} (${regionCode})`,
    };
  }

  if (countryCode === "BR") {
    return {
      kind: "country",
      code: countryCode,
      label: "Brasil — estado não identificado",
    };
  }

  if (/^[A-Z]{2}$/.test(countryCode)) {
    try {
      return {
        kind: "country",
        code: countryCode,
        label: countryNames.of(countryCode) ?? countryCode,
      };
    } catch {
      return { kind: "country", code: countryCode, label: countryCode };
    }
  }

  return {
    kind: "unknown",
    code: null,
    label: "Localização desconhecida",
  };
}