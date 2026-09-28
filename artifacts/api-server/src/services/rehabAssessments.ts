import { z } from "zod/v4";
import { db, physioFollowupsTable, rehabAssessmentsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

// ── Tipos de avaliação suportados ───────────────────────────────────────────
// As avaliações de reabilitação do joelho (força de quadríceps, hop tests,
// ACL-RSI, VISA-P etc.) foram retiradas. As de ombro/cotovelo entram aqui
// quando o protocolo for definido pelo médico.
export const ASSESSMENT_TYPES = [
  "retorno_esporte",
] as const;

export type AssessmentType = (typeof ASSESSMENT_TYPES)[number];

const base = {
  observacoes: z.string().optional(),
};

const payloadSchemas: Record<AssessmentType, z.ZodType> = {
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

// ── Cálculo de computed + red_flags (backend, nunca no frontend) ────────────
export function computeAssessment(
  _type: AssessmentType,
  _payload: Record<string, unknown>,
  _phase: number | null,
  _diagnosisCode: string,
): { computed: Record<string, unknown> | null; redFlags: string[] } {
  return { computed: null, redFlags: [] };
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
