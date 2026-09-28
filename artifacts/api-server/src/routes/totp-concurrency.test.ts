import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, doctorsTable } from "@workspace/db";
import app from "../app";
import { hashPassword } from "../lib/auth";
import {
  encryptTotpSecret,
  generateTotpSecret,
  hashRecoveryCodes,
} from "../lib/totp";

let server: Server;
let baseUrl: string;
let doctorId: number | undefined;
let email: string;
const password = "recovery-race-test-password";
const recoveryCode = "ABCD1234EFGH";

beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  email = `totp-concurrency-${randomUUID()}@example.test`;
  const [doctor] = await db
    .insert(doctorsTable)
    .values({
      nome: "TOTP Concurrency Test",
      email,
      senhaHash: await hashPassword(password),
      aprovado: true,
      isAdmin: true,
      isFree: true,
      totpEnabled: true,
      totpSecretEnc: encryptTotpSecret(generateTotpSecret()),
      totpRecoveryCodesHash: await hashRecoveryCodes([recoveryCode]),
    })
    .returning({ id: doctorsTable.id });
  doctorId = doctor.id;
});

afterAll(async () => {
  if (doctorId !== undefined) {
    await db.delete(doctorsTable).where(eq(doctorsTable.id, doctorId));
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe("Admin login without 2FA challenge", () => {
  it("establishes a session directly when TOTP is configured", async () => {
    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, senha: password }),
    });
    expect(loginResponse.status).toBe(200);

    const loginBody = await loginResponse.json() as {
      requires2FA?: boolean;
      challengeToken?: string;
      doctor?: { id: number; isAdmin: boolean };
    };
    expect(loginBody.requires2FA).not.toBe(true);
    expect(loginBody.challengeToken).toBeUndefined();
    expect(loginBody.doctor).toMatchObject({ id: doctorId, isAdmin: true });
    expect(loginResponse.headers.get("set-cookie")).toBeTruthy();
  });
});