import * as fs from 'fs';
import * as path from 'path';
import labels from '../src/clinical/labels.pt.json';

const fields = (labels as any)._fields as Record<string, string>;
const dir = path.join(__dirname, '..', 'src', 'clinical', 'schemas');

function names(s: any, out: Set<string>): Set<string> {
  if (s && typeof s === 'object') {
    for (const [k, v] of Object.entries(s.properties ?? {})) { out.add(k); names(v, out); }
    if (s.items) names(s.items, out);
    for (const x of s.allOf ?? []) names(x.then ?? {}, out);
  }
  return out;
}

test('todo campo de schema tem rótulo em _fields (formulário sem texto hardcoded)', () => {
  const all = new Set<string>();
  for (const f of fs.readdirSync(dir)) names(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), all);
  expect([...all].filter((n) => !fields[n])).toEqual([]);
});
