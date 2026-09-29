/**
 * Product analytics client — privacy-safe, append-only telemetry.
 *
 * Privacy guarantees (mirrors backend):
 *   - Session ID: opaque UUID stored in sessionStorage only, never tied to patient data.
 *   - Paths: only allowlisted route templates, never raw dynamic identifiers.
 *   - UTMs: only utm_source / utm_medium / utm_campaign from the FIRST landing URL.
 *   - NEVER sent: patient IDs/names, query params, form values, error messages/stacks,
 *     raw URLs, IPs, or user-agents.
 *   - Fails silently — telemetry never disrupts the application.
 */

const SESSION_STORAGE_KEY = "dr_analytics_sid";
const API_BASE = "/regen-api/analytics";

const ALLOWED_UTM_PARAMS = ["utm_source", "utm_medium", "utm_campaign"] as const;
type UtmParam = (typeof ALLOWED_UTM_PARAMS)[number];

// ── Session ID ────────────────────────────────────────────────────────────────

/** Returns the opaque session UUID, creating and persisting it if needed. */
export function getOrCreateSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem(SESSION_STORAGE_KEY, id);
    return id;
  } catch {
    // sessionStorage unavailable (private browsing edge case)
    return crypto.randomUUID();
  }
}

/** Header used to correlate canonical server events with this opaque session. */
export function getAnalyticsSessionHeaders(): Record<string, string> {
  return { "X-Analytics-Session-Id": getOrCreateSessionId() };
}

// ── Path sanitisation ─────────────────────────────────────────────────────────

/**
 * Maps the current location to an allowlisted route template.
 * Dynamic IDs and public tokens are replaced before they leave the browser.
 * Unknown routes collapse to /other so a future slug cannot leak user data.
 */
export function sanitisePath(raw?: string): string {
  const src = raw ?? window.location.pathname;
  const path = src.split("?")[0]!.split("#")[0]!.slice(0, 200);
  if (SAFE_STATIC_PATHS.has(path)) return path;

  for (const [pattern, template] of SAFE_DYNAMIC_PATHS) {
    if (pattern.test(path)) return template;
  }

  return path ? "/other" : "";
}

const SAFE_STATIC_PATHS = new Set([
  "/", "/admin", "/agenda", "/agenda-cirurgica", "/assinatura-cancelada",
  "/dashboard", "/fisio", "/fisio/agenda", "/fisio/dashboard", "/fisio/login",
  "/fisio/pacientes", "/fisio/pacientes/novo", "/fisio/planos", "/followup",
  "/followup-central", "/forgot-password", "/login", "/orientacoes-paciente",
  "/patients", "/patients/new", "/pending-approval", "/profile", "/redefinir-senha",
  "/regen", "/regen/caso/novo", "/regen/consentimento", "/regen/orientacoes",
  "/regen/pesquisa", "/register", "/reports", "/secretary/dashboard",
  "/secretary/login", "/service/dashboard", "/service/login", "/sucesso",
  "/surgeries", "/surgeries/new", "/whatsapp-broadcast",
]);

const SAFE_DYNAMIC_PATHS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^\/pre-consulta\/[^/]+$/, "/pre-consulta/:token"],
  [/^\/admin\/doctors\/[^/]+$/, "/admin/doctors/:id"],
  [/^\/fisio\/convite\/[^/]+$/, "/fisio/convite/:token"],
  [/^\/fisio\/pacientes\/[^/]+$/, "/fisio/pacientes/:id"],
  [/^\/patient\/regen\/[^/]+$/, "/patient/regen/:token"],
  [/^\/patient\/[^/]+$/, "/patient/:token"],
  [/^\/patients\/[^/]+$/, "/patients/:id"],
  [/^\/regen\/caso\/[^/]+$/, "/regen/caso/:id"],
  [/^\/surgeries\/[^/]+$/, "/surgeries/:id"],
];

// ── UTM extraction ────────────────────────────────────────────────────────────

/**
 * Extracts utm_source / utm_medium / utm_campaign from a URL string.
 * Only reads the allowlisted UTM params; ignores everything else.
 * Safe to call with any string — returns an empty object on failure.
 */
export function extractUtms(href: string): Partial<Record<UtmParam, string>> {
  try {
    const url = new URL(href);
    const result: Partial<Record<UtmParam, string>> = {};
    for (const key of ALLOWED_UTM_PARAMS) {
      const val = url.searchParams.get(key);
      if (val && /^[A-Za-z0-9._-]+$/.test(val)) result[key] = val.slice(0, 100);
    }
    return result;
  } catch {
    return {};
  }
}

// ── Error category sanitisation ───────────────────────────────────────────────

type ErrorCategory =
  | "TypeError"
  | "ReferenceError"
  | "SyntaxError"
  | "NetworkError"
  | "ChunkLoadError"
  | "UnhandledRejection"
  | "Unknown";

const KNOWN_ERROR_TYPES = new Set<ErrorCategory>([
  "TypeError",
  "ReferenceError",
  "SyntaxError",
  "NetworkError",
  "ChunkLoadError",
  "UnhandledRejection",
]);

/**
 * Returns a privacy-safe error category from an Error object.
 * NEVER includes: message text, stack traces, or any runtime values.
 */
export function categoriseError(err: unknown): ErrorCategory {
  if (err instanceof TypeError) return "TypeError";
  if (err instanceof ReferenceError) return "ReferenceError";
  if (err instanceof SyntaxError) return "SyntaxError";
  if (
    err instanceof Error &&
    (err.name === "ChunkLoadError" || err.message.startsWith("Failed to fetch dynamically imported"))
  ) {
    return "ChunkLoadError";
  }
  if (err instanceof Error && err.name === "NetworkError") return "NetworkError";
  return "Unknown";
}

/**
 * Validates that a category string is in the allowed set.
 * Used to sanitize externally-supplied strings.
 */
export function sanitiseErrorCategory(raw: string): ErrorCategory {
  if (KNOWN_ERROR_TYPES.has(raw as ErrorCategory)) return raw as ErrorCategory;
  return "Unknown";
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

/** Sends a POST request. Uses keepalive for reliability. Fails silently. */
function post(path: string, body: object): void {
  try {
    fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // ignore
  }
}

/**
 * Sends a POST using navigator.sendBeacon (fire-and-forget, survives page unload).
 * Falls back to fetch if sendBeacon is unavailable.
 */
function beacon(path: string, body: object): void {
  try {
    const blob = new Blob([JSON.stringify(body)], { type: "application/json" });
    const sent = navigator.sendBeacon?.(`${API_BASE}${path}`, blob);
    if (!sent) {
      // sendBeacon returned false (queue full) — fall back to fetch
      post(path, body);
    }
  } catch {
    post(path, body);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function sessionStart(
  sessionId: string,
  utms: Partial<Record<UtmParam, string>>,
): void {
  post("/session/start", {
    sessionId,
    ...(utms.utm_source ? { utmSource: utms.utm_source } : {}),
    ...(utms.utm_medium ? { utmMedium: utms.utm_medium } : {}),
    ...(utms.utm_campaign ? { utmCampaign: utms.utm_campaign } : {}),
  });
}

export function sessionHeartbeat(sessionId: string): void {
  post("/session/heartbeat", { sessionId });
}

export function sessionEnd(sessionId: string): void {
  beacon("/session/end", { sessionId });
}

export function recordPageView(sessionId: string, pagePath: string): void {
  post("/event", {
    sessionId,
    eventName: "page_view",
    pagePath,
  });
}

/**
 * Records an intentional click on an in-app navigation link or explicitly
 * marked navigation button.
 *
 * The destination is sanitised at the last client boundary as well as when
 * the click is discovered. This keeps a future caller from accidentally
 * sending an identifier or user-provided route segment.
 */
export function recordNavigationClick(sessionId: string, destinationPath: string): void {
  const pagePath = sanitisePath(destinationPath);
  const featureName = pagePath ? navigationFeatureFromPath(pagePath) : null;
  if (!pagePath || !featureName) return;
  post("/event", {
    sessionId,
    eventName: "navigation_click",
    pagePath,
    featureName,
  });
}

export type NavigationFeatureName =
  | "surgery"
  | "followup"
  | "patient"
  | "report"
  | "pdf"
  | "exam"
  | "checkout"
  | "support"
  | "regen"
  | "physio"
  | "agenda"
  | "dashboard"
  | "patients"
  | "surgeries"
  | "profile"
  | "settings"
  | "subscription";

const NAVIGATION_FEATURE_BY_PATH: Readonly<Record<string, NavigationFeatureName>> = {
  "/agenda": "agenda",
  "/agenda-cirurgica": "agenda",
  "/dashboard": "dashboard",
  "/followup": "followup",
  "/followup-central": "followup",
  "/patients": "patients",
  "/patients/new": "patient",
  "/patients/:id": "patient",
  "/profile": "profile",
  "/regen": "regen",
  "/regen/caso/novo": "regen",
  "/regen/caso/:id": "regen",
  "/regen/consentimento": "regen",
  "/regen/orientacoes": "regen",
  "/regen/pesquisa": "regen",
  "/reports": "report",
  "/surgeries": "surgeries",
  "/surgeries/new": "surgery",
  "/surgeries/:id": "surgery",
  "/whatsapp-broadcast": "support",
};

/** Derives the backend-allowlisted feature from an already sanitized route. */
export function navigationFeatureFromPath(destinationPath: string): NavigationFeatureName | null {
  return NAVIGATION_FEATURE_BY_PATH[sanitisePath(destinationPath)] ?? null;
}

interface NavigationTargetLike {
  getAttribute(name: string): string | null;
  hasAttribute?(name: string): boolean;
  closest?(selector: string): NavigationTargetLike | null;
}

type NavigationEventRoot = Pick<Document, "addEventListener" | "removeEventListener">;
const navigationListenerCleanups = new WeakMap<NavigationEventRoot, () => void>();

/**
 * Converts an anchor destination into an allowlisted in-app route.
 *
 * Only same-origin anchors are eligible. Query strings and fragments are
 * intentionally discarded by sanitisePath, and dynamic route segments become
 * their privacy-safe templates.
 */
export function navigationDestinationFromHref(
  href: string | null,
  currentHref = "http://localhost/",
): string | null {
  if (!href || href.startsWith("#")) return null;

  try {
    const destination = new URL(href, currentHref);
    const current = new URL(currentHref);
    if (destination.origin !== current.origin) return null;
    return sanitisePath(destination.pathname) || null;
  } catch {
    return null;
  }
}

/**
 * Installs one delegated click listener for in-app navigation links and
 * explicitly marked navigation buttons.
 *
 * Delegation covers desktop sidebar, mobile navigation, and links rendered by
 * page content without requiring each menu to add its own handler. Cleanup is
 * returned explicitly so auth changes and React StrictMode remounts cannot
 * leave duplicate listeners behind. Programmatic setLocation/page loads do
 * not dispatch an anchor click and therefore never reach this callback.
 */
export function attachNavigationClickListener(
  onNavigationClick: (destinationPath: string) => void,
  root: NavigationEventRoot = document,
): () => void {
  // Keep this delegated capture singleton even if a shell is accidentally
  // mounted twice during an auth transition.
  navigationListenerCleanups.get(root)?.();

  const handleClick = (event: Event) => {
    const target = event.target as NavigationTargetLike | null;
    const navigationTarget = target?.closest?.("a,button[data-analytics-destination]");
    if (!navigationTarget) return;
    const isAnchor = Boolean(navigationTarget.getAttribute("href"));
    if (isAnchor && navigationTarget.hasAttribute?.("download")) return;
    const destination = navigationDestinationFromHref(
      navigationTarget.getAttribute("href") ??
        navigationTarget.getAttribute("data-analytics-destination"),
      typeof window === "undefined" ? "http://localhost/" : window.location.href,
    );
    if (destination) onNavigationClick(destination);
  };

  root.addEventListener("click", handleClick);
  const cleanup = () => {
    root.removeEventListener("click", handleClick);
    if (navigationListenerCleanups.get(root) === cleanup) {
      navigationListenerCleanups.delete(root);
    }
  };
  navigationListenerCleanups.set(root, cleanup);
  return cleanup;
}

export function recordVital(
  sessionId: string,
  metricName: string,
  value: number,
  rating: "good" | "needs-improvement" | "poor" | undefined,
  pagePath: string,
): void {
  post("/vitals", {
    sessionId,
    metricName,
    value,
    ...(rating ? { rating } : {}),
    pagePath,
  });
}

export function recordClientError(
  sessionId: string,
  errorType: ErrorCategory,
  pagePath: string,
): void {
  post("/vitals", {
    sessionId,
    metricName: "client_error",
    errorType,
    pagePath,
  });
}
