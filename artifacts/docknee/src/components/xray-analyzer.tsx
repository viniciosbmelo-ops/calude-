import { useState, useRef, useEffect, useLayoutEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Upload, Loader2, CheckCircle, AlertTriangle, XCircle,
  ImageIcon, RefreshCw, FileImage, ChevronRight, Ruler, Info, Eye, FileDown,
  Target, Zap, TriangleAlert, ChevronDown, ChevronUp, Pencil, Share2
} from "lucide-react";
import {
  generateXRayPDF,
  getXRayPdfBlockReason,
  isCurrentXRayPdfGeneration,
  hasUnsavedOsteotomySimulation,
  isOsteotomySelectionRequired,
  resolveSelectedOsteotomyOption,
  resolveXRayPdfImageDataUrl,
  selectXRayPdfImageSource,
  deriveDisplayedPostAmTf,
} from "@/lib/xray-pdf";
import type { XRayPdfImageSource } from "@/lib/xray-pdf";
import { handlePdfOpenClick, sharePdfOrDownload } from "@/lib/pdf-share";
import { anguloMiniaciDFO, calcJlcaAjusteGraduadoDFO, computeTibialTarget, jlcaAjusteLabel } from "@/lib/dfo-geometry";
import { decidirNivel, cunhaParaOpcao, type OpcaoNivel, type OpcaoId } from "@/lib/level-decision";
import {
  getNivelOverrideForOsteotomia,
  isOptionCompatibleWithPrimaryClass,
} from "@/lib/osteotomy-selection";
import {
  resolverBase, calcularCunha, buildAnguloCorrigido,
  type BaseCalibrada, type CunhaResultado, type Marcacao as BaseMarcacao,
} from "@/lib/cunha";
import { toast } from "sonner";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { xrayAnalyzerMessages } from "@/locales/xray-analyzer";

interface XRayAnalysis {
  raciocinioVisual?: string;
  eixoMecanico?: { desvio: string; graus: number };
  eixoAnatomico?: { desvio: string; graus: number };
  mLDFA?: { valor: number; referencia: string; status: string };
  aMPTA?: { valor: number; referencia: string; status: string };
  JLCA?: { valor: number; referencia: string; status: string };
  MAD?: { valor: number; unidade: string; lado: string; status: string };
  origemDesvio?: string;
  grauVaro?: string;
  indicacaoOsteotomia?: boolean;
  tipoOsteotomia?: string;
  nivelOsteotomia?: string;
  anguloCorrecao?: number;
  anguloCorrecaoRaw?: number;
  metaCorrecao?: string;
  contribuicaoFemoral?: number;
  contribuicaoTibial?: number;
  contribuicaoArticular?: number;
  planoFemoral?: { indicado: boolean; correcaoNecessaria: number; tecnica: string; justificativaTecnica: string };
  planoTibial?: { indicado: boolean; correcaoNecessaria: number; tecnica: string; justificativaTecnica: string };
  valgofisiologico?: { esperado: string; encontrado: number; diferenca: number };
  contribuicaoFemoraltexto?: string;
  contribuicaoTibialTexto?: string;
  membrosAvaliados?: string;
  justificativa: string;
  qualidadeImagem: string;
  observacoes?: string;
  tipoAnalise?: string;
  ladoAvaliado?: string;
  percentualWBL?: {
    valor?: number;
    preCorrecao?: number;
    posCorrecao?: number;
    alvo?: string;
    interpretacao?: string;
  };
  // ── Novos campos Miniaci / Wedge / Dupla Osteotomia ──
  estrategiaCorrecao?: string;
  HKA_desejado?: number;
  alvoMecanico?: string;
  wedgeTibial?: { calculado_mm: number; aproximado_mm: number };
  wedgeFemoral?: { calculado_mm: number; aproximado_mm: number };
  distribuicaoDupla?: {
    aplicavel: boolean;
    pesoFemoral: number;
    pesoTibial: number;
    correcaoFemoral: number;
    correcaoTibial: number;
    wedgeFemoral_mm: number;
    wedgeTibial_mm: number;
  };
  alertas?: string[];
  opcoesOsteotomia?: unknown[];
  _selectedOsteotomiaIdx?: number | null;
  _selectedOsteotomiaId?: string | null;
  _hkaConfirmadoPeloMedico?: number;
  // ── Deformidade extra-articular (bowing diafisário) ──
  // Detectada quando o eixo anatômico (diáfise) diverge significativamente
  // do eixo mecânico. Padrão Paley:
  //   AMA femoral normal: 5°–9° (média 7°). Fora desta faixa → bowing femoral.
  //   Divergência tibial normal: <3°. Acima → bowing tibial.
  // Quando presente, a osteotomia ao redor do joelho NÃO corrige a deformidade
  // e o cirurgião deve operar no ÁPICE da curvatura óssea.
  deformidadeExtraArticular?: {
    presente: boolean;
    osso: "Fêmur" | "Tíbia" | "Ambos" | "Nenhum";
    amaFemoral: number;        // graus (5°–9° = normal)
    divergenciaTibial: number; // graus (<3° = normal)
    femoralBowing: boolean;
    femoralBorderline?: boolean;
    tibialBowing: boolean;
    recomendacao: string;
    /** Ângulo de correção a ser realizado no CORA diafisário femoral (= HKA medido). Null quando não há bowing femoral. */
    anguloCoraFemoral?: number | null;
    /** Ângulo de correção a ser realizado no CORA diafisário tibial (= HKA medido). Null quando não há bowing tibial. */
    anguloCoraTibial?: number | null;
    /** Ângulo do CORA femoral medido manualmente na Rx (via "Localizar CORA na Rx"), mais preciso que a estimativa via HKA. */
    anguloCoraFemoralMedido?: number | null;
    /** Ângulo do CORA tibial medido manualmente na Rx (via "Localizar CORA na Rx"), mais preciso que a estimativa via HKA. */
    anguloCoraTibialMedido?: number | null;
    /** Direção do bowing femoral: "valgizante" (AMA>9°, diáfise mais lateral) ou "varizante" (AMA<5°). Vazio quando normal. */
    femDesvioDir?: "valgizante" | "varizante" | "";
  };
}

export type XRayAnalysisContext = "standalone" | "surgery";

interface XRayAnalyzerProps {
  /** Required provenance for server-side RX success analytics. */
  analysisContext: XRayAnalysisContext;
  onAnalysisComplete?: (analysis: XRayAnalysis) => void;
  onImageSaved?: (imageUrl: string) => void;
  onOsteotomiaChoose?: (opcao: Record<string, unknown> | null, idx: number | null) => void;
  savedAnalysis?: XRayAnalysis | null;
  savedImageUrl?: string | null;
  savedSelectedOsteotomiaIdx?: number | null;
  patientName?: string;
  defaultStep?: "axis" | "upload";
  defaultLado?: LadoId;
}

const AXIS_OPTIONS = [
  {
    id: "completa",
    labelKey: "analysisComplete",
    descKey: "analysisCompleteDesc",
    icon: "📐",
  },
  {
    id: "eixo_mecanico",
    labelKey: "analysisMechanical",
    descKey: "analysisMechanicalDesc",
    icon: "📏",
  },
  {
    id: "eixo_anatomico",
    labelKey: "analysisAnatomical",
    descKey: "analysisAnatomicalDesc",
    icon: "🦴",
  },
  {
    id: "femur",
    labelKey: "analysisFemur",
    descKey: "analysisFemurDesc",
    icon: "🔺",
  },
  {
    id: "tibia",
    labelKey: "analysisTibia",
    descKey: "analysisTibiaDesc",
    icon: "🔻",
  },
  {
    id: "osteotomia",
    labelKey: "analysisOsteotomy",
    descKey: "analysisOsteotomyDesc",
    icon: "⚕️",
  },
] as const;

type AxisId = typeof AXIS_OPTIONS[number]["id"];


const LADO_OPTIONS = [
  { id: "direito",   labelKey: "right",   descKey: "rightDesc",    icon: "" },
  { id: "esquerdo",  labelKey: "left",  descKey: "leftDesc",   icon: "" },
] as const;

type LadoId = typeof LADO_OPTIONS[number]["id"];

const statusColor = (status: string) => {
  if (status === "Normal") return "text-green-700 bg-green-50 border-green-200";
  if (["Aumentado", "Diminuído", "Desvio predominantemente femoral", "Desvio predominantemente tibial"].some(s => status.includes(s)))
    return "text-amber-700 bg-amber-50 border-amber-200";
  return "text-muted-foreground bg-muted border-border";
};

// Cores por direção de deformidade (varo = vermelho, valgo = amarelo, normal = verde)
const deformityColor = (dir: "varo" | "valgo" | "normal") => {
  if (dir === "varo")   return "text-red-700 bg-red-50 border-red-200";
  if (dir === "valgo")  return "text-yellow-700 bg-yellow-50 border-yellow-300";
  return "text-green-700 bg-green-50 border-green-200";
};

const deformityIcon = (dir: "varo" | "valgo" | "normal") => {
  if (dir === "normal") return <CheckCircle className="h-3.5 w-3.5 text-green-600" />;
  if (dir === "varo")   return <AlertTriangle className="h-3.5 w-3.5 text-red-500" />;
  return <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />;
};

const statusIcon = (status: string) => {
  if (status === "Normal" || status === "Tíbia normal" || status === "Fêmur normal")
    return <CheckCircle className="h-3.5 w-3.5 text-green-600" />;
  return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
};

const DEFORMIDADE_OPTIONS = [
  { id: "auto", label: "Auto", desc: "IA avalia", icon: "🤖" },
  { id: "varo", label: "Varo", desc: "Confirmar", icon: "⬅️" },
  { id: "valgo", label: "Valgo", desc: "Confirmar", icon: "➡️" },
  { id: "neutro", label: "Neutro", desc: "Confirmar", icon: "⚖️" },
] as const;
type DeformidadeId = typeof DEFORMIDADE_OPTIONS[number]["id"];

const HEIC_EXTS = [".heic", ".heif"];

// ── Osteotomy simulation — Miniaci geometric formula ─────────────────────────
// Fórmula P4 (única válida): cunha_mm = base_mm × 2·sin(α/2)
// Inversa:                   α_° = 2·arcsin(mm / (2·base_mm)) × 180/π
//
// Bases anatômicas (midpoint das faixas normais córtex-a-córtex — usadas quando escala
// não está calibrada por marcação na Rx). Miniaci usa D = largura total, sem subtrair offset.
//   Fêmur supracondilar ML: [68, 80] mm → midpoint 74 mm
//   Tíbia metafisário proximal ML: [65, 78] mm → midpoint 71,5 mm
const ANAT_BASE_FEM = 74.0;   // mm — fallback femoral (córtex-a-córtex)
const ANAT_BASE_TIB = 71.5;   // mm — fallback tibial (córtex-a-córtex)

/** Miniaci forward: cunha_mm = base × 2·sin(α/2) */
const miniaciMm = (deg: number, base: number): number =>
  +(base * 2 * Math.sin((deg * Math.PI) / 180 / 2)).toFixed(1);

/** Miniaci inverse: α° = 2·arcsin(mm / (2·base)) */
const miniaciDeg = (mm: number, base: number): number => {
  const r = mm / (2 * base);
  if (r <= 0) return 0;
  if (r >= 1) return 180;
  return +(2 * Math.asin(r) * 180 / Math.PI).toFixed(1);
};

// Legacy ratio constants — kept ONLY as fallback when P4 data is absent
const SIM_TIBIAL_RATIO  = 1.0;
const SIM_FEMORAL_RATIO = 1.26;

// ─── Point-marking geometry helpers ──────────────────────────────────────────
interface MarkedPoint { x: number; y: number }

/**
 * Computes the signed HKA (Hip-Knee-Ankle) angle from 3 marked points.
 *
 * Convention (Paley / standard orthopaedic):
 *   HKA < 0  →  Varo   (membro em varo, joelho medial à linha AC)
 *   HKA > 0  →  Valgo  (membro em valgo, joelho lateral à linha AC)
 *   HKA = 0  →  Neutro
 *
 * Coordinate system: standard AP X-ray, Y-axis pointing DOWN (screen coords).
 *   IMAGE LEFT  = paciente DIREITO  (convenção AP radiográfica)
 *   IMAGE RIGHT = paciente ESQUERDO
 *
 * @param pts   [A=cabeça femoral, B=centro do joelho, C=cúpula talar]
 * @param lado  "direito" | "esquerdo" | "bilateral"
 */
function computeHKAFromPoints(
  pts: MarkedPoint[],
  lado: "direito" | "esquerdo" | "bilateral" = "direito"
): number | null {
  if (pts.length < 3) return null;
  const [A, B, C] = pts;

  // ── Magnitude: angle between AB and BC axes ──────────────────────────────
  // Direction of femoral mechanical axis (head → knee)
  const AB = { x: B.x - A.x, y: B.y - A.y };
  // Direction of tibial mechanical axis (knee → ankle)
  const BC = { x: C.x - B.x, y: C.y - B.y };
  const dot = AB.x * BC.x + AB.y * BC.y;
  const magAB = Math.sqrt(AB.x ** 2 + AB.y ** 2);
  const magBC = Math.sqrt(BC.x ** 2 + BC.y ** 2);
  if (magAB === 0 || magBC === 0) return null;
  const cosAngle = Math.min(1, Math.max(-1, dot / (magAB * magBC)));
  const magnitude = Math.acos(cosAngle) * (180 / Math.PI);

  // ── Sign: cross product determines which side of AC the knee (B) is on ──
  // AC vector (head → ankle, roughly downward in screen coords)
  const ACx = C.x - A.x, ACy = C.y - A.y;
  // AB vector (head → knee)
  const ABx = B.x - A.x, ABy = B.y - A.y;
  // Cross product Z component: AC × AB
  // cross > 0  →  B is to the LEFT  of AC (screen Y-down)
  // cross < 0  →  B is to the RIGHT of AC (screen Y-down)
  const cross = ACx * ABy - ACy * ABx;

  // In standard AP X-ray (Y-axis points DOWN in screen coords):
  //   cross > 0  →  B is to the LEFT  of A→C
  //   cross < 0  →  B is to the RIGHT of A→C
  //
  // VARO = knee is LATERAL to the mechanical axis:
  //   DIREITO leg (on IMAGE LEFT):  lateral = image LEFT  → B left of AC  → cross > 0  → VARO (negative)
  //   ESQUERDO leg (on IMAGE RIGHT): lateral = image RIGHT → B right of AC → cross < 0  → VARO (negative)
  //
  // VALGO = knee is MEDIAL:
  //   DIREITO: medial = image RIGHT → B right of AC → cross < 0 → VALGO (positive)
  //   ESQUERDO: medial = image LEFT → B left of AC  → cross > 0 → VALGO (positive)
  let signedHka: number;
  if (lado === "esquerdo") {
    signedHka = cross < 0 ? -magnitude : magnitude;   // esquerdo: B right of AC = lateral = VARO
  } else {
    // "direito" or "bilateral" (default: right-leg convention)
    signedHka = cross > 0 ? -magnitude : magnitude;   // direito: B left of AC = lateral = VARO
  }

  return Math.round(signedHka * 10) / 10;
}

const POINT_LABELS = [
  { id: "hkaFemoralHead", color: "#1FB6E1" },
  { id: "hkaKneeCenter", color: "#F59E0B" },
  { id: "hkaTalarDome", color: "#10B981" },
] as const;

const ALDFA_POINT_LABELS = [
  { id: "aldfaMedialCondyle", instructionId: "aldfaMedialCondyleInstruction", color: "#F97316" },
  { id: "aldfaLateralCondyle", instructionId: "aldfaLateralCondyleInstruction", color: "#EF4444" },
] as const;

const AMPTA_POINT_LABELS = [
  { id: "amptaMedialPlateau", instructionId: "amptaMedialPlateauInstruction", color: "#8B5CF6" },
  { id: "amptaLateralPlateau", instructionId: "amptaLateralPlateauInstruction", color: "#EC4899" },
] as const;

// ── Eixo Anatômico paciente-específico: 2 pts no fêmur + 2 pts na tíbia ───
// Permite calcular o ângulo tibiofemoral anatômico real (não a fórmula HKA+6°).
const EIXO_FEMORAL_POINT_LABELS = [
  { id: "femoralAxisProximal", instructionId: "femoralAxisProximalInstruction", color: "#06B6D4" },
  { id: "femoralAxisDistal", instructionId: "femoralAxisDistalInstruction", color: "#0EA5E9" },
] as const;
const EIXO_TIBIAL_POINT_LABELS = [
  { id: "tibialAxisProximal", instructionId: "tibialAxisProximalInstruction", color: "#22C55E" },
  { id: "tibialAxisDistal", instructionId: "tibialAxisDistalInstruction", color: "#10B981" },
] as const;

// ── CORA geometry helpers ─────────────────────────────────────────────────────

/**
 * Intersection of two infinite lines, each defined by two points.
 * Returns null when lines are parallel (cross product ≈ 0).
 */
function lineLineIntersection(
  p1: MarkedPoint, p2: MarkedPoint,
  p3: MarkedPoint, p4: MarkedPoint,
): MarkedPoint | null {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
  const cross = d1x * d2y - d1y * d2x;
  if (Math.abs(cross) < 1e-8) return null;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / cross;
  return { x: p1.x + t * d1x, y: p1.y + t * d1y };
}

/**
 * Acute angle (0°–90°) between two segments defined by 2 points each.
 * Uses |cos| so the result is always the smaller of the two supplementary angles.
 */
function angleBetweenSegments(
  p1: MarkedPoint, p2: MarkedPoint,
  p3: MarkedPoint, p4: MarkedPoint,
): number {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
  const mag1 = Math.sqrt(d1x * d1x + d1y * d1y);
  const mag2 = Math.sqrt(d2x * d2x + d2y * d2y);
  if (mag1 < 1e-10 || mag2 < 1e-10) return 0;
  const cosA = Math.abs(d1x * d2x + d1y * d2y) / (mag1 * mag2);
  return Math.round(Math.acos(Math.max(0, Math.min(1, cosA))) * (180 / Math.PI) * 10) / 10;
}

// ── Marking step metadata (single source of truth) ────────────────────────────
// Used by BOTH the guidance panel and the floating on-image banner so the
// "next point to mark" is described identically in both places.
type MarkTarget = 'hka' | 'aldfa' | 'ampta' | 'eixoFemoral' | 'eixoTibial';
type MarkStep = { num: number; label: string; hint: string; color: string; target: MarkTarget; idxInTarget: number; done: boolean; active: boolean };
type MarkStepLocalizationKey = "mark1Label" | "mark1Hint" | "mark2Label" | "mark2Hint" | "mark3Label" | "mark3Hint" | "mark4Label" | "mark4Hint" | "mark5Label" | "mark5Hint" | "mark6Label" | "mark6Hint" | "mark7Label" | "mark7Hint" | "mark8Label" | "mark8Hint" | "mark9Label" | "mark9Hint" | "mark10Label" | "mark10Hint" | "mark11Label" | "mark11Hint";
type MarkStepMeta = { num: number; label: string; hint: string; labelKey?: MarkStepLocalizationKey; hintKey?: MarkStepLocalizationKey; color: string; target: MarkTarget; idxInTarget: number };

const MARK_STEP_META: MarkStepMeta[] = [
  { num: 1, label: "Cabeça Femoral", labelKey: "mark1Label", color: "#1FB6E1", target: 'hka', idxInTarget: 0,
    hintKey: "mark1Hint",
    hint: "Centro geométrico da cabeça femoral — ponto mais circular da epífise proximal do fêmur (use zoom)" },
  { num: 2, label: "Centro do Joelho", labelKey: "mark2Label", color: "#F59E0B", target: 'hka', idxInTarget: 1,
    hintKey: "mark2Hint",
    hint: "Centro da fossa intercondiliana — ponto médio entre os côndilos femorais, na linha articular" },
  { num: 3, label: "Cúpula do Tálus", labelKey: "mark3Label", color: "#10B981", target: 'hka', idxInTarget: 2,
    hintKey: "mark3Hint",
    hint: "Centro da cúpula do tálus — ponto mais alto e central da superfície articular do tornozelo" },
  { num: 4, label: "Côndilo Medial (AmLDF)", labelKey: "mark4Label", color: "#F97316", target: 'aldfa', idxInTarget: 0,
    hintKey: "mark4Hint",
    hint: "Ponta mais DISTAL do côndilo medial femoral (lado de dentro). NÃO confundir com o planalto tibial" },
  { num: 5, label: "Côndilo Lateral (AmLDF)", labelKey: "mark5Label", color: "#EF4444", target: 'aldfa', idxInTarget: 1,
    hintKey: "mark5Hint",
    hint: "Ponta mais DISTAL do côndilo lateral femoral (lado de fora). Os 2 côndilos definem a linha articular femoral" },
  { num: 6, label: "Planalto Medial (AmMPT)", labelKey: "mark6Label", color: "#8B5CF6", target: 'ampta', idxInTarget: 0,
    hintKey: "mark6Hint",
    hint: "Ponto mais ALTO do planalto tibial medial (lado de dentro). Marco da superfície articular tibial interna" },
  { num: 7, label: "Planalto Lateral (AmMPT)", labelKey: "mark7Label", color: "#EC4899", target: 'ampta', idxInTarget: 1,
    hintKey: "mark7Hint",
    hint: "Ponto mais ALTO do planalto tibial lateral (lado de fora). Com o Ponto 6, define a inclinação tibial" },
  { num: 8, label: "Diáfise Femoral PROXIMAL", labelKey: "mark8Label", color: "#06B6D4", target: 'eixoFemoral', idxInTarget: 0,
    hintKey: "mark8Hint",
    hint: "Centro do canal medular femoral no TERÇO PROXIMAL. ⚠ Se houver bowing, marque a TANGENTE no segmento reto (não siga a curva), senão o AMA femoral subestima a deformidade." },
  { num: 9, label: "Diáfise Femoral DISTAL", labelKey: "mark9Label", color: "#0EA5E9", target: 'eixoFemoral', idxInTarget: 1,
    hintKey: "mark9Hint",
    hint: "Centro do canal medular femoral no TERÇO DISTAL. ⚠ Marque acima do ponto de inflexão se houver bowing — a linha 8→9 deve representar a porção RETA da diáfise, não acompanhar a curvatura." },
  { num: 10, label: "Diáfise Tibial PROXIMAL", labelKey: "mark10Label", color: "#22C55E", target: 'eixoTibial', idxInTarget: 0,
    hintKey: "mark10Hint",
    hint: "Centro do canal medular tibial no TERÇO PROXIMAL. ⚠ Se houver bowing tibial, marque a tangente no segmento reto da diáfise, NÃO siga a curvatura." },
  { num: 11, label: "Diáfise Tibial DISTAL", labelKey: "mark11Label", color: "#10B981", target: 'eixoTibial', idxInTarget: 1,
    hintKey: "mark11Hint",
    hint: "Centro do canal medular tibial no TERÇO DISTAL. ⚠ A linha 10→11 deve representar a porção RETA — se acompanhar o bowing, o ângulo calculado vira ~0° e a deformidade extra-articular não é detectada." },
];

function buildMarkSteps(
  counts: { hka: number; aldfa: number; ampta: number; eixoFemoral: number; eixoTibial: number },
  markingTarget: MarkTarget,
  t: (key: MarkStepLocalizationKey) => string,
): MarkStep[] {
  return MARK_STEP_META.map((m) => {
    const c = counts[m.target];
    return {
      ...m,
      label: m.labelKey ? t(m.labelKey) : m.label,
      hint: m.hintKey ? t(m.hintKey) : m.hint,
      done: c >= m.idxInTarget + 1,
      active: markingTarget === m.target && c === m.idxInTarget,
    };
  });
}


// ── Calibração de escala ───────────────────────────────────────────────────
type CalibMode = 'idle' | 'p1' | 'p2' | 'confirm' | 'done';

// Diâmetros oficiais das moedas do Real (série 2023).
// Fonte: Banco Central do Brasil — bcb.gov.br/cedulasemoedas/moedas
// Verificar antes de usar — valores variam por série de emissão.
const COIN_PRESETS: { label: string; mm: number }[] = [
  { label: 'R$0,10', mm: 20.0 },
  { label: 'R$0,25', mm: 25.0 },
  { label: 'R$0,50', mm: 23.0 },
  { label: 'R$1,00', mm: 27.0 },
];

const normalizeSavedXRayUrl = (value: string | null | undefined): string | null => {
  if (!value) return null;
  if (value.startsWith("http") || value.startsWith("blob:") || value.startsWith("data:")) return value;
  return value.replace(/^\/objects\//, "/api/storage/objects/");
};

export function XRayAnalyzer({ analysisContext, onAnalysisComplete, onImageSaved, onOsteotomiaChoose, savedAnalysis, savedImageUrl, savedSelectedOsteotomiaIdx, patientName, defaultStep, defaultLado }: XRayAnalyzerProps) {
  const { locale } = useLanguage();
  const t = useScopedTranslations(xrayAnalyzerMessages);
  const [step, setStep] = useState<"axis" | "lado" | "upload" | "result">(
    savedAnalysis ? "result" : (defaultStep ?? "axis")
  );
  const [selectedAxis, setSelectedAxis] = useState<AxisId>("completa");
  const [wblDesejado, setWblDesejado] = useState<number>(50); // Neutro padrão
  const [hkaObjetivo, setHkaObjetivo] = useState<number>(0); // HKA esperado em 50%
  const [selectedLado, setSelectedLado] = useState<LadoId>(defaultLado ?? "direito");
  const [selectedDeformidade, setSelectedDeformidade] = useState<DeformidadeId>("auto");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(() => normalizeSavedXRayUrl(savedImageUrl));
  const previewUrlOwnedRef = useRef(false);
  const [analysis, setAnalysis] = useState<XRayAnalysis | null>(savedAnalysis ?? null);
  const [loading, setLoading] = useState(false);
  const [loadingSeconds, setLoadingSeconds] = useState(0);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [showRaciocinio, setShowRaciocinio] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [pdfShareUrl, setPdfShareUrl] = useState<string | null>(null);
  const [mmEdit, setMmEdit] = useState<{ dfoMm: number; htoMm: number } | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [editingAngle, setEditingAngle] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [anglesEdited, setAnglesEdited] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  // Every replacement/reset of the RX increments this token. Async work captures
  // it at launch and may only commit while it still identifies the same image.
  const imageGenerationRef = useRef(0);
  const lastUploadedImageUrlRef = useRef<string | null>(null);
  const pdfGenerationRef = useRef(0);

  useEffect(() => {
    previewUrlRef.current = previewUrl;
  }, [previewUrl]);

  useEffect(() => {
    const restoredUrl = normalizeSavedXRayUrl(savedImageUrl);
    const isCurrentUploadEcho = !!savedImageUrl && savedImageUrl === lastUploadedImageUrlRef.current;
    setPreviewUrl((currentUrl) => {
      if (currentUrl === restoredUrl) return currentUrl;
      if (currentUrl && previewUrlOwnedRef.current) URL.revokeObjectURL(currentUrl);
      previewUrlOwnedRef.current = false;
      return restoredUrl;
    });
    if (!isCurrentUploadEcho) setSelectedFile(null);
    if (isCurrentUploadEcho) lastUploadedImageUrlRef.current = null;
  }, [savedImageUrl]);

  // Timer while loading
  useEffect(() => {
    if (!loading) { setLoadingSeconds(0); return; }
    const id = setInterval(() => setLoadingSeconds(s => s + 1), 1000);
    return () => clearInterval(id);
  }, [loading]);

  // ── Snap ref for native touch handlers (avoids stale closures) ───────────
  const touchSnapRef = useRef({ imgZoom: 1, panOffset: { x: 0, y: 0 }, markingMode: false, replacingIndex: null as number | null, markedPoints: [] as MarkedPoint[], selectedLado: "direito" as "direito" | "esquerdo" | "bilateral", markingTarget: 'hka' as 'hka' | 'aldfa' | 'ampta' | 'eixoFemoral' | 'eixoTibial', aldfaPoints: [] as MarkedPoint[], amptaPoints: [] as MarkedPoint[], eixoFemoralPoints: [] as MarkedPoint[], eixoTibialPoints: [] as MarkedPoint[], coraMarkingActive: false, coraMarkingPhase: null as 'prox' | 'dist' | null, coraMarkingBone: null as 'femoral' | 'tibial' | null, coraProxPoints: [] as MarkedPoint[], coraDistPoints: [] as MarkedPoint[], dfoHingeActive: false, dfoHingePoint: null as MarkedPoint | null, baseMarkingActive: null as { bone: 'femur' | 'tibia'; phase: 'entrada' | 'charneira' } | null, calibMode: 'idle' as CalibMode });

  // ── RAF ref for throttling magnifier / pan setState calls ─────────────────
  const rafMagnifierRef = useRef<number | null>(null);
  const rafPanRef = useRef<number | null>(null);
  // Staging refs — hold latest values so RAF callback always reads the most recent frame
  const pendingMagnifierRef = useRef<{ pos: { x: number; y: number }; screenPos: { x: number; y: number } } | null>(null);
  const pendingPanRef = useRef<{ zoom?: number; offset: { x: number; y: number } } | null>(null);
  // DOM ref to the magnifier loupe — lets the touch-move handler reposition it
  // imperatively (left/top/background-position) WITHOUT a React re-render of the
  // whole component every frame, which is what made marking movement laggy.
  const magnifierElRef = useRef<HTMLDivElement | null>(null);

  // ── Osteotomy surgery selection ────────────────────────────────────────────
  const [selectedOsteotomiaIdx, setSelectedOsteotomiaIdx] = useState<number | null>(savedSelectedOsteotomiaIdx ?? null);
  const osteotomyOptionsAvailable = Array.isArray(analysis?.opcoesOsteotomia) && analysis.opcoesOsteotomia.length > 0;
  const pdfSelectionRequired = analysis ? isOsteotomySelectionRequired(analysis) : false;
  const pdfSelectionValid = analysis
    ? resolveSelectedOsteotomyOption(
      analysis,
      selectedOsteotomiaIdx,
      typeof analysis._selectedOsteotomiaId === "string" ? analysis._selectedOsteotomiaId : undefined,
    ) !== null
    : false;
  const selectedOsteotomiaId = analysis && Array.isArray(analysis.opcoesOsteotomia)
    ? String((analysis.opcoesOsteotomia[selectedOsteotomiaIdx as number] as Record<string, unknown> | undefined)?.id ?? "")
    : null;
  const pdfSelectionIdx = pdfSelectionValid ? selectedOsteotomiaIdx : null;
  const pdfImageSource = selectXRayPdfImageSource(
    previewUrl,
    normalizeSavedXRayUrl(savedImageUrl),
    selectedFile,
  );
  const pdfBlockReason = getXRayPdfBlockReason(
    analysis,
    pdfSelectionIdx,
    pdfImageSource !== null,
    analysis !== null && hasUnsavedOsteotomySimulation(
      analysis,
      selectedOsteotomiaIdx,
      mmEdit,
      selectedOsteotomiaId,
    ),
  );
  const [nivelDecisaoOverride, setNivelDecisaoOverride] = useState<OpcaoId | null>(null);

  const [simSaved, setSimSaved] = useState(false);

  // A deferred PDF URL is only valid for the exact analysis/image/selection
  // that produced it.  Invalidate it as soon as any of those inputs changes.
  useEffect(() => {
    pdfGenerationRef.current += 1;
    setPdfShareUrl(null);
  }, [analysis, previewUrl, selectedFile, selectedOsteotomiaIdx, mmEdit, locale, patientName]);

  // Keep the transient simulation confirmation from a prior image from firing
  // after a new image has already started.
  const simSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      pdfGenerationRef.current += 1;
      const currentUrl = previewUrlRef.current;
      if (currentUrl && previewUrlOwnedRef.current) {
        URL.revokeObjectURL(currentUrl);
        previewUrlOwnedRef.current = false;
      }
      if (simSavedTimerRef.current) {
        clearTimeout(simSavedTimerRef.current);
        simSavedTimerRef.current = null;
      }
    };
  }, []);

  // Commits simulated mm values into the analysis state so the PDF uses them.
  const handleSaveSimulation = (
    idx: number,
    newPos: { HKA: number; mLDFA: number | null; aMPTA: number | null; wbl: number },
    dfoMm: number,
    htoMm: number,
    isDupla: boolean,
    isHTOBase: boolean,
  ) => {
    if (!analysis) return;
    const opcoes = [...(analysis.opcoesOsteotomia as Array<Record<string, unknown>>)];
    const opcao: Record<string, unknown> = { ...opcoes[idx] };

    // Persist the same post-op values shown by the simulation table. The table's
    // existing AmTF display is derived from its displayed signed HKA, so update
    // that derived value when a simulation is committed rather than retaining
    // a stale value from the prior saved option. Other stored fields (including
    // JLCA adjustment and pre-op values) remain untouched.
    const nextAngulosPos: Record<string, unknown> = {
      ...(opcao.angulosPos && typeof opcao.angulosPos === "object" ? opcao.angulosPos as Record<string, unknown> : {}),
      HKA: newPos.HKA,
      desvio: newPos.HKA < 0 ? "Varo" : newPos.HKA > 0 ? "Valgo" : "Neutro",
      AmTF: deriveDisplayedPostAmTf(newPos.HKA),
    };
    // An absent source angle is unavailable, not zero. Keep any pre-existing
    // stored field untouched rather than manufacturing a value from a missing
    // mLDFA/aMPTA input.
    if (newPos.mLDFA !== null) nextAngulosPos.mLDFA = newPos.mLDFA;
    if (newPos.aMPTA !== null) nextAngulosPos.aMPTA = newPos.aMPTA;
    opcao.angulosPos = nextAngulosPos;
    opcao.wblPos = newPos.wbl;

    if (isDupla) {
      opcao.wedgeFemoral_mm = +dfoMm.toFixed(1);
      opcao.wedgeTibial_mm  = +htoMm.toFixed(1);
      // Miniaci inverse para ângulo — usa base calibrada se disponível, senão anatômica
      const svFem = cunhaPorNivel?.find(c => c.osso === 'femur');
      const svTib = cunhaPorNivel?.find(c => c.osso === 'tibia');
      const svBaseFem = (svFem?.base?.modo === 'CALIBRADO' && svFem.base.base_mm != null)
        ? svFem.base.base_mm : ANAT_BASE_FEM;
      const svBaseTib = (svTib?.base?.modo === 'CALIBRADO' && svTib.base.base_mm != null)
        ? svTib.base.base_mm : ANAT_BASE_TIB;
      opcao.correcaoFemoral = svFem ? miniaciDeg(dfoMm, svBaseFem) : +(dfoMm / SIM_FEMORAL_RATIO).toFixed(1);
      opcao.correcaoTibial  = svTib ? miniaciDeg(htoMm, svBaseTib) : +(htoMm / SIM_TIBIAL_RATIO).toFixed(1);
    } else if (isHTOBase) {
      opcao.wedge_mm = +htoMm.toFixed(1);
      // correcao (planned angle) is intentionally NOT overwritten —
      // the card header badge always shows the server-planned correction.
    } else {
      opcao.wedge_mm = +dfoMm.toFixed(1);
      // correcao (planned angle) is intentionally NOT overwritten —
      // the card header badge always shows the server-planned correction.
    }

    opcoes[idx] = opcao;
    // Preserve the physician's explicit choice alongside the adjusted option.
    // Without this marker, the surgery form's JSON callback would overwrite
    // the saved analysis and silently revert to the AI/default option on reload.
    const selectedId = String((opcoes[idx] as Record<string, unknown> | undefined)?.id ?? "");
    const updated = {
      ...analysis,
      opcoesOsteotomia: opcoes,
      _selectedOsteotomiaIdx: idx,
      _selectedOsteotomiaId: selectedId || null,
    };
    setAnalysis(updated);
    onAnalysisComplete?.(updated);
    setMmEdit(null);
    setSimSaved(true);
    if (simSavedTimerRef.current) clearTimeout(simSavedTimerRef.current);
    simSavedTimerRef.current = setTimeout(() => {
      setSimSaved(false);
      simSavedTimerRef.current = null;
    }, 2500);
  };

  // ── Point-marking state ────────────────────────────────────────────────────
  const [markingMode, setMarkingMode] = useState(false);
  const [markedPoints, setMarkedPoints] = useState<MarkedPoint[]>([]);
  const [hkaFromPoints, setHkaFromPoints] = useState<number | null>(null);
  const [replacingIndex, setReplacingIndex] = useState<number | null>(null);
  const [markingTarget, setMarkingTarget] = useState<'hka' | 'aldfa' | 'ampta' | 'eixoFemoral' | 'eixoTibial'>('hka');
  const [aldfaPoints, setAldfaPoints] = useState<MarkedPoint[]>([]);
  const [amptaPoints, setAmptaPoints] = useState<MarkedPoint[]>([]);
  const [eixoFemoralPoints, setEixoFemoralPoints] = useState<MarkedPoint[]>([]);
  const [eixoTibialPoints, setEixoTibialPoints] = useState<MarkedPoint[]>([]);
  const [computedAlDFA, setComputedAlDFA] = useState<number | null>(null);
  const [computedAmPTA, setComputedAmPTA] = useState<number | null>(null);
  const [computedEixoAnatomico, setComputedEixoAnatomico] = useState<number | null>(null);
  // AMA = ângulo entre eixo mecânico femoral (cabeça fem → centro joelho) e
  // eixo anatômico femoral (diáfise prox → diáfise distal). Normal 5°–9°.
  const [computedAmaFemoral, setComputedAmaFemoral] = useState<number | null>(null);
  // Divergência tibial = ângulo entre eixo mecânico tibial (joelho → tornozelo)
  // e eixo anatômico tibial (diáfise prox → diáfise distal). Normal <3°.
  const [computedDivergenciaTibial, setComputedDivergenciaTibial] = useState<number | null>(null);
  // Quando o médico clica "Refinar eixo anatômico" no card de bowing, guardamos
  // qual eixo está sendo refinado para mostrar instrução específica na tela de marcação.
  const [refiningAxis, setRefiningAxis] = useState<'femoral' | 'tibial' | null>(null);
  // Ref para o refiningAxis — necessário dentro de handlers de eventos (closure-safe)
  const refiningAxisRef = useRef<'femoral' | 'tibial' | null>(null);

  // ── CORA marking state ─────────────────────────────────────────────────────
  // Ativado pelo botão "Localizar CORA na radiografia" no card de bowing.
  // Fase 'prox' = médico marca 2 pontos no segmento proximal;
  // fase 'dist' = marca 2 pontos no segmento distal; null = concluído.
  const [coraMarkingActive, setCoraMarkingActive] = useState(false);
  const [coraMarkingPhase, setCoraMarkingPhase] = useState<'prox' | 'dist' | null>(null);
  const [coraMarkingBone, setCoraMarkingBone] = useState<'femoral' | 'tibial' | null>(null);
  const coraMarkingBoneRef = useRef<'femoral' | 'tibial' | null>(null);
  const coraMarkingPhaseRef = useRef<'prox' | 'dist' | null>(null);
  const [coraProxPoints, setCoraProxPoints] = useState<MarkedPoint[]>([]);
  const [coraDistPoints, setCoraDistPoints] = useState<MarkedPoint[]>([]);
  // Resultado calculado após marcação dos 4 pontos
  const [computedCoraFemoral, setComputedCoraFemoral] = useState<{ angle: number; x: number; y: number } | null>(null);
  const [computedCoraTibial, setComputedCoraTibial] = useState<{ angle: number; x: number; y: number } | null>(null);

  // ── DFO Charneira (Hinge) Marking ────────────────────────────────────────
  // Um único ponto G = charneira no fêmur distal. Ativa/desativa com botão
  // "Marcar Charneira DFO" na seção de planejamento femoral.
  const [dfoHingeActive, setDfoHingeActive] = useState(false);
  const dfoHingeActiveRef = useRef(false);
  const [dfoHingePoint, setDfoHingePoint] = useState<MarkedPoint | null>(null);

  // ── Marcação de base por osso (Prompt 3) ──────────────────────────────────
  type BoneBasePoints = { entrada: MarkedPoint; charneira?: MarkedPoint };
  const [baseMarcacoes, setBaseMarcacoes] = useState<{ femur?: BoneBasePoints; tibia?: BoneBasePoints }>({});
  const baseMarcacoesRef = useRef<{ femur?: BoneBasePoints; tibia?: BoneBasePoints }>({});
  const requiredBaseBonesRef = useRef<Array<'femur' | 'tibia'>>([]);
  type BasePhase = { bone: 'femur' | 'tibia'; phase: 'entrada' | 'charneira' };
  const [baseMarkingActive, setBaseMarkingActive] = useState<BasePhase | null>(null);
  const baseMarkingActiveRef = useRef<BasePhase | null>(null);
  const cunhaPanelRef = useRef<HTMLDivElement | null>(null);
  const [magnifierPos, setMagnifierPos] = useState<{ x: number; y: number } | null>(null);
  const [magnifierScreenPos, setMagnifierScreenPos] = useState<{ x: number; y: number } | null>(null);

  // ── Calibração de escala (Etapa 0) ────────────────────────────────────────
  const [calibMode, setCalibMode] = useState<CalibMode>('idle');
  const calibModeRef = useRef<CalibMode>('idle');
  const [calibP1, setCalibP1] = useState<MarkedPoint | null>(null);
  const [calibP2, setCalibP2] = useState<MarkedPoint | null>(null);
  const [calibDistInput, setCalibDistInput] = useState<string>('');
  const [mmPorPixel, setMmPorPixel] = useState<number | null>(null);
  // Natural image dimensions — used for SVG viewBox so coords stay valid across resize
  const [naturalImgSize, setNaturalImgSize] = useState<{ w: number; h: number } | null>(null);
  const imgContainerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const svgOverlayRef = useRef<SVGSVGElement>(null);

  // Helper: natural-pixel scale factor relative to current CSS display size
  const getNatScale = () => {
    const img = imgRef.current;
    if (!img || !img.clientWidth) return 1;
    return img.naturalWidth / img.clientWidth;
  };

  // ── Touch tracking ref ────────────────────────────────────────────────────
  const touchStateRef = useRef<{
    mode: "none" | "pan" | "pinch" | "marking";
    startClientX: number; startClientY: number;
    lastClientX: number; lastClientY: number;
    // Committed marking position — the magnifier crosshair only moves when the
    // finger travels past a small dead-zone, so resting/jittering a finger keeps
    // the target rock-steady ("mesmo segurando o dedo"). The point is placed here.
    markClientX: number; markClientY: number;
    startPanX: number; startPanY: number;
    lastDist: number;
    moved: boolean;
    // Set when a 2nd finger touches mid-marking — aborts the placement so a stray
    // finger can never drop a point in the wrong spot.
    multiTouch: boolean;
  }>({ mode: "none", startClientX: 0, startClientY: 0, lastClientX: 0, lastClientY: 0, markClientX: 0, markClientY: 0, startPanX: 0, startPanY: 0, lastDist: 0, moved: false, multiTouch: false });

  // ── Zoom / pan state ──────────────────────────────────────────────────────
  const [imgZoom, setImgZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ mx: number; my: number; px: number; py: number } | null>(null);

  const MAG_SIZE = 190;
  const MAG_ZOOM = 4;

  const blobToDataUrl = (blobUrl: string): Promise<string> =>
    fetch(blobUrl)
      .then((r) => {
        if (!r.ok) throw new Error(`RX image request failed (${r.status})`);
        return r.blob();
      })
      .then(
        (blob) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          })
      );

  const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          resolve(reader.result);
        } else {
          reject(new Error("RX file could not be read as a data URL"));
        }
      };
      reader.onerror = () => reject(reader.error ?? new Error("RX file could not be read"));
      reader.readAsDataURL(file);
    });

  const imageSourceToDataUrl = async (source: XRayPdfImageSource): Promise<string> => {
    return resolveXRayPdfImageDataUrl(source, {
      // FileReader is local browser I/O and avoids fetch(blob:...) CSP violations.
      readFile: fileToDataUrl,
      // Only remote/storage URLs reach this fetch implementation.
      fetchRemote: blobToDataUrl,
    });
  };

  const handleGeneratePDF = async () => {
    if (!analysis) return;
    if (
      pdfBlockReason === "osteotomy-selection-required"
      || pdfBlockReason === "osteotomy-options-unavailable"
      || pdfBlockReason === "simulation-unsaved"
    ) {
      toast.error(
        pdfBlockReason === "simulation-unsaved"
          ? t("pdfSimulationUnsaved")
          : osteotomyOptionsAvailable
            ? t("pdfOsteotomySelectionRequired")
            : t("pdfOsteotomyOptionsUnavailable"),
        { duration: 5000 },
      );
      return;
    }
    const pdfGeneration = ++pdfGenerationRef.current;
    setPdfShareUrl(null);
    setGeneratingPdf(true);
    try {
      // ── Capture annotated X-ray for PDF ──────────────────────────────────────
      // Strategy: convert base image to a data: URL first, then composite with SVG.
      // Data URLs are always same-origin → canvas is NEVER tainted → toDataURL/
      // getImageData never throw SecurityError.
      // SVG overlay is also encoded as base64 data URL for the same reason.
      let xrayImageDataUrl: string | undefined;
      let _captureMethod = "none";
      const svgEl = svgOverlayRef.current;
      // On iOS/Android we target a smaller canvas so the final PDF stays under
      // ~8 MB — WhatsApp rejects or fails to send larger documents on mobile.
      const isMobileCapture = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      const MAX_PX = isMobileCapture ? 900 : 1500;
      const JPEG_Q = isMobileCapture ? 0.72 : 0.88;

      // When no preview exists, keep capture possible from the selected File. This
      // is especially important on mobile, where the object URL can disappear
      // during a view transition even though the input File is still present.
      const imageSource = selectXRayPdfImageSource(
        previewUrl,
        normalizeSavedXRayUrl(savedImageUrl),
        selectedFile,
      );
      // The RX is part of this report's clinical evidence.  Do not generate a
      // successful-looking PDF when the image URL is unavailable.
      if (!imageSource) {
        throw new Error("XRAY_IMAGE_CAPTURE_FAILED");
      }

      if (imageSource) {
        try {
          // 1. Local File/blob/data sources stay local; only persisted/remote
          // storage URLs use fetch (the CSP disallows fetch(blob:...)).
          const baseDataUrl = await imageSourceToDataUrl(imageSource);
          if (!isCurrentXRayPdfGeneration(pdfGenerationRef.current, pdfGeneration)) return;

          // 2. Load into an Image to get natural dimensions
          const baseImg = new Image();
          const [natW, natH] = await new Promise<[number, number]>((resolve, reject) => {
            baseImg.onload = () => resolve([baseImg.naturalWidth, baseImg.naturalHeight]);
            baseImg.onerror = reject;
            baseImg.src = baseDataUrl;
          });
          if (!isCurrentXRayPdfGeneration(pdfGenerationRef.current, pdfGeneration)) return;

          // 3. Scale canvas so longest side ≤ MAX_PX
          const scale = Math.min(1, MAX_PX / Math.max(natW, natH));
          const cw = Math.round(natW * scale);
          const ch = Math.round(natH * scale);
          console.log("[DocKnee PDF] base image loaded:", { natW, natH, cw, ch });

          const canvas = document.createElement("canvas");
          canvas.width = cw;
          canvas.height = ch;
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("2d context unavailable");

          // 4. Draw base image (data URL → never taints canvas)
          ctx.drawImage(baseImg, 0, 0, cw, ch);
          _captureMethod = "base-only";

          // 5. Overlay SVG annotations if present
          if (svgEl) {
            const svgClone = svgEl.cloneNode(true) as SVGSVGElement;
            svgClone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
            svgClone.setAttribute("width", String(cw));
            svgClone.setAttribute("height", String(ch));
            // viewBox = full natural image coords so stored point positions map correctly
            svgClone.setAttribute("viewBox", `0 0 ${natW} ${natH}`);

            // Strip <defs> and all filter="url(#id)" attributes.
            // Browsers refuse to render SVG-as-<img> when it contains url(#id) filter
            // references — the image either silently fails to load or onload never fires.
            // Drop shadows are cosmetic; removing them keeps all geometry visible in the PDF.
            const defs = svgClone.querySelector("defs");
            if (defs) defs.remove();
            svgClone.querySelectorAll("[filter]").forEach(el => el.removeAttribute("filter"));

            const svgStr = new XMLSerializer().serializeToString(svgClone);
            // Use Blob URL — more reliable than base64 data URL for SVG images
            const svgBlob = new Blob([svgStr], { type: "image/svg+xml" });
            const svgBlobUrl = URL.createObjectURL(svgBlob);
            const svgOk = await new Promise<boolean>((resolve) => {
              const svgImg = new Image();
              let settled = false;
              let timeoutId: ReturnType<typeof setTimeout> | null = null;
              const cleanup = () => {
                if (timeoutId !== null) clearTimeout(timeoutId);
                URL.revokeObjectURL(svgBlobUrl);
              };
              const finish = (value: boolean, resolve: (result: boolean) => void) => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve(value);
              };
              svgImg.onload = () => {
                if (settled) return;
                let success = true;
                try { ctx.drawImage(svgImg, 0, 0, cw, ch); }
                catch (e) { console.warn("[DocKnee PDF] drawImage SVG failed:", e); success = false; }
                finally { finish(success, resolve); }
              };
              svgImg.onerror = (e) => {
                console.warn("[DocKnee PDF] SVG img load error:", e);
                finish(false, resolve);
              };
              // Timeout fallback — onload/onerror can silently stall in some browsers
              timeoutId = setTimeout(() => finish(false, resolve), 3000);
              svgImg.src = svgBlobUrl;
            });
            if (!isCurrentXRayPdfGeneration(pdfGenerationRef.current, pdfGeneration)) return;
            if (svgOk) _captureMethod = "composite";
            console.log("[DocKnee PDF] SVG overlay:", svgOk);
          }

          // 6. Export canvas as JPEG (lower quality on mobile to keep PDF small for WhatsApp)
          const dataUrl = canvas.toDataURL("image/jpeg", JPEG_Q);
          console.log("[DocKnee PDF] output:", _captureMethod, "length:", dataUrl?.length);
          if (dataUrl && dataUrl.length > 5000) {
            xrayImageDataUrl = dataUrl;
          } else {
            throw new Error("canvas output too short — likely blank");
          }
        } catch (err) {
          console.warn("[DocKnee PDF] composite failed, plain fallback:", err);
          _captureMethod = "plain-fallback";
          try {
            if (imageSource) {
              // Always resize in fallback too — raw full-res images make PDFs too large for WhatsApp
              const rawDataUrl = await imageSourceToDataUrl(imageSource);
              if (!isCurrentXRayPdfGeneration(pdfGenerationRef.current, pdfGeneration)) return;
              const fbImg = new Image();
              await new Promise<void>((resolve, reject) => {
                fbImg.onload = () => resolve();
                fbImg.onerror = reject;
                fbImg.src = rawDataUrl;
              });
              if (!isCurrentXRayPdfGeneration(pdfGenerationRef.current, pdfGeneration)) return;
              const fbScale = Math.min(1, MAX_PX / Math.max(fbImg.naturalWidth || 1, fbImg.naturalHeight || 1));
              const fbW = Math.round((fbImg.naturalWidth || MAX_PX) * fbScale);
              const fbH = Math.round((fbImg.naturalHeight || MAX_PX) * fbScale);
              const fbCanvas = document.createElement("canvas");
              fbCanvas.width = fbW;
              fbCanvas.height = fbH;
              const fbCtx = fbCanvas.getContext("2d");
              if (fbCtx) {
                fbCtx.drawImage(fbImg, 0, 0, fbW, fbH);
                xrayImageDataUrl = fbCanvas.toDataURL("image/jpeg", JPEG_Q);
              }
            }
          } catch {
            throw new Error("XRAY_IMAGE_CAPTURE_FAILED");
          }
        }
      }

      if (xrayImageDataUrl && xrayImageDataUrl.length > 5000) {
        toast.success(
          _captureMethod === "composite"
            ? t("captureAnnotated")
            : _captureMethod === "base-only"
            ? t("captureWithoutSvg")
            : t("captureSimple"),
          { description: `${(xrayImageDataUrl.length / 1024).toFixed(0)} KB`, duration: 4000 }
        );
      } else {
        throw new Error("XRAY_IMAGE_CAPTURE_FAILED");
      }
      if (!isCurrentXRayPdfGeneration(pdfGenerationRef.current, pdfGeneration)) return;
      console.log("[DocKnee PDF] final:", _captureMethod, xrayImageDataUrl ? `${xrayImageDataUrl.length} chars` : "NONE");

      // Merge the manually-measured CORA angle(s) (from "Localizar CORA na Rx") into
      // the analysis before export — this state lives only in this component and is
      // not part of the persisted `analysis` object, so the PDF must be given a copy
      // that includes it or it silently falls back to the HKA-estimated angle only.
      const analysisForPdf: XRayAnalysis = analysis.deformidadeExtraArticular
        ? {
            ...analysis,
            deformidadeExtraArticular: {
              ...analysis.deformidadeExtraArticular,
              anguloCoraFemoralMedido: computedCoraFemoral?.angle ?? null,
              anguloCoraTibialMedido: computedCoraTibial?.angle ?? null,
            },
          }
        : analysis;

      const { doc, filename } = generateXRayPDF(analysisForPdf, patientName, xrayImageDataUrl, selectedOsteotomiaIdx, locale);

      if (!isCurrentXRayPdfGeneration(pdfGenerationRef.current, pdfGeneration)) return;
      const result = await sharePdfOrDownload(
        doc,
        filename,
        (url) => {
          if (pdfGenerationRef.current === pdfGeneration) setPdfShareUrl(url);
        },
      );
      if (!isCurrentXRayPdfGeneration(pdfGenerationRef.current, pdfGeneration)) return;
      if (result.deferred) {
        toast.success(t("pdfReady"), {
          description: t("pdfReadyDescription"),
          duration: 6000,
        });
      }
    } catch (err) {
      if (!isCurrentXRayPdfGeneration(pdfGenerationRef.current, pdfGeneration)) return;
      console.error("Erro ao gerar PDF da análise RX:", err);
      toast.error(
        err instanceof Error && err.message === "XRAY_IMAGE_CAPTURE_FAILED"
          ? t("captureFailed")
          : t("pdfGenerationError"),
        { duration: 4000 },
      );
    } finally {
      if (isCurrentXRayPdfGeneration(pdfGenerationRef.current, pdfGeneration)) {
        setGeneratingPdf(false);
      }
    }
  };

  const handleOpenPDF = () => {
    if (!pdfShareUrl) return;
    handlePdfOpenClick(pdfShareUrl, () => setPdfShareUrl(null));
  };

  /** Canvas → JPEG blob helper */
  const canvasBlobJpeg = (src: CanvasImageSource, w: number, h: number): Promise<Blob> =>
    new Promise((res, rej) => {
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) { rej(new Error("no 2d context")); return; }
      ctx.drawImage(src, 0, 0);
      canvas.toBlob(b => b ? res(b) : rej(new Error("toBlob null")), "image/jpeg", 0.92);
    });

  /**
   * HEIC → JPEG conversion, four strategies in order:
   * 1. createImageBitmap()  — Chrome 113+/macOS, Firefox 133+
   * 2. HTMLImageElement     — Safari + Chrome 105+ via blob URL
   * 3. Server-side Sharp    — most reliable, no browser codec dependency
   * 4. heic2any WASM        — last-resort pure-JS fallback
   */
  const convertHeicToJpeg = async (file: File): Promise<File> => {
    const jpegName = file.name.replace(/\.hei[cf]$/i, ".jpg");
    const heicBlob = new Blob([await file.arrayBuffer()], { type: "image/heic" });

    // ── Strategy 1: createImageBitmap ─────────────────────────────────────────
    try {
      const bitmap = await createImageBitmap(heicBlob);
      const blob = await canvasBlobJpeg(bitmap, bitmap.width, bitmap.height);
      bitmap.close();
      return new File([blob], jpegName, { type: "image/jpeg" });
    } catch (e1) {
      console.warn("[HEIC] createImageBitmap failed:", e1);
    }

    // ── Strategy 2: HTMLImageElement ──────────────────────────────────────────
    try {
      const url = URL.createObjectURL(heicBlob);
      const blob = await new Promise<Blob>((res, rej) => {
        const img = new Image();
        img.onload = async () => {
          URL.revokeObjectURL(url);
          try { res(await canvasBlobJpeg(img, img.naturalWidth, img.naturalHeight)); }
          catch (e) { rej(e); }
        };
        img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("img.onerror")); };
        img.src = url;
      });
      return new File([blob], jpegName, { type: "image/jpeg" });
    } catch (e2) {
      console.warn("[HEIC] HTMLImageElement failed:", e2);
    }

    // ── Strategy 3: server-side Sharp conversion (most reliable) ──────────────
    try {
      const form = new FormData();
      form.append("image", heicBlob, file.name);
      const resp = await fetch("/api/xray/convert-heic", {
        method: "POST",
        credentials: "same-origin",
        body: form,
      });
      if (!resp.ok) {
        const errJson = await resp.json().catch(() => ({}));
        throw new Error((errJson as { error?: string }).error ?? `HTTP ${resp.status}`);
      }
      const jpegBuf = await resp.arrayBuffer();
      return new File([jpegBuf], jpegName, { type: "image/jpeg" });
    } catch (e3) {
      console.warn("[HEIC] server-side Sharp failed:", e3);
    }

    // ── Strategy 4: heic2any WASM ─────────────────────────────────────────────
    try {
      const heic2any = (await import("heic2any")).default;
      const result = await heic2any({ blob: heicBlob, toType: "image/jpeg", quality: 0.92 });
      const out = Array.isArray(result) ? result[0] : result;
      return new File([out], jpegName, { type: "image/jpeg" });
    } catch (e4) {
      console.error("[HEIC] heic2any failed:", e4);
    }

    throw new Error("all HEIC conversion strategies failed");
  };

  /**
   * Clears only state derived from a particular RX. Global analysis preferences
   * (side, axis, correction target and deformity selection) intentionally stay
   * selected for the next image.
   */
  const resetImageDependentState = () => {
    // Invalidate outstanding analyze/recalculate (and HEIC conversion) work
    // before clearing image-derived state. Their finally blocks are guarded too.
    imageGenerationRef.current += 1;
    setSelectedOsteotomiaIdx(null);
    setNivelDecisaoOverride(null);
    setMmEdit(null);
    setSimSaved(false);
    setEditingAngle(null);
    setEditValue("");
    setAnglesEdited(false);
    setLoading(false);
    setRecalculating(false);
    setConverting(false);
    setUploadingImage(false);
    if (simSavedTimerRef.current) {
      clearTimeout(simSavedTimerRef.current);
      simSavedTimerRef.current = null;
    }
    // The parent stores the selected procedure separately from the analysis.
    // Clear it as well, so it cannot restore a procedure from the prior RX.
    onOsteotomiaChoose?.(null, null);
  };

  const resetMarkingState = () => {
    resetImageDependentState();
    setMarkingMode(false);
    setMarkedPoints([]);
    setReplacingIndex(null);
    setMarkingTarget('hka');
    setAldfaPoints([]);
    setAmptaPoints([]);
    setEixoFemoralPoints([]);
    setEixoTibialPoints([]);
    setComputedAlDFA(null);
    setComputedAmPTA(null);
    setComputedEixoAnatomico(null);
    setComputedAmaFemoral(null);
    setComputedDivergenciaTibial(null);
    setHkaFromPoints(null);
    setRefiningAxis(null);
    refiningAxisRef.current = null;
    // A new image must never retain a CORA from the prior anatomy.
    setCoraMarkingActive(false);
    setCoraMarkingPhase(null);
    setCoraMarkingBone(null);
    setCoraProxPoints([]);
    setCoraDistPoints([]);
    setComputedCoraFemoral(null);
    setComputedCoraTibial(null);
    coraMarkingBoneRef.current = null;
    coraMarkingPhaseRef.current = null;
    // The DFO hinge and calibrated cortical bases are image coordinates.
    setDfoHingeActive(false);
    setDfoHingePoint(null);
    dfoHingeActiveRef.current = false;
    setBaseMarcacoes({});
    baseMarcacoesRef.current = {};
    requiredBaseBonesRef.current = [];
    setBaseMarkingActive(null);
    baseMarkingActiveRef.current = null;
    setImgZoom(1);
    setPanOffset({ x: 0, y: 0 });
    setNaturalImgSize(null);
    setAnalysis(null);
    setCalibMode('idle');
    calibModeRef.current = 'idle';
    setCalibP1(null);
    setCalibP2(null);
    setCalibDistInput('');
    setMmPorPixel(null);
    setPdfShareUrl(null);
    touchSnapRef.current.markingMode = false;
    touchSnapRef.current.markedPoints = [];
    touchSnapRef.current.replacingIndex = null;
    touchSnapRef.current.markingTarget = 'hka';
    touchSnapRef.current.aldfaPoints = [];
    touchSnapRef.current.amptaPoints = [];
    touchSnapRef.current.eixoFemoralPoints = [];
    touchSnapRef.current.eixoTibialPoints = [];
    touchSnapRef.current.coraMarkingActive = false;
    touchSnapRef.current.coraMarkingPhase = null;
    touchSnapRef.current.coraMarkingBone = null;
    touchSnapRef.current.coraProxPoints = [];
    touchSnapRef.current.coraDistPoints = [];
    touchSnapRef.current.dfoHingeActive = false;
    touchSnapRef.current.dfoHingePoint = null;
    touchSnapRef.current.baseMarkingActive = null;
    touchSnapRef.current.imgZoom = 1;
    touchSnapRef.current.panOffset = { x: 0, y: 0 };
  };

  const processFile = async (file: File) => {
    const ext = file.name.toLowerCase();
    const isHeic = HEIC_EXTS.some((e) => ext.endsWith(e)) || file.type === "image/heic" || file.type === "image/heif";
    setError(null);
    resetMarkingState();
    const generation = imageGenerationRef.current;

    if (isHeic) {
      setConverting(true);
      setPreviewUrl((prev) => {
        if (prev && previewUrlOwnedRef.current) URL.revokeObjectURL(prev);
        previewUrlOwnedRef.current = false;
        return null;
      });
      try {
        const converted = await convertHeicToJpeg(file);
        if (generation !== imageGenerationRef.current) return;
        setSelectedFile(converted);
        const convertedUrl = URL.createObjectURL(converted);
        previewUrlOwnedRef.current = true;
        setPreviewUrl(convertedUrl);
      } catch (err) {
        if (generation !== imageGenerationRef.current) return;
        const detail = err instanceof Error ? err.message : String(err);
        setError(t("heicError", { detail }));
        setSelectedFile(null);
      } finally {
        if (generation === imageGenerationRef.current) setConverting(false);
      }
    } else {
      if (generation !== imageGenerationRef.current) return;
      setSelectedFile(file);
      setPreviewUrl((prev) => {
        if (prev && previewUrlOwnedRef.current) URL.revokeObjectURL(prev);
        const fileUrl = URL.createObjectURL(file);
        previewUrlOwnedRef.current = true;
        return fileUrl;
      });
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };

  // Compress image client-side before upload to avoid proxy timeout on large files.
  // X-rays from iPhones (HEIC) or scanners can be 10–20 MB; a raw upload over mobile
  // takes 60–90s and kills the proxy connection before the handler even starts.
  // Targeting ≤1500px / JPEG 85% yields ~300–600 KB — fast upload, full AI quality.
  const compressForUpload = (file: File): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const MAX = 1500;
        const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.round(img.naturalWidth * scale);
        const h = Math.round(img.naturalHeight * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(file); return; }
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          (blob) => { blob ? resolve(blob) : resolve(file); },
          "image/jpeg",
          0.85
        );
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Falha ao carregar imagem para compressão.")); };
      img.src = url;
    });
  };

  const analyze = async (force = false) => {
    if (!selectedFile) return;
    const generation = imageGenerationRef.current;
    setLoading(true);
    setError(null);
    try {
      const compressed = await compressForUpload(selectedFile);
      if (generation !== imageGenerationRef.current) return;
      const imageFile = new File([compressed], "image.jpg", { type: "image/jpeg" });
      const formData = new FormData();
      formData.append("image", imageFile);
      formData.append("tipoAnalise", selectedAxis);
      formData.append("lado", selectedLado);
      formData.append("estrategiaCorrecao", "fujisawa");
      formData.append("deformidadeEsperada", selectedDeformidade);
      formData.append("analysisContext", analysisContext);
      formData.append("wblDesejado", String(wblDesejado));
      if (force) formData.append("force", "true");
      if (hkaFromPoints !== null) {
        // If the physician explicitly selected a deformity direction that conflicts with
        // the computed sign (e.g. mirrored image or non-standard orientation), honour the
        // physician's choice and flip the sign automatically before sending to the AI.
        let hkaToSend = hkaFromPoints;
        if (selectedDeformidade === "varo"  && hkaFromPoints > 0) hkaToSend = -Math.abs(hkaFromPoints);
        if (selectedDeformidade === "valgo" && hkaFromPoints < 0) hkaToSend =  Math.abs(hkaFromPoints);
        formData.append("hkaConfirmado", String(hkaToSend));
      }
      if (computedAlDFA !== null) {
        formData.append("mldfaConfirmado", String(computedAlDFA));
      }
      if (computedAmPTA !== null) {
        // The new computeAmPTAFromPoints auto-detects medial vs lateral from the leg
        // side and uses the distal tibial axis, so click order no longer affects the
        // result. Send the value directly.
        formData.append("amptaConfirmado", String(computedAmPTA));
      }
      // ── Eixo Anatômico paciente-específico (geometric) ────────────────────
      // When the physician marked the 4 diaphysis points (2 fem + 2 tib), send
      // the geometrically-computed signed angle. The server uses this instead
      // of the population-average HKA + 6° formula.
      if (computedEixoAnatomico !== null) {
        formData.append("eixoAnatomicoConfirmado", String(computedEixoAnatomico));
      }
      // ── Detecção de deformidade extra-articular (Paley) ─────────────────
      // Envia AMA femoral e divergência tibial para o backend classificar
      // se há bowing diafisário. Quando há, o backend recomenda osteotomia
      // no ápice da deformidade e desabilita as opções de DFO/HTO.
      if (computedAmaFemoral !== null) {
        formData.append("amaFemoralConfirmado", String(computedAmaFemoral));
      }
      if (computedDivergenciaTibial !== null) {
        formData.append("divergenciaTibialConfirmada", String(computedDivergenciaTibial));
      }

      const res = await fetch("/api/xray/analyze", {
        method: "POST",
        credentials: "same-origin",
        body: formData,
      });

      const data = await res.json();
      if (generation !== imageGenerationRef.current) return;
      if (!res.ok) {
        setError(data.error ?? t("analysisError"));
        return;
      }
      setAnalysis(data.analysis);
      setRefiningAxis(null);
      refiningAxisRef.current = null;
      setStep("result");
      onAnalysisComplete?.(data.analysis);
      if (onImageSaved && selectedFile) {
        uploadXRayImage(selectedFile, generation).then((url) => {
          if (generation === imageGenerationRef.current && url) {
            lastUploadedImageUrlRef.current = url;
            onImageSaved(url);
          }
        });
      }
    } catch (err) {
      if (generation !== imageGenerationRef.current) return;
      const isAbort = (err as { name?: string })?.name === "AbortError" || (err as { name?: string })?.name === "TimeoutError";
      if (isAbort) {
        setError(t("analysisTimeout"));
      } else {
        setError(t("serverConnectionFailure"));
      }
    } finally {
      if (generation === imageGenerationRef.current) setLoading(false);
    }
  };

  const resetZoom = () => {
    const resetOffset = { x: 0, y: 0 };
    // Keep native touch handlers in sync immediately. React state is committed
    // asynchronously, so a mark made right after tapping "Ajustar" must already
    // use the reset viewport.
    touchSnapRef.current.imgZoom = 1;
    touchSnapRef.current.panOffset = resetOffset;
    // If a throttled pinch/pan frame is still queued, make it commit the reset
    // instead of restoring the previous zoom on the next animation frame.
    pendingPanRef.current = { zoom: 1, offset: resetOffset };
    setImgZoom(1);
    setPanOffset(resetOffset);
  };

  const viewportLockedByPointMarking =
    markingMode ||
    replacingIndex !== null ||
    baseMarkingActive !== null ||
    coraMarkingActive ||
    dfoHingeActive ||
    calibMode === "p1" ||
    calibMode === "p2";

  // The recovery action is useful only after the physician has actually
  // zoomed/panned the image. Do not cover the panoramic RX during the normal
  // 1× marking flow with a button that has nothing to reset.
  const imageViewportAdjusted =
    imgZoom > 1.01 ||
    Math.abs(panOffset.x) > 1 ||
    Math.abs(panOffset.y) > 1;

  const reset = () => {
    setStep("axis");
    setSelectedFile(null);
    setPreviewUrl((prev) => {
      if (prev && previewUrlOwnedRef.current) URL.revokeObjectURL(prev);
      previewUrlOwnedRef.current = false;
      return null;
    });
    setError(null);
    setShowRaciocinio(false);
    // Use the same complete image-dependent reset as processFile(). This keeps
    // a prior osteotomy simulation from leaking into a fresh RX workflow.
    resetMarkingState();
    resetZoom();
    if (fileRef.current) fileRef.current.value = "";
  };

  // ── Upload X-ray image to object storage ──────────────────────────────────
  const uploadXRayImage = async (file: File, generation = imageGenerationRef.current): Promise<string | null> => {
    try {
      setUploadingImage(true);
      const reqRes = await fetch("/api/storage/uploads/request-url", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type || "image/jpeg", purpose: "xray" }),
      });
      if (!reqRes.ok) return null;
      const { uploadURL, token } = await reqRes.json();
      const uploadRes = await fetch(uploadURL, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type || "image/jpeg" },
      });
      if (!uploadRes.ok) return null;

      const finalizeRes = await fetch("/api/storage/uploads/finalize", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!finalizeRes.ok) return null;
      const { objectPath } = await finalizeRes.json();
      return objectPath as string;
    } catch {
      return null;
    } finally {
      if (generation === imageGenerationRef.current) setUploadingImage(false);
    }
  };

  // Coordinates relative to the img element in original (pre-zoom) space.
  // getBoundingClientRect() accounts for CSS transform. We divide by imgZoom to get CSS-pixel
  // coords within the unscaled image, then multiply by the natural/CSS ratio to get natural
  // pixel coords. This keeps markedPoints invariant when the display size changes (e.g. when
  // marking mode ends and the image shrinks from maxHeight 780 → 468).
  const getImgCoordsFromClient = (clientX: number, clientY: number) => {
    const img = imgRef.current;
    if (!img) return null;
    const rect = img.getBoundingClientRect();
    const natScale = img.clientWidth ? img.naturalWidth / img.clientWidth : 1;
    return {
      x: ((clientX - rect.left) / imgZoom) * natScale,
      y: ((clientY - rect.top) / imgZoom) * natScale,
    };
  };
  const getImgCoords = (e: React.MouseEvent) => getImgCoordsFromClient(e.clientX, e.clientY);

  /**
   * Zoom centrado no meio do container — usado pelos botões +/− de toque.
   * Diferente do wheel zoom (centrado no cursor), aqui mantemos o centro visual.
   */
  const zoomByFactor = (factor: number) => {
    if (!previewUrl) return;
    const imgEl = imgRef.current;
    const contEl = imgContainerRef.current;
    if (!imgEl || !contEl) return;
    const curZoom = touchSnapRef.current.imgZoom;
    const newZoom = Math.min(8, Math.max(1, curZoom * factor));
    if (newZoom === curZoom) return;
    // Mantém o ponto que está no centro do container no mesmo lugar visual:
    // centro do container em coordenadas CSS da imagem sem zoom
    const curPan = touchSnapRef.current.panOffset;
    const contW = contEl.clientWidth;
    const contH = contEl.clientHeight;
    const imgW = imgEl.clientWidth;
    const imgH = imgEl.clientHeight;
    // Ponto central da imagem em coordenadas CSS da imagem (sem o zoom)
    const cx = (contW / 2 - curPan.x - (contW / 2 - imgW * curZoom / 2)) / curZoom;
    const cy = (contH / 2 - curPan.y - (contH / 2 - imgH * curZoom / 2)) / curZoom;
    const newPanX = contW / 2 - cx * newZoom - (contW / 2 - imgW * newZoom / 2);
    const newPanY = contH / 2 - cy * newZoom - (contH / 2 - imgH * newZoom / 2);
    const clamped = clampPan(newPanX, newPanY, newZoom);
    touchSnapRef.current.imgZoom = newZoom;
    touchSnapRef.current.panOffset = clamped;
    pendingPanRef.current = { zoom: newZoom, offset: clamped };
    if (rafPanRef.current === null) {
      rafPanRef.current = requestAnimationFrame(() => {
        rafPanRef.current = null;
        if (pendingPanRef.current) {
          if (pendingPanRef.current.zoom !== undefined) setImgZoom(pendingPanRef.current.zoom);
          setPanOffset(pendingPanRef.current.offset);
        }
      });
    }
  };

  const clampPan = (px: number, py: number, zoom: number) => {
    const img = imgRef.current;
    if (!img) return { x: px, y: py };
    const cont = imgContainerRef.current;
    const maxX = cont
      ? Math.max(0, img.clientWidth  * zoom / 2 - cont.clientWidth  / 2)
      : (img.clientWidth  * (zoom - 1)) / 2;
    const maxY = cont
      ? Math.max(0, img.clientHeight * zoom / 2 - cont.clientHeight / 2)
      : (img.clientHeight * (zoom - 1)) / 2;
    return {
      x: Math.max(-maxX, Math.min(maxX, px)),
      y: Math.max(-maxY, Math.min(maxY, py)),
    };
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!previewUrl) return;
    e.preventDefault();
    const imgEl = imgRef.current;
    const contEl = imgContainerRef.current;
    if (!imgEl || !contEl) return;

    const factor = e.deltaY > 0 ? 0.83 : 1.20;
    // Read zoom from snap ref so rapid wheel events chain correctly without stale state
    const curZoom = touchSnapRef.current.imgZoom;
    const newZoom = Math.min(8, Math.max(1, curZoom * factor));

    const imgRect = imgEl.getBoundingClientRect();
    const imgX = (e.clientX - imgRect.left) / curZoom;
    const imgY = (e.clientY - imgRect.top) / curZoom;
    const contRect = contEl.getBoundingClientRect();
    const newPanX = e.clientX - imgX * newZoom - contRect.left - contRect.width / 2 + imgEl.clientWidth * newZoom / 2;
    const newPanY = e.clientY - imgY * newZoom - contRect.top - contRect.height / 2 + imgEl.clientHeight * newZoom / 2;
    const clamped = clampPan(newPanX, newPanY, newZoom);

    // Update snap ref immediately so the next wheel event sees the correct zoom
    touchSnapRef.current.imgZoom = newZoom;
    touchSnapRef.current.panOffset = clamped;

    // Throttle React setState to one frame — avoids dozens of re-renders per scroll gesture
    pendingPanRef.current = { zoom: newZoom, offset: clamped };
    if (rafPanRef.current === null) {
      rafPanRef.current = requestAnimationFrame(() => {
        rafPanRef.current = null;
        if (pendingPanRef.current) {
          if (pendingPanRef.current.zoom !== undefined) setImgZoom(pendingPanRef.current.zoom);
          setPanOffset(pendingPanRef.current.offset);
        }
      });
    }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (markingMode || replacingIndex !== null) return;
    if (imgZoom <= 1) return;
    e.preventDefault();
    setIsDragging(true);
    setDragStart({ mx: e.clientX, my: e.clientY, px: panOffset.x, py: panOffset.y });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    setDragStart(null);
  };

  // ── Geometric angle computation from physician-marked landmarks ─────────────
  // mLDFA = angle at the LATERAL side of the intersection between the mechanical
  // femoral axis and the distal femoral joint line (normal 87° ± 3°).
  //
  // Geometry (image coords, Y downward):
  //   Vfem  = femoral head → condyle midpoint  (points DOWNWARD)
  //   Vjl   = Cmed → Clat                       (medial → lateral)
  //
  // The raw acos(Vfem · Vjl) gives the angle at the MEDIAL-proximal corner.
  // The mLDFA (lateral-distal corner) is always the SUPPLEMENT: 180° − acos(dot).
  //
  // Verification (T = upward tilt of lateral condyle from horizontal):
  //   Normal (T=+3°, lateral higher): dot=−sin3°=−0.052 → acos=93° → 180−93=87° ✓
  //   Varo   (T=−3°, lateral lower):  dot=+sin3°=+0.052 → acos=87° → 180−87=93° ✓
  //   Valgo  (T=+9°, lateral higher): dot=−sin9°=−0.156 → acos=99° → 180−99=81° ✓
  //
  // IMPORTANT: clicks must be in order Cmed first, Clat second (enforced by UI labels).
  // Works identically for right and left legs.
  const computeAlDFAFromPoints = (femHead: MarkedPoint, condyles: MarkedPoint[]): number => {
    const [Cmed, Clat] = condyles;
    const DFC = { x: (Cmed.x + Clat.x) / 2, y: (Cmed.y + Clat.y) / 2 };
    const Vfem = { x: DFC.x - femHead.x, y: DFC.y - femHead.y };
    const Vfem_mag = Math.hypot(Vfem.x, Vfem.y) || 1;
    const Vfem_u = { x: Vfem.x / Vfem_mag, y: Vfem.y / Vfem_mag };
    const Vjl = { x: Clat.x - Cmed.x, y: Clat.y - Cmed.y };
    const Vjl_mag = Math.hypot(Vjl.x, Vjl.y) || 1;
    const Vjl_u = { x: Vjl.x / Vjl_mag, y: Vjl.y / Vjl_mag };
    const dot = Math.max(-1, Math.min(1, Vfem_u.x * Vjl_u.x + Vfem_u.y * Vjl_u.y));
    // mLDFA = supplement of the raw angle (lateral-distal corner of the intersection).
    // Do NOT apply a ">90° flip" — that erroneously collapses varo (mLDFA>90°) to
    // the same range as normal/valgo, making it indistinguishable.
    const mldfa = 180 - Math.acos(dot) * (180 / Math.PI);
    return Math.round(mldfa * 10) / 10;
  };

  // ── Classificador clínico AMA femoral / Divergência tibial ─────────────────
  // Single source of truth para classificar severidade (normal/borderline/bowing).
  // Usado tanto no indicador em tempo real (durante marcação) quanto nos cards
  // permanentes de resultado, garantindo que ambos contam a mesma história.
  //
  // Limiares Paley (alinhados ao backend xray.ts):
  //   AMA femoral: normal 5°–9° | bowing <5° ou >9° | borderline ±0.5° da borda
  //   Divergência tibial: normal <2° | borderline 2°–3° | bowing >3°
  // Observação: "borderline" só existe DENTRO da faixa normal — é o aviso de
  // "está perto do limite, revise a marcação". Fora da faixa normal já é bowing.
  type Severity = "normal" | "borderline" | "bowing";
  const classifyAmaFemoral = (ama: number): Severity =>
    ama < 5 || ama > 9 ? "bowing"
      : ama < 5.5 || ama > 8.5 ? "borderline"
      : "normal";
  const classifyDivTibial = (divAbs: number): Severity =>
    divAbs > 3 ? "bowing"
      : divAbs >= 2 ? "borderline"
      : "normal";
  const severityColor = (sev: Severity): string =>
    sev === "bowing" ? "text-red-600"
      : sev === "borderline" ? "text-amber-600"
      : "text-emerald-600";

  // ── AMA femoral e divergência tibial (detecção de deformidade extra-articular)
  // Retorna ângulo entre duas LINHAS (não vetores orientados) em coords de pixel,
  // normalizado para 0°–90°. Isso garante que a ordem de marcação dos pontos
  // (prox→dist ou dist→prox) não afeta o resultado — comparar eixos ósseos é
  // intrinsecamente uma operação de linha, não de vetor direcionado.
  // Retorna null se algum segmento for degenerado (pontos duplicados/coincidentes)
  // para evitar falso-positivo de bowing por erro de marcação.
  const angleBetweenVectors = (
    p1a: MarkedPoint, p1b: MarkedPoint,   // linha 1: p1a — p1b
    p2a: MarkedPoint, p2b: MarkedPoint,   // linha 2: p2a — p2b
  ): number | null => {
    const v1 = { x: p1b.x - p1a.x, y: p1b.y - p1a.y };
    const v2 = { x: p2b.x - p2a.x, y: p2b.y - p2a.y };
    const m1 = Math.hypot(v1.x, v1.y);
    const m2 = Math.hypot(v2.x, v2.y);
    const EPSILON = 1; // pixel — segmento menor que isso = ponto duplicado
    if (m1 < EPSILON || m2 < EPSILON) return null;
    let cos = (v1.x * v2.x + v1.y * v2.y) / (m1 * m2);
    cos = Math.max(-1, Math.min(1, cos));
    const theta = Math.acos(cos) * 180 / Math.PI;
    // Equivalência de linha: trata ângulo e seu suplementar como o mesmo
    // (vetor invertido = mesma linha) → resultado sempre em [0°, 90°]
    const lineAngle = Math.min(theta, 180 - theta);
    return Math.round(lineAngle * 10) / 10;
  };

  // Eixo Anatômico tibiofemoral paciente-específico:
  // ângulo entre o eixo diafisário do fêmur (Fp→Fd) e o eixo diafisário da tíbia (Tp→Td).
  // Reusa computeHKAFromPoints com um vértice "joelho virtual" = ponto médio entre Fd e Tp.
  // Sinal segue convenção HKA: negativo = Varo, positivo = Valgo.
  const computeEixoAnatomicoFromPoints = (
    femPts: MarkedPoint[],
    tibPts: MarkedPoint[],
    lado: "direito" | "esquerdo" | "bilateral",
  ): number | null => {
    if (femPts.length < 2 || tibPts.length < 2) return null;
    const [Fp, Fd] = femPts;
    const [Tp, Td] = tibPts;
    const knee = { x: (Fd.x + Tp.x) / 2, y: (Fd.y + Tp.y) / 2 };
    return computeHKAFromPoints([Fp, knee, Td], lado);
  };

  // aMPTA = acos(dot(Vtib_distal, Vpm_lateral_to_medial)) in image pixel coords.
  //
  // Formula: acos(dot) — NO 180° subtraction needed.
  //   Normal ≈ 87°. Varo tibial < 87°. Valgo tibial > 87°.
  //
  // IMPORTANT: click order is NOT reliable. Auto-detect medial vs lateral
  // using x-position + leg side:
  //
  //   Standard AP radiograph convention: image viewed as if facing the patient.
  //     Patient's RIGHT side  → viewer's LEFT  → SMALLER x in image.
  //     Patient's LEFT  side  → viewer's RIGHT → LARGER  x in image.
  //
  //   RIGHT leg medial = toward body midline = patient's LEFT = LARGER  x.
  //   LEFT  leg medial = toward body midline = patient's RIGHT = SMALLER x.
  //   BILATERAL: fallback to click order (p0 labeled as medial in UI).
  //
  // Geometry (Vtib ≈ (0,+1) downward, right leg varo: Pmed.y > Plat.y):
  //   Vpm = Pmed − Plat = (+Δx, +Δy): dot = +Δy/|Vpm| > 0 → acos < 90° ✓ (varo)
  //   Valgo tibial (medial higher, Pmed.y < Plat.y): dot < 0 → acos > 90° ✓
  const computeAmPTAFromPoints = (
    tibialSpine: MarkedPoint,
    ankle: MarkedPoint,
    plateau: MarkedPoint[],
    lado: "direito" | "esquerdo" | "bilateral",
  ): number => {
    const [p0, p1] = plateau;

    // Auto-detect medial vs lateral by x-position + AP convention.
    // This makes the result insensitive to click order.
    let Pmed: MarkedPoint, Plat: MarkedPoint;
    if (lado === "direito") {
      // Right leg AP: medial = LARGER x (patient's left / midline side → viewer's right)
      [Pmed, Plat] = p0.x >= p1.x ? [p0, p1] : [p1, p0];
    } else if (lado === "esquerdo") {
      // Left leg AP: medial = SMALLER x (patient's right / midline side → viewer's left)
      [Pmed, Plat] = p0.x <= p1.x ? [p0, p1] : [p1, p0];
    } else {
      // Bilateral: trust click order (p0 labeled as medial in UI)
      [Pmed, Plat] = [p0, p1];
    }

    // Vtib: distal direction (tibialSpine/knee center → ankle), downward in image
    const Vtib = { x: ankle.x - tibialSpine.x, y: ankle.y - tibialSpine.y };
    const Vtib_mag = Math.hypot(Vtib.x, Vtib.y) || 1;
    const Vtib_u = { x: Vtib.x / Vtib_mag, y: Vtib.y / Vtib_mag };

    // Vpm: from lateral toward medial
    const Vpm = { x: Pmed.x - Plat.x, y: Pmed.y - Plat.y };
    const Vpm_mag = Math.hypot(Vpm.x, Vpm.y) || 1;
    const Vpm_u = { x: Vpm.x / Vpm_mag, y: Vpm.y / Vpm_mag };

    const dot = Math.max(-1, Math.min(1, Vtib_u.x * Vpm_u.x + Vtib_u.y * Vpm_u.y));
    return Math.round(Math.acos(dot) * (180 / Math.PI) * 10) / 10;
  };

  // ── CORA geometry helpers ──────────────────────────────────────────────────
  // Find intersection of two infinite lines, each defined by 2 points
  const lineIntersection2D = (p1: { x: number; y: number }, p2: { x: number; y: number }, p3: { x: number; y: number }, p4: { x: number; y: number }): { x: number; y: number } | null => {
    const d1 = { x: p2.x - p1.x, y: p2.y - p1.y };
    const d2 = { x: p4.x - p3.x, y: p4.y - p3.y };
    const cross = d1.x * d2.y - d1.y * d2.x;
    if (Math.abs(cross) < 1e-10) return null; // parallel
    const t = ((p3.x - p1.x) * d2.y - (p3.y - p1.y) * d2.x) / cross;
    return { x: p1.x + t * d1.x, y: p1.y + t * d1.y };
  };

  const computeCORA = (femurPts: { x: number; y: number }[], tibiaPts: { x: number; y: number }[]): { point: { x: number; y: number }; angle: number } | null => {
    if (femurPts.length < 2 || tibiaPts.length < 2) return null;
    const intersection = lineIntersection2D(femurPts[0], femurPts[1], tibiaPts[0], tibiaPts[1]);
    if (!intersection) return null;
    const vFem = { x: femurPts[1].x - femurPts[0].x, y: femurPts[1].y - femurPts[0].y };
    const vTib = { x: tibiaPts[1].x - tibiaPts[0].x, y: tibiaPts[1].y - tibiaPts[0].y };
    const magFem = Math.hypot(vFem.x, vFem.y) || 1;
    const magTib = Math.hypot(vTib.x, vTib.y) || 1;
    const dot = Math.max(-1, Math.min(1, (vFem.x * vTib.x + vFem.y * vTib.y) / (magFem * magTib)));
    const ang = Math.acos(dot) * (180 / Math.PI);
    const deformityAngle = Math.round(Math.min(ang, 180 - ang) * 10) / 10;
    return { point: intersection, angle: deformityAngle };
  };

  const recordBasePoint = (active: BasePhase, coords: MarkedPoint) => {
    const { bone, phase } = active;
    if (phase === 'entrada') {
      const updated = {
        ...baseMarcacoesRef.current,
        [bone]: { entrada: coords },
      };
      baseMarcacoesRef.current = updated;
      setBaseMarcacoes(updated);
      const next = { bone, phase: 'charneira' as const };
      setBaseMarkingActive(next);
      baseMarkingActiveRef.current = next;
      touchSnapRef.current.baseMarkingActive = next;
      return;
    }

    const entrada = baseMarcacoesRef.current[bone]?.entrada;
    if (!entrada) {
      const restart = { bone, phase: 'entrada' as const };
      setBaseMarkingActive(restart);
      baseMarkingActiveRef.current = restart;
      touchSnapRef.current.baseMarkingActive = restart;
      return;
    }

    const updated = {
      ...baseMarcacoesRef.current,
      [bone]: { entrada, charneira: coords },
    };
    baseMarcacoesRef.current = updated;
    setBaseMarcacoes(updated);

    const nextBone = requiredBaseBonesRef.current.find((candidate) => {
      const points = updated[candidate];
      return !(points?.entrada && points.charneira);
    });
    if (nextBone) {
      const next = {
        bone: nextBone,
        phase: updated[nextBone]?.entrada ? 'charneira' as const : 'entrada' as const,
      };
      setBaseMarkingActive(next);
      baseMarkingActiveRef.current = next;
      touchSnapRef.current.baseMarkingActive = next;
      setMarkingMode(true);
      touchSnapRef.current.markingMode = true;
      setStep('upload');
      return;
    }

    setBaseMarkingActive(null);
    baseMarkingActiveRef.current = null;
    touchSnapRef.current.baseMarkingActive = null;
    setMarkingMode(false);
    touchSnapRef.current.markingMode = false;
    setStep('result');
    setTimeout(() => cunhaPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 150);
  };

  // Extend a line defined by 2 points to span the full image
  const extendLineToImgBounds = (p1: { x: number; y: number }, p2: { x: number; y: number }, imgW: number, imgH: number): [{ x: number; y: number }, { x: number; y: number }] => {
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    if (Math.abs(dx) < 1e-10 && Math.abs(dy) < 1e-10) return [p1, p2];
    const ts: number[] = [];
    if (Math.abs(dx) > 1e-10) { ts.push(-p1.x / dx); ts.push((imgW - p1.x) / dx); }
    if (Math.abs(dy) > 1e-10) { ts.push(-p1.y / dy); ts.push((imgH - p1.y) / dy); }
    ts.sort((a, b) => a - b);
    return [
      { x: p1.x + ts[0] * dx, y: p1.y + ts[0] * dy },
      { x: p1.x + ts[ts.length - 1] * dx, y: p1.y + ts[ts.length - 1] * dy },
    ];
  };

  const handleMarkingClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const coords = getImgCoords(e);
    if (!coords) return;

    // ── Calibração de escala (Etapa 0) — prioridade máxima ────────────────────
    if (calibModeRef.current === 'p1') {
      setCalibP1(coords);
      setCalibMode('p2');
      calibModeRef.current = 'p2';
      touchSnapRef.current.calibMode = 'p2';
      return;
    }
    if (calibModeRef.current === 'p2') {
      setCalibP2(coords);
      setCalibMode('confirm');
      calibModeRef.current = 'confirm';
      touchSnapRef.current.calibMode = 'confirm';
      return;
    }

    // ── Base marking (Prompt 3) — 2 taps per bone: entrada → charneira ────────
    const activeBaseMarking = baseMarkingActiveRef.current;
    if (activeBaseMarking) {
      recordBasePoint(activeBaseMarking, coords);
      return;
    }

    // ── DFO hinge — single-point, takes priority over all other flows ─────────
    if (dfoHingeActive) {
      setDfoHingePoint(coords);
      touchSnapRef.current.dfoHingePoint = coords;
      setDfoHingeActive(false);
      dfoHingeActiveRef.current = false;
      touchSnapRef.current.dfoHingeActive = false;
      setMarkingMode(false);
      touchSnapRef.current.markingMode = false;
      setStep('result');
      return;
    }

    // ── CORA marking — takes priority over regular 11-point flow ──────────────
    if (coraMarkingActive) {
      if (coraMarkingPhase === 'prox') {
        if (coraProxPoints.length >= 2) return;
        const np = [...coraProxPoints, coords];
        setCoraProxPoints(np);
        touchSnapRef.current.coraProxPoints = np;
        if (np.length === 2) {
          setCoraMarkingPhase('dist');
          coraMarkingPhaseRef.current = 'dist';
          touchSnapRef.current.coraMarkingPhase = 'dist';
        }
      } else if (coraMarkingPhase === 'dist') {
        if (coraDistPoints.length >= 2) return;
        const np = [...coraDistPoints, coords];
        setCoraDistPoints(np);
        touchSnapRef.current.coraDistPoints = np;
        if (np.length === 2) {
          const intersection = lineLineIntersection(coraProxPoints[0], coraProxPoints[1], np[0], np[1]);
          const angle = angleBetweenSegments(coraProxPoints[0], coraProxPoints[1], np[0], np[1]);
          if (intersection) {
            const result = { angle, x: intersection.x, y: intersection.y };
            if (coraMarkingBoneRef.current === 'femoral') setComputedCoraFemoral(result);
            else setComputedCoraTibial(result);
          }
          setCoraMarkingPhase(null);
          coraMarkingPhaseRef.current = null;
          touchSnapRef.current.coraMarkingPhase = null;
          setMarkingMode(false);
          touchSnapRef.current.markingMode = false;
        }
      }
      return;
    }

    // aLDFA marking mode
    if (markingTarget === 'aldfa') {
      if (!markingMode || aldfaPoints.length >= 2) return;
      const np = [...aldfaPoints, coords];
      setAldfaPoints(np);
      if (np.length === 2) {
        // Auto-advance to aMPTA marking
        touchSnapRef.current.markingTarget = 'ampta';
        touchSnapRef.current.amptaPoints = [];
        setMarkingTarget('ampta');
        setAmptaPoints([]);
        setComputedAmPTA(null);
      }
      return;
    }

    // aMPTA marking mode
    if (markingTarget === 'ampta') {
      if (!markingMode || amptaPoints.length >= 2) return;
      const np = [...amptaPoints, coords];
      setAmptaPoints(np);
      if (np.length === 2) {
        // Auto-advance to Eixo Femoral marking
        touchSnapRef.current.markingTarget = 'eixoFemoral';
        touchSnapRef.current.eixoFemoralPoints = [];
        setMarkingTarget('eixoFemoral');
        setEixoFemoralPoints([]);
      }
      return;
    }

    // Eixo Femoral diaphysis marking mode (2 pts)
    if (markingTarget === 'eixoFemoral') {
      if (!markingMode || eixoFemoralPoints.length >= 2) return;
      const np = [...eixoFemoralPoints, coords];
      setEixoFemoralPoints(np);
      if (np.length === 2) {
        // Auto-advance to Eixo Tibial.
        // Ao refinar apenas o eixo femoral, preservamos os pontos tibiais existentes
        // (não apagamos) — o médico marcou o segmento reto femoral e não precisa
        // repetir a tibial.
        touchSnapRef.current.markingTarget = 'eixoTibial';
        setMarkingTarget('eixoTibial');
        if (refiningAxisRef.current !== 'femoral') {
          touchSnapRef.current.eixoTibialPoints = [];
          setEixoTibialPoints([]);
        }
      }
      return;
    }

    // Eixo Tibial diaphysis marking mode (2 pts) — last step
    if (markingTarget === 'eixoTibial') {
      if (!markingMode || eixoTibialPoints.length >= 2) return;
      const np = [...eixoTibialPoints, coords];
      setEixoTibialPoints(np);
      if (np.length === 2) {
        setMarkingMode(false); // all 11 done
      }
      return;
    }

    // HKA mode: replacing a specific point
    if (replacingIndex !== null) {
      const newPoints = [...markedPoints];
      newPoints[replacingIndex] = coords;
      setMarkedPoints(newPoints);
      setReplacingIndex(null);
      if (newPoints.length === 3) {
        const hka = computeHKAFromPoints(newPoints, selectedLado);
        setHkaFromPoints(hka);
      }
      return;
    }

    // HKA mode: normal sequential marking
    if (!markingMode || markedPoints.length >= 3) return;
    const newPoints = [...markedPoints, coords];
    setMarkedPoints(newPoints);
    if (newPoints.length === 3) {
      const hka = computeHKAFromPoints(newPoints, selectedLado);
      setHkaFromPoints(hka);
      // Auto-advance to aLDFA marking instead of stopping
      touchSnapRef.current.markingTarget = 'aldfa';
      touchSnapRef.current.aldfaPoints = [];
      setMarkingTarget('aldfa');
      setAldfaPoints([]);
      setComputedAlDFA(null);
    }
  };

  // ── Calibração de escala — funções de controle ────────────────────────────
  const startCalibration = () => {
    setCalibP1(null);
    setCalibP2(null);
    setCalibDistInput('');
    setCalibMode('p1');
    calibModeRef.current = 'p1';
    touchSnapRef.current.calibMode = 'p1';
  };

  const confirmCalibration = () => {
    if (!calibP1 || !calibP2) return;
    const dist = parseFloat(calibDistInput);
    if (!isFinite(dist) || dist <= 0) return;
    const pxDist = Math.hypot(calibP2.x - calibP1.x, calibP2.y - calibP1.y);
    if (pxDist < 10) return;
    const mpp = dist / pxDist;
    setMmPorPixel(mpp);
    setCalibMode('done');
    calibModeRef.current = 'done';
    touchSnapRef.current.calibMode = 'done';
    // Auto-reset zoom after calibration so the full image is visible for marking
    resetZoom();
  };

  const resetCalibration = () => {
    setCalibMode('idle');
    calibModeRef.current = 'idle';
    touchSnapRef.current.calibMode = 'idle';
    setCalibP1(null);
    setCalibP2(null);
    setCalibDistInput('');
    setMmPorPixel(null);
  };

  const startMarking = () => {
    touchSnapRef.current.markingMode = true;
    touchSnapRef.current.markedPoints = [];
    touchSnapRef.current.replacingIndex = null;
    touchSnapRef.current.markingTarget = 'hka';
    touchSnapRef.current.aldfaPoints = [];
    touchSnapRef.current.amptaPoints = [];
    touchSnapRef.current.eixoFemoralPoints = [];
    touchSnapRef.current.eixoTibialPoints = [];
    setMarkedPoints([]);
    setHkaFromPoints(null);
    setReplacingIndex(null);
    setMarkingTarget('hka');
    setAldfaPoints([]);
    setAmptaPoints([]);
    setEixoFemoralPoints([]);
    setEixoTibialPoints([]);
    setComputedAlDFA(null);
    setComputedAmPTA(null);
    setComputedEixoAnatomico(null);
    setComputedAmaFemoral(null);
    setComputedDivergenciaTibial(null);
    setMarkingMode(true);
    setMagnifierPos(null);
  };

  const startMarkingAlDFA = () => {
    touchSnapRef.current.markingMode = true;
    touchSnapRef.current.aldfaPoints = [];
    touchSnapRef.current.replacingIndex = null;
    touchSnapRef.current.markingTarget = 'aldfa';

    setAldfaPoints([]);
    setMarkingTarget('aldfa');
    setComputedAlDFA(null);
    setMarkingMode(true);
    setMagnifierPos(null);
  };

  const startMarkingAmPTA = () => {
    touchSnapRef.current.markingMode = true;
    touchSnapRef.current.amptaPoints = [];
    touchSnapRef.current.replacingIndex = null;
    touchSnapRef.current.markingTarget = 'ampta';

    setAmptaPoints([]);
    setMarkingTarget('ampta');
    setComputedAmPTA(null);
    setMarkingMode(true);
    setMagnifierPos(null);
  };


  // ── Inline angle editing ──────────────────────────────────────────────────
  const openEdit = (field: string, currentVal: number) => {
    setEditingAngle(field);
    setEditValue(String(currentVal));
  };

  const cancelEdit = () => {
    setEditingAngle(null);
    setEditValue("");
  };

  const confirmEdit = (field: string) => {
    const v = parseFloat(editValue);
    if (isNaN(v) || !analysis) { cancelEdit(); return; }
    const upd = { ...analysis };
    if (field === "mLDFA" && upd.mLDFA) {
      upd.mLDFA = { ...(upd.mLDFA as Record<string, unknown>), valor: v, status: v >= 84 && v <= 90 ? "Normal" : "Alterado" } as typeof upd.mLDFA;
    } else if (field === "aMPTA" && upd.aMPTA) {
      upd.aMPTA = { ...(upd.aMPTA as Record<string, unknown>), valor: v, status: v >= 84 && v <= 90 ? "Normal" : "Alterado" } as typeof upd.aMPTA;
    } else if (field === "JLCA" && upd.JLCA) {
      upd.JLCA = { ...(upd.JLCA as Record<string, unknown>), valor: v, status: v <= 2 ? "Normal" : "Alterado" } as typeof upd.JLCA;
    }
    setAnalysis(upd);
    setAnglesEdited(true);
    cancelEdit();
  };


  const recalculatePlanning = async () => {
    if (!analysis) return;
    const generation = imageGenerationRef.current;
    setRecalculating(true);
    try {
      const res = await fetch("/api/xray/recalculate", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysis, wblDesejado, estrategiaCorrecao: wblDesejado === 50 ? "neutro" : "lateral" }),
      });
      const data = await res.json();
      if (generation !== imageGenerationRef.current) return;
      if (res.ok) {
        const updated = {
          ...analysis,
          opcoesOsteotomia: data.opcoesOsteotomia,
          _selectedOsteotomiaIdx: null,
          _selectedOsteotomiaId: null,
          anguloCorrecao: data.anguloCorrecao,
          anguloCorrecaoRaw: data.anguloCorrecaoRaw,
          percentualWBL: data.percentualWBL,
          // Refreshed origem do desvio + per-segment contributions, computed
          // server-side from the (possibly edited) angles via Paley method.
          ...(data.origemDesvio !== undefined && { origemDesvio: data.origemDesvio }),
          ...(data.contribuicaoFemoral !== undefined && { contribuicaoFemoral: data.contribuicaoFemoral }),
          ...(data.contribuicaoTibial !== undefined && { contribuicaoTibial: data.contribuicaoTibial }),
          ...(data.contribuicaoArticular !== undefined && { contribuicaoArticular: data.contribuicaoArticular }),
          ...(data.contribuicaoFemoraltexto !== undefined && { contribuicaoFemoraltexto: data.contribuicaoFemoraltexto }),
          ...(data.contribuicaoTibialTexto !== undefined && { contribuicaoTibialTexto: data.contribuicaoTibialTexto }),
          // If server auto-corrected a supplementary mLDFA/aMPTA, reflect that.
          ...(data.mLDFA !== undefined && { mLDFA: data.mLDFA }),
          ...(data.aMPTA !== undefined && { aMPTA: data.aMPTA }),
          ...(data._avisoCorrecaoSuplementar !== undefined && {
            _avisoCorrecaoSuplementar: data._avisoCorrecaoSuplementar,
          } as Record<string, unknown>),
        };
        // Measurements may have changed the anatomical level. A former saved
        // HTO/DFO must not remain an implicit selection after recalculation.
        setSelectedOsteotomiaIdx(null);
        setNivelDecisaoOverride(null);
        setAnalysis(updated as typeof analysis);
        setAnglesEdited(false);
        onAnalysisComplete?.(updated as typeof analysis);
      }
    } catch {
      // silent fail
    } finally {
      if (generation === imageGenerationRef.current) setRecalculating(false);
    }
  };

  /**
   * Inicia o refinamento de um eixo anatômico diretamente do card de bowing/borderline.
   * Limpa os pontos daquele eixo, entra em modo de marcação e volta ao passo de upload.
   * O médico re-marca 2 pontos no segmento reto da diáfise e reanalisam normalmente.
   */
  const startAxisRefinement = (axis: 'femoral' | 'tibial') => {
    setRefiningAxis(axis);
    refiningAxisRef.current = axis;
    if (axis === 'femoral') {
      setEixoFemoralPoints([]);
      touchSnapRef.current.eixoFemoralPoints = [];
      setMarkingTarget('eixoFemoral');
      touchSnapRef.current.markingTarget = 'eixoFemoral';
    } else {
      setEixoTibialPoints([]);
      touchSnapRef.current.eixoTibialPoints = [];
      setMarkingTarget('eixoTibial');
      touchSnapRef.current.markingTarget = 'eixoTibial';
    }
    setMarkingMode(true);
    touchSnapRef.current.markingMode = true;
    setStep('upload');
  };

  // ── startCoraMarking ────────────────────────────────────────────────────────
  // Ativa o modo de localização manual do CORA na radiografia.
  // O médico marca 2 pontos no segmento proximal e 2 no distal;
  // a interseção das duas retas = ponto CORA, o ângulo = ângulo de correção.
  const startCoraMarking = (bone: 'femoral' | 'tibial') => {
    setCoraMarkingBone(bone);
    coraMarkingBoneRef.current = bone;
    setCoraMarkingActive(true);
    setCoraMarkingPhase('prox');
    coraMarkingPhaseRef.current = 'prox';
    setCoraProxPoints([]);
    setCoraDistPoints([]);
    touchSnapRef.current.coraMarkingActive = true;
    touchSnapRef.current.coraMarkingPhase = 'prox';
    touchSnapRef.current.coraMarkingBone = bone;
    touchSnapRef.current.coraProxPoints = [];
    touchSnapRef.current.coraDistPoints = [];
    setMarkingMode(true);
    touchSnapRef.current.markingMode = true;
    setStep('upload');
  };

  const cancelCoraMarking = () => {
    setCoraMarkingActive(false);
    setCoraMarkingPhase(null);
    coraMarkingPhaseRef.current = null;
    setCoraProxPoints([]);
    setCoraDistPoints([]);
    touchSnapRef.current.coraMarkingActive = false;
    touchSnapRef.current.coraMarkingPhase = null;
    touchSnapRef.current.coraProxPoints = [];
    touchSnapRef.current.coraDistPoints = [];
    setMarkingMode(false);
    touchSnapRef.current.markingMode = false;
  };

  // ── DFO Miniaci Geométrico — derivado de H, A, G (charneira), T (WBL% no platô) ──
  const dfoMiniaciResult = useMemo(() => {
    const H = markedPoints[0];   // Cabeça Femoral
    const A = markedPoints[2];   // Cúpula do Tálus (tornozelo)
    const G = dfoHingePoint;
    const jlca = analysis?.JLCA?.valor ?? 0;

    if (H && A && G && amptaPoints.length >= 2) {
      try {
        const T = computeTibialTarget(amptaPoints[0], amptaPoints[1], wblDesejado);
        const alpha = anguloMiniaciDFO(H, A, G, T);
        const ajuste = calcJlcaAjusteGraduadoDFO(jlca);
        const alphaAlvo = Math.max(0, Math.round((alpha - ajuste) * 10) / 10);
        const cunha_mm = Math.round(alphaAlvo * 1.26 * 10) / 10;
        const ajusteLabel = jlcaAjusteLabel(jlca);
        return { method: 'miniaci-geometrico' as const, alpha: Math.round(alpha * 10) / 10, ajuste, alphaAlvo, cunha_mm, ajusteLabel };
      } catch {
        return null;
      }
    }

    // Fallback Paley: correcaoFemoral = |mLDFA − 87|
    const mldfa = analysis?.mLDFA?.valor;
    if (mldfa != null && (analysis?.planoFemoral?.indicado || analysis?.distribuicaoDupla?.aplicavel)) {
      const corrFem = Math.abs(mldfa - 87);
      const ajuste = calcJlcaAjusteGraduadoDFO(jlca);
      const alphaAlvo = Math.max(0, Math.round((corrFem - ajuste) * 10) / 10);
      const cunha_mm = Math.round(alphaAlvo * 1.26 * 10) / 10;
      const ajusteLabel = jlcaAjusteLabel(jlca);
      return { method: 'paley-fallback' as const, alpha: Math.round(corrFem * 10) / 10, ajuste, alphaAlvo, cunha_mm, ajusteLabel };
    }
    return null;
  }, [markedPoints, dfoHingePoint, amptaPoints, wblDesejado, analysis]);

  // ── Motor de decisão de nível (Prompt 2) ─────────────────────────────────
  const nivelDecisaoResult = useMemo(() => {
    const mldfa = analysis?.mLDFA?.valor;
    const mpta  = analysis?.aMPTA?.valor;
    if (mldfa == null || mpta == null) return null;
    const ajuste = dfoMiniaciResult?.ajuste ?? 0;
    return decidirNivel(mldfa, mpta, ajuste);
  }, [analysis, dfoMiniaciResult]);

  // Opção efetivamente selecionada pelo médico.
  const opcaoSelecionada: OpcaoNivel | null = useMemo(() => {
    if (!nivelDecisaoResult) return null;
    const selectedOption = selectedOsteotomiaIdx !== null && Array.isArray(analysis?.opcoesOsteotomia)
      ? (analysis.opcoesOsteotomia as Array<Record<string, unknown>>)[selectedOsteotomiaIdx]
      : null;
    // A saved procedure is an automatic default, not an anatomical override.
    // Reject legacy HTO/DFO choices when recalculated measurements changed level.
    const savedSelectionOverride = selectedOption &&
      isOptionCompatibleWithPrimaryClass(selectedOption.id, nivelDecisaoResult.primaryClass)
      ? getNivelOverrideForOsteotomia(selectedOption.id, nivelDecisaoResult.primaryClass)
      : null;
    const selectedOverride = savedSelectionOverride && nivelDecisaoResult.opcoes.some(option => option.id === savedSelectionOverride)
      ? savedSelectionOverride
      : null;
    const id = nivelDecisaoOverride ?? selectedOverride;
    return nivelDecisaoResult.opcoes.find(o => o.id === id) ?? null;
  }, [analysis?.opcoesOsteotomia, nivelDecisaoResult, nivelDecisaoOverride, selectedOsteotomiaIdx]);

  useEffect(() => {
    if (selectedOsteotomiaIdx === null || !Array.isArray(analysis?.opcoesOsteotomia) || !nivelDecisaoResult) return;
    const selected = (analysis.opcoesOsteotomia as Array<Record<string, unknown>>)[selectedOsteotomiaIdx];
    if (!selected || !isOptionCompatibleWithPrimaryClass(selected.id, nivelDecisaoResult.primaryClass)) {
      setSelectedOsteotomiaIdx(null);
      setNivelDecisaoOverride(null);
      setBaseMarkingActive(null);
      baseMarkingActiveRef.current = null;
      touchSnapRef.current.baseMarkingActive = null;
      setMarkingMode(false);
      touchSnapRef.current.markingMode = false;
      onOsteotomiaChoose?.(null, null);
    }
  }, [analysis?.opcoesOsteotomia, nivelDecisaoResult, selectedOsteotomiaIdx]);

  const startBaseMarking = (bone: 'femur' | 'tibia') => {
    const currentPoints = baseMarcacoesRef.current[bone];
    if (currentPoints?.entrada && currentPoints.charneira) {
      const updated = { ...baseMarcacoesRef.current };
      delete updated[bone];
      baseMarcacoesRef.current = updated;
      setBaseMarcacoes(updated);
    }
    const phase = {
      bone,
      phase: currentPoints?.entrada && !currentPoints.charneira ? 'charneira' as const : 'entrada' as const,
    };
    setBaseMarkingActive(phase);
    baseMarkingActiveRef.current = phase;
    touchSnapRef.current.baseMarkingActive = phase;
    setMarkingMode(true);
    touchSnapRef.current.markingMode = true;
    setStep('upload');
  };

  const handleOsteotomiaSelect = (idx: number | null, opcoes: Array<Record<string, unknown>>) => {
    const selectedOption = idx === null ? null : opcoes[idx];
    const levelOverride = getNivelOverrideForOsteotomia(selectedOption?.id, nivelDecisaoResult?.primaryClass);
    const compatible = !selectedOption
      || !nivelDecisaoResult
      || isOptionCompatibleWithPrimaryClass(selectedOption.id, nivelDecisaoResult.primaryClass);

    if (!compatible) {
      setSelectedOsteotomiaIdx(null);
      setNivelDecisaoOverride(null);
      onOsteotomiaChoose?.(null, null);
      return;
    }

    setSelectedOsteotomiaIdx(idx);
    setAnalysis((current) => current
      ? {
        ...current,
        _selectedOsteotomiaIdx: idx,
        _selectedOsteotomiaId: idx === null ? null : String(selectedOption?.id ?? ""),
      }
      : current);
    setNivelDecisaoOverride(
      levelOverride && nivelDecisaoResult?.opcoes.some(option => option.id === levelOverride)
        ? levelOverride
        : null,
    );
    setMmEdit(null);
    if (onOsteotomiaChoose) {
      onOsteotomiaChoose(selectedOption, idx);
    }

    if (selectedOption && levelOverride && (previewUrl || savedImageUrl)) {
      const selectedLevel = nivelDecisaoResult?.opcoes.find(option => option.id === levelOverride);
      const firstIncompleteBone = (['femur', 'tibia'] as const).find((bone) => {
        const correction = bone === 'femur' ? selectedLevel?.corrFem : selectedLevel?.corrTib;
        const points = baseMarcacoes[bone];
        return Boolean(correction) && !(points?.entrada && points.charneira);
      });
      if (firstIncompleteBone) {
        startBaseMarking(firstIncompleteBone);
      }
    }
  };

  // ── Cunha por nível (Prompt 3) — guard clínico aplicado ──────────────────
  type CunhaPorNivelItem = { osso: 'femur' | 'tibia'; cunha: CunhaResultado; base: BaseCalibrada; corrDeg: number; anguloCorrigido: import('@/lib/cunha').AnguloCorrigido };
  const cunhaPorNivel = useMemo((): CunhaPorNivelItem[] | null => {
    if (!opcaoSelecionada || opcaoSelecionada.locked) return null;
    const resultado: CunhaPorNivelItem[] = [];
    for (const osso of ['femur', 'tibia'] as const) {
      const corrDeg = Math.abs(osso === 'femur' ? opcaoSelecionada.corrFem : opcaoSelecionada.corrTib);
      if (corrDeg === 0) continue;
      const ang = buildAnguloCorrigido(
        corrDeg,
        osso,
        opcaoSelecionada.locked,
        dfoMiniaciResult?.method === 'miniaci-geometrico' ? 'geometrico' : 'paley_fallback',
      );
      const bpts = baseMarcacoes[osso];
      const marcacao: BaseMarcacao | null =
        bpts?.entrada && bpts.charneira
          ? { entrada: bpts.entrada, charneira: bpts.charneira }
          : null;
      const base: import('@/lib/cunha').BaseCalibrada = resolverBase(marcacao, osso, mmPorPixel, 1.0, 0, mmPorPixel !== null);
      try {
        const cunha = calcularCunha(ang, base);
        resultado.push({ osso, cunha, base, corrDeg, anguloCorrigido: ang });
      } catch {
        // guard error — não deve acontecer pois locked=false verificado acima
      }
    }
    return resultado.length > 0 ? resultado : null;
  }, [opcaoSelecionada, baseMarcacoes, dfoMiniaciResult, mmPorPixel]);

  // ── Ossos requeridos para Etapa 4 — usa opcaoSelecionada (mesma fonte do card) ─
  // NÃO usa analysis.opcoesOsteotomia[padrao] porque a IA e a engine mecânica
  // podem divergir; aqui usamos o mesmo opcaoSelecionada que controla o card exibido.
  const etapa4Bones = useMemo((): ('femur' | 'tibia')[] => {
    if (!opcaoSelecionada) return [];
    const bones: ('femur' | 'tibia')[] = [];
    if (Math.abs(opcaoSelecionada.corrFem) > 0) bones.push('femur');
    if (Math.abs(opcaoSelecionada.corrTib) > 0) bones.push('tibia');
    return bones;
  }, [opcaoSelecionada]);

  // True quando todos os ossos requeridos têm entrada+charneira marcados
  const etapa4Complete = useMemo((): boolean => {
    if (etapa4Bones.length === 0) return true;
    return etapa4Bones.every(b => !!(baseMarcacoes[b]?.entrada && baseMarcacoes[b]?.charneira));
  }, [etapa4Bones, baseMarcacoes]);

  /** Formata ângulo pós-JLCA/JLO — fonte única, nunca usa HKA bruto */
  const fmtAngulo = (a: import('@/lib/cunha').AnguloCorrigido): string => {
    const casas = a.origem === 'geometrico' ? 1 : 0;
    const prefixo = a.origem === 'geometrico' ? '' : '~';
    return `${prefixo}${a.valorDeg.toFixed(casas)}°`;
  };

  /** Formata abertura — NUNCA número seco sem banda/faixa */
  const fmtCunha = (c: CunhaResultado): { texto: string; badge: string } => {
    switch (c.modo) {
      case 'ABSOLUTO': {
        const a = c as import('@/lib/cunha').CunhaAbsoluto;
        return {
          texto: `${a.abertura} mm  (${a.banda[0]}–${a.banda[1]})`,
          badge: a.alerta ? t("withoutMarker", { value: a.incertezaPct }) : t("measuredUncertainty", { value: a.incertezaPct }),
        };
      }
      case 'FAIXA': {
        const f = c as import('@/lib/cunha').CunhaFaixa;
        return { texto: `~${f.faixa[0]}–${f.faixa[1]} mm`, badge: t("unmarkedBaseEstimate") };
      }
      case 'PARAMETRICO': {
        const p = c as import('@/lib/cunha').CunhaParametrico;
        return { texto: `${p.fator} × base(mm)`, badge: t("measureBaseOnTable") };
      }
    }
  };

  // ── DFO Hinge marking (single-point) ────────────────────────────────────
  const startDfoHingeMarking = () => {
    setDfoHingeActive(true);
    dfoHingeActiveRef.current = true;
    touchSnapRef.current.dfoHingeActive = true;
    setMarkingMode(true);
    touchSnapRef.current.markingMode = true;
    setStep('upload');
  };

  const cancelDfoHingeMarking = () => {
    setDfoHingeActive(false);
    dfoHingeActiveRef.current = false;
    touchSnapRef.current.dfoHingeActive = false;
    setMarkingMode(false);
    touchSnapRef.current.markingMode = false;
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    // Handle drag-to-pan — throttle via RAF
    if (isDragging && dragStart && !(markingMode || replacingIndex !== null)) {
      const dx = e.clientX - dragStart.mx;
      const dy = e.clientY - dragStart.my;
      const clamped = clampPan(dragStart.px + dx, dragStart.py + dy, imgZoom);
      pendingPanRef.current = { offset: clamped };
      if (rafPanRef.current === null) {
        rafPanRef.current = requestAnimationFrame(() => {
          rafPanRef.current = null;
          if (pendingPanRef.current) setPanOffset(pendingPanRef.current.offset);
        });
      }
      return;
    }

    const active = markingMode || replacingIndex !== null;
    if (!active) {
      if (magnifierPos) { setMagnifierPos(null); setMagnifierScreenPos(null); }
      return;
    }
    // Magnifier for desktop — throttle via RAF
    const coords = getImgCoords(e);
    if (coords) {
      const contEl = imgContainerRef.current;
      const screenPos = contEl
        ? { x: e.clientX - contEl.getBoundingClientRect().left, y: e.clientY - contEl.getBoundingClientRect().top }
        : null;
      pendingMagnifierRef.current = { pos: coords, screenPos: screenPos ?? { x: 0, y: 0 } };
      if (rafMagnifierRef.current === null) {
        rafMagnifierRef.current = requestAnimationFrame(() => {
          rafMagnifierRef.current = null;
          if (pendingMagnifierRef.current) {
            setMagnifierPos(pendingMagnifierRef.current.pos);
            setMagnifierScreenPos(pendingMagnifierRef.current.screenPos);
          }
        });
      }
    }
  };

  const handleMouseLeave = () => { setMagnifierPos(null); setMagnifierScreenPos(null); };

  // ── Keep snap ref in sync so native touch handlers see fresh state ─────────
  // ── Auto-compute aLDFA/aMPTA when landmark points are complete ───────────
  useEffect(() => {
    if (markedPoints.length >= 1 && aldfaPoints.length === 2) {
      setComputedAlDFA(computeAlDFAFromPoints(markedPoints[0], aldfaPoints));
    } else {
      setComputedAlDFA(null);
    }
  }, [markedPoints, aldfaPoints]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (markedPoints.length >= 3 && amptaPoints.length === 2) {
      setComputedAmPTA(computeAmPTAFromPoints(markedPoints[1], markedPoints[2], amptaPoints, selectedLado));
    } else {
      setComputedAmPTA(null);
    }
  }, [markedPoints, amptaPoints, selectedLado]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (eixoFemoralPoints.length === 2 && eixoTibialPoints.length === 2) {
      setComputedEixoAnatomico(computeEixoAnatomicoFromPoints(eixoFemoralPoints, eixoTibialPoints, selectedLado));
    } else {
      setComputedEixoAnatomico(null);
    }
  }, [eixoFemoralPoints, eixoTibialPoints, selectedLado]); // eslint-disable-line react-hooks/exhaustive-deps

  // AMA femoral: requer 3 pts HKA (hip, knee, ankle) + 2 pts diáfise femoral
  // Linha mecânica = hip — knee_center | Linha anatômica = femProx — femDist
  // angleBetweenVectors retorna null quando há segmento degenerado.
  useEffect(() => {
    if (markedPoints.length === 3 && eixoFemoralPoints.length === 2) {
      const hip = markedPoints[0];
      const knee = markedPoints[1];
      const [femProx, femDist] = eixoFemoralPoints;
      setComputedAmaFemoral(angleBetweenVectors(hip, knee, femProx, femDist));
    } else {
      setComputedAmaFemoral(null);
    }
  }, [markedPoints, eixoFemoralPoints]); // eslint-disable-line react-hooks/exhaustive-deps

  // Divergência tibial: requer 3 pts HKA + 2 pts diáfise tibial
  // Linha mecânica = knee_center — ankle | Linha anatômica = tibProx — tibDist
  useEffect(() => {
    if (markedPoints.length === 3 && eixoTibialPoints.length === 2) {
      const knee = markedPoints[1];
      const ankle = markedPoints[2];
      const [tibProx, tibDist] = eixoTibialPoints;
      setComputedDivergenciaTibial(angleBetweenVectors(knee, ankle, tibProx, tibDist));
    } else {
      setComputedDivergenciaTibial(null);
    }
  }, [markedPoints, eixoTibialPoints]); // eslint-disable-line react-hooks/exhaustive-deps

  // useLayoutEffect (not useEffect) ensures the ref is updated synchronously
  // after every DOM mutation, before any touch events can fire. This prevents
  // a race where onTouchStart reads a stale markingMode=false from the ref
  // immediately after entering marking mode, causing the first mark to misfire.
  useLayoutEffect(() => {
    touchSnapRef.current = { imgZoom, panOffset, markingMode, replacingIndex, markedPoints, selectedLado, markingTarget, aldfaPoints, amptaPoints, eixoFemoralPoints, eixoTibialPoints, coraMarkingActive, coraMarkingPhase, coraMarkingBone, coraProxPoints, coraDistPoints, dfoHingeActive, dfoHingePoint, baseMarkingActive, calibMode };
    baseMarcacoesRef.current = baseMarcacoes;
    requiredBaseBonesRef.current = etapa4Bones;
  }); // no dep array — runs after every render

  // ── Native touch listeners (non-passive) for pan / pinch-zoom / marking ───
  useEffect(() => {
    const el = imgContainerRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      // Se o toque foi no botão de undo flutuante (ou filho dele), não
      // interceptar — deixar o evento nativo propagar e o onClick do botão
      // disparar normalmente. e.preventDefault() bloquearia o click.
      if ((e.target as HTMLElement)?.closest?.('[data-undo-btn]')) return;
      if ((e.target as HTMLElement)?.closest?.('[data-zoom-control]')) {
        // Reset so onTouchMove (mode !== "none" guard) won't preventDefault
        // and suppress the synthetic click on the zoom button.
        touchStateRef.current.mode = "none";
        return;
      }

      // Always prevent default to stop: native image drag, page scroll,
      // and synthetic mouse events that fire after a touch sequence.
      e.preventDefault();

      if (e.touches.length === 1) {
        const t = e.touches[0];
        const { markingMode: mMode, replacingIndex: rIdx, panOffset: pan, calibMode: cModeSnap } = touchSnapRef.current;
        const mode: "marking" | "pan" = (mMode || rIdx !== null || cModeSnap === 'p1' || cModeSnap === 'p2') ? "marking" : "pan";
        Object.assign(touchStateRef.current, {
          mode, startClientX: t.clientX, startClientY: t.clientY,
          lastClientX: t.clientX, lastClientY: t.clientY,
          markClientX: t.clientX, markClientY: t.clientY,
          startPanX: pan.x, startPanY: pan.y, lastDist: 0, moved: false,
          multiTouch: false,
        });
        if (mode === "marking") {
          // Show magnifier immediately on first touch (not only on move)
          const imgEl = imgRef.current, contEl = imgContainerRef.current;
          if (imgEl && contEl) {
            const { imgZoom: curZoom } = touchSnapRef.current;
            const ir = imgEl.getBoundingClientRect(), cr = contEl.getBoundingClientRect();
            // Store in natural pixel space (consistent with onTouchMove)
            const natScale = imgEl.clientWidth ? imgEl.naturalWidth / imgEl.clientWidth : 1;
            setMagnifierPos({ x: ((t.clientX - ir.left) / curZoom) * natScale, y: ((t.clientY - ir.top) / curZoom) * natScale });
            setMagnifierScreenPos({ x: t.clientX - cr.left, y: t.clientY - cr.top });
          }
        }
      } else if (e.touches.length === 2) {
        // Never allow pinch-zoom while marking — a stray second finger must not
        // move the image and disrupt the point-placement workflow.
        const { markingMode: mMode } = touchSnapRef.current;
        if (mMode || touchStateRef.current.mode === "marking") {
          // A stray second finger mid-marking must NOT place a point or move the
          // image. Flag it so touchend skips placement and hide the magnifier.
          touchStateRef.current.multiTouch = true;
          setMagnifierPos(null);
          setMagnifierScreenPos(null);
          return;
        }

        const t0 = e.touches[0], t1 = e.touches[1];
        const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        const { panOffset: pan } = touchSnapRef.current;
        Object.assign(touchStateRef.current, {
          mode: "pinch",
          startClientX: 0, startClientY: 0,
          lastClientX: (t0.clientX + t1.clientX) / 2,
          lastClientY: (t0.clientY + t1.clientY) / 2,
          startPanX: pan.x, startPanY: pan.y,
          lastDist: dist, moved: false,
        });
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      const ts = touchStateRef.current;
      if (ts.mode === "none") return;
      e.preventDefault();

      if (ts.mode === "pinch" && e.touches.length === 2) {
        const t0 = e.touches[0], t1 = e.touches[1];
        const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        if (ts.lastDist === 0) { ts.lastDist = dist; return; }
        const midX = (t0.clientX + t1.clientX) / 2, midY = (t0.clientY + t1.clientY) / 2;
        const { imgZoom: curZoom } = touchSnapRef.current;
        const newZoom = Math.min(8, Math.max(1, curZoom * (dist / ts.lastDist)));
        touchSnapRef.current.imgZoom = newZoom; // keep ref in sync so next event reads updated value
        const imgEl = imgRef.current, contEl = imgContainerRef.current;
        if (imgEl && contEl) {
          const ir = imgEl.getBoundingClientRect(), cr = contEl.getBoundingClientRect();
          const imgX = (midX - ir.left) / curZoom, imgY = (midY - ir.top) / curZoom;
          const npx = midX - imgX * newZoom - cr.left - cr.width / 2 + imgEl.clientWidth * newZoom / 2;
          const npy = midY - imgY * newZoom - cr.top - cr.height / 2 + imgEl.clientHeight * newZoom / 2;
          const clampedOffset = clampPan(npx, npy, newZoom);
          touchSnapRef.current.panOffset = clampedOffset;
          pendingPanRef.current = { zoom: newZoom, offset: clampedOffset };
          if (rafPanRef.current === null) {
            rafPanRef.current = requestAnimationFrame(() => {
              rafPanRef.current = null;
              if (pendingPanRef.current) {
                if (pendingPanRef.current.zoom !== undefined) setImgZoom(pendingPanRef.current.zoom);
                setPanOffset(pendingPanRef.current.offset);
              }
            });
          }
        }
        ts.lastDist = dist;
        return;
      }

      if (ts.mode === "pan" && e.touches.length === 1) {
        const t = e.touches[0];
        const dx = t.clientX - ts.startClientX, dy = t.clientY - ts.startClientY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) ts.moved = true;
        const imgEl = imgRef.current;
        if (imgEl) {
          const { imgZoom: curZoom } = touchSnapRef.current;
          const clampedOffset = clampPan(ts.startPanX + dx, ts.startPanY + dy, curZoom);
          touchSnapRef.current.panOffset = clampedOffset;
          pendingPanRef.current = { offset: clampedOffset };
          if (rafPanRef.current === null) {
            rafPanRef.current = requestAnimationFrame(() => {
              rafPanRef.current = null;
              if (pendingPanRef.current) setPanOffset(pendingPanRef.current.offset);
            });
          }
        }
        ts.lastClientX = t.clientX; ts.lastClientY = t.clientY;
        return;
      }

      if (ts.mode === "marking" && e.touches.length === 1) {
        if (ts.multiTouch) return; // a 2nd finger aborted this marking gesture
        const t = e.touches[0];
        const dx = t.clientX - ts.startClientX, dy = t.clientY - ts.startClientY;
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) ts.moved = true;
        ts.lastClientX = t.clientX; ts.lastClientY = t.clientY;
        // The dead-zone is applied ONLY while the finger is still resting near the
        // touch-down point (before a deliberate drag): this absorbs the natural
        // tremor of a resting finger so the magnifier doesn't drift on its own.
        // Once the user actually drags (moved), the magnifier tracks the finger
        // 1:1 so repositioning feels smooth — not "grabbed"/snaggy.
        if (!ts.moved) {
          const mdx = t.clientX - ts.markClientX, mdy = t.clientY - ts.markClientY;
          if (Math.hypot(mdx, mdy) < 3) return;
        }
        ts.markClientX = t.clientX; ts.markClientY = t.clientY;
        const imgEl = imgRef.current, contEl = imgContainerRef.current;
        if (imgEl && contEl) {
          const { imgZoom: curZoom } = touchSnapRef.current;
          const ir = imgEl.getBoundingClientRect(), cr = contEl.getBoundingClientRect();
          // Store natural-pixel coords for the angle calculation; display coords for screen pos
          const natScale = imgEl.clientWidth ? imgEl.naturalWidth / imgEl.clientWidth : 1;
          const posX = ((t.clientX - ir.left) / curZoom) * natScale;
          const posY = ((t.clientY - ir.top) / curZoom) * natScale;
          pendingMagnifierRef.current = {
            pos: { x: posX, y: posY },
            screenPos: { x: t.clientX - cr.left, y: t.clientY - cr.top },
          };
          if (rafMagnifierRef.current === null) {
            rafMagnifierRef.current = requestAnimationFrame(() => {
              rafMagnifierRef.current = null;
              const p = pendingMagnifierRef.current;
              const magEl = magnifierElRef.current;
              const imgEl2 = imgRef.current, contEl2 = imgContainerRef.current;
              if (!p) return;
              if (magEl && imgEl2 && contEl2) {
                // Fast path: reposition the loupe directly in the DOM (no React
                // re-render of the 4400-line component → smooth 60fps tracking).
                const iW = imgEl2.clientWidth, iH = imgEl2.clientHeight;
                const cW = contEl2.clientWidth, cH = contEl2.clientHeight;
                const PAD = 8;
                let lx = p.screenPos.x + 28;
                if (lx + MAG_SIZE > cW - PAD) lx = p.screenPos.x - MAG_SIZE - 28;
                lx = Math.max(PAD, Math.min(lx, cW - MAG_SIZE - PAD));
                const ty = Math.max(PAD, Math.min(p.screenPos.y - MAG_SIZE / 2, cH - MAG_SIZE - PAD));
                const dnatW = imgEl2.naturalWidth || iW;
                const dnatH = imgEl2.naturalHeight || iH;
                const dispX = p.pos.x * (iW / dnatW);
                const dispY = p.pos.y * (iH / dnatH);
                const bgX = -(dispX * MAG_ZOOM - MAG_SIZE / 2);
                const bgY = -(dispY * MAG_ZOOM - MAG_SIZE / 2);
                magEl.style.left = `${lx}px`;
                magEl.style.top = `${ty}px`;
                magEl.style.backgroundPosition = `${bgX}px ${bgY}px`;
              } else {
                // Loupe not mounted yet (very first frame): fall back to state so
                // it mounts at the right place.
                setMagnifierPos(p.pos);
                setMagnifierScreenPos(p.screenPos);
              }
            });
          }
        }
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      // Se o toque terminou sobre o botão de undo, deixar o click nativo
      // do botão disparar — não colocar ponto nem processar como marcação.
      if ((e.target as HTMLElement)?.closest?.('[data-undo-btn]')) {
        touchStateRef.current.mode = "none";
        return;
      }
      if ((e.target as HTMLElement)?.closest?.('[data-zoom-control]')) {
        touchStateRef.current.mode = "none";
        return;
      }
      const ts = touchStateRef.current;
      if (ts.mode === "marking" && ts.multiTouch) {
        // This gesture was contaminated by a second finger — do NOT place a point.
        // Only reset once all fingers are off the screen.
        setMagnifierPos(null); setMagnifierScreenPos(null);
        if (e.touches.length === 0) { ts.mode = "none"; ts.multiTouch = false; }
        return;
      }
      if (ts.mode === "marking") {
        setMagnifierPos(null); setMagnifierScreenPos(null);
        // Place the mark at the COMMITTED (dead-zone-stabilized) position, not the
        // raw lift position — this keeps the point exactly where the magnifier
        // crosshair last showed it, immune to micro-jitter at the moment of lift.
        const finalX = ts.markClientX;
        const finalY = ts.markClientY;
        const imgEl = imgRef.current;
        if (imgEl) {
          const { imgZoom: curZoom, replacingIndex: rIdx, markedPoints: pts, selectedLado: lado, markingTarget: mTarget, aldfaPoints: apts, amptaPoints: ampts, eixoFemoralPoints: efpts, eixoTibialPoints: etpts, coraMarkingActive: coraActive, coraMarkingPhase: coraPhase, coraMarkingBone: coraBone, coraProxPoints: cProx, coraDistPoints: cDist, dfoHingeActive: dfoHA, baseMarkingActive: bma, calibMode: calibModeSnap } = touchSnapRef.current;
          const ir = imgEl.getBoundingClientRect();
          const natScale = imgEl.clientWidth ? imgEl.naturalWidth / imgEl.clientWidth : 1;
          const coords = { x: ((finalX - ir.left) / curZoom) * natScale, y: ((finalY - ir.top) / curZoom) * natScale };

          // Reject touches outside image bounds
          const natW = imgEl.naturalWidth; const natH = imgEl.naturalHeight;
          if (coords.x < 0 || coords.y < 0 || coords.x > natW || coords.y > natH) {
            // tap landed outside the actual image — ignore silently
          } else if (calibModeSnap === 'p1') {
            // ── Calibração P1 (touch) ─────────────────────────────────────────
            setCalibP1(coords);
            setCalibMode('p2');
            calibModeRef.current = 'p2';
            touchSnapRef.current.calibMode = 'p2';
          } else if (calibModeSnap === 'p2') {
            // ── Calibração P2 (touch) ─────────────────────────────────────────
            setCalibP2(coords);
            setCalibMode('confirm');
            calibModeRef.current = 'confirm';
            touchSnapRef.current.calibMode = 'confirm';
          } else if (bma) {
            // ── Base marking (touch) ─────────────────────────────────────────
            recordBasePoint(bma, coords);
          } else if (dfoHA) {
            // ── DFO hinge single-point (touch) ──────────────────────────────
            setDfoHingePoint(coords);
            touchSnapRef.current.dfoHingePoint = coords;
            setDfoHingeActive(false);
            dfoHingeActiveRef.current = false;
            touchSnapRef.current.dfoHingeActive = false;
            setMarkingMode(false);
            touchSnapRef.current.markingMode = false;
            setStep('result');
          } else if (coraActive) {
            // ── CORA marking (touch) ─────────────────────────────────────────
            if (coraPhase === 'prox' && cProx.length < 2) {
              const np = [...cProx, coords];
              setCoraProxPoints(np);
              touchSnapRef.current.coraProxPoints = np;
              if (np.length === 2) {
                setCoraMarkingPhase('dist');
                coraMarkingPhaseRef.current = 'dist';
                touchSnapRef.current.coraMarkingPhase = 'dist';
              }
            } else if (coraPhase === 'dist' && cDist.length < 2) {
              const np = [...cDist, coords];
              setCoraDistPoints(np);
              touchSnapRef.current.coraDistPoints = np;
              if (np.length === 2) {
                const intersection = lineLineIntersection(cProx[0], cProx[1], np[0], np[1]);
                const angle = angleBetweenSegments(cProx[0], cProx[1], np[0], np[1]);
                if (intersection) {
                  const result = { angle, x: intersection.x, y: intersection.y };
                  if (coraBone === 'femoral') setComputedCoraFemoral(result);
                  else setComputedCoraTibial(result);
                }
                setCoraMarkingPhase(null);
                coraMarkingPhaseRef.current = null;
                touchSnapRef.current.coraMarkingPhase = null;
                setMarkingMode(false);
                touchSnapRef.current.markingMode = false;
              }
            }
          } else if (mTarget === 'aldfa') {
            if (apts.length < 2) {
              const np = [...apts, coords];
              setAldfaPoints(np);
              touchSnapRef.current.aldfaPoints = np;
              if (np.length === 2) {
                touchSnapRef.current.markingTarget = 'ampta';
                touchSnapRef.current.amptaPoints = [];
                setMarkingTarget('ampta');
                setAmptaPoints([]);
                setComputedAmPTA(null);
              }
            }
          } else if (mTarget === 'ampta') {
            if (ampts.length < 2) {
              const np = [...ampts, coords];
              setAmptaPoints(np);
              touchSnapRef.current.amptaPoints = np;
              if (np.length === 2) {
                // Auto-advance to Eixo Femoral marking
                touchSnapRef.current.markingTarget = 'eixoFemoral';
                touchSnapRef.current.eixoFemoralPoints = [];
                setMarkingTarget('eixoFemoral');
                setEixoFemoralPoints([]);
              }
            }
          } else if (mTarget === 'eixoFemoral') {
            if (efpts.length < 2) {
              const np = [...efpts, coords];
              setEixoFemoralPoints(np);
              touchSnapRef.current.eixoFemoralPoints = np;
              if (np.length === 2) {
                touchSnapRef.current.markingTarget = 'eixoTibial';
                setMarkingTarget('eixoTibial');
                // Preserve tibial points when only refining the femoral axis
                if (refiningAxisRef.current !== 'femoral') {
                  touchSnapRef.current.eixoTibialPoints = [];
                  setEixoTibialPoints([]);
                }
              }
            }
          } else if (mTarget === 'eixoTibial') {
            if (etpts.length < 2) {
              const np = [...etpts, coords];
              setEixoTibialPoints(np);
              touchSnapRef.current.eixoTibialPoints = np;
              if (np.length === 2) {
                setMarkingMode(false); // all 11 done
              }
            }
          } else if (rIdx !== null) {
            const np = [...pts]; np[rIdx] = coords;
            setMarkedPoints(np); setReplacingIndex(null);
            if (np.length === 3) { const hka = computeHKAFromPoints(np, lado); setHkaFromPoints(hka); }
          } else if (pts.length < 3) {
            const np = [...pts, coords];
            setMarkedPoints(np);
            touchSnapRef.current.markedPoints = np;
            if (np.length === 3) {
              const hka = computeHKAFromPoints(np, lado);
              setHkaFromPoints(hka);
              // Auto-advance to aLDFA
              touchSnapRef.current.markingTarget = 'aldfa';
              touchSnapRef.current.aldfaPoints = [];
              setMarkingTarget('aldfa');
              setAldfaPoints([]);
              setComputedAlDFA(null);
            }
          }
        }
      }
      if (e.touches.length === 0) touchStateRef.current.mode = "none";
    };

    // touchcancel fires on iOS when the OS interrupts the touch (e.g. scroll
    // snap-back after the button tap). Without handling it, touchStateRef.mode
    // stays "marking" forever and the first real mark is silently dropped.
    const onTouchCancel = () => {
      touchStateRef.current.mode = "none";
      touchStateRef.current.multiTouch = false;
      setMagnifierPos(null);
      setMagnifierScreenPos(null);
    };

    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: false });
    el.addEventListener("touchcancel", onTouchCancel, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchCancel);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewUrl, step]); // re-attaches when image mounts OR when step toggles back to upload (div remounts as new DOM node)

  const goFromAxis = () => {
    setStep("lado");
  };

  const selectedOption = AXIS_OPTIONS.find((o) => o.id === selectedAxis)!;
  const selectedLadoOption = LADO_OPTIONS.find((o) => o.id === selectedLado)!;
  // The selected card computes the exact simulation values (including any
  // cortical calibration).  Keep the same handler available to the mobile
  // action bar instead of recomputing measurements in a second code path.
  let saveSimulationAction: (() => void) | null = null;
  const pdfBlockMessage = pdfBlockReason === "osteotomy-selection-required"
    ? t("pdfOsteotomySelectionRequired")
    : pdfBlockReason === "osteotomy-options-unavailable"
      ? t("pdfOsteotomyOptionsUnavailable")
      : pdfBlockReason === "simulation-unsaved"
        ? t("pdfSimulationUnsaved")
        : pdfBlockReason === "xray-image-unavailable"
          ? t("captureFailed")
          : pdfBlockReason === "analysis-unavailable"
            ? t("pdfGenerationError")
            : null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-base flex items-center gap-2">
            <Ruler className="h-4 w-4 text-primary" />
            {t("title")}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("subtitle")}
          </p>
        </div>
        {step !== "axis" && (
          <Button variant="ghost" size="sm" onClick={reset} className="text-muted-foreground text-xs">
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> {t("restart")}
          </Button>
        )}
      </div>

      {/* Aviso */}
      <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-xs text-blue-700">
        <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
        <span>
          {t("notice")}
        </span>
      </div>

      {/* PASSO 1 — Seleção do eixo */}
      {step === "axis" && (
        <div className="space-y-3">
          <p className="text-sm font-medium">{t("selectAnalysis")}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {AXIS_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setSelectedAxis(opt.id)}
                className={cn(
                  "text-left rounded-xl border-2 px-4 py-3 transition-all hover:border-primary/60",
                  selectedAxis === opt.id
                    ? "border-primary bg-primary/5 shadow-sm"
                    : "border-border bg-background"
                )}
              >
                <div className="flex items-start gap-2">
                  <span className="text-xl leading-none mt-0.5">{opt.icon}</span>
                  <div>
                    <p className={cn("font-semibold text-sm", selectedAxis === opt.id ? "text-primary" : "text-foreground")}>
                      {t(opt.labelKey)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{t(opt.descKey)}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
          <Button type="button" onClick={goFromAxis} className="w-full mt-1">
            {t("continue")} — {t(selectedOption.labelKey)}
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}

      {/* PASSO 2 — Seleção do lado */}
      {step === "lado" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t("analysis")}</span>
            <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold text-xs">
              {selectedOption.icon} {t(selectedOption.labelKey)}
            </span>
          </div>

          <p className="text-sm font-medium">{t("selectLimb")}</p>

          <div className="grid grid-cols-3 gap-2">
            {LADO_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setSelectedLado(opt.id)}
                className={cn(
                  "text-center rounded-xl border-2 px-3 py-4 transition-all hover:border-primary/60",
                  selectedLado === opt.id
                    ? "border-primary bg-primary/5 shadow-sm"
                    : "border-border bg-background"
                )}
              >
                <p className={cn("font-semibold text-sm", selectedLado === opt.id ? "text-primary" : "text-foreground")}>
                  {t(opt.labelKey)}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{t(opt.descKey)}</p>
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setStep("axis")} className="flex-shrink-0">
              {t("back")}
            </Button>
            <Button type="button" onClick={() => setStep("upload")} className="flex-1">
              {t("continue")} — {t(selectedLadoOption.labelKey)}
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* PASSO 3 — Upload */}
      {step === "upload" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t("analysis")}</span>
            <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold text-xs">
              {selectedOption.icon} {t(selectedOption.labelKey)}
            </span>
            <span className="text-muted-foreground">|</span>
            <span className="px-2 py-0.5 rounded-full bg-muted border font-semibold text-xs">
              {t(selectedLadoOption.labelKey)}
            </span>
          </div>

          {/* Banner: localizando CORA na radiografia */}
          {coraMarkingActive && (
            <div className="rounded-xl border-2 border-purple-400 bg-purple-50 px-3 py-3 flex flex-col gap-2">
              <div className="flex items-start gap-2">
                <Target className="h-4 w-4 text-purple-700 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-purple-900">
                    {t("coraTitle", { bone: coraMarkingBone === "femoral" ? t("femoral") : t("tibial") })}
                  </p>
                  {coraMarkingPhase === 'prox' && (
                    <p className="text-xs text-purple-800 mt-0.5 leading-snug">
                      {t("coraProx")}
                    </p>
                  )}
                  {coraMarkingPhase === 'dist' && (
                    <p className="text-xs text-purple-800 mt-0.5 leading-snug">
                      {t("coraDist")}
                    </p>
                  )}
                  {coraMarkingPhase === null && (
                    <p className="text-xs text-purple-800 mt-0.5 leading-snug">
                      {t("coraDone")}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                {coraMarkingPhase === null && (
                  <button
                    type="button"
                    onClick={() => { setStep('result'); }}
                    className="text-xs bg-purple-700 text-white rounded-lg px-3 py-1.5 font-bold hover:bg-purple-800 transition-colors"
                  >
                    {t("backToResult")}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => { cancelCoraMarking(); setStep('result'); }}
                  className="text-xs text-purple-700 underline hover:text-purple-900 transition-colors self-center"
                >
                  {t("cancelCora")}
                </button>
              </div>
            </div>
          )}

          {/* Banner: marcando base por osso (Prompt 3) */}
          {baseMarkingActive && (() => {
            // Derive technique for the bone being marked from the selected opcao
            const selOpcao = (analysis?.opcoesOsteotomia && selectedOsteotomiaIdx !== null && selectedOsteotomiaIdx >= 0)
              ? (analysis.opcoesOsteotomia as Array<Record<string, unknown>>)[selectedOsteotomiaIdx]
              : null;
            const rawTec = baseMarkingActive.bone === 'femur'
              ? String(selOpcao?.tecnicaFemoral ?? selOpcao?.tecnica ?? "")
              : String(selOpcao?.tecnicaTibial ?? selOpcao?.tecnica ?? "");
            const tecLow = rawTec.toLowerCase();
            const tecTipo = tecLow.includes("abertura") ? "abertura" : tecLow.includes("fechamento") ? "fechamento" : null;
            const tecLado = tecLow.includes("medial") ? "medial" : tecLow.includes("lateral") ? "lateral" : null;
            const tecLabel = tecTipo && tecLado
              ? `${tecTipo.charAt(0).toUpperCase() + tecTipo.slice(1)} ${tecLado.charAt(0).toUpperCase() + tecLado.slice(1)}`
              : null;
            const ladoIncisao = tecLado ?? (baseMarkingActive.bone === 'femur' ? "lateral" : "medial");
            const ladoCharneira = ladoIncisao === "medial" ? "lateral" : "medial";

            return (
            <div className="rounded-xl border-2 border-violet-400 bg-violet-50 px-3 py-3 flex flex-col gap-2">
              {/* Technique pill — shown when we know the type */}
              {tecLabel && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[11px] font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wide ${tecTipo === "abertura" ? "bg-blue-600 text-white" : "bg-orange-600 text-white"}`}>
                    {baseMarkingActive.bone === 'femur' ? 'DFO' : 'HTO'} — {tecLabel}
                  </span>
                  <span className="text-[10px] text-violet-700">
                    {t("incisionHinge", { incision: ladoIncisao, hinge: ladoCharneira })}
                  </span>
                </div>
              )}
              <div className="flex items-start gap-2">
                <Ruler className="h-4 w-4 text-violet-700 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-violet-900">
                    {t("osteotomyStep", { bone: baseMarkingActive.bone === "femur" ? t("femoralCap") : t("tibialCap") })}
                  </p>
                  {baseMarkingActive.phase === 'entrada' ? (
                    <div className="mt-0.5 space-y-1">
                      <p className="text-xs text-violet-900 font-semibold">
                        {t("baseEntry", { side: ladoIncisao, detail: tecTipo === "abertura" ? t("openingSide") : tecTipo === "fechamento" ? t("closingSide") : t("incisionSide") })}
                      </p>
                      <p className="text-[11px] bg-violet-100 text-violet-900 rounded px-2 py-1 leading-snug font-medium">
                        {baseMarkingActive.bone === 'femur'
                          ? t("baseFemurEntry", { side: ladoIncisao })
                          : t("baseTibiaEntry", { side: ladoIncisao })}
                      </p>
                    </div>
                  ) : (
                    <div className="mt-0.5 space-y-1">
                      <p className="text-xs text-violet-900 font-semibold">
                        {t("baseHinge", { side: ladoCharneira })}
                      </p>
                      <p className="text-[11px] bg-amber-100 text-amber-900 rounded px-2 py-1 leading-snug font-bold">
                        {baseMarkingActive.bone === 'femur'
                          ? t("baseFemurHinge", { side: ladoCharneira.toUpperCase() })
                          : t("baseTibiaHinge", { side: ladoCharneira.toUpperCase() })}
                      </p>
                      <p className="text-[10px] text-violet-700 leading-snug">
                         {t("baseDistanceHelp")}
                      </p>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                {baseMarkingActive.phase === 'charneira' && (
                  <button
                    type="button"
                    onClick={() => {
                      const bone = baseMarkingActive.bone;
                      setBaseMarcacoes(prev => ({ ...prev, [bone]: undefined }));
                      const phase = { bone, phase: 'entrada' as const };
                      setBaseMarkingActive(phase);
                      baseMarkingActiveRef.current = phase;
                      touchSnapRef.current.baseMarkingActive = phase;
                    }}
                    className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-300 rounded px-2 py-1 hover:bg-amber-100 transition-colors active:scale-95"
                  >
                    {t("redoEntry")}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => { setBaseMarkingActive(null); baseMarkingActiveRef.current = null; touchSnapRef.current.baseMarkingActive = null; setMarkingMode(false); touchSnapRef.current.markingMode = false; setStep('result'); }}
                  className="text-xs text-violet-700 underline hover:text-violet-900 transition-colors self-center"
                >
                  {t("cancel")}
                </button>
              </div>
            </div>
          );
          })()}

          {/* Banner: marcando charneira DFO */}
          {dfoHingeActive && (
            <div className="rounded-xl border-2 border-orange-400 bg-orange-50 px-3 py-3 flex flex-col gap-2">
              <div className="flex items-start gap-2">
                <Target className="h-4 w-4 text-orange-700 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-orange-900">{t("dfoHinge")}</p>
                  <p className="text-xs text-orange-800 mt-0.5 leading-snug">
                    {t("dfoHingeHelp")}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { cancelDfoHingeMarking(); setStep('result'); }}
                className="text-xs text-orange-700 underline hover:text-orange-900 transition-colors self-start"
              >
                {t("cancel")}
              </button>
            </div>
          )}

          {/* Banner: refinando eixo anatômico */}
          {refiningAxis && (
            <div className="rounded-xl border-2 border-blue-400 bg-blue-50 px-3 py-3 flex flex-col gap-2">
              <div className="flex items-start gap-2">
                <Target className="h-4 w-4 text-blue-700 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-blue-900">
                    {t("refineAxis", { bone: refiningAxis === "femoral" ? t("femoral") : t("tibial") })}
                  </p>
                  <p className="text-xs text-blue-800 mt-0.5 leading-snug">
                    {refiningAxis === 'femoral'
                      ? t("refineFemur") : t("refineTibia")}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setRefiningAxis(null); refiningAxisRef.current = null; setStep('result'); }}
                className="text-xs text-blue-700 underline hover:text-blue-900 transition-colors self-start"
              >
                  {t("cancelRefinement")}
              </button>
            </div>
          )}

          {/* Deformidade esperada — só exibe quando há desvio de eixo ou seleção manual */}
          {((hkaFromPoints !== null && hkaFromPoints !== 0) ||
            (selectedDeformidade !== "auto" && selectedDeformidade !== "neutro")) && (
          <div className="rounded-xl border border-border bg-muted/30 px-3 py-2.5 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
               <span className="text-xs font-semibold text-foreground">{t("expectedDeformity")}</span>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {DEFORMIDADE_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSelectedDeformidade(opt.id)}
                  className={cn(
                    "rounded-lg border-2 py-1.5 px-1 text-center transition-all",
                    selectedDeformidade === opt.id
                      ? opt.id === "auto" ? "border-primary bg-primary/10" : "border-amber-400 bg-amber-50 shadow-sm"
                      : "border-border bg-background hover:border-primary/40"
                  )}
                >
                  <div className="text-sm mb-0.5">{opt.icon}</div>
                  <p className={cn("text-[11px] font-bold leading-none",
                    selectedDeformidade === opt.id
                      ? opt.id === "auto" ? "text-primary" : "text-amber-700"
                      : "text-foreground"
                  )}>{opt.id === "auto" ? t("deformityAuto") : opt.id === "varo" ? t("deformityVarus") : opt.id === "valgo" ? t("deformityValgus") : t("deformityNeutral")}</p>
                  <p className="text-[9px] text-muted-foreground mt-0.5">{opt.id === "auto" ? t("deformityAutoDesc") : t("deformityConfirm")}</p>
                </button>
              ))}
            </div>
            {selectedDeformidade !== "auto" && (
              <p className="text-[10px] text-amber-700 font-medium">
                 {t("aiAnchor")}
              </p>
            )}
          </div>
          )}

          {/* Alvo de correção — % do platô tibial + HKA objetivo (sempre visível) */}
          <div className="rounded-xl border border-border bg-muted/30 px-3 py-3 space-y-2.5">
            <div className="flex items-center gap-1.5">
              <Target className="h-3.5 w-3.5 text-primary" />
               <span className="text-xs font-semibold text-foreground">{t("correctionTarget")}</span>
            </div>

            {/* Presets — %WBL + HKA esperado pós-op (fórmula DocKnee: HKA = (WBL−50)×0,28) */}
            <div className="flex gap-1.5">
              {([
                { wbl: 50,   label: t("neutral"),   hka: 0    },
                { wbl: 55,   label: t("moderate"), hka: 1.4  },
                { wbl: 62.5, label: "Fujisawa", hka: 3.5  },
                { wbl: 66,   label: t("severe"),   hka: 4.5  },
              ]).map(({ wbl, label, hka }) => (
                <button
                  key={wbl}
                  type="button"
                  onClick={() => { setWblDesejado(wbl); setHkaObjetivo(hka); }}
                  className={cn(
                    "flex-1 rounded-md border px-1.5 py-1.5 text-center transition-all",
                    wblDesejado === wbl
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  )}
                >
                  <div className="text-[11px] font-bold">{wbl}%</div>
                  <div className="text-[10px] opacity-70">{hka === 0 ? "0°" : `+${hka}°`}</div>
                  <div className="text-[9px] opacity-50">{label}</div>
                </button>
              ))}
            </div>

            {/* Entradas bidirecionais WBL ↔ HKA (fórmula: HKA = (WBL−50)×0,28) */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[10px] text-muted-foreground mb-1">{t("wblTarget")}</p>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={40}
                    max={75}
                    step={0.5}
                    value={wblDesejado}
                    onChange={(e) => {
                      const v = Math.min(75, Math.max(40, Number(e.target.value)));
                      setWblDesejado(v);
                      setHkaObjetivo(Math.round((v - 50) * 0.28 * 10) / 10);
                    }}
                    className="w-full rounded border border-border bg-background px-1.5 py-1 text-center text-xs font-bold text-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <span className="text-[10px] text-muted-foreground shrink-0">%</span>
                </div>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground mb-1">{t("hkaTarget")}</p>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={-5}
                    max={8}
                    step={0.1}
                    value={hkaObjetivo}
                    onChange={(e) => {
                      const h = Math.min(8, Math.max(-5, Number(e.target.value)));
                      setHkaObjetivo(Math.round(h * 10) / 10);
                      setWblDesejado(Math.min(75, Math.max(40, Math.round((50 + h / 0.28) * 2) / 2)));
                    }}
                    className="w-full rounded border border-border bg-background px-1.5 py-1 text-center text-xs font-bold text-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <span className="text-[10px] text-muted-foreground shrink-0">°</span>
                </div>
              </div>
            </div>

            <p className="text-[10px] text-muted-foreground">
              {wblDesejado === 50
                ? t("targetNeutral")
                : wblDesejado > 50
                ? t("targetLateral", { wbl: wblDesejado, hka: Math.round((wblDesejado - 50) * 0.28 * 10) / 10 })
                : t("targetMedial", { wbl: wblDesejado, hka: Math.round((wblDesejado - 50) * 0.28 * 10) / 10 })}
            </p>
          </div>

          {/* File input always in DOM so fileRef works after file is selected */}
          <input
            ref={fileRef}
            type="file"
            accept="image/*,.heic,.heif"
            className="hidden"
            onChange={handleFileChange}
          />

          {converting ? (
            <div className="rounded-xl border bg-muted/30 p-6 flex items-center gap-4">
              <Loader2 className="h-10 w-10 text-primary flex-shrink-0 animate-spin" />
              <div>
                <p className="font-medium text-sm">{t("heicConverting")}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{t("heicWait")}</p>
              </div>
            </div>
          ) : !previewUrl ? (
            <div
              className={cn(
                "border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors",
                dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"
              )}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              <ImageIcon className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm font-medium">{t("upload")}</p>
              <p className="text-xs text-muted-foreground mt-1">{t("uploadHint")}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {previewUrl ? (
                <>
                  {/* ── Etapa 0 — Calibração de Escala (obrigatória) ─────── */}
                  <div className={cn(
                    "rounded-xl border-2 p-3 space-y-2.5 transition-colors",
                    calibMode === 'done'
                      ? "border-emerald-400 bg-emerald-50"
                      : "border-amber-400 bg-amber-50"
                  )}>
                    {calibMode === 'idle' && (
                      <>
                        <div className="flex items-center gap-2">
                          <Ruler className="h-4 w-4 text-amber-700 shrink-0" />
                          <p className="text-sm font-bold text-amber-900">{t("calibrationTitle")}</p>
                        </div>
                        <p className="text-xs text-amber-800 leading-snug">
                           {t("calibrationHelp")}
                        </p>
                        <p className="text-[11px] text-amber-700">{t("calibrationTip")}</p>
                        <button
                          type="button"
                          onClick={startCalibration}
                          className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition-colors font-semibold"
                        >
                          <Ruler className="h-3.5 w-3.5" />
                          {t("calibrate")}
                        </button>
                      </>
                    )}

                    {(calibMode === 'p1' || calibMode === 'p2') && (
                      <>
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-600 text-white text-[11px] font-bold shrink-0">
                            {calibMode === 'p1' ? '1' : '2'}
                          </span>
                          <p className="text-sm font-bold text-amber-900">
                            {calibMode === 'p1' ? t("calibrationP1") : t("calibrationP2")}
                          </p>
                        </div>
                        <p className="text-xs text-amber-800 leading-snug">
                          {calibMode === 'p1'
                            ? t("calibrationP1Help") : t("calibrationP2Help")}
                        </p>
                        <button
                          type="button"
                          onClick={() => { setCalibMode('idle'); calibModeRef.current = 'idle'; touchSnapRef.current.calibMode = 'idle'; setCalibP1(null); setCalibP2(null); }}
                          className="self-start flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-amber-400 text-amber-800 bg-amber-50 hover:bg-amber-100 active:scale-95 transition-all"
                        >{t("cancelCalibration")}</button>
                      </>
                    )}

                    {calibMode === 'confirm' && calibP1 && calibP2 && (
                      <>
                        <div className="flex items-center gap-2">
                          <Ruler className="h-4 w-4 text-amber-700 shrink-0" />
                          <p className="text-sm font-bold text-amber-900">{t("realDistance")}</p>
                        </div>
                        <p className="text-[11px] text-amber-700">
                          {t("pixelDistance", { pixels: Math.hypot(calibP2.x - calibP1.x, calibP2.y - calibP1.y).toFixed(0) })}
                          {Math.hypot(calibP2.x - calibP1.x, calibP2.y - calibP1.y) < 80
                            ? t("shortDistance")
                            : ' ✓'}
                        </p>
                        <p className="text-[11px] text-amber-700 font-medium">{t("coinPresets")}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {COIN_PRESETS.map(coin => (
                            <button
                              key={coin.label}
                              type="button"
                              onClick={() => setCalibDistInput(String(coin.mm))}
                              className={cn(
                                "text-[11px] px-2 py-1 rounded-md border transition-colors",
                                calibDistInput === String(coin.mm)
                                  ? "bg-amber-600 text-white border-amber-600"
                                  : "bg-white text-amber-700 border-amber-300 hover:bg-amber-50"
                              )}
                            >
                              {coin.label} = {coin.mm} mm
                            </button>
                          ))}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <input
                            type="number"
                            min={1}
                            step={0.1}
                            value={calibDistInput}
                            onChange={e => setCalibDistInput(e.target.value)}
                            placeholder="mm"
                            className="w-24 rounded border border-amber-300 bg-white px-2 py-1 text-sm font-bold text-center focus:outline-none focus:ring-1 focus:ring-amber-500"
                          />
                          <span className="text-xs text-amber-700 font-semibold">{t("realDistanceMm")}</span>
                          <button
                            type="button"
                            onClick={confirmCalibration}
                            disabled={!calibDistInput || parseFloat(calibDistInput) <= 0}
                            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-semibold"
                          >
                            {t("confirm")}
                          </button>
                        </div>
                        {calibDistInput && parseFloat(calibDistInput) > 0 && (() => {
                          const px = Math.hypot(calibP2.x - calibP1.x, calibP2.y - calibP1.y);
                          const mpp = parseFloat(calibDistInput) / px;
                          return (
                            <p className="text-[11px] text-amber-700">
                               {t("previewScale", { mpp: mpp.toFixed(4), pixels: (100 / mpp).toFixed(0) })}
                            </p>
                          );
                        })()}
                        <button
                          type="button"
                          onClick={() => { setCalibMode('p1'); calibModeRef.current = 'p1'; touchSnapRef.current.calibMode = 'p1'; setCalibP1(null); setCalibP2(null); }}
                          className="text-xs text-amber-700 underline hover:text-amber-900 transition-colors"
                        >{t("remarkPoints")}</button>
                      </>
                    )}

                    {calibMode === 'done' && mmPorPixel && (
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div>
                          <p className="text-sm font-bold text-emerald-800 flex items-center gap-1.5">
                            <span className="text-base">✓</span> {t("calibrated")}
                          </p>
                          <p className="text-xs text-emerald-700">
                            {t("calibratedDetail", { mpp: mmPorPixel.toFixed(4), pixels: (100 / mmPorPixel).toFixed(0) })}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={resetCalibration}
                          className="text-[11px] text-emerald-700 border border-emerald-300 rounded-lg px-2.5 py-1 hover:bg-emerald-100 transition-colors"
                        >
                          {t("recalibrate")}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* ── Point-marking toolbar ─────────────────────────────── */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {!markingMode && hkaFromPoints === null && calibMode !== 'done' && (
                      <button
                        type="button"
                        disabled
                        className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-muted text-muted-foreground border border-border cursor-not-allowed font-semibold opacity-60"
                        title={t("calibrateBeforeMarking")}
                      >
                        <Target className="h-4 w-4" />
                        {t("markPointsDisabled")}
                      </button>
                    )}
                    {!markingMode && hkaFromPoints === null && (
                      <>
                        <button
                          type="button"
                          onClick={calibMode === 'done' ? startMarking : undefined}
                          disabled={calibMode !== 'done'}
                          className={cn(
                            "flex items-center gap-2 text-sm px-4 py-2 rounded-lg transition-colors font-semibold shadow-md",
                            calibMode === 'done'
                              ? "bg-primary text-primary-foreground hover:bg-primary/90"
                              : "hidden"
                          )}
                        >
                          <Target className="h-4 w-4" />
                          {t("markPoints")}
                        </button>
                      </>
                    )}
                    {markingMode && (
                      <div className="flex items-center gap-2 flex-1">
                        <span className={cn(
                          "text-xs font-semibold animate-pulse flex items-center gap-1",
                          markingTarget === 'aldfa' ? "text-orange-600" :
                          markingTarget === 'ampta' ? "text-purple-600" :
                          markingTarget === 'eixoFemoral' ? "text-cyan-600" :
                          markingTarget === 'eixoTibial' ? "text-green-600" : "text-primary"
                        )}>
                          <Target className="h-3.5 w-3.5" />
                          {markingTarget === 'aldfa'
                            ? t("clickPoint", { label: ALDFA_POINT_LABELS[aldfaPoints.length] ? t(ALDFA_POINT_LABELS[aldfaPoints.length].id) : "" })
                            : markingTarget === 'ampta'
                            ? t("clickPoint", { label: AMPTA_POINT_LABELS[amptaPoints.length] ? t(AMPTA_POINT_LABELS[amptaPoints.length].id) : "" })
                            : markingTarget === 'eixoFemoral'
                            ? t("clickPoint", { label: EIXO_FEMORAL_POINT_LABELS[eixoFemoralPoints.length] ? t(EIXO_FEMORAL_POINT_LABELS[eixoFemoralPoints.length].id) : "" })
                            : markingTarget === 'eixoTibial'
                            ? t("clickPoint", { label: EIXO_TIBIAL_POINT_LABELS[eixoTibialPoints.length] ? t(EIXO_TIBIAL_POINT_LABELS[eixoTibialPoints.length].id) : "" })
                            : t("clickPoint", { label: POINT_LABELS[markedPoints.length] ? t(POINT_LABELS[markedPoints.length].id) : "" })
                          }
                        </span>
                        <span className="text-[10px] text-muted-foreground/70 hidden sm:inline">{t("scrollZoom")}</span>
                        {/* Indicador em tempo real: AMA fem + Div tib calculados.
                            Permite ao cirurgião validar a marcação ANTES de enviar
                            para análise. Se o valor parecer errado (ex: AMA muito
                            baixo apesar de bowing visível), pode usar "Voltar 1 ponto"
                            e remarcar. */}
                        {(computedAmaFemoral !== null || computedDivergenciaTibial !== null) && (
                          <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-white border border-slate-300 text-[10px] font-mono">
                            {computedAmaFemoral !== null && (
                              <span className={cn("font-bold", severityColor(classifyAmaFemoral(computedAmaFemoral)))}>
                                AMA fem {computedAmaFemoral.toFixed(1)}°
                              </span>
                            )}
                            {computedAmaFemoral !== null && computedDivergenciaTibial !== null && (
                              <span className="text-muted-foreground">·</span>
                            )}
                            {computedDivergenciaTibial !== null && (
                              <span className={cn("font-bold", severityColor(classifyDivTibial(Math.abs(computedDivergenciaTibial))))}>
                                Div tib {Math.abs(computedDivergenciaTibial).toFixed(1)}°
                              </span>
                            )}
                          </div>
                        )}
                        <div className="ml-auto flex items-center gap-2">
                          {(() => {
                            // Undo unificado entre todos os 11 pontos: se o target
                            // atual estiver vazio, volta para o target anterior e
                            // remove o último ponto dele. Isso resolve o caso comum
                            // "errei o último ponto do aLDFA, avancei pro aMPTA e
                            // quero voltar pra refazer o aLDFA".
                            const undoChain: Array<{
                              target: typeof markingTarget;
                              points: MarkedPoint[];
                              setter: (p: MarkedPoint[]) => void;
                            }> = [
                              { target: 'hka', points: markedPoints, setter: setMarkedPoints },
                              { target: 'aldfa', points: aldfaPoints, setter: setAldfaPoints },
                              { target: 'ampta', points: amptaPoints, setter: setAmptaPoints },
                              { target: 'eixoFemoral', points: eixoFemoralPoints, setter: setEixoFemoralPoints },
                              { target: 'eixoTibial', points: eixoTibialPoints, setter: setEixoTibialPoints },
                            ];
                            const currentIdx = undoChain.findIndex(s => s.target === markingTarget);
                            // Caminha de trás pra frente a partir do target atual procurando
                            // o último target não-vazio
                            let undoIdx = currentIdx;
                            while (undoIdx >= 0 && undoChain[undoIdx]!.points.length === 0) {
                              undoIdx--;
                            }
                            if (undoIdx < 0) return null;
                            const undoStep = undoChain[undoIdx]!;
                            const totalMarked = undoChain.reduce((s, c) => s + c.points.length, 0);
                            return (
                              <button
                                type="button"
                                onClick={() => {
                                  const newPoints = undoStep.points.slice(0, -1);
                                  undoStep.setter(newPoints);
                                  // Sincroniza touchSnapRef imediatamente (sem esperar
                                  // o próximo render do useLayoutEffect) para eliminar
                                  // race condition em mobile: se o cirurgião tocar a
                                  // tela logo após o undo, o handler de touch deve ler
                                  // o estado já atualizado de pontos + target.
                                  if (undoStep.target === 'hka') touchSnapRef.current.markedPoints = newPoints;
                                  else if (undoStep.target === 'aldfa') touchSnapRef.current.aldfaPoints = newPoints;
                                  else if (undoStep.target === 'ampta') touchSnapRef.current.amptaPoints = newPoints;
                                  else if (undoStep.target === 'eixoFemoral') touchSnapRef.current.eixoFemoralPoints = newPoints;
                                  else if (undoStep.target === 'eixoTibial') touchSnapRef.current.eixoTibialPoints = newPoints;
                                  // Se o target atual estiver vazio e voltarmos para
                                  // um anterior, ajustar markingTarget para continuar
                                  // a marcação no passo correto.
                                  if (undoStep.target !== markingTarget) {
                                    setMarkingTarget(undoStep.target);
                                    touchSnapRef.current.markingTarget = undoStep.target;
                                  }
                                }}
                                className="text-sm px-3 py-1.5 rounded-lg border-2 border-amber-400 bg-amber-50 text-amber-800 hover:bg-amber-100 active:scale-95 transition-all font-bold flex items-center gap-1.5 shadow-sm"
                                title={t("undoMarkedPoint", { point: totalMarked })}
                              >
                                <RefreshCw className="h-4 w-4 -scale-x-100" />
                                {t("undoPoint")}
                              </button>
                            );
                          })()}
                          <button type="button" onClick={() => {
                            setMarkingMode(false);
                            if (markingTarget === 'aldfa') { setAldfaPoints([]); setMarkingTarget('hka'); }
                            else if (markingTarget === 'ampta') { setAmptaPoints([]); setMarkingTarget('hka'); }
                            else if (markingTarget === 'eixoFemoral') { setEixoFemoralPoints([]); setMarkingTarget('hka'); }
                            else if (markingTarget === 'eixoTibial') { setEixoTibialPoints([]); setMarkingTarget('hka'); }
                            else setMarkedPoints([]);
                          }} className="text-xs text-muted-foreground hover:text-destructive">
                            {t("cancelMarking")}
                          </button>
                        </div>
                      </div>
                    )}
                    {/* ── Undo button — visible even AFTER all 11 points are done ── */}
                    {!markingMode && (() => {
                      // CORA undo in sidebar
                      if (coraMarkingActive && (coraProxPoints.length > 0 || coraDistPoints.length > 0)) {
                        const inDist = coraDistPoints.length > 0;
                        return (
                          <button
                            type="button"
                            data-undo-btn
                            onClick={() => {
                              if (inDist) {
                                const np = coraDistPoints.slice(0, -1);
                                setCoraDistPoints(np);
                                touchSnapRef.current.coraDistPoints = np;
                                if (np.length === 0 && coraMarkingPhase === null) {
                                  setCoraMarkingPhase('dist');
                                  coraMarkingPhaseRef.current = 'dist';
                                  touchSnapRef.current.coraMarkingPhase = 'dist';
                                  setMarkingMode(true);
                                  touchSnapRef.current.markingMode = true;
                                }
                              } else {
                                const np = coraProxPoints.slice(0, -1);
                                setCoraProxPoints(np);
                                touchSnapRef.current.coraProxPoints = np;
                                if (coraMarkingPhase !== 'prox') {
                                  setCoraMarkingPhase('prox');
                                  coraMarkingPhaseRef.current = 'prox';
                                  touchSnapRef.current.coraMarkingPhase = 'prox';
                                  setMarkingMode(true);
                                  touchSnapRef.current.markingMode = true;
                                }
                              }
                            }}
                            className="text-sm px-3 py-1.5 rounded-lg border-2 border-purple-400 bg-purple-50 text-purple-800 hover:bg-purple-100 active:scale-95 transition-all font-bold flex items-center gap-1.5 shadow-sm"
                          >
                            <RefreshCw className="h-4 w-4 -scale-x-100" />
                            {t("undoCoraPoint")}
                          </button>
                        );
                      }
                      const anyPoints = markedPoints.length > 0 || aldfaPoints.length > 0 || amptaPoints.length > 0 || eixoFemoralPoints.length > 0 || eixoTibialPoints.length > 0;
                      if (!anyPoints) return null;
                      // Walk undo chain from last step backwards to find last non-empty step
                      type UndoEntry = { target: typeof markingTarget; points: MarkedPoint[]; setter: (p: MarkedPoint[]) => void };
                      const undoChain: UndoEntry[] = [
                        { target: 'hka', points: markedPoints, setter: setMarkedPoints },
                        { target: 'aldfa', points: aldfaPoints, setter: setAldfaPoints },
                        { target: 'ampta', points: amptaPoints, setter: setAmptaPoints },
                        { target: 'eixoFemoral', points: eixoFemoralPoints, setter: setEixoFemoralPoints },
                        { target: 'eixoTibial', points: eixoTibialPoints, setter: setEixoTibialPoints },
                      ];
                      // Start from markingTarget's position, walk backward for last non-empty
                      const currentIdx = undoChain.findIndex(s => s.target === markingTarget);
                      let undoIdx = currentIdx >= 0 ? currentIdx : undoChain.length - 1;
                      while (undoIdx >= 0 && undoChain[undoIdx]!.points.length === 0) undoIdx--;
                      if (undoIdx < 0) return null;
                      const undoStep = undoChain[undoIdx]!;
                      const totalMarked = undoChain.reduce((s, c) => s + c.points.length, 0);
                      return (
                        <button
                          type="button"
                          data-undo-btn
                          onClick={() => {
                            const newPoints = undoStep.points.slice(0, -1);
                            undoStep.setter(newPoints);
                            if (undoStep.target === 'hka') touchSnapRef.current.markedPoints = newPoints;
                            else if (undoStep.target === 'aldfa') touchSnapRef.current.aldfaPoints = newPoints;
                            else if (undoStep.target === 'ampta') touchSnapRef.current.amptaPoints = newPoints;
                            else if (undoStep.target === 'eixoFemoral') touchSnapRef.current.eixoFemoralPoints = newPoints;
                            else if (undoStep.target === 'eixoTibial') touchSnapRef.current.eixoTibialPoints = newPoints;
                            setMarkingTarget(undoStep.target);
                            touchSnapRef.current.markingTarget = undoStep.target;
                            // Re-enter marking mode so the user can place the corrected point
                            setMarkingMode(true);
                            touchSnapRef.current.markingMode = true;
                          }}
                          className="text-sm px-3 py-1.5 rounded-lg border-2 border-amber-400 bg-amber-50 text-amber-800 hover:bg-amber-100 active:scale-95 transition-all font-bold flex items-center gap-1.5 shadow-sm"
                          title={t("undoAndReopen", { point: totalMarked })}
                        >
                          <RefreshCw className="h-4 w-4 -scale-x-100" />
                          {t("undoPoint")}
                        </button>
                      );
                    })()}
                    {/* ── Marking guidance panel ─────────────────────────────── */}
                    {markingMode && (() => {
                      const STEPS = buildMarkSteps(
                        { hka: markedPoints.length, aldfa: aldfaPoints.length, ampta: amptaPoints.length, eixoFemoral: eixoFemoralPoints.length, eixoTibial: eixoTibialPoints.length },
                        markingTarget,
                        t,
                      );

                      const activeStep = STEPS.find(s => s.active);
                      const doneCount = STEPS.filter(s => s.done).length;

                      return (
                        <div className="w-full mt-1 rounded-xl border border-slate-200 bg-slate-50/90 overflow-hidden">
                          {/* Header progress bar */}
                          <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-200 bg-white/70">
                            <div className="flex gap-1">
                              {STEPS.map(s => (
                                <div
                                  key={s.num}
                                  className={cn("h-2 rounded-full transition-all", s.done ? "w-5" : s.active ? "w-5 animate-pulse" : "w-2")}
                                  style={{ backgroundColor: s.done ? s.color : s.active ? s.color : "#CBD5E1" }}
                                  title={s.label}
                                />
                              ))}
                            </div>
                             <span className="text-[10px] font-bold text-slate-500 ml-1">{t("markedProgress", { count: doneCount })}</span>
                            {activeStep && (
                               <span className="ml-auto text-[10px] text-slate-400 hidden sm:block">{t("markingPanHelp")}</span>
                            )}
                          </div>

                          {/* Active step instruction — large, high-contrast so the surgeon
                              cannot mistake which point comes next in the sequence. */}
                          {activeStep && (
                            <div
                              className="px-4 py-3.5 flex items-start gap-3.5 border-l-[6px]"
                              style={{ borderLeftColor: activeStep.color, backgroundColor: `${activeStep.color}14` }}
                            >
                              <div
                                className="shrink-0 w-12 h-12 rounded-full flex items-center justify-center text-white text-xl font-black ring-4 ring-white shadow-md animate-pulse"
                                style={{ backgroundColor: activeStep.color }}
                              >
                                {activeStep.num}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-[10px] font-extrabold uppercase tracking-wide" style={{ color: activeStep.color }}>
                                   {t("nextPoint", { point: activeStep.num })}
                                </p>
                                <p className="text-base font-extrabold text-slate-900 leading-tight">{activeStep.label}</p>
                                <p className="text-[13px] text-slate-700 mt-1 leading-relaxed">{activeStep.hint}</p>
                              </div>
                            </div>
                          )}

                          {/* Remaining steps as chips */}
                          <div className="flex flex-wrap gap-1.5 px-3 py-2.5 border-t border-slate-200">
                            {STEPS.filter(s => !s.done && !s.active).map(s => (
                              <span key={s.num} className="text-[10px] px-2 py-0.5 rounded-full border border-slate-200 text-slate-500 bg-white flex items-center gap-1">
                                <span className="w-2 h-2 rounded-full inline-block shrink-0" style={{ backgroundColor: "#CBD5E1" }} />
                                {s.num}. {s.label}
                              </span>
                            ))}
                            {STEPS.filter(s => s.done).map(s => (
                              <span key={s.num} className="text-[10px] px-2 py-0.5 rounded-full border text-white flex items-center gap-1" style={{ backgroundColor: s.color, borderColor: s.color }}>
                                ✓ {s.num}. {s.label}
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                    {hkaFromPoints !== null && (
                      <div className="flex items-center gap-2 flex-wrap flex-1">
                        <span className={cn(
                          "text-xs font-bold px-2.5 py-1 rounded-lg flex items-center gap-1.5 border",
                          hkaFromPoints < 0 ? "text-red-700 bg-red-50 border-red-200"
                            : hkaFromPoints > 0 ? "text-blue-700 bg-blue-50 border-blue-200"
                            : "text-green-700 bg-green-50 border-green-200"
                        )}>
                          <CheckCircle className="h-3.5 w-3.5" />
                          HKA: {Math.abs(hkaFromPoints).toFixed(1)}°
                          {hkaFromPoints < 0 && <span className="ml-1 font-extrabold">VARO</span>}
                          {hkaFromPoints > 0 && <span className="ml-1 font-extrabold">VALGO</span>}
                          {hkaFromPoints === 0 && <span className="ml-1">{t("neutralStatus")}</span>}
                        </span>
                        {/* Botão inverter direção — útil quando imagem está espelhada/orientação não-padrão */}
                        <button
                          type="button"
                          title={t("flipDirection")}
                          onClick={() => setHkaFromPoints(v => v !== null ? Math.round(-v * 10) / 10 : v)}
                          className="text-[10px] px-2 py-1 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 hover:border-gray-400 transition-colors font-medium flex items-center gap-0.5 flex-shrink-0"
                        >
                          ⟳ {hkaFromPoints <= 0 ? t("toValgus") : t("toVarus")}
                        </button>
                        {computedAlDFA !== null && (() => {
                          const mldfaNodePost = analysis ? (analysis as unknown as Record<string, unknown>).mLDFA as Record<string, unknown> | undefined : undefined;
                          const mldfaDisplay =
                            (mldfaNodePost?._corrigidoSuplementar ? Number(mldfaNodePost.valor) : null)
                            ?? computedAlDFA;
                          const wasFixed = mldfaDisplay !== computedAlDFA;
                          return (
                            <span className="text-xs font-bold px-2.5 py-1 rounded-lg flex items-center gap-1 border text-orange-700 bg-orange-50 border-orange-200"
                              title={wasFixed ? t("correctedAngle", { angle: computedAlDFA.toFixed(1) }) : undefined}>
                              <CheckCircle className="h-3 w-3" />
                              mLDFA: {mldfaDisplay.toFixed(1)}°{wasFixed ? " ✓" : ""}
                            </span>
                          );
                        })()}
                        {computedAmPTA !== null && (
                          <span className="text-xs font-bold px-2.5 py-1 rounded-lg flex items-center gap-1 border text-purple-700 bg-purple-50 border-purple-200">
                            <CheckCircle className="h-3 w-3" />
                            aMPTA: {computedAmPTA.toFixed(1)}°
                          </span>
                        )}
                        <div className="flex items-center gap-1.5 ml-auto">
                          {!markingMode && computedAlDFA === null && (
                            <button type="button" onClick={startMarkingAlDFA}
                              className="text-xs px-2 py-1 rounded-lg border-2 border-dashed border-orange-400 text-orange-700 hover:bg-orange-50 transition-colors font-medium flex items-center gap-1"
                              title={t("markFemoralCondyles")}>
                              <Target className="h-3 w-3" />
                              {t("femoralCondyles")}
                            </button>
                          )}
                          {!markingMode && computedAlDFA !== null && (
                            <button type="button" onClick={startMarkingAlDFA}
                              className="text-xs px-2 py-1 rounded-lg border border-orange-300 text-orange-600 hover:bg-orange-50 transition-colors"
                              title={t("redoMldfa")}>
                              ↩ mLDFA
                            </button>
                          )}
                          {!markingMode && computedAmPTA === null && (
                            <button type="button" onClick={startMarkingAmPTA}
                              className="text-xs px-2 py-1 rounded-lg border-2 border-dashed border-purple-400 text-purple-700 hover:bg-purple-50 transition-colors font-medium flex items-center gap-1"
                              title={t("markTibialPlateaus")}>
                              <Target className="h-3 w-3" />
                              {t("tibialPlateaus")}
                            </button>
                          )}
                          {!markingMode && computedAmPTA !== null && (
                            <button type="button" onClick={startMarkingAmPTA}
                              className="text-xs px-2 py-1 rounded-lg border border-purple-300 text-purple-600 hover:bg-purple-50 transition-colors"
                              title={t("redoAmpta")}>
                              ↩ aMPTA
                            </button>
                          )}
                          <button type="button" onClick={startMarking} className="text-xs text-muted-foreground hover:text-primary">
                            {t("redoHka")}
                          </button>
                        </div>
                      </div>
                    )}
                    {!markingMode && (
                      <button
                        type="button"
                        onClick={() => { if (fileRef.current) { fileRef.current.value = ""; fileRef.current.click(); } }}
                        className="ml-auto text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted transition-colors flex-shrink-0"
                      >
                        {t("changePhoto")}
                      </button>
                    )}
                  </div>

                  {/* ── Image with point overlay ──────────────────────────── */}
                  {/* Outer container: black background + centering + zoom/pan events */}
                  <div
                    ref={imgContainerRef}
                    className={cn(
                      "rounded-xl overflow-hidden border bg-black flex items-center justify-center relative",
                      (markingMode || replacingIndex !== null) ? "ring-2 ring-primary" : ""
                    )}
                    style={{
                      maxHeight: 600,
                      touchAction: "none",
                      userSelect: "none",
                      WebkitUserSelect: "none",
                      WebkitTouchCallout: "none",
                    } as React.CSSProperties}
                    onWheel={handleWheel}
                    onMouseDown={handleMouseDown}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={() => { handleMouseLeave(); handleMouseUp(); }}
                  >
                    {/* ── Banner flutuante: ponto atual da sequência ───────────
                        Fica no topo da imagem, bem visível e na cor do ponto, para
                        o cirurgião nunca marcar o ponto errado da sequência. */}
                    {/* ── Banner flutuante CORA (quando em modo CORA) ─────── */}
                    {coraMarkingActive && coraMarkingPhase !== null && (() => {
                      const isProx = coraMarkingPhase === 'prox';
                      const bg = isProx ? '#A855F7' : '#F97316';
                      const boneName = coraMarkingBone === 'femoral' ? t("femoralTitle") : t("tibialTitle");
                      const segLabel = isProx ? t("proximal") : t("distal");
                      const pointNum = isProx ? (coraProxPoints.length + 1) : (coraDistPoints.length + 1);
                      return (
                        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 pointer-events-none max-w-[92%]">
                          <div
                            className="flex items-center gap-2.5 rounded-full pl-1.5 pr-4 py-1.5 shadow-lg ring-2 ring-white/40 backdrop-blur-sm"
                            style={{ backgroundColor: bg }}
                          >
                            <span className="shrink-0 w-8 h-8 rounded-full bg-white/95 flex items-center justify-center text-base font-black" style={{ color: bg }}>
                              {pointNum}
                            </span>
                            <div className="min-w-0 leading-tight">
                              <span className="block text-[9px] font-bold uppercase tracking-wide text-white/85">
                                {t("coraFloatingTitle", { bone: boneName, segment: segLabel })}
                              </span>
                              <span className="block text-sm font-extrabold text-white truncate">
                                {isProx ? t("coraFloatingProx") : t("coraFloatingDist")}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                    {/* ── Banner flutuante: ponto atual da sequência 1-11 ─── */}
                    {(markingMode || replacingIndex !== null) && !coraMarkingActive && (() => {
                      const steps = buildMarkSteps(
                        { hka: markedPoints.length, aldfa: aldfaPoints.length, ampta: amptaPoints.length, eixoFemoral: eixoFemoralPoints.length, eixoTibial: eixoTibialPoints.length },
                        markingTarget,
                        t,
                      );
                      const active = steps.find(s => s.active);
                      if (!active) return null;
                      return (
                        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 pointer-events-none max-w-[92%]">
                          <div
                            className="flex items-center gap-2.5 rounded-full pl-1.5 pr-4 py-1.5 shadow-lg ring-2 ring-white/40 backdrop-blur-sm"
                            style={{ backgroundColor: active.color }}
                          >
                            <span className="shrink-0 w-8 h-8 rounded-full bg-white/95 flex items-center justify-center text-base font-black" style={{ color: active.color }}>
                              {active.num}
                            </span>
                            <div className="min-w-0 leading-tight">
                              <span className="block text-[9px] font-bold uppercase tracking-wide text-white/85">Marque agora · {active.num}/11</span>
                              <span className="block text-sm font-extrabold text-white truncate">{active.label}</span>
                              {active.num >= 8 && active.num <= 11 && (
                                <span className="block text-[10px] font-semibold text-white/80 mt-0.5">{t("markDiaphysisCenter")}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                    {/* ── Botão undo flutuante sobre a imagem ──────────────────
                        Só aparece quando há pontos marcados. Posicionado no canto
                        superior direito do container (position:absolute). Apenas
                        o ícone — sem texto — para não cobrir a imagem. Usa a
                        mesma lógica de undo unificado do botão da barra de controle. */}
                    {(markingMode || replacingIndex !== null) && (() => {
                      // CORA undo (overlay button)
                      if (coraMarkingActive) {
                        const inDist = coraDistPoints.length > 0;
                        const hasAny = coraProxPoints.length > 0 || coraDistPoints.length > 0;
                        if (!hasAny) return null;
                        return (
                          <button
                            type="button"
                            title={t("undoCoraPoint")}
                            onPointerDown={e => { e.stopPropagation(); }}
                            onClick={e => {
                              e.stopPropagation();
                              if (inDist) {
                                const np = coraDistPoints.slice(0, -1);
                                setCoraDistPoints(np);
                                touchSnapRef.current.coraDistPoints = np;
                              } else {
                                const np = coraProxPoints.slice(0, -1);
                                setCoraProxPoints(np);
                                touchSnapRef.current.coraProxPoints = np;
                                if (coraMarkingPhase !== 'prox') {
                                  setCoraMarkingPhase('prox');
                                  coraMarkingPhaseRef.current = 'prox';
                                  touchSnapRef.current.coraMarkingPhase = 'prox';
                                }
                              }
                            }}
                            data-undo-btn="1"
                            className="absolute top-2 right-2 w-10 h-10 rounded-full bg-purple-500/90 hover:bg-purple-400 active:scale-95 shadow-lg flex items-center justify-center transition-all"
                            style={{ touchAction: "auto", zIndex: 50 }}
                          >
                            <RefreshCw className="h-5 w-5 text-white -scale-x-100" />
                          </button>
                        );
                      }
                      const undoChain2 = [
                        { target: 'hka' as const,         points: markedPoints,       setter: setMarkedPoints },
                        { target: 'aldfa' as const,        points: aldfaPoints,        setter: setAldfaPoints },
                        { target: 'ampta' as const,        points: amptaPoints,        setter: setAmptaPoints },
                        { target: 'eixoFemoral' as const,  points: eixoFemoralPoints,  setter: setEixoFemoralPoints },
                        { target: 'eixoTibial' as const,   points: eixoTibialPoints,   setter: setEixoTibialPoints },
                      ];
                      const currentIdx2 = undoChain2.findIndex(s => s.target === markingTarget);
                      let undoIdx2 = currentIdx2;
                      while (undoIdx2 >= 0 && undoChain2[undoIdx2]!.points.length === 0) undoIdx2--;
                      if (undoIdx2 < 0) return null;
                      const undoStep2 = undoChain2[undoIdx2]!;
                      const total2 = undoChain2.reduce((s, c) => s + c.points.length, 0);
                      return (
                        <button
                          type="button"
                          title={`Voltar 1 ponto (${total2}/11 marcados)`}
                          onPointerDown={e => {
                            // stopPropagation evita que o click chegue ao handler de
                            // marcação de pontos que está no imgContainerRef
                            e.stopPropagation();
                          }}
                          onClick={e => {
                            e.stopPropagation();
                            const newPoints = undoStep2.points.slice(0, -1);
                            undoStep2.setter(newPoints);
                            if (undoStep2.target === 'hka') touchSnapRef.current.markedPoints = newPoints;
                            else if (undoStep2.target === 'aldfa') touchSnapRef.current.aldfaPoints = newPoints;
                            else if (undoStep2.target === 'ampta') touchSnapRef.current.amptaPoints = newPoints;
                            else if (undoStep2.target === 'eixoFemoral') touchSnapRef.current.eixoFemoralPoints = newPoints;
                            else if (undoStep2.target === 'eixoTibial') touchSnapRef.current.eixoTibialPoints = newPoints;
                            if (undoStep2.target !== markingTarget) {
                              setMarkingTarget(undoStep2.target);
                              touchSnapRef.current.markingTarget = undoStep2.target;
                            }
                          }}
                          data-undo-btn="1"
                          className="absolute top-2 right-2 w-10 h-10 rounded-full bg-amber-400/90 hover:bg-amber-300 active:scale-95 shadow-lg flex items-center justify-center transition-all"
                          style={{ touchAction: "auto", zIndex: 50 }}
                        >
                          <RefreshCw className="h-5 w-5 text-amber-900 -scale-x-100" />
                        </button>
                      );
                    })()}

                    {/* Inner wrapper: EXACTLY the size of the image — SVG lives here; zoom transform applied */}
                    <div
                      className={cn(
                        "relative",
                        (markingMode || replacingIndex !== null) ? "cursor-none" : isDragging ? "cursor-grabbing" : imgZoom > 1 ? "cursor-grab" : ""
                      )}
                      style={{
                        display: "inline-block",
                        lineHeight: 0,
                        transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${imgZoom})`,
                        transformOrigin: "50% 50%",
                        willChange: "transform", // hint browser to composite on GPU
                      }}
                      onClick={handleMarkingClick}
                      onMouseMove={handleMouseMove}
                    >
                      <img
                        ref={imgRef}
                        src={previewUrl}
                        alt={t("panoramicImageAlt")}
                        draggable={false}
                        className="max-h-full w-auto object-contain block select-none"
                        style={{
                          maxHeight: 588,
                          userSelect: "none",
                          WebkitUserSelect: "none",
                          WebkitTouchCallout: "none",
                          pointerEvents: "none",
                        } as React.CSSProperties}
                        onDragStart={(e) => e.preventDefault()}
                        onContextMenu={(e) => e.preventDefault()}
                        onLoad={(e) => {
                          const img = e.currentTarget;
                          setNaturalImgSize({ w: img.naturalWidth, h: img.naturalHeight });
                        }}
                      />

                      {/* SVG overlay — absolute inset-0 sits exactly on the image.
                          viewBox uses natural image dimensions so markedPoints (stored in
                          natural pixel coords) map correctly regardless of display size. */}
                      {(markingMode || replacingIndex !== null || markedPoints.length > 0 || aldfaPoints.length > 0 || amptaPoints.length > 0 || coraProxPoints.length > 0 || coraDistPoints.length > 0 || computedCoraFemoral !== null || computedCoraTibial !== null || dfoHingePoint !== null || baseMarcacoes.femur || baseMarcacoes.tibia || calibP1 !== null) && naturalImgSize && (
                        <svg
                          ref={svgOverlayRef}
                          className="absolute inset-0 w-full h-full pointer-events-none"
                          viewBox={`0 0 ${naturalImgSize.w} ${naturalImgSize.h}`}
                          style={{ overflow: "visible" }}
                        >
                          {/* svgNS = scale factor: 1 natural pixel = how many CSS pixels on screen.
                              Used to keep circles / text the same visual size regardless of
                              the image's natural resolution. Strokes use vectorEffect instead. */}
                          {(() => {
                            const svgNS = naturalImgSize && imgRef.current?.clientWidth
                              ? naturalImgSize.w / imgRef.current.clientWidth
                              : 1;
                            const sd = svgNS; // alias for brevity
                            return (
                              <>
                          <defs>
                            <filter id="shadow-label" x="-30%" y="-30%" width="160%" height="160%">
                              <feDropShadow dx="0" dy={sd} stdDeviation={2*sd} floodColor="rgba(0,0,0,0.9)" floodOpacity="1" />
                            </filter>
                            <filter id="shadow-line" x="-5%" y="-5%" width="110%" height="110%">
                              <feDropShadow dx="0" dy="0" stdDeviation={1.5*sd} floodColor="rgba(0,0,0,0.7)" />
                            </filter>
                          </defs>

                          {/* ─── Eixo mecânico completo A→C (quadril → tornozelo) ─── */}
                          {markedPoints.length === 3 && (() => {
                            const A = markedPoints[0], C = markedPoints[2];
                            const dx = C.x - A.x, dy = C.y - A.y;
                            const len = Math.sqrt(dx*dx + dy*dy) || 1;
                            const ex = (dx/len)*12*sd, ey = (dy/len)*12*sd;
                            return (
                              <line
                                x1={A.x - ex} y1={A.y - ey}
                                x2={C.x + ex} y2={C.y + ey}
                                stroke="#facc15" strokeWidth={1.5} strokeDasharray="6 4"
                                opacity="0.85" filter="url(#shadow-line)"
                                vectorEffect="non-scaling-stroke"
                              />
                            );
                          })()}

                          {/* ─── Segmento femoral: A→B (azul) ─── */}
                          {markedPoints.length >= 2 && (
                            <line
                              x1={markedPoints[0].x} y1={markedPoints[0].y}
                              x2={markedPoints[1].x} y2={markedPoints[1].y}
                              stroke="#1FB6E1" strokeWidth={2.5} opacity="0.9"
                              filter="url(#shadow-line)"
                              vectorEffect="non-scaling-stroke"
                            />
                          )}

                          {/* ─── Segmento tibial: B→C (verde) ─── */}
                          {markedPoints.length === 3 && (
                            <line
                              x1={markedPoints[1].x} y1={markedPoints[1].y}
                              x2={markedPoints[2].x} y2={markedPoints[2].y}
                              stroke="#10B981" strokeWidth={2.5} opacity="0.9"
                              filter="url(#shadow-line)"
                              vectorEffect="non-scaling-stroke"
                            />
                          )}

                          {/* ─── Arco do ângulo HKA no joelho ─── */}
                          {markedPoints.length === 3 && hkaFromPoints !== null && (() => {
                            const A = markedPoints[0], B = markedPoints[1], C = markedPoints[2];
                            const lenAB = Math.sqrt((B.x-A.x)**2 + (B.y-A.y)**2) || 1;
                            const lenBC = Math.sqrt((C.x-B.x)**2 + (C.y-B.y)**2) || 1;
                            const r = Math.min(lenAB, lenBC) * 0.18;
                            const angA = Math.atan2(A.y - B.y, A.x - B.x);
                            const angC = Math.atan2(C.y - B.y, C.x - B.x);
                            const sx = B.x + r * Math.cos(angA);
                            const sy = B.y + r * Math.sin(angA);
                            const ex = B.x + r * Math.cos(angC);
                            const ey = B.y + r * Math.sin(angC);
                            let diff = angC - angA;
                            while (diff > Math.PI) diff -= 2*Math.PI;
                            while (diff < -Math.PI) diff += 2*Math.PI;
                            const sweep = diff > 0 ? 1 : 0;
                            const large = Math.abs(diff) > Math.PI ? 1 : 0;
                            return (
                              <path
                                d={`M ${sx} ${sy} A ${r} ${r} 0 ${large} ${sweep} ${ex} ${ey}`}
                                fill="none" stroke="#facc15" strokeWidth={1.5} opacity="0.9"
                                filter="url(#shadow-line)"
                                vectorEffect="non-scaling-stroke"
                              />
                            );
                          })()}

                          {/* ─── Pontos marcados ─── */}
                          {markedPoints.map((pt, i) => {
                            const isReplacing = replacingIndex === i;
                            const colors = ["#1FB6E1", "#F59E0B", "#10B981"];
                            const anatomyLabels = [t("hip"), t("knee"), t("ankle")];
                            const color = isReplacing ? "#ef4444" : colors[i];
                            const labelText = anatomyLabels[i];
                            const R = 6 * sd;
                            const CL = 7 * sd; // crosshair arm length
                            const lx = pt.x + R + 6*sd;
                            const ly = pt.y;
                            const labelW = labelText.length * 6.5*sd + 8*sd;
                            return (
                              <g key={i}>
                                <circle cx={pt.x} cy={pt.y} r={isReplacing ? R+8*sd : R+4*sd}
                                  fill={color} opacity={isReplacing ? 0.25 : 0.18} />
                                <line x1={pt.x - R-CL} y1={pt.y} x2={pt.x - R+sd} y2={pt.y} stroke="white" strokeWidth={1.2} opacity="0.9" filter="url(#shadow-line)" vectorEffect="non-scaling-stroke" />
                                <line x1={pt.x + R-sd} y1={pt.y} x2={pt.x + R+CL} y2={pt.y} stroke="white" strokeWidth={1.2} opacity="0.9" filter="url(#shadow-line)" vectorEffect="non-scaling-stroke" />
                                <line x1={pt.x} y1={pt.y - R-CL} x2={pt.x} y2={pt.y - R+sd} stroke="white" strokeWidth={1.2} opacity="0.9" filter="url(#shadow-line)" vectorEffect="non-scaling-stroke" />
                                <line x1={pt.x} y1={pt.y + R-sd} x2={pt.x} y2={pt.y + R+CL} stroke="white" strokeWidth={1.2} opacity="0.9" filter="url(#shadow-line)" vectorEffect="non-scaling-stroke" />
                                <circle cx={pt.x} cy={pt.y} r={R}
                                  fill={color} fillOpacity="0.25"
                                  stroke={color} strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
                                <circle cx={pt.x} cy={pt.y} r={2.5*sd} fill={isReplacing ? "#ef4444" : "white"} />
                                <rect x={lx - 2*sd} y={ly - 9*sd} width={labelW} height={16*sd} rx={3*sd}
                                  fill="rgba(0,0,0,0.75)" />
                                <text x={lx + labelW/2 - 2*sd} y={ly + 3.5*sd}
                                  fill={color} fontSize={10*sd} fontWeight="bold" textAnchor="middle"
                                  filter="url(#shadow-label)">
                                  {labelText}
                                </text>
                              </g>
                            );
                          })}

                          {/* ─── aLDFA: linha da articulação distal + pontos ─── */}
                          {aldfaPoints.length === 2 && (() => {
                            const [Cmed, Clat] = aldfaPoints;
                            const dx = Clat.x - Cmed.x, dy = Clat.y - Cmed.y;
                            const len = Math.sqrt(dx*dx + dy*dy) || 1;
                            const ex = (dx/len)*16*sd, ey = (dy/len)*16*sd;
                            return (
                              <line x1={Cmed.x - ex} y1={Cmed.y - ey} x2={Clat.x + ex} y2={Clat.y + ey}
                                stroke="#F97316" strokeWidth={2} opacity="0.9"
                                filter="url(#shadow-line)" vectorEffect="non-scaling-stroke" />
                            );
                          })()}
                          {aldfaPoints.map((pt, i) => {
                            const color = ALDFA_POINT_LABELS[i].color;
                            const labelText = i === 0 ? t("aldfaMedialShort") : t("aldfaLateralShort");
                            const R = 5 * sd; const CL = 6 * sd;
                            const lx = pt.x + R + 5*sd; const ly = pt.y;
                            const labelW = labelText.length * 6*sd + 8*sd;
                            return (
                              <g key={`aldfa-${i}`}>
                                <circle cx={pt.x} cy={pt.y} r={R+4*sd} fill={color} opacity="0.18" />
                                <line x1={pt.x-R-CL} y1={pt.y} x2={pt.x-R+sd} y2={pt.y} stroke="white" strokeWidth={1.2} opacity="0.9" filter="url(#shadow-line)" vectorEffect="non-scaling-stroke" />
                                <line x1={pt.x+R-sd} y1={pt.y} x2={pt.x+R+CL} y2={pt.y} stroke="white" strokeWidth={1.2} opacity="0.9" filter="url(#shadow-line)" vectorEffect="non-scaling-stroke" />
                                <line x1={pt.x} y1={pt.y-R-CL} x2={pt.x} y2={pt.y-R+sd} stroke="white" strokeWidth={1.2} opacity="0.9" filter="url(#shadow-line)" vectorEffect="non-scaling-stroke" />
                                <line x1={pt.x} y1={pt.y+R-sd} x2={pt.x} y2={pt.y+R+CL} stroke="white" strokeWidth={1.2} opacity="0.9" filter="url(#shadow-line)" vectorEffect="non-scaling-stroke" />
                                <circle cx={pt.x} cy={pt.y} r={R} fill={color} fillOpacity="0.25" stroke={color} strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
                                <circle cx={pt.x} cy={pt.y} r={2.5*sd} fill="white" />
                                <rect x={lx-2*sd} y={ly-9*sd} width={labelW} height={16*sd} rx={3*sd} fill="rgba(0,0,0,0.75)" />
                                <text x={lx+labelW/2-2*sd} y={ly+3.5*sd} fill={color} fontSize={10*sd} fontWeight="bold" textAnchor="middle" filter="url(#shadow-label)">{labelText}</text>
                              </g>
                            );
                          })}
                          {/* mLDFA computed angle label — positioned above the condyles (toward femoral shaft) */}
                          {computedAlDFA !== null && aldfaPoints.length === 2 && (() => {
                            const mid = { x: (aldfaPoints[0].x + aldfaPoints[1].x) / 2, y: (aldfaPoints[0].y + aldfaPoints[1].y) / 2 };
                            // Place label well ABOVE the mLDFA line (toward femoral shaft, away from knee center)
                            const labelY = mid.y - 110*sd;
                            const mldfaNodeOvl = analysis ? (analysis as unknown as Record<string, unknown>).mLDFA as Record<string, unknown> | undefined : undefined;
                            const displayAlDFA =
                              (mldfaNodeOvl?._corrigidoSuplementar ? Number(mldfaNodeOvl.valor) : null)
                              ?? computedAlDFA;
                            const wasFixed = displayAlDFA !== computedAlDFA;
                            const lbl = wasFixed
                              ? `mLDFA ${displayAlDFA.toFixed(1)}° ✓`
                              : `mLDFA ${computedAlDFA.toFixed(1)}°`;
                            const lW = lbl.length * 6.5*sd + 12*sd;
                            return (
                              <g>
                                {/* vertical connector line from label to aLDFA mid */}
                                <line x1={mid.x} y1={labelY + 18*sd} x2={mid.x} y2={mid.y - 4*sd}
                                  stroke="rgba(180,80,0,0.6)" strokeWidth={1} strokeDasharray={`${4*sd} ${3*sd}`}
                                  vectorEffect="non-scaling-stroke" />
                                <rect x={mid.x - lW/2} y={labelY} width={lW} height={18*sd} rx={3*sd} fill="rgba(180,80,0,0.92)" />
                                <text x={mid.x} y={labelY + 13*sd} fill="white" fontSize={11*sd} fontWeight="bold" textAnchor="middle" filter="url(#shadow-label)">{lbl}</text>
                              </g>
                            );
                          })()}

                          {/* ─── aMPTA: linha do planalto tibial + pontos ─── */}
                          {amptaPoints.length === 2 && (() => {
                            const [Pmed, Plat] = amptaPoints;
                            const dx = Plat.x - Pmed.x, dy = Plat.y - Pmed.y;
                            const len = Math.sqrt(dx*dx + dy*dy) || 1;
                            const ex = (dx/len)*16*sd, ey = (dy/len)*16*sd;
                            return (
                              <line x1={Pmed.x - ex} y1={Pmed.y - ey} x2={Plat.x + ex} y2={Plat.y + ey}
                                stroke="#8B5CF6" strokeWidth={2} opacity="0.9"
                                filter="url(#shadow-line)" vectorEffect="non-scaling-stroke" />
                            );
                          })()}
                          {amptaPoints.map((pt, i) => {
                            const color = AMPTA_POINT_LABELS[i].color;
                            const labelText = i === 0 ? "Pl.Medial" : "Pl.Lateral";
                            const R = 5 * sd; const CL = 6 * sd;
                            const lx = pt.x + R + 5*sd; const ly = pt.y;
                            const labelW = labelText.length * 6*sd + 8*sd;
                            return (
                              <g key={`ampta-${i}`}>
                                <circle cx={pt.x} cy={pt.y} r={R+4*sd} fill={color} opacity="0.18" />
                                <line x1={pt.x-R-CL} y1={pt.y} x2={pt.x-R+sd} y2={pt.y} stroke="white" strokeWidth={1.2} opacity="0.9" filter="url(#shadow-line)" vectorEffect="non-scaling-stroke" />
                                <line x1={pt.x+R-sd} y1={pt.y} x2={pt.x+R+CL} y2={pt.y} stroke="white" strokeWidth={1.2} opacity="0.9" filter="url(#shadow-line)" vectorEffect="non-scaling-stroke" />
                                <line x1={pt.x} y1={pt.y-R-CL} x2={pt.x} y2={pt.y-R+sd} stroke="white" strokeWidth={1.2} opacity="0.9" filter="url(#shadow-line)" vectorEffect="non-scaling-stroke" />
                                <line x1={pt.x} y1={pt.y+R-sd} x2={pt.x} y2={pt.y+R+CL} stroke="white" strokeWidth={1.2} opacity="0.9" filter="url(#shadow-line)" vectorEffect="non-scaling-stroke" />
                                <circle cx={pt.x} cy={pt.y} r={R} fill={color} fillOpacity="0.25" stroke={color} strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
                                <circle cx={pt.x} cy={pt.y} r={2.5*sd} fill="white" />
                                <rect x={lx-2*sd} y={ly-9*sd} width={labelW} height={16*sd} rx={3*sd} fill="rgba(0,0,0,0.75)" />
                                <text x={lx+labelW/2-2*sd} y={ly+3.5*sd} fill={color} fontSize={10*sd} fontWeight="bold" textAnchor="middle" filter="url(#shadow-label)">{labelText}</text>
                              </g>
                            );
                          })}
                          {/* aMPTA computed angle label — positioned below the plateau (toward tibial shaft) */}
                          {computedAmPTA !== null && amptaPoints.length === 2 && (() => {
                            const mid = { x: (amptaPoints[0].x + amptaPoints[1].x) / 2, y: (amptaPoints[0].y + amptaPoints[1].y) / 2 };
                            // Place label well BELOW the aMPTA line (toward tibial shaft, away from knee center)
                            const labelY = mid.y + 80*sd;
                            const lbl = `aMPTA ${computedAmPTA.toFixed(1)}°`;
                            const lW = lbl.length * 6.5*sd + 12*sd;
                            return (
                              <g>
                                {/* vertical connector line from aMPTA mid to label */}
                                <line x1={mid.x} y1={mid.y + 4*sd} x2={mid.x} y2={labelY}
                                  stroke="rgba(100,30,200,0.6)" strokeWidth={1} strokeDasharray={`${4*sd} ${3*sd}`}
                                  vectorEffect="non-scaling-stroke" />
                                <rect x={mid.x - lW/2} y={labelY} width={lW} height={18*sd} rx={3*sd} fill="rgba(100,30,200,0.92)" />
                                <text x={mid.x} y={labelY + 13*sd} fill="white" fontSize={11*sd} fontWeight="bold" textAnchor="middle" filter="url(#shadow-label)">{lbl}</text>
                              </g>
                            );
                          })()}

                          {/* ─── Eixo Femoral: linha diafisária extendida + pontos ─── */}
                          {eixoFemoralPoints.length === 2 && (() => {
                            const [Pp, Pd] = eixoFemoralPoints;
                            const dx = Pd.x - Pp.x, dy = Pd.y - Pp.y;
                            const len = Math.sqrt(dx*dx + dy*dy) || 1;
                            // Extend line proximally and distally for visibility
                            const ex = (dx/len)*180*sd, ey = (dy/len)*180*sd;
                            return (
                              <line x1={Pp.x - ex} y1={Pp.y - ey} x2={Pd.x + ex} y2={Pd.y + ey}
                                stroke="#06B6D4" strokeWidth={2} opacity="0.85"
                                strokeDasharray={`${8*sd} ${4*sd}`}
                                filter="url(#shadow-line)" vectorEffect="non-scaling-stroke" />
                            );
                          })()}
                          {eixoFemoralPoints.map((pt, i) => {
                            const color = EIXO_FEMORAL_POINT_LABELS[i].color;
                            const labelText = i === 0 ? t("femoralProxShort") : t("femoralDistShort");
                            const R = 5 * sd; const CL = 6 * sd;
                            const lx = pt.x + R + 5*sd; const ly = pt.y;
                            const labelW = labelText.length * 6*sd + 8*sd;
                            return (
                              <g key={`eixoF-${i}`}>
                                <circle cx={pt.x} cy={pt.y} r={R+4*sd} fill={color} opacity="0.18" />
                                <line x1={pt.x-R-CL} y1={pt.y} x2={pt.x-R+sd} y2={pt.y} stroke="white" strokeWidth={1.2} opacity="0.9" filter="url(#shadow-line)" vectorEffect="non-scaling-stroke" />
                                <line x1={pt.x+R-sd} y1={pt.y} x2={pt.x+R+CL} y2={pt.y} stroke="white" strokeWidth={1.2} opacity="0.9" filter="url(#shadow-line)" vectorEffect="non-scaling-stroke" />
                                <line x1={pt.x} y1={pt.y-R-CL} x2={pt.x} y2={pt.y-R+sd} stroke="white" strokeWidth={1.2} opacity="0.9" filter="url(#shadow-line)" vectorEffect="non-scaling-stroke" />
                                <line x1={pt.x} y1={pt.y+R-sd} x2={pt.x} y2={pt.y+R+CL} stroke="white" strokeWidth={1.2} opacity="0.9" filter="url(#shadow-line)" vectorEffect="non-scaling-stroke" />
                                <circle cx={pt.x} cy={pt.y} r={R} fill={color} fillOpacity="0.25" stroke={color} strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
                                <circle cx={pt.x} cy={pt.y} r={2.5*sd} fill="white" />
                                <rect x={lx-2*sd} y={ly-9*sd} width={labelW} height={16*sd} rx={3*sd} fill="rgba(0,0,0,0.75)" />
                                <text x={lx+labelW/2-2*sd} y={ly+3.5*sd} fill={color} fontSize={10*sd} fontWeight="bold" textAnchor="middle" filter="url(#shadow-label)">{labelText}</text>
                              </g>
                            );
                          })}
                          {/* ─── Eixo Tibial: linha diafisária extendida + pontos ─── */}
                          {eixoTibialPoints.length === 2 && (() => {
                            const [Pp, Pd] = eixoTibialPoints;
                            const dx = Pd.x - Pp.x, dy = Pd.y - Pp.y;
                            const len = Math.sqrt(dx*dx + dy*dy) || 1;
                            const ex = (dx/len)*180*sd, ey = (dy/len)*180*sd;
                            return (
                              <line x1={Pp.x - ex} y1={Pp.y - ey} x2={Pd.x + ex} y2={Pd.y + ey}
                                stroke="#22C55E" strokeWidth={2} opacity="0.85"
                                strokeDasharray={`${8*sd} ${4*sd}`}
                                filter="url(#shadow-line)" vectorEffect="non-scaling-stroke" />
                            );
                          })()}
                          {eixoTibialPoints.map((pt, i) => {
                            const color = EIXO_TIBIAL_POINT_LABELS[i].color;
                            const labelText = i === 0 ? t("tibialProxShort") : t("tibialDistShort");
                            const R = 5 * sd; const CL = 6 * sd;
                            const lx = pt.x + R + 5*sd; const ly = pt.y;
                            const labelW = labelText.length * 6*sd + 8*sd;
                            return (
                              <g key={`eixoT-${i}`}>
                                <circle cx={pt.x} cy={pt.y} r={R+4*sd} fill={color} opacity="0.18" />
                                <line x1={pt.x-R-CL} y1={pt.y} x2={pt.x-R+sd} y2={pt.y} stroke="white" strokeWidth={1.2} opacity="0.9" filter="url(#shadow-line)" vectorEffect="non-scaling-stroke" />
                                <line x1={pt.x+R-sd} y1={pt.y} x2={pt.x+R+CL} y2={pt.y} stroke="white" strokeWidth={1.2} opacity="0.9" filter="url(#shadow-line)" vectorEffect="non-scaling-stroke" />
                                <line x1={pt.x} y1={pt.y-R-CL} x2={pt.x} y2={pt.y-R+sd} stroke="white" strokeWidth={1.2} opacity="0.9" filter="url(#shadow-line)" vectorEffect="non-scaling-stroke" />
                                <line x1={pt.x} y1={pt.y+R-sd} x2={pt.x} y2={pt.y+R+CL} stroke="white" strokeWidth={1.2} opacity="0.9" filter="url(#shadow-line)" vectorEffect="non-scaling-stroke" />
                                <circle cx={pt.x} cy={pt.y} r={R} fill={color} fillOpacity="0.25" stroke={color} strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
                                <circle cx={pt.x} cy={pt.y} r={2.5*sd} fill="white" />
                                <rect x={lx-2*sd} y={ly-9*sd} width={labelW} height={16*sd} rx={3*sd} fill="rgba(0,0,0,0.75)" />
                                <text x={lx+labelW/2-2*sd} y={ly+3.5*sd} fill={color} fontSize={10*sd} fontWeight="bold" textAnchor="middle" filter="url(#shadow-label)">{labelText}</text>
                              </g>
                            );
                          })}
                          {/* Eixo Anatômico computed angle label — at intersection / midpoint of the two shafts */}
                          {computedEixoAnatomico !== null && eixoFemoralPoints.length === 2 && eixoTibialPoints.length === 2 && (() => {
                            const Fd = eixoFemoralPoints[1];
                            const Tp = eixoTibialPoints[0];
                            const mid = { x: (Fd.x + Tp.x) / 2, y: (Fd.y + Tp.y) / 2 };
                            const labelX = mid.x + 90*sd;
                            const labelY = mid.y;
                            const ea = computedEixoAnatomico;
                            const desvio = ea < -0.05 ? "Varo" : ea > 0.05 ? "Valgo" : "Neutro";
                            const lbl = `Eixo Anat. ${Math.abs(ea).toFixed(1)}° ${desvio}`;
                            const lW = lbl.length * 6.5*sd + 12*sd;
                            return (
                              <g>
                                <line x1={mid.x} y1={mid.y} x2={labelX} y2={labelY}
                                  stroke="rgba(20,120,80,0.6)" strokeWidth={1} strokeDasharray={`${4*sd} ${3*sd}`}
                                  vectorEffect="non-scaling-stroke" />
                                <rect x={labelX} y={labelY - 9*sd} width={lW} height={18*sd} rx={3*sd} fill="rgba(20,120,80,0.92)" />
                                <text x={labelX + lW/2} y={labelY + 4*sd} fill="white" fontSize={11*sd} fontWeight="bold" textAnchor="middle" filter="url(#shadow-label)">{lbl}</text>
                              </g>
                            );
                          })()}

                          {/* ─── CORA overlay ─────────────────────────────────────
                              Segmento proximal (roxo) + distal (laranja) + ponto de
                              interseção CORA (diamante vermelho) + rótulo do ângulo */}
                          {coraProxPoints.length >= 1 && (() => {
                            const color = '#A855F7'; // purple
                            return (
                              <>
                                {coraProxPoints.length === 2 && (() => {
                                  const [p1, p2] = coraProxPoints;
                                  const dx = p2.x - p1.x, dy = p2.y - p1.y;
                                  const len = Math.sqrt(dx*dx + dy*dy) || 1;
                                  const ex = (dx/len)*200*sd, ey = (dy/len)*200*sd;
                                  return (
                                    <line x1={p1.x - ex} y1={p1.y - ey} x2={p2.x + ex} y2={p2.y + ey}
                                      stroke={color} strokeWidth={2.5} opacity="0.9"
                                      strokeDasharray={`${8*sd} ${4*sd}`}
                                      filter="url(#shadow-line)" vectorEffect="non-scaling-stroke" />
                                  );
                                })()}
                                {coraProxPoints.map((pt, i) => (
                                  <g key={`cp-${i}`}>
                                    <circle cx={pt.x} cy={pt.y} r={7*sd} fill={color} fillOpacity="0.3" stroke={color} strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
                                    <circle cx={pt.x} cy={pt.y} r={2.5*sd} fill="white" />
                                    <rect x={pt.x + 10*sd} y={pt.y - 9*sd} width={52*sd} height={16*sd} rx={3*sd} fill="rgba(0,0,0,0.75)" />
                                    <text x={pt.x + 36*sd} y={pt.y + 4*sd} fill={color} fontSize={10*sd} fontWeight="bold" textAnchor="middle" filter="url(#shadow-label)">Prox.{i+1}</text>
                                  </g>
                                ))}
                              </>
                            );
                          })()}
                          {coraDistPoints.length >= 1 && (() => {
                            const color = '#F97316'; // orange
                            return (
                              <>
                                {coraDistPoints.length === 2 && (() => {
                                  const [p1, p2] = coraDistPoints;
                                  const dx = p2.x - p1.x, dy = p2.y - p1.y;
                                  const len = Math.sqrt(dx*dx + dy*dy) || 1;
                                  const ex = (dx/len)*200*sd, ey = (dy/len)*200*sd;
                                  return (
                                    <line x1={p1.x - ex} y1={p1.y - ey} x2={p2.x + ex} y2={p2.y + ey}
                                      stroke={color} strokeWidth={2.5} opacity="0.9"
                                      strokeDasharray={`${8*sd} ${4*sd}`}
                                      filter="url(#shadow-line)" vectorEffect="non-scaling-stroke" />
                                  );
                                })()}
                                {coraDistPoints.map((pt, i) => (
                                  <g key={`cd-${i}`}>
                                    <circle cx={pt.x} cy={pt.y} r={7*sd} fill={color} fillOpacity="0.3" stroke={color} strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
                                    <circle cx={pt.x} cy={pt.y} r={2.5*sd} fill="white" />
                                    <rect x={pt.x + 10*sd} y={pt.y - 9*sd} width={52*sd} height={16*sd} rx={3*sd} fill="rgba(0,0,0,0.75)" />
                                    <text x={pt.x + 36*sd} y={pt.y + 4*sd} fill={color} fontSize={10*sd} fontWeight="bold" textAnchor="middle" filter="url(#shadow-label)">Dist.{i+1}</text>
                                  </g>
                                ))}
                              </>
                            );
                          })()}
                          {/* ─── Base por osso (Prompt 3) — pontos entrada + charneira ─── */}
                          {/* Fêmur: labels à DIREITA do ponto (offset +x)              */}
                          {/* Tíbia:  labels à ESQUERDA do ponto (offset −x)            */}
                          {/* Isso evita sobreposição quando os pontos estão próximos.  */}
                          {/* Oculta durante calibração para não poluir a tela           */}
                          {calibMode === 'idle' && (['femur', 'tibia'] as const).map(bone => {
                            const bpts = baseMarcacoes[bone];
                            if (!bpts) return null;
                            // Oculta marcações do outro osso durante marcação ativa — evita confusão de labels
                            if (baseMarkingActive && baseMarkingActive.bone !== bone) return null;
                            const color   = bone === 'femur' ? '#7C3AED' : '#2563EB';
                            const bgColor = bone === 'femur' ? 'rgba(109,40,217,0.88)' : 'rgba(29,78,216,0.88)';
                            const label   = bone === 'femur' ? 'Fem' : 'Tib';
                            // fêmur → direita; tíbia → esquerda
                            const wE = 58 * sd;  // rect width "Base X entrada"
                            const wC = 66 * sd;  // rect width "Base X charneira"
                            const gap = 10 * sd;
                            // rect x: right-side = point + gap; left-side = point - gap - width
                            const rxE = bone === 'femur' ? bpts.entrada.x + gap : bpts.entrada.x - gap - wE;
                            const rxC = bpts.charneira ? (bone === 'femur' ? bpts.charneira.x + gap : bpts.charneira.x - gap - wC) : 0;
                            return (
                              <g key={`base-${bone}`}>
                                {/* Ponto entrada */}
                                <circle cx={bpts.entrada.x} cy={bpts.entrada.y} r={5 * sd} fill={color} fillOpacity="0.3" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                                <circle cx={bpts.entrada.x} cy={bpts.entrada.y} r={2 * sd} fill={color} />
                                <rect x={rxE} y={bpts.entrada.y - 8 * sd} width={wE} height={14 * sd} rx={3 * sd} fill={bgColor} />
                                <text x={rxE + wE / 2} y={bpts.entrada.y + 3 * sd} fill="white" fontSize={9 * sd} fontWeight="bold" textAnchor="middle">Córtex medial {label}</text>
                                {/* Linha entrada→charneira + ponto charneira */}
                                {bpts.charneira && (() => {
                                  const mx = (bpts.entrada.x + bpts.charneira.x) / 2;
                                  const my = (bpts.entrada.y + bpts.charneira.y) / 2;
                                  // base_mm badge — largura ML horizontal (|Δx| apenas, sem componente vertical)
                                  const pxDist = Math.abs(bpts.charneira.x - bpts.entrada.x);
                                  const baseMM = mmPorPixel ? +(pxDist * mmPorPixel).toFixed(1) : null;
                                  const badgeTxt = baseMM !== null ? `${baseMM} mm` : null;
                                  const bW = badgeTxt ? (badgeTxt.length * 6.5 + 14) * sd : 0;
                                  return (
                                    <>
                                      <line x1={bpts.entrada.x} y1={bpts.entrada.y} x2={bpts.charneira.x} y2={bpts.charneira.y} stroke={color} strokeWidth={1.5} strokeDasharray={`${4 * sd} ${3 * sd}`} vectorEffect="non-scaling-stroke" />
                                      <circle cx={bpts.charneira.x} cy={bpts.charneira.y} r={5 * sd} fill={color} fillOpacity="0.3" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                                      <circle cx={bpts.charneira.x} cy={bpts.charneira.y} r={2 * sd} fill={color} />
                                      <rect x={rxC} y={bpts.charneira.y - 8 * sd} width={wC} height={14 * sd} rx={3 * sd} fill={bgColor} />
                                      <text x={rxC + wC / 2} y={bpts.charneira.y + 3 * sd} fill="white" fontSize={9 * sd} fontWeight="bold" textAnchor="middle">Córtex lateral {label}</text>
                                      {/* Badge midpoint — base_mm medida */}
                                      {badgeTxt && (
                                        <>
                                          <rect x={mx - bW / 2} y={my - 9 * sd} width={bW} height={16 * sd} rx={4 * sd} fill="rgba(22,163,74,0.92)" />
                                          <text x={mx} y={my + 4 * sd} fill="white" fontSize={9 * sd} fontWeight="bold" textAnchor="middle">{badgeTxt}</text>
                                        </>
                                      )}
                                    </>
                                  );
                                })()}
                              </g>
                            );
                          })}

                          {/* ─── DFO charneira (hinge) point G ─── */}
                          {dfoHingePoint && (() => {
                            const { x, y } = dfoHingePoint;
                            const R = 9 * sd;
                            const lbl = "Charneira G";
                            const lW = lbl.length * 6.5 * sd + 12 * sd;
                            return (
                              <g>
                                <circle cx={x} cy={y} r={R + 4 * sd} fill="#EA580C" opacity="0.18" />
                                <line x1={x - R - 8 * sd} y1={y} x2={x + R + 8 * sd} y2={y} stroke="white" strokeWidth={1.5} opacity="0.9" filter="url(#shadow-line)" vectorEffect="non-scaling-stroke" />
                                <line x1={x} y1={y - R - 8 * sd} x2={x} y2={y + R + 8 * sd} stroke="white" strokeWidth={1.5} opacity="0.9" filter="url(#shadow-line)" vectorEffect="non-scaling-stroke" />
                                <circle cx={x} cy={y} r={R} fill="#EA580C" fillOpacity="0.35" stroke="#EA580C" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
                                <circle cx={x} cy={y} r={3 * sd} fill="white" />
                                <rect x={x + R + 6 * sd} y={y - 9 * sd} width={lW} height={16 * sd} rx={3 * sd} fill="rgba(180,60,0,0.9)" />
                                <text x={x + R + 6 * sd + lW / 2} y={y + 4 * sd} fill="white" fontSize={10 * sd} fontWeight="bold" textAnchor="middle" filter="url(#shadow-label)">{lbl}</text>
                              </g>
                            );
                          })()}

                          {/* CORA intersection diamond + angle label */}
                          {(computedCoraFemoral || computedCoraTibial) && (() => {
                            const result = computedCoraFemoral ?? computedCoraTibial!;
                            const { x, y, angle } = result;
                            const bone = computedCoraFemoral ? 'Fem' : 'Tib';
                            const half = 10 * sd;
                            const lbl = `CORA ${bone} ${angle.toFixed(1)}°`;
                            const lW = lbl.length * 7*sd + 16*sd;
                            return (
                              <g>
                                {/* diamond */}
                                <polygon
                                  points={`${x},${y - half} ${x + half},${y} ${x},${y + half} ${x - half},${y}`}
                                  fill="#EF4444" stroke="white" strokeWidth={1.5} opacity="0.95"
                                  filter="url(#shadow-label)"
                                  vectorEffect="non-scaling-stroke"
                                />
                                {/* label */}
                                <line x1={x + half} y1={y} x2={x + half + 30*sd} y2={y}
                                  stroke="rgba(200,30,30,0.7)" strokeWidth={1}
                                  vectorEffect="non-scaling-stroke" />
                                <rect x={x + half + 30*sd} y={y - 10*sd} width={lW} height={19*sd} rx={4*sd} fill="rgba(180,20,20,0.9)" />
                                <text x={x + half + 30*sd + lW/2} y={y + 4*sd} fill="white" fontSize={11*sd} fontWeight="bold" textAnchor="middle" filter="url(#shadow-label)">{lbl}</text>
                              </g>
                            );
                          })()}

                          {/* ─── Calibração de escala — P1/P2 e linha de referência ─── */}
                          {/* Ocultos durante marcação dos 11 pontos e marcação de base para não poluir a imagem */}
                          {calibP1 && !markingMode && !baseMarkingActive && (
                            <g>
                              <circle cx={calibP1.x} cy={calibP1.y} r={5*sd} fill="#f59e0b" fillOpacity="0.20" stroke="#f59e0b" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                              <circle cx={calibP1.x} cy={calibP1.y} r={1.5*sd} fill="#f59e0b" />
                              <rect x={calibP1.x + 12*sd} y={calibP1.y - 10*sd} width={50*sd} height={18*sd} rx={3*sd} fill="rgba(0,0,0,0.75)" />
                              <text x={calibP1.x + 37*sd} y={calibP1.y + 3.5*sd} fill="#fbbf24" fontSize={10*sd} fontWeight="bold" textAnchor="middle" filter="url(#shadow-label)">Ref P1</text>
                            </g>
                          )}
                          {calibP1 && calibP2 && !markingMode && !baseMarkingActive && (
                            <g>
                              <line x1={calibP1.x} y1={calibP1.y} x2={calibP2.x} y2={calibP2.y}
                                stroke="#f59e0b" strokeWidth={2} strokeDasharray={`${5*sd} ${3*sd}`}
                                opacity="0.9" filter="url(#shadow-line)" vectorEffect="non-scaling-stroke" />
                              <circle cx={calibP2.x} cy={calibP2.y} r={5*sd} fill="#f59e0b" fillOpacity="0.20" stroke="#f59e0b" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                              <circle cx={calibP2.x} cy={calibP2.y} r={1.5*sd} fill="#f59e0b" />
                              <rect x={calibP2.x + 12*sd} y={calibP2.y - 10*sd} width={50*sd} height={18*sd} rx={3*sd} fill="rgba(0,0,0,0.75)" />
                              <text x={calibP2.x + 37*sd} y={calibP2.y + 3.5*sd} fill="#fbbf24" fontSize={10*sd} fontWeight="bold" textAnchor="middle" filter="url(#shadow-label)">Ref P2</text>
                            </g>
                          )}
                          {calibMode === 'done' && calibP1 && calibP2 && mmPorPixel && !markingMode && !baseMarkingActive && (() => {
                            const mx = (calibP1.x + calibP2.x) / 2;
                            const my = (calibP1.y + calibP2.y) / 2;
                            const lbl = `${mmPorPixel.toFixed(3)} mm/px`;
                            const lW = lbl.length * 6.5*sd + 16*sd;
                            return (
                              <g>
                                <rect x={mx - lW/2} y={my - 14*sd} width={lW} height={18*sd} rx={3*sd} fill="rgba(5,150,105,0.9)" />
                                <text x={mx} y={my + 1*sd} fill="white" fontSize={10*sd} fontWeight="bold" textAnchor="middle" filter="url(#shadow-label)">{lbl}</text>
                              </g>
                            );
                          })()}

                          {/* ─── Hint: reposicionando ponto ─── */}
                          {replacingIndex !== null && (() => {
                            const txt = t("replacePoint", { label: t(POINT_LABELS[replacingIndex].id) });
                            const textW = txt.length * 7*sd + 16*sd;
                            return (
                              <g>
                                <rect x={6*sd} y={4*sd} width={textW} height={22*sd} rx={4*sd} fill="rgba(180,0,0,0.75)" />
                                <text x={14*sd} y={19*sd} fill="white" fontSize={11*sd} fontWeight="bold"
                                  filter="url(#shadow-label)">
                                  {txt}
                                </text>
                              </g>
                            );
                          })()}

                          {/* ─── HKA resultado visual no joelho ─── */}
                          {markedPoints.length === 3 && hkaFromPoints !== null && (() => {
                            const B = markedPoints[1];
                            const absHka = Math.abs(hkaFromPoints);
                            const sub = hkaFromPoints < 0 ? "VARO" : hkaFromPoints > 0 ? "VALGO" : "NEUTRO";
                            const label = `HKA ${absHka.toFixed(1)}°`;
                            const bgColor = hkaFromPoints < 0 ? "rgba(180,30,30,0.85)" : hkaFromPoints > 0 ? "rgba(30,80,180,0.85)" : "rgba(20,120,60,0.85)";
                            const textW = (label.length + sub.length + 3) * 6.5*sd + 20*sd;
                            const bx = B.x - textW / 2;
                            const by = B.y + 22*sd;
                            return (
                              <g>
                                <rect x={bx} y={by} width={textW} height={20*sd} rx={4*sd} fill={bgColor} />
                                <text x={bx + textW/2} y={by + 13.5*sd}
                                  fill="white" fontSize={11*sd} fontWeight="bold" textAnchor="middle"
                                  filter="url(#shadow-label)">
                                  {label} · {sub}
                                </text>
                              </g>
                            );
                          })()}
                              </>
                            );
                          })()}
                        </svg>
                      )}

                    </div>

                    {/* ── Magnifier loupe — outside zoom wrapper to avoid being scaled ── */}
                    {(markingMode || replacingIndex !== null) && magnifierPos && magnifierScreenPos && imgRef.current && (() => {
                      const imgEl = imgRef.current!;
                      const imgW = imgEl.clientWidth;
                      const imgH = imgEl.clientHeight;
                      const contEl = imgContainerRef.current!;
                      const contW = contEl.clientWidth;
                      const contH = contEl.clientHeight;
                      const PAD = 8;
                      // Position magnifier in container-relative screen coords
                      let left = magnifierScreenPos.x + 28;
                      let top = magnifierScreenPos.y - MAG_SIZE / 2;
                      if (left + MAG_SIZE > contW - PAD) left = magnifierScreenPos.x - MAG_SIZE - 28;
                      // Clamp both axes so the loupe never bleeds outside the container
                      left = Math.max(PAD, Math.min(left, contW - MAG_SIZE - PAD));
                      top = Math.max(PAD, Math.min(top, contH - MAG_SIZE - PAD));
                      // Border color = color of the point being placed
                      const pointColors = ["#1FB6E1", "#F59E0B", "#10B981"];
                      const activeIdx = replacingIndex !== null ? replacingIndex : markedPoints.length;
                      const borderColor = activeIdx < 3 ? pointColors[activeIdx] : "#facc15";
                       const activeLabel = [t("hip"), t("knee"), t("ankle")][activeIdx] ?? "";
                      // magnifierPos is in natural-pixel space; convert to display-pixel space
                      // before computing background-position (backgroundSize uses display px).
                      const natW = naturalImgSize?.w ?? imgW;
                      const displayX = magnifierPos.x * (imgW / natW);
                      const displayY = magnifierPos.y * (imgH / (naturalImgSize?.h ?? imgH));
                      const bgX = -(displayX * MAG_ZOOM - MAG_SIZE / 2);
                      const bgY = -(displayY * MAG_ZOOM - MAG_SIZE / 2);
                      return (
                        <div
                          ref={magnifierElRef}
                          className="absolute pointer-events-none"
                          style={{
                            left,
                            top,
                            width: MAG_SIZE,
                            height: MAG_SIZE,
                            borderRadius: "50%",
                            overflow: "hidden",
                            border: `3px solid ${borderColor}`,
                            boxShadow: "0 4px 24px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.15)",
                            zIndex: 30,
                            backgroundImage: `url(${previewUrl})`,
                            backgroundRepeat: "no-repeat",
                            backgroundSize: `${imgW * MAG_ZOOM}px ${imgH * MAG_ZOOM}px`,
                            backgroundPosition: `${bgX}px ${bgY}px`,
                          }}
                        >
                          <svg width={MAG_SIZE} height={MAG_SIZE} className="absolute inset-0 pointer-events-none" style={{ zIndex: 31 }}>
                            <line x1={MAG_SIZE/2-22} y1={MAG_SIZE/2} x2={MAG_SIZE/2-7} y2={MAG_SIZE/2} stroke="#facc15" strokeWidth="1.8" />
                            <line x1={MAG_SIZE/2+7} y1={MAG_SIZE/2} x2={MAG_SIZE/2+22} y2={MAG_SIZE/2} stroke="#facc15" strokeWidth="1.8" />
                            <line x1={MAG_SIZE/2} y1={MAG_SIZE/2-22} x2={MAG_SIZE/2} y2={MAG_SIZE/2-7} stroke="#facc15" strokeWidth="1.8" />
                            <line x1={MAG_SIZE/2} y1={MAG_SIZE/2+7} x2={MAG_SIZE/2} y2={MAG_SIZE/2+22} stroke="#facc15" strokeWidth="1.8" />
                            <circle cx={MAG_SIZE/2} cy={MAG_SIZE/2} r="3" fill={borderColor} stroke="white" strokeWidth="1" />
                            {activeLabel && (
                              <>
                                <rect x={MAG_SIZE/2 - 34} y={MAG_SIZE - 26} width="68" height="17" rx="4" fill="rgba(0,0,0,0.75)" />
                                <text x={MAG_SIZE/2} y={MAG_SIZE - 13} fill={borderColor} fontSize="11" fontWeight="bold" textAnchor="middle" style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.9))" }}>
                                  {activeLabel}
                                </text>
                              </>
                            )}
                            <text x={MAG_SIZE - 6} y={14} fill="rgba(255,255,255,0.6)" fontSize="9" textAnchor="end">{MAG_ZOOM}×</text>
                          </svg>
                        </div>
                      );
                    })()}

                    {/* Durante a marcação, pinch/pan ficam bloqueados para evitar
                        pontos acidentais. Este botão oferece uma saída explícita
                        quando a imagem já entrou ampliada na sequência. */}
                    {previewUrl && viewportLockedByPointMarking && imageViewportAdjusted && (
                      <button
                        type="button"
                        data-zoom-control
                        onPointerDown={e => e.stopPropagation()}
                        onClick={e => { e.stopPropagation(); resetZoom(); }}
                        aria-label={t("fitImageAria")}
                        title={t("fitImageTitle")}
                        className="absolute top-14 right-2 z-50 h-10 px-3 rounded-full bg-black/85 border border-white/25 shadow-lg text-white flex items-center gap-2 pointer-events-auto select-none hover:bg-black active:scale-95 transition-all"
                        style={{ touchAction: "auto" }}
                      >
                        <span className="text-xs font-semibold">{t("fitImage")}</span>
                        <span className="min-w-7 h-6 px-1.5 rounded-full bg-white/15 flex items-center justify-center text-xs font-bold font-mono">
                          1×
                        </span>
                      </button>
                    )}

                    {/* ── Controles completos de zoom fora da marcação ──────── */}
                    {previewUrl && !viewportLockedByPointMarking && (
                      <div data-zoom-control className="absolute top-2 right-2 flex items-center gap-0.5 z-20 pointer-events-auto select-none rounded-xl overflow-hidden shadow-lg" style={{ background: "rgba(0,0,0,0.82)", border: "1px solid rgba(255,255,255,0.18)" }}>
                        {/* Botão − */}
                        <button
                          type="button"
                          data-zoom-control
                          onPointerDown={e => e.stopPropagation()}
                          onClick={e => { e.stopPropagation(); zoomByFactor(1 / 1.5); }}
                          disabled={imgZoom <= 1}
                          aria-label={t("zoomOut")}
                          className="w-10 h-10 flex items-center justify-center text-white text-xl font-bold hover:bg-white/10 active:bg-white/20 transition-colors disabled:opacity-25 disabled:cursor-default"
                        >
                          −
                        </button>
                        {/* Divider */}
                        <div className="w-px h-6 bg-white/20 shrink-0" />
                        {/* Indicador de nível — toque reseta para 1:1 */}
                        <button
                          type="button"
                          data-zoom-control
                          onPointerDown={e => e.stopPropagation()}
                          onClick={e => { e.stopPropagation(); resetZoom(); }}
                          aria-label={t("resetZoom")}
                          className="min-w-[48px] h-10 px-2 flex items-center justify-center text-white text-xs font-bold font-mono hover:bg-white/10 active:bg-white/20 transition-colors tracking-wide"
                        >
                          {imgZoom <= 1 ? '1×' : `${imgZoom.toFixed(1)}×`}
                        </button>
                        {/* Divider */}
                        <div className="w-px h-6 bg-white/20 shrink-0" />
                        {/* Botão + */}
                        <button
                          type="button"
                          data-zoom-control
                          onPointerDown={e => e.stopPropagation()}
                          onClick={e => { e.stopPropagation(); zoomByFactor(1.5); }}
                          disabled={imgZoom >= 8}
                          aria-label={t("zoomIn")}
                          className="w-10 h-10 flex items-center justify-center text-white text-xl font-bold hover:bg-white/10 active:bg-white/20 transition-colors disabled:opacity-25 disabled:cursor-default"
                        >
                          +
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Legend with per-point edit buttons */}
                  {markedPoints.length > 0 && (
                    <div className="flex gap-2 flex-wrap items-center">
                      {POINT_LABELS.slice(0, markedPoints.length).map((pl, i) => (
                        <div key={i} className="flex items-center gap-1">
                          <span className="flex items-center gap-1 text-xs">
                            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: pl.color }} />
                            {t(pl.id)}
                          </span>
                          {!markingMode && (
                            <button
                              type="button"
                              onClick={() => {
                                const newIdx = replacingIndex === i ? null : i;
                                // Direct ref mutation FIRST so onTouchStart sees the new value
                                // immediately, before React re-renders and useLayoutEffect runs.
                                // Without this, a fast tap after clicking "Refazer" enters PAN
                                // mode instead of marking mode (the original first-tap race condition).
                                touchSnapRef.current.replacingIndex = newIdx;
                                touchSnapRef.current.markingTarget = 'hka';
                                setReplacingIndex(newIdx);
                              }}
                              className={cn(
                                "text-[10px] px-1.5 py-0.5 rounded border transition-colors font-medium ml-1",
                                replacingIndex === i
                                  ? "border-red-400 text-red-700 bg-red-50"
                                  : "border-muted-foreground/30 text-muted-foreground hover:text-amber-700 hover:border-amber-300 hover:bg-amber-50"
                              )}
                            >
                              {replacingIndex === i ? t("cancelMarking") : t("redo")}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : null}

              {/* ── Alerta de conflito entre pontos e deformidade selecionada ── */}
              {hkaFromPoints !== null && selectedDeformidade !== "auto" && (() => {
                const computedVaro = hkaFromPoints < 0;
                const selectedVaro = selectedDeformidade === "varo";
                const conflito = computedVaro !== selectedVaro;
                if (!conflito) return null;
                const computedLabel = hkaFromPoints < 0 ? "VARO" : "VALGO";
                const selectedLabel = selectedDeformidade === "varo" ? "VARO" : "VALGO";
                return (
                  <div className="rounded-xl border-2 border-red-400 bg-red-50 px-4 py-3 space-y-2">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-bold text-red-800">{t("directionConflict")}</p>
                        <p className="text-xs text-red-700 mt-0.5">
                          {t("directionConflictValues", { hka: Math.abs(hkaFromPoints!).toFixed(1), computed: computedLabel, selected: selectedLabel })}
                        </p>
                        <p className="text-xs text-red-600 mt-1">
                          {t("directionConflictHelp", { side: t(selectedLadoOption.labelKey) })}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setSelectedDeformidade(hkaFromPoints < 0 ? "varo" : "valgo")}
                        className="flex-1 rounded-lg border border-red-400 bg-white text-red-700 text-xs font-semibold px-3 py-2 hover:bg-red-100 transition-colors"
                      >
                        {t("correctTo", { direction: computedLabel })}
                      </button>
                      <button
                        type="button"
                        onClick={startMarking}
                        className="flex-1 rounded-lg border border-red-300 bg-white text-red-600 text-xs font-medium px-3 py-2 hover:bg-red-50 transition-colors"
                      >
                        {t("redoPoints")}
                      </button>
                    </div>
                  </div>
                );
              })()}

              {(() => {
                const hkaDone   = markedPoints.length === 3;
                const aldfaDone = aldfaPoints.length === 2;
                const amptaDone = amptaPoints.length === 2;
                const eixoFemoralDone = eixoFemoralPoints.length === 2;
                const eixoTibialDone = eixoTibialPoints.length === 2;
                const eixoDone = eixoFemoralDone && eixoTibialDone;
                const allPointsMarked = hkaDone && aldfaDone && amptaDone && eixoDone;
                const markedCount = markedPoints.length + aldfaPoints.length + amptaPoints.length + eixoFemoralPoints.length + eixoTibialPoints.length;

                return (
                  <>
                    {/* Points progress — shown when not all 11 are marked */}
                    {!allPointsMarked && (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-amber-800">{t("markingRequired")}</span>
                          <span className="text-xs font-bold text-amber-700">{markedCount}/11</span>
                        </div>
                        <div className="w-full h-1.5 bg-amber-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-amber-500 rounded-full transition-all duration-300"
                            style={{ width: `${(markedCount / 11) * 100}%` }}
                          />
                        </div>
                        <div className="grid grid-cols-4 gap-1.5 text-[10px]">
                          <div className={`flex items-center gap-1 px-2 py-1 rounded-md border font-medium ${hkaDone ? "border-green-300 bg-green-50 text-green-700" : "border-amber-300 bg-white text-amber-700"}`}>
                            <span>{hkaDone ? "✓" : `${markedPoints.length}/3`}</span>
                            <span>HKA</span>
                          </div>
                          <div className={`flex items-center gap-1 px-2 py-1 rounded-md border font-medium ${aldfaDone ? "border-green-300 bg-green-50 text-green-700" : "border-amber-300 bg-white text-amber-700"}`}>
                            <span>{aldfaDone ? "✓" : `${aldfaPoints.length}/2`}</span>
                            <span>AmLDF</span>
                          </div>
                          <div className={`flex items-center gap-1 px-2 py-1 rounded-md border font-medium ${amptaDone ? "border-green-300 bg-green-50 text-green-700" : "border-amber-300 bg-white text-amber-700"}`}>
                            <span>{amptaDone ? "✓" : `${amptaPoints.length}/2`}</span>
                            <span>AmMPT</span>
                          </div>
                          <div className={`flex items-center gap-1 px-2 py-1 rounded-md border font-medium ${eixoDone ? "border-green-300 bg-green-50 text-green-700" : "border-amber-300 bg-white text-amber-700"}`}>
                            <span>{eixoDone ? "✓" : `${eixoFemoralPoints.length + eixoTibialPoints.length}/4`}</span>
                            <span>{t("anatomicalAxisShort")}</span>
                          </div>
                        </div>
                        {markedCount === 0 && (
                          <p className="text-[10px] text-amber-700">
                            {t("startMarkingHelp")}
                          </p>
                        )}
                      </div>
                    )}

                    <Button
                      type="button"
                      onClick={() => analyze()}
                      disabled={loading || converting || !allPointsMarked || !selectedFile}
                      className="w-full"
                      size="lg"
                    >
                      {loading ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                           {t("analyzing")}
                        </>
                      ) : converting ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                           {t("heicConverting")}
                        </>
                      ) : !allPointsMarked ? (
                        <>
                          <Upload className="h-4 w-4 mr-2 opacity-50" />
                           {t("markBeforeAnalyze")}
                        </>
                      ) : (
                        <>
                          <Upload className="h-4 w-4 mr-2" />
                          {hkaFromPoints !== null
                             ? t("analyzeConfirmed", { hka: Math.abs(hkaFromPoints).toFixed(1), direction: hkaFromPoints < 0 ? t("varus") : hkaFromPoints > 0 ? t("valgus") : t("neutralStatus") })
                             : t("analyzeType", { type: t(selectedOption.labelKey) })}
                        </>
                      )}
                    </Button>
                  </>
                );
              })()}

              {/* Loading progress panel */}
              {loading && (
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3 animate-in fade-in-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                       <span className="text-sm font-semibold text-primary">{t("aiAnalyzing")}</span>
                    </div>
                    <span className="text-xs font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded">
                      {Math.floor(loadingSeconds / 60).toString().padStart(2, "0")}:{(loadingSeconds % 60).toString().padStart(2, "0")}
                    </span>
                  </div>

                  {/* Animated progress bar */}
                  <div className="w-full h-1.5 bg-primary/15 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-1000"
                      style={{ width: `${Math.min(95, (loadingSeconds / 90) * 100)}%` }}
                    />
                  </div>

                  {/* Rotating status messages */}
                  <p className="text-xs text-muted-foreground">
                     {loadingSeconds < 8  && t("loadingUpload")}
                     {loadingSeconds >= 8  && loadingSeconds < 20 && t("loadingStructures")}
                     {loadingSeconds >= 20 && loadingSeconds < 35 && t("loadingAxes")}
                     {loadingSeconds >= 35 && loadingSeconds < 55 && t("loadingMeasurements")}
                     {loadingSeconds >= 55 && loadingSeconds < 75 && t("loadingPlanning")}
                     {loadingSeconds >= 75 && loadingSeconds < 91 && t("loadingFinishing")}
                     {loadingSeconds >= 91 && t("loadingServerFinishing")}
                  </p>

                  <p className="text-[10px] text-muted-foreground/70">
                     {t("loadingTypical")}
                  </p>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
              <XCircle className="h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}
        </div>
      )}

      {/* RESULTADO */}
      {step === "result" && analysis && (
        <div className="space-y-4 animate-in fade-in-0 duration-300">

          {/* Badges */}
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("text-xs px-3 py-1.5 rounded-full inline-flex items-center gap-1.5 border font-medium",
              analysis.qualidadeImagem === "Boa" ? "text-green-700 bg-green-50 border-green-200" :
              analysis.qualidadeImagem === "Regular" ? "text-amber-700 bg-amber-50 border-amber-200" :
              "text-red-700 bg-red-50 border-red-200"
            )}>
              {t("quality")} <strong>{analysis.qualidadeImagem}</strong>
            </span>
            {analysis.tipoAnalise && (
              <span className="text-xs px-3 py-1.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-semibold">
                {AXIS_OPTIONS.find(o => o.id === analysis.tipoAnalise)?.icon}{" "}
                 {(() => { const option = AXIS_OPTIONS.find(o => o.id === analysis.tipoAnalise); return option ? t(option.labelKey) : analysis.tipoAnalise; })()}
              </span>
            )}
            {analysis.ladoAvaliado && (
              <span className="text-xs px-3 py-1 rounded-full bg-muted border font-medium">
                 {(() => { const option = LADO_OPTIONS.find(o => o.id === analysis.ladoAvaliado); return option ? t(option.labelKey) : analysis.ladoAvaliado; })()}
              </span>
            )}
            {analysis.estrategiaCorrecao && (
              <span className="text-xs px-3 py-1.5 rounded-full bg-amber-50 border border-amber-300 text-amber-800 font-semibold inline-flex items-center gap-1">
                <Target className="h-3 w-3" /> {analysis.estrategiaCorrecao}
              </span>
            )}
            {(analysis as unknown as Record<string, unknown>)._hkaConfirmadoPeloMedico !== undefined && (() => {
              const hkaVal = Number((analysis as unknown as Record<string, unknown>)._hkaConfirmadoPeloMedico);
              const label = hkaVal < 0 ? "VARO" : hkaVal > 0 ? "VALGO" : "Neutro";
              const colorCls = hkaVal < 0
                ? "bg-red-50 border-red-300 text-red-800"
                : hkaVal > 0
                  ? "bg-blue-50 border-blue-300 text-blue-800"
                  : "bg-green-50 border-green-300 text-green-800";
              return (
                <span className={`text-xs px-3 py-1.5 rounded-full border font-semibold inline-flex items-center gap-1.5 ${colorCls}`}>
                  <CheckCircle className="h-3 w-3" />
                   {t("hkaMarkedByDoctor", { hka: Math.abs(hkaVal), direction: label })}
                </span>
              );
            })()}
          </div>

          {/* Banner de inconsistência: AI mediu ângulos contraditórios entre si.
              Mostra alerta forte e CTA para marcação manual em vez de exibir
              recomendação cirúrgica baseada em dados ruins. */}
          {(analysis as unknown as Record<string, unknown>)._inconsistente === true && (
            <div className="rounded-xl border-2 border-red-300 bg-red-50 p-4 space-y-3">
              <div className="flex items-start gap-2.5">
                <div className="rounded-full bg-red-100 p-1.5 mt-0.5">
                  <Target className="h-4 w-4 text-red-700" />
                </div>
                <div className="flex-1 min-w-0">
                   <h4 className="text-sm font-bold text-red-900">{t("inconclusiveTitle")}</h4>
                  <p className="text-xs text-red-800 mt-1.5 leading-relaxed">
                    {String((analysis as unknown as Record<string, unknown>)._motivoInconsistencia ?? "")}
                  </p>
                  <p className="text-[11px] text-red-700/80 mt-2 italic">
                     {t("inconclusiveHelp")}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setStep("upload"); setTimeout(() => startMarking(), 50); }}
                className="w-full flex items-center justify-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors"
              >
                <Target className="h-4 w-4" />
                 {t("markHkaManually")}
              </button>
            </div>
          )}

          {/* Aviso de correção automática de ângulo suplementar (lado errado) */}
          {(analysis as unknown as Record<string, unknown>)._avisoCorrecaoSuplementar !== undefined && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
              <div className="flex items-start gap-2">
                <Target className="h-4 w-4 text-amber-700 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-900 leading-relaxed">
                   <span className="font-semibold">{t("automaticCorrection")}</span>{" "}
                  {String((analysis as unknown as Record<string, unknown>)._avisoCorrecaoSuplementar ?? "")}
                </p>
              </div>
            </div>
          )}

          {/* ⚠️ ALERTA: Deformidade EXTRA-ARTICULAR — ocultado da interface */}
          {false && analysis!.deformidadeExtraArticular?.presente && (() => {
            const ea = analysis!.deformidadeExtraArticular!;
            return (
              <div className="rounded-xl border border-amber-300 bg-amber-50/40 p-4 space-y-3">
                <div className="flex items-center gap-2">
                   <span className="text-[10px] font-bold uppercase tracking-wide text-amber-700 bg-amber-100 border border-amber-300 rounded px-2 py-0.5">{t("extraArticularDeformity")}</span>
                  <span className="text-[11px] text-amber-800 font-medium">{ea.osso}</span>
                </div>

                {/* Ângulos medidos */}
                <div className="grid grid-cols-2 gap-2">
                  <div className={cn(
                    "rounded-lg border p-2.5",
                    ea.femoralBowing ? "border-red-300 bg-red-100/60" : "border-emerald-200 bg-emerald-50",
                  )}>
                    <div className="flex items-center gap-1.5 mb-1">
                      {ea.femoralBowing
                        ? <XCircle className="h-3.5 w-3.5 text-red-600" />
                        : <CheckCircle className="h-3.5 w-3.5 text-emerald-600" />}
                      <span className={cn("text-[10px] font-semibold uppercase", ea.femoralBowing ? "text-red-700" : "text-emerald-700")}>
                        AMA Femoral
                      </span>
                    </div>
                    <p className={cn("text-base font-bold leading-tight", ea.femoralBowing ? "text-red-900" : "text-emerald-900")}>
                      {ea.amaFemoral.toFixed(1)}°
                    </p>
                     <p className="text-[10px] opacity-70 mt-0.5">{t("referenceAma")}</p>
                  </div>
                  <div className={cn(
                    "rounded-lg border p-2.5",
                    ea.tibialBowing ? "border-red-300 bg-red-100/60" : "border-emerald-200 bg-emerald-50",
                  )}>
                    <div className="flex items-center gap-1.5 mb-1">
                      {ea.tibialBowing
                        ? <XCircle className="h-3.5 w-3.5 text-red-600" />
                        : <CheckCircle className="h-3.5 w-3.5 text-emerald-600" />}
                      <span className={cn("text-[10px] font-semibold uppercase", ea.tibialBowing ? "text-red-700" : "text-emerald-700")}>
                        Divergência Tibial
                      </span>
                    </div>
                    <p className={cn("text-base font-bold leading-tight", ea.tibialBowing ? "text-red-900" : "text-emerald-900")}>
                      {ea.divergenciaTibial.toFixed(1)}°
                    </p>
                    <p className="text-[10px] opacity-70 mt-0.5">Ref: &lt; 3°</p>
                  </div>
                </div>

                {/* Card CORA — ângulo de correção no ápice da deformidade */}
                {(ea.anguloCoraFemoral != null || ea.anguloCoraTibial != null || computedCoraFemoral !== null || computedCoraTibial !== null) && (
                  <div className="rounded-lg border-2 border-amber-400 bg-amber-50 p-3 space-y-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-base">📐</span>
                       <span className="text-xs font-bold text-amber-900 uppercase tracking-wide">{t("coraCorrectionAngle")}</span>
                    </div>
                    <p className="text-[11px] text-amber-800 leading-snug">
                       {t("coraCorrectionHelp")}
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {ea.anguloCoraFemoral != null && (
                        <div className="rounded-md bg-white border border-amber-300 p-2.5 text-center relative">
                           <p className="text-[10px] font-semibold text-amber-700 uppercase mb-0.5">{t("femurCora")}</p>
                          {computedCoraFemoral ? (
                            <>
                              <div className="inline-flex items-center gap-1 mb-0.5 bg-purple-100 rounded px-1.5 py-0.5">
                                 <span className="text-[9px] font-bold text-purple-700 uppercase">{t("measuredOnXray")}</span>
                              </div>
                              <p className="text-2xl font-extrabold text-purple-900">{computedCoraFemoral!.angle.toFixed(1)}°</p>
                               <p className="text-[10px] text-amber-500 line-through mt-0.5">{t("estimatedValue", { value: `${(ea.anguloCoraFemoral as number).toFixed(1)}°` })}</p>
                            </>
                          ) : (
                            <>
                              <p className="text-2xl font-extrabold text-amber-900">{(ea.anguloCoraFemoral as number).toFixed(1)}°</p>
                               <p className="text-[10px] text-amber-500 mt-0.5">{t("estimatedViaHka")}</p>
                            </>
                          )}
                           <p className="text-[10px] text-amber-600 mt-0.5">{t("femoralDiaphysisOsteotomy")}</p>
                        </div>
                      )}
                      {ea.anguloCoraTibial != null && (
                        <div className="rounded-md bg-white border border-amber-300 p-2.5 text-center">
                           <p className="text-[10px] font-semibold text-amber-700 uppercase mb-0.5">{t("tibiaCora")}</p>
                          {computedCoraTibial ? (
                            <>
                              <div className="inline-flex items-center gap-1 mb-0.5 bg-purple-100 rounded px-1.5 py-0.5">
                                 <span className="text-[9px] font-bold text-purple-700 uppercase">{t("measuredOnXray")}</span>
                              </div>
                              <p className="text-2xl font-extrabold text-purple-900">{computedCoraTibial!.angle.toFixed(1)}°</p>
                               <p className="text-[10px] text-amber-500 line-through mt-0.5">{t("estimatedValue", { value: `${(ea.anguloCoraTibial as number).toFixed(1)}°` })}</p>
                            </>
                          ) : (
                            <>
                              <p className="text-2xl font-extrabold text-amber-900">{(ea.anguloCoraTibial as number).toFixed(1)}°</p>
                               <p className="text-[10px] text-amber-500 mt-0.5">{t("estimatedViaHka")}</p>
                            </>
                          )}
                           <p className="text-[10px] text-amber-600 mt-0.5">{t("tibialDiaphysisOsteotomy")}</p>
                        </div>
                      )}
                    </div>
                    <p className="text-[10px] text-amber-700 italic">
                       {t("coraMeasurementTip")}
                    </p>
                  </div>
                )}

                {/* Botões de refinamento do eixo anatômico + localizar CORA */}
                <div className="pt-1 flex flex-wrap gap-2">
                  {ea.femoralBowing && (
                    <button
                      type="button"
                      onClick={() => startAxisRefinement('femoral')}
                      className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border-2 border-blue-400 bg-blue-50 text-blue-800 hover:bg-blue-100 transition-colors"
                    >
                      <Target className="h-3.5 w-3.5" />
                       {t("refineFemoralAxis")}
                    </button>
                  )}
                  {ea.tibialBowing && (
                    <button
                      type="button"
                      onClick={() => startAxisRefinement('tibial')}
                      className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border-2 border-blue-400 bg-blue-50 text-blue-800 hover:bg-blue-100 transition-colors"
                    >
                      <Target className="h-3.5 w-3.5" />
                       {t("refineTibialAxis")}
                    </button>
                  )}
                  {ea.femoralBowing && (
                    <button
                      type="button"
                      onClick={() => startCoraMarking('femoral')}
                      className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border-2 border-purple-400 bg-purple-50 text-purple-800 hover:bg-purple-100 transition-colors"
                    >
                      <span className="text-sm leading-none">📐</span>
                       {computedCoraFemoral ? t("remarkFemoralCoraXray") : t("locateFemoralCoraXray")}
                    </button>
                  )}
                  {ea.tibialBowing && (
                    <button
                      type="button"
                      onClick={() => startCoraMarking('tibial')}
                      className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border-2 border-purple-400 bg-purple-50 text-purple-800 hover:bg-purple-100 transition-colors"
                    >
                      <span className="text-sm leading-none">📐</span>
                       {computedCoraTibial ? t("remarkTibialCoraXray") : t("locateTibialCoraXray")}
                    </button>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Raciocínio Visual da IA */}
          {analysis.raciocinioVisual && (
            <div className="rounded-lg border border-blue-100 bg-blue-50/50 overflow-hidden">
              <button
                type="button"
                onClick={() => setShowRaciocinio(v => !v)}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-100/50 transition-colors"
              >
                <Eye className="h-3.5 w-3.5" />
                {t("visualReasoning")}
                <span className="ml-auto text-blue-400">{showRaciocinio ? t("hide") : t("view")}</span>
              </button>
              {showRaciocinio && (
                <div className="px-3 pb-3 text-xs text-blue-800 leading-relaxed border-t border-blue-100 pt-2">
                  {analysis.raciocinioVisual?.replace(/-(\d)/g, "$1")}
                </div>
              )}
            </div>
          )}

          {/* Grid de métricas */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {analysis.eixoMecanico && (() => {
              const hkaDeg = Math.abs(Number(analysis.eixoMecanico!.graus));
              const hkaDir = analysis.eixoMecanico!.desvio === "Varo"
                ? "varo" : analysis.eixoMecanico!.desvio === "Valgo"
                ? "valgo" : hkaDeg <= 3 ? "normal" : "varo";
              return (
                <div className={cn("rounded-xl border p-3 space-y-1", deformityColor(hkaDir))}>
                  <div className="flex items-center gap-1.5">
                    {deformityIcon(hkaDir)}
                    <span className="text-xs font-semibold">{t("mechanicalAxis")}</span>
                  </div>
                  <p className="text-lg font-bold leading-tight">{hkaDeg}° {analysis.eixoMecanico!.desvio}</p>
                   <p className="text-xs opacity-70">{t("referenceHka")}</p>
                </div>
              );
            })()}
            {analysis.eixoAnatomico && (() => {
              const eaDeg = Number(analysis.eixoAnatomico!.graus);
              const eaDir: "varo" | "valgo" | "normal" = eaDeg < 4
                ? "varo" : eaDeg > 8 ? "valgo" : "normal";
              return (
                <div className={cn("rounded-xl border p-3 space-y-1", deformityColor(eaDir))}>
                  <div className="flex items-center gap-1.5">
                    {deformityIcon(eaDir)}
                    <span className="text-xs font-semibold">{t("anatomicalAxis")}</span>
                  </div>
                  <p className="text-lg font-bold leading-tight">{Math.abs(eaDeg)}° {analysis.eixoAnatomico!.desvio}</p>
                   <p className="text-xs opacity-70">{t("referenceAnatomical")}</p>
                </div>
              );
            })()}
            {/* AMA Femoral e Divergência Tibial removidos da interface (deformidade extra-articular ocultada) */}
            {false && analysis!.deformidadeExtraArticular && typeof (analysis!.deformidadeExtraArticular as any).amaFemoral === "number" && (analysis!.deformidadeExtraArticular as any).amaFemoral > 0 && (() => {
              const ama = analysis!.deformidadeExtraArticular!.amaFemoral as number;
              const sev = classifyAmaFemoral(ama);
              // AMA > 9° = bowing VALGO (diáfise mais lateral que normal)
              // AMA < 5° = bowing VARO (diáfise menos lateral / medializada)
              const dirCard: "varo" | "valgo" | "normal" =
                sev === "bowing" && ama < 5 ? "varo"    // bowing varo → vermelho
                : sev === "bowing" && ama > 9 ? "valgo" // bowing valgo → amarelo-forte
                : sev === "borderline" ? "valgo"        // borderline → amarelo
                : "normal";                             // normal → verde

              let statusMsg: string;
              let badgeLabel: string;
              let badgeCls: string;
              if (sev === "bowing" && ama < 5) {
                statusMsg = t("femoralBowingVarus");
                badgeLabel = "bowing varo";
                badgeCls = "bg-red-100 text-red-700";
              } else if (sev === "bowing" && ama > 9) {
                statusMsg = t("femoralBowingValgus");
                badgeLabel = "bowing valgo";
                badgeCls = "bg-red-100 text-red-700";
              } else if (sev === "borderline" && ama > 8.5) {
                statusMsg = t("borderlineValgusIncreased");
                badgeLabel = "↑ valgo borderline";
                badgeCls = "bg-amber-100 text-amber-700";
              } else if (sev === "borderline" && ama < 5.5) {
                statusMsg = t("borderlineValgusReduced");
                badgeLabel = "↓ valgo borderline";
                badgeCls = "bg-amber-100 text-amber-700";
              } else {
                // normal: AMA é um desvio valgo fisiológico
                statusMsg = t("physiologicalValgusStatus");
                badgeLabel = "valgo normal";
                badgeCls = "bg-emerald-100 text-emerald-700";
              }

              return (
                <div className={cn("rounded-xl border p-3 space-y-1.5", deformityColor(dirCard))}>
                  <div className="flex items-center gap-1.5">
                    {deformityIcon(dirCard)}
                    <span className="text-xs font-semibold">{t("amaFemoral")}</span>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <p className="text-lg font-bold leading-tight">{ama.toFixed(1)}°</p>
                    <span className={cn("text-xs font-semibold px-1.5 py-0.5 rounded", badgeCls)}>
                      {badgeLabel}
                    </span>
                  </div>
                  <p className="text-xs opacity-80">{statusMsg}</p>
                  {(sev === "bowing" || sev === "borderline") && (
                    <button
                      type="button"
                      onClick={() => startAxisRefinement('femoral')}
                      className="mt-1 flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-blue-400 bg-white/70 text-blue-800 hover:bg-blue-50 transition-colors"
                    >
                      <Target className="h-3 w-3" />
                      {t("refineFemoralAxis")}
                    </button>
                  )}
                  {/* Escape hatch: CORA manual mesmo com AMA normal */}
                  <button
                    type="button"
                    onClick={() => startCoraMarking('femoral')}
                    className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-md border border-purple-300 bg-white/60 text-purple-700 hover:bg-purple-50 transition-colors"
                    title={t("manualFemoralCoraTitle")}
                  >
                    <span className="leading-none">📐</span>
                    {computedCoraFemoral ? t("remarkFemoralCora") : t("locateFemoralCoraXray")}
                  </button>
                </div>
              );
            })()}
            {false && analysis!.deformidadeExtraArticular && typeof (analysis!.deformidadeExtraArticular as any).divergenciaTibial === "number" && (analysis!.deformidadeExtraArticular as any).divergenciaTibial != null && (() => {
              const div = Math.abs(analysis!.deformidadeExtraArticular!.divergenciaTibial);
              const sev = classifyDivTibial(div);
              const dir: "varo" | "valgo" | "normal" = sev === "bowing" ? "varo" : sev === "borderline" ? "valgo" : "normal";
              return (
                <div className={cn("rounded-xl border p-3 space-y-1.5", deformityColor(dir))}>
                  <div className="flex items-center gap-1.5">
                    {deformityIcon(dir)}
                    <span className="text-xs font-semibold">{t("tibialDivergence")}</span>
                  </div>
                  <p className="text-lg font-bold leading-tight">{div.toFixed(1)}°</p>
                  <p className="text-xs opacity-70">
                    {sev === "bowing" ? t("tibialBowing") : sev === "borderline" ? t("borderlineReview") : t("referenceTibialDivergence")}
                  </p>
                  {(sev === "bowing" || sev === "borderline") && (
                    <button
                      type="button"
                      onClick={() => startAxisRefinement('tibial')}
                      className="mt-0.5 flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-blue-400 bg-white/70 text-blue-800 hover:bg-blue-50 transition-colors"
                    >
                      <Target className="h-3 w-3" />
                      {t("refineTibialAxis")}
                    </button>
                  )}
                  {/* Escape hatch: CORA manual mesmo com divergência normal.
                      Bowing diafisário médio cancela na linha reta prox→dist
                      → divergência ≈ 0° mesmo com bowing visível na Rx. */}
                  <button
                    type="button"
                    onClick={() => startCoraMarking('tibial')}
                    className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-md border border-purple-300 bg-white/60 text-purple-700 hover:bg-purple-50 transition-colors"
                    title={t("manualTibialCoraTitle")}
                  >
                    <span className="leading-none">📐</span>
                    {computedCoraTibial ? t("remarkTibialCora") : t("locateTibialCoraXray")}
                  </button>
                </div>
              );
            })()}
            {analysis.mLDFA && (() => {
              // mLDFA: normal 84–90°. >90° = componente varo femoral (red). <84° = componente valgo femoral (yellow)
              const v = analysis.mLDFA!.valor;
              const dir: "varo" | "valgo" | "normal" = v > 90 ? "varo" : v < 84 ? "valgo" : "normal";
              const isEditing = editingAngle === "mLDFA";
              return (
                <div className={cn("rounded-xl border p-3 space-y-1", deformityColor(dir))}>
                  <div className="flex items-center justify-between gap-1.5">
                     <div className="flex items-center gap-1.5">{deformityIcon(dir)}<span className="text-xs font-semibold">{t("aldfaFemur")}</span></div>
                    {!isEditing && (
                      <button type="button" onClick={() => openEdit("mLDFA", v)} title={t("manualCorrection")} className="p-0.5 rounded hover:bg-black/10 transition-colors">
                        <Pencil className="h-3 w-3 opacity-40" />
                      </button>
                    )}
                  </div>
                  {isEditing ? (
                    <div className="flex items-center gap-1 py-0.5">
                      <input type="number" step="0.5" min="60" max="110" value={editValue} onChange={e => setEditValue(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") confirmEdit("mLDFA"); if (e.key === "Escape") cancelEdit(); }}
                        autoFocus className="w-16 text-sm font-bold rounded border border-primary/60 px-1.5 py-0.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
                      <span className="text-sm font-bold">°</span>
                      <button type="button" onClick={() => confirmEdit("mLDFA")} className="text-xs px-2 py-0.5 rounded bg-primary text-primary-foreground font-medium">✓</button>
                      <button type="button" onClick={cancelEdit} className="text-xs px-2 py-0.5 rounded border border-muted-foreground/30 text-muted-foreground">✕</button>
                    </div>
                  ) : (
                    <p className="text-lg font-bold leading-tight">{v}°</p>
                  )}
                   <p className="text-xs opacity-70">{t("referenceValue", { value: analysis.mLDFA!.referencia })}</p>
                </div>
              );
            })()}
            {analysis.aMPTA && (() => {
              // aMPTA: normal 84–90°. <84° = varo tibial (red). >90° = valgo tibial (yellow)
              const v = analysis.aMPTA!.valor;
              const dir: "varo" | "valgo" | "normal" = v < 84 ? "varo" : v > 90 ? "valgo" : "normal";
              const isEditing = editingAngle === "aMPTA";
              return (
                <div className={cn("rounded-xl border p-3 space-y-1", deformityColor(dir))}>
                  <div className="flex items-center justify-between gap-1.5">
                     <div className="flex items-center gap-1.5">{deformityIcon(dir)}<span className="text-xs font-semibold">{t("amptaTibia")}</span></div>
                    {!isEditing && (
                      <button type="button" onClick={() => openEdit("aMPTA", v)} title={t("manualCorrection")} className="p-0.5 rounded hover:bg-black/10 transition-colors">
                        <Pencil className="h-3 w-3 opacity-40" />
                      </button>
                    )}
                  </div>
                  {isEditing ? (
                    <div className="flex items-center gap-1 py-0.5">
                      <input type="number" step="0.5" min="60" max="110" value={editValue} onChange={e => setEditValue(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") confirmEdit("aMPTA"); if (e.key === "Escape") cancelEdit(); }}
                        autoFocus className="w-16 text-sm font-bold rounded border border-primary/60 px-1.5 py-0.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
                      <span className="text-sm font-bold">°</span>
                      <button type="button" onClick={() => confirmEdit("aMPTA")} className="text-xs px-2 py-0.5 rounded bg-primary text-primary-foreground font-medium">✓</button>
                      <button type="button" onClick={cancelEdit} className="text-xs px-2 py-0.5 rounded border border-muted-foreground/30 text-muted-foreground">✕</button>
                    </div>
                  ) : (
                    <p className="text-lg font-bold leading-tight">{v}°</p>
                  )}
                   <p className="text-xs opacity-70">{t("referenceValue", { value: analysis.aMPTA!.referencia })}</p>
                </div>
              );
            })()}
            {analysis.JLCA && (() => {
              // JLCA: normal 0–2°. Elevado = componente articular (amarelo — geralmente visto em valgo)
              const v = analysis.JLCA!.valor;
              const dir: "varo" | "valgo" | "normal" = v <= 2 ? "normal" : "valgo";
              const isEditing = editingAngle === "JLCA";
              return (
                <div className={cn("rounded-xl border p-3 space-y-1", deformityColor(dir))}>
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5">{deformityIcon(dir)}<span className="text-xs font-semibold">JLCA</span></div>
                    {!isEditing && (
                      <button type="button" onClick={() => openEdit("JLCA", v)} title={t("manualCorrection")} className="p-0.5 rounded hover:bg-black/10 transition-colors">
                        <Pencil className="h-3 w-3 opacity-40" />
                      </button>
                    )}
                  </div>
                  {isEditing ? (
                    <div className="flex items-center gap-1 py-0.5">
                      <input type="number" step="0.5" min="0" max="20" value={editValue} onChange={e => setEditValue(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") confirmEdit("JLCA"); if (e.key === "Escape") cancelEdit(); }}
                        autoFocus className="w-16 text-sm font-bold rounded border border-primary/60 px-1.5 py-0.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
                      <span className="text-sm font-bold">°</span>
                      <button type="button" onClick={() => confirmEdit("JLCA")} className="text-xs px-2 py-0.5 rounded bg-primary text-primary-foreground font-medium">✓</button>
                      <button type="button" onClick={cancelEdit} className="text-xs px-2 py-0.5 rounded border border-muted-foreground/30 text-muted-foreground">✕</button>
                    </div>
                  ) : (
                    <p className="text-lg font-bold leading-tight">{v}°</p>
                  )}
                   <p className="text-xs opacity-70">{t("referenceValue", { value: analysis.JLCA!.referencia })}</p>
                </div>
              );
            })()}
            {analysis.MAD && (() => {
              // MAD: Medial = varo (red). Lateral = valgo (yellow). ≤10 mm = normal (green)
              const isLateral = analysis.MAD!.lado?.toLowerCase().includes("lat");
              const madMm = Math.abs(Number(analysis.MAD!.valor));
              const dir: "varo" | "valgo" | "normal" = madMm <= 10 ? "normal" : isLateral ? "valgo" : "varo";
              return (
                <div className={cn("rounded-xl border p-3 space-y-1", deformityColor(dir))}>
                  <div className="flex items-center gap-1.5">
                    {deformityIcon(dir)}
                    <span className="text-xs font-semibold">MAD</span>
                    <span className="text-[10px] opacity-60 font-normal ml-0.5">{t("mechanicalAxisDeviation")}</span>
                  </div>
                  <p className="text-lg font-bold leading-tight">{analysis.MAD!.valor} {analysis.MAD!.unidade}</p>
                  <p className="text-xs font-semibold opacity-80">
                    {isLateral ? t("lateralValgus") : t("medialVarus")}
                  </p>
                  <p className="text-xs opacity-60">{t("centralAxisNormal")}</p>
                  <p className="text-[10px] opacity-50 leading-tight pt-0.5">
                    {t("madDescription")}
                  </p>
                </div>
              );
            })()}
            {analysis.percentualWBL && (analysis.percentualWBL.valor !== undefined || analysis.percentualWBL.preCorrecao !== undefined) && (() => {
              const wblVal = analysis.percentualWBL!.valor ?? analysis.percentualWBL!.preCorrecao!;
              const isVaro = wblVal < 47;
              const isValgo = wblVal > 55;
              // %WBL: <47% = varo (red), >55% = valgo (yellow), 47–55% = normal (green)
              const wblDeformDir: "varo" | "valgo" | "normal" = isVaro ? "varo" : isValgo ? "valgo" : "normal";
              const wblColor = deformityColor(wblDeformDir);
               const wblDirLabel = isVaro ? t("wblMedialVarus") : isValgo ? t("wblLateralValgus") : t("wblCentral");
              return (
                <div className={cn("rounded-xl border p-3 space-y-1", wblColor)}>
                  <div className="flex items-center gap-1.5">
                    {deformityIcon(wblDeformDir)}
                    <span className="text-xs font-semibold">%WBL</span>
                  </div>
                  <p className="text-lg font-bold leading-tight">{wblVal}% <span className="text-xs font-normal opacity-75">{wblDirLabel}</span></p>
                  <p className="text-xs opacity-70">{t("wblScale")}</p>
                </div>
              );
            })()}
            {/* AmTF — Ângulo medial tíbio-femoral: 180° − HKA_signed */}
            {analysis.eixoMecanico && (() => {
              const hkaDeg = Math.abs(Number(analysis.eixoMecanico!.graus));
              const hkaDesvio = analysis.eixoMecanico!.desvio;
              const amtfVal = hkaDesvio === "Varo"
                ? +(180 + hkaDeg).toFixed(1)
                : hkaDesvio === "Valgo"
                  ? +(180 - hkaDeg).toFixed(1)
                  : 180;
              const amtfDir: "varo" | "valgo" | "normal" =
                amtfVal > 183 ? "varo" : amtfVal < 177 ? "valgo" : "normal";
              return (
                <div className={cn("rounded-xl border p-3 space-y-1", deformityColor(amtfDir))}>
                  <div className="flex items-center gap-1.5">
                    {deformityIcon(amtfDir)}
                    <span className="text-xs font-semibold">AmTF</span>
                     <span className="text-[10px] opacity-60 font-normal ml-0.5">{t("medialTibiofemoral")}</span>
                  </div>
                  <p className="text-lg font-bold leading-tight">{amtfVal}°</p>
                   <p className="text-xs opacity-70">{t("referenceAmtf")}</p>
                </div>
              );
            })()}
          </div>

          {/* Botão recalcular — visível quando qualquer ângulo foi editado manualmente */}
          {anglesEdited && (
            <div className="rounded-xl border-2 border-primary/30 bg-primary/5 px-4 py-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-primary">{t("manualAngles")}</p>
                <p className="text-xs text-muted-foreground">{t("recalculateHelp")}</p>
              </div>
              <Button size="sm" onClick={recalculatePlanning} disabled={recalculating} className="shrink-0">
                {recalculating ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
                {t("recalculate")}
              </Button>
            </div>
          )}

          {/* Campos adicionais */}
          <div className="flex flex-wrap gap-2">
            {analysis.origemDesvio && analysis.origemDesvio !== "Não aplicável" && (
              <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                <span className="font-medium text-muted-foreground text-xs">{t("deviationOrigin")} </span>
                <span className="font-semibold">{analysis.origemDesvio}</span>
              </div>
            )}
            {analysis.grauVaro && analysis.grauVaro !== "Não aplicável" && (
              <div className="rounded-lg border bg-amber-50 border-amber-200 px-3 py-2 text-sm">
                <span className="font-medium text-amber-700 text-xs">{t("classification")} </span>
                <span className="font-bold text-amber-800">{analysis.grauVaro}</span>
              </div>
            )}
            {analysis.alvoMecanico && (
              <div className="rounded-lg border bg-emerald-50 border-emerald-200 px-3 py-2 text-sm flex items-center gap-1.5">
                <Target className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                <span className="font-medium text-emerald-700 text-xs">{t("target")} </span>
                <span className="font-bold text-emerald-800">{analysis.alvoMecanico}</span>
              </div>
            )}
          </div>

          {/* Ângulo de correção — principal */}
          {analysis.anguloCorrecao !== undefined && analysis.anguloCorrecao > 0 && (
            <div className="rounded-xl border-2 border-blue-200 bg-blue-50 p-4 space-y-2">
              {analysis.percentualWBL?.preCorrecao !== undefined && analysis.percentualWBL?.posCorrecao !== undefined && (
                <div className="flex items-center gap-3 pt-1 border-t border-blue-200">
                  <div className="text-center">
                     <p className="text-xs text-blue-500">{t("wblPre")}</p>
                    <p className="text-lg font-black text-blue-800">{analysis.percentualWBL.preCorrecao}%</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-blue-400" />
                  <div className="text-center">
                     <p className="text-xs text-blue-500">{t("wblPost")}</p>
                    <p className="text-lg font-black text-emerald-700">{analysis.percentualWBL.posCorrecao}%</p>
                  </div>
                  {analysis.percentualWBL.alvo && (
                    <div className="ml-auto text-right">
                       <p className="text-xs text-blue-500">{t("targetPlain")}</p>
                      <p className="text-xs font-bold text-blue-700">{analysis.percentualWBL.alvo}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Wedge em mm */}
          {(analysis.wedgeTibial || analysis.wedgeFemoral) && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("estimatedOpening")}</p>
              <div className="grid grid-cols-2 gap-3">
                {analysis.wedgeTibial && (
                  <div className="rounded-xl border-2 border-blue-300 bg-blue-50 p-3 space-y-1.5">
                     <p className="text-xs font-bold text-blue-700">{t("tibialHto")}</p>
                    <p className="text-2xl font-black text-blue-900">{analysis.wedgeTibial.calculado_mm} mm</p>
                    <p className="text-xs text-blue-600">{t("trigonometric", { distance: 120 })}</p>
                    <p className="text-xs text-blue-500">{t("ruleOfThumb", { value: analysis.wedgeTibial.aproximado_mm })}</p>
                  </div>
                )}
                {analysis.wedgeFemoral && (
                  <div className="rounded-xl border-2 border-orange-300 bg-orange-50 p-3 space-y-1.5">
                     <p className="text-xs font-bold text-orange-700">{t("femoralDfo")}</p>
                    <p className="text-2xl font-black text-orange-900">{analysis.wedgeFemoral.calculado_mm} mm</p>
                    <p className="text-xs text-orange-600">{t("trigonometric", { distance: 90 })}</p>
                    <p className="text-xs text-orange-500">{t("ruleOfThumb", { value: analysis.wedgeFemoral.aproximado_mm })}</p>
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground italic">
                {t("wedgeEstimateNote")}
              </p>
            </div>
          )}

          {/* Osteotomia: sem indicação — somente justificativa clínica neutra */}
          {analysis.indicacaoOsteotomia === false && (
            <div className="rounded-xl border-2 bg-green-50 border-green-300 p-4 space-y-2">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-600" />
                <span className="font-bold text-base text-green-800">{t("osteotomyNotIndicated")}</span>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">{analysis.justificativa}</p>
            </div>
          )}
          {analysis.indicacaoOsteotomia === true && analysis.justificativa && !analysis.opcoesOsteotomia?.length && (
            <div className="rounded-xl border bg-muted/40 p-4">
              <p className="text-sm leading-relaxed">{analysis.justificativa}</p>
            </div>
          )}

          {/* ── Opção Selecionada: cunha P4 (Prompt 2) ───────────────────────────── */}
          {nivelDecisaoResult && analysis.indicacaoOsteotomia === true && (
            <div className="space-y-3">

              {/* ── Opção selecionada: cunha P4 com fonte única de ângulo ── */}
              {opcaoSelecionada && !opcaoSelecionada.locked && (
                <div className="rounded-lg bg-white border border-indigo-200 p-3 space-y-2">
                  <div>
                    <p className="text-xs font-bold text-indigo-800">
                      📐 {opcaoSelecionada.label}
                      <span className="ml-1.5 font-normal text-indigo-500">
                         — {dfoMiniaciResult?.method === 'miniaci-geometrico' ? t("miniaciGeometric") : t("paleyDecomposition")}
                      </span>
                    </p>
                    <p className="text-xs text-indigo-600 mt-0.5 leading-relaxed">{opcaoSelecionada.nota}</p>
                  </div>

                  {/* Cunha por osso — fonte única: cunhaPorNivel (P4) */}
                  {cunhaPorNivel && cunhaPorNivel.length > 0 ? (
                    <div ref={cunhaPanelRef} className="space-y-2 pt-1 border-t border-indigo-100">
                      {cunhaPorNivel.map(item => {
                        const isFem = item.osso === 'femur';
                        const col = isFem ? 'text-orange-700' : 'text-blue-700';
                        const borderCol = isFem ? 'border-orange-200 bg-orange-50/40' : 'border-blue-200 bg-blue-50/40';
                        const formatted = fmtCunha(item.cunha);
                        // When Etapa 4 points are marked → ABSOLUTO mode: show physical cut angle
                        // arctan(abertura/base) = real wedge angle at the cut site (updates automatically)
                        const angLabel = (() => {
                          if (item.cunha.modo === 'ABSOLUTO') {
                            const c = item.cunha as import('@/lib/cunha').CunhaAbsoluto;
                            // fator = abertura / base_mm  →  atan(fator) = physical wedge angle
                            const physDeg = Math.atan(c.fator) * 180 / Math.PI;
                            return `${physDeg.toFixed(1)}°`;
                          }
                          return fmtAngulo(item.anguloCorrigido);
                        })();
                        return (
                          <div key={item.osso} className={`rounded border p-2 space-y-0.5 ${borderCol}`}>
                            <div className="flex items-center justify-between flex-wrap gap-1">
                              <span className={`text-xs font-bold ${col}`}>
                                 {isFem ? t("dfoFemur") : t("htoTibia")}
                              </span>
                              <span className={`text-xs font-mono font-black ${col}`}>{angLabel}</span>
                            </div>
                            <div className="flex items-baseline gap-2 flex-wrap">
                              <span className={`text-sm font-black ${col}`}>{formatted.texto}</span>
                              <span className="text-[10px] text-gray-500 bg-white/70 rounded px-1 py-0.5">{formatted.badge}</span>
                            </div>
                            {item.cunha.modo === 'ABSOLUTO' && (item.cunha as import('@/lib/cunha').CunhaAbsoluto).alerta && (
                              <p className="text-[10px] text-amber-700 leading-snug">
                                ⚠ {(item.cunha as import('@/lib/cunha').CunhaAbsoluto).alerta}
                              </p>
                            )}
                          </div>
                        );
                      })}
                      {opcaoSelecionada.residualHKA !== undefined && opcaoSelecionada.residualHKA > 0 && (
                         <p className="text-xs text-amber-700 font-semibold">{t("hkaResidual", { value: opcaoSelecionada.residualHKA })}</p>
                      )}
                    </div>
                  ) : (
                    /* fallback: base ainda não marcada → botões diretos para iniciar marcação */
                    <div className="flex flex-col gap-2 pt-2 border-t border-indigo-100">
                      <p className="text-[11px] text-indigo-700 font-semibold">
                         {t("markWidthIntro")}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {opcaoSelecionada.corrFem !== 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              const phase = { bone: 'femur' as const, phase: 'entrada' as const };
                              setBaseMarkingActive(phase);
                              baseMarkingActiveRef.current = phase;
                              touchSnapRef.current.baseMarkingActive = phase;
                              setMarkingMode(true);
                              touchSnapRef.current.markingMode = true;
                              setStep('upload');
                            }}
                            className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 active:scale-95 transition-all shadow-sm"
                          >
                             <Ruler className="h-3 w-3" /> {t("markFemurWidth")}
                          </button>
                        )}
                        {opcaoSelecionada.corrTib !== 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              const phase = { bone: 'tibia' as const, phase: 'entrada' as const };
                              setBaseMarkingActive(phase);
                              baseMarkingActiveRef.current = phase;
                              touchSnapRef.current.baseMarkingActive = phase;
                              setMarkingMode(true);
                              touchSnapRef.current.markingMode = true;
                              setStep('upload');
                            }}
                            className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 active:scale-95 transition-all shadow-sm"
                          >
                             <Ruler className="h-3 w-3" /> {t("markTibiaWidth")}
                          </button>
                        )}
                      </div>
                      <p className="text-[10px] text-gray-400 leading-snug">
                         {t("markWidthHelp")}
                      </p>
                    </div>
                  )}

                  <p className="text-[10px] text-indigo-400 leading-snug">
                     {t("jloThresholds")}
                     {nivelDecisaoResult && t("jlcaAdjustmentApplied", { value: nivelDecisaoResult.ajusteJLCA })}
                  </p>
                </div>
              )}

              {/* Aviso: opção travada selecionada por override consciente */}
              {opcaoSelecionada?.locked && nivelDecisaoOverride && (
                <div className="rounded-lg bg-red-100 border border-red-400 px-3 py-2 text-xs text-red-900 space-y-1">
                   <p className="font-bold">{t("blockedOption")}</p>
                  {(() => {
                    const jloVal = opcaoSelecionada.jlo;
                    if (jloVal > 4) return (
                       <p>{t("blockedJlo", { value: jloVal })}</p>
                    );
                     return <p>{t("blockedGeneric")}</p>;
                  })()}
                </div>
              )}

            </div>
          )}

          {/* Planejamento por nível */}
          {(analysis.planoFemoral || analysis.planoTibial) && (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("planningByLevel")}</p>

              {/* Contribuições */}
              {(analysis.contribuicaoFemoral !== undefined || analysis.contribuicaoTibial !== undefined || analysis.contribuicaoArticular !== undefined) && (
                <div className="grid grid-cols-3 gap-2">
                  {analysis.contribuicaoFemoral !== undefined && (
                    <div className="rounded-lg border bg-orange-50 border-orange-200 p-2 text-center">
                      <p className="text-xs text-orange-600 font-medium">{t("femoralContribution")}</p>
                      <p className="text-lg font-bold text-orange-800">{analysis.contribuicaoFemoral}°</p>
                    </div>
                  )}
                  {analysis.contribuicaoTibial !== undefined && (
                    <div className="rounded-lg border bg-blue-50 border-blue-200 p-2 text-center">
                      <p className="text-xs text-blue-600 font-medium">{t("tibialContribution")}</p>
                      <p className="text-lg font-bold text-blue-800">{analysis.contribuicaoTibial}°</p>
                    </div>
                  )}
                  {analysis.contribuicaoArticular !== undefined && analysis.contribuicaoArticular > 0 && (
                    <div className="rounded-lg border bg-purple-50 border-purple-200 p-2 text-center">
                      <p className="text-xs text-purple-600 font-medium">{t("articularContribution")}</p>
                      <p className="text-lg font-bold text-purple-800">{analysis.contribuicaoArticular}°</p>
                    </div>
                  )}
                </div>
              )}

              {/* Nível Femoral */}
              {analysis.planoFemoral && analysis.planoFemoral.indicado && (
                <div className="rounded-xl border-2 border-orange-300 bg-orange-50 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                     <span className="font-bold text-orange-800 text-sm">{t("femoralLevelDfo")}</span>
                    <span className="text-xl font-bold text-orange-900">{analysis.planoFemoral.correcaoNecessaria}°</span>
                  </div>
                  <p className="text-sm font-semibold text-orange-700">
                    {t("technique")} <span className="font-bold">{analysis.planoFemoral.tecnica}</span>
                  </p>
                  {analysis.planoFemoral.justificativaTecnica && (
                    <p className="text-xs text-orange-600 leading-relaxed">{analysis.planoFemoral.justificativaTecnica}</p>
                  )}

                  {/* ── Miniaci Geométrico (ou Paley fallback) ── */}
                  {dfoMiniaciResult && (() => {
                    // Fonte única de ângulo: cunhaPorNivel (pós-JLCA/JLO) quando disponível.
                    // Elimina a divergência "card 10,8° / cunha 11°" — ambos consomem o mesmo valor.
                    const femItem = cunhaPorNivel?.find(c => c.osso === 'femur');
                    const angLabel = femItem
                      ? fmtAngulo(femItem.anguloCorrigido)
                      : `${dfoMiniaciResult.alphaAlvo}°`;
                    const isGeom = dfoMiniaciResult.method === 'miniaci-geometrico';
                    return (
                      <div className={`rounded-lg border p-3 space-y-1.5 ${isGeom ? 'border-orange-300 bg-white' : 'border-orange-200 bg-orange-50/60'}`}>
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${isGeom ? 'bg-orange-600 text-white' : 'bg-orange-200 text-orange-800'}`}>
                             {isGeom ? t("miniaciGeometricIcon") : t("paleyDecompositionIcon")}
                          </span>
                          {/* ângulo único — mesmo valor que alimenta o cálculo da cunha */}
                          <span className="text-lg font-black text-orange-900">{angLabel}</span>
                        </div>
                        {dfoMiniaciResult.ajusteLabel && (
                          <p className="text-xs text-orange-700 font-medium">
                             {t("jlcaPostAdjustment", { adjustment: dfoMiniaciResult.ajusteLabel, angle: angLabel })}
                          </p>
                        )}
                        {/* Cunha P4 — corda exata, jamais 1°≈1,26mm isolado */}
                        {femItem ? (
                          (() => {
                            const fmt = fmtCunha(femItem.cunha);
                            return (
                              <div className="pt-1 border-t border-orange-100 space-y-0.5">
                                <div className="flex items-baseline gap-2 flex-wrap">
                                  <span className="text-sm font-black text-orange-900">{fmt.texto}</span>
                                  <span className="text-[10px] text-gray-500 bg-orange-50 border border-orange-200 rounded px-1 py-0.5">{fmt.badge}</span>
                                </div>
                                {femItem.cunha.modo === 'ABSOLUTO' && (femItem.cunha as import('@/lib/cunha').CunhaAbsoluto).alerta && (
                                  <p className="text-[10px] text-amber-700">⚠ {(femItem.cunha as import('@/lib/cunha').CunhaAbsoluto).alerta}</p>
                                )}
                              </div>
                            );
                          })()
                        ) : (
                          <p className="text-xs text-orange-500 italic pt-1 border-t border-orange-100">
                             {t("selectLevelForP4")}
                          </p>
                        )}
                      </div>
                    );
                  })()}

                  {/* ── Botão Marcar Charneira ── */}
                  <button
                    type="button"
                    onClick={startDfoHingeMarking}
                    className="w-full flex items-center justify-center gap-2 text-xs px-3 py-2 rounded-lg border-2 border-orange-400 bg-white text-orange-700 hover:bg-orange-50 active:scale-95 transition-all font-bold"
                  >
                    <Target className="h-3.5 w-3.5" />
                     {dfoHingePoint ? t("remarkDfoHinge") : t("markDfoHinge")}
                  </button>
                  {dfoHingePoint && !amptaPoints.length && (
                     <p className="text-xs text-orange-500 text-center">{t("markPlateauForMiniaci")}</p>
                  )}
                  {dfoHingePoint && !markedPoints[0] && (
                     <p className="text-xs text-orange-500 text-center">{t("markHkaForMiniaci")}</p>
                  )}

                  {analysis.wedgeFemoral && (
                    <div className="pt-2 border-t border-orange-200 flex items-center gap-3 text-xs text-orange-700">
                      <span className="font-semibold">Wedge IA: {analysis.wedgeFemoral.calculado_mm} mm</span>
                       <span className="text-orange-500">{t("ruleOfThumbMm", { value: analysis.wedgeFemoral.aproximado_mm })}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Nível Tibial */}
              {analysis.planoTibial && analysis.planoTibial.indicado && (
                <div className="rounded-xl border-2 border-blue-300 bg-blue-50 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                     <span className="font-bold text-blue-800 text-sm">{t("tibialLevelHto")}</span>
                    <span className="text-xl font-bold text-blue-900">{analysis.planoTibial.correcaoNecessaria}°</span>
                  </div>
                  <p className="text-sm font-semibold text-blue-700">
                    {t("technique")} <span className="font-bold">{analysis.planoTibial.tecnica}</span>
                  </p>
                  {analysis.planoTibial.justificativaTecnica && (
                    <p className="text-xs text-blue-600 leading-relaxed">{analysis.planoTibial.justificativaTecnica}</p>
                  )}
                  {analysis.wedgeTibial && (
                    <div className="mt-2 pt-2 border-t border-blue-200 flex items-center gap-3 text-xs text-blue-700">
                      <span className="font-semibold">Wedge: {analysis.wedgeTibial.calculado_mm} mm</span>
                       <span className="text-blue-500">{t("ruleOfThumbMm", { value: analysis.wedgeTibial.aproximado_mm })}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Distribuição Dupla Osteotomia */}
              {analysis.distribuicaoDupla && analysis.distribuicaoDupla.aplicavel && (
                <div className="rounded-xl border-2 border-purple-300 bg-purple-50 p-4 space-y-3">
                   <p className="text-xs font-bold text-purple-800 uppercase tracking-wide">{t("doubleDistribution")}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-white rounded-lg border border-purple-200 p-3 text-center space-y-1">
                      <p className="text-xs text-purple-600 font-medium">{t("femoralDfoPlain")}</p>
                      <p className="text-xl font-black text-orange-700">{analysis.distribuicaoDupla.correcaoFemoral}°</p>
                       <p className="text-xs text-purple-500">{t("weight", { value: Math.round(analysis.distribuicaoDupla.pesoFemoral * 100) })}</p>
                      {analysis.distribuicaoDupla.wedgeFemoral_mm > 0 && (
                        <p className="text-xs font-semibold text-orange-600">{analysis.distribuicaoDupla.wedgeFemoral_mm} mm</p>
                      )}
                    </div>
                    <div className="bg-white rounded-lg border border-purple-200 p-3 text-center space-y-1">
                      <p className="text-xs text-purple-600 font-medium">{t("tibialHtoPlain")}</p>
                      <p className="text-xl font-black text-blue-700">{analysis.distribuicaoDupla.correcaoTibial}°</p>
                       <p className="text-xs text-purple-500">{t("weight", { value: Math.round(analysis.distribuicaoDupla.pesoTibial * 100) })}</p>
                      {analysis.distribuicaoDupla.wedgeTibial_mm > 0 && (
                        <p className="text-xs font-semibold text-blue-600">{analysis.distribuicaoDupla.wedgeTibial_mm} mm</p>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-purple-600 italic">
                     {t("distributionHelp")}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Alertas técnicos */}
          {analysis.alertas && analysis.alertas.length > 0 && (
            <div className="rounded-xl border-2 border-red-200 bg-red-50 p-4 space-y-2">
              <div className="flex items-center gap-2">
                <TriangleAlert className="h-4 w-4 text-red-600 shrink-0" />
                <span className="font-bold text-sm text-red-800">{t("technicalAlerts")}</span>
              </div>
              <ul className="space-y-1.5">
                {analysis.alertas.map((alerta, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-red-700">
                    <span className="mt-0.5 shrink-0 w-4 h-4 rounded-full bg-red-200 text-red-700 font-bold flex items-center justify-center text-[10px]">{i + 1}</span>
                    {alerta}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ── Etapa 4 — Marcação de córtices (antes dos resultados) ── */}
          {analysis.opcoesOsteotomia && Array.isArray(analysis.opcoesOsteotomia) && analysis.opcoesOsteotomia.length > 0 && (
            <div className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 space-y-2">
              <p className="text-xs font-bold text-indigo-800">{t("step4Title")}</p>
              <p className="text-[10px] text-indigo-600 leading-snug">
                {t("step4Help")}
              </p>
              <div className="flex flex-col gap-2">
                {etapa4Bones.map(bone => {
                  const bpts = baseMarcacoes[bone];
                  const complete = bpts?.entrada && bpts.charneira;
                  const partial  = bpts?.entrada && !bpts.charneira;
                  const isFem    = bone === 'femur';
                  const calibLargura = complete && mmPorPixel
                    ? +(Math.abs(bpts.charneira!.x - bpts.entrada.x) * mmPorPixel).toFixed(1)
                    : null;
                  return (
                    <div key={bone} className={`rounded-lg border p-2.5 space-y-1.5 ${isFem ? 'border-violet-200 bg-white' : 'border-blue-200 bg-white'}`}>
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className={`text-[10px] font-bold ${isFem ? 'text-violet-800' : 'text-blue-800'}`}>
                          {isFem ? t("femurSupracondylar") : t("tibiaMetaphyseal")}
                        </span>
                        {complete
                          ? <span className="text-[10px] font-bold text-green-700 bg-green-100 px-1.5 py-0.5 rounded-full">✓ {calibLargura !== null ? `${calibLargura} mm` : t("marked")}</span>
                          : partial
                          ? <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full">{t("markSecondPoint")}</span>
                          : <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">{t("notMarked")}</span>
                        }
                      </div>
                      <button
                        type="button"
                        onClick={() => startBaseMarking(bone)}
                        className={`w-full flex items-center justify-center gap-1.5 text-xs px-3 py-2 rounded border-2 transition-all active:scale-95 font-semibold ${
                          complete
                            ? isFem ? 'border-violet-300 bg-white text-violet-600' : 'border-blue-300 bg-white text-blue-600'
                            : isFem ? 'border-violet-500 bg-violet-50 text-violet-800 hover:bg-violet-100' : 'border-blue-500 bg-blue-50 text-blue-800 hover:bg-blue-100'
                        }`}
                      >
                        <Ruler className="h-3 w-3" />
                        {complete ? t("remarkTwoPoints") : partial ? t("touchSecondPoint") : t("markTwoPoints")}
                      </button>
                      {complete && calibLargura !== null && (
                        <p className={`text-[10px] font-mono font-bold ${isFem ? 'text-violet-800' : 'text-blue-800'}`}>
                          {t("measuredWidth", { value: calibLargura })}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Gate: prompt para completar Etapa 4 */}
          {analysis.opcoesOsteotomia && Array.isArray(analysis.opcoesOsteotomia) && analysis.opcoesOsteotomia.length > 0 && !etapa4Complete && (
            <div className="rounded-xl border-2 border-dashed border-indigo-300 bg-indigo-50/50 p-4 text-center space-y-1.5">
              <p className="text-sm font-semibold text-indigo-700">{t("completeMarking")}</p>
              <p className="text-[11px] text-indigo-400">{t("markingAppears")}</p>
            </div>
          )}
          {/* Todas as opções de osteotomia — visíveis somente após Etapa 4 */}
          {analysis.opcoesOsteotomia && Array.isArray(analysis.opcoesOsteotomia) && analysis.opcoesOsteotomia.length > 0 && etapa4Complete && (
              <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="h-px flex-1 bg-border" />
                  <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest px-2">{t("osteotomyOptions")}</span>
                <div className="h-px flex-1 bg-border" />
              </div>
              {(analysis.opcoesOsteotomia as Array<Record<string, unknown>>).map((opcao, idx) => {
                const pre  = opcao.angulosPre  as { HKA: number; desvio?: string; mLDFA?: number; aMPTA?: number };
                const pos  = opcao.angulosPos  as { HKA: number; mLDFA?: number; aMPTA?: number };
                const isDupla   = String(opcao.id ?? "").startsWith("dupla");
                const isHTOBase = String(opcao.id ?? "").startsWith("hto");
                const wedgeMarcada = (osso: 'femur' | 'tibia'): number | null => {
                  const item = cunhaPorNivel?.find((cunha) => cunha.osso === osso);
                  return item?.cunha.modo === 'ABSOLUTO' ? item.cunha.abertura : null;
                };
                const cunhaFemoralReal = wedgeMarcada('femur');
                const cunhaTibialReal = wedgeMarcada('tibia');
                const cunhaFemoralPequena = cunhaFemoralReal !== null && cunhaFemoralReal < 5;
                const cunhaTibialPequena = cunhaTibialReal !== null && cunhaTibialReal < 5;
                const duplaCunhaPequena = cunhaFemoralPequena || cunhaTibialPequena;
                const alertasPersistidos = ((opcao.alertas as string[]) ?? []).filter((alerta) =>
                  !isDupla || !/Correção (femoral|tibial).*< 5 mm.*risco cirúrgico adicional/i.test(alerta),
                );
                const alertasCunhaReal = isDupla && duplaCunhaPequena
                  ? [
                    cunhaFemoralPequena
                      ? t("smallFemoralCorrection", { value: cunhaFemoralReal!.toFixed(1) })
                      : null,
                    cunhaTibialPequena
                      ? t("smallTibialCorrection", { value: cunhaTibialReal!.toFixed(1) })
                      : null,
                  ].filter((alerta): alerta is string => alerta !== null)
                  : [];
                const alertas = [...alertasPersistidos, ...alertasCunhaReal];

                const borderColor = isDupla
                  ? "border-purple-200"
                  : isHTOBase
                    ? "border-blue-200"
                    : "border-orange-200";
                const bgColor = isDupla
                  ? "bg-purple-50/50"
                  : isHTOBase
                    ? "bg-blue-50/50"
                    : "bg-orange-50/50";
                const labelColor = isDupla
                  ? "text-purple-700" : isHTOBase ? "text-blue-700" : "text-orange-700";
                const dotColor = isDupla
                  ? "bg-purple-500"
                  : isHTOBase
                    ? "bg-blue-500"
                    : "bg-orange-500";
                const isReallySelected = selectedOsteotomiaIdx === idx;
                const isSelected = isReallySelected;

                // ── mm simulation — usa fórmula Miniaci P4 (k=2·sin(α/2)) ──────────
                // P4 items para a opção selecionada (null para as não-selecionadas)
                const p4Fem = isSelected ? cunhaPorNivel?.find(c => c.osso === 'femur') : undefined;
                const p4Tib = isSelected ? cunhaPorNivel?.find(c => c.osso === 'tibia') : undefined;
                // Base efetiva: calibrada > midpoint anatômico
                const p4BaseFem = (p4Fem?.base?.modo === 'CALIBRADO' && p4Fem.base.base_mm != null)
                  ? p4Fem.base.base_mm : ANAT_BASE_FEM;
                const p4BaseTib = (p4Tib?.base?.modo === 'CALIBRADO' && p4Tib.base.base_mm != null)
                  ? p4Tib.base.base_mm : ANAT_BASE_TIB;

                // Ângulos de correção derivados diretamente de angulosPos da IA.
                // |pos.mLDFA − pre.mLDFA| dá a correção femoral que a IA realmente planejou
                // (ex: 10.4° para HKA neutro via DFO), em vez da decomposição anatômica do
                // decidirNivel (ex: |mLDFA−87°|=3.7°). Garante que o mm exibido seja
                // consistente com a tabela pré/pós-op — ambos agora derivam de angulosPos.
                // Guard: se angulosPos/Pre ausentes (análise legada), usa 0 e oculta valores.
                const preMldfa = typeof pre?.mLDFA === "number" && Number.isFinite(pre.mLDFA) ? pre.mLDFA : null;
                const posMldfa = typeof pos?.mLDFA === "number" && Number.isFinite(pos.mLDFA) ? pos.mLDFA : null;
                const preAmpta = typeof pre?.aMPTA === "number" && Number.isFinite(pre.aMPTA) ? pre.aMPTA : null;
                const posAmpta = typeof pos?.aMPTA === "number" && Number.isFinite(pos.aMPTA) ? pos.aMPTA : null;
                const aiCorrFemDeg = preMldfa !== null && posMldfa !== null
                  ? +(Math.abs(posMldfa - preMldfa)).toFixed(1)
                  : 0;
                const aiCorrTibDeg = preAmpta !== null && posAmpta !== null
                  ? +(Math.abs(posAmpta - preAmpta)).toFixed(1)
                  : 0;

                // Valor inicial dos sliders: Miniaci forward a partir da correção planejada
                // pela IA (consistente com a tabela pré/pós-op).
                const origDfoMm = (() => {
                  // A committed physician adjustment is authoritative. Do not
                  // replace it with a fresh Miniaci estimate when reopening a
                  // saved report.
                  const stored = Number(isDupla ? opcao.wedgeFemoral_mm : (!isHTOBase ? opcao.wedge_mm : NaN));
                  if (Number.isFinite(stored)) return stored;
                  if ((isDupla || !isHTOBase) && aiCorrFemDeg > 0) return +(miniaciMm(aiCorrFemDeg, p4BaseFem)).toFixed(1);
                  return 0;
                })();
                const origHtoMm = (() => {
                  const stored = Number(isDupla ? opcao.wedgeTibial_mm : (isHTOBase ? opcao.wedge_mm : NaN));
                  if (Number.isFinite(stored)) return stored;
                  if ((isDupla || isHTOBase) && aiCorrTibDeg > 0) return +(miniaciMm(aiCorrTibDeg, p4BaseTib)).toFixed(1);
                  return 0;
                })();

                const editDfoMm = mmEdit?.dfoMm ?? origDfoMm;
                const editHtoMm = mmEdit?.htoMm ?? origHtoMm;

                const hasStoredWedge = (value: unknown) =>
                  value !== null && value !== undefined
                  && !(typeof value === "string" && value.trim() === "")
                  && Number.isFinite(Number(value));
                const persistedWedgeAvailable = isDupla
                  ? hasStoredWedge(opcao.wedgeFemoral_mm) && hasStoredWedge(opcao.wedgeTibial_mm)
                  : hasStoredWedge(opcao.wedge_mm);
                const isSimulating = isSelected && mmEdit !== null
                  && (!persistedWedgeAvailable || editDfoMm !== origDfoMm || editHtoMm !== origHtoMm);
                const canSaveSimulation = isSimulating;
                if (canSaveSimulation) {
                  saveSimulationAction = () => handleSaveSimulation(
                    idx,
                    displayPos,
                    editDfoMm,
                    editHtoMm,
                    isDupla,
                    isHTOBase,
                  );
                }

                // Build sim post-op from PRE-op + applied correction × direction.
                // This is direction-aware (works for both varo→valgizante and valgo→varizante)
                // and crucially yields displayPos === pre when wedge = 0 (no surgery → no change).
                // The previous formula `pos + delta` had the sign of `delta` inverted for valgo
                // cases, producing absurd post-op values when the slider was dialed back to 0.
                const preHkaSigned = pre.desvio === "Varo"
                  ? -Math.abs(pre.HKA ?? 0)
                  : pre.desvio === "Valgo"
                    ? +Math.abs(pre.HKA ?? 0)
                    : (pre.HKA ?? 0);
                // Ângulo a partir dos mm do slider — sempre Miniaci quando há correção no nível
                // (aiCorrFemDeg > 0 significa que a IA planejou correção femoral; temos p4BaseFem
                // sempre disponível, seja calibrado ou anatômico).
                const correctionAppliedDfoDeg = (isDupla || !isHTOBase) && (aiCorrFemDeg > 0 || p4Fem)
                  ? miniaciDeg(editDfoMm, p4BaseFem)
                  : editDfoMm / SIM_FEMORAL_RATIO;
                const correctionAppliedHtoDeg = (isDupla || isHTOBase) && (aiCorrTibDeg > 0 || p4Tib)
                  ? miniaciDeg(editHtoMm, p4BaseTib)
                  : editHtoMm / SIM_TIBIAL_RATIO;
                const totalAppliedDeg = correctionAppliedDfoDeg + correctionAppliedHtoDeg;
                // Total correction at the initial (planned) mm — mesma fórmula
                const origTotalDeg =
                  ((isDupla || !isHTOBase)
                    ? ((aiCorrFemDeg > 0 || p4Fem) ? miniaciDeg(origDfoMm, p4BaseFem) : origDfoMm / SIM_FEMORAL_RATIO)
                    : 0)
                  + ((isDupla || isHTOBase)
                    ? ((aiCorrTibDeg > 0 || p4Tib) ? miniaciDeg(origHtoMm, p4BaseTib) : origHtoMm / SIM_TIBIAL_RATIO)
                    : 0);

                // Sign convention (frontend signed HKA: positive=valgo, negative=varo):
                // VARO (HKA<0) needs valgizante correction → adds to signed HKA.
                // VALGO (HKA>0) needs varizante correction → subtracts from signed HKA.
                const corrSign = preHkaSigned < 0 ? +1 : preHkaSigned > 0 ? -1 : +1;

                // Per-segment direction of post-op change:
                //   DFO valgizante (varo case)  → mLDFA decreases (high→low)  → −1
                //   DFO varizante (valgo case) → mLDFA increases (low→high)  → +1
                //   HTO valgizante (varo case)  → aMPTA increases (low→high) → +1
                //   HTO varizante (valgo case) → aMPTA decreases (high→low) → −1
                const aldfaSign = preHkaSigned < 0 ? -1 : +1;
                const amptaSign = preHkaSigned < 0 ? +1 : -1;

                const simHkaSigned = +(preHkaSigned + totalAppliedDeg * corrSign).toFixed(1);
                const simAldfa = preMldfa === null
                  ? null
                  : +((preMldfa + correctionAppliedDfoDeg * aldfaSign).toFixed(1));
                const simAmpta = preAmpta === null
                  ? null
                  : +((preAmpta + correctionAppliedHtoDeg * amptaSign).toFixed(1));

                const origWblPos = Number(opcao.wblPos as number) || 50;
                // WBL: linear interpolation calibrated on server's wblPre→wblPos over the
                // AI-recommended correction range. This ensures the simulator shows EXACTLY
                // the server's target WBL at the AI-recommended mm, and scales proportionally
                // for other mm values — eliminating the jump seen when the slider is moved
                // back to the original position (server uses a different WBL coefficient than
                // the geometric 50+HKA×1.6 formula the client would otherwise apply).
                const origWblPre = Number(opcao.wblPre as number) || +(50 + preHkaSigned * 1.6).toFixed(1);
                const simWbl = origTotalDeg > 0
                  ? +(origWblPre + (origWblPos - origWblPre) * (totalAppliedDeg / origTotalDeg)).toFixed(1)
                  : origWblPre;
                // Use computed values during live simulation; fall back to server-computed
                // pos when the simulator has not been touched (preserves server formatting).
                const displayPos = isSimulating
                  ? { HKA: simHkaSigned, mLDFA: simAldfa, aMPTA: simAmpta, wbl: simWbl }
                  : { HKA: pos.HKA, mLDFA: posMldfa, aMPTA: posAmpta, wbl: origWblPos };

                return (
                    <div key={idx} className={`rounded-xl border-2 ${isSelected ? "border-emerald-400 ring-2 ring-emerald-200 bg-emerald-50/60" : `${borderColor} ${bgColor}`} overflow-hidden space-y-0`}>
                    <div className="p-4 space-y-3">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className={`w-2 h-2 rounded-full ${dotColor} shrink-0 mt-0.5`} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className={`font-bold text-sm ${labelColor}`}>{String(opcao.nome)}</p>
                            {isReallySelected && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-300 shrink-0">
                                {t("surgicalChoice")}
                              </span>
                            )}
                            {isDupla && duplaCunhaPequena && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-400 shrink-0" title={t("smallWedgeTitle")}>
                                {t("smallWedge")}
                              </span>
                            )}
                            {!isDupla && Number(opcao.wedge_mm) < 4 && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-400 shrink-0" title={t("infeasibleWedgeTitle")}>
                                {t("infeasibleWedgeShort")}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">{String(opcao.nivel).replace(/\s*\(meta[^)]*\)/gi, "").trim()}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-xs font-bold px-2 py-1 rounded-full ${isSelected ? "bg-emerald-100 border-emerald-300 text-emerald-700" : `${bgColor} border ${borderColor} ${labelColor}`}`}>
                          {t("total", { value: Number(opcao.correcao) })}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleOsteotomiaSelect(isReallySelected ? null : idx, analysis.opcoesOsteotomia as Array<Record<string, unknown>>)}
                          className={`text-[10px] font-bold px-2 py-1 rounded-lg border transition-all ${
                            isReallySelected
                              ? "bg-emerald-500 text-white border-emerald-600 hover:bg-emerald-600"
                              : "bg-white text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                          }`}
                          title={isReallySelected ? t("unselectSurgery") : t("selectSurgery")}
                        >
                          {isReallySelected ? t("selected") : t("choose")}
                        </button>
                      </div>
                    </div>

                    {/* Observação técnica */}
                    {Boolean(opcao.observacao) && (
                      <div className={`rounded-lg px-3 py-2 text-xs leading-relaxed ${
                        isSelected
                          ? "bg-green-50 border border-green-200 text-green-800"
                          : "bg-gray-50 border border-gray-200 text-gray-600"
                      }`}>
                        {String(opcao.observacao)}
                      </div>
                    )}

                    {/* ── Banner de técnica cirúrgica — DUPLA OSTEOTOMIA ─────────────── */}
                    {isDupla && (() => {
                      const parseTec = (s: string) => {
                        const t = s.toLowerCase();
                        return {
                          tipo: t.includes("abertura") ? "abertura" : t.includes("fechamento") ? "fechamento" : null as string | null,
                          lado: t.includes("medial") ? "medial" : t.includes("lateral") ? "lateral" : null as string | null,
                        };
                      };
                      const fem = parseTec(String(opcao.tecnicaFemoral ?? ""));
                      const tib = parseTec(String(opcao.tecnicaTibial ?? ""));
                      if (!fem.tipo && !tib.tipo) return null;

                      const BoneTag = ({ label, tipo, lado }: { label: string; tipo: string | null; lado: string | null }) => {
                        if (!tipo || !lado) return null;
                        const isAbertura = tipo === "abertura";
                        const ladoEntrada = lado;
                        const ladoCharneira = lado === "medial" ? "lateral" : "medial";
                        const corDot    = isAbertura ? "bg-blue-500" : "bg-orange-500";
                        const corBadge  = isAbertura ? "bg-blue-600 text-white" : "bg-orange-600 text-white";
                        const corBorder = isAbertura ? "border-blue-200 bg-blue-50" : "border-orange-200 bg-orange-50";
                        const tipoStr   = tipo.charAt(0).toUpperCase() + tipo.slice(1);
                        const ladoStr   = lado.charAt(0).toUpperCase() + lado.slice(1);
                        return (
                          <div className={`flex-1 rounded-lg border-2 ${corBorder} px-3 py-2 space-y-1.5`}>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={`w-2 h-2 rounded-full ${corDot} shrink-0`} />
                              <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">{label}</span>
                              <span className={`text-[11px] font-extrabold px-2 py-0.5 rounded-full ${corBadge} uppercase tracking-wide leading-none`}>
                                {tipoStr} {ladoStr}
                              </span>
                            </div>
                            <p className="text-[11px] leading-snug text-foreground/80">
                              {isAbertura
                                ? <strong>{t("openingSideDetail", { entry: ladoEntrada, hinge: ladoCharneira })}</strong>
                                : <strong>{t("closingSideDetail", { entry: ladoEntrada, hinge: ladoCharneira })}</strong>
                              }
                            </p>
                            <p className="text-[10px] text-muted-foreground leading-snug">
                              {isAbertura
                                ? t("openingMarkHelp", { entry: ladoEntrada, hinge: ladoCharneira })
                                : t("closingMarkHelp", { entry: ladoEntrada, hinge: ladoCharneira })
                              }
                            </p>
                          </div>
                        );
                      };

                      return (
                        <div className="rounded-xl border-2 border-purple-200 bg-purple-50/60 px-3 py-3 space-y-2">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm">🔬</span>
                            <p className="text-xs font-bold text-purple-800 uppercase tracking-wide">{t("plannedTechnique")}</p>
                          </div>
                          <div className="flex gap-2">
                            <BoneTag label={t("dfoFemurLabel")} tipo={fem.tipo} lado={fem.lado} />
                            <BoneTag label={t("htoTibiaLabel")} tipo={tib.tipo} lado={tib.lado} />
                          </div>
                          <p className="text-[10px] text-purple-700 leading-snug border-t border-purple-200 pt-2">
                            {t("plannedTechniqueHelp", { sides: fem.lado && tib.lado ? `DFO ${fem.lado}, HTO ${tib.lado}` : t("medialAndLateral") })}
                          </p>
                        </div>
                      );
                    })()}

                    {/* Alerta cunha < 4 mm — tecnicamente inviável */}
                    {!isDupla && Number(opcao.wedge_mm) < 4 && (
                      <div className="rounded-lg border-2 border-red-300 bg-red-50 px-3 py-3 text-xs text-red-800 flex items-start gap-2">
                        <span className="text-base shrink-0 mt-0.5">🚫</span>
                        <div>
                          <p className="font-bold">{t("infeasibleWedge")}</p>
                          <p className="mt-1 leading-snug">
                            {t("infeasibleWedgeHelp", { value: Number(opcao.wedge_mm) })}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Ângulos pré / pós */}
                    <div className="rounded-lg overflow-hidden border border-border/50">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-black/5">
                            <th className="text-left px-3 py-1.5 font-semibold text-muted-foreground">{t("angle")}</th>
                            <th className="text-center px-3 py-1.5 font-semibold text-muted-foreground">{t("preOp")}</th>
                            <th className="text-center px-2 py-1.5 text-muted-foreground/50">→</th>
                            <th className="text-center px-3 py-1.5 font-semibold text-muted-foreground">
                              {t("postOp")}{isSimulating && <span className="ml-1 text-[9px] font-bold text-violet-600 bg-violet-100 px-1 rounded">{t("simulation")}</span>}
                            </th>
                            <th className="text-right px-3 py-1.5 font-semibold text-muted-foreground">{t("normal")}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/30">
                          <tr className="bg-white/60">
                            <td className="px-3 py-2 font-semibold">HKA</td>
                            <td className="px-3 py-2 text-center font-bold text-red-700">
                              {Math.abs(pre.HKA)}°{" "}
                              <span className="text-[10px] font-normal">{pre.desvio ?? (pre.HKA < 0 ? "Varo" : pre.HKA > 0 ? "Valgo" : "Neutro")}</span>
                            </td>
                            <td className="px-2 py-2 text-center text-muted-foreground/40">→</td>
                            <td className={`px-3 py-2 text-center font-bold ${isSimulating ? "text-violet-700" : Math.abs(displayPos.HKA) <= 3 ? "text-green-700" : displayPos.HKA < 0 ? "text-amber-700" : "text-blue-700"}`}>
                              {Math.abs(displayPos.HKA)}°{" "}
                              <span className="text-[10px] font-normal">{displayPos.HKA < 0 ? "Varo" : displayPos.HKA > 0 ? "Valgo" : "Neutro"}</span>
                            </td>
                            <td className="px-3 py-2 text-right text-muted-foreground">0° ± 3°</td>
                          </tr>
                          {/* AmTF — Ângulo medial tíbio-femoral */}
                          {(() => {
                            const amtfPre = pre.desvio === "Varo"
                              ? +(180 + Math.abs(pre.HKA ?? 0)).toFixed(1)
                              : pre.desvio === "Valgo"
                                ? +(180 - Math.abs(pre.HKA ?? 0)).toFixed(1)
                                : 180;
                            const amtfPos = deriveDisplayedPostAmTf(displayPos.HKA);
                            const posOk = amtfPos >= 177 && amtfPos <= 183;
                            return (
                              <tr className="bg-white/60">
                                <td className="px-3 py-2 font-semibold">AmTF</td>
                                <td className={`px-3 py-2 text-center font-bold ${amtfPre < 177 || amtfPre > 183 ? "text-amber-700" : "text-muted-foreground"}`}>{amtfPre}°</td>
                                <td className="px-2 py-2 text-center text-muted-foreground/40">→</td>
                                <td className={`px-3 py-2 text-center font-bold ${isSimulating ? "text-violet-700" : posOk ? "text-green-700" : "text-amber-700"}`}>{amtfPos}°</td>
                                <td className="px-3 py-2 text-right text-muted-foreground">180° ± 3°</td>
                              </tr>
                            );
                          })()}
                          <tr className="bg-white/40">
                            <td className="px-3 py-2 font-semibold">AmLDF</td>
                            <td className={`px-3 py-2 text-center font-bold ${preMldfa !== null && (preMldfa < 84 || preMldfa > 90) ? "text-amber-700" : "text-muted-foreground"}`}>{preMldfa === null ? "--" : `${preMldfa}°`}</td>
                            <td className="px-2 py-2 text-center text-muted-foreground/40">→</td>
                            <td className={`px-3 py-2 text-center font-bold ${isSimulating ? "text-violet-700" : displayPos.mLDFA !== null && displayPos.mLDFA >= 84 && displayPos.mLDFA <= 90 ? "text-green-700" : "text-amber-700"}`}>{displayPos.mLDFA === null ? "--" : `${displayPos.mLDFA}°`}</td>
                            <td className="px-3 py-2 text-right text-muted-foreground">87° ± 3°</td>
                          </tr>
                          <tr className="bg-white/60">
                            <td className="px-3 py-2 font-semibold">AmMPT</td>
                            <td className={`px-3 py-2 text-center font-bold ${preAmpta !== null && (preAmpta < 84 || preAmpta > 90) ? "text-amber-700" : "text-muted-foreground"}`}>{preAmpta === null ? "--" : `${preAmpta}°`}</td>
                            <td className="px-2 py-2 text-center text-muted-foreground/40">→</td>
                            <td className={`px-3 py-2 text-center font-bold ${isSimulating ? "text-violet-700" : displayPos.aMPTA !== null && displayPos.aMPTA >= 84 && displayPos.aMPTA <= 90 ? "text-green-700" : "text-red-700"}`}>{displayPos.aMPTA === null ? "--" : `${displayPos.aMPTA}°`}</td>
                            <td className="px-3 py-2 text-right text-muted-foreground">87° ± 3°</td>
                          </tr>
                          <tr className="bg-white/40">
                            <td className="px-3 py-2 font-semibold">%WBL</td>
                            <td className="px-3 py-2 text-center font-bold text-amber-700">{String(opcao.wblPre)}%</td>
                            <td className="px-2 py-2 text-center text-muted-foreground/40">→</td>
                            <td className={`px-3 py-2 text-center font-bold ${isSimulating ? "text-violet-700" : "text-green-700"}`}>{displayPos.wbl}%</td>
                            <td className="px-3 py-2 text-right">
                              <span className="text-[9px] text-muted-foreground block leading-none mb-0.5">{t("targetPlain")}</span>
                              <span className="font-semibold text-blue-700">{wblDesejado}%</span>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    {/* Wedge — static when not selected, editable simulator when selected */}
                    <div className="space-y-2">
                      {/* Always show technique labels */}
                      <div className="flex flex-wrap gap-2 text-xs">
                        {isDupla ? (
                          <>
                            {Boolean(opcao.tecnicaFemoral) && (
                              <span className="px-2 py-0.5 text-[11px] text-orange-600 font-medium">
                                🦴 DFO ↳ {String(opcao.tecnicaFemoral)}
                              </span>
                            )}
                            {Boolean(opcao.tecnicaTibial) && (
                              <span className="px-2 py-0.5 text-[11px] text-blue-600 font-medium">
                                🦴 HTO ↳ {String(opcao.tecnicaTibial)}
                                {Boolean(opcao.cargaTibial) && <span className="text-muted-foreground"> · {t("load")} {String(opcao.cargaTibial)}</span>}
                              </span>
                            )}
                          </>
                        ) : (
                          Boolean(opcao.tecnica) && (
                            <span className={`px-2 py-0.5 text-[11px] ${labelColor} font-medium`}>
                              ↳ {String(opcao.tecnica)}
                            </span>
                          )
                        )}
                      </div>

                      {/* Editable mm inputs (shown when selected) */}
                      {isSelected ? (
                        <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-3 space-y-3">
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-xs font-semibold text-violet-800">{t("simulateWedge")}</span>
                            <div className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">
                              {simSaved && isSelected && (
                                <span
                                  role="status"
                                  aria-live="polite"
                                  className="shrink-0 text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-300 px-2 py-0.5 rounded-full"
                                >
                                   {t("saved")}
                                </span>
                              )}
                              {canSaveSimulation && (
                                <>
                                  <button
                                    type="button"
                                    aria-label={t("saveToReport")}
                                    title={t("saveToReport")}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      handleSaveSimulation(idx, displayPos, editDfoMm, editHtoMm, isDupla, isHTOBase);
                                    }}
                                    className="inline-flex shrink-0 whitespace-nowrap text-[10px] font-bold text-emerald-700 bg-emerald-100 hover:bg-emerald-200 border border-emerald-300 px-2 py-1 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1"
                                  >
                                    {t("saveToReport")}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setMmEdit(null)}
                                    className="shrink-0 whitespace-nowrap text-[10px] text-violet-600 hover:text-violet-900 underline"
                                  >
                                    {t("resetSimulation")}
                                  </button>
                                </>
                              )}
                            </div>
                          </div>

                          {/* DFO row */}
                          {(isDupla || !isHTOBase) && (
                            <div className="space-y-1">
                              <div className="flex items-center justify-between flex-wrap gap-1">
                                <span className="text-[11px] font-bold text-orange-700">
                                  🦴 DFO — {correctionAppliedDfoDeg.toFixed(1)}°
                                  {' '}·{' '}
                                  <span className={isSimulating && editDfoMm !== origDfoMm ? "text-violet-700 font-extrabold" : ""}>{editDfoMm.toFixed(1)} mm</span>
                                </span>
                                {p4Fem
                                  ? <span className="text-[10px] text-green-700 italic">{t("markedWidth", { value: p4BaseFem })}</span>
                                  : <button
                                      type="button"
                                      onClick={() => { const ph = { bone: 'femur' as const, phase: 'entrada' as const }; setBaseMarkingActive(ph); baseMarkingActiveRef.current = ph; touchSnapRef.current.baseMarkingActive = ph; setMarkingMode(true); touchSnapRef.current.markingMode = true; setStep('upload'); }}
                                      className="text-[10px] text-orange-700 underline italic hover:text-orange-900 transition-colors"
                                    >{t("estimateMarkWidth", { value: p4BaseFem })}</button>
                                }
                              </div>
                              <div className="flex items-center gap-2">
                                <input
                                  type="range"
                                  min={0} max={25} step={0.5}
                                  value={editDfoMm}
                                  onChange={e => setMmEdit({ dfoMm: +e.target.value, htoMm: editHtoMm })}
                                  className="flex-1 accent-orange-500"
                                />
                                <input
                                  type="number"
                                  min={0} max={25} step={0.5}
                                  value={editDfoMm}
                                  onChange={e => setMmEdit({ dfoMm: Math.max(0, Math.min(25, +e.target.value)), htoMm: editHtoMm })}
                                  className="w-16 text-xs border border-orange-300 rounded px-1.5 py-1 text-center font-bold text-orange-700 bg-white"
                                />
                                <span className="text-[11px] text-muted-foreground">mm</span>
                              </div>
                            </div>
                          )}

                          {/* HTO row */}
                          {(isDupla || isHTOBase) && (
                            <div className="space-y-1">
                              <div className="flex items-center justify-between flex-wrap gap-1">
                                <span className="text-[11px] font-bold text-blue-700">
                                  🦴 HTO — {correctionAppliedHtoDeg.toFixed(1)}°
                                  {' '}·{' '}
                                  <span className={isSimulating && editHtoMm !== origHtoMm ? "text-violet-700 font-extrabold" : ""}>{editHtoMm.toFixed(1)} mm</span>
                                </span>
                                {p4Tib
                                  ? <span className="text-[10px] text-green-700 italic">{t("markedWidth", { value: p4BaseTib })}</span>
                                  : <button
                                      type="button"
                                      onClick={() => { const ph = { bone: 'tibia' as const, phase: 'entrada' as const }; setBaseMarkingActive(ph); baseMarkingActiveRef.current = ph; touchSnapRef.current.baseMarkingActive = ph; setMarkingMode(true); touchSnapRef.current.markingMode = true; setStep('upload'); }}
                                      className="text-[10px] text-amber-700 font-semibold underline hover:text-amber-900 transition-colors"
                                    >{t("markTibialCortices")}</button>
                                }
                              </div>
                              <div className="flex items-center gap-2">
                                <input
                                  type="range"
                                  min={0} max={20} step={0.5}
                                  value={editHtoMm}
                                  onChange={e => setMmEdit({ dfoMm: editDfoMm, htoMm: +e.target.value })}
                                  className="flex-1 accent-blue-500"
                                />
                                <input
                                  type="number"
                                  min={0} max={20} step={0.5}
                                  value={editHtoMm}
                                  onChange={e => setMmEdit({ dfoMm: editDfoMm, htoMm: Math.max(0, Math.min(20, +e.target.value)) })}
                                  className="w-16 text-xs border border-blue-300 rounded px-1.5 py-1 text-center font-bold text-blue-700 bg-white"
                                />
                                <span className="text-[11px] text-muted-foreground">mm</span>
                              </div>
                            </div>
                          )}

                          {/* ── Etapa 4: Marcar córtices na Rx ── */}
                          {!opcao.locked && (
                            <div className="border-t border-violet-200 pt-2 mt-1 space-y-1.5">
                              <p className="text-[10px] font-bold text-indigo-700">{t("step4CompactTitle")}</p>
                              <div className="flex flex-col gap-2">
                                {(['femur', 'tibia'] as const).map(bone => {
                                  const showBone = bone === 'femur' ? (isDupla || !isHTOBase) : (isDupla || isHTOBase);
                                  if (!showBone) return null;
                                  const corrDeg = bone === 'femur' ? aiCorrFemDeg : aiCorrTibDeg;
                                  const bpts = baseMarcacoes[bone];
                                  const complete = bpts?.entrada && bpts.charneira;
                                  const partial = bpts?.entrada && !bpts.charneira;
                                  const isBone = bone === 'femur';
                                  const calibLargura = complete && mmPorPixel
                                    ? +(Math.abs(bpts.charneira!.x - bpts.entrada.x) * mmPorPixel).toFixed(1)
                                    : null;
                                  return (
                                    <div key={bone} className={`rounded-lg border p-2.5 space-y-1.5 ${isBone ? 'border-violet-200 bg-white' : 'border-blue-200 bg-white'}`}>
                                      <div className="flex items-center justify-between gap-2 flex-wrap">
                                        <span className={`text-[10px] font-bold ${isBone ? 'text-violet-800' : 'text-blue-800'}`}>
                                          {isBone ? t("femurSupracondylar") : t("tibiaMetaphyseal")}
                                          {corrDeg > 0 && <span className="font-normal"> ({corrDeg}°)</span>}
                                        </span>
                                        {complete
                                          ? <span className="text-[10px] font-bold text-green-700 bg-green-100 px-1.5 py-0.5 rounded-full">✓ {calibLargura !== null ? `${calibLargura} mm` : t("marked")}</span>
                                          : partial
                                          ? <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full">{t("markSecondPoint")}</span>
                                          : <span className="text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-full">{t("anatomicalEstimate")}</span>
                                        }
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const phase = { bone, phase: 'entrada' as const };
                                          setBaseMarkingActive(phase);
                                          baseMarkingActiveRef.current = phase;
                                          touchSnapRef.current.baseMarkingActive = phase;
                                          setMarkingMode(true);
                                          touchSnapRef.current.markingMode = true;
                                          setStep('upload');
                                        }}
                                        className={`w-full flex items-center justify-center gap-1.5 text-xs px-3 py-2 rounded border-2 transition-all active:scale-95 font-semibold ${
                                          complete
                                            ? isBone ? 'border-violet-300 bg-white text-violet-600' : 'border-blue-300 bg-white text-blue-600'
                                            : isBone ? 'border-violet-400 bg-white text-violet-700 hover:bg-violet-50' : 'border-blue-400 bg-white text-blue-700 hover:bg-blue-50'
                                        }`}
                                      >
                                        <Ruler className="h-3 w-3" />
                                        {complete ? t("remarkTwoPoints") : partial ? t("touchSecondPoint") : t("markTwoPoints")}
                                      </button>
                                      {complete && calibLargura !== null && (
                                        <p className={`text-[10px] font-mono font-bold ${isBone ? 'text-violet-800' : 'text-blue-800'}`}>
                                          {t("measuredWidth", { value: calibLargura })}
                                        </p>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {(() => {
                            const femCalib = p4Fem?.base?.modo === 'CALIBRADO' && p4Fem.base.base_mm != null;
                            const tibCalib = p4Tib?.base?.modo === 'CALIBRADO' && p4Tib.base.base_mm != null;
                            const hasCalib = femCalib || tibCalib;
                            const femStr = femCalib
                              ? t("femoralBaseMarked", { value: p4Fem!.base.base_mm! })
                              : t("femoralBaseEstimated", { value: p4BaseFem });
                            const tibStr = tibCalib
                              ? t("tibialBaseMarked", { value: p4Tib!.base.base_mm! })
                              : t("tibialCorticesUnmarked");
                            const femAlerta = femCalib && p4Fem!.base.base_mm! < 68
                              ? t("femoralBaseWarning", { value: p4Fem!.base.base_mm! })
                              : p4Fem?.base?.alertaFaixaAnatomica ?? null;
                            const tibAlerta = tibCalib && p4Tib!.base.base_mm! < 40
                              ? t("tibialBaseWarning", { value: p4Tib!.base.base_mm! })
                              : p4Tib?.base?.alertaFaixaAnatomica ?? null;
                            return (
                              <>
                                <p className="text-[10px] text-muted-foreground">
                                  {t("miniaciFormulaBase", { femur: femStr, tibia: tibStr })}
                                  {!hasCalib && t("markEntryHinge")}
                                </p>
                                {femAlerta && <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-1 leading-snug font-medium mt-1">{femAlerta}</p>}
                                {tibAlerta && <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-1 leading-snug font-medium mt-1">{tibAlerta}</p>}
                              </>
                            );
                          })()}
                        </div>
                      ) : (
                        /* Static badges when not selected — usa base calibrada se já marcada, senão anatômica */
                        (() => {
                          // Derive calibrated base directly from the global baseMarcacoes + mmPorPixel
                          // (these are the same cortex markings the selected simulator uses — keeps values consistent)
                          const femPts = baseMarcacoes.femur;
                          const tibPts = baseMarcacoes.tibia;
                          const calibFemBase = (femPts?.entrada && femPts?.charneira && mmPorPixel)
                            ? +(Math.abs(femPts.charneira.x - femPts.entrada.x) * mmPorPixel).toFixed(1)
                            : null;
                          const calibTibBase = (tibPts?.entrada && tibPts?.charneira && mmPorPixel)
                            ? +(Math.abs(tibPts.charneira.x - tibPts.entrada.x) * mmPorPixel).toFixed(1)
                            : null;
                          const baseFem = calibFemBase ?? ANAT_BASE_FEM;
                          const baseTib = calibTibBase ?? ANAT_BASE_TIB;
                          const isEstFem = calibFemBase === null;
                          const isEstTib = calibTibBase === null;

                          return (
                            <div className="flex flex-wrap gap-2 text-xs">
                              {isDupla ? (
                                <>
                                  <span className="px-2 py-1 rounded-md border border-orange-300 text-orange-700 font-semibold bg-orange-50" title={isEstFem ? t("estimateMarkCortices") : t("calibratedBase", { value: baseFem })}>
                                    🦴 DFO: {aiCorrFemDeg}° · {isEstFem ? "~" : ""}{miniaciMm(aiCorrFemDeg, baseFem)} mm{isEstFem ? "" : " ✓"}
                                  </span>
                                  <span className="px-2 py-1 rounded-md border border-blue-300 text-blue-700 font-semibold bg-blue-50" title={isEstTib ? t("estimateMarkCortices") : t("calibratedBase", { value: baseTib })}>
                                    🦴 HTO: {aiCorrTibDeg}° · {isEstTib ? "~" : ""}{miniaciMm(aiCorrTibDeg, baseTib)} mm{isEstTib ? "" : " ✓"}
                                  </span>
                                </>
                              ) : (
                                <span className={`px-2 py-1 rounded-md border ${borderColor} ${labelColor} font-semibold`} title={isHTOBase ? (isEstTib ? t("estimate") : t("calibratedBase", { value: baseTib })) : (isEstFem ? t("estimate") : t("calibratedBase", { value: baseFem }))}>
                                  {Number(opcao.correcao)}° · {(isHTOBase ? isEstTib : isEstFem) ? "~" : ""}{miniaciMm(Number(opcao.correcao), isHTOBase ? baseTib : baseFem)} mm{(isHTOBase ? isEstTib : isEstFem) ? "" : " ✓"}
                                </span>
                              )}
                            </div>
                          );
                        })()
                      )}
                    </div>

                    {/* Alertas / notas da opção */}
                    {alertas.length > 0 && (
                      <div className="rounded-lg px-3 py-2 space-y-1 bg-amber-50 border border-amber-200">
                        {alertas.map((a, i) => (
                          <p key={i} className="text-xs flex items-start gap-1.5 text-amber-700">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                            {a}
                          </p>
                        ))}
                      </div>
                    )}
                    </div>{/* end p-4 space-y-3 */}
                  </div>
                );
              })}

            </div>
          )}


          {/* Justificativa para análises sem osteotomia */}
          {analysis.indicacaoOsteotomia === undefined && analysis.justificativa && (
            <div className="rounded-xl border bg-muted/40 p-4">
              <p className="text-sm leading-relaxed">{analysis.justificativa}</p>
            </div>
          )}

          {/* Eixo anatômico especial */}
          {analysis.valgofisiologico && (
            <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-1">
              <p className="font-medium text-xs text-muted-foreground">{t("physiologicValgus")}</p>
              <p>{t("physiologicValgusValues", { expected: analysis.valgofisiologico.esperado, found: analysis.valgofisiologico.encontrado, difference: analysis.valgofisiologico.diferenca })}</p>
            </div>
          )}

          {analysis.observacoes && analysis.observacoes !== "null" && (
            <div className="rounded-lg bg-muted/50 border p-3 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{t("observations")} </span>
              {analysis.observacoes}
            </div>
          )}

          <div
            className="sticky bottom-0 z-30 -mx-3 border-t border-border/80 bg-background/95 px-3 pt-3 shadow-[0_-6px_20px_rgba(15,23,42,0.08)] backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:px-0 md:pt-1 md:shadow-none md:backdrop-blur-none"
            style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
          >
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={handleGeneratePDF}
                disabled={generatingPdf || pdfBlockReason !== null}
                title={pdfBlockMessage ?? undefined}
                aria-describedby={pdfBlockReason ? "xray-pdf-action-reason" : undefined}
                className="bg-primary hover:bg-primary/90"
              >
                {generatingPdf
                  ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> {t("generatingPdf")}</>
                  : <><FileDown className="h-3.5 w-3.5 mr-1.5" /> {t("generatePdf")}</>
                }
              </Button>
              {saveSimulationAction && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => saveSimulationAction?.()}
                  className="md:hidden border-emerald-500 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
                >
                  <CheckCircle className="h-3.5 w-3.5 mr-1.5" /> {t("saveToReport")}
                </Button>
              )}
              {pdfShareUrl && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleOpenPDF}
                  className="border-green-600 text-green-700 hover:bg-green-50 hover:text-green-800"
                >
                  <Share2 className="h-3.5 w-3.5 mr-1.5" /> {t("openPdf")}
                </Button>
              )}
              {selectedFile && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => analyze(true)}
                  disabled={loading}
                  title={t("reanalyzeTitle")}
                >
                  {loading
                    ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> {t("reanalyzing")}</>
                    : <><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> {t("reanalyze")}</>
                  }
                </Button>
              )}
              <Button type="button" variant="outline" size="sm" onClick={reset}>
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> {t("newAnalysis")}
              </Button>
            </div>
            {pdfBlockReason && (
              <div
                id="xray-pdf-action-reason"
                role="status"
                className="mt-2 w-full rounded-lg border-2 border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800"
              >
                <p className="font-semibold">{pdfBlockMessage}</p>
                {(pdfBlockReason === "osteotomy-selection-required" || pdfBlockReason === "osteotomy-options-unavailable") && (
                  <p className="mt-0.5">
                    {pdfBlockReason === "osteotomy-selection-required"
                      ? t("pdfOsteotomySelectionRequiredDescription")
                      : t("pdfOsteotomyOptionsUnavailableDescription")}
                  </p>
                )}
                {pdfBlockReason === "simulation-unsaved" && (
                  <p className="mt-0.5">{t("pdfSimulationUnsavedDescription")}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
