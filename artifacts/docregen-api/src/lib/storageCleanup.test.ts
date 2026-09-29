import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { db, storageCleanupJobsTable } from "@workspace/docregen-db";
import { eq } from "drizzle-orm";
import {
  enqueueStorageCleanup,
  processStorageCleanupJobs,
} from "./storageCleanup";

const createdPaths: string[] = [];

afterEach(async () => {
  await Promise.all(createdPaths.splice(0).map((objectPath) =>
    db
      .delete(storageCleanupJobsTable)
      .where(eq(storageCleanupJobsTable.objectPath, objectPath))
  ));
});

describe("durable storage cleanup outbox", () => {
  it("enqueues unique paths transactionally and backs off failures for retry", async () => {
    const invalidPath = `invalid-cleanup-path-${randomUUID()}`;
    createdPaths.push(invalidPath);

    const inserted = await db.transaction((tx) =>
      enqueueStorageCleanup(tx, [invalidPath, invalidPath, null])
    );
    expect(inserted).toBe(1);

    const cleanup = await processStorageCleanupJobs();
    expect(cleanup.failed).toBeGreaterThanOrEqual(1);

    const [job] = await db
      .select()
      .from(storageCleanupJobsTable)
      .where(eq(storageCleanupJobsTable.objectPath, invalidPath));
    expect(job).toMatchObject({ attempts: 1 });
    expect(job.lastError).toContain("Versão do objeto ausente");
    expect(job.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("does not retain cleanup work when the owning transaction rolls back", async () => {
    const rolledBackPath = `rolled-back-cleanup-${randomUUID()}`;
    createdPaths.push(rolledBackPath);

    await expect(db.transaction(async (tx) => {
      await enqueueStorageCleanup(tx, [rolledBackPath]);
      throw new Error("rollback");
    })).rejects.toThrow("rollback");

    const jobs = await db
      .select()
      .from(storageCleanupJobsTable)
      .where(eq(storageCleanupJobsTable.objectPath, rolledBackPath));
    expect(jobs).toHaveLength(0);
  });
});