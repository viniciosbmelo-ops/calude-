import { pool } from "@workspace/docregen-db";
import { getStripeSync } from "./stripeClient";
import { logger } from "./logger";

/** Minimal pg PoolClient interface — avoids importing pg directly. */
interface PgClient {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  release(): void;
}

/**
 * Processes a raw Stripe webhook payload. The payload MUST be the raw Buffer —
 * the webhook route is registered before express.json() so the body is not parsed.
 *
 * Order of operations (non-negotiable):
 *   1. Signature verification via stripe-replit-sync.processWebhook()  ← FIRST.
 *      We never trust type/id from the raw JSON before authentication.
 *      processWebhook() throws on invalid signature; we propagate that throw.
 *   2. Parse the authenticated event to extract id and type.
 *   3. Handle invoice.upcoming (id=null) AFTER authentication:
 *      stripe-replit-sync may throw a NOT NULL constraint error when it tries
 *      to insert the null-id invoice; we catch that specific error (code 23502
 *      on table invoices) and ignore it — it is expected and safe to skip.
 *      All other errors from processWebhook are re-thrown for retry.
 *   4. Idempotency: INSERT event.id into stripe_webhook_events (unique).
 *      Duplicate delivery → 23505 → skip internal effects, return success.
 *   5. Internal effects (subscription analytics) run inside the SAME
 *      transaction as the dedup INSERT so a failure there rolls back the dedup
 *      record and the event can be retried (no silent best-effort swallow).
 *   6. COMMIT.
 */
export async function processStripeWebhook(payload: Buffer, signature: string): Promise<void> {
  if (!Buffer.isBuffer(payload)) {
    throw new Error(
      "STRIPE WEBHOOK ERROR: Payload must be a Buffer. " +
        "Ensure the webhook route is registered BEFORE app.use(express.json()).",
    );
  }

  // ── 1. Signature verification ─────────────────────────────────────────────
  // processWebhook() verifies the HMAC signature and throws on mismatch.
  // It also writes the event into the local stripe.* schema tables.
  // invoice.upcoming events have id=null; stripe-replit-sync throws a NOT NULL
  // constraint violation (code 23502, table "invoices") when it tries to insert
  // them.  We detect ONLY that specific error after verification and skip it.
  const sync = await getStripeSync();
  try {
    await sync.processWebhook(payload, signature);
  } catch (syncErr: unknown) {
    const pg = syncErr as { code?: string; table?: string };
    if (pg?.code === "23502" && pg?.table === "invoices") {
      // invoice.upcoming — null event id, cannot be stored.  Authenticated but
      // ignorable; return 200 so Stripe does not retry.
      logger.info("stripe webhook: invoice.upcoming (null id) — skipping after signature verification");
      return;
    }
    // All other errors (bad signature, DB issues, etc.) propagate for retry.
    throw syncErr;
  }

  // ── 2. Parse authenticated payload ────────────────────────────────────────
  // Safe to parse now — signature verified above.
  let event: StripeEventLike;
  try {
    event = JSON.parse(payload.toString("utf8")) as StripeEventLike;
  } catch {
    // processWebhook already validated the payload; this path is unreachable
    // in practice but we guard defensively.
    throw new Error("STRIPE WEBHOOK ERROR: payload is not valid JSON (post-verification)");
  }

  const eventId = event.id;
  if (!eventId) {
    // Non-invoice.upcoming event with no id (shouldn't happen after Stripe auth).
    logger.warn({ type: event.type }, "stripe webhook: event has no id after verification — skipping");
    return;
  }

  // ── 3. Idempotency + internal effects in one transaction ──────────────────
  // The dedup INSERT and the internal effects are committed together. If an
  // effect fails the dedup INSERT is rolled back → Stripe retries the event.
  const client = await pool.connect() as unknown as PgClient;
  try {
    await client.query("BEGIN");

    // Try to claim the event.
    try {
      await client.query(
        `INSERT INTO stripe_webhook_events (stripe_event_id, event_type) VALUES ($1, $2)`,
        [eventId, event.type ?? ""],
      );
    } catch (dupErr: unknown) {
      await client.query("ROLLBACK");
      const pg = dupErr as { code?: string };
      if (pg?.code === "23505") {
        logger.info(
          { eventId, type: event.type },
          "stripe webhook: duplicate event — already processed, skipping",
        );
        return;
      }
      throw dupErr;
    }

    // Apply all internal effects inside the same transaction. If any effect
    // fails, the dedup claim rolls back and Stripe can safely retry the event.
    await applyCanonicalAdminEvents(event, client);

    await client.query("COMMIT");
  } catch (txErr) {
    try { await client.query("ROLLBACK"); } catch { /* ignore */ }
    throw txErr;
  } finally {
    client.release();
  }
}

interface StripeEventLike {
  id?: string;
  type?: string;
  data?: {
    object?: Record<string, unknown>;
    previous_attributes?: Record<string, unknown>;
  };
}

async function findDoctorId(
  obj: Record<string, unknown>,
  client: PgClient,
): Promise<number | null> {
  const metadata = (obj["metadata"] ?? {}) as Record<string, unknown>;
  const fromMetadata = Number(metadata["doctor_id"] ?? metadata["doctorId"]);
  if (Number.isInteger(fromMetadata) && fromMetadata > 0) return fromMetadata;

  const customer = typeof obj["customer"] === "string" ? obj["customer"] : null;
  if (!customer) return null;

  const result = await client.query(
    `SELECT id FROM doctors WHERE stripe_customer_id = $1 LIMIT 1`,
    [customer],
  );
  const id = Number(result.rows[0]?.["id"]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Writes only canonical, non-clinical operational facts derived from an
 * authenticated Stripe event. These writes share the webhook dedup transaction.
 */
async function applyCanonicalAdminEvents(
  event: StripeEventLike,
  client: PgClient,
): Promise<void> {
  const type = event.type ?? "";
  const obj = event.data?.object;
  if (!obj) return;

  if (type === "invoice.payment_failed") {
    // DocRegen has no admin console; surface the failure in the logs.
    logger.warn({ eventId: event.id }, "stripe webhook: recurring payment failed — check the Stripe dashboard");
    return;
  }

  const isSubscriptionEvent =
    type === "customer.subscription.created" ||
    type === "customer.subscription.updated";
  if (!isSubscriptionEvent || obj["status"] !== "active") return;

  const previousStatus = event.data?.previous_attributes?.["status"];
  const becameActive =
    type === "customer.subscription.created" ||
    (type === "customer.subscription.updated" &&
      typeof previousStatus === "string" &&
      previousStatus !== "active");
  if (!becameActive) return;

  const doctorId = await findDoctorId(obj, client);
  if (doctorId == null) return;

  await client.query(
    `INSERT INTO analytics_events
       (session_id, doctor_id, event_name, page_path, feature_name)
     VALUES ($1, $2, 'subscription_activated', NULL, 'checkout')`,
    [`stripe:${event.id ?? "unknown"}`, doctorId],
  );
}
