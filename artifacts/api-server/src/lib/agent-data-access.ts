import { z } from "zod/v4";

export type SqlQuery = {
  text: string;
  values: unknown[];
};

export type ResolvedAgentScope =
  | { kind: "all" }
  | { kind: "doctor"; doctorId: number };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const VISIBLE_FOLLOWUP_SQL = `NOT (
  'Fraturas' = ANY(COALESCE(s.tipos_procedimento, '{}'::text[]))
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
  enxerto: z.string().trim().min(1).max(100).optional(),
  ligamento: z.string().trim().min(1).max(40).optional(),
  reforco: z.string().trim().min(1).max(100).optional(),
  diagnostico: z.string().trim().min(1).max(160).optional(),
  tipo_procedimento: z.string().trim().min(1).max(100).optional(),
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
    "average_ikdc",
    "average_lysholm",
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

const GRAFT_ALIASES: Array<{ canonical: string; aliases: string[] }> = [
  {
    canonical: "Tendão do Reto Femoral",
    aliases: ["tendao do reto femoral", "tendao reto femoral", "reto femoral"],
  },
  {
    canonical: "Tendão Patelar (BTB)",
    aliases: ["tendao patelar", "patelar", "btb"],
  },
  {
    canonical: "Isquiotibiais (Grácil + Semitendíneo)",
    aliases: [
      "isquiotibiais",
      "gracil + semitendineo",
      "gracil e semitendineo",
      "semitendineo + gracil",
      "semitendineo e gracil",
    ],
  },
  {
    canonical: "Tendão Quadricipital",
    aliases: ["tendao quadricipital", "quadricipital"],
  },
  { canonical: "Grácil", aliases: ["gracil"] },
  { canonical: "Semitendíneo", aliases: ["semitendineo"] },
  { canonical: "Fibular Longo", aliases: ["fibular longo"] },
  { canonical: "Hemifibular", aliases: ["hemifibular"] },
  { canonical: "Aloenxerto", aliases: ["aloenxerto"] },
  {
    canonical: "Ligamento Sintético (LARS)",
    aliases: ["ligamento sintetico", "lars"],
  },
];

const LIGAMENT_ALIASES: Array<{ canonical: string; aliases: string[] }> = [
  {
    canonical: "LCA",
    aliases: [
      "lca",
      "ligamento cruzado anterior",
      "reconstrucao do ligamento cruzado anterior",
    ],
  },
  {
    canonical: "LCP",
    aliases: ["lcp", "ligamento cruzado posterior"],
  },
  { canonical: "CPL", aliases: ["cpl", "canto posterolateral"] },
  { canonical: "CPM", aliases: ["cpm", "canto posteromedial"] },
  { canonical: "LOA", aliases: ["loa", "ligamento obliquo anterior"] },
];

const REINFORCEMENT_ALIASES: Array<{
  canonical: string;
  aliases: string[];
}> = [
  {
    canonical: "ALL (Ligamento Anterolateral)",
    aliases: [
      "lal",
      "all",
      "ligamento anterolateral",
      "ligamento extra articular anterolateral",
    ],
  },
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

  const ligament = LIGAMENT_ALIASES.find(({ aliases }) =>
    aliases.some((alias) => containsClinicalAlias(normalizedMessage, alias))
  );
  if (ligament) enriched.ligamento = ligament.canonical;

  const graft = GRAFT_ALIASES.find(({ aliases }) =>
    aliases.some((alias) => containsClinicalAlias(normalizedMessage, alias))
  );
  if (graft) enriched.enxerto = graft.canonical;

  const reinforcement = REINFORCEMENT_ALIASES.find(({ aliases }) =>
    aliases.some((alias) => containsClinicalAlias(normalizedMessage, alias))
  );
  if (reinforcement) enriched.reforco = reinforcement.canonical;

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
    | "enxerto"
    | "ligamento"
    | "reforco"
    | "diagnostico"
    | "tipo_procedimento"
    | "periodo_inicio"
    | "periodo_fim"
  >,
  values: unknown[],
  conditions: string[],
): void {
  if (args.sexo) {
    conditions.push(`p.sexo = ${addValue(values, args.sexo)}`);
  }
  if (args.enxerto) {
    const normalizedGraft = normalizeClinicalText(args.enxerto);
    if (
      normalizedGraft.includes("isquiotibiais") ||
      (
        containsClinicalAlias(normalizedGraft, "gracil") &&
        containsClinicalAlias(normalizedGraft, "semitendineo")
      )
    ) {
      const isquiotibiais = normalizedTextSql(addValue(values, "%isquiotibiais%"));
      const gracil = normalizedTextSql(addValue(values, "%gracil%"));
      const semitendineo = normalizedTextSql(addValue(values, "%semitendineo%"));
      const documentedGraft = normalizedTextSql("s.enxerto");
      conditions.push(
        `(${documentedGraft} LIKE ${isquiotibiais} ESCAPE '\\' OR (${documentedGraft} LIKE ${gracil} ESCAPE '\\' AND ${documentedGraft} LIKE ${semitendineo} ESCAPE '\\'))`,
      );
    } else {
      conditions.push(
        `${normalizedTextSql("s.enxerto")} LIKE ${normalizedTextSql(addValue(values, `%${escapeLike(args.enxerto)}%`))} ESCAPE '\\'`,
      );
    }
  }
  if (args.ligamento) {
    const ligament = addValue(values, args.ligamento);
    const ligamentLike = addValue(values, `%${escapeLike(args.ligamento)}%`);
    conditions.push(
      `(
        EXISTS (
          SELECT 1
          FROM unnest(COALESCE(s.ligamentos_acometidos, '{}'::text[])) AS ligament_value
          WHERE ${normalizedTextSql("ligament_value")} = ${normalizedTextSql(ligament)}
        )
        OR EXISTS (
          SELECT 1
          FROM unnest(COALESCE(s.tipos_procedimento, '{}'::text[])) AS procedure_value
          WHERE ${normalizedTextSql("procedure_value")} = ${normalizedTextSql(ligament)}
        )
        OR ${normalizedTextSql("s.diagnostico")} LIKE ${normalizedTextSql(ligamentLike)} ESCAPE '\\'
        OR ${normalizedTextSql("s.procedimento_realizado")} LIKE ${normalizedTextSql(ligamentLike)} ESCAPE '\\'
      )`,
    );
  }
  if (args.reforco) {
    const normalizedReinforcement = normalizeClinicalText(args.reforco);
    const jsonKey = normalizedReinforcement.includes("anterolateral") ||
      containsClinicalAlias(normalizedReinforcement, "lal") ||
      containsClinicalAlias(normalizedReinforcement, "all")
      ? "lal"
      : null;
    const textPattern = addValue(values, `%${escapeLike(args.reforco)}%`);
    const normalizedTextPattern = normalizedTextSql(textPattern);
    if (jsonKey) {
      const jsonPattern = addValue(values, `%"${jsonKey}":true%`);
      conditions.push(
        `(s.reforco::text LIKE ${jsonPattern} OR ${normalizedTextSql("s.reforco")} LIKE ${normalizedTextPattern} ESCAPE '\\')`,
      );
    } else {
      conditions.push(
        `${normalizedTextSql("s.reforco")} LIKE ${normalizedTextPattern} ESCAPE '\\'`,
      );
    }
  }
  if (args.diagnostico) {
    conditions.push(
      `${normalizedTextSql("s.diagnostico")} LIKE ${normalizedTextSql(addValue(values, `%${escapeLike(args.diagnostico)}%`))} ESCAPE '\\'`,
    );
  }
  if (args.tipo_procedimento) {
    const procedureType = addValue(values, args.tipo_procedimento);
    conditions.push(
      `EXISTS (
        SELECT 1
        FROM unnest(COALESCE(s.tipos_procedimento, '{}'::text[])) AS procedure_value
        WHERE ${normalizedTextSql("procedure_value")} = ${normalizedTextSql(procedureType)}
      )`,
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
    average_ikdc: "ROUND(AVG(f.ikdc)::numeric, 1)",
    average_lysholm: "ROUND(AVG(f.lysholm)::numeric, 1)",
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
        s.enxerto,
        s.diagnostico,
        s.ligamentos_acometidos,
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
        ROUND(AVG(f.ikdc)::numeric, 1) AS avg_ikdc,
        ROUND(AVG(f.lysholm)::numeric, 1) AS avg_lysholm,
        ROUND(AVG(f.tegner)::numeric, 1) AS avg_tegner,
        ROUND(AVG(f.kujala)::numeric, 1) AS avg_kujala,
        ROUND(AVG(f.marx)::numeric, 1) AS avg_marx,
        ROUND(AVG(f.koos_dor)::numeric, 1) AS avg_koos_dor,
        ROUND(AVG(f.koos_esporte)::numeric, 1) AS avg_koos_esporte,
        ROUND(AVG(f.koos_qualidade)::numeric, 1) AS avg_koos_qualidade,
        ROUND(AVG(f.koos_sintomas)::numeric, 1) AS avg_koos_sintomas,
        ROUND(AVG(f.koos_funcao)::numeric, 1) AS avg_koos_funcao,
        ROUND(AVG(f.koos12)::numeric, 1) AS avg_koos12,
        ROUND(AVG(f.vas_dor)::numeric, 1) AS avg_vas,
        ROUND(AVG(f.acl_rsi)::numeric, 1) AS avg_acl_rsi,
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