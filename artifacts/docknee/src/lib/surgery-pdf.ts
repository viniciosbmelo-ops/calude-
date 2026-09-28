import jsPDF from "jspdf";
import { format } from "date-fns";
import type { Locale } from "./i18n";
import { documentDate, documentText, generatedDocumentText } from "@/locales/document-locales";
import {
  surgeryPdfAuthoredText,
  surgeryPdfControlledText,
  surgeryPdfGeneratedClinicalText,
  surgeryPdfOcdText,
} from "@/locales/surgery-pdf";
import {
  classifyPTS,
  getPTSClassificationLabel,
  getPTSClassificationRange,
} from "@/lib/pts-classification";
import { getKrirsDisplayJustification, getKrirsRiskLabel, getKrirsRiskLevel } from "@/lib/krirs-risk";
import {
  getLegacyMeniscalDetails,
  getExplicitMeniscalSideDetails,
  hasExplicitMeniscalSideDetails,
  hasMeaningfulMeniscalDetails,
  type MeniscalSide,
} from "@/lib/meniscal-details";
import { limbHeading, readBilateralDocumentation, type LimbSnapshot } from "@/lib/bilateral-surgery";

type PdfRecord = Record<string, unknown>;

function isPdfRecord(value: unknown): value is PdfRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasPdfValue(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "";
}

/**
 * The API stores this record directly in lca_leap_decision.  Keep this
 * intentionally narrow: these are the two shapes that have actually been
 * persisted (the row itself and the same row nested by the bilateral limb
 * snapshot).  In particular, do not recompute a missing result here.
 */
export function normalizeAclLeapDecision(value: unknown): PdfRecord | null {
  if (!isPdfRecord(value)) return null;
  return value;
}

/**
 * The current API returns the algorithm result as
 * exameOsteocondral.ocdResult.  ocdAnalysis is retained as the compatibility
 * projection used by drafts and older PDF callers.
 */
export function resolveSavedOcdResult(surgery: unknown): unknown {
  if (!isPdfRecord(surgery)) return null;
  const exam = surgery.exameOsteocondral;
  if (isPdfRecord(exam) && hasPdfValue(exam.ocdResult)) return exam.ocdResult;
  return surgery.ocdAnalysis ?? null;
}

const ACL_INPUT_LABELS: Record<string, string> = {
  idade: "Idade",
  sexo: "Sexo",
  enxertoPlanejado: "Enxerto planejado",
  enxerto: "Enxerto planejado",
  pivotShift: "Pivot Shift",
  lachman: "Grau do Lachman",
  hiperextensaoGraus: "Hiperextensão (graus)",
  revisao: "Revisão",
  esqueletoImaturo: "Esqueleto imaturo",
  lesaoCronica: "Lesão crônica",
  esportePivot: "Esporte de pivô",
  ptsGraus: "PTS (graus)",
  contralateralLca: "História de LCA contralateral",
  tabagismo: "Tabagismo",
  atrasoCirurgicoDias: "Atraso cirúrgico (dias)",
  earlyRtsPivot: "Retorno precoce ao pivô",
  tunelComprometido: "Túnel comprometido",
  aloenxertoJovem: "Aloenxerto em paciente jovem",
  allIsoladaConduta: "Reconstrução isolada do ALL",
  segondFratura: "Fratura de Segond",
  notchEstreito: "Chanfradura estreita (notch)",
  lesaoAlcImagem: "Lesão do complexo anterolateral em imagem",
  meniscalConcomitante: "Procedimento meniscal concomitante",
  graftDiametroMm: "Diâmetro do enxerto (mm)",
  leapIndicado: "Indicação LEAP",
  forcaMaxima: "Força máxima",
  decisaoMedico: "Decisão do médico",
  decisaoClinica: "Decisão do médico",
  decisaoCirurgiao: "Decisão do médico",
  physicianDecision: "Decisão do médico",
};

const ACL_RESULT_LABELS: Record<string, string> = {
  disclaimers: "Ressalvas",
  naoCalibrado: "Não calibrado",
  populacao: "População",
  vies: "Viés",
  driversNaoModificaveis: "Drivers não modificáveis",
  regras: "Regras",
  leapIndicado: "Indicação LEAP",
  forcaMaxima: "Força máxima",
  fatoresAcessorios: "Fatores acessórios",
  fatoresAcessoriosCount: "Quantidade de fatores acessórios",
  camadaSeguranca: "Camada de segurança",
  reassurance: "Reasseguramento",
  caveats: "Ressalvas",
  consentComplications: "Complicações para consentimento",
  execucaoTecnica: "Execução técnica",
  nota: "Nota",
  itens: "Itens",
  id: "ID",
  label: "Descrição",
  presente: "Presente",
  modulo: "Módulo",
  forca: "Força",
  evidencia: "Evidência",
  titulo: "Título",
  alavanca: "Alavanca",
  justificativa: "Justificativa",
  contraindicado: "Contraindicado",
};

const ACL_CONTROLLED_KEYS = new Set([
  "sexo",
  "enxertoPlanejado",
  "enxerto",
  "forcaMaxima",
  "forca",
  "revisao",
  "esqueletoImaturo",
  "lesaoCronica",
  "esportePivot",
  "contralateralLca",
  "tabagismo",
  "earlyRtsPivot",
  "tunelComprometido",
  "aloenxertoJovem",
  "allIsoladaConduta",
  "segondFratura",
  "notchEstreito",
  "lesaoAlcImagem",
  "meniscalConcomitante",
  "leapIndicado",
  "presente",
]);

function aclLabel(key: string): string {
  return ACL_INPUT_LABELS[key] ?? ACL_RESULT_LABELS[key] ?? key
    .replace(/([a-zÀ-ÿ])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (char) => char.toUpperCase());
}

function appendAclPairs(
  value: unknown,
  path: string[],
  pairs: Array<{ label: string; value: unknown; controlled?: boolean }>,
): void {
  if (!hasPdfValue(value)) return;
  if (Array.isArray(value)) {
    if (value.length === 0) return;
    value.forEach((item, index) => appendAclPairs(item, [...path, `[${index + 1}]`], pairs));
    return;
  }
  if (isPdfRecord(value)) {
    for (const [key, nested] of Object.entries(value)) {
      appendAclPairs(nested, [...path, key], pairs);
    }
    return;
  }
  const label = path.map((part) => part.startsWith("[") ? part : aclLabel(part)).join(" / ");
  const key = path[path.length - 1];
  pairs.push({ label, value, controlled: typeof value === "boolean" || ACL_CONTROLLED_KEYS.has(key) });
}

function aclScalarPairs(
  decision: PdfRecord,
): Array<{ label: string; value: unknown; controlled?: boolean }> {
  const pairs: Array<{ label: string; value: unknown; controlled?: boolean }> = [];
  const knownKeys = new Set(["resultado", "id", "surgeryId", "createdAt", "updatedAt"]);
  for (const [key, value] of Object.entries(decision)) {
    if (knownKeys.has(key) || !hasPdfValue(value)) continue;
    if (isPdfRecord(value) || Array.isArray(value)) {
      appendAclPairs(value, [key], pairs);
    } else {
      pairs.push({ label: aclLabel(key), value, controlled: typeof value === "boolean" || ACL_CONTROLLED_KEYS.has(key) });
    }
  }
  return pairs;
}

function meaningful(value: unknown): boolean {
  if (value == null || value === "") return false;
  if (Array.isArray(value)) return value.length > 0 && value.some(meaningful);
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).some(meaningful);
  return true;
}

export function bilateralLimbPdfLines(snapshot: LimbSnapshot, locale: Locale = "pt-BR"): string[] {
  const labels: Record<string, string> = {
    tipoCaso: "Tipo de caso", diagnostico: "Diagnostico", alinhamento: "Alinhamento",
    grauAlinhamento: "Grau", tiposProcedimento: "Procedimentos",
    ligamentosAcometidos: "Ligamentos", procedimentoRealizado: "Procedimento realizado",
    observacoes: "Observacoes", exameLigamentar: "Exame ligamentar",
    examePatelar: "Exame patelar", exameOsteocondral: "Exame osteocondral",
    lcaAlgorithm: "Algoritmo LCA", picsScore: "Algoritmo PICS",
    procedimentoMeniscal: "Procedimento meniscal", detalhesProcedimentos: "Detalhes dos procedimentos",
  };
  const stringify = (value: unknown): string => {
    if (Array.isArray(value)) return value.map(stringify).join(", ");
    if (value && typeof value === "object") {
      return Object.entries(value as Record<string, unknown>)
        .filter(([key, nested]) => !key.startsWith("_") && meaningful(nested))
        .map(([key, nested]) => `${key}: ${stringify(nested)}`).join("; ");
    }
    if (typeof value === "boolean") return value ? "Sim" : "Não";
    return String(value);
  };
  const jSignLabel = locale === "es" ? "Signo de J" : "J Sign";
  const jSignGradeLabel = locale === "es" ? "Grado del signo de J" : "Grau do J Sign";
  const yes = locale === "es" ? "Sí" : "Sim";
  const no = locale === "es" ? "No" : "Não";
  const stringifyPatellarExam = (value: unknown): string => {
    if (!isPdfRecord(value)) return stringify(value);
    const parts: string[] = [];
    if (typeof value.jSign === "boolean") {
      parts.push(`${jSignLabel}: ${value.jSign ? yes : no}`);
      if (value.jSign === true && hasPdfValue(value.jSignGrau)) {
        parts.push(`${jSignGradeLabel}: ${String(value.jSignGrau)}`);
      }
    }
    for (const [key, nested] of Object.entries(value)) {
      if (["jSign", "jSignGrau"].includes(key) || key.startsWith("_") || !meaningful(nested)) continue;
      parts.push(`${key}: ${stringify(nested)}`);
    }
    return parts.join("; ");
  };
  return Object.entries(snapshot)
    .filter(([key, value]) => !key.startsWith("_") && key !== "aclLeapDecision" && meaningful(value))
    .map(([key, value]) => `${labels[key] ?? key}: ${key === "examePatelar" ? stringifyPatellarExam(value) : stringify(value)}`);
}

const C = {
  navy:   [10,  24,  40]  as [number, number, number],
  cyan:   [31, 182, 225]  as [number, number, number],
  green:  [21, 128,  61]  as [number, number, number],
  red:    [220,  38,  38] as [number, number, number],
  amber:  [180,  83,   9] as [number, number, number],
  muted:  [107, 114, 128] as [number, number, number],
  border: [226, 232, 240] as [number, number, number],
  bgLight:[248, 250, 252] as [number, number, number],
  bgBlue: [239, 246, 255] as [number, number, number],
  bgGreen:[240, 253, 244] as [number, number, number],
  black:  [ 15,  23,  42] as [number, number, number],
  white:  [255, 255, 255] as [number, number, number],
};

export function splitSurgeryPdfGeneratedText(
  doc: Pick<jsPDF, "splitTextToSize">,
  locale: Locale,
  source: string,
  maxWidth: number,
): string[] {
  return doc.splitTextToSize(surgeryPdfGeneratedClinicalText(locale, source), maxWidth) as string[];
}

type ReforcoPart =
  | { kind: "let" }
  | { kind: "lal"; banda?: string; enxerto?: string }
  | { kind: "loa"; enxerto?: string; fixacao?: string }
  | { kind: "raw"; text: string };

function parseReforco(reforcoStr?: string | null): ReforcoPart[] {
  if (!reforcoStr) return [];
  try {
    const r = JSON.parse(reforcoStr);
    const parts: ReforcoPart[] = [];
    if (r.let) parts.push({ kind: "let" });
    if (r.lal) {
      parts.push({
        kind: "lal",
        banda: r.lalBanda ? String(r.lalBanda) : undefined,
        enxerto: r.lalEnxerto ? String(r.lalEnxerto) : undefined,
      });
    }
    if (r.loa) {
      parts.push({
        kind: "loa",
        enxerto: r.loaEnxerto ? String(r.loaEnxerto) : undefined,
        fixacao: r.loaFixacao ? String(r.loaFixacao) : undefined,
      });
    }
    return parts;
  } catch {
    return reforcoStr ? [{ kind: "raw", text: reforcoStr }] : [];
  }
}

const EXAME_LABELS: Record<string, string> = {
  lachman: "Lachman",
  gavetaNeutra: "Gaveta Neutra (Anterior)",
  pivotShift: "Pivot Shift",
  aderTest: "ADER Test",
  gavetaRotInterna: "Gaveta Rot. Interna",
  estresseValgo0: "Estresse Valgo 0°",
  estresseValgo30: "Estresse Valgo 30°",
  estresseVaro0: "Estresse Varo 0°",
  estresseVaro30: "Estresse Varo 30°",
  gavetaPosterior: "Gaveta Posterior",
  sagSign: "Sag Sign",
  quadricepsAtivo: "Quadriceps Ativo",
  dialTest: "Dial Test",
  dialTest30: "Dial Test 30°",
  dialTest90: "Dial Test 90°",
  recurvato: "Recurvatum",
  gavetaRotatoria: "Gaveta Rotatoria Postero-Lateral",
  hiperextensao: "Hiperextensao",
  slopeTibialPts: "Slope Tibial Posterior (PTS)",
};

function sanitize(s: string): string {
  return s
    .replace(/[\u2018\u2019\u0060\u00B4]/g, "'")
    .replace(/[\u201C\u201D\u00AB\u00BB]/g, '"')
    // Helvetica/WinAnsi cannot encode mathematical comparison signs. Keep
    // their meaning instead of silently replacing a persisted threshold with
    // a question mark.
    .replace(/\u2265/g, ">=")
    .replace(/\u2264/g, "<=")
    .replace(/\u2260/g, "!=")
    .replace(/\u2212/g, "-")
    .replace(/\u2014/g, " -- ")
    .replace(/\u2013/g, "-")
    .replace(/\u2022/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00B2/g, "2")
    .replace(/\u00B3/g, "3")
    .replace(/[^\x00-\xFF]/g, "?");
}

import type { BioReadyResult } from "./regen-bioready";

export async function generateSurgeryPDF(surgery: any, bioReadyResult?: BioReadyResult, locale: Locale = "pt-BR"): Promise<{ doc: jsPDF; filename: string }> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = 210;
  const margin = 16;
  const cW = W - margin * 2;
  const pageTop = 16;
  const contentBottom = 276;
  let y = 0;
  const generated = (text: string) => {
    const specific = surgeryPdfAuthoredText(locale, text);
    return specific !== text ? specific : generatedDocumentText(locale, text);
  };
  const generatedLabel = (text: string) => {
    if (!text.includes(" / ")) return generated(text);
    return text.split(" / ").map((part) => generated(part)).join(" / ");
  };
  const controlled = (value: unknown) => surgeryPdfControlledText(
    locale,
    typeof value === "boolean"
      ? (value ? "Sim" : locale === "es" ? "Nao" : "Não")
      : String(value ?? ""),
  );
  const generatedClinical = (value: unknown) => surgeryPdfGeneratedClinicalText(locale, String(value ?? ""));
  const ocdText = (value: unknown) => surgeryPdfOcdText(locale, String(value ?? ""));

  // ── helpers ──────────────────────────────────────────────────────────────────
  const setColor = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2]);
  const setFill  = (c: [number, number, number]) => doc.setFillColor(c[0], c[1], c[2]);
  const setDraw  = (c: [number, number, number]) => doc.setDrawColor(c[0], c[1], c[2]);
  const gap = (mm: number) => { y += mm; };
  const lh = (size: number) => size * 0.42;

  function txt(
    str: string, x: number, size: number,
    opts?: { bold?: boolean; color?: [number, number, number]; align?: "left"|"center"|"right"; maxWidth?: number }
  ) {
    doc.setFontSize(size);
    doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
    if (opts?.color) setColor(opts.color);
    doc.text(sanitize(generated(str)), x, y, { align: opts?.align ?? "left", maxWidth: opts?.maxWidth });
  }

  function wrappedLines(str: string, x: number, size: number, maxW: number,
    opts?: { bold?: boolean; color?: [number, number, number] }): number {
    doc.setFontSize(size);
    doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
    if (opts?.color) setColor(opts.color);
    const lines = doc.splitTextToSize(sanitize(str), maxW);
    doc.text(lines, x, y, { maxWidth: maxW });
    return lines.length;
  }

  function hRule(lw = 0.2) {
    setDraw(C.border);
    doc.setLineWidth(lw);
    doc.line(margin, y, W - margin, y);
    gap(2);
  }

  function checkPage(need = 20) {
    if (y + need > contentBottom) { doc.addPage(); y = pageTop; }
  }

  function sectionHeader(title: string) {
    checkPage(10);
    gap(2);
    setFill(C.navy);
    doc.roundedRect(margin, y - 3, cW, 7, 1.5, 1.5, "F");
    setColor(C.white);
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "bold");
    doc.text(sanitize(generated(title).toUpperCase()), margin + 4, y);
    gap(7);
    setColor(C.black);
  }

  function kvGrid(pairs: { label: string; value?: unknown; controlled?: boolean }[], cols = 2) {
    const valid = pairs.filter(p => hasPdfValue(p.value));
    if (valid.length === 0) return;
    gap(1);
    const effectiveCols = valid.length === 1 ? 1 : cols;
    const colW = cW / effectiveCols;
    const lineHeight = lh(8);

    // Draw one pair at a time when a value is taller than a page. This is
    // deliberately separate from the normal two-column path: a long saved
    // rationale must be split before drawing, never after rowY was captured.
    const drawLongPair = (
      pair: { label: string; value?: unknown; controlled?: boolean },
      width: number,
    ) => {
      const valueText = sanitize(pair.controlled ? controlled(pair.value) : String(pair.value));
      const lines = doc.splitTextToSize(valueText, width - 4) as string[];
      let offset = 0;
      while (offset < lines.length) {
        checkPage(3.5 + lineHeight + 1.5);
        const availableLines = Math.max(
          1,
          Math.floor((contentBottom - y - 5) / lineHeight),
        );
        const count = Math.min(lines.length - offset, availableLines);
        doc.setFontSize(7);
        doc.setFont("helvetica", "normal");
        setColor(C.muted);
        doc.text(sanitize(generatedLabel(pair.label)), margin, y);
        setColor(C.black);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.text(lines.slice(offset, offset + count), margin, y + 3.5, { maxWidth: width - 4 });
        y += 3.5 + lineHeight * count + 1.5;
        offset += count;
        if (offset < lines.length) {
          doc.addPage();
          y = pageTop;
        }
      }
      gap(2);
    };

    for (let index = 0; index < valid.length; index += effectiveCols) {
      const row = valid.slice(index, index + effectiveCols);
      const metrics = row.map((pair) => {
        const valueText = sanitize(pair.controlled ? controlled(pair.value) : String(pair.value));
        doc.setFontSize(8);
        const lines = doc.splitTextToSize(valueText, colW - 4) as string[];
        return { pair, lines, height: 3.5 + lineHeight * lines.length + 1.5 };
      });
      const rowHeight = Math.max(...metrics.map((metric) => metric.height));

      // A row that cannot fit on a page is rendered as independent full-width
      // pairs, allowing each long value to continue onto a fresh page.
      if (rowHeight > contentBottom - pageTop - 4) {
        for (const { pair } of metrics) drawLongPair(pair, cW);
        continue;
      }

      checkPage(rowHeight + 2);
      const rowY = y;
      metrics.forEach(({ pair, lines }, column) => {
        doc.setFontSize(7);
        doc.setFont("helvetica", "normal");
        setColor(C.muted);
        doc.text(sanitize(generatedLabel(pair.label)), margin + column * colW, rowY);
        setColor(C.black);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.text(lines, margin + column * colW, rowY + 3.5, { maxWidth: colW - 4 });
      });
      y = rowY + rowHeight + 2;
    }
    gap(1);
  }

  function controlledKvGrid(pairs: { label: string; value?: unknown }[], cols = 2) {
    kvGrid(pairs.map((pair) => ({ ...pair, controlled: true })), cols);
  }

  function renderAclDecisionSection(rawDecision: unknown, sideHeading?: string): boolean {
    const decision = normalizeAclLeapDecision(rawDecision);
    if (!decision) return false;

    sectionHeader("DocSholder AI Decision — LEAP");
    if (sideHeading) {
      checkPage(8);
      txt(sideHeading, margin, 8, { bold: true, color: C.cyan });
      gap(5);
    }

    const inputPairs = aclScalarPairs(decision);
    const ptsClassification = classifyPTS(decision.ptsGraus);
    if (ptsClassification) {
      inputPairs.push({
        label: locale === "es" ? "Clasificación PTS" : "Classificação PTS",
        value: `${getPTSClassificationLabel(ptsClassification, locale)} (${getPTSClassificationRange(ptsClassification, locale)})`,
      });
    }
    if (inputPairs.length > 0) {
      checkPage(8);
      doc.setFontSize(7.5);
      doc.setFont("helvetica", "bold");
      setColor(C.muted);
      doc.text(generated("Entradas Clinicas Salvas"), margin, y);
      gap(4);
      kvGrid(inputPairs);
    }

    const result = decision.resultado;
    if (isPdfRecord(result)) {
      const resultPairs: Array<{ label: string; value: unknown; controlled?: boolean }> = [];
      appendAclPairs(result, [], resultPairs);
      if (resultPairs.length > 0) {
        checkPage(8);
        doc.setFontSize(7.5);
        doc.setFont("helvetica", "bold");
        setColor(C.muted);
        doc.text(generated("Resultado Salvo"), margin, y);
        gap(4);
        // A single column keeps long rationales readable and prevents a
        // rationale from being visually separated from its rule.
        kvGrid(resultPairs, 1);
      }
    }
    return true;
  }

  function scoreCard(label: string, value: string | number, sub?: string, x = margin, w = 40, h = 18) {
    setFill(C.bgBlue);
    setDraw(C.border);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, y, w, h, 2, 2, "FD");
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    setColor(C.navy);
    doc.text(String(value), x + w / 2, y + 10, { align: "center" });
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    setColor(C.muted);
    doc.text(sanitize(generated(label)), x + w / 2, y + 15, { align: "center" });
    if (sub) {
      doc.setFontSize(6);
      doc.text(sanitize(generated(sub)), x + w / 2, y + h - 1.5, { align: "center" });
    }
  }

  // ── PAGE HEADER ──────────────────────────────────────────────────────────────
  function pageHeader() {
    setColor(C.muted);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    const dateNow = documentDate(locale, new Date(), { day: "2-digit", month: "2-digit", year: "numeric" });
    doc.text(`${documentText(locale, "generatedOn")} ${dateNow}`, W - margin, 11, { align: "right" });

    setDraw(C.border);
    doc.setLineWidth(0.2);
    doc.line(margin, 16, W - margin, 16);
    y = 20;
  }

  // ── PAGE FOOTER ──────────────────────────────────────────────────────────────
  function addFooters(totalPages: number) {
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      setDraw(C.border);
      doc.setLineWidth(0.2);
      doc.line(margin, 285, W - margin, 285);
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      setColor(C.muted);
       doc.text(documentText(locale, "confidential"), margin, 290);
       doc.text(documentText(locale, "page", { current: i, total: totalPages }), W - margin, 290, { align: "right" });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // BUILD DOCUMENT
  // ═══════════════════════════════════════════════════════════════════════
  pageHeader();

  const patientName = surgery.patient?.nome ?? "—";
  const dateSurg = surgery.dataCirurgia
    ? format(new Date(surgery.dataCirurgia), "dd/MM/yyyy") : "—";

  setFill(C.bgLight);
  doc.roundedRect(margin, y, cW, 11, 2, 2, "F");
  setColor(C.navy);
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text(sanitize(generated("Resumo Cirurgico")), margin + 4, y + 7.5);
  gap(12);

  // ── 1. IDENTIFICAÇÃO ─────────────────────────────────────────────────
  sectionHeader("1. Identificacao do Paciente");
  const dataNasc = surgery.patient?.dataNascimento
    ? (() => { try { return format(new Date(surgery.patient.dataNascimento), "dd/MM/yyyy"); } catch { return surgery.patient.dataNascimento; } })()
    : null;
  kvGrid([
    { label: "Nome",                value: patientName },
    { label: "Sexo",                value: surgery.patient?.sexo, controlled: true },
    { label: "CPF",                 value: surgery.patient?.cpf || "—" },
    { label: "Data de Nascimento",  value: dataNasc },
    { label: "Telefone",            value: surgery.patient?.telefone },
    { label: "E-mail",              value: (surgery.patient as any)?.email || "—" },
    { label: "Lado Preferido",      value: surgery.patient?.lado, controlled: true },
    { label: "Data do Procedimento", value: dateSurg },
    { label: "Hospital / Local",    value: surgery.hospital },
  ]);
  const bilateral = surgery.lado === "Bilateral"
    ? readBilateralDocumentation(surgery.procedimentosDetalhados)
    : null;

  // ── 2. CLASSIFICAÇÃO ─────────────────────────────────────────────────
  if (!bilateral) sectionHeader("2. Classificacao do Caso");

  // Build full procedure names
  const procedimentoNomes = (() => {
    const tipos = (surgery.tiposProcedimento ?? []) as string[];
    if (!tipos.length) return null;
    const labels: string[] = [];
    for (const t of tipos) {
      if (t === "Artroplastias") {
        try {
          const d = JSON.parse((surgery as any).procedimentosDetalhados ?? "{}");
          const atj = d.artroplastia;
          const TYPE_MAP: Record<string, string> = {
            "TKA": "Artroplastia Total do Joelho (ATJ)",
            "UKA": "Artroplastia Unicompartimental do Joelho (UKA)",
            "PKA": "Artroplastia Patelofemoral (PKA)",
            "Revisao": "Revisao de Artroplastia",
          };
          const COMP_MAP: Record<string, string> = {
            "Tricompartimental": "Artroplastia Total do Joelho (ATJ)",
            "Unicompartimental": "Artroplastia Unicompartimental do Joelho (UKA)",
          };
          if (atj?.tipo && TYPE_MAP[atj.tipo]) {
            labels.push(TYPE_MAP[atj.tipo]);
          } else if (atj?.compartimento && COMP_MAP[atj.compartimento]) {
            labels.push(COMP_MAP[atj.compartimento]);
          } else {
            labels.push("Artroplastia do Joelho");
          }
        } catch {
          labels.push("Artroplastia do Joelho");
        }
      } else {
        labels.push(t);
      }
    }
    return labels.join(", ") || null;
  })();

  if (!bilateral) {
    kvGrid([
      { label: "Tipo de Caso",    value: surgery.tipoCaso, controlled: true },
      { label: "Diagnostico",     value: surgery.diagnostico },
      { label: "Alinhamento",     value: surgery.alinhamento, controlled: true },
      { label: "Grau",            value: surgery.grauAlinhamento },
      { label: "Procedimentos",   value: procedimentoNomes?.split(", ").map(controlled).join(", "), controlled: false },
      { label: "Ligamentos",      value: (surgery.ligamentosAcometidos ?? []).map((l: string) => controlled(l === "PLC" ? "CPL" : l)).join(", ") || null },
    ]);
  }
  if (bilateral) {
    for (const limb of ["direito", "esquerdo"] as const) {
      const snapshot = bilateral.byLimb[limb];
      sectionHeader(limbHeading(limb, locale));
      if (!snapshot) continue;
      for (const line of bilateralLimbPdfLines(snapshot, locale)) {
        checkPage(10);
        const count = wrappedLines(generatedClinical(line), margin + 2, 7.5, cW - 4);
        gap(lh(7.5) * count + 2);
      }
       // In a bilateral record this side-owned snapshot is authoritative.
       // Never fall back to the flat compatibility row, which belongs to the
       // active limb and would duplicate/misattribute the decision.
       renderAclDecisionSection(snapshot.aclLeapDecision);
    }
  }

  // ── BioReady Score® ─────────────────────────────────────────────────
  if (bioReadyResult) {
    sectionHeader("BioReady Score\u00ae \u2014 Prontidao Biologica");

    // Main score card
    checkPage(20);
    const gradeColorMap: Record<string, [number,number,number]> = {
      excellent: [5, 150, 105],
      good:      [2, 132, 199],
      optimize:  [217, 119, 6],
      defer:     [220,  38, 38],
    };
    const gc = gradeColorMap[bioReadyResult.grade] ?? C.navy;
    const bgMap: Record<string, [number,number,number]> = {
      excellent: [236, 253, 245],
      good:      [240, 249, 255],
      optimize:  [255, 251, 235],
      defer:     [254, 242, 242],
    };
    const bg = bgMap[bioReadyResult.grade] ?? C.bgLight;

    setFill(bg);
    setDraw(gc);
    doc.setLineWidth(0.5);
    doc.roundedRect(margin, y, cW, 16, 2, 2, "FD");
    // Score number (big)
    doc.setFontSize(22);
    doc.setFont("helvetica", "bold");
    setColor(gc);
    doc.text(String(bioReadyResult.score), margin + 8, y + 11, { align: "center" });
    // Labels
    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    setColor(C.muted);
    doc.text("BIOREADY SCORE\u00ae", margin + 16, y + 5);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    setColor(gc);
    doc.text(sanitize(controlled(bioReadyResult.gradeLabel)), margin + 16, y + 10);
    if (bioReadyResult.isIncomplete) {
      doc.setFontSize(6.5);
      doc.setFont("helvetica", "italic");
      setColor(C.amber);
      doc.text(sanitize(generated("Dados insuficientes — preencha a anamnese para laudo completo")), margin + 16, y + 14.5);
    }
    // Completude (right)
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    setColor(C.muted);
    doc.text(`${generated("Completude")}: ${Math.round(bioReadyResult.dataCompleteness * 100)}%`, W - margin - 2, y + 5, { align: "right" });
    gap(19);

    // Factors compact grid (2 columns)
    checkPage(Math.ceil(bioReadyResult.factors.length / 2) * 6 + 4);
    const factors = bioReadyResult.factors;
    const fColW = cW / 2;
    let fCol = 0;
    let fRowY = y;
    let fMaxH = 0;
    for (const f of factors) {
      if (fCol === 0) {
        checkPage(6);
        fRowY = y;
        fMaxH = 0;
      }
      const dotColor: [number,number,number] = f.status === "green" ? C.green
        : f.status === "yellow" ? C.amber
        : f.status === "red" ? C.red
        : C.border;
      const scoreText = f.status === "na" ? "—" : `${f.score}/10`;
      const xBase = margin + fCol * fColW;
      // dot
      setFill(dotColor);
      doc.circle(xBase + 1.5, fRowY - 0.5, 1.2, "F");
      // label
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      setColor(C.muted);
      doc.text(sanitize(controlled(f.label)), xBase + 5, fRowY, { maxWidth: fColW - 14 });
      // score
      doc.setFont("helvetica", "bold");
      setColor(f.status === "na" ? C.muted : C.navy);
      doc.text(scoreText, xBase + fColW - 2, fRowY, { align: "right" });
      fMaxH = Math.max(fMaxH, 5);
      fCol++;
      if (fCol >= 2) {
        fCol = 0;
        y = fRowY + fMaxH;
      }
    }
    if (fCol > 0) y = fRowY + fMaxH;
    gap(3);

    // Top recommendations
    if (bioReadyResult.topRecommendations.length > 0) {
      checkPage(8 + bioReadyResult.topRecommendations.length * 8);
      doc.setFontSize(7);
      doc.setFont("helvetica", "bold");
      setColor(C.muted);
      doc.text(`${generated("Prioridades de otimizacao")}:`, margin, y);
      gap(4);
      for (const rec of bioReadyResult.topRecommendations) {
        checkPage(10);
        const recLines = doc.splitTextToSize(sanitize(generatedClinical(rec)), cW - 8);
        const recH = recLines.length * 3.8 + 5;
        setFill([255, 251, 235] as [number,number,number]);
        setDraw(C.amber);
        doc.setLineWidth(0.3);
        doc.roundedRect(margin, y, cW, recH, 1.5, 1.5, "FD");
        setColor(C.amber);
        doc.setFontSize(7.5);
        doc.setFont("helvetica", "normal");
        doc.text(recLines, margin + 4, y + 4);
        gap(recH + 2);
      }
    }
    gap(2);
  }

  if (!bilateral) {
    renderAclDecisionSection(surgery.aclLeapDecision);
  }

  // Bilateral clinical data is authoritative in the two snapshots above.
  // Never continue into the unlabeled flat compatibility projection.
  if (bilateral) {
    const followups = Array.isArray(surgery.followups) ? surgery.followups : [];
    if (followups.length > 0) {
      sectionHeader(locale === "es" ? "Seguimientos postoperatorios" : "Acompanhamentos pos-operatorios");
      followups.forEach((followup: Record<string, unknown>, index: number) => {
        checkPage(10);
        txt(`${index + 1}. ${String(followup.tempo ?? "")}`, margin + 2, 8, { bold: true, color: C.navy });
        gap(4);
        for (const line of bilateralLimbPdfLines(followup)) {
          if (line.startsWith("id:") || line.startsWith("surgeryId:")) continue;
          checkPage(8);
          const count = wrappedLines(generatedClinical(line), margin + 4, 7, cW - 6);
          gap(lh(7) * count + 1.5);
        }
        gap(2);
      });
    }
    addFooters(doc.getNumberOfPages());
    const safeName = patientName.replace(/[^a-zA-Z0-9À-ÿ\s]/g, "").replace(/\s+/g, "_");
    const dateSafe = surgery.dataCirurgia
      ? format(new Date(surgery.dataCirurgia), "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");
    return { doc, filename: `DocSholder_Resumo_${safeName}_${dateSafe}.pdf` };
  }

  // ── 3. EXAME FÍSICO LIGAMENTAR ────────────────────────────────────────
  const exame = surgery.exameLigamentar;
  const lca = surgery.lcaAlgorithm;
  const hasExame = exame && Object.keys(exame).some(k => !["id","surgeryId","createdAt"].includes(k) && exame[k] != null);
  if (hasExame) {
    sectionHeader("3. Exame Fisico Ligamentar");

    // Hiperextensão — apenas destaque colorido se limítrofe ou hiperlaxidade
    if (exame.hiperextensao) {
      if (exame.hiperextensao === "<5") {
        // Normal: mostrar como linha simples sem caixa colorida
        kvGrid([{ label: "Hiperextensao do Joelho", value: "< 5\u00b0 \u2014 Normal", controlled: true }]);
      } else {
        checkPage(12);
        const isHigh = exame.hiperextensao === ">6.5" || exame.hiperextensao === ">7.5";
        const hiperColor = isHigh ? C.red : C.amber;
        const hiperTxt = !isHigh
          ? "5 \u2013 6,5\u00b0 \u2014 Limitrofe"
          : "\u2265 6,5\u00b0 \u2014 Hiperlaxidade";
        setFill(C.bgLight);
        setDraw(C.border);
        doc.setLineWidth(0.3);
        doc.roundedRect(margin, y, cW, 9, 1.5, 1.5, "FD");
        setColor(C.muted);
        doc.setFontSize(7);
        doc.setFont("helvetica", "normal");
        doc.text(sanitize(generated("Hiperextensao do Joelho")), margin + 3, y + 3);
        setColor(hiperColor);
        doc.setFontSize(8);
        doc.setFont("helvetica", "bold");
        doc.text(sanitize(controlled(hiperTxt)), margin + 3, y + 6.5);
        gap(11);
      }
    }

    // LCA-specific fields first (priority display)
    const lcaExamePairs: { label: string; value?: string | null; controlled?: boolean }[] = [];
    if (exame.lachman != null) lcaExamePairs.push({ label: "Lachman", value: String(exame.lachman), controlled: true });
    if (exame.gavetaNeutra != null) lcaExamePairs.push({ label: "Gaveta Neutra (Anterior)", value: String(exame.gavetaNeutra), controlled: true });
    if (exame.pivotShift != null) lcaExamePairs.push({ label: "Pivot Shift", value: String(exame.pivotShift), controlled: true });
    if (lca?.esportePivot != null) lcaExamePairs.push({ label: "Esportes com Pivo", value: lca.esportePivot ? "Sim" : "Não", controlled: true });
    if (exame.aderTest != null) lcaExamePairs.push({ label: "ADER Test", value: exame.aderTest ? "Positivo" : "Negativo", controlled: true });

    // Other fields
    const otherSkip = ["id","surgeryId","createdAt","hiperextensao","lachman","gavetaNeutra","pivotShift","aderTest"];
    const otherPairs = Object.entries(exame)
      .filter(([k, v]) => !otherSkip.includes(k) && v != null)
      .map(([k, v]) => {
        const ptsClassification = k === "slopeTibialPts" ? classifyPTS(v) : null;
        return {
          label: EXAME_LABELS[k] ?? k.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase()).trim(),
          value: ptsClassification
            ? `${String(v)}° — ${getPTSClassificationLabel(ptsClassification, locale)} (${getPTSClassificationRange(ptsClassification, locale)})`
            : typeof v === "boolean" ? (v ? "Positivo" : "Negativo") : String(v),
          controlled: typeof v === "boolean" || Object.prototype.hasOwnProperty.call(EXAME_LABELS, k),
        };
      });

    kvGrid([...lcaExamePairs, ...otherPairs]);
  }

  const examePatelar = surgery.examePatelar;
  const hasExamePatelar = examePatelar && Object.entries(examePatelar).some(
    ([key, value]) => !["id", "surgeryId", "createdAt"].includes(key) && value != null,
  );
  if (hasExamePatelar) {
    sectionHeader("Exame Femoropatelar");
    const patellarPairs: { label: string; value?: string | number | null; controlled?: boolean }[] = [];
    for (const [key, value] of Object.entries(examePatelar)) {
      if (["id", "surgeryId", "createdAt", "jSignGrau"].includes(key) || value == null) continue;
      patellarPairs.push({
        label: key === "jSign" ? "J Sign" : EXAME_LABELS[key] ?? key.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase()).trim(),
        value: typeof value === "boolean" ? (value ? "Positivo" : "Negativo") : String(value),
        controlled: typeof value === "boolean" || key === "jSign",
      });
    }
    if (examePatelar.jSign === true && examePatelar.jSignGrau != null) {
      patellarPairs.push({ label: "Grau do J Sign", value: String(examePatelar.jSignGrau) });
    }
    kvGrid(patellarPairs);
  }

  // ── 4. ALGORITMOS CLÍNICOS ──────────────────────────────────────────
  const pics = surgery.picsScore;
  if (lca?.krirsInterpretacao != null || lca?.krirsScore != null || pics?.ptsTotal != null) {
    sectionHeader("4. Algoritmos Clinicos");

    if (lca?.krirsInterpretacao != null || lca?.krirsScore != null) {
      const exame = surgery.exameLigamentar;
      const instabAM = exame?.aderTest === true;
      const instabAL = exame?.gavetaRotInterna === true || (lca.pivotShift ?? 0) >= 2;
      const riskLevel = getKrirsRiskLevel(lca.krirsScore, lca.flagAltoRisco, lca.krirsInterpretacao);
      const riskLabel = getKrirsRiskLabel(riskLevel, locale);

      checkPage(14);
      // Compact header line: label + risk classification inline
      setFill(C.bgBlue);
      setDraw(C.border);
      doc.setLineWidth(0.3);
      doc.roundedRect(margin, y, cW, 10, 1.5, 1.5, "FD");
      // Label
      doc.setFontSize(7);
      doc.setFont("helvetica", "bold");
      setColor(C.navy);
      doc.text(generated("KRIRS — LCA"), margin + 3, y + 4);
      doc.setFontSize(8.5);
      doc.text(sanitize(riskLabel), margin + 36, y + 5);
      gap(12);

      kvGrid([{ label: "Tecnica Principal", value: lca.tecnicaRecomendada, controlled: true }]);

      if (lca.justificativa) {
        checkPage(10);
        const justification = getKrirsDisplayJustification(lca.justificativa, riskLevel, locale);
        const n = wrappedLines(generated(justification), margin + 3, 7.5, cW - 6, { color: C.muted });
        gap(lh(7.5) * n + 3);
      }

      // Instability alerts — inline text, no filled rect
      if (instabAM || instabAL) {
        checkPage(10);
        const alertMsg = instabAM && instabAL
          ? "! Instabilidade Combinada (ADER+): Reconstrucao Dupla Extra-Articular \u2014 LOA + LAL/LET"
          : instabAM
          ? "! ADER Test Positivo \u2014 Instabilidade Anteromedial: Recomendar LOA (Ligamento Obliquo Anterior)"
          : "! Instabilidade Anterolateral (Gaveta Rot. Interna / Pivot Shift): Recomendar LAL/LET";
        const alertColor: [number,number,number] = instabAM && instabAL ? C.red : instabAM ? C.amber : [30,64,175];
        const n = wrappedLines(generated(alertMsg), margin + 2, 7.5, cW - 4, { color: alertColor, bold: true });
        gap(lh(7.5) * n + 3);
      }
    }

    if (pics?.ptsTotal != null) {
      checkPage(14);
      setFill(C.bgBlue);
      setDraw(C.border);
      doc.setLineWidth(0.3);
      doc.roundedRect(margin, y, cW, 10, 1.5, 1.5, "FD");
      doc.setFontSize(7);
      doc.setFont("helvetica", "bold");
      setColor(C.navy);
      doc.text(generated("PICS 2.0 — Patelar"), margin + 3, y + 4);
      doc.setFontSize(11);
      doc.text(String(pics.ptsTotal), margin + 44, y + 5);
      doc.setFontSize(6.5);
      doc.setFont("helvetica", "normal");
      setColor(C.muted);
      doc.text(generated("pontos"), margin + 55, y + 4);
      gap(12);
      kvGrid([
        { label: "Risco",   value: pics.ptsRisco, controlled: true },
        { label: "Conduta", value: pics.ptsConduta, controlled: true },
      ]);
    }
  }

  // ── 5. TÉCNICA CIRÚRGICA PRINCIPAL — LCA ────────────────────────────
  const reforcoLines = parseReforco(surgery.reforco);
  const isLcaReparo = (surgery as any).tipoLca === "Reparo";
  const hasLcaTecnica = surgery.enxerto || surgery.diametroEnxerto || (surgery as any).flipCutter || (surgery as any).tunelFemoral ||
    surgery.fixacaoFemoral || surgery.fixacaoTibial || reforcoLines.length > 0 ||
    (isLcaReparo && ((surgery as any).localizacaoLesaoLca || (surgery as any).fixacaoReparoLca || (surgery as any).internalBrace));
  if (hasLcaTecnica) {
    sectionHeader("5. Tecnica Cirurgica Principal — LCA (Ligamento Cruzado Anterior)");
    if (isLcaReparo) {
      kvGrid([
        { label: "Tipo de Cirurgia",       value: "Reparo do LCA", controlled: true },
        { label: "Localizacao da Lesao",   value: (surgery as any).localizacaoLesaoLca, controlled: true },
        { label: "Fixacao",                value: (surgery as any).fixacaoReparoLca, controlled: true },
        { label: "Internal Brace",         value: (surgery as any).internalBrace, controlled: true },
      ]);
    } else {
    kvGrid([
      { label: "Enxerto",           value: surgery.enxerto, controlled: true },
      { label: "Diametro",          value: surgery.diametroEnxerto },
      { label: "FlipCutter utilizado", value: (surgery as any).flipCutter, controlled: true },
      { label: "Tunel Femoral",     value: (surgery as any).tunelFemoral, controlled: true },
      { label: "Fixacao Femoral",   value: surgery.fixacaoFemoral, controlled: true },
      { label: "Fixacao Tibial",    value: surgery.fixacaoTibial, controlled: true },
      { label: "Internal Brace",    value: (surgery as any).internalBrace, controlled: true },
      { label: "Preservacao do Remanescente", value: (surgery as any).preservacaoRemanescente, controlled: true },
    ]);
    }
    if (reforcoLines.length > 0) {
      checkPage(8 + reforcoLines.length * 5);
      doc.setFontSize(7.5);
      doc.setFont("helvetica", "bold");
      setColor(C.muted);
      doc.text(`${generated("Reconstrucao Extra-Articular")}:`, margin, y);
      gap(4);
      for (const line of reforcoLines) {
        checkPage(6);
        setColor(C.navy);
        doc.setFontSize(8);
        doc.setFont("helvetica", "bold");
        let lineText: string;
        if (line.kind === "raw") {
          lineText = line.text;
        } else {
          const fixed = line.kind === "let"
            ? "LET — Ligamento Extra-articular Tecidual"
            : line.kind === "lal"
              ? "LAL — Ligamento Anterolateral"
              : "LOA — Ligamento Obliquo Anterior";
          lineText = generatedClinical(fixed);
          if (line.kind === "lal" && line.banda) lineText += ` (${line.banda})`;
          if ((line.kind === "lal" || line.kind === "loa") && line.enxerto) {
            lineText += ` · ${generated("Enxerto")}: ${line.enxerto}`;
          }
          if (line.kind === "loa" && line.fixacao) {
            lineText += ` · ${generated("Fixacao Femoral")}: ${controlled(line.fixacao)}`;
          }
        }
        doc.text(sanitize("•  " + lineText), margin + 2, y);
        gap(lh(8) + 2.5);
      }
      gap(1);
    }
  }


  // ── 5d. RECONSTRUÇÃO DO LCM ──────────────────────────────────────────
  const ligamentosArr = (surgery.ligamentosAcometidos ?? []) as string[];
  {
    let lcmData: { tecnica?: string; enxerto?: string; fixacaoProximal?: string; fixacaoDistal?: string } | undefined;
    if ((surgery as any).procedimentosDetalhados) {
      try {
        const parsed = JSON.parse((surgery as any).procedimentosDetalhados);
        lcmData = parsed.lcm;
      } catch { /* ignore */ }
    }
    if (ligamentosArr.includes("LCM")) {
      sectionHeader("Reconstrucao — LCM (Ligamento Colateral Medial)");
      const pairs = [
        { label: "Tecnica",          value: lcmData?.tecnica   || null, controlled: true },
        { label: "Enxerto",          value: lcmData?.enxerto   || null, controlled: true },
        { label: "Fixacao Proximal", value: lcmData?.fixacaoProximal || null, controlled: true },
        { label: "Fixacao Distal",   value: lcmData?.fixacaoDistal   || null, controlled: true },
      ].filter(p => p.value);
      if (pairs.length > 0) {
        kvGrid(pairs);
      } else {
        checkPage(8);
        setColor(C.muted);
        doc.setFontSize(7.5);
        doc.setFont("helvetica", "normal");
        doc.text(generated("Tecnica nao especificada"), margin, y);
        gap(7);
      }
    }
  }

  if ((surgery as any).procedimentosDetalhados) {
    try {
      const d = JSON.parse((surgery as any).procedimentosDetalhados);

      // Osteotomia / Ortobiológico
      const ost = d.osteotomia;
      const ostParts: string[] = [];
      if (ost?.tibial) {
        let s = "Osteotomia Tibial";
        if (ost.tibialLado) s += ` ${ost.tibialLado}`;
        if (ost.tibialTipo) s += ` de ${ost.tibialTipo}`;
        if (ost.tibialAngulo) s += ` — ${ost.tibialAngulo}deg`;
        ostParts.push(s);
      } else if (ost?.tibialAberturaMedial) {
        ostParts.push("Osteotomia Tibial de Abertura Medial");
      }
      if (ost?.femoral) {
        let s = "Osteotomia Femoral";
        if (ost.femoralLado) s += ` ${ost.femoralLado}`;
        if (ost.femoralTipo) s += ` de ${ost.femoralTipo}`;
        if (ost.femoralAngulo) s += ` — ${ost.femoralAngulo}deg`;
        ostParts.push(s);
      }
      if (ost?.dupla) {
        const tibPart = [ost.duplaTibialLado, ost.duplaTibialTipo && `de ${ost.duplaTibialTipo}`, ost.duplaTibialAngulo && `${ost.duplaTibialAngulo}deg`].filter(Boolean).join(" ");
        const femPart = [ost.duplaFemoralLado, ost.duplaFemoralTipo && `de ${ost.duplaFemoralTipo}`, ost.duplaFemoralAngulo && `${ost.duplaFemoralAngulo}deg`].filter(Boolean).join(" ");
        ostParts.push(`Dupla Osteotomia${tibPart ? ` - Tibial: ${tibPart}` : ""}${femPart ? ` / Femoral: ${femPart}` : ""}`);
      }
      if (ost?.slop) {
        let s = "Correcao do SLOP Tibial";
        if (ost.slopGrau) s += ` — ${ost.slopGrau}deg`;
        ostParts.push(s);
      }
      if (ost?.enxertoOsseo) {
        let s = "Enxerto Osseo Associado";
        if (ost.enxertoOsseoTipo) s += `: ${ost.enxertoOsseoTipo}`;
        ostParts.push(s);
      }
      const ortoMap: Record<string, string> = {
        bma: "BMA", ha: "Acido Hialuronico", prp: "PRP",
        hidrogel: "Hidrogel", nanofat: "Nanofat",
      };
      const ortoParts: string[] = [];
      if (d.ortobiologico) {
        Object.entries(ortoMap).forEach(([k, label]) => { if (d.ortobiologico[k]) ortoParts.push(label); });
      }
      const orto = d.ortobiologico as any;
      const diagTipoMap: Record<string, string> = {
        osteoartrose: "Osteoartrose", condromalacia: "Condromalacia Patelar",
        lesaoMeniscal: "Lesao Meniscal", lesaoLigamentar: "Lesao Ligamentar",
        lesaoMuscular: "Lesao Muscular", edemaOsseo: "Lesao Osteocondral",
      };
      // Suporta tanto array (novo) quanto string (legado)
      const diagTiposArr: string[] = Array.isArray(orto?.diagnosticoTipos)
        ? orto.diagnosticoTipos
        : orto?.diagnosticoTipo ? [orto.diagnosticoTipo] : [];
      const ortodiag = diagTiposArr.map((tipo: string) => {
        let label = diagTipoMap[tipo] || tipo;
        if (tipo === "osteoartrose" && orto?.diagnosticoAhlback) label += ` Ahlback Grau ${orto.diagnosticoAhlback}`;
        if (tipo === "lesaoLigamentar" && orto?.diagnosticoLigamento) label += ` - ${orto.diagnosticoLigamento}`;
        if (tipo === "edemaOsseo" && orto?.diagnosticoEdemaLocal) label += ` - ${orto.diagnosticoEdemaLocal}`;
        return label;
      }).join("; ");
      const outrosProcs: string[] = Array.isArray(d.outrosProcedimentos) ? d.outrosProcedimentos : [];
      const fraturasProcs: string[] = Array.isArray(d.fraturas) ? d.fraturas : [];
      const hasOrtoBlock = ostParts.length > 0 || ortoParts.length > 0 || ortodiag || outrosProcs.length > 0 || fraturasProcs.length > 0;
      if (hasOrtoBlock) {
        // Add a section header when this is the first procedure section (no LCA technique above)
        if (!hasLcaTecnica) {
          sectionHeader("5. Procedimentos Realizados");
        }

        // Ortobiológico — detailed sub-block when present
        if (ortoParts.length > 0) {
          checkPage(14);
          setFill(C.bgBlue);
          setDraw(C.border);
          doc.setLineWidth(0.3);
          doc.roundedRect(margin, y, cW, 10, 1.5, 1.5, "FD");
          doc.setFontSize(7);
          doc.setFont("helvetica", "bold");
          setColor(C.navy);
          doc.text(generated("Ortobiologicos"), margin + 3, y + 4);
          doc.setFontSize(11);
          doc.text(sanitize(ortoParts.map(controlled).join(" + ")), margin + 44, y + 5);
          gap(13);
          kvGrid([
            { label: "Diagnostico Paciente", value: ortodiag || surgery.diagnostico || null },
          ]);
        }

        controlledKvGrid([
          { label: "Osteotomia",             value: ostParts.length > 0 ? ostParts.map(generatedClinical).join("; ") : null },
          { label: "Outros Procedimentos",    value: outrosProcs.length > 0 ? outrosProcs.map(controlled).join(", ") : null },
          { label: "Fraturas",                value: fraturasProcs.length > 0 ? fraturasProcs.map(controlled).join(", ") : null },
        ]);
      }
    } catch { /* ignore */ }
  }

  // ── 5c. RECONSTRUÇÃO DO CPM ──────────────────────────────────────────
  const cpmRec = (surgery as any).cpmReconstruction;
  if (cpmRec && (cpmRec.abordagem || cpmRec.lcmTecnica || cpmRec.lopTecnica)) {
    sectionHeader("Reconstrucao — CPM (Canto Postero-Medial)");
    gap(2);
    checkPage(6);
    setColor(C.muted); doc.setFontSize(7.5); doc.setFont("helvetica", "italic");
    const abordagemLabel = cpmRec.abordagem === "lcm_isolado"
      ? "Abordagem: LCM Isolado"
      : cpmRec.abordagem === "lcm_lop"
      ? "Abordagem: LCM + LOP (Lig. Obliquo Posterior)"
      : "LCM + LOP";
      doc.text(sanitize(generatedClinical(abordagemLabel)), margin, y);
    gap(7);

    if (cpmRec.lcmTecnica || cpmRec.lcmEnxerto || cpmRec.lcmFixacaoProximal || cpmRec.lcmFixacaoDistal) {
      checkPage(20);
      setColor(C.cyan); doc.setFontSize(8); doc.setFont("helvetica", "bold");
      doc.text(generated("LCM — Ligamento Colateral Medial"), margin, y); gap(6);
      controlledKvGrid([
        { label: "Tecnica",          value: cpmRec.lcmTecnica || null },
        { label: "Enxerto",          value: cpmRec.lcmEnxerto || null },
        { label: "Fixacao Proximal", value: cpmRec.lcmFixacaoProximal || null },
        { label: "Fixacao Distal",   value: cpmRec.lcmFixacaoDistal || null },
      ]);
      gap(4);
    }

    if (cpmRec.abordagem === "lcm_lop" && (cpmRec.lopTecnica || cpmRec.lopEnxerto || cpmRec.lopFixacao)) {
      checkPage(20);
      setColor(C.cyan); doc.setFontSize(8); doc.setFont("helvetica", "bold");
      doc.text(generated("LOP — Ligamento Obliquo Posterior"), margin, y); gap(6);
      controlledKvGrid([
        { label: "Tecnica",  value: cpmRec.lopTecnica || null },
        { label: "Enxerto",  value: cpmRec.lopEnxerto || null },
        { label: "Fixacao",  value: cpmRec.lopFixacao || null },
      ]);
      gap(4);
    }

    if (cpmRec.justificativa) {
      checkPage(14);
      kvGrid([{ label: "Justificativa", value: cpmRec.justificativa }]);
      gap(4);
    }
  }

  // ── 5d. RECONSTRUÇÃO DO CPL ──────────────────────────────────────────
  const cplRec = (surgery as any).cplReconstruction;
  if (cplRec && (cplRec.tecnica || (Array.isArray(cplRec.enxertos) && cplRec.enxertos.length > 0))) {
  try {
    sectionHeader("Reconstrucao — CPL (LCL + Tend. Popliteo + LPF)");

    // Técnica badge
    if (cplRec.tecnica) {
      checkPage(10);
      doc.setFontSize(8.5);
      doc.setFont("helvetica", "bold");
      const tunnelDesc = cplRec.tecnica === "Laprade"
        ? "Laprade (anatomica) — LCL+T.Popl. (2 femorais) / LCL+LPF (fibular) / LPF (tibial)"
        : cplRec.tecnica === "Arcieiro"
        ? "Arcieiro (nao anatomica) — LCL+T.Popl. (2 femorais) / LCL (fibular) — LPF nao reconstr."
        : "Fanelli (nao anatomica) — LCL+T.Popl. (1 femoral) — LPF nao reconstr.";
      const tdLines = splitSurgeryPdfGeneratedText(doc, locale, tunnelDesc, cW - 6);
      const tdBoxH = 6.5 + tdLines.length * 4.2 + 2.5;
      setFill(C.bgLight);
      doc.roundedRect(margin, y, cW, tdBoxH, 1.5, 1.5, "F");
      setColor(C.muted);
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.text(generated("Tecnica"), margin + 3, y + 3);
      setColor(C.navy);
      doc.setFontSize(8.5);
      doc.setFont("helvetica", "bold");
      doc.text(tdLines, margin + 3, y + 6.5);
      gap(tdBoxH + 3);
    }

    // Enxertos
    const enxertos = Array.isArray(cplRec.enxertos) ? cplRec.enxertos.filter((e: any) => e.nome) : [];
    checkPage(8 + Math.max(enxertos.length, 1) * 6);
    setColor(C.muted);
    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    doc.text(`${generated("Enxertos")}:`, margin, y);
    gap(4);
    if (enxertos.length > 0) {
      for (const enx of enxertos) {
        checkPage(6);
        setColor(C.black);
        doc.setFontSize(7.5);
        doc.setFont("helvetica", "bold");
        const diam = enx.diametro ? ` — Ø ${enx.diametro}` : "";
        doc.text(sanitize(`• ${controlled(enx.nome)}${diam}`), margin + 3, y);
        gap(5);
      }
    } else {
      setColor(C.muted);
      doc.setFontSize(7.5);
      doc.setFont("helvetica", "italic");
      doc.text(controlled("Nao informado"), margin + 3, y);
      gap(5);
    }

    // Fixações — mostra todos os campos relevantes para a técnica, com "—" quando vazio
    const isLaprade  = cplRec.tecnica === "Laprade";
    const isArcieiro = cplRec.tecnica === "Arcieiro";
    const fixacoes: { label: string; value: string | null }[] = [
      { label: "Femoral 1 (LCL)",    value: cplRec.fixacaoFemoral1 || "—" },
    ];
    if (isLaprade || isArcieiro) {
      fixacoes.push({ label: "Femoral 2 (Tend. Poplit.)", value: cplRec.fixacaoFemoral2 || "—" });
      fixacoes.push({ label: isLaprade ? "Fibular (LCL + LPF)" : "Fibular (LCL)", value: cplRec.fixacaoFibular || "—" });
    }
    if (isLaprade) {
      fixacoes.push({ label: "Tibial (LPF)", value: cplRec.fixacaoTibial || "—" });
    }
    controlledKvGrid(fixacoes);

    // REA Associada
    if (cplRec.reaAssociada) {
      checkPage(10);
      const reaTipo = cplRec.reaTipo || "";
      const reaLabel = reaTipo === "LAL" ? "LAL — Ligamento Anterolateral"
        : reaTipo === "LET" ? "LET — Tenodese Extra-Articular Lateral"
        : "Sim (tipo não especificado)";
      setFill([209, 250, 229] as [number,number,number]);
      doc.roundedRect(margin, y, cW, 9, 1.5, 1.5, "F");
      setColor(C.muted);
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.text(generated("Reconstrucao Anterolateral Extra-Articular Associada"), margin + 3, y + 3);
      setColor(C.black);
      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      doc.text(sanitize(controlled(reaLabel)), margin + 3, y + 6.5);
      gap(12);
    }

    if (cplRec.justificativa) {
      checkPage(12);
      setFill(C.bgLight);
      const jlines = doc.splitTextToSize(cplRec.justificativa, cW - 6);
      const jh = jlines.length * lh(7.5) + 6;
      doc.roundedRect(margin, y, cW, jh, 1.5, 1.5, "F");
      gap(3);
      wrappedLines(cplRec.justificativa, margin + 3, 7.5, cW - 6, { color: C.black });
      gap(lh(7.5) * jlines.length + 4);
    }
  } catch (e) { console.error("CPL PDF section error:", e); }
  }

  // ── 5b. RECONSTRUÇÃO DO LCP ──────────────────────────────────────────
  const lcpRec = (surgery as any).lcpReconstruction;
  if (lcpRec && (lcpRec.grauLesao || lcpRec.tecnica || lcpRec.enxerto || lcpRec.flipCutter)) {
    sectionHeader("Reconstrucao — LCP (Ligamento Cruzado Posterior)");

    // Grade alert
    if (lcpRec.grauLesao) {
      checkPage(12);
      const grauColor: [number,number,number] = lcpRec.grauLesao === "III" ? C.red : lcpRec.grauLesao === "II" ? C.amber : C.green;
      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      const grauTxt = lcpRec.grauLesao === "I" ? "Grau I — 0–5 mm | Tibia anterior aos condiles | Tratamento conservador"
        : lcpRec.grauLesao === "II" ? "Grau II — 5–10 mm | Tibia nivelada aos condiles | Avaliacao individual"
        : "Grau III — >10 mm | Tibia posterior aos condiles | Indicacao cirurgica";
      const grauLines = splitSurgeryPdfGeneratedText(doc, locale, grauTxt, cW - 6);
      const grauBoxH = 6.5 + grauLines.length * 4 + 2.5;
      setFill(lcpRec.grauLesao === "III" ? [254,242,242] as [number,number,number] : lcpRec.grauLesao === "II" ? [255,251,235] as [number,number,number] : [240,253,244] as [number,number,number]);
      setDraw(grauColor);
      doc.setLineWidth(0.4);
      doc.roundedRect(margin, y, cW, grauBoxH, 1.5, 1.5, "FD");
      setColor(C.muted);
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.text(generated("Grau da Lesao"), margin + 3, y + 3);
      setColor(grauColor);
      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      doc.text(grauLines, margin + 3, y + 6.5);
      gap(grauBoxH + 3);
    }

    controlledKvGrid([
      { label: "Tecnica", value: lcpRec.tecnica },
      { label: "Abordagem", value: lcpRec.abordagem },
      { label: "Enxerto", value: lcpRec.enxerto },
      { label: "Diametro", value: lcpRec.diametroEnxerto },
      { label: "FlipCutter utilizado", value: lcpRec.flipCutter },
      { label: "Fixacao Femoral", value: lcpRec.fixacaoFemoral },
      { label: "Fixacao Tibial", value: lcpRec.fixacaoTibial },
      { label: "Fixacao Anteromedial", value: lcpRec.fixacaoAnteromedial },
      { label: "Fixacao Posterolateral", value: lcpRec.fixacaoPosterolateral },
    ]);

    if (lcpRec.justificativa) {
      checkPage(12);
      setFill(C.bgLight);
      const jlines = doc.splitTextToSize(lcpRec.justificativa, cW - 6);
      const jh = jlines.length * lh(7.5) + 6;
      doc.roundedRect(margin, y, cW, jh, 1.5, 1.5, "F");
      gap(3);
      wrappedLines(lcpRec.justificativa, margin + 3, 7.5, cW - 6, { color: C.black });
      gap(lh(7.5) * jlines.length + 4);
    }
  }

  // ── 5e. TÉCNICA CIRÚRGICA — ARTROPLASTIA (ATJ/UKA) ──────────────────
  {
    let atj: any = null;
    if ((surgery as any).procedimentosDetalhados) {
      try {
        const d = JSON.parse((surgery as any).procedimentosDetalhados);
        atj = d.artroplastia;
      } catch { /* ignore */ }
    }
    const isATJ = (surgery.tiposProcedimento ?? []).includes("Artroplastias");
    if (isATJ && atj) {
      sectionHeader("Tecnica Cirurgica — Artroplastia do Joelho");

      // Avaliação Clínica Pré-operatória
      checkPage(10);
      doc.setFontSize(7.5); doc.setFont("helvetica", "bold"); setColor(C.muted);
      doc.text(generated("Avaliacao Clinica Pre-operatoria"), margin, y); gap(5);

      const instVal = atj.instabilidade
        ? (atj.instabilidadeGrau
            ? `${controlled(atj.instabilidade)} — ${atj.instabilidadeGrau}`
            : controlled(atj.instabilidade))
        : null;
      const gonartroseMedialVal = atj.gonartroseMedial
        ? (atj.gonartroseMedialAhlback
            ? `${controlled(atj.gonartroseMedial)} (Ahlback ${controlled(atj.gonartroseMedialAhlback)})`
            : controlled(atj.gonartroseMedial))
        : null;
      const flexExtVal = (atj.flexaoGraus || atj.extensaoGraus)
        ? [
            atj.flexaoGraus && `${generated("Flexao")}: ${atj.flexaoGraus}deg`,
            atj.extensaoGraus && `${generated("Extensao")}: ${atj.extensaoGraus}deg`,
          ].filter(Boolean).join(" | ")
        : null;

      controlledKvGrid([
        { label: "Alinhamento do Membro",  value: atj.alinhamentoMembro  || null },
        { label: "Instabilidade",          value: instVal },
        { label: "Gonartrose Medial",      value: gonartroseMedialVal },
        { label: "Gonartrose Lateral",     value: atj.gonartroseLateral  || null },
        { label: "Femoropatelar",          value: atj.femoropatelar      || null },
        { label: "ADM (Flexao / Extensao)", value: flexExtVal },
      ]);

      // Técnica Cirúrgica
      checkPage(10);
      doc.setFontSize(7.5); doc.setFont("helvetica", "bold"); setColor(C.muted);
      doc.text(generated("Tecnica Cirurgica"), margin, y); gap(5);

      controlledKvGrid([
        { label: "Tipo de Protese",           value: atj.tipo            || null },
        { label: "Compartimento",             value: atj.compartimento   || null },
        { label: "Tecnologia (TKA)",          value: atj.tecnologia      || null },
        { label: "Revisao — Componentes",     value: atj.revisaoComponentes || null },
        { label: "Fixacao",                   value: atj.fixacao         || null },
        { label: "Garrote",                   value: atj.garrote         || null },
        { label: "TXA (Acido Tranexamico)",   value: atj.txa             || null },
      ]);

      // Calços
      const calcosFemoral = Array.isArray(atj.calcosFemoral) ? atj.calcosFemoral.filter(Boolean) : [];
      const calcosTibial  = Array.isArray(atj.calcosTibial)  ? atj.calcosTibial.filter(Boolean)  : [];
      if (calcosFemoral.length > 0 || calcosTibial.length > 0) {
        controlledKvGrid([
          { label: "Calcos Femorais", value: calcosFemoral.length > 0 ? calcosFemoral.map(controlled).join(", ") : null },
          { label: "Calcos Tibiais",  value: calcosTibial.length  > 0 ? calcosTibial.map(controlled).join(", ")  : null },
        ]);
      }

      // Cone Metafisário
      if (atj.coneMetafisario) {
        const coneVal = atj.coneMetafisario === "Sim" && atj.coneMetafisarioLocal
          ? `${controlled("Sim")} — ${controlled(atj.coneMetafisarioLocal)}`
          : atj.coneMetafisario;
        controlledKvGrid([{ label: "Cone Metafisário", value: coneVal }]);
      }

      // Observações ATJ
      if (atj.observacoes) {
        checkPage(14);
        setFill(C.bgLight);
        const obsLines = doc.splitTextToSize(atj.observacoes, cW - 6);
        const obsH = obsLines.length * lh(7.5) + 8;
        doc.roundedRect(margin, y, cW, obsH, 1.5, 1.5, "F");
        gap(4);
        setColor(C.muted); doc.setFontSize(7); doc.setFont("helvetica", "normal");
        doc.text(`${generated("Observacoes")}:`, margin + 3, y); gap(3.5);
        const n = wrappedLines(atj.observacoes, margin + 3, 7.5, cW - 6, { color: C.black });
        gap(lh(7.5) * n + 4);
      }
    }
  }

  // ── OCD. LESÃO OSTEOCONDRAL ──────────────────────────────────────────
  const ocdExame = (surgery as any).exameOsteocondral
    ?? (surgery.ocdAnalysis != null ? { ocdResult: surgery.ocdAnalysis } : null);
  const isOsteocondralCase = (surgery.tiposProcedimento ?? []).includes("Lesões Osteocondrais");
  if (isOsteocondralCase && ocdExame) {
    sectionHeader("Lesao Osteocondral — Exame Clinico e Algoritmo");

    // Algorithm result badge (classification + clinical status)
    const ocdResult = resolveSavedOcdResult(surgery) as any;
    if (ocdResult?.classification || ocdResult?.clinicalStatus) {
      checkPage(14);
      setFill(C.bgGreen);
      setDraw(C.border);
      doc.setLineWidth(0.3);
      doc.roundedRect(margin, y, cW, 10, 1.5, 1.5, "FD");
      // Classification code (left)
      doc.setFontSize(7);
      doc.setFont("helvetica", "bold");
      setColor(C.muted);
      doc.text(generated("Classificacao de Cartilagem v1.0"), margin + 3, y + 3.5);
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      setColor(C.green);
      doc.text(sanitize(ocdResult.classification ?? ""), margin + 3, y + 8);
      // Clinical status (right half)
      if (ocdResult.clinicalStatus) {
        doc.setFontSize(7);
        doc.setFont("helvetica", "normal");
        setColor(C.muted);
        doc.text(generated("Status Clinico"), margin + cW / 2, y + 3.5);
        doc.setFontSize(8);
        doc.setFont("helvetica", "bold");
        setColor(C.black);
        const statusLines = doc.splitTextToSize(sanitize(ocdText(ocdResult.clinicalStatus)), cW / 2 - 4);
        doc.text(statusLines, margin + cW / 2, y + 8);
      }
      gap(13);
    }

    // Clinical exam fields
    const etiologiaMap: Record<string, string> = {
      traumatica: "Traumatica", ocd: "OCD (Osteocondrite Dissecante)",
      degenerativa: "Degenerativa", idiopatica: "Idiopatica",
    };
    const localizacaoMap: Record<string, string> = {
      cfe_medial: "Condilo Femoral Medial", cfe_lateral: "Condilo Femoral Lateral",
      cti_medial: "Platô Tibial Medial", cti_lateral: "Platô Tibial Lateral",
      patela: "Patela", trochlea: "Tróclea",
    };
    const osseoMap: Record<string, string> = {
      integro: "Íntegro", edema: "Edema Ósseo", cisto: "Cisto Subcondral",
      esclerose: "Esclerose", fragmento: "Fragmento Solto",
    };
    const profMap: Record<string, string> = {
      superficial: "Superficial (< 50% espessura)", profunda: "Profunda (> 50% espessura)",
      osso_exposto: "Osso Subcondral Exposto",
    };
    const padraoMap: Record<string, string> = {
      condral: "Condral (cartilagem apenas)", osteocondral: "Osteocondral (cartilagem + osso)",
    };

    controlledKvGrid([
      { label: "Sintomatica",         value: ocdExame.sintomatica },
      { label: "Falha do tratamento conservador", value: ocdExame.falhaConservador },
      { label: "Artrose difusa",      value: ocdExame.artroseDifusa },
      { label: "Objetivo",             value: ocdExame.objetivo },
      { label: "Etiologia",          value: etiologiaMap[ocdExame.etiologia] ?? ocdExame.etiologia ?? null },
      { label: "Localizacao",        value: localizacaoMap[ocdExame.localizacao] ?? ocdExame.localizacao ?? null },
      { label: "Tamanho",            value: ocdExame.tamanhoMm2 != null ? `${ocdExame.tamanhoMm2} cm²` : null },
      { label: "Grau ICRS",          value: ocdExame.icrsGrau ?? null },
      { label: "Padrao",             value: padraoMap[ocdExame.padrao] ?? ocdExame.padrao ?? null },
      { label: "Profundidade",       value: profMap[ocdExame.profundidade] ?? ocdExame.profundidade ?? null },
      { label: "Osso Subcondral",    value: osseoMap[ocdExame.osseoStatus] ?? ocdExame.osseoStatus ?? null },
      { label: "Contencao",          value: ocdExame.continencia ? (ocdExame.continencia === "contida" ? "Contida" : "Nao Contida") : null },
      { label: "Estabilidade OCD",   value: ocdExame.estabilidadeOcd ? (ocdExame.estabilidadeOcd === "estavel" ? "Estavel" : "Instavel") : null },
      {
        label: "Banco de Tecidos — OCA Fresco",
        value: ocdExame.bancoTecidosDisponivel === true
          ? "Disponibilidade confirmada"
          : ocdExame.bancoTecidosDisponivel === false
            ? "Indisponível"
            : "Não informado",
      },
      { label: "Edema Osseo",             value: ocdExame.edemaOsseo },
      { label: "Cisto Subcondral",        value: ocdExame.cistoSubcondral },
      { label: "Fragmento Solto",         value: ocdExame.fragmentoSolto },
      { label: "Lesao Meniscal Assoc.",   value: ocdExame.lesaoMeniscalAssociada },
      { label: "Lesao Ligamentar Assoc.", value: ocdExame.lesaoLigamentarAssociada },
      { label: "Desvio Axial",             value: ocdExame.desvioAxial },
      { label: "RM Disponivel",             value: ocdExame.rmDisponivel },
    ]);

    // Keep every persisted clinical/image input visible, including false and
    // numeric zero.  The explicit fields above retain their established
    // catalog labels; this catches newer columns without dropping them.
    const ocdKnownKeys = new Set([
      "id", "surgeryId", "createdAt", "updatedAt", "ocdResult",
      "sintomatica", "falhaConservador", "artroseDifusa", "objetivo",
      "etiologia", "localizacao", "tamanhoMm2", "icrsGrau", "padrao",
      "profundidade", "osseoStatus", "continencia", "estabilidadeOcd",
      "bancoTecidosDisponivel", "edemaOsseo", "cistoSubcondral", "fragmentoSolto",
      "lesaoMeniscalAssociada", "lesaoLigamentarAssociada", "desvioAxial", "rmDisponivel",
    ]);
    const ocdAdditionalPairs = Object.entries(ocdExame)
      .filter(([key, value]) => !ocdKnownKeys.has(key) && hasPdfValue(value))
      .map(([key, value]) => ({
        label: key.replace(/([a-zÀ-ÿ])([A-Z])/g, "$1 $2").replace(/^./, (char) => char.toUpperCase()),
        value: Array.isArray(value) ? value.map(String).join(", ") : isPdfRecord(value) ? JSON.stringify(value) : value,
        controlled: typeof value === "boolean",
      }));
    if (ocdAdditionalPairs.length > 0) kvGrid(ocdAdditionalPairs);

    // Binary findings summary
    const binLabels: string[] = [];
    if (ocdExame.edemaOsseo)             binLabels.push("Edema Osseo");
    if (ocdExame.cistoSubcondral)        binLabels.push("Cisto Subcondral");
    if (ocdExame.fragmentoSolto)         binLabels.push("Fragmento Solto");
    if (ocdExame.lesaoMeniscalAssociada) binLabels.push("Lesao Meniscal Assoc.");
    if (ocdExame.lesaoLigamentarAssociada) binLabels.push("Lesao Ligamentar Assoc.");
    if (ocdExame.desvioAxial)            binLabels.push("Desvio Axial");
    if (ocdExame.rmDisponivel)           binLabels.push("RM Disponivel");
    if (binLabels.length > 0) {
      kvGrid([{ label: "Achados Associados", value: binLabels.map(controlled).join(" · ") }]);
    }

    // Biomechanical gate
    if (ocdResult?.biomechanicalGate?.present) {
      checkPage(14);
      const gate = ocdResult.biomechanicalGate;
      const gateLines = doc.splitTextToSize(sanitize(ocdText(gate.action ?? "")), cW - 6);
      const gateH = gateLines.length * lh(7.5) + 9;
      setFill([255, 251, 235] as [number, number, number]);
      setDraw(C.amber);
      doc.setLineWidth(0.4);
      doc.roundedRect(margin, y, cW, gateH, 1.5, 1.5, "FD");
      setColor(C.amber);
      doc.setFontSize(7);
      doc.setFont("helvetica", "bold");
      doc.text(generated("Gate Biomecanico Presente"), margin + 3, y + 3.5);
      setColor(C.black);
      doc.setFontSize(7.5);
      doc.setFont("helvetica", "normal");
      doc.text(gateLines, margin + 3, y + 7.5);
      gap(gateH + 3);
      if (Array.isArray(gate.factors) && gate.factors.length > 0) {
        kvGrid([{ label: "Fatores Biomecanicos", value: gate.factors.map(ocdText).join(", ") }]);
      }
    }

    // Top 3 algorithm recommendations
    const recs: any[] = Array.isArray(ocdResult?.recommendations) ? ocdResult.recommendations.slice(0, 3) : [];
    if (recs.length > 0) {
      checkPage(8 + recs.length * 10);
      doc.setFontSize(7.5);
      doc.setFont("helvetica", "bold");
      setColor(C.muted);
      doc.text(`${generated("Recomendacoes do Algoritmo")}:`, margin, y);
      gap(5);
      for (const rec of recs) {
        checkPage(12);
        const procText = sanitize(ocdText(rec.procedure ?? ""));
        const ratText = rec.rationale ? sanitize(ocdText(rec.rationale)) : null;
        const statusBadge = ocdText(rec.status === "primeira_linha" ? "1a linha" : rec.status === "segunda_linha" ? "2a linha" : (rec.status ?? ""));
        setFill(C.bgLight);
        const recLines = doc.splitTextToSize(procText, cW - 12);
        const ratLines = ratText ? doc.splitTextToSize(ratText, cW - 12) : [];
        const recH = 5 + recLines.length * lh(8) + (ratLines.length > 0 ? ratLines.length * lh(7) + 2 : 0) + 4;
        doc.roundedRect(margin, y, cW, recH, 1.5, 1.5, "F");
        // Priority badge
        setColor(C.green);
        doc.setFontSize(6.5);
        doc.setFont("helvetica", "bold");
        doc.text(sanitize(statusBadge), margin + cW - 4, y + 3.5, { align: "right" });
        // Procedure name
        setColor(C.navy);
        doc.setFontSize(8);
        doc.setFont("helvetica", "bold");
        doc.text(recLines, margin + 3, y + 5);
        let recY = y + 5 + recLines.length * lh(8) + 1;
        if (ratLines.length > 0) {
          doc.setFontSize(7);
          doc.setFont("helvetica", "normal");
          setColor(C.muted);
          doc.text(ratLines, margin + 3, recY);
          recY += ratLines.length * lh(7);
        }
        gap(recH + 3);
      }
    }

    // Technique section (from procedimentosDetalhados.osteocondral)
    let ocdTecnica: any = null;
    if ((surgery as any).procedimentosDetalhados) {
      try {
        const det = JSON.parse((surgery as any).procedimentosDetalhados);
        ocdTecnica = det.osteocondral;
      } catch { /* ignore */ }
    }
    if (ocdTecnica) {
      const procedimentos: string[] = Array.isArray(ocdTecnica.procedimentos) ? ocdTecnica.procedimentos : [];
      const adjuvantes: string[] = Array.isArray(ocdTecnica.adjuvantes) ? ocdTecnica.adjuvantes : [];
      const adjMap: Record<string, string> = { prp: "PRP", bma: "BMA / Aspirado de Medula", ha: "Acido Hialuronico" };
      const adjLabel = adjuvantes.map((a: string) => controlled(adjMap[a] ?? a)).join(", ");
      controlledKvGrid([
        { label: "Procedimento(s) Realizado(s)", value: procedimentos.length > 0 ? procedimentos.map(controlled).join(", ") : null },
        { label: "Tecnica Nanofraturas",          value: ocdTecnica.nanofraturasTecnica ?? null },
        { label: "OATS — Diametro",               value: ocdTecnica.oatsDiametroMm ? `${ocdTecnica.oatsDiametroMm} mm` : null },
        { label: "OATS — N de Plugs",             value: ocdTecnica.oatsNumPlugs ? String(ocdTecnica.oatsNumPlugs) : null },
        { label: "Fixacao OCD",                   value: ocdTecnica.fixacaoOcdTipo ?? null },
        { label: "Adjuvantes Biologicos",          value: adjLabel || null },
      ]);
      if (ocdTecnica.observacoes) {
        checkPage(14);
        setFill(C.bgLight);
        const obsLines = doc.splitTextToSize(sanitize(ocdTecnica.observacoes), cW - 6);
        const obsH = obsLines.length * lh(7.5) + 8;
        doc.roundedRect(margin, y, cW, obsH, 1.5, 1.5, "F");
        gap(4);
        setColor(C.muted); doc.setFontSize(7); doc.setFont("helvetica", "normal");
        doc.text(`${generated("Observacoes")}:`, margin + 3, y); gap(3.5);
        const n = wrappedLines(ocdTecnica.observacoes, margin + 3, 7.5, cW - 6, { color: C.black });
        gap(lh(7.5) * n + 4);
      }
    }
  }

  // ── 6. PROC. MENISCAL ────────────────────────────────────────────────
  const menisco = surgery.procedimentoMeniscal;
  const isArtroplastiaForPDF = (surgery.tiposProcedimento ?? []).includes("Artroplastias");
  const selectedMeniscalSides: MeniscalSide[] = menisco
    ? ([
        menisco.ladoMedial && "medial",
        menisco.ladoLateral && "lateral",
      ].filter(Boolean) as MeniscalSide[])
    : [];
  const meniscalSideGroups = menisco && hasExplicitMeniscalSideDetails(menisco)
    ? (["medial", "lateral"] as const).flatMap((side) => {
        const details = getExplicitMeniscalSideDetails(menisco, side);
        return details ? [{ side, details }] : [];
      })
    : [];
  const legacyDetailsWithoutSide = menisco && !hasExplicitMeniscalSideDetails(menisco)
    ? getLegacyMeniscalDetails(menisco)
    : null;
  const meniscalExamKeys = [
    "contexto", "dorInterlinha", "mcMurrayMedial", "mcMurrayLateral",
    "apleyCompressao", "apleyTracao", "marchaPato", "steinmann1",
    "steinmann2", "observacoesExame",
  ];
  const hasMeniscalExam = !!menisco && meniscalExamKeys.some((key) => {
    const value = menisco[key];
    return value !== null && value !== undefined && value !== "";
  });
  const hasMeniscalProcedure = meniscalSideGroups.some(({ details }) => hasMeaningfulMeniscalDetails(details))
    || !!(legacyDetailsWithoutSide && hasMeaningfulMeniscalDetails(legacyDetailsWithoutSide))
    || selectedMeniscalSides.length > 0
    || !!menisco?.sutura;
  if (!isArtroplastiaForPDF && menisco && (hasMeniscalExam || hasMeniscalProcedure)) {
    sectionHeader("6. Procedimento Meniscal");

    const meniscalLabelMap: Record<string, string> = {
      contexto: "Contexto",
      dorInterlinha: "Dor a Palpacao da Interlinha",
      mcMurrayMedial: "McMurray Medial", mcMurrayLateral: "McMurray Lateral",
      apleyCompressao: "Apley Compressao", apleyTracao: "Apley Tracao",
      marchaPato: "Marcha do Pato", steinmann1: "Steinmann I", steinmann2: "Steinmann II",
      lesaoRampa: "Lesao Rampa", lesaoRaiz: "Raiz Posterior",
      lesaoRaizAnterior: "Raiz Anterior", lesaoCornoAnterior: "Corno Anterior",
      lesaoCornoPosterior: "Corno Posterior",
      lesaoAlcaBalde: "Alca de Balde", lesaoRadial: "Lesao Radial",
      lesaoCorpo: "Lesao Corpo", lesaoDiscoide: "Menisco Discoide",
      tecnicasSutura: "Tecnicas de Sutura",
      numPontos: "N de Pontos", pontosPorTecnica: "Pontos/Tecnica",
      tipoFio: "Tipo de Fio",
      fixacaoRaiz: "Metodo de Fixacao da Raiz",
      centralizacaoRaiz: "Centralizacao da Raiz Posterior",
      centralizacaoMetodo: "Metodo de Fixacao da Centralizacao",
      saucerizacao: "Saucerizacao",
      observacoesExame: "Observacoes do Exame",
    };
    const meniscalControlledKeys = new Set([
      "lesaoRampa", "lesaoRaiz",
      "lesaoRaizAnterior", "lesaoCornoAnterior", "lesaoCornoPosterior",
      "lesaoAlcaBalde", "lesaoRadial", "lesaoCorpo", "lesaoDiscoide", "tecnicasSutura",
      "numPontos", "tipoFio", "fixacaoRaiz", "centralizacaoRaiz",
      "centralizacaoMetodo", "saucerizacao",
    ]);

    const examPairs = meniscalExamKeys.flatMap((key) => {
      const value = menisco[key];
      if (value == null || value === "") return [];
      return [{
        label: meniscalLabelMap[key] ?? key,
        value: typeof value === "boolean" ? "Sim" : String(value),
        controlled: typeof value === "boolean",
      }];
    });
    if (examPairs.length > 0) kvGrid(examPairs);

    const addDetailPairs = (
      details: Record<string, unknown>,
      side: MeniscalSide | null,
    ) => {
      const pairs: { label: string; value: string; controlled?: boolean }[] = [];
      if (side) {
        pairs.push({
          label: "Menisco",
          value: side === "medial" ? "Medial" : "Lateral",
          controlled: true,
        });
      }

      const tipoProcedimento = details.sutura && details.meniscectomia
        ? "Sutura + Meniscectomia Parcial"
        : details.sutura
        ? "Sutura Meniscal"
        : details.meniscectomia
        ? "Meniscectomia"
        : null;
      if (tipoProcedimento) {
        pairs.push({ label: "Tipo de Procedimento", value: tipoProcedimento, controlled: true });
      }

      if (details.estimuloBiologico) {
        const estimuloDesc = [
          details.estimuloPerfuracaoIntercondilo && controlled("Perfuracao de Intercondilo"),
          details.estimuloCoaguloFibrina && controlled("Coagulo de Fibrina"),
          details.estimuloOrtobiologico && (details.estimuloOrtobiologicoTipo
            ? `${controlled("Ortobiologico")}: ${controlled(String(details.estimuloOrtobiologicoTipo))}` : "Ortobiologico"),
        ].filter(Boolean).join(" · ") || controlled("Sim");
        pairs.push({ label: "Estimulo Biologico", value: estimuloDesc, controlled: true });
      }

      const MENISCAL_TYPE_SKIP = [
        "estimuloBiologico", "estimuloPerfuracaoIntercondilo", "estimuloCoaguloFibrina",
        "estimuloOrtobiologico", "estimuloOrtobiologicoTipo", "meniscectomia",
      ];
      for (const [k, v] of Object.entries(details)) {
        if (MENISCAL_TYPE_SKIP.includes(k) || v == null || v === "") continue;
      const label = meniscalLabelMap[k] ?? k.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase()).trim();

      if (k === "pontosPorTecnica") {
        try {
          const parsed: Record<string, number> = typeof v === "string" ? JSON.parse(v) : (v as any);
          for (const [tecnica, pontos] of Object.entries(parsed)) {
            pairs.push({ label: "Tecnica", value: String(tecnica), controlled: true });
            pairs.push({ label: "N de Pontos", value: String(pontos), controlled: true });
          }
        } catch {
          pairs.push({ label, value: String(v), controlled: false });
        }
        continue;
      }

      pairs.push({
        label,
        value: Array.isArray(v)
          ? (meniscalControlledKeys.has(k)
              ? (v as any[]).map(controlled).join(", ")
              : (v as any[]).map(String).join(", "))
          : typeof v === "boolean" ? (v ? "Sim" : "Não") : String(v),
        controlled: typeof v === "boolean" || meniscalControlledKeys.has(k),
      });
      }
      if (pairs.length > 0) kvGrid(pairs);
    };

    for (const group of meniscalSideGroups) {
      addDetailPairs(group.details as Record<string, unknown>, group.side);
    }
    if (legacyDetailsWithoutSide && hasMeaningfulMeniscalDetails(legacyDetailsWithoutSide)) {
      addDetailPairs(legacyDetailsWithoutSide as Record<string, unknown>, null);
    }
  }

  // ── 7. ANÁLISE RADIOGRÁFICA ─────────────────────────────────────────
  let rxAnalysis: any = null;
  if (surgery.rxAnaliseJson) {
    try { rxAnalysis = JSON.parse(surgery.rxAnaliseJson); } catch { /* ignore */ }
  }
  if (rxAnalysis) {
    sectionHeader("7. Analise Radiografica (IA)");

    // Embed panoramic X-ray image if available
    if (surgery.rxImageUrl) {
      try {
        const imgUrl = surgery.rxImageUrl.startsWith("http")
          ? surgery.rxImageUrl
          : surgery.rxImageUrl.replace(/^\/objects\//, "/api/storage/objects/");
        const imgResp = await fetch(imgUrl);
        if (imgResp.ok) {
          const blob = await imgResp.blob();
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          // Fit image proportionally — max width = cW, max height = 120mm
          const img = new Image();
          img.src = dataUrl;
          await new Promise<void>(r => { img.onload = () => r(); img.onerror = () => r(); });
          const aspect = img.naturalWidth > 0 ? img.naturalHeight / img.naturalWidth : 1;
          const imgW = Math.min(cW, 100);
          const imgH = Math.min(imgW * aspect, 120);
          checkPage(imgH + 6);
          // Center image
          const imgX = margin + (cW - imgW) / 2;
          doc.addImage(dataUrl, "JPEG", imgX, y, imgW, imgH);
          gap(imgH + 4);
        }
      } catch { /* skip image if unavailable */ }
    }

    const angles = [
      { label: "HKA",  val: rxAnalysis.eixoMecanico && typeof rxAnalysis.eixoMecanico === "object" ? `${Math.abs(rxAnalysis.eixoMecanico.graus) ?? "—"}°` : null },
      { label: "aLDFA", val: rxAnalysis.aLDFA?.valor != null ? `${rxAnalysis.aLDFA.valor}°` : null },
      { label: "AmMPT", val: rxAnalysis.aMPTA?.valor != null ? `${rxAnalysis.aMPTA.valor}°` : null },
      { label: "JLCA",  val: rxAnalysis.JLCA?.valor  != null ? `${rxAnalysis.JLCA.valor}°`  : null },
      { label: "MAD",   val: rxAnalysis.MAD?.valor   != null ? `${rxAnalysis.MAD.valor} mm` : null },
      { label: "%WBL",  val: rxAnalysis.percentualWBL?.valor != null ? `${rxAnalysis.percentualWBL.valor}%` : null },
      { label: "Correcao", val: rxAnalysis.anguloCorrecao != null ? `${rxAnalysis.anguloCorrecao}°` : null },
    ].filter(a => a.val);

    if (angles.length > 0) {
      checkPage(22);
      const cardW = (cW - (angles.length - 1) * 3) / angles.length;
      angles.forEach((a, i) => {
        scoreCard(a.label, a.val!, undefined, margin + i * (cardW + 3), cardW, 18);
      });
      gap(21);
    }

    if (rxAnalysis.diagnostico) {
      checkPage(12);
      doc.setFontSize(7.5);
      doc.setFont("helvetica", "bold");
      setColor(C.navy);
      doc.text(`${generated("Diagnostico")}:`, margin, y);
      gap(3);
      const n = wrappedLines(rxAnalysis.diagnostico, margin, 7.5, cW);
      gap(lh(7.5) * n + 2);
    }

  }

  // ── 8. OBSERVAÇÕES ───────────────────────────────────────────────────
  if (surgery.observacoes) {
    sectionHeader("8. Observacoes");
    checkPage(12);
    setFill(C.bgLight);
    const obsLines = doc.splitTextToSize(surgery.observacoes, cW - 6);
    const obsH = obsLines.length * lh(8) + 6;
    doc.roundedRect(margin, y, cW, obsH, 1.5, 1.5, "F");
    gap(3);
    const n = wrappedLines(surgery.observacoes, margin + 3, 8, cW - 6);
    gap(lh(8) * n + 3);
  }

  // ── FOOTERS & SAVE ───────────────────────────────────────────────────
  addFooters(doc.getNumberOfPages());

  const safeName = patientName.replace(/[^a-zA-Z0-9À-ÿ\s]/g, "").replace(/\s+/g, "_");
  const dateSafe = surgery.dataCirurgia
    ? format(new Date(surgery.dataCirurgia), "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");
  const filename = `DocSholder_Resumo_${safeName}_${dateSafe}.pdf`;
  return { doc, filename };
}
