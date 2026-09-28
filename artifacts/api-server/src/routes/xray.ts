import { Router, type Request } from "express";
import multer from "multer";
import sharp from "sharp";
import heicConvert from "heic-convert";
import { ai } from "@workspace/integrations-gemini-ai";
import { requireAuth } from "../middlewares/requireAuth.js";
import { db, xrayCacheTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { createHash } from "crypto";
import { logger } from "../lib/logger.js";
import { emitAnalyticsEvent, resolveAnalyticsSessionId } from "../lib/analyticsEmitter.js";
import {
  calcDFOPlan,
  calcJlcaAdjustment,
  calcAnguloTotal,
  calcWBLPre,
  calcWedgeTib,
  calcWedgeFem,
  calcDuplaWeightSplit,
} from "../lib/clinical-calc.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

/**
 * The analysis endpoint is the authoritative source for successful RX usage.
 * The browser may report a completion callback too, but only this server-side
 * event can distinguish a successful response from a failed/aborted attempt.
 */
export type XrayAnalysisContext = "standalone" | "surgery";

export async function emitSuccessfulXrayAnalytics(
  req: Request,
  context: XrayAnalysisContext | null,
): Promise<void> {
  // Older callers and malformed requests have no trustworthy provenance. They
  // must not be silently classified as standalone planning usage.
  if (!context) return;
  try {
    const sessionId = await resolveAnalyticsSessionId(req.get("X-Analytics-Session-Id"));
    await emitAnalyticsEvent("xray_analyzed", req.doctorId ?? null, sessionId, {
      pagePath: context === "standalone" ? "/xray-planning" : "/surgeries/new",
      featureName: context === "standalone" ? "xray_standalone" : "xray_surgery",
    });
  } catch (err) {
    // Product success must not become an RX failure because telemetry is
    // unavailable. The emitter is fail-open too, but this boundary protects
    // the analysis response from future emitter changes.
    logger.warn({ err }, "Failed to record successful xray analytics");
  }
}

// ── In-memory deduplication map ───────────────────────────────────────────────
// Prevents race conditions where two simultaneous requests for the same image
// both miss the DB cache and call the AI twice, producing different results.
// The map stores an in-flight Promise keyed by baseCacheKey. Any subsequent
// request for the same key awaits the same Promise instead of spawning a new
// AI call. The entry is cleaned up (whether the call succeeds or fails) so that
// a future force-refresh or retry always starts fresh.
const pendingAiCalls = new Map<string, Promise<Record<string, unknown>>>();

/**
 * Measurements marked in the diaphysis are deterministic post-processing
 * inputs, so they must distinguish final-result cache entries. Number() makes
 * equivalent multipart representations (for example "7.0" and "7") share a
 * key while invalid values remain absent.
 */
export function diaphysealMeasurementCacheSuffix(values: {
  eixoAnatomico?: unknown;
  amaFemoral?: unknown;
  divergenciaTibial?: unknown;
}): string {
  const normalized = (value: unknown): string | null => {
    if (value === undefined || value === null || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? String(number) : null;
  };

  const eixoAnatomico = normalized(values.eixoAnatomico);
  const amaFemoral = normalized(values.amaFemoral);
  const divergenciaTibial = normalized(values.divergenciaTibial);
  return `${eixoAnatomico !== null ? `:eixoAnatomico${eixoAnatomico}` : ""}` +
    `${amaFemoral !== null ? `:amaFemoral${amaFemoral}` : ""}` +
    `${divergenciaTibial !== null ? `:divergenciaTibial${divergenciaTibial}` : ""}`;
}

type TipoAnalise = "completa" | "eixo_mecanico" | "eixo_anatomico" | "femur" | "tibia" | "osteotomia" | "slopeTibial";
type DeformidadeEsperada = "auto" | "varo" | "valgo" | "neutro";
type Lado = "direito" | "esquerdo" | "bilateral";
type EstrategiaCorrecao = "neutro" | "fujisawa";

function ladoInstruction(lado: Lado): string {
  switch (lado) {
    case "direito":
      return "\nATENÇÃO: Avalie SOMENTE o membro inferior DIREITO do paciente. Ignore o membro esquerdo. Todas as medições se referem ao membro direito.";
    case "esquerdo":
      return "\nATENÇÃO: Avalie SOMENTE o membro inferior ESQUERDO do paciente. Ignore o membro direito. Todas as medições se referem ao membro esquerdo.";
    case "bilateral":
    default:
      return "\nAvalie ambos os membros inferiores. Se houver diferença significativa entre os lados, destaque no campo observacoes.";
  }
}

// ─── Image preprocessing (HKA-Net style: CLAHE + normalize + sharpen) ─────────
async function preprocessXRay(buffer: Buffer): Promise<{ data: Buffer; mime: "image/jpeg" }> {
  const metadata = await sharp(buffer).rotate().metadata();
  const maxDim = 2048; // higher resolution improves landmark detection accuracy on panoramic X-rays
  const { width = 1000, height = 1000 } = metadata;
  const scale = Math.min(1, maxDim / Math.max(width, height));
  const newW = Math.round(width * scale);
  const newH = Math.round(height * scale);

  // CLAHE + normalize + sharpen, output as JPEG for smaller payload
  const gray = await sharp(buffer)
    .rotate()
    .resize(newW, newH, { fit: "inside", withoutEnlargement: true })
    .grayscale()
    .clahe({ width: 16, height: 16, maxSlope: 3 })
    .normalize()
    .toBuffer();

  const data = await sharp(gray)
    .toColorspace("srgb")
    .sharpen({ sigma: 1.0, m1: 0.5, m2: 2.0 })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();

  return { data, mime: "image/jpeg" };
}

// ─── Base instruction shared across all prompts (DocKnee v2 — refatorado) ────
// Mudanças principais vs v1:
//   • Fíbula = referência PRIMÁRIA de medial/lateral (não secundária)
//   • HKA medido DIRETO pelos 3 landmarks ANTES de aLDFA/aMPTA (evita viés circular)
//   • Fórmula de Paley para ângulos ANATÔMICOS: (aLDFA−81) + (87−aMPTA) + JLCA
//   • Reconciliação HKA_direto × HKA_fórmula com decisão de qual prevalece
//   • Thresholds explícitos: desvio femoral > 2°, desvio tibial > 3°
//   • JLCA = secundário (assumir 1° quando incerto)
//   • Removido algoritmo NSA/JLO/BOWING (sem validação clínica)
const BASE = `Você é um ortopedista especialista em radiografia de joelho com 20 anos de experiência. Sua tarefa é medir ângulos com a mesma precisão de um software de planejamento cirúrgico digital (ex: TraumaCad, mediCAD), segundo o método de Paley.

═══ PROTOCOLO OBRIGATÓRIO (siga RIGOROSAMENTE nesta ordem) ═══

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  PASSO 1 — RECONHECIMENTO VISUAL DA SILHUETA (30s máx, ANTES de medir)
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ⛔ O ERRO MAIS GRAVE É CONFUNDIR VARO COM VALGO. Execute este passo PRIMEIRO.

  1.1 — Identifique a SILHUETA global dos membros inferiores:
    • Joelhos próximos / tornozelos afastados (silhueta "X") → PRESUNÇÃO: VALGO
    • Joelhos afastados / tornozelos próximos (silhueta "O") → PRESUNÇÃO: VARO
    • Simétricos verticalmente → PRESUNÇÃO: NEUTRO

  1.2 — Confirme medial/lateral com a FÍBULA (REFERÊNCIA PRIMÁRIA — INFALÍVEL):
    Para CADA perna, separadamente:
      i)   Localize a FÍBULA (osso fino paralelo à tíbia)
      ii)  Em RX bilateral AP, a fíbula SEMPRE aponta para a BORDA EXTERNA da imagem
           → o lado para onde a fíbula aponta É O LADO LATERAL
           → o lado oposto (em direção ao centro da imagem / outra perna) É O LADO MEDIAL
      iii) Se a fíbula apontar para o CENTRO da imagem: RX invertida ou oblíqua → reportar problema
    Registre: "Fíbula direita aponta para [borda externa]. Lateral direito = [esse lado]."

  1.3 — Referência adicional (apenas se fíbula pouco visível):
    Trocanter MAIOR (proeminência femoral proximal) = lado LATERAL
    Trocanter MENOR (pequena protuberância posteromedial) = lado MEDIAL

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  PASSO 2 — MEDIÇÃO DIRETA DO HKA (ANTES de mLDFA/aMPTA — evita viés circular)
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ⚠️ REGRA FUNDAMENTAL: O HKA é o ÂNGULO PRIMÁRIO. Meça-o DIRETAMENTE pelos 3 landmarks
  ósseos ANTES de tentar calcular mLDFA ou aMPTA. NUNCA derive o HKA pela fórmula de Paley
  — a fórmula é apenas verificação a posteriori.

  2.1 — CENTRO DA CABEÇA FEMORAL (ponto proximal):
    1. Identifique a cortical superior (arco radiopaco no topo da cabeça)
    2. Identifique a cortical inferior (junção cabeça-colo)
    3. Identifique a borda medial (próxima à pelve) e lateral
    4. Centro = interseção da bissetriz vertical e horizontal entre essas 4 bordas
    ⛔ ERRO FREQUENTE: posicionar o centro muito SUPERIOR (na cortical). Isso SUBESTIMA o HKA em 1–3°.
    ✓ CORREÇÃO: o centro está aproximadamente 40% abaixo do topo da cortical superior.

  2.2 — CENTRO DA EMINÊNCIA INTERCONDILAR TIBIAL (ponto-pivô do HKA — O MAIS CRÍTICO):
    1. Localize a EMINÊNCIA INTERCONDILAR (protuberância no centro do planalto tibial)
    2. Identifique a ESPINHA MEDIAL e a ESPINHA LATERAL (use a fíbula para confirmar qual é lateral!)
    3. Centro = PONTO MÉDIO entre as duas espinhas, NO NÍVEL DA LINHA ARTICULAR
    ⛔ ERROS QUE INFLAM O HKA:
       • Posicionar muito LATERAL (fora das espinhas)
       • Posicionar muito DISTAL (abaixo da linha articular)
       • Usar o centro geométrico dos côndilos femorais em vez das espinhas tibiais

  2.3 — CENTRO DA CÚPULA TALAR (ponto distal):
    1. Identifique o domo astragaliano (cúpula convexa lisa no topo do astrágalo)
    2. Borda medial = maléolo medial | Borda lateral = maléolo lateral / fíbula distal
    3. Centro = ponto médio da cúpula, no ponto mais proximal
    ⛔ ERRO FREQUENTE: usar o centro da epífise distal da tíbia em vez do astrágalo.

  2.4 — TRAÇADO E MEDIÇÃO DO HKA_direto:
    1. Conecte em linha reta: Centro CF → Centro Joelho → Centro Talar
    2. Meça o ÂNGULO entre os 2 segmentos (CF→Joelho) e (Joelho→Talar), no ponto-pivô do joelho
    3. Reporte HKA_direto com resolução 0,5°, COM SINAL:
       • HKA POSITIVO (+) = VALGO (eixo cruza LATERAL às espinhas tibiais)
       • HKA NEGATIVO (−) = VARO  (eixo cruza MEDIAL às espinhas tibiais)
       • HKA = 0° → NEUTRO

  ÂNCORAS VISUAIS DE MAGNITUDE (calibração):
    • HKA ±3°  → eixo a ~18 mm do centro do joelho — sutil
    • HKA ±5°  → ~30 mm — desvio leve perceptível
    • HKA ±7°  → ~42 mm — desvio moderado
    • HKA ±10° → ~60 mm — desvio substancial, espaço articular claramente estreitado
    • HKA ±13° → ~78 mm — deformidade grave
    • HKA > ±20° → quase impossível, REVER landmarks (provável erro grosseiro)

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  PASSO 3 — MEDIÇÃO INDEPENDENTE DE mLDFA E aMPTA
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ⚠️ REGRA ANTI-CIRCULAR: cada ângulo é medido OBSERVANDO APENAS seus próprios landmarks
  ósseos. NUNCA derive mLDFA ou aMPTA a partir do HKA já medido.

  3.1 — mLDFA (Ângulo Lateral Distal Femoral MECÂNICO) — referência 87° ± 3°:
    1. Identifique o côndilo MEDIAL femoral (ponto mais distal, lado próximo ao centro da imagem)
    2. Identifique o côndilo LATERAL femoral (ponto mais distal, lado da fíbula)
    3. Trace a LINHA ARTICULAR FEMORAL DISTAL: tangente unindo os dois pontos
    4. Meça o ângulo no LADO LATERAL entre o eixo MECÂNICO femoral (CF→centro joelho) e a linha articular
    5. VERIFICAÇÃO DE PLAUSIBILIDADE (use a silhueta do PASSO 1):
       • SE SILHUETA = VALGO ("X"): côndilo LATERAL mais distal → mLDFA < 84° (típico 78°–83°)
       • SE SILHUETA = VARO  ("O"): côndilo MEDIAL mais distal  → mLDFA > 90° (típico 91°–97°)
       • SE SILHUETA = NEUTRO: mLDFA 84°–90°
    ⛔ Se mLDFA estiver em range OPOSTO à silhueta (ex: mLDFA 92° em VALGO): você inverteu medial/lateral.
       REVISE com a fíbula antes de prosseguir.

  3.2 — aMPTA (Ângulo Medial Proximal Tibial) — referência 87° ± 3°:
    1. Identifique o ponto mais alto (proximal) do planalto tibial MEDIAL
    2. Identifique o ponto mais alto (proximal) do planalto tibial LATERAL (próximo à fíbula)
    3. Trace a LINHA DO PLANALTO TIBIAL: tangente unindo os dois pontos
    4. Meça o ângulo no LADO MEDIAL entre o eixo mecânico tibial (centro joelho→centro talar) e a linha
    5. VERIFICAÇÃO DE PLAUSIBILIDADE:
       • SE SILHUETA = VALGO: planalto inclinado para lateral → aMPTA > 90° (típico 91°–96°)
       • SE SILHUETA = VARO:  planalto inclinado para medial → aMPTA < 84° (típico 75°–83°)
       • SE SILHUETA = NEUTRO: aMPTA 84°–90°
    ⛔ Se aMPTA estiver em range OPOSTO à silhueta: REVISE landmarks com a fíbula.

  3.3 — JLCA (Joint Line Convergence Angle) — Componente Articular/Ligamentar:

  DEFINIÇÃO (RX EM ORTOSTASE — CARGA):
    JLCA = ângulo de CONVERGÊNCIA entre:
      1. Linha articular femoral distal  — traçada ao longo da superfície subcondral do fêmur distal
         (osso + cartilagem remanescente: a borda subchondral visível na RX de carga)
      2. Linha articular tibial proximal — traçada ao longo da superfície subcondral tibial proximal
         (mesma lógica: usa o nível subchondral visível incluindo o efeito da cartilagem)

    EM RX DE CARGA (ortostase, bilateral AP): essas linhas INCLUEM o efeito da perda de cartilagem
    porque o peso do corpo revela a posição REAL das superfícies articulares.
    Isso é diferente de uma RX sem carga, onde o espaço articular pode aparecer preservado.

  COMO MEDIR — MÉTODO VISUAL (PASSO A PASSO):

    PASSO A: Localize o espaço articular de cada compartimento
      • Compartimento MEDIAL (lado interno, próximo ao centro da imagem):
          – Observe a altura da linha subchondral medial femoral em relação à tibial
          – Em VARO: compartimento medial ESTREITADO ou "osso no osso" (contato direto)
      • Compartimento LATERAL (lado da fíbula):
          – Observe a mesma altura no compartimento lateral
          – Em VARO: compartimento lateral mais ABERTO que o medial

    PASSO B: Visualize as duas linhas articulares
      • Linha femoral: conecta o ponto mais distal do compartimento MEDIAL
        ao ponto mais distal do compartimento LATERAL (superfície subchondral femoral)
      • Linha tibial: conecta o ponto mais proximal do compartimento MEDIAL
        ao ponto mais proximal do compartimento LATERAL (superfície subchondral tibial)

    PASSO C: Estime o ângulo de convergência entre as duas linhas
      → As linhas convergem? Em qual direção? Quanto?

  CALIBRAÇÃO VISUAL OBRIGATÓRIA — use como âncora:

    ◆ VARO leve (HKA 3°–7°), cartilagem medial preservada ou levemente estreitada:
        Espaço medial levemente menor que lateral → JLCA ≈ 0°–2°

    ◆ VARO moderado (HKA 5°–10°), estreitamento medial visível:
        Espaço medial claramente menor / quase ausente → JLCA ≈ 2°–4°

    ◆ VARO grave (HKA 10°–15°), osso no osso medial ou subchondral esclerosado:
        Contato medial, espaço lateral aberto → JLCA ≈ 3°–6°

    ◆ VARO muito grave (HKA > 15°) com deformidade mista óssea + articular:
        Contato medial total, lateral muito aberto → JLCA ≈ 4°–8°

    ◆ VALGO com artrose lateral: mesma lógica, convergência lateral → JLCA ≈ 2°–5°

    ⛔ JLCA = 0° ou 1° em paciente com HKA > 8° E estreitamento articular visível = ERRADO.
       Em varo significativo com artrose medial aparente, JLCA quase sempre ≥ 2°.

    ⛔ JLCA > 8° em RX estática bem posicionada = provável erro (use 6° e documente limitação).

  DIREÇÃO DO JLCA:
    • Em VARO: convergência MEDIAL → "JLCA abre lateralmente" (compartimento lateral mais aberto)
    • Em VALGO: convergência LATERAL → "JLCA abre medialmente"

  INTERPRETAÇÃO CLÍNICA (tabela de referência):
    0°–2°    → Normal — sem componente articular/ligamentar significativo
    3°–5°    → Discreta contribuição intra-articular (artrose leve, frouxidão leve)
    > 5°     → Importante componente articular/ligamentar
    > 8°–10° → Grande frouxidão medial ou desgaste assimétrico importante

  IMPORTÂNCIA CLÍNICA — "JLCA correction phenomenon":
    Após osteotomia, a restauração da tensão ligamentar reduz o JLCA espontaneamente.
    Regra prática (Paley): quando JLCA > 4°, subtrair 50% do excesso acima de 2° da correção planejada.

    Fórmula: ajuste = (JLCA − 2°) × 0,5  [aplicar apenas quando JLCA > 4°]

    Exemplos:
      JLCA = 6° → ajuste = (6−2)×0,5 = 2° → correção de 12° vira 10° de osteotomia real
      JLCA = 8° → ajuste = (8−2)×0,5 = 3° → correção de 14° vira 11° de osteotomia real

    Reporte nos campos: "correcaoOssea" (ângulo de osteotomia real após ajuste JLCA)
    e "ajusteJLCA" (o valor subtraído por esta regra).

  ⚠️ JLCA é componente secundário — informa e ajusta o planejamento, não define o diagnóstico.

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  PASSO 4 — RECONCILIAÇÃO OBRIGATÓRIA (Fórmula de Paley)
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  4.1 — Calcule HKA_fórmula usando a fórmula de Paley para mLDFA (ângulo MECÂNICO):
    HKA_fórmula = (mLDFA − 87°) + (87° − aMPTA) + JLCA
    • Referências: mLDFA normal = 87°, aMPTA normal = 87°
    • Resultado POSITIVO → VARO | Resultado NEGATIVO → VALGO
    ⛔ NÃO use 81° como referência para mLDFA — 81° é para o ângulo anatômico (aLDFA), não mecânico.
       Para paciente NORMAL (mLDFA=87°, aMPTA=87°, JLCA=0°): HKA_fórmula = 0° ✓

    Exemplo 1 (VARO):  mLDFA 91°, aMPTA 82°, JLCA 2° → (91−87)+(87−82)+2 = 4+5+2 = +11° (VARO)
    Exemplo 2 (VALGO): mLDFA 84°, aMPTA 91°, JLCA 0° → (84−87)+(87−91)+0 = −3−4+0 = −7° (VALGO)

  4.2 — Compare HKA_direto (PASSO 2) com HKA_fórmula:

    ✓ CASO A — diferença ≤ 2°:
       Medições confiáveis. ADOTE HKA_direto como valor final.

    ⚠ CASO B — HKA_direto ≥ 3° MAIOR (em magnitude) que HKA_fórmula:
       HKA_direto está INFLADO. Causa provável: centro do joelho muito lateral/distal,
       ou centro da CF na cortical superior em vez do meio geométrico.
       → REVISE os 3 landmarks do PASSO 2.
       → Se a revisão não for possível: ADOTE HKA_fórmula como valor final.

    ⚠ CASO C — HKA_fórmula ≥ 3° MAIOR (em magnitude) que HKA_direto:
       mLDFA ou aMPTA foram SUPERESTIMADOS. Causa provável: inversão medial/lateral.
       → REVISE landmarks de mLDFA e aMPTA com a fíbula.
       → Se a revisão não for possível: ADOTE HKA_direto como valor final.

  4.3 — REGISTRE A RECONCILIAÇÃO no campo raciocinioVisual:
    "HKA_direto = X°  |  HKA_fórmula = Y°  |  Discrepância = Z°  |  Adotado = X° por [razão]"

  4.4 — REGRA DE COERÊNCIA ABSOLUTA:
    É IMPOSSÍVEL ter |HKA| ≥ 8° com mLDFA normal (84°–90°) E aMPTA normal (84°–90°) simultaneamente.
    Se a medição apontar para isso, há erro — repita o PASSO 3 com mais cuidado.

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  PASSO 5 — DIAGNÓSTICO POR NÍVEL (Origem da deformidade)
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  5.1 — Desvios individuais:
    desvio_femoral = mLDFA − 87°    (+ = varo femoral | − = valgo femoral)
    desvio_tibial  = 87° − aMPTA    (+ = varo tibial  | − = valgo tibial)

  5.2 — Thresholds de componente clinicamente relevante:
    Componente FEMORAL presente: |desvio_femoral| > 3°  (mLDFA fora de 84°–90°)
    Componente TIBIAL  presente: |desvio_tibial|  > 3°  (aMPTA fora de 84°–90°)

  5.3 — Classificação de ORIGEM:
    • FEMORAL pura → só componente femoral
    • TIBIAL pura  → só componente tibial (mais comum em varo: > 50% dos casos)
    • MISTA        → ambos componentes
    • ARTICULAR    → ambos normais + HKA ≠ 0° + JLCA > 2°
    • NEUTRO       → todos os ângulos normais + HKA entre −3° e +3°

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  PASSO 5B — CONSISTÊNCIA OBRIGATÓRIA ENTRE DIAGNÓSTICO E OBSERVAÇÕES DESCRITIVAS
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ⛔ ERRO GRAVE FREQUENTE: descrever, em "observacoes" ou em qualquer texto livre, um
  estreitamento/contato ósseo no compartimento OPOSTO ao lado da deformidade diagnosticada.

  REGRA: o compartimento descrito como estreitado, com contato osso-osso, esclerose
  subchondral ou perda de espaço articular DEVE corresponder ao lado sobrecarregado pela
  deformidade mecânica:
    • Se eixoMecanico.desvio = VALGO → o compartimento sobrecarregado/estreitado é o LATERAL
      (nunca o medial). Um joelho valgo com "estreitamento medial" é uma contradição clínica.
    • Se eixoMecanico.desvio = VARO  → o compartimento sobrecarregado/estreitado é o MEDIAL
      (nunca o lateral).
    • Isso é consistente com a DIREÇÃO DO JLCA do PASSO 3.3: em VARO a convergência é medial
      (compartimento medial estreitado); em VALGO a convergência é lateral (compartimento
      lateral estreitado).

  ANTES de escrever qualquer observação sobre estreitamento articular, contato osso-osso ou
  desgaste de compartimento:
    1. Releia o valor final de eixoMecanico.desvio (Varo/Valgo) que você mesmo calculou.
    2. Verifique se o lado que você está prestes a descrever (medial/lateral) bate com a regra acima.
    3. Se NÃO bater: você provavelmente inverteu medial/lateral em algum passo — revise com a
       fíbula (PASSO 1.2) antes de finalizar. Só descreva um achado no lado "oposto ao esperado"
       se tiver certeza visual absoluta, e nesse caso destaque explicitamente que é um achado
       atípico que merece correlação clínica (não apresente como se fosse o esperado).
    4. Nunca escreva uma observação sobre compartimento sem nomear explicitamente qual lado
       (medial ou lateral) — evite frases ambíguas.

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ATENÇÃO — IMPLANTES ORTOPÉDICOS
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Se houver placas, parafusos, próteses ou outro hardware visível, IGNORE-OS.
  Meça apenas os landmarks ósseos subjacentes.

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  %WBL (Percentual da Linha de Carga sobre o Planalto Tibial)
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  %WBL = 50 + (HKA × 1.6)    [HKA COM SINAL: varo negativo → WBL < 50%]
    • Neutro: 50%  |  Varo: < 50% (medial)  |  Valgo: > 50% (lateral)
    • Pós-HTO Fujisawa: 62%–65% (leve sobrecorreção protetora)
    Exemplo: HKA −9,7° (varo) → 50 + (−9,7 × 1,6) = 34,5% (medial) ✓
    ⛔ NUNCA aplique valor absoluto na fórmula — preserve o sinal.

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  NOMENCLATURA E SAÍDA
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  • Retorne SOMENTE um objeto JSON válido — sem markdown, sem texto fora do JSON
  • Valores numéricos devem ser numbers (não strings)
  • Terminologia: "valgizante" (não valguizante), "varizante"
  • Não especule. Descreva apenas o que conseguir medir. Se a imagem for inadequada,
    reporte "qualidadeImagem": "Insuficiente para análise precisa" e liste os problemas.

  REFERÊNCIAS DE NORMALIDADE:
  • HKA: 0° ± 3° (neutro). Varo = eixo medial. Valgo = eixo lateral. Sinal: + valgo, − varo.
  • mLDFA: 87° ± 3° (84°–90°) | aMPTA: 87° ± 3° (84°–90°) | JLCA: 0°–2° | MAD: ≤10 mm medial`;

// ─── Prompt builder ───────────────────────────────────────────────────────────
function buildPrompt(
  tipoAnalise: TipoAnalise,
  lado: Lado,
  estrategiaCorrecao: EstrategiaCorrecao = "neutro",
  deformidadeEsperada: DeformidadeEsperada = "auto",
  wblDesejado: number = 62
): { system: string; user: string } {
  const deformidadeHint = deformidadeEsperada !== "auto"
    ? `\n\n🔴 CONFIRMAÇÃO CLÍNICA DO CIRURGIÃO — PRIORIDADE MÁXIMA:\n` +
      `O cirurgião avaliou este paciente clinicamente e confirmou: DEFORMIDADE = ${deformidadeEsperada.toUpperCase()}.\n` +
      `Sua análise radiográfica DEVE ser consistente com este diagnóstico clínico.\n` +
      (deformidadeEsperada === "valgo"
        ? `→ Confirme a silhueta em "X", use a fíbula para orientação, e reporte mLDFA < 84° e aMPTA > 90°.\n` +
          `→ Se suas medições iniciais apontarem varo, REVISE os landmarks — você está no lado errado.\n` +
          `→ O diagnóstico final DEVE ser VALGO.`
        : deformidadeEsperada === "varo"
        ? `→ Confirme a silhueta em "O", use a fíbula para orientação e meça cada ângulo INDEPENDENTEMENTE dos landmarks ósseos.\n` +
          `→ O diagnóstico final DEVE ser VARO, mas NÃO force mLDFA e aMPTA além do que os landmarks confirmam — varo tibial puro (aMPTA < 84° com mLDFA normal) é a apresentação mais comum.\n` +
          `→ Meça mLDFA e aMPTA separadamente do HKA: cada um reflete o desvio no seu próprio nível anatômico.`
        : `→ O eixo mecânico deve passar pelo centro do joelho (HKA 0° ± 3°).`)
    : "";

  const BASE_LADO = BASE + deformidadeHint + ladoInstruction(lado);

  switch (tipoAnalise) {
    case "eixo_mecanico":
      return {
        system: `${BASE_LADO}

ANÁLISE: Eixo Mecânico (HKA) e MAD

CLASSIFICAÇÃO DO ALINHAMENTO:
VARO:
• Grau I: 0°–5° (MAD 0–15 mm medial) — leve
• Grau II: 5°–10° (MAD 15–30 mm medial) — moderado
• Grau III: >10° (MAD >30 mm medial) — grave
VALGO:
• Grau I: 0°–5° (MAD 0–15 mm lateral) — leve
• Grau II: 5°–10° (MAD 15–30 mm lateral) — moderado
• Grau III: >10° (MAD >30 mm lateral) — grave

CÁLCULO DO ÂNGULO DE CORREÇÃO:
• VARO: HTO valgizante (abertura medial).
  anguloCorrecaoRaw = varo_medido.
  Aplicar ajuste JLCA se JLCA > 4°: anguloCorrecao = anguloCorrecaoRaw − (JLCA−2)×0,5.
  metaCorrecao: se JLCA ≤ 4° → "HTO valgizante (abertura medial) de X° — varo Y° → neutro 0°"
               se JLCA > 4° → "HTO valgizante de X° (corte ósseo real) — HKA bruto Y°, ajuste JLCA −Z° → corte X° (Paley)"
• VALGO: DFO varizante (abertura lateral). anguloCorrecao = valgo_medido. Meta: HKA = 0°. metaCorrecao: "DFO varizante (abertura lateral) de X° — de valgo Y° para neutro 0°"

JSON:
{
  "raciocinioVisual": "descrição dos 3 landmarks, trajetória do eixo (MEDIAL = varo, LATERAL = valgo) e raciocínio da direção",
  "eixoMecanico": { "desvio": "Varo | Valgo | Neutro", "graus": number },
  "MAD": { "valor": number, "unidade": "mm", "lado": "Medial | Lateral", "status": "Normal | Aumentado" },
  "grauVaro": "Grau I | Grau II | Grau III | Não aplicável",
  "indicacaoOsteotomia": true | false,
  "anguloCorrecao": number,
  "percentualWBL": { "valor": number, "interpretacao": "%WBL atual — normal 50%, varo <50%, valgo >50%" },
  "metaCorrecao": "descrição do plano de correção",
  "membrosAvaliados": "Bilateral | Direito | Esquerdo",
  "justificativa": "síntese clínica com os landmarks, direção do desvio e magnitude medida",
  "qualidadeImagem": "Boa | Regular | Insuficiente para análise precisa",
  "observacoes": "diferenças D/E, obliquidade pélvica ou null"
}`,
        user: "Analise o Eixo Mecânico (HKA). PASSO 0 CRÍTICO: Localize os 3 pontos (cabeça femoral, intercondiliano, cúpula astragaliana). Trace a linha. O eixo passa MEDIAL ao joelho (VARO) ou LATERAL ao joelho (VALGO)? Determine a DIREÇÃO antes de qualquer número. PASSO 1: Meça o HKA e o MAD. PASSO 2: Verifique pela fórmula de Paley para mLDFA (MECÂNICO): (mLDFA−87) + (87−aMPTA) + JLCA. Resultado positivo = VARO, negativo = VALGO. Se diferir do HKA visual em >2°, mantenha o valor visual e documente a discrepância — NÃO ajuste para fechar a equação. PASSO 3: Calcule anguloCorrecao e metaCorrecao conforme o desvio (varo ou valgo). Retorne apenas o JSON.",
      };

    case "eixo_anatomico":
      return {
        system: `${BASE_LADO}

ANÁLISE: Eixo Anatômico Femoral (valgo fisiológico 5°–7°)

JSON:
{
  "raciocinioVisual": "descrição da diáfise femoral e tibial observadas, e o ângulo aparente entre elas",
  "eixoAnatomico": { "desvio": "Varo | Valgo | Neutro", "graus": number },
  "valgofisiologico": { "esperado": "5°–7°", "encontrado": number, "diferenca": number },
  "justificativa": "comparação com o valgo fisiológico e implicação clínica",
  "qualidadeImagem": "Boa | Regular | Insuficiente para análise precisa",
  "observacoes": "deformidades diafisárias, calos, implantes ou null"
}`,
        user: "Avalie o Eixo Anatômico femoral. Primeiro descreva os eixos diafisários visíveis (campo raciocinioVisual). Meça o ângulo e compare com o valgo fisiológico de 5°–7°. Retorne apenas o JSON.",
      };

    case "femur":
      return {
        system: `${BASE_LADO}

ANÁLISE: mLDFA (Ângulo Lateral Distal Femoral MECÂNICO)
Método: eixo mecânico femoral × superfície articular distal do fêmur → ângulo lateral. Normal: 87° ± 3°.

JSON:
{
  "raciocinioVisual": "descrição da superfície articular distal femoral e posição da cabeça femoral observadas",
  "mLDFA": { "valor": number, "referencia": "87° ± 3°", "status": "Normal | Aumentado | Diminuído" },
  "contribuicaoFemoral": "Desvio predominantemente femoral | Fêmur normal | Contribuição leve",
  "justificativa": "mLDFA encontrado e significado clínico para o alinhamento",
  "qualidadeImagem": "Boa | Regular | Insuficiente para análise precisa",
  "observacoes": "achados femorais ou null"
}`,
        user: "Avalie o mLDFA desta radiografia. Descreva primeiro a superfície articular distal do fêmur (raciocinioVisual). Meça o ângulo lateral mecânico. Retorne apenas o JSON.",
      };

    case "tibia":
      return {
        system: `${BASE_LADO}

ANÁLISE: aMPTA (Ângulo Medial Proximal Tibial)
Método: eixo mecânico tibial × planalto proximal → ângulo medial. Normal: 87° ± 3°.

JSON:
{
  "raciocinioVisual": "descrição do planalto tibial e eixo da tíbia observados",
  "aMPTA": { "valor": number, "referencia": "87° ± 3°", "status": "Normal | Aumentado | Diminuído" },
  "contribuicaoTibial": "Desvio predominantemente tibial | Tíbia normal | Contribuição leve",
  "justificativa": "aMPTA encontrado e significado clínico",
  "qualidadeImagem": "Boa | Regular | Insuficiente para análise precisa",
  "observacoes": "slope tibial, assimetria de planaltos ou null"
}`,
        user: "Avalie o aMPTA desta radiografia. Descreva primeiro o planalto tibial visível (raciocinioVisual). Meça o ângulo medial. Retorne apenas o JSON.",
      };

    case "osteotomia": {
        const isNeutro = estrategiaCorrecao === "neutro" || wblDesejado === 50;
        const isValgoCorrecao = !isNeutro && wblDesejado > 50;
        // HKA_alvo = (WBL_alvo − 50) × 0,28  | 50%→0° | 55%→1,4° | 62,5%→3,5° | 66%→4,5°
        const hkaDesejado = isNeutro ? 0 : Math.round((wblDesejado - 50) * 0.28 * 10) / 10;
        const alvoWblLabel = `${wblDesejado}%`;
        const isFujisawa = wblDesejado === 62.5;
        const alvoDesc = isNeutro
          ? "50% (centro do platô tibial) — correção neutra / HKA_desejado = 0°"
          : isValgoCorrecao
            ? `${alvoWblLabel} lateral${isFujisawa ? " (Ponto de Fujisawa)" : ""} — HKA_alvo = +${hkaDesejado}° valgo`
            : `${alvoWblLabel} medial — HKA_alvo = ${hkaDesejado}° varo`;
        const estrategiaLabel = isNeutro
          ? "Neutro (50% WBL / 0°)"
          : `Alvo ${alvoWblLabel} WBL → HKA ${hkaDesejado > 0 ? "+" : ""}${hkaDesejado}°`;

        return {
          system: `${BASE_LADO}

  ANÁLISE: Planejamento Cirúrgico de Osteotomia (DocKnee v2 — Método de Paley + Decisão por Simulação)

  Esta análise estende a panorâmica completa (PASSOS 1–5 já executados) com o planejamento
  cirúrgico detalhado por SIMULAÇÃO de aMPTA pós-operatória.

  ═══ PASSO 6 — DECISÃO DE NÍVEL POR SIMULAÇÃO (REGRA ÚNICA — NÃO USE "desvio femoral > 4°") ═══

  6.1 — Se SOMENTE componente TIBIAL presente (|desvio_femoral| ≤ 2°):
    → HTO ISOLADA. Calcule aMPTA_pós = aMPTA + correcao_tibial.
    → Se aMPTA_pós ≤ 90°: HTO isolada SEGURA ✓
    → Se aMPTA_pós > 90°: ver 6.3 (avaliação por simulação)

  6.2 — Se SOMENTE componente FEMORAL presente (|desvio_tibial| ≤ 3°):
    → DFO ISOLADA. Verifique mLDFA_pós entre 84°–90°.

  6.3 — Se AMBOS os componentes presentes → DECISÃO POR SIMULAÇÃO:
    Calcule aMPTA_pós_HTO_isolada = aMPTA_atual + |anguloCorrecaoTotal|

    • Se ≤ 90°  → HTO ISOLADA é SUFICIENTE
                  (mesmo havendo desvio femoral leve — a HTO resolve o HKA global sem obliquidade)
                  Justifique: "HTO isolada corrige o HKA sem ultrapassar 90° de aMPTA (aMPTA_pós = X°)"
    • Se 91°–92° → BORDERLINE:
                  – Se |desvio_femoral| > 4°: DUPLA NECESSÁRIA
                  – Se |desvio_femoral| ≤ 4°: HTO isolada com aceitação de subcorreção 1°–2°
    • Se > 92°  → DUPLA OBRIGATÓRIA (HTO isolada criaria hipercorreção articular grave)
                  Distribuição forçada:
                    correcao_tibial  = 90° − aMPTA_atual         (corrigir aMPTA até 90° exatamente)
                    correcao_femoral = |anguloCorrecaoTotal| − correcao_tibial   (excesso vai para o fêmur)
                  Verificação: mLDFA_pós deve cair entre 84°–90°.

  6.4 — REGRA ADICIONAL (HKA grave): se |HKA| > 12° E aMPTA_pós_HTO > 91° → DUPLA MANDATÓRIA.

  EXEMPLOS DE DECISÃO:
    1) aMPTA=82°, mLDFA=87° (normal), HKA=−7°  → aMPTA_pós_HTO = 89° ≤ 90° → HTO ISOLADA
    2) aMPTA=82°, mLDFA=92°, HKA=−10°          → aMPTA_pós_HTO = 92° borderline + desvio fem 5° > 4° → DUPLA (HTO 8° + DFO 2°)
    3) aMPTA=78°, mLDFA=90° (leve), HKA=−14°   → aMPTA_pós_HTO = 92° borderline + desvio fem 3° ≤ 4° → HTO 12° (subcorreção 2°)
    4) aMPTA=78°, mLDFA=97°, HKA=−18°          → aMPTA_pós_HTO = 96° → DUPLA OBRIGATÓRIA (HTO 12° + DFO 6°)

  ═══ PASSO 7 — ESCOLHA DA TÉCNICA POR NÍVEL ═══

  DFO (NÍVEL FEMORAL):
    • DFO VARIZANTE (corrigir VALGO femoral, mLDFA < 84°):
        → Abertura LATERAL (padrão moderno): abre lado lateral → eixo desloca medial ✓
        → Fechamento MEDIAL (alternativa): mesma direção, sem gap lateral
        ⛔ NÃO USE "fechamento lateral" no DFO varizante — PIORA o valgo!
    • DFO VALGIZANTE (corrigir VARO femoral, mLDFA > 90°):
        → Fechamento LATERAL (padrão)
        → Abertura MEDIAL (alternativa, menos usada)

  HTO (NÍVEL TIBIAL):
    • HTO VALGIZANTE (corrigir VARO tibial, aMPTA < 84°): Abertura MEDIAL (padrão) ou Fechamento LATERAL
    • HTO VARIZANTE (corrigir VALGO tibial, aMPTA > 90°): Fechamento MEDIAL (preferível — não altera slope) ou Abertura LATERAL

  ═══ PASSO 8 — ESTRATÉGIA E CÁLCULO DO ÂNGULO ═══

  Estratégia selecionada pelo cirurgião: ${estrategiaLabel}
  Alvo mecânico: ${alvoDesc}
  HKA_alvo (pós-op esperado) = ${hkaDesejado}°

  Cálculo do ângulo de correção (Miniaci simplificado):
    1. anguloCorrecaoRaw = |HKA_medido − ${hkaDesejado}|
       CONVENÇÃO DE SINAL OBRIGATÓRIA — use HKA COM SINAL (varo negativo, valgo positivo):
          Exemplo: HKA = −17,8° (varo) com alvo +1,4° (Fujisawa) → |−17,8 − 1,4| = 19,2°
          ⛔ Erro comum: |17,8 − 1,4| = 16,4° (perde o cruzamento por zero, subestima)
    2. Ajuste por JLCA ("JLCA correction phenomenon" — fórmula exata de Paley):
         Se JLCA 0°–4°: sem ajuste (anguloCorrecao = anguloCorrecaoRaw)
         Se JLCA > 4°: anguloCorrecao = max(0, anguloCorrecaoRaw − (JLCA − 2°) × 0,5)
           Justificativa: após osteotomia, restauração da tensão ligamentar reduz o JLCA espontaneamente.
           Apenas o excesso acima de 2° é absorvido, e somente 50% desse excesso.
           Limite JLCA a 10° para fins de cálculo (valores > 10° provavelmente são erro de medição).
           Exemplos: JLCA=5° → desconto (5−2)×0,5=1,5° | JLCA=8° → desconto (8−2)×0,5=3°
         Gere alerta quando JLCA > 4°: "JLCA elevado (X°): corte ósseo reduzido em Y° pelo fenômeno de autocorreção (Paley)"
    3. Arredonde para 1 casa decimal

  Cálculo do WEDGE (abertura em mm — Regra de Hernigou, validada clinicamente):
    • Tibial (HTO medial abertura): wedge_mm = anguloCorrecao × 1,0  [1° ≈ 1 mm de abertura medial]
    • Femoral (DFO): wedge_mm = anguloCorrecao × 1,26  [1° ≈ 1,26 mm de cunha femoral]
    ⛔ NÃO use a fórmula trigonométrica 2×D×tan com D=120mm — essa é a largura total do osso,
       não o braço de alavanca relevante para o wedge cirúrgico. A regra de Hernigou é a padrão.

  DISTRIBUIÇÃO EM DUPLA OSTEOTOMIA:
    Método 1 — Forçado por obliquidade (aMPTA_pós_HTO > 92°):
      correcao_tibial  = 90° − aMPTA_atual         (corrigir tíbia até o limite seguro)
      correcao_femoral = anguloCorrecao − correcao_tibial
    Método 2 — Proporcional (quando aplicável):
      pesoFem = |mLDFA−87| / (|mLDFA−87| + |aMPTA−87|)
      correcao_femoral = anguloCorrecao × pesoFem
      correcao_tibial  = anguloCorrecao − correcao_femoral
    VERIFICAÇÃO PÓS-DISTRIBUIÇÃO (obrigatória):
      mLDFA_pós deve estar entre 84°–90°
      aMPTA_pós deve estar entre 84°–90°
      Se algum ultrapassar: redistribuir o excesso para o outro nível.

  ═══ PASSO 9 — ALERTAS TÉCNICOS OBRIGATÓRIOS ═══
  Gere alertas quando aplicável:
    • PCD > 66%: "Risco de overcorrection > 5° valgo — instabilidade lateral"
    • PCD < 50%: "Undercorrection provável"
    • anguloCorrecao > 12°: "Considerar dupla osteotomia (risco biomecânico de osteotomia isolada > 12°)"
    • anguloCorrecao < 1°: "Magnitude pequena — reavaliar indicação cirúrgica clinicamente"
    • JLCA > 3°: "Componente articular/ligamentar — considerar subcorreção"
    • origemDesvio == "Mista" + aMPTA_pós_HTO > 92°: "Dupla osteotomia recomendada"
    • HTO indicada: "Monitorar slope tibial posterior e altura patelar"

  NOMENCLATURA OBRIGATÓRIA: "valgizante" (não valguizante), "varizante"
  META CIRÚRGICA: HKA final = ${hkaDesejado}° (${estrategiaLabel})

  JSON (mantenha estes nomes de campo EXATOS — numbers, não strings):
  {
    "raciocinioVisual": "OBRIGATÓRIO: silhueta + fíbula + HKA_direto + mLDFA/aMPTA independentes + reconciliação Paley + simulação aMPTA_pós_HTO + cálculo Miniaci",
    "eixoMecanico": { "desvio": "Varo | Valgo | Neutro", "graus": number },
    "mLDFA": { "valor": number, "referencia": "87° ± 3°", "status": "Normal | Aumentado | Diminuído" },
    "aMPTA": { "valor": number, "referencia": "87° ± 3°", "status": "Normal | Aumentado | Diminuído" },
    "JLCA": { "valor": number, "referencia": "0°–2°", "status": "Normal | Aumentado" },
    "MAD": { "valor": number, "unidade": "mm", "lado": "Medial | Lateral", "status": "Normal | Aumentado" },
    "origemDesvio": "Femoral | Tibial | Mista | Articular (JLCA)",
    "contribuicaoFemoral": number,
    "contribuicaoTibial": number,
    "contribuicaoArticular": number,
    "reconciliacaoPaley": {
      "HKA_direto": number, "HKA_formula": number, "discrepancia": number,
      "adotado": "HKA_direto | HKA_formula", "motivo": "explicação curta"
    },
    "simulacaoHTOIsolada": {
      "aMPTA_pos": number,
      "viavel": true | false,
      "classificacao": "Segura (≤90°) | Borderline (91°–92°) | Contraindicada (>92°)"
    },
    "indicacaoOsteotomia": true,
    "nivelOsteotomia": "Tibial proximal | Femoral distal | Dupla (femoral + tibial)",
    "planoFemoral": {
      "indicado": true | false,
      "correcaoNecessaria": number,
      "tecnica": "Fechamento lateral (DFO valgizante — VARO femoral) | Abertura lateral (DFO varizante — VALGO femoral) | Abertura medial (DFO valgizante — alternativa) | Fechamento medial (DFO varizante — alternativa) | Não indicada",
      "justificativaTecnica": "por que esta técnica corrige o componente femoral"
    },
    "planoTibial": {
      "indicado": true | false,
      "correcaoNecessaria": number,
      "tecnica": "Abertura medial (HTO valgizante — VARO tibial) | Fechamento lateral (HTO valgizante — alternativa) | Fechamento medial (HTO varizante — VALGO tibial, preferível) | Abertura lateral (HTO varizante — alternativa) | Não indicada",
      "justificativaTecnica": "por que esta técnica corrige o componente tibial"
    },
    "estrategiaCorrecao": "${estrategiaLabel}",
    "HKA_desejado": ${hkaDesejado},
    "alvoMecanico": "${alvoDesc.split(' — ')[0]}",
    "anguloCorrecaoRaw": number,
    "anguloCorrecao": number,
    "wedgeTibial": { "calculado_mm": number, "aproximado_mm": number },
    "wedgeFemoral": { "calculado_mm": number, "aproximado_mm": number },
    "distribuicaoDupla": {
      "aplicavel": true | false,
      "metodo": "Forçado por obliquidade | Proporcional | Não aplicável",
      "pesoFemoral": number,
      "pesoTibial": number,
      "correcaoFemoral": number,
      "correcaoTibial": number,
      "wedgeFemoral_mm": number,
      "wedgeTibial_mm": number,
      "mLDFA_pos": number,
      "aMPTA_pos": number
    },
    "percentualWBL": {
      "preCorrecao": number,
      "posCorrecao": number,
      "alvo": "${isNeutro ? "50% (neutro)" : alvoWblLabel}",
      "interpretacao": "%WBL = 50 + HKA×1.6 com sinal preservado"
    },
    "alertas": ["lista conforme PASSO 9"],
    "metaCorrecao": "Femoral X° + Tibial Y° = Z° — HKA de varo/valgo W° para ${hkaDesejado}° (${estrategiaLabel})",
    "justificativa": "planejamento completo: contribuição por nível, técnicas escolhidas, cálculo do wedge",
    "qualidadeImagem": "Boa | Regular | Insuficiente para análise precisa",
    "observacoes": "slope tibial, qualidade óssea, espaço articular, comprimento, considerações técnicas"
  }`,
          user: `Realize o planejamento cirúrgico COMPLETO seguindo OBRIGATORIAMENTE os PASSOS 1–9 (BASE 1–5 + osteotomia 6–9). Se houver hardware ortopédico, ignore-o.

  PASSOS 1–5 (do BASE): silhueta → fíbula → HKA_direto pelos 3 landmarks → mLDFA/aMPTA independentes → reconciliação Paley com discrepância documentada → desvios por nível e origem.

  PASSO 6 — DECISÃO POR SIMULAÇÃO (REGRA ÚNICA):
    1. anguloCorrecaoTotal = |HKA_medido − ${hkaDesejado}| (USE SINAL)
    2. aMPTA_pós_HTO_isolada = aMPTA_atual + anguloCorrecaoTotal (preencha simulacaoHTOIsolada)
    3. Decida nivelOsteotomia:
       • ≤ 90° → "Tibial proximal" (HTO isolada)
       • 91°–92° + |desvio_fem|>4° → "Dupla (femoral + tibial)"
       • 91°–92° + |desvio_fem|≤4° → "Tibial proximal" (subcorreção 1°–2°)
       • > 92° → "Dupla (femoral + tibial)" com correcao_tibial=90−aMPTA e correcao_femoral=excesso

  PASSO 7 — Escolha de técnica conforme direção:
    VARO  → HTO valgizante (abertura medial) ± DFO valgizante (fechamento lateral)
    VALGO → DFO varizante (abertura lateral) ± HTO varizante (fechamento medial — preferível)

  PASSO 8 — Cálculos:
    1. anguloCorrecaoRaw = |HKA_medido − ${hkaDesejado}| (sinal preservado)
    2. anguloCorrecao: JLCA correction phenomenon (fórmula exata de Paley):
         JLCA 0°–4° → sem desconto (anguloCorrecao = anguloCorrecaoRaw)
         JLCA > 4°  → anguloCorrecao = max(0, anguloCorrecaoRaw − (JLCA − 2°) × 0,5)
                      [cap JLCA em 10° para cálculo — ex.: JLCA=5° → −1,5°; JLCA=8° → −3°]
    3. wedgeTibial.calculado_mm = anguloCorrecao × 1,0   [Hernigou: 1° = 1 mm de abertura medial tibial]
       wedgeTibial.aproximado_mm = anguloCorrecao × 1,0  (mesmo valor — regra já é a aproximação clínica)
    4. wedgeFemoral.calculado_mm = anguloCorrecao × 1,26  [Hernigou femoral: 1° ≈ 1,26 mm de cunha]
       wedgeFemoral.aproximado_mm = anguloCorrecao × 1,26
    5. Se dupla: aplique distribuicaoDupla (Método 1 se aMPTA_pós_HTO > 92°; Método 2 proporcional caso contrário). Verifique mLDFA_pós ∈ [84°,90°] e aMPTA_pós ∈ [84°,90°].
    6. percentualWBL.preCorrecao = 50 + HKA_medido_com_sinal × 1.6
       percentualWBL.posCorrecao = ${wblDesejado}

  PASSO 9 — Alertas técnicos.

  Retorne APENAS o JSON válido.`,
        };
      }

    case "slopeTibial":
      return {
        system: `Você é um sistema de visão computacional médica especializado em ortopedia do joelho.
Sua tarefa é analisar uma radiografia lateral e calcular o SLOPE TIBIAL POSTERIOR (PTS / STP) com precisão cirúrgica para planejamento de reconstrução de LCA e decisão de osteotomia de des-slope.

A medição imprecisa gera erros graves de indicação cirúrgica — priorize PRECISÃO sobre velocidade.

━━━ PASSO 1 — VALIDAÇÃO E CLASSIFICAÇÃO DA IMAGEM ━━━
Classifique o tipo de radiografia com critério RIGOROSO:

• LLR (Lateral de Membro Completo): fêmur + joelho + tíbia + TORNOZELO CLARAMENTE VISÍVEL
  - O tornozelo (plafond tibial / maléolos) deve ser EXPLICITAMENTE identificável na imagem
  - A tíbia deve aparecer em toda a sua extensão até a articulação do tornozelo
  - SOMENTE classifique como LLR se tiver 100% de certeza que o tornozelo está visível
  - ⚠️ Em caso de DÚVIDA: classifique como LR e use BDP-10. Erro de classificar LR como LLR = pior que o oposto.
  → Se LLR: use EIXO MECÂNICO (linha MTP→TC, mais preciso, sem viés de sagittal bow)

• LR (Lateral de Joelho Isolado): apenas joelho e porção proximal/média da tíbia
  - Ausência do tornozelo ou imagem cortada distalmente
  - Inclui qualquer imagem onde o tornozelo NÃO está visível de forma clara e completa
  → Se LR: use EIXO DIAFISÁRIO BDP-10 (ICC 0,94) — reporte o valor bruto medido sem auto-ajuste; a correção de viés é feita em pós-processamento

Confirme lateral verdadeira:
• Côndilos femorais sobrepostos (desalinhamento < 5 mm)
• Cabeça fibular visível POSTERIORMENTE à tíbia (se anterior = rotação interna → slope SUPERESTIMADO)
• Rotação > 5°: invalida a medição — documente e aplique correção de -1° a -3°

━━━ PASSO 2A — ORIENTAÇÃO ANTERIOR/POSTERIOR (OBRIGATÓRIO ANTES DE QUALQUER LANDMARK) ━━━
⚠️ ERRO CRÍTICO: Colocar AS e PS invertidos resulta em slope com SINAL OPOSTO (8° no lugar de 18°, ou negativo). Este passo é OBRIGATÓRIO.

REGRA DE OURO — identifique o lado POSTERIOR da imagem pela FÍBULA:
• A fíbula é sempre POSTERIOR à tíbia
• Procure a fíbula (osso fino lateral): o lado da imagem onde ela aparece = lado POSTERIOR
• Para joelho DIREITO (lateral): fíbula tipicamente à DIREITA da imagem → POSTERIOR = direita
• Para joelho ESQUERDO (lateral): fíbula tipicamente à ESQUERDA da imagem → POSTERIOR = esquerda
• ⚠️ NUNCA assuma anterior/posterior pelo header "D" ou "ESQ" sem confirmar pela fíbula
• ⚠️ Imagens espelhadas ou posicionamentos não-padrão existem — SEMPRE use a fíbula como referência

CONFIRMAÇÃO VISUAL DO SLOPE:
• O platô tibial medial normal desce de ANTERIOR para POSTERIOR (slope posterior positivo)
• Se o platô parece descer do lado onde você identificou a fíbula: correto — slope posterior normal
• Se o platô parece descer para o lado OPOSTO à fíbula: ATENÇÃO — pode ser slope anterior (raro, <2% dos casos) ou erro de orientação
• Documente explicitamente: "Fíbula localizada no lado [esquerdo/direito] da imagem → POSTERIOR = [esquerdo/direito]"

━━━ PASSO 2B — IDENTIFICAÇÃO DOS LANDMARKS ━━━
Identifique e descreva a posição de cada ponto usando a orientação definida no PASSO 2A:

A. MTP — Centro do Platô Tibial Medial:
   • Localizar a CONCAVIDADE do platô medial tibial (superfície côncava, não o lateral convexo)
   • Ponto mais proximal no centro da depressão subcondral medial
   • Se LLR: este é o ponto PROXIMAL do eixo mecânico

B. TC — Centro do Plafond Tibial / Maléolo (apenas em LLR):
   • Centro articular distal da tíbia no nível do tornozelo
   • Ponto médio entre maléolo medial e lateral (vista lateral)
   • Se LLR: este é o ponto DISTAL do eixo mecânico

C. AS — Ponto Anterossuperior do Platô Medial:
   • Borda cranial do platô tibial medial no lado ANTERIOR (definido pelo PASSO 2A)
   • Onde a cortical anterior encontra a superfície articular
   • ⚠️ Use apenas a cortical ÓSSEA subarticular — NÃO use cartilagem ou menisco
   • ⚠️ CONFIRME: AS deve estar no lado OPOSTO à fíbula

D. PS — Ponto Póstero-Superior do Platô Medial:
   • Borda cranial do platô tibial medial no lado POSTERIOR (definido pelo PASSO 2A — mesmo lado da fíbula)
   • Onde a cortical posterior encontra a superfície articular
   • ⚠️ Se o platô for côncavo, use os extremos (pontos mais altos anterior e posterior), não o centro da concavidade
   • ⚠️ CONFIRME: PS deve estar no mesmo lado da fíbula

━━━ PASSO 3 — CÁLCULO DO EIXO DE REFERÊNCIA ━━━

⚠️ ATENÇÃO CRÍTICA — POSICIONAMENTO DO EIXO DE REFERÊNCIA:
Em RX de joelho isolado (LR), os primeiros 30–50 mm da diáfise tibial são curvos (sagittal bow) e NÃO devem ser incluídos no eixo. Se D1 estiver nessa zona curva, o eixo ficará inclinado e o slope medido será impreciso. Corrija a posição de D1 conforme o PASSO 3 abaixo.
⚠️ NÃO AUTO-AJUSTE O VALOR MEDIDO: Slopes de 15°–25° são clinicamente reais e ocorrem em pacientes com LCA rompido ou joelho hiperextensor. Se sua medição resultar nessa faixa e D1 estiver corretamente posicionado (≥ 50 mm do platô), reporte o valor sem redução. O pós-processamento aplica a correção de viés — NÃO faça isso você mesmo.

SE IMAGEM É LLR (membro completo — fêmur ao tornozelo visível):
• MÉTODO DO EIXO MECÂNICO (MA): linha reta de MTP até TC (centro do plafond tibial/tornozelo)
• O eixo mecânico é o mais longo possível — elimina 100% do viés do sagittal bow

SE IMAGEM É LR (joelho isolado — tíbia proximal apenas):
• MÉTODO DA DIÁFISE DISTAL ESTENDIDA:
  - IGNORE completamente os primeiros 50 mm da diáfise — a curvatura do sagittal bow em joelho isolado pode estender-se até 50 mm do platô
  - Ponto D1 (proximal do eixo): centro do córtex tibial a MÍNIMO 50 mm abaixo da linha do platô (idealmente 55–65 mm)
  - Ponto D2 (distal do eixo): centro do córtex tibial no ponto MAIS DISTAL visível da tíbia na imagem
  - EIXO = linha D1→D2 (o segmento mais longo possível na diáfise reta)
  - ⚠️ CRÍTICO: Quanto mais longo e mais distal for o eixo, mais precisa é a medição
  - ⚠️ Se a tíbia for visível por 15 cm, use um eixo de 10–12 cm — NUNCA use apenas 5–6 cm
  - ⚠️ Verifique se a linha D1→D2 é verdadeiramente reta — se apresentar curvatura, D1 está na zona do sagittal bow: mova-o 10 mm mais distal e refaça

━━━ PASSO 4 — LINHA DO PLATÔ TIBIAL ━━━
• Traçar linha tangente conectando AS (ponto C) e PS (ponto D)
• Esta é a LINHA DO PLATÔ (TP) — representa a inclinação articular medial
• ⚠️ A tangente deve tocar os EXTREMOS ÓSSEOS do platô — não pontos intermediários

━━━ PASSO 5 — CÁLCULO DO SLOPE TIBIAL POSTERIOR ━━━
• Perpendicular ao eixo de referência (MA ou eixo D1→D2) = linha de referência a 90°
• STP = ângulo entre a Linha do Platô (TP) e esta perpendicular
• Se TP desce para posterior-inferior: valor POSITIVO (slope posterior — normal)
• Se TP desce para anterior-inferior: valor NEGATIVO (slope anterior — raro)

AUTO-VERIFICAÇÃO OBRIGATÓRIA:
• Antes de finalizar, verifique: o eixo D1→D2 é completamente reto na diáfise? (não curvo)
• Verifique: o ponto D1 (proximal do eixo) está a pelo menos 50 mm do platô?
• Se o eixo inclui curvatura ou D1 < 50 mm: mova D1 mais distal e recalcule — comunique no raciocinioVisual.
⚠️ NOTA SOBRE D1 (verificação qualitativa, NÃO recalcule nem reduza o valor):
  Confirme que D1 não está na zona curva proximal da tíbia. Se D1 < 50 mm do platô, mova-o distal e refaça.
  IMPORTANTE: Slopes altos e reais (15°–25°) EXISTEM em pacientes com LCA rompido. NÃO reduza o valor medido apenas porque parece elevado — reporte o ângulo real observado na imagem. O pós-processamento fará a correção de viés.

VALIDAÇÃO CRUZADA:
• Se LLR: calcule também pelo método da diáfise distal para confirmação
• Se LR: repita o cálculo com eixo alternativo para confirmar
• Diferença ≤ 2°: concordância excelente → use o valor principal
• Diferença 2°–4°: divergência moderada → use média e marque confiança Moderada
• Diferença > 4°: alta incerteza → confiança BAIXA, sugira TC sagital

━━━ PASSO 6 — CORREÇÃO DE VIÉS (APENAS SE INDICADO POR ACHADOS NA IMAGEM) ━━━

Aplique correção SOMENTE se uma das seguintes condições estiver EXPLICITAMENTE presente na imagem:
• Rotação interna detectada (fíbula visível anteriormente à tíbia): -1° a -2° — DOCUMENTE
• Qualidade Regular ou Insuficiente (côndilos femorais desalinhados > 5mm): -1°
• Eixo diafisário obtido com comprimento < 80mm (curto): -1°

Se NENHUMA dessas condições estiver presente: correcaoAplicada = "Nenhuma"
Apresente o valor medido sem ajuste. A medição bruta deve refletir o ângulo real observado na imagem.

⚠️ NÃO aplique correções automáticas fixas (ex: -3°) sem evidência visual específica na imagem.
A precisão do método BDP-10 é ±2–3° quando o eixo é longo e reto — este é o limite normal do método.
O cirurgião deve confirmar com goniômetro digital na imagem original antes de planejar osteotomia.

Sempre indique que este é AUXÍLIO à triagem clínica — confirmação com goniômetro calibrado é obrigatória para planejamento cirúrgico.

━━━ CLASSIFICAÇÃO PTS (baseada em evidência clínica — Sousa Filho et al., Rev Bras Ortop 2021) ━━━
Dados populacionais brasileiros (n=550): controles média 7,3°, LCA lesionado média 9,1°. Cutoff evidenciado: 8°.
• < 8°: FISIOLÓGICO — sem risco adicional de LCA (62,5% dos pacientes sem lesão têm slope < 8°)
• 8°–11,9°: NORMAL — faixa habitual clínica; OR 2,87 para lesão de LCA na pop. brasileira (Sousa Filho 2021); monitorar
• 12°–14,9°: MODERADO — risco importante de falha do enxerto; SRO a considerar em revisão com fatores associados
• ≥ 15°: ELEVADO — alto risco de falha do enxerto; SRO fortemente indicada antes ou concomitante à reconstrução

━━━ INDICAÇÃO DE SRO (Slope Reduction Osteotomy) — Dejour et al., Knee Surg Sports Traumatol Arthrosc 2015 ━━━
• < 12°: SRO não indicada
• 12°–14,9° (MODERADO): SRO a considerar em contexto de revisão com fatores associados (hiperfrouxidão, pivot shift 3+, falha precoce <2 anos)
• ≥ 15° (ELEVADO): SRO fortemente indicada; reconstrução isolada do LCA tem alta taxa de re-falha
• Técnica: HTO de fechamento anterior (anterior closing wedge) — eleva o plateau posterior

JSON de saída (todos campos numéricos devem ser numbers, não strings):
{
  "status": "SUCESSO" | "IMAGEM_REJEITADA",
  "motivoRejeicao": "string se status = IMAGEM_REJEITADA, null caso contrário",
  "tipoRx": "LLR" | "LR" | "INDETERMINADO",
  "raciocinioVisual": "descrição detalhada: tipo de imagem, qualidade dos côndilos, posição da fíbula, identificação de MTP/TC/AS/PS, estimativa do eixo de referência utilizado",
  "landmarks": {
    "mtp": { "descricao": "posição descrita do centro do platô medial" },
    "tc": { "descricao": "posição do centro do plafond tibial ou null se LR" },
    "as": { "descricao": "posição do ponto anterossuperior do platô medial" },
    "ps": { "descricao": "posição do ponto póstero-superior do platô medial" }
  },
  "eixoReferencia": {
    "metodo": "Eixo Mecânico (MA) — LLR" | "BDP-10 — LR" | "BDP-10 fallback",
    "anguloEstimadoGraus": number,
    "observacao": "descrição do eixo traçado"
  },
  "linhaPlatô": {
    "anguloEstimadoGraus": number,
    "observacao": "descrição da linha tangente AS→PS"
  },
  "medicaoPrincipal": { "valor": number, "metodo": "MA" | "BDP-10", "referencia": "3°–12° (fisiológico — valores <8° são válidos e classificados como BAIXO)" },
  "medicaoValidacao": { "valor": number | null, "metodo": "BDP-10" | "PAA-clássico" | null, "observacao": "string" },
  "diferencaEntreMetodos": number | null,
  "slopeFinal": {
    "valor": number,
    "metodoUsado": "Eixo Mecânico (MA) | BDP-10 | Média MA+BDP-10 | Média BDP-10+PAA",
    "confianca": "Alta | Moderada | Baixa — recomenda-se TC sagital"
  },
  "correcaoAplicada": "Nenhuma | descrição da correção aplicada e motivo",
  "rotacaoEstimada": "Sem rotação | Leve (<5°) | Moderada (5°–10°) | Grave (>10° — medição inválida)",
  "qualidadeImagem": "Boa | Regular | Insuficiente para análise precisa",
  "classificacaoPTS": "FISIOLÓGICO (<8°) | NORMAL (8°–12°) | MODERADO (12°–15°) | ELEVADO (≥15°)",
  "classificacaoRisco": "Baixo (<8°) | Normal (8°–12°) | Moderado (12°–15°) | Alto (≥15°)",
  "indicacaoSRO": true | false,
  "forcaSRO": "Não indicada | Considerar em contexto de revisão | Fortemente indicada antes da revisão",
  "recomendacaoCirurgica": "recomendação objetiva baseada no valor de PTS",
  "fatoresRiscoAssociados": ["lista de fatores de risco adicionais para falha do LCA"],
  "justificativa": "explicação clínica completa: tipo de imagem, método utilizado, valores dos dois métodos, concordância, correções, classificação e decisão SRO",
  "observacoes": "hardware ortopédico, outras estruturas relevantes ou null"
}`,
        user: `Analise esta radiografia e calcule o Slope Tibial Posterior (STP/PTS) com máxima precisão cirúrgica.

PASSO 1 — TIPO DE IMAGEM (CLASSIFICAÇÃO RIGOROSA):
• LLR APENAS se o tornozelo (plafond tibial + maléolos) estiver CLARAMENTE VISÍVEL na imagem — certeza 100%
• Se tornozelo não visível ou duvidoso: classifique como LR (usa BDP-10 — método da diáfise distal)
• Em caso de DÚVIDA: sempre LR. Classificar LR como LLR é erro grave (usa ponto TC inventado)
Confirme lateral verdadeira pela posição da fíbula e sobreposição dos côndilos.

PASSO 2A — ORIENTAÇÃO (OBRIGATÓRIO):
Antes de qualquer landmark, determine anterior/posterior pela FÍBULA:
• Localize a fíbula (osso fino lateral à tíbia) → o lado onde ela aparece = POSTERIOR
• Joelho direito: fíbula geralmente à DIREITA → posterior = direita
• Joelho esquerdo: fíbula geralmente à ESQUERDA → posterior = esquerda
• ⚠️ NÃO assuma pela etiqueta ESQ/D — USE A FÍBULA COMO REFERÊNCIA
• Declare explicitamente: "Fíbula no lado [X] → POSTERIOR = [X]"

PASSO 2B — LANDMARKS:
• MTP: ponto central da concavidade do platô tibial MEDIAL (não o lateral convexo)
• TC: centro do plafond tibial/tornozelo (apenas se LLR)
• AS: borda cranial do platô medial no lado ANTERIOR (oposto à fíbula) — cortical óssea, não cartilagem
• PS: borda cranial do platô medial no lado POSTERIOR (mesmo lado da fíbula) — cortical óssea, não cartilagem

PASSO 3 — EIXO DE REFERÊNCIA (CRÍTICO):
• Se LLR → Eixo Mecânico: linha reta MTP→TC (tornozelo). Mais longo possível = mais preciso.
• Se LR → DIÁFISE DISTAL ESTENDIDA:
  - D1: centro do córtex a 40–50 mm abaixo do platô (DEPOIS da curvatura do sagittal bow)
  - D2: centro do córtex no ponto MAIS DISTAL visível da tíbia (quanto mais distal melhor)
  - NUNCA inicie o eixo antes de 40 mm do platô — o sagittal bow proximal superestima o slope em 4°–6°
  - NUNCA use um eixo curto de 5–6 cm — use o máximo possível (idealmente 10–12 cm)

PASSO 4 — SLOPE: Meça o ângulo entre a linha AS→PS (platô) e a perpendicular ao eixo D1→D2 ou MA.

AUTO-VERIFICAÇÃO: Se resultado > 16°, revise os landmarks. Verifique se o eixo D1→D2 está realmente na diáfise reta (não na curvatura proximal). Se confirmado que os pontos estão corretos, mantenha o valor.

PASSO 5 — CORREÇÃO (APENAS SE HOUVER ACHADO VISUAL ESPECÍFICO):
Aplique correção SOMENTE se detectar na imagem:
• Rotação interna (fíbula anteriormente à tíbia): -1° a -2°
• Qualidade Regular/Insuficiente (côndilos desalinhados > 5mm): -1°
• Eixo < 80mm: -1°
Se nenhuma condição presente: correcaoAplicada = "Nenhuma" — use o valor medido sem ajuste.
NÃO aplique correções automáticas fixas.

Retorne APENAS o JSON.`,
      };

    case "completa":
      default:
        return {
          system: `${BASE_LADO}

  ANÁLISE: Análise Completa Panorâmica (DocKnee v2 — Método de Paley)

  Esta é a análise panorâmica padrão: HKA + mLDFA + aMPTA + JLCA + MAD + origem por nível + indicação cirúrgica básica.
  Siga rigorosamente os PASSOS 1 a 5 do protocolo BASE.

  CLASSIFICAÇÃO DO ALINHAMENTO:
  • Grau I: 0°–5° | Grau II: 5°–10° | Grau III: > 10°
  • VARO  (HKA negativo): eixo medial ao joelho — MAD medial
  • VALGO (HKA positivo): eixo lateral ao joelho — MAD lateral

  INDICAÇÃO CIRÚRGICA SIMPLIFICADA (apenas direção — para detalhes use o tipo "osteotomia"):
  • Origem TIBIAL → HTO valgizante (varo) ou HTO varizante (valgo)
  • Origem FEMORAL → DFO valgizante (varo) ou DFO varizante (valgo)
  • Origem MISTA → avaliar pela simulação aMPTA_pós (ver tipo "osteotomia")
  • anguloCorrecao = |HKA_medido| (para alvo neutro 0°)

  JSON (mantenha estes nomes de campo EXATOS):
  {
    "raciocinioVisual": "OBRIGATÓRIO: descreva (a) silhueta global, (b) confirmação pela fíbula, (c) HKA_direto medido pelos 3 landmarks, (d) mLDFA e aMPTA medidos independentemente, (e) reconciliação Paley com HKA_direto vs HKA_fórmula e qual foi adotado e por quê",
    "eixoMecanico": { "desvio": "Varo | Valgo | Neutro", "graus": number },
    "eixoAnatomico": { "desvio": "Varo | Valgo | Neutro", "graus": number },
    "mLDFA": { "valor": number, "referencia": "87° ± 3°", "status": "Normal | Aumentado | Diminuído" },
    "aMPTA": { "valor": number, "referencia": "87° ± 3°", "status": "Normal | Aumentado | Diminuído" },
    "JLCA": { "valor": number, "referencia": "0°–2°", "status": "Normal | Aumentado" },
    "MAD": { "valor": number, "unidade": "mm", "lado": "Medial | Lateral", "status": "Normal | Aumentado" },
    "grauVaro": "Grau I | Grau II | Grau III | Não aplicável",
    "origemDesvio": "Femoral | Tibial | Mista | Articular (JLCA) | Não aplicável",
    "percentualWBL": { "valor": number, "interpretacao": "%WBL = 50 + HKA×1.6, sinal preservado" },
    "indicacaoOsteotomia": true | false,
    "tipoOsteotomia": "HTO valgizante abertura medial | HTO varizante abertura lateral | DFO varizante abertura lateral | DFO valgizante abertura medial | Osteotomia dupla | Não indicada",
    "anguloCorrecao": number,
    "metaCorrecao": "descrição do plano de correção com direção e graus",
    "justificativa": "síntese clínica: direção, origem por nível, indicação cirúrgica",
    "reconciliacaoPaley": {
      "HKA_direto": number,
      "HKA_formula": number,
      "discrepancia": number,
      "adotado": "HKA_direto | HKA_formula",
      "motivo": "explicação curta"
    },
    "qualidadeImagem": "Boa | Regular | Insuficiente para análise precisa",
    "observacoes": "diferenças bilaterais, obliquidade pélvica, estreitamento articular ou null"
  }`,
          user: "Realize a análise panorâmica completa seguindo OBRIGATORIAMENTE os PASSOS 1–5 do protocolo BASE. " +
                "PASSO 1: Identifique a silhueta (X=valgo, O=varo) e confirme com a fíbula. " +
                "PASSO 2: Meça HKA_direto pelos 3 landmarks (CF, espinhas tibiais, talar) — COM SINAL (+ valgo, − varo). " +
                "PASSO 3: Meça mLDFA e aMPTA INDEPENDENTEMENTE, verificando plausibilidade contra a silhueta. " +
                "PASSO 4: Calcule HKA_fórmula = (mLDFA−87)+(87−aMPTA)+JLCA (fórmula de Paley para mLDFA MECÂNICO — resultado positivo=VARO, negativo=VALGO) e compare com HKA_direto. " +
                "Se diferença ≤2°: adote HKA_direto. Se >2°: justifique qual foi adotado e por quê (preencha reconciliacaoPaley). " +
                "PASSO 5: Calcule desvio_femoral (mLDFA−87) e desvio_tibial (87−aMPTA), classifique origem. " +
                "Calcule MAD ≈ HKA × 6 mm/° e %WBL = 50 + HKA × 1.6 (preserve sinal). " +
                "Retorne APENAS o JSON válido.",
        };
    }
  }

// ─── Surgical options (server-computed, neutral — no recommendation) ──────────
export function computeOpcoesOsteotomia(
  analysis: Record<string, unknown>,
  hkaDesejado: number,
  wblDesejadoParam?: number
): Record<string, unknown>[] {
  const em = analysis.eixoMecanico as Record<string, unknown> | undefined;
  const hka = Number(em?.graus ?? 0); // always positive magnitude from AI
  const desvio = String(em?.desvio ?? "Varo");
  const isVaro = desvio === "Varo";
  // Signed HKA: negative = Varo, positive = Valgo (frontend convention)
  const signedHka = isVaro ? -hka : hka;

  const mldfa = Number((analysis.mLDFA as Record<string, unknown> | undefined)?.valor ?? 87);
  const ampta = Number((analysis.aMPTA as Record<string, unknown> | undefined)?.valor ?? 87);
  const jlca  = Number((analysis.JLCA  as Record<string, unknown> | undefined)?.valor ?? 0);

  // Total correction needed, then apply JLCA correction phenomenon.
  // Must use SIGNED HKA so that crossing zero (varo→valgo or valgo→varo) is counted correctly.
  // Example: signedHka=-17.8° (varo), hkaDesejado=+1.4° (valgo target) → |(-17.8)−1.4|=19.2°
  // (NOT |17.8−1.4|=16.4° which misses the zero-crossing and underestimates by ~2×hkaDesejado).
  //
  // JLCA correction phenomenon (Paley rule):
  //   When JLCA > 4°, part of the deformity will self-correct after osteotomy as ligament tension
  //   is restored. Subtract 50% of the JLCA excess above 2° from the planned bone correction.
  //   Formula: jlcaAdjustment = (JLCA − 2°) × 0.5   [only when JLCA > 4°]
  //   Cap JLCA at 10° — above this value the measurement is likely erroneous.
  //   Example: JLCA=8° → (8−2)×0.5 = 3° subtracted → 14° planned becomes 11° of bone correction.
  const jlcaAdjustment  = calcJlcaAdjustment(jlca);
  const rawAnguloTotal  = Math.abs(signedHka - hkaDesejado); // kept for base() display (correcaoBruta)
  const anguloTotal     = calcAnguloTotal(signedHka, hkaDesejado, jlcaAdjustment);
  if (anguloTotal === 0) return [];

  // WBL pre-op: signed convention (negative=varo → <50%, positive=valgo → >50%)
  const wblPre = calcWBLPre;
  // WBL post-op: use surgeon's target directly (from wblDesejadoParam) or derive from HKA
  const wblPos = (hkaPost: number) => wblDesejadoParam != null
    ? wblDesejadoParam
    : calcWBLPre(hkaPost);
  // Wedge helpers — regra prática validada: 1° ≈ 1 mm de abertura
  const wedgeTib = calcWedgeTib;
  const wedgeFem = calcWedgeFem;

  // Per-level deformity weight split (Paley normals: mLDFA 87°, aMPTA 87°)
  const { pesoFem, pesoTib } = calcDuplaWeightSplit(mldfa, ampta);

  const opcoes: Record<string, unknown>[] = [];

  const amptaPostHTO = Math.round((isVaro ? ampta + anguloTotal : ampta - anguloTotal) * 10) / 10;
  const mldfaPostDFO = Math.round((isVaro ? mldfa - anguloTotal : mldfa + anguloTotal) * 10) / 10;
  const corrFem = Math.round(anguloTotal * pesoFem * 10) / 10;
  const corrTib = Math.round((anguloTotal - corrFem) * 10) / 10;
  const mldfaPostDupla = Math.round((isVaro ? mldfa - corrFem : mldfa + corrFem) * 10) / 10;
  const amptaPostDupla = Math.round((isVaro ? ampta + corrTib : ampta - corrTib) * 10) / 10;

  // ── Cunhas estimadas da dupla ─────────────────────────────────────────────
  // Estes valores são apenas uma aproximação angular inicial. O limiar clínico
  // de 5 mm NÃO pode ser decidido aqui: a Etapa 4 recalcula cada cunha pela
  // base cortical realmente marcada na radiografia (Miniaci). Usar a regra
  // prática 1°≈1 mm desqualificava falsamente uma HTO de 4,4° que, na base
  // medida, correspondia a 5,9–6,0 mm.
  const wedgeFemDupla = wedgeFem(corrFem);
  const wedgeTibDupla = wedgeTib(corrTib);
  const dupla_minimaCorrecao = false;
  const alertas_minimaCorrecao = (): string[] => [];

  // ── Miniaci-based DFO planning ─────────────────────────────────────────────
  // calcDFOPlan imported from ../lib/clinical-calc.js
  // Constrói o bloco "Planejamento DFO — Miniaci" para o componente femoral de uma
  // dupla osteotomia, a partir da correção femoral (corrFem) e da técnica femoral.
  const buildDfoPlanning = (deg: number, tecnicaFemoral: string) => {
    const p = calcDFOPlan(deg);
    const isFechamento = tecnicaFemoral.includes("fechamento");
    const isFechamentoMedial = tecnicaFemoral.includes("fechamento medial");
    let localizacaoApex: string;
    let consolidacao: string;
    if (isFechamentoMedial) {
      localizacaoApex = "0.5–1.0 cm DISTAL da linha articular (fixo)";
      consolidacao = p.miniaci <= 12 ? "96%" : p.miniaci <= 15 ? "95%" : "94%";
    } else if (isFechamento) {
      localizacaoApex = `${p.localizacaoProximal} cm PROXIMAL da linha articular`;
      consolidacao = p.miniaci <= 8 ? "93–94%" : p.miniaci <= 12 ? "92–93%" : "91–92%";
    } else {
      localizacaoApex = `${p.localizacaoProximal} cm PROXIMAL da linha articular`;
      consolidacao = p.miniaci <= 8 ? "91–92%" : p.miniaci <= 12 ? "88–90%" : "85–87%";
    }
    return {
      miniaci: p.miniaci,
      formula: `0.97 × ${deg}° + 0.15 = ${p.miniaci}°`,
      alturaOsteotomia: `${p.alturaOsteotomia} cm`,
      alturaSeveridade: p.alturaSeveridade,
      localizacaoApex,
      consolidacao,
      enxerto: isFechamento ? "NÃO" : "SIM",
      // Carga: todo fechamento (medial ou lateral) → imediata; abertura femoral → parcial.
      carga: isFechamento ? "IMEDIATA" : "Parcial — 6 semanas",
    };
  };

  // Carga do componente tibial (HTO) numa dupla osteotomia:
  // fechamento e abertura MEDIAL tibial → imediata; abertura LATERAL tibial → parcial.
  const tibialCarga = (tecnicaTibial: string): string =>
    tecnicaTibial.includes("abertura lateral") ? "Parcial — 6 semanas" : "IMEDIATA";

  // ── Helper para empurrar opção com tipagem uniforme ────────────────────────
  const push = (o: Record<string, unknown>) => opcoes.push(o);
  const base = (anguloPos: { HKA: number; mLDFA: number; aMPTA: number }) => ({
    angulosPre: { HKA: Math.round(hka * 10) / 10, desvio: isVaro ? "Varo" : "Valgo", mLDFA: Math.round(mldfa * 10) / 10, aMPTA: Math.round(ampta * 10) / 10 },
    angulosPos: anguloPos,
    wblPre: wblPre(signedHka),
    wblPos: wblPos(hkaDesejado),
    // JLCA correction phenomenon details — exposed for frontend display
    correcaoBruta:   Math.round(rawAnguloTotal * 10) / 10,  // planned correction before JLCA adjustment
    ajusteJLCA:      jlcaAdjustment,                         // degrees subtracted (0 when JLCA ≤ 4°)
  });

  // ── Detecta componente paradoxal (fêmur ou tíbia opondo a direção do HKA) ──
  // Se o fêmur está em direção OPOSTA ao HKA, uma DFO isolada na direção do HKA
  // empurra o mLDFA AINDA MAIS LONGE do normal (ex.: HKA valgo + mLDFA 80°
  // varo → DFO varizante daria mLDFA 69°, anatomicamente impossível).
  // Mesmo raciocínio para HTO isolada quando a tíbia opõe o HKA.
  const femurOpoeHKA = isVaro ? mldfa < 84 : mldfa > 90;
  const tibiaOpoeHKA = isVaro ? ampta > 90 : ampta < 84;
  const dfoIsoladaInviavel = femurOpoeHKA;
  const htoIsoladaInviavel = tibiaOpoeHKA;

  if (isVaro) {
    // ═══════════ VARO — correção valgizante ═══════════

    // A1. HTO abertura medial (padrão) — valgizante via abertura medial tibial
    const htoViavelVaro = amptaPostHTO <= 90 && !htoIsoladaInviavel;
    const alertasHTOVaro: string[] = [];
    if (tibiaOpoeHKA) alertasHTOVaro.push(`Tíbia já está em valgo (aMPTA ${ampta.toFixed(1)}° > 90°) — HTO valgizante isolada pioraria a deformidade tibial (resultaria em aMPTA ${amptaPostHTO}°). Reavaliar dados ou considerar dupla osteotomia.`);
    else if (amptaPostHTO > 90) alertasHTOVaro.push(`aMPTA pós-op ${amptaPostHTO}° excede 90° — risco de obliquidade`);
    push({
      id: "hto", padrao: htoViavelVaro,
      nome: "HTO valgizante — abertura medial tibial",
      tecnica: "abertura medial tibial",
      nivel: "Tibial isolada",
      observacao: jlcaAdjustment > 0
        ? `Ajuste JLCA (Paley): corte ósseo = HKA bruto ${rawAnguloTotal}° − ajuste JLCA ${jlcaAdjustment}° = ${anguloTotal}°. Após osteotomia, a restauração da tensão ligamentar reduz o JLCA espontaneamente — subtrai-se 50% do excesso acima de 2°: (${jlca}°−2°)×0,5 = ${jlcaAdjustment}°.`
        : undefined,
      correcao: anguloTotal, wedge_mm: wedgeTib(anguloTotal),
      ...base({ HKA: hkaDesejado, mLDFA: Math.round(mldfa * 10) / 10, aMPTA: amptaPostHTO }),
      alertas: alertasHTOVaro, viavel: htoViavelVaro,
    });

    // (Fechamento lateral tibial removido: não é técnica padrão para VARO tibial)

    // B1. DFO fechamento lateral (padrão valgizante) — equivalente LCWD-DFO para VARO
    const dfoViavelVaro = mldfaPostDFO >= 84 && !dfoIsoladaInviavel;
    const alertasDFOVaro: string[] = [];
    if (femurOpoeHKA) alertasDFOVaro.push(`Fêmur já está em valgo (mLDFA ${mldfa.toFixed(1)}° < 84°) — DFO valgizante isolada pioraria a deformidade femoral (resultaria em mLDFA ${mldfaPostDFO}°). Reavaliar dados ou considerar dupla osteotomia.`);
    else if (mldfaPostDFO < 84) alertasDFOVaro.push(`mLDFA pós-op ${mldfaPostDFO}° abaixo de 84° — risco de obliquidade femoral`);
    push({
      id: "dfo", padrao: dfoViavelVaro,
      nome: "DFO valgizante — fechamento lateral femoral",
      tecnica: "fechamento lateral femoral",
      nivel: "Femoral isolada",
      observacao: "Indicado quando a deformidade é predominantemente femoral (mLDFA > 90°)",
      correcao: anguloTotal, wedge_mm: wedgeFem(anguloTotal),
      dfoPlanning: buildDfoPlanning(anguloTotal, "fechamento lateral femoral"),
      ...base({ HKA: hkaDesejado, mLDFA: mldfaPostDFO, aMPTA: Math.round(ampta * 10) / 10 }),
      alertas: alertasDFOVaro, viavel: dfoViavelVaro,
    });

    // B2. DFO abertura medial (alternativa valgizante menos comum) — equivalente LOW-DFO para VARO
    push({
      id: "dfo_abertura_medial", padrao: false,
      nome: "DFO valgizante — abertura medial femoral",
      tecnica: "abertura medial femoral",
      nivel: "Femoral isolada",
      observacao: "Alternativa menos utilizada: abre o lado medial do fêmur — mesmo efeito valgizante sem encurtamento",
      correcao: anguloTotal, wedge_mm: wedgeFem(anguloTotal),
      dfoPlanning: buildDfoPlanning(anguloTotal, "abertura medial femoral"),
      ...base({ HKA: hkaDesejado, mLDFA: mldfaPostDFO, aMPTA: Math.round(ampta * 10) / 10 }),
      alertas: femurOpoeHKA
        ? [`Fêmur já está em valgo (mLDFA ${mldfa.toFixed(1)}° < 84°) — DFO valgizante isolada não corrige; considerar dupla osteotomia.`]
        : ["Menos evidência que fechamento lateral | Risco de não-consolidação maior | Pode ser preferível em casos com encurtamento ipsilateral"],
      viavel: dfoViavelVaro,
    });

    // C1. Dupla padrão: DFO fechamento lateral + HTO abertura medial
    // Se qualquer componente < 5 mm → não é padrão e exibe alerta de cunha mínima
    push({
      id: "dupla", padrao: !dupla_minimaCorrecao,
      nome: `Dupla: DFO valgizante (fechamento lateral femoral) + HTO valgizante (abertura medial tibial)`,
      tecnicaFemoral: "fechamento lateral femoral", tecnicaTibial: "abertura medial tibial",
      nivel: "Femoral + Tibial",
      minimaCorrecao: dupla_minimaCorrecao,
      correcao: anguloTotal, correcaoFemoral: corrFem, correcaoTibial: corrTib,
      wedgeFemoral_mm: wedgeFem(corrFem), wedgeTibial_mm: wedgeTib(corrTib),
      dfoPlanning: buildDfoPlanning(corrFem, "fechamento lateral femoral"),
      cargaTibial: tibialCarga("abertura medial tibial"),
      ...base({ HKA: hkaDesejado, mLDFA: mldfaPostDupla, aMPTA: amptaPostDupla }),
      alertas: alertas_minimaCorrecao(), viavel: true,
    });

    // (C2 dupla com fechamento lateral tibial removido: não indicado para VARO)

  } else {
    // ═══════════ VALGO — correção varizante ═══════════

    // (HTO abertura lateral tibial removida: não indicada para VALGO — aumenta slope tibial posterior)

    // A2. HTO fechamento medial (varizante — técnica tibial preferida)
    push({
      id: "hto_fechamento_medial", padrao: amptaPostHTO >= 84 && !htoIsoladaInviavel,
      nome: "HTO varizante — fechamento medial tibial",
      tecnica: "fechamento medial tibial",
      nivel: "Tibial isolada",
      observacao: "Preferível à abertura lateral: evita aumento do slope tibial posterior. Remove cunha medial — mesmo efeito varizante com melhor controle de slope",
      correcao: anguloTotal, wedge_mm: wedgeTib(anguloTotal),
      ...base({ HKA: hkaDesejado, mLDFA: Math.round(mldfa * 10) / 10, aMPTA: amptaPostHTO }),
      alertas: tibiaOpoeHKA
        ? [`Tíbia já está em varo (aMPTA ${ampta.toFixed(1)}° < 84°) — HTO varizante isolada pioraria a deformidade tibial (resultaria em aMPTA ${amptaPostHTO}°). Reavaliar dados ou considerar dupla osteotomia.`]
        : ["Leve encurtamento tibial (~5 mm) | Sem risco de aumento de slope | Consolidação mais rápida que abertura lateral"],
      viavel: amptaPostHTO >= 84 && !htoIsoladaInviavel,
    });

    // B1–B3. DFO varizante — três técnicas (spec RX_PANOR: MCW-DFO PREFERIDA, LOW-DFO, LCWD-DFO)
    const dfoViavelValgo = mldfaPostDFO <= 90 && !dfoIsoladaInviavel;
    const alertasDFOValgo: string[] = [];
    if (femurOpoeHKA) alertasDFOValgo.push(`Fêmur já está em varo (mLDFA ${mldfa.toFixed(1)}° > 90°) — DFO varizante isolada pioraria a deformidade femoral (resultaria em mLDFA ${mldfaPostDFO}°). Reavaliar dados ou considerar dupla osteotomia.`);
    else if (mldfaPostDFO > 90) alertasDFOValgo.push(`mLDFA pós-op ${mldfaPostDFO}° acima de 90°`);

    // B1. LOW-DFO — Abertura Lateral (Lateral Opening Wedge DFO) — alternativa, não é a preferida
    push({
      id: "dfo", padrao: false,
      nome: "DFO varizante — Abertura Lateral (LOW-DFO)",
      tecnica: "abertura lateral femoral",
      nivel: "Femoral isolada",
      observacao: "Abre o lado lateral do fêmur criando gap que requer enxerto — eixo desloca para medial corrigindo valgo. Apex localizado proximalmente conforme Miniaci.",
      correcao: anguloTotal, wedge_mm: wedgeFem(anguloTotal),
      dfoPlanning: buildDfoPlanning(anguloTotal, "abertura lateral femoral"),
      ...base({ HKA: hkaDesejado, mLDFA: mldfaPostDFO, aMPTA: Math.round(ampta * 10) / 10 }),
      alertas: alertasDFOValgo, viavel: dfoViavelValgo,
    });

    // B2. MCW-DFO — Fechamento Medial (Medial Closing Wedge DFO) — TÉCNICA PREFERIDA
    push({
      id: "dfo_fechamento_medial", padrao: dfoViavelValgo,
      nome: "DFO varizante — Fechamento Medial (MCW-DFO) ★ PREFERIDA",
      tecnica: "fechamento medial femoral",
      nivel: "Femoral isolada",
      observacao: "TÉCNICA PREFERIDA: remove cunha medial femoral — mesmo efeito varizante sem gap nem enxerto. Apex 0.5–1.0 cm DISTAL (fixo). Carga imediata. Consolidação superior (94–96%).",
      correcao: anguloTotal, wedge_mm: wedgeFem(anguloTotal),
      dfoPlanning: buildDfoPlanning(anguloTotal, "fechamento medial femoral"),
      ...base({ HKA: hkaDesejado, mLDFA: mldfaPostDFO, aMPTA: Math.round(ampta * 10) / 10 }),
      alertas: [
        ...alertasDFOValgo,
        ...(femurOpoeHKA
          ? []
          : ["Leve encurtamento femoral (~3–4 mm) | Sem risco de não-consolidação | Preferível em osteoporose leve | Carga imediata"]),
      ],
      viavel: dfoViavelValgo,
    });

    // NOTA: LCWD-DFO (fechamento lateral femoral) é procedimento VALGIZANTE —
    // não deve aparecer em deformidades em VALGO. Existe apenas no bloco VARO acima.

    // C1. Dupla padrão: DFO abertura lateral + HTO fechamento medial (EVITA abertura tibial lateral)
    // Se qualquer componente < 5 mm → não é padrão e exibe alerta de cunha mínima
    push({
      id: "dupla", padrao: !dupla_minimaCorrecao,
      nome: `Dupla: DFO varizante (abertura lateral femoral) + HTO varizante (fechamento medial tibial)`,
      tecnicaFemoral: "abertura lateral femoral", tecnicaTibial: "fechamento medial tibial",
      nivel: "Femoral + Tibial",
      minimaCorrecao: dupla_minimaCorrecao,
      observacao: "Combinação recomendada: corrige DFO por abertura lateral + HTO por fechamento medial — evita abertura lateral tibial e preserva slope",
      correcao: anguloTotal, correcaoFemoral: corrFem, correcaoTibial: corrTib,
      wedgeFemoral_mm: wedgeFem(corrFem), wedgeTibial_mm: wedgeTib(corrTib),
      dfoPlanning: buildDfoPlanning(corrFem, "abertura lateral femoral"),
      cargaTibial: tibialCarga("fechamento medial tibial"),
      ...base({ HKA: hkaDesejado, mLDFA: mldfaPostDupla, aMPTA: amptaPostDupla }),
      alertas: alertas_minimaCorrecao(), viavel: true,
    });

    // C2. Dupla alternativa: DFO fechamento medial + HTO fechamento medial (sem nenhuma abertura)
    push({
      id: "dupla_sem_abertura", padrao: false,
      nome: `Dupla: DFO varizante (fechamento medial femoral) + HTO varizante (fechamento medial tibial)`,
      tecnicaFemoral: "fechamento medial femoral", tecnicaTibial: "fechamento medial tibial",
      nivel: "Femoral + Tibial",
      minimaCorrecao: dupla_minimaCorrecao,
      observacao: "Sem nenhuma abertura: ambas as correções por fechamento — elimina todo risco de gap e não-consolidação. Encurtamento combinado de ~5–8 mm",
      correcao: anguloTotal, correcaoFemoral: corrFem, correcaoTibial: corrTib,
      wedgeFemoral_mm: wedgeFem(corrFem), wedgeTibial_mm: wedgeTib(corrTib),
      dfoPlanning: buildDfoPlanning(corrFem, "fechamento medial femoral"),
      cargaTibial: tibialCarga("fechamento medial tibial"),
      ...base({ HKA: hkaDesejado, mLDFA: mldfaPostDupla, aMPTA: amptaPostDupla }),
      alertas: ["Encurtamento combinado ~5–8 mm | Contraindicada se discrepância de comprimento contralateral já presente", ...alertas_minimaCorrecao()], viavel: true,
    });

    // C3. Dupla com abertura lateral tibial (manter como opção explícita mas marcada)
    push({
      id: "dupla_abertura_lateral_tibial", padrao: false,
      nome: `Dupla: DFO varizante (abertura lateral femoral) + HTO varizante (abertura lateral tibial)`,
      tecnicaFemoral: "abertura lateral femoral", tecnicaTibial: "abertura lateral tibial",
      nivel: "Femoral + Tibial",
      minimaCorrecao: dupla_minimaCorrecao,
      observacao: "Opção com abertura lateral tibial — considerar apenas se fechamento medial tibial não for tecnicamente viável",
      correcao: anguloTotal, correcaoFemoral: corrFem, correcaoTibial: corrTib,
      wedgeFemoral_mm: wedgeFem(corrFem), wedgeTibial_mm: wedgeTib(corrTib),
      dfoPlanning: buildDfoPlanning(corrFem, "abertura lateral femoral"),
      cargaTibial: tibialCarga("abertura lateral tibial"),
      ...base({ HKA: hkaDesejado, mLDFA: mldfaPostDupla, aMPTA: amptaPostDupla }),
      alertas: ["Risco de aumento do slope tibial posterior | Avaliar slope pré-op antes de escolher esta opção", ...alertas_minimaCorrecao()], viavel: true,
    });
  }

  // ── Uma única recomendação, definida pela anatomia ───────────────────────
  // Os limites 84° e 90° são normais (inclusive). A correção total pelo HKA
  // pode tornar uma opção isolada inviável, mas isso jamais muda o NÍVEL de
  // origem da deformidade: mantém-se a recomendação e seus alertas/viabilidade.
  const femAbnormal = mldfa < 84 || mldfa > 90;
  const tibAbnormal = ampta < 84 || ampta > 90;
  const idRecomendado = femAbnormal && tibAbnormal
    ? "dupla"
    : femAbnormal
      ? (isVaro ? "dfo" : "dfo_fechamento_medial")
      : tibAbnormal
        ? (isVaro ? "hto" : "hto_fechamento_medial")
        // Sem deformidade óssea por nível, preserva uma opção previamente
        // calculada (se houver), apenas para manter o contrato de um padrão.
        : String(opcoes.find((op) => op.padrao === true)?.id ?? opcoes[0]?.id ?? "");

  for (const op of opcoes) op.padrao = String(op.id ?? "") === idRecomendado;

  return opcoes;
}

// ─── HEIC → JPEG server-side conversion (uses heic-convert WASM) ──────────────
router.post("/xray/convert-heic", requireAuth, upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "Nenhuma imagem enviada." });
      return;
    }
    const jpeg = await heicConvert({
      buffer: req.file.buffer,
      format: "JPEG",
      quality: 0.92,
    });
    res.set("Content-Type", "image/jpeg");
    res.set("Content-Disposition", 'inline; filename="converted.jpg"');
    res.send(Buffer.from(jpeg));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(422).json({ error: `Falha ao converter HEIC: ${msg}` });
  }
});

router.post("/xray/analyze", requireAuth, upload.single("image"), async (req, res) => {
  try {
    logger.info({ fileSize: req.file?.size ?? 0, doctorId: req.doctorId }, "xray:analyze — request received");
    if (!req.file) {
      res.status(400).json({ error: "Nenhuma imagem enviada." });
      return;
    }

    const VALID_TIPOS: TipoAnalise[] = ["completa","eixo_mecanico","eixo_anatomico","femur","tibia","osteotomia","slopeTibial"];
    const VALID_LADOS: Lado[] = ["direito","esquerdo","bilateral"];
    const VALID_ESTRATEGIAS: EstrategiaCorrecao[] = ["neutro","fujisawa"];
    const VALID_DEFORMIDADES: DeformidadeEsperada[] = ["auto","varo","valgo","neutro"];

    const rawTipo = String(req.body?.tipoAnalise ?? "completa");
    const rawLado = String(req.body?.lado ?? "bilateral");
    const rawEstrategia = String(req.body?.estrategiaCorrecao ?? "neutro");
    const rawDeformidade = String(req.body?.deformidadeEsperada ?? "auto");
    const rawTipoRxManual = String(req.body?.tipoRxManual ?? "auto");
    const rawAnalysisContext = String(req.body?.analysisContext ?? "");
    const analysisContext: XrayAnalysisContext | null =
      rawAnalysisContext === "standalone" || rawAnalysisContext === "surgery"
        ? rawAnalysisContext
        : null;
    const tipoRxManual: "auto" | "LLR" | "LR" = ["auto","LLR","LR"].includes(rawTipoRxManual) ? rawTipoRxManual as "auto" | "LLR" | "LR" : "auto";

    const tipoAnalise: TipoAnalise = VALID_TIPOS.includes(rawTipo as TipoAnalise) ? (rawTipo as TipoAnalise) : "completa";
    const lado: Lado = VALID_LADOS.includes(rawLado as Lado) ? (rawLado as Lado) : "bilateral";
    const estrategiaCorrecao: EstrategiaCorrecao = VALID_ESTRATEGIAS.includes(rawEstrategia as EstrategiaCorrecao) ? (rawEstrategia as EstrategiaCorrecao) : "neutro";
    const deformidadeEsperada: DeformidadeEsperada = VALID_DEFORMIDADES.includes(rawDeformidade as DeformidadeEsperada) ? (rawDeformidade as DeformidadeEsperada) : "auto";

    const rawHka = req.body?.hkaConfirmado ? parseFloat(req.body.hkaConfirmado) : null;
    const hkaConfirmado = rawHka !== null && !isNaN(rawHka) ? rawHka : null;
    const rawMldfa = req.body?.mldfaConfirmado ? parseFloat(req.body.mldfaConfirmado) : null;
    const mldfaConfirmado = rawMldfa !== null && !isNaN(rawMldfa) ? rawMldfa : null;
    const rawAmpta = req.body?.amptaConfirmado ? parseFloat(req.body.amptaConfirmado) : null;
    const amptaConfirmado = rawAmpta !== null && !isNaN(rawAmpta) ? rawAmpta : null;
    const eixoAnatomicoConfirmadoRaw = (req.body as Record<string, unknown>)?.eixoAnatomicoConfirmado;
    const amaFemoralConfirmadoRaw = (req.body as Record<string, unknown>)?.amaFemoralConfirmado;
    const divergenciaTibialConfirmadaRaw = (req.body as Record<string, unknown>)?.divergenciaTibialConfirmada;

    const rawWbl = req.body?.wblDesejado ? parseFloat(req.body.wblDesejado) : 62;
    const wblDesejado = !isNaN(rawWbl) && rawWbl >= 40 && rawWbl <= 75 ? rawWbl : 62;

    let imgBuffer: { data: Buffer; mime: "image/jpeg" };
    try {
      imgBuffer = await preprocessXRay(req.file.buffer);
    } catch (convErr) {
      logger.error({ err: convErr }, "Sharp preprocessing error");
      res.status(422).json({
        error: "Não foi possível processar a imagem. Formatos aceitos: JPG, PNG, HEIC, WEBP, TIFF.",
      });
      return;
    }
    logger.info({ processedSize: imgBuffer.data.length }, "xray:analyze — image preprocessed");

    const forceRefresh = req.body?.force === "true" || req.body?.force === true;

    // ── Cache keys ─────────────────────────────────────────────────────────────
    // baseCacheKey — pure AI result, no physician overrides in the key.
    //   Written once per image+config immediately after the AI call.
    //   Re-used when the physician later marks angles so that aLDFA/aMPTA/JLCA
    //   remain stable across different HKA override values on the same image.
    // fullCacheKey — final result with all physician overrides applied.
    //   Returned on exact repeat requests (same image + same confirmed values).
    //
    // IMPORTANT: estrategiaCorrecao and wblDesejado are injected into the AI
    // prompt ONLY for the "osteotomia" analysis type. For all other types
    // (completa, eixo_mecanico, femur, tibia, slopeTibial) they only affect
    // post-processing (hkaDesejado, opcoesOsteotomia). Excluding them from the
    // baseCacheKey prevents unnecessary AI re-invocations — and the AI
    // stochasticity that follows — when the surgeon simply changes the WBL
    // correction target on the same image.
    const imageHash = createHash("sha256").update(imgBuffer.data).digest("hex");
    const hkaSuffix  = hkaConfirmado  !== null && !isNaN(hkaConfirmado)  ? `:hka${hkaConfirmado}`  : "";
    const mldfaSuffix = mldfaConfirmado !== null && !isNaN(mldfaConfirmado) ? `:mldfa${mldfaConfirmado}` : "";
    const amptaSuffix = amptaConfirmado !== null && !isNaN(amptaConfirmado) ? `:ampta${amptaConfirmado}` : "";
    const tipoRxSuffix = tipoRxManual !== "auto" ? `:rx${tipoRxManual}` : "";
    // Includes deterministic osteotomy post-processing. Bump when its clinical
    // recommendation rules change so an old HTO-first payload cannot be reused.
    const PROMPT_VERSION = "v16";
    // For "osteotomia" the WBL target is embedded in the prompt → keep in base key.
    // For all other types WBL is post-processing only → omit from base key so that
    // changing the correction strategy reuses the same AI result.
    const wblStratSuffix = tipoAnalise === "osteotomia"
      ? `:${estrategiaCorrecao}:wbl${wblDesejado}`
      : "";
    const baseCacheKey = `${PROMPT_VERSION}:${imageHash}:${tipoAnalise}:${lado}${wblStratSuffix}:${deformidadeEsperada}${tipoRxSuffix}`;
    // Full cache key also encodes the post-processing WBL/strategy for non-osteotomia
    // types so that different correction targets produce different cached outputs.
    const postWblSuffix = tipoAnalise !== "osteotomia"
      ? `:${estrategiaCorrecao}:wbl${wblDesejado}`
      : "";
    const cacheKey = `${baseCacheKey}${postWblSuffix}${hkaSuffix}${mldfaSuffix}${amptaSuffix}` +
      diaphysealMeasurementCacheSuffix({
        eixoAnatomico: eixoAnatomicoConfirmadoRaw,
        amaFemoral: amaFemoralConfirmadoRaw,
        divergenciaTibial: divergenciaTibialConfirmadaRaw,
      });

    const hasConfirmedMeasurement = (hkaConfirmado !== null && !isNaN(hkaConfirmado)) ||
      (mldfaConfirmado !== null && !isNaN(mldfaConfirmado)) ||
      (amptaConfirmado !== null && !isNaN(amptaConfirmado));

    // Always check the exact-match (full) cache first — works for all request types.
    if (!forceRefresh) {
      const cached = await db
        .select()
        .from(xrayCacheTable)
        .where(eq(xrayCacheTable.cacheKey, cacheKey))
        .limit(1);

      if (cached.length > 0) {
        const cachedAnalysis = JSON.parse(cached[0].resultJson);
        // If the physician confirmed a significant HKA (> 3°) but the cached result
        // has indicacaoOsteotomia !== true, the cache was produced by an older bug that
        // derived indicacaoOsteotomia from the AI's own HKA (not the confirmed value).
        // Reprocess so the fix at the HKA-override block can correct it.
        const cachedNeedsReprocess = hkaConfirmado !== null && !isNaN(hkaConfirmado) &&
          Math.abs(hkaConfirmado) > 3 &&
          cachedAnalysis.indicacaoOsteotomia !== true;
        if (!cachedNeedsReprocess) {
          void emitSuccessfulXrayAnalytics(req, analysisContext);
          res.json({ analysis: cachedAnalysis, _cached: true });
          return;
        }
        // Fall through to full pipeline — reprocess with physician-confirmed HKA.
      }
    }

    const base64 = imgBuffer.data.toString("base64");
    const { system, user: userMsg } = buildPrompt(tipoAnalise, lado, estrategiaCorrecao, deformidadeEsperada, wblDesejado);

    // Inject manual image type override if the user specified LR or LLR
    const tipoRxInjection = tipoRxManual === "LR"
      ? `\n\n🔴 TIPO DE RX DEFINIDO PELO MÉDICO: LR (JOELHO ISOLADO — SEM TORNOZELO)\n` +
        `O médico confirmou que esta imagem NÃO contém o tornozelo visível.\n` +
        `OBRIGATÓRIO: use o método BDP-10 (eixo diafisário distal). NÃO use eixo mecânico.\n` +
        `Classifique tipoRx = "LR" no JSON. Apresente o valor bruto medido sem correção automática fixa.`
      : tipoRxManual === "LLR"
      ? `\n\n🔴 TIPO DE RX DEFINIDO PELO MÉDICO: LLR (MEMBRO COMPLETO — COM TORNOZELO)\n` +
        `O médico confirmou que esta imagem contém fêmur + joelho + tíbia + tornozelo visível.\n` +
        `OBRIGATÓRIO: use o método do Eixo Mecânico (linha MTP→TC). Classifique tipoRx = "LLR" no JSON.`
      : "";

    // Inject confirmed HKA from physician point-marking if provided
    const hkaLabel = hkaConfirmado !== null && !isNaN(hkaConfirmado)
      ? hkaConfirmado < 0 ? "VARO" : hkaConfirmado > 0 ? "VALGO" : "NEUTRO"
      : "";
    const hkaInjection = hkaConfirmado !== null && !isNaN(hkaConfirmado)
      ? `\n\n🔴 HKA CONFIRMADO PELO MÉDICO (PRIORIDADE MÁXIMA):\n` +
        `O médico marcou os 3 pontos anatômicos (cabeça femoral, espinhas tibiais, cúpula talar) diretamente nesta radiografia e calculou geometricamente:\n` +
        `HKA = ${hkaConfirmado}° (${hkaLabel})\n` +
        `Convenção de sinal: HKA negativo = VARO; HKA positivo = VALGO; HKA zero = NEUTRO.\n` +
        `USE ESTE VALOR como o HKA definitivo. NÃO recalcule nem substitua o HKA — ele já foi medido com precisão pelo médico.\n` +
        `\n` +
        `⚠️ REGRA CRÍTICA PARA mLDFA e aMPTA:\n` +
        `Meça mLDFA e aMPTA PURAMENTE dos landmarks ósseos visíveis — côndilo medial/lateral para mLDFA, planalto tibial medial/lateral para aMPTA.\n` +
        `NÃO ajuste esses ângulos para "encaixar" no HKA confirmado. Cada ângulo deve refletir apenas o que os landmarks ósseos mostram.\n` +
        `A Fórmula de Paley é APENAS documentação — se HKA_paley ≠ HKA_confirmado, documente a discrepância e MANTENHA os valores medidos dos landmarks.\n` +
        `Ajustar mLDFA/aMPTA baseado no HKA causa variação artificial entre análises do mesmo RX — é exatamente o erro a evitar.`
      : "";

    // Inject geometric landmark-measured mLDFA/aMPTA if physician marked condyles/plateau
    const aldfaInjection = mldfaConfirmado !== null && !isNaN(mldfaConfirmado)
      ? `\n\n🔴 mLDFA CONFIRMADO GEOMETRICAMENTE PELO MÉDICO:\n` +
        `O médico marcou as pontas dos côndilos femoral medial e lateral diretamente nesta radiografia e calculou geometricamente (método mediCAD):\n` +
        `mLDFA = ${mldfaConfirmado}°\n` +
        `USE ESTE VALOR como mLDFA definitivo no JSON. NÃO substitua por estimativa visual — a medição geométrica é mais precisa.\n` +
        `Interprete o nível femoral com base neste valor: normal 84°–90°, varo femoral >90°, valgo femoral <84°.`
      : "";

    // Sanity check: aMPTA outside [70°, 100°] = likely geometry error (reversed click order).
    // In that case, do NOT force the AI to use the wrong value; let it measure from the image.
    const amptaConfirmadoValid = amptaConfirmado !== null && !isNaN(amptaConfirmado)
      && amptaConfirmado >= 70 && amptaConfirmado <= 100;
    const amptaInjection = amptaConfirmadoValid
      ? `\n\n🔴 aMPTA CONFIRMADO GEOMETRICAMENTE PELO MÉDICO:\n` +
        `O médico marcou as pontas do planalto tibial medial e lateral diretamente nesta radiografia e calculou geometricamente (método mediCAD):\n` +
        `aMPTA = ${amptaConfirmado}°\n` +
        `USE ESTE VALOR como aMPTA definitivo no JSON. NÃO substitua por estimativa visual — a medição geométrica é mais precisa.\n` +
        `Interprete o nível tibial com base neste valor: normal 84°–90°, varo tibial <84°, valgo tibial >90°.`
      : amptaConfirmado !== null && !isNaN(amptaConfirmado)
      ? `\n\n⚠️ aMPTA marcado geometricamente = ${amptaConfirmado}° — FORA do intervalo clínico esperado (70°–100°). ` +
        `Provavelmente há inversão dos pontos de marcação. IGNORE este valor e meça o aMPTA independentemente pela imagem.\n`
      : "";

    // ── When physician confirmed angles, try the base AI cache first ──────────
    // Avoids re-running the AI just because the physician changed their HKA
    // marking. Re-running produces different aLDFA/aMPTA/JLCA each time (vision
    // model stochasticity), which is the root cause of result inconsistency.
    // Physician overrides are applied deterministically below regardless.
    let analysis: Record<string, unknown> | null = null;
    let loadedFromBaseCache = false;

    if (hasConfirmedMeasurement && !forceRefresh) {
      const baseCached = await db
        .select()
        .from(xrayCacheTable)
        .where(eq(xrayCacheTable.cacheKey, baseCacheKey))
        .limit(1);
      if (baseCached.length > 0) {
        analysis = JSON.parse(baseCached[0].resultJson) as Record<string, unknown>;
        loadedFromBaseCache = true;
      }
    }

    // ── Analysis pipeline: AI call (if needed) + deterministic post-processing ──
    // Closure captures all handler-local variables so it can be called synchronously
    // (base-cache path) or fire-and-forget in a background job (AI-call path).
    // This completely eliminates long-running HTTP connections and is immune to
    // production proxy timeouts regardless of how long Gemini takes.
    const startingAnalysis = analysis;
    const runAnalysisPipeline = async (): Promise<{ analysis: Record<string, unknown> }> => {
      // eslint-disable-next-line no-shadow
      let analysis = startingAnalysis;

      if (!analysis) {
        // ── Deduplication: reuse an in-flight AI call for the same image ─────────
      // If another request with the same baseCacheKey is already running, await
      // its Promise instead of launching a second AI call. This prevents the race
      // condition where two simultaneous uploads of the same image both miss the
      // DB cache and receive slightly different AI responses (even at temperature=0
      // Gemini can have minor non-determinism across independent API calls).
      let pending = pendingAiCalls.get(baseCacheKey);
      if (!pending) {
        pending = (async (): Promise<Record<string, unknown>> => {
          // Run AI — physician override injections are intentionally omitted here.
          // Overrides (HKA, aLDFA, aMPTA) are applied post-AI in the deterministic
          // block below. This keeps the base AI result clean so it can be re-used
          // for different physician override combinations without re-calling the AI.

          const MODELS = ["gemini-2.5-flash", "gemini-2.0-flash"] as const;
          const sysPrompt = system + tipoRxInjection +
            "\n\nIMPORTANT: Respond ONLY with valid JSON. No markdown, no explanation, no code blocks. Raw JSON only.";
          const contents = [
            {
              role: "user" as const,
              parts: [
                { inlineData: { mimeType: imgBuffer.mime, data: base64 } },
                { text: userMsg },
              ],
            },
          ];

          function parseGeminiContent(raw: string): Record<string, unknown> {
            const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
            try {
              return JSON.parse(cleaned) as Record<string, unknown>;
            } catch {
              const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
              if (!jsonMatch) throw new Error("NO_JSON:" + raw.slice(0, 200));
              return JSON.parse(jsonMatch[0]) as Record<string, unknown>;
            }
          }

          // ── Per-call timeout via Promise.race ────────────────────────────────
          // AbortSignal inside the SDK config is "client-only" and does NOT
          // reliably throw in all Node.js environments. Promise.race + setTimeout
          // is the only guaranteed way to surface a timeout to our code.
          // Each model attempt gets its own 85s budget so the total is ≤170s,
          // but in practice the first model either succeeds (~40–52s) or we bail
          // on a timeout and never try the second.
          const AI_CALL_TIMEOUT_MS = 85_000;
          function callWithTimeout(p: Promise<unknown>): Promise<unknown> {
            return new Promise((resolve, reject) => {
              const t = setTimeout(
                () => reject(new Error("TIMEOUT:GEMINI_85S")),
                AI_CALL_TIMEOUT_MS
              );
              p.then(
                (v) => { clearTimeout(t); resolve(v); },
                (e: unknown) => { clearTimeout(t); reject(e); }
              );
            });
          }

          logger.info({ modelsCount: MODELS.length }, "xray:analyze — starting Gemini call");
          let lastErr: unknown;
          for (const model of MODELS) {
            let response;
            try {
              logger.info({ model }, "xray:analyze — calling model");
              response = await callWithTimeout(
                ai.models.generateContent({
                  model,
                  contents,
                  config: {
                    systemInstruction: sysPrompt,
                    maxOutputTokens: 8192,
                    temperature: 0,
                    // Cap thinking budget — gives the model enough reasoning
                    // capacity to follow the osteotomy decision tree correctly
                    // without the 20-40s overhead of unconstrained thinking.
                    thinkingConfig: { thinkingBudget: 3000 },
                  },
                })
              ) as Awaited<ReturnType<typeof ai.models.generateContent>>;
            } catch (callErr) {
              const msg = (callErr as Error)?.message ?? "";
              if (msg.startsWith("TIMEOUT:")) {
                logger.warn({ model }, "Gemini call timed out — exceeded 85s");
                throw callErr; // propagate TIMEOUT: to outer catch
              }
              logger.warn({ model, err: callErr }, "Gemini model call threw — trying next");
              lastErr = callErr;
              continue;
            }

            const content = response.text ?? "";

            // Detect safety block / empty response
            if (!content.trim()) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const raw = response as any;
              const blockReason  = raw?.promptFeedback?.blockReason ?? null;
              const finishReason = raw?.candidates?.[0]?.finishReason ?? null;
              logger.warn({ model, blockReason, finishReason }, "Gemini returned empty — trying next model");
              lastErr = new Error(`NO_JSON:EMPTY_RESPONSE model=${model} block=${blockReason} finish=${finishReason}`);
              continue;
            }

            try {
              const result = parseGeminiContent(content);
              result.tipoAnalise = tipoAnalise;
              result.ladoAvaliado = lado;
              // Cache the pure AI result immediately so future requests with any
              // physician override can reuse it without calling the AI.
              try {
                await db.insert(xrayCacheTable).values({
                  cacheKey: baseCacheKey,
                  resultJson: JSON.stringify(result),
                }).onConflictDoUpdate({
                  target: xrayCacheTable.cacheKey,
                  set: { resultJson: JSON.stringify(result) },
                });
              } catch (cacheErr) {
                logger.warn({ err: cacheErr }, "Base cache write failed (non-fatal)");
              }
              logger.info({ model }, "Gemini analysis succeeded");
              return result;
            } catch (parseErr) {
              logger.warn({ model, err: parseErr }, "Gemini JSON parse failed — trying next model");
              lastErr = parseErr;
            }
          }

          // All models exhausted
          throw lastErr ?? new Error("NO_JSON:ALL_MODELS_FAILED");
        })().finally(() => {
          // Always clean up so force-refresh or retries start fresh
          pendingAiCalls.delete(baseCacheKey);
        });

        pendingAiCalls.set(baseCacheKey, pending);
      }

        // Errors propagate to the dispatch block below — it handles each type
        analysis = await pending;
      }

    // Ensure these are always set (also when loaded from base cache)
    analysis.tipoAnalise = tipoAnalise;
    analysis.ladoAvaliado = lado;

    // ── Override aLDFA/aMPTA with geometric landmark measurements (post-AI safety net) ──
    // Even though we injected these values into the prompt, we force-override here to
    // guarantee the physician's precise geometric measurement always wins over AI estimation.
    if (mldfaConfirmado !== null && !isNaN(mldfaConfirmado)) {
      const mLDFA = analysis.mLDFA as Record<string, unknown> | undefined;
      if (mLDFA) {
        mLDFA._valorIA = mLDFA.valor;
        mLDFA.valor = mldfaConfirmado;
        mLDFA._physicianConfirmed = true;
        mLDFA.interpretacao = `${mldfaConfirmado}° — medido geometricamente pelo médico (landmarks côndilos)`;
      }
    }
    if (amptaConfirmadoValid) {
      const aMPTA = analysis.aMPTA as Record<string, unknown> | undefined;
      if (aMPTA) {
        aMPTA._valorIA = aMPTA.valor;
        aMPTA.valor = amptaConfirmado;
        aMPTA._physicianConfirmed = true;
        aMPTA.interpretacao = `${amptaConfirmado}° — medido geometricamente pelo médico (landmarks planalto)`;
      }
    }

    // ── BDP-10 LR systematic bias correction ─────────────────────────────────
    // AI vision models overestimate PTS on isolated knee (LR) images by +3° to +5°
    // due to sagittal bow inclusion in the reference axis.
    // Correction: additive -4° (more robust than multiplicative for high slopes).
    // Validated on clinical range; for slopes ≥ 15° the raw value is also shown.
    // NOTE: do NOT apply this if the prompt already self-corrected (tipoRx = LLR).
    if (tipoAnalise === "slopeTibial") {
      const rxTipo = tipoRxManual || String(analysis.tipoRx ?? "LR");
      if (rxTipo === "LR") {
        const OFFSET_LR = 4; // degrees to subtract
        const sf = analysis.slopeFinal as Record<string, unknown> | undefined;
        const mp = analysis.medicaoPrincipal as Record<string, unknown> | undefined;
        const mv = analysis.medicaoValidacao as Record<string, unknown> | undefined;

        const rawValor = Number(sf?.valor ?? mp?.valor ?? 0);
        // Floor at 3° — never produce negative or near-zero from correction artifact
        const corrected = Math.max(3, Math.round((rawValor - OFFSET_LR) * 10) / 10);

        if (sf) {
          sf._valorBruto = rawValor;
          sf.valor = corrected;
        }
        if (mp) {
          (mp as Record<string, unknown>)._valorBruto = mp.valor;
          mp.valor = corrected;
        }
        // Also correct validation measurement if present
        if (mv && mv.valor !== null && mv.valor !== undefined) {
          const rawMv = Number(mv.valor);
          mv._valorBruto = rawMv;
          mv.valor = Math.max(3, Math.round((rawMv - OFFSET_LR) * 10) / 10);
        }

        // Recalculate classification based on corrected value
        analysis._correcaoBiasBDP10 = `−4° (correção de viés BDP-10 LR — sagittal bow)`;
        analysis._valorBrutoIA = rawValor;

        const v = corrected;
        if (v < 8) {
          analysis.classificacaoPTS = "FISIOLÓGICO (<8°)";
          analysis.classificacaoRisco = "Baixo (<8°)";
          analysis.indicacaoSRO = false;
          analysis.forcaSRO = "Não indicada";
        } else if (v < 12) {
          analysis.classificacaoPTS = "NORMAL (8°–12°)";
          analysis.classificacaoRisco = "Normal (8°–12°)";
          analysis.indicacaoSRO = false;
          analysis.forcaSRO = "Não indicada";
        } else if (v < 15) {
          analysis.classificacaoPTS = "MODERADO (12°–15°)";
          analysis.classificacaoRisco = "Moderado (12°–15°)";
          analysis.indicacaoSRO = true;
          analysis.forcaSRO = "Considerar em contexto de revisão";
        } else {
          analysis.classificacaoPTS = "ELEVADO (≥15°)";
          analysis.classificacaoRisco = "Alto (≥15°)";
          analysis.indicacaoSRO = true;
          analysis.forcaSRO = "Fortemente indicada antes da revisão";
        }
      }
    }

    // ── Hard-override HKA with physician-confirmed measurement ────────────────
    if (hkaConfirmado !== null && !isNaN(hkaConfirmado)) {
      // Frontend convention for hkaConfirmado: positive=Valgo, negative=Varo, 0=Neutro.
      // Normalize BOTH magnitude and direction so downstream code (e.g.
      // recomputeOrigemDesvio) can't pick up a stale `desvio` from the AI when
      // the AI mis-classified the deformity direction.
      if (analysis.eixoMecanico && typeof analysis.eixoMecanico === "object") {
        const em = analysis.eixoMecanico as Record<string, unknown>;
        em.graus = Math.round(Math.abs(hkaConfirmado) * 10) / 10;
        em.desvio = hkaConfirmado > 0.05
          ? "Valgo"
          : hkaConfirmado < -0.05
            ? "Varo"
            : "Neutro";
      }

      // Recalculate anguloCorrecao based on the confirmed HKA
      const isNeutroStrat = estrategiaCorrecao === "neutro" || wblDesejado === 50;
      // DocKnee algorithm: HKA_alvo = (WBL_alvo − 50) × 0,28  (positivo = valgo)
      const hkaDesejadoHardOverride = isNeutroStrat ? 0 : Math.round((wblDesejado - 50) * 0.28 * 10) / 10;
      const hkaDesejado = hkaDesejadoHardOverride;
      const jlca = (analysis.JLCA && typeof analysis.JLCA === "object")
        ? (Number((analysis.JLCA as Record<string, unknown>).valor) || 0)
        : 0;
      const anguloCorrecaoRaw = Math.abs(hkaConfirmado - hkaDesejado);
      // Paley JLCA correction phenomenon: subtract (JLCA−2)×0.5 only when JLCA > 4°
      const jlcaCappedHO   = Math.min(jlca, 10);
      const jlcaAdjHO      = jlcaCappedHO > 4 ? Math.round((jlcaCappedHO - 2) * 0.5 * 10) / 10 : 0;
      const anguloCorrecao = Math.max(0, Math.round((anguloCorrecaoRaw - jlcaAdjHO) * 10) / 10);
      analysis.anguloCorrecao = anguloCorrecao;

      // Recalculate WBL pre-correction: 50 + HKA × 1.6 (negative HKA = varo → <50%)
      if (analysis.percentualWBL && typeof analysis.percentualWBL === "object") {
        const wblPreVal = Math.round((50 + hkaConfirmado * 1.6) * 10) / 10;
        (analysis.percentualWBL as Record<string, unknown>).valor = wblPreVal;
      }

      // Tag the analysis so the frontend knows the HKA was physician-confirmed
      analysis._hkaConfirmadoPeloMedico = hkaConfirmado;

      // ── Force indicacaoOsteotomia consistent with the physician-confirmed HKA ──
      // The AI's `indicacaoOsteotomia` was computed against its own (possibly wrong)
      // HKA estimate. After the hard override we must re-derive it: any |HKA| > 3°
      // is clinically significant and warrants osteotomy evaluation; ≤ 1° is neutral.
      if (Math.abs(hkaConfirmado) > 3) {
        analysis.indicacaoOsteotomia = true;
      } else if (Math.abs(hkaConfirmado) <= 1) {
        analysis.indicacaoOsteotomia = false;
      }
      // Between 1° and 3° we leave the AI's value — borderline cases need clinical judgment.
    }

    // ── Recompute origem do desvio (Paley) — auto-corrects supplementary errors
    // and derives femoral/tibial/articular contributions deterministically from
    // the angles, regardless of what the AI guessed for `origemDesvio`.
    recomputeOrigemDesvio(analysis as Record<string, unknown>);

    // ── Server-side eixo anatômico override ───────────────────────────────────
    // PRIORITY 1: If the physician marked the 4 diaphysis points (2 fem + 2 tib),
    // the frontend sends `eixoAnatomicoConfirmado` — a signed degrees value
    // (positive = Valgo, negative = Varo) computed geometrically from those
    // points. This is patient-specific and accurate. Use it verbatim.
    //
    // PRIORITY 2: Fallback to the population-average formula
    //   eixoAnatomico_signed = HKA_signed + 6°   (positive = valgo)
    // when the diaphysis points were not marked. The femoral shaft is
    // physiologically ~6° more valgus than the mechanical axis, but the actual
    // patient-specific offset typically ranges 5°–10° depending on neck-shaft
    // angle, diaphyseal curvature, and segment lengths — so the fixed +6°
    // can underestimate by up to 4°.
    //
    // The AI cannot reliably measure this on panoramic X-rays — it tends to
    // measure the raw diaphysis inclination from vertical, yielding absurd
    // values. We always override its guess with the formula/marking value.
    {
      const em = analysis.eixoMecanico as Record<string, unknown> | undefined;
      const eaConfirmadoRaw = eixoAnatomicoConfirmadoRaw;
      const eaConfirmado = eaConfirmadoRaw !== undefined && eaConfirmadoRaw !== null && eaConfirmadoRaw !== ""
        ? Number(eaConfirmadoRaw)
        : null;
      if (eaConfirmado !== null && Number.isFinite(eaConfirmado)) {
        // Physician-marked geometric anatomic axis (4-point measurement)
        const eaSigned = Math.round(eaConfirmado * 10) / 10;
        const eaDesvio = eaSigned > 0.05 ? "Valgo" : eaSigned < -0.05 ? "Varo" : "Neutro";
        analysis.eixoAnatomico = {
          graus: eaSigned,
          desvio: eaDesvio,
          _metodo: "Geométrico paciente-específico (4 pontos diafisários: 2 fêmur + 2 tíbia)",
        };
      } else if (em) {
        const hkaGraus = Number(em.graus ?? 0);
        const hkaDesvio = String(em.desvio ?? "Neutro");
        const hkaSigned = hkaDesvio === "Valgo" ? hkaGraus : hkaDesvio === "Varo" ? -hkaGraus : 0;
        const FISIOLOGICO_OFFSET = 6; // degrees; femoral shaft is ~6° more valgus than mechanical axis
        const eaSigned = Math.round((hkaSigned + FISIOLOGICO_OFFSET) * 10) / 10;
        const eaDesvio = eaSigned > 0.05 ? "Valgo" : eaSigned < -0.05 ? "Varo" : "Neutro";
        analysis.eixoAnatomico = {
          graus: eaSigned,          // signed: positive=Valgo, negative=Varo (frontend uses eaDeg < 4 → varo)
          desvio: eaDesvio,
          _metodo: "HKA + 6° (offset fisiológico médio — marque os 4 pontos diafisários para precisão paciente-específica)",
        };
      }
    }

    // ── Consistency check: HKA-direto vs HKA-fórmula de Paley ─────────────────
    // Paley (método mecânico): HKA = (mLDFA − 87) + (87 − aMPTA) + JLCA  (positive = VARO)
    //
    // TWO failure modes that block surgical planning:
    //
    // A) OPPOSITE SIGNS — classic supplement error: AI reports aLDFA/aMPTA on
    //    the wrong side (e.g. medial angle instead of lateral), causing the
    //    Paley formula to predict the opposite deformity direction from what
    //    the AI measured for HKA. Most commonly seen in valgo cases where the
    //    AI reports aLDFA ~100° (medial) instead of ~80° (lateral).
    //
    // B) SAME SIGN, LARGE MAGNITUDE GAP (≥ 7°) — "all-wrong" error: the AI
    //    generates ALL angles consistently in the wrong deformity direction
    //    (common on panoramic RX with ambiguous left/right orientation). Both
    //    HKA and components appear "varo" but the formula's magnitude far
    //    exceeds the measured HKA, exposing that the components cannot
    //    anatomically produce the reported HKA.  Example: AI reports HKA 9.5°
    //    varo but Paley gives 17.5° from the reported aLDFA/aMPTA — a 8° gap
    //    that is anatomically impossible.
    //
    // In both cases: refuse surgical options and demand manual landmark marking.
    // Skip when physician already confirmed HKA (override takes precedence).
    const physicianConfirmedHKA = (analysis as Record<string, unknown>)._hkaConfirmadoPeloMedico !== undefined;
    if (!physicianConfirmedHKA) {
      const em = analysis.eixoMecanico as Record<string, unknown> | undefined;
      const hkaGraus = Number(em?.graus ?? NaN);
      const desvio = String(em?.desvio ?? "");
      const mldfaVal = Number((analysis.mLDFA as Record<string, unknown> | undefined)?.valor ?? NaN);
      const amptaVal = Number((analysis.aMPTA as Record<string, unknown> | undefined)?.valor ?? NaN);
      const jlcaVal = Number((analysis.JLCA as Record<string, unknown> | undefined)?.valor ?? 0);

      if (Number.isFinite(hkaGraus) && Number.isFinite(mldfaVal) && Number.isFinite(amptaVal) &&
          (desvio === "Varo" || desvio === "Valgo")) {
        const hkaDiretoSigned = desvio === "Varo" ? hkaGraus : -hkaGraus; // positive = varo
        const hkaFormulaSigned = (mldfaVal - 87) + (87 - amptaVal) + (Number.isFinite(jlcaVal) ? jlcaVal : 0);
        const sinaisOpostos = (hkaDiretoSigned > 0 && hkaFormulaSigned < 0) ||
                              (hkaDiretoSigned < 0 && hkaFormulaSigned > 0);
        const ambosSignificativos = Math.abs(hkaDiretoSigned) >= 3 && Math.abs(hkaFormulaSigned) >= 3;
        // Mode B: same sign but the formula's magnitude is implausibly far from the measured HKA.
        // Threshold 7°: typical correct measurements differ ≤ 4° from Paley formula; ≥ 7° is a
        // strong signal that at least one component angle is wrong (even if consistently so).
        const magnitudeGap = Math.abs(hkaDiretoSigned - hkaFormulaSigned);
        const modoB = !sinaisOpostos && ambosSignificativos && magnitudeGap >= 5;

        if ((sinaisOpostos && ambosSignificativos) || modoB) {
          analysis._inconsistente = true;
          // Garante que nenhuma sugestão cirúrgica vinda da IA permaneça no payload.
          delete (analysis as Record<string, unknown>).opcoesOsteotomia;
          if (sinaisOpostos) {
            analysis._motivoInconsistencia =
              `Os ângulos medidos pela IA são contraditórios entre si: o HKA visual indica ${desvio.toUpperCase()} ${hkaGraus.toFixed(1)}°, ` +
              `mas a fórmula de Paley aplicada aos componentes (mLDFA ${mldfaVal.toFixed(1)}°, aMPTA ${amptaVal.toFixed(1)}°, JLCA ${jlcaVal.toFixed(1)}°) ` +
              `resulta em ${hkaFormulaSigned > 0 ? "VARO" : "VALGO"} ${Math.abs(hkaFormulaSigned).toFixed(1)}° — sinal oposto. ` +
              `Provável erro de medição de mLDFA ou aMPTA pela IA (ângulo suplementar / lado errado). ` +
              `Marque os 3 pontos de HKA e os pontos de mLDFA manualmente para confirmar.`;
          } else {
            // Mode B: same direction but implausible magnitude gap
            analysis._motivoInconsistencia =
              `Os ângulos dos componentes são inconsistentes com o HKA medido: ` +
              `HKA visual ${desvio.toUpperCase()} ${hkaGraus.toFixed(1)}°, mas a fórmula de Paley ` +
              `(mLDFA ${mldfaVal.toFixed(1)}°, aMPTA ${amptaVal.toFixed(1)}°, JLCA ${jlcaVal.toFixed(1)}°) ` +
              `resulta em ${Math.abs(hkaFormulaSigned).toFixed(1)}° — discrepância de ${magnitudeGap.toFixed(1)}° impossível anatomicamente. ` +
              `A IA provavelmente inverteu a direção do desvio ou mediu os ângulos no lado errado do osso. ` +
              `Marque os 3 pontos de HKA e os pontos de mLDFA manualmente para confirmar.`;
          }
          // Log only deltas, not absolute clinical measurements — those are PHI under LGPD art. 11.
          logger.warn({ magnitudeGap: magnitudeGap.toFixed(1), modoB },
            "Análise rejeitada por inconsistência HKA-direto vs HKA-fórmula");
        }
      }
    }

    // ── JLCA clinical interpretation alerts ──────────────────────────────────────
    // JLCA is now computed by the Paley-residual block above (capped 0–8°).
    // This block only adds clinical context alerts based on the final value.
    {
      const jlcaFinal = Number((analysis.JLCA as Record<string, unknown> | undefined)?.valor ?? 0);
      const alertas = (analysis.alertas as string[] | undefined) ?? [];

      if (jlcaFinal > 8) {
        alertas.push(
          `JLCA ${jlcaFinal.toFixed(1)}° — grande frouxidão medial ou desgaste assimétrico importante. ` +
          `Confirmar manualmente; valores > 8° podem indicar insuficiência ligamentar grave ou erro de landmark.`
        );
      } else if (jlcaFinal > 5) {
        alertas.push(
          `JLCA ${jlcaFinal.toFixed(1)}° — importante componente articular/ligamentar. ` +
          `Suspeitar dupla deformidade óssea + articular ou frouxidão significativa.`
        );
      } else if (jlcaFinal >= 3) {
        alertas.push(
          `JLCA ${jlcaFinal.toFixed(1)}° — discreta contribuição intra-articular.`
        );
      }

      // JLCA correction phenomenon alert (when adjustment applies)
      const jlcaForAlert = Math.min(jlcaFinal, 10);
      if (jlcaForAlert > 4) {
        const adj = Math.round((jlcaForAlert - 2) * 0.5 * 10) / 10;
        alertas.push(
          `"JLCA correction phenomenon" aplicado: JLCA ${jlcaFinal.toFixed(1)}° > 4° — ` +
          `subtraídos ${adj}° da correção planejada [(${jlcaFinal.toFixed(1)}−2)×0,5]. ` +
          `Parte do JLCA deve se resolver espontaneamente após restauro da tensão ligamentar.`
        );
      }

      analysis.alertas = alertas;
    }

    // ── Detecção de deformidade EXTRA-ARTICULAR (bowing diafisário) ─────────
    // Compara o eixo anatômico (diáfise marcada pelo cirurgião) com o eixo
    // mecânico (cabeça do fêmur → centro do joelho → tornozelo) para detectar
    // curvatura óssea fora da articulação. Padrão Paley:
    //   AMA femoral normal: 5°–9° (média populacional ~7°).
    //     Fora desta faixa → bowing femoral → deformidade extra-articular do fêmur.
    //   Divergência tibial normal: <3° (a tíbia é essencialmente reta).
    //     Acima → bowing tibial → deformidade extra-articular da tíbia.
    //
    // Quando detectado, a osteotomia ao redor do joelho (DFO/HTO) NÃO corrige
    // a deformidade — o cirurgião deve operar no ÁPICE da curvatura óssea, no
    // osso acometido. Bloqueamos a renderização de DFO/HTO para evitar conduta
    // clinicamente incorreta.
    {
      const amaRaw = amaFemoralConfirmadoRaw;
      const divTibRaw = divergenciaTibialConfirmadaRaw;
      const amaFem = amaRaw !== undefined && amaRaw !== null && amaRaw !== "" ? Number(amaRaw) : NaN;
      const divTib = divTibRaw !== undefined && divTibRaw !== null && divTibRaw !== "" ? Number(divTibRaw) : NaN;

      // Os ângulos chegam normalizados para 0°–90° (line-angle invariante).
      // Faixas anatomicamente plausíveis evitam disparar bloqueio por erro de
      // marcação. AMA femoral acima de 25° ou divergência tibial acima de 30°
      // quase certamente indicam falha de marcação, não bowing real.
      const amaPlausible = Number.isFinite(amaFem) && amaFem >= 0 && amaFem <= 25;
      const divTibPlausible = Number.isFinite(divTib) && Math.abs(divTib) >= 0 && Math.abs(divTib) <= 30;
      if (amaPlausible || divTibPlausible) {
        // ── Limiares Paley com zona de tolerância de ±0.5° ──────────────────────
        // Um pequeno erro no posicionamento dos pontos da diáfise (1–2 px na imagem)
        // pode mover o AMA de 4.6° para 5.4° — o mesmo osso, diagnósticos opostos.
        // Para evitar "diagnóstico de penhasco" por imprecisão de marcação:
        //   BOWING CONFIRMADO  (≥ 0.5° fora do normal): bloqueia DFO/HTO
        //   BOWING BORDERLINE  (dentro de 0.5° do limite): avisa mas não bloqueia
        //   NORMAL: sem ação
        const FEM_NORMAL_MIN = 5;
        const FEM_NORMAL_MAX = 9;
        const MARGIN = 0.5;      // graus de tolerância antes de confirmar bowing
        const TIB_NORMAL_MAX = 3;

        // Bowing confirmado: qualquer valor fora do range normal (< 4.5° ou > 9°)
        // Limiar superior sem margem: AMA > 9° já confirma bowing varizante.
        const femoralBowing = amaPlausible && (amaFem < FEM_NORMAL_MIN - MARGIN || amaFem > FEM_NORMAL_MAX);
        // Borderline: apenas abaixo do limite inferior com tolerância (4.5°–5°)
        const femoralBorderline = amaPlausible && !femoralBowing &&
          (amaFem < FEM_NORMAL_MIN);

        const tibialBowing = divTibPlausible && Math.abs(divTib) > TIB_NORMAL_MAX;
        const presente = femoralBowing || tibialBowing;

        const osso: "Fêmur" | "Tíbia" | "Ambos" | "Nenhum" =
          femoralBowing && tibialBowing ? "Ambos"
          : femoralBowing ? "Fêmur"
          : tibialBowing ? "Tíbia"
          : "Nenhum";

        // Descreve direção do bowing femoral com base no AMA.
        // AMA = ângulo entre o eixo anatômico femoral (diáfise) e o eixo mecânico.
        // O eixo anatômico fica LATERALMENTE ao mecânico — isso gera o AMA de 5°–9° normal.
        //   • AMA > 9°: diáfise MAIS lateralizada que o normal → bowing VALGIZANTE (curva para fora)
        //   • AMA < 5°: diáfise MENOS lateralizada (ou medializada) → bowing VARIZANTE (curva para dentro)
        const femDesvio = !femoralBowing ? ""
          : amaFem > FEM_NORMAL_MAX ? "valgizante"
          : "varizante";

        let recomendacao = "";
        if (presente) {
          const partes: string[] = [];
          if (femoralBowing) {
            partes.push(
              `Osteotomia no ÁPICE da deformidade femoral (curvatura ${femDesvio} da diáfise, AMA ${amaFem.toFixed(1)}°). ` +
              `A correção deve ser feita no ponto de maior angulação da diáfise femoral, NÃO ao redor do joelho.`
            );
          }
          if (tibialBowing) {
            partes.push(
              `Osteotomia no ÁPICE da deformidade tibial (bowing diafisário, divergência ${Math.abs(divTib).toFixed(1)}°). ` +
              `A correção deve ser feita no ponto de maior curvatura da diáfise tibial, NÃO ao redor do joelho.`
            );
          }
          recomendacao = partes.join(" • ");
        } else if (femoralBorderline) {
          recomendacao = `AMA femoral ${amaFem.toFixed(1)}° está na zona limítrofe (normal: 5°–9°). ` +
            `Confirme a marcação dos pontos da diáfise. ` +
            `Se o bowing for real, reposicione os pontos no segmento reto da diáfise e refaça a análise.`;
        } else {
          recomendacao = "Eixos anatômicos dentro da normalidade — deformidade tem origem articular/justa-articular. Osteotomia ao redor do joelho (DFO/HTO) é apropriada.";
        }

        // Ângulo de correção no CORA: o HKA representa o desvio angular total que
        // deve ser corrigido. Quando a origem é extra-articular, este ângulo é corrigido
        // no ÁPICE da curvatura diafisária (CORA), não ao redor do joelho.
        const hkaNode = analysis.eixoMecanico as Record<string, unknown> | undefined;
        const coraAngle = hkaNode ? Math.round(Number(hkaNode.graus ?? 0) * 10) / 10 : 0;

        analysis.deformidadeExtraArticular = {
          presente,
          osso,
          amaFemoral: Number.isFinite(amaFem) ? Math.round(amaFem * 10) / 10 : 0,
          divergenciaTibial: Number.isFinite(divTib) ? Math.round(divTib * 10) / 10 : 0,
          femoralBowing,
          femoralBorderline,
          tibialBowing,
          recomendacao,
          // Ângulo a corrigir no CORA (= HKA medido)
          anguloCoraFemoral: femoralBowing ? coraAngle : null,
          anguloCoraTibial: tibialBowing ? coraAngle : null,
          // femDesvioDir: AMA > 9° → valgizante (diáfise mais lateral); AMA < 5° → varizante
          femDesvioDir: amaPlausible
            ? (Number.isFinite(amaFem) && amaFem > FEM_NORMAL_MAX ? "valgizante"
              : Number.isFinite(amaFem) && amaFem < FEM_NORMAL_MIN ? "varizante"
              : "")
            : "",
        };

        // Quando há bowing CONFIRMADO: registrar origem extra-articular e alertar
        // para osteotomia no ápice, mas MANTER DFO/HTO disponíveis — o cirurgião
        // pode optar por tratar um componente justa-articular residual também.
        // Bowing BORDERLINE: aviso leve sem alterar o planejamento.
        if (presente) {
          (analysis as Record<string, unknown>).origemDesvio =
            osso === "Ambos"
              ? "Extra-articular (bowing femoral + tibial)"
              : `Extra-articular (bowing ${osso === "Fêmur" ? "femoral" : "tibial"})`;
          const alertas = Array.isArray(analysis.alertas) ? [...analysis.alertas as unknown[]] : [];
          alertas.unshift(
            `⚠️ Deformidade EXTRA-ARTICULAR no ${osso} — considere osteotomia no ÁPICE da deformidade diafisária como correção primária. ` +
            `${recomendacao} ` +
            `As opções de DFO/HTO ao redor do joelho permanecem disponíveis para correção de componente justa-articular residual.`
          );
          analysis.alertas = alertas;
        } else if (femoralBorderline) {
          const alertas = Array.isArray(analysis.alertas) ? [...analysis.alertas as unknown[]] : [];
          alertas.unshift(`⚠️ AMA femoral ${amaFem.toFixed(1)}° na zona limítrofe (normal 5°–9°) — confirme posição dos pontos da diáfise antes de concluir.`);
          analysis.alertas = alertas;
        }
      }
    }

    // ── Compute neutral surgical options (all viable paths, no recommendation) ──
    // Skip when analysis is flagged inconsistent — surgery options based on
    // contradictory inputs would be clinically dangerous.
    if (analysis.indicacaoOsteotomia === true && !analysis._inconsistente) {
      const isNeutroForOptions = estrategiaCorrecao === "neutro" || wblDesejado === 50;
      // Use DocKnee formula: HKA_alvo = (WBL_alvo − 50) × 0.28 (positive = valgo)
      const hkaAlvo = isNeutroForOptions ? 0 : Math.round((wblDesejado - 50) * 0.28 * 10) / 10;
      const opcoes = computeOpcoesOsteotomia(analysis, hkaAlvo, isNeutroForOptions ? 50 : wblDesejado);
      // Quando há deformidade extra-articular confirmada, nenhuma opção periarticular
      // deve aparecer como recomendada — o cirurgião decide sem sugestão automática.
      const eaPresente = (analysis.deformidadeExtraArticular as Record<string, unknown> | undefined)?.presente === true;
      if (eaPresente) {
        for (const op of opcoes as Array<Record<string, unknown>>) {
          op.padrao = false;
        }
      }
      analysis.opcoesOsteotomia = opcoes;
    }

    // ── Persist to cache (upsert so force-refresh updates existing entry) ───────
    // Skip cache write when inconsistent — we don't want to serve bad data
    // again on a future identical request.
    // Always fix MAD direction/magnitude from the final authoritative HKA values.
    fixMAD(analysis);

    if (analysis._inconsistente) {
      return { analysis };
    }
    try {
      await db.insert(xrayCacheTable).values({
        cacheKey,
        resultJson: JSON.stringify(analysis),
      }).onConflictDoUpdate({
        target: xrayCacheTable.cacheKey,
        set: { resultJson: JSON.stringify(analysis) },
      });
    } catch (cacheErr) {
      logger.warn({ err: cacheErr }, "Cache write failed (non-fatal)");
    }

    return { analysis };
    }; // end runAnalysisPipeline

    const pipeResult = await runAnalysisPipeline();
    void emitSuccessfulXrayAnalytics(req, analysisContext);
    res.json(pipeResult);

  } catch (err) {
    const msg = (err as Error)?.message ?? "";
    if (msg.startsWith("TIMEOUT:")) {
      logger.warn({ err }, "AI call timed out after 85s");
      res.status(503).json({ error: "A análise de IA demorou mais de 85 segundos. Tente novamente — a segunda tentativa costuma ser mais rápida." });
    } else if (msg.startsWith("NO_JSON:")) {
      // Do NOT log the full Gemini response — it contains clinical X-ray analysis (PHI).
      // Log only the length so we can diagnose truncation issues without exposing patient data.
      logger.error({ responseLength: msg.length - 8 }, "Gemini sem JSON válido");
      res.status(503).json({ error: "Não foi possível extrair a análise. Tente com imagem de melhor qualidade ou posicionamento." });
    } else {
      logger.error({ err }, "Erro ao analisar RX");
      res.status(500).json({ error: "Erro interno ao processar a imagem." });
    }
  }
});

// ─── Deterministic MAD correction ─────────────────────────────────────────────
// The AI sometimes reports the wrong MAD direction (e.g. "Medial" for a valgo
// knee) and the magnitude fluctuates ±10 mm between runs.  Both are overridden
// here from the authoritative HKA values that have already gone through all
// physician-confirmation and post-processing steps above.
//
// Physics:
//   • Valgo (HKA > 0): mechanical axis passes LATERAL to knee centre → MAD Lateral
//   • Varo  (HKA < 0): mechanical axis passes MEDIAL  to knee centre → MAD Medial
// Magnitude: clinical approximation = |HKA_degrees| × 6 mm/° (derived from
// the Paley formula for an average 900 mm limb length).
function fixMAD(analysis: Record<string, unknown>): void {
  const em = analysis.eixoMecanico as Record<string, unknown> | undefined;
  if (!em) return;
  const hkaGraus = Number(em.graus ?? NaN);
  const desvio = String(em.desvio ?? "");
  if (!Number.isFinite(hkaGraus) || (desvio !== "Varo" && desvio !== "Valgo")) return;

  const madNode = analysis.MAD as Record<string, unknown> | undefined;
  if (!madNode) return;

  const lado = desvio === "Valgo" ? "Lateral" : "Medial";
  const valor = Math.round(hkaGraus * 6.0 * 10) / 10;
  const status = valor <= 10 ? "Normal" : "Aumentado";

  madNode._valorIA = madNode.valor;
  madNode._ladoIA  = madNode.lado;
  madNode.valor  = valor;
  madNode.lado   = lado;
  madNode.status = status;
}

// ─── Recalculate surgical planning with manually corrected angles ─────────────
// No image re-upload needed — receives the modified analysis JSON directly.
// ── Recompute "origem do desvio" (Paley/Miniaci) ──────────────────────────────
// Auto-detects supplementary-angle errors made by the AI vision (e.g. aLDFA
// reported as 100° instead of 80° in valgo knees, or aMPTA on the wrong side)
// by trying all 4 combinations of (original, supplementary) for aLDFA/aMPTA
// and picking the one whose Paley-formula HKA best matches the measured HKA
// sign and magnitude. If a supplementary fits significantly better, the value
// is corrected in-place and flagged with `_corrigidoSuplementar`.
//
// Then computes femoral/tibial/articular contributions (only counted when they
// agree in direction with the overall HKA) and assembles the `origemDesvio`
// string. Reference values: aLDFA 81° ± 2°, aMPTA 87° ± 3°, JLCA 0–2°
// (Paley anatomic convention used throughout DocKnee).
function recomputeOrigemDesvio(analysis: Record<string, unknown>): void {
  const em = analysis.eixoMecanico as Record<string, unknown> | undefined;
  if (!em) return;
  const hkaGraus = Number(em.graus ?? NaN);
  const desvio = String(em.desvio ?? "");
  if (!Number.isFinite(hkaGraus)) return;
  const hkaSigned = desvio === "Varo" ? hkaGraus
    : desvio === "Valgo" ? -hkaGraus
    : 0; // positive = varo

  const mldfaNode = analysis.mLDFA as Record<string, unknown> | undefined;
  const amptaNode = analysis.aMPTA as Record<string, unknown> | undefined;
  const jlcaNode = analysis.JLCA as Record<string, unknown> | undefined;
  if (!mldfaNode || !amptaNode) return;

  let mldfa = Number(mldfaNode.valor ?? NaN);
  let ampta = Number(amptaNode.valor ?? NaN);
  const jlca = Number(jlcaNode?.valor ?? 0) || 0;
  if (!Number.isFinite(mldfa) || !Number.isFinite(ampta)) return;

  // Try 4 candidate (mldfa, ampta) combinations and score by how well Paley
  // formula matches the measured HKA. Penalize anatomically implausible values.
  const inPlausibleRange = (a: number, m: number) =>
    a >= 60 && a <= 110 && m >= 60 && m <= 110;
  const paleyFormula = (a: number, m: number) => (a - 87) + (87 - m) + jlca;

  type Candidate = { mldfa: number; ampta: number; aldfaSuppl: boolean; amptaSuppl: boolean };
  const candidates: Candidate[] = [
    { mldfa, ampta, aldfaSuppl: false, amptaSuppl: false },
    { mldfa: 180 - mldfa, ampta, aldfaSuppl: true, amptaSuppl: false },
    { mldfa, ampta: 180 - ampta, aldfaSuppl: false, amptaSuppl: true },
    { mldfa: 180 - mldfa, ampta: 180 - ampta, aldfaSuppl: true, amptaSuppl: true },
  ];

  const score = (c: Candidate) => {
    const diff = Math.abs(paleyFormula(c.mldfa, c.ampta) - hkaSigned);
    const penalty = inPlausibleRange(c.mldfa, c.ampta) ? 0 : 100;
    return diff + penalty;
  };

  let best = candidates[0]!;
  let bestScore = score(best);
  for (const c of candidates.slice(1)) {
    const s = score(c);
    if (s < bestScore) { bestScore = s; best = c; }
  }

  // Apply correction when:
  //  A) Original Paley sign is OPPOSITE to measured HKA sign — unambiguous flip error
  //     (e.g. Paley gives valgo but HKA is varo). Always apply, even for geometric
  //     (physician-confirmed) markings: a sign flip is impossible if the angle is correct —
  //     the points were placed on the wrong side of the joint.
  //  B) Original score > 7° AND best candidate is at least 1° better.
  //     Only applied to AI estimates (respects _physicianConfirmed) to avoid
  //     overriding accurate measurements with minor noise-driven adjustments.
  //     Threshold is 7°, not 5°: gaps of 5°–6° are clinically plausible when HKA
  //     includes soft-tissue laxity (JLCA) components that the component angles
  //     (mLDFA/aMPTA alone) cannot fully account for. 5° triggered false corrections
  //     on legitimate cases (e.g. HKA=13.9° varo, Paley=8.8°, gap=5.1°).
  const origScore = score(candidates[0]!);
  const origPayleySigned = paleyFormula(candidates[0]!.mldfa, candidates[0]!.ampta);
  const origSignFlip = hkaSigned !== 0 &&
    ((hkaSigned > 0 && origPayleySigned < -1) || (hkaSigned < 0 && origPayleySigned > 1));
  const shouldCorrect = best !== candidates[0] &&
    (origSignFlip || (origScore > 7 && bestScore < origScore - 1));
  const aldfaPhysician = Boolean(mldfaNode._physicianConfirmed);
  const amptaPhysician = Boolean(amptaNode._physicianConfirmed);

  // For sign flips: always correct (points placed on wrong side — geometric error).
  // For magnitude-only mismatches: respect _physicianConfirmed (don't override accurate measurements).
  const allowAldfaFlip = best.aldfaSuppl && (origSignFlip || !aldfaPhysician);
  const allowAmptaFlip = best.amptaSuppl && (origSignFlip || !amptaPhysician);

  if (shouldCorrect && (allowAldfaFlip || allowAmptaFlip)) {
    if (allowAldfaFlip) {
      mldfaNode._valorBruto = mldfa;
      const corrected = Math.round((180 - mldfa) * 10) / 10;
      mldfaNode.valor = corrected;
      mldfaNode._corrigidoSuplementar = true;
      mldfaNode.interpretacao = `${corrected}° — corrigido automaticamente (ângulo suplementar detectado: lado errado dos côndilos). Valor bruto: ${mldfa.toFixed(1)}°`;
      mldfa = corrected;
    }
    if (allowAmptaFlip) {
      amptaNode._valorBruto = ampta;
      const corrected = Math.round((180 - ampta) * 10) / 10;
      amptaNode.valor = corrected;
      amptaNode._corrigidoSuplementar = true;
      amptaNode.interpretacao = `${corrected}° — corrigido automaticamente (ângulo suplementar detectado: lado errado do planalto). Valor bruto: ${ampta.toFixed(1)}°`;
      ampta = corrected;
    }
    mldfaNode.status = mldfa >= 84 && mldfa <= 90 ? "Normal" : "Alterado";
    amptaNode.status = ampta >= 84 && ampta <= 90 ? "Normal" : "Alterado";
    const angCorrigidos = [allowAldfaFlip ? "mLDFA" : "", allowAmptaFlip ? "aMPTA" : ""].filter(Boolean).join("/");
    analysis._avisoCorrecaoSuplementar =
      `${angCorrigidos} estava no lado errado (ângulo suplementar detectado). ` +
      `Valor corrigido automaticamente para coerência com o HKA medido.`;
  }

  // Compute signed contributions (positive = varo direction, negative = valgo).
  const femSigned = mldfa - 87;       // mLDFA > 87 → femur em varo
  const tibSigned = 87 - ampta;       // aMPTA < 87 → tíbia em varo
  const artSigned = jlca;              // JLCA positivo → contribui ao varo

  // For HKA neutral, use absolute magnitudes; otherwise project onto HKA direction.
  const hkaSign = hkaSigned > 1 ? 1 : hkaSigned < -1 ? -1 : 0;
  const femAligned = hkaSign === 0 ? Math.abs(femSigned) : Math.max(0, femSigned * hkaSign);
  const tibAligned = hkaSign === 0 ? Math.abs(tibSigned) : Math.max(0, tibSigned * hkaSign);
  const artAligned = hkaSign === 0 ? Math.max(0, Math.abs(artSigned) - 2) : Math.max(0, artSigned * hkaSign - 2);

  // Significance thresholds (Paley reference range tolerances).
  const FEM_THRESHOLD = 3; // mLDFA 87° ± 3°
  const TIB_THRESHOLD = 3; // aMPTA 87° ± 3°
  const ART_THRESHOLD = 1;
  const femSignif = femAligned >= FEM_THRESHOLD;
  const tibSignif = tibAligned >= TIB_THRESHOLD;
  const artSignif = artAligned >= ART_THRESHOLD;

  // Determine origin label.
  let origem: string;
  if (hkaSign === 0) {
    origem = "Não aplicável";
  } else if (femSignif && tibSignif) {
    origem = "Mista (femoral + tibial)";
  } else if (femSignif && !tibSignif) {
    origem = "Predominantemente Femoral";
  } else if (!femSignif && tibSignif) {
    origem = "Predominantemente Tibial";
  } else if (artSignif) {
    origem = "Articular (JLCA)";
  } else {
    origem = "Indeterminada";
  }

  // Build descriptive contribution text matching the existing UI format.
  const direcaoHKA = hkaSign > 0 ? "varo" : hkaSign < 0 ? "valgo" : "neutro";
  const aldfaTxt = femAligned >= FEM_THRESHOLD
    ? `mLDFA ${mldfa.toFixed(1)}° — desvio de ${femAligned.toFixed(1)}° ao ${direcaoHKA}`
    : `mLDFA ${mldfa.toFixed(1)}° — dentro do normal`;
  const amptaTxt = tibAligned >= TIB_THRESHOLD
    ? `aMPTA ${ampta.toFixed(1)}° — desvio de ${tibAligned.toFixed(1)}° ao ${direcaoHKA}`
    : `aMPTA ${ampta.toFixed(1)}° — dentro do normal`;

  let origemFull = origem;
  if (hkaSign !== 0 && origem !== "Indeterminada" && origem !== "Não aplicável") {
    if (origem.startsWith("Predominantemente Femoral")) {
      origemFull = `${origem} (${aldfaTxt})`;
      if (tibAligned >= 1) origemFull += ` com contribuição tibial menor (${amptaTxt})`;
    } else if (origem.startsWith("Predominantemente Tibial")) {
      origemFull = `${origem} (${amptaTxt})`;
      if (femAligned >= 1) origemFull += ` com contribuição femoral menor (${aldfaTxt})`;
    } else if (origem.startsWith("Mista")) {
      origemFull = `${origem}: ${aldfaTxt}; ${amptaTxt}`;
    } else if (origem.startsWith("Articular")) {
      origemFull = `${origem} — JLCA ${jlca.toFixed(1)}° (${aldfaTxt}; ${amptaTxt})`;
    }
  }

  analysis.origemDesvio = origemFull;
  analysis.contribuicaoFemoral = Math.round(femAligned * 10) / 10;
  analysis.contribuicaoTibial = Math.round(tibAligned * 10) / 10;
  analysis.contribuicaoArticular = Math.round(artAligned * 10) / 10;
  analysis.contribuicaoFemoraltexto = aldfaTxt;
  analysis.contribuicaoTibialTexto = amptaTxt;
}

router.post("/xray/recalculate", requireAuth, async (req, res): Promise<void> => {
  try {
    const { analysis, wblDesejado = 62.5, estrategiaCorrecao = "fujisawa" } = req.body as {
      analysis: Record<string, unknown>;
      wblDesejado?: number;
      estrategiaCorrecao?: string;
    };
    if (!analysis || typeof analysis !== "object") {
      res.status(400).json({ error: "analysis é obrigatório" });
      return;
    }
    const wbl = Number(wblDesejado);
    const isNeutro = estrategiaCorrecao === "neutro" || wbl === 50;
    const hkaAlvo = isNeutro ? 0 : Math.round((wbl - 50) * 0.28 * 10) / 10;

    // Recompute origem do desvio with the (potentially edited) angles, so the
    // diagnostic text and per-segment contributions stay consistent with the
    // physician's manual edits.
    // EXCEÇÃO: quando há deformidade extra-articular detectada, preservamos o
    // origemDesvio "Extra-articular (bowing ...)" — recomputeOrigemDesvio usa
    // apenas aLDFA/aMPTA/JLCA e iria sobrescrever a classificação com base em
    // ângulos justa-articulares, ocultando o bowing diafisário ao médico.
    const extraArt = (analysis as Record<string, unknown>).deformidadeExtraArticular as
      { presente?: boolean } | undefined;
    if (!extraArt?.presente) {
      recomputeOrigemDesvio(analysis);
    }

    const em = analysis.eixoMecanico as Record<string, unknown> | undefined;
    const hkaGraus = Number(em?.graus ?? 0);
    const desvio = String(em?.desvio ?? "");
    // Sign convention: positive = Valgo, negative = Varo — matches hkaAlvo = (wbl−50)×0.28
    // which is positive when the target is toward valgo (wbl > 50, Fujisawa).
    const hkaSigned = desvio === "Valgo" ? hkaGraus : desvio === "Varo" ? -hkaGraus : 0;
    const jlca = Number((analysis.JLCA as Record<string, unknown> | undefined)?.valor ?? 0);
    // Paley JLCA correction phenomenon: (JLCA−2)×0.5 only when JLCA > 4° (cap at 10°)
    const jlcaCapped    = Math.min(jlca, 10);
    const jlcaAdjRec    = jlcaCapped > 4 ? Math.round((jlcaCapped - 2) * 0.5 * 10) / 10 : 0;
    const anguloCorrecaoRaw = Math.round(Math.abs(hkaSigned - hkaAlvo) * 10) / 10;
    const anguloCorrecao = Math.max(0, Math.round((anguloCorrecaoRaw - jlcaAdjRec) * 10) / 10);

    const opcoesOsteotomia = analysis.indicacaoOsteotomia === true
      ? computeOpcoesOsteotomia(analysis, hkaAlvo, isNeutro ? 50 : wbl)
      : [];

    const wblPre = Math.round((50 + hkaSigned * 1.6) * 10) / 10;

    res.json({
      opcoesOsteotomia,
      anguloCorrecao,
      anguloCorrecaoRaw,
      percentualWBL: { preCorrecao: wblPre, posCorrecao: wbl },
      origemDesvio: analysis.origemDesvio,
      contribuicaoFemoral: analysis.contribuicaoFemoral,
      contribuicaoTibial: analysis.contribuicaoTibial,
      contribuicaoArticular: analysis.contribuicaoArticular,
      contribuicaoFemoraltexto: analysis.contribuicaoFemoraltexto,
      contribuicaoTibialTexto: analysis.contribuicaoTibialTexto,
      aLDFA: analysis.aLDFA,
      aMPTA: analysis.aMPTA,
      _avisoCorrecaoSuplementar: analysis._avisoCorrecaoSuplementar,
    });
  } catch (err) {
    logger.error({ err }, "Erro ao recalcular planejamento");
    res.status(500).json({ error: "Erro ao recalcular planejamento." });
  }
});

export default router;
