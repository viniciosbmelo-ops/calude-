import type { Request } from "express";

/**
 * Returns the canonical base URL for generating patient-facing links.
 *
 * Priority:
 * 1. APP_URL env var (manually pinned URL, e.g. custom domain)
 * 2. First entry in REPLIT_DOMAINS (automatically the correct domain for both
 *    dev preview and production deployment)
 * 3. Reconstructed from the incoming request headers
 */
export function getBaseUrl(req?: Request): string {
  if (process.env["APP_URL"]) {
    return process.env["APP_URL"].replace(/\/$/, "");
  }

  const replitDomain = process.env["REPLIT_DOMAINS"]?.split(",")[0]?.trim();
  if (replitDomain) {
    return `https://${replitDomain}`;
  }

  if (req) {
    const proto = req.headers["x-forwarded-proto"] ?? req.protocol;
    const host = req.headers["host"] ?? req.get("host");
    return `${proto}://${host}`;
  }

  return "https://localhost";
}

/**
 * Returns the base URL to use for Stripe Checkout success/cancel redirects.
 *
 * Unlike patient-facing links (which must always use the pinned production
 * domain via APP_URL), checkout redirects should return the user to the exact
 * origin where they started — so registering on a dev/preview deploy returns to
 * that deploy, and registering on production returns to production.
 *
 * The request Origin is validated against an allowlist (REPLIT_DOMAINS + the
 * APP_URL host) to prevent an attacker-supplied Origin header from turning the
 * post-checkout redirect into an open redirect. Anything not on the allowlist
 * falls back to the canonical base URL.
 */
export function getCheckoutRedirectBase(req: Request): string {
  const origin = req.headers["origin"];
  if (typeof origin === "string" && origin) {
    try {
      const url = new URL(origin);
      const allowedHosts = new Set<string>();
      for (const d of (process.env["REPLIT_DOMAINS"] ?? "").split(",")) {
        const h = d.trim();
        if (h) allowedHosts.add(h);
      }
      const appUrl = process.env["APP_URL"];
      if (appUrl) {
        try {
          allowedHosts.add(new URL(appUrl).host);
        } catch {
          // ignore malformed APP_URL
        }
      }
      if ((url.protocol === "https:" || url.protocol === "http:") && allowedHosts.has(url.host)) {
        return `${url.protocol}//${url.host}`;
      }
    } catch {
      // malformed Origin — fall through to canonical base
    }
  }
  return getBaseUrl(req);
}
