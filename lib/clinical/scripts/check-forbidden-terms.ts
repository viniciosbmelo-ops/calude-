/**
 * Guarda de produto: o núcleo documenta, não indica conduta.
 * Falha o build se termos de recomendação aparecerem em textos exibidos ao usuário.
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Caminhos relativos à raiz do monorepo: núcleo clínico + telas/rotas de ombro e cotovelo
const ROOTS = [
  'lib/clinical/src/instability',
  'lib/clinical/src/report/templates.ts',
  'lib/clinical/src/labels.pt.json',
  'artifacts/docknee/src/components/shoulder',
  'artifacts/docknee/src/pages/surgeries/shoulder',
  'artifacts/api-server/src/routes/shoulder-surgeries.ts'
];
const FORBIDDEN = [/indicad[oa]s?\b/i, /recomend/i, /sugere-se/i, /deve(-se)? realizar/i, /conduta ideal/i, /melhor opção/i];

function files(p: string): string[] {
  if (!fs.existsSync(p)) return [];
  if (fs.statSync(p).isFile()) return [p];
  return fs.readdirSync(p).flatMap((f) => files(path.join(p, f)));
}

export function scan(root = path.resolve(HERE, '..', '..', '..')): string[] {
  const hits: string[] = [];
  for (const r of ROOTS) {
    for (const f of files(path.join(root, r))) {
      fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        // Comentários de código com referência bibliográfica são permitidos
        if (/^\s*(\*|\/\/)/.test(line)) return;
        for (const re of FORBIDDEN) if (re.test(line)) hits.push(`${path.relative(root, f)}:${i + 1}: ${line.trim()}`);
      });
    }
  }
  return hits;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const hits = scan();
  if (hits.length) {
    console.error('Termos de recomendação encontrados:\n' + hits.join('\n'));
    process.exit(1);
  }
  console.log('OK — nenhum termo de recomendação.');
}
