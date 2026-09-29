import { Request, Response, NextFunction } from "express";
import { verifyToken, type AuthTokenPayload } from "../lib/auth";
import { validateCurrentAccount } from "../lib/sessionAccountStore";
import { recordSecurityEvent } from "../lib/securityMonitor";
import { getSessionCookie, type SessionRole } from "../lib/session";

declare global {
  namespace Express {
    interface Request {
      doctorId?: number;
      isAdmin?: boolean;
      secretaryId?: number;
      role?: AuthTokenPayload["role"];
    }
  }
}

function getBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  return token.length > 0 ? token : null;
}

function assignPayload(req: Request, payload: AuthTokenPayload): void {
  req.role = payload.role;
  req.isAdmin = payload.role === "doctor" ? payload.isAdmin : false;
  req.doctorId =
    payload.role === "doctor" || payload.role === "secretary"
      ? payload.doctorId
      : undefined;
  req.secretaryId = payload.role === "secretary" ? payload.secretaryId : undefined;
}

async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
  allowedRoles: readonly SessionRole[],
): Promise<void> {
  const candidates = [
    ...allowedRoles.map((role) => getSessionCookie(req, role)),
    getBearerToken(req),
  ].filter((token): token is string => Boolean(token));

  for (const token of candidates) {
    const payload = verifyToken(token);
    if (payload && allowedRoles.includes(payload.role)) {
      const currentPayload = await validateCurrentAccount(payload);
      if (!currentPayload) continue;
      assignPayload(req, currentPayload);
      next();
      return;
    }
  }

  if (candidates.length === 0) {
    const isSessionProbe = /\/(?:auth|secretary-auth)\/me(?:\?|$)/.test(
      req.originalUrl,
    );
    if (!isSessionProbe) {
      recordSecurityEvent("forbidden", `${req.method} ${req.originalUrl} — sem sessão`);
    }
    res.status(401).json({ error: "Não autenticado" });
  } else {
    recordSecurityEvent("auth_failure", `${req.method} ${req.originalUrl} — token inválido/expirado`);
    res.status(401).json({ error: "Token inválido ou expirado" });
  }
}

// Doctor-side auth. Secretary access must be explicitly granted with
// requireDoctorOrSecretary so a shared session never inherits doctor-only routes.
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  void authenticate(req, res, () => {
    if (!req.doctorId) {
      res.status(403).json({ error: "Acesso negado." });
      return;
    }
    next();
  }, ["doctor"]).catch(next);
}

export function optionalDoctorAuth(req: Request, res: Response, next: NextFunction): void {
  void (async () => {
    const token = getSessionCookie(req, "doctor") ?? getBearerToken(req);
    if (!token) {
      next();
      return;
    }

    const payload = verifyToken(token);
    const currentPayload =
      payload?.role === "doctor" ? await validateCurrentAccount(payload) : null;
    if (!currentPayload) {
      recordSecurityEvent("auth_failure", `${req.method} ${req.originalUrl} — sessão opcional inválida`);
      res.status(401).json({ error: "Token inválido ou expirado" });
      return;
    }

    assignPayload(req, currentPayload);
    next();
  })().catch(next);
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (!req.isAdmin) {
      res.status(403).json({ error: "Acesso negado. Somente administradores." });
      return;
    }
    next();
  });
}

export function requireSecretary(req: Request, res: Response, next: NextFunction): void {
  void authenticate(req, res, () => {
    if (req.role !== "secretary") {
      res.status(403).json({ error: "Acesso negado. Somente secretárias." });
      return;
    }
    next();
  }, ["secretary"]).catch(next);
}

export function requireDoctorOrSecretary(req: Request, res: Response, next: NextFunction): void {
  void authenticate(req, res, () => {
    if (!req.doctorId) {
      res.status(403).json({ error: "Acesso negado." });
      return;
    }
    next();
  }, ["doctor", "secretary"]).catch(next);
}
