import { useState, useRef, useEffect, useCallback } from "react";
import { Send, ChevronDown, RotateCcw, FileDown, Mic, MicOff, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { aiAssistantMessages } from "@/locales/ai-assistant";
import { isAppleMobileBrowser, useAssistantVoice } from "./voice-controller";
import jsPDF from "jspdf";
import { handlePdfOpenClick, sharePdfOrDownload } from "@/lib/pdf-share";

/**
 * Marca visual do assistente: brilho sobre o degradê da marca, sempre acompanhado
 * do rótulo "IA" no cabeçalho — deixa explícito que as respostas vêm de uma IA.
 */
export function AssistantMark({ label }: { label?: string }) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className="flex h-full w-full items-center justify-center"
      style={{ background: "linear-gradient(135deg, #1A365D 0%, #609DBC 100%)" }}
    >
      <Sparkles className="h-1/2 w-1/2 text-white" strokeWidth={2.2} />
    </span>
  );
}

interface ReportData {
  titulo: string;
  filtros_descricao: string;
  isAdmin?: boolean;
  patients: Array<{
    paciente_nome: string;
    sexo: string;
    data_cirurgia: string;
    lado: string;
    hospital: string;
    tipo_caso: string | null;
    diagnostico: string;
    doctor_nome?: string;
  }>;
  followupStats: {
    total_followups: number;
    avg_vas: number | null;
    retornou_esporte: number;
    falhas: number;
  } | null;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  isReport?: boolean;
  reportData?: ReportData | null;
}

function renderMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/^### (.+)$/gm, '<p class="font-bold text-sm mt-3 mb-1 text-foreground">$1</p>')
    .replace(/^## (.+)$/gm, '<p class="font-bold text-base mt-3 mb-1 text-foreground">$1</p>')
    .replace(/^# (.+)$/gm, '<p class="font-bold text-lg mt-2 mb-1 text-foreground">$1</p>')
    .replace(/^\| (.+) \|$/gm, (line) => {
      const cells = line.split("|").filter(Boolean).map(c => `<td class="px-2 py-1 border border-border text-xs">${c.trim()}</td>`).join("");
      return `<tr>${cells}</tr>`;
    })
    .replace(/(<tr>.*<\/tr>\n?)+/gs, (table) => `<div class="overflow-x-auto my-2"><table class="border-collapse border border-border w-full text-left text-xs">${table}</table></div>`)
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc text-sm">$1</li>')
    .replace(/(<li .+<\/li>\n?)+/gs, (list) => `<ul class="my-1 space-y-0.5">${list}</ul>`)
    .replace(/\n\n/g, '<br/><br/>')
    .replace(/\n/g, "<br/>");
}

function addHeader(doc: jsPDF, pageW: number, assistantName: string) {
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(10, 22, 40);
  doc.text(`DocSholder — ${assistantName}`, 20, 15);
  doc.setDrawColor(220, 220, 230);
  doc.setLineWidth(0.2);
  doc.line(20, 20, pageW - 20, 20);
}

function addFooter(doc: jsPDF, pageW: number, pageH: number, page: number, total: number, generatedAt: string) {
  doc.setDrawColor(220, 220, 230);
  doc.setLineWidth(0.2);
  doc.line(20, pageH - 14, pageW - 20, pageH - 14);
  doc.setTextColor(150, 150, 160);
  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  doc.text(
    generatedAt,
    pageW / 2, pageH - 8, { align: "center" }
  );
  doc.text(`${page} / ${total}`, pageW - 20, pageH - 8, { align: "right" });
}

// GREEN = dentro da normalidade, YELLOW = limítrofe, RED = abaixo do normal
function scoreColor(label: string, value: number): [number, number, number] {
  const GREEN:  [number, number, number] = [34,  168, 110];
  const YELLOW: [number, number, number] = [234, 179,  8];
  const RED:    [number, number, number] = [220,  60, 60];

  const key = label.toLowerCase();

  // VAS Dor — menor é melhor (0-10)
  if (key.includes("vas")) {
    if (value <= 3) return GREEN;
    if (value <= 6) return YELLOW;
    return RED;
  }
  // Fallback genérico por percentual
  const pct = value / 100;
  if (pct >= 0.75) return GREEN;
  if (pct >= 0.50) return YELLOW;
  return RED;
}

function drawScoreBar(
  doc: jsPDF,
  x: number,
  y: number,
  label: string,
  sublabel: string,
  value: number | null,
  maxVal: number
) {
  if (value === null || value === undefined || isNaN(Number(value))) return;
  const val = Number(value);
  const barW = 110;
  const barH = 7;
  const pct = Math.min(val / maxVal, 1);
  const color = scoreColor(label, val);

  doc.setFontSize(8.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(20, 30, 55);
  doc.text(label, x, y + 5);

  if (sublabel) {
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(130, 130, 150);
    doc.text(sublabel, x, y + 10);
  }

  const bx = x + 42;

  doc.setFillColor(230, 232, 240);
  doc.roundedRect(bx, y + 0.5, barW, barH, 2, 2, "F");

  if (pct > 0) {
    doc.setFillColor(color[0], color[1], color[2]);
    doc.roundedRect(bx, y + 0.5, barW * pct, barH, 2, 2, "F");
  }

  doc.setFontSize(8.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(color[0], color[1], color[2]);
  doc.text(`${val.toFixed(1)}`, bx + barW + 4, y + 6);

  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(170, 170, 185);
  doc.text(`/ ${maxVal}`, bx + barW + 16, y + 6);
}

function generateReportPDF(
  reportData: ReportData | null | undefined,
  question: string,
  content: string,
  copy: (key: keyof typeof aiAssistantMessages["pt-BR"], params?: Record<string, string | number>) => string,
  locale: string,
) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 20;
  const maxWidth = pageW - margin * 2;

  if (!reportData || !reportData.patients || reportData.patients.length === 0) {
    addHeader(doc, pageW, copy("assistantName"));
    let y = 32;
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(10, 22, 40);
    doc.text(copy("pdfResponse"), margin, y);
    y += 8;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 80);
    const lines = content.replace(/\*\*/g, "").replace(/\*/g, "").replace(/^#{1,3} /gm, "").split("\n");
    for (const line of lines) {
      if (y > pageH - 20) { doc.addPage(); addHeader(doc, pageW, copy("assistantName")); y = 32; }
      const wrapped = doc.splitTextToSize(line || " ", maxWidth);
      doc.text(wrapped, margin, y);
      y += wrapped.length * 5 + 1;
    }
    addFooter(doc, pageW, pageH, 1, 1, copy("pdfGeneratedAt", { date: new Intl.DateTimeFormat(locale).format(new Date()) }));
    return {
      doc,
      filename: `assistente-ia-relatorio-${new Date().toISOString().slice(0, 10)}.pdf`,
    };
  }

  const { patients, followupStats, titulo, filtros_descricao, isAdmin } = reportData;

  addHeader(doc, pageW, copy("assistantName"));
  let y = 30;
  let currentPage = 1;

  // ── Title block ──────────────────────────────────────────────────────
  doc.setFontSize(15);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(10, 22, 40);
  const titleLines = doc.splitTextToSize(titulo, maxWidth);
  doc.text(titleLines, margin, y);
  y += titleLines.length * 8 + 3;

  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 110, 135);
  const filtroLines = doc.splitTextToSize(copy("pdfFilters", { filters: filtros_descricao }), maxWidth);
  doc.text(filtroLines, margin, y);
  y += filtroLines.length * 5 + 3;

  // Stat chips
  doc.setFillColor(235, 245, 255);
  doc.roundedRect(margin, y, 44, 8, 2, 2, "F");
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(31, 100, 200);
  doc.text(copy("pdfPatients", { count: patients.length, plural: patients.length !== 1 ? "s" : "" }), margin + 3, y + 5.5);

  doc.setFillColor(235, 255, 245);
  doc.roundedRect(margin + 48, y, 52, 8, 2, 2, "F");
  doc.setTextColor(34, 140, 90);
  doc.text(copy("pdfDate", { date: new Intl.DateTimeFormat(locale).format(new Date()) }), margin + 51, y + 5.5);

  if (isAdmin) {
    doc.setFillColor(31, 182, 225, 0.15);
    doc.roundedRect(margin + 104, y, 36, 8, 2, 2, "F");
    doc.setTextColor(10, 22, 40);
    doc.text(copy("pdfAdmin"), margin + 107, y + 5.5);
  }
  y += 14;

  // ── Section header: Patients ─────────────────────────────────────────
  doc.setFillColor(10, 22, 40);
  doc.rect(margin, y, pageW - margin * 2, 9, "F");
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(255, 255, 255);
  doc.text(copy("pdfPatientList"), margin + 3, y + 6);
  y += 9;

  // Column config: admin shows Médico instead of Diagnóstico
  const COL = isAdmin ? {
    num:  { x: margin,      w: 8  },
    nome: { x: margin + 8,  w: 44 },
    sx:   { x: margin + 52, w: 9  },
    data: { x: margin + 61, w: 22 },
    lado: { x: margin + 83, w: 11 },
    enx:  { x: margin + 94, w: 34 },
    med:  { x: margin + 128,w: 41 },
  } : {
    num:  { x: margin,      w: 8  },
    nome: { x: margin + 8,  w: 52 },
    sx:   { x: margin + 60, w: 9  },
    data: { x: margin + 69, w: 22 },
    lado: { x: margin + 91, w: 11 },
    enx:  { x: margin + 102,w: 40 },
    diag: { x: margin + 142,w: 27 },
  } as any;
  const ROW_H = 10;

  const drawTableHeader = () => {
    doc.setFillColor(230, 235, 248);
    doc.rect(margin, y, pageW - margin * 2, 7, "F");
    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(60, 70, 100);
    doc.text("#",          COL.num.x  + 1, y + 5);
    doc.text(copy("pdfPatient"),   COL.nome.x + 1, y + 5);
    doc.text("Sx",         COL.sx.x   + 1, y + 5);
    doc.text(copy("pdfSurgery"),   COL.data.x + 1, y + 5);
    doc.text(copy("pdfSide"),       COL.lado.x + 1, y + 5);
    doc.text(copy("pdfCaseType"), COL.enx.x  + 1, y + 5);
    if (isAdmin) {
      doc.text(copy("pdfDoctor"),   COL.med.x  + 1, y + 5);
    } else {
      doc.text(copy("pdfDiagnosis"), COL.diag.x + 1, y + 5);
    }
    y += 7;
  };

  drawTableHeader();

  patients.forEach((p: any, idx: number) => {
    if (y + ROW_H > pageH - 20) {
      addFooter(doc, pageW, pageH, currentPage, -1, copy("pdfGeneratedAt", { date: new Intl.DateTimeFormat(locale).format(new Date()) }));
      doc.addPage();
      currentPage++;
      addHeader(doc, pageW, copy("assistantName"));
      y = 30;
      doc.setFillColor(10, 22, 40);
      doc.rect(margin, y, pageW - margin * 2, 9, "F");
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(255, 255, 255);
      doc.text(copy("pdfPatientListContinued"), margin + 3, y + 6);
      y += 9;
      drawTableHeader();
    }

    // Row background
    if (idx % 2 === 0) {
      doc.setFillColor(250, 251, 254);
      doc.rect(margin, y, pageW - margin * 2, ROW_H, "F");
    }

    // Left accent bar
    doc.setFillColor(31, 182, 225);
    doc.rect(margin, y, 1.5, ROW_H, "F");

    const rowY = y + 6.5;
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(120, 130, 155);
    doc.text(String(idx + 1), COL.num.x + 2, rowY);

    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 25, 50);
    const nomeMax = isAdmin ? 22 : 26;
    doc.text((p.paciente_nome || "-").substring(0, nomeMax), COL.nome.x + 1, rowY);

    doc.setFont("helvetica", "normal");
    doc.setTextColor(60, 80, 120);
    const data = p.data_cirurgia ? new Intl.DateTimeFormat(locale).format(new Date(p.data_cirurgia + "T00:00:00")) : "-";
    doc.text(p.sexo || "-",                        COL.sx.x   + 1, rowY);
    doc.text(data,                                  COL.data.x + 1, rowY);
    doc.text((p.lado || "-").substring(0, 5),      COL.lado.x + 1, rowY);
    doc.text((p.tipo_caso || "-").substring(0, 22), COL.enx.x  + 1, rowY);
    if (isAdmin) {
      const med = (p.doctor_nome || "-").replace(/^Dr[aA]?\.?\s*/i, "");
      doc.text(med.substring(0, 22),               COL.med.x  + 1, rowY);
    } else {
      doc.text((p.diagnostico || "-").substring(0, 14), COL.diag.x + 1, rowY);
    }

    // Bottom separator
    doc.setDrawColor(235, 238, 248);
    doc.setLineWidth(0.15);
    doc.line(margin, y + ROW_H, pageW - margin, y + ROW_H);
    y += ROW_H;
  });

  // ── Follow-up section — always shown ─────────────────────────────────
  {
    const neededSpace = 60;
    if (y + neededSpace > pageH - 20) {
      addFooter(doc, pageW, pageH, currentPage, -1, copy("pdfGeneratedAt", { date: new Intl.DateTimeFormat(locale).format(new Date()) }));
      doc.addPage();
      currentPage++;
      addHeader(doc, pageW, copy("assistantName"));
      y = 30;
    } else {
      y += 10;
    }

    const totalFu = followupStats ? Number(followupStats.total_followups) : 0;

    // Section header
    doc.setFillColor(10, 22, 40);
    doc.rect(margin, y, pageW - margin * 2, 9, "F");
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(255, 255, 255);
    doc.text(copy("pdfAggregateFollowup"), margin + 3, y + 6);
    doc.setTextColor(31, 182, 225);
    doc.setFontSize(7.5);
    doc.text(
      totalFu > 0 ? copy("pdfAssessments", { count: totalFu }) : copy("pdfNoAssessments"),
      pageW - margin - 3, y + 6, { align: "right" }
    );
    y += 14;

    if (totalFu === 0 || !followupStats) {
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(130, 140, 160);
      doc.text(copy("pdfNoFollowup"), margin, y + 4);
      y += 12;
    } else {
      // All available scores
      const scores: Array<[string, string, number | null, number]> = [
        ["VAS Dor",         copy("scoreVas"),          followupStats.avg_vas,              10],
      ];

      for (const [label, sublabel, val, max] of scores) {
        if (val === null || val === undefined || isNaN(Number(val))) continue;
        if (y + 16 > pageH - 20) {
          addFooter(doc, pageW, pageH, currentPage, -1, copy("pdfGeneratedAt", { date: new Intl.DateTimeFormat(locale).format(new Date()) }));
          doc.addPage();
          currentPage++;
          addHeader(doc, pageW, copy("assistantName"));
          y = 30;
        }
        drawScoreBar(doc, margin, y, label, sublabel, val, max);
        y += 16;
      }

      // Outcomes summary
      y += 4;
      const retornou = Number(followupStats.retornou_esporte ?? 0);
      const falhas   = Number(followupStats.falhas ?? 0);
      const pctRetorno = patients.length > 0 ? ((retornou / patients.length) * 100).toFixed(0) : "—";
      const pctFalha   = patients.length > 0 ? ((falhas   / patients.length) * 100).toFixed(0) : "—";

      if (y + 12 > pageH - 20) {
        addFooter(doc, pageW, pageH, currentPage, -1, copy("pdfGeneratedAt", { date: new Intl.DateTimeFormat(locale).format(new Date()) }));
        doc.addPage();
        currentPage++;
        addHeader(doc, pageW, copy("assistantName"));
        y = 30;
      }

      doc.setFillColor(235, 255, 245);
      doc.roundedRect(margin, y, 75, 9, 2, 2, "F");
      doc.setFontSize(7.5);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(34, 140, 90);
      doc.text(copy("pdfReturnToSport", { count: retornou, percent: pctRetorno }), margin + 3, y + 6);

      doc.setFillColor(255, 240, 240);
      doc.roundedRect(margin + 80, y, 60, 9, 2, 2, "F");
      doc.setTextColor(200, 60, 60);
      doc.text(copy("pdfFailures", { count: falhas, percent: pctFalha }), margin + 83, y + 6);
    }
  }

  // ── Paginate footers ─────────────────────────────────────────────────
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    addFooter(doc, pageW, pageH, i, totalPages, copy("pdfGeneratedAt", { date: new Intl.DateTimeFormat(locale).format(new Date()) }));
  }

  return {
    doc,
    filename: `assistente-ia-relatorio-${new Date().toISOString().slice(0, 10)}.pdf`,
  };
}

export function AIAssistant() {
  const { user } = useAuth();
  const { locale } = useLanguage();
  const t = useScopedTranslations(aiAssistantMessages);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [pdfShareUrl, setPdfShareUrl] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const {
    isListening,
    isTranscribing,
    micError,
    interimText,
    start: startVoice,
    stop: stopVoice,
    cancel: cancelVoice,
  } = useAssistantVoice({
    locale,
    getMessage: key => t(key),
    onText: text => {
      setInput(prev => (prev ? `${prev} ${text}` : text).trim());
      setTimeout(() => inputRef.current?.focus(), 0);
    },
  });

  const handleDownloadPDF = async (reportData: ReportData | null | undefined, question: string, content: string) => {
    if (pdfShareUrl) {
      handlePdfOpenClick(pdfShareUrl, () => setPdfShareUrl(null));
      return;
    }

    const { doc, filename } = generateReportPDF(reportData, question, content, t, locale);
    await sharePdfOrDownload(doc, filename, setPdfShareUrl);
  };

  const toggleMic = useCallback(() => {
    if (isListening) {
      stopVoice();
      return;
    }
    if (!isTranscribing) startVoice();
  }, [isListening, isTranscribing, startVoice, stopVoice]);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("assistant-open", handler);
    return () => window.removeEventListener("assistant-open", handler);
  }, []);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 200);
    } else {
      // Closing is cancellation, not a request to commit a late browser
      // event into a draft after the panel has disappeared.
      cancelVoice();
    }
  }, [cancelVoice, open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function sendMessage(text?: string) {
    const content = (text ?? input).trim();
    if (!content || loading) return;

    const newMessages: Message[] = [...messages, { role: "user", content }];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch(`/api/agent/chat`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: newMessages.map(({ role, content }) => ({ role, content })),
        }),
      });

      if (!res.ok) throw new Error(`request-failed-${res.status}`);
      const data = await res.json();
      setMessages(prev => [...prev, {
        role: "assistant",
        content: data.message,
        isReport: !!data.isReport,
        reportData: data.reportData ?? null,
      }]);
    } catch (e: any) {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: t("responseError"),
      }]);
    } finally {
      setLoading(false);
    }
  }

  if (!user) return null;

  const firstName = ((user as any).nome ?? "").replace(/^Dr[aA]?\.?\s*/i, "").trim().split(/\s+/)[0] || t("doctorFallback");

  return (
    <>
      {/* Floating button — desktop only; mobile uses bottom nav */}
      <button
        onClick={() => setOpen(true)}
        className={cn(
          "fixed z-50 hidden md:flex items-center justify-center rounded-full shadow-2xl transition-all duration-200 active:scale-95 overflow-hidden",
          "md:bottom-6 md:right-6",
          open && "opacity-0 pointer-events-none scale-75"
        )}
        style={{
          width: 54,
          height: 54,
          background: "#0A1628",
          boxShadow: "0 4px 20px rgba(31,182,225,0.45)",
        }}
        aria-label={t("open")}
      >
        <AssistantMark />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 md:inset-auto md:bottom-6 md:right-6 md:w-[420px] md:h-[600px] flex flex-col rounded-none md:rounded-2xl overflow-hidden"
          style={{ boxShadow: "0 8px 48px rgba(0,0,0,0.25)", paddingTop: "env(safe-area-inset-top)" }}
        >
          <div
            className="flex items-center gap-3 px-4 py-3.5 shrink-0"
            style={{ background: "linear-gradient(135deg, #0A1628 0%, #0D2040 100%)" }}
          >
            <div className="w-9 h-9 rounded-full shrink-0 overflow-hidden"
              style={{ border: "1.5px solid rgba(31,182,225,0.4)" }}
            >
              <AssistantMark />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-white">{t("title")}</span>
                <span
                  className="text-xs font-medium px-1.5 py-0.5 rounded"
                  style={{ background: "rgba(31,182,225,0.2)", color: "#1FB6E1", fontSize: 10 }}
                >IA</span>
              </div>
              <span className="text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>
                {t("assistantName")}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <button
                  onClick={() => setMessages([])}
                  className="w-8 h-8 rounded-full flex items-center justify-center"
                  style={{ background: "rgba(255,255,255,0.07)", border: "none", cursor: "pointer" }}
                  title={t("newConversation")}
                  aria-label={t("newConversation")}
                >
                  <RotateCcw className="h-3.5 w-3.5 text-white/50" />
                </button>
              )}
              <button
                onClick={() => {
                  cancelVoice();
                  setOpen(false);
                }}
                className="w-8 h-8 rounded-full flex items-center justify-center"
                style={{ background: "rgba(255,255,255,0.07)", border: "none", cursor: "pointer" }}
                title={t("close")}
                aria-label={t("close")}
              >
                <ChevronDown className="h-4 w-4 text-white/70" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto bg-background p-3 space-y-3">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-5 pb-4">
                <div className="text-center space-y-2">
                  <div className="w-14 h-14 rounded-2xl mx-auto overflow-hidden"
                    style={{ border: "1px solid rgba(31,182,225,0.2)" }}
                  >
                    <AssistantMark />
                  </div>
                  <div>
                    <p className="font-bold text-foreground text-sm">{t("greeting", { name: firstName })}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 max-w-[260px] mx-auto">
                      {t("onboarding")}
                    </p>
                  </div>
                </div>
                <div className="w-full space-y-1.5">
                  {([t("suggestionSurgeries"), t("suggestionProcedure"), t("suggestionReport")]).map((s) => (
                    <button
                      key={s}
                      onClick={() => sendMessage(s)}
                      className="w-full text-left text-xs px-3 py-2 rounded-lg border border-border bg-card hover:bg-muted/50 transition-colors text-foreground/80"
                      style={{ cursor: "pointer", fontFamily: "inherit" }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => {
              const prevUserMsg = messages.slice(0, i).filter(m => m.role === "user").at(-1);
              return (
                <div key={i} className={cn("flex gap-2", msg.role === "user" ? "justify-end" : "justify-start")}>
                  {msg.role === "assistant" && (
                    <div className="w-7 h-7 rounded-full shrink-0 mt-0.5 overflow-hidden"
                      style={{ border: "1px solid rgba(31,182,225,0.3)" }}
                    >
                      <AssistantMark />
                    </div>
                  )}
                  <div className="flex flex-col gap-1 max-w-[82%]">
                    <div
                      className={cn(
                        "px-3 py-2 rounded-2xl text-sm leading-relaxed",
                        msg.role === "user"
                          ? "text-white rounded-br-sm"
                          : "bg-card border border-border text-foreground rounded-bl-sm"
                      )}
                      style={msg.role === "user" ? { background: "linear-gradient(135deg, #1A365D, #2A4A7F)" } : {}}
                    >
                      {msg.role === "assistant" ? (
                        <div
                          className="prose-sm"
                          dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                        />
                      ) : (
                        <span>{msg.content}</span>
                      )}
                    </div>
                    {msg.role === "assistant" && msg.isReport && (
                      <button
                        onClick={() => handleDownloadPDF(msg.reportData, prevUserMsg?.content ?? t("reportFallbackQuestion"), msg.content)}
                        className="self-start flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors"
                        style={{
                          cursor: "pointer",
                          fontFamily: "inherit",
                          background: "#0A1628",
                          color: "#1FB6E1",
                          borderColor: "#1FB6E1",
                        }}
                      >
                        <FileDown className="h-3.5 w-3.5" />
                        {pdfShareUrl ? t("openPdf") : t("downloadPdf")}
                      </button>
                    )}
                  </div>
                  {msg.role === "user" && (
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-white text-xs font-bold"
                      style={{ background: "linear-gradient(135deg, #1A365D, #2A4A7F)" }}
                    >
                      {(() => {
                        const cleaned = ((user as any).nome ?? "").replace(/^Dr[aA]?\.?\s*/i, "").trim();
                        const parts = cleaned.split(/\s+/).filter(Boolean);
                        if (parts.length === 0) return "?";
                        if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
                        return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
                      })()}
                    </div>
                  )}
                </div>
              );
            })}

            {loading && (
              <div className="flex gap-2 justify-start">
                <div className="w-7 h-7 rounded-full shrink-0 overflow-hidden"
                  style={{ border: "1px solid rgba(31,182,225,0.3)" }}
                >
                  <AssistantMark />
                </div>
                <div
                  className="bg-card border border-border px-4 py-3 rounded-2xl rounded-bl-sm flex items-center gap-1.5"
                  role="status"
                  aria-label={t("loading")}
                >
                  {[0, 1, 2].map(i => (
                    <span
                      key={i}
                      className="w-1.5 h-1.5 rounded-full animate-bounce"
                      style={{ background: "#1FB6E1", animationDelay: `${i * 0.15}s` }}
                    />
                  ))}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="shrink-0 bg-background border-t border-border px-3 pt-3" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                placeholder={isListening
                  ? t("listeningTapToStop")
                  : isTranscribing
                    ? t("transcribingAudio")
                    : t("inputPlaceholder")}
                rows={1}
                readOnly={isListening || isTranscribing}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="sentences"
                spellCheck={false}
                data-form-type="other"
                className="flex-1 resize-none bg-muted/30 border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50 transition-colors leading-5"
                style={{
                  fontFamily: "inherit",
                  maxHeight: 100,
                  minHeight: 38,
                  ...(isListening ? { borderColor: "#1FB6E1", boxShadow: "0 0 0 2px rgba(31,182,225,0.25)" } : {}),
                }}
                onInput={e => {
                  const el = e.currentTarget;
                  el.style.height = "auto";
                  el.style.height = Math.min(el.scrollHeight, 100) + "px";
                }}
              />
              <button
                onClick={toggleMic}
                disabled={isTranscribing}
                title={isListening ? t("stopRecording") : micError ? t("microphoneUnavailable") : t("talkToAssistant")}
                aria-label={isListening ? t("stopRecording") : micError ? t("microphoneUnavailable") : t("talkToAssistant")}
                className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-all"
                style={{
                  border: "none",
                  cursor: "pointer",
                  background: isListening
                    ? "linear-gradient(135deg, #1FB6E1 0%, #0891b2 100%)"
                    : micError
                    ? "rgba(220,60,60,0.12)"
                    : "rgba(31,182,225,0.1)",
                  boxShadow: isListening ? "0 0 0 3px rgba(31,182,225,0.3)" : "none",
                  animation: isListening ? "pulse 1.2s ease-in-out infinite" : "none",
                }}
              >
                {micError
                  ? <MicOff className="h-4 w-4" style={{ color: "#dc3c3c" }} />
                  : <Mic className="h-4 w-4" style={{ color: isListening ? "#fff" : "#1FB6E1" }} />
                }
              </button>
              <button
                onClick={() => sendMessage()}
                disabled={!input.trim() || loading || isListening || isTranscribing}
                className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-all disabled:opacity-40"
                style={{
                  background: input.trim() && !loading ? "linear-gradient(135deg, #1FB6E1 0%, #0A1628 100%)" : undefined,
                  border: "none",
                  cursor: input.trim() && !loading ? "pointer" : "default",
                }}
                aria-label={t("send")}
                title={t("send")}
              >
                <Send className={cn("h-4 w-4", input.trim() && !loading ? "text-white" : "text-muted-foreground")} />
              </button>
            </div>
            {isListening && (
              <p className="text-center text-xs mt-2 truncate px-2" style={{ color: "#1FB6E1" }}>
                {isAppleMobileBrowser()
                  ? t("listeningTapToStop")
                  : interimText
                  ? <><span style={{ opacity: 0.7 }}>{interimText}</span></>
                  : t("listeningHint")}
              </p>
            )}
            {isTranscribing && (
              <p className="text-center text-xs mt-2 px-2" style={{ color: "#1FB6E1" }}>
                {t("transcribingAudio")}
              </p>
            )}
            {!isListening && micError && (
              <p role="alert" className="text-center text-xs mt-2 px-2" style={{ color: "#dc3c3c" }}>
                {micError}
              </p>
            )}
            {!isListening && (
              <p className={cn("text-center text-xs text-muted-foreground/50 mt-2", micError && "sr-only")}>
                {t("disclaimer")}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
