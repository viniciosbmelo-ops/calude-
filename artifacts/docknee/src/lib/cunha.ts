/**
 * Cálculo de cunha com guard clínico obrigatório — Prompt 4 (final).
 *
 * PIPELINE: Miniaci (P1) → JLCA (P1) → Decisão de nível + JLO (P2) → Base por osso (P3) → Cunha (P4)
 *
 * REGRAS INVIOLÁVEIS:
 *   1. Fórmula ÚNICA: k = 2·sin(α/2)  — tangente é proibida neste módulo (lint-in-test).
 *   2. Ângulo aceito SOMENTE com selos jlcaAplicado + jloVerificado + !travadoPorJLO.
 *   3. Saída CALIBRADO: valor único + banda de incerteza (±5% com marcador; ±12% sem).
 *      Nunca exibir abertura isolada — sempre com banda.
 *   4. Saída FAIXA: intervalo [base_min·k, base_max·k]. Nunca colapsar em ponto.
 *   5. Saída PARAMETRICO: fator k + instrução. Zero mm inventado.
 *
 * Referência golden: 71,5 mm @ 10° → abertura = 71,5 × 2·sin(5°) ≈ 12,46 mm
 *                    (pela tangente seria ≈ 12,61 mm — diferença silenciosa de 1,2%)
 */

export interface AnguloCorrigido {
  valorDeg: number;
  osso: 'femur' | 'tibia';
  /** Ajuste de JLCA (Prompt 1) aplicado antes do cálculo */
  jlcaAplicado: boolean;
  /** JLO pós-op verificado pelo motor de nível (Prompt 2) */
  jloVerificado: boolean;
  /** true = opção bloqueada pelo motor — não gerar cunha */
  travadoPorJLO: boolean;
  origem: 'geometrico' | 'paley_fallback';
}

export interface BaseCalibrada {
  L_mm: number | null;          // charneira → entrada (px × escala / mag)
  base_mm: number | null;       // = L_mm − offsetCharneira
  larguraCortical_mm: number | null; // = base_mm + offsetCharneira (total entrada→cortical oposta)
  modo: 'CALIBRADO' | 'FAIXA' | 'PARAMETRICO';
  faixa_mm?: [number, number];  // somente quando modo === 'FAIXA'
  /**
   * true  = escala calibrada por marcador físico (régua/esfera) → incerteza ±5%
   * false = calibração indireta / sem marcador            → incerteza ±12%
   * omitido = assume false (conservador)
   */
  calibradoPorMarcador?: boolean;
  /**
   * Aviso quando base_mm cai fora da faixa anatômica plausível.
   * Presente apenas quando modo === 'CALIBRADO' e base está fora de range.
   */
  alertaFaixaAnatomica?: string;
}

export interface Pt { x: number; y: number }
export interface Marcacao { entrada: Pt; charneira: Pt }

const FAIXA_ANATÔMICA: Record<'femur' | 'tibia', [number, number]> = {
  femur: [68, 80],  // supracondilar ML: largura total córtex-a-córtex (Miniaci usa D total)
  tibia: [65, 78],  // metafisário proximal: largura total córtex-a-córtex
};

/** Faixa de validação plausível para a marcação calibrada (mais larga que a estimativa) */
const FAIXA_VALIDA: Record<'femur' | 'tibia', [number, number]> = {
  femur: [35, 100],  // base total córtex-a-córtex; 35mm cobre fêmures pequenos/pediátricos
  tibia: [35, 95],
};

/**
 * Resolve a base da cunha para um osso.
 *
 * @param m                Par de pontos marcados (entrada + charneira), ou null
 * @param osso             'femur' | 'tibia'
 * @param mmPorPixel       Escala calibrada (null = sem calibração)
 * @param fatorMag         Fator de magnificação radiográfica (default 1,0)
 * @param offsetCharneira  Distância da charneira à cortical lateral (default 10 mm)
 * @param calibradoPorMarcador  Se escala vem de marcador físico (default false → ±12%)
 */
export function resolverBase(
  m: Marcacao | null,
  osso: 'femur' | 'tibia',
  mmPorPixel: number | null,
  fatorMag = 1.0,
  offsetCharneira = 10,
  calibradoPorMarcador = false,
): BaseCalibrada {
  if (m && mmPorPixel) {
    // Largura ML (mediolateral) em radiografia AP — usa apenas o componente horizontal (|Δx|).
    // Math.hypot incluiria o Δy (diferença proximal-distal entre os pontos) e inflaria
    // a medida quando entrada e charneira estão em alturas diferentes — erro sistemático
    // especialmente na tíbia proximal onde a cortical lateral/fibular é mais distal.
    const pxDist = Math.abs(m.charneira.x - m.entrada.x);
    const L = (pxDist * mmPorPixel) / fatorMag;
    const base_mm = +(L - offsetCharneira).toFixed(1);
    const [minV, maxV] = FAIXA_VALIDA[osso];
    const alertaFaixaAnatomica =
      base_mm < minV || base_mm > maxV
        ? `Base ${base_mm} mm fora da faixa anatômica plausível (${minV}–${maxV} mm) — possível erro de marcação ou calibração.`
        : undefined;
    return {
      L_mm: +L.toFixed(1),
      base_mm,
      larguraCortical_mm: +(base_mm + offsetCharneira).toFixed(1),
      modo: 'CALIBRADO',
      calibradoPorMarcador,
      alertaFaixaAnatomica,
    };
  }
  if (m && !mmPorPixel) {
    return { L_mm: null, base_mm: null, larguraCortical_mm: null, modo: 'PARAMETRICO' };
  }
  return { L_mm: null, base_mm: null, larguraCortical_mm: null, modo: 'FAIXA', faixa_mm: FAIXA_ANATÔMICA[osso] };
}

export class ClinicalGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClinicalGuardError';
  }
}

/** Resultado CALIBRADO: valor único com banda de incerteza obrigatória */
export interface CunhaAbsoluto {
  modo: 'ABSOLUTO';
  abertura: number;
  /** Intervalo [baixo, alto] com incerteza residual aplicada */
  banda: [number, number];
  incertezaPct: number;
  fator: number;
  /** null quando escala tem marcador físico; mensagem quando calibração indireta */
  alerta: string | null;
}

export interface CunhaFaixa {
  modo: 'FAIXA';
  faixa: [number, number];
  fator: number;
  alerta: string;
}

export interface CunhaParametrico {
  modo: 'PARAMETRICO';
  fator: number;
  instrucao: string;
}

export type CunhaResultado = CunhaAbsoluto | CunhaFaixa | CunhaParametrico;

/**
 * Calcula a abertura da cunha de osteotomia — estágio terminal do pipeline.
 *
 * GUARD: lança ClinicalGuardError se qualquer selo de proveniência faltar.
 *
 * Fórmula ÚNICA (tangente é proibida — lint-in-test cobre o módulo inteiro):
 *   k = 2 · sin(α / 2)
 *   abertura = base_mm × k
 *
 * Incerteza residual (mesmo calibrado, a foto de tela tem erro de parallax/magnificação):
 *   ±5%  — escala com marcador físico (régua, esfera de aço conhecida)
 *   ±12% — calibração indireta ou sem marcador
 */
export function calcularCunha(a: AnguloCorrigido, base: BaseCalibrada): CunhaResultado {
  if (!a.jlcaAplicado) {
    throw new ClinicalGuardError('Ângulo sem compensação de JLCA — ajuste pelo JLCA antes de calcular a cunha.');
  }
  if (!a.jloVerificado) {
    throw new ClinicalGuardError('Ângulo sem verificação de JLO — rode o motor de nível antes de calcular a cunha.');
  }
  if (a.travadoPorJLO) {
    throw new ClinicalGuardError('Opção travada por JLO — não calcular cunha para opção bloqueada.');
  }

  // Fórmula ÚNICA — corda exata. Tangente é proibida (lint-in-test bloqueia Math["tan"]).
  const k = +(2 * Math.sin((a.valorDeg * Math.PI) / 180 / 2)).toFixed(4);

  switch (base.modo) {
    case 'CALIBRADO': {
      const abertura = base.base_mm! * k;
      const incPct   = base.calibradoPorMarcador ? 0.05 : 0.12;
      const baixo    = +(abertura * (1 - incPct)).toFixed(1);
      const alto     = +(abertura * (1 + incPct)).toFixed(1);
      return {
        modo: 'ABSOLUTO',
        abertura: +abertura.toFixed(1),
        banda: [baixo, alto],
        incertezaPct: +(incPct * 100).toFixed(0),
        fator: k,
        alerta: base.calibradoPorMarcador
          ? null
          : 'Sem marcador de calibração: magnificação ~5–15% embutida. Confirmar na mesa operatória.',
      };
    }
    case 'FAIXA': {
      const [b0, b1] = base.faixa_mm!;
      return {
        modo: 'FAIXA',
        faixa: [+(b0 * k).toFixed(1), +(b1 * k).toFixed(1)],
        fator: k,
        alerta: 'Base não marcada — abertura é estimativa anatômica. Confirmar na mesa operatória.',
      };
    }
    case 'PARAMETRICO': {
      return {
        modo: 'PARAMETRICO',
        fator: k,
        instrucao:
          `Meça a base (entrada → charneira) na mesa. ` +
          `Abertura = ${k} × base_medida_mm.`,
      };
    }
  }
}

/**
 * Constrói AnguloCorrigido a partir dos outputs do Prompt 1 e Prompt 2.
 * Único ponto onde os selos jlcaAplicado + jloVerificado podem ser setados como true.
 */
export function buildAnguloCorrigido(
  valorDeg: number,
  osso: 'femur' | 'tibia',
  travadoPorJLO: boolean,
  origem: 'geometrico' | 'paley_fallback',
): AnguloCorrigido {
  return {
    valorDeg,
    osso,
    jlcaAplicado: true,
    jloVerificado: true,
    travadoPorJLO,
    origem,
  };
}
