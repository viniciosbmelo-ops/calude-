/** Gera db/seeds/002_pathology_catalog.sql a partir de src/clinical/catalog/pathologies.ts */
import { PATHOLOGIES } from '../src/clinical/catalog/pathologies';

const q = (s?: string) => (s === undefined ? 'NULL' : `'${s.replace(/'/g, "''")}'`);
const arr = (a?: string[]) => (a && a.length ? `ARRAY[${a.map(q).join(',')}]::text[]` : `'{}'::text[]`);

// Pais antes dos filhos (FK parent_code)
const ordered = [...PATHOLOGIES].sort((a, b) => Number(!!a.parent) - Number(!!b.parent));

const lines = [
  '-- Gerado automaticamente por scripts/generate-seed.ts — NÃO editar à mão',
  'BEGIN;',
  ...ordered.map(
    (p) =>
      `INSERT INTO public.pathology_catalog (code, region, name_pt, parent_code, schema_version, diagnosis_schema_id, intraop_schema_id, report_template, default_protocol_code, proms_default)\n` +
      `VALUES (${q(p.code)}, ${q(p.region)}, ${q(p.name_pt)}, ${q(p.parent)}, 1, ${q(p.diagnosis)}, ${q(p.intraop)}, ${q(p.report_template)}, ${q(p.default_protocol_code)}, ${arr(p.proms_default)})\n` +
      `ON CONFLICT (code) DO UPDATE SET name_pt = EXCLUDED.name_pt, parent_code = EXCLUDED.parent_code, diagnosis_schema_id = EXCLUDED.diagnosis_schema_id, intraop_schema_id = EXCLUDED.intraop_schema_id, report_template = EXCLUDED.report_template, default_protocol_code = EXCLUDED.default_protocol_code, proms_default = EXCLUDED.proms_default;`
  ),
  'COMMIT;',
  ''
];
process.stdout.write(lines.join('\n'));
