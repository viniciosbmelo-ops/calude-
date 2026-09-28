import type { Request, Response, NextFunction } from "express";
import { db, physioPatientsTable, careLinksTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  FREE_PATIENT_LIMIT,
  getPhysio,
  hasActiveSubscription,
  isReadOnly,
  createFisioCheckoutSession,
} from "../lib/physioBilling";

/**
 * Paywall (spec 5.3): 2 pacientes gratuitos LIFETIME. Aplicado em
 * POST /physio/patients e POST /physio/invites/accept.
 * Sem assinatura ativa e contador >= 2 → 402 + checkoutUrl.
 * O convite NUNCA é consumido aqui — o middleware roda antes do handler.
 */
export async function enforcePatientLimit(req: Request, res: Response, next: NextFunction): Promise<void> {
  const physio = await getPhysio(req.physioId!);
  if (!physio) {
    res.status(401).json({ error: "Não autenticado" });
    return;
  }

  if (hasActiveSubscription(physio)) {
    next();
    return;
  }

  // Degradação: past_due/canceled nunca criam pacientes novos.
  if (isReadOnly(physio)) {
    res.status(403).json({
      error: "PLAN_READ_ONLY",
      message:
        physio.subscriptionStatus === "past_due"
          ? "Sua assinatura está com pagamento pendente. Regularize para continuar criando dados."
          : "Sua assinatura foi cancelada. Seus dados continuam disponíveis para leitura.",
    });
    return;
  }

  if (physio.patientsCreatedTotal >= FREE_PATIENT_LIMIT) {
    // Convite no paywall: deep link de retorno preserva o token (?paid=1).
    const inviteToken = typeof req.body?.token === "string" ? req.body.token : undefined;
    let checkoutUrl: string | null = null;
    try {
      checkoutUrl = await createFisioCheckoutSession(physio, req, { inviteToken });
    } catch (err) {
      req.log.error({ err }, "physio paywall: checkout session failed");
    }
    res.status(402).json({
      error: "PLAN_LIMIT_REACHED",
      message:
        "Seus 2 pacientes de teste gratuitos já foram utilizados. " +
        "Assine o plano para adicionar novos pacientes.",
      checkoutUrl,
    });
    return;
  }

  next();
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** POST /physio/patients/:id/assessments — única escrita permitida em past_due. */
const ASSESSMENT_WRITE_RE = /\/physio\/patients\/(\d+)\/assessments\/?$/;

function getAssessmentPatientId(req: Request): number | null {
  if (req.method !== "POST") return null;
  // req.path é relativo ao mount do middleware; originalUrl tem o caminho completo.
  const fullPath = req.originalUrl.split("?")[0] ?? "";
  const match = ASSESSMENT_WRITE_RE.exec(fullPath);
  if (!match?.[1]) return null;
  const id = parseInt(match[1], 10);
  return Number.isNaN(id) ? null : id;
}

/**
 * Degradação por estado da assinatura (spec 1.4):
 * - past_due: somente leitura + avaliações estruturadas de encaminhados ativos
 * - canceled: somente leitura total (guarda legal COFFITO/LGPD — nada é deletado)
 * Aplicar DEPOIS de requirePhysio em todos os routers de escrita do fisio.
 */
export async function physioWriteGuard(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const physio = await getPhysio(req.physioId!);
  if (!physio) {
    res.status(401).json({ error: "Não autenticado" });
    return;
  }

  if (!isReadOnly(physio)) {
    next();
    return;
  }

  const assessmentPatientId = getAssessmentPatientId(req);
  if (physio.subscriptionStatus === "past_due" && assessmentPatientId !== null) {
    // Permitido apenas para encaminhados com care_link ativo.
    const patientId = assessmentPatientId;
    {
      const [row] = await db
        .select({ careLinkId: physioPatientsTable.careLinkId })
        .from(physioPatientsTable)
        .where(and(eq(physioPatientsTable.id, patientId), eq(physioPatientsTable.physioId, physio.id)))
        .limit(1);
      if (row?.careLinkId) {
        const [link] = await db
          .select({ status: careLinksTable.status })
          .from(careLinksTable)
          .where(eq(careLinksTable.id, row.careLinkId))
          .limit(1);
        if (link?.status === "active") {
          next();
          return;
        }
      }
    }
  }

  res.status(403).json({
    error: "PLAN_READ_ONLY",
    message:
      physio.subscriptionStatus === "past_due"
        ? "Sua assinatura está com pagamento pendente. Enquanto isso, sua conta está em modo somente leitura (avaliações de pacientes encaminhados continuam liberadas)."
        : "Sua assinatura foi cancelada. Seus dados continuam disponíveis para leitura (guarda do prontuário), mas não é possível criar ou editar registros.",
  });
}
