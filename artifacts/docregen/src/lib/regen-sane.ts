/**
 * Region-specific SANE in DocRegen (web side). Every case asks VAS + the SANE
 * of its condition's body region — one SANE per case (ombro, joelho, quadril,
 * cotovelo, tornozelo/pé, punho/mão, coluna). Conditions without a defined
 * region ("outras") and legacy/unknown codes take the region of the case's
 * application site(s) when all sites map to one SANE; otherwise VAS only
 * (`saneForCase`, mirrors the API).
 * Definitions and wording (pt-BR / es) come from @workspace/clinical/region-sane.
 * SANE for the spine has limited validation in the literature
 * (`limitedValidation`: the clinician UI shows a subtle note).
 */
import {
  SANE_REGIONS,
  saneForBodyRegion,
  saneRegionByInstrument,
  type SaneRegionCode,
  type SaneRegionDef,
} from "@workspace/clinical/region-sane";
import { saneForCase as saneForRegionAndSites } from "@workspace/clinical/application-sites";
import { REGEN_CONDITION_CATALOG } from "./regen-conditions";
import { parseApplicationSites } from "./regen-application-sites";

export { SANE_REGIONS, saneRegionByInstrument };
export type { SaneRegionCode, SaneRegionDef };

const REGION_BY_CODE = new Map(REGEN_CONDITION_CATALOG.map((c) => [c.code, c.region] as const));

/** Recommended SANE for a condition code, or null (VAS only). */
export function saneForCondition(code: string | null | undefined): SaneRegionDef | null {
  return code ? saneForBodyRegion(REGION_BY_CODE.get(code)) : null;
}

/**
 * SANE of a case from its current data: the condition's region SANE; for
 * conditions without a region, the single region of its application sites
 * (product_details.locaisAplicacao / legacy localAplicacao); else null.
 */
export function saneForCase(
  conditionCode: string | null | undefined,
  productDetails: Record<string, unknown> | null | undefined,
): SaneRegionDef | null {
  const region = conditionCode ? REGION_BY_CODE.get(conditionCode) : undefined;
  return saneForRegionAndSites(region, parseApplicationSites(productDetails));
}

const loose = (value: string) => value.trim().toLowerCase().replace(/[\s_-]+/g, " ");

const BY_LOOSE_NAME = new Map<string, SaneRegionDef>(
  SANE_REGIONS.flatMap((d) => [d.code, d.scale, d.label["pt-BR"], d.label.es].map((n) => [loose(n), d] as const)),
);

/**
 * Any spelling of a region SANE ("SANE_OMBRO", "SANE Ombro", "SANE Hombro",
 * "sane-ombro") → its definition; null otherwise.
 */
export function saneDefForName(name: string | null | undefined): SaneRegionDef | null {
  if (!name) return null;
  return saneRegionByInstrument(name.trim()) ?? BY_LOOSE_NAME.get(loose(name)) ?? null;
}

/** Display label for a SANE in the given locale ("SANE Ombro" / "SANE Hombro"). */
export function saneLabel(def: SaneRegionDef, locale: string): string {
  return locale.startsWith("es") ? def.label.es : def.label["pt-BR"];
}

/** The SANE question in the given locale (used as help text in the clinician form). */
export function saneQuestion(def: SaneRegionDef, locale: string): string {
  return locale.startsWith("es") ? def.question.es : def.question["pt-BR"];
}
