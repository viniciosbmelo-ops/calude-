import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Pencil, Trash2, Settings, Send, Calendar, Clock, Hospital, User,
  CreditCard, Package, Phone, X, ChevronDown, ChevronUp, MessageSquare, FileDown
} from "lucide-react";
import { cn, formatLocalDate, sortByPtBrName } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { useLanguage, type Locale } from "@/lib/i18n";
import { useScopedTranslations } from "@/lib/i18n";
import { operationalCoreMessages } from "@/locales/operational-core";
import jsPDF from "jspdf";
import { handlePdfOpenClick, sharePdfOrDownload } from "@/lib/pdf-share";

type CodigoCbhpm = { codigo: string; descricao: string; quantidade: number };
type Material = { nome: string; quantidade: number; fornecedor: string };
type Destinatario = { nome: string; telefone: string };

type CirurgiaAgendada = {
  id: number;
  patientId: number;
  data: string;
  hora: string;
  tipoCirurgia: string;
  hospital: string | null;
  planoSaude: string | null;
  codigosCbhpm: string | null;
  materiais: string | null;
  destinatarios: string | null;
  status: string;
  observacoes: string | null;
  patientNome: string | null;
  patientTelefone: string | null;
};

type ConfigData = {
  hospitais: string;
  planosSaude: string;
  materiais: string;
  fornecedores: string;
  destinatarios: string;
};

type Patient = { id: number; nome: string };
type PlanoConfig = { nome: string; codigos: { codigo: string; descricao: string }[] };
type MaterialConfig = { nome: string; categoria: string };

function authHeaders() {
  return { "Content-Type": "application/json" };
}

function parsedJson<T>(val: string | null | undefined, fallback: T): T {
  if (!val) return fallback;
  try { return JSON.parse(val) as T; } catch { return fallback; }
}

function statusColor(s: string) {
  if (s === "agendado") return "bg-blue-100 text-blue-800 border-blue-200";
  if (s === "confirmado") return "bg-green-100 text-green-800 border-green-200";
  if (s === "cancelado") return "bg-red-100 text-red-800 border-red-200";
  if (s === "realizado") return "bg-gray-100 text-gray-700 border-gray-200";
  return "bg-gray-100 text-gray-700";
}

type OperationalKey = keyof typeof operationalCoreMessages["pt-BR"];

function agendaText(locale: Locale, key: OperationalKey, params?: Record<string, string | number>) {
  const template = operationalCoreMessages[locale][key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
}

function statusLabel(s: string, locale: Locale) {
  if (s === "agendado") return agendaText(locale, "agendaScheduled");
  if (s === "confirmado") return agendaText(locale, "agendaConfirmed");
  if (s === "cancelado") return agendaText(locale, "agendaCancelled");
  if (s === "realizado") return agendaText(locale, "agendaCompleted");
  return s;
}

function cleanPhone(phone: string) {
  const d = phone.replace(/\D/g, "");
  return d.startsWith("55") ? d : `55${d}`;
}

function parseLocalDate(d: string) {
  const [y, mo, day] = d.split("-").map(Number);
  return new Date(y, mo - 1, day, 12);
}

function fmtDate(d: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" }).format(parseLocalDate(d));
}

function fmtDateFull(d: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(parseLocalDate(d));
}

// Local calendar day (the UTC date is already "tomorrow" after 21:00 in Brazil).
function todayStr() { return formatLocalDate(); }
function weekEnd() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return formatLocalDate(d);
}

function buildWaMsg(c: CirurgiaAgendada, locale: Locale) {
  const codigos = parsedJson<CodigoCbhpm[]>(c.codigosCbhpm, []);
  const materiais = parsedJson<Material[]>(c.materiais, []);
  let msg = `🔪 *${agendaText(locale, "agendaWhatsappTitle")}*\n\n`;
  msg += `📅 *${agendaText(locale, "agendaWhatsappDate")}:* ${fmtDateFull(c.data, locale)} ${agendaText(locale, "agendaWhatsappAt")} ${c.hora}\n`;
  msg += `👤 *${agendaText(locale, "agendaWhatsappPatient")}:* ${c.patientNome ?? "-"}\n`;
  if (c.hospital) msg += `🏥 *${agendaText(locale, "agendaWhatsappHospital")}:* ${c.hospital}\n`;
  msg += `💉 *${agendaText(locale, "agendaWhatsappProcedure")}:* ${c.tipoCirurgia}\n`;
  if (c.planoSaude) msg += `\n*${agendaText(locale, "agendaWhatsappPlan")}:* ${c.planoSaude}\n`;
  if (codigos.length > 0) {
    msg += `\n*${agendaText(locale, "agendaCbhpmCodes")}:*\n`;
    codigos.forEach(cd => { msg += `• ${cd.codigo} — ${cd.descricao} (${cd.quantidade}x)\n`; });
  }
  if (materiais.length > 0) {
    msg += `\n*${agendaText(locale, "agendaWhatsappAuthorizedMaterials")}:*\n`;
    materiais.forEach(m => {
      msg += `• ${m.nome} — ${m.quantidade} ${agendaText(locale, "agendaUnitShort")}`;
      if (m.fornecedor) msg += ` (${m.fornecedor})`;
      msg += "\n";
    });
  }
  if (c.observacoes) msg += `\n📝 *${agendaText(locale, "agendaObservationShort")}:* ${c.observacoes}\n`;
  msg += `\nDocSholder 🦵`;
  return msg;
}

function sanitizePdf(s: string): string {
  return s
    .replace(/[\u2018\u2019\u0060\u00B4]/g, "'")
    .replace(/[\u201C\u201D\u00AB\u00BB]/g, '"')
    .replace(/\u2014/g, "--").replace(/\u2013/g, "-")
    .replace(/\u2026/g, "...").replace(/[^\x00-\xFF]/g, "?");
}

export function generateAgendaPDF(items: CirurgiaAgendada[], titulo: string, doctorNome: string, generatedDate: Date, locale: Locale) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = 210, margin = 16, cW = W - margin * 2, H = 297;
  let y = 0;

  type RGB = [number, number, number];
  const navy: RGB = [26, 54, 93];
  const cyan: RGB = [31, 182, 225];
  const black: RGB = [30, 30, 30];
  const white: RGB = [255, 255, 255];
  const lightBg: RGB = [235, 241, 250];
  const borderC: RGB = [200, 215, 235];
  const grayC: RGB = [110, 110, 110];

  const statusRGB: Record<string, RGB> = {
    agendado: [31, 182, 225], confirmado: [43, 147, 72],
    cancelado: [200, 50, 50], realizado: [140, 140, 140],
  };

  const setC = (c: RGB) => doc.setTextColor(c[0], c[1], c[2]);
  const setF = (c: RGB) => doc.setFillColor(c[0], c[1], c[2]);
  const setD = (c: RGB) => doc.setDrawColor(c[0], c[1], c[2]);

  function checkPage(need: number) {
    if (y + need > H - 16) { doc.addPage(); y = margin; }
  }

  // ── Header sem faixa ou logomarca ─────────────────────────────
  setC(black);
  doc.setFontSize(13); doc.setFont("helvetica", "bold");
  doc.text(sanitizePdf(agendaText(locale, "agendaPdfTitle")), W / 2, 13, { align: "center" });
  doc.setFontSize(9); doc.setFont("helvetica", "normal");
  setC(grayC);
  doc.text(sanitizePdf(titulo), W / 2, 20, { align: "center" });

  doc.setFontSize(8);
  doc.text(sanitizePdf(agendaText(locale, "agendaPdfDoctor", { name: doctorNome })), margin, 28);
  const generatedDateLabel = new Intl.DateTimeFormat(locale).format(generatedDate);
  doc.text(sanitizePdf(agendaText(locale, "agendaPdfGeneratedAt", { date: generatedDateLabel })), W - margin, 28, { align: "right" });
  setD(borderC);
  doc.setLineWidth(0.3);
  doc.line(margin, 32, W - margin, 32);

  y = 38;

  // ── Summary strip ────────────────────────────────────────────
  setF(lightBg); doc.rect(margin, y, cW, 8, "F");
  setC(navy); doc.setFontSize(9); doc.setFont("helvetica", "bold");
  doc.text(sanitizePdf(agendaText(locale, "agendaPdfTotal", { count: items.length })), margin + 4, y + 5.5);
  y += 13;

  // ── Group by date ────────────────────────────────────────────
  const byDate: Record<string, CirurgiaAgendada[]> = {};
  for (const item of items) { (byDate[item.data] ??= []).push(item); }
  const sortedDates = Object.keys(byDate).sort();

  for (const date of sortedDates) {
    const dayItems = byDate[date].sort((a, b) => a.hora.localeCompare(b.hora));

    // Date section header
    checkPage(14);
    setF(lightBg); setD(borderC); doc.setLineWidth(0.3);
    doc.rect(margin, y, cW, 8, "FD");
    setC(navy); doc.setFontSize(10); doc.setFont("helvetica", "bold");
    doc.text(sanitizePdf(fmtDateFull(date, locale)), margin + 3, y + 5.5);
    y += 12;

    for (const c of dayItems) {
      const codigos = parsedJson<CodigoCbhpm[]>(c.codigosCbhpm, []);
      const mats    = parsedJson<Material[]>(c.materiais, []);

      const codigosH = codigos.length > 0 ? 5 + codigos.length * 4.5 : 0;
      const matsH    = mats.length > 0    ? 5 + mats.length * 4.5    : 0;
      let obsH = 0;
      if (c.observacoes) {
        const obsLines = doc.splitTextToSize(sanitizePdf(c.observacoes), cW - 18);
        obsH = 5 + obsLines.length * 4;
      }
      const totalH = 30 + codigosH + matsH + obsH;

      checkPage(totalH + 5);

      // Card
      setF(white); setD(borderC); doc.setLineWidth(0.25);
      doc.roundedRect(margin, y, cW, totalH, 2, 2, "FD");
      // Left accent
      const sRGB = statusRGB[c.status] ?? ([140, 140, 140] as RGB);
      setF(sRGB); doc.roundedRect(margin, y, 3.5, totalH, 1, 1, "F");

      let cy = y + 7;

      // Patient name
      setC(navy); doc.setFontSize(11); doc.setFont("helvetica", "bold");
      doc.text(sanitizePdf(c.patientNome ?? "—"), margin + 7, cy, { maxWidth: cW - 30 });

      // Status badge
      const sLabel = statusLabel(c.status, locale);
      doc.setFontSize(7.5); doc.setFont("helvetica", "bold");
      const bW = doc.getTextWidth(sLabel) + 6;
      setF(sRGB);
      doc.roundedRect(W - margin - bW, cy - 5.5, bW, 7, 1, 1, "F");
      setC(white); doc.text(sLabel, W - margin - bW / 2, cy - 0.5, { align: "center" });

      cy += 5.5;

      // Procedure
      setC(black); doc.setFontSize(9); doc.setFont("helvetica", "normal");
      const procLines = doc.splitTextToSize(sanitizePdf(c.tipoCirurgia), cW - 14);
      doc.text(procLines, margin + 7, cy, { maxWidth: cW - 14 });
      cy += procLines.length * 4.5;

      // Info row
      setC(grayC); doc.setFontSize(8);
      let info = agendaText(locale, "agendaPdfTime", { time: c.hora });
      if (c.hospital) info += `   ${agendaText(locale, "agendaPdfHospital", { hospital: sanitizePdf(c.hospital) })}`;
      if (c.planoSaude) info += `   ${agendaText(locale, "agendaPdfPlan", { plan: sanitizePdf(c.planoSaude) })}`;
      doc.text(info, margin + 7, cy, { maxWidth: cW - 14 });
      cy += 5.5;

      if (codigos.length > 0 || mats.length > 0 || c.observacoes) {
        setD([220, 225, 238]); doc.setLineWidth(0.2);
        doc.line(margin + 7, cy, margin + cW - 3, cy);
        cy += 4;
      }

      // CBHPM
      if (codigos.length > 0) {
        setC(navy); doc.setFontSize(8); doc.setFont("helvetica", "bold");
        doc.text(sanitizePdf(agendaText(locale, "agendaPdfCbhpm")), margin + 7, cy); cy += 4.5;
        setC(black); doc.setFont("helvetica", "normal");
        for (const cd of codigos) {
          doc.text(sanitizePdf(`  ${cd.codigo} - ${cd.descricao} (${cd.quantidade}x)`), margin + 7, cy, { maxWidth: cW - 14 });
          cy += 4.5;
        }
      }

      // Materials
      if (mats.length > 0) {
        setC(navy); doc.setFontSize(8); doc.setFont("helvetica", "bold");
        doc.text(sanitizePdf(agendaText(locale, "agendaPdfMaterials")), margin + 7, cy); cy += 4.5;
        setC(black); doc.setFont("helvetica", "normal");
        for (const m of mats) {
          let ms = `  ${m.nome} - ${m.quantidade} ${agendaText(locale, "agendaUnitShort")}`;
          if (m.fornecedor) ms += ` (${sanitizePdf(m.fornecedor)})`;
          doc.text(sanitizePdf(ms), margin + 7, cy, { maxWidth: cW - 14 });
          cy += 4.5;
        }
      }

      // Obs
      if (c.observacoes) {
        setC(navy); doc.setFontSize(8); doc.setFont("helvetica", "bold");
        doc.text(sanitizePdf(`${agendaText(locale, "agendaObservationShort")}:`), margin + 7, cy);
        setC(grayC); doc.setFont("helvetica", "italic");
        const obsLines = doc.splitTextToSize(sanitizePdf(c.observacoes), cW - 22);
        doc.text(obsLines, margin + 18, cy, { maxWidth: cW - 22 });
        cy += obsLines.length * 4;
      }

      y += totalH + 4;
    }
    y += 2;
  }

  // ── Page numbers ────────────────────────────────────────────
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    setC([160, 160, 160]); doc.setFontSize(7.5); doc.setFont("helvetica", "normal");
    doc.text(sanitizePdf(agendaText(locale, "agendaPdfPage", { page: i, pages })), W / 2, H - 7, { align: "center" });
  }

  return {
    doc,
    filename: `agenda-cirurgica-${new Date().toISOString().split("T")[0]}.pdf`,
  };
}

const EMPTY_FORM = {
  patientId: "",
  data: todayStr(),
  hora: "07:00",
  tipoCirurgia: "",
  hospital: "",
  planoSaude: "",
  status: "agendado",
  observacoes: "",
};

export default function AgendaCirurgica() {
  const { locale } = useLanguage();
  const t = useScopedTranslations(operationalCoreMessages);
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();

  const [tab, setTab] = useState("hoje");
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfShareUrl, setPdfShareUrl] = useState<string | null>(null);
  const [dlgOpen, setDlgOpen] = useState(false);
  const [cfgOpen, setCfgOpen] = useState(false);
  const [waOpen, setWaOpen] = useState(false);
  const [waMsg, setWaMsg] = useState("");
  const [waPhone, setWaPhone] = useState("");
  const [editing, setEditing] = useState<CirurgiaAgendada | null>(null);

  const [form, setForm] = useState<typeof EMPTY_FORM>({ ...EMPTY_FORM });
  const [codigos, setCodigos] = useState<CodigoCbhpm[]>([]);
  const [materiais, setMateriais] = useState<Material[]>([]);
  const [destin, setDestin] = useState<Destinatario[]>([]);

  const { data: surgerias = [] } = useQuery<CirurgiaAgendada[]>({
    queryKey: ["scheduled-surgeries"],
    queryFn: async () => {
      const r = await fetch("/api/scheduled-surgeries", { credentials: "same-origin", headers: authHeaders() });
      if (!r.ok) throw new Error(t("agendaLoadSurgeriesError"));
      return r.json();
    },
  });

  const { data: patients = [] } = useQuery<Patient[]>({
    queryKey: ["patients-simple"],
    queryFn: async () => {
      const r = await fetch("/api/patients", { credentials: "same-origin", headers: authHeaders() });
      if (!r.ok) throw new Error(t("agendaLoadPatientsError"));
      const data = await r.json();
      return (data.patients ?? data).map((p: any) => ({ id: p.id, nome: p.nome }));
    },
  });

  const { data: config, refetch: refetchConfig } = useQuery<ConfigData>({
    queryKey: ["surgery-config"],
    queryFn: async () => {
      const r = await fetch("/api/doctor/surgery-config", { credentials: "same-origin", headers: authHeaders() });
      if (!r.ok) throw new Error(t("agendaLoadSettingsError"));
      return r.json();
    },
  });

  const sortedPatients = sortByPtBrName(patients, (patient) => patient.nome, (patient) => patient.id);
  const hospitais = sortByPtBrName(parsedJson<string[]>(config?.hospitais, []), (hospital) => hospital);
  const planos = sortByPtBrName(parsedJson<PlanoConfig[]>(config?.planosSaude, []), (plano) => plano.nome);
  const materiaisConfig = sortByPtBrName(parsedJson<MaterialConfig[]>(config?.materiais, []), (material) => material.nome);
  const fornecedores = sortByPtBrName(parsedJson<string[]>(config?.fornecedores, []), (fornecedor) => fornecedor);
  const destinatariosConfig = sortByPtBrName(parsedJson<Destinatario[]>(config?.destinatarios, []), (destinatario) => destinatario.nome, (destinatario) => destinatario.telefone);

  const createMut = useMutation({
    mutationFn: async (body: object) => {
      const r = await fetch("/api/scheduled-surgeries", {
        method: "POST", credentials: "same-origin", headers: authHeaders(), body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(t("agendaCreateError"));
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["scheduled-surgeries"] }); setDlgOpen(false); toast({ title: t("agendaCreated") }); },
    onError: () => toast({ title: t("agendaScheduleError"), variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, body }: { id: number; body: object }) => {
      const r = await fetch(`/api/scheduled-surgeries/${id}`, {
        method: "PATCH", credentials: "same-origin", headers: authHeaders(), body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(t("agendaUpdateError"));
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["scheduled-surgeries"] }); setDlgOpen(false); toast({ title: t("agendaUpdated") }); },
    onError: () => toast({ title: t("agendaUpdateError"), variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/scheduled-surgeries/${id}`, {
        method: "DELETE", credentials: "same-origin", headers: authHeaders(),
      });
      if (!r.ok) throw new Error(t("agendaDeleteError"));
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["scheduled-surgeries"] }); toast({ title: t("agendaRemoved") }); },
    onError: () => toast({ title: t("agendaDeleteError"), variant: "destructive" }),
  });

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, data: todayStr() });
    setCodigos([]);
    setMateriais([]);
    setDestin([]);
    setDlgOpen(true);
  };

  const openEdit = (c: CirurgiaAgendada) => {
    setEditing(c);
    setForm({
      patientId: String(c.patientId),
      data: c.data,
      hora: c.hora,
      tipoCirurgia: c.tipoCirurgia,
      hospital: c.hospital ?? "",
      planoSaude: c.planoSaude ?? "",
      status: c.status,
      observacoes: c.observacoes ?? "",
    });
    setCodigos(parsedJson<CodigoCbhpm[]>(c.codigosCbhpm, []));
    setMateriais(parsedJson<Material[]>(c.materiais, []));
    setDestin(parsedJson<Destinatario[]>(c.destinatarios, []));
    setDlgOpen(true);
  };

  const openWa = (c: CirurgiaAgendada, phone: string) => {
    setWaMsg(buildWaMsg(c, locale));
    setWaPhone(phone);
    setWaOpen(true);
  };

  const handleSend = () => {
    const url = `https://wa.me/${cleanPhone(waPhone)}?text=${encodeURIComponent(waMsg)}`;
    window.open(url, "_blank");
  };

  const handleSave = () => {
    const pid = Number(form.patientId);
    if (!pid || !form.data || !form.hora || !form.tipoCirurgia.trim()) {
      toast({ title: t("agendaRequiredFields"), variant: "destructive" });
      return;
    }
    const body = {
      patientId: pid,
      data: form.data,
      hora: form.hora,
      tipoCirurgia: form.tipoCirurgia,
      hospital: form.hospital || null,
      planoSaude: form.planoSaude || null,
      codigosCbhpm: JSON.stringify(codigos),
      materiais: JSON.stringify(materiais),
      destinatarios: JSON.stringify(destin),
      status: form.status,
      observacoes: form.observacoes || null,
    };
    if (editing) {
      const { patientId: _p, ...rest } = body;
      updateMut.mutate({ id: editing.id, body: rest });
    } else {
      createMut.mutate(body);
    }
  };

  const today = todayStr();
  const wEnd = weekEnd();

  const filteredHoje = surgerias.filter(c => c.data === today);
  const filteredSemana = surgerias.filter(c => c.data > today && c.data <= wEnd);
  const filteredFuturos = surgerias.filter(c => c.data > wEnd);

  const handleGeneratePdf = async () => {
    if (pdfShareUrl) {
      handlePdfOpenClick(pdfShareUrl, () => setPdfShareUrl(null));
      return;
    }
    const items = tab === "hoje" ? filteredHoje : tab === "semana" ? filteredSemana : filteredFuturos;
    if (items.length === 0) {
      toast({ title: t("agendaNoPdfItems"), variant: "destructive" });
      return;
    }
    const titulos: Record<string, string> = {
      hoje: t("agendaPdfTodayTitle", { date: fmtDateFull(today, locale) }),
      semana: t("agendaPdfWeekTitle"),
      futuros: t("agendaPdfFutureTitle"),
    };
    const doctorNome = (user as any)?.nome ?? (user as any)?.name ?? t("agendaDoctorFallback");
    setPdfLoading(true);
    try {
      const { doc, filename } = generateAgendaPDF(items, titulos[tab] ?? "", doctorNome, new Date(), locale);
      const result = await sharePdfOrDownload(doc, filename, setPdfShareUrl);
      if (result.deferred) {
        toast({ title: t("agendaPdfReady"), description: t("agendaPdfOpenSafari") });
      }
    } finally {
      setPdfLoading(false);
    }
  };

  return (
    <div className="p-4 max-w-2xl mx-auto pb-24">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <h1 className="text-xl font-bold text-foreground">{t("surgicalSchedule")}</h1>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={handleGeneratePdf} disabled={pdfLoading}>
            <FileDown className="h-4 w-4 mr-1" /> {pdfLoading ? t("agendaGenerating") : pdfShareUrl ? t("agendaOpenPdf") : "PDF"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setCfgOpen(true)}>
            <Settings className="h-4 w-4 mr-1" /> {t("agendaConfigure")}
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" /> {t("agendaNew")}
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full mb-4 h-auto">
          <TabsTrigger value="hoje" className="flex-1 min-w-0 whitespace-normal text-center">
            {t("agendaToday")} {filteredHoje.length > 0 && <span className="ml-1 text-xs bg-blue-500 text-white rounded-full px-1.5">{filteredHoje.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="semana" className="flex-1 min-w-0 whitespace-normal text-center">{t("agendaThisWeek")}</TabsTrigger>
          <TabsTrigger value="futuros" className="flex-1 min-w-0 whitespace-normal text-center">{t("agendaFuture")}</TabsTrigger>
        </TabsList>

        <TabsContent value="hoje">
          <SurgeryList items={filteredHoje} onEdit={openEdit} onDelete={id => deleteMut.mutate(id)} onWa={openWa} />
        </TabsContent>
        <TabsContent value="semana">
          <SurgeryList items={filteredSemana} onEdit={openEdit} onDelete={id => deleteMut.mutate(id)} onWa={openWa} />
        </TabsContent>
        <TabsContent value="futuros">
          <SurgeryList items={filteredFuturos} onEdit={openEdit} onDelete={id => deleteMut.mutate(id)} onWa={openWa} />
        </TabsContent>
      </Tabs>

      {/* Create/Edit Dialog — only mount when open */}
      {dlgOpen && (
      <Dialog open={dlgOpen} onOpenChange={setDlgOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? t("agendaEditSurgery") : t("agendaScheduleSurgery")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Patient */}
            <div className="space-y-1">
              <Label>{t("patient")} *</Label>
              <Select value={form.patientId} onValueChange={v => setForm(f => ({ ...f, patientId: v }))}>
                <SelectTrigger><SelectValue placeholder={t("agendaSelectPatient")} /></SelectTrigger>
                <SelectContent className="max-h-60 overflow-y-auto">
                  {sortedPatients.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Date + Time */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{t("agendaDate")} *</Label>
                <Input type="date" value={form.data} onChange={e => setForm(f => ({ ...f, data: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>{t("agendaTime")} *</Label>
                <Input type="time" value={form.hora} onChange={e => setForm(f => ({ ...f, hora: e.target.value }))} />
              </div>
            </div>

            {/* Surgery type */}
            <div className="space-y-1">
              <Label>{t("procedure")} *</Label>
              <Input
                placeholder={t("agendaProcedureExample")}
                value={form.tipoCirurgia}
                onChange={e => setForm(f => ({ ...f, tipoCirurgia: e.target.value }))}
              />
            </div>

            {/* Hospital */}
            <div className="space-y-1">
              <Label>{t("agendaHospital")}</Label>
              {hospitais.length > 0 ? (
                <Select value={form.hospital || "__none__"} onValueChange={v => setForm(f => ({ ...f, hospital: v === "__none__" ? "" : v }))}>
                  <SelectTrigger><SelectValue placeholder={t("agendaSelectHospital")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— {t("agendaNone")} —</SelectItem>
                    {hospitais.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Input placeholder={t("agendaHospitalName")} value={form.hospital} onChange={e => setForm(f => ({ ...f, hospital: e.target.value }))} />
              )}
            </div>

            {/* Plano de saúde */}
            <div className="space-y-1">
              <Label>{t("agendaHealthPlan")}</Label>
              {planos.length > 0 ? (
                <Select value={form.planoSaude || "__none__"} onValueChange={v => {
                  const val = v === "__none__" ? "" : v;
                  setForm(f => ({ ...f, planoSaude: val }));
                  if (val && val !== "Particular") {
                    const plano = planos.find(p => p.nome === val);
                    if (plano && plano.codigos.length > 0 && codigos.length === 0) {
                      setCodigos(plano.codigos.map(c => ({ ...c, quantidade: 1 })));
                    }
                  }
                }}>
                  <SelectTrigger><SelectValue placeholder={t("agendaSelectPlan")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— {t("agendaNone")} —</SelectItem>
                    <SelectItem value="Particular">{t("agendaPrivate")}</SelectItem>
                    {planos.map(p => <SelectItem key={p.nome} value={p.nome}>{p.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Input placeholder={t("agendaPlanOrPrivate")} value={form.planoSaude} onChange={e => setForm(f => ({ ...f, planoSaude: e.target.value }))} />
              )}
            </div>

            {/* CBHPM Codes */}
            <CodigosSection codigos={codigos} onChange={setCodigos} planos={planos} planoSelecionado={form.planoSaude} />

            {/* Materiais */}
            <MateriaisSection materiais={materiais} onChange={setMateriais} materiaisConfig={materiaisConfig} fornecedores={fornecedores} />

            {/* Destinatários WA */}
            <DestinatariosSection destin={destin} onChange={setDestin} config={destinatariosConfig} />

            {/* Status */}
            <div className="space-y-1">
              <Label>{t("agendaStatus")}</Label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="agendado">{t("agendaScheduled")}</SelectItem>
                  <SelectItem value="confirmado">{t("agendaConfirmed")}</SelectItem>
                  <SelectItem value="cancelado">{t("agendaCancelled")}</SelectItem>
                  <SelectItem value="realizado">{t("agendaCompleted")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Obs */}
            <div className="space-y-1">
              <Label>{t("observations")}</Label>
              <Textarea
                rows={2}
                placeholder={t("agendaObservationsPlaceholder")}
                value={form.observacoes}
                onChange={e => setForm(f => ({ ...f, observacoes: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlgOpen(false)}>{t("cancel")}</Button>
            <Button onClick={handleSave} disabled={createMut.isPending || updateMut.isPending}>
              {editing ? t("save") : t("agendaSchedule")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      )}

      {/* Config Dialog — only mount when open */}
      {cfgOpen && (
        <ConfigDialog
          open={cfgOpen}
          onClose={() => { setCfgOpen(false); refetchConfig(); }}
          config={config}
        />
      )}

      {/* WhatsApp Dialog — only mount when open */}
      {waOpen && (
        <Dialog open={waOpen} onOpenChange={setWaOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                 <MessageSquare className="h-5 w-5 text-green-600" /> {t("agendaSendWhatsapp")}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                 <Label>{t("agendaNumber")}</Label>
                <Input value={waPhone} onChange={e => setWaPhone(e.target.value)} placeholder="+55 11 99999-9999" />
              </div>
              <div className="space-y-1">
                 <Label>{t("agendaMessage")}</Label>
                <Textarea rows={12} value={waMsg} onChange={e => setWaMsg(e.target.value)} className="text-xs font-mono" />
              </div>
            </div>
            <DialogFooter>
               <Button variant="outline" onClick={() => setWaOpen(false)}>{t("cancel")}</Button>
              <Button onClick={handleSend} className="bg-green-600 hover:bg-green-700 text-white">
                 <Send className="h-4 w-4 mr-1" /> {t("agendaOpenWhatsapp")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function SurgeryList({
  items, onEdit, onDelete, onWa
}: {
  items: CirurgiaAgendada[];
  onEdit: (c: CirurgiaAgendada) => void;
  onDelete: (id: number) => void;
  onWa: (c: CirurgiaAgendada, phone: string) => void;
}) {
  const t = useScopedTranslations(operationalCoreMessages);
  if (items.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Calendar className="h-10 w-10 mx-auto mb-2 opacity-30" />
        <p className="text-sm">{t("agendaEmpty")}</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {items.map(c => <SurgeryCard key={c.id} c={c} onEdit={onEdit} onDelete={onDelete} onWa={onWa} />)}
    </div>
  );
}

function SurgeryCard({
  c, onEdit, onDelete, onWa
}: {
  c: CirurgiaAgendada;
  onEdit: (c: CirurgiaAgendada) => void;
  onDelete: (id: number) => void;
  onWa: (c: CirurgiaAgendada, phone: string) => void;
}) {
  const { locale } = useLanguage();
  const t = useScopedTranslations(operationalCoreMessages);
  const [expanded, setExpanded] = useState(false);
  const codigos = parsedJson<CodigoCbhpm[]>(c.codigosCbhpm, []);
  const materiais = parsedJson<Material[]>(c.materiais, []);
  const destin = parsedJson<Destinatario[]>(c.destinatarios, []);

  return (
    <Card className="border border-border shadow-sm">
      <CardContent className="p-4 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm truncate">{c.patientNome ?? "—"}</span>
              <Badge className={cn("text-xs border", statusColor(c.status))}>{statusLabel(c.status, locale)}</Badge>
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">{c.tipoCirurgia}</div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onEdit(c)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:text-red-600" onClick={() => { if (confirm(t("agendaRemoveConfirm"))) onDelete(c.id); }}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{fmtDate(c.data, locale)}</span>
          <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{c.hora}</span>
          {c.hospital && <span className="flex items-center gap-1"><Hospital className="h-3 w-3" />{c.hospital}</span>}
          {c.planoSaude && <span className="flex items-center gap-1"><CreditCard className="h-3 w-3" />{c.planoSaude}</span>}
        </div>

        {(codigos.length > 0 || materiais.length > 0 || c.observacoes) && (
          <button
            onClick={() => setExpanded(e => !e)}
            className="text-xs text-primary flex items-center gap-1 hover:underline"
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expanded ? t("agendaHideDetails") : t("agendaViewDetails")}
          </button>
        )}

        {expanded && (
          <div className="text-xs space-y-2 pt-1 border-t border-border/50">
            {codigos.length > 0 && (
              <div>
                <div className="font-medium text-foreground mb-1">{t("agendaCbhpmCodes")}:</div>
                {codigos.map((cd, i) => (
                  <div key={i} className="text-muted-foreground">• {cd.codigo} — {cd.descricao} ({cd.quantidade}x)</div>
                ))}
              </div>
            )}
            {materiais.length > 0 && (
              <div>
                <div className="font-medium text-foreground mb-1">{t("agendaMaterials")}:</div>
                {materiais.map((m, i) => (
                  <div key={i} className="text-muted-foreground">• {m.nome} — {m.quantidade} {t("agendaUnitShort")}{m.fornecedor ? ` (${m.fornecedor})` : ""}</div>
                ))}
              </div>
            )}
            {c.observacoes && (
              <div>
                <div className="font-medium text-foreground mb-1">{t("agendaObservationShort")}:</div>
                <div className="text-muted-foreground">{c.observacoes}</div>
              </div>
            )}
          </div>
        )}

        {destin.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1 border-t border-border/50">
            <span className="text-xs text-muted-foreground self-center">{t("agendaSendWa")}</span>
            {destin.map((d, i) => (
              <Button key={i} size="sm" variant="outline" className="h-6 text-xs px-2 gap-1 text-green-700 border-green-300"
                onClick={() => onWa(c, d.telefone)}>
                <Phone className="h-3 w-3" />{d.nome}
              </Button>
            ))}
          </div>
        )}
        {c.patientTelefone && (
          <div className="pt-0.5">
            <Button size="sm" variant="outline" className="h-6 text-xs px-2 gap-1 text-green-700 border-green-300"
              onClick={() => onWa(c, c.patientTelefone!)}>
              <Phone className="h-3 w-3" />{t("patient")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function lookupCbhpm(codigo: string, planos: PlanoConfig[] | undefined, locale: Locale): string {
  const clean = codigo.replace(/\D/g, "");
  if (!clean) return "";
  if (planos) {
    for (const plano of planos) {
      const found = plano.codigos?.find(c => c.codigo.replace(/\D/g, "") === clean);
      if (found?.descricao) return found.descricao;
    }
  }
  // Sem tabela embutida: a descrição vem dos códigos cadastrados nos planos do médico.
  return "";
}

function CodigosSection({
  codigos, onChange, planos, planoSelecionado
}: {
  codigos: CodigoCbhpm[];
  onChange: (c: CodigoCbhpm[]) => void;
  planos: PlanoConfig[];
  planoSelecionado: string;
}) {
  const { locale } = useLanguage();
  const t = useScopedTranslations(operationalCoreMessages);
  const [show, setShow] = useState(false);
  const [newCod, setNewCod] = useState({ codigo: "", descricao: "", quantidade: 1 });

  const planoCodigoSuggestions = useMemo(() => {
    const p = planos.find(p => p.nome === planoSelecionado);
    return p?.codigos ?? [];
  }, [planos, planoSelecionado]);

  const addCodigo = () => {
    if (!newCod.codigo.trim()) return;
    onChange([...codigos, { ...newCod }]);
    setNewCod({ codigo: "", descricao: "", quantidade: 1 });
  };

  const handleNewCodigoChange = (val: string) => {
    const found = lookupCbhpm(val, planos, locale);
    setNewCod(n => ({ ...n, codigo: val, descricao: found || n.descricao }));
  };

  const handleExistingCodigoChange = (i: number, val: string, current: CodigoCbhpm) => {
    const found = lookupCbhpm(val, planos, locale);
    const next = [...codigos];
    next[i] = { ...current, codigo: val, descricao: found || current.descricao };
    onChange(next);
  };

  return (
    <div className="space-y-1">
      <button onClick={() => setShow(s => !s)} className="flex items-center gap-1 text-sm font-medium text-foreground w-full text-left">
        <Package className="h-4 w-4 text-blue-500" />
        {t("agendaCbhpmCodes")} {codigos.length > 0 && <span className="text-xs text-muted-foreground">({codigos.length})</span>}
        {show ? <ChevronUp className="h-3.5 w-3.5 ml-auto" /> : <ChevronDown className="h-3.5 w-3.5 ml-auto" />}
      </button>
      {show && (
        <div className="space-y-2 pl-2 border-l-2 border-blue-100">
          {planoCodigoSuggestions.length > 0 && (
            <div className="text-xs text-muted-foreground">
              {t("agendaPlanSuggestions")}
              <div className="flex flex-wrap gap-1 mt-1">
                {planoCodigoSuggestions.map((s, i) => (
                  <button key={i} onClick={() => {
                    if (!codigos.find(c => c.codigo === s.codigo)) {
                      onChange([...codigos, { ...s, quantidade: 1 }]);
                    }
                  }} className="text-xs bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5 hover:bg-blue-100">
                    {s.codigo}
                  </button>
                ))}
              </div>
            </div>
          )}
          {codigos.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                className="h-7 text-xs w-24 flex-shrink-0"
                value={c.codigo}
                onChange={e => handleExistingCodigoChange(i, e.target.value, c)}
                placeholder={t("agendaCode")}
              />
              <Input
                className="h-7 text-xs flex-1"
                value={c.descricao}
                onChange={e => {
                  const next = [...codigos]; next[i] = { ...c, descricao: e.target.value }; onChange(next);
                }}
                placeholder={t("agendaDescription")}
              />
              <Input className="h-7 text-xs w-14 flex-shrink-0" type="number" min={1} value={c.quantidade} onChange={e => {
                const next = [...codigos]; next[i] = { ...c, quantidade: Number(e.target.value) }; onChange(next);
              }} />
              <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500" onClick={() => onChange(codigos.filter((_, j) => j !== i))}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <Input
              className="h-7 text-xs w-24 flex-shrink-0"
              placeholder={t("agendaCode")}
              value={newCod.codigo}
              onChange={e => handleNewCodigoChange(e.target.value)}
            />
            <Input
              className="h-7 text-xs flex-1"
              placeholder={t("agendaDescription")}
              value={newCod.descricao}
              onChange={e => setNewCod(n => ({ ...n, descricao: e.target.value }))}
            />
            <Input className="h-7 text-xs w-14 flex-shrink-0" type="number" min={1} value={newCod.quantidade} onChange={e => setNewCod(n => ({ ...n, quantidade: Number(e.target.value) }))} />
            <Button size="icon" variant="ghost" className="h-7 w-7 text-primary" onClick={addCodigo}><Plus className="h-3 w-3" /></Button>
          </div>
        </div>
      )}
    </div>
  );
}

function MateriaisSection({
  materiais, onChange, materiaisConfig, fornecedores
}: {
  materiais: Material[];
  onChange: (m: Material[]) => void;
  materiaisConfig: MaterialConfig[];
  fornecedores: string[];
}) {
  const t = useScopedTranslations(operationalCoreMessages);
  const [show, setShow] = useState(false);
  const [newMat, setNewMat] = useState({ nome: "", quantidade: 1, fornecedor: "" });

  const addMaterial = () => {
    if (!newMat.nome.trim()) return;
    onChange([...materiais, { ...newMat }]);
    setNewMat({ nome: "", quantidade: 1, fornecedor: "" });
  };

  return (
    <div className="space-y-1">
      <button onClick={() => setShow(s => !s)} className="flex items-center gap-1 text-sm font-medium text-foreground w-full text-left">
        <Package className="h-4 w-4 text-orange-500" />
        {t("agendaAuthorizedMaterials")} {materiais.length > 0 && <span className="text-xs text-muted-foreground">({materiais.length})</span>}
        {show ? <ChevronUp className="h-3.5 w-3.5 ml-auto" /> : <ChevronDown className="h-3.5 w-3.5 ml-auto" />}
      </button>
      {show && (
        <div className="space-y-2 pl-2 border-l-2 border-orange-100">
          {materiais.map((m, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input className="h-7 text-xs flex-1" value={m.nome} onChange={e => {
                const next = [...materiais]; next[i] = { ...m, nome: e.target.value }; onChange(next);
              }} placeholder={t("agendaMaterial")} />
              <Input className="h-7 text-xs w-14 flex-shrink-0" type="number" min={1} value={m.quantidade} onChange={e => {
                const next = [...materiais]; next[i] = { ...m, quantidade: Number(e.target.value) }; onChange(next);
              }} />
              <Input className="h-7 text-xs w-28 flex-shrink-0" value={m.fornecedor} onChange={e => {
                const next = [...materiais]; next[i] = { ...m, fornecedor: e.target.value }; onChange(next);
              }} placeholder={t("agendaSupplier")} />
              <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500" onClick={() => onChange(materiais.filter((_, j) => j !== i))}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
          {materiaisConfig.length > 0 && (
            <div>
              <Select value="__add__" onValueChange={v => {
                if (v && v !== "__add__" && !materiais.find(m => m.nome === v)) {
                  onChange([...materiais, { nome: v, quantidade: 1, fornecedor: fornecedores[0] ?? "" }]);
                }
              }}>
                <SelectTrigger className="h-7 text-xs"><SelectValue placeholder={`+ ${t("agendaAddFromList")}`} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__add__" disabled>+ {t("agendaAddFromList")}</SelectItem>
                  {materiaisConfig.map(m => <SelectItem key={m.nome} value={m.nome}>{m.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Input className="h-7 text-xs flex-1" placeholder={t("agendaMaterialName")} value={newMat.nome} onChange={e => setNewMat(n => ({ ...n, nome: e.target.value }))} />
            <Input className="h-7 text-xs w-14 flex-shrink-0" type="number" min={1} value={newMat.quantidade} onChange={e => setNewMat(n => ({ ...n, quantidade: Number(e.target.value) }))} />
            <Input className="h-7 text-xs w-28 flex-shrink-0" placeholder={t("agendaSupplier")} value={newMat.fornecedor} onChange={e => setNewMat(n => ({ ...n, fornecedor: e.target.value }))} />
            <Button size="icon" variant="ghost" className="h-7 w-7 text-primary" onClick={addMaterial}><Plus className="h-3 w-3" /></Button>
          </div>
        </div>
      )}
    </div>
  );
}

function DestinatariosSection({
  destin, onChange, config
}: {
  destin: Destinatario[];
  onChange: (d: Destinatario[]) => void;
  config: Destinatario[];
}) {
  const t = useScopedTranslations(operationalCoreMessages);
  const [show, setShow] = useState(false);
  const [custom, setCustom] = useState({ nome: "", telefone: "" });

  const toggleConfig = (d: Destinatario) => {
    const idx = destin.findIndex(x => x.telefone === d.telefone);
    if (idx >= 0) onChange(destin.filter((_, i) => i !== idx));
    else onChange([...destin, d]);
  };

  return (
    <div className="space-y-1">
      <button onClick={() => setShow(s => !s)} className="flex items-center gap-1 text-sm font-medium text-foreground w-full text-left">
        <Phone className="h-4 w-4 text-green-600" />
        {t("agendaWhatsappRecipients")} {destin.length > 0 && <span className="text-xs text-muted-foreground">({destin.length})</span>}
        {show ? <ChevronUp className="h-3.5 w-3.5 ml-auto" /> : <ChevronDown className="h-3.5 w-3.5 ml-auto" />}
      </button>
      {show && (
        <div className="space-y-2 pl-2 border-l-2 border-green-100">
          {config.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {config.map((d, i) => {
                const selected = destin.some(x => x.telefone === d.telefone);
                return (
                  <button key={i} onClick={() => toggleConfig(d)}
                    className={cn("text-xs border rounded px-2 py-1 transition-colors", selected
                      ? "bg-green-100 border-green-400 text-green-800"
                      : "bg-muted border-border text-muted-foreground hover:bg-green-50"
                    )}>
                    {d.nome}
                  </button>
                );
              })}
            </div>
          )}
          {destin.filter(d => !config.some(c => c.telefone === d.telefone)).map((d, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xs flex-1">{d.nome} — {d.telefone}</span>
              <Button size="icon" variant="ghost" className="h-6 w-6 text-red-500" onClick={() => onChange(destin.filter(x => x.telefone !== d.telefone))}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <Input className="h-7 text-xs flex-1" placeholder={t("agendaName")} value={custom.nome} onChange={e => setCustom(n => ({ ...n, nome: e.target.value }))} />
            <Input className="h-7 text-xs flex-1" placeholder={t("agendaPhone")} value={custom.telefone} onChange={e => setCustom(n => ({ ...n, telefone: e.target.value }))} />
            <Button size="icon" variant="ghost" className="h-7 w-7 text-primary" onClick={() => {
              if (!custom.nome || !custom.telefone) return;
              onChange([...destin, { ...custom }]);
              setCustom({ nome: "", telefone: "" });
            }}><Plus className="h-3 w-3" /></Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ConfigDialog({ open, onClose, config }: { open: boolean; onClose: () => void; config?: ConfigData }) {
  const { toast } = useToast();
  const t = useScopedTranslations(operationalCoreMessages);
  const [tab, setTab] = useState("hospitais");

  const [hospitais, setHospitais] = useState<string[]>([]);
  const [planos, setPlanos] = useState<PlanoConfig[]>([]);
  const [materiais, setMateriais] = useState<MaterialConfig[]>([]);
  const [fornecedores, setFornecedores] = useState<string[]>([]);
  const [destinatarios, setDestinatarios] = useState<Destinatario[]>([]);

  const [newHosp, setNewHosp] = useState("");
  const [newForns, setNewForns] = useState("");
  const [newMat, setNewMat] = useState({ nome: "", categoria: "" });
  const [newDest, setNewDest] = useState({ nome: "", telefone: "" });
  const [newPlano, setNewPlano] = useState({ nome: "", codigos: "" });
  const [expandedPlano, setExpandedPlano] = useState<number | null>(null);
  const [newPlanoCode, setNewPlanoCode] = useState<{ [i: number]: { codigo: string; descricao: string } }>({});

  useEffect(() => {
    if (open && config) {
      setHospitais(sortByPtBrName(parsedJson<string[]>(config.hospitais, []), (hospital) => hospital));
      setPlanos(sortByPtBrName(parsedJson<PlanoConfig[]>(config.planosSaude, []), (plano) => plano.nome));
      setMateriais(sortByPtBrName(parsedJson<MaterialConfig[]>(config.materiais, []), (material) => material.nome));
      setFornecedores(sortByPtBrName(parsedJson<string[]>(config.fornecedores, []), (fornecedor) => fornecedor));
      setDestinatarios(sortByPtBrName(parsedJson<Destinatario[]>(config.destinatarios, []), (destinatario) => destinatario.nome, (destinatario) => destinatario.telefone));
    }
  }, [open, config]);

  const handleSave = async () => {
    const body = {
      hospitais: JSON.stringify(hospitais),
      planosSaude: JSON.stringify(planos),
      materiais: JSON.stringify(materiais),
      fornecedores: JSON.stringify(fornecedores),
      destinatarios: JSON.stringify(destinatarios),
    };
    const r = await fetch("/api/doctor/surgery-config", {
      method: "PATCH", credentials: "same-origin", headers: authHeaders(), body: JSON.stringify(body),
    });
    if (r.ok) { toast({ title: t("agendaSettingsSaved") }); onClose(); }
    else toast({ title: t("agendaSaveError"), variant: "destructive" });
  };

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Settings className="h-5 w-5" />{t("agendaSurgicalSettings")}</DialogTitle>
        </DialogHeader>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full grid grid-cols-5 h-auto text-xs">
            <TabsTrigger value="hospitais" className="px-1 py-1.5 text-xs">{t("agendaHospitals")}</TabsTrigger>
            <TabsTrigger value="planos" className="px-1 py-1.5 text-xs">{t("agendaPlans")}</TabsTrigger>
            <TabsTrigger value="materiais" className="px-1 py-1.5 text-xs">{t("agendaMaterials")}</TabsTrigger>
            <TabsTrigger value="fornecedores" className="px-1 py-1.5 text-xs">{t("agendaSuppliers")}</TabsTrigger>
            <TabsTrigger value="destinatarios" className="px-1 py-1.5 text-xs">WA</TabsTrigger>
          </TabsList>

          <TabsContent value="hospitais" className="space-y-2 mt-3">
            <div className="flex gap-2">
              <Input className="h-8 text-sm" placeholder={t("agendaHospitalNameConfig")} value={newHosp} onChange={e => setNewHosp(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && newHosp.trim()) { setHospitais(h => sortByPtBrName([...h, newHosp.trim()], (hospital) => hospital)); setNewHosp(""); } }} />
              <Button size="sm" onClick={() => { if (newHosp.trim()) { setHospitais(h => sortByPtBrName([...h, newHosp.trim()], (hospital) => hospital)); setNewHosp(""); } }}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {hospitais.map((h, i) => (
              <div key={i} className="flex items-center justify-between border rounded px-3 py-2 text-sm">
                <span>{h}</span>
                <Button size="icon" variant="ghost" className="h-6 w-6 text-red-500" onClick={() => setHospitais(hs => hs.filter((_, j) => j !== i))}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </TabsContent>

          <TabsContent value="planos" className="space-y-2 mt-3">
            <div className="flex gap-2">
              <Input className="h-8 text-sm" placeholder={t("agendaPlanName")} value={newPlano.nome} onChange={e => setNewPlano(n => ({ ...n, nome: e.target.value }))} />
              <Button size="sm" onClick={() => {
                if (newPlano.nome.trim()) {
                  setPlanos(ps => sortByPtBrName([...ps, { nome: newPlano.nome.trim(), codigos: [] }], (plano) => plano.nome));
                  setNewPlano({ nome: "", codigos: "" });
                }
              }}><Plus className="h-4 w-4" /></Button>
            </div>
            {planos.map((p, i) => (
              <div key={i} className="border rounded">
                <div className="flex items-center justify-between px-3 py-2">
                  <button className="flex items-center gap-2 text-sm font-medium flex-1 text-left" onClick={() => setExpandedPlano(expandedPlano === i ? null : i)}>
                    {p.nome}
                    <span className="text-xs text-muted-foreground">({t("agendaCodesCount", { count: p.codigos.length })})</span>
                    {expandedPlano === i ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
                  </button>
                  <Button size="icon" variant="ghost" className="h-6 w-6 text-red-500" onClick={() => setPlanos(ps => ps.filter((_, j) => j !== i))}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
                {expandedPlano === i && (
                  <div className="px-3 pb-3 space-y-2 border-t pt-2">
                    {p.codigos.map((c, j) => (
                      <div key={j} className="flex items-center gap-2 text-xs">
                        <span className="w-24 font-mono">{c.codigo}</span>
                        <span className="flex-1 text-muted-foreground">{c.descricao}</span>
                        <Button size="icon" variant="ghost" className="h-5 w-5 text-red-500" onClick={() => {
                          const next = [...planos];
                          next[i] = { ...p, codigos: p.codigos.filter((_, k) => k !== j) };
                          setPlanos(next);
                        }}><X className="h-2.5 w-2.5" /></Button>
                      </div>
                    ))}
                    <div className="flex items-center gap-2">
                      <Input className="h-6 text-xs w-24" placeholder={t("agendaCode")} value={newPlanoCode[i]?.codigo ?? ""} onChange={e => setNewPlanoCode(n => ({ ...n, [i]: { ...n[i], codigo: e.target.value } }))} />
                      <Input className="h-6 text-xs flex-1" placeholder={t("agendaDescription")} value={newPlanoCode[i]?.descricao ?? ""} onChange={e => setNewPlanoCode(n => ({ ...n, [i]: { ...n[i], descricao: e.target.value } }))} />
                      <Button size="icon" variant="ghost" className="h-6 w-6 text-primary" onClick={() => {
                        const nc = newPlanoCode[i];
                        if (!nc?.codigo?.trim()) return;
                        const next = [...planos];
                        next[i] = { ...p, codigos: [...p.codigos, { codigo: nc.codigo, descricao: nc.descricao ?? "" }] };
                        setPlanos(next);
                        setNewPlanoCode(n => ({ ...n, [i]: { codigo: "", descricao: "" } }));
                      }}><Plus className="h-3 w-3" /></Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </TabsContent>

          <TabsContent value="materiais" className="space-y-2 mt-3">
            <div className="flex gap-2">
              <Input className="h-8 text-sm flex-1" placeholder={t("agendaMaterialName")} value={newMat.nome} onChange={e => setNewMat(m => ({ ...m, nome: e.target.value }))} />
              <Input className="h-8 text-sm w-28" placeholder={t("agendaCategory")} value={newMat.categoria} onChange={e => setNewMat(m => ({ ...m, categoria: e.target.value }))} />
              <Button size="sm" onClick={() => { if (newMat.nome.trim()) { setMateriais(m => sortByPtBrName([...m, { ...newMat }], (material) => material.nome)); setNewMat({ nome: "", categoria: "" }); } }}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {materiais.map((m, i) => (
              <div key={i} className="flex items-center justify-between border rounded px-3 py-2 text-sm">
                <span>{m.nome}{m.categoria && <span className="text-xs text-muted-foreground ml-2">({m.categoria})</span>}</span>
                <Button size="icon" variant="ghost" className="h-6 w-6 text-red-500" onClick={() => setMateriais(ms => ms.filter((_, j) => j !== i))}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </TabsContent>

          <TabsContent value="fornecedores" className="space-y-2 mt-3">
            <div className="flex gap-2">
              <Input className="h-8 text-sm" placeholder={t("agendaSupplierName")} value={newForns} onChange={e => setNewForns(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && newForns.trim()) { setFornecedores(f => sortByPtBrName([...f, newForns.trim()], (fornecedor) => fornecedor)); setNewForns(""); } }} />
              <Button size="sm" onClick={() => { if (newForns.trim()) { setFornecedores(f => sortByPtBrName([...f, newForns.trim()], (fornecedor) => fornecedor)); setNewForns(""); } }}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {fornecedores.map((f, i) => (
              <div key={i} className="flex items-center justify-between border rounded px-3 py-2 text-sm">
                <span>{f}</span>
                <Button size="icon" variant="ghost" className="h-6 w-6 text-red-500" onClick={() => setFornecedores(fs => fs.filter((_, j) => j !== i))}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </TabsContent>

          <TabsContent value="destinatarios" className="space-y-2 mt-3">
            <div className="text-xs text-muted-foreground mb-2">{t("agendaRecipientsHelp")}</div>
            <div className="flex gap-2">
              <Input className="h-8 text-sm flex-1" placeholder={t("agendaName")} value={newDest.nome} onChange={e => setNewDest(d => ({ ...d, nome: e.target.value }))} />
              <Input className="h-8 text-sm flex-1" placeholder="WhatsApp" value={newDest.telefone} onChange={e => setNewDest(d => ({ ...d, telefone: e.target.value }))} />
              <Button size="sm" onClick={() => { if (newDest.nome && newDest.telefone) { setDestinatarios(ds => sortByPtBrName([...ds, { ...newDest }], (destinatario) => destinatario.nome, (destinatario) => destinatario.telefone)); setNewDest({ nome: "", telefone: "" }); } }}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {destinatarios.map((d, i) => (
              <div key={i} className="flex items-center justify-between border rounded px-3 py-2 text-sm">
                <div>
                  <span className="font-medium">{d.nome}</span>
                  <span className="text-xs text-muted-foreground ml-2">{d.telefone}</span>
                </div>
                <Button size="icon" variant="ghost" className="h-6 w-6 text-red-500" onClick={() => setDestinatarios(ds => ds.filter((_, j) => j !== i))}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </TabsContent>
        </Tabs>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("cancel")}</Button>
          <Button onClick={handleSave}>{t("agendaSaveSettings")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
