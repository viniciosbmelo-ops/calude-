import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, doctorsTable } from "@workspace/docregen-db";
import app from "../app";
import { hashPassword, signToken } from "../lib/auth";

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
    nome: "Localized Errors Doctor",
    email: `localized-errors-${randomUUID()}@example.test`,
    senhaHash: await hashPassword("strong-password-123"),
    crm: "54321",
    crmEstado: "SP",
    cpf: "10987654321",
    idioma: "es",
    isFree: true,
  }).returning();
  doctorId = doctor.id;
  authorization = `Bearer ${signToken({
    doctorId,
    isAdmin: doctor.isAdmin,
    sessionVersion: doctor.sessionVersion,
  })}`;
});

afterAll(async () => {
  if (doctorId) await db.delete(doctorsTable).where(eq(doctorsTable.id, doctorId));
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
});

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

describe.sequential("localized media and service errors", () => {
  it("localizes upload validation while preserving status and JSON contract", async () => {
    const missing = await request("/api/media/request-upload-url", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(missing.status).toBe(400);
    await expect(missing.json()).resolves.toEqual({
      error: "name, contentType y surgeryId son obligatorios",
    });

    const unsupported = await request("/api/media/request-upload-url", {
      method: "POST",
      body: JSON.stringify({
        surgeryId: 1,
        name: "archivo.svg",
        contentType: "image/svg+xml",
      }),
    });
    expect(unsupported.status).toBe(400);
    await expect(unsupported.json()).resolves.toEqual({ error: "Tipo de archivo no permitido" });

    const tooLarge = await request("/api/media/request-upload-url", {
      method: "POST",
      body: JSON.stringify({
        surgeryId: 1,
        name: "foto.jpg",
        contentType: "image/jpeg",
        size: 26 * 1024 * 1024,
      }),
    });
    expect(tooLarge.status).toBe(400);
    await expect(tooLarge.json()).resolves.toEqual({
      error: "Archivo demasiado grande (máximo 25 MB para este tipo)",
    });

    const cachedClientShape = await request("/api/media/request-upload-url", {
      method: "POST",
      body: JSON.stringify({
        surgeryId: 2147483647,
        fileName: "captura.png",
        mimeType: "image/png",
        size: 1024,
      }),
    });
    expect(cachedClientShape.status).toBe(404);
    await expect(cachedClientShape.json()).resolves.toEqual({
      error: "Cirugía no encontrada",
    });
  });

  it("localizes doctor service errors and preserves free identifiers verbatim", async () => {
    const location = await request("/api/doctor/locations", {
      method: "POST",
      body: JSON.stringify({ nome: "" }),
    });
    expect(location.status).toBe(400);
    await expect(location.json()).resolves.toEqual({ error: "El nombre del lugar es obligatorio." });

    const email = `Servicio-Libre-${randomUUID()}@Example.TEST`;
    const link = await request("/api/doctor/services/link", {
      method: "POST",
      body: JSON.stringify({ email, senha: "segredo" }),
    });
    expect(link.status).toBe(404);
    const body = await link.json() as { error: string };
    expect(body.error).toContain(email.toLowerCase());
    expect(body.error).toContain("No se encontró ningún servicio");
  });

  it("uses Portuguese for unsupported doctor locales and anonymous service login", async () => {
    await db.update(doctorsTable).set({ idioma: "unsupported-locale" }).where(eq(doctorsTable.id, doctorId));

    const fallback = await request("/api/media/request-upload-url", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(fallback.status).toBe(400);
    await expect(fallback.json()).resolves.toEqual({
      error: "name, contentType e surgeryId são obrigatórios",
    });

    const anonymous = await fetch(`${baseUrl}/api/service-auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(anonymous.status).toBe(400);
    await expect(anonymous.json()).resolves.toEqual({ error: "Dados de acesso inválidos." });
  });
});