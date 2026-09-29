import { test, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { scan, DECISION_ROOTS } from '../scripts/check-forbidden-terms';

test('nenhum termo de recomendação em textos exibidos ao usuário', () => {
  expect(scan()).toEqual([]);
});

function fakeRoot(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-'));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  return root;
}

const VOCAB_OK = "export const ROTULO_SUGESTAO = 'Sugestão' as const;\n";

test('apoio à decisão: caminhos do motor, da rota e das telas futuras estão na guarda', () => {
  expect(DECISION_ROOTS).toEqual(expect.arrayContaining([
    'lib/clinical/src/decision',
    'artifacts/api-server/src/routes/decision-support.ts',
    'artifacts/docknee/src/locales/decision-support.ts',
  ]));
});

test('apoio à decisão: termos de prescrição são barrados só nos caminhos de decisão', () => {
  const root = fakeRoot({
    'lib/clinical/src/decision/vocab.ts': VOCAB_OK,
    'lib/clinical/src/decision/x.ts': "const a = 'Indicação cirúrgica';\nconst b = 'tratamento de escolha';\n// indicação em comentário é permitida\n",
    'artifacts/api-server/src/routes/decision-support.ts': "res.json({ error: 'Recommended option' });\n",
    'lib/clinical/src/instability/y.ts': "const c = 'Indicação';\n",
  });
  const hits = scan(root);
  expect(hits).toHaveLength(3);
  expect(hits.join('\n')).toMatch(/decision\/x\.ts:1/);
  expect(hits.join('\n')).toMatch(/decision\/x\.ts:2/);
  expect(hits.join('\n')).toMatch(/decision-support\.ts:1/);
});

test('apoio à decisão: termos já proibidos continuam proibidos ali ("indicado", "recomendado")', () => {
  const root = fakeRoot({
    'lib/clinical/src/decision/vocab.ts': VOCAB_OK,
    'lib/clinical/src/decision/x.ts': "const a = 'Fortemente recomendado';\nconst b = 'contraindicado';\n",
  });
  expect(scan(root)).toHaveLength(2);
});

test('apoio à decisão: rótulo fixo "Sugestão" é obrigatório', () => {
  const root = fakeRoot({ 'lib/clinical/src/decision/vocab.ts': "export const ROTULO_SUGESTAO = 'Resultado' as const;\n" });
  expect(scan(root)).toEqual([expect.stringMatching(/ROTULO_SUGESTAO/)]);
});
