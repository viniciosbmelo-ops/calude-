/**
 * Motor de decisão de nível (DFO / HTO / Duplo)
 *
 * Implementa as regras da literatura com limiares fixos:
 *   - Sautet P, Ollivier M. Arthrosc Tech 2022 [PMID 35782844]
 *   - Mabrouk A et al. Knee Surg Relat Res / J Exp Orthop 2025 [PMC12070550]
 *   - Comparing double-level osteotomies in severe valgus/varus. [PMC12075348]
 *
 * Nota: os limiares JLO_LIMIT (4°) e MPTA_MAX (94°) provêm majoritariamente
 * de séries de varo. Para cenários de valgo a direção do risco inverte
 * (perigo principal: mLDFA >90°, não MPTA >94°), mas a lógica de
 * "não empurrar o osso cortado para fora de 87 ± 3°" é simétrica e
 * sustentada pela ref 3 em casos de valgo.
 */

export const NORMAL_DEG   = 87;
export const TOL_DEG      = 3;
export const JLO_LIMIT    = 4;   // °  cisalhamento excessivo na cartilagem (ref 1, 2)
export const MPTA_MAX_DEG = 94;  // °  hipercorreção tibial (ref 1, 2)

export type OpcaoId =
  | 'DUPLO_NIVEL'
  | 'FEMORAL_ANATOMICA'
  | 'FEMORAL_HKA_NEUTRO'
  | 'TIBIAL_ANATOMICA';

export interface OpcaoNivel {
  id: OpcaoId;
  label: string;
  corrFem: number;
  corrTib: number;
  postFem: number;
  postTib: number;
  jlo: number;
  locked: boolean;
  lockReason?: string;
  recomendada: boolean;
  residualHKA?: number;
  nota: string;
}

export interface NivelDecisaoResult {
  mLDFA: number;
  MPTA: number;
  ajusteJLCA: number;
  femAbn: boolean;
  tibAbn: boolean;
  primaryClass: 'DOUBLE_LEVEL' | 'SINGLE_FEMORAL' | 'SINGLE_TIBIAL' | 'WITHIN_NORMAL';
  opcoes: OpcaoNivel[];
}

function simularJLO(
  anguloOsso: number,
  corr: number,
  osso: 'femur' | 'tibia',
): { post: number; jlo: number; locked: boolean; lockReason?: string } {
  const post   = +( anguloOsso + corr ).toFixed(1);
  const jloDeg = +Math.abs(post - NORMAL_DEG).toFixed(1);
  let locked     = false;
  let lockReason: string | undefined;

  if (jloDeg > JLO_LIMIT) {
    locked     = true;
    lockReason = `${osso === 'femur' ? 'mLDFA' : 'MPTA'} pós-op ${post}° → JLO ${jloDeg}° (>${JLO_LIMIT}°) — cisalhamento excessivo na cartilagem (Sautet/Ollivier 2022)`;
  }
  if (osso === 'tibia' && post > MPTA_MAX_DEG) {
    locked     = true;
    lockReason = `MPTA pós-op ${post}° > ${MPTA_MAX_DEG}° — hipercorreção tibial (Sautet/Ollivier 2022)`;
  }
  return { post, jlo: jloDeg, locked, lockReason };
}

/**
 * Calcula todas as opções de nível para o caso dado.
 *
 * @param mLDFA     mLDFA medido em graus
 * @param MPTA      MPTA medido em graus
 * @param ajusteJLCA graus a subtrair da correção total (Prompt 1 — escalonado por faixa de JLCA)
 */
export function decidirNivel(
  mLDFA: number,
  MPTA: number,
  ajusteJLCA: number,
): NivelDecisaoResult {
  const femAbn = Math.abs(mLDFA - NORMAL_DEG) > TOL_DEG;
  const tibAbn = Math.abs(MPTA  - NORMAL_DEG) > TOL_DEG;

  const corrFem  = +( NORMAL_DEG - mLDFA ).toFixed(1);
  const corrTib  = +( NORMAL_DEG - MPTA  ).toFixed(1);
  const corrHKA  = +( corrFem + corrTib  ).toFixed(1);

  const opcoes: OpcaoNivel[] = [];

  // ── A) DUPLO NÍVEL — cada osso ao seu normal ───────────────────────────────
  opcoes.push({
    id: 'DUPLO_NIVEL',
    label: 'Duplo Nível (DFO + HTO)',
    corrFem,
    corrTib,
    postFem: NORMAL_DEG,
    postTib: NORMAL_DEG,
    jlo: 0,
    locked: false,
    recomendada: femAbn && tibAbn,
    nota: 'Corrige onde a deformidade está. Linha articular horizontal. JLO = 0°. (Sautet/Ollivier 2022)',
  });

  // ── B) FEMORAL ANATÔMICA — só o fêmur; deixa resíduo tibial ───────────────
  const b = simularJLO(mLDFA, corrFem, 'femur');
  opcoes.push({
    id: 'FEMORAL_ANATOMICA',
    label: 'Femoral Anatômica (DFO)',
    corrFem,
    corrTib: 0,
    postFem: b.post,
    postTib: +MPTA.toFixed(1),
    jlo: b.jlo,
    locked: b.locked,
    lockReason: b.lockReason,
    recomendada: femAbn && !tibAbn,
    residualHKA: +Math.abs(corrTib).toFixed(1),
    nota: `Restaura mLDFA→${NORMAL_DEG}°. Resíduo de ~${Math.abs(corrTib).toFixed(1)}° no HKA (tíbia não tocada).`,
  });

  // ── C) FEMORAL P/ HKA NEUTRO — hipercorrege fêmur c/ compensação JLCA ─────
  //   ajusteJLCA já vem calculado pelo Prompt 1 (escalonado por faixa)
  const cCorr = +( corrHKA - ajusteJLCA ).toFixed(1);
  const c     = simularJLO(mLDFA, cCorr, 'femur');
  opcoes.push({
    id: 'FEMORAL_HKA_NEUTRO',
    label: 'Femoral p/ HKA Neutro (DFO)',
    corrFem: cCorr,
    corrTib: 0,
    postFem: c.post,
    postTib: +MPTA.toFixed(1),
    jlo: c.jlo,
    locked: c.locked,
    lockReason: c.lockReason,
    recomendada: false,
    nota: c.locked
      ? `BLOQUEADA: mLDFA pós-op ${c.post}° → JLO ${c.jlo}° (>${JLO_LIMIT}°). Hipercorrege o fêmur.`
      : `Neutraliza o HKA num só nível. mLDFA pós-op ${c.post}° (hipercorreção femoral).`,
  });

  // ── D) TIBIAL ANATÔMICA — só a tíbia; deixa resíduo femoral ──────────────
  if (tibAbn) {
    const d = simularJLO(MPTA, corrTib, 'tibia');
    opcoes.push({
      id: 'TIBIAL_ANATOMICA',
      label: 'Tibial Anatômica (HTO)',
      corrFem: 0,
      corrTib,
      postFem: +mLDFA.toFixed(1),
      postTib: d.post,
      jlo: d.jlo,
      locked: d.locked,
      lockReason: d.lockReason,
      recomendada: !femAbn && tibAbn,
      residualHKA: +Math.abs(corrFem).toFixed(1),
      nota: `Restaura MPTA→${NORMAL_DEG}°. Resíduo de ~${Math.abs(corrFem).toFixed(1)}° no HKA (fêmur não tocado).`,
    });
  }

  const primaryClass: NivelDecisaoResult['primaryClass'] =
    femAbn && tibAbn ? 'DOUBLE_LEVEL'
    : femAbn         ? 'SINGLE_FEMORAL'
    : tibAbn         ? 'SINGLE_TIBIAL'
    :                  'WITHIN_NORMAL';

  return { mLDFA, MPTA, ajusteJLCA, femAbn, tibAbn, primaryClass, opcoes };
}

/** Cunha paramétrica para a opção selecionada (Hernigou — 1° ≈ 1,26 mm) */
export function cunhaParaOpcao(opcao: OpcaoNivel, nivel: 'femoral' | 'tibial'): number {
  const corr = nivel === 'femoral' ? Math.abs(opcao.corrFem) : Math.abs(opcao.corrTib);
  return Math.round(corr * 1.26 * 10) / 10;
}
