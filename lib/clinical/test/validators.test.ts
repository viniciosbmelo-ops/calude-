import { test, expect } from 'vitest';
import * as fs from 'fs';
import { OUT, generateValidators } from '../scripts/generate-validators';
import { ALL_SCHEMAS } from '../src/schemas';
import { SchemaRegistry } from '../src/schemaRegistry';
import { toIssues } from '../src/ajvMessages';
import { multiProcedure } from './fixtures';

test('validadores do navegador estão em dia com os schemas (rode: pnpm --filter @workspace/clinical gen)', () => {
  expect(fs.readFileSync(OUT, 'utf8')).toBe(generateValidators());
});

test('validador pré-compilado dá o mesmo resultado que o do servidor', async () => {
  const { validators } = await import('../src/generated/validators.js');
  const reg = new SchemaRegistry();
  const samples: [string, unknown][] = [
    ['SH_RCT.intraop.v1', multiProcedure.procedures.find((p) => p.pathology_code === 'SH_RCT_FULL')!.data],
    ['SH_RCT.intraop.v1', { tendons: ['SSC'], tear_type: 'full_thickness' }],
    ['CORE_SURGERY.v1', { surgery_date: '2026-13-40', side: 'X' }]
  ];
  expect(Object.keys(validators).sort()).toEqual(ALL_SCHEMAS.map((s) => (s as any).$id).sort());
  for (const [id, data] of samples) {
    const v = validators[id];
    const client = v(data) ? [] : toIssues(v.errors);
    expect(client).toEqual(reg.validate(id, data).issues);
  }
});
