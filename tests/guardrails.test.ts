import * as path from 'path';
import { scan } from '../scripts/check-forbidden-terms';

test('nenhum termo de recomendação em textos exibidos ao usuário', () => {
  expect(scan(path.join(__dirname, '..'))).toEqual([]);
});
