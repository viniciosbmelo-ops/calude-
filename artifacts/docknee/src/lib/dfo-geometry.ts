/**
 * DFO Miniaci Reverso — Geometria pura (invariante à calibração).
 *
 * Algoritmo: o fragmento distal (fêmur distal + tíbia + tornozelo) gira
 * em torno da charneira G. O ângulo de correção α é o ângulo ∠A–G–A',
 * onde A' é o novo centro do tornozelo sobre o eixo mecânico desejado.
 *
 * Referência: Miniaci A et al. "Correction of lower limb malalignment" (1989).
 *
 * LGPD: nenhuma função recebe ou retorna IDs de paciente.
 */

export type Pt = { x: number; y: number };

/**
 * Intersecção entre a reta definida por H→T e o círculo de centro G e raio r.
 * Retorna 0, 1 ou 2 pontos.
 */
export function interseccaoRetaCirculo(H: Pt, T: Pt, G: Pt, r: number): Pt[] {
  const d = { x: T.x - H.x, y: T.y - H.y };
  const f = { x: H.x - G.x, y: H.y - G.y };
  const a = d.x * d.x + d.y * d.y;
  const b = 2 * (f.x * d.x + f.y * d.y);
  const c = f.x * f.x + f.y * f.y - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return [];
  const s = Math.sqrt(disc);
  const t1 = (-b - s) / (2 * a);
  const t2 = (-b + s) / (2 * a);
  return [
    { x: H.x + t1 * d.x, y: H.y + t1 * d.y },
    { x: H.x + t2 * d.x, y: H.y + t2 * d.y },
  ];
}

/**
 * Ângulo de correção DFO pelo método Miniaci reverso geométrico (graus).
 *
 * @param H  Centro da cabeça femoral (pixel)
 * @param A  Centro do tornozelo — posição atual (pixel)
 * @param G  Ponto da charneira no fêmur distal (pixel)
 * @param T  Ponto-alvo do WBL no planalto tibial (pixel)
 *
 * Lança erro se a geometria for inválida (H=T ou sem interseção).
 */
export function anguloMiniaciDFO(H: Pt, A: Pt, G: Pt, T: Pt): number {
  const r = Math.hypot(A.x - G.x, A.y - G.y);
  if (r < 1) throw new Error("Charneira coincide com o tornozelo — revise marcação.");

  const cands = interseccaoRetaCirculo(H, T, G, r);
  if (cands.length === 0) {
    throw new Error("Geometria inválida: eixo desejado não alcança o arco de rotação do tornozelo — revise H, T ou G.");
  }

  // Escolher a raiz que menos desloca A (correção mínima, do lado distal)
  const Aprime = cands.reduce((best, p) =>
    Math.hypot(p.x - A.x, p.y - A.y) < Math.hypot(best.x - A.x, best.y - A.y) ? p : best
  );

  const vGA  = { x: A.x - G.x, y: A.y - G.y };
  const vGAp = { x: Aprime.x - G.x, y: Aprime.y - G.y };
  const cross = vGA.x * vGAp.y - vGA.y * vGAp.x;
  const dot   = vGA.x * vGAp.x + vGA.y * vGAp.y;
  return Math.abs(Math.atan2(cross, dot)) * 180 / Math.PI;
}

/**
 * Compensação graduada de JLCA para DFO (Prompt 1, spec Miniaci reverso).
 *
 * Diferente da fórmula de Paley para HTO (50% do excesso acima de 2°),
 * o DFO usa uma tabela discreta:
 *   JLCA ≤ 3° → 0° | 4–6° → 1° | 7–8° → 2° | ≥ 9° → 3°
 *
 * Retorna valor positivo a SUBTRAIR de α: αAlvo = α − resultado.
 */
export function calcJlcaAjusteGraduadoDFO(jlca: number): number {
  const j = Math.abs(jlca);
  if (j <= 3) return 0;
  if (j <= 6) return 1;
  if (j <= 8) return 2;
  return 3;
}

/**
 * Ponto-alvo T no planalto tibial, a partir dos pontos medial e lateral
 * do planalto e do percentual WBL desejado (0% = medial, 100% = lateral).
 *
 * Exemplo: wblPct = 62.5 → Ponto de Fujisawa (62,5% da largura tibial).
 */
export function computeTibialTarget(platMedial: Pt, platLateral: Pt, wblPct: number): Pt {
  const t = wblPct / 100;
  return {
    x: platMedial.x + t * (platLateral.x - platMedial.x),
    y: platMedial.y + t * (platLateral.y - platMedial.y),
  };
}

/**
 * Label formatado para o ajuste JLCA, ex: "JLCA 5° → −1°".
 * Retorna null quando ajuste é zero.
 */
export function jlcaAjusteLabel(jlca: number): string | null {
  const ajuste = calcJlcaAjusteGraduadoDFO(jlca);
  if (ajuste === 0) return null;
  return `JLCA ${Math.abs(jlca).toFixed(0)}° → −${ajuste}°`;
}
