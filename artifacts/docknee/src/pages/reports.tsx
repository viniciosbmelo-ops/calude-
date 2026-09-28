import { useState, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { operationalCoreMessages } from "@/locales/operational-core";
import { reportingDashboardMessages } from "@/locales/reporting-dashboard";
import { reportCatalogLabel, reportCatalogOptions } from "@/locales/reporting-catalogs";
import { documentText } from "@/locales/document-locales";
import { sortByPtBrName } from "@/lib/utils";
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

// ─── Constants ───────────────────────────────────────────────────────────────
const TIPOS_PROCEDIMENTO = ["Lesão Ligamentar", "Lesão Meniscal", "Instabilidade Patelar", "Osteotomia", "Lesões Osteocondrais", "Artroplastias", "Ortobiológicos"];
const LIGAMENTOS = ["LCA", "LCP", "CPL", "CPM", "LOA"];
const TEMPOS = ["3 meses", "6 meses", "12 meses", "24 meses", "36 meses", "48 meses", "60 meses"];
const ENXERTOS = [
  "Tendão Patelar (BTB)",
  "Isquiotibiais (Grácil + Semitendíneo)",
  "Tendão Quadricipital",
  "Tendão do Reto Femoral",
  "Grácil",
  "Semitendíneo",
  "Fibular Longo",
  "Hemifibular",
  "Aloenxerto",
  "Ligamento Sintético (LARS)",
  "Outro",
];
const DIAMETROS = ["7mm", "7,5mm", "8mm", "8,5mm", "9mm", "9,5mm", "10mm", "10,5mm", "11mm", "Outro"];
const FIXACOES_FEMORAIS = ["Endobutton", "Parafuso bioabsorvível", "Parafuso metálico", "Âncora de sutura", "Endoboton Ajustável", "Poste", "Outro"];
const FIXACOES_TIBIAIS = ["Parafuso bioabsorvível", "Parafuso metálico", "Poste", "Cortical fixation", "Endoboton Ajustável", "Âncora de sutura", "Outro"];
const ALINHAMENTOS = ["Neutro", "Varo", "Valgo", "Recurvatum"];
const REFORCOS = ["LET (Ligamento Extra-articular Tecidual)", "ALL (Ligamento Anterolateral)", "Ligamento Oblíquo Anterior (LOA)", "Tenodese de MacIntosh"];
const PROCEDIMENTOS_MENISCAIS = ["Meniscectomia parcial", "Sutura meniscal", "Implante de raiz meniscal", "Aloenxerto meniscal"];
const NIVEIS_ATIVIDADE = ["Sedentário", "Recreacional", "Amador", "Semi-profissional", "Profissional"];
const LADOS = ["Direito", "Esquerdo"];

const ESCALAS = [
  { key: "ikdc", label: "IKDC", full: "IKDC Subjetivo", max: 100 },
  { key: "lysholm", label: "Lysholm", full: "Lysholm", max: 100 },
  { key: "tegner", label: "Tegner", full: "Tegner", max: 10 },
  { key: "kujala", label: "Kujala", full: "Kujala", max: 100 },
  { key: "vasDor", label: "VAS", full: "VAS Dor", max: 10, invert: true },
  { key: "aclRsi", label: "ACL-RSI", full: "ACL-RSI Retorno Esporte", max: 100 },
  { key: "marx", label: "Marx", full: "Marx Atividade", max: 16 },
  { key: "koos12", label: "KOOS-12", full: "KOOS-12 (versão abreviada)", max: 100 },
];

// ─── Types ────────────────────────────────────────────────────────────────────
interface FollowupRecord {
  id: number | null; surgeryId: number; tempo: string | null; dataAvaliacao: string | null;
  ikdc: number | null; lysholm: number | null; tegner: number | null; kujala: number | null;
  vasDor: number | null; aclRsi: number | null; marx: number | null;
  koos12: number | null;
  retornoEsporte: boolean | null; nivelRetorno: string | null;
  falha: boolean | null; falhaType: string | null; observacoes: string | null;
  dataCirurgia: string | null; hospital: string | null;
  tiposProcedimento: string[]; ligamentosAcometidos: string[];
  enxerto: string | null; diametroEnxerto: string | null;
  fixacaoFemoral: string | null; fixacaoTibial: string | null;
  alinhamento: string | null; reforco: string | null; procedimentoRealizado: string | null;
  surgeryDoctorId: number;
  patientNome: string | null; patientSexo: string | null; patientLado: string | null;
  patientNivelAtividade: string | null; patientEsportePivot: boolean;
  patientBeighton: number | null; idade: number | null;
  doctorNome: string | null;
}

interface ScoreForm {
  tempo: string;
  ikdc: string; lysholm: string; tegner: string; kujala: string; vasDor: string;
  aclRsi: string; marx: string;
  koos12: string;
  retornoEsporte: string; nivelRetorno: string; falha: string; falhaType: string;
  observacoes: string; dataAvaliacao: string;
}

type FilterState = {
  // Follow-up
  tempo: string;
  retornoEsporte: string;
  falha: string;
  // Surgery
  tipoCaso: string;
  ligamentos: string[];
  dataInicio: string;
  dataFim: string;
  hospital: string;
  alinhamento: string;
  reforco: string;
  procedimento: string;
  // Technique
  enxerto: string;
  diametroEnxerto: string;
  fixacaoFemoral: string;
  fixacaoTibial: string;
  // Patient
  sexo: string;
  nivelAtividade: string;
  esportePivot: string;
  lado: string;
  idadeMin: string;
  idadeMax: string;
  // Admin
  medicoId: string;
};

const EMPTY_FILTERS: FilterState = {
  tempo: "", retornoEsporte: "", falha: "",
  tipoCaso: "", ligamentos: [], dataInicio: "", dataFim: "", hospital: "", alinhamento: "", reforco: "", procedimento: "",
  enxerto: "", diametroEnxerto: "", fixacaoFemoral: "", fixacaoTibial: "",
  sexo: "", nivelAtividade: "", esportePivot: "", lado: "", idadeMin: "", idadeMax: "",
  medicoId: "",
};

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
    ikdc: "", lysholm: "", tegner: "", kujala: "", vasDor: "", aclRsi: "", marx: "",
    koos12: "",
    retornoEsporte: "", nivelRetorno: "", falha: "", falhaType: "", observacoes: "", dataAvaliacao: "",
  });

  // When URL escala changes, pre-open edit for that scale (just store for highlight)
  const highlightEscala = urlEscala;

  const setFilter = (k: keyof FilterState, v: string) => setFilters(f => ({ ...f, [k]: v }));
  const toggleLigamento = (lig: string) => setFilters(f => ({
    ...f,
    ligamentos: f.ligamentos.includes(lig)
      ? f.ligamentos.filter(l => l !== lig)
      : [...f.ligamentos, lig],
  }));

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

  const filtered = useMemo(() => records, [records]);
  const isExportPending = isLoading || isFetching;

  const chartsRef = useRef<HTMLDivElement>(null);

  const applyFollowupFilters = () => {
    setApplied({
      ...filters,
      ligamentos: [...filters.ligamentos],
    });
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
    for (const r of filtered) {
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
          ikdc: avg(recs.map(r => r.ikdc)) != null ? parseFloat(avg(recs.map(r => r.ikdc))!.toFixed(1)) : null,
          lysholm: avg(recs.map(r => r.lysholm)) != null ? parseFloat(avg(recs.map(r => r.lysholm))!.toFixed(1)) : null,
          tegner: avg(recs.map(r => r.tegner)) != null ? parseFloat(avg(recs.map(r => r.tegner))!.toFixed(2)) : null,
          vasDor: avg(recs.map(r => r.vasDor)) != null ? parseFloat(avg(recs.map(r => r.vasDor))!.toFixed(1)) : null,
          aclRsi: avg(recs.map(r => r.aclRsi)) != null ? parseFloat(avg(recs.map(r => r.aclRsi))!.toFixed(1)) : null,
          koos12: avg(recs.map(r => (r as any).koos12)) != null ? parseFloat(avg(recs.map(r => (r as any).koos12))!.toFixed(1)) : null,
          taxaRetorno: retRecs.length > 0
            ? parseFloat((retRecs.filter(r => r.retornoEsporte).length / retRecs.length * 100).toFixed(0))
            : null,
          taxaFalha: recs.length > 0
            ? parseFloat((recs.filter(r => r.falha).length / recs.length * 100).toFixed(0))
            : null,
        };
      });
  }, [filtered]);

  const ligamentData = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of filtered) {
      for (const l of r.ligamentosAcometidos) {
        counts.set(l, (counts.get(l) ?? 0) + 1);
      }
    }
    return [...counts.entries()].map(([name, value]) => ({ name, value }));
  }, [filtered]);

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
      pdf.text(`${documentText(locale, "generatedOn")} ${formatDate(new Date())} · ${filtered.length} ${documentText(locale, "followups")} · ${new Set(filtered.map(r => r.surgeryId)).size} ${documentText(locale, "surgeries")}`, 10, 18);
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
        `relatorio_docknee_${new Date().toISOString().slice(0, 10)}.pdf`,
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
      ikdc: row.ikdc?.toString() ?? "", lysholm: row.lysholm?.toString() ?? "",
      tegner: row.tegner?.toString() ?? "", kujala: row.kujala?.toString() ?? "",
      vasDor: row.vasDor?.toString() ?? "", aclRsi: row.aclRsi?.toString() ?? "",
      marx: row.marx?.toString() ?? "", koos12: (row as any).koos12?.toString() ?? "",
      retornoEsporte: row.retornoEsporte == null ? "" : row.retornoEsporte ? "sim" : "nao",
      nivelRetorno: row.nivelRetorno ?? "", falha: row.falha == null ? "" : row.falha ? "sim" : "nao",
      falhaType: row.falhaType ?? "", observacoes: row.observacoes ?? "", dataAvaliacao: row.dataAvaliacao ?? "",
    });
  };

  const saveScores = () => {
    if (!editRow) return;
    const n = (s: string) => s === "" ? null : parseFloat(s);
    const ni = (s: string) => s === "" ? null : parseInt(s);
    const b = (s: string) => s === "" ? null : s === "sim";
    updateMut.mutate({ id: editRow.id, surgeryId: editRow.surgeryId, data: {
      tempo: scoreForm.tempo || "Pré-operatório",
      ikdc: n(scoreForm.ikdc), lysholm: ni(scoreForm.lysholm), tegner: ni(scoreForm.tegner),
      kujala: ni(scoreForm.kujala), vasDor: ni(scoreForm.vasDor),
      aclRsi: n(scoreForm.aclRsi), marx: ni(scoreForm.marx),
      koos12: n(scoreForm.koos12),
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
    const headers = [isAdminExport ? tx("csvSurgeryId") : tx("csvPatient"), tx("csvSex"), tx("csvAge"), tx("csvSide"), tx("csvActivityLevel"), tx("csvPivotSport"),
      tx("csvDoctor"), tx("csvType"), tx("csvLigament"), tx("csvHospital"), tx("csvAlignment"), tx("csvGraft"), tx("csvDiameter"), tx("csvFemoralFixation"), tx("csvTibialFixation"), tx("csvReinforcement"),
      tx("csvSurgeryDate"), tx("csvFollowupTime"), tx("csvAssessmentDate"),
      "IKDC", "Lysholm", "Tegner", "Kujala", tx("csvVasPain"), "ACL-RSI", "Marx",
      "KOOS-12",
      tx("csvReturnSport"), tx("csvReturnLevel"), tx("csvFailure"), tx("csvFailureType")];
    const rows = filtered.map(r => [
      isAdminExport ? tx("surgeryId", { id: r.surgeryId }) : (r.patientNome ?? ""), r.patientSexo ?? "", r.idade ?? "", r.patientLado ?? "",
      r.patientNivelAtividade ?? "", r.patientEsportePivot ? documentText(locale, "yes") : documentText(locale, "no"),
      r.doctorNome ?? "", r.tiposProcedimento.join("; "), r.ligamentosAcometidos.join("; "),
      r.hospital ?? "", r.alinhamento ?? "", r.enxerto ?? "", r.diametroEnxerto ?? "",
      r.fixacaoFemoral ?? "", r.fixacaoTibial ?? "", r.reforco ?? "",
      r.dataCirurgia ?? "", r.tempo, r.dataAvaliacao ?? "",
      r.ikdc ?? "", r.lysholm ?? "", r.tegner ?? "", r.kujala ?? "", r.vasDor ?? "", r.aclRsi ?? "", r.marx ?? "",
      (r as any).koos12 ?? "",
      r.retornoEsporte == null ? "" : r.retornoEsporte ? documentText(locale, "yes") : documentText(locale, "no"),
      r.nivelRetorno ?? "", r.falha == null ? "" : r.falha ? documentText(locale, "yes") : documentText(locale, "no"), r.falhaType ?? "",
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "relatorio_docknee.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  // Summary stats
  const avgIkdc = avg(filtered.map(r => r.ikdc));
  const avgLysholm = avg(filtered.map(r => r.lysholm));
  const avgTegner = avg(filtered.map(r => r.tegner));
  const avgVas = avg(filtered.map(r => r.vasDor));
  const withRetorno = filtered.filter(r => r.retornoEsporte != null);
  const taxaRetorno = withRetorno.length > 0 ? (withRetorno.filter(r => r.retornoEsporte).length / withRetorno.length * 100) : null;
  const taxaFalha = filtered.length > 0 ? (filtered.filter(r => r.falha).length / filtered.length * 100) : null;

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
            disabled={isExportPending || filtered.length === 0 || chartData.length === 0}
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
          <Button variant="outline" onClick={generatePDF} disabled={isExportPending || filtered.length === 0 || chartData.length === 0}>
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
                      <Input type="date" className="h-8 text-xs" value={regenFilters.dataInicio} onChange={e => setRegenFilters(f => ({ ...f, dataInicio: e.target.value }))} />
                    </div>
                    {/* Data fim */}
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">{tx("toDate")}</Label>
                      <Input type="date" className="h-8 text-xs" value={regenFilters.dataFim} onChange={e => setRegenFilters(f => ({ ...f, dataFim: e.target.value }))} />
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
              <FilterSelect label={tx("caseType")} value={filters.tipoCaso} options={TIPOS_PROCEDIMENTO} onChange={v => setFilter("tipoCaso", v)} placeholder={tx("all")} locale={locale} />
            <div className="space-y-1 sm:col-span-2 lg:col-span-2">
              <Label className="text-xs text-muted-foreground">{tx("affectedLigaments")}</Label>
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {LIGAMENTOS.map(lig => {
                  const active = filters.ligamentos.includes(lig);
                  return (
                    <button
                      key={lig}
                      type="button"
                      onClick={() => toggleLigamento(lig)}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                        active
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
                      }`}
                    >
                      {lig}
                    </button>
                  );
                })}
                {filters.ligamentos.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setFilters(f => ({ ...f, ligamentos: [] }))}
                    className="text-xs px-2 py-1 text-muted-foreground hover:text-destructive"
                  >
                    {tx("clear")}
                  </button>
                )}
              </div>
            </div>
             <FilterSelect label={tx("frontalAlignment")} value={filters.alinhamento} options={ALINHAMENTOS} onChange={v => setFilter("alinhamento", v)} placeholder={tx("all")} locale={locale} />
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{tx("hospitalContains")}</Label>
              <Input className="h-8 text-xs" placeholder={tx("hospitalExample")} value={filters.hospital} onChange={e => setFilter("hospital", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{tx("meniscalProcedure")}</Label>
              <Select value={filters.procedimento} onValueChange={v => setFilter("procedimento", v === "_all" ? "" : v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={tx("all")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">{tx("all")}</SelectItem>
                  {reportCatalogOptions(locale, PROCEDIMENTOS_MENISCAIS).map(({ value, label }) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{tx("extraArticularReinforcement")}</Label>
              <Select value={filters.reforco} onValueChange={v => setFilter("reforco", v === "_all" ? "" : v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={tx("all")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">{tx("all")}</SelectItem>
                  {reportCatalogOptions(locale, REFORCOS).map(({ value, label }) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{tx("surgeryFrom")}</Label>
              <Input type="date" className="h-8 text-xs" value={filters.dataInicio} onChange={e => setFilter("dataInicio", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{tx("surgeryTo")}</Label>
              <Input type="date" className="h-8 text-xs" value={filters.dataFim} onChange={e => setFilter("dataFim", e.target.value)} />
            </div>
          </FilterSection>

          {/* Técnica */}
           <FilterSection title={tx("surgicalTechnique")}>
              <FilterSelect label={tx("graftType")} value={filters.enxerto} options={ENXERTOS} onChange={v => setFilter("enxerto", v)} placeholder={tx("all")} locale={locale} />
              <FilterSelect label={tx("graftDiameter")} value={filters.diametroEnxerto} options={DIAMETROS} onChange={v => setFilter("diametroEnxerto", v)} placeholder={tx("all")} locale={locale} />
              <FilterSelect label={tx("femoralFixation")} value={filters.fixacaoFemoral} options={FIXACOES_FEMORAIS} onChange={v => setFilter("fixacaoFemoral", v)} placeholder={tx("all")} locale={locale} />
              <FilterSelect label={tx("tibialFixation")} value={filters.fixacaoTibial} options={FIXACOES_TIBIAIS} onChange={v => setFilter("fixacaoTibial", v)} placeholder={tx("all")} locale={locale} />
          </FilterSection>

          {/* Paciente / Fatores de risco */}
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
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{tx("pivotSport")}</Label>
              <Select value={filters.esportePivot} onValueChange={v => setFilter("esportePivot", v === "_all" ? "" : v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={tx("all")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">{tx("all")}</SelectItem>
                  <SelectItem value="true">{tx("yesPivotSport")}</SelectItem>
                  <SelectItem value="false">{tx("no")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
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
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Card className="border-border shadow-sm bg-primary text-primary-foreground">
              <CardContent className="pt-4 pb-4">
                <div className="text-xs text-primary-foreground/70 mb-1">{tx("followups")}</div>
                <div className="text-3xl font-bold">{filtered.length}</div>
                <div className="text-xs text-primary-foreground/60">{new Set(filtered.map(r => r.surgeryId)).size} {tx("surgeries")}</div>
              </CardContent>
            </Card>
            {[
              { label: tx("averageIkdc"), val: fmtAvg(avgIkdc), unit: "/100" },
              { label: tx("averageLysholm"), val: fmtAvg(avgLysholm, 0), unit: "/100" },
              { label: tx("averageTegner"), val: fmtAvg(avgTegner), unit: "/10" },
              { label: tx("averageVas"), val: fmtAvg(avgVas, 1), unit: "/10" },
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
      {filtered.length > 0 && chartData.length > 0 && (
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
                  {tx("chartSummary", { followups: filtered.length, surgeries: new Set(filtered.map(r => r.surgeryId)).size, periods: chartData.length })}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={generatePDF} className="print:hidden">
                <FileText className="mr-1.5 h-3.5 w-3.5" />
                {tx("generatePdf")}
              </Button>
            </div>

            {/* Row 1: Line chart + Pie chart */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Evolution Line Chart */}
              <div className="lg:col-span-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">{tx("scalesEvolution")}</p>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={chartData} margin={{ top: 4, right: 16, left: -10, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="tempo" tickFormatter={(value) => reportCatalogLabel(locale, String(value))} tick={{ fontSize: 9 }} angle={-30} textAnchor="end" height={48} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 9 }} />
                    <Tooltip
                      formatter={(val: any, name: string) => [val != null ? val.toFixed(1) : "—", name]}
                      labelFormatter={(value) => reportCatalogLabel(locale, String(value))}
                      labelStyle={{ fontSize: 11, fontWeight: 600 }}
                      contentStyle={{ fontSize: 11 }}
                    />
                    <Legend iconSize={10} wrapperStyle={{ fontSize: 10 }} />
                    {chartData.some(d => d.ikdc != null) && (
                      <Line type="monotone" dataKey="ikdc" name="IKDC" stroke="#1A365D" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                    )}
                    {chartData.some(d => d.lysholm != null) && (
                      <Line type="monotone" dataKey="lysholm" name="Lysholm" stroke="#1FB6E1" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                    )}
                    {chartData.some(d => d.aclRsi != null) && (
                      <Line type="monotone" dataKey="aclRsi" name="ACL-RSI" stroke="#10B981" strokeWidth={2} strokeDasharray="4 2" dot={{ r: 3 }} connectNulls />
                    )}
                    {chartData.some(d => (d as any).koos12 != null) && (
                      <Line type="monotone" dataKey="koos12" name="KOOS-12" stroke="#8B5CF6" strokeWidth={2} strokeDasharray="2 2" dot={{ r: 3 }} connectNulls />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Ligament Pie Chart */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">{tx("ligamentDistribution")}</p>
                {ligamentData.length > 0 ? (
                  <>
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie data={ligamentData} cx="50%" cy="50%" outerRadius={70} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                          {ligamentData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v: any) => [v, tx("surgeries")]} contentStyle={{ fontSize: 11 }} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex flex-wrap gap-2 justify-center mt-2">
                      {ligamentData.map((d, i) => (
                        <div key={d.name} className="flex items-center gap-1.5 text-xs">
                          <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                          <span>{d.name}: <strong>{d.value}</strong></span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="h-[200px] flex items-center justify-center text-xs text-muted-foreground">{tx("noData")}</div>
                )}
              </div>
            </div>

            {/* Row 2: Return to sport + VAS + Tegner */}
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

              {/* VAS + Tegner mini charts */}
              <div className="space-y-4">
                {chartData.some(d => d.vasDor != null) && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{tx("averageVasPain")}</p>
                    <ResponsiveContainer width="100%" height={90}>
                      <LineChart data={chartData} margin={{ top: 2, right: 8, left: -20, bottom: 2 }}>
                        <XAxis dataKey="tempo" tickFormatter={(value) => reportCatalogLabel(locale, String(value))} tick={{ fontSize: 8 }} angle={-30} textAnchor="end" height={36} />
                        <YAxis domain={[0, 10]} tick={{ fontSize: 8 }} />
                        <Tooltip formatter={(v: any) => [v?.toFixed(1), tx("vasPain")]} labelFormatter={(value) => reportCatalogLabel(locale, String(value))} contentStyle={{ fontSize: 10 }} />
                        <Line type="monotone" dataKey="vasDor" name="VAS" stroke="#EF4444" strokeWidth={2} dot={{ r: 2 }} connectNulls />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
                {chartData.some(d => d.tegner != null) && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{tx("averageTegnerScore")}</p>
                    <ResponsiveContainer width="100%" height={90}>
                      <LineChart data={chartData} margin={{ top: 2, right: 8, left: -20, bottom: 2 }}>
                        <XAxis dataKey="tempo" tickFormatter={(value) => reportCatalogLabel(locale, String(value))} tick={{ fontSize: 8 }} angle={-30} textAnchor="end" height={36} />
                        <YAxis domain={[0, 10]} tick={{ fontSize: 8 }} />
                        <Tooltip formatter={(v: any) => [v?.toFixed(1), "Tegner"]} labelFormatter={(value) => reportCatalogLabel(locale, String(value))} contentStyle={{ fontSize: 10 }} />
                        <Line type="monotone" dataKey="tegner" name="Tegner" stroke="#F59E0B" strokeWidth={2} dot={{ r: 2 }} connectNulls />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>

            {/* Number of cases per period */}
            <div className="pt-2 border-t border-border">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{tx("assessmentsByPeriod")}</p>
              <div className="flex flex-wrap gap-2">
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
             {tx("clickToOpenRecord", { surgeries: new Set(filtered.map(r => r.surgeryId)).size, assessments: filtered.filter(r => r.id != null).length })}
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
                    <TableHead className="whitespace-nowrap text-xs">{tx("ligament")}</TableHead>
                    <TableHead className="whitespace-nowrap text-xs">{tx("graft")}</TableHead>
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
                        <span className="text-muted-foreground">{row.patientSexo?.charAt(0) ?? "?"}</span>
                        {row.idade != null && <span className="ml-1">{row.idade}a</span>}
                      </TableCell>
                      <TableCell onClick={!user?.isAdmin ? () => window.open(`/surgeries/${row.surgeryId}`, "_blank") : undefined}>
                        <div className="flex flex-wrap gap-1">
                          {row.ligamentosAcometidos.map(l => <Badge key={l} className="text-xs bg-primary/10 text-primary border-0">{l}</Badge>)}
                        </div>
                      </TableCell>
                      <TableCell
                        className="text-xs whitespace-nowrap text-muted-foreground"
                        onClick={!user?.isAdmin ? () => window.open(`/surgeries/${row.surgeryId}`, "_blank") : undefined}
                      >{row.enxerto ? reportCatalogLabel(locale, row.enxerto) : "—"}</TableCell>
                      {user?.isAdmin && (
                        <TableCell
                          className="text-xs whitespace-nowrap"
                          onClick={!user?.isAdmin ? () => window.open(`/surgeries/${row.surgeryId}`, "_blank") : undefined}
                        >{row.doctorNome ?? "—"}</TableCell>
                      )}
                      <TableCell
                        className="text-xs text-muted-foreground whitespace-nowrap"
                        onClick={!user?.isAdmin ? () => window.open(`/surgeries/${row.surgeryId}`, "_blank") : undefined}
                      >{row.dataCirurgia ?? "—"}</TableCell>
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
                  <span className="font-medium">{editRow.dataCirurgia ?? "—"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{tx("hospital")} </span>
                  <span className="font-medium">{editRow.hospital ?? "—"}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">{tx("type")} </span>
                  <span className="font-medium">{(editRow.tiposProcedimento ?? []).map(value => reportCatalogLabel(locale, value)).join(", ") || "—"}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">{tx("ligaments")} </span>
                  {(editRow.ligamentosAcometidos ?? []).length > 0
                    ? (editRow.ligamentosAcometidos ?? []).map(l => (
                        <Badge key={l} className="mr-1 text-xs h-4 px-1.5 bg-primary/10 text-primary border-0">{l}</Badge>
                      ))
                    : <span className="font-medium">—</span>}
                </div>
                {editRow.enxerto && (
                  <div>
                    <span className="text-muted-foreground">{tx("graft")}: </span>
                    <span className="font-medium">{reportCatalogLabel(locale, editRow.enxerto)}</span>
                    {editRow.diametroEnxerto && <span className="text-muted-foreground ml-1">({editRow.diametroEnxerto})</span>}
                  </div>
                )}
                {editRow.fixacaoFemoral && (
                  <div>
                    <span className="text-muted-foreground">{tx("femoralFixationShort")} </span>
                    <span className="font-medium">{reportCatalogLabel(locale, editRow.fixacaoFemoral)}</span>
                  </div>
                )}
                {editRow.fixacaoTibial && (
                  <div>
                    <span className="text-muted-foreground">{tx("tibialFixationShort")} </span>
                    <span className="font-medium">{reportCatalogLabel(locale, editRow.fixacaoTibial)}</span>
                  </div>
                )}
                {editRow.alinhamento && (
                  <div>
                    <span className="text-muted-foreground">{tx("alignment")} </span>
                    <span className="font-medium">{reportCatalogLabel(locale, editRow.alinhamento)}</span>
                  </div>
                )}
                {editRow.reforco && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground">{tx("reinforcement")} </span>
                    <span className="font-medium">{reportCatalogLabel(locale, editRow.reforco)}</span>
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
                    {["Pré-operatório","2 semanas","30 dias","45 dias","60 dias","3 meses","6 meses","9 meses","12 meses","18 meses","24 meses","36 meses","48 meses","60 meses"].map(t => (
                      <SelectItem key={t} value={t}>{reportCatalogLabel(locale, t)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-sm font-medium">{tx("assessmentDate")}</Label>
              <Input type="date" value={sf.dataAvaliacao} onChange={e => setSf("dataAvaliacao", e.target.value)} />
            </div>

            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">{tx("mainScales")}</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[
                  { key: "ikdc" as const, label: tx("ikdcSubjective"), min: 0, max: 100, step: 0.1, unit: "/100" },
                  { key: "lysholm" as const, label: "Lysholm", min: 0, max: 100, step: 1, unit: "/100" },
                  { key: "tegner" as const, label: "Tegner", min: 0, max: 10, step: 1, unit: "/10" },
                  { key: "kujala" as const, label: tx("kujalaPatellar"), min: 0, max: 100, step: 1, unit: "/100" },
                  { key: "vasDor" as const, label: tx("vasPain"), min: 0, max: 10, step: 1, unit: "/10" },
                  { key: "aclRsi" as const, label: tx("aclRsiReturnSport"), min: 0, max: 100, step: 0.1, unit: "/100" },
                  { key: "marx" as const, label: tx("marxActivity"), min: 0, max: 16, step: 1, unit: "/16" },
                ].map(({ key, label, min, max, step, unit }) => (
                  <div key={key} className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{label} <span className="opacity-50">{unit}</span></Label>
                    <Input type="number" min={min} max={max} step={step} value={sf[key]} onChange={e => setSf(key, e.target.value)} placeholder="—" className="h-8" />
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">KOOS-12</p>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{tx("koosTotal")} <span className="opacity-50">/100</span></Label>
                <Input type="number" min={0} max={100} step={0.1} value={sf["koos12"]} onChange={e => setSf("koos12", e.target.value)} placeholder="—" className="h-8" />
                <p className="text-xs text-muted-foreground opacity-60">{tx("koosFormula")}</p>
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
                        <SelectItem value="Ruptura do enxerto">{reportCatalogLabel(locale, "Ruptura do enxerto")}</SelectItem>
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
