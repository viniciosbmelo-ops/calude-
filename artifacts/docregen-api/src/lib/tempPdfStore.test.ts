/**
 * Temporary PDF store (PostgreSQL, shared by all instances): validation,
 * per-doctor quota, global cap, expiry, filename sanitization, id format.
 */
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, doctorsTable, tempPdfsTable } from "@workspace/docregen-db";
import { _internals, getPdf, storePdf } from "./tempPdfStore";
import app from "../app";
import { signToken } from "./auth";

let doctorId: number;
let server: Server;
let baseUrl: string;

const makePdf = (extra = 0) => Buffer.concat([Buffer.from("%PDF-1.4 test content"), Buffer.alloc(extra)]);

beforeAll(async () => {
  const [doctor] = await db.insert(doctorsTable).values({
    nome: "PDF Doctor", email: `pdf-${randomUUID()}@example.test`, senhaHash: "x", isFree: true,
  }).returning();
  doctorId = doctor!.id;
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) => (error ? reject(error) : resolve()));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await db.delete(tempPdfsTable).where(eq(tempPdfsTable.doctorId, doctorId));
  for (const key of ["PDF_TEMP_MAX_PER_DOCTOR", "PDF_TEMP_MAX_TOTAL_BYTES"]) delete process.env[key];
});

afterAll(async () => {
  await db.delete(doctorsTable).where(eq(doctorsTable.id, doctorId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("validation helpers", () => {
  it("magic bytes", () => {
    expect(_internals.hasPdfMagicBytes(Buffer.from("%PDF-1.4"))).toBe(true);
    expect(_internals.hasPdfMagicBytes(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    expect(_internals.hasPdfMagicBytes(Buffer.from("%PD"))).toBe(false);
  });

  it("filename sanitization", () => {
    expect(_internals.sanitizeFilename("relatorio-2024.pdf")).toBe("relatorio-2024.pdf");
    expect(_internals.sanitizeFilename("../../etc/passwd")).not.toContain("/");
    expect(_internals.sanitizeFilename("myfile")).toMatch(/\.pdf$/);
    expect(_internals.sanitizeFilename("a".repeat(300)).length).toBeLessThanOrEqual(132);
  });
});

describe("storePdf / getPdf (database)", () => {
  it("rejects non-PDF content and oversized files", async () => {
    expect(await storePdf(doctorId, Buffer.from("hello"), "x.pdf")).toEqual({ error: "invalid_pdf" });
    expect(await storePdf(doctorId, makePdf(21 * 1024 * 1024), "x.pdf")).toEqual({ error: "too_large" });
  });

  it("stores in the database and serves by id", async () => {
    const result = await storePdf(doctorId, makePdf(), "laudo.pdf");
    expect(result.id).toMatch(/^[0-9a-f]{32}$/);
    const entry = await getPdf(result.id!);
    expect(entry?.filename).toBe("laudo.pdf");
    expect(entry?.buffer.subarray(0, 4).toString()).toBe("%PDF");
    const [row] = await db.select().from(tempPdfsTable).where(eq(tempPdfsTable.id, result.id!));
    expect(row?.doctorId).toBe(doctorId);
  });

  it("returns null for malformed, unknown and expired ids", async () => {
    expect(await getPdf("../etc")).toBeNull();
    expect(await getPdf("0".repeat(32))).toBeNull();
    const { id } = await storePdf(doctorId, makePdf(), "old.pdf");
    await db.update(tempPdfsTable).set({ expiresAt: sql`now() - interval '1 second'` }).where(eq(tempPdfsTable.id, id!));
    expect(await getPdf(id!)).toBeNull();
  });

  it("enforces the per-doctor quota", async () => {
    process.env["PDF_TEMP_MAX_PER_DOCTOR"] = "2";
    expect((await storePdf(doctorId, makePdf(), "1.pdf")).id).toBeTruthy();
    expect((await storePdf(doctorId, makePdf(), "2.pdf")).id).toBeTruthy();
    expect(await storePdf(doctorId, makePdf(), "3.pdf")).toEqual({ error: "doctor_quota" });
  });

  it("enforces the global size cap", async () => {
    process.env["PDF_TEMP_MAX_TOTAL_BYTES"] = "10";
    expect(await storePdf(doctorId, makePdf(), "big.pdf")).toEqual({ error: "store_full" });
  });
});

describe("routes", () => {
  it("POST stores for the doctor, GET serves it; quota answers 429", async () => {
    const auth = { Authorization: `Bearer ${signToken({ doctorId, isAdmin: false, sessionVersion: 0 })}` };
    const posted = await fetch(`${baseUrl}/regen-api/pdf/temp`, {
      method: "POST", headers: { ...auth, "Content-Type": "application/pdf", "X-Filename": "r.pdf" }, body: makePdf(),
    });
    expect(posted.status).toBe(200);
    const { path } = await posted.json() as { path: string };
    const served = await fetch(`${baseUrl}${path}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("application/pdf");

    process.env["PDF_TEMP_MAX_PER_DOCTOR"] = "1";
    const limited = await fetch(`${baseUrl}/regen-api/pdf/temp`, {
      method: "POST", headers: { ...auth, "Content-Type": "application/pdf" }, body: makePdf(),
    });
    expect(limited.status).toBe(429);
  });

  it("the JSON (base64) variant accepts more than the 1 MB default body limit", async () => {
    const auth = { Authorization: `Bearer ${signToken({ doctorId, isAdmin: false, sessionVersion: 0 })}` };
    const data = makePdf(2 * 1024 * 1024).toString("base64");
    const posted = await fetch(`${baseUrl}/regen-api/pdf/temp`, {
      method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ data, filename: "big.pdf" }),
    });
    expect(posted.status).toBe(200);
  });
});
