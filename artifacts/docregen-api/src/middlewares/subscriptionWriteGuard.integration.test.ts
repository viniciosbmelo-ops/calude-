import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db, doctorsTable } from "@workspace/docregen-db";
import { eq } from "drizzle-orm";
import app from "../app";
import { signToken } from "../lib/auth";

describe.sequential("subscription write guard integration", () => {
  let server: Server;
  let baseUrl: string;
  let doctorId: number;
  let authorization: string;

  beforeAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server = app.listen(0, "127.0.0.1", (error?: Error) => error ? reject(error) : resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const [doctor] = await db.insert(doctorsTable).values({
      nome: "Guard test doctor",
      email: `subscription-guard-${randomUUID()}@example.test`,
      senhaHash: "not-used",
      isFree: false,
      isAdmin: false,
    }).returning();
    doctorId = doctor!.id;
    authorization = `Bearer ${signToken({
      doctorId,
      isAdmin: false,
      sessionVersion: doctor!.sessionVersion,
    })}`;
  });

  afterAll(async () => {
    if (doctorId) await db.delete(doctorsTable).where(eq(doctorsTable.id, doctorId));
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it("blocks a real paid clinical mutation without an active subscription", async () => {
    const response = await fetch(`${baseUrl}/regen-api/patients`, {
      method: "POST",
      headers: { Authorization: authorization, "Content-Type": "application/json" },
      body: JSON.stringify({ nome: "Must not be created" }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "SUBSCRIPTION_WRITE_REQUIRED",
      message: "Sua assinatura não permite alterações no momento.",
    });
  });

  it("preserves the authenticated billing checkout exception", async () => {
    const response = await fetch(`${baseUrl}/regen-api/stripe/checkout`, {
      method: "POST",
      headers: { Authorization: authorization, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    // The checkout handler, rather than the subscription guard, validates its input.
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "priceId é obrigatório." });
  });

  it("preserves public patient verification mutations", async () => {
    const response = await fetch(`${baseUrl}/regen-api/patient/regen/nonexistent-token/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cpf: "12345678900" }),
    });

    // No doctor session is required here; either the verification handler or
    // its public abuse limiter owns the denial, never the subscription guard.
    expect([401, 429]).toContain(response.status);
    const body = await response.json() as { error?: string };
    expect(body.error).not.toBe("SUBSCRIPTION_WRITE_REQUIRED");
    expect(body.error).not.toBe("SUBSCRIPTION_STATUS_UNAVAILABLE");
  });

  it("preserves the public support contact exception", async () => {
    const response = await fetch(`${baseUrl}/regen-api/admin/contact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Mensagem é obrigatória." });
  });
});