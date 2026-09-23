/**
 * Parser GS1 (GS1-128 / DataMatrix) sem dependências.
 * Suporta: (01) GTIN-14, (10) lote, (17) validade AAMMDD, (11) fabricação AAMMDD, (21) série, (240) ID adicional.
 * Aceita formato "human readable" com parênteses e formato cru com separador FNC1/GS (\x1d),
 * com ou sem prefixo de simbologia (]C1, ]d2, ]Q3).
 */

export interface Gs1Result {
  gtin?: string;
  lot?: string;
  serial?: string;
  expiry?: string; // ISO YYYY-MM-DD
  production?: string; // ISO
  additionalId?: string;
  raw: string;
  unknownAIs: string[];
}

export class Gs1ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Gs1ParseError';
  }
}

const GS = '\x1d';

/** AIs de comprimento fixo (sem separador) e variáveis (terminam em GS ou fim). */
const FIXED: Record<string, number> = { '01': 14, '17': 6, '11': 6 };
const VARIABLE: Record<string, number> = { '10': 20, '21': 20, '240': 30 };

export function gtinCheckDigitValid(gtin: string): boolean {
  if (!/^\d{14}$/.test(gtin)) return false;
  const digits = gtin.split('').map(Number);
  const check = digits.pop()!;
  // Da direita para a esquerda (excluindo dígito verificador): pesos 3,1,3,1...
  const sum = digits
    .reverse()
    .reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

function yymmddToIso(v: string, field: string): string {
  if (!/^\d{6}$/.test(v)) throw new Gs1ParseError(`Data inválida em ${field}: ${v}`);
  const yy = Number(v.slice(0, 2));
  const mm = Number(v.slice(2, 4));
  let dd = Number(v.slice(4, 6));
  if (mm < 1 || mm > 12) throw new Gs1ParseError(`Mês inválido em ${field}: ${v}`);
  // Regra GS1 simplificada de século: 00–49 → 20xx; 50–99 → 19xx (suficiente para OPME)
  const year = yy <= 49 ? 2000 + yy : 1900 + yy;
  // DD = 00 significa último dia do mês (GS1 General Specifications)
  if (dd === 0) dd = new Date(Date.UTC(year, mm, 0)).getUTCDate();
  const maxDay = new Date(Date.UTC(year, mm, 0)).getUTCDate();
  if (dd < 1 || dd > maxDay) throw new Gs1ParseError(`Dia inválido em ${field}: ${v}`);
  return `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

function assign(result: Gs1Result, ai: string, value: string): void {
  switch (ai) {
    case '01':
      if (!gtinCheckDigitValid(value)) throw new Gs1ParseError(`GTIN com dígito verificador inválido: ${value}`);
      result.gtin = value;
      break;
    case '10':
      result.lot = value;
      break;
    case '21':
      result.serial = value;
      break;
    case '17':
      result.expiry = yymmddToIso(value, '(17)');
      break;
    case '11':
      result.production = yymmddToIso(value, '(11)');
      break;
    case '240':
      result.additionalId = value;
      break;
    default:
      result.unknownAIs.push(ai);
  }
}

function parseParenthesized(input: string, result: Gs1Result): void {
  const re = /\((\d{2,4})\)([^()]*)/g;
  let m: RegExpExecArray | null;
  let matched = 0;
  while ((m = re.exec(input)) !== null) {
    matched++;
    const ai = m[1];
    const value = m[2].replace(new RegExp(GS, 'g'), '').trim();
    if (FIXED[ai] !== undefined && value.length !== FIXED[ai]) {
      throw new Gs1ParseError(`AI (${ai}) deve ter ${FIXED[ai]} caracteres; recebido ${value.length}.`);
    }
    if (VARIABLE[ai] !== undefined && (value.length === 0 || value.length > VARIABLE[ai])) {
      throw new Gs1ParseError(`AI (${ai}) com comprimento inválido.`);
    }
    assign(result, ai, value);
  }
  if (matched === 0) throw new Gs1ParseError('Nenhum AI encontrado.');
}

function parseRaw(input: string, result: Gs1Result): void {
  let i = 0;
  while (i < input.length) {
    if (input[i] === GS) {
      i++;
      continue;
    }
    const ai2 = input.slice(i, i + 2);
    const ai3 = input.slice(i, i + 3);
    let ai: string;
    if (FIXED[ai2] !== undefined || VARIABLE[ai2] !== undefined) ai = ai2;
    else if (VARIABLE[ai3] !== undefined) ai = ai3;
    else throw new Gs1ParseError(`AI desconhecido/não suportado na posição ${i}: "${input.slice(i, i + 4)}"`);
    i += ai.length;
    if (FIXED[ai] !== undefined) {
      const value = input.slice(i, i + FIXED[ai]);
      if (value.length !== FIXED[ai]) throw new Gs1ParseError(`AI (${ai}) truncado.`);
      assign(result, ai, value);
      i += FIXED[ai];
    } else {
      const end = input.indexOf(GS, i);
      const value = end === -1 ? input.slice(i) : input.slice(i, end);
      if (value.length === 0 || value.length > VARIABLE[ai]) throw new Gs1ParseError(`AI (${ai}) com comprimento inválido.`);
      assign(result, ai, value);
      i = end === -1 ? input.length : end + 1;
    }
  }
}

export function parseGs1(rawInput: string): Gs1Result {
  if (typeof rawInput !== 'string' || rawInput.trim().length === 0) throw new Gs1ParseError('Leitura vazia.');
  const raw = rawInput;
  let s = rawInput.trim().replace(/^\](C1|d2|Q3|e0)/, '');
  const result: Gs1Result = { raw, unknownAIs: [] };
  if (s.includes('(')) parseParenthesized(s, result);
  else parseRaw(s, result);
  return result;
}
