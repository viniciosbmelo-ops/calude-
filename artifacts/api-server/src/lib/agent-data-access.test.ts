import { describe, expect, it } from "vitest";
import {
  authorizeAgentScope,
  buildReportQuery,
  buildStatisticsQuery,
  enrichClinicalFiltersFromMessage,
  ReportArgsSchema,
  StatisticsArgsSchema,
  summarizeReportForAi,
} from "./agent-data-access";
import {
  AgentChatBodySchema,
  buildClinicalFilterContext,
} from "./agent-chat-schema";

describe("agent data access", () => {
  it("accepts follow-up history while stripping frontend-only message metadata", () => {
    const parsed = AgentChatBodySchema.parse({
      messages: [
        { role: "user", content: "Quantos reparos de manguito rotador eu fiz?" },
        {
          role: "assistant",
          content: "Você realizou 4 cirurgias.",
          isReport: false,
          reportData: null,
        },
        {
          role: "user",
          content: "Quantos desses foram com tenodese do bíceps?",
        },
      ],
    });

    expect(parsed.messages).toEqual([
      { role: "user", content: "Quantos reparos de manguito rotador eu fiz?" },
      { role: "assistant", content: "Você realizou 4 cirurgias." },
      {
        role: "user",
        content: "Quantos desses foram com tenodese do bíceps?",
      },
    ]);
  });

  it("keeps prior user criteria for referential follow-up questions", () => {
    const context = buildClinicalFilterContext([
      { role: "user", content: "Quantos reparos de manguito rotador eu fiz?" },
      { role: "assistant", content: "Você realizou 4 cirurgias." },
      {
        role: "user",
        content: "Quantos desses 4 foram com tenodese do bíceps?",
      },
    ]);

    expect(context).toContain("Quantos reparos de manguito rotador eu fiz?");
    expect(context).toContain("Quantos desses 4 foram com tenodese");
  });

  it("does not carry old clinical criteria into an unrelated new question", () => {
    const context = buildClinicalFilterContext([
      { role: "user", content: "Quantos reparos de manguito rotador eu fiz?" },
      { role: "assistant", content: "Você realizou 4 cirurgias." },
      { role: "user", content: "Qual a média de idade dos pacientes?" },
    ]);

    expect(context).toBe("Qual a média de idade dos pacientes?");
  });

  it("forces a non-admin doctor to use only their own scope", () => {
    expect(authorizeAgentScope("own", 17, false)).toEqual({
      kind: "doctor",
      doctorId: 17,
    });
    expect(() => authorizeAgentScope("all", 17, false)).toThrow(
      "Médicos só podem consultar o próprio escopo",
    );
    expect(() => authorizeAgentScope("doctor", 17, false, 22)).toThrow(
      "Médicos só podem consultar o próprio escopo",
    );
  });

  it("requires an explicit, validated admin scope", () => {
    expect(authorizeAgentScope("all", 1, true)).toEqual({ kind: "all" });
    expect(authorizeAgentScope("doctor", 1, true, 22)).toEqual({
      kind: "doctor",
      doctorId: 22,
    });
    expect(() => authorizeAgentScope("doctor", 1, true)).toThrow(
      "Médico do escopo não encontrado",
    );
  });

  it("builds parameterized statistics with a server-owned doctor predicate", () => {
    const args = StatisticsArgsSchema.parse({
      operation: "surgery_count",
      group_by: "sex",
      scope: "own",
      diagnostico: "manguito%' OR 1=1 --",
    });
    const query = buildStatisticsQuery(args, { kind: "doctor", doctorId: 17 });

    expect(query.text).toContain("s.doctor_id = $1");
    expect(query.text).not.toContain("OR 1=1");
    expect(query.values[0]).toBe(17);
    expect(query.values[1]).toBe("%manguito\\%' OR 1=1 --%");
  });

  it("filters by region and case type with parameters, never interpolated text", () => {
    const args = StatisticsArgsSchema.parse({
      operation: "surgery_count",
      group_by: "none",
      scope: "own",
      regiao: "shoulder",
      tipo_caso: "SH_CUFF",
    });
    const query = buildStatisticsQuery(args, { kind: "doctor", doctorId: 17 });

    expect(query.text).toContain("s.regiao = $2");
    expect(query.text).toContain("$3 = ANY(COALESCE(s.tipos_procedimento");
    expect(query.values).toEqual([17, "shoulder", "SH_CUFF"]);
  });

  it("rejects knee filters and outcome operations that no longer exist", () => {
    expect(StatisticsArgsSchema.safeParse({
      operation: "surgery_count",
      scope: "own",
      ligamento: "LCA",
    }).success).toBe(false);
    expect(StatisticsArgsSchema.safeParse({
      operation: "average_ikdc",
      scope: "own",
    }).success).toBe(false);
    expect(StatisticsArgsSchema.safeParse({
      operation: "surgery_count",
      scope: "own",
      regiao: "knee",
    }).success).toBe(false);
  });

  it("understands region and case type from the doctor's wording", () => {
    const args = StatisticsArgsSchema.parse({
      operation: "surgery_count",
      group_by: "none",
      scope: "own",
    });

    expect(
      enrichClinicalFiltersFromMessage(args, "Quantos reparos de manguito rotador no ombro eu fiz?"),
    ).toEqual({
      operation: "surgery_count",
      group_by: "none",
      scope: "own",
      regiao: "shoulder",
      tipo_caso: "SH_CUFF",
    });
  });

  it("uses the region to tell apart case types with the same name", () => {
    const enriched = enrichClinicalFiltersFromMessage(
      StatisticsArgsSchema.parse({ operation: "surgery_count", scope: "own" }),
      "Quantas cirurgias de instabilidade do cotovelo?",
    );
    expect(enriched).toMatchObject({ regiao: "elbow", tipo_caso: "EL_INSTABILITY" });
  });

  it("does not guess a region when the doctor mentions both", () => {
    const enriched = enrichClinicalFiltersFromMessage(
      StatisticsArgsSchema.parse({ operation: "surgery_count", scope: "own" }),
      "Quantas cirurgias de ombro e cotovelo eu fiz?",
    );
    expect(enriched.regiao).toBeUndefined();
  });

  it("keeps the prior documented cohort for an elliptical sex follow-up", () => {
    const context = buildClinicalFilterContext([
      { role: "user", content: "Quantas cirurgias de manguito rotador no ombro eu fiz?" },
      { role: "assistant", content: "Você realizou 2 cirurgias." },
      { role: "user", content: "Quantas são mulheres?" },
    ]);

    expect(context).toContain("manguito rotador");
    expect(context).toContain("Quantas são mulheres?");

    const enriched = enrichClinicalFiltersFromMessage(
      StatisticsArgsSchema.parse({
        operation: "surgery_count",
        group_by: "none",
        scope: "own",
      }),
      context,
    );
    expect(enriched).toMatchObject({
      sexo: "F",
      regiao: "shoulder",
      tipo_caso: "SH_CUFF",
    });
  });

  it("rejects invalid report scope and dates", () => {
    expect(ReportArgsSchema.safeParse({
      titulo: "Relatório",
      filtros_descricao: "Todos",
      scope: "doctor",
    }).success).toBe(false);

    expect(ReportArgsSchema.safeParse({
      titulo: "Relatório",
      filtros_descricao: "Período",
      scope: "own",
      periodo_inicio: "2026-02-30",
    }).success).toBe(false);
  });

  it("keeps authorized report SQL scoped and parameterized", () => {
    const args = ReportArgsSchema.parse({
      titulo: "Manguito",
      filtros_descricao: "Diagnóstico de manguito",
      scope: "own",
      diagnostico: "manguito",
    });
    const query = buildReportQuery(args, { kind: "doctor", doctorId: 8 });

    expect(query.text).toContain("s.doctor_id = $1");
    expect(query.text).toContain("translate(lower(COALESCE(s.diagnostico, ''))");
    expect(query.values).toEqual([8, "%manguito%"]);
  });

  it("sends authorized patient rows to the AI so the doctor can identify cases", () => {
    const summary = summarizeReportForAi({
      patients: [{ paciente_nome: "Maria Souza", diagnostico: "Rotura do manguito rotador" }],
      followupStats: { avg_vas: "2.0" },
    });

    expect(summary).toEqual({
      total_pacientes: 1,
      pacientes: [{ paciente_nome: "Maria Souza", diagnostico: "Rotura do manguito rotador" }],
      followup_stats: { avg_vas: "2.0" },
    });
    expect(JSON.stringify(summary)).toContain("Maria Souza");
    expect(JSON.stringify(summary)).toContain("manguito");
  });
});