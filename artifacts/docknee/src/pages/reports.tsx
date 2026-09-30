import { useState, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { operationalCoreMessages } from "@/locales/operational-core";
import { reportingDashboardMessages } from "@/locales/reporting-dashboard";
import { reportCatalogLabel, reportCatalogOptions } from "@/locales/reporting-catalogs";
import { CASE_TYPE_BY_KEY, CASE_TYPES } from "@workspace/clinical/web";
import { documentText } from "@/locales/document-locales";
import { formatDateOnly, formatLocalDate, sortByPtBrName } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { handlePdfOpenClick, sharePdfOrDownload } from "@/lib/pdf-share";
import { Filter, Download, Pencil, CheckCircle, XCircle, TrendingUp, ChevronDown, ChevronRight, FileText, ExternalLink } from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { DateInput } from "@/components/ui/date-input";

// ─── Constants ───────────────────────────────────────────────────────────────
const CASE_TYPE_OPTIONS = CASE_TYPES.filter((c) => !c.freeOnly);
const TEMPOS = ["Pré-operatório", "6 semanas", "3 meses", "6 meses", "1 ano"];
const NIVEIS_ATIVIDADE = ["Sedentário", "Recreacional", "Amador", "Semi-profissional", "Profissional"];
const LADOS = ["Direito", "Esquerdo"];

export const ESCALAS = [
  { key: "vasDor", label: "VAS", full: "VAS Dor", max: 10, invert: true },
  { key: "sane", label: "SANE", full: "SANE", max: 100, invert: false },
];

// ─── Types ────────────────────────────────────────────────────────────────────
interface FollowupRecord {
  id: number | null; surgeryId: number; tempo: string | null; dataAvaliacao: string | null;
  vasDor: number | null;
  /** SANE (0–100) respondido pelo paciente; null quando não respondido. */
  sane?: number | null;
  retornoEsporte: boolean | null; nivelRetorno: string | null;
  falha: boolean | null; falhaType: string | null; observacoes: string | null;
  /** Registro de follow-up com algum desfecho registrado (resposta do paciente ou do médico). */
  respondida: boolean;
  surgeryStatus?: string | null;
  dataCirurgia: string | null; hospital: string | null;
  regiao: string | null; tipoCaso: string | null; diagnostico: string | null;
  tiposProcedimento: string[]; procedimentoRealizado: string | null;
  surgeryDoctorId: number;
  patientNome: string | null; patientSexo: string | null; patientLado: string | null;
  patientNivelAtividade: string | null;
  patientBeighton: number | null; idade: number | null;
  doctorNome: string | null;
}

interface ScoreForm {
  tempo: string;
  vasDor: string;
  retornoEsporte: string; nivelRetorno: string; falha: string; falhaType: string;
  observacoes: string; dataAvaliacao: string;
}

type FilterState = {
  // Follow-up
  tempo: string;
  retornoEsporte: string;
  falha: string;
  // Surgery
  regiao: string;
  tipoCaso: string;
  dataInicio: string;
  dataFim: string;
  hospital: string;
  // Patient
  sexo: string;
  nivelAtividade: string;
  lado: string;
  idadeMin: string;
  idadeMax: string;
  // Admin
  medicoId: string;
};

const EMPTY_FILTERS: FilterState = {
  tempo: "", retornoEsporte: "", falha: "",
  regiao: "", tipoCaso: "", dataInicio: "", dataFim: "", hospital: "",
  sexo: "", nivelAtividade: "", lado: "", idadeMin: "", idadeMax: "",
  medicoId: "",
};

const caseTypeLabel = (key: string) => CASE_TYPE_BY_KEY.get(key)?.label ?? key;

const DRAFT_SURGERY_STATUS = "rascunho";

type ReportRow = Pick<FollowupRecord, "id" | "surgeryId" | "respondida" | "tiposProcedimento"> & { surgeryStatus?: string | null };

/** Rascunhos não são cirurgias realizadas e não entram no relatório. */
export function excludeDraftRows<T extends { surgeryStatus?: string | null }>(rows: readonly T[]): T[] {
  return rows.filter((row) => row.surgeryStatus !== DRAFT_SURGERY_STATUS);
}

/**
 * Contagens do relatório. Cada linha é um registro de follow-up ou, quando a
 * cirurgia ainda não tem nenhum, a própria cirurgia (id nulo).
 * - surgeries: cirurgias realizadas distintas;
 * - recordedFollowups: registros de follow-up (criados no envio do questionário
 *   ou ao inserir uma avaliação), respondidos ou não;
 * - answeredAssessments: registros com algum desfecho preenchido.
 */
export function summarizeReportRows(rows: readonly ReportRow[]) {
  const completed = excludeDraftRows(rows);
  return {
    surgeries: new Set(completed.map((row) => row.surgeryId)).size,
    recordedFollowups: completed.filter((row) => row.id != null).length,
    answeredAssessments: completed.filter((row) => row.id != null && row.respondida).length,
  };
}

/**
 * Mesma convenção do painel: % das cirurgias realizadas, cada tipo contado uma
 * vez por cirurgia. Como uma cirurgia pode ter vários tipos, a soma pode passar de 100%.
 */
export function summarizeReportCaseTypes(rows: readonly ReportRow[]) {
  const seen = new Set<number>();
  const counts = new Map<string, number>();
  for (const row of excludeDraftRows(rows)) {
    if (seen.has(row.surgeryId)) continue;
    seen.add(row.surgeryId);
    for (const key of new Set(row.tiposProcedimento ?? [])) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const surgeries = seen.size;
  return {
    surgeries,
    byType: [...counts.entries()].map(([key, count]) => ({
      key,
      count,
      percent: surgeries > 0 ? Math.round((count / surgeries) * 100) : 0,
    })),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function scoreCell(v: number | null, max: number = 100, invert = false) {
  if (v == null) return <span className="text-muted-foreground/40 text-xs">—</span>;
  const pct = invert ? ((max - v) / max) * 100 : (v / max) * 100;
  const color = pct >= 75 ? "text-green-600" : pct >= 50 ? "text-amber-600" : "text-red-600";
  return <span className={`font-semibold tabular-nums ${color}`}>{v}</span>;
}
function avg(arr: (number | null)[]): number | null {
  const v = arr.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
/** Médias das escalas do paciente nas avaliações respondidas (VAS 0–10, SANE 0–100). */
export function summarizeReportScores(rows: readonly { vasDor: number | null; sane?: number | null }[]) {
  return {
    avgVas: avg(rows.map((r) => r.vasDor)),
    avgSane: avg(rows.map((r) => r.sane ?? null)),
  };
}
function fmtAvg(v: number | null, d = 1) { return v == null ? "—" : v.toFixed(d); }

function FilterSelect({ label, value, options, onChange, placeholder, locale }: {
  label: string; value: string; options: string[]; onChange: (v: string) => void; placeholder: string; locale: "pt-BR" | "es";
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={v => onChange(v === "_all" ? "" : v)}>
        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={placeholder} /></SelectTrigger>
        <SelectContent>
          <SelectItem value="_all">{placeholder}</SelectItem>
          {reportCatalogOptions(locale, options)
            .sort((a, b) => a.label.localeCompare(b.label, locale))
            .map(({ value: optionValue, label: optionLabel }) => (
              <SelectItem key={optionValue} value={optionValue}>{optionLabel}</SelectItem>
            ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function FilterSection({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-muted/30 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
      >
        {title}
        {open ? <ChevronDown className="h-4 w-4 opacity-50" /> : <ChevronRight className="h-4 w-4 opacity-50" />}
      </button>
      {open && <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">{children}</div>}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function Reports() {
  const { formatDate, locale } = useLanguage();
  const t = useScopedTranslations(operationalCoreMessages);
  const tx = useScopedTranslations(reportingDashboardMessages);
  type ReportingKey = keyof (typeof reportingDashboardMessages)["pt-BR"];
  // The i18n helper has no plural rules: pick the singular or plural key explicitly.
  const countLabel = (count: number, one: ReportingKey, other: ReportingKey) => tx(count === 1 ? one : other, { count });
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [location] = useLocation();

  // Parse ?escala= from URL
  const urlEscala = useMemo(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("escala") ?? "";
  }, [location]);

  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<FilterState>(EMPTY_FILTERS);
  const [editRow, setEditRow] = useState<FollowupRecord | null>(null);
  const [pdfShareUrl, setPdfShareUrl] = useState<string | null>(null);

  // ── Filtros de Consultas ──────────────────────────────────────────────────
  const [consultasFilters, setConsultasFilters] = useState({ tipo: "", plano: "", periodo: "" });
  const [appliedConsultas, setAppliedConsultas] = useState({ tipo: "", plano: "", periodo: "" });

  // ── Filtros de Ortobiológicos ─────────────────────────────────────────────
  const [regenFilters, setRegenFilters]         = useState({ produto: "", status: "", dataInicio: "", dataFim: "" });
  const [appliedRegen, setAppliedRegen]         = useState({ produto: "", status: "", dataInicio: "", dataFim: "" });

  const { data: regenData, isLoading: regenLoading } = useQuery<{
    total: number;
    byProduct: Record<string, number>;
    byStatus: Record<string, number>;
    byCondition: Record<string, number>;
  }>({
    queryKey: ["reports/regen", appliedRegen],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (appliedRegen.produto)     p.set("produto",     appliedRegen.produto);
      if (appliedRegen.status)      p.set("status",      appliedRegen.status);
      if (appliedRegen.dataInicio)  p.set("dataInicio",  appliedRegen.dataInicio);
      if (appliedRegen.dataFim)     p.set("dataFim",     appliedRegen.dataFim);
      const res = await fetch(`/api/reports/regen${p.toString() ? "?" + p.toString() : ""}`, {
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error(tx("loadError"));
      return res.json();
    },
  });

  const { data: consultasData, isLoading: consultasLoading } = useQuery<{
    total: number;
    byTipo: Record<string, number>;
    byPlano: Record<string, number>;
    byStatus: Record<string, number>;
    planos: string[];
  }>({
    queryKey: ["reports/consultas", appliedConsultas],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (appliedConsultas.tipo) p.set("tipo", appliedConsultas.tipo);
      if (appliedConsultas.plano) p.set("plano", appliedConsultas.plano);
      if (appliedConsultas.periodo) p.set("periodo", appliedConsultas.periodo);
      const res = await fetch(`/api/reports/consultas${p.toString() ? "?" + p.toString() : ""}`, {
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error(tx("loadError"));
      return res.json();
    },
  });
  const [scoreForm, setScoreForm] = useState<ScoreForm>({
    tempo: "",
    vasDor: "",
    retornoEsporte: "", nivelRetorno: "", falha: "", falhaType: "", observacoes: "", dataAvaliacao: "",
  });

  // When URL escala changes, pre-open edit for that scale (just store for highlight)
  const highlightEscala = urlEscala;

  const setFilter = (k: keyof FilterState, v: string) => setFilters(f => ({ ...f, [k]: v }));
  const buildQuery = (f: FilterState) => {
    const p = new URLSearchParams();
    (Object.entries(f) as [keyof FilterState, unknown][]).forEach(([k, v]) => {
      if (Array.isArray(v)) {
        if (v.length > 0) p.set(k, v.join(","));
      } else if (v) {
        p.set(k, v as string);
      }
    });
    return p.toString();
  };

  const { data: records = [], isLoading, isFetching } = useQuery<FollowupRecord[]>({
    queryKey: ["reports/followups", applied],
    queryFn: async () => {
      const qs = buildQuery(applied);
      const res = await fetch(`/api/reports/followups${qs ? "?" + qs : ""}`, {
        credentials: "same-origin",
      });
       if (!res.ok) throw new Error(tx("loadError"));
      return res.json();
    },
  });

  const { data: doctors = [] } = useQuery<{ id: number; nome: string }[]>({
    queryKey: ["reports/doctors"],
    queryFn: async () => {
      const res = await fetch("/api/reports/doctors", { credentials: "same-origin" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!user?.isAdmin,
  });
  const sortedDoctors = sortByPtBrName(doctors, (doctor) => doctor.nome, (doctor) => doctor.id);

  const filtered = useMemo(() => excludeDraftRows(records), [records]);
  const answered = useMemo(() => filtered.filter((r) => r.id != null && r.respondida), [filtered]);
  const reportCounts = useMemo(() => summarizeReportRows(filtered), [filtered]);
  const isExportPending = isLoading || isFetching;

  const chartsRef = useRef<HTMLDivElement>(null);

  const applyFollowupFilters = () => {
    setApplied({ ...filters });
    toast({ title: tx("filtersApplied"), description: tx("updatingReport") });
  };

  // ─── Ordered tempo labels for chart X axis ────────────────────────────────
  const TEMPO_ORDER = [
    "Pré-operatório", "2 semanas", "30 dias", "1 mês", "6 semanas", "45 dias",
    "60 dias", "2 meses", "90 dias", "3 meses", "120 dias", "4 meses",
    "150 dias", "5 meses", "180 dias", "6 meses", "9 meses", "270 dias",
    "1 ano", "12 meses", "18 meses", "2 anos", "24 meses", "3 anos", "36 meses",
  ];
  const tempoIndex = (t: string) => { const i = TEMPO_ORDER.indexOf(t); return i >= 0 ? i : 999; };

  const chartData = useMemo(() => {
    const groups = new Map<string, FollowupRecord[]>();
    for (const r of answered) {
      const key = r.tempo ?? "";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => tempoIndex(a) - tempoIndex(b))
      .map(([tempo, recs]) => {
        const retRecs = recs.filter(r => r.retornoEsporte != null);
        return {
          tempo,
          n: recs.length,
          vasDor: avg(recs.map(r => r.vasDor)) != null ? parseFloat(avg(recs.map(r => r.vasDor))!.toFixed(1)) : null,
          taxaRetorno: retRecs.length > 0
            ? parseFloat((retRecs.filter(r => r.retornoEsporte).length / retRecs.length * 100).toFixed(0))
            : null,
          taxaFalha: recs.some(r => r.falha != null)
            ? parseFloat((recs.filter(r => r.falha).length / recs.filter(r => r.falha != null).length * 100).toFixed(0))
            : null,
        };
      });
  }, [answered]);

  // Cirurgias realizadas (não avaliações) por tipo de caso — % das cirurgias.
  const caseTypeData = useMemo(
    () => summarizeReportCaseTypes(filtered).byType.map(({ key, count, percent }) => ({ name: caseTypeLabel(key), value: count, percent })),
    [filtered],
  );
  const PIE_COLORS = ["#1A365D", "#1FB6E1", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899"];

  const generatePDF = async () => {
    if (pdfShareUrl) {
      handlePdfOpenClick(pdfShareUrl, () => setPdfShareUrl(null));
      return;
    }
    if (isExportPending) {
      toast({ title: tx("waitForUpdate"), description: tx("filteredLoading") });
      return;
    }
    if (!chartsRef.current) return;
    toast({ title: tx("generatingPdf"), description: tx("waitSeconds") });
    try {
      const html2canvas = (await import("html2canvas")).default;
      const { jsPDF } = await import("jspdf");

      const container = chartsRef.current;

      // iOS Safari / html2canvas cannot render SVGs directly. Pre-convert every
      // Recharts SVG to a <img> PNG data-URL, then restore originals afterwards.
      const svgEls = Array.from(container.querySelectorAll("svg")) as SVGElement[];
      type Replacement = { parent: Element; svg: SVGElement; img: HTMLImageElement };
      const replacements: Replacement[] = [];

      await Promise.all(svgEls.map(async (svg) => {
        try {
          const bbox = svg.getBoundingClientRect();
          const w = Math.max(Math.ceil(bbox.width), 10);
          const h = Math.max(Math.ceil(bbox.height), 10);
          svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
          const svgStr = new XMLSerializer().serializeToString(svg);
          const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
          const url = URL.createObjectURL(blob);
          await new Promise<void>((resolve) => {
            const tmp = new Image();
            tmp.onload = () => {
              const c = document.createElement("canvas");
              c.width = w * 2; c.height = h * 2;
              const ctx = c.getContext("2d")!;
              ctx.fillStyle = "#ffffff";
              ctx.fillRect(0, 0, c.width, c.height);
              ctx.drawImage(tmp, 0, 0, c.width, c.height);
              URL.revokeObjectURL(url);
              const img = document.createElement("img");
              img.src = c.toDataURL("image/png");
              img.style.cssText = `width:${w}px;height:${h}px;display:block;`;
              const parent = svg.parentElement!;
              parent.replaceChild(img, svg);
              replacements.push({ parent, svg, img });
              resolve();
            };
            tmp.onerror = () => { URL.revokeObjectURL(url); resolve(); };
            tmp.src = url;
          });
        } catch { /* keep original SVG on error */ }
      }));

      // Try with scale:2 first; fall back to scale:1 if the canvas comes out
      // blank (width=0) or if html2canvas throws (e.g. memory pressure on mobile).
      let canvas: HTMLCanvasElement | undefined;
      const h2cOptions = (scale: number) => ({
        scale,
        backgroundColor: "#ffffff",
        useCORS: true,
        allowTaint: false,   // keep canvas clean so toDataURL doesn't throw SecurityError
        logging: false,
        imageTimeout: 15000,
      });

      try {
        const c = await html2canvas(container, h2cOptions(2));
        canvas = c.width > 0 ? c : undefined;
      } catch {
        // will retry at scale:1 below
      } finally {
        for (const { parent, svg, img } of replacements) {
          if (img.parentNode === parent) parent.replaceChild(svg, img);
        }
      }

      if (!canvas) {
        // Fallback: scale:1, also allow taint (some env can't avoid it)
        canvas = await html2canvas(container, { ...h2cOptions(1), allowTaint: true });
      }

      if (!canvas || canvas.width === 0 || canvas.height === 0) {
        throw new Error(tx("emptyCanvasError"));
      }

      let imgData: string;
      try {
        imgData = canvas.toDataURL("image/png");
      } catch {
        // SecurityError: tainted canvas — use JPEG which tolerates taint on some browsers
        imgData = canvas.toDataURL("image/jpeg", 0.92);
      }

      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const ratio = canvas.height / canvas.width;
      const imgW = pageW - 20;
      const imgH = imgW * ratio;
      pdf.setFontSize(14);
      pdf.setTextColor(26, 54, 93);
      pdf.text(documentText(locale, "followupReport"), 10, 12);
      pdf.setFontSize(9);
      pdf.setTextColor(100, 100, 100);
      pdf.text(`${documentText(locale, "generatedOn")} ${formatDate(new Date())} · ${countLabel(reportCounts.answeredAssessments, "answeredAssessmentCount", "answeredAssessmentsCount")} · ${countLabel(reportCounts.recordedFollowups, "recordedFollowupCount", "recordedFollowupsCount")} · ${countLabel(reportCounts.surgeries, "surgeryCount", "surgeriesCount")}`, 10, 18);
      if (hasActiveFilters) {
        const filterSummary = Object.entries(applied)
          .filter(([, v]) => Array.isArray(v) ? v.length > 0 : v !== "")
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.map(value => reportCatalogLabel(locale, value)).join(", ") : reportCatalogLabel(locale, v)}`)
          .join(" · ");
        pdf.text(`${documentText(locale, "filters")}: ${filterSummary}`, 10, 23, { maxWidth: pageW - 20 });
      }
      const topMargin = hasActiveFilters ? 28 : 22;
      const availH = pageH - topMargin - 5;
      const safeImgH = Number.isFinite(imgH) ? Math.min(imgH, availH) : availH;
      pdf.addImage(imgData, "PNG", 10, topMargin, imgW, safeImgH);
      const result = await sharePdfOrDownload(
        pdf,
        `relatorio_docsholder_${formatLocalDate()}.pdf`,
        setPdfShareUrl,
      );
      toast(result.deferred
        ? { title: tx("pdfReady"), description: tx("openPdfSafari") }
        : { title: tx("pdfGenerated") });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("Erro ao gerar PDF:", e);
      toast({ title: tx("pdfError"), description: msg.slice(0, 120), variant: "destructive" });
    }
  };

  const updateMut = useMutation({
    mutationFn: async ({ id, surgeryId, data }: { id: number | null; surgeryId: number; data: Record<string, unknown> }) => {
      if (id == null) {
        const res = await fetch(`/api/followup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ surgeryId, tempo: data.tempo ?? "Pré-operatório", ...data }),
        });
        if (!res.ok) throw new Error(tx("saveRequestError"));
        return res.json();
      }
      const res = await fetch(`/api/followup/${id}/update`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(tx("saveRequestError"));
      return res.json();
    },
    onSuccess: () => { toast({ title: tx("scalesSaved") }); qc.invalidateQueries({ queryKey: ["reports/followups"] }); setEditRow(null); },
    onError: () => toast({ title: tx("saveError"), variant: "destructive" }),
  });

  const openEdit = (row: FollowupRecord) => {
    setEditRow(row);
    setScoreForm({
      tempo: row.tempo ?? "",
      vasDor: row.vasDor?.toString() ?? "",
      retornoEsporte: row.retornoEsporte == null ? "" : row.retornoEsporte ? "sim" : "nao",
      nivelRetorno: row.nivelRetorno ?? "", falha: row.falha == null ? "" : row.falha ? "sim" : "nao",
      falhaType: row.falhaType ?? "", observacoes: row.observacoes ?? "", dataAvaliacao: row.dataAvaliacao ?? "",
    });
  };

  const saveScores = () => {
    if (!editRow) return;
    const ni = (s: string) => s === "" ? null : parseInt(s);
    const b = (s: string) => s === "" ? null : s === "sim";
    updateMut.mutate({ id: editRow.id, surgeryId: editRow.surgeryId, data: {
      tempo: scoreForm.tempo || "Pré-operatório",
      vasDor: ni(scoreForm.vasDor),
      retornoEsporte: b(scoreForm.retornoEsporte), nivelRetorno: scoreForm.nivelRetorno || null,
      falha: b(scoreForm.falha), falhaType: scoreForm.falhaType || null,
      observacoes: scoreForm.observacoes || null, dataAvaliacao: scoreForm.dataAvaliacao || null,
    }});
  };

  const exportCSV = () => {
    if (isExportPending) {
      toast({ title: tx("waitForUpdate"), description: tx("filteredLoading") });
      return;
    }
    const isAdminExport = user?.isAdmin ?? false;
    const headers = [isAdminExport ? tx("csvSurgeryId") : tx("csvPatient"), tx("csvSex"), tx("csvAge"), tx("csvSide"), tx("csvActivityLevel"),
      tx("csvDoctor"), tx("region"), tx("csvType"), tx("csvDiagnosis"), tx("csvHospital"),
      tx("csvSurgeryDate"), tx("csvFollowupTime"), tx("csvAssessmentDate"), tx("csvVasPain"), tx("csvSane"),
      tx("csvReturnSport"), tx("csvReturnLevel"), tx("csvFailure"), tx("csvFailureType")];
    const yesNo = (v: boolean | null) => v == null ? "" : v ? documentText(locale, "yes") : documentText(locale, "no");
    const rows = filtered.map(r => [
      isAdminExport ? tx("surgeryId", { id: r.surgeryId }) : (r.patientNome ?? ""), r.patientSexo ?? "", r.idade ?? "", r.patientLado ?? "",
      r.patientNivelAtividade ?? "",
      r.doctorNome ?? "", regionLabel(r.regiao), r.tiposProcedimento.map(caseTypeLabel).join("; "), r.diagnostico ?? "",
      r.hospital ?? "", r.dataCirurgia ?? "", r.tempo, r.dataAvaliacao ?? "", r.vasDor ?? "", r.sane ?? "",
      yesNo(r.retornoEsporte), r.nivelRetorno ?? "", yesNo(r.falha), r.falhaType ?? "",
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "relatorio_docsholder.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  // Summary stats
  const { avgVas, avgSane } = summarizeReportScores(answered);
  const withRetorno = answered.filter(r => r.retornoEsporte != null);
  const taxaRetorno = withRetorno.length > 0 ? (withRetorno.filter(r => r.retornoEsporte).length / withRetorno.length * 100) : null;
  const withFalha = answered.filter(r => r.falha != null);
  const taxaFalha = withFalha.length > 0 ? (withFalha.filter(r => r.falha).length / withFalha.length * 100) : null;

  const regionLabel = (value: string | null) => value === "shoulder" ? tx("shoulder") : value === "elbow" ? tx("elbow") : "—";
  const sf = scoreForm;
  const setSf = (k: keyof ScoreForm, v: string) => setScoreForm(p => ({ ...p, [k]: v }));

  const hasActiveFilters = Object.entries(applied).some(([, v]) => Array.isArray(v) ? v.length > 0 : v !== "");
  const activeFilterCount = Object.entries(applied).filter(([, v]) => Array.isArray(v) ? v.length > 0 : v !== "").length;

  return (
    <div className="max-w-full animate-in fade-in">

      {/* ── Mobile navy banner (hidden md+) ── */}
      <div className="md:hidden" style={{ background: "linear-gradient(135deg, #0A1628 0%, #0D2040 100%)" }}>
        <div className="px-4 pt-5 pb-4">
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#fff", margin: 0 }}>
            {t("reports")}
            {highlightEscala && (
              <span style={{ fontSize: 14, fontWeight: 400, color: "#1FB6E1", marginLeft: 8 }}>
                — {ESCALAS.find(e => e.key === highlightEscala)?.label ?? highlightEscala}
              </span>
            )}
          </h1>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", margin: "4px 0 0" }}>
            {user?.isAdmin ? tx("adminMode") : tx("mobileSubtitle")}
          </p>
        </div>
        <div className="px-4 pb-4 flex gap-2">
          <button
            onClick={generatePDF}
            disabled={isExportPending || filtered.length === 0}
            style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 0", borderRadius: 10, fontSize: 12, fontWeight: 600, background: "rgba(255,255,255,0.1)", color: isExportPending || filtered.length === 0 ? "rgba(255,255,255,0.3)" : "#fff", border: "none", cursor: isExportPending || filtered.length === 0 ? "default" : "pointer" }}
          >
            <FileText style={{ width: 14, height: 14 }} />
            {tx("generatePdf")}
          </button>
          <button
            onClick={exportCSV}
            disabled={isExportPending || filtered.length === 0}
            style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 0", borderRadius: 10, fontSize: 12, fontWeight: 600, background: !isExportPending && filtered.length > 0 ? "#1FB6E1" : "rgba(255,255,255,0.08)", color: isExportPending || filtered.length === 0 ? "rgba(255,255,255,0.3)" : "#fff", border: "none", cursor: isExportPending || filtered.length === 0 ? "default" : "pointer" }}
          >
            <Download style={{ width: 14, height: 14 }} />
            {tx("exportCsv")}
          </button>
        </div>
      </div>

    <div className="p-6 md:p-8 max-w-full space-y-5">
      {/* ── Desktop header (hidden on mobile) ── */}
      <div className="hidden md:flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 max-w-7xl mx-auto">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            {t("reports")}
            {highlightEscala && (
              <span className="ml-3 text-lg font-normal text-primary">
                — {ESCALAS.find(e => e.key === highlightEscala)?.full ?? highlightEscala}
              </span>
            )}
          </h1>
          <p className="text-muted-foreground mt-1">{tx("reportsSubtitle")}</p>
          {user?.isAdmin && (
            <p className="text-xs mt-1 text-primary font-medium">{tx("adminDetails")}</p>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={generatePDF} disabled={isExportPending || filtered.length === 0}>
            <FileText className="mr-2 h-4 w-4" />
            {tx("generatePdf")}
          </Button>
          <Button variant="outline" onClick={exportCSV} disabled={isExportPending || filtered.length === 0}>
            <Download className="mr-2 h-4 w-4" />
            {tx("exportCsv")}
          </Button>
        </div>
      </div>

      {/* Filter Panel */}
      <Card className="border-border shadow-sm max-w-7xl mx-auto">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Filter className="h-4 w-4" />
              {tx("filters")}
              {hasActiveFilters && <Badge className="ml-1 text-xs h-5">{tx("active", { count: activeFilterCount })}</Badge>}
            </CardTitle>
            <div className="flex gap-2">
              <Button size="sm" onClick={applyFollowupFilters} disabled={isFetching}>{tx("apply")}</Button>
              <Button size="sm" variant="outline" onClick={() => { setFilters(EMPTY_FILTERS); setApplied(EMPTY_FILTERS); }}>{tx("clear")}</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">

          {/* ── Consultas ──────────────────────────────────────────────────── */}
          <div className="border border-blue-200 bg-blue-50/50 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 bg-blue-100/60 border-b border-blue-200">
               <span className="text-sm font-medium text-blue-900">{tx("appointments")}</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setAppliedConsultas(consultasFilters)}
                  className="text-xs px-3 py-1 rounded-md bg-blue-700 text-white font-medium hover:bg-blue-800 transition-colors"
                >
                  {tx("apply")}
                </button>
                <button
                  type="button"
                  onClick={() => { setConsultasFilters({ tipo: "", plano: "", periodo: "" }); setAppliedConsultas({ tipo: "", plano: "", periodo: "" }); }}
                  className="text-xs px-3 py-1 rounded-md border border-blue-300 text-blue-700 hover:bg-blue-100 transition-colors"
                >
                  {tx("clear")}
                </button>
              </div>
            </div>
            <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Tipo */}
              <div className="space-y-1">
                 <Label className="text-xs text-muted-foreground">{tx("appointmentType")}</Label>
                <Select value={consultasFilters.tipo} onValueChange={v => setConsultasFilters(f => ({ ...f, tipo: v === "_all" ? "" : v }))}>
                   <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={tx("all")} /></SelectTrigger>
                  <SelectContent>
                     <SelectItem value="_all">{tx("all")}</SelectItem>
                     <SelectItem value="consulta">{tx("consultation")}</SelectItem>
                     <SelectItem value="retorno">{tx("return")}</SelectItem>
                     <SelectItem value="avaliacao">{tx("assessment")}</SelectItem>
                     <SelectItem value="cirurgia">{tx("surgery")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {/* Plano */}
              <div className="space-y-1">
                 <Label className="text-xs text-muted-foreground">{tx("privatePlan")}</Label>
                <Select value={consultasFilters.plano} onValueChange={v => setConsultasFilters(f => ({ ...f, plano: v === "_all" ? "" : v }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={tx("all")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_all">{tx("all")}</SelectItem>
                    <SelectItem value="Particular">Particular</SelectItem>
                    {sortByPtBrName(consultasData?.planos ?? [], (plano) => plano).map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {/* Período */}
              <div className="space-y-1">
                 <Label className="text-xs text-muted-foreground">{tx("period")}</Label>
                <Select value={consultasFilters.periodo} onValueChange={v => setConsultasFilters(f => ({ ...f, periodo: v === "_all" ? "" : v }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={tx("all")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_all">{tx("all")}</SelectItem>
                    <SelectItem value="dia">{tx("today")}</SelectItem>
                    <SelectItem value="semana">{tx("thisWeek")}</SelectItem>
                    <SelectItem value="mes">{tx("thisMonth")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* ── Ortobiológicos ───────────────────────────────────────────── */}
          {(() => {
            const PROD_LABELS: Record<string, string> = {
              PRP: "PRP", LP_PRP: "LP-PRP", LR_PRP: "LR-PRP", PRF: "PRF",
              AH: "Ác. Hialurônico", COLAGENO: "Colágeno", BMAC: "BMA",
              MFAT: "MFAT", NANOFAT: "Nanofat", SVF: "SVF", LISADO: "Lisado",
              SUBCONDROPLASTIA: "Subcondroplastia", HIDROGEL: "Hidrogel",
            };
            return (
              <div className="border border-green-200 bg-green-50/50 rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 bg-green-100/60 border-b border-green-200">
                  <span className="text-sm font-medium text-green-900">{tx("orthobiologics")}</span>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setAppliedRegen(regenFilters)}
                      className="text-xs px-3 py-1 rounded-md bg-green-700 text-white font-medium hover:bg-green-800 transition-colors">
                      {tx("apply")}
                    </button>
                    <button type="button"
                      onClick={() => { setRegenFilters({ produto: "", status: "", dataInicio: "", dataFim: "" }); setAppliedRegen({ produto: "", status: "", dataInicio: "", dataFim: "" }); }}
                      className="text-xs px-3 py-1 rounded-md border border-green-300 text-green-700 hover:bg-green-100 transition-colors">
                      {tx("clear")}
                    </button>
                  </div>
                </div>
                <div className="p-4 space-y-3">
                  {/* Produto pills */}
                  <div>
                    <Label className="text-xs text-muted-foreground block mb-1.5">{tx("product")}</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(PROD_LABELS).map(([code, label]) => {
                        const active = regenFilters.produto === code;
                        return (
                          <button key={code} type="button"
                            onClick={() => setRegenFilters(f => ({ ...f, produto: active ? "" : code }))}
                            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${active ? "bg-green-700 text-white border-green-700" : "bg-background text-muted-foreground border-border hover:border-green-400 hover:text-foreground"}`}>
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {/* Status */}
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">{tx("status")}</Label>
                      <Select value={regenFilters.status} onValueChange={v => setRegenFilters(f => ({ ...f, status: v === "_all" ? "" : v }))}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={tx("all")} /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_all">{tx("all")}</SelectItem>
                          <SelectItem value="draft">{tx("draft")}</SelectItem>
                          <SelectItem value="active">{tx("activeStatus")}</SelectItem>
                          <SelectItem value="closed">{tx("closed")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {/* Data início */}
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">{tx("fromDate")}</Label>
                      <DateInput className="h-8 text-xs" value={regenFilters.dataInicio} onValueChange={(v) => setRegenFilters(f => ({ ...f, dataInicio: v }))} />
                    </div>
                    {/* Data fim */}
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">{tx("toDate")}</Label>
                      <DateInput className="h-8 text-xs" value={regenFilters.dataFim} onValueChange={(v) => setRegenFilters(f => ({ ...f, dataFim: v }))} />
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Follow-up */}
           <FilterSection title={tx("followup")} defaultOpen>
              <FilterSelect label={tx("followupTime")} value={filters.tempo} options={TEMPOS} onChange={v => setFilter("tempo", v)} placeholder={tx("all")} locale={locale} />
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{tx("returnToSport")}</Label>
              <Select value={filters.retornoEsporte} onValueChange={v => setFilter("retornoEsporte", v === "_all" ? "" : v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={tx("all")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">{tx("all")}</SelectItem>
                  <SelectItem value="true">{tx("yesReturned")}</SelectItem>
                  <SelectItem value="false">{tx("noNotReturned")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{tx("treatmentFailure")}</Label>
              <Select value={filters.falha} onValueChange={v => setFilter("falha", v === "_all" ? "" : v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={tx("all")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">{tx("all")}</SelectItem>
                  <SelectItem value="true">{tx("yesWithFailure")}</SelectItem>
                  <SelectItem value="false">{tx("noWithoutFailure")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </FilterSection>

          {/* Cirurgia */}
           <FilterSection title={tx("surgicalData")} defaultOpen>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{tx("region")}</Label>
              <Select value={filters.regiao} onValueChange={v => setFilters(f => ({ ...f, regiao: v === "_all" ? "" : v, tipoCaso: "" }))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={tx("all")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">{tx("all")}</SelectItem>
                  <SelectItem value="shoulder">{tx("shoulder")}</SelectItem>
                  <SelectItem value="elbow">{tx("elbow")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{tx("caseType")}</Label>
              <Select value={filters.tipoCaso} onValueChange={v => setFilter("tipoCaso", v === "_all" ? "" : v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={tx("all")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">{tx("all")}</SelectItem>
                  {CASE_TYPE_OPTIONS.filter(c => !filters.regiao || c.region === filters.regiao).map(c => (
                    <SelectItem key={c.key} value={c.key}>{c.label}{filters.regiao ? "" : ` (${c.region === "shoulder" ? tx("shoulder") : tx("elbow")})`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{tx("hospitalContains")}</Label>
              <Input className="h-8 text-xs" placeholder={tx("hospitalExample")} value={filters.hospital} onChange={e => setFilter("hospital", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{tx("surgeryFrom")}</Label>
              <DateInput className="h-8 text-xs" value={filters.dataInicio} onValueChange={(v) => setFilter("dataInicio", v)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{tx("surgeryTo")}</Label>
              <DateInput className="h-8 text-xs" value={filters.dataFim} onValueChange={(v) => setFilter("dataFim", v)} />
            </div>
          </FilterSection>

          {/* Paciente */}
           <FilterSection title={tx("patientRiskFactors")}>
             <FilterSelect label={tx("sex")} value={filters.sexo} options={["Masculino", "Feminino"]} onChange={v => setFilter("sexo", v)} placeholder={tx("all")} locale={locale} />
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{tx("minimumAge")}</Label>
              <Input type="number" className="h-8 text-xs" placeholder={tx("minimumAgeExample")} min={0} max={100} value={filters.idadeMin} onChange={e => setFilter("idadeMin", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{tx("maximumAge")}</Label>
              <Input type="number" className="h-8 text-xs" placeholder={tx("maximumAgeExample")} min={0} max={100} value={filters.idadeMax} onChange={e => setFilter("idadeMax", e.target.value)} />
            </div>
             <FilterSelect label={tx("operatedSide")} value={filters.lado} options={LADOS} onChange={v => setFilter("lado", v)} placeholder={tx("all")} locale={locale} />
             <FilterSelect label={tx("activityLevel")} value={filters.nivelAtividade} options={NIVEIS_ATIVIDADE} onChange={v => setFilter("nivelAtividade", v)} placeholder={tx("all")} locale={locale} />
          </FilterSection>

          {/* Admin */}
          {user?.isAdmin && (
            <FilterSection title={tx("administrator")}>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{tx("doctor")}</Label>
                <Select value={filters.medicoId} onValueChange={v => setFilter("medicoId", v === "_all" ? "" : v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={tx("allDoctors")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_all">{tx("allDoctors")}</SelectItem>
                    {sortedDoctors.map(d => <SelectItem key={d.id} value={String(d.id)}>{d.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </FilterSection>
          )}
        </CardContent>
      </Card>

      {/* ── Métricas de Consultas ─────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto">
        {consultasLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
          </div>
        ) : consultasData ? (
          <Card className="border-blue-200 shadow-sm bg-blue-50/40">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">{tx("appointments")}</span>
                {(appliedConsultas.tipo || appliedConsultas.plano || appliedConsultas.periodo) && (
                  <span className="text-xs text-blue-500">
                    {[
                      appliedConsultas.periodo === "dia" ? tx("today").toLowerCase() : appliedConsultas.periodo === "semana" ? tx("thisWeek").toLowerCase() : appliedConsultas.periodo === "mes" ? tx("thisMonth").toLowerCase() : "",
                      appliedConsultas.tipo,
                      appliedConsultas.plano,
                    ].filter(Boolean).join(" · ")}
                  </span>
                )}
              </div>
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
                {/* Total */}
                <div className="bg-white rounded-lg border border-blue-200 p-3">
                  <div className="text-xs text-muted-foreground mb-1">{tx("total")}</div>
                  <div className="text-2xl font-bold text-blue-700">{consultasData.total}</div>
                  <div className="text-xs text-muted-foreground">{tx("appointmentsCount")}</div>
                </div>
                {/* Por tipo */}
                <div className="bg-white rounded-lg border border-blue-200 p-3">
                  <div className="text-xs text-muted-foreground mb-1">{tx("byType")}</div>
                  <div className="space-y-0.5">
                    {Object.entries(consultasData.byTipo).length === 0
                      ? <span className="text-xs text-muted-foreground">—</span>
                      : Object.entries(consultasData.byTipo).map(([t, n]) => (
                          <div key={t} className="flex items-center justify-between gap-2">
                            <span className="text-xs capitalize text-foreground">{t}</span>
                            <span className="text-xs font-bold text-blue-700">{n}</span>
                          </div>
                        ))}
                  </div>
                </div>
                {/* Por plano */}
                <div className="bg-white rounded-lg border border-blue-200 p-3">
                  <div className="text-xs text-muted-foreground mb-1">{tx("privatePlan")}</div>
                  <div className="space-y-0.5 max-h-20 overflow-y-auto">
                    {Object.entries(consultasData.byPlano).length === 0
                      ? <span className="text-xs text-muted-foreground">—</span>
                      : Object.entries(consultasData.byPlano)
                          .sort((a, b) => b[1] - a[1])
                          .map(([pl, n]) => (
                            <div key={pl} className="flex items-center justify-between gap-2">
                              <span className="text-xs text-foreground truncate">{pl}</span>
                              <span className="text-xs font-bold text-blue-700">{n}</span>
                            </div>
                          ))}
                  </div>
                </div>
                {/* Por status */}
                <div className="bg-white rounded-lg border border-blue-200 p-3">
                  <div className="text-xs text-muted-foreground mb-1">{tx("byStatus")}</div>
                  <div className="space-y-0.5">
                    {Object.entries(consultasData.byStatus).length === 0
                      ? <span className="text-xs text-muted-foreground">—</span>
                      : Object.entries(consultasData.byStatus)
                          .sort((a, b) => b[1] - a[1])
                          .map(([s, n]) => (
                            <div key={s} className="flex items-center justify-between gap-2">
                              <span className="text-xs capitalize text-foreground">{s}</span>
                              <span className="text-xs font-bold text-blue-700">{n}</span>
                            </div>
                          ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>

      {/* ── Métricas de Ortobiológicos ────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto">
        {regenLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
          </div>
        ) : regenData ? (
          <Card className="border-green-200 shadow-sm bg-green-50/40">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-semibold text-green-700 uppercase tracking-wide">{tx("orthobiologics")}</span>
                {(appliedRegen.produto || appliedRegen.status || appliedRegen.dataInicio || appliedRegen.dataFim) && (
                  <span className="text-xs text-green-600">
                    {[
                      appliedRegen.produto,
                      appliedRegen.status === "draft" ? tx("draft") : appliedRegen.status === "active" ? tx("activeStatus") : appliedRegen.status === "closed" ? tx("closed") : "",
                      appliedRegen.dataInicio ? tx("fromAppliedDate", { date: appliedRegen.dataInicio }) : "",
                      appliedRegen.dataFim ? tx("toAppliedDate", { date: appliedRegen.dataFim }) : "",
                    ].filter(Boolean).join(" · ")}
                  </span>
                )}
              </div>
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
                {/* Total */}
                <div className="bg-white rounded-lg border border-green-200 p-3">
                  <div className="text-xs text-muted-foreground mb-1">{tx("totalCases")}</div>
                  <div className="text-2xl font-bold text-green-700">{regenData.total}</div>
                  <div className="text-xs text-muted-foreground">{tx("orthobiologicsCount")}</div>
                </div>
                {/* Por produto */}
                <div className="bg-white rounded-lg border border-green-200 p-3">
                  <div className="text-xs text-muted-foreground mb-1">{tx("byProduct")}</div>
                  <div className="space-y-0.5 max-h-24 overflow-y-auto">
                    {Object.keys(regenData.byProduct).length === 0
                      ? <span className="text-xs text-muted-foreground">—</span>
                      : Object.entries(regenData.byProduct)
                          .sort((a, b) => b[1] - a[1])
                          .map(([prod, n]) => (
                            <div key={prod} className="flex items-center justify-between gap-2">
                              <span className="text-xs text-foreground">{prod.replace(/_/g, "-")}</span>
                              <span className="text-xs font-bold text-green-700">{n}</span>
                            </div>
                          ))}
                  </div>
                </div>
                {/* Por status */}
                <div className="bg-white rounded-lg border border-green-200 p-3">
                  <div className="text-xs text-muted-foreground mb-1">{tx("byStatus")}</div>
                  <div className="space-y-0.5">
                    {Object.keys(regenData.byStatus).length === 0
                      ? <span className="text-xs text-muted-foreground">—</span>
                      : Object.entries(regenData.byStatus).map(([s, n]) => (
                          <div key={s} className="flex items-center justify-between gap-2">
                            <span className="text-xs text-foreground">{s}</span>
                            <span className="text-xs font-bold text-green-700">{n}</span>
                          </div>
                        ))}
                  </div>
                </div>
                {/* Por condição */}
                <div className="bg-white rounded-lg border border-green-200 p-3">
                  <div className="text-xs text-muted-foreground mb-1">{tx("byCondition")}</div>
                  <div className="space-y-0.5 max-h-24 overflow-y-auto">
                    {Object.keys(regenData.byCondition).length === 0
                      ? <span className="text-xs text-muted-foreground">—</span>
                      : Object.entries(regenData.byCondition)
                          .sort((a, b) => b[1] - a[1])
                          .map(([cond, n]) => (
                            <div key={cond} className="flex items-center justify-between gap-2">
                              <span className="text-xs text-foreground truncate">{cond}</span>
                              <span className="text-xs font-bold text-green-700">{n}</span>
                            </div>
                          ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>

      {/* Summary Cards */}
      <div className="max-w-7xl mx-auto">
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="border-border shadow-sm bg-primary text-primary-foreground">
              <CardContent className="pt-4 pb-4">
                <div className="text-xs text-primary-foreground/70 mb-1">{tx("answeredAssessments")}</div>
                <div className="text-3xl font-bold">{reportCounts.answeredAssessments}</div>
                <div className="text-xs text-primary-foreground/60">
                  {countLabel(reportCounts.recordedFollowups, "recordedFollowupCount", "recordedFollowupsCount")} · {countLabel(reportCounts.surgeries, "surgeryCount", "surgeriesCount")}
                </div>
              </CardContent>
            </Card>
            {[
              { label: tx("averageVas"), val: fmtAvg(avgVas, 1), unit: "/10" },
              { label: tx("averageSane"), val: fmtAvg(avgSane, 0), unit: tx("saneUnit") },
            ].map(c => (
              <Card key={c.label} className="border-border shadow-sm">
                <CardContent className="pt-4 pb-4">
                  <div className="text-xs text-muted-foreground mb-1">{c.label}</div>
                  <div className="text-2xl font-bold text-foreground">{c.val}</div>
                  <div className="text-xs text-muted-foreground">{c.unit}</div>
                </CardContent>
              </Card>
            ))}
            <Card className="border-border shadow-sm">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                  <TrendingUp className="h-3 w-3" /> {tx("returnFailure")}
                </div>
                <div className="text-xl font-bold text-green-600">{taxaRetorno == null ? "—" : `${taxaRetorno.toFixed(0)}%`}</div>
                <div className="text-xs text-red-500">{taxaFalha == null ? "" : tx("failureRate", { rate: taxaFalha.toFixed(0) })}</div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Charts Section */}
      {filtered.length > 0 && (
        <div className="max-w-7xl mx-auto space-y-4">
          <div
            ref={chartsRef}
            className="bg-card rounded-xl border border-border shadow-sm p-6 space-y-6"
            style={{ fontFamily: "system-ui, sans-serif" }}
          >
            {/* PDF Header (only visible when capturing) */}
            <div className="flex items-center justify-between pb-4 border-b border-border">
              <div>
                <h2 className="text-lg font-bold text-[#1A365D]">{tx("graphicalAnalysis")}</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {tx("chartSummary", {
                    followups: countLabel(reportCounts.answeredAssessments, "answeredAssessmentCount", "answeredAssessmentsCount"),
                    surgeries: countLabel(reportCounts.surgeries, "surgeryCount", "surgeriesCount"),
                    periods: countLabel(chartData.length, "periodEvaluated", "periodsEvaluated"),
                  })}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={generatePDF} className="print:hidden">
                <FileText className="mr-1.5 h-3.5 w-3.5" />
                {tx("generatePdf")}
              </Button>
            </div>

            {/* Row 1: Line chart + Pie chart */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Dor média por período */}
              <div className="lg:col-span-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">{tx("averageVasPain")}</p>
                {chartData.some(d => d.vasDor != null) ? (
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={chartData} margin={{ top: 4, right: 16, left: -10, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="tempo" tickFormatter={(value) => reportCatalogLabel(locale, String(value))} tick={{ fontSize: 9 }} angle={-30} textAnchor="end" height={48} />
                      <YAxis domain={[0, 10]} tick={{ fontSize: 9 }} />
                      <Tooltip formatter={(v: any) => [v?.toFixed(1), tx("vasPain")]} labelFormatter={(value) => reportCatalogLabel(locale, String(value))} contentStyle={{ fontSize: 11 }} />
                      <Line type="monotone" dataKey="vasDor" name="VAS" stroke="#EF4444" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[260px] flex items-center justify-center text-xs text-muted-foreground">{tx("noData")}</div>
                )}
              </div>

              {/* Distribuição por tipo de caso */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">{tx("caseTypeDistribution")}</p>
                {caseTypeData.length > 0 ? (
                  <>
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie data={caseTypeData} cx="50%" cy="50%" innerRadius="45%" outerRadius="85%" paddingAngle={caseTypeData.length > 1 ? 1 : 0} dataKey="value" nameKey="name" isAnimationActive={false}>
                          {caseTypeData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v: any) => [v, tx("surgeries")]} contentStyle={{ fontSize: 11 }} />
                      </PieChart>
                    </ResponsiveContainer>
                    <ul className="mt-3 space-y-1.5">
                      {caseTypeData.map((d, i) => (
                        <li key={d.name} className="flex items-start gap-2 text-xs">
                          <span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} aria-hidden="true" />
                          <span className="min-w-0 flex-1 break-words">{d.name}</span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            <strong className="text-foreground">{d.value}</strong>
                            {" · "}{d.percent}%
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-[10px] text-muted-foreground">{tx("caseTypeShareNote")}</p>
                  </>
                ) : (
                  <div className="h-[200px] flex items-center justify-center text-xs text-muted-foreground">{tx("noData")}</div>
                )}
              </div>
            </div>

            {/* Row 2: Return to sport */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 pt-2">
              {/* Return bar chart */}
              {chartData.some(d => d.taxaRetorno != null) && (
                <div className="lg:col-span-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">{tx("returnFailureRate")}</p>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={chartData.filter(d => d.taxaRetorno != null || d.taxaFalha != null)} margin={{ top: 4, right: 16, left: -10, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="tempo" tickFormatter={(value) => reportCatalogLabel(locale, String(value))} tick={{ fontSize: 9 }} angle={-30} textAnchor="end" height={48} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 9 }} unit="%" />
                      <Tooltip formatter={(v: any) => [`${v}%`]} labelFormatter={(value) => reportCatalogLabel(locale, String(value))} contentStyle={{ fontSize: 11 }} />
                      <Legend iconSize={10} wrapperStyle={{ fontSize: 10 }} />
                      <Bar dataKey="taxaRetorno" name={tx("returnPercent")} fill="#10B981" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="taxaFalha" name={tx("failurePercent")} fill="#EF4444" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

            </div>

            {/* Number of cases per period */}
            <div className="pt-2 border-t border-border">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{tx("assessmentsByPeriod")}</p>
              <div className="flex flex-wrap gap-2">
                {chartData.length === 0 && <div className="text-xs text-muted-foreground">{tx("noData")}</div>}
                {chartData.map(d => (
                  <div key={d.tempo} className="bg-muted/40 rounded-lg px-3 py-1.5 text-center">
                    <div className="text-xs text-muted-foreground">{reportCatalogLabel(locale, d.tempo)}</div>
                    <div className="text-lg font-bold text-[#1A365D]">{d.n}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Data Table */}
      <Card className="border-border shadow-sm max-w-7xl mx-auto">
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-semibold text-muted-foreground">
             {tx("clickToOpenRecord", {
               surgeries: countLabel(reportCounts.surgeries, "surgeryCount", "surgeriesCount"),
               followups: countLabel(reportCounts.recordedFollowups, "recordedFollowupCount", "recordedFollowupsCount"),
               assessments: countLabel(reportCounts.answeredAssessments, "answeredAssessmentCount", "answeredAssessmentsCount"),
             })}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">{tx("noSurgeriesForFilters")}</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="whitespace-nowrap text-xs w-8">#</TableHead>
                    <TableHead className="whitespace-nowrap text-xs">{tx("age")}</TableHead>
                    <TableHead className="whitespace-nowrap text-xs">{tx("region")}</TableHead>
                    <TableHead className="whitespace-nowrap text-xs">{tx("caseType")}</TableHead>
                    {user?.isAdmin && <TableHead className="whitespace-nowrap text-xs">{tx("doctor")}</TableHead>}
                    <TableHead className="whitespace-nowrap text-xs">{tx("surgery")}</TableHead>
                    <TableHead className="whitespace-nowrap text-xs">{tx("followupTime")}</TableHead>
                    {ESCALAS.map(e => (
                      <TableHead
                        key={e.key}
                        className={`text-center whitespace-nowrap text-xs ${highlightEscala === e.key ? "bg-primary/10 text-primary font-bold" : ""}`}
                      >
                        {e.label}
                      </TableHead>
                    ))}
                    <TableHead className="text-center whitespace-nowrap text-xs">{tx("returnAbbreviation")}</TableHead>
                    <TableHead className="text-center whitespace-nowrap text-xs">{tx("treatmentFailure")}</TableHead>
                    <TableHead className="text-right whitespace-nowrap text-xs">{tx("actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((row, idx) => (
                    <TableRow key={`${row.surgeryId}-${row.id ?? "none"}-${idx}`} className={`hover:bg-primary/5 group ${!user?.isAdmin ? "cursor-pointer" : ""}`}>
                      <TableCell className="text-xs text-muted-foreground font-mono">{idx + 1}</TableCell>
                      <TableCell
                        className="text-xs whitespace-nowrap"
                        onClick={!user?.isAdmin ? () => window.open(`/surgeries/${row.surgeryId}`, "_blank") : undefined}
                      >
                        <span className="text-muted-foreground">{row.patientSexo?.trim() ? row.patientSexo.trim().charAt(0) : "—"}</span>
                        {row.idade != null && <span className="ml-1">{row.idade}a</span>}
                      </TableCell>
                      <TableCell onClick={!user?.isAdmin ? () => window.open(`/surgeries/${row.surgeryId}`, "_blank") : undefined}>
                        <span className="text-xs">{regionLabel(row.regiao)}</span>
                      </TableCell>
                      <TableCell
                        className="text-xs whitespace-nowrap text-muted-foreground"
                        onClick={!user?.isAdmin ? () => window.open(`/surgeries/${row.surgeryId}`, "_blank") : undefined}
                      >
                        <div className="flex flex-wrap gap-1">
                          {row.tiposProcedimento.map(k => <Badge key={k} className="text-xs bg-primary/10 text-primary border-0">{caseTypeLabel(k)}</Badge>)}
                        </div>
                      </TableCell>
                      {user?.isAdmin && (
                        <TableCell
                          className="text-xs whitespace-nowrap"
                          onClick={!user?.isAdmin ? () => window.open(`/surgeries/${row.surgeryId}`, "_blank") : undefined}
                        >{row.doctorNome ?? "—"}</TableCell>
                      )}
                      <TableCell
                        className="text-xs text-muted-foreground whitespace-nowrap"
                        onClick={!user?.isAdmin ? () => window.open(`/surgeries/${row.surgeryId}`, "_blank") : undefined}
                      >{formatDateOnly(row.dataCirurgia, locale, undefined, row.dataCirurgia ?? "—")}</TableCell>
                      <TableCell onClick={!user?.isAdmin ? () => window.open(`/surgeries/${row.surgeryId}`, "_blank") : undefined}>
                        {row.tempo
                          ? <Badge variant="secondary" className="text-xs">{reportCatalogLabel(locale, row.tempo)}</Badge>
                          : <span className="text-xs text-muted-foreground/40">—</span>}
                      </TableCell>
                      {ESCALAS.map(e => (
                        <TableCell
                          key={e.key}
                          className={`text-center ${highlightEscala === e.key ? "bg-primary/5 font-semibold" : ""}`}
                          onClick={!user?.isAdmin ? () => window.open(`/surgeries/${row.surgeryId}`, "_blank") : undefined}
                        >
                          {scoreCell((row as any)[e.key], e.max, e.invert)}
                        </TableCell>
                      ))}
                      <TableCell className="text-center" onClick={!user?.isAdmin ? () => window.open(`/surgeries/${row.surgeryId}`, "_blank") : undefined}>
                        {row.retornoEsporte == null ? <span className="text-muted-foreground/40 text-xs">—</span>
                          : row.retornoEsporte ? <CheckCircle className="h-4 w-4 text-green-600 mx-auto" />
                          : <XCircle className="h-4 w-4 text-red-500 mx-auto" />}
                      </TableCell>
                      <TableCell className="text-center" onClick={!user?.isAdmin ? () => window.open(`/surgeries/${row.surgeryId}`, "_blank") : undefined}>
                        {row.falha == null ? <span className="text-muted-foreground/40 text-xs">—</span>
                          : row.falha ? <Badge variant="destructive" className="text-xs">{tx("yes")}</Badge>
                          : <span className="text-xs text-muted-foreground">{tx("no")}</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-1 justify-end">
                          {!user?.isAdmin && (
                            <Button
                              size="sm" variant="ghost"
                              onClick={!user?.isAdmin ? () => window.open(`/surgeries/${row.surgeryId}`, "_blank") : undefined}
                              className="h-7 text-xs text-primary opacity-0 group-hover:opacity-100 transition-opacity"
                              title={tx("openRecord")}
                            >
                              <ExternalLink className="h-3 w-3 mr-1" />{tx("record")}
                            </Button>
                          )}
                          {!user?.isAdmin && (
                            <Button size="sm" variant="ghost" onClick={() => openEdit(row)} className="h-7 text-xs">
                              <Pencil className="h-3 w-3 mr-1" />{row.id == null ? tx("add") : tx("edit")}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Scales Dialog */}
      <Dialog open={!!editRow} onOpenChange={open => !open && setEditRow(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{tx("editScales")}</DialogTitle>
            <DialogDescription>
              {user?.isAdmin ? tx("surgeryId", { id: editRow?.surgeryId ?? "" }) : editRow?.patientNome}
              {editRow?.tempo ? tx("followupOf", { time: reportCatalogLabel(locale, editRow.tempo) }) : tx("newAssessment")}
            </DialogDescription>
          </DialogHeader>

          {/* Surgery context info */}
          {editRow && (
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs space-y-2">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                <div>
                  <span className="text-muted-foreground">{tx("patient")}: </span>
                  <span className="font-medium">{user?.isAdmin ? tx("anonymous") : (editRow.patientNome ?? "—")}</span>
                  {editRow.patientSexo && <span className="text-muted-foreground ml-1">({reportCatalogLabel(locale, editRow.patientSexo)})</span>}
                  {editRow.idade != null && <span className="text-muted-foreground">, {tx("ageYears", { age: editRow.idade })}</span>}
                </div>
                <div>
                  <span className="text-muted-foreground">{tx("side")} </span>
                  <span className="font-medium">{editRow.patientLado ? reportCatalogLabel(locale, editRow.patientLado) : "—"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{tx("surgeryDate")} </span>
                  <span className="font-medium">{formatDateOnly(editRow.dataCirurgia, locale, undefined, editRow.dataCirurgia ?? "—")}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{tx("hospital")} </span>
                  <span className="font-medium">{editRow.hospital ?? "—"}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">{tx("type")} </span>
                  <span className="font-medium">{(editRow.tiposProcedimento ?? []).map(caseTypeLabel).join(", ") || "—"}</span>
                </div>
                {editRow.diagnostico && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground">{tx("csvDiagnosis")}: </span>
                    <span className="font-medium">{editRow.diagnostico}</span>
                  </div>
                )}
                {editRow.patientNivelAtividade && (
                  <div>
                    <span className="text-muted-foreground">{tx("activity")} </span>
                    <span className="font-medium">{reportCatalogLabel(locale, editRow.patientNivelAtividade)}</span>
                  </div>
                )}
                {editRow.patientBeighton != null && (
                  <div>
                    <span className="text-muted-foreground">{tx("beighton")} </span>
                    <span className="font-medium">{editRow.patientBeighton}/9</span>
                    {editRow.patientBeighton >= 4 && <Badge variant="outline" className="ml-1 text-xs h-4 px-1.5 border-amber-400 text-amber-600">{tx("hyperlaxity")}</Badge>}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="space-y-5 pt-2">
            {editRow?.id == null && (
              <div className="space-y-1">
                <Label className="text-sm font-medium">{tx("followupPeriod")} <span className="text-red-500">*</span></Label>
                <Select value={sf.tempo} onValueChange={v => setSf("tempo", v)}>
                  <SelectTrigger><SelectValue placeholder={tx("selectPeriod")} /></SelectTrigger>
                  <SelectContent>
                    {TEMPOS.map(t => (
                      <SelectItem key={t} value={t}>{reportCatalogLabel(locale, t)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-sm font-medium">{tx("assessmentDate")}</Label>
              <DateInput value={sf.dataAvaliacao} onValueChange={(v) => setSf("dataAvaliacao", v)} />
            </div>

            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">{tx("mainScales")}</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">{tx("vasPain")} <span className="opacity-50">/10</span></Label>
                  <Input type="number" min={0} max={10} step={1} value={sf.vasDor} onChange={e => setSf("vasDor", e.target.value)} placeholder="—" className="h-8" />
                </div>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">{tx("returnToSport")}</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">{tx("returned")}</Label>
                  <Select value={sf.retornoEsporte} onValueChange={v => setSf("retornoEsporte", v)}>
                    <SelectTrigger className="h-8"><SelectValue placeholder={tx("notInformed")} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">{tx("notInformed")}</SelectItem>
                      <SelectItem value="sim">{tx("yes")}</SelectItem>
                      <SelectItem value="nao">{tx("no")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">{tx("returnLevel")}</Label>
                  <Select value={sf.nivelRetorno} onValueChange={v => setSf("nivelRetorno", v)}>
                    <SelectTrigger className="h-8"><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">—</SelectItem>
                      <SelectItem value="mesmo nível">{reportCatalogLabel(locale, "mesmo nível")}</SelectItem>
                      <SelectItem value="nível inferior">{reportCatalogLabel(locale, "nível inferior")}</SelectItem>
                      <SelectItem value="esporte recreacional">{reportCatalogLabel(locale, "esporte recreacional")}</SelectItem>
                      <SelectItem value="sem esporte">{reportCatalogLabel(locale, "sem esporte")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">{tx("treatmentFailure")}</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">{tx("hadFailure")}</Label>
                  <Select value={sf.falha} onValueChange={v => setSf("falha", v)}>
                    <SelectTrigger className="h-8"><SelectValue placeholder={tx("notInformed")} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">{tx("notInformed")}</SelectItem>
                      <SelectItem value="nao">{tx("no")}</SelectItem>
                      <SelectItem value="sim">{tx("yes")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {sf.falha === "sim" && (
                  <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">{tx("failureType")}</Label>
                    <Select value={sf.falhaType} onValueChange={v => setSf("falhaType", v)}>
                      <SelectTrigger className="h-8"><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">—</SelectItem>
                        <SelectItem value="Instabilidade residual">{reportCatalogLabel(locale, "Instabilidade residual")}</SelectItem>
                        <SelectItem value="Rigidez articular">{reportCatalogLabel(locale, "Rigidez articular")}</SelectItem>
                        <SelectItem value="Infecção">{reportCatalogLabel(locale, "Infecção")}</SelectItem>
                        <SelectItem value="Outra">{reportCatalogLabel(locale, "Outra")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{tx("notes")}</Label>
              <textarea
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[70px] resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder={tx("clinicalNotes")}
                value={sf.observacoes}
                onChange={e => setSf("observacoes", e.target.value)}
              />
            </div>

            <div className="flex justify-end gap-3 pt-1">
              <Button variant="outline" onClick={() => setEditRow(null)}>{tx("cancel")}</Button>
              <Button onClick={saveScores} disabled={updateMut.isPending}>
                {updateMut.isPending ? tx("saving") : tx("saveScales")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
    </div>
  );
}
