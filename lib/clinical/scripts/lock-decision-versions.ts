/**
 * Regenera src/decision/versions.lock.json a partir dos algoritmos registrados.
 * Uso explícito, depois de mudar a versão de um algoritmo:
 *   pnpm --filter @workspace/clinical run lock:decision
 * Entradas de versões já existentes nunca são sobrescritas: conteúdo novo exige versão nova.
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { DECISION_ALGORITHMS } from '../src/decision/registry';
import { algorithmKey, hashDefinition } from '../src/decision/hash';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOCK_PATH = path.resolve(HERE, '..', 'src', 'decision', 'versions.lock.json');

const atual = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8')) as Record<string, string>;
const novo: Record<string, string> = { ...atual };
const conflitos: string[] = [];
for (const def of DECISION_ALGORITHMS) {
  const key = algorithmKey(def);
  const h = hashDefinition(def);
  if (atual[key] && atual[key] !== h) conflitos.push(key);
  else novo[key] = h;
}
if (conflitos.length) {
  console.error(`Conteúdo alterado sem nova versão: ${conflitos.join(', ')}. Suba a versão do algoritmo.`);
  process.exit(1);
}
const ordenado = Object.fromEntries(Object.keys(novo).sort().map((k) => [k, novo[k]]));
fs.writeFileSync(LOCK_PATH, JSON.stringify(ordenado, null, 2) + '\n');
console.log(`versions.lock.json: ${Object.keys(ordenado).length} versão(ões).`);
