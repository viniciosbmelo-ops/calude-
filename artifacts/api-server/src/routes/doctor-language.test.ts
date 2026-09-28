import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, doctorsTable } from "@workspace/db";
import app from "../app";
import { hashPassword, signToken } from "../lib/auth";

let server: Server;
let baseUrl: string;
let doctorId: number;
let token: string;

beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const [doctor] = await db.insert(doctorsTable).values({
    nome: "Language Test Doctor",
    email: `language-${randomUUID()}@example.test`,
    senhaHash: await hashPassword("strong-password-123"),
    crm: "12345",
    crmEstado: "SP",
    cpf: "12345678901",
  }).returning();

  doctorId = doctor.id;
  token = signToken({
    doctorId,
    isAdmin: doctor.isAdmin,
    sessionVersion: doctor.sessionVersion,
  });
});

afterAll(async () => {
  if (doctorId) await db.delete(doctorsTable).where(eq(doctorsTable.id, doctorId));
  await new Promise<void>((resolve, reject) => {
    server.close(error => (error ? reject(error) : resolve()));
  });
});

async function patchLanguage(idioma: string): Promise<Response> {
  return fetch(`${baseUrl}/api/doctors/${doctorId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ idioma }),
  });
}

describe.sequential("doctor language preference", () => {
  it("defaults existing and new profiles to Portuguese", async () => {
    const response = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { idioma: string };
    expect(body.idioma).toBe("pt-BR");
  });

  it("persists Spanish and returns it in the authenticated profile", async () => {
    const update = await patchLanguage("es");
    expect(update.status).toBe(200);
    const updateBody = await update.json() as { idioma: string };
    expect(updateBody.idioma).toBe("es");

    const [stored] = await db
      .select({ idioma: doctorsTable.idioma })
      .from(doctorsTable)
      .where(eq(doctorsTable.id, doctorId))
      .limit(1);
    expect(stored.idioma).toBe("es");

    const me = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const meBody = await me.json() as { idioma: string };
    expect(meBody.idioma).toBe("es");
  });

  it("rejects unsupported languages without changing the preference", async () => {
    const update = await patchLanguage("en");
    expect(update.status).toBe(400);

    const [stored] = await db
      .select({ idioma: doctorsTable.idioma })
      .from(doctorsTable)
      .where(eq(doctorsTable.id, doctorId))
      .limit(1);
    expect(stored.idioma).toBe("es");
  });
});