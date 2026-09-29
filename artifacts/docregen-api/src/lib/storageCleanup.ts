import {
  ObjectNotFoundError,
  ObjectStorageService,
  objectStorageClient,
} from "./objectStorage";
import { db, pool, storageCleanupJobsTable, uploadGrantsTable } from "@workspace/docregen-db";
import { asc, eq, lte, sql } from "drizzle-orm";

const storage = new ObjectStorageService();
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** All link, abandon, and cleanup operations use this lock for one object path. */
export async function lockStoragePath(tx: DbTransaction, objectPath: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${objectPath}, 0))`);
}

export function uniqueStoragePaths(
  paths: Iterable<string | null | undefined>,
): string[] {
  return Array.from(new Set(
    Array.from(paths).filter((path): path is string => Boolean(path)),
  ));
}

function parseGcsPath(path: string): { bucketName: string; objectName: string } {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new Error("Caminho de arquivo inválido no armazenamento.");
  }
  return {
    bucketName: parts[0]!,
    objectName: parts.slice(1).join("/"),
  };
}

/**
 * Deletes a trusted storage path. Missing objects are already compliant and
 * therefore count as success.
 */
export async function deleteStoredObject(path: string): Promise<void> {
  if (path.startsWith("/objects/")) {
    try {
      const file = await storage.getObjectEntityFile(path);
      await file.delete({ ignoreNotFound: true });
      return;
    } catch (error) {
      if (error instanceof ObjectNotFoundError) return;
      throw error;
    }
  }

  const { bucketName, objectName } = parseGcsPath(path);
  await objectStorageClient
    .bucket(bucketName)
    .file(objectName)
    .delete({ ignoreNotFound: true });
}

export async function deleteStoredObjects(paths: Iterable<string | null | undefined>): Promise<void> {
  for (const path of uniqueStoragePaths(paths)) {
    await deleteStoredObject(path);
  }
}

/**
 * Persists storage erasure work in the same transaction that removes the
 * owning clinical rows. A unique object path makes enqueueing idempotent.
 */
export async function enqueueStorageCleanup(
  tx: DbTransaction,
  paths: Iterable<string | { objectPath: string; objectGeneration?: string | null } | null | undefined>,
): Promise<number> {
  const jobs = new Map<string, string | null>();
  for (const path of paths) {
    if (!path) continue;
    const objectPath = typeof path === "string" ? path : path.objectPath;
    if (!objectPath) continue;
    if (typeof path !== "string") {
      jobs.set(objectPath, path.objectGeneration ?? null);
      continue;
    }
    // Consumed grants retain the generation, allowing deletion flows that only
    // know a clinical object path to remain version-safe.
    const [grant] = await tx
      .select({ objectGeneration: uploadGrantsTable.objectGeneration })
      .from(uploadGrantsTable)
      .where(eq(uploadGrantsTable.objectPath, objectPath))
      .limit(1);
    jobs.set(objectPath, grant?.objectGeneration ?? null);
  }
  if (jobs.size === 0) return 0;
  const inserted = await tx
    .insert(storageCleanupJobsTable)
    .values(Array.from(jobs, ([objectPath, objectGeneration]) => ({ objectPath, objectGeneration })))
    .onConflictDoNothing({ target: storageCleanupJobsTable.objectPath })
    .returning({ id: storageCleanupJobsTable.id });
  return inserted.length;
}

export interface StorageCleanupResult {
  processed: number;
  deleted: number;
  failed: number;
}

/**
 * Cleanup jobs can be created by a losing finalization request after another
 * concurrent request has already linked the same object. Never erase an object
 * while any supported clinical record still references it.
 */
export async function isStoredObjectLinked(objectPath: string, tx?: DbTransaction): Promise<boolean> {
  const result = tx
    ? await tx.execute<{ linked: boolean }>(sql`
      SELECT EXISTS (SELECT 1 FROM patient_attachments WHERE object_path = ${objectPath}) AS linked`)
    : await pool.query<{ linked: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM patient_attachments WHERE object_path = $1) AS linked`,
    [objectPath],
  );
  return result.rows[0]?.linked === true;
}

/**
 * Drains a bounded batch from the durable outbox. Jobs are only removed after
 * storage confirms deletion; failures receive capped exponential backoff.
 */
export async function processStorageCleanupJobs(
  limit = 50,
): Promise<StorageCleanupResult> {
  const now = new Date();
  const jobs = await db
    .select()
    .from(storageCleanupJobsTable)
    .where(lte(storageCleanupJobsTable.nextAttemptAt, now))
    .orderBy(asc(storageCleanupJobsTable.nextAttemptAt), asc(storageCleanupJobsTable.id))
    .limit(limit);

  let deleted = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      await db.transaction(async (tx) => {
        await lockStoragePath(tx, job.objectPath);
        // Re-check while holding the same lock used by all linking paths.
        if (!await isStoredObjectLinked(job.objectPath, tx)) {
          if (!job.objectGeneration) {
            // Legacy rows do not identify immutable bytes: preserve rather
            // than risk erasing a later replacement.
            throw new Error("Versão do objeto ausente; limpeza automática bloqueada.");
          }
          const actualGeneration = await storage.getObjectEntityGeneration(job.objectPath);
          if (actualGeneration !== job.objectGeneration) {
            throw new Error("Versão do objeto mudou; limpeza automática bloqueada.");
          }
          const file = await storage.getObjectEntityFile(job.objectPath);
          await file.delete({ ifGenerationMatch: job.objectGeneration, ignoreNotFound: true });
        }
        await tx.delete(storageCleanupJobsTable).where(eq(storageCleanupJobsTable.id, job.id));
      });
      deleted += 1;
    } catch (error) {
      const attempts = job.attempts + 1;
      const backoffMs = Math.min(24 * 60 * 60 * 1000, 60_000 * (2 ** Math.min(attempts, 10)));
      await db
        .update(storageCleanupJobsTable)
        .set({
          attempts,
          lastError: error instanceof Error
            ? error.message.slice(0, 1_000)
            : "Falha desconhecida no armazenamento.",
          nextAttemptAt: new Date(Date.now() + backoffMs),
          updatedAt: new Date(),
        })
        .where(eq(storageCleanupJobsTable.id, job.id));
      failed += 1;
    }
  }

  return { processed: jobs.length, deleted, failed };
}