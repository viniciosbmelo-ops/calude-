import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  doctorsTable,
  followupTable,
  patientsTable,
  scheduledNotificationsTable,
  surgeriesTable,
  procedimentoMeniscalTable,
  cpmReconstructionTable,
} from "@workspace/db";
import app from "../app";
import { hashPassword, signToken } from "../lib/auth";
import { cleanSubtable } from "./surgeries";

let server: Server;
let baseUrl: string;
let doctorAId: number;
let doctorBId: number;
let patientAId: number;
let patientBId: number;
let surgeryAId: number;
let surgeryBId: number;
let followupAId: number;
let followupBId: number;
let notificationAId: number;
let authA: string;

async function apiRequest(
  path: string,
  method: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${authA}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const suffix = randomUUID();
  const senhaHash = await hashPassword("ownership-test-password");
  const [doctorA, doctorB] = await db
    .insert(doctorsTable)
    .values([
      {
        nome: "Ownership Doctor A",
        email: `ownership-a-${suffix}@example.test`,
        senhaHash,
        isFree: true,
      },
      {
        nome: "Ownership Doctor B",
        email: `ownership-b-${suffix}@example.test`,
        senhaHash,
        isFree: true,
      },
    ])
    .returning();
  doctorAId = doctorA.id;
  doctorBId = doctorB.id;

  const [patientA, patientB] = await db
    .insert(patientsTable)
    .values([
      {
        doctorId: doctorAId,
        nome: "Patient A",
        telefone: "5511999999999",
      },
      {
        doctorId: doctorBId,
        nome: "Patient B",
        telefone: "5511888888888",
      },
    ])
    .returning();
  patientAId = patientA.id;
  patientBId = patientB.id;

  const [surgeryA, surgeryB] = await db
    .insert(surgeriesTable)
    .values([
      { doctorId: doctorAId, patientId: patientAId },
      { doctorId: doctorBId, patientId: patientBId },
    ])
    .returning();
  surgeryAId = surgeryA.id;
  surgeryBId = surgeryB.id;

  const [followupA, followupB] = await db
    .insert(followupTable)
    .values([
      { surgeryId: surgeryAId, tempo: "6 semanas", token: randomUUID() },
      { surgeryId: surgeryBId, tempo: "6 semanas", token: randomUUID() },
    ])
    .returning();
  followupAId = followupA.id;
  followupBId = followupB.id;

  const [notificationA] = await db
    .insert(scheduledNotificationsTable)
    .values({
      surgeryId: surgeryAId,
      patientId: patientAId,
      periodo: "6 semanas",
    })
    .returning();
  notificationAId = notificationA.id;

  authA = signToken({
    doctorId: doctorAId,
    isAdmin: false,
    sessionVersion: doctorA.sessionVersion,
  });
});


afterAll(async () => {
  if (doctorAId && doctorBId) {
    await db
      .delete(doctorsTable)
      .where(and(
        eq(doctorsTable.isAdmin, false),
        eq(doctorsTable.id, doctorAId),
      ));
    await db
      .delete(doctorsTable)
      .where(and(
        eq(doctorsTable.isAdmin, false),
        eq(doctorsTable.id, doctorBId),
      ));
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe.sequential("surgery and follow-up ownership", () => {
  it("accepts a null patellar exam in a surgery patch", async () => {
    const response = await apiRequest(`/api/surgeries/${surgeryAId}`, "PATCH", {
      examePatelar: null,
    });

    expect(response.status).toBe(200);
  });

  it("removes metadata and undefined values before subtable writes", () => {
    expect(cleanSubtable({
      id: 123,
      surgeryId: 456,
      createdAt: "2026-08-28T12:00:00.000Z",
      updatedAt: "2026-08-28T12:00:00.000Z",
      contexto: undefined,
      ladoMedial: false,
      observacoesExame: "",
      classificacao: null,
    })).toEqual({
      ladoMedial: false,
      observacoesExame: "",
      classificacao: null,
    });
  });

  it("rejects another doctor's patient in draft and final creation", async () => {
    const draft = await apiRequest("/api/surgeries/draft", "POST", {
      patientId: patientBId,
    });
    const final = await apiRequest("/api/surgeries", "POST", {
      patientId: patientBId,
    });

    expect(draft.status).toBe(404);
    expect(final.status).toBe(404);

    const crossLinked = await db
      .select({ id: surgeriesTable.id })
      .from(surgeriesTable)
      .where(and(
        eq(surgeriesTable.doctorId, doctorAId),
        eq(surgeriesTable.patientId, patientBId),
      ));
    expect(crossLinked).toHaveLength(0);
  });

  it("updates an owned follow-up but not one from another surgery", async () => {
    const own = await apiRequest(
      `/api/surgeries/${surgeryAId}/followups/${followupAId}`,
      "PATCH",
      { observacoes: "owned update" },
    );
    const foreign = await apiRequest(
      `/api/surgeries/${surgeryAId}/followups/${followupBId}`,
      "PATCH",
      { observacoes: "cross-tenant update" },
    );

    expect(own.status).toBe(200);
    expect(foreign.status).toBe(404);

    const [unchanged] = await db
      .select({ observacoes: followupTable.observacoes })
      .from(followupTable)
      .where(eq(followupTable.id, followupBId))
      .limit(1);
    expect(unchanged.observacoes).toBeNull();
  });

  it("rejects a WhatsApp follow-up ID from another surgery before sending", async () => {
    const response = await apiRequest(
      `/api/surgeries/${surgeryAId}/schedule/${notificationAId}/whatsapp`,
      "POST",
      {
        followupId: followupBId,
        customMessage: "ownership test",
      },
    );

    expect(response.status).toBe(404);
  });

  it("localizes malformed IDs and scheduling/WhatsApp errors for Spanish doctors", async () => {
    await db
      .update(doctorsTable)
      .set({ idioma: "es" })
      .where(eq(doctorsTable.id, doctorAId));

    const malformedId = await apiRequest("/api/surgeries/no-es-un-id", "GET");
    const missingSurgery = await apiRequest("/api/surgeries/999999999/schedule", "GET");
    const missingAppointment = await apiRequest(
      `/api/surgeries/${surgeryAId}/schedule/999999999/prepare-whatsapp`,
      "POST",
    );
    const invalidFollowup = await apiRequest(
      `/api/surgeries/${surgeryAId}/schedule/${notificationAId}/whatsapp`,
      "POST",
      { followupId: 0 },
    );
    const invalidStatus = await apiRequest(
      `/api/surgeries/${surgeryAId}/schedule/${notificationAId}/status`,
      "PATCH",
      { status: "invalid" },
    );

    expect(await malformedId.json()).toEqual({ error: "ID no válido" });
    expect(await missingSurgery.json()).toEqual({ error: "Cirugía no encontrada" });
    expect(await missingAppointment.json()).toEqual({ error: "Programación no encontrada" });
    expect(await invalidFollowup.json()).toEqual({ error: "followupId no válido" });
    expect(await invalidStatus.json()).toEqual({ error: "Estado no válido" });
  });

  it("returns a stable Spanish error for malformed authenticated surgery requests", async () => {
    await db
      .update(doctorsTable)
      .set({ idioma: "es" })
      .where(eq(doctorsTable.id, doctorAId));

    const responses = await Promise.all([
      apiRequest("/api/surgeries/draft", "POST", { patientId: "invalid" }),
      apiRequest(`/api/surgeries/${surgeryAId}/finalize`, "POST", { patientId: "invalid" }),
      apiRequest("/api/surgeries", "POST", { patientId: "invalid" }),
      apiRequest(`/api/surgeries/${surgeryAId}`, "PATCH", { tiposProcedimento: "invalid" }),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Datos no válidos" });
    }
  });

  it("saves a draft when a subtable contains only metadata or unknown fields", async () => {
    const [meniscal] = await db
      .insert(procedimentoMeniscalTable)
      .values({
        surgeryId: surgeryAId,
        contexto: "preservar ao recarregar rascunho",
      })
      .returning();

    const response = await apiRequest("/api/surgeries/draft", "POST", {
      id: surgeryAId,
      patientId: patientAId,
      procedimentoMeniscal: {
        id: meniscal.id,
        surgeryId: surgeryAId,
        createdAt: meniscal.createdAt.toISOString(),
        unsupportedFutureField: true,
      },
    });

    expect(response.status).toBe(200);

    const [unchanged] = await db
      .select({ contexto: procedimentoMeniscalTable.contexto })
      .from(procedimentoMeniscalTable)
      .where(eq(procedimentoMeniscalTable.surgeryId, surgeryAId))
      .limit(1);
    expect(unchanged.contexto).toBe("preservar ao recarregar rascunho");
  });

  it("does not create empty rows for metadata-only procedure payloads", async () => {
    const metadataOnly = {
      id: 999999,
      surgeryId: surgeryAId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const subtableFields = [
      "exameLigamentar",
      "lcaAlgorithm",
      "lcpReconstruction",
      "cpmReconstruction",
      "cplReconstruction",
      "procedimentoMeniscal",
      "examePatelar",
      "picsScore",
      "periprostheticFracture",
      "distalFemurFracture",
      "tibialPlateauFracture",
      "patellaFracture",
      "tibialSpineFracture",
      "patelarTendonRupture",
      "quadricepsTendonRupture",
      "aclLeapDecision",
      "exameOsteocondral",
    ];

    const response = await apiRequest("/api/surgeries", "POST", {
      patientId: patientAId,
      ...Object.fromEntries(subtableFields.map((field) => [field, metadataOnly])),
    });

    expect(response.status).toBe(201);
    const created = await response.json() as { id: number };

    const tableNames = [
      "exame_ligamentar",
      "lca_algorithm",
      "lcp_reconstruction",
      "cpm_reconstruction",
      "cpl_reconstruction",
      "procedimento_meniscal",
      "exame_patelar",
      "pics_score",
      "periprosthetic_fracture",
      "distal_femur_fracture",
      "tibial_plateau_fracture",
      "patella_fracture",
      "tibial_spine_fracture",
      "patelar_tendon_rupture",
      "quadriceps_tendon_rupture",
      "lca_leap_decision",
      "exame_osteocondral",
    ];

    for (const tableName of tableNames) {
      const result = await db.execute(sql`
        SELECT COUNT(*)::integer AS count
        FROM ${sql.raw(`"${tableName}"`)}
        WHERE surgery_id = ${created.id}
      `);
      expect(result.rows[0]?.count, tableName).toBe(0);
    }
  });

  it("still creates a populated procedure subtable", async () => {
    const response = await apiRequest("/api/surgeries", "POST", {
      patientId: patientAId,
      cpmReconstruction: {
        abordagem: "lcm_isolado",
        lcmTecnica: "Lind",
      },
      procedimentoMeniscal: {
        dorInterlinha: "Ambas",
        mcMurrayMedial: true,
        mcMurrayLateral: true,
        apleyCompressao: true,
        apleyTracao: true,
        marchaPato: true,
        steinmann1: true,
        steinmann2: false,
        observacoesExame: "Dor medial durante o exame",
        contexto: "persistir procedimento preenchido",
        ladoMedial: true,
      },
    });

    expect(response.status).toBe(201);
    const created = await response.json() as { id: number };
    const [meniscal] = await db
      .select({
        dorInterlinha: procedimentoMeniscalTable.dorInterlinha,
        mcMurrayMedial: procedimentoMeniscalTable.mcMurrayMedial,
        mcMurrayLateral: procedimentoMeniscalTable.mcMurrayLateral,
        apleyCompressao: procedimentoMeniscalTable.apleyCompressao,
        apleyTracao: procedimentoMeniscalTable.apleyTracao,
        marchaPato: procedimentoMeniscalTable.marchaPato,
        steinmann1: procedimentoMeniscalTable.steinmann1,
        steinmann2: procedimentoMeniscalTable.steinmann2,
        observacoesExame: procedimentoMeniscalTable.observacoesExame,
        contexto: procedimentoMeniscalTable.contexto,
        ladoMedial: procedimentoMeniscalTable.ladoMedial,
      })
      .from(procedimentoMeniscalTable)
      .where(eq(procedimentoMeniscalTable.surgeryId, created.id))
      .limit(1);

    expect(meniscal).toEqual({
      dorInterlinha: "Ambas",
      mcMurrayMedial: true,
      mcMurrayLateral: true,
      apleyCompressao: true,
      apleyTracao: true,
      marchaPato: true,
      steinmann1: true,
      steinmann2: false,
      observacoesExame: "Dor medial durante o exame",
      contexto: "persistir procedimento preenchido",
      ladoMedial: true,
    });

    const [cpm] = await db
      .select({
        abordagem: cpmReconstructionTable.abordagem,
        lcmTecnica: cpmReconstructionTable.lcmTecnica,
      })
      .from(cpmReconstructionTable)
      .where(eq(cpmReconstructionTable.surgeryId, created.id))
      .limit(1);
    expect(cpm).toEqual({
      abordagem: "lcm_isolado",
      lcmTecnica: "Lind",
    });

    const detailResponse = await apiRequest(`/api/surgeries/${created.id}`, "GET");
    expect(detailResponse.status).toBe(200);
    const detail = await detailResponse.json() as {
      procedimentoMeniscal?: {
        dorInterlinha?: string | null;
        mcMurrayMedial?: boolean | null;
        observacoesExame?: string | null;
      };
      cpmReconstruction?: {
        abordagem?: string | null;
        lcmTecnica?: string | null;
      };
    };
    expect(detail.procedimentoMeniscal).toMatchObject({
      dorInterlinha: "Ambas",
      mcMurrayMedial: true,
      observacoesExame: "Dor medial durante o exame",
    });
    expect(detail.cpmReconstruction).toMatchObject({
      abordagem: "lcm_isolado",
      lcmTecnica: "Lind",
    });
  });

  it("persists and reloads independent medial and lateral meniscal details", async () => {
    const medial = {
      sutura: true,
      lesaoRampa: true,
      tecnicasSutura: ["All-inside"],
      pontosPorTecnica: JSON.stringify({ "All-inside": 2 }),
      meniscectomia: false,
    };
    const lateral = {
      sutura: false,
      lesaoRaiz: true,
      fixacaoRaiz: "Âncora",
      centralizacaoRaiz: true,
      centralizacaoMetodo: "Túnel Trans-ósseo",
      meniscectomia: true,
    };

    const createResponse = await apiRequest("/api/surgeries", "POST", {
      patientId: patientAId,
      procedimentoMeniscal: {
        sutura: true,
        ladoMedial: true,
        ladoLateral: true,
        detalhesMedial: medial,
        detalhesLateral: lateral,
      },
    });
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json() as { id: number };

    const firstReload = await apiRequest(`/api/surgeries/${created.id}`, "GET");
    expect(firstReload.status).toBe(200);
    const firstDetail = await firstReload.json() as {
      procedimentoMeniscal: {
        detalhesMedial: Record<string, unknown>;
        detalhesLateral: Record<string, unknown>;
      };
    };
    expect(firstDetail.procedimentoMeniscal.detalhesMedial).toEqual(medial);
    expect(firstDetail.procedimentoMeniscal.detalhesLateral).toEqual(lateral);

    const editedLateral = { ...lateral, fixacaoRaiz: "Endoboton" };
    const draftResponse = await apiRequest("/api/surgeries/draft", "POST", {
      id: created.id,
      patientId: patientAId,
      procedimentoMeniscal: {
        ...firstDetail.procedimentoMeniscal,
        detalhesMedial: medial,
        detalhesLateral: editedLateral,
      },
    });
    expect(draftResponse.status).toBe(200);

    const secondReload = await apiRequest(`/api/surgeries/${created.id}`, "GET");
    expect(secondReload.status).toBe(200);
    const secondDetail = await secondReload.json() as {
      procedimentoMeniscal: {
        detalhesMedial: Record<string, unknown>;
        detalhesLateral: Record<string, unknown>;
      };
    };
    expect(secondDetail.procedimentoMeniscal.detalhesMedial).toEqual(medial);
    expect(secondDetail.procedimentoMeniscal.detalhesLateral).toEqual(editedLateral);

    const deselectResponse = await apiRequest("/api/surgeries/draft", "POST", {
      id: created.id,
      patientId: patientAId,
      procedimentoMeniscal: {
        ladoMedial: false,
        ladoLateral: true,
        detalhesMedial: null,
        detalhesLateral: editedLateral,
        sutura: false,
        meniscectomia: true,
      },
    });
    expect(deselectResponse.status).toBe(200);

    const afterDeselectResponse = await apiRequest(`/api/surgeries/${created.id}`, "GET");
    expect(afterDeselectResponse.status).toBe(200);
    const afterDeselectDetail = await afterDeselectResponse.json() as {
      procedimentoMeniscal: {
        detalhesMedial: Record<string, unknown> | null;
        detalhesLateral: Record<string, unknown>;
      };
    };
    expect(afterDeselectDetail.procedimentoMeniscal.detalhesMedial).toBeNull();
    expect(afterDeselectDetail.procedimentoMeniscal.detalhesLateral).toEqual(editedLateral);
  });

  it("rejects malformed side-specific meniscal details", async () => {
    const response = await apiRequest("/api/surgeries/draft", "POST", {
      id: surgeryAId,
      patientId: patientAId,
      procedimentoMeniscal: {
        ladoMedial: true,
        detalhesMedial: {
          sutura: "sim",
          campoDesconhecido: true,
        },
      },
    });

    expect(response.status).toBe(400);
  });

  it("persists J Sign grades through draft, PATCH, finalize, create, and bilateral reload", async () => {
    const bilateralDetails = JSON.stringify({
      jSignGrau: 2,
      bilateral: {
        schemaVersion: 1,
        byLimb: {
          direito: {
            tipoCaso: "Lesão ligamentar direita",
            examePatelar: { jSign: true, jSignGrau: 1 },
          },
          esquerdo: {
            tipoCaso: "Lesão ligamentar esquerda",
            examePatelar: { jSign: true, jSignGrau: 4 },
          },
        },
      },
    });

    const draftResponse = await apiRequest("/api/surgeries/draft", "POST", {
      patientId: patientAId,
      lado: "Bilateral",
      examePatelar: { jSign: true, jSignGrau: 2 },
      procedimentosDetalhados: bilateralDetails,
    });
    expect(draftResponse.status).toBe(200);
    const draft = await draftResponse.json() as { id: number };

    const draftReload = await apiRequest(`/api/surgeries/${draft.id}`, "GET");
    expect(draftReload.status).toBe(200);
    const draftDetail = await draftReload.json() as {
      examePatelar?: { jSign?: boolean; jSignGrau?: number };
      procedimentosDetalhados?: string;
    };
    expect(draftDetail.examePatelar).toMatchObject({ jSign: true, jSignGrau: 2 });
    const draftDetails = JSON.parse(draftDetail.procedimentosDetalhados!);
    expect(draftDetails.jSignGrau).toBe(2);
    expect(draftDetails.bilateral.byLimb.direito.examePatelar).toMatchObject({ jSign: true, jSignGrau: 1 });
    expect(draftDetails.bilateral.byLimb.esquerdo.examePatelar).toMatchObject({ jSign: true, jSignGrau: 4 });

    const negativePatch = await apiRequest(`/api/surgeries/${draft.id}`, "PATCH", {
      examePatelar: { jSign: false, jSignGrau: 4 },
    });
    expect(negativePatch.status).toBe(200);
    const negativeReload = await apiRequest(`/api/surgeries/${draft.id}`, "GET");
    const negativeDetail = await negativeReload.json() as {
      examePatelar?: { jSign?: boolean; jSignGrau?: number };
      procedimentosDetalhados?: string;
    };
    expect(negativeDetail.examePatelar).toMatchObject({ jSign: false });
    expect(negativeDetail.examePatelar?.jSignGrau).toBeUndefined();
    const negativeDetails = JSON.parse(negativeDetail.procedimentosDetalhados!);
    expect(negativeDetails.jSignGrau).toBeUndefined();
    expect(negativeDetails.bilateral.byLimb.direito.examePatelar.jSignGrau).toBe(1);
    expect(negativeDetails.bilateral.byLimb.esquerdo.examePatelar.jSignGrau).toBe(4);

    const positivePatch = await apiRequest(`/api/surgeries/${draft.id}`, "PATCH", {
      examePatelar: { jSign: true, jSignGrau: 3 },
    });
    expect(positivePatch.status).toBe(200);
    const positiveReload = await apiRequest(`/api/surgeries/${draft.id}`, "GET");
    const positiveDetail = await positiveReload.json() as {
      examePatelar?: { jSign?: boolean; jSignGrau?: number };
      procedimentosDetalhados?: string;
    };
    expect(positiveDetail.examePatelar).toMatchObject({ jSign: true, jSignGrau: 3 });
    expect(JSON.parse(positiveDetail.procedimentosDetalhados!).jSignGrau).toBe(3);

    const finalDraftResponse = await apiRequest("/api/surgeries/draft", "POST", {
      patientId: patientAId,
      lado: "Direito",
      examePatelar: { jSign: true, jSignGrau: 4 },
    });
    expect(finalDraftResponse.status).toBe(200);
    const finalDraft = await finalDraftResponse.json() as { id: number };
    const finalizeResponse = await apiRequest(`/api/surgeries/${finalDraft.id}/finalize`, "POST", {
      patientId: patientAId,
      examePatelar: { jSign: true, jSignGrau: 4 },
      procedimentosDetalhados: JSON.stringify({ jSignGrau: 4 }),
    });
    expect(finalizeResponse.status).toBe(200);
    const finalizedReload = await apiRequest(`/api/surgeries/${finalDraft.id}`, "GET");
    const finalizedDetail = await finalizedReload.json() as {
      status?: string;
      examePatelar?: { jSign?: boolean; jSignGrau?: number };
    };
    expect(finalizedDetail.status).toBe("completo");
    expect(finalizedDetail.examePatelar).toMatchObject({ jSign: true, jSignGrau: 4 });

    const createResponse = await apiRequest("/api/surgeries", "POST", {
      patientId: patientAId,
      lado: "Direito",
      examePatelar: { jSign: true, jSignGrau: 1 },
      procedimentosDetalhados: JSON.stringify({ jSignGrau: 1 }),
    });
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json() as { id: number };
    const createdReload = await apiRequest(`/api/surgeries/${created.id}`, "GET");
    const createdDetail = await createdReload.json() as {
      examePatelar?: { jSign?: boolean; jSignGrau?: number };
    };
    expect(createdDetail.examePatelar).toMatchObject({ jSign: true, jSignGrau: 1 });
  });
});