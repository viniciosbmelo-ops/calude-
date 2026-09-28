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
        { role: "user", content: "Quantos LCA com reto femoral eu fiz?" },
        {
          role: "assistant",
          content: "Você realizou 4 cirurgias.",
          isReport: false,
          reportData: null,
        },
        {
          role: "user",
          content: "Quantos desses foram associados ao ligamento anterolateral?",
        },
      ],
    });

    expect(parsed.messages).toEqual([
      { role: "user", content: "Quantos LCA com reto femoral eu fiz?" },
      { role: "assistant", content: "Você realizou 4 cirurgias." },
      {
        role: "user",
        content: "Quantos desses foram associados ao ligamento anterolateral?",
      },
    ]);
  });

  it("keeps prior user criteria for referential follow-up questions", () => {
    const context = buildClinicalFilterContext([
      { role: "user", content: "Quantos LCA com reto femoral eu fiz?" },
      { role: "assistant", content: "Você realizou 4 cirurgias." },
      {
        role: "user",
        content: "Quantos desses 4 foram associados ao ligamento anterolateral?",
      },
    ]);

    expect(context).toContain("Quantos LCA com reto femoral eu fiz?");
    expect(context).toContain("Quantos desses 4 foram associados");
  });

  it("does not carry old clinical criteria into an unrelated new question", () => {
    const context = buildClinicalFilterContext([
      { role: "user", content: "Quantos LCA com reto femoral eu fiz?" },
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
      diagnostico: "LCA%' OR 1=1 --",
    });
    const query = buildStatisticsQuery(args, { kind: "doctor", doctorId: 17 });

    expect(query.text).toContain("s.doctor_id = $1");
    expect(query.text).not.toContain("OR 1=1");
    expect(query.values[0]).toBe(17);
    expect(query.values[1]).toBe("%LCA\\%' OR 1=1 --%");
  });

  it("matches clinical text without requiring accents and finds ligament values across surgery fields", () => {
    const args = StatisticsArgsSchema.parse({
      operation: "surgery_count",
      group_by: "none",
      scope: "own",
      enxerto: "tendao do reto femoral",
      ligamento: "LCA",
    });
    const query = buildStatisticsQuery(args, { kind: "doctor", doctorId: 17 });

    expect(query.text).toContain("translate(lower(COALESCE(s.enxerto, ''))");
    expect(query.text).toContain("unnest(COALESCE(s.ligamentos_acometidos");
    expect(query.text).toContain("unnest(COALESCE(s.tipos_procedimento");
    expect(query.text).toContain("s.procedimento_realizado");
    expect(query.values).toEqual([
      17,
      "%tendao do reto femoral%",
      "LCA",
      "%LCA%",
    ]);
  });

  it("understands LCA com reto femoral as LCA plus the canonical graft", () => {
    const args = StatisticsArgsSchema.parse({
      operation: "surgery_count",
      group_by: "none",
      scope: "own",
    });

    expect(
      enrichClinicalFiltersFromMessage(
        args,
        "Quantos LCA com reto femoral eu fiz?",
      ),
    ).toEqual({
      operation: "surgery_count",
      group_by: "none",
      scope: "own",
      ligamento: "LCA",
      enxerto: "Tendão do Reto Femoral",
    });
  });

  it("prioritizes documented terms in the doctor's wording over conflicting model filters", () => {
    const args = StatisticsArgsSchema.parse({
      operation: "surgery_count",
      scope: "own",
      enxerto: "Outro",
    });

    expect(
      enrichClinicalFiltersFromMessage(args, "Quantos LCA com BTB eu fiz?"),
    ).toMatchObject({
      ligamento: "LCA",
      enxerto: "Tendão Patelar (BTB)",
    });

    expect(
      enrichClinicalFiltersFromMessage(
        StatisticsArgsSchema.parse({
          operation: "surgery_count",
          scope: "own",
        }),
        "Quantas reconstruções com tendao patelar?",
      ),
    ).toMatchObject({
      enxerto: "Tendão Patelar (BTB)",
    });
  });

  it("keeps the prior documented cohort for an elliptical sex follow-up", () => {
    const context = buildClinicalFilterContext([
      {
        role: "user",
        content: "Quantas cirurgias de LCA + LAL com tendão do reto femoral eu fiz?",
      },
      { role: "assistant", content: "Você realizou 2 cirurgias." },
      { role: "user", content: "Quantas são mulheres?" },
    ]);

    expect(context).toContain("LCA + LAL");
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
      ligamento: "LCA",
      reforco: "ALL (Ligamento Anterolateral)",
      enxerto: "Tendão do Reto Femoral",
    });
  });

  it.each([
    "Quantos LCA + LAL com semitendíneo e grácil?",
    "Quantos LCA + ALL com grácil + semitendíneo?",
    "Quantos LCA com isquiotibiais?",
  ])("maps hamstring graft wording to the documented composite graft: %s", (message) => {
    const enriched = enrichClinicalFiltersFromMessage(
      StatisticsArgsSchema.parse({
        operation: "surgery_count",
        group_by: "none",
        scope: "own",
        enxerto: "semitendíneo e grácil",
      }),
      message,
    );

    expect(enriched).toMatchObject({
      ligamento: "LCA",
      enxerto: "Isquiotibiais (Grácil + Semitendíneo)",
    });

    const query = buildStatisticsQuery(enriched, {
      kind: "doctor",
      doctorId: 17,
    });
    expect(query.values.slice(0, 6)).toEqual([
      17,
      "%isquiotibiais%",
      "%gracil%",
      "%semitendineo%",
      "LCA",
      "%LCA%",
    ]);
    expect(query.text).toContain("LIKE");
    expect(query.text).toContain("AND");
  });

  it.each([
    "Quantos LCA + LAL com reto femoral eu fiz?",
    "Quantos LCA + ALL com reto femoral eu fiz?",
    "Quantas reconstruções de ligamento cruzado anterior associado ao ligamento anterolateral utilizando o enxerto do reto femoral?",
  ])("treats abbreviated and full LCA plus ALL descriptions equally: %s", (message) => {
    const args = StatisticsArgsSchema.parse({
      operation: "surgery_count",
      group_by: "none",
      scope: "own",
    });

    const enriched = enrichClinicalFiltersFromMessage(args, message);
    expect(enriched).toEqual({
      operation: "surgery_count",
      group_by: "none",
      scope: "own",
      ligamento: "LCA",
      reforco: "ALL (Ligamento Anterolateral)",
      enxerto: "Tendão do Reto Femoral",
    });

    const query = buildStatisticsQuery(enriched, {
      kind: "doctor",
      doctorId: 17,
    });
    expect(query.text).toContain("s.reforco::text LIKE");
    expect(query.values).toContain('%"lal":true%');
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
      titulo: "LCA",
      filtros_descricao: "Diagnóstico LCA",
      scope: "own",
      diagnostico: "LCA",
    });
    const query = buildReportQuery(args, { kind: "doctor", doctorId: 8 });

    expect(query.text).toContain("s.doctor_id = $1");
    expect(query.text).toContain("translate(lower(COALESCE(s.diagnostico, ''))");
    expect(query.values).toEqual([8, "%LCA%"]);
  });

  it("sends authorized patient rows to the AI so the doctor can identify cases", () => {
    const summary = summarizeReportForAi({
      patients: [{ paciente_nome: "Maria Souza", diagnostico: "LCA" }],
      followupStats: { avg_ikdc: "88.0" },
    });

    expect(summary).toEqual({
      total_pacientes: 1,
      pacientes: [{ paciente_nome: "Maria Souza", diagnostico: "LCA" }],
      followup_stats: { avg_ikdc: "88.0" },
    });
    expect(JSON.stringify(summary)).toContain("Maria Souza");
    expect(JSON.stringify(summary)).toContain("LCA");
  });
});