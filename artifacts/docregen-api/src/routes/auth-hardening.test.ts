/**
 * Regression tests for the authentication hardening:
 *   - every credential endpoint is behind the (DB-backed) per-IP auth limiter;
 *   - per-account lockout after repeated failures (DB-backed, any IP);
 *   - e-mails normalized to lowercase + unique on lower(email);
 *   - registration validation (password ≥ 8, e-mail format, CPF checksum);
 *   - secretary password ≥ 8;
 *   - logout revokes the session server-side (sessionVersion);
 *   - /admin/contact ignores revoked sessions;
 *   - malformed JSON / non-string CPF are 400, not 500.
 */
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, like, or, sql } from "drizzle-orm";
import {
  adminContactMessages,
  authLockoutsTable,
  db,
  doctorsTable,
  rateLimitBucketsTable,
  secretariesTable,
} from "@workspace/docregen-db";
import app from "../app";
import { hashPassword, signSecretaryToken, signToken } from "../lib/auth";
import { ACCOUNT_LOCKOUT } from "../lib/accountLockout";

let server: Server;
let baseUrl: string;
const suffix = randomUUID().slice(0, 8);
const password = "strong-password-123";
const createdDoctorIds: number[] = [];
let doctorId: number;
let doctorEmail: string;
let secretaryId: number;
let secretaryEmail: string;

function post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** A valid CPF derived from 9 digits (checksum computed). */
function validCpf(seed: number): string {
  const base = String(100_000_000 + (seed % 800_000_000)).slice(0, 9).split("").map(Number);
  const digit = (digits: number[]) => {
    const sum = digits.reduce((acc, d, i) => acc + d * (digits.length + 1 - i), 0);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  const d1 = digit(base);
  const d2 = digit([...base, d1]);
  return [...base, d1, d2].join("");
}

async function clearAuthBuckets(): Promise<void> {
  await db.delete(rateLimitBucketsTable).where(or(
    like(rateLimitBucketsTable.key, "auth:%"),
    like(rateLimitBucketsTable.key, "register:%"),
  ));
}

beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) => (error ? reject(error) : resolve()));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  doctorEmail = `hardening-doctor-${suffix}@example.test`;
  secretaryEmail = `hardening-secretary-${suffix}@example.test`;
  const senhaHash = await hashPassword(password);
  const [doctor] = await db.insert(doctorsTable).values({
    nome: "Hardening Doctor", email: doctorEmail, senhaHash, isFree: true,
  }).returning();
  doctorId = doctor!.id;
  createdDoctorIds.push(doctorId);
  const [secretary] = await db.insert(secretariesTable).values({
    doctorId, nome: "Hardening Secretary", email: secretaryEmail, senhaHash,
  }).returning();
  secretaryId = secretary!.id;
});

afterEach(async () => {
  delete process.env["DOCREGEN_ENFORCE_RATE_LIMITS"];
  await clearAuthBuckets();
  await db.delete(authLockoutsTable);
});

afterAll(async () => {
  if (createdDoctorIds.length) {
    await db.delete(adminContactMessages).where(inArray(adminContactMessages.doctorId, createdDoctorIds));
    await db.delete(doctorsTable).where(inArray(doctorsTable.id, createdDoctorIds));
  }
  await db.delete(doctorsTable).where(like(doctorsTable.email, `%-${suffix}@example.test`));
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
});

describe("per-IP auth limiter on every credential endpoint", () => {
  const routes: Array<[string, () => { path: string; body: unknown }]> = [
    ["doctor login", () => ({ path: "/regen-api/auth/login", body: { email: `nobody-${randomUUID()}@example.test`, senha: "wrong-password" } })],
    ["secretary login", () => ({ path: "/regen-api/secretary-auth/login", body: { email: `nobody-${randomUUID()}@example.test`, senha: "wrong-password" } })],
    ["follow-up link CPF verification", () => ({ path: `/regen-api/patient/regen/${randomUUID()}/verify`, body: { cpf: "529.982.247-25" } })],
    ["pré-consulta CPF verification", () => ({ path: `/regen-api/pre-consult/${randomUUID()}/verify`, body: { cpf: "529.982.247-25" } })],
    ["password change", () => ({ path: "/regen-api/auth/change-password", body: { senhaAtual: "x", novaSenha: "yyyyyyyy" } })],
  ];

  for (const [label, build] of routes) {
    it(`${label}: 11th failed attempt from one IP is 429`, async () => {
      process.env["DOCREGEN_ENFORCE_RATE_LIMITS"] = "1";
      await clearAuthBuckets();
      const statuses: number[] = [];
      for (let i = 0; i < 11; i++) {
        const { path, body } = build();
        statuses.push((await post(path, body)).status);
      }
      expect(statuses.slice(0, 10).every((status) => status !== 429)).toBe(true);
      expect(statuses[10]).toBe(429);
    });
  }

  it("password reset request and confirmation stay rate limited", async () => {
    process.env["DOCREGEN_ENFORCE_RATE_LIMITS"] = "1";
    await db.delete(rateLimitBucketsTable).where(like(rateLimitBucketsTable.key, "pwreset:%"));
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await post("/regen-api/auth/forgot-password", { email: `x-${i}@example.test` })).status);
    }
    expect(statuses[5]).toBe(429);
    await db.delete(rateLimitBucketsTable).where(like(rateLimitBucketsTable.key, "pwreset:%"));
  });

  it("stores the counters in the database (shared by all instances)", async () => {
    process.env["DOCREGEN_ENFORCE_RATE_LIMITS"] = "1";
    await post("/regen-api/secretary-auth/login", { email: `nobody-${randomUUID()}@example.test`, senha: "wrong-password" });
    const rows = await db.select().from(rateLimitBucketsTable).where(like(rateLimitBucketsTable.key, "auth:%"));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => !row.key.includes("@"))).toBe(true);
  });
});

describe("per-account lockout (DB-backed, independent of IP)", () => {
  it("locks a doctor account after repeated failures, even for the right password", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < ACCOUNT_LOCKOUT.MAX_FAILURES; i++) {
      // Mixed case: the same normalized account.
      const email = i % 2 ? doctorEmail.toUpperCase() : doctorEmail;
      statuses.push((await post("/regen-api/auth/login", { email, senha: "wrong-password" })).status);
    }
    expect(statuses.slice(0, -1).every((status) => status === 401)).toBe(true);
    expect(statuses.at(-1)).toBe(429);

    const locked = await post("/regen-api/auth/login", { email: doctorEmail, senha: password });
    expect(locked.status).toBe(429);
    expect((await locked.json() as { code: string }).code).toBe("ACCOUNT_LOCKED");

    const [row] = await db.select().from(authLockoutsTable);
    expect(row?.keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.lockedUntil).toBeTruthy();
  });

  it("locks a secretary account after repeated failures", async () => {
    for (let i = 0; i < ACCOUNT_LOCKOUT.MAX_FAILURES; i++) {
      await post("/regen-api/secretary-auth/login", { email: secretaryEmail, senha: "wrong-password" });
    }
    const locked = await post("/regen-api/secretary-auth/login", { email: secretaryEmail, senha: password });
    expect(locked.status).toBe(429);
  });

  it("a successful login resets the failure counter", async () => {
    for (let i = 0; i < ACCOUNT_LOCKOUT.MAX_FAILURES - 2; i++) {
      await post("/regen-api/auth/login", { email: doctorEmail, senha: "wrong-password" });
    }
    expect((await post("/regen-api/auth/login", { email: doctorEmail, senha: password })).status).toBe(200);
    const rows = await db.select().from(authLockoutsTable);
    expect(rows).toHaveLength(0);
  });

  it("an expired lock lets the account log in again", async () => {
    for (let i = 0; i < ACCOUNT_LOCKOUT.MAX_FAILURES; i++) {
      await post("/regen-api/auth/login", { email: doctorEmail, senha: "wrong-password" });
    }
    await db.update(authLockoutsTable).set({
      lockedUntil: sql`now() - interval '1 second'`,
      windowStartedAt: sql`now() - interval '1 hour'`,
    });
    expect((await post("/regen-api/auth/login", { email: doctorEmail, senha: password })).status).toBe(200);
  });
});

describe("secretary password policy", () => {
  it("rejects secretary passwords shorter than 8 characters", async () => {
    const auth = signToken({ doctorId, isAdmin: false, sessionVersion: 0 });
    const headers = { Authorization: `Bearer ${auth}` };
    const short = await post("/regen-api/secretaries", { nome: "Sec Curta", email: `short-${suffix}@example.test`, senha: "1234567" }, headers);
    expect(short.status).toBe(400);
    const ok = await post("/regen-api/secretaries", { nome: "Sec Longa", email: `Long-${suffix}@Example.test`, senha: "12345678" }, headers);
    expect(ok.status).toBe(201);
    const created = await ok.json() as { id: number; email: string };
    expect(created.email).toBe(`long-${suffix}@example.test`);
    await db.delete(secretariesTable).where(eq(secretariesTable.id, created.id));
  });
});

describe("registration validation and e-mail normalization", () => {
  const base = (overrides: Record<string, unknown>) => ({
    nome: "Dra. Cadastro",
    email: `register-${randomUUID().slice(0, 8)}-${suffix}@example.test`,
    senha: "senha-forte-1",
    crm: String(Math.floor(Math.random() * 900000) + 100000),
    crmEstado: "SP",
    cpf: validCpf(Math.floor(Math.random() * 1e8)),
    ...overrides,
  });

  it("rejects an empty or short password", async () => {
    expect((await post("/regen-api/auth/register", base({ senha: "" }))).status).toBe(400);
    expect((await post("/regen-api/auth/register", base({ senha: "1234567" }))).status).toBe(400);
  });

  it("rejects a malformed e-mail", async () => {
    expect((await post("/regen-api/auth/register", base({ email: "not-an-email" }))).status).toBe(400);
  });

  it("rejects an invalid doctor CPF", async () => {
    const response = await post("/regen-api/auth/register", base({ cpf: "111.111.111-11" }));
    expect(response.status).toBe(400);
    expect((await response.json() as { error: string }).error).toMatch(/CPF/);
  });

  it("stores e-mails lowercase, rejects case-variant duplicates and logs in with any case", async () => {
    const mixed = `Mixed.Case-${suffix}@Example.TEST`;
    const created = await post("/regen-api/auth/register", base({ email: mixed }));
    expect(created.status).toBe(201);
    const { doctor } = await created.json() as { doctor: { id: number; email: string } };
    createdDoctorIds.push(doctor.id);
    expect(doctor.email).toBe(mixed.toLowerCase());

    const duplicate = await post("/regen-api/auth/register", base({ email: mixed.toLowerCase() }));
    expect(duplicate.status).toBe(409);

    const login = await post("/regen-api/auth/login", { email: mixed.toUpperCase(), senha: "senha-forte-1" });
    expect(login.status).toBe(200);
  });

  it("the database rejects a case-variant duplicate e-mail", async () => {
    const email = `unique-${suffix}@example.test`;
    const senhaHash = await hashPassword(password);
    const [first] = await db.insert(doctorsTable).values({ nome: "Unique A", email, senhaHash }).returning();
    createdDoctorIds.push(first!.id);
    await expect(
      db.insert(doctorsTable).values({ nome: "Unique B", email: email.toUpperCase(), senhaHash }),
    ).rejects.toThrow();
  });
});

describe("logout revokes the session server-side", () => {
  it("doctor token stops working after logout", async () => {
    const [doctor] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, doctorId));
    const token = signToken({ doctorId, isAdmin: false, sessionVersion: doctor!.sessionVersion });
    const auth = { Authorization: `Bearer ${token}` };
    expect((await fetch(`${baseUrl}/regen-api/auth/me`, { headers: auth })).status).toBe(200);
    expect((await post("/regen-api/auth/logout", {}, auth)).status).toBe(200);
    expect((await fetch(`${baseUrl}/regen-api/auth/me`, { headers: auth })).status).toBe(401);
  });

  it("secretary token stops working after logout", async () => {
    const [secretary] = await db.select().from(secretariesTable).where(eq(secretariesTable.id, secretaryId));
    const token = signSecretaryToken({ secretaryId, doctorId, sessionVersion: secretary!.sessionVersion });
    const auth = { Authorization: `Bearer ${token}` };
    expect((await fetch(`${baseUrl}/regen-api/secretary-auth/me`, { headers: auth })).status).toBe(200);
    expect((await post("/regen-api/auth/logout", {}, auth)).status).toBe(200);
    expect((await fetch(`${baseUrl}/regen-api/secretary-auth/me`, { headers: auth })).status).toBe(401);
  });
});

describe("/admin/contact with a revoked session", () => {
  it("does not attribute the message to the doctor", async () => {
    const [doctor] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, doctorId));
    const staleToken = signToken({ doctorId, isAdmin: false, sessionVersion: doctor!.sessionVersion });
    await db.update(doctorsTable).set({ sessionVersion: sql`${doctorsTable.sessionVersion} + 1` }).where(eq(doctorsTable.id, doctorId));
    const response = await post("/regen-api/admin/contact", { mensagem: "mensagem de teste revogada" }, { Authorization: `Bearer ${staleToken}` });
    expect(response.status).toBe(201);
    expect((await response.json() as { doctorId: number | null }).doctorId).toBeNull();

    const [fresh] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, doctorId));
    const validToken = signToken({ doctorId, isAdmin: false, sessionVersion: fresh!.sessionVersion });
    const attributed = await post("/regen-api/admin/contact", { mensagem: "mensagem de teste válida" }, { Authorization: `Bearer ${validToken}` });
    expect((await attributed.json() as { doctorId: number | null }).doctorId).toBe(doctorId);
  });
});

describe("client errors are 400, not 500", () => {
  it("malformed JSON body", async () => {
    const response = await post("/regen-api/auth/login", "{not json");
    expect(response.status).toBe(400);
    expect((await response.json() as { code: string }).code).toBe("INVALID_JSON");
  });

  it("non-string CPF on the follow-up link verification", async () => {
    const response = await post(`/regen-api/patient/regen/${randomUUID()}/verify`, { cpf: 12345678901 });
    expect(response.status).toBe(400);
  });
});
