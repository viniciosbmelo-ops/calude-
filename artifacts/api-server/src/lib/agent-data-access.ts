import { z } from "zod/v4";
import { CASE_TYPES } from "@workspace/clinical";

export type SqlQuery = {
  text: string;
  values: unknown[];
};

export type ResolvedAgentScope =
  | { kind: "all" }
  | { kind: "doctor"; doctorId: number };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const VISIBLE_FOLLOWUP_SQL = `NOT (
  EXISTS (
    SELECT 1 FROM unnest(COALESCE(s.tipos_procedimento, '{}'::text[])) AS tipo
    WHERE tipo LIKE '%\\_FRACTURE' ESCAPE '\\'
  )
  AND f.tempo ~* '^pr(é|e)(-|[[:space:]])?op(eratório|eratorio)?([[:space:]]|[(]|$)'
)`;

const ValidDate = z.string().regex(ISO_DATE).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Data inválida");

const ScopeFields = {
  scope: z.enum(["own", "doctor", "all"]),
  doctor_query: z.string().trim().min(2).max(120).optional(),
};

const ClinicalFilters = {
  sexo: z.enum(["M", "F"]).optional(),
  regiao: z.enum(["shoulder", "elbow"]).optional(),
  tipo_caso: z.string().trim().min(1).max(40).optional(),
  diagnostico: z.string().trim().min(1).max(160).optional(),
  periodo_inicio: ValidDate.optional(),
  periodo_fim: ValidDate.optional(),
};

export const StatisticsArgsSchema = z.object({
  ...ScopeFields,
  ...ClinicalFilters,
  operation: z.enum([
    "patient_count",
    "surgery_count",
    "followup_count",
    "average_pain",
    "return_to_sport_rate",
    "failure_rate",
  ]),
  group_by: z.enum(["none", "sex", "year"]).default("none"),
}).strict().superRefine((value, ctx) => {
  validateScopeShape(value, ctx);
  validatePeriod(value, ctx);
});

export const ReportArgsSchema = z.object({
  ...ScopeFields,
  ...ClinicalFilters,
  titulo: z.string().trim().min(1).max(140),
  filtros_descricao: z.string().trim().min(1).max(500),
}).strict().superRefine((value, ctx) => {
  validateScopeShape(value, ctx);
  validatePeriod(value, ctx);
});

export type StatisticsArgs = z.infer<typeof StatisticsArgsSchema>;
export type ReportArgs = z.infer<typeof ReportArgsSchema>;

const REGION_ALIASES: Array<{ canonical: "shoulder" | "elbow"; aliases: string[] }> = [
  { canonical: "shoulder", aliases: ["ombro", "ombros", "hombro", "hombros"] },
  { canonical: "elbow", aliases: ["cotovelo", "cotovelos", "codo", "codos"] },
];

function normalizeClinicalText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsClinicalAlias(text: string, alias: string): boolean {
  const normalizedAlias = normalizeClinicalText(alias);
  if (normalizedAlias.length <= 3) {
    return new RegExp(`(?:^|\\s)${normalizedAlias}(?:$|\\s)`, "i").test(text);
  }
  return text.includes(normalizedAlias);
}

export function enrichClinicalFiltersFromMessage<
  T extends StatisticsArgs | ReportArgs,
>(args: T, message: string): T {
  const normalizedMessage = normalizeClinicalText(message);
  const enriched = { ...args };

  const mentionsFemale = ["mulher", "mulheres", "feminino", "sexo feminino"]
    .some((alias) => containsClinicalAlias(normalizedMessage, alias));
  const mentionsMale = ["homem", "homens", "masculino", "sexo masculino"]
    .some((alias) => containsClinicalAlias(normalizedMessage, alias));
  if (mentionsFemale !== mentionsMale) {
    enriched.sexo = mentionsFemale ? "F" : "M";
  }

  const regions = REGION_ALIASES.filter(({ aliases }) =>
    aliases.some((alias) => containsClinicalAlias(normalizedMessage, alias))
  );
  if (regions.length === 1) enriched.regiao = regions[0]!.canonical;

  // Tipo de caso pelo nome do catálogo (ex.: "manguito rotador" → SH_CUFF)
  const caseTypes = CASE_TYPES.filter((caseType) =>
    (!enriched.regiao || caseType.region === enriched.regiao)
    && !caseType.freeOnly
    && containsClinicalAlias(normalizedMessage, caseType.label)
  );
  if (caseTypes.length === 1) enriched.tipo_caso = caseTypes[0]!.key;

  return enriched;
}

function validateScopeShape(
  value: { scope: "own" | "doctor" | "all"; doctor_query?: string },
  ctx: z.RefinementCtx,
): void {
  if (value.scope === "doctor" && !value.doctor_query) {
    ctx.addIssue({
      code: "custom",
      path: ["doctor_query"],
      message: "doctor_query é obrigatório para o escopo doctor",
    });
  }
  if (value.scope !== "doctor" && value.doctor_query) {
    ctx.addIssue({
      code: "custom",
      path: ["doctor_query"],
      message: "doctor_query só pode ser usado no escopo doctor",
    });
  }
}

function validatePeriod(
  value: { periodo_inicio?: string; periodo_fim?: string },
  ctx: z.RefinementCtx,
): void {
  if (
    value.periodo_inicio &&
    value.periodo_fim &&
    value.periodo_inicio > value.periodo_fim
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["periodo_fim"],
      message: "O fim do período não pode ser anterior ao início",
    });
  }
}

export function authorizeAgentScope(
  requestedScope: "own" | "doctor" | "all",
  actorDoctorId: number,
  isAdmin: boolean,
  resolvedDoctorId?: number,
): ResolvedAgentScope {
  if (!Number.isInteger(actorDoctorId) || actorDoctorId <= 0) {
    throw new Error("Ator inválido");
  }

  if (!isAdmin) {
    if (requestedScope !== "own") {
      throw new Error("Médicos só podem consultar o próprio escopo");
    }
    return { kind: "doctor", doctorId: actorDoctorId };
  }

  if (requestedScope === "all") return { kind: "all" };
  if (requestedScope === "own") {
    return { kind: "doctor", doctorId: actorDoctorId };
  }
  if (!Number.isInteger(resolvedDoctorId) || (resolvedDoctorId ?? 0) <= 0) {
    throw new Error("Médico do escopo não encontrado");
  }
  return { kind: "doctor", doctorId: resolvedDoctorId! };
}

function addValue(values: unknown[], value: unknown): string {
  values.push(value);
  return `$${values.length}`;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

const ACCENTED_CHARS = "áàãâäéèêëíìîïóòõôöúùûüç";
const ASCII_CHARS = "aaaaaeeeeiiiiooooouuuuc";

function normalizedTextSql(expression: string): string {
  return `translate(lower(COALESCE(${expression}, '')), '${ACCENTED_CHARS}', '${ASCII_CHARS}')`;
}

function addClinicalConditions(
  args: Pick<
    ReportArgs,
    | "sexo"
    | "regiao"
    | "tipo_caso"
    | "diagnostico"
    | "periodo_inicio"
    | "periodo_fim"
  >,
  values: unknown[],
  conditions: string[],
): void {
  if (args.sexo) {
    conditions.push(`p.sexo = ${addValue(values, args.sexo)}`);
  }
  if (args.regiao) {
    conditions.push(`s.regiao = ${addValue(values, args.regiao)}`);
  }
  if (args.tipo_caso) {
    conditions.push(
      `${addValue(values, args.tipo_caso)} = ANY(COALESCE(s.tipos_procedimento, '{}'::text[]))`,
    );
  }
  if (args.diagnostico) {
    conditions.push(
      `${normalizedTextSql("s.diagnostico")} LIKE ${normalizedTextSql(addValue(values, `%${escapeLike(args.diagnostico)}%`))} ESCAPE '\\'`,
    );
  }
  if (args.periodo_inicio) {
    conditions.push(`s.data_cirurgia >= ${addValue(values, args.periodo_inicio)}`);
  }
  if (args.periodo_fim) {
    conditions.push(`s.data_cirurgia <= ${addValue(values, args.periodo_fim)}`);
  }
}

function addScopeCondition(
  scope: ResolvedAgentScope,
  values: unknown[],
  conditions: string[],
  doctorColumn = "s.doctor_id",
): void {
  if (scope.kind === "doctor") {
    conditions.push(`${doctorColumn} = ${addValue(values, scope.doctorId)}`);
  }
}

export function buildStatisticsQuery(
  args: StatisticsArgs,
  scope: ResolvedAgentScope,
): SqlQuery {
  const values: unknown[] = [];
  const conditions: string[] = [];

  const aggregateByOperation: Record<StatisticsArgs["operation"], string> = {
    patient_count: "COUNT(DISTINCT p.id)::int",
    surgery_count: "COUNT(DISTINCT s.id)::int",
    followup_count: "COUNT(DISTINCT f.id)::int",
    average_pain: "ROUND(AVG(f.vas_dor)::numeric, 1)",
    return_to_sport_rate:
      "ROUND(100.0 * AVG(CASE WHEN f.retorno_esporte = true THEN 1 ELSE 0 END)::numeric, 1)",
    failure_rate:
      "ROUND(100.0 * AVG(CASE WHEN f.falha = true THEN 1 ELSE 0 END)::numeric, 1)",
  };

  const needsFollowup = !["patient_count", "surgery_count"].includes(args.operation);
  const fromClause = needsFollowup
    ? "FROM followup f JOIN surgeries s ON s.id = f.surgery_id JOIN patients p ON p.id = s.patient_id"
    : args.operation === "patient_count"
      ? "FROM patients p LEFT JOIN surgeries s ON s.patient_id = p.id"
      : "FROM surgeries s JOIN patients p ON p.id = s.patient_id";

  addScopeCondition(
    scope,
    values,
    conditions,
    args.operation === "patient_count" ? "p.doctor_id" : "s.doctor_id",
  );
  addClinicalConditions(args, values, conditions);
  if (needsFollowup) conditions.push(VISIBLE_FOLLOWUP_SQL);

  const groupExpression =
    args.group_by === "sex"
      ? "p.sexo"
      : args.group_by === "year"
        ? "EXTRACT(YEAR FROM s.data_cirurgia::date)::int"
        : null;
  const groupSelect = groupExpression ? `${groupExpression} AS label, ` : "";
  const groupClause = groupExpression
    ? ` GROUP BY ${groupExpression} ORDER BY ${groupExpression}`
    : "";
  const whereClause = conditions.length > 0
    ? ` WHERE ${conditions.join(" AND ")}`
    : "";

  return {
    text: `SELECT ${groupSelect}${aggregateByOperation[args.operation]} AS value ${fromClause}${whereClause}${groupClause}`,
    values,
  };
}

export function buildReportQuery(
  args: ReportArgs,
  scope: ResolvedAgentScope,
): SqlQuery {
  const values: unknown[] = [];
  const conditions: string[] = [];
  addScopeCondition(scope, values, conditions);
  addClinicalConditions(args, values, conditions);

  const whereClause = conditions.length > 0
    ? `WHERE ${conditions.join(" AND ")}`
    : "";

  return {
    text: `
      SELECT
        p.nome AS paciente_nome,
        p.sexo,
        s.data_cirurgia,
        s.lado,
        s.hospital,
        s.regiao,
        s.tipo_caso,
        s.diagnostico,
        s.procedimento_realizado,
        s.id AS surgery_id,
        d.nome AS doctor_nome
      FROM surgeries s
      JOIN patients p ON p.id = s.patient_id
      LEFT JOIN doctors d ON d.id = s.doctor_id
      ${whereClause}
      ORDER BY s.data_cirurgia DESC
      LIMIT 200
    `,
    values,
  };
}

export function buildFollowupStatsQuery(surgeryIds: number[]): SqlQuery {
  const ids = surgeryIds.filter((id) => Number.isInteger(id) && id > 0);
  if (ids.length === 0) {
    throw new Error("Nenhuma cirurgia autorizada para agregar");
  }
  return {
    text: `
      SELECT
        COUNT(*)::int AS total_followups,
        ROUND(AVG(f.vas_dor)::numeric, 1) AS avg_vas,
        COUNT(*) FILTER (WHERE f.retorno_esporte = true)::int AS retornou_esporte,
        COUNT(*) FILTER (WHERE f.falha = true)::int AS falhas
      FROM followup f
      JOIN surgeries s ON s.id = f.surgery_id
      WHERE f.surgery_id = ANY($1::int[])
        AND ${VISIBLE_FOLLOWUP_SQL}
    `,
    values: [ids],
  };
}

export function summarizeReportForAi(data: {
  patients: unknown[];
  followupStats: unknown;
}): {
  total_pacientes: number;
  pacientes: unknown[];
  followup_stats: unknown;
} {
  return {
    total_pacientes: data.patients.length,
    pacientes: data.patients,
    followup_stats: data.followupStats,
  };
}