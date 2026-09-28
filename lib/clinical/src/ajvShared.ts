/**
 * Configuração ÚNICA do ajv (servidor e gerador dos validadores do navegador).
 */
import Ajv2020, { Options } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

export * from './ajvMessages';

export function buildAjv(extra: Options = {}): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: false, ...extra });
  addFormats(ajv);
  // Anotações de UI — ignoradas na validação, lidas pelo renderer de formulário
  for (const kw of ['x-ui', 'x-label', 'x-note', 'x-example']) ajv.addKeyword({ keyword: kw, schemaType: ['string'] });
  return ajv;
}

