import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  appointmentsTable,
  db,
  doctorsTable,
  patientsTable,
  physioAppointmentsTable,
  physioFollowupsTable,
  physioPatientsTable,
  physiotherapistsTable,
  surgeriesTable,
} from "@workspace/db";
import app from "../app";
import { signPhysioToken, signToken } from "../lib/auth";

/**
 * "Today" and report periods follow the clinic calendar (America/Sao_Paulo)
 * even with the server in UTC. The clock is frozen at 23:30 in Brasília on
 * 29/09/2026 (= 02:30 UTC on 30/09), where the old UTC-based code already
 * counted the 30th.
 */

let server: Server;
let baseUrl: string;
let doctorId: number;
let physioId: number;
let doctorAuth: string;
let physioAuth: string;
const surgeryIds: number[] = [];
const originalTz = process.env.TZ;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const j = (res: Response): Promise<any> => res.json();

function call(path: string, token: string): Promise<Response> {
  return fetch(`${baseUrl}/api${path}`, { headers: { Authorization: `Bearer ${token}` } });
}

beforeAll(async () => {
  process.env.TZ = "UTC";
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-29T23:30:00-03:00"));

  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) => (error ? reject(error) : resolve()));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const [doctor] = await db
    .insert(doctorsTable)
    .values({
      nome: "Clinic Today Doctor",
      email: `clinic-today-${randomUUID()}@example.test`,
      senhaHash: "not-used",
      isFree: true,
      // Admin so the same fixture can read /reports/admin (monthly surgeries).
      isAdmin: true,
    })
    .returning();
  doctorId = doctor.id;
  doctorAuth = signToken({ doctorId, isAdmin: true, sessionVersion: doctor.sessionVersion });

  const [patient] = await db
    .insert(patientsTable)
    .values({ doctorId, nome: "Clinic Today Patient", telefone: "5511966666666" })
    .returning();

  await db.insert(appointmentsTable).values(
    ["2026-09-26", "2026-09-29", "2026-09-29", "2026-09-30", "2026-10-03", "2026-10-04"].map((data) => ({
      doctorId,
      patientId: patient.id,
      data,
      hora: "10:00",
      tipo: "consulta",
      status: "agendado",
    })),
  );

  // Surgery created at 23:30 BRT on the last day of a (far-future) month:
  // 02:30 UTC on the 1st of the next month.
  const [surgery] = await db
    .insert(surgeriesTable)
    .values({
      doctorId,
      patientId: patient.id,
      status: "completo",
      tiposProcedimento: ["SH_CUFF"],
      createdAt: new Date("2031-01-31T23:30:00-03:00"),
    })
    .returning();
  surgeryIds.push(surgery.id);

  const [physio] = await db
    .insert(physiotherapistsTable)
    .values({
      nome: "Clinic Today Physio",
      email: `clinic-today-physio-${randomUUID()}@example.test`,
      senhaHash: "not-used",
      celular: "5511955555555",
    })
    .returning();
  physioId = physio.id;
  physioAuth = signPhysioToken({ physioId, sessionVersion: physio.sessionVersion });

  const [physioPatient] = await db
    .insert(physioPatientsTable)
    .values({ physioId, fullName: "Physio Today Patient" })
    .returning();

  await db.insert(physioFollowupsTable).values([
    { physioId, physioPatientId: physioPatient.id, title: "Ontem", dueDate: "2026-09-28" },
    { physioId, physioPatientId: physioPatient.id, title: "Hoje", dueDate: "2026-09-29" },
    { physioId, physioPatientId: physioPatient.id, title: "Amanha", dueDate: "2026-09-30" },
    { physioId, physioPatientId: physioPatient.id, title: "Em 7 dias", dueDate: "2026-10-06" },
    { physioId, physioPatientId: physioPatient.id, title: "Em 8 dias", dueDate: "2026-10-07" },
  ]);

  const at = (iso: string) => new Date(iso);
  await db.insert(physioAppointmentsTable).values([
    // 00:30 and 23:30 BRT on the 29th: today.
    { physioId, physioPatientId: physioPatient.id, startsAt: at("2026-09-29T00:30:00-03:00"), endsAt: at("2026-09-29T01:00:00-03:00") },
    { physioId, physioPatientId: physioPatient.id, startsAt: at("2026-09-29T23:30:00-03:00"), endsAt: at("2026-09-29T23:59:00-03:00") },
    // 23:30 BRT on the 28th and 00:30 BRT on the 30th: not today.
    { physioId, physioPatientId: physioPatient.id, startsAt: at("2026-09-28T23:30:00-03:00"), endsAt: at("2026-09-28T23:59:00-03:00") },
    { physioId, physioPatientId: physioPatient.id, startsAt: at("2026-09-30T00:30:00-03:00"), endsAt: at("2026-09-30T01:00:00-03:00") },
  ]);
});

afterAll(async () => {
  vi.useRealTimers();
  if (surgeryIds.length) await db.delete(surgeriesTable).where(inArray(surgeriesTable.id, surgeryIds));
  if (physioId) await db.delete(physiotherapistsTable).where(eq(physiotherapistsTable.id, physioId));
  if (doctorId) {
    await db.delete(appointmentsTable).where(eq(appointmentsTable.doctorId, doctorId));
    await db.delete(patientsTable).where(eq(patientsTable.doctorId, doctorId));
    await db.delete(doctorsTable).where(eq(doctorsTable.id, doctorId));
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe("clinic 'today' at 23:30 BRT with the server in UTC", () => {
  it("consultations report: day, Sunday–Saturday week and month of the clinic calendar", async () => {
    const dia = await j(await call("/reports/consultas?periodo=dia", doctorAuth));
    expect(dia.total).toBe(2); // the two on 2026-09-29, not the one on the 30th
    const semana = await j(await call("/reports/consultas?periodo=semana", doctorAuth));
    expect(semana.total).toBe(4); // 27/09–03/10
    const mes = await j(await call("/reports/consultas?periodo=mes", doctorAuth));
    expect(mes.total).toBe(4); // September only
  });

  it("monthly surgeries group an event at 23:30 BRT into that day's month", async () => {
    const res = await call("/reports/admin", doctorAuth);
    expect(res.status).toBe(200);
    const body = await j(res);
    const months = new Map<string, number>(body.monthlySurgeries.map((m: { month: string; count: number }) => [m.month, m.count]));
    expect(months.get("2031-01")).toBeGreaterThanOrEqual(1);
    expect(months.has("2031-02")).toBe(false);
  });

  it("physio dashboard: overdue, next 7 days and today's agenda use the clinic day", async () => {
    const res = await call("/physio/dashboard", physioAuth);
    expect(res.status).toBe(200);
    const body = await j(res);
    expect(body.followups.overdue.map((f: { title: string }) => f.title)).toEqual(["Ontem"]);
    expect(body.followups.next7days.map((f: { title: string }) => f.title)).toEqual(["Hoje", "Amanha", "Em 7 dias"]);
    expect(body.followups.upcomingCount).toBe(1);
    expect(body.todayAgenda.map((a: { startsAt: string }) => a.startsAt)).toEqual([
      "2026-09-29T03:30:00.000Z",
      "2026-09-30T02:30:00.000Z",
    ]);
  });
});
