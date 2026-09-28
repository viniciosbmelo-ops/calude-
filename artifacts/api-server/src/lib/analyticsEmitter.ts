/**
 * Server-side analytics event emitter.
 * Emits canonical events (login, register, checkout_started) where server is
 * the authoritative source, preventing spoofing from the client.
 *
 * Privacy: no PII, no patient data. Events only carry doctorId and eventName.
 */
import { db, analyticsEventsTable, analyticsSessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Accepts the opaque analytics session header only when it references a session
 * previously created by the telemetry endpoint. This prevents callers from
 * attaching canonical server events to arbitrary identifiers.
 */
export async function resolveAnalyticsSessionId(raw: unknown): Promise<string | null> {
  if (typeof raw !== "string" || !UUID_PATTERN.test(raw)) return null;
  try {
    const [session] = await db
      .select({ id: analyticsSessionsTable.id })
      .from(analyticsSessionsTable)
      .where(eq(analyticsSessionsTable.sessionId, raw))
      .limit(1);
    return session ? raw : null;
  } catch {
    return null;
  }
}

/** Upgrades an anonymous session after successful authentication. */
export async function attachAnalyticsActor(sessionId: string | null, doctorId: number): Promise<void> {
  if (!sessionId) return;
  try {
    await db
      .update(analyticsSessionsTable)
      .set({ doctorId, actorType: "authenticated", lastHeartbeatAt: new Date() })
      .where(eq(analyticsSessionsTable.sessionId, sessionId));
  } catch (err) {
    logger.warn({ err }, "Failed to attach analytics actor");
  }
}

export async function emitAnalyticsEvent(
  eventName: string,
  doctorId: number | null,
  sessionId: string | null,
  metadata?: {
    pagePath?: string | null;
    featureName?: string | null;
  },
): Promise<void> {
  if (!sessionId && !doctorId) return;
  try {
    await db.insert(analyticsEventsTable).values({
      sessionId: sessionId ?? `server-${doctorId ?? 0}`,
      doctorId: doctorId ?? null,
      eventName,
      pagePath: metadata?.pagePath ?? null,
      featureName: metadata?.featureName ?? null,
    });
  } catch (err) {
    // Fire-and-forget — never let analytics failures affect request handling
    logger.warn({ err, eventName }, "Failed to emit analytics event");
  }
}
