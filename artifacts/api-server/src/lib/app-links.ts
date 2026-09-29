import type { Request } from "express";

/**
 * Which frontend a request came from. Both frontends share this API server
 * and database:
 *   - "docknee"  — the original web app, served at the domain root.
 *   - "docregen" — the regenerative-medicine & pain app, served under /docregen.
 *
 * The frontend identifies itself with the `X-App` request header. The value is
 * only ever compared against a fixed allowlist and mapped to a hard-coded base
 * path, so client input never becomes part of a generated URL (no open
 * redirect / link injection). Anything missing or unknown resolves to
 * "docknee", which keeps the historical behaviour unchanged.
 */
export type ClientApp = "docknee" | "docregen";

export const CLIENT_APP_HEADER = "x-app";
export const DEFAULT_CLIENT_APP: ClientApp = "docknee";

const APP_BASE_PATHS: Readonly<Record<ClientApp, string>> = {
  docknee: "",
  docregen: "/docregen",
};

const APP_BRAND_NAMES: Readonly<Record<ClientApp, string>> = {
  docknee: "DocSholder",
  docregen: "DocRegen",
};

/**
 * Public pages each non-default app actually serves. A link to a page an app
 * does not have (e.g. the surgical follow-up questionnaire `/patient/:token`,
 * which only exists in DocKnee) keeps pointing at the root app, so it never
 * lands on a 404.
 */
const APP_PUBLIC_ROUTES: Readonly<Record<ClientApp, { exact: readonly string[]; prefixes: readonly string[] }>> = {
  docknee: { exact: [], prefixes: [] },
  docregen: {
    exact: [
      "/orientacoes-paciente",
      "/redefinir-senha",
      "/sucesso",
      "/assinatura-cancelada",
      "/secretary/login",
    ],
    prefixes: ["/pre-consulta/", "/patient/regen/"],
  },
};

function isClientApp(value: string): value is ClientApp {
  return Object.prototype.hasOwnProperty.call(APP_BASE_PATHS, value);
}

/** Resolves the calling app from the `X-App` header through the allowlist. */
export function resolveClientApp(req?: Pick<Request, "headers"> | null): ClientApp {
  const raw = req?.headers?.[CLIENT_APP_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return DEFAULT_CLIENT_APP;
  const normalized = value.trim().toLowerCase();
  return isClientApp(normalized) ? normalized : DEFAULT_CLIENT_APP;
}

export function appBrandName(app: ClientApp): string {
  return APP_BRAND_NAMES[app];
}

export function appBasePath(app: ClientApp): string {
  return APP_BASE_PATHS[app];
}

/** Whether `app` has its own page for `path` (query string ignored). */
export function appServesPath(app: ClientApp, path: string): boolean {
  const pathname = path.split(/[?#]/, 1)[0] ?? "";
  const routes = APP_PUBLIC_ROUTES[app];
  return routes.exact.includes(pathname) || routes.prefixes.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Builds a patient/secretary-facing link. `origin` is the trusted base URL the
 * caller already used (getBaseUrl / getCheckoutRedirectBase / APP_URL);
 * `path` is a server-controlled absolute path. For the default app — or for a
 * page the calling app does not serve — the result is exactly
 * `${origin}${path}`, i.e. the historical DocKnee link.
 */
export function buildAppLink(origin: string, path: string, app: ClientApp = DEFAULT_CLIENT_APP): string {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error("buildAppLink expects an absolute, same-origin path");
  }
  const prefix = app !== DEFAULT_CLIENT_APP && appServesPath(app, path) ? APP_BASE_PATHS[app] : "";
  return `${origin}${prefix}${path}`;
}

/** Convenience: resolve the app from the request and build the link. */
export function buildRequestAppLink(req: Pick<Request, "headers">, origin: string, path: string): string {
  return buildAppLink(origin, path, resolveClientApp(req));
}
