/**
 * Apoio à decisão baseado em literatura.
 *
 * - O servidor é a fonte da verdade: recalcula com o motor de @workspace/clinical e grava a execução
 *   (tabela só de inserção). Qualquer resultado enviado pelo cliente é ignorado.
 * - Toda saída é "Sugestão"; a escolha do cirurgião é registrada à parte.
 * - Governança: conteúdo e versão no código (hash); status no banco (a linha mais recente vale,
 *   sem linha = rascunho). Admin vê tudo; os demais só versões ativas, e só com a flag
 *   `apoio_decisao` ligada (padrão: desligada). Limiares diferentes do padrão aprovado só valem
 *   em revisão feita pelo admin; os parâmetros usados ficam gravados em `resultado.parametros`.
 * - Com `surgeryId`, a entrada vem do registro (dadosClinicos + nascimento do paciente) pelo mapeador
 *   do algoritmo; o que o cliente envia só preenche lacunas, e divergências ficam em `conflitos`.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  apoioDecisaoEscolhasTable,
  apoioDecisaoExecucoesTable,
  apoioDecisaoStatusTable,
  featureFlagsTable,
  patientsTable,
  surgeriesTable,
} from "@workspace/db";
import {
  AlterarStatusApoioDecisaoBody,
  AvaliarApoioDecisaoBody,
  RegistrarEscolhaApoioDecisaoBody,
} from "@workspace/api-zod";
import {
  ClinicalGuardError,
  concordancia,
  decisionRegistry,
  evaluate,
  podeTransitar,
  statusEfetivo,
  montarEntrada,
  type AlgoritmoRegistrado,
  type ClinicalPayload,
  type ContextoMapeamento,
  type DecisionRegistry,
  type EntradaMontada,
  type ProvenienciaEntrada,
  type ResultadoApoio,
  type StatusAlgoritmo,
} from "@workspace/clinical";
import { requireAdmin, requireAuth } from "../middlewares/requireAuth";

export const APOIO_DECISAO_FLAG = "apoio_decisao";

type LinhaStatus = { algoritmoVersao: string; status: string; hash: string; createdAt: Date };

async function flagLigada(): Promise<boolean> {
  const [flag] = await db
    .select({ enabled: featureFlagsTable.enabled })
    .from(featureFlagsTable)
    .where(eq(featureFlagsTable.key, APOIO_DECISAO_FLAG))
    .limit(1);
  return flag?.enabled === true;
}

/** Última linha de status por "id@versão" (tabela só de inserção: maior id vale). */
async function ultimasLinhas(algoritmoIds: string[], executor: Pick<typeof db, "select"> = db): Promise<Map<string, LinhaStatus>> {
  const out = new Map<string, LinhaStatus>();
  if (!algoritmoIds.length) return out;
  const rows = await executor
    .select({
      algoritmoId: apoioDecisaoStatusTable.algoritmoId,
      algoritmoVersao: apoioDecisaoStatusTable.algoritmoVersao,
      status: apoioDecisaoStatusTable.status,
      hash: apoioDecisaoStatusTable.algoritmoHash,
      createdAt: apoioDecisaoStatusTable.createdAt,
    })
    .from(apoioDecisaoStatusTable)
    .where(inArray(apoioDecisaoStatusTable.algoritmoId, algoritmoIds))
    .orderBy(desc(apoioDecisaoStatusTable.id));
  for (const r of rows) {
    const key = `${r.algoritmoId}@${r.algoritmoVersao}`;
    if (!out.has(key)) out.set(key, r);
  }
  return out;
}

function chave(e: AlgoritmoRegistrado): string {
  return `${e.def.id}@${e.def.versao}`;
}

function paramStr(v: unknown): string {
  return Array.isArray(v) ? String(v[0]) : String(v ?? "");
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Partes do dadosClinicos usadas pelos mapeadores, só com a forma esperada (rascunho pode estar incompleto). */
function payloadParaMapeamento(raw: unknown): ContextoMapeamento["payload"] {
  if (!isObj(raw)) return {};
  const pre = raw.avaliacaoPreop;
  const avaliacaoPreop = isObj(pre)
    ? {
      comum: isObj(pre.comum) ? pre.comum : {},
      patologias: Array.isArray(pre.patologias) ? pre.patologias.filter(isObj) as unknown as NonNullable<ClinicalPayload["avaliacaoPreop"]>["patologias"] : [],
    }
    : undefined;
  return {
    ...(avaliacaoPreop ? { avaliacaoPreop } : {}),
    ...(isObj(raw.geral) ? { geral: raw.geral } : {}),
    ...(Array.isArray(raw.procedimentos) ? { procedimentos: raw.procedimentos.filter(isObj) as unknown as ClinicalPayload["procedimentos"] } : {}),
  };
}

/** Algoritmo visível ao usuário, com o status efetivo; undefined = não existe ou não visível. */
async function algoritmoVisivel(
  registry: DecisionRegistry,
  req: Request,
  id: string,
  versao: string,
): Promise<{ entry: AlgoritmoRegistrado; status: StatusAlgoritmo } | undefined> {
  const entry = registry.get(id, versao);
  if (!entry) return undefined;
  const linhas = await ultimasLinhas([id]);
  const status = statusEfetivo(linhas.get(chave(entry)), entry.hash);
  if (req.isAdmin) return { entry, status };
  if (status !== "ativo" || !(await flagLigada())) return undefined;
  return { entry, status };
}

export function createDecisionSupportRouter(registry: DecisionRegistry = decisionRegistry): IRouter {
  const router: IRouter = Router();

  // GET /apoio-decisao/algoritmos — versões visíveis ao usuário, com status
  router.get("/apoio-decisao/algoritmos", requireAuth, async (req, res): Promise<void> => {
    const entries = registry.list();
    const [moduloAtivo, linhas] = await Promise.all([
      flagLigada(),
      ultimasLinhas([...new Set(entries.map((e) => e.def.id))]),
    ]);
    const algoritmos = entries
      .map((e) => {
        const linha = linhas.get(chave(e));
        const status = statusEfetivo(linha, e.hash);
        return {
          id: e.def.id,
          versao: e.def.versao,
          titulo: e.def.titulo,
          escopo: e.def.escopo,
          patologias: e.def.patologias,
          status,
          hash: e.hash,
          hashConfereLock: e.hashLock === e.hash,
          statusAtualizadoEm: linha && linha.hash === e.hash ? linha.createdAt.toISOString() : null,
          definicao: e.def,
        };
      })
      .filter((a) => req.isAdmin || (moduloAtivo && a.status === "ativo"));
    res.json({ moduloAtivo, algoritmos });
  });

  // POST /apoio-decisao/algoritmos/:algoritmoId/:versao/avaliar — avalia no servidor e grava a execução
  router.post("/apoio-decisao/algoritmos/:algoritmoId/:versao/avaliar", requireAuth, async (req, res): Promise<void> => {
    const parsed = AvaliarApoioDecisaoBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Dados inválidos.", code: "INVALID_BODY" });
      return;
    }
    const body = parsed.data;
    if ((body.patientId !== undefined && !isPositiveInt(body.patientId))
      || (body.surgeryId !== undefined && !isPositiveInt(body.surgeryId))) {
      res.status(400).json({ error: "Identificador inválido.", code: "INVALID_ID" });
      return;
    }
    if (body.revisao === true && !req.isAdmin) {
      res.status(403).json({ error: "Modo revisão restrito ao administrador.", code: "REVIEW_ADMIN_ONLY" });
      return;
    }
    const visivel = await algoritmoVisivel(registry, req, paramStr(req.params.algoritmoId), paramStr(req.params.versao));
    if (!visivel) {
      res.status(404).json({ error: "Algoritmo não encontrado.", code: "ALGORITHM_NOT_FOUND" });
      return;
    }
    const { entry, status } = visivel;
    const modoGravado = status === "ativo" && body.revisao !== true ? body.modo : "revisao";
    if (modoGravado === "revisao" && (body.patientId !== undefined || body.surgeryId !== undefined)) {
      res.status(422).json({
        error: "Avaliação de revisão não pode ser vinculada a paciente ou cirurgia.",
        code: "REVIEW_RUN_NOT_LINKABLE",
      });
      return;
    }
    // Governança: limiares fora do padrão aprovado (hash) só valem em revisão feita pelo admin.
    const overrides = body.parametros && Object.keys(body.parametros).length ? body.parametros : undefined;
    const aplicaOverrides = overrides !== undefined && req.isAdmin === true && modoGravado === "revisao";
    const parametrosIgnorados = overrides !== undefined && !aplicaOverrides;

    let patientId: number | null = body.patientId ?? null;
    const surgeryId: number | null = body.surgeryId ?? null;
    let contexto: Omit<ContextoMapeamento, "manual"> | undefined;
    if (surgeryId !== null) {
      const [s] = await db
        .select({
          patientId: surgeriesTable.patientId,
          dadosClinicos: surgeriesTable.dadosClinicos,
          dataCirurgia: surgeriesTable.dataCirurgia,
          lado: surgeriesTable.lado,
          dataNascimento: patientsTable.dataNascimento,
        })
        .from(surgeriesTable)
        .innerJoin(patientsTable, and(eq(patientsTable.id, surgeriesTable.patientId), eq(patientsTable.doctorId, req.doctorId!)))
        .where(and(eq(surgeriesTable.id, surgeryId), eq(surgeriesTable.doctorId, req.doctorId!)))
        .limit(1);
      if (!s) {
        res.status(404).json({ error: "Cirurgia não encontrada.", code: "SURGERY_NOT_FOUND" });
        return;
      }
      if (patientId !== null && patientId !== s.patientId) {
        res.status(422).json({ error: "A cirurgia não pertence a este paciente.", code: "PATIENT_SURGERY_MISMATCH" });
        return;
      }
      patientId = s.patientId;
      contexto = {
        payload: payloadParaMapeamento(s.dadosClinicos),
        dataNascimento: s.dataNascimento,
        dataReferencia: s.dataCirurgia,
        lado: s.lado,
      };
    } else if (patientId !== null) {
      const [p] = await db
        .select({ id: patientsTable.id })
        .from(patientsTable)
        .where(and(eq(patientsTable.id, patientId), eq(patientsTable.doctorId, req.doctorId!)))
        .limit(1);
      if (!p) {
        res.status(404).json({ error: "Paciente não encontrado.", code: "PATIENT_NOT_FOUND" });
        return;
      }
    }

    let resultado: ResultadoApoio;
    let montada: EntradaMontada;
    try {
      // Com cirurgia: registro (mapeador do algoritmo) + manual, sem o manual sobrescrever o registro
      montada = montarEntrada(entry.def, entry.mapear, contexto, body.entrada);
      resultado = evaluate(entry.def, montada.entrada, {
        status,
        hash: entry.hash,
        modo: body.modo,
        ...(aplicaOverrides ? { parametros: overrides } : {}),
      });
    } catch (err) {
      if (err instanceof ClinicalGuardError) {
        res.status(422).json({ error: err.message, code: err.code, ...(err.field ? { field: err.field } : {}) });
        return;
      }
      throw err;
    }
    // Proveniência só das entradas efetivamente usadas (o modo preop descarta as intraoperatórias)
    const proveniencia: Record<string, ProvenienciaEntrada> = {};
    for (const k of Object.keys(resultado.entrada)) proveniencia[k] = montada.proveniencia[k] ?? { de: "manual" };

    const [row] = await db
      .insert(apoioDecisaoExecucoesTable)
      .values({
        doctorId: req.doctorId!,
        patientId,
        surgeryId,
        algoritmoId: entry.def.id,
        algoritmoVersao: entry.def.versao,
        algoritmoHash: entry.hash,
        statusNoMomento: status,
        motorVersao: resultado.motor,
        modo: modoGravado,
        entrada: resultado.entrada,
        proveniencia,
        conflitos: montada.conflitos,
        resultado,
      })
      .returning({ id: apoioDecisaoExecucoesTable.id });
    res.status(201).json({
      execucaoId: row.id,
      modo: modoGravado,
      resultado,
      proveniencia,
      conflitos: montada.conflitos,
      parametrosIgnorados,
    });
  });

  // POST /apoio-decisao/execucoes/:id/escolha — escolha do cirurgião, vinculada à execução
  router.post("/apoio-decisao/execucoes/:id/escolha", requireAuth, async (req, res): Promise<void> => {
    const id = Number.parseInt(paramStr(req.params.id), 10);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "ID inválido.", code: "INVALID_ID" });
      return;
    }
    const parsed = RegistrarEscolhaApoioDecisaoBody.safeParse(req.body);
    const body = parsed.success ? parsed.data : undefined;
    const opcao = body?.opcao?.trim() || undefined;
    const outra = body?.outra?.trim() || undefined;
    if (!body || (opcao === undefined) === (outra === undefined)) {
      res.status(400).json({ error: "Informe uma opção do algoritmo ou descreva outra conduta (apenas uma).", code: "INVALID_BODY" });
      return;
    }
    const [exec] = await db
      .select()
      .from(apoioDecisaoExecucoesTable)
      .where(and(eq(apoioDecisaoExecucoesTable.id, id), eq(apoioDecisaoExecucoesTable.doctorId, req.doctorId!)))
      .limit(1);
    if (!exec) {
      res.status(404).json({ error: "Execução não encontrada.", code: "EXECUTION_NOT_FOUND" });
      return;
    }
    if (exec.modo === "revisao") {
      res.status(409).json({ error: "Execução de revisão não recebe escolha do cirurgião.", code: "REVIEW_RUN" });
      return;
    }
    const resultado = exec.resultado as ResultadoApoio;
    if (opcao !== undefined) {
      const def = registry.get(exec.algoritmoId, exec.algoritmoVersao)?.def;
      const validas = new Set(def ? def.opcoes.map((o) => o.id) : resultado.opcoes.map((o) => o.opcao));
      if (!validas.has(opcao)) {
        res.status(422).json({ error: "Opção não pertence ao algoritmo.", code: "UNKNOWN_OPTION" });
        return;
      }
    }
    const escolha = opcao !== undefined ? { opcao } : { outra: outra! };
    const [row] = await db
      .insert(apoioDecisaoEscolhasTable)
      .values({
        execucaoId: exec.id,
        doctorId: req.doctorId!,
        opcao: opcao ?? null,
        outra: outra ?? null,
        concordancia: concordancia(resultado, escolha),
        justificativa: body.justificativa?.trim() || null,
      })
      .returning();
    res.status(201).json({
      id: row.id,
      execucaoId: row.execucaoId,
      opcao: row.opcao,
      outra: row.outra,
      concordancia: row.concordancia,
      justificativa: row.justificativa,
      createdAt: row.createdAt.toISOString(),
    });
  });

  // POST /apoio-decisao/algoritmos/:algoritmoId/:versao/status — governança (admin)
  router.post("/apoio-decisao/algoritmos/:algoritmoId/:versao/status", requireAdmin, async (req: Request, res: Response): Promise<void> => {
    const parsed = AlterarStatusApoioDecisaoBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Dados inválidos.", code: "INVALID_BODY" });
      return;
    }
    const { status: novo, hash, nota } = parsed.data;
    const entry = registry.get(paramStr(req.params.algoritmoId), paramStr(req.params.versao));
    if (!entry) {
      res.status(404).json({ error: "Versão do algoritmo não existe no código em execução.", code: "ALGORITHM_NOT_FOUND" });
      return;
    }
    if (entry.hashLock !== entry.hash) {
      res.status(409).json({
        error: "Conteúdo do algoritmo difere do versions.lock.json: suba a versão e regenere o lock.",
        code: "LOCK_MISMATCH",
      });
      return;
    }
    if (hash !== entry.hash) {
      res.status(409).json({
        error: "O hash informado difere do conteúdo em execução. Revise a versão atual antes de mudar o status.",
        code: "HASH_MISMATCH",
      });
      return;
    }
    const { id: algoritmoId, versao } = entry.def;

    const outcome = await db.transaction(async (tx) => {
      // Serializa mudanças de status do mesmo algoritmo
      await tx.execute(sql`SELECT pg_advisory_xact_lock(87011, hashtext(${algoritmoId}))`);
      const linhas = await ultimasLinhas([algoritmoId], tx);
      const anterior = statusEfetivo(linhas.get(chave(entry)), entry.hash);
      if (!podeTransitar(anterior, novo)) return { kind: "invalid" as const, anterior };

      const aposentadas: string[] = [];
      if (novo === "ativo") {
        for (const l of linhas.values()) {
          if (l.algoritmoVersao !== versao && l.status === "ativo") aposentadas.push(l.algoritmoVersao);
        }
        if (aposentadas.length) {
          await tx.insert(apoioDecisaoStatusTable).values(aposentadas.map((v) => ({
            algoritmoId,
            algoritmoVersao: v,
            algoritmoHash: linhas.get(`${algoritmoId}@${v}`)!.hash,
            status: "aposentado",
            doctorId: req.doctorId!,
            nota: `Aposentada ao ativar ${versao}.`,
          })));
        }
      }
      const [row] = await tx
        .insert(apoioDecisaoStatusTable)
        .values({ algoritmoId, algoritmoVersao: versao, algoritmoHash: entry.hash, status: novo, doctorId: req.doctorId!, nota: nota?.trim() || null })
        .returning({ createdAt: apoioDecisaoStatusTable.createdAt });
      return { kind: "ok" as const, anterior, aposentadas: aposentadas.sort(), createdAt: row.createdAt };
    });

    if (outcome.kind === "invalid") {
      res.status(422).json({ error: `Transição não permitida: ${outcome.anterior} → ${novo}.`, code: "INVALID_TRANSITION" });
      return;
    }
    res.status(201).json({
      algoritmoId,
      versao,
      hash: entry.hash,
      status: novo,
      anterior: outcome.anterior,
      aposentadas: outcome.aposentadas,
      createdAt: outcome.createdAt.toISOString(),
    });
  });

  // GET /apoio-decisao/algoritmos/:algoritmoId/:versao/status — histórico de status (admin)
  router.get("/apoio-decisao/algoritmos/:algoritmoId/:versao/status", requireAdmin, async (req, res): Promise<void> => {
    const algoritmoId = paramStr(req.params.algoritmoId);
    const versao = paramStr(req.params.versao);
    const entry = registry.get(algoritmoId, versao);
    const rows = await db
      .select({
        id: apoioDecisaoStatusTable.id,
        status: apoioDecisaoStatusTable.status,
        hash: apoioDecisaoStatusTable.algoritmoHash,
        doctorId: apoioDecisaoStatusTable.doctorId,
        nota: apoioDecisaoStatusTable.nota,
        createdAt: apoioDecisaoStatusTable.createdAt,
      })
      .from(apoioDecisaoStatusTable)
      .where(and(eq(apoioDecisaoStatusTable.algoritmoId, algoritmoId), eq(apoioDecisaoStatusTable.algoritmoVersao, versao)))
      .orderBy(desc(apoioDecisaoStatusTable.id));
    if (!entry && rows.length === 0) {
      res.status(404).json({ error: "Versão do algoritmo não encontrada.", code: "ALGORITHM_NOT_FOUND" });
      return;
    }
    res.json({
      algoritmoId,
      versao,
      hashCodigo: entry?.hash ?? null,
      hashLock: entry?.hashLock ?? null,
      historico: rows.map((r) => ({
        id: r.id,
        status: r.status,
        hash: r.hash,
        hashConfereCodigo: entry ? r.hash === entry.hash : false,
        doctorId: r.doctorId,
        nota: r.nota,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  });

  // GET /apoio-decisao/cirurgias/:surgeryId/execucoes — execuções vinculadas à cirurgia, com a última escolha
  router.get("/apoio-decisao/cirurgias/:surgeryId/execucoes", requireAuth, async (req, res): Promise<void> => {
    const surgeryId = Number.parseInt(paramStr(req.params.surgeryId), 10);
    if (!Number.isInteger(surgeryId) || surgeryId <= 0) {
      res.status(400).json({ error: "ID inválido.", code: "INVALID_ID" });
      return;
    }
    const [s] = await db
      .select({ id: surgeriesTable.id })
      .from(surgeriesTable)
      .where(and(eq(surgeriesTable.id, surgeryId), eq(surgeriesTable.doctorId, req.doctorId!)))
      .limit(1);
    if (!s) {
      res.status(404).json({ error: "Cirurgia não encontrada.", code: "SURGERY_NOT_FOUND" });
      return;
    }
    const execs = await db
      .select()
      .from(apoioDecisaoExecucoesTable)
      .where(and(eq(apoioDecisaoExecucoesTable.surgeryId, surgeryId), eq(apoioDecisaoExecucoesTable.doctorId, req.doctorId!)))
      .orderBy(desc(apoioDecisaoExecucoesTable.id));
    const escolhas = execs.length
      ? await db
        .select()
        .from(apoioDecisaoEscolhasTable)
        .where(and(
          inArray(apoioDecisaoEscolhasTable.execucaoId, execs.map((e) => e.id)),
          eq(apoioDecisaoEscolhasTable.doctorId, req.doctorId!),
        ))
        .orderBy(desc(apoioDecisaoEscolhasTable.id))
      : [];
    const ultimaEscolha = new Map<number, (typeof escolhas)[number]>();
    for (const e of escolhas) if (!ultimaEscolha.has(e.execucaoId)) ultimaEscolha.set(e.execucaoId, e);
    res.json({
      execucoes: execs.map((e) => {
        const escolha = ultimaEscolha.get(e.id);
        return {
          execucaoId: e.id,
          algoritmoId: e.algoritmoId,
          versao: e.algoritmoVersao,
          hash: e.algoritmoHash,
          statusNoMomento: e.statusNoMomento,
          modo: e.modo,
          createdAt: e.createdAt.toISOString(),
          resultado: e.resultado,
          escolha: escolha
            ? {
              id: escolha.id,
              execucaoId: escolha.execucaoId,
              opcao: escolha.opcao,
              outra: escolha.outra,
              concordancia: escolha.concordancia,
              justificativa: escolha.justificativa,
              createdAt: escolha.createdAt.toISOString(),
            }
            : null,
        };
      }),
    });
  });

  return router;
}

export default createDecisionSupportRouter();
