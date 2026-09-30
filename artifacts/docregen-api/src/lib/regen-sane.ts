/**
 * Region-specific SANE (single question, integer 0–100, higher = better) for
 * DocRegen. Every case asks VAS + the SANE of its condition's body region
 * (one SANE per case); conditions without a defined region ("outras") and
 * unknown/legacy codes ask VAS only. Definitions and wording (pt-BR / es)
 * live in @workspace/clinical/region-sane. SANE for the spine has limited
 * validation in the literature (validated mainly for shoulder/knee/hip).
 */
import {
  SANE_REGIONS,
  saneForBodyRegion,
  saneRegionByInstrument,
  type SaneRegionDef,
} from "@workspace/clinical/region-sane";
import { REGEN_CONDITION_CATALOG } from "./regen-conditions";

export { SANE_REGIONS, saneRegionByInstrument, type SaneRegionDef };

const REGION_BY_CODE = new Map(REGEN_CONDITION_CATALOG.map((condition) => [condition.code, condition.region]));

/** Recommended SANE for a condition code (catalog region), or null (VAS only). */
export function saneForCondition(code: unknown): SaneRegionDef | null {
  return typeof code === "string" ? saneForBodyRegion(REGION_BY_CODE.get(code)) : null;
}

/** Follow-up (patient link) scale names of every region SANE. */
export const SANE_SCALES: readonly string[] = SANE_REGIONS.map((d) => d.scale);

/** Manual codes + link names accepted on the clinician PROM form. */
export const SANE_INSTRUMENT_NAMES: readonly string[] = SANE_REGIONS.flatMap((d) => [d.code, d.scale]);

/** Research export keys ("sane_ombro", "sane_joelho", …). */
export const SANE_RESEARCH_KEYS: readonly string[] = SANE_REGIONS.map((d) => d.researchKey);
