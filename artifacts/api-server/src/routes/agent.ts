import { Router, type IRouter, type Request } from "express";
import OpenAI from "openai";
import multer from "multer";
import { toFile } from "openai/uploads";
import { z } from "zod/v4";
import { pool } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import {
  authorizeAgentScope,
  buildFollowupStatsQuery,
  buildReportQuery,
  buildStatisticsQuery,
  enrichClinicalFiltersFromMessage,
  ReportArgsSchema,
  StatisticsArgsSchema,
  summarizeReportForAi,
  type ReportArgs,
  type ResolvedAgentScope,
  type StatisticsArgs,
} from "../lib/agent-data-access";
import {
  AgentChatBodySchema,
  buildClinicalFilterContext,
} from "../lib/agent-chat-schema";
import {
  transcriptionErrorMessage,
  transcriptionFileExtension,
  transcriptionLocale,
} from "./audio-format";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? "",
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const router: IRouter = Router();
const voiceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
});

router.post("/agent/transcribe", requireAuth, voiceUpload.single("audio"), async (req, res): Promise<void> => {
  const locale = transcriptionLocale(req.body?.locale);
  if (!req.file?.buffer?.length) {
    res.status(400).json({ error: transcriptionErrorMessage(locale, "missing") });
    return;
  }
  const extension = transcriptionFileExtension(req.file.mimetype);
  if (!extension) {
    res.status(415).json({ error: transcriptionErrorMessage(locale, "unsupported") });
    return;
  }
  try {
    const transcription = await openai.audio.transcriptions.create({
      file: await toFile(req.file.buffer, `joia-audio.${extension}`, { type: req.file.mimetype }),
      model: "gpt-4o-mini-transcribe",
      language: locale === "es" ? "es" : "pt",
    });
    const text = transcription.text.trim();
    if (!text) {
      res.status(422).json({ error: transcriptionErrorMessage(locale, "empty") });
      return;
    }
    res.json({ text });
  } catch {
    res.status(502).json({ error: transcriptionErrorMessage(locale, "failed") });
  }
});

const APP_GUIDE = `
## Guia da Plataforma DocSholder

### Navegação principal
- **Dashboard**: visão geral com estatísticas de pacientes, procedimentos e score IKDC médio
- **Pacientes**: lista de pacientes cadastrados. Clique em um paciente para ver prontuário completo
- **Procedimentos**: lista de cirurgias/procedimentos. Use "Novo Procedimento" para cadastrar
- **Planejamento RX**: análise radiológica com ferramentas de medição (HKA, MPTA, LDFA, slope tibial)
- **Relatórios**: geração de relatórios e documentos
- **Admin**: gestão administrativa da plataforma
- **Perfil**: dados do médico logado, CRM, especialidade

### Como cadastrar um paciente
1. Clique em "Novo Paciente" no Dashboard ou na página Pacientes
2. Preencha os dados clínicos solicitados
3. Informe nível de atividade, esporte pivot e Beighton Score, quando aplicável
4. Salve — o paciente aparece na lista imediatamente

### Como cadastrar um procedimento
1. Clique em "Novo Procedimento" ou acesse um paciente e use a aba Procedimentos
2. Preencha data, hospital, lado, tipo de caso, diagnóstico e enxerto
3. Detalhe ligamentos acometidos e fixações
4. Adicione observações e protocolo pós-operatório
5. Salve como rascunho ou marque como completo

### Funcionalidades por paciente
- **Prontuário**: dados clínicos e histórico
- **Procedimentos**: lista de cirurgias
- **Questionários**: IKDC, KOOS, Lysholm e VAS
- **Raio-X**: upload e análise de imagens radiológicas com IA
- **Seguimento**: protocolo de follow-up e envio via WhatsApp
- **Laudo INSS**: geração de laudo médico para INSS em PDF

### Algoritmos clínicos disponíveis
- KRIRS, PICS 2.0, IKDC Subjetivo, KOOS, Lysholm e Beighton Score
`;

function buildSystemPrompt(isAdmin: boolean): string {
  const accessContext = isAdmin
    ? `
## ACESSO ADMINISTRATIVO
- Toda consulta de dados deve declarar um escopo explícito.
- Use scope="all" apenas quando o usuário pedir dados de toda a plataforma.
- Use scope="doctor" e doctor_query quando o usuário pedir um médico específico.
- Use scope="own" apenas para os dados vinculados ao próprio cadastro administrativo.
- Nunca presuma scope="all" e nunca solicite ou invente IDs internos.
`
    : `
## ACESSO DO MÉDICO
- Toda consulta de dados deve usar scope="own".
- O servidor aplica o médico autenticado; nunca peça, aceite ou invente outro médico.
- Nunca tente consultar dados de outros profissionais.
`;

  return `Você é JoIA (Joelho Inteligência Artificial), assistente da plataforma DocSholder.

Ajude com:
1. Dúvidas de uso da plataforma.
2. Estatísticas clínicas agregadas usando query_statistics.
3. Relatórios autorizados usando generate_report.
4. Conhecimento geral sobre cirurgia do joelho e reabilitação.

Regras de segurança:
- Você não escreve nem executa SQL.
- Use somente as ferramentas e filtros estruturados disponíveis.
- O médico autenticado pode consultar todos os dados de pacientes e atendimentos documentados por ele, inclusive nomes e demais dados identificáveis retornados pelas ferramentas.
- Quando o usuário pedir quem são os pacientes, nomes, detalhes de casos ou informações para um relatório, use generate_report e responda diretamente com os dados retornados.
- Não alegue sigilo, LGPD ou regras da plataforma para ocultar do próprio médico dados documentados por ele.
- Nunca invente nomes ou informações que não tenham sido retornados pelas ferramentas.
- O isolamento entre contas é obrigatório: médicos nunca podem consultar dados documentados por outros profissionais.
- Para listas e relatórios, use generate_report.
- Para contagens, médias e taxas, use query_statistics.

Regras de interpretação clínica:
- Extraia todos os critérios clínicos mencionados, mesmo quando o usuário usar uma forma abreviada.
- "LCA com reto femoral" significa ligamento="LCA" e enxerto="Tendão do Reto Femoral".
- "reto femoral" e "tendão do reto femoral" representam o mesmo enxerto.
- "LCA + LAL", "LCA + ALL" e "LCA associado ao ligamento anterolateral" representam a mesma associação.
- A frase "reconstrução do ligamento cruzado anterior associado ao ligamento anterolateral utilizando o enxerto do reto femoral" significa ligamento="LCA", reforco="ALL (Ligamento Anterolateral)" e enxerto="Tendão do Reto Femoral".
- Siglas, nomes por extenso, diferenças de acento e maiúsculas não mudam o significado da busca.

Regras de PDF:
- Ao concluir um relatório, pergunte se o usuário deseja baixá-lo em PDF.
- Nunca diga que um PDF já foi gerado antes da confirmação do usuário.
- Não ofereça PDF para respostas que usaram apenas query_statistics.

Seja direto, objetivo e use linguagem médica adequada.

${APP_GUIDE}
${accessContext}`;
}

const commonFilterProperties = {
  scope: {
    type: "string",
    enum: ["own", "doctor", "all"],
    description: "Escopo obrigatório: own para o próprio médico, doctor para um médico específico, all somente para administrador e plataforma inteira.",
  },
  doctor_query: {
    type: "string",
    description: "Nome ou parte do nome do médico. Obrigatório apenas com scope=doctor.",
  },
  sexo: { type: "string", enum: ["M", "F"] },
  enxerto: {
    type: "string",
    description: "Tipo de enxerto; a busca ignora diferenças de maiúsculas e acentos.",
  },
  ligamento: {
    type: "string",
    description: "Sigla ou nome do ligamento, como LCA, LCP, LCM ou CPL. Também reconhece nomes por extenso e procura em todos os campos cirúrgicos equivalentes.",
  },
  reforco: {
    type: "string",
    description: "Associação ou reforço extra-articular, como LAL/ALL (ligamento anterolateral), LET ou LOA.",
  },
  diagnostico: {
    type: "string",
    description: "Diagnóstico clínico; a busca ignora diferenças de maiúsculas e acentos.",
  },
  tipo_procedimento: {
    type: "string",
    description: "Categoria geral cadastrada no campo tipo de procedimento, não a sigla isolada do ligamento.",
  },
  periodo_inicio: { type: "string", description: "Data inicial YYYY-MM-DD" },
  periodo_fim: { type: "string", description: "Data final YYYY-MM-DD" },
} as const;

const tools: Parameters<typeof openai.chat.completions.create>[0]["tools"] = [
  {
    type: "function",
    function: {
      name: "query_statistics",
      description: "Consulta somente métricas clínicas agregadas por meio de operações autorizadas pelo servidor.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          ...commonFilterProperties,
          operation: {
            type: "string",
            enum: [
              "patient_count",
              "surgery_count",
              "followup_count",
              "average_ikdc",
              "average_lysholm",
              "average_pain",
              "return_to_sport_rate",
              "failure_rate",
            ],
          },
          group_by: {
            type: "string",
            enum: ["none", "sex", "year"],
          },
        },
        required: ["operation", "scope"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_report",
      description: "Gera um relatório estruturado e autorizado de pacientes e procedimentos.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          ...commonFilterProperties,
          titulo: { type: "string" },
          filtros_descricao: { type: "string" },
        },
        required: ["titulo", "filtros_descricao", "scope"],
      },
    },
  },
];

async function resolveDoctorId(doctorQuery: string): Promise<number> {
  const normalized = doctorQuery.trim();
  const result = await pool.query<{ id: number }>(
    `
      SELECT id
      FROM doctors
      WHERE aprovado = true
        AND lower(nome) LIKE lower($1)
      ORDER BY
        CASE WHEN lower(nome) = lower($2) THEN 0 ELSE 1 END,
        nome
      LIMIT 2
    `,
    [`%${normalized}%`, normalized],
  );

  if (result.rows.length === 0) {
    throw new Error("Nenhum médico aprovado corresponde ao nome informado");
  }
  if (result.rows.length > 1) {
    throw new Error("Mais de um médico corresponde ao nome informado; seja mais específico");
  }
  return result.rows[0]!.id;
}

async function resolveRequestedScope(
  args: { scope: "own" | "doctor" | "all"; doctor_query?: string },
  actorDoctorId: number,
  isAdmin: boolean,
): Promise<ResolvedAgentScope> {
  const resolvedDoctorId =
    isAdmin && args.scope === "doctor" && args.doctor_query
      ? await resolveDoctorId(args.doctor_query)
      : undefined;
  return authorizeAgentScope(
    args.scope,
    actorDoctorId,
    isAdmin,
    resolvedDoctorId,
  );
}

function auditAgentAccess(
  req: Request,
  details: {
    operation: string;
    requestedScope: string;
    resolvedScope: ResolvedAgentScope;
    rowCount: number;
  },
): void {
  const payload = {
    event: "agent_data_access",
    actorDoctorId: req.doctorId,
    actorIsAdmin: req.isAdmin === true,
    operation: details.operation,
    requestedScope: details.requestedScope,
    resolvedDoctorId:
      details.resolvedScope.kind === "doctor"
        ? details.resolvedScope.doctorId
        : null,
    rowCount: details.rowCount,
  };

  if (req.isAdmin && details.resolvedScope.kind === "all") {
    req.log.warn(payload, "Admin JoIA access to platform-wide clinical data");
  } else {
    req.log.info(payload, "JoIA clinical data access");
  }
}

async function runStatistics(
  args: StatisticsArgs,
  scope: ResolvedAgentScope,
): Promise<{ operation: string; group_by: string; results: unknown[] }> {
  const query = buildStatisticsQuery(args, scope);
  const result = await pool.query(query.text, query.values);
  return {
    operation: args.operation,
    group_by: args.group_by,
    results: result.rows.slice(0, 100),
  };
}

async function runGenerateReport(
  args: ReportArgs,
  scope: ResolvedAgentScope,
  isAdmin: boolean,
) {
  const query = buildReportQuery(args, scope);
  const result = await pool.query(query.text, query.values);
  const patients = result.rows.slice(0, 200) as Array<Record<string, unknown>>;

  let followupStats: unknown = null;
  const surgeryIds = patients
    .map((patient) => Number(patient.surgery_id))
    .filter((id) => Number.isInteger(id) && id > 0);

  if (surgeryIds.length > 0) {
    const followupQuery = buildFollowupStatsQuery(surgeryIds);
    const followupResult = await pool.query(
      followupQuery.text,
      followupQuery.values,
    );
    followupStats = followupResult.rows[0] ?? null;
  }

  return {
    patients,
    followupStats,
    titulo: args.titulo,
    filtros_descricao: args.filtros_descricao,
    isAdmin,
  };
}

router.post("/agent/chat", requireAuth, async (req, res): Promise<void> => {
  try {
    const parsedBody = AgentChatBodySchema.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({ error: "Mensagens inválidas ou muito extensas." });
      return;
    }

    const doctorId = req.doctorId;
    if (!doctorId) {
      res.status(401).json({ error: "Não autenticado" });
      return;
    }

    const isAdmin = req.isAdmin === true;
    const messages = parsedBody.data.messages;
    const lastUserMessage =
      messages.filter((message) => message.role === "user").at(-1)?.content ?? "";
    const clinicalFilterContext = buildClinicalFilterContext(messages);
    const userWantsPdf = /pdf|baixar|download|imprimir/i.test(lastUserMessage);
    const systemMessages = [
      {
        role: "system" as const,
        content: buildSystemPrompt(isAdmin),
      },
    ];

    const firstResponse = await openai.chat.completions.create({
      model: "gpt-5.1",
      messages: [...systemMessages, ...messages],
      tools,
      tool_choice: "auto",
      max_completion_tokens: 4096,
    });

    const firstChoice = firstResponse.choices[0];
    if (
      firstChoice.finish_reason !== "tool_calls" ||
      !firstChoice.message.tool_calls
    ) {
      res.json({
        message: firstChoice.message.content,
        isReport: false,
        reportData: null,
      });
      return;
    }

    const toolResults: Array<{
      role: "tool";
      tool_call_id: string;
      content: string;
    }> = [];
    let reportData: Awaited<ReturnType<typeof runGenerateReport>> | null = null;

    for (const toolCall of firstChoice.message.tool_calls) {
      const call = toolCall as {
        id: string;
        function: { name: string; arguments: string };
      };

      let rawArgs: unknown;
      try {
        rawArgs = JSON.parse(call.function.arguments);
      } catch {
        toolResults.push({
          role: "tool",
          tool_call_id: call.id,
          content: "Erro: argumentos JSON inválidos.",
        });
        continue;
      }

      if (call.function.name === "query_statistics") {
        const parsedArgs = StatisticsArgsSchema.safeParse(rawArgs);
        if (!parsedArgs.success) {
          toolResults.push({
            role: "tool",
            tool_call_id: call.id,
            content: "Erro: operação, escopo ou filtros estatísticos inválidos.",
          });
          continue;
        }

        try {
          const enrichedArgs = enrichClinicalFiltersFromMessage(
            parsedArgs.data,
            clinicalFilterContext,
          );
          const scope = await resolveRequestedScope(
            enrichedArgs,
            doctorId,
            isAdmin,
          );
          const statistics = await runStatistics(enrichedArgs, scope);
          auditAgentAccess(req, {
            operation: enrichedArgs.operation,
            requestedScope: enrichedArgs.scope,
            resolvedScope: scope,
            rowCount: statistics.results.length,
          });
          toolResults.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(statistics),
          });
        } catch (error) {
          req.log.warn({
            event: "agent_data_access_rejected",
            actorDoctorId: doctorId,
            operation: parsedArgs.data.operation,
            requestedScope: parsedArgs.data.scope,
            reason: error instanceof Error ? error.message : "unknown",
          }, "JoIA data access rejected");
          toolResults.push({
            role: "tool",
            tool_call_id: call.id,
            content: `Erro de segurança: ${error instanceof Error ? error.message : "acesso recusado"}.`,
          });
        }
        continue;
      }

      if (call.function.name === "generate_report") {
        const parsedArgs = ReportArgsSchema.safeParse(rawArgs);
        if (!parsedArgs.success) {
          toolResults.push({
            role: "tool",
            tool_call_id: call.id,
            content: "Erro: escopo ou filtros do relatório inválidos.",
          });
          continue;
        }

        try {
          const enrichedArgs = enrichClinicalFiltersFromMessage(
            parsedArgs.data,
            clinicalFilterContext,
          );
          const scope = await resolveRequestedScope(
            enrichedArgs,
            doctorId,
            isAdmin,
          );
          const data = await runGenerateReport(enrichedArgs, scope, isAdmin);
          reportData = data;
          auditAgentAccess(req, {
            operation: "generate_report",
            requestedScope: enrichedArgs.scope,
            resolvedScope: scope,
            rowCount: data.patients.length,
          });
          toolResults.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(summarizeReportForAi(data)),
          });
        } catch (error) {
          req.log.warn({
            event: "agent_data_access_rejected",
            actorDoctorId: doctorId,
            operation: "generate_report",
            requestedScope: parsedArgs.data.scope,
            reason: error instanceof Error ? error.message : "unknown",
          }, "JoIA report access rejected");
          toolResults.push({
            role: "tool",
            tool_call_id: call.id,
            content: `Erro de segurança: ${error instanceof Error ? error.message : "acesso recusado"}.`,
          });
        }
        continue;
      }

      toolResults.push({
        role: "tool",
        tool_call_id: call.id,
        content: "Erro: ferramenta não autorizada.",
      });
    }

    const finalResponse = await openai.chat.completions.create({
      model: "gpt-5.1",
      messages: [
        ...systemMessages,
        ...messages,
        firstChoice.message,
        ...toolResults,
      ],
      max_completion_tokens: 2048,
    });

    res.json({
      message: finalResponse.choices[0]?.message.content ?? "",
      isReport: Boolean(reportData) && (userWantsPdf || reportData!.patients.length > 0),
      reportData,
    });
  } catch (error) {
    req.log.error({ err: error }, "Erro no agente JoIA");
    res.status(500).json({ error: "Erro interno no agente de IA" });
  }
});

export default router;