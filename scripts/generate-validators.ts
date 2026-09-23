/**
 * Gera validadores ajv PRÉ-COMPILADOS (standalone) para o navegador.
 * Motivo: a CSP do app proíbe eval, que o ajv usa para compilar schemas em tempo de execução.
 * Saída: web/src/generated/validators.js — regenerar sempre que um schema mudar (o build faz isso;
 * o teste tests/validators.test.ts falha se o arquivo estiver desatualizado).
 */
import * as fs from 'fs';
import * as path from 'path';
import { buildAjv } from '../src/clinical/ajvShared';
import standaloneCode from 'ajv/dist/standalone';
import { _ } from 'ajv';

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'src', 'clinical', 'schemas');

export function generateValidators(): string {
  // Mesma configuração do servidor, com geração de código
  const ajv = buildAjv({ code: { source: true, esm: true, formats: _`fmts` } });
  const ids: Record<string, string> = {};
  for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.json')).sort()) {
    const s = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    ajv.addSchema(s);
    ids[s.$id.replace(/[^A-Za-z0-9]/g, '_')] = s.$id;
  }
  // O standalone ainda emite require() para funções de runtime; converte para import (ESM do Vite)
  const imports = new Map<string, string>();
  const code = standaloneCode(ajv, ids).replace(/require\("([^"]+)"\)\.default/g, (_m, mod: string) => {
    if (!imports.has(mod)) imports.set(mod, `rt${imports.size}`);
    return imports.get(mod)!;
  });
  const importLines = [...imports].map(([mod, name]) => `import ${name} from "${mod}";`).join('\n');
  const exportsMap = Object.entries(ids).map(([k, id]) => `  ${JSON.stringify(id)}: ${k}`).join(',\n');
  return `// GERADO por scripts/generate-validators.ts — não editar.\n/* eslint-disable */\nimport { fullFormats as fmts } from "ajv-formats/dist/formats";\n${importLines}\n${code}\nexport const validators = {\n${exportsMap}\n};\n`;
}

if (require.main === module) {
  const out = path.join(ROOT, 'web', 'src', 'generated', 'validators.js');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, generateValidators());
  fs.writeFileSync(out.replace(/\.js$/, '.d.ts'), `export declare const validators: Record<string, ((data: unknown) => boolean) & { errors?: any[] | null }>;\n`);
  console.log(`validadores gerados em ${path.relative(ROOT, out)}`);
}
