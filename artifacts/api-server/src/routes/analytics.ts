/**
 * Telemetry endpoints — append-only pseudonymous product analytics.
 *
 * Privacy guarantees:
 *   - Actor identity comes ONLY from validated auth session, never from request body.
 *   - No patient names, chart content, exam values, or clinical metadata.
 *   - No full URLs or query strings — path only, capped at 200 chars.
 *   - No raw IPs, no raw user-agents stored.
 *   - Anonymous sessions use an opaque client-side sessionId (UUID).
 *   - UTMs allowed on anonymous acquisition events only.
 *
 * Endpoints:
 *   POST /analytics/session/start    — start a 30-min session
 *   POST /analytics/session/heartbeat — extend session
 *   POST /analytics/session/end       — end session
 *   POST /analytics/event             — record an allowlisted event
 *   POST /analytics/vitals            — record Web Vitals / client errors
 */
import { Router, type IRouter, type Request } from "express";
import { z } from "zod";
import { db, analyticsSessionsTable, analyticsEventsTable, webVitalsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { getSessionCookie } from "../lib/session";
import { verifyToken } from "../lib/auth";
import { validateCurrentAccount } from "../lib/sessionAccountStore";

const router: IRouter = Router();

// ── Allowlists ──────────────────────────────────────────────────────────────

const ALLOWED_EVENTS = new Set([
  // Auth lifecycle (server-side also emits these)
  "login",
  "logout",
  "register",
  "password_reset",
  // Navigation
  "page_view",
  "navigation_click",
  // Core feature usage
  "surgery_created",
  "surgery_updated",
  "followup_created",
  "followup_updated",
  "patient_created",
  "report_viewed",
  "pdf_exported",
  "exam_completed",
  // Subscription
  "checkout_started",
  "subscription_activated",
  // Support
  "contact_submitted",
  // Acquisition
  "acquisition_visit",
]);

// xray_analyzed is intentionally server-only: the /xray/analyze handler emits
// it after a successful response (including a valid cache hit), so a client
// cannot manufacture RX usage from a failed request.

const ALLOWED_VITALS = new Set(["LCP", "FID", "CLS", "FCP", "TTFB", "INP", "client_error"]);
const ALLOWED_ERROR_TYPES = new Set([
  "TypeError", "ReferenceError", "SyntaxError", "NetworkError",
  "ChunkLoadError", "UnhandledRejection", "Unknown",
]);
const ALLOWED_FEATURES = new Set([
  "surgery", "followup", "patient", "report", "xray", "pdf", "exam",
  "checkout", "support", "regen", "physio", "agenda", "dashboard", "admin",
  "patients", "surgeries", "profile", "settings", "subscription",
]);

const ALLOWED_UTM_SOURCES = new Set([
  "google", "facebook", "instagram", "linkedin", "twitter", "x",
  "email", "organic", "direct", "referral", "newsletter", "unknown",
]);

const MAX_PATH_LEN = 200;
const MAX_SESSION_ID_LEN = 64;

// ── Auth resolution helper ────────────────────────────────────────────────────

/**
 * Extracts the doctorId from an auth session (cookie or Bearer token).
 * Returns null for unauthenticated requests — never reads from request body.
 */
async function resolveDoctorId(req: Request): Promise<number | null> {
  const token =
    getSessionCookie(req, "doctor") ??
    (() => {
      const h = req.headers.authorization;
      return h?.startsWith("Bearer ") ? h.slice(7) : null;
    })();
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload || payload.role !== "doctor") return null;
  const current = await validateCurrentAccount(payload);
  if (!current || current.role !== "doctor") return null;
  return current.doctorId;
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
  "/surgeries", "/surgeries/new", "/whatsapp-broadcast", "/xray-planning",
]);

const SAFE_DYNAMIC_PATHS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^\/admin\/doctors\/[^/]+$/, "/admin/doctors/:id"],
  [/^\/pre-consulta\/[^/]+$/, "/pre-consulta/:token"],
  [/^\/fisio\/convite\/[^/]+$/, "/fisio/convite/:token"],
  [/^\/fisio\/pacientes\/[^/]+$/, "/fisio/pacientes/:id"],
  [/^\/patient\/regen\/[^/]+$/, "/patient/regen/:token"],
  [/^\/patient\/[^/]+$/, "/patient/:token"],
  [/^\/patients\/[^/]+$/, "/patients/:id"],
  [/^\/regen\/caso\/[^/]+$/, "/regen/caso/:id"],
  [/^\/surgeries\/[^/]+$/, "/surgeries/:id"],
];

/** Maps paths to privacy-safe route templates; never stores raw IDs or tokens. */
export function sanitisePath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const path = raw.split("?")[0]!.split("#")[0]!.slice(0, MAX_PATH_LEN);
  if (!path) return null;
  if (SAFE_STATIC_PATHS.has(path)) return path;
  for (const [pattern, template] of SAFE_DYNAMIC_PATHS) {
    if (pattern.test(path)) return template;
  }
  return "/other";
}

const CANONICAL_NAVIGATION_FEATURE_BY_PATH: Readonly<Record<string, string>> = {
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
  "/xray-planning": "xray",
};

/** Derives the feature exclusively from the already-sanitized destination. */
export function canonicalNavigationFeature(sanitizedPath: string | null): string | null {
  if (!sanitizedPath || sanitizedPath === "/other") return null;
  return CANONICAL_NAVIGATION_FEATURE_BY_PATH[sanitizedPath] ?? null;
}

// ── Zod schemas ───────────────────────────────────────────────────────────────

const SessionStartSchema = z.object({
  sessionId: z.string().uuid().max(MAX_SESSION_ID_LEN),
  utmSource: z.string().max(50).optional(),
  utmMedium: z.string().max(50).regex(/^[A-Za-z0-9._-]+$/).optional(),
  utmCampaign: z.string().max(100).regex(/^[A-Za-z0-9._-]+$/).optional(),
});

const SessionHeartbeatSchema = z.object({
  sessionId: z.string().uuid().max(MAX_SESSION_ID_LEN),
});

const EventSchema = z.object({
  sessionId: z.string().uuid().max(MAX_SESSION_ID_LEN),
  eventName: z.string().max(60),
  pagePath: z.string().max(MAX_PATH_LEN).optional(),
  featureName: z.string().max(80).optional(),
});

const VitalSchema = z.object({
  sessionId: z.string().uuid().max(MAX_SESSION_ID_LEN),
  metricName: z.string().max(20),
  value: z.number().optional(),
  rating: z.enum(["good", "needs-improvement", "poor"]).optional(),
  errorType: z.string().max(100).optional(),
  pagePath: z.string().max(MAX_PATH_LEN).optional(),
});

// ── Endpoints ─────────────────────────────────────────────────────────────────

/**
 * POST /analytics/session/start
 * Starts a new analytics session. Accepts both anonymous and authenticated actors.
 */
router.post("/analytics/session/start", async (req, res): Promise<void> => {
  const parsed = SessionStartSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }

  const doctorId = await resolveDoctorId(req);
  const { sessionId, utmSource, utmMedium, utmCampaign } = parsed.data;

  // Validate UTM source against allowlist (only store known acquisition channels)
  const safeUtmSource = utmSource && ALLOWED_UTM_SOURCES.has(utmSource.toLowerCase())
    ? utmSource.toLowerCase()
    : utmSource ? "unknown" : null;

  await db.insert(analyticsSessionsTable).values({
    sessionId,
    doctorId: doctorId ?? null,
    actorType: doctorId ? "authenticated" : "anonymous",
    utmSource: safeUtmSource,
    utmMedium: utmMedium ?? null,
    utmCampaign: utmCampaign ?? null,
  }).onConflictDoUpdate({
    target: analyticsSessionsTable.sessionId,
    set: {
      ...(doctorId ? { doctorId, actorType: "authenticated" } : {}),
      lastHeartbeatAt: new Date(),
    },
  });

  if (safeUtmSource || utmCampaign) {
    await db.execute(sql`
      INSERT INTO analytics_events (session_id, doctor_id, event_name, page_path, feature_name)
      SELECT ${sessionId}, ${doctorId ?? null}, 'acquisition_visit', NULL, NULL
      WHERE NOT EXISTS (
        SELECT 1
        FROM analytics_events
        WHERE session_id = ${sessionId}
          AND event_name = 'acquisition_visit'
      )
    `);
  }

  res.status(204).end();
});

/**
 * POST /analytics/session/heartbeat
 * Extends the last-heartbeat timestamp of an active session.
 */
router.post("/analytics/session/heartbeat", async (req, res): Promise<void> => {
  const parsed = SessionHeartbeatSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload" });
    return;
  }

  const { sessionId } = parsed.data;
  const doctorId = await resolveDoctorId(req);

  await db
    .update(analyticsSessionsTable)
    .set({
      lastHeartbeatAt: new Date(),
      ...(doctorId ? { doctorId, actorType: "authenticated" } : {}),
    })
    .where(eq(analyticsSessionsTable.sessionId, sessionId));

  res.status(204).end();
});

/**
 * POST /analytics/session/end
 * Marks a session as ended.
 */
router.post("/analytics/session/end", async (req, res): Promise<void> => {
  const parsed = SessionHeartbeatSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload" });
    return;
  }

  const { sessionId } = parsed.data;
  const doctorId = await resolveDoctorId(req);

  await db
    .update(analyticsSessionsTable)
    .set({
      endedAt: new Date(),
      ...(doctorId ? { doctorId, actorType: "authenticated" } : {}),
    })
    .where(eq(analyticsSessionsTable.sessionId, sessionId));

  res.status(204).end();
});

/**
 * POST /analytics/event
 * Records an allowlisted product event.
 * Actor identity is resolved from auth session — never trusted from body.
 */
router.post("/analytics/event", async (req, res): Promise<void> => {
  const parsed = EventSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }

  const { sessionId, eventName } = parsed.data;

  if (!ALLOWED_EVENTS.has(eventName)) {
    // Silently ignore unknown events rather than erroring (tolerant intake)
    res.status(204).end();
    return;
  }

  const doctorId = await resolveDoctorId(req);
  const pagePath = sanitisePath(parsed.data.pagePath);
  const submittedFeatureName = parsed.data.featureName && ALLOWED_FEATURES.has(parsed.data.featureName)
    ? parsed.data.featureName
    : null;
  const featureName = eventName === "navigation_click"
    ? canonicalNavigationFeature(pagePath)
    : submittedFeatureName;

  // Navigation clicks are a separate semantic event. Only retain a click when
  // both sides of its destination/feature contract are allowlisted. In
  // particular, do not turn an unknown path into a ranked "/other" click.
  // `page_view` remains independent and is never reclassified as a click.
  if (eventName === "navigation_click" && (
    pagePath === null ||
    pagePath === "/other" ||
    featureName === null
  )) {
    res.status(204).end();
    return;
  }

  await db.insert(analyticsEventsTable).values({
    sessionId,
    doctorId: doctorId ?? null,
    eventName,
    pagePath,
    featureName,
  });

  res.status(204).end();
});

/**
 * POST /analytics/vitals
 * Records Web Vitals metrics or client-side error type reports.
 * No user-agent, no message content.
 */
router.post("/analytics/vitals", async (req, res): Promise<void> => {
  const parsed = VitalSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }

  const { sessionId, metricName, value, rating, errorType } = parsed.data;

  if (!ALLOWED_VITALS.has(metricName)) {
    res.status(204).end();
    return;
  }

  const doctorId = await resolveDoctorId(req);
  const pagePath = sanitisePath(parsed.data.pagePath);

  await db.insert(webVitalsTable).values({
    sessionId,
    doctorId: doctorId ?? null,
    metricName,
    value: value ?? null,
    rating: rating ?? null,
    errorType: metricName === "client_error"
      ? errorType && ALLOWED_ERROR_TYPES.has(errorType) ? errorType : "Unknown"
      : null,
    pagePath,
  });

  res.status(204).end();
});

export default router;
