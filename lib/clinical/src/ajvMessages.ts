/**
 * Tradução de erros do ajv para PT-BR. Sem dependência do compilador (usável no navegador).
 */
import type { ErrorObject } from 'ajv/dist/2020';

export interface ValidationIssue {
  field: string;
  message_pt: string;
  keyword: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export function fieldOf(e: ErrorObject): string {
  const base = e.instancePath.replace(/^\//, '').replace(/\//g, '.');
  if (e.keyword === 'required') {
    const missing = (e.params as { missingProperty: string }).missingProperty;
    return base ? `${base}.${missing}` : missing;
  }
  if (e.keyword === 'additionalProperties') {
    const extra = (e.params as { additionalProperty: string }).additionalProperty;
    return base ? `${base}.${extra}` : extra;
  }
  return base || '(raiz)';
}

export function messagePt(e: ErrorObject): string {
  const p = e.params as Record<string, unknown>;
  switch (e.keyword) {
    case 'required':
      return 'Campo obrigatório não preenchido.';
    case 'enum':
      return `Valor não permitido. Opções: ${(p.allowedValues as unknown[]).join(', ')}.`;
    case 'minimum':
      return `Valor abaixo do mínimo (${p.limit}).`;
    case 'maximum':
      return `Valor acima do máximo (${p.limit}).`;
    case 'type':
      return `Tipo inválido (esperado ${p.type}).`;
    case 'additionalProperties':
      return 'Campo não previsto no formulário desta patologia.';
    case 'minItems':
      return `Selecione pelo menos ${p.limit} item(ns).`;
    case 'uniqueItems':
      return 'Itens duplicados.';
    case 'maxLength':
      return `Texto excede ${p.limit} caracteres.`;
    case 'pattern':
      return 'Formato inválido.';
    case 'format':
      return `Formato inválido (${p.format}).`;
    default:
      return e.message ?? 'Valor inválido.';
  }
}

/** Converte erros do ajv em pendências em PT-BR (sem ruído de if/then, sem duplicatas). */
export function toIssues(errors: ErrorObject[] | null | undefined): ValidationIssue[] {
  const issues = (errors ?? [])
    .filter((e) => e.keyword !== 'if')
    .map((e) => ({ field: fieldOf(e), keyword: e.keyword, message_pt: messagePt(e) }));
  return [...new Map(issues.map((i) => [`${i.field}|${i.keyword}`, i])).values()];
}
