import { Gs1ParseError, gtinCheckDigitValid, parseGs1 } from '../src/clinical/gs1/parser';

const GS = '\x1d';
describe('GS1 parser', () => {
  test('dígito verificador GTIN', () => {
    expect(gtinCheckDigitValid('00012345600012')).toBe(true);
    expect(gtinCheckDigitValid('00888867123458')).toBe(true);
    expect(gtinCheckDigitValid('00888867123459')).toBe(false);
    expect(gtinCheckDigitValid('123')).toBe(false);
  });
  test('formato com parênteses', () => {
    const r = parseGs1('(01)00888867123458(17)281231(10)LOT-A77(21)SN0001');
    expect(r).toMatchObject({ gtin: '00888867123458', expiry: '2028-12-31', lot: 'LOT-A77', serial: 'SN0001' });
  });
  test('formato cru com FNC1/GS e prefixo de simbologia', () => {
    const r = parseGs1(`]d2011076123456789517270630` + `10ABC123${GS}21XYZ9`);
    expect(r).toMatchObject({ gtin: '10761234567895', expiry: '2027-06-30', lot: 'ABC123', serial: 'XYZ9' });
  });
  test('cru: GTIN + validade + lote no fim', () => {
    const r = parseGs1('01107612345678951727063010ABC123');
    expect(r).toMatchObject({ gtin: '10761234567895', expiry: '2027-06-30', lot: 'ABC123' });
  });
  test('cru: lote seguido de série separados por GS', () => {
    const r = parseGs1(`010001234560001210L0T9${GS}21S-42${GS}17300101`);
    expect(r).toMatchObject({ gtin: '00012345600012', lot: 'L0T9', serial: 'S-42', expiry: '2030-01-01' });
  });
  test('validade com dia 00 = último dia do mês', () => {
    expect(parseGs1('(01)07612345678900(17)280200').expiry).toBe('2028-02-29');
  });
  test('data de fabricação (11)', () => {
    expect(parseGs1('(01)07612345678900(11)250115').production).toBe('2025-01-15');
  });
  test('AI (240) e AI desconhecido em parênteses', () => {
    const r = parseGs1('(01)07612345678900(240)REF-99(99)XYZ');
    expect(r.additionalId).toBe('REF-99');
    expect(r.unknownAIs).toEqual(['99']);
  });
  test('raw preservado', () => {
    const s = ' (01)07612345678900(10)A ';
    expect(parseGs1(s).raw).toBe(s);
  });
  test.each([
    ['', /vazia/],
    ['(01)00888867123459', /dígito verificador/],
    ['(01)0088886712345', /14 caracteres/],
    ['(17)281331', /Mês inválido/],
    ['(17)280231', /Dia inválido/],
    ['(17)28AB31', /Data inválida/],
    ['(10)', /comprimento inválido/],
    ['99ABC', /AI desconhecido/],
    ['0100888867', /truncado/],
    ['texto qualquer', /Nenhum AI|AI desconhecido/]
  ])('inválido: %p', (input, msg) => {
    expect(() => parseGs1(input)).toThrow(Gs1ParseError);
    expect(() => parseGs1(input)).toThrow(msg);
  });
});
