/**
 * Tests for the read-only schema assertion (assertRequiredSchema).
 *
 * Key invariants:
 *   1. Passes silently when every required table + column exists.
 *   2. Throws listing missing tables.
 *   3. Throws listing missing columns (only for tables that exist).
 *   4. Issues ONLY read-only information_schema SELECTs — never any DDL.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPoolQuery = vi.fn();

vi.mock("@workspace/docregen-db", () => ({
  pool: {
    query: (...args: unknown[]) => mockPoolQuery(...args),
  },
}));

vi.mock("./logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  },
}));

import {
  assertRequiredSchema,
  REQUIRED_TABLES,
  REQUIRED_COLUMNS,
} from "./schema-guard";

/** Builds a fake information_schema.tables result. */
function tablesResult(names: string[]) {
  return { rows: names.map((table_name) => ({ table_name })) };
}

/** Builds a fake information_schema.columns result. */
function columnsResult(cols: { table: string; column: string }[]) {
  return {
    rows: cols.map((c) => ({ table_name: c.table, column_name: c.column })),
  };
}

beforeEach(() => {
  mockPoolQuery.mockReset();
});

describe("assertRequiredSchema", () => {
  it("requires every table referenced by a required column", () => {
    const requiredTables = new Set(REQUIRED_TABLES);
    const unguarded = REQUIRED_COLUMNS.filter(
      ({ table }) => !requiredTables.has(table),
    );

    expect(unguarded).toEqual([]);
  });

  it("requires the decision-support audit tables", () => {
    expect(REQUIRED_TABLES).toEqual(
      expect.arrayContaining([
        "apoio_decisao_execucoes",
        "apoio_decisao_escolhas",
        "apoio_decisao_status",
      ]),
    );
  });

  it("passes when all required tables and columns exist", async () => {
    mockPoolQuery
      .mockResolvedValueOnce(tablesResult(REQUIRED_TABLES))
      .mockResolvedValueOnce(columnsResult(REQUIRED_COLUMNS));

    await expect(assertRequiredSchema()).resolves.toBeUndefined();
    expect(mockPoolQuery).toHaveBeenCalledTimes(2);
  });

  it("issues only read-only information_schema SELECTs (no DDL)", async () => {
    mockPoolQuery
      .mockResolvedValueOnce(tablesResult(REQUIRED_TABLES))
      .mockResolvedValueOnce(columnsResult(REQUIRED_COLUMNS));

    await assertRequiredSchema();

    for (const call of mockPoolQuery.mock.calls) {
      const sql = String(call[0]).toUpperCase();
      expect(sql).toContain("INFORMATION_SCHEMA");
      expect(sql.startsWith("\n") ? sql.trim() : sql).toMatch(/^SELECT/);
      expect(sql).not.toMatch(/CREATE |ALTER |DROP |INSERT |UPDATE |DELETE /);
    }
  });

  it("throws and lists missing tables", async () => {
    const present = REQUIRED_TABLES.filter(
      (t) => t !== "regen_cases" && t !== "stripe_webhook_events",
    );
    mockPoolQuery.mockResolvedValueOnce(tablesResult(present));
    // Column probe only runs for existing tables; provide all their columns.
    mockPoolQuery.mockResolvedValueOnce(
      columnsResult(REQUIRED_COLUMNS.filter((c) => present.includes(c.table))),
    );

    await expect(assertRequiredSchema()).rejects.toThrow(/missing tables/);
    await expect(
      (async () => {
        mockPoolQuery
          .mockResolvedValueOnce(tablesResult(present))
          .mockResolvedValueOnce(
            columnsResult(
              REQUIRED_COLUMNS.filter((c) => present.includes(c.table)),
            ),
          );
        await assertRequiredSchema();
      })(),
    ).rejects.toThrow(/regen_cases|stripe_webhook_events/);
  });

  it("throws and lists missing columns for existing tables", async () => {
    mockPoolQuery.mockResolvedValueOnce(tablesResult(REQUIRED_TABLES));
    // Drop the retry columns from the reported columns.
    const withoutRetry = REQUIRED_COLUMNS.filter(
      (c) => c.column !== "attempts" && c.column !== "next_attempt_at",
    );
    mockPoolQuery.mockResolvedValueOnce(columnsResult(withoutRetry));

    await expect(assertRequiredSchema()).rejects.toThrow(/missing columns/);
  });

  it("does not probe columns for a table that is itself missing", async () => {
    // scheduled_notifications missing → its columns must not be double-reported.
    const present = REQUIRED_TABLES.filter(
      (t) => t !== "scheduled_notifications",
    );
    mockPoolQuery.mockResolvedValueOnce(tablesResult(present));
    mockPoolQuery.mockResolvedValueOnce(
      columnsResult(REQUIRED_COLUMNS.filter((c) => present.includes(c.table))),
    );

    let err: Error | undefined;
    try {
      await assertRequiredSchema();
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeDefined();
    expect(err!.message).toContain("missing tables: scheduled_notifications");
    // Columns of the missing table must NOT appear in the missing-columns list.
    expect(err!.message).not.toMatch(/scheduled_notifications\.attempts/);
  });

  it("error message tells the operator how to apply the schema", async () => {
    mockPoolQuery
      .mockResolvedValueOnce(tablesResult([]))
      .mockResolvedValueOnce(columnsResult([]));

    await expect(assertRequiredSchema()).rejects.toThrow(
      /post-merge\.sh|re-publish/,
    );
  });
});
