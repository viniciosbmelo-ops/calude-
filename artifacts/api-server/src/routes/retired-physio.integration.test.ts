import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db, doctorsTable, physiotherapistsTable, whatsappOutboxTable } from "@workspace/db";
import app from "../app";
import { signToken } from "../lib/auth";
import { claimNextRedFlagAlert } from "../services/redFlagAlerts";

/**
 * The physiotherapist portal was removed. Its endpoints must answer 404 for
 * every caller (including a still-valid legacy physio token), its queued
 * WhatsApp alerts must never be dispatched, and its stored data is preserved.
 */

let server: Server;
let baseUrl: string;
let doctorId: number;
let doctorAuth: string;
let physioId: number;
let legacyPhysioToken: string;
const outboxIds: number[] = [];

const RETIRED: Array<[method: string, path: string]> = [
  ["POST", "/physio-auth/login"],
  ["POST", "/physio-auth/register"],
  ["GET", "/physio-auth/me"],
  ["GET", "/physio/dashboard"],
  ["GET", "/physio/patients"],
  ["POST", "/physio/patients"],
  ["GET", "/physio/patients/1"],
  ["PATCH", "/physio/followups/1"],
  ["POST", "/physio/patients/1/assessments"],
  ["GET", "/physio/patients/1/documents"],
  ["GET", "/physio/appointments"],
  ["GET", "/physio/billing/plans"],
  ["POST", "/physio/billing/checkout"],
  ["GET", "/physio/invites/some-token"],
  ["POST", "/physio/invites/accept"],
  ["GET", "/physio/protocols"],
  ["GET", "/admin/physiotherapists"],
  ["PATCH", "/admin/physiotherapists/1/block"],
  ["POST", "/patients/1/rehab-invite"],
  ["GET", "/patients/1/rehab"],
  ["POST", "/care-links/1/revoke"],
];

beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) => (error ? reject(error) : resolve()));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const [doctor] = await db.insert(doctorsTable).values({
    nome: "Retired Physio Doctor",
    email: `retired-physio-doctor-${randomUUID()}@example.test`,
    senhaHash: "not-used",
    isFree: true,
    isAdmin: true,
    aprovado: true,
  }).returning();
  doctorId = doctor.id;
  doctorAuth = signToken({ doctorId, isAdmin: true, sessionVersion: doctor.sessionVersion });

  const [physio] = await db.insert(physiotherapistsTable).values({
    nome: "Legacy Physio",
    email: `retired-physio-${randomUUID()}@example.test`,
    senhaHash: "not-used",
    celular: "5511955555555",
  }).returning();
  physioId = physio.id;
  legacyPhysioToken = jwt.sign(
    { physioId, sessionVersion: physio.sessionVersion, role: "physio", isAdmin: false },
    process.env["SESSION_SECRET"]!,
    { algorithm: "HS256", issuer: "docknee-api", audience: "docknee-web", expiresIn: "12h" },
  );
});

afterAll(async () => {
  if (outboxIds.length) await db.delete(whatsappOutboxTable).where(inArray(whatsappOutboxTable.id, outboxIds));
  if (physioId) await db.delete(physiotherapistsTable).where(eq(physiotherapistsTable.id, physioId));
  if (doctorId) await db.delete(doctorsTable).where(eq(doctorsTable.id, doctorId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("removed physiotherapy panel", () => {
  it("answers 404 on every retired endpoint, anonymous or with any token", async () => {
    for (const [method, path] of RETIRED) {
      for (const token of [null, legacyPhysioToken, doctorAuth]) {
        const res = await fetch(`${baseUrl}/api${path}`, {
          method,
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: method === "GET" ? undefined : JSON.stringify({ email: "x@example.test", senha: "x" }),
        });
        expect(res.status, `${method} ${path}`).toBe(404);
      }
    }
  });

  it("does not let a legacy physio token reach doctor endpoints", async () => {
    const res = await fetch(`${baseUrl}/api/patients`, {
      headers: { Authorization: `Bearer ${legacyPhysioToken}` },
    });
    expect(res.status).toBe(401);
  });

  it("keeps the stored physiotherapist data", async () => {
    const [row] = await db.select({ id: physiotherapistsTable.id })
      .from(physiotherapistsTable)
      .where(eq(physiotherapistsTable.id, physioId));
    expect(row?.id).toBe(physioId);
  });

  it("never dispatches a queued rehab red-flag WhatsApp alert", async () => {
    const suffix = randomUUID();
    const [retired] = await db.insert(whatsappOutboxTable).values({
      eventType: "rehab_red_flag",
      idempotencyKey: `retired-${suffix}`,
      recipient: "5511900000000",
      message: "legacy physio alert",
      nextAttemptAt: new Date("1969-01-01T00:00:00Z"),
    }).returning();
    const [active] = await db.insert(whatsappOutboxTable).values({
      eventType: "generic_doctor_message",
      idempotencyKey: `active-${suffix}`,
      recipient: "5511900000001",
      message: "doctor message",
      nextAttemptAt: new Date("1970-01-01T00:00:00Z"),
    }).returning();
    outboxIds.push(retired.id, active.id);

    const claimed = await claimNextRedFlagAlert();
    expect(claimed?.id).toBe(active.id);

    const [stillPending] = await db.select({ status: whatsappOutboxTable.status, attempts: whatsappOutboxTable.attempts })
      .from(whatsappOutboxTable)
      .where(eq(whatsappOutboxTable.id, retired.id));
    expect(stillPending).toEqual({ status: "pending", attempts: 0 });
  });
});
