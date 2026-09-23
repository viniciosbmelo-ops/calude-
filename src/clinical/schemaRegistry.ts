/**
 * Registro de schemas por patologia (JSON Schema draft 2020-12, validado com ajv).
 * Uso no Express:  router.post('/procedures', validateAgainstSchema(req => `${req.body.pathology_code}.intraop.v${req.body.schema_version}`), handler)
 */
import Ajv2020, { ErrorObject, ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import * as fs from 'fs';
import * as path from 'path';

export interface ValidationIssue {
  field: string;
  message_pt: string;
  keyword: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

const SCHEMA_DIR = path.join(__dirname, 'schemas');

function buildAjv(): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: false });
  addFormats(ajv);
  // Anotações de UI — ignoradas na validação, lidas pelo renderer de formulário
  for (const kw of ['x-ui', 'x-label', 'x-note', 'x-example']) ajv.addKeyword({ keyword: kw, schemaType: ['string'] });
  return ajv;
}

function fieldOf(e: ErrorObject): string {
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

function messagePt(e: ErrorObject): string {
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

export class SchemaRegistry {
  private readonly ajv = buildAjv();
  private readonly validators = new Map<string, ValidateFunction>();
  private readonly raw = new Map<string, Record<string, unknown>>();

  constructor(dir: string = SCHEMA_DIR) {
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const schema = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      this.register(schema);
    }
  }

  register(schema: Record<string, unknown>): void {
    const id = schema.$id as string;
    if (!id) throw new Error('Schema sem $id');
    if (this.validators.has(id)) throw new Error(`Schema duplicado: ${id}`);
    this.validators.set(id, this.ajv.compile(schema));
    this.raw.set(id, schema);
  }

  ids(): string[] {
    return [...this.validators.keys()].sort();
  }

  get(id: string): Record<string, unknown> | undefined {
    return this.raw.get(id);
  }

  validate(id: string, data: unknown): ValidationResult {
    const v = this.validators.get(id);
    if (!v) return { valid: false, issues: [{ field: '(schema)', keyword: 'schema', message_pt: `Schema não encontrado: ${id}` }] };
    const valid = v(data) as boolean;
    if (valid) return { valid: true, issues: [] };
    // Remove ruído de if/then (o erro real já vem no 'required' correspondente)
    const issues = (v.errors ?? [])
      .filter((e) => e.keyword !== 'if')
      .map((e) => ({ field: fieldOf(e), keyword: e.keyword, message_pt: messagePt(e) }));
    const dedup = new Map(issues.map((i) => [`${i.field}|${i.keyword}`, i]));
    return { valid: false, issues: [...dedup.values()] };
  }
}

/** Middleware Express genérico (sem importar express para manter o núcleo desacoplado). */
export function validateAgainstSchema(registry: SchemaRegistry, idFromReq: (req: any) => string) {
  return (req: any, res: any, next: any) => {
    const id = idFromReq(req);
    const r = registry.validate(id, req.body?.data);
    if (!r.valid) return res.status(422).json({ error: 'VALIDATION_FAILED', schema: id, issues: r.issues });
    next();
  };
}
