/**
 * Analytics schema — append-only pseudonymous product analytics.
 *
 * Privacy contract:
 *   - No patient names, chart content, exam values, or clinical metadata.
 *   - No full URLs or query strings (path only, truncated to 200 chars).
 *   - No raw IPs — only hashed opaque session IDs or authenticated doctorId.
 *   - No raw user-agents.
 *   - Actor identity is resolved server-side from auth token, never from body.
 */
import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  index,
  uniqueIndex,
  real,
} from "drizzle-orm/pg-core";

// ─── Analytics sessions ───────────────────────────────────────────────────────

/**
 * analytics_sessions: one row per 30-minute activity window per actor.
 * Authenticated actors: identified by doctorId (no PII).
 * Anonymous actors: identified by an opaque client-generated sessionId (no IP, no UA).
 */
export const analyticsSessionsTable = pgTable(
  "analytics_sessions",
  {
    id: serial("id").primaryKey(),
    /** Opaque client-generated session UUID — never contains PII. */
    sessionId: text("session_id").notNull(),
    /** Set only for authenticated (logged-in) actors — linked to doctors.id. */
    doctorId: integer("doctor_id"),
    /** 'authenticated' | 'anonymous' */
    actorType: text("actor_type").notNull().default("anonymous"),
    /** UTM source (acquisition analytics only, anonymous sessions). */
    utmSource: text("utm_source"),
    /** UTM medium. */
    utmMedium: text("utm_medium"),
    /** UTM campaign. */
    utmCampaign: text("utm_campaign"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [
    index("analytics_sessions_doctor_id_idx").on(t.doctorId),
    index("analytics_sessions_started_at_idx").on(t.startedAt),
    uniqueIndex("analytics_sessions_session_id_uidx").on(t.sessionId),
    index("analytics_sessions_utm_campaign_idx").on(t.utmCampaign, t.startedAt),
  ],
);

export type AnalyticsSession = typeof analyticsSessionsTable.$inferSelect;

// ─── Analytics events ─────────────────────────────────────────────────────────

/**
 * analytics_events: append-only log of allowlisted product events.
 * event_name must be in the server-side allowlist.
 */
export const analyticsEventsTable = pgTable(
  "analytics_events",
  {
    id: serial("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    doctorId: integer("doctor_id"),
    /** Allowlisted event name — no free-form strings. */
    eventName: text("event_name").notNull(),
    /**
     * Short path string (max 200 chars) — no query strings.
     * Examples: "/dashboard", "/surgeries"
     */
    pagePath: text("page_path"),
    /**
     * Feature name for feature-usage events.
     * Must be in allowlist — no PII.
     */
    featureName: text("feature_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("analytics_events_session_id_idx").on(t.sessionId),
    index("analytics_events_doctor_id_idx").on(t.doctorId),
    index("analytics_events_created_at_idx").on(t.createdAt),
    index("analytics_events_name_idx").on(t.eventName),
  ],
);

export type AnalyticsEvent = typeof analyticsEventsTable.$inferSelect;

// ─── Web Vitals / Client errors ────────────────────────────────────────────────

/**
 * web_vitals: Core Web Vitals and client-side error reports.
 * No user-agent strings — only the metric type and value.
 */
export const webVitalsTable = pgTable(
  "web_vitals",
  {
    id: serial("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    doctorId: integer("doctor_id"),
    /**
     * Metric name: 'LCP' | 'FID' | 'CLS' | 'FCP' | 'TTFB' | 'INP'
     * or 'client_error' for JS error reports.
     */
    metricName: text("metric_name").notNull(),
    /** Numeric value (ms for timing metrics, unitless for CLS). */
    value: real("value"),
    /** Rating: 'good' | 'needs-improvement' | 'poor' — null for errors. */
    rating: text("rating"),
    /** Error type/class name for client_error events — no message content. */
    errorType: text("error_type"),
    /** Path where the event occurred — no query strings, max 200 chars. */
    pagePath: text("page_path"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("web_vitals_metric_name_idx").on(t.metricName),
    index("web_vitals_created_at_idx").on(t.createdAt),
  ],
);

export type WebVital = typeof webVitalsTable.$inferSelect;
