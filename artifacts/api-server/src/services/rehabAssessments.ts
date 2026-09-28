import { z } from "zod/v4";
import { db, physioFollowupsTable, rehabAssessmentsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

// ── Tipos de avaliação suportados ───────────────────────────────────────────
export const ASSESSMENT_TYPES = [
  "adm",
  "derrame",
  "circunferencia",
  "forca",
  "forca_mrc",
  "agachamento_unipodal",
  "valgo_dinamico",
  "equilibrio",
  "hop",
  "y_balance",
  "less",
  "acl_rsi",
  "marcha",
  "tug",
  "sts_30s",
  "visa_p",
  "dor_carga",
  "retorno_esporte",
] as const;

export type AssessmentType = (typeof ASSESSMENT_TYPES)[number];

const base = {
  observacoes: z.string().optional(),
  falseio: z.boolean().optional(), // episódio de falseio relatado
};

const payloadSchemas: Record<AssessmentType, z.ZodType> = {
  adm: z.object({
    ...base,
    extensao_deficit_graus: z.number().min(-20).max(60), // 0 = extensão completa
    flexao_graus: z.number().min(0).max(180),
  }),
  derrame: z.object({
    ...base,
    grau: z.number().int().min(0).max(3), // stroke test 0–3
    persistente: z.boolean().optional(),
  }),
  circunferencia: z.object({
    ...base,
    coxa_operado_cm: z.number().positive(),
    coxa_saudavel_cm: z.number().positive(),
  }),
  forca: z.object({
    ...base,
    quadriceps_operado: z.number().positive(),
    quadriceps_saudavel: z.number().positive(),
    isquiotibiais_operado: z.number().positive().optional(),
    isquiotibiais_saudavel: z.number().positive().optional(),
    unidade: z.string().optional(), // kgf, Nm etc.
  }),
  forca_mrc: z.object({
    ...base,
    quadriceps_mrc: z.number().int().min(0).max(5),
    isquiotibiais_mrc: z.number().int().min(0).max(5).optional(),
    slr_sem_lag: z.boolean().optional(),
  }),
  agachamento_unipodal: z.object({
    ...base,
    qualidade: z.enum(["bom", "moderado", "ruim"]),
  }),
  valgo_dinamico: z.object({
    ...base,
    grau: z.enum(["ausente", "leve", "moderado", "grave"]),
  }),
  equilibrio: z.object({
    ...base,
    teste: z.string().optional(),
    resultado: z.string().optional(),
  }),
  hop: z.object({
    ...base,
    single_operado: z.number().positive(),
    single_saudavel: z.number().positive(),
    triple_operado: z.number().positive().optional(),
    triple_saudavel: z.number().positive().optional(),
    crossover_operado: z.number().positive().optional(),
    crossover_saudavel: z.number().positive().optional(),
  }),
  y_balance: z.object({
    ...base,
    composto_operado: z.number().positive(),
    composto_saudavel: z.number().positive(),
  }),
  less: z.object({
    ...base,
    escore: z.number().min(0).max(17),
  }),
  acl_rsi: z.object({
    ...base,
    escore: z.number().min(0).max(100),
  }),
  marcha: z.object({
    ...base,
    padrao: z.enum(["normal", "claudicante", "com_auxiliar"]),
  }),
  tug: z.object({
    ...base,
    segundos: z.number().positive(),
  }),
  sts_30s: z.object({
    ...base,
    repeticoes: z.number().int().min(0),
  }),
  visa_p: z.object({
    ...base,
    escore: z.number().min(0).max(100),
  }),
  dor_carga: z.object({
    ...base,
    eva: z.number().min(0).max(10), // single leg decline squat
  }),
  retorno_esporte: z.object({
    ...base,
    decisao: z.enum(["apto", "nao_apto", "parcial"]),
    justificativa: z.string().min(1),
  }),
};

export function validateAssessmentPayload(
  type: string,
  payload: unknown,
): { success: true; data: Record<string, unknown> } | { success: false; error: string } {
  if (!(ASSESSMENT_TYPES as readonly string[]).includes(type)) {
    return { success: false, error: `Tipo de avaliação inválido: ${type}` };
  }
  const parsed = payloadSchemas[type as AssessmentType].safeParse(payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      success: false,
      error: `Payload inválido para ${type}: ${issue ? `${issue.path.join(".")} — ${issue.message}` : "dados inválidos"}`,
    };
  }
  return { success: true, data: parsed.data as Record<string, unknown> };
}

function lsi(operado: number, saudavel: number): number {
  return Math.round((operado / saudavel) * 1000) / 10;
}

// ── Cálculo de computed + red_flags (backend, nunca no frontend) ────────────
export function computeAssessment(
  type: AssessmentType,
  payload: Record<string, unknown>,
  phase: number | null,
  diagnosisCode: string,
): { computed: Record<string, unknown> | null; redFlags: string[] } {
  const computed: Record<string, unknown> = {};
  const redFlags: string[] = [];
  const p = payload as Record<string, number & string & boolean>;

  if (p.falseio === true) redFlags.push("giving_way_episode");

  switch (type) {
    case "adm": {
      const ext = Number(p.extensao_deficit_graus);
      const flex = Number(p.flexao_graus);
      computed.extensao_completa = ext <= 0;
      if (ext >= 5 && phase !== null && phase <= 2) redFlags.push("extension_deficit");
      if (diagnosisCode === "atj" && phase === 1 && flex < 90) redFlags.push("atj_stiffness_risk");
      break;
    }
    case "derrame": {
      const grau = Number(p.grau);
      computed.grau = grau;
      if (grau >= 2 && p.persistente === true) redFlags.push("persistent_effusion");
      break;
    }
    case "circunferencia": {
      const diff = Number(p.coxa_operado_cm) - Number(p.coxa_saudavel_cm);
      computed.diferenca_cm = Math.round(diff * 10) / 10;
      break;
    }
    case "forca": {
      const lsiQ = lsi(Number(p.quadriceps_operado), Number(p.quadriceps_saudavel));
      computed.lsi_quadriceps = lsiQ;
      if (p.isquiotibiais_operado && p.isquiotibiais_saudavel) {
        computed.lsi_isquiotibiais = lsi(Number(p.isquiotibiais_operado), Number(p.isquiotibiais_saudavel));
      }
      if (phase === 4 && lsiQ < 90) redFlags.push("quadriceps_lsi_below_90");
      break;
    }
    case "hop": {
      const pairs: Array<[string, string, string]> = [
        ["single_operado", "single_saudavel", "lsi_single_hop"],
        ["triple_operado", "triple_saudavel", "lsi_triple_hop"],
        ["crossover_operado", "crossover_saudavel", "lsi_crossover_hop"],
      ];
      const lsis: number[] = [];
      for (const [op, sa, key] of pairs) {
        if (p[op] && p[sa]) {
          const v = lsi(Number(p[op]), Number(p[sa]));
          computed[key] = v;
          lsis.push(v);
        }
      }
      if (lsis.length > 0) {
        const media = Math.round((lsis.reduce((a, b) => a + b, 0) / lsis.length) * 10) / 10;
        computed.lsi_hop_medio = media;
        if (phase === 4 && media < 90) redFlags.push("hop_lsi_below_90");
      }
      break;
    }
    case "y_balance": {
      computed.lsi_composto = lsi(Number(p.composto_operado), Number(p.composto_saudavel));
      break;
    }
    case "less": {
      const escore = Number(p.escore);
      computed.classificacao =
        escore <= 4 ? "excelente" : escore <= 5 ? "bom" : escore <= 6 ? "moderado" : "ruim";
      break;
    }
    case "acl_rsi": {
      const escore = Number(p.escore);
      computed.escore = escore;
      if (escore < 65) redFlags.push("acl_rsi_below_65");
      break;
    }
    case "tug": {
      const s = Number(p.segundos);
      computed.dentro_da_meta = s < 12;
      break;
    }
    case "visa_p": {
      computed.escore = Number(p.escore);
      break;
    }
    default:
      break;
  }

  return { computed: Object.keys(computed).length > 0 ? computed : null, redFlags };
}

// ── Auto-conclusão de follow-ups (±7 dias da due_date) ──────────────────────
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export async function autoCompleteFollowups(physioPatientId: number): Promise<number[]> {
  const [pendings, assessments] = await Promise.all([
    db.select().from(physioFollowupsTable)
      .where(and(
        eq(physioFollowupsTable.physioPatientId, physioPatientId),
        eq(physioFollowupsTable.status, "pending"),
      )),
    db.select({
      id: rehabAssessmentsTable.id,
      assessmentType: rehabAssessmentsTable.assessmentType,
      createdAt: rehabAssessmentsTable.createdAt,
    }).from(rehabAssessmentsTable)
      .where(eq(rehabAssessmentsTable.physioPatientId, physioPatientId)),
  ]);

  const completedIds: number[] = [];

  for (const followup of pendings) {
    const required = followup.requiredAssessments ?? [];
    if (required.length === 0) continue;

    const due = new Date(`${followup.dueDate}T12:00:00Z`).getTime();
    const linked: number[] = [];
    const allMatched = required.every((type) => {
      const match = assessments.find(
        (a) => a.assessmentType === type && Math.abs(a.createdAt.getTime() - due) <= WINDOW_MS,
      );
      if (match) linked.push(match.id);
      return Boolean(match);
    });

    if (allMatched) {
      await db.update(physioFollowupsTable)
        .set({ status: "done", completedAt: new Date(), linkedAssessmentIds: linked })
        .where(eq(physioFollowupsTable.id, followup.id));
      completedIds.push(followup.id);
    }
  }

  return completedIds;
}
