/**
 * One redaction function for page_visits, audit_logs, pino request logs and
 * security events; audit rows carry the right resource and actor.
 */
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import {
  auditLogsTable,
  db,
  doctorsTable,
  pageVisitsTable,
  patientsTable,
  secretariesTable,
} from "@workspace/docregen-db";
import app, { privacySafeRequestPath, serializeRequestForLog } from "../app";
import { signSecretaryToken, signToken } from "../lib/auth";
import { redactPath, redactUrlForLog } from "../lib/redaction";
import { extractResource, privacySafeAuditPath } from "../middlewares/auditLog";
import { privacySafeVisitPath } from "./stats";
import { buildSecurityAlertHtml, scrubSecurityDetails } from "../lib/securityMonitor";

let server: Server;
let baseUrl: string;
let doctorId: number;
let secretaryId: number;
let patientId: number;
let doctorAuth: string;
let secretaryAuth: string;
const startedAt = new Date(Date.now() - 1000);
const TOKEN = "Zk3v9_rawSecretToken-abc";
const UUID = randomUUID();
const PDF_ID = "0123456789abcdef0123456789abcdef";

beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) => (error ? reject(error) : resolve()));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const suffix = randomUUID();
  const [doctor] = await db.insert(doctorsTable).values({
    nome: "Audit Doctor", email: `audit-${suffix}@example.test`, senhaHash: "x", isFree: true,
  }).returning();
  doctorId = doctor!.id;
  const [secretary] = await db.insert(secretariesTable).values({
    doctorId, nome: "Audit Secretary", email: `audit-sec-${suffix}@example.test`, senhaHash: "x",
  }).returning();
  secretaryId = secretary!.id;
  const [patient] = await db.insert(patientsTable).values({ doctorId, nome: "AUDIT PATIENT" }).returning();
  patientId = patient!.id;
  doctorAuth = signToken({ doctorId, isAdmin: false, sessionVersion: 0 });
  secretaryAuth = signSecretaryToken({ secretaryId, doctorId, sessionVersion: 0 });
});

afterAll(async () => {
  await db.delete(auditLogsTable).where(eq(auditLogsTable.doctorId, doctorId));
  await db.delete(doctorsTable).where(eq(doctorsTable.id, doctorId));
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
});

async function waitForAudit(where: Parameters<typeof and>[0]) {
  for (let i = 0; i < 50; i++) {
    const rows = await db.select().from(auditLogsTable)
      .where(and(gte(auditLogsTable.createdAt, startedAt), where))
      .orderBy(desc(auditLogsTable.id));
    if (rows.length) return rows;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return [];
}

describe("shared path redaction", () => {
  it.each([
    [`/regen-api/pre-consult/${TOKEN}/answers?x=1`, "/regen-api/pre-consult/:token/answers"],
    [`/regen-api/patient/regen/${UUID}/verify`, "/regen-api/patient/regen/:token/verify"],
    [`/regen-api/patient-orientations/${TOKEN}`, "/regen-api/patient-orientations/:token"],
    [`/regen-api/pdf/temp/${PDF_ID}`, "/regen-api/pdf/temp/:id"],
    [`/pre-consulta/${TOKEN}`, "/pre-consulta/:token"],
    [`/patient/regen/${UUID}`, "/patient/regen/:token"],
    [`/redefinir-senha?token=${TOKEN}`, "/redefinir-senha"],
  ])("%s → %s", (input, expected) => {
    expect(redactPath(input)).toBe(expected);
    expect(privacySafeRequestPath(input)).toBe(expected);
    expect(privacySafeAuditPath(input)).toBe(expected);
  });

  it("strips the /docregen SPA base for page visits (the VisitTracker sends the full pathname)", () => {
    expect(privacySafeVisitPath(`/docregen/pre-consulta/${TOKEN}`)).toBe("/pre-consulta/:token");
    expect(privacySafeVisitPath(`/docregen/patient/regen/${UUID}`)).toBe("/patient/regen/:token");
    expect(privacySafeVisitPath(`/docregen/orientacoes-paciente?token=${TOKEN}`)).toBe("/orientacoes-paciente");
    expect(privacySafeVisitPath(`/docregen/redefinir-senha?token=${TOKEN}`)).toBe("/redefinir-senha");
    expect(privacySafeVisitPath("/docregen/login")).toBe("/login");
  });

  it("masks secret query values in log URLs and keeps the rest", () => {
    expect(redactUrlForLog(`/regen-api/pre-consult/${TOKEN}/form?token=${TOKEN}&lang=es`))
      .toBe("/regen-api/pre-consult/:token/form?token=:redacted&lang=es");
    const serialized = serializeRequestForLog({ id: 1, method: "GET", url: `/regen-api/patient/regen/${UUID}?t=${TOKEN}` });
    expect(JSON.stringify(serialized)).not.toContain(UUID);
    expect(JSON.stringify(serialized)).not.toContain(TOKEN);
  });

  it("security events hash identifiers and alert e-mails escape HTML", () => {
    const scrubbed = scrubSecurityDetails("login id=maria@example.com cpf 529.982.247-25");
    expect(scrubbed).not.toContain("maria@example.com");
    expect(scrubbed).not.toContain("529.982.247-25");
    const html = buildSecurityAlertHtml("auth_failure", 3, `<script>alert(1)</script>`);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("page_visits never store link tokens", () => {
  it("stores the redacted path and classifies public pages after stripping the base", async () => {
    for (const path of [`/docregen/pre-consulta/${TOKEN}`, `/docregen/patient/regen/${UUID}`, "/docregen/login"]) {
      const response = await fetch(`${baseUrl}/regen-api/stats/visit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      expect(response.status).toBe(204);
    }
    const rows = await db.select().from(pageVisitsTable).where(gte(pageVisitsTable.createdAt, startedAt));
    const paths = rows.map((row) => row.path);
    expect(paths).toContain("/pre-consulta/:token");
    expect(paths).toContain("/patient/regen/:token");
    expect(JSON.stringify(rows)).not.toContain(TOKEN);
    expect(JSON.stringify(rows)).not.toContain(UUID);
    expect(rows.find((row) => row.path === "/login")?.accessType).toBe("site");
    await db.delete(pageVisitsTable).where(inArray(pageVisitsTable.id, rows.map((row) => row.id)));
  });
});

describe("audit trail", () => {
  it("extracts the resource with or without the API prefix", () => {
    expect(extractResource(`/regen-api/patients/${12}`)).toEqual({ resourceType: "patients", resourceId: "12" });
    expect(extractResource(`/patients/12/attachments`)).toEqual({ resourceType: "patients", resourceId: "12" });
    expect(extractResource(`/regen-api/regen/cases/${UUID}/procedures`)).toEqual({ resourceType: "regen/cases", resourceId: UUID });
    expect(extractResource("/regen-api/pre-consult/:token/answers")).toEqual({ resourceType: "pre-consult", resourceId: null });
  });

  it("records resource and doctor actor for a doctor request", async () => {
    await fetch(`${baseUrl}/regen-api/patients/${patientId}`, { headers: { Authorization: `Bearer ${doctorAuth}` } });
    const [row] = await waitForAudit(and(
      eq(auditLogsTable.doctorId, doctorId),
      eq(auditLogsTable.endpoint, `/regen-api/patients/${patientId}`),
    ));
    expect(row).toMatchObject({
      actorRole: "doctor",
      secretaryId: null,
      resourceType: "patients",
      resourceId: String(patientId),
    });
  });

  it("records the secretary as the actor (not the doctor)", async () => {
    await fetch(`${baseUrl}/regen-api/patients`, { headers: { Authorization: `Bearer ${secretaryAuth}` } });
    const [row] = await waitForAudit(and(
      eq(auditLogsTable.secretaryId, secretaryId),
      eq(auditLogsTable.endpoint, "/regen-api/patients"),
    ));
    expect(row).toMatchObject({ actorRole: "secretary", doctorId, resourceType: "patients" });
  });

  it("records public-link access as patient_link with a token hash, never the token", async () => {
    await fetch(`${baseUrl}/regen-api/patient/regen/${UUID}`);
    const hash = createHash("sha256").update(UUID).digest("hex");
    const [row] = await waitForAudit(eq(auditLogsTable.patientLinkHash, hash));
    expect(row).toMatchObject({
      actorRole: "patient_link",
      doctorId: null,
      endpoint: "/regen-api/patient/regen/:token",
      resourceType: "patient/regen",
    });
    expect(JSON.stringify(row)).not.toContain(UUID);
    await db.delete(auditLogsTable).where(eq(auditLogsTable.patientLinkHash, hash));
  });

  it("anonymous requests are labelled anonymous", async () => {
    await fetch(`${baseUrl}/regen-api/auth/config`);
    const [row] = await waitForAudit(eq(auditLogsTable.endpoint, "/regen-api/auth/config"));
    expect(row?.actorRole).toBe("anonymous");
  });
});
