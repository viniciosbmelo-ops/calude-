import type { NextFunction, Request, Response } from 'express';
import { ClinicalGuardError, Gs1ParseError } from '../src/clinical';

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
  }
}

export const notFound = (what = 'Recurso') => new HttpError(404, 'NOT_FOUND', `${what} não encontrado.`);
export const badRequest = (message: string, details?: unknown) => new HttpError(400, 'BAD_REQUEST', message, details);

/** Envolve handlers async para que erros cheguem ao errorHandler (Express 4). */
export const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

/**
 * Tradução de erros do Postgres:
 *  23514 (check_violation, triggers do núcleo) → 422 com a mensagem do banco (já em PT-BR)
 *  42501 (RLS/insufficient_privilege)          → 404, para não vazar existência de dados alheios
 *  23505 (unique)                              → 409
 *  23503 (FK)                                  → 422
 */
export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) });
  }
  if (err instanceof ClinicalGuardError) {
    return res.status(422).json({ error: 'CLINICAL_GUARD', code: err.code, field: err.field, message: err.message });
  }
  if (err instanceof Gs1ParseError) {
    return res.status(422).json({ error: 'GS1_INVALID', message: err.message });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'BAD_JSON', message: 'JSON inválido.' });
  }
  switch (err?.code) {
    case '23514':
      return res.status(422).json({ error: 'INTEGRITY_RULE', message: err.message });
    case '42501':
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Recurso não encontrado.' });
    case '23505':
      return res.status(409).json({ error: 'CONFLICT', message: 'Conflito de concorrência — recarregue e tente de novo.' });
    case '23503':
      return res.status(422).json({ error: 'INVALID_REFERENCE', message: 'Referência inválida.' });
    case '22P02':
    case '22007':
    case '22008':
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'Valor em formato inválido.' });
  }
  // eslint-disable-next-line no-console
  console.error(err);
  return res.status(500).json({ error: 'INTERNAL', message: 'Erro interno.' });
}
