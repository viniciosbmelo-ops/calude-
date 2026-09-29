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
 * Patient-facing links must open in the frontend that generated them: DocRegen
 * requests (X-App: docregen) get /docregen/... links, everything else keeps
 * the historical root links used by DocKnee.
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
  const response = await doctorRequest(`/api/patients/${patientId}/pre-consult/invite`, "POST", appHeader, {});
  expect(response.status).toBe(201);
  return response.json() as Promise<{ link: string; whatsappMessage: string }>;
}

describe("app-aware patient links", () => {
  it("keeps the root pre-consultation link when no app is declared (DocKnee)", async () => {
    const body = await inviteLink();
    expect(body.link).toMatch(new RegExp(`^${DOCREGEN_APP_URL}/pre-consulta/[A-Za-z0-9_-]+$`));
    expect(body.whatsappMessage).toContain(body.link);
  });

  it("points DocRegen pre-consultation invites at /docregen", async () => {
    const body = await inviteLink("docregen");
    expect(body.link).toMatch(new RegExp(`^${DOCREGEN_APP_URL}/docregen/pre-consulta/[A-Za-z0-9_-]+$`));
    expect(body.whatsappMessage).toContain(body.link);
  });

  it("ignores unknown app identifiers instead of building URLs from them", async () => {
    for (const header of ["https://evil.example", "/evil", "docregen/../x"]) {
      const body = await inviteLink(header);
      expect(body.link.startsWith(`${DOCREGEN_APP_URL}/pre-consulta/`)).toBe(true);
      expect(body.link).not.toContain("evil");
    }
  });

  it("routes regenerative follow-up links through the calling app", async () => {
    const path = `/api/regen/cases/${caseId}/notifications/${notificationId}/prepare-whatsapp`;

    const docknee = await doctorRequest(path, "POST");
    expect(docknee.status).toBe(200);
    const dockneeBody = await docknee.json() as { link: string; token: string; message: string };
    expect(dockneeBody.link).toBe(`${DOCREGEN_APP_URL}/patient/regen/${dockneeBody.token}`);

    const docregen = await doctorRequest(path, "POST", "docregen");
    expect(docregen.status).toBe(200);
    const docregenBody = await docregen.json() as { link: string; token: string; message: string };
    expect(docregenBody.token).toBe(dockneeBody.token);
    expect(docregenBody.link).toBe(`${DOCREGEN_APP_URL}/docregen/patient/regen/${docregenBody.token}`);
    expect(docregenBody.message).toContain(docregenBody.link);
  });

  it("routes patient-orientation links through the calling app", async () => {
    const docknee = await doctorRequest("/api/patient-orientations/token", "POST", undefined, { procKey: "prp_articular" });
    expect(docknee.status).toBe(201);
    const dockneeBody = await docknee.json() as { preUrl: string; posUrl: string };
    expect(dockneeBody.preUrl.startsWith(`${DOCREGEN_APP_URL}/orientacoes-paciente?token=`)).toBe(true);

    const docregen = await doctorRequest("/api/patient-orientations/token", "POST", "docregen", { procKey: "prp_articular" });
    expect(docregen.status).toBe(201);
    const docregenBody = await docregen.json() as { preUrl: string; posUrl: string };
    expect(docregenBody.preUrl.startsWith(`${DOCREGEN_APP_URL}/docregen/orientacoes-paciente?token=`)).toBe(true);
    expect(docregenBody.posUrl.startsWith(`${DOCREGEN_APP_URL}/docregen/orientacoes-paciente?token=`)).toBe(true);
  });
});
