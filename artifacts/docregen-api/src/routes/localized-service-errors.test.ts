import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, doctorsTable, patientsTable } from "@workspace/docregen-db";
import app from "../app";
import { hashPassword, signToken } from "../lib/auth";

let server: Server;
let baseUrl: string;
let doctorId: number;
let authorization: string;
let patientId: number;

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
  const [patient] = await db.insert(patientsTable).values({
    doctorId,
    nome: "Paciente de errores localizados",
  }).returning();
  patientId = patient.id;
  authorization = `Bearer ${signToken({
    doctorId,
    isAdmin: doctor.isAdmin,
    sessionVersion: doctor.sessionVersion,
  })}`;
});

afterAll(async () => {
  if (patientId) await db.delete(patientsTable).where(eq(patientsTable.id, patientId));
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

const UPLOAD_URL = "/regen-api/storage/uploads/request-url";

describe.sequential("localized upload errors", () => {
  it("localizes upload validation while preserving status and JSON contract", async () => {
    const missing = await request(UPLOAD_URL, {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(missing.status).toBe(400);
    await expect(missing.json()).resolves.toEqual({ error: "Datos del paciente no válidos." });

    const withoutPatient = await request(UPLOAD_URL, {
      method: "POST",
      body: JSON.stringify({ purpose: "patient_attachment", name: "a.pdf", contentType: "application/pdf", size: 10 }),
    });
    expect(withoutPatient.status).toBe(400);
    await expect(withoutPatient.json()).resolves.toEqual({ error: "ID de paciente no válido." });

    const otherDoctorsPatient = await request(UPLOAD_URL, {
      method: "POST",
      body: JSON.stringify({
        purpose: "patient_attachment",
        patientId: 2147483647,
        name: "a.pdf",
        contentType: "application/pdf",
        size: 10,
      }),
    });
    expect(otherDoctorsPatient.status).toBe(404);
    await expect(otherDoctorsPatient.json()).resolves.toEqual({ error: "Paciente no encontrado." });

    const unsupported = await request(UPLOAD_URL, {
      method: "POST",
      body: JSON.stringify({
        purpose: "patient_attachment",
        patientId,
        name: "archivo.svg",
        contentType: "image/svg+xml",
        size: 10,
      }),
    });
    expect(unsupported.status).toBe(400);
    await expect(unsupported.json()).resolves.toEqual({ error: "Tipo de archivo no permitido" });

    // Cached PWA bundles send fileName/mimeType instead of name/contentType.
    const tooLarge = await request(UPLOAD_URL, {
      method: "POST",
      body: JSON.stringify({
        purpose: "patient_attachment",
        patientId,
        fileName: "foto.jpg",
        mimeType: "image/jpeg",
        size: 1024 * 1024 * 1024,
      }),
    });
    expect(tooLarge.status).toBe(400);
    const tooLargeBody = await tooLarge.json() as { error: string };
    expect(tooLargeBody.error).toMatch(/^Archivo demasiado grande \(máximo \d+ MB para este tipo\)$/);
  });

  it("uses Portuguese for unsupported doctor locales", async () => {
    await db.update(doctorsTable).set({ idioma: "unsupported-locale" }).where(eq(doctorsTable.id, doctorId));

    const fallback = await request(UPLOAD_URL, {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(fallback.status).toBe(400);
    await expect(fallback.json()).resolves.toEqual({ error: "Dados do paciente inválidos." });
  });

  it("does not expose DocKnee's surgical media or institutional service routes", async () => {
    for (const path of ["/regen-api/media/request-upload-url", "/regen-api/doctor/locations", "/regen-api/service-auth/login"]) {
      const response = await request(path, { method: "POST", body: JSON.stringify({}) });
      expect(response.status, path).toBe(404);
    }
  });
});
