/**
 * Autenticação por JWT do Supabase (HS256, segredo do projeto em SUPABASE_JWT_SECRET).
 * Projetos com chaves assimétricas (JWKS) devem trocar `verify` por uma verificação via JWKS.
 */
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { AuthUser, isUuid } from './db';

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

export function requireAuth(secret: string) {
  if (!secret || secret.length < 32) throw new Error('SUPABASE_JWT_SECRET ausente ou curto demais');
  return (req: Request, res: Response, next: NextFunction) => {
    const m = /^Bearer (.+)$/.exec(req.header('authorization') ?? '');
    if (!m) return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Token ausente.' });
    try {
      const claims = jwt.verify(m[1], secret, { algorithms: ['HS256'], audience: 'authenticated' }) as jwt.JwtPayload;
      if (!isUuid(claims.sub) || claims.role !== 'authenticated') throw new Error('claims inválidas');
      req.user = { id: claims.sub, claims };
      next();
    } catch {
      return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Token inválido ou expirado.' });
    }
  };
}

export function userOf(req: Request): AuthUser {
  if (!req.user) throw new Error('requireAuth não aplicado');
  return req.user;
}
