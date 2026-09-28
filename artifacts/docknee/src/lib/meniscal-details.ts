export type MeniscalSide = "medial" | "lateral";

export interface MeniscalSideDetails {
  sutura?: boolean | null;
  lesaoRampa?: boolean | null;
  lesaoRaiz?: boolean | null;
  lesaoRaizAnterior?: boolean | null;
  lesaoCornoAnterior?: boolean | null;
  lesaoCornoPosterior?: boolean | null;
  lesaoAlcaBalde?: boolean | null;
  lesaoRadial?: boolean | null;
  lesaoCorpo?: boolean | null;
  lesaoDiscoide?: boolean | null;
  fixacaoRaiz?: string | null;
  centralizacaoRaiz?: boolean | null;
  centralizacaoMetodo?: string | null;
  tecnicasSutura?: string[];
  numPontos?: number | null;
  pontosPorTecnica?: string | null;
  tipoFio?: string | null;
  estimuloBiologico?: boolean | null;
  estimuloPerfuracaoIntercondilo?: boolean | null;
  estimuloCoaguloFibrina?: boolean | null;
  estimuloOrtobiologico?: boolean | null;
  estimuloOrtobiologicoTipo?: string | null;
  saucerizacao?: boolean | null;
  meniscectomia?: boolean | null;
}

export const MENISCAL_SIDE_DETAIL_KEYS = [
  "sutura",
  "lesaoRampa",
  "lesaoRaiz",
  "lesaoRaizAnterior",
  "lesaoCornoAnterior",
  "lesaoCornoPosterior",
  "lesaoAlcaBalde",
  "lesaoRadial",
  "lesaoCorpo",
  "lesaoDiscoide",
  "fixacaoRaiz",
  "centralizacaoRaiz",
  "centralizacaoMetodo",
  "tecnicasSutura",
  "numPontos",
  "pontosPorTecnica",
  "tipoFio",
  "estimuloBiologico",
  "estimuloPerfuracaoIntercondilo",
  "estimuloCoaguloFibrina",
  "estimuloOrtobiologico",
  "estimuloOrtobiologicoTipo",
  "saucerizacao",
  "meniscectomia",
] as const satisfies readonly (keyof MeniscalSideDetails)[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function sideSelectionKey(side: MeniscalSide): "ladoMedial" | "ladoLateral" {
  return side === "medial" ? "ladoMedial" : "ladoLateral";
}

export function sideDetailsKey(side: MeniscalSide): "detalhesMedial" | "detalhesLateral" {
  return side === "medial" ? "detalhesMedial" : "detalhesLateral";
}

export function getLegacyMeniscalDetails(
  procedure: Record<string, unknown> | null | undefined,
): MeniscalSideDetails {
  if (!procedure) return {};
  return Object.fromEntries(
    MENISCAL_SIDE_DETAIL_KEYS
      .filter((key) => procedure[key] !== undefined && procedure[key] !== null)
      .map((key) => [key, procedure[key]]),
  ) as MeniscalSideDetails;
}

export function getMeniscalSideDetails(
  procedure: Record<string, unknown> | null | undefined,
  side: MeniscalSide,
): MeniscalSideDetails {
  if (!procedure) return {};
  const explicit = getExplicitMeniscalSideDetails(procedure, side);
  if (explicit) return explicit;

  // Legacy records stored one shared detail set. Only expose that set for a
  // side that was actually selected in the historical record.
  return procedure[sideSelectionKey(side)] === true
    ? getLegacyMeniscalDetails(procedure)
    : {};
}

export function getExplicitMeniscalSideDetails(
  procedure: Record<string, unknown> | null | undefined,
  side: MeniscalSide,
): MeniscalSideDetails | null {
  if (!procedure) return null;
  const explicit = procedure[sideDetailsKey(side)];
  return isRecord(explicit) ? explicit as MeniscalSideDetails : null;
}

export function hasExplicitMeniscalSideDetails(
  procedure: Record<string, unknown> | null | undefined,
): boolean {
  return !!procedure && (
    isRecord(procedure.detalhesMedial) || isRecord(procedure.detalhesLateral)
  );
}

function reconcileAggregateFlags(procedure: Record<string, unknown>): Record<string, unknown> {
  const medial = getExplicitMeniscalSideDetails(procedure, "medial");
  const lateral = getExplicitMeniscalSideDetails(procedure, "lateral");
  return {
    ...procedure,
    sutura: !!(medial?.sutura || lateral?.sutura),
    meniscectomia: !!(medial?.meniscectomia || lateral?.meniscectomia),
    estimuloBiologico: !!(medial?.estimuloBiologico || lateral?.estimuloBiologico),
  };
}

export function removeMeniscalSideDetails(
  procedure: Record<string, unknown> | null | undefined,
  side: MeniscalSide,
): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...(procedure || {}),
    [sideSelectionKey(side)]: false,
    [sideDetailsKey(side)]: null,
  };
  const otherSide: MeniscalSide = side === "medial" ? "lateral" : "medial";

  if (!getExplicitMeniscalSideDetails(next, otherSide) && next[sideSelectionKey(otherSide)] !== true) {
    for (const key of MENISCAL_SIDE_DETAIL_KEYS) {
      next[key] = key === "tecnicasSutura" ? [] : null;
    }
  }

  return reconcileAggregateFlags(next);
}

export function clearMeniscalProcedureDetails(
  procedure: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...(procedure || {}),
    ladoMedial: false,
    ladoLateral: false,
    detalhesMedial: null,
    detalhesLateral: null,
  };
  for (const key of MENISCAL_SIDE_DETAIL_KEYS) {
    next[key] = key === "tecnicasSutura" ? [] : null;
  }
  return reconcileAggregateFlags(next);
}

export function hasMeaningfulMeniscalDetails(details: MeniscalSideDetails): boolean {
  return Object.values(details).some(
    (value) => value !== null
      && value !== undefined
      && value !== false
      && value !== ""
      && !(Array.isArray(value) && value.length === 0),
  );
}