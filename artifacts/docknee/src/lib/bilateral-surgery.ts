export type SurgeryLimb = "direito" | "esquerdo";

export type LimbSnapshot = Record<string, unknown>;

export interface BilateralDocumentation {
  schemaVersion: 1;
  byLimb: Partial<Record<SurgeryLimb, LimbSnapshot>>;
}

const SHARED_FIELDS = new Set([
  "id",
  "patientId",
  "dataCirurgia",
  "hospital",
  "lado",
  "status",
  "createdAt",
  "updatedAt",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseDetails(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Creates the side-owned portion of a wizard payload. Shared surgery metadata is excluded. */
export function createLimbSnapshot(
  payload: Record<string, unknown>,
  uiState?: Record<string, unknown>,
): LimbSnapshot {
  const snapshot = Object.fromEntries(
    Object.entries(payload).filter(([key]) => !SHARED_FIELDS.has(key) && key !== "procedimentosDetalhados"),
  );
  return {
    ...snapshot,
    detalhesProcedimentos: parseDetails(payload.procedimentosDetalhados),
    ...(uiState ? { _wizardUi: uiState } : {}),
  };
}

export function readBilateralDocumentation(value: unknown): BilateralDocumentation | null {
  const details = parseDetails(value);
  const candidate = isRecord(details.bilateral)
    ? details.bilateral
    : (details.schemaVersion === 1 && isRecord(details.byLimb) ? details : null);
  if (!candidate || candidate.schemaVersion !== 1 || !isRecord(candidate.byLimb)) return null;

  const byLimb: Partial<Record<SurgeryLimb, LimbSnapshot>> = {};
  if (isRecord(candidate.byLimb.direito)) byLimb.direito = candidate.byLimb.direito;
  if (isRecord(candidate.byLimb.esquerdo)) byLimb.esquerdo = candidate.byLimb.esquerdo;
  return { schemaVersion: 1, byLimb };
}

/** Adds versioned bilateral data while preserving every existing/unknown detail key. */
export function writeBilateralDocumentation(
  value: unknown,
  byLimb: Partial<Record<SurgeryLimb, LimbSnapshot>>,
): string {
  const details = parseDetails(value);
  return JSON.stringify({
    ...details,
    bilateral: { schemaVersion: 1, byLimb },
  });
}

function isSubstantive(value: unknown, key?: string): boolean {
  if (key?.startsWith("_")) return false;
  if (value == null || value === "" || value === false) return false;
  if (Array.isArray(value)) return value.some((item) => isSubstantive(item));
  if (isRecord(value)) {
    return Object.entries(value).some(([nestedKey, nested]) => isSubstantive(nested, nestedKey));
  }
  return true;
}

/** Intentionally validates a body of documentation, not individual optional fields. */
export function hasSubstantiveLimbDocumentation(snapshot: LimbSnapshot | null | undefined): boolean {
  if (!snapshot) return false;
  const clinicalKeys = [
    "tipoCaso", "diagnostico", "alinhamento", "grauAlinhamento",
    "tiposProcedimento", "ligamentosAcometidos", "procedimentoRealizado",
    "observacoes", "exameLigamentar", "examePatelar", "exameOsteocondral",
    "lcaAlgorithm", "aclLeapDecision", "ocdAnalysis", "picsScore", "procedimentoMeniscal", "detalhesProcedimentos",
    "lcpReconstruction", "cpmReconstruction", "cplReconstruction",
    "periprostheticFracture", "distalFemurFracture", "tibialPlateauFracture",
    "patellaFracture", "tibialSpineFracture", "patelarTendonRupture",
    "quadricepsTendonRupture", "procedimentoRealizado",
  ];
  return clinicalKeys.some((key) => isSubstantive(snapshot[key], key));
}

export function limbHeading(limb: SurgeryLimb, locale: "pt-BR" | "es"): string {
  if (locale === "es") return limb === "direito" ? "RODILLA DERECHA" : "RODILLA IZQUIERDA";
  return limb === "direito" ? "JOELHO DIREITO" : "JOELHO ESQUERDO";
}

export function updateStoredLimbSnapshot(
  byLimb: Partial<Record<SurgeryLimb, LimbSnapshot>>,
  limb: SurgeryLimb,
  initial: LimbSnapshot,
  updater: (snapshot: LimbSnapshot) => LimbSnapshot,
): Partial<Record<SurgeryLimb, LimbSnapshot>> {
  return {
    ...byLimb,
    [limb]: updater({ ...initial, ...(byLimb[limb] ?? {}) }),
  };
}