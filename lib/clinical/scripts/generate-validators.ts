/**
 * Gera validadores ajv PRÉ-COMPILADOS (standalone) para o navegador.
 * Motivo: a CSP de produção do app (script-src 'self', sem 'unsafe-eval') impede o ajv de
 * compilar schemas em tempo de execução. Sem isto, o formulário funcionaria em desenvolvimento
 * (CSP permissiva) e quebraria em produção.
 * Saída: src/generated/validators.js — o teste test/validators.test.ts falha se estiver desatualizado.
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import standaloneCode from 'ajv/dist/standalone';
import { _ } from 'ajv';
import { buildAjv } from '../src/ajvShared';
import { ALL_SCHEMAS } from '../src/schemas';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const OUT = path.join(HERE, '..', 'src', 'generated', 'validators.js');

export function generateValidators(): string {
  const ajv = buildAjv({ code: { source: true, esm: true, formats: _`fmts` } });
  const ids: Record<string, string> = {};
  for (const s of ALL_SCHEMAS) {
    ajv.addSchema(structuredClone(s));
    const id = (s as { $id: string }).$id;
    ids[id.replace(/[^A-Za-z0-9]/g, '_')] = id;
  }
  // O standalone ainda emite require() para funções de runtime do ajv; converte em import (ESM)
  const imports = new Map<string, string>();
  const code = standaloneCode(ajv, ids).replace(/require\("([^"]+)"\)\.default/g, (_m, mod: string) => {
    if (!imports.has(mod)) imports.set(mod, `rt${imports.size}`);
    return imports.get(mod)!;
  });
  const importLines = [...imports].map(([mod, name]) => `import ${name} from "${mod}";`).join('\n');
  const map = Object.entries(ids).map(([k, id]) => `  ${JSON.stringify(id)}: ${k}`).join(',\n');
  return `// GERADO por lib/clinical/scripts/generate-validators.ts — não editar.\n/* eslint-disable */\nimport { fullFormats as fmts } from "ajv-formats/dist/formats";\n${importLines}\n${code}\nexport const validators = {\n${map}\n};\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  fs.writeFileSync(OUT, generateValidators());
  fs.writeFileSync(OUT.replace(/\.js$/, '.d.ts'), 'export declare const validators: Record<string, ((data: unknown) => boolean) & { errors?: import("ajv").ErrorObject[] | null }>;\n');
  console.log(`validadores gerados em ${path.relative(process.cwd(), OUT)}`);
}
