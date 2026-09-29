/**
 * Guarda de produto: o núcleo documenta, não indica conduta.
 * Falha o build se termos de recomendação aparecerem em textos exibidos ao usuário.
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Apoio à decisão (desenho em ARQUITETURA.md, D10): a guarda NÃO abre exceção. Estes caminhos passam
 * pelos mesmos termos proibidos e, além disso, por termos de prescrição específicos, porque ali o texto
 * precisa ser de sugestão: "Sugestão", "a literatura favorece", "cautela", "força da sugestão".
 */
export const DECISION_ROOTS = [
  'lib/clinical/src/decision',
  'artifacts/api-server/src/routes/decision-support.ts',
  'artifacts/docknee/src/locales/decision-support.ts',
  'artifacts/docknee/src/components/shoulder/decision',
  'artifacts/docknee/src/pages/apoio-decisao'
];
const DECISION_FORBIDDEN = [
  /indica[çc](ão|ões|ao|oes)\b/i, /\bindic(ar|a-se|amos|ando)\b/i, /contraindica/i,
  /tratamento de escolha/i, /padr[ãa]o[- ]ouro/i, /\bprescrev/i, /\bprescri[çc]/i,
  /\brecommend/i, /\bindicat(ed|ion)/i
];
/** Vocabulário do apoio à decisão: o rótulo fixo de toda saída precisa ser exatamente "Sugestão". */
const DECISION_VOCAB = 'lib/clinical/src/decision/vocab.ts';
const DECISION_LABEL_RE = /ROTULO_SUGESTAO\s*=\s*'Sugestão'/;

// Caminhos relativos à raiz do monorepo: núcleo clínico + telas/rotas de ombro e cotovelo
const ROOTS = [
  'lib/clinical/src/instability',
  'lib/clinical/src/report/templates.ts',
  'lib/clinical/src/labels.pt.json',
  'artifacts/docknee/src/components/shoulder',
  'artifacts/docknee/src/pages/surgeries/shoulder',
  'artifacts/docknee/src/locales/surgery-shoulder.ts',
  'artifacts/api-server/src/routes/shoulder-surgeries.ts',
  ...DECISION_ROOTS
];
const FORBIDDEN = [/indicad[oa]s?\b/i, /recomend/i, /sugere-se/i, /deve(-se)? realizar/i, /conduta ideal/i, /melhor opção/i];

function files(p: string): string[] {
  if (!fs.existsSync(p)) return [];
  if (fs.statSync(p).isFile()) return [p];
  return fs.readdirSync(p).flatMap((f) => files(path.join(p, f)));
}

export function scan(root = path.resolve(HERE, '..', '..', '..')): string[] {
  const hits: string[] = [];
  const decisionFiles = new Set(DECISION_ROOTS.flatMap((r) => files(path.join(root, r))));
  const seen = new Set<string>();
  for (const r of ROOTS) {
    for (const f of files(path.join(root, r))) {
      if (seen.has(f)) continue;
      seen.add(f);
      const terms = decisionFiles.has(f) ? [...FORBIDDEN, ...DECISION_FORBIDDEN] : FORBIDDEN;
      fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        // Comentários de código com referência bibliográfica são permitidos
        if (/^\s*(\*|\/\/)/.test(line)) return;
        if (terms.some((re) => re.test(line))) hits.push(`${path.relative(root, f)}:${i + 1}: ${line.trim()}`);
      });
    }
  }
  const vocab = path.join(root, DECISION_VOCAB);
  if (fs.existsSync(path.join(root, 'lib/clinical/src/decision'))
    && (!fs.existsSync(vocab) || !DECISION_LABEL_RE.test(fs.readFileSync(vocab, 'utf8')))) {
    hits.push(`${DECISION_VOCAB}: rótulo fixo ROTULO_SUGESTAO = 'Sugestão' ausente ou alterado`);
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
