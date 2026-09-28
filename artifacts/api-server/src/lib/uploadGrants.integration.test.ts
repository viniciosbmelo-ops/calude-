import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  db,
  doctorsTable,
  patientAttachmentsTable,
  patientsTable,
  storageCleanupJobsTable,
  uploadGrantsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashPassword } from "./auth";
import {
  claimGrant,
  createGrant,
  findAvailableGrant,
} from "./uploadGrants";
import {
  enqueueStorageCleanup,
  processStorageCleanupJobs,
} from "./storageCleanup";

let doctorId: number;
let patientId: number;

beforeAll(async () => {
  const suffix = randomUUID();
  const [doctor] = await db.insert(doctorsTable).values({
    nome: "Upload grant integration doctor",
    email: `upload-grant-${suffix}@example.test`,
    senhaHash: await hashPassword("upload-grant-test-password"),
    isFree: true,
  }).returning();
  doctorId = doctor.id;
  const [patient] = await db.insert(patientsTable).values({
    doctorId,
    nome: "UPLOAD GRANT INTEGRATION PATIENT",
    cpf: "52998224725",
  }).returning();
  patientId = patient.id;
});

afterAll(async () => {
  if (doctorId) {
    await db.delete(doctorsTable).where(eq(doctorsTable.id, doctorId));
  }
});

async function makeGrant(objectPath: string) {
  const token = await createGrant({
    purpose: "patient_attachment",
    doctorId,
    patientId,
    objectPath,
    fileName: "exam.pdf",
    mimeType: "application/pdf",
    expectedSize: 10,
  });
  const grant = await findAvailableGrant(token);
  expect(grant).not.toBeNull();
  return { token, grant: grant! };
}

describe.sequential("atomic upload grant finalization", () => {
  it("allows exactly one concurrent transaction to claim a token", async () => {
    const objectPath = `/objects/concurrency-${randomUUID()}`;
    const { token, grant } = await makeGrant(objectPath);

    const results = await Promise.all([
      db.transaction((tx) => claimGrant(tx, token, grant.id, "1")),
      db.transaction((tx) => claimGrant(tx, token, grant.id, "1")),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    await db.delete(uploadGrantsTable).where(eq(uploadGrantsTable.id, grant.id));
  });

  it("rolls the claim back when the clinical transaction fails", async () => {
    const objectPath = `/objects/rollback-${randomUUID()}`;
    const { token, grant } = await makeGrant(objectPath);

    await expect(db.transaction(async (tx) => {
      expect(await claimGrant(tx, token, grant.id, "1")).toBe(true);
      throw new Error("simulated clinical insert failure");
    })).rejects.toThrow("simulated clinical insert failure");

    expect(await db.transaction((tx) => claimGrant(tx, token, grant.id, "1"))).toBe(true);
    await db.delete(uploadGrantsTable).where(eq(uploadGrantsTable.id, grant.id));
  });

  it("does not delete or detach an object that became linked before cleanup", async () => {
    const objectPath = `/objects/linked-${randomUUID()}`;
    const [attachment] = await db.insert(patientAttachmentsTable).values({
      patientId,
      doctorId,
      fileName: "linked.pdf",
      fileSize: 10,
      mimeType: "application/pdf",
      objectPath,
    }).returning();
    await db.transaction((tx) => enqueueStorageCleanup(tx, [objectPath]));

    const result = await processStorageCleanupJobs();
    expect(result.deleted).toBeGreaterThanOrEqual(1);
    expect(await db.select().from(patientAttachmentsTable)
      .where(eq(patientAttachmentsTable.id, attachment.id))).toHaveLength(1);
    expect(await db.select().from(storageCleanupJobsTable)
      .where(eq(storageCleanupJobsTable.objectPath, objectPath))).toHaveLength(0);

    await db.delete(patientAttachmentsTable).where(eq(patientAttachmentsTable.id, attachment.id));
  });
});