/**
 * Tests for Stripe webhook deduplication and signature-first processing.
 *
 * Key invariants tested:
 *   1. Signature verification (processWebhook) runs BEFORE any DB write.
 *   2. invoice.upcoming is skipped AFTER signature verification (23502 on invoices).
 *   3. Duplicate events (23505) are silently acknowledged.
 *   4. Physio billing is inside the same transaction — failure causes rollback.
 *   5. Bad signature propagates as an error (Stripe retries).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Mocks — vi.mock factories must NOT reference outer-scope variables.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("./stripeClient", () => ({
  getStripeSync: vi.fn(),
}));

const mockClientQuery = vi.fn();
const mockClientRelease = vi.fn();
const mockPoolConnect = vi.fn();

vi.mock("@workspace/db", () => ({
  pool: {
    connect: (...args: unknown[]) => mockPoolConnect(...args),
    query: vi.fn(),
  },
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    }),
  },
  physiotherapistsTable: {} as never,
  stripeWebhookEventsTable: {} as never,
}));

vi.mock("./physioBilling", () => ({
  mapStripeStatus: vi.fn().mockReturnValue(null),
}));

vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Imports
// ─────────────────────────────────────────────────────────────────────────────

import { processStripeWebhook } from "./webhookHandlers";
import { getStripeSync } from "./stripeClient";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makePayload(event: Record<string, unknown>): Buffer {
  return Buffer.from(JSON.stringify(event));
}

/** Sets up mockPoolConnect to return a pg client with sequential responses. */
function setupClient(queryResponses: (object | Error)[]) {
  let idx = 0;
  mockClientQuery.mockImplementation(() => {
    const resp = queryResponses[idx++];
    if (resp instanceof Error) return Promise.reject(resp);
    return Promise.resolve(resp ?? {});
  });
  mockPoolConnect.mockResolvedValue({ query: mockClientQuery, release: mockClientRelease });
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("processStripeWebhook — signature-first + deduplication", () => {
  const mockProcessWebhook = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.mocked(getStripeSync).mockResolvedValue({
      processWebhook: mockProcessWebhook,
    } as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Basic guards ─────────────────────────────────────────────────────────

  it("throws if payload is not a Buffer", async () => {
    await expect(
      processStripeWebhook("not a buffer" as unknown as Buffer, "sig"),
    ).rejects.toThrow("Payload must be a Buffer");
  });

  it("calls processWebhook (signature verification) BEFORE any DB pool.connect", async () => {
    // processWebhook throws immediately — DB must not have been touched.
    mockProcessWebhook.mockRejectedValueOnce(new Error("bad signature"));

    const payload = makePayload({
      id: "evt_early_001",
      type: "customer.subscription.updated",
      data: { object: {} },
    });

    await expect(processStripeWebhook(payload, "badsig")).rejects.toThrow("bad signature");

    // pool.connect must NOT have been called before signature verification.
    expect(mockPoolConnect).not.toHaveBeenCalled();
  });

  // ── invoice.upcoming (null id) ─────────────────────────────────────────

  it("skips invoice.upcoming AFTER signature verification (23502 on invoices)", async () => {
    // stripe-replit-sync throws 23502 on invoices when trying to insert null id
    const notNullErr = Object.assign(
      new Error("null value in column id of relation invoices violates not-null constraint"),
      { code: "23502", table: "invoices" },
    );
    mockProcessWebhook.mockRejectedValueOnce(notNullErr);

    const payload = makePayload({
      id: null,
      type: "invoice.upcoming",
      data: { object: {} },
    });

    // Must not throw — return silently.
    await expect(processStripeWebhook(payload, "valid-sig")).resolves.toBeUndefined();

    // processWebhook WAS called (signature checked first)
    expect(mockProcessWebhook).toHaveBeenCalledTimes(1);

    // No DB pool connection for dedup after the skip
    expect(mockPoolConnect).not.toHaveBeenCalled();
  });

  it("propagates non-invoice.upcoming 23502 errors (not silenced)", async () => {
    const otherNotNull = Object.assign(
      new Error("null value in column x"),
      { code: "23502", table: "other_table" },
    );
    mockProcessWebhook.mockRejectedValueOnce(otherNotNull);

    const payload = makePayload({
      id: "evt_other_001",
      type: "customer.subscription.updated",
      data: { object: {} },
    });

    await expect(processStripeWebhook(payload, "sig")).rejects.toThrow("null value in column x");
  });

  // ── Event with no id (post-verification) ─────────────────────────────────

  it("skips events with no id after verification (returns silently)", async () => {
    // processWebhook succeeds, but the event has no id (edge case)
    mockProcessWebhook.mockResolvedValueOnce(undefined);

    const payload = makePayload({
      // no id field
      type: "customer.subscription.created",
      data: { object: {} },
    });

    await processStripeWebhook(payload, "sig");

    expect(mockProcessWebhook).toHaveBeenCalledTimes(1);
    expect(mockPoolConnect).not.toHaveBeenCalled();
  });

  // ── First delivery ────────────────────────────────────────────────────────

  it("verifies signature THEN inserts event id THEN commits on first delivery", async () => {
    setupClient([
      {},  // BEGIN
      {},  // INSERT stripe_webhook_events
      {},  // COMMIT
    ]);

    const payload = makePayload({
      id: "evt_first_001",
      type: "customer.subscription.updated",
      data: { object: { status: "active", metadata: {} } },
    });

    await processStripeWebhook(payload, "sig");

    // processWebhook must be called before pool.connect
    expect(mockProcessWebhook).toHaveBeenCalledTimes(1);
    expect(mockPoolConnect).toHaveBeenCalledTimes(1);

    // BEGIN
    expect(mockClientQuery.mock.calls[0]![0]).toBe("BEGIN");

    // INSERT with the correct event id
    const insertCall = mockClientQuery.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("INSERT INTO stripe_webhook_events"),
    );
    expect(insertCall).toBeDefined();
    expect(insertCall![1]).toContain("evt_first_001");

    // COMMIT
    expect(mockClientQuery.mock.calls.at(-1)![0]).toBe("COMMIT");

    // Client always released
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  // ── Duplicate event ───────────────────────────────────────────────────────

  it("silently skips duplicate event (23505) — signature still verified first", async () => {
    const dupError = Object.assign(new Error("unique violation"), { code: "23505" });

    setupClient([
      {},       // BEGIN
      dupError, // INSERT → duplicate
      {},       // ROLLBACK
    ]);

    const payload = makePayload({
      id: "evt_dup_001",
      type: "customer.subscription.updated",
      data: { object: {} },
    });

    await expect(processStripeWebhook(payload, "sig")).resolves.toBeUndefined();

    // processWebhook was called (signature verified)
    expect(mockProcessWebhook).toHaveBeenCalledTimes(1);

    // ROLLBACK was issued
    const rollback = mockClientQuery.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0] === "ROLLBACK",
    );
    expect(rollback).toBeDefined();

    // Client released
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  // ── Non-duplicate DB error ────────────────────────────────────────────────

  it("re-throws non-duplicate DB errors and releases client", async () => {
    const dbError = Object.assign(new Error("connection lost"), { code: "08006" });

    setupClient([
      {},      // BEGIN
      dbError, // INSERT → fatal
      {},      // ROLLBACK
    ]);

    const payload = makePayload({
      id: "evt_dberr_001",
      type: "customer.subscription.updated",
      data: { object: {} },
    });

    await expect(processStripeWebhook(payload, "sig")).rejects.toThrow("connection lost");
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  // ── Physio billing in same transaction ────────────────────────────────────

  it("physio billing failure causes ROLLBACK (dedup INSERT rolled back for retry)", async () => {
    // physio billing is done via client.query inside the transaction.
    // We simulate it failing by making the UPDATE call throw.
    const billingErr = new Error("physio UPDATE failed");

    setupClient([
      {},          // BEGIN
      {},          // INSERT stripe_webhook_events (success)
      billingErr,  // physio billing UPDATE (via client.query) → fail
      {},          // ROLLBACK
    ]);

    const payload = makePayload({
      id: "evt_physio_fail_001",
      type: "invoice.payment_failed",
      data: {
        object: {
          metadata: { physio_id: "42" },
        },
      },
    });

    // Should propagate the billing error
    await expect(processStripeWebhook(payload, "sig")).rejects.toThrow("physio UPDATE failed");

    // ROLLBACK must have been issued
    const rollback = mockClientQuery.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0] === "ROLLBACK",
    );
    expect(rollback).toBeDefined();

    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  it("records a canonical subscription activation when Stripe transitions a doctor to active", async () => {
    setupClient([
      {},                 // BEGIN
      {},                 // INSERT stripe_webhook_events
      { rows: [] },       // no matching physiotherapist
      { rows: [{ id: 7 }] }, // matching doctor
      {},                 // INSERT analytics_events
      {},                 // COMMIT
    ]);

    const payload = makePayload({
      id: "evt_subscription_active_001",
      type: "customer.subscription.updated",
      data: {
        object: { status: "active", customer: "cus_doctor_001", metadata: {} },
        previous_attributes: { status: "trialing" },
      },
    });

    await processStripeWebhook(payload, "sig");

    const activationInsert = mockClientQuery.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("INSERT INTO analytics_events"),
    );
    expect(activationInsert).toBeDefined();
    expect(activationInsert![1]).toEqual(["stripe:evt_subscription_active_001", 7]);
    expect(mockClientQuery.mock.calls.at(-1)![0]).toBe("COMMIT");
  });

  it("creates a privacy-safe admin alert for an authenticated failed payment event", async () => {
    setupClient([
      {}, // BEGIN
      {}, // INSERT stripe_webhook_events
      {}, // INSERT admin_alerts
      {}, // COMMIT
    ]);

    const payload = makePayload({
      id: "evt_payment_failed_001",
      type: "invoice.payment_failed",
      data: { object: {} },
    });

    await processStripeWebhook(payload, "sig");

    const alertInsert = mockClientQuery.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("INSERT INTO admin_alerts"),
    );
    expect(alertInsert).toBeDefined();
    expect(String(alertInsert![0])).not.toContain("customer");
    expect(mockClientQuery.mock.calls.at(-1)![0]).toBe("COMMIT");
  });
});
