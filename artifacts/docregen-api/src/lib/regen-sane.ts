/**
 * Region-specific SANE (single question, integer 0–100, higher = better) for
 * DocRegen. Every case asks VAS + the SANE of its condition's body region
 * (one SANE per case). Conditions without a defined region ("outras") and
 * unknown/legacy codes take the region of the case's application site(s)
 * when they all map to one SANE; otherwise VAS only (`saneForCase`). Definitions and wording (pt-BR / es)
 * live in @workspace/clinical/region-sane. SANE for the spine has limited
 * validation in the literature (validated mainly for shoulder/knee/hip).
 */
import {
  SANE_REGIONS,
  saneForBodyRegion,
  saneRegionByInstrument,
  type SaneRegionDef,
} from "@workspace/clinical/region-sane";
import { saneForCase as saneForRegionAndSites } from "@workspace/clinical/application-sites";
import { REGEN_CONDITION_CATALOG } from "./regen-conditions";
import { applicationSitesForProductDetails } from "./regen-application-sites";

export { SANE_REGIONS, saneRegionByInstrument, type SaneRegionDef };

const REGION_BY_CODE = new Map(REGEN_CONDITION_CATALOG.map((condition) => [condition.code, condition.region]));

/** Recommended SANE for a condition code (catalog region), or null (VAS only). */
export function saneForCondition(code: unknown): SaneRegionDef | null {
  return typeof code === "string" ? saneForBodyRegion(REGION_BY_CODE.get(code)) : null;
}

/**
 * SANE of a case, computed from its current data (no stored value): the
 * condition's region SANE; for conditions without a region, the SANE of the
 * application sites (product_details.locaisAplicacao) when they all map to one
 * region; else null (VAS only).
 */
export function saneForCase(conditionCode: unknown, productDetails: unknown): SaneRegionDef | null {
  const region = typeof conditionCode === "string" ? REGION_BY_CODE.get(conditionCode) : undefined;
  const details = productDetails && typeof productDetails === "object" && !Array.isArray(productDetails)
    ? productDetails as Record<string, string>
    : null;
  return saneForRegionAndSites(region, applicationSitesForProductDetails(details));
}

/**
 * The SANE that comes from the application sites only — null when the
 * condition has its own region (those cases keep their stored schedule
 * unchanged) or the sites do not map to one region. Used to extend follow-ups
 * already stored as VAS-only at read time.
 */
export function siteDerivedSane(conditionCode: unknown, productDetails: unknown): SaneRegionDef | null {
  return saneForCondition(conditionCode) ? null : saneForCase(conditionCode, productDetails);
}

/** Follow-up (patient link) scale names of every region SANE. */
export const SANE_SCALES: readonly string[] = SANE_REGIONS.map((d) => d.scale);

/** Manual codes + link names accepted on the clinician PROM form. */
export const SANE_INSTRUMENT_NAMES: readonly string[] = SANE_REGIONS.flatMap((d) => [d.code, d.scale]);

/** Research export keys ("sane_ombro", "sane_joelho", …). */
export const SANE_RESEARCH_KEYS: readonly string[] = SANE_REGIONS.map((d) => d.researchKey);
