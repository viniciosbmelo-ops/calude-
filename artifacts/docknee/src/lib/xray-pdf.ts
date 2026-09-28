import jsPDF from "jspdf";
import type { Locale } from "./i18n";
import { documentDate, documentText, generatedDocumentText, type DocumentMessageKey } from "@/locales/document-locales";

interface XRayAnalysis {
  raciocinioVisual?: string;
  eixoMecanico?: { desvio: string; graus: number };
  eixoAnatomico?: { desvio: string; graus: number };
  mLDFA?: { valor: number; referencia: string; status: string };
  aMPTA?: { valor: number; referencia: string; status: string };
  JLCA?: { valor: number; referencia: string; status: string };
  MAD?: { valor: number; unidade: string; lado: string; status: string };
  percentualWBL?: { valor?: number; preCorrecao?: number; posCorrecao?: number; alvo?: string };
  origemDesvio?: string;
  grauVaro?: string;
  indicacaoOsteotomia?: boolean;
  tipoOsteotomia?: string;
  nivelOsteotomia?: string;
  anguloCorrecao?: number;
  metaCorrecao?: string;
  contribuicaoFemoral?: number;
  contribuicaoTibial?: number;
  contribuicaoArticular?: number;
  planoFemoral?: { indicado: boolean; correcaoNecessaria: number; tecnica: string; justificativaTecnica: string };
  planoTibial?: { indicado: boolean; correcaoNecessaria: number; tecnica: string; justificativaTecnica: string };
  valgofisiologico?: { esperado: string; encontrado: number; diferenca: number };
  membrosAvaliados?: string;
  justificativa: string;
  qualidadeImagem: string;
  observacoes?: string;
  tipoAnalise?: string;
  ladoAvaliado?: string;
  opcoesOsteotomia?: unknown[];
  /** Persisted physician choice. Never infer this from `padrao`. */
  _selectedOsteotomiaIdx?: number | null;
  _selectedOsteotomiaId?: string | null;
  alertas?: string[];
  deformidadeExtraArticular?: {
    presente: boolean;
    osso: string;
    amaFemoral: number;
    divergenciaTibial: number;
    femoralBowing: boolean;
    tibialBowing: boolean;
    recomendacao: string;
    femDesvioDir?: string;
    anguloCoraFemoral?: number | null;
    anguloCoraTibial?: number | null;
    anguloCoraFemoralMedido?: number | null;
    anguloCoraTibialMedido?: number | null;
  };
}

type OsteotomySelectionAnalysis = Pick<XRayAnalysis, "indicacaoOsteotomia" | "opcoesOsteotomia">;

export type XRayPdfBlockReason =
  | "analysis-unavailable"
  | "osteotomy-selection-required"
  | "osteotomy-options-unavailable"
  | "simulation-unsaved"
  | "xray-image-unavailable";

/**
 * The standalone analyzer keeps the RX in component state.  A preview is
 * normally available, but a browser can lose the object URL while the File is
 * still selected (for example after a mobile view transition).  Keep the
 * source-selection policy separate from capture so the caller can use the
 * original File without inventing persistence.
 */
export type XRayPdfImageSource =
  | { kind: "preview"; value: string }
  | { kind: "saved"; value: string }
  | { kind: "file"; value: File };

export type XRayPdfImageAcquisition = "local" | "remote";

export function selectXRayPdfImageSource(
  previewUrl: string | null | undefined,
  savedImageUrl: string | null | undefined,
  selectedFile: File | null | undefined,
): XRayPdfImageSource | null {
  if (previewUrl) return { kind: "preview", value: previewUrl };
  if (selectedFile) return { kind: "file", value: selectedFile };
  if (savedImageUrl) return { kind: "saved", value: savedImageUrl };
  return null;
}

/**
 * Local browser image sources must never be sent through fetch: the app CSP
 * allows them in an <img> but deliberately does not allow fetch(blob:...).
 * Data URLs are already decoded data, while a selected File is read by the
 * caller with FileReader. Persisted/storage URLs remain remote sources.
 */
export function getXRayPdfImageAcquisition(
  source: XRayPdfImageSource,
): XRayPdfImageAcquisition {
  if (source.kind === "file") return "local";
  return /^(blob:|data:)/i.test(source.value) ? "local" : "remote";
}

export function resolveXRayPdfImageDataUrl(
  source: XRayPdfImageSource,
  readers: {
    readFile: (file: File) => Promise<string>;
    fetchRemote: (url: string) => Promise<string>;
  },
): Promise<string> {
  if (source.kind === "file") return readers.readFile(source.value);
  if (getXRayPdfImageAcquisition(source) === "local") {
    return Promise.resolve(source.value);
  }
  return readers.fetchRemote(source.value);
}

export function getXRayPdfBlockReason(
  analysis: OsteotomySelectionAnalysis | null | undefined,
  selectedOsteotomiaIdx: number | null | undefined,
  hasImageSource: boolean,
  hasUnsavedSimulation = false,
): XRayPdfBlockReason | null {
  if (!analysis) return "analysis-unavailable";
  if (analysis.indicacaoOsteotomia === true && !Array.isArray(analysis.opcoesOsteotomia)) {
    return "osteotomy-options-unavailable";
  }
  if (isOsteotomySelectionRequired(analysis) && !isValidOsteotomySelection(analysis, selectedOsteotomiaIdx)) {
    return Array.isArray(analysis.opcoesOsteotomia) && analysis.opcoesOsteotomia.length > 0
      ? "osteotomy-selection-required"
      : "osteotomy-options-unavailable";
  }
  if (hasUnsavedSimulation) return "simulation-unsaved";
  if (!hasImageSource) return "xray-image-unavailable";
  return null;
}

export function isCurrentXRayPdfGeneration(
  currentGeneration: number,
  capturedGeneration: number,
): boolean {
  return currentGeneration === capturedGeneration;
}

/**
 * An indicated plan or a legacy list of surgical options is a clinical
 * decision, not an AI default. Keep this predicate in the PDF module so every
 * caller (including the saved-surgery view) applies the same rule before
 * exporting.
 */
export function isOsteotomySelectionRequired(
  analysis: OsteotomySelectionAnalysis,
): boolean {
  return analysis.indicacaoOsteotomia === true
    || (Array.isArray(analysis.opcoesOsteotomia) && analysis.opcoesOsteotomia.length > 0);
}

export function isValidOsteotomySelection(
  analysis: OsteotomySelectionAnalysis,
  selectedOsteotomiaIdx: number | null | undefined,
): boolean {
  return Number.isInteger(selectedOsteotomiaIdx)
    && (selectedOsteotomiaIdx as number) >= 0
    && Array.isArray(analysis.opcoesOsteotomia)
    && (selectedOsteotomiaIdx as number) < analysis.opcoesOsteotomia.length;
}

export type XRayOsteotomyOption = Record<string, unknown>;

/**
 * Resolve the exact option selected by the physician.  The `padrao` flag is
 * an AI/server recommendation and is deliberately never used as a fallback.
 *
 * A stored id is checked when present so an option-list reorder cannot silently
 * make an old index point to another operation.  Returning null forces the
 * caller to ask the physician to choose again instead of exporting the wrong
 * plan.
 */
export function resolveSelectedOsteotomyOption(
  analysis: OsteotomySelectionAnalysis,
  selectedOsteotomiaIdx: number | null | undefined,
  selectedOsteotomiaId?: string | null,
): XRayOsteotomyOption | null {
  if (!isValidOsteotomySelection(analysis, selectedOsteotomiaIdx)) return null;
  const option = analysis.opcoesOsteotomia?.[selectedOsteotomiaIdx as number];
  if (!option || typeof option !== "object" || Array.isArray(option)) return null;
  if (selectedOsteotomiaId != null && String((option as XRayOsteotomyOption).id ?? "") !== selectedOsteotomiaId) {
    return null;
  }
  return option as XRayOsteotomyOption;
}

/**
 * The simulation table's post-op AmTF is an existing calculator output:
 * `180 - signed HKA`, rounded to one decimal place. Keep this tiny shared
 * helper so committing a simulation and any focused regression test use the
 * exact same value shown on screen.
 */
export function deriveDisplayedPostAmTf(signedHka: number): number {
  return +(180 - signedHka).toFixed(1);
}

/**
 * A slider simulation is only exportable after it has been committed to the
 * selected option. If a legacy option has no persisted wedge to compare with,
 * fail closed rather than claiming the current simulation is saved.
 */
export function hasUnsavedOsteotomySimulation(
  analysis: OsteotomySelectionAnalysis,
  selectedOsteotomiaIdx: number | null | undefined,
  simulation: { dfoMm: number; htoMm: number } | null | undefined,
  selectedOsteotomiaId?: string | null,
): boolean {
  if (!simulation) return false;
  const option = resolveSelectedOsteotomyOption(analysis, selectedOsteotomiaIdx, selectedOsteotomiaId);
  if (!option) return true;
  const optionId = String(option.id ?? "").toLowerCase();
  const isDupla = optionId.startsWith("dupla")
    || option.wedgeFemoral_mm !== undefined
    || option.wedgeTibial_mm !== undefined;
  const isHto = optionId.startsWith("hto")
    || (!optionId.startsWith("dfo") && String(option.nivel ?? "").toLowerCase().includes("tibial"));
  const readFinite = (value: unknown): number | null => {
    if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return null;
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const storedDfo = isDupla ? readFinite(option.wedgeFemoral_mm) : isHto ? 0 : readFinite(option.wedge_mm);
  const storedHto = isDupla ? readFinite(option.wedgeTibial_mm) : isHto ? readFinite(option.wedge_mm) : 0;
  if (isDupla && (storedDfo === null || storedHto === null)) return true;
  if (!isDupla && (storedDfo === null || storedHto === null)) return true;
  return Math.abs(simulation.dfoMm - (storedDfo ?? 0)) > 0.05
    || Math.abs(simulation.htoMm - (storedHto ?? 0)) > 0.05;
}

const AXIS_LABEL_KEYS = [
  ["completa", "analysisComplete"],
  ["eixo_mecanico", "mechanicalAxis"],
  ["eixo_anatomico", "anatomicalAxis"],
  ["femur", "femurMldfa"],
  ["tibia", "tibiaAmpta"],
  ["osteotomia", "osteotomyPlanning"],
] as const satisfies readonly (readonly [string, DocumentMessageKey])[];

const SIDE_LABEL_KEYS = [
  ["bilateral", "bilateral"],
  ["direito", "rightLimb"],
  ["esquerdo", "leftLimb"],
] as const satisfies readonly (readonly [string, DocumentMessageKey])[];

function findDocumentKey(
  value: string | undefined,
  mappings: readonly (readonly [string, DocumentMessageKey])[],
): DocumentMessageKey | undefined {
  return mappings.find(([source]) => source === value)?.[1];
}

// Colors
const C = {
  primary: [10, 24, 40] as [number, number, number],        // navy escuro (= fundo do logo)
  accent: [239, 68, 68] as [number, number, number],        // red-500
  amber: [180, 83, 9] as [number, number, number],          // amber-700
  green: [21, 128, 61] as [number, number, number],         // green-700
  muted: [107, 114, 128] as [number, number, number],       // gray-500
  border: [229, 231, 235] as [number, number, number],      // gray-200
  bgLight: [248, 250, 252] as [number, number, number],     // slate-50
  bgAmber: [255, 251, 235] as [number, number, number],     // amber-50
  bgGreen: [240, 253, 244] as [number, number, number],     // green-50
  bgBlue: [239, 246, 255] as [number, number, number],      // blue-50
  black: [15, 23, 42] as [number, number, number],          // slate-900
  white: [255, 255, 255] as [number, number, number],
};

export function generateXRayPDF(analysis: XRayAnalysis, patientName?: string, xrayImageDataUrl?: string, selectedOsteotomiaIdx?: number | null, locale: Locale = "pt-BR"): { doc: jsPDF; filename: string } {
  const selectionRequired = isOsteotomySelectionRequired(analysis);
  const selectionValid = resolveSelectedOsteotomyOption(
    analysis,
    selectedOsteotomiaIdx,
    analysis._selectedOsteotomiaId,
  ) !== null;
  if (selectionRequired && !selectionValid) {
    throw new Error("An osteotomy option must be explicitly selected before generating the X-ray PDF.");
  }

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = 210;
  const margin = 16;
  const contentW = W - margin * 2;
  let y = 0;
  const generated = (value: string) => generatedDocumentText(locale, value);

  // ── helpers ──────────────────────────────────────────────────────────────────

  // jsPDF helvetica has incorrect width metrics for curly quotes, em/en dashes,
  // and other non-basic-latin Unicode chars → splitTextToSize may not break the
  // line at the right place, causing visible overflow. Normalize to ASCII before
  // any text measurement or rendering call.
  function sanitize(s: string): string {
    return s
      .replace(/[\u2018\u2019\u0060\u00B4]/g, "'")
      .replace(/[\u201C\u201D\u00AB\u00BB]/g, '"')
      .replace(/\u2014/g, " -- ")
      .replace(/\u2013/g, "-")
      .replace(/\u2026/g, "...")
      .replace(/\u00B7/g, "·")
      .replace(/[^\x00-\xFF]/g, "?");
  }

  function setColor(rgb: [number, number, number]) {
    doc.setTextColor(rgb[0], rgb[1], rgb[2]);
  }
  function setFill(rgb: [number, number, number]) {
    doc.setFillColor(rgb[0], rgb[1], rgb[2]);
  }
  function setDraw(rgb: [number, number, number]) {
    doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
  }

  function text(
    str: string,
    x: number,
    size: number,
    opts?: { bold?: boolean; color?: [number, number, number]; align?: "left" | "center" | "right" | "justify"; maxWidth?: number }
  ) {
    doc.setFontSize(size);
    doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
    if (opts?.color) setColor(opts.color);
    doc.text(generated(str), x, y, { align: opts?.align ?? "left", maxWidth: opts?.maxWidth });
  }

  function wrappedText(
    str: string,
    x: number,
    size: number,
    maxWidth: number,
    opts?: { bold?: boolean; color?: [number, number, number] }
  ): number {
    doc.setFontSize(size);
    doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
    if (opts?.color) setColor(opts.color);
    const lines = doc.splitTextToSize(generated(str), maxWidth);
    doc.text(lines, x, y);
    return lines.length;
  }

  function lineHeight(size: number) { return size * 0.4; }

  function gap(mm: number) { y += mm; }

  function hRule(color: [number, number, number] = C.border, lw = 0.3) {
    setDraw(color);
    doc.setLineWidth(lw);
    doc.line(margin, y, W - margin, y);
    gap(5);
  }

  function sectionTitle(title: string) {
    gap(3);
    setFill(C.primary);
    doc.roundedRect(margin, y - 5, contentW, 10, 1.5, 1.5, "F");
    setColor(C.white);
    text(generated(title), margin + 4, 10, { bold: true });
    gap(8);
    setColor(C.black);
  }

  function badge(label: string, x: number, bY: number, bg: [number, number, number], fg: [number, number, number], w: number) {
    setFill(bg);
    setDraw(bg);
    doc.roundedRect(x, bY - 3.5, w, 5.5, 1, 1, "F");
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "bold");
    setColor(fg);
    doc.text(label, x + w / 2, bY, { align: "center" });
  }

  function measureRow(label: string, value: string, reference: string, status: string, rowY: number) {
    const col1 = margin;
    const col2 = margin + 55;
    const col3 = margin + 105;
    const col4 = margin + 148;

    const isNormal = status === "Normal";
    const statusColor = isNormal ? C.green : C.amber;

    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    setColor(C.black);
    doc.text(label, col1, rowY);

    doc.setFont("helvetica", "bold");
    doc.text(value, col2, rowY);

    doc.setFont("helvetica", "normal");
    setColor(C.muted);
    doc.text(reference, col3, rowY);

    setFill(isNormal ? C.bgGreen : C.bgAmber);
    setDraw(isNormal ? [187, 247, 208] as [number, number, number] : [253, 230, 138] as [number, number, number]);
    doc.roundedRect(col4, rowY - 3.5, 30, 5, 1, 1, "FD");
    doc.setFont("helvetica", "bold");
    setColor(statusColor);
    doc.text(status, col4 + 15, rowY, { align: "center" });

    setColor(C.black);
  }

  function checkPage(needed: number) {
    if (y + needed > 280) {
      doc.addPage();
      y = margin;
    }
  }

  const storedNumber = (value: unknown): number | null => {
    if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return null;
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const storedAngle = (
    angles: Record<string, unknown> | undefined,
    ...keys: string[]
  ): number | null => {
    if (!angles) return null;
    for (const key of keys) {
      const value = storedNumber(angles[key]);
      if (value !== null) return value;
    }
    return null;
  };

  const storedText = (value: unknown): string | null => {
    if (value === undefined || value === null || String(value).trim() === "") return null;
    return sanitize(String(value));
  };

  // ── HEADER SEM IDENTIDADE VISUAL DA PLATAFORMA ─────────────────────────────
  y = 13;
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  setColor(C.primary);
  doc.text(documentText(locale, "radiographicAnalysis"), margin, y);
  const dateStr = documentDate(locale, new Date(), { day: "2-digit", month: "long", year: "numeric" });
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "normal");
  setColor(C.muted);
  doc.text(dateStr, W - margin, y, { align: "right" });

  setDraw(C.border);
  doc.setLineWidth(0.2);
  doc.line(margin, 18, W - margin, 18);
  y = 26;

  // ── PATIENT + INFO BAR ───────────────────────────────────────────────────────
  if (patientName) {
    setFill(C.bgLight);
    setDraw(C.border);
    doc.roundedRect(margin, y - 4, contentW, 10, 1.5, 1.5, "FD");
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    setColor(C.muted);
    doc.text(`${documentText(locale, "patient")}:`, margin + 3, y + 1);
    doc.setFont("helvetica", "bold");
    setColor(C.black);
    doc.text(patientName, margin + 22, y + 1);
    y += 10;
  }

  gap(4);

  // Analysis type + side badges
  const axisKey = findDocumentKey(analysis.tipoAnalise, AXIS_LABEL_KEYS);
  const sideKey = findDocumentKey(analysis.ladoAvaliado, SIDE_LABEL_KEYS);
  const axisLabel = axisKey ? documentText(locale, axisKey) : analysis.tipoAnalise ?? documentText(locale, "analysis");
  const ladoLabel = sideKey ? documentText(locale, sideKey) : analysis.membrosAvaliados ?? documentText(locale, "bilateral");

  badge(axisLabel, margin, y, C.bgBlue, C.primary, 100);
  badge(ladoLabel, margin + 104, y, [240, 253, 244] as [number, number, number], C.green, 50);

  // Quality badge
  const qBg = analysis.qualidadeImagem === "Boa" ? C.bgGreen : C.bgAmber;
  const qFg = analysis.qualidadeImagem === "Boa" ? C.green : C.amber;
  badge(documentText(locale, "imageQuality", { value: analysis.qualidadeImagem }), margin + 158, y, qBg, qFg, 36);

  gap(7);
  hRule();

  // ── SELECTED PLAN SUMMARY (must lead the report) ─────────────────────────────
  // This is intentionally a compact, first-page summary. The detailed option
  // card remains below the measurements, but the physician's explicit choice
  // can never be mistaken for a buried AI recommendation.
  const selectedOption = selectionValid
    ? resolveSelectedOsteotomyOption(analysis, selectedOsteotomiaIdx, analysis._selectedOsteotomiaId)
    : null;
  if (selectedOption) {
    const pre = (selectedOption.angulosPre && typeof selectedOption.angulosPre === "object"
      ? selectedOption.angulosPre : {}) as Record<string, unknown>;
    const pos = (selectedOption.angulosPos && typeof selectedOption.angulosPos === "object"
      ? selectedOption.angulosPos : {}) as Record<string, unknown>;
    const isDupla = String(selectedOption.id ?? "").toLowerCase().startsWith("dupla")
      || selectedOption.wedgeFemoral_mm !== undefined
      || selectedOption.wedgeTibial_mm !== undefined;
    const technique = isDupla
      ? [
        storedText(selectedOption.tecnicaFemoral),
        storedText(selectedOption.tecnicaTibial),
        storedText(selectedOption.lado ?? selectedOption.side ?? analysis.ladoAvaliado),
      ].filter(Boolean).join(" + ")
      : [storedText(selectedOption.tecnica), storedText(selectedOption.lado ?? selectedOption.side ?? analysis.ladoAvaliado)]
        .filter(Boolean).join(" · ");
    const correction = storedNumber(
      selectedOption.correcao ?? selectedOption.anguloCorrecao ?? selectedOption.correction,
    );
    const wedge = isDupla
      ? [
        storedNumber(selectedOption.wedgeFemoral_mm) !== null ? `DFO ${storedNumber(selectedOption.wedgeFemoral_mm)} mm` : null,
        storedNumber(selectedOption.wedgeTibial_mm) !== null ? `HTO ${storedNumber(selectedOption.wedgeTibial_mm)} mm` : null,
      ].filter(Boolean).join(" · ")
      : storedNumber(selectedOption.wedge_mm) !== null ? `${storedNumber(selectedOption.wedge_mm)} mm` : null;
    const preHka = storedAngle(pre, "HKA", "hka");
    const posHka = storedAngle(pos, "HKA", "hka");
    const preMldfa = storedAngle(pre, "mLDFA", "mldfa", "AmLDF", "amLDF");
    const posMldfa = storedAngle(pos, "mLDFA", "mldfa", "AmLDF", "amLDF");
    const preAmpta = storedAngle(pre, "aMPTA", "amPTA", "AmMPT", "amMPT");
    const posAmpta = storedAngle(pos, "aMPTA", "amPTA", "AmMPT", "amMPT");
    const preAmtf = storedAngle(pre, "AmTF", "amTF", "AMTF", "aMTF", "amtf", "medialTibiofemoral");
    const posAmtf = storedAngle(pos, "AmTF", "amTF", "AMTF", "aMTF", "amtf", "medialTibiofemoral");
    const wblTargetValue = selectedOption.wblTarget ?? selectedOption.alvoWBL ?? selectedOption.wblAlvo
      ?? analysis.percentualWBL?.alvo;
    const wblTargetText = storedText(wblTargetValue);
    const jlcaAdjustment = storedNumber(
      selectedOption.ajusteJLCA ?? selectedOption.jlcaAdjustment ?? selectedOption.ajusteJlca,
    );
    const summaryRows = [
      technique ? `${documentText(locale, "procedureTechnique")}: ${technique}` : null,
      correction !== null || wedge
        ? `${documentText(locale, "correctionWedge")}: ${correction !== null ? `${correction}°` : "--"}${wedge ? ` · ${wedge}` : ""}`
        : null,
      preHka !== null || posHka !== null || preMldfa !== null || posMldfa !== null || preAmpta !== null || posAmpta !== null || preAmtf !== null || posAmtf !== null
        ? `${documentText(locale, "prePostMeasurements")}: HKA ${preHka ?? "--"}° → ${posHka ?? "--"}° · AmTF ${preAmtf ?? "--"}° → ${posAmtf ?? "--"}° · AmLDF ${preMldfa ?? "--"}° → ${posMldfa ?? "--"}° · AmMPT ${preAmpta ?? "--"}° → ${posAmpta ?? "--"}°`
        : null,
      wblTargetText
        ? `${documentText(locale, "targetWbl")}: ${wblTargetText}${wblTargetText.endsWith("%") ? "" : "%"}`
        : null,
      jlcaAdjustment !== null ? `${documentText(locale, "jlcaAdjustment")}: ${jlcaAdjustment}°` : null,
    ].filter((row): row is string => row !== null);
    const title = storedText(selectedOption.nome) ?? storedText(selectedOption.id) ?? "--";
    const level = storedText(selectedOption.nivel);
    const titleLines = doc.splitTextToSize(title, contentW - 10) as string[];
    const levelLines = level ? doc.splitTextToSize(level, contentW - 10) as string[] : [];
    const rowLines = summaryRows.map((row) => doc.splitTextToSize(sanitize(row), contentW - 10) as string[]);
    const summaryH = 9 + titleLines.length * 5 + (levelLines.length ? levelLines.length * 4 + 2 : 0)
      + rowLines.reduce((total, lines) => total + lines.length * 4 + 1, 0) + 8;
    checkPage(summaryH + 10);
    sectionTitle(documentText(locale, "selectedPlan"));
    setFill(C.bgGreen);
    setDraw([34, 197, 94] as [number, number, number]);
    doc.setLineWidth(1);
    doc.roundedRect(margin, y - 4, contentW, summaryH, 2, 2, "FD");
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    setColor(C.green);
    doc.text(titleLines, margin + 5, y);
    gap(titleLines.length * 5 + 1);
    if (levelLines.length) {
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      setColor(C.muted);
      doc.text(levelLines, margin + 5, y);
      gap(levelLines.length * 4 + 2);
    }
    for (const lines of rowLines) {
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      setColor(C.black);
      doc.text(lines, margin + 5, y);
      gap(lines.length * 4 + 1);
    }
    gap(5);
    hRule();
  }

  // ── MEASUREMENTS + IMAGE (two-column layout) ─────────────────────────────────
  const hasAnyMeasurement = !!(
    analysis.eixoMecanico || analysis.eixoAnatomico ||
    analysis.mLDFA || analysis.aMPTA || analysis.JLCA || analysis.MAD ||
    analysis.percentualWBL || analysis.grauVaro
  );
  if (hasAnyMeasurement || Boolean(xrayImageDataUrl)) {
    checkPage(60);
    sectionTitle(documentText(locale, "measurements"));

    const hasImg = !!xrayImageDataUrl;
    // A saved result view has no mounted image/SVG element.  If there are no
    // measurements (for example an image-only/legacy analysis), use the whole
    // content width so the RX is still visible instead of rendering a tiny
    // empty left column.
    const leftW = hasImg ? (hasAnyMeasurement ? 78 : contentW) : 0;
    const colGap = hasImg ? 5 : 0;
    const rightW = contentW - leftW - colGap;
    const rightX = margin + leftW + colGap;
    const startY = y;
    let rY = startY; // right-column cursor
    let imageBottomY = startY;

    // ── helper: compact param card ───────────────────────────────────────────
    const cardPad = 2;
    const valueMaxW = rightW - 12; // inner padding on both sides
    const drawCard = (
      label: string,
      value: string,
      sub: string,
      dotColor: [number, number, number]
    ) => {
      const safeValue = sanitize(value);
      const safeSub   = sanitize(sub);
      // Measure value text at size 11 — if too long, drop to size 9
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      let valLines = doc.splitTextToSize(safeValue, valueMaxW);
      if (valLines.length > 1) {
        doc.setFontSize(9);
        valLines = doc.splitTextToSize(safeValue, valueMaxW);
      }
      const valFontSize = valLines.length > 1 ? 9 : 11;
      const valLineH = valFontSize === 9 ? 4 : 5.5;
      const extraValH = Math.max(0, valLines.length - 1) * valLineH;

      // sub lines
      doc.setFontSize(6.5);
      doc.setFont("helvetica", "normal");
      const subLines = safeSub ? doc.splitTextToSize(safeSub, valueMaxW) : [];
      const subH = subLines.length > 0 ? subLines.length * 3.5 + 1 : 0;

      const cardH = 6 + 5 + extraValH + subH + 3; // label row + value + sub + padding

      setFill([248, 250, 252] as [number, number, number]);
      setDraw(C.border);
      doc.setLineWidth(0.2);
      doc.roundedRect(rightX, rY, rightW, cardH, 2, 2, "FD");

      // status dot
      setFill(dotColor);
      doc.circle(rightX + 4, rY + 4.5, 1.8, "F");

      // label
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      setColor(C.muted);
      doc.text(label, rightX + 8, rY + 4.5);

      // value (multiline)
      doc.setFontSize(valFontSize);
      doc.setFont("helvetica", "bold");
      setColor(C.black);
      doc.text(valLines, rightX + 8, rY + 10.5);

      // sub-label below all value lines
      if (subLines.length > 0) {
        const subY = rY + 10.5 + extraValH + (valFontSize === 9 ? 1 : 2);
        doc.setFontSize(6.5);
        doc.setFont("helvetica", "normal");
        setColor(C.muted);
        doc.text(subLines, rightX + 8, subY + 3.5);
      }

      rY += cardH + cardPad;
    };

    // ── param cards (right column) ────────────────────────────────────────────
    if (analysis.eixoMecanico) {
      const { desvio, graus } = analysis.eixoMecanico;
      const ok = Math.abs(graus) <= 3;
      drawCard(documentText(locale, "mechanicalAxis"), `${Math.abs(graus)}° ${desvio}`, documentText(locale, "mechanicalAxisReference"), ok ? C.green : C.amber);
    }
    if (analysis.eixoAnatomico) {
      const { desvio, graus } = analysis.eixoAnatomico;
      const ok = Math.abs(graus) >= 5 && Math.abs(graus) <= 7;
      drawCard(documentText(locale, "anatomicalAxis"), `${Math.abs(graus)}° ${desvio}`, documentText(locale, "anatomicalAxisReference"), ok ? C.green : C.amber);
    }
    if (analysis.mLDFA) {
      const ok = analysis.mLDFA.status === "Normal";
      drawCard(documentText(locale, "mldfaFemur"), `${analysis.mLDFA.valor}°`, documentText(locale, "referenceValue", { value: analysis.mLDFA.referencia }), ok ? C.green : C.amber);
    }
    if (analysis.aMPTA) {
      const ok = analysis.aMPTA.status === "Normal";
      drawCard(documentText(locale, "amptaTibia"), `${analysis.aMPTA.valor}°`, documentText(locale, "referenceValue", { value: analysis.aMPTA.referencia }), ok ? C.green : C.amber);
    }
    if (analysis.JLCA) {
      const ok = analysis.JLCA.status === "Normal";
      drawCard("JLCA", `${analysis.JLCA.valor}°`, documentText(locale, "referenceValue", { value: analysis.JLCA.referencia }), ok ? C.green : C.amber);
    }
    if (analysis.MAD) {
      const ok = analysis.MAD.status === "Normal";
      drawCard(`MAD`, `${analysis.MAD.valor} mm`, `${analysis.MAD.lado}`, ok ? C.green : C.amber);
    }
    if (analysis.percentualWBL) {
      const wblVal = analysis.percentualWBL.valor ?? analysis.percentualWBL.preCorrecao;
      if (wblVal !== undefined) {
        const ok = wblVal >= 45 && wblVal <= 60;
        const sub = analysis.percentualWBL.alvo
          ? documentText(locale, "wblTarget", { value: analysis.percentualWBL.alvo })
          : documentText(locale, "wblScale");
        drawCard(`%WBL`, `${wblVal}%`, sub, ok ? C.green : C.amber);
      }
    }
    if (analysis.valgofisiologico) {
      const vf = analysis.valgofisiologico;
      const ok = Math.abs(vf.diferenca) <= 1;
      drawCard(documentText(locale, "physiologicalValgus"), `${vf.encontrado}° (Δ ${vf.diferenca}°)`, vf.esperado, ok ? C.green : C.amber);
    }
    if (analysis.origemDesvio) {
      drawCard(documentText(locale, "deviationOrigin"), analysis.origemDesvio, "", C.primary as [number, number, number]);
    }
    if (analysis.grauVaro && analysis.grauVaro !== "Não aplicável") {
      const grauFg = analysis.grauVaro === "Grau I" ? C.green
        : analysis.grauVaro === "Grau II" ? C.amber
        : C.accent;
      drawCard(documentText(locale, "classification"), analysis.grauVaro, "", grauFg);
    }
    if (analysis.contribuicaoFemoral != null) {
      drawCard(documentText(locale, "femoralContributionFull"), String(analysis.contribuicaoFemoral), "", C.muted as [number, number, number]);
    }
    if (analysis.contribuicaoTibial != null) {
      drawCard(documentText(locale, "tibialContributionFull"), String(analysis.contribuicaoTibial), "", C.muted as [number, number, number]);
    }

    // ── left column: X-ray image with annotations ────────────────────────────
    if (hasImg && xrayImageDataUrl) {
      try {
        const props = doc.getImageProperties(xrayImageDataUrl);
        const ratio = props.width / props.height;
        const rightColH = rY - startY;
        // Keep the image and its caption inside the printable area.  The
        // following sections start after this block, so a fixed 220mm cap can
        // otherwise run into the footer on a short page.
        const captionBottomPadding = 8;
        const remainingImageH = Math.max(24, 280 - startY - captionBottomPadding);
        const requestedImageH = hasAnyMeasurement
          ? Math.max(rightColH, 60)
          : Math.min(160, contentW / ratio);
        let imgH = Math.min(requestedImageH, 220, remainingImageH);
        let imgW = imgH * ratio;
        if (imgW > leftW) {
          imgW = leftW;
          imgH = imgW / ratio;
        }
        const imgX = margin + (leftW - imgW) / 2;
        setDraw(C.border);
        setFill([255, 255, 255] as [number, number, number]);
        doc.setLineWidth(0.25);
        doc.rect(imgX - 1, startY - 1, imgW + 2, imgH + 2, "FD");
        const fmt = xrayImageDataUrl.startsWith("data:image/png") ? "PNG" : "JPEG";
        doc.addImage(xrayImageDataUrl, fmt, imgX, startY, imgW, imgH, undefined, "FAST");
        doc.setFontSize(7);
        doc.setFont("helvetica", "italic");
        setColor(C.muted);
        doc.text(documentText(locale, "xrayPanoramic"), margin + leftW / 2, startY + imgH + 4, { align: "center" });
        imageBottomY = startY + imgH + 8;
      } catch (error) {
        // A PDF without the RX is clinically incomplete.  Never hide a
        // malformed data URL or an image decoding failure behind a successful
        // download.
        throw new Error("Unable to add the X-ray image to the PDF.", { cause: error });
      }
    }

    y = Math.max(rY, startY + 40, imageBottomY);
    gap(4);
    hRule();
  }

  // ── DEFORMIDADE EXTRA-ARTICULAR (BOWING DIAFISÁRIO) ─────────────────────────
  if (analysis.deformidadeExtraArticular?.presente) {
    const ea = analysis.deformidadeExtraArticular;
    checkPage(55);
    gap(2);

    // Red warning title bar
    setFill([220, 38, 38] as [number, number, number]);
    doc.roundedRect(margin, y - 4, contentW, 8, 1, 1, "F");
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "bold");
    setColor(C.white);
    doc.text(documentText(locale, "extraArticularDeformity"), margin + 3, y, { maxWidth: contentW - 6 });
    gap(7);
    setColor(C.black);

    // Subtitle
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    setColor([127, 29, 29] as [number, number, number]);
    const bowingSubLines = doc.splitTextToSize(
      sanitize(documentText(locale, "bowingDescription", { bone: ea.osso })),
      contentW - 8
    );
    doc.text(bowingSubLines, margin + 2, y, { maxWidth: contentW - 8 });
    gap(bowingSubLines.length * 4.5 + 3);

    // Two-column: AMA Femoral | Divergência Tibial
    const colW = (contentW - 4) / 2;
    const colItems = [
      {
        label: documentText(locale, "amaFemoral"),
        value: `${ea.amaFemoral.toFixed(1)}°`,
        ref: documentText(locale, "averageReference"),
        anomaly: ea.femoralBowing,
      },
      {
        label: documentText(locale, "tibialDivergence"),
        value: `${ea.divergenciaTibial.toFixed(1)}°`,
        ref: documentText(locale, "tibialDivergenceReference"),
        anomaly: ea.tibialBowing,
      },
    ];
    colItems.forEach((item, i) => {
      const cx = margin + i * (colW + 4);
      const fill: [number,number,number] = item.anomaly ? [254, 226, 226] : [240, 253, 244];
      const border: [number,number,number] = item.anomaly ? [252, 165, 165] : [134, 239, 172];
      const labelClr: [number,number,number] = item.anomaly ? [185, 28, 28] : [21, 128, 61];
      setFill(fill); setDraw(border);
      doc.setLineWidth(0.5);
      doc.roundedRect(cx, y - 3.5, colW, 14, 1.5, 1.5, "FD");
      doc.setFontSize(6.5); doc.setFont("helvetica", "bold"); setColor(labelClr);
      doc.text(item.label, cx + 3, y);
      doc.setFontSize(12); doc.setFont("helvetica", "bold"); setColor(item.anomaly ? [127, 29, 29] as [number,number,number] : [20, 83, 45] as [number,number,number]);
      doc.text(item.value, cx + 3, y + 6);
      doc.setFontSize(6.5); doc.setFont("helvetica", "normal"); setColor(C.muted);
      doc.text(item.ref, cx + 3, y + 9.5);
    });
    gap(18);

    // Surgical recommendation
    setFill([255, 255, 255] as [number, number, number]);
    setDraw([220, 38, 38] as [number, number, number]);
    doc.setLineWidth(0.8);
    const recLines = doc.splitTextToSize(sanitize(ea.recomendacao), contentW - 16);
    const recBoxH = recLines.length * 4.5 + 12;
    checkPage(recBoxH + 4);
    doc.roundedRect(margin, y - 4, contentW, recBoxH, 2, 2, "FD");
    doc.setFontSize(7); doc.setFont("helvetica", "bold"); setColor([185, 28, 28] as [number, number, number]);
    doc.text(documentText(locale, "surgicalRecommendation"), margin + 4, y);
    gap(5);
    doc.setFontSize(8); doc.setFont("helvetica", "normal"); setColor([127, 29, 29] as [number, number, number]);
    doc.text(recLines, margin + 4, y, { maxWidth: contentW - 16 });
    gap(recLines.length * 4.5 + 5);

    // ── ÂNGULO DE CORREÇÃO NO CORA ──────────────────────────────────────────
    if (ea.anguloCoraFemoral != null || ea.anguloCoraTibial != null) {
      const coraDescLines = doc.splitTextToSize(
        sanitize(documentText(locale, "coraDescription")),
        contentW - 8
      );
      const coraBoxH = 8 + coraDescLines.length * 4 + 24 + 8;
      checkPage(coraBoxH + 6);
      setFill([255, 251, 235] as [number, number, number]);
      setDraw([251, 191, 36] as [number, number, number]);
      doc.setLineWidth(0.5);
      doc.roundedRect(margin, y - 4, contentW, coraBoxH, 2, 2, "FD");
      doc.setFontSize(8); doc.setFont("helvetica", "bold"); setColor([120, 53, 15] as [number, number, number]);
      doc.text(documentText(locale, "coraCorrectionAngle"), margin + 4, y);
      gap(5);
      doc.setFontSize(7.5); doc.setFont("helvetica", "normal"); setColor([146, 64, 14] as [number, number, number]);
      doc.text(coraDescLines, margin + 4, y, { maxWidth: contentW - 8 });
      gap(coraDescLines.length * 4 + 3);

      const coraColW = (contentW - 12) / 2;
      const coraItems: { label: string; sub: string; measured: number | null | undefined; estimated: number | null | undefined }[] = [];
      if (ea.anguloCoraFemoral != null) {
        coraItems.push({ label: documentText(locale, "femurCora"), sub: documentText(locale, "femoralDiaphysisOsteotomy"), measured: ea.anguloCoraFemoralMedido, estimated: ea.anguloCoraFemoral });
      }
      if (ea.anguloCoraTibial != null) {
        coraItems.push({ label: documentText(locale, "tibiaCora"), sub: documentText(locale, "tibialDiaphysisOsteotomy"), measured: ea.anguloCoraTibialMedido, estimated: ea.anguloCoraTibial });
      }
      coraItems.forEach((item, i) => {
        const cx = margin + 4 + i * (coraColW + 4);
        setFill([255, 255, 255] as [number, number, number]);
        setDraw([252, 211, 77] as [number, number, number]);
        doc.setLineWidth(0.4);
        doc.roundedRect(cx, y - 3.5, coraColW, 20, 1.5, 1.5, "FD");
        doc.setFontSize(6.5); doc.setFont("helvetica", "bold"); setColor([146, 64, 14] as [number, number, number]);
        doc.text(item.label, cx + coraColW / 2, y, { align: "center" });
        const hasMeasured = item.measured != null;
        doc.setFontSize(12); doc.setFont("helvetica", "bold");
        setColor(hasMeasured ? ([107, 33, 168] as [number, number, number]) : ([120, 53, 15] as [number, number, number]));
        doc.text(`${(hasMeasured ? item.measured! : item.estimated!).toFixed(1)} deg`, cx + coraColW / 2, y + 7, { align: "center" });
        doc.setFontSize(6); doc.setFont("helvetica", "normal"); setColor(C.muted);
        if (hasMeasured) {
          doc.text(documentText(locale, "measuredRx", { value: item.estimated!.toFixed(1) }), cx + coraColW / 2, y + 11, { align: "center" });
        } else {
          doc.text(documentText(locale, "estimatedViaHka"), cx + coraColW / 2, y + 11, { align: "center" });
        }
        doc.text(item.sub, cx + coraColW / 2, y + 14.5, { align: "center" });
      });
      gap(24);
    }

    hRule();
  }

  // ── ALERTAS TÉCNICOS ──────────────────────────────────────────────────────────
  if (analysis.alertas && analysis.alertas.length > 0) {
    checkPage(25);
    gap(2);
    // 10 mm bullet indent + 10 mm right padding inside the box.
    // Keep sanitize() in sync: splitTextToSize uses helvetica metrics which can
    // mis-measure curly quotes / em-dashes and produce lines that appear wider
    // than measured → sanitize before ANY measurement call.
    const alertaTextW = contentW - 20;
    const bulletX = margin + 10; // text starts here
    doc.setFontSize(7.5); doc.setFont("helvetica", "normal");
    const alertasH = analysis.alertas.reduce((acc, a) => {
      return acc + doc.splitTextToSize(sanitize(a), alertaTextW).length * 5 + 5;
    }, 16);
    setFill([254, 226, 226] as [number, number, number]);
    setDraw([252, 165, 165] as [number, number, number]);
    doc.setLineWidth(0.4);
    doc.roundedRect(margin, y - 4, contentW, alertasH, 2, 2, "FD");
    doc.setFontSize(8); doc.setFont("helvetica", "bold"); setColor([185, 28, 28] as [number, number, number]);
    doc.text(documentText(locale, "technicalAlerts"), margin + 4, y);
    gap(7);
    analysis.alertas.forEach((alerta, i) => {
      doc.setFontSize(7.5); doc.setFont("helvetica", "normal");
      const aLines = doc.splitTextToSize(sanitize(alerta), alertaTextW);
      checkPage(aLines.length * 5 + 6);
      setColor([127, 29, 29] as [number, number, number]);
      // Numbered bullet
      setFill([252, 165, 165] as [number, number, number]);
      doc.roundedRect(margin + 3, y - 2.5, 5, 5, 1, 1, "F");
      doc.setFontSize(6.5); doc.setFont("helvetica", "bold"); setColor(C.white);
      doc.text(String(i + 1), margin + 5.5, y + 0.5, { align: "center" });
      doc.setFontSize(7.5); doc.setFont("helvetica", "normal"); setColor([127, 29, 29] as [number, number, number]);
      doc.text(aLines, bulletX, y, { maxWidth: alertaTextW });
      gap(aLines.length * 5 + 5);
    });
    gap(4);
    hRule();
  }

  // ── OSTEOTOMY PLANNING ────────────────────────────────────────────────────────
  if (analysis.indicacaoOsteotomia !== undefined) {
    checkPage(35);
    sectionTitle(documentText(locale, "surgicalPlanning"));

    const indicated = analysis.indicacaoOsteotomia;

    // Only show the non-indicated notice (no "Osteotomia Indicada" box)
    if (!indicated) {
      const borderClr = [134, 239, 172] as [number, number, number];
      setFill(C.bgGreen);
      setDraw(borderClr);
      doc.setLineWidth(0.5);
      doc.roundedRect(margin, y - 4, contentW, 12, 2, 2, "FD");
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      setColor(C.green);
      doc.text(documentText(locale, "osteotomyNotIndicated"), margin + 4, y + 1);
      gap(14);
    } else {
      gap(4);
    }

    // Dupla osteotomia — planejamento por nível
    if (indicated && (analysis.planoFemoral || analysis.planoTibial)) {
      checkPage(10);
      gap(2);
      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      setColor(C.muted);
      doc.text(documentText(locale, "planningByLevel"), margin, y);
      gap(5);

      // Contribuições
      if (analysis.contribuicaoFemoral !== undefined || analysis.contribuicaoTibial !== undefined) {
        const col = contentW / 3;
        if (analysis.contribuicaoFemoral !== undefined) {
          setFill([255, 237, 213] as [number, number, number]);
          setDraw([253, 186, 116] as [number, number, number]);
          doc.roundedRect(margin, y - 4, col - 2, 10, 1.5, 1.5, "FD");
          doc.setFontSize(7);
          doc.setFont("helvetica", "normal");
          setColor([154, 52, 18] as [number, number, number]);
          doc.text(documentText(locale, "femoralContribution"), margin + 2, y);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(11);
          doc.text(`${analysis.contribuicaoFemoral}°`, margin + 2, y + 5);
        }
        if (analysis.contribuicaoTibial !== undefined) {
          setFill([254, 226, 226] as [number, number, number]);
          setDraw([252, 165, 165] as [number, number, number]);
          doc.roundedRect(margin + col, y - 4, col - 2, 10, 1.5, 1.5, "FD");
          doc.setFontSize(7);
          doc.setFont("helvetica", "normal");
          setColor([153, 27, 27] as [number, number, number]);
          doc.text(documentText(locale, "tibialContribution"), margin + col + 2, y);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(11);
          doc.text(`${analysis.contribuicaoTibial}°`, margin + col + 2, y + 5);
        }
        if (analysis.contribuicaoArticular !== undefined && analysis.contribuicaoArticular > 0) {
          setFill([243, 232, 255] as [number, number, number]);
          setDraw([196, 181, 253] as [number, number, number]);
          doc.roundedRect(margin + col * 2, y - 4, col - 2, 10, 1.5, 1.5, "FD");
          doc.setFontSize(7);
          doc.setFont("helvetica", "normal");
          setColor([88, 28, 135] as [number, number, number]);
          doc.text(documentText(locale, "articularContribution"), margin + col * 2 + 2, y);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(11);
          doc.text(`${analysis.contribuicaoArticular}°`, margin + col * 2 + 2, y + 5);
        }
        gap(12);
      }

      // Femoral plan
      if (analysis.planoFemoral?.indicado) {
        checkPage(28);
        setFill([255, 237, 213] as [number, number, number]);
        setDraw([253, 186, 116] as [number, number, number]);
        doc.setLineWidth(0.5);
        const plFLines = doc.splitTextToSize(analysis.planoFemoral.justificativaTecnica ?? "", contentW - 40);
        const plFH = Math.max(22, plFLines.length * 4 + 18);
        doc.roundedRect(margin, y - 4, contentW, plFH, 2, 2, "FD");

        doc.setFontSize(9);
        doc.setFont("helvetica", "bold");
        setColor([154, 52, 18] as [number, number, number]);
        doc.text(documentText(locale, "femoralLevel"), margin + 3, y);
        doc.setFontSize(14);
        doc.text(`${analysis.planoFemoral.correcaoNecessaria}°`, W - margin - 5, y + 4, { align: "right" });

        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");
        setColor(C.black);
        const tecFLines = doc.splitTextToSize(documentText(locale, "technique", { value: analysis.planoFemoral.tecnica }), contentW - 20);
        doc.text(tecFLines, margin + 3, y + 6);

        if (plFLines.length > 0) {
          doc.setFontSize(7.5);
          setColor(C.muted);
          doc.text(plFLines, margin + 3, y + 6 + tecFLines.length * 4);
        }
        gap(plFH + 2);
      }

      // Tibial plan
      if (analysis.planoTibial?.indicado) {
        checkPage(28);
        setFill([239, 246, 255] as [number, number, number]);
        setDraw([147, 197, 253] as [number, number, number]);
        doc.setLineWidth(0.5);
        const plTLines = doc.splitTextToSize(analysis.planoTibial.justificativaTecnica ?? "", contentW - 40);
        const plTH = Math.max(22, plTLines.length * 4 + 18);
        doc.roundedRect(margin, y - 4, contentW, plTH, 2, 2, "FD");

        doc.setFontSize(9);
        doc.setFont("helvetica", "bold");
        setColor(C.primary);
        doc.text(documentText(locale, "tibialLevel"), margin + 3, y);
        doc.setFontSize(14);
        doc.text(`${analysis.planoTibial.correcaoNecessaria}°`, W - margin - 5, y + 4, { align: "right" });

        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");
        setColor(C.black);
        const tecTLines = doc.splitTextToSize(documentText(locale, "technique", { value: analysis.planoTibial.tecnica }), contentW - 20);
        doc.text(tecTLines, margin + 3, y + 6);

        if (plTLines.length > 0) {
          doc.setFontSize(7.5);
          setColor(C.muted);
          doc.text(plTLines, margin + 3, y + 6 + tecTLines.length * 4);
        }
        gap(plTH + 2);
      }
    }

    // metaCorrecao narrative box removed — planning info is conveyed by the
    // osteotomy cards and angle table below.

    // ── Opção Cirúrgica escolhida pelo médico ──────────────────────────────────
    if (Array.isArray(analysis.opcoesOsteotomia) && analysis.opcoesOsteotomia.length > 0) {
      checkPage(20);
      gap(4);

      // Section label
      doc.setFontSize(8.5);
      doc.setFont("helvetica", "bold");
      setColor(C.muted);
      doc.text(documentText(locale, "osteotomySuggestions"), margin, y, { maxWidth: contentW });
      gap(8);

      type OpcaoOsteotomia = {
        id: string;
        nome: string;
        nivel: string;
        correcao?: number;
        wedge_mm?: number;
        correcaoFemoral?: number;
        correcaoTibial?: number;
        wedgeFemoral_mm?: number;
        wedgeTibial_mm?: number;
        tecnica?: string;
        tecnicaFemoral?: string;
        tecnicaTibial?: string;
        lado?: string;
        side?: string;
        angulosPre?: Record<string, unknown>;
        angulosPos?: Record<string, unknown>;
        wblPre?: number;
        wblPos?: number;
        wblTarget?: number;
        alvoWBL?: number;
        wblAlvo?: number;
        ajusteJLCA?: number;
        jlcaAdjustment?: number;
        alertas?: string[];
        viavel?: boolean;
        padrao?: boolean;
        cargaTibial?: string;
        dfoPlanning?: {
          miniaci: number;
          formula: string;
          alturaOsteotomia: string;
          alturaSeveridade: string;
          consolidacao: string;
          enxerto: string;
          carga: string;
        };
      };

      const opcoes = analysis.opcoesOsteotomia as OpcaoOsteotomia[];

      // Colors per option type
      const optColors: Record<string, { fill: [number,number,number]; draw: [number,number,number]; label: [number,number,number] }> = {
        hto:   { fill: [239, 246, 255], draw: [147, 197, 253], label: [29, 78, 216] },
        dfo:   { fill: [255, 247, 237], draw: [253, 186, 116], label: [154, 52, 18] },
        dupla: { fill: [250, 245, 255], draw: [216, 180, 254], label: [109, 40, 217] },
      };

      // Always show exactly ONE option: the option explicitly chosen by the
      // physician.  There is deliberately no "Padrão" fallback here.
      const shownIdx = selectedOsteotomiaIdx as number;

      for (let idx = 0; idx < opcoes.length; idx++) {
        const opcao = opcoes[idx];
        const isDupla = String(opcao.id ?? "").toLowerCase().startsWith("dupla")
          || opcao.wedgeFemoral_mm !== undefined
          || opcao.wedgeTibial_mm !== undefined;
        const oc = optColors[opcao.id] ?? (isDupla ? optColors.dupla : optColors.hto);
        const pre = opcao.angulosPre ?? {};
        const pos = opcao.angulosPos ?? {};
        const alertas = opcao.alertas ?? [];
        const isSelected = selectionValid && selectedOsteotomiaIdx === idx;

        // ── Show only the physician-chosen option ────────────────────────────
        if (idx !== shownIdx) {
          continue;
        }

        // ── Full card for the physician-chosen option ─────────────────────────
        const selFill: [number,number,number] = [240, 253, 244];
        const selDraw: [number,number,number] = [34, 197, 94];
        const selLabel: [number,number,number] = [21, 128, 61];
        const cardFill = isSelected ? selFill : oc.fill;
        const cardDraw = isSelected ? selDraw : oc.draw;
        const cardLabel = isSelected ? selLabel : oc.label;

        // ── Card geometry — computed to match the EXACT gaps used in the render
        //    below, so the rounded rect always fits its content: no overlap with
        //    the following box, no dead space inside. Keep in sync with gap() calls.
        const G_TITLE = 7, G_SUB = 7, G_TABLE_HEAD = 6, G_SEP = 2;
        const G_ROW = 7.5, G_PREWEDGE = 3, G_WEDGE = 7, G_BADGE = 9;
        const dfoPlanH = 0;       // Miniaci block removed
        const dfoBlockAdv = 0;    // Miniaci block removed

        // Pre-wrap text so the measured height matches what is actually rendered.
        // Title: reserve space for the right-aligned "X° total" badge (≈30mm).
        const titleMaxW = contentW - 34;
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        const titleLines = doc.splitTextToSize(sanitize(opcao.nome), titleMaxW) as string[];
        const titleAdv = G_TITLE + Math.max(0, titleLines.length - 1) * 6;

        const htoCargaTxt = opcao.cargaTibial ? ` · ${documentText(locale, "htoLoad", { value: opcao.cargaTibial })}` : "";
        const techniqueText = isDupla
          ? [opcao.tecnicaFemoral, opcao.tecnicaTibial, opcao.lado ?? opcao.side ?? analysis.ladoAvaliado].filter(Boolean).join(" + ")
          : [opcao.tecnica, opcao.lado ?? opcao.side ?? analysis.ladoAvaliado].filter(Boolean).join(" · ");
        const jlcaAdjustment = storedNumber(opcao.ajusteJLCA ?? opcao.jlcaAdjustment ?? (opcao as Record<string, unknown>).ajusteJlca);
        const wedgeLines = isDupla
          ? doc.splitTextToSize(
              sanitize(`DFO: ${opcao.correcaoFemoral}° · ~${opcao.wedgeFemoral_mm} mm   |   HTO: ${opcao.correcaoTibial}° · ~${opcao.wedgeTibial_mm} mm${htoCargaTxt}`),
              contentW - 10,
            )
          : [];
        const wedgeAdv = isDupla ? G_WEDGE + Math.max(0, wedgeLines.length - 1) * 5 : G_WEDGE;
        const alertLineCounts = alertas.map((a) => doc.splitTextToSize(sanitize(`! ${a}`), contentW - 14).length);
        const alertAdv = alertas.length > 0 ? 1 + alertLineCounts.reduce((acc, n) => acc + n * 5 + 2, 0) : 0;

        const badgeH = isSelected ? G_BADGE : 0;
        const extraPlanLines = (techniqueText || jlcaAdjustment !== null) ? 7 : 0;
        const contentAdv =
          badgeH + titleAdv + G_SUB + dfoBlockAdv +
           G_TABLE_HEAD + G_SEP + 5 * G_ROW + G_PREWEDGE + wedgeAdv + extraPlanLines + alertAdv;
        const cardH = contentAdv + 5; // 4mm top pad (rect at y-4) + ~1mm bottom pad
        checkPage(cardH + 4);

        // Card background
        setFill(cardFill);
        setDraw(cardDraw);
        doc.setLineWidth(isSelected ? 1 : 0.5);
        doc.roundedRect(margin, y - 4, contentW, cardH, 2, 2, "FD");

        // "Escolha Cirúrgica" badge row
        if (isSelected) {
          setFill(selLabel);
          setDraw(selLabel);
          doc.setLineWidth(0);
          doc.roundedRect(margin + 3, y - 3.5, 42, 6.5, 1.5, 1.5, "F");
          doc.setFontSize(7.5);
          doc.setFont("helvetica", "bold");
          setColor(C.white);
          doc.text(documentText(locale, "selectedSurgery"), margin + 24, y + 0.5, { align: "center" });
          gap(9);
        }

        // Title row — title wraps if long; badge stays right-aligned on first line only
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        setColor(cardLabel);
        doc.text(titleLines, margin + 3, y);
        // Badge right-aligned, same y as first title line
        doc.setFontSize(9);
        setColor(C.muted);
        const storedCorrection = storedNumber(opcao.correcao ?? (opcao as Record<string, unknown>).anguloCorrecao ?? (opcao as Record<string, unknown>).correction);
        doc.text(documentText(locale, "totalAngle", { value: storedCorrection ?? "--" }), W - margin - 3, y, { align: "right" });
        gap(titleAdv);

        // Subtitle (nivel)
        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");
        setColor(C.muted);
        doc.text(opcao.nivel, margin + 3, y);
        gap(G_SUB);

        if (techniqueText || jlcaAdjustment !== null) {
          doc.setFontSize(7.5);
          doc.setFont("helvetica", "normal");
          setColor(C.muted);
          const planMeta = [
            techniqueText ? `${documentText(locale, "procedureTechnique")}: ${techniqueText}` : null,
            jlcaAdjustment !== null ? `${documentText(locale, "jlcaAdjustment")}: ${jlcaAdjustment}°` : null,
          ].filter((value): value is string => value !== null).join(" · ");
          doc.text(sanitize(planMeta), margin + 3, y);
          gap(7);
        }


        // Table header
        const col0 = 28; // angle label width
        const col1 = (contentW - col0) / 2 - 4; // pre col
        const col2 = col1; // post col
        const tableX0 = margin + 3;
        const tableX1 = tableX0 + col0;
        const tableX2 = tableX1 + col1 + 4;
        const tableX3 = W - margin - 3;

        doc.setFontSize(8);
        doc.setFont("helvetica", "bold");
        setColor(C.muted);
        doc.text(documentText(locale, "angle"), tableX0, y);
        doc.text(documentText(locale, "preOp"), tableX1 + col1 / 2, y, { align: "center" });
        doc.text(documentText(locale, "postOp"), tableX2 + col2 / 2, y, { align: "center" });
        doc.text(documentText(locale, "normal"), tableX3, y, { align: "right" });
        gap(G_TABLE_HEAD);

        // Thin separator
        doc.setLineWidth(0.3);
        setDraw([180, 180, 180] as [number,number,number]);
        doc.line(margin + 2, y - 1.5, W - margin - 2, y - 1.5);
        gap(G_SEP);

        // Table rows use values persisted in the selected option verbatim. In
        // particular, do not derive AmTF from HKA: legacy/saved records may
        // contain a physician adjustment that must survive export exactly.
        const preHka = storedAngle(pre, "HKA", "hka");
        const posHka = storedAngle(pos, "HKA", "hka");
        const preMldfa = storedAngle(pre, "mLDFA", "mldfa", "AmLDF", "amLDF");
        const posMldfa = storedAngle(pos, "mLDFA", "mldfa", "AmLDF", "amLDF");
        const preAmpta = storedAngle(pre, "aMPTA", "amPTA", "AmMPT", "amMPT");
        const posAmpta = storedAngle(pos, "aMPTA", "amPTA", "AmMPT", "amMPT");
        const preAmtf = storedAngle(pre, "AmTF", "amTF", "AMTF", "aMTF", "amtf", "medialTibiofemoral");
        const posAmtf = storedAngle(pos, "AmTF", "amTF", "AMTF", "aMTF", "amtf", "medialTibiofemoral");
        const hkaDirection = (value: number | null): string =>
          value === null ? "--" : value < 0 ? "Varo" : value > 0 ? "Valgo" : "Neutro";
        // Match the selected-table display: retain a persisted direction when
        // present, otherwise use the sign already carried by HKA. This adds no
        // measurement and avoids exporting "--" after a saved simulation.
        const hkaPreDir = storedText(pre.desvio) ?? hkaDirection(preHka);
        const hkaPosDir = storedText(pos.desvio) ?? hkaDirection(posHka);
        const rows: { label: string; pre: string; post: string; normal: string; preAnomaly: boolean; postOk: boolean }[] = [
          {
            label: "HKA",
            pre: preHka !== null ? `${preHka}° ${hkaPreDir}` : "--",
            post: posHka !== null ? `${posHka}° ${hkaPosDir}` : "--",
            normal: "0° ± 3°",
            preAnomaly: preHka !== null && Math.abs(preHka) > 3,
            postOk: posHka !== null && Math.abs(posHka) <= 3,
          },
          {
            label: "AmTF",
            pre: preAmtf !== null ? `${preAmtf}°` : "--",
            post: posAmtf !== null ? `${posAmtf}°` : "--",
            normal: "180° ± 3°",
            preAnomaly: preAmtf !== null && (preAmtf < 177 || preAmtf > 183),
            postOk: posAmtf !== null && posAmtf >= 177 && posAmtf <= 183,
          },
          {
            label: "AmLDF",
            pre: preMldfa !== null ? `${preMldfa}°` : "--",
            post: posMldfa !== null ? `${posMldfa}°` : "--",
            normal: "87° ± 3°",
            preAnomaly: preMldfa !== null && (preMldfa < 84 || preMldfa > 90),
            postOk: posMldfa !== null && posMldfa >= 84 && posMldfa <= 90,
          },
          {
            label: "AmMPT",
            pre: preAmpta !== null ? `${preAmpta}°` : "--",
            post: posAmpta !== null ? `${posAmpta}°` : "--",
            normal: "87° ± 3°",
            preAnomaly: preAmpta !== null && (preAmpta < 84 || preAmpta > 90),
            postOk: posAmpta !== null && posAmpta >= 84 && posAmpta <= 90,
          },
          {
            label: "%WBL",
            pre: opcao.wblPre !== undefined ? `${opcao.wblPre}%` : "--",
            post: opcao.wblPos !== undefined ? `${opcao.wblPos}%` : "--",
            normal: "50%",
            preAnomaly: opcao.wblPre !== undefined && (opcao.wblPre < 45 || opcao.wblPre > 55),
            postOk: opcao.wblPos !== undefined && opcao.wblPos >= 45 && opcao.wblPos <= 65,
          },
        ];

        for (const row of rows) {
          doc.setFontSize(8.5);
          doc.setFont("helvetica", "bold");
          setColor(C.black);
          doc.text(row.label, tableX0, y);

          doc.setFont("helvetica", "bold");
          setColor(row.preAnomaly ? [180, 80, 0] as [number,number,number] : C.muted);
          doc.text(row.pre, tableX1 + col1 / 2, y, { align: "center" });

          doc.setFont("helvetica", "bold");
          setColor(row.postOk ? [22, 101, 52] as [number,number,number] : [180, 0, 0] as [number,number,number]);
          doc.text(row.post, tableX2 + col2 / 2, y, { align: "center" });

          doc.setFont("helvetica", "normal");
          setColor(C.muted);
          doc.text(row.normal, tableX3, y, { align: "right" });
          gap(G_ROW);
        }

        gap(G_PREWEDGE);

        // Wedge info
        doc.setFontSize(8);
        doc.setFont("helvetica", "bold");
        setColor(cardLabel);
        if (isDupla) {
          doc.text(wedgeLines, margin + 3, y);
          if (wedgeLines.length > 1) gap((wedgeLines.length - 1) * 5);
        } else {
          doc.text(documentText(locale, "estimatedWedge", { angle: storedCorrection ?? "--", wedge: opcao.wedge_mm ?? "" }), margin + 3, y);
        }
        gap(G_WEDGE);

        // Alerts
        if (alertas.length > 0) {
          gap(1);
          doc.setFontSize(7.5);
          doc.setFont("helvetica", "normal");
          setColor([180, 0, 0] as [number,number,number]);
          for (const alerta of alertas) {
            const aLines = doc.splitTextToSize(sanitize(`! ${alerta}`), contentW - 14);
            doc.text(aLines, margin + 3, y, { maxWidth: contentW - 14 });
            gap(aLines.length * 5 + 2);
          }
        }

        gap(4);
      }

      gap(4);
    }

    hRule();
  }

  // Síntese Clínica section removed — AI-generated synthesis text removed from PDF.

  if (analysis.observacoes && analysis.observacoes !== "null") {
    gap(3);
    const obsInnerW = contentW - 22;
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "normal");
    const obsLines = doc.splitTextToSize(sanitize(analysis.observacoes), obsInnerW);
    const lineH8 = 5.0; // mm per line at 8.5pt
    const availableH = () => 280 - y;
    const headerH = 8;
    let chunkStart = 0;
    while (chunkStart < obsLines.length) {
      const maxLines = Math.max(1, Math.floor((availableH() - headerH - 10) / lineH8));
      const chunk = obsLines.slice(chunkStart, chunkStart + maxLines);
      const boxH = headerH + chunk.length * lineH8 + 8;
      checkPage(boxH + 6);
      gap(2);
      setFill(C.bgLight);
      setDraw(C.border);
      doc.setLineWidth(0.3);
      doc.roundedRect(margin, y - 5, contentW, boxH, 2, 2, "FD");
      if (chunkStart === 0) {
        doc.setFontSize(8.5);
        doc.setFont("helvetica", "bold");
        setColor(C.muted);
        doc.text(documentText(locale, "observations"), margin + 5, y);
        gap(headerH);
      }
      doc.setFontSize(8.5);
      doc.setFont("helvetica", "normal");
      setColor(C.black);
      doc.text(chunk, margin + 5, y);
      gap(chunk.length * lineH8 + 3);
      chunkStart += maxLines;
    }
    gap(3);
  }

  hRule();

  // ── FOOTER ───────────────────────────────────────────────────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    const pageH = 297;
    setFill(C.bgLight);
    setDraw(C.border);
    doc.setLineWidth(0.2);
    doc.line(margin, pageH - 12, W - margin, pageH - 12);
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    setColor(C.muted);
    doc.text(
      documentText(locale, "aiDisclaimer"),
      margin,
      pageH - 7
    );
    doc.text(documentText(locale, "page", { current: i, total: pageCount }), W - margin, pageH - 7, { align: "right" });
  }

  const tipoSlug = analysis.tipoAnalise ?? "analise";
  const dateSlug = new Date().toISOString().slice(0, 10);
  return { doc, filename: `docknee-rx-${tipoSlug}-${dateSlug}.pdf` };
}
