import { applicationAnatomicalSite } from "@workspace/clinical/application-sites";

export interface RegenApplicationSite {
  localAplicacao: string;
  guia: string;
  /**
   * Anatomical site code (catalog in @workspace/clinical/application-sites).
   * Optional: rows saved before this field existed simply have no structure.
   */
  estruturaAnatomica?: string;
  /** Free text for "Músculo (especificar)" / "Outro (especificar)". */
  estruturaAnatomicaDetalhe?: string;
}

export const APPLICATION_SITES_KEY = "locaisAplicacao";

function asSite(value: unknown): RegenApplicationSite | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const localAplicacao = typeof row.localAplicacao === "string" ? row.localAplicacao : "";
  const guia = typeof row.guia === "string" ? row.guia : "";
  const estruturaAnatomica = typeof row.estruturaAnatomica === "string" ? row.estruturaAnatomica : "";
  const estruturaAnatomicaDetalhe = typeof row.estruturaAnatomicaDetalhe === "string" ? row.estruturaAnatomicaDetalhe : "";
  if (!localAplicacao.trim() && !guia.trim() && !estruturaAnatomica.trim()) return null;
  if (!estruturaAnatomica.trim()) return { localAplicacao, guia };
  return estruturaAnatomicaDetalhe.trim()
    ? { localAplicacao, guia, estruturaAnatomica, estruturaAnatomicaDetalhe }
    : { localAplicacao, guia, estruturaAnatomica };
}

/**
 * Validates only the serialized repeatable extension. Other product detail
 * keys intentionally remain open for future technical fields.
 */
export function parseApplicationSites(value: unknown): RegenApplicationSite[] | null {
  if (typeof value !== "string" || !value.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  if (parsed.some(item => (
    !item
    || typeof item !== "object"
    || Array.isArray(item)
    || typeof (item as Record<string, unknown>).localAplicacao !== "string"
    || typeof (item as Record<string, unknown>).guia !== "string"
    || !["undefined", "string"].includes(typeof (item as Record<string, unknown>).estruturaAnatomica)
    || !["undefined", "string"].includes(typeof (item as Record<string, unknown>).estruturaAnatomicaDetalhe)
  ))) return null;
  const rows = parsed.map(asSite);
  if (rows.some(row => row === null)) return null;
  return rows.filter((row): row is RegenApplicationSite => row !== null);
}

export function hasValidApplicationSitesExtension(productDetails: Record<string, string>): boolean {
  const raw = productDetails[APPLICATION_SITES_KEY];
  if (raw === undefined) return true;
  return parseApplicationSites(raw) !== null;
}

export function applicationSitesForProductDetails(
  productDetails: Record<string, string> | null | undefined,
): RegenApplicationSite[] {
  const extension = parseApplicationSites(productDetails?.[APPLICATION_SITES_KEY]);
  if (extension && extension.length > 0) return extension;
  const legacy = asSite({
    localAplicacao: productDetails?.localAplicacao,
    guia: productDetails?.guia,
  });
  return legacy ? [legacy] : [];
}

export function synchronizeApplicationSiteLegacyFields(
  productDetails: Record<string, string>,
): Record<string, string> {
  const sites = applicationSitesForProductDetails(productDetails);
  if (sites.length === 0) return productDetails;
  return {
    ...productDetails,
    localAplicacao: sites[0].localAplicacao,
    guia: sites[0].guia,
  };
}

/**
 * Catalog labels of the case's anatomical structures ("; "-separated, in the
 * given locale), for the anonymised research export. Only catalog labels:
 * the free-text complement and unknown values are never exported.
 */
export function anatomicalSiteLabelsForResearch(
  productDetails: Record<string, string> | null | undefined,
  locale: "pt-BR" | "es" = "pt-BR",
): string {
  const labels = applicationSitesForProductDetails(productDetails)
    .map(site => applicationAnatomicalSite(site.estruturaAnatomica))
    .filter((site): site is NonNullable<typeof site> => site !== null)
    .map(site => site.label[locale]);
  return [...new Set(labels)].join("; ");
}
