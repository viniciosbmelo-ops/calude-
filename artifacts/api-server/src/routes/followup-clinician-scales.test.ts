import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  doctorsTable,
  followupTable,
  patientsTable,
  scaleResponsesTable,
  surgeriesTable,
} from "@workspace/db";
import app from "../app";
import { hashPassword, signToken } from "../lib/auth";

let server: Server;
let baseUrl: string;
let doctorAId: number;
let doctorBId: number;
let cuffSurgeryId: number;
let instabilitySurgeryId: number;
let otherDoctorSurgeryId: number;
let otherDoctorFollowupId: number;
let authA: string;

const constantAnswers = {
  pain: 10,
  sleep: 2,
  work: 3,
  recreation: 3,
  hand_position: "neck",
  flexion_deg: 140,
  abduction_deg: 100,
  er_achieved: ["hand_behind_head_elbow_forward", "hand_behind_head_elbow_back"],
  ir_position: "waist_L3",
};
// pain 10 + ADL (2+3+3+6)=14 + ROM (flex 8 + abd 6 + RE 4 + RI 6)=24 → 48 / 75 (sem dinamômetro)
const CONSTANT_EXPECTED = 48;

function cuffPayload() {
  return {
    versao: 1,
    regiao: "shoulder",
    geral: {},
    procedimentos: [{ tipoCaso: "SH_CUFF", codigo: "SH_RCT_FULL", sequencia: 1, dados: {} }],
    mapaArtroscopico: [],
    implantes: [],
  };
}

async function api(path: string, method: string, body?: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${authA}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function json(res: Response): Promise<any> {
  return res.json();
}

async function followupsOf(surgeryId: number) {
  return db.select().from(followupTable).where(eq(followupTable.surgeryId, surgeryId));
}

beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) => (error ? reject(error) : resolve()));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const suffix = randomUUID();
  const senhaHash = await hashPassword("clinician-scales-test-password");
  const [doctorA, doctorB] = await db
    .insert(doctorsTable)
    .values([
      { nome: "Clinician Scales A", email: `clin-scales-a-${suffix}@example.test`, senhaHash, isFree: true },
      { nome: "Clinician Scales B", email: `clin-scales-b-${suffix}@example.test`, senhaHash, isFree: true },
    ])
    .returning();
  doctorAId = doctorA.id;
  doctorBId = doctorB.id;

  const [patientA, patientB] = await db
    .insert(patientsTable)
    .values([
      { doctorId: doctorAId, nome: "Patient Scales A" },
      { doctorId: doctorBId, nome: "Patient Scales B" },
    ])
    .returning();

  const [cuff, instability, other] = await db
    .insert(surgeriesTable)
    .values([
      { doctorId: doctorAId, patientId: patientA.id, regiao: "shoulder", tiposProcedimento: ["SH_CUFF"], dadosClinicos: cuffPayload() },
      // Só o tipo de caso: aplicáveis vêm da patologia padrão do catálogo (SH_INST_ANT → ROWE)
      { doctorId: doctorAId, patientId: patientA.id, regiao: "shoulder", tiposProcedimento: ["SH_INSTABILITY"] },
      { doctorId: doctorBId, patientId: patientB.id, regiao: "shoulder", tiposProcedimento: ["SH_CUFF"], dadosClinicos: cuffPayload() },
    ])
    .returning();
  cuffSurgeryId = cuff.id;
  instabilitySurgeryId = instability.id;
  otherDoctorSurgeryId = other.id;

  const [otherFollowup] = await db
    .insert(followupTable)
    .values({ surgeryId: otherDoctorSurgeryId, tempo: "3 meses" })
    .returning();
  otherDoctorFollowupId = otherFollowup.id;

  authA = signToken({ doctorId: doctorAId, isAdmin: false, sessionVersion: doctorA.sessionVersion });
});

afterAll(async () => {
  for (const id of [doctorAId, doctorBId]) {
    if (id) await db.delete(doctorsTable).where(and(eq(doctorsTable.isAdmin, false), eq(doctorsTable.id, id)));
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe.sequential("clinician scales on follow-up", () => {
  it("saves Constant with the server-side score and ignores a client score", async () => {
    const res = await api("/api/followup", "POST", {
      surgeryId: cuffSurgeryId,
      tempo: "6 meses",
      vasDor: 2,
      escalasClinicas: { CONSTANT: { ...constantAnswers, score: 99, strength_kg: null } },
      score: 99,
    });
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.escalasClinicas).toEqual([
      expect.objectContaining({ escala: "CONSTANT", score: CONSTANT_EXPECTED, max: 75, versao: "constant-1987-no-strength" }),
    ]);

    const [row] = await db.select().from(scaleResponsesTable).where(eq(scaleResponsesTable.followupId, body.id));
    expect(row.nomeEscala).toBe("CONSTANT");
    expect(row.score).toBe(CONSTANT_EXPECTED);
    const stored = JSON.parse(row.respostas);
    expect(stored).not.toHaveProperty("score");
    expect(stored).not.toHaveProperty("strength_kg");

    // Upsert (mesmo follow-up, mesma escala) com dinamômetro → máximo 100
    const upd = await api(`/api/followup/${body.id}/clinician-scales`, "PUT", {
      escalasClinicas: { CONSTANT: { ...constantAnswers, strength_kg: 5 } },
    });
    expect(upd.status).toBe(200);
    const updBody = await json(upd);
    // 5 kg × 2,20462 = 11,02 lb → 11 pontos
    expect(updBody.escalasClinicas).toEqual([
      expect.objectContaining({ escala: "CONSTANT", score: CONSTANT_EXPECTED + 11, max: 100 }),
    ]);
    const rows = await db.select().from(scaleResponsesTable).where(eq(scaleResponsesTable.followupId, body.id));
    expect(rows).toHaveLength(1);

    const surgery = await json(await api(`/api/surgeries/${cuffSurgeryId}`, "GET"));
    const listed = surgery.followups.find((f: { id: number }) => f.id === body.id);
    expect(listed.escalasClinicas[0]).toMatchObject({ escala: "CONSTANT", score: CONSTANT_EXPECTED + 11, max: 100 });
  });

  it("saves Rowe when only the case type is recorded", async () => {
    const res = await api("/api/followup", "POST", {
      surgeryId: instabilitySurgeryId,
      tempo: "1 ano",
      escalasClinicas: { ROWE: { stability: "no_recurrence", motion: "er_75", function: "mild" } },
    });
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.escalasClinicas).toEqual([expect.objectContaining({ escala: "ROWE", score: 90, max: 100 })]);
  });

  it("rejects a scale that does not apply to the surgery and creates nothing", async () => {
    const before = (await followupsOf(cuffSurgeryId)).length;
    const res = await api("/api/followup", "POST", {
      surgeryId: cuffSurgeryId,
      tempo: "3 meses",
      escalasClinicas: { ROWE: { stability: "no_recurrence", motion: "full", function: "no_limitation" } },
    });
    expect(res.status).toBe(422);
    expect((await json(res)).scale).toBe("ROWE");
    expect(await followupsOf(cuffSurgeryId)).toHaveLength(before);
  });

  it("rejects ASES (license pending) even though the pathology lists it", async () => {
    const before = (await followupsOf(cuffSurgeryId)).length;
    const res = await api("/api/followup", "POST", {
      surgeryId: cuffSurgeryId,
      tempo: "3 meses",
      escalasClinicas: { ASES: { pain_vas: 0, adl: Array(10).fill(3) } },
    });
    expect(res.status).toBe(422);
    expect(await followupsOf(cuffSurgeryId)).toHaveLength(before);

    const [existing] = await followupsOf(cuffSurgeryId);
    const put = await api(`/api/followup/${existing.id}/clinician-scales`, "PUT", {
      escalasClinicas: { ASES: { pain_vas: 0, adl: Array(10).fill(3) } },
    });
    expect(put.status).toBe(422);
    const ases = await db
      .select()
      .from(scaleResponsesTable)
      .where(and(eq(scaleResponsesTable.followupId, existing.id), eq(scaleResponsesTable.nomeEscala, "ASES")));
    expect(ases).toHaveLength(0);
  });

  it("rejects licensed or retired scale names sent as clinician scales", async () => {
    const [existing] = await followupsOf(cuffSurgeryId);
    for (const name of ["KOOS", "WOMAC", "IKDC", "DASH", "QUICKDASH", "OSS", "MEPS"]) {
      const put = await api(`/api/followup/${existing.id}/clinician-scales`, "PUT", {
        escalasClinicas: { [name]: { q1: 1 } },
      });
      expect(put.status, name).toBe(422);
    }
    const stored = await db
      .select({ nomeEscala: scaleResponsesTable.nomeEscala })
      .from(scaleResponsesTable)
      .where(eq(scaleResponsesTable.followupId, existing.id));
    expect(stored.every((r) => r.nomeEscala === "CONSTANT" || r.nomeEscala === "ROWE")).toBe(true);
  });

  it("rejects invalid answers with the failing field", async () => {
    const res = await api("/api/followup", "POST", {
      surgeryId: cuffSurgeryId,
      tempo: "3 meses",
      escalasClinicas: { CONSTANT: { ...constantAnswers, hand_position: "constructor" } },
    });
    expect(res.status).toBe(400);
    expect((await json(res)).field).toBe("hand_position");
  });

  it("does not let a doctor write scales on another doctor's follow-up or surgery", async () => {
    const put = await api(`/api/followup/${otherDoctorFollowupId}/clinician-scales`, "PUT", {
      escalasClinicas: { CONSTANT: constantAnswers },
    });
    expect(put.status).toBe(404);
    const post = await api("/api/followup", "POST", {
      surgeryId: otherDoctorSurgeryId,
      tempo: "3 meses",
      escalasClinicas: { CONSTANT: constantAnswers },
    });
    expect(post.status).toBe(404);
    const rows = await db
      .select()
      .from(scaleResponsesTable)
      .where(inArray(scaleResponsesTable.followupId, [otherDoctorFollowupId]));
    expect(rows).toHaveLength(0);
    expect(await followupsOf(otherDoctorSurgeryId)).toHaveLength(1);
  });
});
