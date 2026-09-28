import { useState, useRef, useCallback, useEffect } from "react";
import { Upload, RotateCcw, AlertTriangle, Info, ZoomIn, ZoomOut, Calculator } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useScopedTranslations } from "@/lib/i18n";
import { ptsAnalyzerMessages } from "@/locales/pts-analyzer";
import { classifyPTS, type PTSClassification } from "@/lib/pts-classification";
import {
  clampImagePan,
  canCommitTouchMark,
  clientToNormalizedImagePoint,
  zoomPanAtFocalPoint,
} from "@/lib/pts-image-geometry";

// ── Types ──────────────────────────────────────────────────────────────────
type Pt = { x: number; y: number };
type PointKey = "C1" | "C2" | "C3" | "C4" | "C5" | "C6" | "T1" | "T2";
type Points = Partial<Record<PointKey, Pt>>;
type Method = "A" | "B";

export interface PTSResult { pts: number; method: Method }

// ── Step metadata ─────────────────────────────────────────────────────────
const STEPS: {
  key: PointKey;
  label: string;
  color: string;
  group: "axis" | "plateau";
  instruction: string;
}[] = [
  {
    key: "C1", color: "#F59E0B", group: "axis",
    label: "C1 — Cortical ANTERIOR (nível proximal)",
    instruction: "Clique na CORTICAL ANTERIOR da tíbia no nível proximal — logo abaixo da tuberosidade tibial.",
  },
  {
    key: "C2", color: "#F59E0B", group: "axis",
    label: "C2 — Cortical POSTERIOR (nível proximal)",
    instruction: "Clique na CORTICAL POSTERIOR da tíbia no MESMO nível de C1. C1+C2 definem o 1º par do eixo.",
  },
  {
    key: "C3", color: "#D97706", group: "axis",
    label: "C3 — Cortical ANTERIOR (nível médio)",
    instruction: "Clique na CORTICAL ANTERIOR da tíbia no TERÇO MÉDIO da diáfise (nível 2).",
  },
  {
    key: "C4", color: "#D97706", group: "axis",
    label: "C4 — Cortical POSTERIOR (nível médio)",
    instruction: "Clique na CORTICAL POSTERIOR da tíbia no MESMO nível de C3. C3+C4 definem o 2º par.",
  },
  {
    key: "C5", color: "#B45309", group: "axis",
    label: "C5 — Cortical ANTERIOR (nível distal)",
    instruction: "Opção A: ~5 cm acima do tornozelo. Opção B: ~15 cm abaixo da interlinha. Cortical anterior.",
  },
  {
    key: "C6", color: "#B45309", group: "axis",
    label: "C6 — Cortical POSTERIOR (nível distal)",
    instruction: "Clique na CORTICAL POSTERIOR da tíbia no MESMO nível de C5. Eixo tibial completo com 3 pares.",
  },
  {
    key: "T1", color: "#3B82F6", group: "plateau",
    label: "T1 — Borda ANTERIOR do platô medial",
    instruction: "Clique na BORDA ÂNTERO-SUPERIOR da superfície articular do platô medial (extremidade anterior da linha do platô).",
  },
  {
    key: "T2", color: "#1D4ED8", group: "plateau",
    label: "T2 — Borda POSTERIOR do platô medial",
    instruction: "Clique na BORDA PÓSTERO-SUPERIOR da superfície articular do platô medial. A reta T1→T2 define o slope.",
  },
];

const ORDER: PointKey[] = ["C1", "C2", "C3", "C4", "C5", "C6", "T1", "T2"];

// ── Geometry helpers ───────────────────────────────────────────────────────

/** Fit tibial axis via linear regression through 3 midpoints in physical (pixel-proportional) space.
 *  ar = imageNaturalWidth / imageNaturalHeight
 *  Returns axis direction in NORMALIZED [0,1] SVG space (for drawing) and physical space (for angle calc).
 */
function fitAxis(
  M1: Pt, M2: Pt, M3: Pt, ar: number
): { dirNorm: Pt; dirPhys: Pt; avgNorm: Pt } {
  // Physical coords: x_phys = x_norm * ar, y_phys = y_norm
  const pts = [M1, M2, M3];
  const px = pts.map(p => p.x * ar);
  const py = pts.map(p => p.y);
  const avgXp = (px[0] + px[1] + px[2]) / 3;
  const avgYp = (py[0] + py[1] + py[2]) / 3;
  const sxy = pts.reduce((s, _, i) => s + (px[i] - avgXp) * (py[i] - avgYp), 0);
  const syy = pts.reduce((s, _, i) => s + (py[i] - avgYp) ** 2, 0);
  // Axis mostly vertical → fit x = a*y + b  (y = independent var)
  const a = syy > 1e-8 ? sxy / syy : 0;  // dx_phys / dy_phys
  const physLen = Math.sqrt(a * a + 1);
  const dirPhys: Pt = { x: a / physLen, y: 1 / physLen };  // normalized, points distally (y+)
  // Convert back to normalized SVG space
  const dirNormRaw = { x: dirPhys.x / ar, y: dirPhys.y };
  const normLen = Math.sqrt(dirNormRaw.x ** 2 + dirNormRaw.y ** 2);
  const dirNorm: Pt = { x: dirNormRaw.x / normLen, y: dirNormRaw.y / normLen };
  const avgNorm: Pt = { x: avgXp / ar, y: avgYp };
  return { dirNorm, dirPhys, avgNorm };
}

/** Compute the visually-correct perpendicular direction in SVG normalized space.
 *  (Accounts for non-square image so the drawn angle looks 90° on screen.)
 */
function perpSvgDir(axisNorm: Pt, ar: number): Pt {
  // Axis in screen pixels: (ax * W, ay * H); W/H = ar
  // Perp in screen: (-ay * H, ax * W)
  // Back to SVG normalized: (-ay * H/W, ax * W/H) = (-ay/ar, ax*ar)
  const rx = -axisNorm.y / ar;
  const ry = axisNorm.x * ar;
  const len = Math.sqrt(rx * rx + ry * ry);
  return { x: rx / len, y: ry / len };
}

/** Compute PTS (degrees) from all 8 points. Uses physical coords for angular accuracy. */
function calcPTS(pts: Points, ar: number): number | null {
  const { C1, C2, C3, C4, C5, C6, T1, T2 } = pts;
  if (!C1 || !C2 || !C3 || !C4 || !C5 || !C6 || !T1 || !T2) return null;
  const M1: Pt = { x: (C1.x + C2.x) / 2, y: (C1.y + C2.y) / 2 };
  const M2: Pt = { x: (C3.x + C4.x) / 2, y: (C3.y + C4.y) / 2 };
  const M3: Pt = { x: (C5.x + C6.x) / 2, y: (C5.y + C6.y) / 2 };
  const { dirPhys } = fitAxis(M1, M2, M3, ar);
  // Perpendicular to axis in physical space
  const perpP: Pt = { x: -dirPhys.y, y: dirPhys.x };
  // Plateau in physical space
  const platPhys: Pt = { x: (T2.x - T1.x) * ar, y: T2.y - T1.y };
  const magP = Math.sqrt(platPhys.x ** 2 + platPhys.y ** 2);
  if (magP < 1e-6) return null;
  // Angle between plateau and perpendicular (= PTS)
  const dot = platPhys.x * perpP.x + platPhys.y * perpP.y;
  const cosAngle = Math.min(1, Math.abs(dot) / magP);
  return Math.round((Math.acos(cosAngle) * 180 / Math.PI) * 10) / 10;
}

/** Build the display interpretation from the measured PTS classification. */
function interpretPTS(pts: unknown, _method?: Method) {
  const classification = classifyPTS(pts);
  if (classification === "normal")
    return {
      classification,
      label: "Normal",
      color: "text-green-700",
      badge: "border-green-400 text-green-700",
      desc: "Slope tibial normal (≤11°). Sem indicação isolada de osteotomia de redução de slope.",
    };
  if (classification === "borderline")
    return {
      classification,
      label: "Limítrofe",
      color: "text-amber-700",
      badge: "border-amber-400 text-amber-700",
      desc: "Slope tibial limítrofe (>11° e ≤15°). Avaliar em contexto: revisão de LCA, pivot shift 3+, hiperlaxidez generalizada.",
    };
  if (classification !== "pathological") return null;
  return {
    classification,
    label: "Patológico — Alto Risco",
    color: "text-red-700",
    badge: "border-red-400 text-red-700",
    desc: "Slope tibial elevado (>15°). Forte indicação de osteotomia de redução de slope (SRO / HTO closing-wedge) em revisão de LCA.",
  };
}

// ── Constants ─────────────────────────────────────────────────────────────
const MAG_SIZE  = 130;
const MAG_ZOOM  = 4;
const MAX_ZOOM  = 8;
const MIN_ZOOM  = 1;
const ZOOM_STEP = 1.2;

// ── Component ─────────────────────────────────────────────────────────────
interface PTSAnalyzerProps { onResult?: (result: PTSResult) => void; }

export function PTSAnalyzer({ onResult }: PTSAnalyzerProps = {}) {
  const t = useScopedTranslations(ptsAnalyzerMessages);
  const [method, setMethod]         = useState<Method>("B");
  const [imageUrl, setImageUrl]     = useState<string | null>(null);
  const [imgAr, setImgAr]           = useState(1);   // naturalWidth / naturalHeight
  const [points, setPoints]         = useState<Points>({});
  const [currentStep, setCurrentStep] = useState(0);
  const [ptsResult, setPtsResult]   = useState<PTSResult | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Zoom / pan
  const [imgZoom, setImgZoom]     = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });

  const zoomRef         = useRef(1);
  const panRef          = useRef({ x: 0, y: 0 });
  const imgArRef        = useRef(1);
  const dragState       = useRef({ active: false, startX: 0, startY: 0, px: 0, py: 0, moved: false });
  const pinchRef        = useRef<{ dist: number; cx: number; cy: number } | null>(null);
  const imgRef          = useRef<HTMLImageElement>(null);
  const containerRef    = useRef<HTMLDivElement>(null);
  const magnifierElRef  = useRef<HTMLDivElement>(null);
  const touchStateRef   = useRef<{
    mode: "none" | "marking" | "pan" | "pinch";
    startX: number;
    startY: number;
    markX: number;
    markY: number;
    startPanX: number;
    startPanY: number;
    moved: boolean;
    multiTouch: boolean;
  }>({
    mode: "none",
    startX: 0,
    startY: 0,
    markX: 0,
    markY: 0,
    startPanX: 0,
    startPanY: 0,
    moved: false,
    multiTouch: false,
  });
  const markingActiveRef = useRef(false);
  const currentStepRef   = useRef(0);
  const pointsRef        = useRef<Points>({});

  const totalSteps = ORDER.length;   // 8
  const allMarked  = currentStep >= totalSteps;
  const isDone     = ptsResult !== null;
  const step       = currentStep < totalSteps ? STEPS[currentStep] : null;
  // Native touch listeners read these refs so they never race a React render
  // while a finger is being lifted.
  markingActiveRef.current = Boolean(imageUrl && !allMarked && !isDone);
  currentStepRef.current = currentStep;
  pointsRef.current = points;
  const localizedStep = step && {
    ...step,
    label: t(`${step.key}Label` as keyof typeof ptsAnalyzerMessages["pt-BR"]),
    instruction: t(`${step.key}Instruction` as keyof typeof ptsAnalyzerMessages["pt-BR"]),
  };
  const ptsClassification: PTSClassification | null = ptsResult ? classifyPTS(ptsResult.pts) : null;
  const interpretation = ptsResult ? interpretPTS(ptsResult.pts, ptsResult.method) : null;
  const localizedInterpretation = interpretation && ptsResult
    ? ptsClassification === "normal"
      ? { ...interpretation, label: t("normal"), desc: t("normalDesc") }
      : ptsClassification === "borderline"
        ? { ...interpretation, label: t("borderline"), desc: t("borderlineDesc") }
        : ptsClassification === "pathological"
          ? { ...interpretation, label: t("highRisk"), desc: t("highRiskDesc") }
          : null
    : null;

  // ── Pan / zoom helpers ────────────────────────────────────────────────
  const clampPan = useCallback((px: number, py: number, zoom: number) => {
    const img = imgRef.current;
    const cont = containerRef.current;
    if (!img || !cont || zoom <= MIN_ZOOM) return { x: 0, y: 0 };
    return clampImagePan(
      { x: px, y: py },
      zoom,
      { width: img.clientWidth, height: img.clientHeight },
      { width: cont.clientWidth, height: cont.clientHeight },
      MIN_ZOOM,
    );
  }, []);

  const applyZoom = useCallback((nz: number, np: { x: number; y: number }) => {
    zoomRef.current = nz; panRef.current = np; setImgZoom(nz); setPanOffset(np);
  }, []);

  const hideMagnifier = useCallback(() => {
    if (magnifierElRef.current) magnifierElRef.current.style.display = "none";
  }, []);

  const resetViewport = useCallback(() => {
    pinchRef.current = null;
    touchStateRef.current.mode = "none";
    touchStateRef.current.multiTouch = false;
    applyZoom(1, { x: 0, y: 0 });
    hideMagnifier();
  }, [applyZoom, hideMagnifier]);

  const reset = useCallback(() => {
    pointsRef.current = {};
    currentStepRef.current = 0;
    setPoints({}); setCurrentStep(0); setPtsResult(null); setImageUrl(null);
    resetViewport();
  }, [resetViewport]);

  const resetPoints = useCallback(() => {
    pointsRef.current = {};
    currentStepRef.current = 0;
    setPoints({}); setCurrentStep(0); setPtsResult(null);
    resetViewport();
  }, [resetViewport]);

  const loadImage = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    pointsRef.current = {};
    currentStepRef.current = 0;
    setImageUrl(url); setPoints({}); setCurrentStep(0); setPtsResult(null);
    resetViewport();
    // Read aspect ratio after image loads
    const tmp = new Image();
    tmp.onload = () => {
      const ar = tmp.naturalWidth / tmp.naturalHeight;
      setImgAr(ar);
      imgArRef.current = ar;
    };
    tmp.src = url;
  }, [resetViewport]);

  const handleFile = useCallback((f: File) => { if (f?.type.startsWith("image/")) loadImage(f); }, [loadImage]);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const f = e.dataTransfer.files[0]; if (f) handleFile(f);
  }, [handleFile]);

  // ── Coordinate from click ────────────────────────────────────────────
  const ptFromEvent = useCallback((e: { clientX: number; clientY: number }): Pt | null => {
    const img = imgRef.current;
    if (!img) return null;
    const rect = img.getBoundingClientRect();
    return clientToNormalizedImagePoint(e.clientX, e.clientY, rect);
  }, []);

  /**
   * Position the loupe from the same transformed image rect used for point
   * placement. Its background uses the fitted, untransformed image dimensions
   * (clientWidth/clientHeight), not natural pixels or the container dimensions.
   * This keeps the crosshair on the exact source pixel after zoom and pan.
   */
  const updateMagnifier = useCallback((clientX: number, clientY: number, touch = false) => {
    const img = imgRef.current;
    const mag = magnifierElRef.current;
    const cont = containerRef.current;
    if (!img || !mag || !cont) return;
    const point = ptFromEvent({ clientX, clientY });
    if (!point) {
      mag.style.display = "none";
      return;
    }

    const cr = cont.getBoundingClientRect();
    const imageWidth = img.clientWidth || img.getBoundingClientRect().width / Math.max(zoomRef.current, 1);
    const imageHeight = img.clientHeight || img.getBoundingClientRect().height / Math.max(zoomRef.current, 1);
    if (imageWidth <= 0 || imageHeight <= 0) {
      mag.style.display = "none";
      return;
    }

    const screenX = clientX - cr.left;
    const screenY = clientY - cr.top;
    const margin = 8;
    let left = touch ? screenX + 28 : screenX - MAG_SIZE / 2;
    let top = touch ? screenY - MAG_SIZE / 2 : screenY - MAG_SIZE - 8;
    if (!touch && top < margin) top = screenY + 8;
    if (touch && left + MAG_SIZE > cr.width - margin) left = screenX - MAG_SIZE - 28;
    left = Math.max(margin, Math.min(left, cr.width - MAG_SIZE - margin));
    top = Math.max(margin, Math.min(top, cr.height - MAG_SIZE - margin));

    const bgW = imageWidth * MAG_ZOOM;
    const bgH = imageHeight * MAG_ZOOM;
    mag.style.display = "block";
    mag.style.left = `${left}px`;
    mag.style.top = `${top}px`;
    mag.style.backgroundSize = `${bgW}px ${bgH}px`;
    mag.style.backgroundPosition = `${-(point.x * bgW - MAG_SIZE / 2)}px ${-(point.y * bgH - MAG_SIZE / 2)}px`;
  }, [ptFromEvent]);

  const commitPoint = useCallback((pt: Pt) => {
    const stepIndex = currentStepRef.current;
    if (stepIndex >= totalSteps || !markingActiveRef.current) return;
    const key = ORDER[stepIndex];
    const nextPoints = { ...pointsRef.current, [key]: pt };
    pointsRef.current = nextPoints;
    currentStepRef.current = stepIndex + 1;
    setPoints(nextPoints);
    setCurrentStep(stepIndex + 1);
  }, [totalSteps]);

  // ── Marking click ───────────────────────────────────────────────────
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (dragState.current.moved) { dragState.current.moved = false; return; }
    if (!imageUrl || allMarked || isDone) return;
    const pt = ptFromEvent(e);
    if (!pt) return;
    const key = ORDER[currentStep];
    const np = { ...points, [key]: pt };
    pointsRef.current = np;
    currentStepRef.current = currentStep + 1;
    setPoints(np);
    setCurrentStep(currentStep + 1);
  }, [imageUrl, currentStep, allMarked, isDone, points, ptFromEvent]);

  // ── Generate analysis ────────────────────────────────────────────────
  const handleGenerateAnalysis = useCallback(() => {
    const val = calcPTS(points, imgArRef.current);
    if (val === null) return;
    const result: PTSResult = { pts: val, method };
    setPtsResult(result);
    onResult?.(result);
  }, [points, method, onResult]);

  const undoLast = () => {
    if (currentStep === 0) return;
    const prev = currentStep - 1;
    const np = { ...points }; delete np[ORDER[prev]];
    pointsRef.current = np;
    currentStepRef.current = prev;
    setPoints(np); setCurrentStep(prev);
    if (ptsResult) setPtsResult(null);
  };

  // ── Wheel zoom ───────────────────────────────────────────────────────
  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const factor  = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    const nz      = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoomRef.current * factor));
    const scale   = nz / zoomRef.current;
    const cont    = containerRef.current;
    let npx = panRef.current.x, npy = panRef.current.y;
    if (cont) {
      const rect = cont.getBoundingClientRect();
      const cx = e.clientX - (rect.left + rect.width  / 2);
      const cy = e.clientY - (rect.top  + rect.height / 2);
      npx = cx * (1 - scale) + panRef.current.x * scale;
      npy = cy * (1 - scale) + panRef.current.y * scale;
    }
    applyZoom(nz, nz <= 1 ? { x: 0, y: 0 } : clampPan(npx, npy, nz));
  }, [clampPan, applyZoom]);

  // ── Mouse pan ───────────────────────────────────────────────────────
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (zoomRef.current <= 1) return;
    dragState.current = { active: true, startX: e.clientX, startY: e.clientY, px: panRef.current.x, py: panRef.current.y, moved: false };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (dragState.current.active) {
      hideMagnifier();
      const dx = e.clientX - dragState.current.startX;
      const dy = e.clientY - dragState.current.startY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragState.current.moved = true;
      const c = clampPan(dragState.current.px + dx, dragState.current.py + dy, zoomRef.current);
      panRef.current = c; setPanOffset(c);
      return;
    }
    updateMagnifier(e.clientX, e.clientY);
  }, [clampPan, hideMagnifier, updateMagnifier]);

  const handleMouseUp = useCallback(() => { dragState.current.active = false; }, []);

  // ── Touch pinch-zoom + pan ───────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    // The canvas is conditionally rendered after upload. The initial effect
    // runs while containerRef is null, so imageUrl must be a dependency to
    // bind native listeners when the actual image node mounts (and replace
    // them when a new upload replaces that node).
    if (!imageUrl || !el) return;
    function getTouchDist(t: TouchList) {
      const dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }
    function isViewportResetTarget(target: EventTarget | null) {
      return (target as HTMLElement)?.closest?.("[data-viewport-reset]");
    }
    function onTouchStart(e: TouchEvent) {
      // Let the explicit viewport reset button receive its normal click.
      if (isViewportResetTarget(e.target)) return;

      if (e.touches.length >= 2) {
        e.preventDefault();
        const ts = touchStateRef.current;
        // A second finger always aborts the pending mark. It still starts a
        // pinch, so the surgeon can zoom during marking without committing the
        // first finger's target when the gesture ends.
        const markingWasPending = markingActiveRef.current || ts.mode === "marking";
        if (markingWasPending) {
          ts.multiTouch = true;
          hideMagnifier();
        }
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        pinchRef.current = { dist: getTouchDist(e.touches), cx, cy };
        ts.mode = "pinch";
        ts.moved = true;
        return;
      }

      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      const ts = touchStateRef.current;
      e.preventDefault();
      ts.startX = t.clientX;
      ts.startY = t.clientY;
      ts.markX = t.clientX;
      ts.markY = t.clientY;
      ts.startPanX = panRef.current.x;
      ts.startPanY = panRef.current.y;
      ts.moved = false;
      ts.multiTouch = false;

      if (markingActiveRef.current) {
        ts.mode = "marking";
        updateMagnifier(t.clientX, t.clientY, true);
      } else if (zoomRef.current > MIN_ZOOM) {
        ts.mode = "pan";
        hideMagnifier();
      } else {
        // There is no point to place and no viewport to pan at 1×.
        ts.mode = "none";
        hideMagnifier();
      }
    }
    function onTouchMove(e: TouchEvent) {
      const ts = touchStateRef.current;
      if (ts.mode === "none") return;
      if (ts.mode === "pinch" && e.touches.length >= 2 && pinchRef.current) {
        e.preventDefault();
        const nd = getTouchDist(e.touches), factor = nd / pinchRef.current.dist;
        const nz = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoomRef.current * factor));
        const cr = el!.getBoundingClientRect();
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const img = imgRef.current;
        if (!img) return;
        const raw = zoomPanAtFocalPoint(
          zoomRef.current,
          panRef.current,
          nz,
          midX,
          midY,
          cr,
          { width: img.clientWidth, height: img.clientHeight },
        );
        const clamped = clampPan(raw.x, raw.y, nz);
        zoomRef.current = nz; panRef.current = clamped;
        setImgZoom(nz); setPanOffset(clamped);
        pinchRef.current.dist = nd; pinchRef.current.cx = midX; pinchRef.current.cy = midY;
      } else if (ts.mode === "pan" && e.touches.length === 1) {
        e.preventDefault();
        const dx = e.touches[0].clientX - ts.startX;
        const dy = e.touches[0].clientY - ts.startY;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) ts.moved = true;
        const c = clampPan(ts.startPanX + dx, ts.startPanY + dy, zoomRef.current);
        panRef.current = c; setPanOffset(c);
      } else if (ts.mode === "marking" && e.touches.length === 1) {
        e.preventDefault();
        if (ts.multiTouch) return;
        const t = e.touches[0];
        // Keep a resting finger from making the target drift. Once it travels
        // beyond the dead-zone, the loupe follows exactly.
        if (Math.hypot(t.clientX - ts.markX, t.clientY - ts.markY) < 2.5) return;
        ts.markX = t.clientX;
        ts.markY = t.clientY;
        ts.moved = true;
        updateMagnifier(t.clientX, t.clientY, true);
      }
    }
    function onTouchEnd(e: TouchEvent) {
      if (isViewportResetTarget(e.target)) return;
      const ts = touchStateRef.current;
      if (ts.mode === "marking") {
        hideMagnifier();
        if (!canCommitTouchMark(ts.mode, ts.multiTouch, e.touches.length)) {
          // A second finger or a remaining finger invalidates this gesture.
          // Only reset after every finger is lifted.
          if (e.touches.length === 0) {
            ts.mode = "none";
            ts.multiTouch = false;
          }
          return;
        }
        const point = ptFromEvent({ clientX: ts.markX, clientY: ts.markY });
        if (point) commitPoint(point);
        ts.mode = "none";
        ts.multiTouch = false;
        return;
      }

      if (ts.mode === "pinch") {
        pinchRef.current = null;
        if (e.touches.length === 1 && zoomRef.current > MIN_ZOOM) {
          const t = e.touches[0];
          ts.mode = "pan";
          ts.startX = t.clientX;
          ts.startY = t.clientY;
          ts.startPanX = panRef.current.x;
          ts.startPanY = panRef.current.y;
        } else if (e.touches.length === 0) {
          ts.mode = "none";
        }
        return;
      }
      if (ts.mode === "pan" && e.touches.length === 0) ts.mode = "none";
    }
    function onTouchCancel() {
      // touchcancel never commits a pending point (iOS can emit it when the
      // browser interrupts a gesture or the page begins a native transition).
      touchStateRef.current.mode = "none";
      touchStateRef.current.multiTouch = false;
      pinchRef.current = null;
      hideMagnifier();
    }
    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove",  onTouchMove,  { passive: false });
    el.addEventListener("touchend",   onTouchEnd);
    el.addEventListener("touchcancel", onTouchCancel);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove",  onTouchMove);
      el.removeEventListener("touchend",   onTouchEnd);
      el.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [clampPan, commitPoint, hideMagnifier, imageUrl, ptFromEvent, updateMagnifier]);

  // ── Derived SVG geometry ─────────────────────────────────────────────
  const svgGeometry = (() => {
    const { C1, C2, C3, C4, C5, C6, T1, T2 } = points;
    const M1 = C1 && C2 ? { x: (C1.x + C2.x) / 2, y: (C1.y + C2.y) / 2 } : null;
    const M2 = C3 && C4 ? { x: (C3.x + C4.x) / 2, y: (C3.y + C4.y) / 2 } : null;
    const M3 = C5 && C6 ? { x: (C5.x + C6.x) / 2, y: (C5.y + C6.y) / 2 } : null;
    const ar = imgAr;

    let axisDir: Pt | null = null;
    let axisAvg: Pt | null = null;
    let perpDir: Pt | null = null;

    if (M1 && M3) {
      // Use M1+M3 for direction when M2 not yet available; upgrade to regression when M2 available
      const m1 = M1, m2 = M2 ?? { x: (M1.x + M3.x) / 2, y: (M1.y + M3.y) / 2 }, m3 = M3;
      const f = fitAxis(m1, m2, m3, ar);
      axisDir = f.dirNorm;
      axisAvg = f.avgNorm;
      perpDir = perpSvgDir(axisDir, ar);
    } else if (M1 && M2) {
      // Only 2 pairs: use simple direction
      const dx = (M2.x - M1.x) / ar, dy = M2.y - M1.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 1e-6) {
        const dn = { x: dx / len / ar, y: dy / len };
        const dnLen = Math.sqrt(dn.x ** 2 + dn.y ** 2);
        axisDir = { x: dn.x / dnLen, y: dn.y / dnLen };
        axisAvg = { x: (M1.x + M2.x) / 2, y: (M1.y + M2.y) / 2 };
        perpDir = perpSvgDir(axisDir, ar);
      }
    }

    // Intermediate PTS for live preview (once all cortical points are done)
    const livePts = (C1 && C2 && C3 && C4 && C5 && C6 && T1 && T2)
      ? calcPTS(points, ar)
      : null;

    return { M1, M2, M3, axisDir, axisAvg, perpDir, T1, T2, livePts };
  })();

  const cursorStyle = isDone
    ? "default"
    : imgZoom > 1 && dragState.current.active
    ? "grabbing"
    : imgZoom > 1
    ? "grab"
    : "crosshair";
  const imageViewportAdjusted = imgZoom > MIN_ZOOM + 0.01
    || Math.abs(panOffset.x) > 1
    || Math.abs(panOffset.y) > 1;

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 border-2 border-teal-200 rounded-xl p-4 bg-teal-50/30">

      {/* ── Header ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-teal-900 text-sm sm:text-base">
             {t("title")}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
             {t("subtitle")}
          </p>
          <div className="mt-1.5 space-y-0.5 border-t border-teal-100 pt-1.5">
            <p className="text-[10px] text-teal-500 leading-snug">
              Khan AM, et al. <em>Arthrosc Tech.</em> 2026;15:e70000. · Dean RS, et al. <em>Arthroscopy.</em> 2021;37(1):243-249.
            </p>
            <p className="text-[10px] text-teal-500 leading-snug">
              Vieider RP, et al. <em>Knee Surg Sports Traumatol Arthrosc.</em> 2024;32(6):1462-1469.
            </p>
          </div>
        </div>
        {imageUrl && (
          <Button type="button" variant="ghost" size="sm" onClick={reset} className="text-muted-foreground w-full sm:w-auto shrink-0">
            <RotateCcw className="h-3.5 w-3.5 mr-1" /> {t("restart")}
          </Button>
        )}
      </div>

      {/* ── Method selector ── */}
      <div className="space-y-1.5">
        <p className="text-xs font-semibold text-teal-800">{t("acquisition")}</p>
        <div className="flex gap-2 flex-wrap">
          {(["A", "B"] as Method[]).map(m => (
            <button key={m} type="button" onClick={() => setMethod(m)} className={cn(
              "flex-1 sm:flex-none text-xs px-3 py-2 rounded-lg border-2 font-medium transition-colors text-left",
              method === m
                ? "border-teal-500 bg-teal-100 text-teal-900"
                : "border-slate-200 bg-white text-muted-foreground hover:border-teal-300"
            )}>
              <span className="font-bold">{m === "A" ? t("optionA") : t("optionB")}</span>
              <span className="block text-[10px] font-normal mt-0.5 opacity-80">
                {m === "A"
                  ? t("optionADesc") : t("optionBDesc")}
              </span>
            </button>
          ))}
        </div>
        {method === "B" && (
          <div className="flex items-start gap-1.5 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
               {t("methodBWarning")}
            </span>
          </div>
        )}
      </div>

      {/* ── Upload zone ── */}
      {!imageUrl && (
        <div
          onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => document.getElementById("pts-upload")?.click()}
          className={cn(
            "border-2 border-dashed rounded-xl flex flex-col items-center justify-center cursor-pointer transition-colors min-h-[160px] text-center px-4",
            isDragging ? "border-teal-400 bg-teal-50" : "border-teal-200 bg-white hover:bg-teal-50/40"
          )}
        >
          <Upload className="h-8 w-8 text-teal-400 mb-2" />
           <p className="text-sm font-medium text-teal-800">{t("upload")}</p>
           <p className="text-xs text-muted-foreground mt-1">{t("uploadHint")}</p>
          <input id="pts-upload" type="file" accept="image/*" className="hidden"
            onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
        </div>
      )}

      {/* ── Image + marking ── */}
      {imageUrl && (
        <div className="space-y-3">

          {/* Progress */}
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-slate-100 rounded-full h-1.5 overflow-hidden">
              <div className="bg-teal-500 h-1.5 rounded-full transition-all"
                style={{ width: `${(Math.min(currentStep, totalSteps) / totalSteps) * 100}%` }} />
            </div>
            <span className="text-xs text-muted-foreground shrink-0">{Math.min(currentStep, totalSteps)}/{totalSteps}</span>
          </div>

          {/* Step guide */}
          {localizedStep && !isDone && (
            <div className={cn(
              "flex items-start gap-2 rounded-lg px-3 py-2 border text-xs",
               localizedStep.group === "axis"
                ? "bg-amber-50 border-amber-200 text-amber-900"
                : "bg-blue-50 border-blue-200 text-blue-900"
            )}>
              <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5"
                 style={{ background: localizedStep.color, color: "#fff" }}>
                {currentStep + 1}
              </div>
              <div>
                 <p className="font-semibold">{localizedStep.label}</p>
                 <p className="mt-0.5 opacity-90">{localizedStep.instruction}</p>
                <p className="mt-1 opacity-60 italic">
                   {localizedStep.group === "axis"
                     ? t("axisGroup") : t("plateauGroup")}
                </p>
              </div>
            </div>
          )}

          {/* Zoom controls */}
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => {
              const nz = Math.max(MIN_ZOOM, zoomRef.current / ZOOM_STEP);
              applyZoom(nz, nz <= 1 ? { x: 0, y: 0 } : clampPan(panRef.current.x, panRef.current.y, nz));
            }} aria-label={t("zoomOut")} className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-30" disabled={imgZoom <= 1}>
              <ZoomOut className="h-3.5 w-3.5 text-slate-600" />
            </button>
            <div className="flex-1 bg-slate-100 rounded-full h-1.5 overflow-hidden">
              <div className="bg-teal-400 h-1.5 rounded-full transition-all"
                style={{ width: `${((imgZoom - 1) / (MAX_ZOOM - 1)) * 100}%` }} />
            </div>
            <button type="button" onClick={() => {
              const nz = Math.min(MAX_ZOOM, zoomRef.current * ZOOM_STEP);
              applyZoom(nz, clampPan(panRef.current.x, panRef.current.y, nz));
             }} aria-label={t("zoomIn")} className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-30" disabled={imgZoom >= MAX_ZOOM}>
              <ZoomIn className="h-3.5 w-3.5 text-slate-600" />
            </button>
            <span className="text-[10px] text-muted-foreground w-10 text-right shrink-0">{imgZoom.toFixed(1)}×</span>
          </div>
          <p className="text-[10px] text-muted-foreground -mt-1">
             {t("zoomHelp")}
          </p>

          {/* Canvas */}
          <div
            ref={containerRef}
            className="relative rounded-xl overflow-hidden select-none bg-black"
            style={{
              cursor: cursorStyle,
              touchAction: "none",           // impede o iOS de capturar pinça antes do JS
              WebkitTouchCallout: "none" as React.CSSProperties["WebkitTouchCallout"],
              WebkitUserSelect: "none",
              userSelect: "none",
            }}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => { dragState.current.active = false; hideMagnifier(); }}
            onClick={handleCanvasClick}
            onContextMenu={(e) => e.preventDefault()}
          >
            {imageViewportAdjusted && (
              <button
                type="button"
                data-viewport-reset
                aria-label={t("fitImageAria")}
                title={t("fitImageTitle")}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); resetViewport(); }}
                className="absolute top-2 right-2 z-50 h-9 px-3 rounded-full bg-black/85 border border-white/25 shadow-lg text-white flex items-center gap-2 pointer-events-auto select-none hover:bg-black active:scale-95 transition-all"
                style={{ touchAction: "auto" }}
              >
                <span className="text-xs font-semibold">{t("fitImage")}</span>
                <span className="min-w-7 h-6 px-1.5 rounded-full bg-white/15 flex items-center justify-center text-xs font-bold font-mono">
                  1×
                </span>
              </button>
            )}
            <div style={{
              transform: `scale(${imgZoom}) translate(${panOffset.x / imgZoom}px, ${panOffset.y / imgZoom}px)`,
              transformOrigin: "center center",
              width: "100%",
              position: "relative",
              willChange: "transform",
            }}>
              <img
                ref={imgRef}
                src={imageUrl}
                alt={t("imageAlt")}
                className="w-full block"
                draggable={false}
                onContextMenu={(e) => e.preventDefault()}
                onDragStart={(e) => e.preventDefault()}
                style={{
                  pointerEvents: "none",
                  WebkitTouchCallout: "none" as React.CSSProperties["WebkitTouchCallout"],
                  WebkitUserSelect: "none",
                  userSelect: "none",
                }}
              />

              {/* ── SVG overlays ── */}
              {/* ── SVG overlays ──
                  IMPORTANTE: vectorEffect="non-scaling-stroke" faz o strokeWidth ser em
                  pixels de tela (não em unidades do viewBox [0,1]).
                  Por isso strokeWidth deve ser ≥ 1 para ser visível. */}
              <svg
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" }}
                viewBox="0 0 1 1" preserveAspectRatio="none"
              >
                {/* Cortical pair connector lines (thin white dashed) */}
                {points.C1 && points.C2 && <line x1={points.C1.x} y1={points.C1.y} x2={points.C2.x} y2={points.C2.y} stroke="rgba(255,255,255,0.6)" strokeWidth="1" strokeDasharray="5,3" vectorEffect="non-scaling-stroke" />}
                {points.C3 && points.C4 && <line x1={points.C3.x} y1={points.C3.y} x2={points.C4.x} y2={points.C4.y} stroke="rgba(255,255,255,0.6)" strokeWidth="1" strokeDasharray="5,3" vectorEffect="non-scaling-stroke" />}
                {points.C5 && points.C6 && <line x1={points.C5.x} y1={points.C5.y} x2={points.C6.x} y2={points.C6.y} stroke="rgba(255,255,255,0.6)" strokeWidth="1" strokeDasharray="5,3" vectorEffect="non-scaling-stroke" />}

                {/* Midpoints (yellow dots) — r em unidades do viewBox (não afetado por vectorEffect) */}
                {svgGeometry.M1 && <circle cx={svgGeometry.M1.x} cy={svgGeometry.M1.y} r="0.012" fill="#FBBF24" stroke="white" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
                {svgGeometry.M2 && <circle cx={svgGeometry.M2.x} cy={svgGeometry.M2.y} r="0.012" fill="#FBBF24" stroke="white" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
                {svgGeometry.M3 && <circle cx={svgGeometry.M3.x} cy={svgGeometry.M3.y} r="0.012" fill="#FBBF24" stroke="white" strokeWidth="1" vectorEffect="non-scaling-stroke" />}

                {/* Yellow tibial axis line (extended beyond image bounds, clipped by overflow:visible + container) */}
                {svgGeometry.axisDir && svgGeometry.axisAvg && (() => {
                  const { axisDir: d, axisAvg: a } = svgGeometry;
                  const t = 2;
                  return (
                    <line
                      x1={a!.x - t * d!.x} y1={a!.y - t * d!.y}
                      x2={a!.x + t * d!.x} y2={a!.y + t * d!.y}
                      stroke="#FBBF24" strokeWidth="2" vectorEffect="non-scaling-stroke"
                    />
                  );
                })()}

                {/* White perpendicular at T1 (linha perpendicular ao eixo tibial) */}
                {svgGeometry.perpDir && svgGeometry.T1 && (() => {
                  const { perpDir: p, T1: t1 } = svgGeometry;
                  const ext = 0.22;
                  return (
                    <line
                      x1={t1!.x - ext * p!.x} y1={t1!.y - ext * p!.y}
                      x2={t1!.x + ext * p!.x} y2={t1!.y + ext * p!.y}
                      stroke="white" strokeWidth="2" vectorEffect="non-scaling-stroke"
                    />
                  );
                })()}

                {/* Blue plateau line T1→T2 (extended slightly) */}
                {svgGeometry.T1 && svgGeometry.T2 && (() => {
                  const t1 = svgGeometry.T1!, t2 = svgGeometry.T2!;
                  const dx = t2.x - t1.x, dy = t2.y - t1.y;
                  const ext = 0.04;
                  return (
                    <line
                      x1={t1.x - ext * dx} y1={t1.y - ext * dy}
                      x2={t2.x + ext * dx} y2={t2.y + ext * dy}
                      stroke="#3B82F6" strokeWidth="2.5" vectorEffect="non-scaling-stroke"
                    />
                  );
                })()}

                {/* Angle arc at T1 */}
                {svgGeometry.livePts !== null && svgGeometry.T1 && svgGeometry.perpDir && svgGeometry.T2 && (() => {
                  // Small arc showing the angle — drawn as text label badge instead
                  return null;
                })()}
              </svg>

              {/* Marked point dots */}
              {ORDER.map(key => {
                const pt = points[key];
                if (!pt) return null;
                const meta = STEPS.find(s => s.key === key)!;
                return (
                  <div key={key} style={{
                    position: "absolute",
                    left: `${pt.x * 100}%`, top: `${pt.y * 100}%`,
                    transform: "translate(-50%, -50%)", pointerEvents: "none",
                  }}>
                    <div style={{
                      width: 22, height: 22, borderRadius: "50%",
                      background: meta.color, border: "2px solid white",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      boxShadow: "0 1px 5px rgba(0,0,0,0.6)",
                    }}>
                      <span style={{ fontSize: 7, color: "#fff", fontWeight: 700 }}>{key}</span>
                    </div>
                  </div>
                );
              })}

              {/* Live PTS badge on image */}
              {svgGeometry.livePts !== null && svgGeometry.T1 && (
                <div style={{
                  position: "absolute",
                  left: `${(svgGeometry.T1.x + 0.04) * 100}%`,
                  top: `${(svgGeometry.T1.y - 0.06) * 100}%`,
                  pointerEvents: "none",
                  transform: "translate(0, -50%)",
                }}>
                  <div style={{
                    background: "rgba(0,0,0,0.75)",
                    color: "#fff",
                    borderRadius: 6,
                    padding: "2px 6px",
                    fontSize: 11,
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                    border: "1px solid rgba(255,255,255,0.3)",
                  }}>
                    PTS ≈ {svgGeometry.livePts}°
                  </div>
                </div>
              )}
            </div>

            {/* Magnifier loupe */}
            {imageUrl && (
              <div ref={magnifierElRef} style={{
                display: "none", position: "absolute",
                width: MAG_SIZE, height: MAG_SIZE,
                borderRadius: "50%", overflow: "hidden",
                border: "2px solid rgba(255,255,255,0.85)",
                boxShadow: "0 2px 12px rgba(0,0,0,0.55)",
                backgroundImage: `url(${imageUrl})`,
                backgroundRepeat: "no-repeat",
                pointerEvents: "none", zIndex: 40,
              }}>
                <svg width={MAG_SIZE} height={MAG_SIZE} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                  <line x1={MAG_SIZE/2-20} y1={MAG_SIZE/2} x2={MAG_SIZE/2-6} y2={MAG_SIZE/2} stroke="#facc15" strokeWidth="1.5" />
                  <line x1={MAG_SIZE/2+6}  y1={MAG_SIZE/2} x2={MAG_SIZE/2+20} y2={MAG_SIZE/2} stroke="#facc15" strokeWidth="1.5" />
                  <line x1={MAG_SIZE/2} y1={MAG_SIZE/2-20} x2={MAG_SIZE/2} y2={MAG_SIZE/2-6}  stroke="#facc15" strokeWidth="1.5" />
                  <line x1={MAG_SIZE/2} y1={MAG_SIZE/2+6}  x2={MAG_SIZE/2} y2={MAG_SIZE/2+20} stroke="#facc15" strokeWidth="1.5" />
                </svg>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            {currentStep > 0 && !isDone && (
              <Button type="button" variant="outline" size="sm" className="text-xs flex-1" onClick={undoLast}>
                {t("undo")}
              </Button>
            )}
            {isDone && (
              <Button type="button" variant="outline" size="sm" className="text-xs flex-1 text-teal-700 border-teal-300" onClick={resetPoints}>
                <RotateCcw className="h-3.5 w-3.5 mr-1" /> {t("newMarking")}
              </Button>
            )}
          </div>

          {/* Generate button */}
          {allMarked && !isDone && (
            <button
              type="button"
              onClick={handleGenerateAnalysis}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-teal-600 hover:bg-teal-700 active:bg-teal-800 text-white font-semibold text-sm py-3 transition-colors shadow-md"
            >
              <Calculator className="h-4 w-4" />
              {t("calculate")}
            </button>
          )}

          {/* Results card */}
          {ptsResult && localizedInterpretation && (
            <div className="rounded-xl border-2 border-teal-300 bg-teal-50 p-4 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                    Slope Tibial Posterior (PTS)
                  </p>
                  <div className="flex items-baseline gap-2 mt-0.5">
                    <span className="text-4xl font-bold text-teal-900">{ptsResult.pts}°</span>
                    <span className="text-sm text-muted-foreground">± 1,5°</span>
                  </div>
                </div>
                <div className="text-right">
                  <Badge variant="outline" className={cn("text-xs mb-1", localizedInterpretation.badge)}>
                    {localizedInterpretation.label}
                  </Badge>
                  <p className="text-[10px] text-muted-foreground block">
                    {ptsResult.method === "A" ? t("methodAResult") : t("methodBResult")}
                  </p>
                </div>
              </div>

              {/* Threshold ruler */}
              <div className="flex items-center gap-0 text-[10px] font-medium rounded-lg overflow-hidden">
                <div className={cn("flex-1 py-1 text-center", ptsClassification === "normal" ? "bg-green-500 text-white" : "bg-green-100 text-green-700")}>{t("normalRange")} {t("normal")}</div>
                <div className={cn("flex-1 py-1 text-center", ptsClassification === "borderline" ? "bg-amber-500 text-white" : "bg-amber-100 text-amber-700")}>{t("borderlineRange")} {t("borderline")}</div>
                <div className={cn("flex-1 py-1 text-center", ptsClassification === "pathological" ? "bg-red-500 text-white" : "bg-red-100 text-red-700")}>{t("highRiskRange")} {t("highRisk")}</div>
              </div>

              <div className="text-xs text-teal-800 bg-white/60 rounded-lg px-3 py-2 border border-teal-200">
                <p className="font-semibold">{t("clinicalInterpretation")}</p>
                <p className="mt-0.5">{localizedInterpretation.desc}</p>
                {ptsResult.method === "B" && (
                  <p className="mt-1.5 text-amber-700 font-medium">
                    {t("methodBResultWarning")}
                  </p>
                )}
              </div>

              <div className="border-t border-teal-200 pt-2">
                <p className="text-[10px] text-muted-foreground leading-snug">
                  <span className="font-medium">{t("legend")}</span>{" "}
                  <span style={{ color: "#FBBF24" }}>●</span> {t("legendAxis")}{" "}
                  <span style={{ color: "#000" }}>●</span> {t("legendPerpendicular")}{" "}
                  <span style={{ color: "#3B82F6" }}>●</span> {t("legendPlateau")}
                </p>
              </div>
            </div>
          )}

          {/* Point summary */}
          {Object.keys(points).length > 0 && (
            <div className="text-[10px] text-muted-foreground">
              <span className="font-medium">{t("markedPoints")}</span>{" "}
              {ORDER.filter(k => points[k]).map(k => {
                const s = STEPS.find(x => x.key === k)!;
                return (
                  <span key={k} className="inline-flex items-center gap-0.5 mr-1">
                    <span style={{ color: s.color }}>●</span>{k}
                  </span>
                );
              })}
            </div>
          )}

          {/* Info box */}
          <div className="flex items-start gap-2 text-xs text-muted-foreground bg-slate-50 rounded-lg px-3 py-2 border">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              <strong>{t("recommendedOrder")}</strong> {t("orderHelp")}
              {method === "A"
                ? t("optionAHelp") : t("optionBHelp")}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
