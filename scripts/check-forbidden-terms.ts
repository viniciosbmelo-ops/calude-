/**
 * Guarda de produto: o núcleo documenta, não indica conduta.
 * Falha o build se termos de recomendação aparecerem em textos exibidos ao usuário.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOTS = ['server', 'web/src', 'src/clinical/instability', 'src/clinical/report/templates', 'src/clinical/labels.pt.json'];
const FORBIDDEN = [/indicad[oa]s?\b/i, /recomend/i, /sugere-se/i, /deve(-se)? realizar/i, /conduta ideal/i, /melhor opção/i];

function files(p: string): string[] {
  if (!fs.existsSync(p)) return [];
  if (fs.statSync(p).isFile()) return [p];
  return fs.readdirSync(p).flatMap((f) => files(path.join(p, f)));
}

export function scan(root = process.cwd()): string[] {
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

if (require.main === module) {
  const hits = scan();
  if (hits.length) {
    console.error('Termos de recomendação encontrados:\n' + hits.join('\n'));
    process.exit(1);
  }
  console.log('OK — nenhum termo de recomendação.');
}
