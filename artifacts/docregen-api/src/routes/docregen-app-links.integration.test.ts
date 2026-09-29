import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  db,
  doctorsTable,
  patientsTable,
  regenCasesTable,
  regenFollowupNotificationsTable,
} from "@workspace/docregen-db";
import app from "../app";
import { signToken } from "../lib/auth";

/**
 * DocRegen is independent from DocKnee: every patient-facing link the DocRegen
 * API builds points to the DocRegen frontend (/docregen/...) and carries
 * DocRegen branding. There is no calling-app flag — an X-App header (the old
 * shared-API mechanism) is ignored and can never produce a DocKnee link.
 */

const DOCREGEN_APP_URL = "https://links.example";
const originalAppUrl = process.env["DOCREGEN_APP_URL"];

let server: Server;
let baseUrl: string;
let doctorId: number;
let patientId: number;
let caseId: string;
let notificationId: string;
let auth: string;

function doctorRequest(path: string, method: string, appHeader?: string, body?: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${auth}`,
      "Content-Type": "application/json",
      ...(appHeader === undefined ? {} : { "X-App": appHeader }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeAll(async () => {
  process.env["DOCREGEN_APP_URL"] = DOCREGEN_APP_URL;
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) => (error ? reject(error) : resolve()));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const [doctor] = await db.insert(doctorsTable).values({
    nome: "DocRegen Links Doctor",
    email: `docregen-links-${randomUUID()}@example.test`,
    senhaHash: "unused",
    isFree: true,
  }).returning();
  doctorId = doctor.id;
  auth = signToken({ doctorId, isAdmin: false, sessionVersion: doctor.sessionVersion });

  const [patient] = await db.insert(patientsTable).values({
    doctorId,
    nome: "DOCREGEN LINKS PATIENT",
    cpf: "52998224725",
    telefone: "11999990000",
  }).returning();
  patientId = patient.id;

  const [regenCase] = await db.insert(regenCasesTable).values({
    doctorId,
    patientId,
    patientName: "DOCREGEN LINKS PATIENT",
    conditionCode: "knee_oa",
  }).returning();
  caseId = regenCase.id;

  const [notification] = await db.insert(regenFollowupNotificationsTable).values({
    caseId,
    periodo: "1 mês",
    daysAfterProcedure: 30,
    scheduledDate: "2099-01-01",
    scales: ["VAS Dor"],
  }).returning();
  notificationId = notification.id;
});

afterAll(async () => {
  if (caseId) await db.delete(regenCasesTable).where(eq(regenCasesTable.id, caseId));
  if (doctorId) await db.delete(doctorsTable).where(eq(doctorsTable.id, doctorId));
  if (originalAppUrl === undefined) delete process.env["DOCREGEN_APP_URL"];
  else process.env["DOCREGEN_APP_URL"] = originalAppUrl;
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

async function inviteLink(appHeader?: string): Promise<{ link: string; whatsappMessage: string }> {
  const response = await doctorRequest(`/regen-api/patients/${patientId}/pre-consult/invite`, "POST", appHeader, {});
  expect(response.status).toBe(201);
  return response.json() as Promise<{ link: string; whatsappMessage: string }>;
}

const BRAND_LEAKS = /DocKnee|DocSholder/i;

describe("DocRegen patient links", () => {
  it("always points pre-consultation invites at /docregen without DocKnee branding", async () => {
    const body = await inviteLink();
    expect(body.link).toMatch(new RegExp(`^${DOCREGEN_APP_URL}/docregen/pre-consulta/[A-Za-z0-9_-]+$`));
    expect(body.whatsappMessage).toContain(body.link);
    expect(body.whatsappMessage).not.toMatch(BRAND_LEAKS);
  });

  it("ignores any X-App header (no DocKnee links, no URLs built from it)", async () => {
    for (const header of ["docknee", "docregen", "https://evil.example", "/evil", "docregen/../x"]) {
      const body = await inviteLink(header);
      expect(body.link).toMatch(new RegExp(`^${DOCREGEN_APP_URL}/docregen/pre-consulta/[A-Za-z0-9_-]+$`));
      expect(body.link).not.toContain("evil");
    }
  });

  it("always builds regenerative follow-up links under /docregen", async () => {
    const path = `/regen-api/regen/cases/${caseId}/notifications/${notificationId}/prepare-whatsapp`;

    const first = await doctorRequest(path, "POST");
    expect(first.status).toBe(200);
    const firstBody = await first.json() as { link: string; token: string; message: string };
    expect(firstBody.link).toBe(`${DOCREGEN_APP_URL}/docregen/patient/regen/${firstBody.token}`);
    expect(firstBody.message).toContain(firstBody.link);
    expect(firstBody.message).not.toMatch(BRAND_LEAKS);

    const withLegacyHeader = await doctorRequest(path, "POST", "docknee");
    expect(withLegacyHeader.status).toBe(200);
    const secondBody = await withLegacyHeader.json() as { link: string; token: string };
    expect(secondBody.token).toBe(firstBody.token);
    expect(secondBody.link).toBe(firstBody.link);
  });

  it("always builds patient-orientation links under /docregen", async () => {
    for (const header of [undefined, "docknee"]) {
      const response = await doctorRequest("/regen-api/patient-orientations/token", "POST", header, { procKey: "prp_articular" });
      expect(response.status).toBe(201);
      const body = await response.json() as { preUrl: string; posUrl: string };
      expect(body.preUrl.startsWith(`${DOCREGEN_APP_URL}/docregen/orientacoes-paciente?token=`)).toBe(true);
      expect(body.posUrl.startsWith(`${DOCREGEN_APP_URL}/docregen/orientacoes-paciente?token=`)).toBe(true);
    }
  });
});
