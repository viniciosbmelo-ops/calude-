/**
 * Tests for followup-cron: concurrent claim, retry/backoff, and token reuse.
 *
 * Pure unit tests — no real DB or HTTP.
 * All external dependencies (pool, db, sendWhatsAppText) are mocked via vi.mock.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

const mockPoolQuery = vi.fn();
const mockDbSelect = vi.fn();
const mockDbUpdate = vi.fn();
const mockDbInsert = vi.fn();
const mockDbExecute = vi.fn();

function makeSelectChain(result: unknown[]) {
  return {
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    for: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(result),
  };
}

function makeUpdateChain() {
  return { set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]) };
}

function makeUpdateCapture(updateSets: Record<string, unknown>[]) {
  return {
    set: vi.fn().mockImplementation((v: Record<string, unknown>) => {
      updateSets.push(v);
      return { where: vi.fn().mockResolvedValue([]) };
    }),
  };
}

function makeInsertChain(result: unknown[]) {
  return {
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(result),
  };
}

vi.mock("@workspace/db", () => {
  const transactionClient = {
    execute: (...args: unknown[]) => mockDbExecute(...args),
    select: (...args: unknown[]) => mockDbSelect(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
    insert: (...args: unknown[]) => mockDbInsert(...args),
  };
  return {
    pool: { connect: vi.fn(), query: (...args: unknown[]) => mockPoolQuery(...args) },
    db: {
      ...transactionClient,
      transaction: (callback: (tx: typeof transactionClient) => unknown) => callback(transactionClient),
    },
    scheduledNotificationsTable: { id: "id", status: "status", patientId: "patientId" } as never,
    followupTable: { id: "id", token: "token" } as never,
    patientsTable: { id: "id" } as never,
    surgeriesTable: { id: "id", doctorId: "doctor_id" } as never,
    doctorsTable: { id: "id" } as never,
    whatsappOutboxTable: { idempotencyKey: "idempotency_key" } as never,
  };
});

const mockSendWhatsAppText = vi.fn();
vi.mock("./whatsapp", () => ({
  sendWhatsAppText: (...args: unknown[]) => mockSendWhatsAppText(...args),
  buildFollowupMessage: vi.fn().mockReturnValue("message text"),
  sanitizeWhatsAppError: (error: unknown) => error instanceof Error ? error.message : String(error),
}));

vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

vi.mock("./base-url", () => ({
  getBaseUrl: vi.fn().mockReturnValue("https://example.com"),
}));

vi.mock("crypto", () => ({
  randomUUID: vi.fn().mockReturnValue("fixed-uuid-1234"),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Imports (after mocks)
// ─────────────────────────────────────────────────────────────────────────────

import { processDueNotifications, claimNextNotification } from "./followup-cron";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Build a db.select chain that returns a notif+patient row */
function makeNotifPatientRow(overrides: Record<string, unknown> = {}) {
  return {
    notif: {
      id: 1,
      surgeryId: 10,
      patientId: 20,
      periodo: "3m",
      scales: ["ikdc"],
      status: "processing",
      followupId: null,
      attempts: 1,
      ...overrides,
    },
    patient: {
      id: 20,
      nome: "João",
      telefone: "+5511999999999",
    },
    surgery: {
      id: 10,
      tiposProcedimento: ["SH_CUFF"],
    },
  };
}

/** Build a full row with doctor+surgery for processClaimedNotification */
function makeFullRow(overrides: Record<string, unknown> = {}) {
  return {
    notif: {
      id: 1,
      surgeryId: 10,
      patientId: 20,
      periodo: "3m",
      scales: ["ikdc"],
      status: "processing",
      followupId: null,
      attempts: 1,
      ...overrides,
    },
    patient: { id: 20, nome: "João", telefone: "+5511999999999" },
    surgery: { id: 10, doctorId: 5, tiposProcedimento: ["SH_CUFF"] },
    doctor: { id: 5, nome: "Dr. Silva" },
  };
}

/**
 * Sets up the mock sequence for a full processDueNotifications run:
 *  1. pool.query → claim returns {id}
 *  2. db.select (notif+patient) → makeNotifPatientRow
 *  3. db.update  → persist followupId on notif (set followupId)
 *  4. db.insert  → new followup row
 *  5. db.select (full with doctor) → makeFullRow
 *  6. pool.query → claim returns null (loop exit)
 */
function setupSuccessRun(
  notifOverrides: Record<string, unknown> = {},
  followupOverrides: Record<string, unknown> = {},
) {
  // pool.query: claim → id=1, then loop exit → null
  mockPoolQuery
    .mockResolvedValueOnce({ rows: [{ id: 1, surgeryId: 10 }] })
    .mockResolvedValueOnce({ rows: [] });

  // db.select #1: notif+patient (in claimNextNotification)
  mockDbSelect
    .mockReturnValueOnce(makeSelectChain([makeNotifPatientRow(notifOverrides)]))
    // db.select #2: full row with doctor (in processClaimedNotification)
    .mockReturnValueOnce(makeSelectChain([makeFullRow(notifOverrides)]));

  // db.update: persist followupId
  mockDbUpdate.mockReturnValue(makeUpdateChain());

  // db.insert: new followup row
  mockDbInsert.mockReturnValue(
    makeInsertChain([{ id: 99, token: "fixed-uuid-1234", ...followupOverrides }]),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests: atomic claim (FOR UPDATE SKIP LOCKED)
// ─────────────────────────────────────────────────────────────────────────────

describe("claimNextNotification — atomic claim", () => {
  afterEach(() => { vi.clearAllMocks(); });

  it("returns null when no eligible notifications exist", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });

    const result = await claimNextNotification();

    expect(result).toBeNull();
    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
    expect(mockPoolQuery.mock.calls[0]![0]).toMatch(/UPDATE scheduled_notifications/);
  });

  it("claims by the clinic's calendar day: at 22:30 in São Paulo, tomorrow's rows are not eligible", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      // 2026-10-05 22:30 em São Paulo = 2026-10-06 01:30 UTC.
      vi.setSystemTime(new Date("2026-10-06T01:30:00Z"));
      mockPoolQuery.mockResolvedValueOnce({ rows: [] });
      await claimNextNotification();
      expect(mockPoolQuery.mock.calls[0]![0]).toMatch(/scheduled_date <= \$1/);
      expect(mockPoolQuery.mock.calls[0]![1]![0]).toBe("2026-10-05");
    } finally {
      vi.useRealTimers();
    }
  });

  it("at 00:30 in São Paulo, today's rows are eligible", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      // 2026-10-06 00:30 em São Paulo = 2026-10-06 03:30 UTC.
      vi.setSystemTime(new Date("2026-10-06T03:30:00Z"));
      mockPoolQuery.mockResolvedValueOnce({ rows: [] });
      await claimNextNotification();
      expect(mockPoolQuery.mock.calls[0]![1]![0]).toBe("2026-10-06");
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses FOR UPDATE SKIP LOCKED to prevent concurrent processing", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });
    await claimNextNotification();

    const claimSql = mockPoolQuery.mock.calls[0]![0] as string;
    expect(claimSql).toContain("FOR UPDATE SKIP LOCKED");
  });

  it("increments attempts atomically in the claim UPDATE", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });
    await claimNextNotification();

    const claimSql = mockPoolQuery.mock.calls[0]![0] as string;
    expect(claimSql).toMatch(/attempts\s*= attempts \+ 1/);
  });

  it("sets a lease expiry (next_attempt_at) during claim to recover from crashes", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });
    await claimNextNotification();

    const claimSql = mockPoolQuery.mock.calls[0]![0] as string;
    expect(claimSql).toContain("next_attempt_at");
    expect(claimSql).toContain("interval '1 minute'");
  });

  it("creates a followup row and token BEFORE returning (pre-send atomicity)", async () => {
    // Claim returns id=1
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: 1, surgeryId: 10 }] });

    // db.select: notif+patient row
    mockDbSelect.mockReturnValueOnce(makeSelectChain([makeNotifPatientRow()]));

    // db.update: persist followupId
    mockDbUpdate.mockReturnValue(makeUpdateChain());

    // db.insert: new followup row
    mockDbInsert.mockReturnValue(makeInsertChain([{ id: 99, token: "fixed-uuid-1234" }]));

    const claimed = await claimNextNotification();

    expect(claimed).not.toBeNull();
    // followupId must be populated before the function returns
    expect(claimed!.followupId).toBe(99);
    expect(claimed!.followupToken).toBe("fixed-uuid-1234");
    // An insert should have been called
    expect(mockDbInsert).toHaveBeenCalledTimes(1);
  });

  it("drops retired knee scales when copying scheduled scales into the follow-up", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: 1, surgeryId: 10 }] });
    const row = makeNotifPatientRow({ scales: ["IKDC", "VAS Dor", "Lysholm"] });
    mockDbSelect.mockReturnValueOnce(makeSelectChain([row]));
    mockDbUpdate.mockReturnValue(makeUpdateChain());
    const insertChain = makeInsertChain([{ id: 99, token: "fixed-uuid-1234" }]);
    mockDbInsert.mockReturnValue(insertChain);

    const claimed = await claimNextNotification();

    expect(insertChain.values).toHaveBeenCalledWith(expect.objectContaining({ escalasEnviadas: ["VAS Dor"] }));
    expect(claimed!.scales).toEqual(["VAS Dor"]);
    // The stored scheduled_notifications row is left untouched.
    expect(row.notif.scales).toEqual(["IKDC", "VAS Dor", "Lysholm"]);
  });

  it("copies an empty scale list when only retired knee scales were scheduled", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: 1, surgeryId: 10 }] });
    mockDbSelect.mockReturnValueOnce(makeSelectChain([makeNotifPatientRow({ scales: ["ikdc"] })]));
    mockDbUpdate.mockReturnValue(makeUpdateChain());
    const insertChain = makeInsertChain([{ id: 99, token: "fixed-uuid-1234" }]);
    mockDbInsert.mockReturnValue(insertChain);

    const claimed = await claimNextNotification();

    expect(insertChain.values).toHaveBeenCalledWith(expect.objectContaining({ escalasEnviadas: [] }));
    expect(claimed!.scales).toEqual([]);
  });

  it("marks notification no_phone and returns null when patient has no phone", async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ id: 1, surgeryId: 10 }] })
      .mockResolvedValueOnce({ rows: [] });

    const rowNoPhone = makeNotifPatientRow();
    rowNoPhone.patient.telefone = "";

    mockDbSelect.mockReturnValueOnce(makeSelectChain([rowNoPhone]));

    const updateSets: Record<string, unknown>[] = [];
    mockDbUpdate.mockReturnValue(makeUpdateCapture(updateSets));

    const claimed = await claimNextNotification();

    expect(claimed).toBeNull();
    expect(mockDbInsert).not.toHaveBeenCalled();
    const noPhoneUpdate = updateSets.find((u) => u["status"] === "no_phone");
    expect(noPhoneUpdate).toBeDefined();
  });

  it("reuses followup row and token on retry (followupId already set)", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: 1, surgeryId: 10 }] });

    // Notif already has followupId=55 (from a previous attempt)
    mockDbSelect
      .mockReturnValueOnce(makeSelectChain([makeNotifPatientRow({ followupId: 55 })]))
      // Fetch existing followup token
      .mockReturnValueOnce(makeSelectChain([{ id: 55, token: "existing-token-xyz" }]));

    const claimed = await claimNextNotification();

    // No new followup row should be created
    expect(mockDbInsert).not.toHaveBeenCalled();
    expect(claimed!.followupId).toBe(55);
    expect(claimed!.followupToken).toBe("existing-token-xyz");
  });

  it("two concurrent calls each claim a different row (SKIP LOCKED semantics)", async () => {
    // Worker A gets id=1, then exits (no more rows).
    // Worker B finds nothing immediately (row 1 is locked by A).
    let claimCallCount = 0;
    mockPoolQuery.mockImplementation(() => {
      claimCallCount++;
      if (claimCallCount === 1) return Promise.resolve({ rows: [{ id: 1, surgeryId: 10 }] });
      return Promise.resolve({ rows: [] });
    });

    // db.select for notif+patient (Worker A's claim path)
    mockDbSelect.mockReturnValue(makeSelectChain([makeNotifPatientRow()]));
    mockDbUpdate.mockReturnValue(makeUpdateChain());
    mockDbInsert.mockReturnValue(makeInsertChain([{ id: 99, token: "tok" }]));

    const [claimedA, claimedB] = await Promise.all([
      claimNextNotification(),
      claimNextNotification(),
    ]);

    // One worker claimed a row; the other did not
    const claimedCount = [claimedA, claimedB].filter(Boolean).length;
    expect(claimedCount).toBeLessThanOrEqual(1);
    expect(mockPoolQuery.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("does not create a token when a fracture wins before the locked claim phase", async () => {
    mockDbSelect.mockReset();
    mockDbUpdate.mockReset();
    mockDbInsert.mockReset();
    mockSendWhatsAppText.mockReset();
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ id: 1, surgeryId: 10 }] })
      .mockResolvedValueOnce({ rows: [] });
    const row = makeNotifPatientRow();
    row.notif.periodo = "Pré-operatório";
    row.surgery.tiposProcedimento = ["SH_CUFF", "SH_FRACTURE"];
    mockDbSelect.mockReturnValueOnce(makeSelectChain([row]));
    const fractureUpdateSets: Record<string, unknown>[] = [];
    mockDbUpdate.mockReturnValue(makeUpdateCapture(fractureUpdateSets));

    const result = await claimNextNotification();

    expect(result).toBeNull();
    expect(mockDbInsert).not.toHaveBeenCalled();
    expect(mockSendWhatsAppText).not.toHaveBeenCalled();
    expect(fractureUpdateSets).toContainEqual(expect.objectContaining({ status: "skipped" }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: retry / backoff
// ─────────────────────────────────────────────────────────────────────────────

describe("processDueNotifications — durable outbox handoff", () => {
  afterEach(() => { vi.clearAllMocks(); });

  it("commits an outbox record before any WhatsApp transport call", async () => {
    setupSuccessRun();
    mockSendWhatsAppText.mockResolvedValue({ ok: true, messageId: "msg-ok" });

    const updateSets: Record<string, unknown>[] = [];
    mockDbUpdate.mockReturnValue(makeUpdateCapture(updateSets));
    // Re-run setup so insert chain is preserved
    mockDbInsert.mockReturnValue(makeInsertChain([{ id: 99, token: "fixed-uuid-1234" }]));

    await processDueNotifications();

    expect(mockSendWhatsAppText).not.toHaveBeenCalled();
    expect(mockDbInsert).toHaveBeenCalled();
    expect(updateSets).toContainEqual(expect.objectContaining({ status: "processing" }));
  });

  it("does not call the provider while holding the scheduled-notification lock", async () => {
    setupSuccessRun({ attempts: 1 });
    mockSendWhatsAppText.mockResolvedValue({ ok: false, error: "timeout" });

    const updateSets: Record<string, unknown>[] = [];
    mockDbUpdate.mockReturnValue(makeUpdateCapture(updateSets));
    mockDbInsert.mockReturnValue(makeInsertChain([{ id: 99, token: "fixed-uuid-1234" }]));

    await processDueNotifications();

    expect(mockSendWhatsAppText).not.toHaveBeenCalled();
    expect(updateSets).toContainEqual(expect.objectContaining({ status: "processing" }));
  });

  it("hands even a final scheduled attempt to the outbox for audited processing", async () => {
    setupSuccessRun({ attempts: 3 });
    mockSendWhatsAppText.mockResolvedValue({ ok: false, error: "server error" });

    const updateSets: Record<string, unknown>[] = [];
    mockDbUpdate.mockReturnValue(makeUpdateCapture(updateSets));
    mockDbInsert.mockReturnValue(makeInsertChain([{ id: 99, token: "fixed-uuid-1234" }]));

    await processDueNotifications();

    expect(mockSendWhatsAppText).not.toHaveBeenCalled();
    expect(mockDbInsert).toHaveBeenCalled();
  });

  it("reuses existing followup and token while queuing a retry", async () => {
    // Pool: claim id=1, loop exit
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ id: 1, surgeryId: 10 }] })
      .mockResolvedValueOnce({ rows: [] });

    // db.select: notif already has followupId=55
    mockDbSelect
      .mockReturnValueOnce(makeSelectChain([makeNotifPatientRow({ followupId: 55, attempts: 2 })]))
      .mockReturnValueOnce(makeSelectChain([{ id: 55, token: "existing-token-abc" }]))
      .mockReturnValueOnce(makeSelectChain([makeFullRow({ followupId: 55, attempts: 2 })]));

    const updateSets: Record<string, unknown>[] = [];
    mockDbUpdate.mockReturnValue(makeUpdateCapture(updateSets));
    mockSendWhatsAppText.mockResolvedValue({ ok: true, messageId: "msg-retry" });

    await processDueNotifications();

    expect(mockSendWhatsAppText).not.toHaveBeenCalled();
    expect(updateSets).toContainEqual(expect.objectContaining({ followupId: 55 }));
  });

  it("revalidates a fracture under lock immediately before sending", async () => {
    mockDbSelect.mockReset();
    mockDbUpdate.mockReset();
    mockDbInsert.mockReset();
    mockSendWhatsAppText.mockReset();
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ id: 1, surgeryId: 10 }] })
      .mockResolvedValueOnce({ rows: [] });
    mockDbSelect
      .mockReturnValueOnce(makeSelectChain([makeNotifPatientRow({ periodo: "Pré-operatório" })]))
      .mockReturnValueOnce(makeSelectChain([{
        ...makeFullRow({ periodo: "Pré-operatório" }),
        surgery: { id: 10, doctorId: 5, tiposProcedimento: ["SH_FRACTURE"] },
      }]));
    mockDbInsert.mockReturnValue(makeInsertChain([{ id: 42, token: "stable-token" }]));
    const fractureUpdateSets: Record<string, unknown>[] = [];
    mockDbUpdate.mockReturnValue(makeUpdateCapture(fractureUpdateSets));

    await processDueNotifications();

    expect(mockSendWhatsAppText).not.toHaveBeenCalled();
    expect(fractureUpdateSets).toContainEqual(expect.objectContaining({ status: "skipped" }));
  });
});
