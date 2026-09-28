import { Router, type IRouter } from "express";
import {
  db,
  careLinksTable,
  doctorsTable,
  physioDocumentsTable,
  physioPatientsTable,
  physiotherapistsTable,
  rehabAssessmentsTable,
} from "@workspace/db";
import { and, eq, desc, isNull } from "drizzle-orm";
import { z } from "zod/v4";
import PDFDocument from "pdfkit";
import { requirePhysio } from "../middlewares/requireAuth";
import { physioWriteGuard } from "../middlewares/physioPlanGuard";
import { ObjectStorageService, objectStorageClient } from "../lib/objectStorage";
import { localeDate, resolveDoctorLocale, type SupportedLocale } from "../lib/locale";

const router: IRouter = Router();
router.use("/physio", requirePhysio);
router.use("/physio", physioWriteGuard);

// ── Templates Zod por doc_type (seção 6 da especificação) ───────────────────
export const DOC_TYPES = ["anamnese", "evolucao", "laudo", "atestado", "followup_note"] as const;
export type DocType = (typeof DOC_TYPES)[number];

const anamneseContent = z.object({
  queixa_principal: z.string().default(""),
  hda: z.string().default(""),
  hpp: z.string().default(""),
  cirurgia: z.object({
    tipo: z.string().default(""),
    data: z.string().nullable().default(null),
    cirurgiao: z.string().default(""),
  }).default({ tipo: "", data: null, cirurgiao: "" }),
  medicamentos: z.string().default(""),
  nivel_atividade_pre: z.string().default(""),
  objetivo_paciente: z.string().default(""),
  exame_fisico_inicial: z.string().default(""),
});

const evolucaoContent = z.object({
  data_sessao: z.string().nullable().default(null),
  sessao_numero: z.number().int().positive().nullable().default(null),
  condutas: z.string().default(""),
  intercorrencias: z.string().default(""),
  resposta_ao_tratamento: z.string().default(""),
  plano_proxima_sessao: z.string().default(""),
});

const laudoContent = z.object({
  periodo: z.object({
    inicio: z.string().nullable().default(null),
    fim: z.string().nullable().default(null),
  }).default({ inicio: null, fim: null }),
  sessoes_realizadas: z.number().int().nonnegative().nullable().default(null),
  diagnostico_fisioterapeutico: z.string().default(""),
  evolucao_resumo: z.string().default(""),
  dados_objetivos_snapshot: z.record(z.string(), z.unknown()).nullable().default(null),
  prognostico: z.string().default(""),
  destinatario: z.string().default(""),
});

const atestadoContent = z.object({
  texto: z.string().default(""),
  finalidade: z.string().default(""),
  data_emissao: z.string().nullable().default(null),
  validade: z.string().nullable().default(null),
});

const followupNoteContent = z.object({
  referente_followup_id: z.number().int().positive().nullable().default(null),
  observacoes: z.string().default(""),
});

const CONTENT_SCHEMAS: Record<DocType, z.ZodType> = {
  anamnese: anamneseContent,
  evolucao: evolucaoContent,
  laudo: laudoContent,
  atestado: atestadoContent,
  followup_note: followupNoteContent,
};

const CreateDocBody = z.object({
  docType: z.enum(DOC_TYPES),
  title: z.string().max(200).optional(),
  content: z.unknown(),
});

const UpdateDocBody = z.object({
  title: z.string().max(200).optional(),
  content: z.unknown().optional(),
});

function parseId(raw: unknown): number | null {
  const id = parseInt(String(raw ?? ""), 10);
  return Number.isNaN(id) ? null : id;
}

async function getOwnedPatient(physioId: number, patientId: number) {
  const [patient] = await db.select().from(physioPatientsTable)
    .where(and(
      eq(physioPatientsTable.id, patientId),
      eq(physioPatientsTable.physioId, physioId),
    ))
    .limit(1);
  return patient ?? null;
}

async function getOwnedDocument(physioId: number, docId: number) {
  const [doc] = await db.select().from(physioDocumentsTable)
    .where(and(
      eq(physioDocumentsTable.id, docId),
      eq(physioDocumentsTable.physioId, physioId),
    ))
    .limit(1);
  return doc ?? null;
}

async function getPatientDoctorLocale(patient: typeof physioPatientsTable.$inferSelect): Promise<SupportedLocale> {
  if (!patient.careLinkId) return "pt-BR";
  const [link] = await db.select({ idioma: doctorsTable.idioma }).from(careLinksTable)
    .innerJoin(doctorsTable, eq(doctorsTable.id, careLinksTable.surgeonId))
    .where(eq(careLinksTable.id, patient.careLinkId)).limit(1);
  return resolveDoctorLocale(link?.idioma);
}

// ── Snapshot de dados objetivos p/ laudo (últimas avaliações) ───────────────
async function buildObjectiveSnapshot(physioPatientId: number) {
  const rows = await db.select().from(rehabAssessmentsTable)
    .where(eq(rehabAssessmentsTable.physioPatientId, physioPatientId))
    .orderBy(desc(rehabAssessmentsTable.createdAt))
    .limit(100);

  // Índices objetivos da reabilitação do joelho (LSI, hop, ACL-RSI) retirados;
  // o laudo registra só as avaliações estruturadas vigentes.
  const snapshot: Record<string, unknown> = {};
  for (const row of rows) {
    if (row.assessmentType === "retorno_esporte" && snapshot.retorno_esporte === undefined) {
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      snapshot.retorno_esporte = payload.decisao;
      snapshot.retorno_esporte_data = row.createdAt;
    }
  }
  return Object.keys(snapshot).length > 0 ? snapshot : null;
}

// ── Geração de PDF (laudo/atestado) ─────────────────────────────────────────
const DOC_TYPE_LABELS: Record<DocType, string> = {
  anamnese: "Anamnese",
  evolucao: "Evolução",
  laudo: "Laudo Fisioterapêutico",
  atestado: "Atestado",
  followup_note: "Nota de Follow-up",
};

function documentLabels(locale: SupportedLocale) {
  if (locale !== "es") return DOC_TYPE_LABELS;
  return {
    anamnese: "Anamnesis", evolucao: "Evolución", laudo: "Informe fisioterapéutico",
    atestado: "Certificado", followup_note: "Nota de seguimiento",
  } satisfies Record<DocType, string>;
}

function fmtDate(value: unknown): string {
  if (!value || typeof value !== "string") return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : value;
}

function generateDocumentPdf(opts: {
  docType: DocType;
  title: string | null;
  content: Record<string, unknown>;
  physio: { nome: string; crefito: string | null; clinica: string | null; cidade: string | null };
  patientName: string;
  locale: SupportedLocale;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const { docType, content, physio, patientName, locale } = opts;

    const PAGE_W = 595;
    const MARGIN = 50;
    const INNER = PAGE_W - MARGIN * 2;

    doc.y = MARGIN;

    // Cabeçalho com identificação completa do profissional
    doc.fontSize(16).font("Helvetica-Bold").fillColor("#0D1B3E").text(physio.nome, MARGIN, doc.y, { align: "center", width: INNER });
    const idLine = [
      physio.crefito ? `CREFITO ${physio.crefito}` : null,
      physio.clinica,
      physio.cidade,
    ].filter(Boolean).join(" · ");
    if (idLine) doc.fontSize(10).font("Helvetica").fillColor("#374151").text(idLine, MARGIN, doc.y, { align: "center", width: INNER });
    doc.moveDown(0.5);
    doc.moveTo(MARGIN, doc.y).lineTo(PAGE_W - MARGIN, doc.y).strokeColor("#D1D5DB").lineWidth(1).stroke();
    doc.moveDown(1);

    doc.fontSize(14).font("Helvetica-Bold").fillColor("#0D1B3E")
       .text(opts.title || documentLabels(locale)[docType], { align: "center" });
    doc.moveDown(1);
    doc.fillColor("black");

    doc.fontSize(11).font("Helvetica-Bold").text(locale === "es" ? "Paciente: " : "Paciente: ", { continued: true })
      .font("Helvetica").text(patientName);
    doc.moveDown(0.75);

    const field = (label: string, value: unknown) => {
      const text = value === null || value === undefined || value === "" ? "—" : String(value);
      doc.fontSize(10).font("Helvetica-Bold").text(`${label}: `, { continued: true })
        .font("Helvetica").text(text);
      doc.moveDown(0.35);
    };

    if (docType === "laudo") {
      const periodo = (content.periodo ?? {}) as Record<string, unknown>;
      field(locale === "es" ? "Período" : "Período", `${fmtDate(periodo.inicio)} a ${fmtDate(periodo.fim)}`);
      field(locale === "es" ? "Sesiones realizadas" : "Sessões realizadas", content.sessoes_realizadas);
      field(locale === "es" ? "Diagnóstico fisioterapéutico" : "Diagnóstico fisioterapêutico", content.diagnostico_fisioterapeutico);
      field(locale === "es" ? "Resumen de la evolución" : "Resumo da evolução", content.evolucao_resumo);

      const snap = content.dados_objetivos_snapshot as Record<string, unknown> | null;
      doc.moveDown(0.5);
      doc.fontSize(11).font("Helvetica-Bold").text(locale === "es" ? "Datos objetivos (evaluaciones estructuradas)" : "Dados objetivos (avaliações estruturadas)");
      doc.moveDown(0.35);
      if (snap && Object.keys(snap).length > 0) {
        if (snap.retorno_esporte !== undefined) {
          const decisao = String(snap.retorno_esporte);
          const label = locale === "es"
            ? ({ apto: "apto", nao_apto: "no apto", parcial: "parcial" } as Record<string, string>)[decisao]
            : ({ apto: "apto", nao_apto: "não apto", parcial: "parcial" } as Record<string, string>)[decisao];
          field(locale === "es" ? "Retorno al deporte" : "Retorno ao esporte", label ?? decisao);
        }
      } else {
        doc.fontSize(10).font("Helvetica").text(locale === "es" ? "No hay evaluaciones estructuradas registradas." : "Sem avaliações estruturadas registradas.");
        doc.moveDown(0.35);
      }
      doc.moveDown(0.5);
      field(locale === "es" ? "Pronóstico" : "Prognóstico", content.prognostico);
      field(locale === "es" ? "Destinatario" : "Destinatário", content.destinatario);
    } else if (docType === "atestado") {
      doc.fontSize(11).font("Helvetica").text(String(content.texto || ""), { lineGap: 3 });
      doc.moveDown(1);
      field(locale === "es" ? "Finalidad" : "Finalidade", content.finalidade);
      field(locale === "es" ? "Fecha de emisión" : "Data de emissão", fmtDate(content.data_emissao));
      field(locale === "es" ? "Validez" : "Validade", fmtDate(content.validade));
    }

    // Rodapé de assinatura
    doc.moveDown(3);
    const sigY = doc.y;
    doc.moveTo(170, sigY).lineTo(425, sigY).strokeColor("black").lineWidth(0.75).stroke();
    doc.moveDown(0.25);
    doc.fontSize(10).font("Helvetica").text(physio.nome, { align: "center" });
    if (physio.crefito) doc.fontSize(9).text(`CREFITO ${physio.crefito}`, { align: "center" });
    doc.moveDown(1);
    doc.fontSize(8).fillColor("#666666")
       .text(locale === "es"
         ? `Documento emitido electrónicamente el ${localeDate(new Date(), locale)}.`
         : `Documento emitido eletronicamente em ${localeDate(new Date(), locale)}.`, { align: "center" });

    doc.end();
  });
}

// ── Upload privado + caminho /objects/... p/ signed URL ─────────────────────
function parsePrivatePath(fullPath: string): { bucketName: string; objectName: string } {
  const parts = fullPath.replace(/^\//, "").split("/");
  return { bucketName: parts[0], objectName: parts.slice(1).join("/") };
}

async function uploadPrivatePdf(objectEntityId: string, pdf: Buffer): Promise<string> {
  const service = new ObjectStorageService();
  let dir = service.getPrivateObjectDir();
  if (!dir.endsWith("/")) dir += "/";
  const fullPath = `${dir}${objectEntityId}`;
  const { bucketName, objectName } = parsePrivatePath(fullPath);
  await objectStorageClient.bucket(bucketName).file(objectName).save(pdf, {
    contentType: "application/pdf",
  });
  return `/objects/${objectEntityId}`;
}

// ── CRUD ────────────────────────────────────────────────────────────────────

// Lista documentos do paciente (opcional ?docType=)
router.get("/physio/patients/:id/documents", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "ID inválido" }); return; }
  const patient = await getOwnedPatient(req.physioId!, id);
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  const docTypeFilter = typeof req.query.docType === "string" && (DOC_TYPES as readonly string[]).includes(req.query.docType)
    ? (req.query.docType as DocType)
    : null;

  const conditions = [eq(physioDocumentsTable.physioPatientId, id)];
  if (docTypeFilter) conditions.push(eq(physioDocumentsTable.docType, docTypeFilter));

  const rows = await db.select().from(physioDocumentsTable)
    .where(and(...conditions))
    .orderBy(desc(physioDocumentsTable.createdAt));
  res.json(rows);
});

// Cria documento
router.post("/physio/patients/:id/documents", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "ID inválido" }); return; }
  const patient = await getOwnedPatient(req.physioId!, id);
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  const parsed = CreateDocBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Dados inválidos" }); return; }

  const contentParsed = CONTENT_SCHEMAS[parsed.data.docType].safeParse(parsed.data.content ?? {});
  if (!contentParsed.success) {
    res.status(400).json({ error: `Conteúdo inválido para ${DOC_TYPE_LABELS[parsed.data.docType]}` });
    return;
  }

  let content = contentParsed.data as Record<string, unknown>;
  // Laudo: preencher snapshot automaticamente quando não informado
  if (parsed.data.docType === "laudo" && !content.dados_objetivos_snapshot) {
    content = { ...content, dados_objetivos_snapshot: await buildObjectiveSnapshot(id) };
  }

  const [doc] = await db.insert(physioDocumentsTable).values({
    physioId: req.physioId!,
    physioPatientId: id,
    docType: parsed.data.docType,
    title: parsed.data.title ?? null,
    content,
  }).returning();

  res.status(201).json(doc);
});

// Detalhe (com signed URL do PDF quando emitido)
router.get("/physio/documents/:docId", async (req, res): Promise<void> => {
  const docId = parseId(req.params.docId);
  if (docId === null) { res.status(400).json({ error: "ID inválido" }); return; }
  const doc = await getOwnedDocument(req.physioId!, docId);
  if (!doc) { res.status(404).json({ error: "Documento não encontrado" }); return; }

  let pdfSignedUrl: string | null = null;
  if (doc.pdfUrl) {
    pdfSignedUrl = await new ObjectStorageService().getSignedGetUrl(doc.pdfUrl, 3600);
  }
  res.json({ ...doc, pdfSignedUrl });
});

// Atualiza (somente não emitido)
router.put("/physio/documents/:docId", async (req, res): Promise<void> => {
  const docId = parseId(req.params.docId);
  if (docId === null) { res.status(400).json({ error: "ID inválido" }); return; }
  const doc = await getOwnedDocument(req.physioId!, docId);
  if (!doc) { res.status(404).json({ error: "Documento não encontrado" }); return; }
  if (doc.lockedAt) {
    res.status(403).json({ error: "Documento emitido é imutável. Crie um novo documento para retificação." });
    return;
  }

  const parsed = UpdateDocBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Dados inválidos" }); return; }

  const updates: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) updates.title = parsed.data.title;
  if (parsed.data.content !== undefined) {
    const contentParsed = CONTENT_SCHEMAS[doc.docType as DocType].safeParse(parsed.data.content);
    if (!contentParsed.success) {
      res.status(400).json({ error: `Conteúdo inválido para ${DOC_TYPE_LABELS[doc.docType as DocType]}` });
      return;
    }
    updates.content = contentParsed.data;
  }
  if (Object.keys(updates).length === 0) { res.json(doc); return; }

  const [updated] = await db.update(physioDocumentsTable)
    .set(updates)
    .where(eq(physioDocumentsTable.id, docId))
    .returning();
  res.json(updated);
});

// Exclui (somente não emitido)
router.delete("/physio/documents/:docId", async (req, res): Promise<void> => {
  const docId = parseId(req.params.docId);
  if (docId === null) { res.status(400).json({ error: "ID inválido" }); return; }
  const doc = await getOwnedDocument(req.physioId!, docId);
  if (!doc) { res.status(404).json({ error: "Documento não encontrado" }); return; }
  if (doc.lockedAt) {
    res.status(403).json({ error: "Documento emitido é imutável e não pode ser excluído." });
    return;
  }
  await db.delete(physioDocumentsTable).where(eq(physioDocumentsTable.id, docId));
  res.status(204).end();
});

// Emissão de laudo/atestado → PDF + lock
router.post("/physio/documents/:docId/emit", async (req, res): Promise<void> => {
  const docId = parseId(req.params.docId);
  if (docId === null) { res.status(400).json({ error: "ID inválido" }); return; }
  const doc = await getOwnedDocument(req.physioId!, docId);
  if (!doc) { res.status(404).json({ error: "Documento não encontrado" }); return; }
  if (doc.docType !== "laudo" && doc.docType !== "atestado") {
    res.status(400).json({ error: "Apenas laudo e atestado podem ser emitidos em PDF." });
    return;
  }
  if (doc.lockedAt) {
    res.status(409).json({ error: "Documento já emitido." });
    return;
  }

  const [physio] = await db.select().from(physiotherapistsTable)
    .where(eq(physiotherapistsTable.id, req.physioId!)).limit(1);
  const [patient] = await db.select().from(physioPatientsTable)
    .where(eq(physioPatientsTable.id, doc.physioPatientId)).limit(1);
  if (!physio || !patient) { res.status(404).json({ error: "Dados não encontrados" }); return; }

  // Laudo: garantir snapshot atualizado na emissão quando ainda vazio
  let content = doc.content as Record<string, unknown>;
  if (doc.docType === "laudo" && !content.dados_objetivos_snapshot) {
    content = { ...content, dados_objetivos_snapshot: await buildObjectiveSnapshot(doc.physioPatientId) };
  }

  const pdf = await generateDocumentPdf({
    docType: doc.docType as DocType,
    title: doc.title,
    content,
    physio: { nome: physio.nome, crefito: physio.crefito, clinica: physio.clinica, cidade: physio.cidade },
    patientName: patient.fullName,
    locale: await getPatientDoctorLocale(patient),
  });

  const objectEntityId = `physio-docs/${req.physioId}/${doc.id}-${Date.now()}.pdf`;
  const pdfUrl = await uploadPrivatePdf(objectEntityId, pdf);

  const [updated] = await db.update(physioDocumentsTable)
    .set({ content, pdfUrl, lockedAt: new Date() })
    .where(and(
      eq(physioDocumentsTable.id, docId),
      eq(physioDocumentsTable.physioId, req.physioId!),
      isNull(physioDocumentsTable.lockedAt),
    ))
    .returning();
  if (!updated) {
    res.status(409).json({ error: "Documento já emitido." });
    return;
  }

  const pdfSignedUrl = await new ObjectStorageService().getSignedGetUrl(pdfUrl, 3600);
  res.json({ ...updated, pdfSignedUrl });
});

export default router;
