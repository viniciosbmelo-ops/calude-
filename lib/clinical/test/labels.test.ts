import { test, expect } from 'vitest';
import { ALL_SCHEMAS } from '../src/schemas';
import labels from '../src/labels.pt.json';

const fields = (labels as any)._fields as Record<string, string>;

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
  for (const s of ALL_SCHEMAS) names(s, all);
  expect([...all].filter((n) => !fields[n])).toEqual([]);
});
