import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  db,
  doctorsTable,
  secretariesTable,
} from "@workspace/db";
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

describe.sequential("account blocking and session revocation", () => {
  it("revokes doctor and secretary sessions and keeps them revoked after unblock", async () => {
    const doctorLogin = await login("/api/auth/login", doctorEmail);
    const secretaryLogin = await login("/api/secretary-auth/login", secretaryEmail);
    expect(doctorLogin.status).toBe(200);
    expect(secretaryLogin.status).toBe(200);

    const blocked = await adminPatch(`/api/admin/doctors/${doctorId}/block`);
    expect(blocked.status).toBe(200);

    const oldDoctorSession = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${doctorSessionToken}` },
    });
    const oldSecretarySession = await fetch(`${baseUrl}/api/secretary-auth/me`, {
      headers: { Authorization: `Bearer ${secretarySessionToken}` },
    });
    const blockedLogin = await login("/api/auth/login", doctorEmail);

    expect(oldDoctorSession.status).toBe(401);
    expect(oldSecretarySession.status).toBe(401);
    expect(blockedLogin.status).toBe(401);

    const approved = await adminPatch(`/api/admin/doctors/${doctorId}/approve`);
    expect(approved.status).toBe(200);

    const stillRevokedDoctor = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${doctorSessionToken}` },
    });
    const stillRevokedSecretary = await fetch(`${baseUrl}/api/secretary-auth/me`, {
      headers: { Authorization: `Bearer ${secretarySessionToken}` },
    });
    expect(stillRevokedDoctor.status).toBe(401);
    expect(stillRevokedSecretary.status).toBe(401);

    expect((await login("/api/auth/login", doctorEmail)).status).toBe(200);
    expect((await login("/api/secretary-auth/login", secretaryEmail)).status).toBe(200);
  });

  it("returns 410 for legacy identity-data password reset endpoints", async () => {
    const verifyIdentity = await fetch(`${baseUrl}/api/auth/verify-identity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cpf: "00000000000",
        email: doctorEmail,
        crm: "1234",
      }),
    });
    const legacyReset = await fetch(`${baseUrl}/api/auth/reset-password`, {
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

  it("allows an admin to edit doctor registration fields without changing privileged fields", async () => {
    const [before] = await db
      .select({
        senhaHash: doctorsTable.senhaHash,
        isAdmin: doctorsTable.isAdmin,
        isFree: doctorsTable.isFree,
        aprovado: doctorsTable.aprovado,
      })
      .from(doctorsTable)
      .where(eq(doctorsTable.id, doctorId))
      .limit(1);

    const response = await fetch(`${baseUrl}/api/admin/doctors/${doctorId}/profile`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        nome: "Médico Atualizado",
        email: doctorEmail.toUpperCase(),
        crm: "12.345",
        crmEstado: "sp",
        cpf: "123.456.789-01",
        telefone: "(11) 99999-0000",
        especialidade: "Ortopedia",
        idioma: "es",
        endereco: "Rua Teste, 10",
        cidade: "São Paulo",
        estado: "sp",
        cep: "01000-000",
        whatsappBusiness: "5511999990000",
        isAdmin: true,
        isFree: false,
        aprovado: false,
        senhaHash: "must-not-be-used",
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as { doctor: { id: number; email: string; crm: string; crmEstado: string } };
    expect(body.doctor).toMatchObject({
      id: doctorId,
      email: doctorEmail,
      crm: "12345",
      crmEstado: "SP",
    });

    const [after] = await db
      .select()
      .from(doctorsTable)
      .where(eq(doctorsTable.id, doctorId))
      .limit(1);
    expect(after).toMatchObject({
      nome: "Médico Atualizado",
      email: doctorEmail,
      crm: "12345",
      crmEstado: "SP",
      cpf: "12345678901",
      telefone: "(11) 99999-0000",
      especialidade: "Ortopedia",
      idioma: "es",
      estado: "SP",
    });
    expect(after.senhaHash).toBe(before.senhaHash);
    expect(after.isAdmin).toBe(before.isAdmin);
    expect(after.isFree).toBe(before.isFree);
    expect(after.aprovado).toBe(before.aprovado);
  });

  it("revokes the current session when an admin resets the doctor password", async () => {
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
    const newPassword = "admin-reset-password-456";

    const reset = await fetch(
      `${baseUrl}/api/admin/doctors/${doctorId}/reset-password`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${adminToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ novaSenha: newPassword }),
      },
    );
    expect(reset.status).toBe(200);

    const revoked = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${currentToken}` },
    });
    expect(revoked.status).toBe(401);
    expect((await login("/api/auth/login", doctorEmail, newPassword)).status).toBe(200);
  });
});