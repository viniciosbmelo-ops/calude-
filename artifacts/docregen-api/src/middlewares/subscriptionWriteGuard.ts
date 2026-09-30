import type { NextFunction, Request, Response } from "express";
import { requireDoctorOrSecretary } from "./requireAuth";
import { resolveStoredSubscriptionAccess } from "../lib/subscriptionAccess";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * These writes either establish a session/billing or are patient/public
 * data-entry flows. Every
 * other unsafe API request is a doctor product mutation and must be billed.
 */
const EXEMPT_MUTATION_PATHS: readonly RegExp[] = [
  /^\/(?:health|auth|secretary-auth)(?:\/|$)/,
  /^\/stripe(?:\/|$)/,
  /^\/analytics(?:\/|$)/,
  /^\/stats(?:\/|$)/,
  /^\/admin\/contact\/?$/,
  /^\/patient(?:\/|$)/,
  /^\/pre-consult\/[^/]+\/(?:verify|answers|submit|uploads\/request-url|attachments)\/?$/,
];

function isExemptMutation(req: Request): boolean {
  const path = (req.path || req.originalUrl.split("?")[0] || "").replace(/^\/regen-api(?=\/)/, "");
  if (EXEMPT_MUTATION_PATHS.some((pattern) => pattern.test(path))) return true;

  // Recording (or revoking) the doctor's own acceptance of the terms of use is
  // a legal/LGPD record, not paid clinical data. The register page posts it
  // right after sign-up, before any subscription exists.
  if (req.method === "POST" && /^\/lgpd\/consentimento\/?$/.test(path)) return true;

  // Language is an account preference needed for localized billing/support,
  // not paid clinical data. Keep every other profile field behind the gate.
  if (req.method === "PATCH" && /^\/doctors\/\d+\/?$/.test(path)) {
    const body = req.body;
    return (
      body !== null
      && typeof body === "object"
      && !Array.isArray(body)
      && Object.keys(body).length === 1
      && Object.prototype.hasOwnProperty.call(body, "idioma")
    );
  }

  return false;
}

function denyUnavailable(res: Response, message: string): void {
  res.status(503).json({
    error: "SUBSCRIPTION_STATUS_UNAVAILABLE",
    message,
  });
}

function denyRequired(res: Response): void {
  res.status(403).json({
    error: "SUBSCRIPTION_WRITE_REQUIRED",
    message: "Sua assinatura não permite alterações no momento.",
  });
}

/**
 * Global server-side enforcement for paid doctor mutations. It deliberately
 * leaves reads and explicitly public, support/auth, and billing flows alone.
 */
export function subscriptionWriteGuard(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method) || isExemptMutation(req)) {
    next();
    return;
  }

  requireDoctorOrSecretary(req, res, () => {
    void (async () => {
      const decision = await resolveStoredSubscriptionAccess(req.doctorId!);
      if (decision.httpStatus === 503) {
        denyUnavailable(res, decision.body.error ?? "Não foi possível verificar sua assinatura. Tente novamente.");
        return;
      }
      if (decision.httpStatus !== 200 || !decision.body.canWrite) {
        denyRequired(res);
        return;
      }
      next();
    })().catch((error: unknown) => {
      req.log.warn({ err: error }, "subscription write guard failed closed");
      denyUnavailable(res, "Não foi possível verificar sua assinatura. Tente novamente.");
    });
  });
}