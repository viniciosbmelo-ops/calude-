/**
 * Autenticação por JWT do Supabase. Aceita os dois modos:
 *  - legado: HS256 com o segredo do projeto (SUPABASE_JWT_SECRET)
 *  - chaves assimétricas (ES256/RS256) verificadas pelo JWKS do projeto
 *    (${SUPABASE_URL}/auth/v1/.well-known/jwks.json)
 * O algoritmo do token decide o caminho; "none" e algoritmos não listados são recusados.
 */
import type { NextFunction, Request, Response } from 'express';
import { createRemoteJWKSet, decodeProtectedHeader, JWTPayload, jwtVerify } from 'jose';
import { AuthUser, isUuid } from './db';

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

export interface AuthConfig {
  secret?: string;
  jwksUrl?: string;
}

export function createVerifier(c: AuthConfig): (token: string) => Promise<JWTPayload> {
  if (c.secret !== undefined && c.secret.length < 32) throw new Error('SUPABASE_JWT_SECRET curto demais');
  if (!c.secret && !c.jwksUrl) throw new Error('Configure SUPABASE_JWT_SECRET e/ou SUPABASE_URL (JWKS)');
  const key = c.secret ? new TextEncoder().encode(c.secret) : undefined;
  const jwks = c.jwksUrl ? createRemoteJWKSet(new URL(c.jwksUrl), { cooldownDuration: 30_000, cacheMaxAge: 10 * 60_000 }) : undefined;
  return async (token) => {
    const { alg } = decodeProtectedHeader(token);
    if (alg === 'HS256') {
      if (!key) throw new Error('HS256 não habilitado');
      return (await jwtVerify(token, key, { algorithms: ['HS256'], audience: 'authenticated' })).payload;
    }
    if (!jwks) throw new Error('JWKS não configurado');
    return (await jwtVerify(token, jwks, { algorithms: ['ES256', 'RS256', 'EdDSA'], audience: 'authenticated' })).payload;
  };
}

export function requireAuth(c: AuthConfig) {
  const verify = createVerifier(c);
  return (req: Request, res: Response, next: NextFunction) => {
    const m = /^Bearer (.+)$/.exec(req.header('authorization') ?? '');
    if (!m) return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Token ausente.' });
    verify(m[1])
      .then((claims) => {
        if (!isUuid(claims.sub) || claims.role !== 'authenticated') throw new Error('claims inválidas');
        req.user = { id: claims.sub, claims: claims as Record<string, unknown> };
        next();
      })
      .catch(() => res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Token inválido ou expirado.' }));
  };
}

export function userOf(req: Request): AuthUser {
  if (!req.user) throw new Error('requireAuth não aplicado');
  return req.user;
}
