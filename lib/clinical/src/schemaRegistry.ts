/**
 * Registro de schemas por patologia (JSON Schema draft 2020-12, validado com ajv).
 * Uso no Express:  router.post('/procedures', validateAgainstSchema(req => `${req.body.pathology_code}.intraop.v${req.body.schema_version}`), handler)
 */
import { ValidateFunction } from 'ajv/dist/2020';
import { ValidationResult, buildAjv, toIssues } from './ajvShared';
import { ALL_SCHEMAS } from './schemas';

export type { ValidationIssue, ValidationResult } from './ajvShared';

export class SchemaRegistry {
  private readonly ajv = buildAjv();
  private readonly validators = new Map<string, ValidateFunction>();
  private readonly raw = new Map<string, Record<string, unknown>>();

  constructor(schemas: Record<string, unknown>[] = ALL_SCHEMAS) {
    for (const schema of schemas) this.register(structuredClone(schema));
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
    return { valid: false, issues: toIssues(v.errors) };
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
