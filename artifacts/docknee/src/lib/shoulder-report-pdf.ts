/**
 * PDF do relatório cirúrgico de ombro/cotovelo. O texto vem pronto do servidor
 * (GET /api/surgeries/:id/relatorio, motor de relatório do núcleo clínico);
 * aqui só se diagrama — nada de conteúdo clínico é gerado no navegador.
 */
import jsPDF from "jspdf";

const NAVY: [number, number, number] = [26, 54, 93];
const MUTED: [number, number, number] = [100, 116, 139];

/** Helvetica/WinAnsi não codifica alguns símbolos: preserva o sentido em vez de virar "?". */
export function sanitizePdfText(s: string): string {
  return s
    .replace(/[‘’`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=")
    .replace(/−/g, "-")
    .replace(/—/g, " -- ")
    .replace(/–/g, "-")
    .replace(/•/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x00-\xFF]/g, "?");
}

function safeFilePart(v: string): string {
  return v.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "") || "paciente";
}

export function reportFilename(patientName: string, date: string | null | undefined, ext: "pdf" | "txt"): string {
  const d = (date ?? "").slice(0, 10) || "sem-data";
  return `Relatorio_Cirurgico_${safeFilePart(patientName)}_${d}.${ext}`;
}

export function generateShoulderReportPDF(texto: string, meta: { patientName: string; date?: string | null }): { doc: jsPDF; filename: string } {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = 210, margin = 18, cW = W - margin * 2, bottom = 280, lineH = 4.6;
  let y = 0;

  const header = () => {
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, W, 14, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("RELATÓRIO CIRÚRGICO", margin, 9);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(sanitizePdfText(meta.patientName), W - margin, 9, { align: "right" });
    y = 24;
  };

  header();
  doc.setFontSize(9.5);
  doc.setTextColor(20, 20, 20);
  for (const raw of texto.split("\n")) {
    // Títulos numerados de procedimento ("1. Reparo…") em negrito.
    const bold = /^\d+\.\s/.test(raw) || /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ ]{4,}:?$/.test(raw.trim());
    doc.setFont("helvetica", bold ? "bold" : "normal");
    const lines: string[] = raw.trim() ? doc.splitTextToSize(sanitizePdfText(raw), cW) : [""];
    for (const line of lines) {
      if (y + lineH > bottom) { doc.addPage(); header(); doc.setFontSize(9.5); doc.setTextColor(20, 20, 20); doc.setFont("helvetica", bold ? "bold" : "normal"); }
      doc.text(line, margin, y);
      y += line ? lineH : lineH * 0.6;
    }
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(`Página ${i} de ${pages}`, W - margin, 290, { align: "right" });
  }
  return { doc, filename: reportFilename(meta.patientName, meta.date, "pdf") };
}
