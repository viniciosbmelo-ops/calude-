import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  calcularCunha,
  ClinicalGuardError,
  resolverBase,
  buildAnguloCorrigido,
  type AnguloCorrigido,
  type BaseCalibrada,
  type CunhaAbsoluto,
  type CunhaFaixa,
  type CunhaParametrico,
} from '../cunha';
import { decidirNivel } from '../level-decision';
import { anguloMiniaciDFO } from '../dfo-geometry';

// ── Helpers ──────────────────────────────────────────────────────────────────

const angOk = (osso: 'femur' | 'tibia', v: number): AnguloCorrigido =>
  ({ valorDeg: v, osso, jlcaAplicado: true, jloVerificado: true, travadoPorJLO: false, origem: 'geometrico' });

const baseCal: BaseCalibrada = { modo: 'CALIBRADO', L_mm: 81.5, base_mm: 71.5 };
const baseCalMarcador: BaseCalibrada = { modo: 'CALIBRADO', L_mm: 81.5, base_mm: 71.5, calibradoPorMarcador: true };
const baseFaixa: BaseCalibrada = { modo: 'FAIXA', L_mm: null, base_mm: null, faixa_mm: [58, 70] };
const baseParam: BaseCalibrada = { modo: 'PARAMETRICO', L_mm: null, base_mm: null };

// ── Proibição de Math.tan (lint em teste) ─────────────────────────────────────

describe('Integridade do módulo cunha.ts', () => {
  it('proíbe Math.tan em cunha.ts (lint-in-test)', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../cunha.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/Math\.tan\b/);
  });

  it('usa Math.sin na fórmula da corda', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../cunha.ts'), 'utf8');
    expect(src).toMatch(/Math\.sin/);
  });
});

// ── Trava Clínica ─────────────────────────────────────────────────────────────

describe('Trava clínica da cunha', () => {
  it('recusa ângulo sem JLCA', () => {
    expect(() => calcularCunha({ ...angOk('femur', 10), jlcaAplicado: false }, baseCal)).toThrow(ClinicalGuardError);
  });
  it('recusa ângulo sem verificação de JLO', () => {
    expect(() => calcularCunha({ ...angOk('femur', 10), jloVerificado: false }, baseCal)).toThrow(ClinicalGuardError);
  });
  it('recusa opção travada por JLO', () => {
    expect(() => calcularCunha({ ...angOk('femur', 11), travadoPorJLO: true }, baseCal)).toThrow(ClinicalGuardError);
  });
  it('lança ClinicalGuardError (não Error genérico)', () => {
    try {
      calcularCunha({ ...angOk('femur', 10), jlcaAplicado: false }, baseCal);
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(ClinicalGuardError);
    }
  });
});

// ── Fórmula da Corda — golden tests ──────────────────────────────────────────

describe('Fórmula da corda exata', () => {
  it('golden: 71,5 mm @ 10° ≈ 12,46 mm (2·71,5·sin(5°))', () => {
    const r = calcularCunha(angOk('femur', 10), baseCal) as CunhaAbsoluto;
    expect(r.abertura).toBeCloseTo(12.46, 1);
  });

  it('golden: NÃO usa tan — 11° com base 71,5 mm → ~13,71 mm (não 13,9 mm de tan)', () => {
    const r = calcularCunha(angOk('femur', 11), baseCal) as CunhaAbsoluto;
    expect(r.abertura).toBeCloseTo(13.71, 1);
    expect(r.abertura).toBeLessThan(13.9); // tan daria ~13,9 mm
  });

  it('fator k = 2·sin(α/2)', () => {
    const r = calcularCunha(angOk('femur', 10), baseCal) as CunhaAbsoluto;
    expect(r.fator).toBeCloseTo(2 * Math.sin((10 * Math.PI) / 180 / 2), 4);
  });
});

// ── Banda de Incerteza (Prompt 4) ─────────────────────────────────────────────

describe('Banda de incerteza — modo ABSOLUTO', () => {
  it('sem marcador: incerteza ±12%, banda inclui abertura', () => {
    const r = calcularCunha(angOk('femur', 10), baseCal) as CunhaAbsoluto;
    expect(r.modo).toBe('ABSOLUTO');
    expect(r.incertezaPct).toBe(12);
    expect(r.banda).toHaveLength(2);
    expect(r.banda[0]).toBeLessThan(r.abertura);
    expect(r.banda[1]).toBeGreaterThan(r.abertura);
    // banda[0] ≈ abertura * 0.88; banda[1] ≈ abertura * 1.12
    expect(r.banda[0]).toBeCloseTo(r.abertura * 0.88, 0);
    expect(r.banda[1]).toBeCloseTo(r.abertura * 1.12, 0);
  });

  it('com marcador: incerteza ±5%', () => {
    const r = calcularCunha(angOk('femur', 10), baseCalMarcador) as CunhaAbsoluto;
    expect(r.incertezaPct).toBe(5);
    expect(r.banda[0]).toBeCloseTo(r.abertura * 0.95, 0);
    expect(r.banda[1]).toBeCloseTo(r.abertura * 1.05, 0);
    expect(r.alerta).toBeNull(); // sem alerta quando marcador presente
  });

  it('sem marcador: alerta não-nulo', () => {
    const r = calcularCunha(angOk('femur', 10), baseCal) as CunhaAbsoluto;
    expect(r.alerta).toBeTruthy();
    expect(typeof r.alerta).toBe('string');
  });

  it('nunca exibe abertura sem banda — abertura e banda sempre presentes juntas', () => {
    const r = calcularCunha(angOk('femur', 10), baseCal) as CunhaAbsoluto;
    expect(r.abertura).toBeDefined();
    expect(r.banda).toBeDefined();
    expect(r.banda[0]).toBeLessThanOrEqual(r.banda[1]);
  });
});

// ── Modos de Base ─────────────────────────────────────────────────────────────

describe('Modos de BaseCalibrada', () => {
  it('PARAMETRICO: instrução c/ fator k, sem mm inventado', () => {
    const r = calcularCunha(angOk('femur', 10), baseParam) as CunhaParametrico;
    expect(r.modo).toBe('PARAMETRICO');
    expect((r as any).abertura).toBeUndefined();
    expect(r.instrucao).toMatch(/base_medida_mm/);
    expect(r.fator).toBeGreaterThan(0);
  });

  it('FAIXA: intervalo [min, max] com alerta e sem ponto único', () => {
    const r = calcularCunha(angOk('femur', 10), baseFaixa) as CunhaFaixa;
    expect(r.modo).toBe('FAIXA');
    expect(r.faixa).toHaveLength(2);
    expect(r.faixa[0]).toBeLessThan(r.faixa[1]);
    expect((r as any).abertura).toBeUndefined();
    expect(r.alerta).toBeTruthy(); // FAIXA sempre traz alerta
  });

  it('FAIXA fêmur @ 6,4°: intervalo esperado ~6,5–7,8 mm', () => {
    // caso real paciente misto: fêmur 6,4°, base anatômica [58,70]
    const r = calcularCunha(
      angOk('femur', 6.4),
      { modo: 'FAIXA', L_mm: null, base_mm: null, faixa_mm: [58, 70] },
    ) as CunhaFaixa;
    expect(r.faixa[0]).toBeCloseTo(6.5, 0);
    expect(r.faixa[1]).toBeCloseTo(7.8, 0);
  });

  it('FAIXA tíbia @ 4,4°: intervalo razoável', () => {
    const r = calcularCunha(
      angOk('tibia', 4.4),
      { modo: 'FAIXA', L_mm: null, base_mm: null, faixa_mm: [55, 68] },
    ) as CunhaFaixa;
    expect(r.faixa[0]).toBeGreaterThan(3);
    expect(r.faixa[1]).toBeLessThan(8);
  });
});

// ── resolverBase ─────────────────────────────────────────────────────────────

describe('resolverBase', () => {
  it('sem marcação → FAIXA anatômica para fêmur', () => {
    const b = resolverBase(null, 'femur', null);
    expect(b.modo).toBe('FAIXA');
    expect(b.faixa_mm).toEqual([68, 80]);
  });
  it('sem marcação → FAIXA anatômica para tíbia', () => {
    const b = resolverBase(null, 'tibia', null);
    expect(b.modo).toBe('FAIXA');
    expect(b.faixa_mm).toEqual([65, 78]);
  });
  it('com marcação e mmPorPixel → CALIBRADO com base_mm correto', () => {
    const m = { entrada: { x: 0, y: 0 }, charneira: { x: 100, y: 0 } };
    const b = resolverBase(m, 'femur', 0.5); // 100px × 0.5 = 50mm, base=40mm
    expect(b.modo).toBe('CALIBRADO');
    expect(b.L_mm).toBeCloseTo(50, 1);
    expect(b.base_mm).toBeCloseTo(40, 1);
  });
  it('com marcação mas sem mmPorPixel → PARAMETRICO', () => {
    const m = { entrada: { x: 0, y: 0 }, charneira: { x: 100, y: 0 } };
    expect(resolverBase(m, 'femur', null).modo).toBe('PARAMETRICO');
  });
  it('repassa calibradoPorMarcador para BaseCalibrada', () => {
    const m = { entrada: { x: 0, y: 0 }, charneira: { x: 100, y: 0 } };
    const b = resolverBase(m, 'femur', 0.5, 1.0, 10, true);
    expect(b.calibradoPorMarcador).toBe(true);
  });
});

// ── Motor de Nível — caso-regressão (valgo misto, JLCA 4°) ───────────────────

describe('Caso misto — motor de nível', () => {
  it('caso clínico: mLDFA 83,7°, MPTA 90° escolhe somente nível femoral', () => {
    const d = decidirNivel(83.7, 90, 0);
    expect(d.femAbn).toBe(true);
    expect(d.tibAbn).toBe(false);
    expect(d.primaryClass).toBe('SINGLE_FEMORAL');
    expect(d.opcoes.filter(o => o.recomendada)).toHaveLength(1);
    expect(d.opcoes.find(o => o.recomendada)?.id).toBe('FEMORAL_ANATOMICA');
  });

  it('considera os limites 84° e 90° normais', () => {
    const d = decidirNivel(84, 90, 0);
    expect(d.femAbn).toBe(false);
    expect(d.tibAbn).toBe(false);
    expect(d.primaryClass).toBe('WITHIN_NORMAL');
  });

  it('classifica como DOUBLE_LEVEL (mLDFA=80,6°, MPTA=91,4°)', () => {
    expect(decidirNivel(80.6, 91.4, 1).primaryClass).toBe('DOUBLE_LEVEL');
  });
  it('ambos femAbn e tibAbn true', () => {
    const d = decidirNivel(80.6, 91.4, 1);
    expect(d.femAbn).toBe(true);
    expect(d.tibAbn).toBe(true);
  });
  it('Duplo Nível recomendado e não bloqueado', () => {
    const d = decidirNivel(80.6, 91.4, 1);
    const duplo = d.opcoes.find(o => o.id === 'DUPLO_NIVEL')!;
    expect(duplo.recomendada).toBe(true);
    expect(duplo.locked).toBe(false);
    expect(duplo.jlo).toBe(0);
  });
  it('FEMORAL_HKA_NEUTRO sem ajuste JLCA trava por JLO >4°', () => {
    const d = decidirNivel(80.6, 91.4, 0);
    expect(d.opcoes.find(o => o.id === 'FEMORAL_HKA_NEUTRO')!.locked).toBe(true);
  });
  it('mantém Duplo Nível disponível quando a tíbia está no limite inferior normal', () => {
    // Regressão: varo grave corrigido só no fêmur levaria mLDFA abaixo de 84°.
    // Mesmo com MPTA=84° (limite inferior), o cirurgião deve poder distribuir
    // a correção entre fêmur e tíbia para manter os dois ângulos equilibrados.
    const d = decidirNivel(94, 84, 0);
    const duplo = d.opcoes.find(o => o.id === 'DUPLO_NIVEL')!;
    expect(d.primaryClass).toBe('SINGLE_FEMORAL');
    expect(duplo.recomendada).toBe(false);
    expect(duplo.locked).toBe(false);
    expect(duplo.postFem).toBe(87);
    expect(duplo.postTib).toBe(87);
  });
  it('output correto do pipeline completo (duplo nível + corda exata + faixa)', () => {
    // Duplo nível: fêmur 6,4° @ faixa 58–70mm → cunha 6,5–7,8 mm
    const d   = decidirNivel(80.6, 91.4, 1);
    const op  = d.opcoes.find(o => o.id === 'DUPLO_NIVEL')!;
    const ang = buildAnguloCorrigido(Math.abs(op.corrFem), 'femur', false, 'paley_fallback');
    const r   = calcularCunha(ang, { modo: 'FAIXA', L_mm: null, base_mm: null, faixa_mm: [58, 70] }) as CunhaFaixa;
    expect(r.modo).toBe('FAIXA');
    expect(r.faixa[0]).toBeGreaterThan(6);
    expect(r.faixa[1]).toBeLessThan(9);
    // garante que NÃO seria o valor 13,9 mm (femoral único sem JLCA por tan)
    expect(r.faixa[1]).toBeLessThan(13.9);
  });
});

// ── anguloMiniaciDFO — geometria ─────────────────────────────────────────────

describe('anguloMiniaciDFO', () => {
  const H = { x: 300, y: 50 }, A = { x: 310, y: 900 };
  const G = { x: 400, y: 700 }, T = { x: 350, y: 650 };
  it('retorna ângulo > 0 e < 30° para config válida', () => {
    const a = anguloMiniaciDFO(H, A, G, T);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(30);
  });
  it('é determinístico', () => {
    expect(anguloMiniaciDFO(H, A, G, T)).toBe(anguloMiniaciDFO(H, A, G, T));
  });
});

// ── buildAnguloCorrigido ─────────────────────────────────────────────────────

describe('buildAnguloCorrigido', () => {
  it('sempre sela jlcaAplicado + jloVerificado = true', () => {
    const a = buildAnguloCorrigido(10, 'femur', false, 'geometrico');
    expect(a.jlcaAplicado).toBe(true);
    expect(a.jloVerificado).toBe(true);
  });
  it('travadoPorJLO=true bloqueia calcularCunha', () => {
    const locked = buildAnguloCorrigido(10, 'femur', true, 'geometrico');
    expect(() => calcularCunha(locked, baseCal)).toThrow(ClinicalGuardError);
  });
});
