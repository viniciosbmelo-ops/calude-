/**
 * Erro de guarda clínica — mesma semântica do DocKnee.
 * Lançado quando um input clínico é implausível; a UI mostra a mensagem e NÃO calcula.
 */
export class ClinicalGuardError extends Error {
  readonly code: string;
  readonly field?: string;
  constructor(code: string, message: string, field?: string) {
    super(message);
    this.name = 'ClinicalGuardError';
    this.code = code;
    this.field = field;
  }
}

/** Arredondamento half-up determinístico (evita 1.005 → 1.00 do toFixed). */
export function round(value: number, decimals = 1): number {
  const f = Math.pow(10, decimals);
  return Math.round((value + Number.EPSILON) * f) / f;
}

export function assertFinite(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ClinicalGuardError('NOT_A_NUMBER', `Campo "${field}" ausente ou não numérico.`, field);
  }
}
