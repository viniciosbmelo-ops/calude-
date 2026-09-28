import { test, expect } from 'vitest';
import { scan } from '../scripts/check-forbidden-terms';

test('nenhum termo de recomendação em textos exibidos ao usuário', () => {
  expect(scan()).toEqual([]);
});
