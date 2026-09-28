import { Router, type IRouter } from "express";
import {
  db,
  surgeriesTable,
  patientsTable,
  doctorsTable,
  exameLigamentarTable,
  lcaAlgorithmTable,
  lcpReconstructionTable,
  cpmReconstructionTable,
  cplReconstructionTable,
  procedimentoMeniscalTable,
  examePatelarTable,
  picsScoreTable,
  periprostheticFractureTable,
  distalFemurFractureTable,
  tibialPlateauFractureTable,
  patellaFractureTable,
  tibialSpineFractureTable,
  patelarTendonRuptureTable,
  quadricepsTendonRuptureTable,
  lcaLeapDecisionTable,
  exameOsteocondralTable,
  followupTable,
  scheduledNotificationsTable,
} from "@workspace/db";
import { eq, and, desc, getTableColumns, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import {
  CalculateKrirsBody,
  CalculatePicsBody,
  CalculateAclDecisionBody,
} from "@workspace/api-zod";
import { computeAclDecision } from "../lib/acl-decision-engine";
import {
  hasFractureProcedure,
  isPreoperativePeriod,
} from "../lib/followup-schedule";
import {
  ensurePreoperativeNotification,
  removePreoperativeNotifications,
  syncSurgerySchedule,
} from "../lib/surgery-schedule-sync";
import { sendWhatsAppText, buildFollowupMessage } from "../lib/whatsapp";
import { getBaseUrl } from "../lib/base-url";
import { randomUUID } from "crypto";
import { z } from "zod/v4";
import { resolveDoctorLocale } from "../lib/locale";
import { localeForDoctorId } from "../lib/locale";
import { message as localizedMessage } from "../lib/locale-catalog";
import { ObjectStorageService } from "../lib/objectStorage";
import { claimXrayGrantForObjectPath } from "../lib/uploadGrants";
import { lockStoragePath } from "../lib/storageCleanup";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

async function patientBelongsToDoctor(
  patientId: number,
  doctorId: number,
): Promise<boolean> {
  const [patient] = await db
    .select({ id: patientsTable.id })
    .from(patientsTable)
    .where(and(
      eq(patientsTable.id, patientId),
      eq(patientsTable.doctorId, doctorId),
    ))
    .limit(1);
  return Boolean(patient);
}

async function updateSurgeryWithLifecycleLock(
  surgeryId: number,
  doctorId: number,
  values: Record<string, unknown>,
): Promise<typeof surgeriesTable.$inferSelect | undefined> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(87001, CAST(${surgeryId} AS integer))`,
    );
    const rxImageUrl = typeof values.rxImageUrl === "string" ? values.rxImageUrl : null;
    const [current] = await tx
      .select({ rxImageUrl: surgeriesTable.rxImageUrl })
      .from(surgeriesTable)
      .where(and(eq(surgeriesTable.id, surgeryId), eq(surgeriesTable.doctorId, doctorId)))
      .limit(1);
    if (rxImageUrl && current?.rxImageUrl !== rxImageUrl) {
      await lockStoragePath(tx, rxImageUrl);
      const objectGeneration = await objectStorageService.getObjectEntityGeneration(rxImageUrl);
      if (!await claimXrayGrantForObjectPath(tx, doctorId, rxImageUrl, objectGeneration)) {
        throw new Error("Pending X-ray upload grant is invalid, expired, or already used");
      }
    }
    const [surgery] = await tx
      .update(surgeriesTable)
      .set(values)
      .where(and(eq(surgeriesTable.id, surgeryId), eq(surgeriesTable.doctorId, doctorId)))
      .returning();
    return surgery;
  });
}

class PreoperativeFractureError extends Error {}

async function ensureFollowupForNotification(
  surgeryId: number,
  notificationId: number,
  preferredFollowupId?: number,
): Promise<typeof followupTable.$inferSelect | null> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(87001, CAST(${surgeryId} AS integer))`,
    );

    const [surgery] = await tx
      .select({ tiposProcedimento: surgeriesTable.tiposProcedimento })
      .from(surgeriesTable)
      .where(eq(surgeriesTable.id, surgeryId))
      .for("update")
      .limit(1);
    if (!surgery) return null;

    const [notification] = await tx
      .select()
      .from(scheduledNotificationsTable)
      .where(and(
        eq(scheduledNotificationsTable.id, notificationId),
        eq(scheduledNotificationsTable.surgeryId, surgeryId),
      ))
      .for("update")
      .limit(1);
    if (!notification) return null;

    if (
      hasFractureProcedure(surgery.tiposProcedimento as string[] | null)
      && isPreoperativePeriod(notification.periodo)
    ) {
      throw new PreoperativeFractureError();
    }

    if (preferredFollowupId) {
      const [preferred] = await tx
        .select()
        .from(followupTable)
        .where(and(
          eq(followupTable.id, preferredFollowupId),
          eq(followupTable.surgeryId, surgeryId),
        ))
        .limit(1);
      return preferred ?? null;
    }

    if (notification.followupId) {
      const [existing] = await tx
        .select()
        .from(followupTable)
        .where(and(
          eq(followupTable.id, notification.followupId),
          eq(followupTable.surgeryId, surgeryId),
        ))
        .limit(1);

      if (existing) {
        if (existing.token) return existing;
        const [updated] = await tx
          .update(followupTable)
          .set({
            token: randomUUID(),
            escalasEnviadas: notification.scales ?? [],
          })
          .where(eq(followupTable.id, existing.id))
          .returning();
        return updated;
      }
    }

    const [created] = await tx
      .insert(followupTable)
      .values({
        surgeryId,
        tempo: notification.periodo,
        dataAvaliacao: new Date().toISOString().slice(0, 10),
        token: randomUUID(),
        escalasEnviadas: notification.scales ?? [],
      })
      .returning();

    await tx
      .update(scheduledNotificationsTable)
      .set({ followupId: created.id })
      .where(eq(scheduledNotificationsTable.id, notificationId));

    return created;
  });
}

function calcKrirs(dados: {
  idade: number;
  esportePivot: boolean;
  pivotShift: number;
  revisao: boolean;
  hiperlaxidade: boolean;
  meniscoLateral: boolean;
  lesaoCronica: boolean;
  aderTest?: boolean;
  gavetaRotInterna?: boolean;
}) {
  if (dados.revisao) {
    return {
      score: 99,
      nivelRisco: "alto" as const,
      tecnica: "ACL + LET ou LAL",
      justificativa: "Revisão de LCA — indicação direta de LET ou LAL",
      flagAltoRisco: true,
      instabAnteromedial: false,
      instabAnterolateral: false,
      instabCombinada: false,
      duplaExtraArticular: false,
      recomendacao: ["LET", "LAL"],
      alerta: null,
    };
  }

  let score = 0;
  if (dados.idade < 25) score += 2;
  if (dados.esportePivot) score += 2;
  if (dados.pivotShift === 2) score += 2;
  if (dados.pivotShift === 3) score += 3;
  if (dados.hiperlaxidade) score += 1;
  if (dados.meniscoLateral) score += 1;
  if (dados.lesaoCronica) score += 1;

  let tecnica: string;
  let justificativa: string;
  let flagAltoRisco: boolean;
  let nivelRisco: "alto" | "intermediario" | "baixo";

  if (dados.pivotShift >= 2) {
    if (dados.idade < 25 || dados.esportePivot) {
      tecnica = "ACL + LET ou LAL";
      justificativa = "Pivot shift ≥2 + paciente jovem/atleta";
      flagAltoRisco = true;
      nivelRisco = "alto";
    } else {
      tecnica = "ACL + ALL";
      justificativa = "Pivot shift ≥2 sem fatores adicionais maiores";
      flagAltoRisco = false;
      nivelRisco = "intermediario";
    }
  } else if (score >= 6) {
    tecnica = "ACL + LET ou LAL";
    justificativa = "Alto risco de re-ruptura";
    flagAltoRisco = true;
    nivelRisco = "alto";
  } else if (score >= 3) {
    tecnica = "ACL + ALL";
    justificativa = "Risco intermediário";
    flagAltoRisco = false;
    nivelRisco = "intermediario";
  } else {
    tecnica = "ACL isolado";
    justificativa = "Baixo risco";
    flagAltoRisco = false;
    nivelRisco = "baixo";
  }

  const instabAM = dados.aderTest === true;

  // Pivot Shift Grau 2 ISOLADO não indica reconstrução combinada LAL/LET.
  // Só indica instabilidade anterolateral se:
  //   - Pivot Shift Grau 3 (crash), OU
  //   - Gaveta rotatória interna positiva, OU
  //   - Pivot Shift Grau 2 + pelo menos um fator adicional (atleta de pivô, idade < 25, hiperlaxidez)
  const pivotShift2ComFator =
    dados.pivotShift === 2 &&
    (dados.esportePivot || dados.idade < 25 || dados.hiperlaxidade);

  const instabAL =
    dados.gavetaRotInterna === true ||
    dados.pivotShift >= 3 ||
    pivotShift2ComFator;

  let recomendacao: string[] = [];
  let alerta: string | null = null;

  if (instabAM && instabAL) {
    recomendacao = ["AOL", "LAL/LET"];
    alerta = "Instabilidade combinada — reconstrução dupla extra-articular";
  } else if (instabAM) {
    recomendacao = ["AOL"];
    alerta = "Instabilidade anteromedial — reconstrução do ligamento oblíquo anterior";
  } else if (instabAL) {
    recomendacao = ["LAL/LET"];
    alerta = "Instabilidade anterolateral — reconstrução do LAL/LET";
  }

  return {
    score,
    nivelRisco,
    tecnica,
    justificativa,
    flagAltoRisco,
    instabAnteromedial: instabAM,
    instabAnterolateral: instabAL,
    instabCombinada: instabAM && instabAL,
    duplaExtraArticular: instabAM && instabAL,
    recomendacao,
    alerta,
  };
}

function calcPics(dados: {
  dejourTipo: string;
  numEpisodios: number;
  luxacaoCronica: boolean;
  idade: number;
  ttTgMm: number;
  catonDeschamps: number;
  maltrackingDinamico: boolean;
  inclinacaoPatelarGraus: number;
  lesaoCondral: boolean;
  hiperlaxidade: boolean;
  sexo: string;
}) {
  let score = 0;
  const componentes: Record<string, number> = {};

  if (["B", "C", "D"].includes(dados.dejourTipo)) {
    componentes.troclea = 4;
    score += 4;
  }
  if (dados.numEpisodios >= 2 || dados.luxacaoCronica) {
    componentes.recorrencia = 3;
    score += 3;
  }
  if (dados.idade < 20) {
    componentes.idade = 2;
    score += 2;
  }
  if (dados.ttTgMm >= 20) {
    componentes.ttgt = 2;
    score += 2;
  }
  if (dados.catonDeschamps > 1.4) {
    componentes.patelaAlta = 2;
    score += 2;
  }
  if (dados.maltrackingDinamico) {
    componentes.maltracking = 2;
    score += 2;
  }
  if (dados.inclinacaoPatelarGraus > 20) {
    componentes.inclinacao = 1;
    score += 1;
  }
  if (dados.lesaoCondral) {
    componentes.condral = 1;
    score += 1;
  }
  if (dados.hiperlaxidade) {
    componentes.hiperlaxidade = 1;
    score += 1;
  }
  if (dados.sexo === "F") {
    componentes.sexo = 1;
    score += 1;
  }

  const fatorDominante =
    Object.entries(componentes).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Nenhum";

  let picsRisco: string;
  let picsConduta: string;

  if (score >= 10) {
    picsRisco = "Muito alto";
    picsConduta = "MPFL + TAT ± Trocleoplastia";
  } else if (score >= 7) {
    picsRisco = "Alto";
    const altoCorrections: string[] = [];
    if (dados.ttTgMm >= 20) altoCorrections.push("TAT");
    if (dados.catonDeschamps > 1.4) altoCorrections.push("Distalização");
    if (["B", "C", "D"].includes(dados.dejourTipo)) altoCorrections.push("Trocleoplastia");
    picsConduta = altoCorrections.length > 0
      ? `MPFL + ${altoCorrections.join(" + ")}`
      : "MPFL + correção do fator dominante";
  } else if (score >= 4) {
    picsRisco = "Moderado";
    const modCorrections: string[] = [];
    if (dados.ttTgMm >= 20) modCorrections.push("TAT");
    if (dados.catonDeschamps > 1.4) modCorrections.push("Distalização");
    if (["B", "C", "D"].includes(dados.dejourTipo)) modCorrections.push("Trocleoplastia");
    picsConduta = modCorrections.length > 0
      ? `MPFL + ${modCorrections.join(" + ")}`
      : "MPFL isolado";
  } else {
    picsRisco = "Baixo";
    picsConduta = "Tratamento conservador";
  }

  const sugestoes: string[] = [];
  if (dados.ttTgMm >= 20) sugestoes.push("Considerar TAT (TT-TG ≥ 20mm)");
  if (dados.catonDeschamps > 1.4) sugestoes.push("Considerar distalização (CDI > 1.40 — patela alta)");
  if (["B", "C", "D"].includes(dados.dejourTipo))
    sugestoes.push(`Avaliar trocleoplastia (Dejour ${dados.dejourTipo})`);

  return { picsTotal: score, picsRisco, picsConduta, fatorDominante, sugestoes };
}

router.post("/surgeries/calculate-krirs", requireAuth, async (req, res): Promise<void> => {
  const parsed = CalculateKrirsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const result = calcKrirs(parsed.data);
  res.json(result);
});

router.post("/surgeries/calculate-pics", requireAuth, async (req, res): Promise<void> => {
  const parsed = CalculatePicsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const result = calcPics(parsed.data);
  res.json(result);
});

router.post("/surgeries/calculate-acl-decision", requireAuth, async (req, res): Promise<void> => {
  const parsed = CalculateAclDecisionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const result = computeAclDecision(parsed.data as any);
  res.json(result);
});

// ── Draft: create or update a partial surgery saved as rascunho ────────────

const MeniscalSideDetailsBody = z.object({
  sutura: z.boolean().nullish(),
  lesaoRampa: z.boolean().nullish(),
  lesaoRaiz: z.boolean().nullish(),
  lesaoRaizAnterior: z.boolean().nullish(),
  lesaoCornoAnterior: z.boolean().nullish(),
  lesaoCornoPosterior: z.boolean().nullish(),
  lesaoAlcaBalde: z.boolean().nullish(),
  lesaoRadial: z.boolean().nullish(),
  lesaoCorpo: z.boolean().nullish(),
  lesaoDiscoide: z.boolean().nullish(),
  fixacaoRaiz: z.string().nullish(),
  centralizacaoRaiz: z.boolean().nullish(),
  centralizacaoMetodo: z.string().nullish(),
  tecnicasSutura: z.array(z.string()).nullish(),
  numPontos: z.number().int().nullish(),
  pontosPorTecnica: z.string().nullish(),
  tipoFio: z.string().nullish(),
  estimuloBiologico: z.boolean().nullish(),
  estimuloPerfuracaoIntercondilo: z.boolean().nullish(),
  estimuloCoaguloFibrina: z.boolean().nullish(),
  estimuloOrtobiologico: z.boolean().nullish(),
  estimuloOrtobiologicoTipo: z.string().nullish(),
  saucerizacao: z.boolean().nullish(),
  meniscectomia: z.boolean().nullish(),
}).strict();

const ProcedimentoMeniscalDraftBody = z.object({
  detalhesMedial: MeniscalSideDetailsBody.nullish(),
  detalhesLateral: MeniscalSideDetailsBody.nullish(),
}).passthrough();

const DraftSurgeryBody = z.object({
  id: z.number().int().nullish(),
  patientId: z.number().int().nullish(),
  dataCirurgia: z.string().nullish(),
  hospital: z.string().nullish(),
  lado: z.string().nullish(),
  tipoCaso: z.string().nullish(),
  diagnostico: z.string().nullish(),
  alinhamento: z.string().nullish(),
  grauAlinhamento: z.string().nullish(),
  tiposProcedimento: z.array(z.string()).nullish(),
  ligamentosAcometidos: z.array(z.string()).nullish(),
  enxerto: z.string().nullish(),
  diametroEnxerto: z.string().nullish(),
  tunelFemoral: z.string().nullish(),
  tunelFemoralPediatrico: z.string().nullish(),
  tunelTibialPediatrico: z.string().nullish(),
  fixacaoFemoral: z.string().nullish(),
  fixacaoTibial: z.string().nullish(),
  flipCutter: z.string().nullish(),
  internalBrace: z.string().nullish(),
  tipoLca: z.string().nullish(),
  localizacaoLesaoLca: z.string().nullish(),
  fixacaoReparoLca: z.string().nullish(),
  preservacaoRemanescente: z.string().nullish(),
  reforco: z.string().nullish(),
  procedimentoRealizado: z.string().nullish(),
  procedimentosDetalhados: z.string().nullish(),
  observacoes: z.string().nullish(),
  rxAnaliseJson: z.string().nullish(),
  rxImageUrl: z.string().nullish(),
  slopeTibialJson: z.string().nullish(),
  exameLigamentar: z.record(z.string(), z.any()).nullish(),
  lcaAlgorithm: z.record(z.string(), z.any()).nullish(),
  lcpReconstruction: z.record(z.string(), z.any()).nullish(),
  cpmReconstruction: z.record(z.string(), z.any()).nullish(),
  cplReconstruction: z.record(z.string(), z.any()).nullish(),
  procedimentoMeniscal: ProcedimentoMeniscalDraftBody.nullish(),
  examePatelar: z.record(z.string(), z.any()).nullish(),
  picsScore: z.record(z.string(), z.any()).nullish(),
  periprostheticFracture: z.record(z.string(), z.any()).nullish(),
  distalFemurFracture: z.record(z.string(), z.any()).nullish(),
  tibialPlateauFracture: z.record(z.string(), z.any()).nullish(),
  patellaFracture: z.record(z.string(), z.any()).nullish(),
  tibialSpineFracture: z.record(z.string(), z.any()).nullish(),
  patelarTendonRupture: z.record(z.string(), z.any()).nullish(),
  quadricepsTendonRupture: z.record(z.string(), z.any()).nullish(),
  aclLeapDecision: z.record(z.string(), z.any()).nullish(),
  // OCD / cartilage exam fields
  exameOsteocondral: z.record(z.string(), z.any()).nullish(),
  // Algorithm output from DocKnee Cartilage Algorithm v1.0
  ocdAnalysis: z.any().nullish(),
  // Standard adult tibial tunnel (separate from pediatric)
  tunelTibial: z.string().nullish(),
});

const UpdateSurgeryWithClinicalBody = z.object({
  dataCirurgia: z.string().optional(),
  hospital: z.string().optional(),
  lado: z.string().nullish(),
  tipoCaso: z.string().optional(),
  diagnostico: z.string().nullish(),
  alinhamento: z.string().optional(),
  grauAlinhamento: z.string().optional(),
  rxAnaliseJson: z.string().nullish(),
  tiposProcedimento: z.array(z.string()).optional(),
  ligamentosAcometidos: z.array(z.string()).optional(),
  enxerto: z.string().optional(),
  diametroEnxerto: z.string().optional(),
  fixacaoFemoral: z.string().optional(),
  fixacaoTibial: z.string().optional(),
  internalBrace: z.string().optional(),
  tipoLca: z.string().optional(),
  localizacaoLesaoLca: z.string().optional(),
  fixacaoReparoLca: z.string().optional(),
  preservacaoRemanescente: z.string().optional(),
  reforco: z.string().optional(),
  procedimentoRealizado: z.string().optional(),
  observacoes: z.string().optional(),
  procedimentosDetalhados: z.string().nullish(),
  examePatelar: z.record(z.string(), z.any()).nullish(),
});

const J_SIGN_GRADES = new Set([1, 2, 3, 4]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * J Sign's grade is intentionally kept outside the relational exam table.  The
 * table is shared with older records and only has the boolean result; the
 * versioned procedure-details JSON is the side-owned home for the optional
 * grade (and works for bilateral snapshots without a migration).
 */
function normalizeJSignGrade(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const grade = typeof value === "string" && /^[1-4]$/.test(value)
    ? Number(value)
    : value;
  if (typeof grade !== "number" || !Number.isInteger(grade) || !J_SIGN_GRADES.has(grade)) {
    throw new Error("Invalid J Sign grade");
  }
  return grade;
}

function normalizePatellarExam(value: unknown): Record<string, unknown> | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!isRecord(value)) throw new Error("Invalid patellar exam");
  const exam = { ...value };
  const grade = exam.jSign === false ? null : normalizeJSignGrade(exam.jSignGrau);
  // An explicit negative J Sign always clears the grade.  An omitted boolean
  // is retained for partial PATCH payloads, which may update only the grade.
  if (exam.jSign !== false && grade !== null) exam.jSignGrau = grade;
  else delete exam.jSignGrau;
  return exam;
}

function normalizeJSignInDetails(
  value: unknown,
  topLevelExam: unknown,
): string | null | undefined {
  if (typeof value !== "string" || !value.trim()) {
    if (topLevelExam !== undefined) {
      const topExam = normalizePatellarExam(topLevelExam);
      const topGrade = topExam?.jSign !== false && topExam?.jSignGrau != null
        ? topExam.jSignGrau
        : null;
      if (topGrade !== null) return JSON.stringify({ jSignGrau: topGrade });
    }
    return value as string | null | undefined;
  }
  let details: unknown;
  try {
    details = JSON.parse(value);
  } catch {
    return value;
  }
  if (!isRecord(details)) return value;
  const normalized = { ...details };
  const topExam = topLevelExam !== undefined ? normalizePatellarExam(topLevelExam) : undefined;
  const topNegative = topExam === null || topExam?.jSign === false;
  if (Object.prototype.hasOwnProperty.call(normalized, "jSignGrau")) {
    const detailGrade = topNegative || normalized.jSign === false
      ? null
      : normalizeJSignGrade(normalized.jSignGrau);
    if (detailGrade === null) delete normalized.jSignGrau;
    else normalized.jSignGrau = detailGrade;
  }
  if (topLevelExam !== undefined) {
    const hasTopGrade = isRecord(topExam)
      && Object.prototype.hasOwnProperty.call(topExam, "jSignGrau");
    const topGrade = topExam?.jSign !== false && topExam?.jSignGrau != null
      ? topExam.jSignGrau
      : null;
    if (
      topExam === null
      || topExam?.jSign === false
      || (topExam?.jSign === true && hasTopGrade && topGrade === null)
    ) delete normalized.jSignGrau;
    else if (topGrade !== null) normalized.jSignGrau = topGrade;
  }

  const bilateral = isRecord(normalized.bilateral) ? normalized.bilateral : null;
  if (bilateral && bilateral.schemaVersion === 1 && isRecord(bilateral.byLimb)) {
    const byLimb = { ...bilateral.byLimb };
    for (const limb of ["direito", "esquerdo"] as const) {
      const snapshot = byLimb[limb];
      if (!isRecord(snapshot)) continue;
      const normalizedSnapshot = { ...snapshot };
      if ("examePatelar" in normalizedSnapshot) {
        normalizedSnapshot.examePatelar = normalizePatellarExam(normalizedSnapshot.examePatelar);
      }
      byLimb[limb] = normalizedSnapshot;
    }
    normalized.bilateral = { ...bilateral, byLimb };
  }
  return JSON.stringify(normalized);
}

function normalizeJSignPayload<T extends Record<string, unknown>>(data: T): T {
  const normalized = { ...data } as T & {
    examePatelar?: unknown;
    procedimentosDetalhados?: unknown;
  };
  const hasPatellarExam = Object.prototype.hasOwnProperty.call(data, "examePatelar");
  const hasProcedureDetails = Object.prototype.hasOwnProperty.call(data, "procedimentosDetalhados");
  if (hasPatellarExam) {
    normalized.examePatelar = normalizePatellarExam(data.examePatelar);
  } else {
    delete normalized.examePatelar;
  }
  if (hasProcedureDetails) {
    normalized.procedimentosDetalhados = normalizeJSignInDetails(
      data.procedimentosDetalhados,
      hasPatellarExam ? normalized.examePatelar ?? null : undefined,
    );
  } else {
    delete normalized.procedimentosDetalhados;
  }
  return normalized as T;
}

function applyJSignNormalization(data: Record<string, unknown>): boolean {
  try {
    Object.assign(data, normalizeJSignPayload(data));
    return true;
  } catch {
    return false;
  }
}

function storedJSignGrade(procedimentosDetalhados: unknown): number | null {
  if (typeof procedimentosDetalhados !== "string") return null;
  try {
    const details = JSON.parse(procedimentosDetalhados);
    return normalizeJSignGrade(isRecord(details) ? details.jSignGrau : null);
  } catch {
    return null;
  }
}

function hasSubstantiveBilateralSide(snapshot: unknown): boolean {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return false;
  const allowed = new Set([
    "tipoCaso", "diagnostico", "alinhamento", "grauAlinhamento", "tiposProcedimento",
    "ligamentosAcometidos", "procedimentoRealizado", "observacoes", "exameLigamentar",
    "examePatelar", "exameOsteocondral", "lcaAlgorithm", "picsScore",
    "procedimentoMeniscal", "detalhesProcedimentos", "lcpReconstruction",
    "cpmReconstruction", "cplReconstruction", "periprostheticFracture",
    "distalFemurFracture", "tibialPlateauFracture", "patellaFracture",
    "tibialSpineFracture", "patelarTendonRupture", "quadricepsTendonRupture",
  ]);
  const meaningful = (value: unknown): boolean => {
    if (value == null || value === "" || value === false) return false;
    if (Array.isArray(value)) return value.some(meaningful);
    if (typeof value === "object") return Object.entries(value as Record<string, unknown>)
      .some(([key, nested]) => !key.startsWith("_") && meaningful(nested));
    return true;
  };
  return Object.entries(snapshot as Record<string, unknown>)
    .some(([key, value]) => allowed.has(key) && meaningful(value));
}

function missingBilateralSide(data: z.infer<typeof DraftSurgeryBody>): "direito" | "esquerdo" | null {
  if (data.lado !== "Bilateral") return null;
  try {
    const details = JSON.parse(data.procedimentosDetalhados ?? "{}");
    const bilateral = details?.bilateral;
    if (bilateral?.schemaVersion !== 1 || !bilateral.byLimb) return "direito";
    if (!hasSubstantiveBilateralSide(bilateral.byLimb.direito)) return "direito";
    if (!hasSubstantiveBilateralSide(bilateral.byLimb.esquerdo)) return "esquerdo";
    return null;
  } catch {
    return "direito";
  }
}

function bilateralValidationMessage(locale: string, side: "direito" | "esquerdo"): string {
  if (locale === "es") {
    return `Falta documentación clínica o del procedimiento para la rodilla ${side === "direito" ? "derecha" : "izquierda"}.`;
  }
  return `Falta documentação clínica ou do procedimento para o joelho ${side}.`;
}

const FRESH_OCA_PROCEDURE = "Aloenxerto osteocondral fresco";

function selectsFreshOcaWithoutConfirmedBank(data: z.infer<typeof DraftSurgeryBody>): boolean {
  const selectsWithoutBank = (
    exam: unknown,
    procedureDetails: unknown,
  ): boolean => {
    if (
      exam
      && typeof exam === "object"
      && !Array.isArray(exam)
      && (exam as Record<string, unknown>).bancoTecidosDisponivel === true
    ) {
      return false;
    }
    if (!procedureDetails || typeof procedureDetails !== "object" || Array.isArray(procedureDetails)) {
      return false;
    }
    const osteocondral = (procedureDetails as Record<string, unknown>).osteocondral;
    if (!osteocondral || typeof osteocondral !== "object" || Array.isArray(osteocondral)) return false;
    const procedures = (osteocondral as Record<string, unknown>).procedimentos;
    return Array.isArray(procedures) && procedures.some(
      (procedure: unknown) => typeof procedure === "string"
        && procedure.toLocaleLowerCase() === FRESH_OCA_PROCEDURE.toLocaleLowerCase(),
    );
  };

  if (!data.procedimentosDetalhados) return false;

  try {
    const details = JSON.parse(data.procedimentosDetalhados);
    if (data.lado === "Bilateral" && details?.bilateral?.schemaVersion === 1) {
      return (["direito", "esquerdo"] as const).some((limb) => {
        const snapshot = details.bilateral.byLimb?.[limb];
        return selectsWithoutBank(snapshot?.exameOsteocondral, snapshot?.detalhesProcedimentos);
      });
    }
    return selectsWithoutBank(data.exameOsteocondral, details);
  } catch {
    return false;
  }
}

// Strip fields that must never be passed to Drizzle set()/values() for sub-tables.
// When loading a draft the API returns full DB rows (id, surgeryId, createdAt as
// strings). If those are echoed back and passed to Drizzle, the timestamp mapper
// calls `.toISOString()` on the string and throws "value.toISOString is not a function".
// Drizzle also drops undefined values; removing them here lets the empty-write guard
// prevent invalid SQL such as `UPDATE ... SET WHERE ...`.
export function cleanSubtable(obj: Record<string, unknown>): Record<string, unknown> {
  const { id: _id, surgeryId: _sid, createdAt: _ca, updatedAt: _ua, ...rest } = obj;
  return Object.fromEntries(
    Object.entries(rest).filter(([, value]) => value !== undefined),
  );
}

function cleanSubtableForTable(
  table: any,
  raw: Record<string, unknown>,
  additional: Record<string, unknown> = {},
): Record<string, unknown> {
  const tableColumns = getTableColumns(table) as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries({ ...cleanSubtable(raw), ...additional })
      .filter(([key, value]) => value !== undefined && key in tableColumns),
  );
}

async function insertSubtableIfPopulated(
  table: any,
  raw: Record<string, unknown> | null | undefined,
  surgeryId: number,
  additional: Record<string, unknown> = {},
) {
  if (!raw) return;

  const values = cleanSubtableForTable(table, raw, additional);
  if (Object.keys(values).length === 0) return;

  await db.insert(table).values({ ...values, surgeryId });
}

async function upsertSubtableIfPopulated(
  table: any,
  raw: Record<string, unknown> | null | undefined,
  surgeryId: number,
  additional: Record<string, unknown> = {},
) {
  if (!raw) return;

  const values = cleanSubtableForTable(table, raw, additional);
  if (Object.keys(values).length === 0) return;

  const columns = getTableColumns(table) as Record<string, any>;
  const [existing] = await db
    .select({ id: columns.id })
    .from(table)
    .where(eq(columns.surgeryId, surgeryId))
    .limit(1);

  if (existing) {
    await db.update(table).set(values).where(eq(columns.surgeryId, surgeryId));
  } else {
    await db.insert(table).values({ ...values, surgeryId });
  }
}

async function upsertSubtables(
  surgeryId: number,
  data: z.infer<typeof DraftSurgeryBody>,
) {
  await upsertSubtableIfPopulated(exameLigamentarTable, data.exameLigamentar, surgeryId);
  await upsertSubtableIfPopulated(lcaAlgorithmTable, data.lcaAlgorithm, surgeryId);
  await upsertSubtableIfPopulated(lcpReconstructionTable, data.lcpReconstruction, surgeryId);
  await upsertSubtableIfPopulated(cpmReconstructionTable, data.cpmReconstruction, surgeryId);
  await upsertSubtableIfPopulated(cplReconstructionTable, data.cplReconstruction, surgeryId);
  await upsertSubtableIfPopulated(procedimentoMeniscalTable, data.procedimentoMeniscal, surgeryId);
  await upsertSubtableIfPopulated(examePatelarTable, data.examePatelar, surgeryId);
  await upsertSubtableIfPopulated(picsScoreTable, data.picsScore, surgeryId);
  await upsertSubtableIfPopulated(periprostheticFractureTable, data.periprostheticFracture, surgeryId);
  await upsertSubtableIfPopulated(distalFemurFractureTable, data.distalFemurFracture, surgeryId);
  await upsertSubtableIfPopulated(tibialPlateauFractureTable, data.tibialPlateauFracture, surgeryId);
  await upsertSubtableIfPopulated(patellaFractureTable, data.patellaFracture, surgeryId);
  await upsertSubtableIfPopulated(tibialSpineFractureTable, data.tibialSpineFracture, surgeryId);
  await upsertSubtableIfPopulated(patelarTendonRuptureTable, data.patelarTendonRupture, surgeryId);
  await upsertSubtableIfPopulated(quadricepsTendonRuptureTable, data.quadricepsTendonRupture, surgeryId);
  await upsertSubtableIfPopulated(lcaLeapDecisionTable, data.aclLeapDecision, surgeryId);

  if (data.exameOsteocondral) {
    const { _ocdResult: _ignored, ...examFields } = data.exameOsteocondral as any;
    const ocdResult = (data as any).ocdAnalysis ?? null;
    await upsertSubtableIfPopulated(
      exameOsteocondralTable,
      examFields,
      surgeryId,
      ocdResult !== null ? { ocdResult } : {},
    );
  }
}

router.post("/surgeries/draft", requireAuth, async (req, res): Promise<void> => {
  const locale = await localeForDoctorId(req.doctorId);
  const parsed = DraftSurgeryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: localizedMessage(locale, "invalidData") });
    return;
  }
  if (!applyJSignNormalization(parsed.data)) {
    res.status(400).json({ error: localizedMessage(locale, "invalidData") });
    return;
  }
  if (selectsFreshOcaWithoutConfirmedBank(parsed.data)) {
    res.status(422).json({ error: localizedMessage(locale, "freshOcaBankConfirmationRequired") });
    return;
  }
  if (
    typeof parsed.data.patientId === "number" &&
    !(await patientBelongsToDoctor(parsed.data.patientId, req.doctorId!))
  ) {
    res.status(404).json({ error: localizedMessage(locale, "patientNotFound") });
    return;
  }

  try {
    const { id, exameLigamentar, lcaAlgorithm, lcpReconstruction, cpmReconstruction, cplReconstruction, procedimentoMeniscal, examePatelar, picsScore, periprostheticFracture, distalFemurFracture, tibialPlateauFracture, patellaFracture, tibialSpineFracture, patelarTendonRupture: _ptr1, quadricepsTendonRupture: _qtr1, aclLeapDecision: _ald1, exameOsteocondral: _ocd1, ocdAnalysis: _oca1, ...surgeryFields } = parsed.data;

    let surgery: typeof surgeriesTable.$inferSelect;

    if (id) {
      // Update existing draft
      const updated = await updateSurgeryWithLifecycleLock(
        id,
        req.doctorId!,
        { ...(surgeryFields as any), status: "rascunho" },
      );
      if (!updated) {
        res.status(404).json({ error: localizedMessage(locale, "draftNotFound") });
        return;
      }
      surgery = updated;
    } else {
      if (!surgeryFields.patientId) {
        res.status(400).json({ error: localizedMessage(locale, "selectPatientForDraft") });
        return;
      }
      const [created] = await db
        .insert(surgeriesTable)
        .values({ ...surgeryFields, patientId: surgeryFields.patientId, doctorId: req.doctorId!, tiposProcedimento: surgeryFields.tiposProcedimento ?? [], ligamentosAcometidos: surgeryFields.ligamentosAcometidos ?? [], status: "rascunho" })
        .returning();
      surgery = created;
    }

    await upsertSubtables(surgery.id, parsed.data);

    if (hasFractureProcedure(surgery.tiposProcedimento as string[] | null)) {
      await removePreoperativeNotifications(surgery.id);
    }

    res.json({ ...surgery, createdAt: surgery.createdAt.toISOString() });
  } catch (err) {
    console.error("[POST /surgeries/draft]", err);
    res.status(500).json({ error: localizedMessage(locale, "draftSaveFailed") });
  }
});

router.post("/surgeries/:id/finalize", requireAuth, async (req, res): Promise<void> => {
  const locale = await localeForDoctorId(req.doctorId);
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: localizedMessage(locale, "invalidId") }); return; }

  const parsed = DraftSurgeryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: localizedMessage(locale, "invalidData") });
    return;
  }
  if (!applyJSignNormalization(parsed.data)) {
    res.status(400).json({ error: localizedMessage(locale, "invalidData") });
    return;
  }
  if (selectsFreshOcaWithoutConfirmedBank(parsed.data)) {
    res.status(422).json({ error: localizedMessage(locale, "freshOcaBankConfirmationRequired") });
    return;
  }
  const missingSide = missingBilateralSide(parsed.data);
  if (missingSide) {
    res.status(422).json({ error: bilateralValidationMessage(locale, missingSide), missingLimb: missingSide });
    return;
  }

  if (
    typeof parsed.data.patientId === "number" &&
    !(await patientBelongsToDoctor(parsed.data.patientId, req.doctorId!))
  ) {
    res.status(404).json({ error: localizedMessage(locale, "patientNotFound") });
    return;
  }

  const { id: _draftId, exameLigamentar, lcaAlgorithm, lcpReconstruction, cpmReconstruction, cplReconstruction, procedimentoMeniscal, examePatelar, picsScore, periprostheticFracture, distalFemurFracture, tibialPlateauFracture, patellaFracture, tibialSpineFracture, patelarTendonRupture, quadricepsTendonRupture, aclLeapDecision, exameOsteocondral: _exOcd4, ocdAnalysis: _oca4, ...surgeryData } = parsed.data;

  try {
    const surgery = await updateSurgeryWithLifecycleLock(
      id,
      req.doctorId!,
      { ...(surgeryData as any), status: "completo" },
    );

    if (!surgery) { res.status(404).json({ error: localizedMessage(locale, "surgeryNotFound") }); return; }

    await upsertSubtables(id, parsed.data as any);

    await syncSurgerySchedule({
      id,
      patientId: surgery.patientId,
      ligamentosAcometidos: (surgery.ligamentosAcometidos ?? []) as string[],
      tiposProcedimento: (surgery.tiposProcedimento ?? []) as string[],
      dataCirurgia: surgery.dataCirurgia,
    });

    res.json({ ...surgery, createdAt: surgery.createdAt.toISOString() });
  } catch (err) {
    console.error("[POST /surgeries/:id/finalize]", err);
    res.status(500).json({ error: localizedMessage(locale, "surgeryFinalizeFailed") });
  }
});

router.get("/surgeries", requireAuth, async (req, res): Promise<void> => {
  const surgeries = await db
    .select({
      surgery: surgeriesTable,
      patientNome: patientsTable.nome,
      patientSexo: patientsTable.sexo,
      patientLado: patientsTable.lado,
    })
    .from(surgeriesTable)
    .leftJoin(patientsTable, eq(surgeriesTable.patientId, patientsTable.id))
    .where(eq(surgeriesTable.doctorId, req.doctorId!))
    .orderBy(sql`${surgeriesTable.dataCirurgia} DESC NULLS LAST`, desc(surgeriesTable.createdAt));

  const result = surgeries.map(({ surgery, patientNome, patientSexo, patientLado }) => ({
    ...surgery,
    createdAt: surgery.createdAt.toISOString(),
    patientNome: patientNome ?? "",
    patientSexo,
    patientLado,
  }));

  res.json(result);
});

router.post("/surgeries", requireAuth, async (req, res): Promise<void> => {
  const locale = await localeForDoctorId(req.doctorId);
  const parsed = DraftSurgeryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: localizedMessage(locale, "invalidData") });
    return;
  }
  if (!applyJSignNormalization(parsed.data)) {
    res.status(400).json({ error: localizedMessage(locale, "invalidData") });
    return;
  }
  if (selectsFreshOcaWithoutConfirmedBank(parsed.data)) {
    res.status(422).json({ error: localizedMessage(locale, "freshOcaBankConfirmationRequired") });
    return;
  }
  const missingSide = missingBilateralSide(parsed.data);
  if (missingSide) {
    res.status(422).json({ error: bilateralValidationMessage(locale, missingSide), missingLimb: missingSide });
    return;
  }

  if (!parsed.data.patientId) {
    res.status(400).json({ error: localizedMessage(locale, "patientIdRequired") });
    return;
  }

  if (!(await patientBelongsToDoctor(parsed.data.patientId, req.doctorId!))) {
    res.status(404).json({ error: localizedMessage(locale, "patientNotFound") });
    return;
  }

  const { id: _draftId, exameLigamentar, lcaAlgorithm, lcpReconstruction, cpmReconstruction, cplReconstruction, procedimentoMeniscal, examePatelar, picsScore, periprostheticFracture, distalFemurFracture, tibialPlateauFracture, patellaFracture, tibialSpineFracture, patelarTendonRupture, quadricepsTendonRupture, aclLeapDecision, exameOsteocondral: _exOcdPost, ocdAnalysis: _ocaPost, ...surgeryData } = parsed.data;

  const [surgery] = await db.transaction(async (tx) => {
    const rxImageUrl = typeof surgeryData.rxImageUrl === "string" ? surgeryData.rxImageUrl : null;
    if (rxImageUrl) {
      await lockStoragePath(tx, rxImageUrl);
      const objectGeneration = await objectStorageService.getObjectEntityGeneration(rxImageUrl);
      if (!await claimXrayGrantForObjectPath(tx, req.doctorId!, rxImageUrl, objectGeneration)) {
        throw new Error("Pending X-ray upload grant is invalid, expired, or already used");
      }
    }
    return tx.insert(surgeriesTable).values({
      ...surgeryData,
      patientId: surgeryData.patientId!,
      tiposProcedimento: surgeryData.tiposProcedimento ?? [],
      ligamentosAcometidos: surgeryData.ligamentosAcometidos ?? [],
      doctorId: req.doctorId!,
    }).returning();
  });

  await insertSubtableIfPopulated(exameLigamentarTable, exameLigamentar, surgery.id);
  await insertSubtableIfPopulated(lcaAlgorithmTable, lcaAlgorithm, surgery.id);
  await insertSubtableIfPopulated(lcpReconstructionTable, lcpReconstruction, surgery.id);
  await insertSubtableIfPopulated(cpmReconstructionTable, cpmReconstruction, surgery.id);
  await insertSubtableIfPopulated(cplReconstructionTable, cplReconstruction, surgery.id);
  await insertSubtableIfPopulated(procedimentoMeniscalTable, procedimentoMeniscal, surgery.id);
  await insertSubtableIfPopulated(examePatelarTable, examePatelar, surgery.id);
  await insertSubtableIfPopulated(picsScoreTable, picsScore, surgery.id);
  await insertSubtableIfPopulated(periprostheticFractureTable, periprostheticFracture, surgery.id);
  await insertSubtableIfPopulated(distalFemurFractureTable, distalFemurFracture, surgery.id);
  await insertSubtableIfPopulated(tibialPlateauFractureTable, tibialPlateauFracture, surgery.id);
  await insertSubtableIfPopulated(patellaFractureTable, patellaFracture, surgery.id);
  await insertSubtableIfPopulated(tibialSpineFractureTable, tibialSpineFracture, surgery.id);
  await insertSubtableIfPopulated(patelarTendonRuptureTable, patelarTendonRupture, surgery.id);
  await insertSubtableIfPopulated(quadricepsTendonRuptureTable, quadricepsTendonRupture, surgery.id);
  await insertSubtableIfPopulated(lcaLeapDecisionTable, aclLeapDecision, surgery.id);
  if (parsed.data.exameOsteocondral && Object.keys(parsed.data.exameOsteocondral).length > 0) {
    const { _ocdResult: _ign, ...examFields } = parsed.data.exameOsteocondral as any;
    const ocdResult = (parsed.data as any).ocdAnalysis ?? null;
    await insertSubtableIfPopulated(
      exameOsteocondralTable,
      examFields,
      surgery.id,
      ocdResult !== null ? { ocdResult } : {},
    );
  }

  await syncSurgerySchedule({
    id: surgery.id,
    patientId: surgery.patientId,
    ligamentosAcometidos: (surgery.ligamentosAcometidos ?? []) as string[],
    tiposProcedimento: (surgery.tiposProcedimento ?? []) as string[],
    dataCirurgia: surgery.dataCirurgia,
  });

  res.status(201).json({ ...surgery, createdAt: surgery.createdAt.toISOString() });
});

router.post("/surgeries/:id/schedule/preop", requireAuth, async (req, res): Promise<void> => {
  let locale = await localeForDoctorId(req.doctorId);
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: localizedMessage(locale, "invalidId") }); return; }

  const [surgery] = await db
    .select()
    .from(surgeriesTable)
    .where(and(
      eq(surgeriesTable.id, id),
      eq(surgeriesTable.doctorId, req.doctorId!),
    ))
    .limit(1);
  if (!surgery) { res.status(404).json({ error: localizedMessage(locale, "surgeryNotFound") }); return; }
  locale = await localeForDoctorId(surgery.doctorId);

  if (hasFractureProcedure(surgery.tiposProcedimento as string[] | null)) {
    await removePreoperativeNotifications(id);
    res.status(409).json({ error: localizedMessage(locale, "fracturePreoperativeFollowupUnavailable") });
    return;
  }

  const notification = await ensurePreoperativeNotification({
    id,
    patientId: surgery.patientId,
    ligamentosAcometidos: (surgery.ligamentosAcometidos ?? []) as string[],
    tiposProcedimento: (surgery.tiposProcedimento ?? []) as string[],
    dataCirurgia: surgery.dataCirurgia,
  });

  if (!notification) {
    res.status(422).json({ error: localizedMessage(await localeForDoctorId(surgery.doctorId), "preoperativeProtocolUnavailable") });
    return;
  }
  res.json(notification);
});

router.post("/surgeries/:id/schedule/generate", requireAuth, async (req, res): Promise<void> => {
  let locale = await localeForDoctorId(req.doctorId);
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: localizedMessage(locale, "invalidId") }); return; }
  const [surgery] = await db.select().from(surgeriesTable)
    .where(and(eq(surgeriesTable.id, id), eq(surgeriesTable.doctorId, req.doctorId!)))
    .limit(1);
  if (!surgery) { res.status(404).json({ error: localizedMessage(locale, "surgeryNotFound") }); return; }
  locale = await localeForDoctorId(surgery.doctorId);
  const rows = await syncSurgerySchedule({
    id,
    patientId: surgery.patientId,
    ligamentosAcometidos: (surgery.ligamentosAcometidos ?? []) as string[],
    tiposProcedimento: (surgery.tiposProcedimento ?? []) as string[],
    dataCirurgia: surgery.dataCirurgia,
  });
  res.json(rows);
});

router.get("/surgeries/:id/schedule", requireAuth, async (req, res): Promise<void> => {
  let locale = await localeForDoctorId(req.doctorId);
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: localizedMessage(locale, "invalidId") }); return; }
  const [surgery] = await db.select({
    id: surgeriesTable.id,
    doctorId: surgeriesTable.doctorId,
    tiposProcedimento: surgeriesTable.tiposProcedimento,
  }).from(surgeriesTable)
    .where(and(eq(surgeriesTable.id, id), eq(surgeriesTable.doctorId, req.doctorId!)))
    .limit(1);
  if (!surgery) { res.status(404).json({ error: localizedMessage(locale, "surgeryNotFound") }); return; }
  locale = await localeForDoctorId(surgery.doctorId);

  if ((surgery.tiposProcedimento as string[] | null)?.includes("Fraturas")) {
    await removePreoperativeNotifications(id);
  }

  const rows = await db
    .select()
    .from(scheduledNotificationsTable)
    .where(eq(scheduledNotificationsTable.surgeryId, id))
    .orderBy(scheduledNotificationsTable.daysAfterSurgery);
  res.json(
    hasFractureProcedure(surgery.tiposProcedimento as string[] | null)
      ? rows.filter((row) => !isPreoperativePeriod(row.periodo))
      : rows,
  );
});

// GET preview of whatsapp message before sending (also creates the followup/token)
router.post("/surgeries/:id/schedule/:notifId/prepare-whatsapp", requireAuth, async (req, res): Promise<void> => {
  let locale = await localeForDoctorId(req.doctorId);
  const surgeryId = parseInt(String(req.params.id ?? ""), 10);
  const notifId = parseInt(String(req.params.notifId ?? ""), 10);

  const [row] = await db
    .select({ notif: scheduledNotificationsTable, patient: patientsTable, surgery: surgeriesTable, doctor: doctorsTable })
    .from(scheduledNotificationsTable)
    .innerJoin(patientsTable, eq(scheduledNotificationsTable.patientId, patientsTable.id))
    .innerJoin(surgeriesTable, eq(scheduledNotificationsTable.surgeryId, surgeriesTable.id))
    .innerJoin(doctorsTable, eq(surgeriesTable.doctorId, doctorsTable.id))
    .where(and(
      eq(scheduledNotificationsTable.id, notifId),
      eq(scheduledNotificationsTable.surgeryId, surgeryId),
      eq(surgeriesTable.doctorId, req.doctorId!),
    ));

  if (!row) { res.status(404).json({ error: localizedMessage(locale, "appointmentNotFound") }); return; }
  locale = resolveDoctorLocale(row.doctor.idioma);

  if (
    hasFractureProcedure(row.surgery.tiposProcedimento as string[] | null)
    && isPreoperativePeriod(row.notif.periodo)
  ) {
    await removePreoperativeNotifications(surgeryId);
    res.status(409).json({ error: localizedMessage(locale, "fracturePreoperativeFollowupUnavailable") });
    return;
  }

  let followup: typeof followupTable.$inferSelect | null;
  try {
    followup = await ensureFollowupForNotification(surgeryId, notifId);
  } catch (error) {
    if (!(error instanceof PreoperativeFractureError)) throw error;
    await removePreoperativeNotifications(surgeryId);
    res.status(409).json({ error: localizedMessage(locale, "fracturePreoperativeFollowupUnavailable") });
    return;
  }
  if (!followup?.token) {
    res.status(404).json({ error: localizedMessage(locale, "appointmentNotFound") });
    return;
  }

  const link = `${getBaseUrl(req)}/patient/${followup.token}`;

  const message = buildFollowupMessage({
    patientName: row.patient.nome,
    periodo: row.notif.periodo,
    scales: row.notif.scales ?? [],
    link,
    doctorName: row.doctor.nome,
    locale: resolveDoctorLocale(row.doctor.idioma),
  });

  res.json({ token: followup.token, link, message, followupId: followup.id, hasTelefone: !!row.patient.telefone });
});

router.post("/surgeries/:id/schedule/:notifId/whatsapp", requireAuth, async (req, res): Promise<void> => {
  let locale = await localeForDoctorId(req.doctorId);
  const surgeryId = parseInt(String(req.params.id ?? ""), 10);
  const notifId = parseInt(String(req.params.notifId ?? ""), 10);
  const { customMessage, followupId } = req.body as { customMessage?: string; followupId?: number };

  const [row] = await db
    .select({ notif: scheduledNotificationsTable, patient: patientsTable, surgery: surgeriesTable, doctor: doctorsTable })
    .from(scheduledNotificationsTable)
    .innerJoin(patientsTable, eq(scheduledNotificationsTable.patientId, patientsTable.id))
    .innerJoin(surgeriesTable, eq(scheduledNotificationsTable.surgeryId, surgeriesTable.id))
    .innerJoin(doctorsTable, eq(surgeriesTable.doctorId, doctorsTable.id))
    .where(and(
      eq(scheduledNotificationsTable.id, notifId),
      eq(scheduledNotificationsTable.surgeryId, surgeryId),
      eq(surgeriesTable.doctorId, req.doctorId!),
    ));

  if (!row) { res.status(404).json({ error: localizedMessage(locale, "appointmentNotFound") }); return; }
  locale = resolveDoctorLocale(row.doctor.idioma);

  if (
    hasFractureProcedure(row.surgery.tiposProcedimento as string[] | null)
    && isPreoperativePeriod(row.notif.periodo)
  ) {
    await removePreoperativeNotifications(surgeryId);
    res.status(409).json({ error: localizedMessage(locale, "fracturePreoperativeFollowupUnavailable") });
    return;
  }

  if (!row.patient.telefone) {
    res.status(400).json({ error: localizedMessage(locale, "patientNoPhone") });
    return;
  }

  // Use pre-created followup or create a new one
  if (
    followupId !== undefined &&
    (!Number.isInteger(followupId) || followupId <= 0)
  ) {
    res.status(400).json({ error: localizedMessage(locale, "invalidFollowupId") });
    return;
  }

  let existingF: typeof followupTable.$inferSelect | null;
  try {
    existingF = await ensureFollowupForNotification(surgeryId, notifId, followupId);
  } catch (error) {
    if (!(error instanceof PreoperativeFractureError)) throw error;
    await removePreoperativeNotifications(surgeryId);
    res.status(409).json({ error: localizedMessage(locale, "fracturePreoperativeFollowupUnavailable") });
    return;
  }
  if (!existingF?.token) { res.status(404).json({ error: localizedMessage(locale, "followupNotFound") }); return; }

  const sendOutcome = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(87001, CAST(${surgeryId} AS integer))`,
    );
    const [locked] = await tx
      .select({ notif: scheduledNotificationsTable, patient: patientsTable, surgery: surgeriesTable, doctor: doctorsTable })
      .from(scheduledNotificationsTable)
      .innerJoin(patientsTable, eq(scheduledNotificationsTable.patientId, patientsTable.id))
      .innerJoin(surgeriesTable, eq(scheduledNotificationsTable.surgeryId, surgeriesTable.id))
      .innerJoin(doctorsTable, eq(surgeriesTable.doctorId, doctorsTable.id))
      .where(and(
        eq(scheduledNotificationsTable.id, notifId),
        eq(scheduledNotificationsTable.surgeryId, surgeryId),
        eq(surgeriesTable.doctorId, req.doctorId!),
      ))
      .for("update")
      .limit(1);
    if (!locked) return { kind: "missing" as const };
    if (
      hasFractureProcedure(locked.surgery.tiposProcedimento as string[] | null)
      && isPreoperativePeriod(locked.notif.periodo)
    ) {
      await tx
        .update(scheduledNotificationsTable)
        .set({ status: "skipped", nextAttemptAt: null, claimedAt: null })
        .where(eq(scheduledNotificationsTable.id, notifId));
      return { kind: "blocked" as const };
    }
    if (!locked.patient.telefone) return { kind: "no_phone" as const };

    const link = `${getBaseUrl(req)}/patient/${existingF.token}`;
    const text = customMessage ?? buildFollowupMessage({
      patientName: locked.patient.nome,
      periodo: locked.notif.periodo,
      scales: locked.notif.scales ?? [],
      link,
      doctorName: locked.doctor.nome,
      locale: resolveDoctorLocale(locked.doctor.idioma),
    });
    const result = await sendWhatsAppText(locked.patient.telefone, text, {
      idempotencyKey: `scheduled-notification:${notifId}`,
    });
    if (result.ok) {
      await tx
        .update(scheduledNotificationsTable)
        .set({ status: "sent", sentAt: new Date(), followupId: existingF.id, whatsappMessageId: result.messageId })
        .where(eq(scheduledNotificationsTable.id, notifId));
    }
    return { kind: "sent" as const, result };
  });

  if (sendOutcome.kind === "missing") {
    res.status(404).json({ error: localizedMessage(locale, "appointmentNotFound") });
  } else if (sendOutcome.kind === "blocked") {
    res.status(409).json({ error: localizedMessage(locale, "fracturePreoperativeFollowupUnavailable") });
  } else if (sendOutcome.kind === "no_phone") {
    res.status(400).json({ error: localizedMessage(locale, "patientNoPhone") });
  } else if (sendOutcome.result.ok) {
    res.json({ ok: true, followupId: existingF.id, messageId: sendOutcome.result.messageId });
  } else {
    res.status(502).json({ ok: false, error: localizedMessage(locale, "sendFailed") });
  }
});

router.patch("/surgeries/:id/schedule/:notifId/status", requireAuth, async (req, res): Promise<void> => {
  let locale = await localeForDoctorId(req.doctorId);
  const surgeryId = parseInt(String(req.params.id ?? ""), 10);
  const notifId = parseInt(String(req.params.notifId ?? ""), 10);
  const { status } = req.body as { status: string };
  if (!["pending", "sent", "skipped", "completed"].includes(status)) {
    res.status(400).json({ error: localizedMessage(locale, "invalidStatus") }); return;
  }
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(87001, CAST(${surgeryId} AS integer))`,
    );
    const [owned] = await tx
      .select({
        notification: scheduledNotificationsTable,
        surgery: surgeriesTable,
      })
      .from(scheduledNotificationsTable)
      .innerJoin(surgeriesTable, eq(scheduledNotificationsTable.surgeryId, surgeriesTable.id))
      .where(and(
        eq(scheduledNotificationsTable.id, notifId),
        eq(scheduledNotificationsTable.surgeryId, surgeryId),
        eq(surgeriesTable.doctorId, req.doctorId!),
      ))
      .for("update")
      .limit(1);
    if (!owned) return { kind: "missing" as const };
    if (
      hasFractureProcedure(owned.surgery.tiposProcedimento as string[] | null)
      && isPreoperativePeriod(owned.notification.periodo)
    ) {
      await tx
        .update(scheduledNotificationsTable)
        .set({ status: "skipped", nextAttemptAt: null, claimedAt: null })
        .where(eq(scheduledNotificationsTable.id, notifId));
      return { kind: "blocked" as const, doctorId: owned.surgery.doctorId };
    }

    const [updated] = await tx
      .update(scheduledNotificationsTable)
      .set({ status, ...(status === "sent" ? { sentAt: new Date() } : {}) })
      .where(eq(scheduledNotificationsTable.id, notifId))
      .returning();
    return { kind: "updated" as const, updated, doctorId: owned.surgery.doctorId };
  });

  if (outcome.kind === "missing") {
    res.status(404).json({ error: localizedMessage(locale, "appointmentNotFound") });
    return;
  }
  locale = await localeForDoctorId(outcome.doctorId);
  if (outcome.kind === "blocked") {
    res.status(409).json({ error: localizedMessage(locale, "fracturePreoperativeFollowupUnavailable") });
    return;
  }
  res.json(outcome.updated);
});

router.get("/surgeries/:id", requireAuth, async (req, res): Promise<void> => {
  const locale = await localeForDoctorId(req.doctorId);
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: localizedMessage(locale, "invalidId") });
    return;
  }

  const [surgery] = await db
    .select()
    .from(surgeriesTable)
    .where(and(eq(surgeriesTable.id, id), eq(surgeriesTable.doctorId, req.doctorId!)))
    .limit(1);

  if (!surgery) {
    res.status(404).json({ error: localizedMessage(locale, "surgeryNotFound") });
    return;
  }

  const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, surgery.patientId)).limit(1);
  const [exame] = await db.select().from(exameLigamentarTable).where(eq(exameLigamentarTable.surgeryId, id)).limit(1);
  const [lca] = await db.select().from(lcaAlgorithmTable).where(eq(lcaAlgorithmTable.surgeryId, id)).limit(1);
  const [lcp] = await db.select().from(lcpReconstructionTable).where(eq(lcpReconstructionTable.surgeryId, id)).limit(1);
  const [cpm] = await db.select().from(cpmReconstructionTable).where(eq(cpmReconstructionTable.surgeryId, id)).limit(1);
  const [cpl] = await db.select().from(cplReconstructionTable).where(eq(cplReconstructionTable.surgeryId, id)).limit(1);
  const [menisco] = await db.select().from(procedimentoMeniscalTable).where(eq(procedimentoMeniscalTable.surgeryId, id)).limit(1);
  const [patelar] = await db.select().from(examePatelarTable).where(eq(examePatelarTable.surgeryId, id)).limit(1);
  const [pics] = await db.select().from(picsScoreTable).where(eq(picsScoreTable.surgeryId, id)).limit(1);
  const [periprostheticFracture] = await db.select().from(periprostheticFractureTable).where(eq(periprostheticFractureTable.surgeryId, id)).limit(1);
  const [distalFemurFracture] = await db.select().from(distalFemurFractureTable).where(eq(distalFemurFractureTable.surgeryId, id)).limit(1);
  const [tibialPlateauFracture] = await db.select().from(tibialPlateauFractureTable).where(eq(tibialPlateauFractureTable.surgeryId, id)).limit(1);
  const [patellaFracture] = await db.select().from(patellaFractureTable).where(eq(patellaFractureTable.surgeryId, id)).limit(1);
  const [tibialSpineFracture] = await db.select().from(tibialSpineFractureTable).where(eq(tibialSpineFractureTable.surgeryId, id)).limit(1);
  const [patelarTendonRuptureRow] = await db.select().from(patelarTendonRuptureTable).where(eq(patelarTendonRuptureTable.surgeryId, id)).limit(1);
  const [quadricepsTendonRuptureRow] = await db.select().from(quadricepsTendonRuptureTable).where(eq(quadricepsTendonRuptureTable.surgeryId, id)).limit(1);
  const [aclLeapDecisionRow] = await db.select().from(lcaLeapDecisionTable).where(eq(lcaLeapDecisionTable.surgeryId, id)).limit(1);
  const [exameOsteocondralRow] = await db.select().from(exameOsteocondralTable).where(eq(exameOsteocondralTable.surgeryId, id)).limit(1);
  const followups = await db.select().from(followupTable).where(eq(followupTable.surgeryId, id)).orderBy(followupTable.createdAt);
  const visibleFollowups = hasFractureProcedure(surgery.tiposProcedimento as string[] | null)
    ? followups.filter((followup) => !isPreoperativePeriod(followup.tempo))
    : followups;

  res.json({
    ...surgery,
    createdAt: surgery.createdAt.toISOString(),
    patient: patient ? { ...patient, createdAt: patient.createdAt.toISOString() } : null,
    exameLigamentar: exame ?? null,
    lcaAlgorithm: lca ?? null,
    lcpReconstruction: lcp ?? null,
    cpmReconstruction: cpm ?? null,
    cplReconstruction: cpl ?? null,
    procedimentoMeniscal: menisco ?? null,
    examePatelar: patelar
      ? {
          ...patelar,
          ...(patelar.jSign === true && storedJSignGrade(surgery.procedimentosDetalhados) !== null
            ? { jSignGrau: storedJSignGrade(surgery.procedimentosDetalhados) }
            : {}),
        }
      : null,
    picsScore: pics ?? null,
    periprostheticFracture: periprostheticFracture ?? null,
    distalFemurFracture: distalFemurFracture ?? null,
    tibialPlateauFracture: tibialPlateauFracture ?? null,
    patellaFracture: patellaFracture ?? null,
    tibialSpineFracture: tibialSpineFracture ?? null,
    patelarTendonRupture: patelarTendonRuptureRow ?? null,
    quadricepsTendonRupture: quadricepsTendonRuptureRow ?? null,
    aclLeapDecision: aclLeapDecisionRow ?? null,
    exameOsteocondral: exameOsteocondralRow ?? null,
    followups: visibleFollowups.map(f => ({ ...f, createdAt: f.createdAt.toISOString() })),
  });
});

router.patch("/surgeries/:id", requireAuth, async (req, res): Promise<void> => {
  const locale = await localeForDoctorId(req.doctorId);
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: localizedMessage(locale, "invalidId") });
    return;
  }

  const parsed = UpdateSurgeryWithClinicalBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: localizedMessage(locale, "invalidData") });
    return;
  }
  if (!applyJSignNormalization(parsed.data)) {
    res.status(400).json({ error: localizedMessage(locale, "invalidData") });
    return;
  }
  if (Object.keys(parsed.data).length === 0) {
    res.status(400).json({ error: localizedMessage(locale, "noValidSurgeryFields") });
    return;
  }

  const [existingSurgery] = await db
    .select()
    .from(surgeriesTable)
    .where(and(eq(surgeriesTable.id, id), eq(surgeriesTable.doctorId, req.doctorId!)))
    .limit(1);
  if (!existingSurgery) {
    res.status(404).json({ error: localizedMessage(locale, "surgeryNotFound") });
    return;
  }
  // A PATCH may update only the exam object. Preserve the existing JSON
  // envelope while replacing/removing the compatibility grade in that case.
  if (
    parsed.data.examePatelar !== undefined
    && parsed.data.procedimentosDetalhados === undefined
  ) {
    parsed.data.procedimentosDetalhados = normalizeJSignInDetails(
      existingSurgery.procedimentosDetalhados,
      parsed.data.examePatelar,
    );
  }
  const mergedForValidation = {
    ...existingSurgery,
    ...parsed.data,
  } as unknown as z.infer<typeof DraftSurgeryBody>;
  const missingSide = missingBilateralSide(mergedForValidation);
  if (missingSide) {
    res.status(422).json({ error: bilateralValidationMessage(locale, missingSide), missingLimb: missingSide });
    return;
  }
  if (mergedForValidation.lado !== "Bilateral" && selectsFreshOcaWithoutConfirmedBank(mergedForValidation)) {
    const [existingOsteocondralExam] = await db
      .select()
      .from(exameOsteocondralTable)
      .where(eq(exameOsteocondralTable.surgeryId, id))
      .limit(1);
    if (existingOsteocondralExam) {
      mergedForValidation.exameOsteocondral = existingOsteocondralExam;
    }
  }
  if (selectsFreshOcaWithoutConfirmedBank(mergedForValidation)) {
    res.status(422).json({ error: localizedMessage(locale, "freshOcaBankConfirmationRequired") });
    return;
  }

  const {
    examePatelar,
    procedimentosDetalhados,
    ...surgeryPatch
  } = parsed.data;
  let surgery = Object.keys(surgeryPatch).length > 0
    ? await updateSurgeryWithLifecycleLock(
        id,
        req.doctorId!,
        surgeryPatch as Record<string, unknown>,
      )
    : existingSurgery;

  if (!surgery) {
    res.status(404).json({ error: localizedMessage(locale, "surgeryNotFound") });
    return;
  }
  if (examePatelar !== undefined) {
    await upsertSubtableIfPopulated(examePatelarTable, examePatelar, id);
  }
  if (procedimentosDetalhados !== undefined) {
    const updatedWithDetails = await updateSurgeryWithLifecycleLock(
      id,
      req.doctorId!,
      { procedimentosDetalhados },
    );
    if (updatedWithDetails) surgery = updatedWithDetails;
  }

  // Se a data da cirurgia foi alterada, recalcula o calendário de follow-up
  if (
    parsed.data.dataCirurgia !== undefined
    || "tiposProcedimento" in parsed.data
    || "ligamentosAcometidos" in parsed.data
  ) {
    await syncSurgerySchedule({
      id,
      patientId: surgery.patientId,
      ligamentosAcometidos: (surgery.ligamentosAcometidos ?? []) as string[],
      tiposProcedimento: (surgery.tiposProcedimento ?? []) as string[],
      dataCirurgia: surgery.dataCirurgia,
    });
  }

  res.json({ ...surgery, createdAt: surgery.createdAt.toISOString() });
});

router.delete("/surgeries/:id", requireAuth, async (req, res): Promise<void> => {
  const locale = await localeForDoctorId(req.doctorId);
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: localizedMessage(locale, "invalidId") });
    return;
  }

  const [deleted] = await db
    .delete(surgeriesTable)
    .where(and(eq(surgeriesTable.id, id), eq(surgeriesTable.doctorId, req.doctorId!)))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: localizedMessage(locale, "surgeryNotFound") });
    return;
  }

  res.status(200).json({ success: true });
});

// PATCH /surgeries/:id/followups/:fId — doctor updates ADM + complications + notes
router.patch("/surgeries/:id/followups/:fId", requireAuth, async (req, res): Promise<void> => {
  let locale = await localeForDoctorId(req.doctorId);
  const surgeryId = parseInt(String(req.params.id ?? ""), 10);
  const fId = parseInt(String(req.params.fId ?? ""), 10);
  if (isNaN(surgeryId) || isNaN(fId)) { res.status(400).json({ error: localizedMessage(locale, "invalidId") }); return; }

  // Verify surgery belongs to this doctor
  const [surgery] = await db.select({ id: surgeriesTable.id, doctorId: surgeriesTable.doctorId }).from(surgeriesTable)
    .where(and(eq(surgeriesTable.id, surgeryId), eq(surgeriesTable.doctorId, req.doctorId!)))
    .limit(1);
  if (!surgery) { res.status(404).json({ error: localizedMessage(locale, "surgeryNotFound") }); return; }
  locale = await localeForDoctorId(surgery.doctorId);

  const { admFlexao, admExtensao, complicacoes, observacoes } = req.body as {
    admFlexao?: number | null;
    admExtensao?: number | null;
    complicacoes?: string[];
    observacoes?: string | null;
  };

  const patch: Record<string, unknown> = {};
  if (admFlexao !== undefined) patch.admFlexao = admFlexao === null ? null : Number(admFlexao);
  if (admExtensao !== undefined) patch.admExtensao = admExtensao === null ? null : Number(admExtensao);
  if (complicacoes !== undefined) patch.complicacoes = complicacoes;
  if (observacoes !== undefined) patch.observacoes = observacoes;

  if (Object.keys(patch).length === 0) { res.status(400).json({ error: localizedMessage(locale, "noFollowupFields") }); return; }

  const [updated] = await db
    .update(followupTable)
    .set(patch)
    .where(and(
      eq(followupTable.id, fId),
      eq(followupTable.surgeryId, surgeryId),
    ))
    .returning();
  if (!updated) { res.status(404).json({ error: localizedMessage(locale, "followupNotFound") }); return; }

  res.json(updated);
});

export default router;
