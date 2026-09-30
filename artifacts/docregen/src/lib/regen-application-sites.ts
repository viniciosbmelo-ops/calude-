/**
 * Repeatable application locations for a regenerative case.
 *
 * The original wizard stored one location and one guidance value directly in
 * product_details.  The repeatable value is intentionally kept in the same
 * JSONB object as a JSON string so old API/database contracts remain valid.
 * The first row is mirrored to the legacy keys by syncApplicationSites.
 */

import {
  APPLICATION_ANATOMICAL_SITES,
  applicationAnatomicalSite,
} from "@workspace/clinical/application-sites";

export interface RegenApplicationSite {
  localAplicacao: string;
  guia: string;
  /**
   * Anatomical site code (APPLICATION_ANATOMICAL_SITES in
   * @workspace/clinical/application-sites). Optional: older rows have none.
   */
  estruturaAnatomica?: string;
}

export const APPLICATION_SITES_KEY = "locaisAplicacao";

export { APPLICATION_ANATOMICAL_SITES };

/** Display label of an anatomical site code in the given locale (unknown values as-is). */
export function anatomicalSiteLabel(value: string, locale: string): string {
  const site = applicationAnatomicalSite(value);
  if (!site) return value;
  return locale.startsWith("es") ? site.label.es : site.label["pt-BR"];
}

export const APPLICATION_SITE_LOCATIONS = [
  "Intra-articular",
  "Subcondroplastia",
  "Tecido periarticular",
  "Tendão patelar",
  "Ligamento",
  "Outro",
] as const;

export const APPLICATION_GUIDES = [
  "Ultrassom",
  "Fluoroscopia",
  "Artroscopia",
  "Referência anatômica (às cegas)",
  "Outro",
] as const;

const emptySite = (): RegenApplicationSite => ({ localAplicacao: "", guia: "", estruturaAnatomica: "" });

function asSite(value: unknown): RegenApplicationSite | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const localAplicacao = typeof row.localAplicacao === "string" ? row.localAplicacao : "";
  const guia = typeof row.guia === "string" ? row.guia : "";
  const estruturaAnatomica = typeof row.estruturaAnatomica === "string" ? row.estruturaAnatomica : "";
  if (!localAplicacao.trim() && !guia.trim() && !estruturaAnatomica.trim()) return null;
  return estruturaAnatomica.trim()
    ? { localAplicacao, guia, estruturaAnatomica }
    : { localAplicacao, guia };
}

/**
 * Reads the repeatable extension and falls back to the legacy singular
 * fields. Invalid/empty extensions never hide a populated legacy location.
 */
export function parseApplicationSites(
  productDetails: Record<string, unknown> | null | undefined,
): RegenApplicationSite[] {
  const raw = productDetails?.[APPLICATION_SITES_KEY];
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const rows = parsed.map(asSite).filter((row): row is RegenApplicationSite => row !== null);
        if (rows.length > 0) return rows;
      }
    } catch {
      // A malformed extension should not hide the legacy singular value.
    }
  } else if (Array.isArray(raw)) {
    const rows = raw.map(asSite).filter((row): row is RegenApplicationSite => row !== null);
    if (rows.length > 0) return rows;
  }

  const legacy = asSite({
    localAplicacao: productDetails?.localAplicacao,
    guia: productDetails?.guia,
  });
  return legacy ? [legacy] : [];
}

/**
 * Mirrors row 1 to localAplicacao/guia while retaining the source object and
 * shared observations. Empty rows are not persisted.
 */
export function syncApplicationSites(
  productDetails: Record<string, string>,
  sites: RegenApplicationSite[],
): Record<string, string> {
  const rows = sites
    .map(site => {
      const estruturaAnatomica = (site.estruturaAnatomica ?? "").trim();
      return {
        localAplicacao: site.localAplicacao.trim(),
        guia: site.guia.trim(),
        ...(estruturaAnatomica ? { estruturaAnatomica } : {}),
      };
    })
    .filter(site => site.localAplicacao !== "" || site.guia !== "" || site.estruturaAnatomica !== undefined);
  const next = { ...productDetails };

  if (rows.length > 0) {
    next[APPLICATION_SITES_KEY] = JSON.stringify(rows);
    next.localAplicacao = rows[0].localAplicacao;
    next.guia = rows[0].guia;
  } else {
    delete next[APPLICATION_SITES_KEY];
    // Explicit empty strings clear the legacy values on PATCH while leaving
    // any unrelated product details and observations untouched.
    if (Object.prototype.hasOwnProperty.call(productDetails, "localAplicacao")) {
      next.localAplicacao = "";
    } else {
      delete next.localAplicacao;
    }
    if (Object.prototype.hasOwnProperty.call(productDetails, "guia")) {
      next.guia = "";
    } else {
      delete next.guia;
    }
  }

  return next;
}

export function emptyApplicationSite(): RegenApplicationSite {
  return emptySite();
}
