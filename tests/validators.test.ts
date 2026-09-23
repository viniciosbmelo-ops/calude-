import * as fs from 'fs';
import * as path from 'path';
import { generateValidators } from '../scripts/generate-validators';

test('validadores pré-compilados do navegador estão em dia com os schemas', () => {
  const file = path.join(__dirname, '..', 'web', 'src', 'generated', 'validators.js');
  expect(fs.readFileSync(file, 'utf8')).toBe(generateValidators());
});
