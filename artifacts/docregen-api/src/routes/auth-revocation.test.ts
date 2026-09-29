import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  db,
  doctorsTable,
  secretariesTable,
} from "@workspace/docregen-db";
import app from "../app";
import {
  hashPassword,
  signSecretaryToken,
  signToken,
} from "../lib/auth";

let server: Server;
let baseUrl: string;
let adminId: number;
let doctorId: number;
let adminToken: string;
let doctorSessionToken: string;
let secretarySessionToken: string;
let doctorEmail: string;
let secretaryEmail: string;
const password = "strong-password-123";

async function login(
  path: string,
  email: string,
  loginPassword = password,
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, identificador: email, senha: loginPassword }),
  });
}

async function adminPatch(path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
}

beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const suffix = randomUUID();
  doctorEmail = `revocation-doctor-${suffix}@example.test`;
  secretaryEmail = `revocation-secretary-${suffix}@example.test`;
  const senhaHash = await hashPassword(password);

  const [admin, doctor] = await db
    .insert(doctorsTable)
    .values([
      {
        nome: "Revocation Admin",
        email: `revocation-admin-${suffix}@example.test`,
        senhaHash,
        isAdmin: true,
        isFree: true,
      },
      {
        nome: "Revocation Doctor",
        email: doctorEmail,
        senhaHash,
        isFree: true,
      },
    ])
    .returning();
  adminId = admin.id;
  doctorId = doctor.id;

  const [secretary] = await db
    .insert(secretariesTable)
    .values({
      doctorId,
      nome: "Revocation Secretary",
      email: secretaryEmail,
      senhaHash,
    })
    .returning();

  adminToken = signToken({
    doctorId: admin.id,
    isAdmin: true,
    sessionVersion: admin.sessionVersion,
  });
  doctorSessionToken = signToken({
    doctorId: doctor.id,
    isAdmin: false,
    sessionVersion: doctor.sessionVersion,
  });
  secretarySessionToken = signSecretaryToken({
    doctorId: doctor.id,
    secretaryId: secretary.id,
    sessionVersion: secretary.sessionVersion,
  });
});

afterAll(async () => {
  if (doctorId) {
    await db.delete(doctorsTable).where(eq(doctorsTable.id, doctorId));
  }
  if (adminId) {
    await db.delete(doctorsTable).where(eq(doctorsTable.id, adminId));
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

/**
 * DocRegen has no admin console (that lives only in DocKnee). Blocking a doctor
 * is an operator action on DocRegen's own database — the same writes DocKnee's
 * admin endpoint performs (aprovado=false + session_version bump for the doctor
 * and their secretaries). These tests verify the DocRegen API enforces it.
 */
async function blockDoctor(id: number): Promise<void> {
  await db.update(doctorsTable)
    .set({ aprovado: false, sessionVersion: sql`${doctorsTable.sessionVersion} + 1` })
    .where(eq(doctorsTable.id, id));
  await db.update(secretariesTable)
    .set({ sessionVersion: sql`${secretariesTable.sessionVersion} + 1` })
    .where(eq(secretariesTable.doctorId, id));
}

async function approveDoctor(id: number): Promise<void> {
  await db.update(doctorsTable).set({ aprovado: true }).where(eq(doctorsTable.id, id));
}

describe.sequential("account blocking and session revocation", () => {
  it("revokes doctor and secretary sessions and keeps them revoked after unblock", async () => {
    const doctorLogin = await login("/regen-api/auth/login", doctorEmail);
    const secretaryLogin = await login("/regen-api/secretary-auth/login", secretaryEmail);
    expect(doctorLogin.status).toBe(200);
    expect(secretaryLogin.status).toBe(200);

    await blockDoctor(doctorId);

    const oldDoctorSession = await fetch(`${baseUrl}/regen-api/auth/me`, {
      headers: { Authorization: `Bearer ${doctorSessionToken}` },
    });
    const oldSecretarySession = await fetch(`${baseUrl}/regen-api/secretary-auth/me`, {
      headers: { Authorization: `Bearer ${secretarySessionToken}` },
    });
    const blockedLogin = await login("/regen-api/auth/login", doctorEmail);

    expect(oldDoctorSession.status).toBe(401);
    expect(oldSecretarySession.status).toBe(401);
    expect(blockedLogin.status).toBe(401);

    await approveDoctor(doctorId);

    const stillRevokedDoctor = await fetch(`${baseUrl}/regen-api/auth/me`, {
      headers: { Authorization: `Bearer ${doctorSessionToken}` },
    });
    const stillRevokedSecretary = await fetch(`${baseUrl}/regen-api/secretary-auth/me`, {
      headers: { Authorization: `Bearer ${secretarySessionToken}` },
    });
    expect(stillRevokedDoctor.status).toBe(401);
    expect(stillRevokedSecretary.status).toBe(401);

    expect((await login("/regen-api/auth/login", doctorEmail)).status).toBe(200);
    expect((await login("/regen-api/secretary-auth/login", secretaryEmail)).status).toBe(200);
  });

  it("returns 410 for legacy identity-data password reset endpoints", async () => {
    const verifyIdentity = await fetch(`${baseUrl}/regen-api/auth/verify-identity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cpf: "00000000000",
        email: doctorEmail,
        crm: "1234",
      }),
    });
    const legacyReset = await fetch(`${baseUrl}/regen-api/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cpf: "00000000000",
        email: doctorEmail,
        crm: "1234",
        novaSenha: "another-password",
      }),
    });

    expect(verifyIdentity.status).toBe(410);
    expect(legacyReset.status).toBe(410);
  });

  it("does not expose DocKnee's admin console endpoints", async () => {
    for (const path of [
      `/regen-api/admin/doctors/${doctorId}/block`,
      `/regen-api/admin/doctors/${doctorId}/profile`,
      `/regen-api/admin/doctors/${doctorId}/reset-password`,
    ]) {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(response.status, path).toBe(404);
    }
  });

  it("revokes the previous session when the doctor changes their password", async () => {
    const [doctor] = await db
      .select({
        sessionVersion: doctorsTable.sessionVersion,
        isAdmin: doctorsTable.isAdmin,
      })
      .from(doctorsTable)
      .where(eq(doctorsTable.id, doctorId))
      .limit(1);
    const currentToken = signToken({
      doctorId,
      isAdmin: doctor.isAdmin,
      sessionVersion: doctor.sessionVersion,
    });
    const newPassword = "doctor-changed-password-456";

    const change = await fetch(`${baseUrl}/regen-api/auth/change-password`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${currentToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ senhaAtual: password, novaSenha: newPassword }),
    });
    expect(change.status).toBe(200);

    const revoked = await fetch(`${baseUrl}/regen-api/auth/me`, {
      headers: { Authorization: `Bearer ${currentToken}` },
    });
    expect(revoked.status).toBe(401);
    expect((await login("/regen-api/auth/login", doctorEmail, newPassword)).status).toBe(200);
  });
});
