/**
 * Patient/secretary-facing links built by the DocRegen API.
 *
 * DocRegen is an independent app: every link it generates always points to
 * the DocRegen frontend and carries DocRegen branding. There is no calling-app
 * flag — the DocRegen API never builds DocKnee links.
 *
 * The frontend is served under `/docregen` by default. When DocRegen moves to
 * its own domain root, set DOCREGEN_FRONTEND_BASE_PATH to an empty value.
 */
export const APP_BRAND_NAME = "DocRegen";
export const DEFAULT_FRONTEND_BASE_PATH = "/docregen";

const BASE_PATH_PATTERN = /^(?:\/[a-z0-9][a-z0-9-]*)*$/;

/** Resolves the frontend base path; rejects anything but a plain path. */
export function frontendBasePath(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env["DOCREGEN_FRONTEND_BASE_PATH"];
  if (raw === undefined) return DEFAULT_FRONTEND_BASE_PATH;
  const value = raw.trim().replace(/\/+$/, "");
  if (!BASE_PATH_PATTERN.test(value)) {
    throw new Error("DOCREGEN_FRONTEND_BASE_PATH must be empty or a plain path such as /docregen");
  }
  return value;
}

/**
 * Builds `${origin}${basePath}${path}`. `origin` is the trusted base URL the
 * caller already resolved (getBaseUrl / getCheckoutRedirectBase /
 * DOCREGEN_APP_URL); `path` is a server-controlled absolute path.
 */
export function buildAppLink(
  origin: string,
  path: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error("buildAppLink expects an absolute, same-origin path");
  }
  return `${origin}${frontendBasePath(env)}${path}`;
}
