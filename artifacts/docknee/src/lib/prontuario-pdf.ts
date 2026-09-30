import jsPDF from "jspdf";
import { format } from "date-fns";
import type { Locale } from "./i18n";
import { documentCalendarDate, documentDate, documentText } from "@/locales/document-locales";
import { toDisplayDate } from "./utils";

type DocTipo = "receita" | "laudo" | "atestado";

const TIPO_TITULO: Record<DocTipo, "medicalPrescription" | "medicalReport" | "medicalCertificate"> = {
  receita: "medicalPrescription", laudo: "medicalReport", atestado: "medicalCertificate",
};

const C = {
  navy:   [10, 24, 40]   as [number, number, number],
  cyan:   [31, 182, 225] as [number, number, number],
  muted:  [107, 114, 128] as [number, number, number],
  border: [226, 232, 240] as [number, number, number],
  black:  [15, 23, 42]   as [number, number, number],
  white:  [255, 255, 255] as [number, number, number],
  light:  [248, 250, 252] as [number, number, number],
  green:  [21, 128, 61]  as [number, number, number],
  amber:  [180, 83, 9]   as [number, number, number],
};

export interface ProntuarioPDFOptions {
  tipo: DocTipo;
  titulo: string;
  conteudo: string;
  data: string;
  pacienteNome: string;
  pacienteDataNascimento?: string | null;
  medicoNome: string;
  medicoCrm: string;
  medicoCrmEstado: string;
  cid?: string | null;
  tempoAfastamento?: string | null;
}

function sanitize(s: string): string {
  return s
    .replace(/[\u2018\u2019\u0060\u00B4]/g, "'")
    .replace(/[\u201C\u201D\u00AB\u00BB]/g, '"')
    .replace(/\u2014/g, " -- ")
    .replace(/\u2013/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[^\x00-\xFF]/g, "?");
}

export async function generateProntuarioPDF(opts: ProntuarioPDFOptions, locale: Locale = "pt-BR"): Promise<{ doc: jsPDF; filename: string }> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = 210;
  const H = 297;
  const margin = 20;
  const cW = W - margin * 2;
  let y = 0;

  const setColor = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2]);
  const setFill  = (c: [number, number, number]) => doc.setFillColor(c[0], c[1], c[2]);
  const setDraw  = (c: [number, number, number]) => doc.setDrawColor(c[0], c[1], c[2]);
  const gap = (mm: number) => { y += mm; };
  const lh = (size: number) => size * 0.42;

  function txt(
    str: string,
    x: number,
    size: number,
    opts?: { bold?: boolean; color?: [number, number, number]; align?: "left" | "center" | "right"; maxWidth?: number }
  ) {
    doc.setFontSize(size);
    doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
    if (opts?.color) setColor(opts.color);
    doc.text(str, x, y, { align: opts?.align ?? "left", maxWidth: opts?.maxWidth });
  }

  function hline(thick = 0.3, color = C.border) {
    setDraw(color);
    doc.setLineWidth(thick);
    doc.line(margin, y, W - margin, y);
  }

  // ── HEADER SEM IDENTIDADE VISUAL DA PLATAFORMA ─────────────────────────────
  y = 14;
  txt(documentText(locale, TIPO_TITULO[opts.tipo]), W / 2, 12, { bold: true, color: C.navy, align: "center" });
  y = 21;
  hline();
  gap(8);

  // ── DADOS DO PACIENTE ──────────────────────────────────────────────────────

  const hasDob = !!opts.pacienteDataNascimento;
  const blockH = hasDob ? 28 : 22;

  setFill(C.light);
  setDraw(C.border);
  doc.setLineWidth(0.3);
  doc.roundedRect(margin, y, cW, blockH, 2, 2, "FD");

  const yBlock = y;
  gap(6);
  txt(documentText(locale, "patient").toUpperCase(), margin + 6, 7, { color: C.muted });
  gap(5);
  txt(opts.pacienteNome.toUpperCase(), margin + 6, 11, { bold: true, color: C.navy });

  if (hasDob) {
    gap(5);
    const dobFormatted = documentCalendarDate(locale, opts.pacienteDataNascimento!, { day: "2-digit", month: "long", year: "numeric" });
    txt(`${documentText(locale, "birthDate").toUpperCase()}: ${dobFormatted.toUpperCase()}`, margin + 6, 8, { color: C.muted });
  }

  // Data à direita
  const dataFormatada = documentDate(locale, opts.data, { day: "2-digit", month: "long", year: "numeric" });
  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  setColor(C.muted);
  doc.text(documentText(locale, "date").toUpperCase(), W - margin - 6, yBlock + 6, { align: "right" });
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  setColor(C.navy);
  doc.text(dataFormatada.toUpperCase(), W - margin - 6, yBlock + 11, { align: "right" });

  y = yBlock + blockH + 6;

  // ── CID (se informado) ────────────────────────────────────────────────────
  if (opts.cid) {
    setFill([239, 246, 255] as [number, number, number]);
    setDraw([191, 219, 254] as [number, number, number]);
    doc.setLineWidth(0.3);
    doc.roundedRect(margin, y, cW, 10, 1.5, 1.5, "FD");
    const yCid = y;
    gap(7);
    txt("CID:", margin + 6, 8, { bold: true, color: C.navy });
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    setColor(C.black);
    doc.text(opts.cid.toUpperCase(), margin + 18, yCid + 7);
    gap(6);
  }

  // ── AFASTAMENTO ───────────────────────────────────────────────────────────
  if (opts.tempoAfastamento) {
    setFill([255, 251, 235] as [number, number, number]);
    setDraw([253, 230, 138] as [number, number, number]);
    doc.setLineWidth(0.3);
    doc.roundedRect(margin, y, cW, 10, 1.5, 1.5, "FD");
    const yAf = y;
    gap(7);
    txt(`${documentText(locale, "leave").toUpperCase()}:`, margin + 6, 8, { bold: true, color: C.amber });
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    setColor(C.amber);
    doc.text(opts.tempoAfastamento!.toUpperCase(), margin + 35, yAf + 7);
    gap(6);
  }

  // ── TÍTULO DO DOCUMENTO ────────────────────────────────────────────────────
  gap(4);
  txt(opts.titulo.toUpperCase(), margin, 13, { bold: true, color: C.navy });
  gap(6);
  hline(0.4, C.cyan);
  gap(8);

  // ── CONTEÚDO ───────────────────────────────────────────────────────────────
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  setColor(C.black);

  const linhas = doc.splitTextToSize(sanitize(opts.conteudo), cW - 4);
  const lineH = 5.5;

  for (const linha of linhas) {
    if (y + lineH > H - 50) {
      doc.addPage();
      y = margin;
    }
    doc.text(linha, margin, y);
    y += lineH;
  }

  // ── RODAPÉ / ASSINATURA ────────────────────────────────────────────────────
  const footerY = H - 42;

  // Linha de assinatura
  setDraw(C.border);
  doc.setLineWidth(0.4);
  doc.line(margin, footerY, margin + 80, footerY);

  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  setColor(C.navy);
  doc.text(opts.medicoNome.toUpperCase(), margin, footerY + 5);

  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  setColor(C.muted);
  doc.text(`CRM ${opts.medicoCrm}/${opts.medicoCrmEstado}`, margin, footerY + 10);

  // Barra final
  setFill(C.navy);
  doc.rect(0, H - 8, W, 8, "F");

  setFill(C.cyan);
  doc.rect(0, H - 9, W, 1, "F");

  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  setColor(C.white);
  doc.text(documentText(locale, "clinicalDocument"), W / 2, H - 3, { align: "center" });

  // ── FILENAME ──────────────────────────────────────────────────────────────
  const tipoSlug = opts.tipo;
  const nomePaciente = opts.pacienteNome.split(" ")[0].toLowerCase();
  // Date-only values ("2026-08-24") are calendar days: never shift them via UTC.
  const slugDate = toDisplayDate(opts.data);
  const dataSlug = Number.isNaN(slugDate.getTime()) ? "sem-data" : format(slugDate, "dd-MM-yyyy");
  const filename = `${tipoSlug}-${nomePaciente}-${dataSlug}.pdf`;
  return { doc, filename };
}
