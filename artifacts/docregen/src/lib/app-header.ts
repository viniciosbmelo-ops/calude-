/**
 * DocRegen shares its API server with DocKnee. Every same-origin `/api`
 * request is tagged with `X-App: docregen` so the server builds patient-facing
 * links (pre-consultation, regenerative follow-up, orientations, password
 * reset, checkout return) under `/docregen/` and uses DocRegen branding.
 * The server maps this value through a fixed allowlist; unknown values fall
 * back to DocKnee, so the header never becomes part of a URL.
 *
 * Installed once at startup; covers the generated API client and the raw
 * `fetch` calls alike. Requests to other origins (e.g. signed storage URLs)
 * are left untouched.
 */
export const APP_HEADER_NAME = "X-App";
export const APP_ID = "docregen";

type FetchFn = typeof fetch;

export function isSameOriginApiRequest(url: string, origin: string): boolean {
  try {
    const target = new URL(url, origin);
    return target.origin === origin && (target.pathname === "/api" || target.pathname.startsWith("/api/"));
  } catch {
    return false;
  }
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** Wraps `fetchImpl` so same-origin API calls carry the app header. */
export function withAppHeader(fetchImpl: FetchFn, origin: string): FetchFn {
  return (input, init) => {
    if (!isSameOriginApiRequest(requestUrl(input), origin)) return fetchImpl(input, init);
    const baseHeaders = init?.headers ?? (typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined);
    const headers = new Headers(baseHeaders);
    if (!headers.has(APP_HEADER_NAME)) headers.set(APP_HEADER_NAME, APP_ID);
    return fetchImpl(input, { ...init, headers });
  };
}

const INSTALLED = Symbol.for("docregen.appHeaderInstalled");

export function installAppHeader(target: typeof globalThis & { location?: Location } = globalThis): void {
  const marked = target as unknown as Record<symbol, boolean>;
  if (marked[INSTALLED] || typeof target.fetch !== "function" || !target.location) return;
  target.fetch = withAppHeader(target.fetch.bind(target), target.location.origin);
  marked[INSTALLED] = true;
}
