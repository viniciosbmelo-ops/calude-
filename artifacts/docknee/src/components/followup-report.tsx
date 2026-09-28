import { useRef, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend,
} from "recharts";
import {
  TrendingUp, TrendingDown, Minus, AlertTriangle,
  CheckCircle2, Info, Activity, FileDown, Loader2,
  ArrowUp, ArrowDown, Equal,
} from "lucide-react";
import { format } from "date-fns";
import { useScopedTranslations } from "@/lib/i18n";
import { operationalCoreMessages } from "@/locales/operational-core";
import { toJpeg } from "html-to-image";
import jsPDF from "jspdf";
import { categorizeFollowupComplications, parseFollowupComplication } from "@/lib/followup-complications";
import { handlePdfOpenClick, sharePdfOrDownload } from "@/lib/pdf-share";
import { useLanguage, type Locale } from "@/lib/i18n";
import { documentDate, documentText } from "@/locales/document-locales";
import {
  followupAuthoredText,
  followupInsightText,
  followupPeriodText,
  followupReportMessages,
  followupReportText,
} from "@/locales/followup-report";

// ─── Period benchmarks ────────────────────────────────────────────────────────
// LCA — Sources: Lysholm & Gillquist 1982; Briggs et al. 2009; Webster et al. 2015;
//        Ardern et al. 2011; van Eck et al. 2013; Hambly & Griva 2008 (KOOS)
// LCP — Sources: Fanelli et al. 2010; Pache et al. 2018; Wind et al. 2004;
//        recuperação mais lenta — laxidez pode aumentar até follow-up final

type BenchRange = { min: number; max: number; label: string };
type PeriodKey = "3 meses" | "6 meses" | "1 ano" | "2 anos" | "5 anos";

const BENCHMARKS: Partial<Record<PeriodKey, Partial<Record<string, BenchRange>>>> = {
  "3 meses": {
    ikdc:   { min: 38, max: 58, label: "38–58 (pós-op precoce)" },
    lysholm:{ min: 62, max: 80, label: "62–80 (reabilitação ativa)" },
    vasDor: { min: 1,  max: 4,  label: "1–4 (dor esperada no pós-op)" },
    koos12: { min: 52, max: 75, label: "52–75 (limitação funcional esperada)" },
  },
  "6 meses": {
    ikdc:   { min: 52, max: 70, label: "52–70 (progressão funcional)" },
    lysholm:{ min: 72, max: 87, label: "72–87" },
    vasDor: { min: 0,  max: 3,  label: "0–3 (dor residual leve)" },
    koos12: { min: 65, max: 82, label: "65–82 (recuperação funcional progressiva)" },
  },
  "1 ano": {
    ikdc:   { min: 65, max: 82, label: "65–82 (resultado esperado 1 ano)" },
    lysholm:{ min: 80, max: 92, label: "80–92" },
    vasDor: { min: 0,  max: 2,  label: "0–2 (dor mínima)" },
    aclRsi: { min: 56, max: 77, label: "56–77 (prontidão psicológica)" },
    marx:   { min: 5,  max: 12, label: "5–12 (retorno atividade)" },
    koos12: { min: 75, max: 88, label: "75–88 (boa recuperação funcional)" },
  },
  "2 anos": {
    ikdc:   { min: 72, max: 86, label: "72–86 (consolidação do resultado)" },
    lysholm:{ min: 84, max: 95, label: "84–95" },
    vasDor: { min: 0,  max: 2,  label: "0–2" },
    aclRsi: { min: 65, max: 82, label: "65–82" },
    marx:   { min: 8,  max: 14, label: "8–14 (atividade esportiva regular)" },
    koos12: { min: 80, max: 92, label: "80–92 (excelente resultado tardio)" },
  },
  "5 anos": {
    ikdc:   { min: 76, max: 90, label: "76–90 (resultado a longo prazo)" },
    lysholm:{ min: 86, max: 97, label: "86–97" },
    vasDor: { min: 0,  max: 1,  label: "0–1 (dor ausente ou mínima)" },
    aclRsi: { min: 70, max: 88, label: "70–88" },
    marx:   { min: 8,  max: 14, label: "8–14" },
    koos12: { min: 82, max: 95, label: "82–95 (resultado a longo prazo)" },
  },
};

// ─── LCP Benchmarks (literatura específica LCP — recuperação mais lenta) ──────
const LCP_BENCHMARKS: Partial<Record<PeriodKey, Partial<Record<string, BenchRange>>>> = {
  "3 meses": {
    ikdc:    { min: 30, max: 52, label: "30–52 (pós-op precoce LCP)" },
    lysholm: { min: 55, max: 72, label: "55–72 (reabilitação inicial LCP)" },
    vasDor:  { min: 1,  max: 5,  label: "1–5 (dor esperada pós-op)" },
  },
  "6 meses": {
    ikdc:    { min: 48, max: 65, label: "48–65 (ponto crítico LCP)" },
    lysholm: { min: 68, max: 82, label: "68–82" },
    vasDor:  { min: 0,  max: 3,  label: "0–3 (dor residual leve)" },
  },
  "1 ano": {
    ikdc:    { min: 58, max: 78, label: "58–78 (resultado 12m LCP)" },
    lysholm: { min: 76, max: 90, label: "76–90" },
    vasDor:  { min: 0,  max: 2,  label: "0–2 (dor mínima)" },
  },
  "2 anos": {
    ikdc:    { min: 66, max: 84, label: "66–84 (avaliação definitiva LCP)" },
    lysholm: { min: 80, max: 93, label: "80–93" },
    vasDor:  { min: 0,  max: 2,  label: "0–2" },
  },
  "5 anos": {
    ikdc:    { min: 70, max: 88, label: "70–88 (longo prazo LCP)" },
    lysholm: { min: 82, max: 95, label: "82–95" },
    vasDor:  { min: 0,  max: 1,  label: "0–1" },
  },
};

function normalizeTempo(tempo: string): PeriodKey {
  return tempo
    .toLowerCase()
    .replace("12 meses", "1 ano")
    .replace("24 meses", "2 anos")
    .replace("60 meses", "5 anos")
    .replace("1 ano", "1 ano")
    .replace("2 anos", "2 anos")
    .replace(/^(\d+)\s*mês.*$/, "$1 meses")
    .replace("30 dias", "1 mês")
    .replace("90 dias", "3 meses")
    .replace("180 dias", "6 meses")
    .trim() as PeriodKey;
}

function getBenchmark(tempo: string, scaleKey: string, ligamentos?: string[]): BenchRange | null {
  const normalized = normalizeTempo(tempo);
  const isLcp = ligamentos?.includes("LCP");
  const map = isLcp ? LCP_BENCHMARKS : BENCHMARKS;
  return map[normalized]?.[scaleKey] ?? null;
}

function getBenchmarkStatus(value: number, bench: BenchRange, higherIsBetter: boolean): "above" | "within" | "below" {
  if (higherIsBetter) {
    if (value > bench.max) return "above";
    if (value < bench.min) return "below";
    return "within";
  } else {
    // Lower is better (VAS Dor)
    if (value < bench.min) return "above"; // below min = better than expected
    if (value > bench.max) return "below"; // above max = worse than expected
    return "within";
  }
}

// ─── Scale definitions ────────────────────────────────────────────────────────

type Rating = "excellent" | "good" | "fair" | "poor" | "alert";

const SCALES: {
  key: string;
  label: string;
  max: number;
  unit?: string;
  interpret: (v: number) => { rating: Rating; text: string };
  higherIsBetter: boolean;
}[] = [
  {
    key: "ikdc",
    label: "IKDC",
    max: 100,
    higherIsBetter: true,
    interpret: (v) => {
      if (v >= 85) return { rating: "excellent", text: "Excelente — função do joelho plenamente recuperada" };
      if (v >= 70) return { rating: "good", text: "Boa função do joelho" };
      if (v >= 55) return { rating: "fair", text: "Função regular — acompanhamento necessário" };
      return { rating: "poor", text: "Função comprometida — revisar protocolo de reabilitação" };
    },
  },
  {
    key: "lysholm",
    label: "Lysholm",
    max: 100,
    higherIsBetter: true,
    interpret: (v) => {
      if (v >= 91) return { rating: "excellent", text: "Resultado excelente (≥91)" };
      if (v >= 84) return { rating: "good", text: "Bom resultado clínico (84–90)" };
      if (v >= 65) return { rating: "fair", text: "Resultado regular (65–83) — monitorar" };
      return { rating: "poor", text: "Resultado ruim (<65) — reavaliação necessária" };
    },
  },
  {
    key: "vasDor",
    label: "VAS Dor",
    max: 10,
    higherIsBetter: false,
    interpret: (v) => {
      if (v <= 2) return { rating: "excellent", text: "Dor mínima ou ausente (≤2)" };
      if (v <= 4) return { rating: "good", text: "Dor leve — controlada (3–4)" };
      if (v <= 6) return { rating: "fair", text: "Dor moderada — intervir (5–6)" };
      return { rating: "alert", text: "Dor intensa — atenção imediata (≥7)" };
    },
  },
  {
    key: "aclRsi",
    label: "ACL-RSI",
    max: 100,
    higherIsBetter: true,
    interpret: (v) => {
      if (v >= 77) return { rating: "excellent", text: "Psicologicamente pronto para retorno ao esporte (≥77)" };
      if (v >= 56) return { rating: "fair", text: "Prontidão psicológica moderada (56–76) — manter acompanhamento" };
      return { rating: "alert", text: "Não psicologicamente pronto (<56) — suporte psicológico indicado" };
    },
  },
  {
    key: "marx",
    label: "Marx",
    max: 16,
    higherIsBetter: true,
    interpret: (v) => {
      if (v >= 14) return { rating: "excellent", text: "Nível de atividade muito alto (≥14)" };
      if (v >= 10) return { rating: "good", text: "Nível de atividade alto (10–13)" };
      if (v >= 5) return { rating: "fair", text: "Nível de atividade moderado (5–9)" };
      return { rating: "poor", text: "Nível de atividade baixo (≤4) — estimular progressão" };
    },
  },
  {
    key: "tegner",
    label: "Tegner",
    max: 10,
    higherIsBetter: true,
    interpret: (v) => {
      if (v >= 7) return { rating: "excellent", text: "Nível de atividade pré-lesão (≥7)" };
      if (v >= 5) return { rating: "good", text: "Nível esportivo (5–6)" };
      if (v >= 3) return { rating: "fair", text: "Nível moderado — atividade recreativa (3–4)" };
      return { rating: "poor", text: "Nível baixo — apenas trabalho leve (<3)" };
    },
  },
  {
    key: "kujala",
    label: "Kujala",
    max: 100,
    higherIsBetter: true,
    interpret: (v) => {
      if (v >= 90) return { rating: "excellent", text: "Excelente função patelofemoral (≥90)" };
      if (v >= 75) return { rating: "good", text: "Boa função patelofemoral (75–89)" };
      if (v >= 55) return { rating: "fair", text: "Função regular — monitorar (55–74)" };
      return { rating: "poor", text: "Função comprometida — reavaliação indicada (<55)" };
    },
  },
  {
    key: "koos12",
    label: "KOOS-12",
    max: 100,
    higherIsBetter: true,
    interpret: (v) => {
      if (v >= 85) return { rating: "excellent", text: "Excelente — sintomas e função muito bem preservados" };
      if (v >= 65) return { rating: "good", text: "Bom — boa função geral do joelho" };
      if (v >= 45) return { rating: "fair", text: "Moderado — limitação funcional presente" };
      return { rating: "poor", text: "Grave — reavaliação clínica necessária" };
    },
  },
  {
    key: "womac",
    label: "WOMAC",
    max: 100,
    higherIsBetter: true,
    interpret: (v) => {
      if (v >= 80) return { rating: "excellent", text: "Excelente resultado funcional (≥80)" };
      if (v >= 60) return { rating: "good", text: "Bom resultado funcional (60–79)" };
      if (v >= 40) return { rating: "fair", text: "Limitação moderada (40–59)" };
      return { rating: "poor", text: "Limitação grave — revisar protocolo (<40)" };
    },
  },
];

const RATING_STYLE: Record<Rating, { bg: string; text: string; border: string; dot: string }> = {
  excellent: { bg: "bg-emerald-50 dark:bg-emerald-950/30", text: "text-emerald-700 dark:text-emerald-400", border: "border-emerald-200 dark:border-emerald-800", dot: "bg-emerald-500" },
  good:      { bg: "bg-blue-50 dark:bg-blue-950/30",    text: "text-blue-700 dark:text-blue-400",    border: "border-blue-200 dark:border-blue-800",    dot: "bg-blue-500" },
  fair:      { bg: "bg-amber-50 dark:bg-amber-950/30",  text: "text-amber-700 dark:text-amber-400",  border: "border-amber-200 dark:border-amber-800",  dot: "bg-amber-500" },
  poor:      { bg: "bg-red-50 dark:bg-red-950/30",      text: "text-red-700 dark:text-red-400",      border: "border-red-200 dark:border-red-800",      dot: "bg-red-500" },
  alert:     { bg: "bg-red-50 dark:bg-red-950/30",      text: "text-red-700 dark:text-red-400",      border: "border-red-200 dark:border-red-800",      dot: "bg-red-600" },
};

const LINE_COLORS: Record<string, string> = {
  ikdc: "#6366f1", lysholm: "#0ea5e9", vasDor: "#ef4444",
  aclRsi: "#8b5cf6", marx: "#f59e0b",
  koos12: "#10b981", tegner: "#f97316", kujala: "#ec4899", womac: "#14b8a6",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function delta(curr: number | null | undefined, prev: number | null | undefined, higherIsBetter: boolean) {
  if (curr == null || prev == null) return null;
  const d = curr - prev;
  const improved = higherIsBetter ? d > 0 : d < 0;
  return { d, improved, same: Math.abs(d) < 0.5 };
}

export function generateInsights(
  followup: Record<string, number | null>,
  prev: Record<string, number | null> | null,
  tempo: string,
  ligamentos?: string[],
  locale: Locale = "pt-BR",
): { type: "success" | "warning" | "info"; text: string }[] {
  const insights: { type: "success" | "warning" | "info"; text: string }[] = [];
  const f = followup;
  const isLcp = ligamentos?.includes("LCP");

  // LCP-specific period insights
  if (isLcp) {
    const t = normalizeTempo(tempo);
    if (t === "3 meses" || tempo.includes("90 dias")) {
      insights.push({ type: "info", text: "LCP 3 meses: fase de reabilitação inicial. Avaliar ADM, controle de edema e início do fortalecimento de isquiotibiais. Escalas opcionais (documentação)." });
    } else if (t === "6 meses" || tempo.includes("180 dias")) {
      insights.push({ type: "warning", text: "LCP 6 meses — PONTO CRÍTICO: realizar teste de gaveta posterior e radiografia de stress ajoelhada. Se translação posterior < 2 mm, liberar joelheira de extensão. Início obrigatório de fortalecimento de isquiotibiais." });
    } else if (t === "1 ano" || tempo.includes("12 meses")) {
      insights.push({ type: "info", text: "LCP 12 meses: avaliação crítica — Lysholm + IKDC + Tegner + testes funcionais (hop tests). Avaliar força isocinética (quadríceps e isquiotibiais). Decisão de retorno ao esporte competitivo." });
    } else if (t === "2 anos" || tempo.includes("24 meses")) {
      insights.push({ type: "warning", text: "LCP 24 meses: avaliação definitiva. Atenção: laxidez posterior pode aumentar do 3º mês até o follow-up final (>5 anos). Rastreamento de osteoartrite obrigatório." });
    } else if (t === "5 anos" || tempo.includes("60 meses")) {
      insights.push({ type: "info", text: "LCP 5 anos: rastreamento de osteoartrite e estabilidade a longo prazo. Reavaliar laxidez posterior comparativa ao pré-operatório." });
    } else if (tempo.toLowerCase().includes("pré") || tempo.toLowerCase().includes("pre")) {
      insights.push({ type: "info", text: "LCP pré-operatório: registrar Lysholm + IKDC + Tegner como baseline. Documentar teste de gaveta posterior e translação tibial posterior (radiografia de stress)." });
    }
  } else {
    // LCA / genérico period insights
    if (tempo.includes("3 meses")) {
      insights.push({ type: "info", text: "Avaliação de 3 meses: fase de proteção do enxerto. Prioridade: controle de dor/edema, amplitude de movimento e força do quadríceps." });
    } else if (tempo.includes("6 meses")) {
      insights.push({ type: "info", text: "Avaliação de 6 meses: fase de fortalecimento. Prioridade: fortalecimento neuromuscular, propriocepção e início de treinamento funcional." });
    } else if (tempo.includes("1 ano") || tempo.includes("12 meses")) {
      insights.push({ type: "info", text: "Avaliação de 1 ano: momento chave para decisão de retorno ao esporte. Critérios: IKDC ≥65, Lysholm ≥80, ACL-RSI ≥56, força ≥90% do membro contralateral." });
    } else if (tempo.includes("2 anos") || tempo.includes("24 meses")) {
      insights.push({ type: "info", text: "Avaliação de 2 anos: consolidação do resultado cirúrgico. Avaliar nível de atividade atual vs. pré-lesão." });
    } else if (tempo.includes("5 anos") || tempo.includes("60 meses")) {
      insights.push({ type: "info", text: "Avaliação de 5 anos: análise de resultado a longo prazo. Monitorar sinais de artrose (KOOS Sintomas) e manutenção do nível esportivo." });
    }
  }

  // Pain
  if (f.vasDor != null) {
    if (f.vasDor >= 7) insights.push({ type: "warning", text: "Dor intensa (VAS ≥ 7): considere revisão de analgesia, infiltração e fisioterapia intensiva. Descartar artrofibrose." });
    else if (f.vasDor <= 2) insights.push({ type: "success", text: "Dor bem controlada (VAS ≤ 2): evolução analgésica favorável." });
    if (prev?.vasDor != null && f.vasDor < prev.vasDor - 1) insights.push({ type: "success", text: `Redução significativa da dor: VAS caiu de ${prev.vasDor} para ${f.vasDor}.` });
    if (prev?.vasDor != null && f.vasDor > prev.vasDor + 1) insights.push({ type: "warning", text: `Piora da dor: VAS subiu de ${prev.vasDor} para ${f.vasDor}. Investigar causa (artrofibrose, lesão associada, infecção).` });
  }

  // IKDC
  if (f.ikdc != null) {
    if (f.ikdc >= 85) insights.push({ type: "success", text: "IKDC excelente (≥85): função do joelho plenamente recuperada." });
    else if (f.ikdc < 55) insights.push({ type: "warning", text: "IKDC < 55: função comprometida. Avaliar compliance com reabilitação, presença de complicações ou falha do enxerto." });
    if (prev?.ikdc != null && f.ikdc - prev.ikdc >= 10) insights.push({ type: "success", text: `Melhora expressiva no IKDC: +${(f.ikdc - prev.ikdc).toFixed(1)} pontos em relação ao follow-up anterior.` });
    if (prev?.ikdc != null && f.ikdc - prev.ikdc <= -5) insights.push({ type: "warning", text: `Queda no IKDC de ${Math.abs(f.ikdc - prev.ikdc).toFixed(1)} pontos. Monitorar e investigar causa da piora.` });
  }

  // Lysholm
  if (f.lysholm != null) {
    if (f.lysholm >= 91) insights.push({ type: "success", text: "Lysholm excelente (≥91): resultado clínico de alta qualidade." });
    else if (f.lysholm < 65) insights.push({ type: "warning", text: "Lysholm < 65 (resultado ruim): considerar revisão do protocolo de reabilitação ou reavaliação cirúrgica." });
  }

  // ACL-RSI
  if (f.aclRsi != null) {
    if (f.aclRsi < 56) insights.push({ type: "warning", text: "ACL-RSI < 56: paciente não psicologicamente pronto para retorno ao esporte. Indicar acompanhamento com psicólogo do esporte." });
    else if (f.aclRsi >= 77) insights.push({ type: "success", text: "ACL-RSI ≥ 77: paciente psicologicamente pronto para retorno ao esporte (critério de Webster et al.)." });
    else if (f.aclRsi >= 56) insights.push({ type: "info", text: "ACL-RSI 56–76: prontidão psicológica moderada. Manter acompanhamento e trabalho de confiança no membro." });
  }

  // Marx
  if (f.marx != null) {
    if (f.marx <= 4) insights.push({ type: "info", text: "Nível de atividade baixo (Marx ≤ 4): estimular retorno progressivo ao esporte." });
    else if (f.marx >= 14) insights.push({ type: "success", text: "Nível de atividade muito alto (Marx ≥ 14): excelente retorno funcional." });
  }

  // KOOS-12
  if ((f as any).koos12 != null && (f as any).koos12 < 45) insights.push({ type: "warning", text: "KOOS-12 < 45: limitação funcional grave. Revisar protocolo de reabilitação e descartar complicações." });
  else if ((f as any).koos12 != null && (f as any).koos12 < 65) insights.push({ type: "info", text: "KOOS-12 entre 45–65: limitação moderada — monitorar evolução e intensificar fisioterapia." });

  // Benchmark comparisons
  const benchIkdc = getBenchmark(tempo, "ikdc", ligamentos);
  if (f.ikdc != null && benchIkdc) {
    const status = getBenchmarkStatus(f.ikdc, benchIkdc, true);
    if (status === "below") insights.push({ type: "warning", text: `IKDC ${f.ikdc.toFixed(0)} está abaixo do esperado para ${tempo} (referência: ${benchIkdc.label}). Revisar protocolo de reabilitação.` });
    else if (status === "above") insights.push({ type: "success", text: `IKDC ${f.ikdc.toFixed(0)} está acima do esperado para ${tempo} (referência: ${benchIkdc.label}). Evolução acima da média.` });
  }

  if (insights.length === 1) insights.push({ type: "info", text: "Nenhuma escala clínica registrada nesta avaliação." });
  return insights.map((insight) => ({ ...insight, text: followupInsightText(locale, insight.text) }));
}

export function interpretFollowupScale(scaleKey: string, value: number, locale: Locale = "pt-BR") {
  const scale = SCALES.find((item) => item.key === scaleKey);
  if (!scale) return null;
  const interpretation = scale.interpret(value);
  return { ...interpretation, text: followupAuthoredText(locale, interpretation.text) };
}

// ─── PDF Export ───────────────────────────────────────────────────────────────

export function exportPdf(
  followup: FollowupReportFollowup,
  previousFollowup: FollowupReportFollowup | null,
  allFollowups: FollowupReportFollowup[],
  surgeryContext?: SurgeryContext,
  locale: Locale = "pt-BR",
) {
  const f = followup as unknown as Record<string, number | null | string | boolean | undefined>;
  const p = previousFollowup as unknown as Record<string, number | null | string | boolean | undefined> | null;

  const ligamentos = surgeryContext?.ligamentosAcometidos;
  const presentScales = SCALES.filter(s => f[s.key] != null);
  const insights = generateInsights(
    Object.fromEntries(SCALES.map(s => [s.key, f[s.key] as number | null])),
    p ? Object.fromEntries(SCALES.map(s => [s.key, p[s.key] as number | null])) : null,
    followup.tempo,
    ligamentos,
    locale,
  );

  const benchmarkRows = presentScales.map(s => {
    const val = f[s.key] as number;
    const bench = getBenchmark(followup.tempo, s.key, ligamentos);
    const status = bench ? getBenchmarkStatus(val, bench, s.higherIsBetter) : null;
    const statusLabel = !bench ? "—" : status === "within" ? `✓ ${followupReportText(locale, "withinExpected")}` : status === "above" ? `↑ ${followupReportText(locale, "aboveExpected")}` : `↓ ${followupReportText(locale, "belowExpected")}`;
    const deltaObj = p ? delta(val, p[s.key] as number | null, s.higherIsBetter) : null;
    const deltaStr = !deltaObj ? "—" : deltaObj.same ? followupReportText(locale, "stable") : `${deltaObj.d > 0 ? "+" : ""}${s.max === 10 ? deltaObj.d.toFixed(1) : Math.round(deltaObj.d)} (${followupReportText(locale, deltaObj.improved ? "improvement" : "worsening")})`;
    return { label: followupAuthoredText(locale, s.label), val: s.max === 10 ? val.toFixed(1) : Math.round(val), max: s.max, bench: bench ? followupAuthoredText(locale, bench.label) : "—", status: statusLabel, statusKind: status, delta: deltaStr };
  });
  const categorizedComplications = categorizeFollowupComplications(followup.complicacoes);
  const complicationGroups = [
    { label: followupReportText(locale, "acuteGroup"), items: categorizedComplications.agudas },
    { label: followupReportText(locale, "lateGroup"), items: categorizedComplications.tardias },
    { label: followupReportText(locale, "uncategorizedGroup"), items: categorizedComplications.gerais },
  ].filter((group) => group.items.length > 0);
  const escapeHtml = (value: string) => value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  const now = new Date();
  const html = `<!DOCTYPE html>
<html lang="${locale}">
<head>
<meta charset="utf-8"/>
<title>${documentText(locale, "clinicalReport")} — ${followupPeriodText(locale, followup.tempo)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 12px; color: #1a1a1a; padding: 24px 32px; max-width: 860px; margin: auto; }
  h1 { font-size: 20px; font-weight: bold; color: #1e40af; margin-bottom: 2px; }
  h2 { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: #64748b; margin: 20px 0 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 12px; }
  .header-left h1 { margin-bottom: 4px; }
  .header-left p { color: #475569; font-size: 11px; margin-top: 2px; }
  .header-right { text-align: right; font-size: 11px; color: #475569; }
  .meta-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 16px; }
  .meta-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 10px; }
  .meta-box .label { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: #94a3b8; margin-bottom: 2px; }
  .meta-box .value { font-weight: 600; color: #1e293b; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 6px; }
  th { background: #f1f5f9; text-align: left; padding: 6px 8px; color: #475569; font-weight: 600; border: 1px solid #e2e8f0; }
  td { padding: 6px 8px; border: 1px solid #e2e8f0; vertical-align: middle; }
  tr:nth-child(even) td { background: #f8fafc; }
  .within { color: #16a34a; font-weight: 600; }
  .above { color: #2563eb; font-weight: 600; }
  .below { color: #dc2626; font-weight: 600; }
  .insight { display: flex; gap: 8px; padding: 7px 10px; border-radius: 5px; margin-bottom: 5px; font-size: 11px; }
  .insight.success { background: #f0fdf4; border: 1px solid #bbf7d0; color: #15803d; }
  .insight.warning { background: #fffbeb; border: 1px solid #fde68a; color: #b45309; }
  .insight.info { background: #eff6ff; border: 1px solid #bfdbfe; color: #1d4ed8; }
  .icon { font-size: 13px; }
  .footnote { margin-top: 24px; font-size: 10px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 8px; }
  .event-box { padding: 7px 10px; border-radius: 5px; margin-bottom: 5px; font-size: 11px; }
  .event-success { background: #f0fdf4; border: 1px solid #bbf7d0; color: #15803d; }
  .event-danger { background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; }
  .toolbar { position: sticky; top: 0; z-index: 10; display: flex; gap: 8px; justify-content: space-between; align-items: center; background: #1e40af; margin: -24px -32px 16px; padding: 10px 16px; padding-top: calc(10px + env(safe-area-inset-top)); }
  .toolbar button { font-size: 14px; font-weight: 600; min-height: 44px; padding: 8px 16px; border: none; border-radius: 8px; cursor: pointer; -webkit-appearance: none; }
  .toolbar .btn-back { background: rgba(255,255,255,.18); color: #fff; }
  .toolbar .btn-print { background: #fff; color: #1e40af; }
  @media print { body { padding: 16px; } .no-print { display: none !important; } }
</style>
</head>
<body>
<div class="toolbar no-print">
  <button type="button" class="btn-back" onclick="window.close();setTimeout(function(){if(!window.closed&&history.length>1){history.back();}},150);">&lsaquo; ${documentText(locale, "back")}</button>
  <button type="button" class="btn-print" onclick="window.print()">${documentText(locale, "savePdfPrint")}</button>
</div>
<div class="header">
  <div class="header-left">
    <h1>${documentText(locale, "clinicalReport")}</h1>
    <p>${followupReportText(locale, "followup")}: <strong>${followupPeriodText(locale, followup.tempo)}</strong>${followup.dataAvaliacao ? ` · ${documentText(locale, "assessedOn")}: ${documentDate(locale, followup.dataAvaliacao, { day: "2-digit", month: "2-digit", year: "numeric" })}` : ""}</p>
    ${previousFollowup ? `<p>${documentText(locale, "comparedWith")}: ${followupPeriodText(locale, previousFollowup.tempo)}</p>` : ""}
  </div>
  <div class="header-right">
    <div>${documentText(locale, "generatedOn")} ${documentDate(locale, now, { dateStyle: "short", timeStyle: "short" })}</div>
    ${surgeryContext?.patientNome ? `<div><strong>${followupReportText(locale, "patient")}:</strong> ${escapeHtml(surgeryContext.patientNome)}</div>` : ""}
    ${surgeryContext?.dataCirurgia ? `<div><strong>${followupReportText(locale, "surgeryDate")}:</strong> ${escapeHtml(surgeryContext.dataCirurgia)}</div>` : ""}
    ${surgeryContext?.ligamentosAcometidos?.length ? `<div><strong>${followupReportText(locale, "ligaments")}:</strong> ${surgeryContext.ligamentosAcometidos.map(escapeHtml).join(", ")}</div>` : ""}
    ${surgeryContext?.enxerto ? `<div><strong>${followupReportText(locale, "graft")}:</strong> ${escapeHtml(surgeryContext.enxerto)}</div>` : ""}
  </div>
</div>

${presentScales.length === 0 ? `<p style="color:#94a3b8;">${followupReportText(locale, "noScale")}</p>` : `
<h2>${followupReportText(locale, "assessedScales")}</h2>
<table>
  <thead>
    <tr>
       <th>${followupReportText(locale, "scale")}</th>
       <th>${followupReportText(locale, "result")}</th>
       <th>${followupReportText(locale, "referencePeriod", { period: followupPeriodText(locale, followup.tempo) })}</th>
       <th>${followupReportText(locale, "situation")}</th>
       <th>${followupReportText(locale, "previousVariation")}</th>
    </tr>
  </thead>
  <tbody>
    ${benchmarkRows.map(r => `
    <tr>
      <td><strong>${r.label}</strong></td>
      <td style="font-weight:700; font-size:13px;">${r.val}<span style="color:#94a3b8; font-size:10px;">/${r.max}</span></td>
      <td style="color:#64748b;">${r.bench}</td>
       <td class="${r.statusKind ?? ""}">${r.status}</td>
      <td>${r.delta}</td>
    </tr>`).join("")}
  </tbody>
</table>
`}

${(followup.retornoEsporte || followup.falha) ? `
<h2>${followupReportText(locale, "clinicalEvents")}</h2>
${followup.retornoEsporte ? `<div class="event-box event-success">✓ ${followupReportText(locale, "returnedSport", { detail: followup.nivelRetorno ? ": " + escapeHtml(followup.nivelRetorno) : "" })}</div>` : ""}
${followup.falha ? `<div class="event-box event-danger">⚠ ${followupReportText(locale, "failureRecorded", { detail: followup.falhaType ? ": " + escapeHtml(followup.falhaType) : "" })}</div>` : ""}
` : ""}

${complicationGroups.length > 0 ? `
<h2>${followupReportText(locale, "complications")}</h2>
${complicationGroups.map((group) => `
  <div class="event-box event-danger">
    <strong>${group.label}:</strong> ${group.items.map(escapeHtml).join("; ")}
  </div>
`).join("")}
` : ""}

<h2>${documentText(locale, "clinicalAnalysis")}</h2>
${insights.filter(i => i.type !== "info" || !i.text.startsWith("Avaliação")).slice(0, 10).map(ins => `
<div class="insight ${ins.type}">
  <span class="icon">${ins.type === "success" ? "✓" : ins.type === "warning" ? "⚠" : "ℹ"}</span>
  <span>${ins.text}</span>
</div>`).join("")}

${allFollowups.length >= 2 ? `
<h2>${followupReportText(locale, "scaleEvolution", { periods: allFollowups.map(fu => followupPeriodText(locale, fu.tempo)).join(" → ") })}</h2>
<table>
  <thead>
    <tr>
      <th>${followupReportText(locale, "scale")}</th>
      ${allFollowups.map(fu => `<th>${followupPeriodText(locale, fu.tempo)}</th>`).join("")}
    </tr>
  </thead>
  <tbody>
    ${SCALES.filter(s => allFollowups.some(fu => (fu as any)[s.key] != null)).map(s => `
    <tr>
      <td><strong>${followupAuthoredText(locale, s.label)}</strong></td>
      ${allFollowups.map(fu => {
        const v = (fu as any)[s.key];
        if (v == null) return "<td style='color:#94a3b8;'>—</td>";
        return `<td style="font-weight:600;">${s.max === 10 ? Number(v).toFixed(1) : Math.round(Number(v))}</td>`;
      }).join("")}
    </tr>`).join("")}
  </tbody>
</table>` : ""}

<div class="footnote">
  <p>${followupReportText(locale, "internalFootnote")}</p>
</div>
</body></html>`;

  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) { alert(followupReportText(locale, "allowPopups")); return; }
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 400);
}

// ─── Chart data builder ───────────────────────────────────────────────────────

function buildChartData(allFollowups: Record<string, number | null | string>[], locale: Locale = "pt-BR") {
  return allFollowups.map((f) => ({
    name: followupPeriodText(locale, String(f.tempo ?? "")),
    ikdc:    f.ikdc    as number | null,
    lysholm: f.lysholm as number | null,
    vasDor:  f.vasDor  as number | null,
    aclRsi:  f.aclRsi  as number | null,
    marx:    f.marx    as number | null,
    tegner:  f.tegner  as number | null,
    kujala:  f.kujala  as number | null,
    koos12:  (f as any).koos12  as number | null,
    womac:   (f as any).womac   as number | null,
    admFlexao:   (f as any).admFlexao   as number | null,
    admExtensao: (f as any).admExtensao as number | null,
  }));
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FollowupReportFollowup {
  id: number;
  tempo: string;
  dataAvaliacao?: string | null;
  ikdc?: number | null;
  lysholm?: number | null;
  tegner?: number | null;
  vasDor?: number | null;
  kujala?: number | null;
  aclRsi?: number | null;
  marx?: number | null;
  koos12?: number | null;
  womac?: number | null;
  admFlexao?: number | null;
  admExtensao?: number | null;
  complicacoes?: string[] | null;
  retornoEsporte?: boolean;
  nivelRetorno?: string | null;
  falha?: boolean;
  falhaType?: string | null;
  observacoes?: string | null;
}

interface SurgeryContext {
  patientNome?: string | null;
  dataCirurgia?: string | null;
  ligamentosAcometidos?: string[];
  enxerto?: string | null;
  tiposProcedimento?: string[];
  lado?: string | null;
  alinhamento?: string | null;
  procedimentosDetalhados?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  followup: FollowupReportFollowup;
  previousFollowup: FollowupReportFollowup | null;
  allFollowups: FollowupReportFollowup[];
  surgeryContext?: SurgeryContext;
}

// ─── Benchmark Status Badge ───────────────────────────────────────────────────

function BenchmarkBadge({ value, benchKey, tempo, higherIsBetter, ligamentos }: {
  value: number; benchKey: string; tempo: string; higherIsBetter: boolean; ligamentos?: string[];
}) {
  const rt = useScopedTranslations(followupReportMessages);
  const bench = getBenchmark(tempo, benchKey, ligamentos);
  if (!bench) return null;
  const status = getBenchmarkStatus(value, bench, higherIsBetter);
  if (status === "within") return (
    <span className="inline-flex items-center gap-0.5 text-xs text-emerald-600 dark:text-emerald-400">
      <Equal className="h-3 w-3" /> {rt("expected")}
    </span>
  );
  if (status === "above") return (
    <span className="inline-flex items-center gap-0.5 text-xs text-blue-600 dark:text-blue-400">
      <ArrowUp className="h-3 w-3" /> {rt("above")}
    </span>
  );
  return (
    <span className="inline-flex items-center gap-0.5 text-xs text-amber-600 dark:text-amber-400">
      <ArrowDown className="h-3 w-3" /> {rt("below")}
    </span>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function FollowupReport({ open, onClose, followup, previousFollowup, allFollowups, surgeryContext }: Props) {
  const t = useScopedTranslations(operationalCoreMessages);
  const rt = useScopedTranslations(followupReportMessages);
  const { locale } = useLanguage();
  const f = followup as unknown as Record<string, number | null | string | boolean | undefined>;
  const p = previousFollowup as unknown as Record<string, number | null | string | boolean | undefined> | null;
  const ligamentos = surgeryContext?.ligamentosAcometidos;
  const isLcp = ligamentos?.includes("LCP");

  const insights = generateInsights(
    Object.fromEntries(SCALES.map(s => [s.key, f[s.key] as number | null])),
    p ? Object.fromEntries(SCALES.map(s => [s.key, p[s.key] as number | null])) : null,
    followup.tempo,
    ligamentos,
    locale,
  );

  const presentScales = SCALES.filter(s => f[s.key] != null);
  const chartData = buildChartData(allFollowups as unknown as Record<string, number | null | string>[], locale);
  const hasChartData = allFollowups.length >= 2;

  // Scales that have at least 2 data points across all followups
  const scalesWithHistory = SCALES.filter(s =>
    allFollowups.filter(fu => (fu as unknown as Record<string, unknown>)[s.key] != null).length >= 2
  );

  // ADM data across all followups
  const admChartData = chartData.filter(d => d.admFlexao != null || d.admExtensao != null);
  const hasAdmData = admChartData.length >= 2;

  const benchmarkableScales = presentScales.filter(s => getBenchmark(followup.tempo, s.key, ligamentos) != null);
  const periodBench = (isLcp ? LCP_BENCHMARKS : BENCHMARKS)[normalizeTempo(followup.tempo)] ?? null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] p-0 overflow-hidden flex flex-col">
        <DialogHeader className="px-6 pt-5 pb-3 border-b shrink-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              <DialogTitle>{t("clinicalReport")} — {followupPeriodText(locale, followup.tempo)}</DialogTitle>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 shrink-0"
              onClick={() => exportPdf(followup, previousFollowup, allFollowups, surgeryContext, locale)}
            >
              <FileDown className="h-3.5 w-3.5" />
              {rt("exportPdf")}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 mt-1">
            {followup.dataAvaliacao && (
              <span className="text-sm text-muted-foreground">
                {rt("assessedOn")} {format(new Date(followup.dataAvaliacao), "dd/MM/yyyy")}
              </span>
            )}
            {previousFollowup && <span className="text-sm text-muted-foreground">· {rt("comparison")}: {followupPeriodText(locale, previousFollowup.tempo)}</span>}
            {surgeryContext?.ligamentosAcometidos?.length ? (
              <div className="flex gap-1">
                {surgeryContext.ligamentosAcometidos.map(l => (
                  <Badge key={l} variant="secondary" className="text-xs">{l}</Badge>
                ))}
              </div>
            ) : null}
          </div>
        </DialogHeader>

        <ScrollArea className="flex-1 overflow-y-auto">
          <div className="px-6 py-4 space-y-6">

            {/* ── Period context ── */}
            {periodBench && benchmarkableScales.length > 0 && (
              <section>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                  {rt("periodContext", { period: followupPeriodText(locale, followup.tempo) })}
                </h3>
                <div className="rounded-lg border bg-card overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/40 border-b">
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">{t("scale")}</th>
                        <th className="text-center px-3 py-2 font-medium text-muted-foreground">{t("result")}</th>
                        <th className="text-center px-3 py-2 font-medium text-muted-foreground">{t("literatureReference")}</th>
                        <th className="text-center px-3 py-2 font-medium text-muted-foreground">{t("situation")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {benchmarkableScales.map((s, i) => {
                        const val = f[s.key] as number;
                        const bench = getBenchmark(followup.tempo, s.key)!;
                        const status = getBenchmarkStatus(val, bench, s.higherIsBetter);
                        return (
                          <tr key={s.key} className={i % 2 === 0 ? "" : "bg-muted/20"}>
                            <td className="px-3 py-2 font-medium">{followupAuthoredText(locale, s.label)}</td>
                            <td className="px-3 py-2 text-center font-bold text-sm">
                              {s.max === 10 ? val.toFixed(1) : Math.round(val)}
                              <span className="text-muted-foreground font-normal text-xs">/{s.max}</span>
                            </td>
                              <td className="px-3 py-2 text-center text-muted-foreground">{followupAuthoredText(locale, bench.label)}</td>
                            <td className="px-3 py-2 text-center">
                              {status === "within" && (
                                <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                                  <Equal className="h-3 w-3" /> {rt("withinExpected")}
                                </span>
                              )}
                              {status === "above" && (
                                <span className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 font-medium">
                                  <ArrowUp className="h-3 w-3" /> {rt("aboveExpected")}
                                </span>
                              )}
                              {status === "below" && (
                                <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
                                  <ArrowDown className="h-3 w-3" /> {rt("belowExpected")}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <p className="text-xs text-muted-foreground px-3 py-2 bg-muted/20 border-t">
                    {rt("references")}: Lysholm &amp; Gillquist (1982); Webster et al. (2015); Ardern et al. (2011); Hambly &amp; Griva (2008).
                  </p>
                </div>
              </section>
            )}

            {/* ── Scale scores ── */}
            {presentScales.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{t("clinicalScales")}</h3>
                  <span className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 px-2 py-0.5 rounded-full font-medium">{t("patientAnswered")}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {presentScales.map((s) => {
                    const val = f[s.key] as number;
                    const { rating, text } = interpretFollowupScale(s.key, val, locale)!;
                    const style = RATING_STYLE[rating];
                    const d = p ? delta(val, p[s.key] as number | null, s.higherIsBetter) : null;
                    return (
                      <div key={s.key} className={`rounded-lg border p-3 ${style.bg} ${style.border}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${style.dot}`} />
                              <span className={`text-xs font-semibold ${style.text}`}>{followupAuthoredText(locale, s.label)}</span>
                            </div>
                            <p className="text-xs text-muted-foreground">{text}</p>
                            <div className="mt-1">
                              <BenchmarkBadge
                                value={val}
                                benchKey={s.key}
                                tempo={followup.tempo}
                                higherIsBetter={s.higherIsBetter}
                                ligamentos={ligamentos}
                              />
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <span className={`text-lg font-bold ${style.text}`}>
                              {s.max === 10 ? val.toFixed(1) : Math.round(val)}
                            </span>
                            <span className="text-xs text-muted-foreground">/{s.max}</span>
                            {d && !d.same && (
                              <div className={`flex items-center justify-end gap-0.5 text-xs mt-0.5 ${d.improved ? "text-emerald-600" : "text-red-500"}`}>
                                {d.improved ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                                <span>{d.d > 0 ? "+" : ""}{s.max === 10 ? d.d.toFixed(1) : Math.round(d.d)}</span>
                              </div>
                            )}
                            {d && d.same && (
                              <div className="flex items-center justify-end gap-0.5 text-xs mt-0.5 text-muted-foreground">
                                <Minus className="h-3 w-3" /><span>{t("stable")}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* ── Evolução por escala — gráficos individuais ── */}
            {hasChartData && scalesWithHistory.length > 0 && (
              <section>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">{t("scaleEvolution")}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {scalesWithHistory.map(s => {
                    const color = LINE_COLORS[s.key] ?? "#94a3b8";
                    const isVas = s.key === "vasDor";
                    const domainMin = 0;
                    const domainMax = s.max;
                    const reversed = !s.higherIsBetter;
                    return (
                      <div key={s.key} className="rounded-lg border bg-card p-3">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-1.5">
                            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: color }} />
                            <span className="text-xs font-semibold">{followupAuthoredText(locale, s.label)}</span>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {isVas ? rt("betterDown") : rt("betterUp", { max: s.max })}
                          </span>
                        </div>
                        <ResponsiveContainer width="100%" height={130}>
                          <LineChart
                            data={chartData.map(d => ({ name: d.name, value: d[s.key as keyof typeof d] as number | null }))}
                            margin={{ top: 4, right: 6, left: -18, bottom: 4 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                            <XAxis dataKey="name" tick={{ fontSize: 9 }} interval={0} />
                            <YAxis
                              domain={[domainMin, domainMax]}
                              reversed={reversed}
                              tick={{ fontSize: 9 }}
                              tickFormatter={(v) => s.max === 10 ? v.toFixed(1) : String(v)}
                            />
                            <Tooltip
                              contentStyle={{ fontSize: 11, borderRadius: 6, padding: "4px 8px" }}
                              formatter={(v: number) => [
                                s.max === 10 ? v.toFixed(1) : Math.round(v),
                                followupAuthoredText(locale, s.label),
                              ]}
                            />
                            {!isVas && <ReferenceLine y={70} stroke="#22c55e" strokeDasharray="4 4" strokeOpacity={0.35} />}
                            {isVas && <ReferenceLine y={4} stroke="#f59e0b" strokeDasharray="4 4" strokeOpacity={0.5} />}
                            <Line
                              type="monotone"
                              dataKey="value"
                              stroke={color}
                              strokeWidth={2}
                              dot={{ r: 3, fill: color }}
                              activeDot={{ r: 5 }}
                              connectNulls
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* ── Evolução do ADM ── */}
            {hasAdmData && (
              <section>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">{t("motionEvolution")}</h3>
                <div className="rounded-lg border bg-card p-4">
                  <div className="flex items-center gap-4 mb-3">
                    <div className="flex items-center gap-1.5">
                      <span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-500" />
                      <span className="text-xs text-muted-foreground">{t("flexionDegrees")}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="inline-block w-2.5 h-2.5 rounded-full bg-purple-500" />
                      <span className="text-xs text-muted-foreground">{t("extensionDegrees")}</span>
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={admChartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip
                        contentStyle={{ fontSize: 11, borderRadius: 6 }}
                        formatter={(v: number, name: string) => [
                          `${v}°`,
                           name === "admFlexao" ? rt("flexion") : rt("extension"),
                        ]}
                      />
                      <ReferenceLine y={90} stroke="#22c55e" strokeDasharray="4 4" strokeOpacity={0.4} label={{ value: rt("flexionTarget"), fontSize: 9, fill: "#22c55e" }} />
                      <Line type="monotone" dataKey="admFlexao" name="admFlexao" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} connectNulls activeDot={{ r: 6 }} />
                      <Line type="monotone" dataKey="admExtensao" name="admExtensao" stroke="#a855f7" strokeWidth={2} dot={{ r: 4 }} connectNulls activeDot={{ r: 6 }} strokeDasharray="5 3" />
                    </LineChart>
                  </ResponsiveContainer>
                  <p className="text-xs text-muted-foreground mt-2 text-center">{t("flexionGoalLegend")}</p>
                </div>
              </section>
            )}

            {/* ── Clinical insights ── */}
            <section>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">{t("clinicalAnalysis")}</h3>
              <div className="space-y-2">
                {insights.map((ins, i) => (
                  <div key={i} className={`flex gap-2.5 p-3 rounded-lg border text-sm ${
                    ins.type === "success" ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800" :
                    ins.type === "warning" ? "bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800" :
                    "bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800"
                  }`}>
                    {ins.type === "success" && <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />}
                    {ins.type === "warning" && <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />}
                    {ins.type === "info" && <Info className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />}
                    <span className={
                      ins.type === "success" ? "text-emerald-800 dark:text-emerald-300" :
                      ins.type === "warning" ? "text-amber-800 dark:text-amber-300" :
                      "text-blue-800 dark:text-blue-300"
                    }>{ins.text}</span>
                  </div>
                ))}
              </div>
            </section>

            {/* ── Avaliação pelo Médico ── */}
            {(followup.retornoEsporte || followup.falha || followup.admFlexao != null || followup.admExtensao != null || (followup.complicacoes && followup.complicacoes.length > 0) || followup.observacoes) && (
              <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700">
                  <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wide">{t("clinicalEvaluation")}</h3>
                  <span className="text-xs bg-slate-700 text-white dark:bg-slate-300 dark:text-slate-900 px-2 py-0.5 rounded-full font-medium">{t("doctor")}</span>
                </div>
                <div className="p-4 space-y-4">

                  {/* Eventos clínicos */}
                  {(followup.retornoEsporte || followup.falha) && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("events")}</p>
                      {followup.retornoEsporte && (
                        <div className="flex gap-2.5 p-3 rounded-lg border bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800">
                          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                          <span className="text-sm text-emerald-800 dark:text-emerald-300">
                            {rt("returnedSport", { detail: followup.nivelRetorno ? `: ${followup.nivelRetorno}` : "" })}
                          </span>
                        </div>
                      )}
                      {followup.falha && (
                        <div className="flex gap-2.5 p-3 rounded-lg border bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800">
                          <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                          <span className="text-sm text-red-800 dark:text-red-300">
                            {rt("failureRecorded", { detail: followup.falhaType ? `: ${followup.falhaType}` : "" })}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ADM */}
                  {(followup.admFlexao != null || followup.admExtensao != null) && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{t("motionRange")}</p>
                      <div className="flex gap-4 p-3 rounded-lg border bg-blue-50 border-blue-200">
                        {followup.admFlexao != null && (
                          <div>
                            <span className="text-xs text-blue-600">{t("flexion")}</span>
                            <p className="text-lg font-bold text-blue-800">{followup.admFlexao}°</p>
                          </div>
                        )}
                        {followup.admExtensao != null && (
                          <div>
                            <span className="text-xs text-blue-600">{t("extension")}</span>
                            <p className="text-lg font-bold text-blue-800">{followup.admExtensao}°</p>
                          </div>
                        )}
                        {followup.admFlexao != null && followup.admExtensao != null && (
                          <div className="ml-auto flex items-center">
                            <span className={`text-xs font-bold px-2 py-1 rounded-full ${followup.admFlexao >= 90 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                              {followup.admFlexao >= 120 ? rt("excellent") : followup.admFlexao >= 90 ? rt("adequate") : rt("belowExpected")}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Complicações */}
                  {followup.complicacoes && followup.complicacoes.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-red-600 uppercase tracking-wide mb-2">{t("registeredComplications")}</p>
                      <div className="space-y-2">
                        {followup.complicacoes.map(code => {
                          const COMPLICATIONS_MAP: Record<string, { nome: string; momento: string; sinais: string }> = {
                            "NEURO-01": { nome: "Lesão nervo fibular",         momento: "Intraop.",         sinais: "Pé em equino, parestesia dorso-pé" },
                            "NEURO-02": { nome: "Lesão nervo safeno",          momento: "Intraop.",         sinais: "Parestesia medial joelho" },
                            "VASCU-01": { nome: "Lesão vascular",              momento: "Intraop.",         sinais: "Isquemia, hematoma expansivo" },
                            "TROM-01":  { nome: "TEP / TVP",                   momento: "Pós-op",           sinais: "Dispneia, edema, dor na perna" },
                            "TROM-02":  { nome: "Hematoma",                    momento: "Pós-op imediato",  sinais: "Dor, tensão, equimose" },
                            "INFEC-01": { nome: "Infecção superficial",        momento: "Pós-op",           sinais: "Calor, rubor, drenagem" },
                            "INFEC-02": { nome: "Infecção profunda (PJI)",     momento: "Pós-op",           sinais: "Dor, febre, PCR elevado" },
                            "MECA-01":  { nome: "Instabilidade de componente", momento: "Tardio",           sinais: "Dor, desvio em varo/valgo" },
                            "MECA-02":  { nome: "Fratura periprotética",       momento: "Tardio",           sinais: "Dor aguda, deformidade" },
                            "OSSO-01":  { nome: "Afundamento de componente",   momento: "Tardio",           sinais: "Dor progressiva, alteração RX" },
                            "RIGI-01":  { nome: "Rigidez articular",           momento: "Pós-op",           sinais: "ADM < 90° após 3 meses" },
                          };
                          const comp = COMPLICATIONS_MAP[code];
                          const parsed = parseFollowupComplication(code);
                          const categoryLabel = parsed.category === "aguda"
                            ? rt("acute30")
                            : parsed.category === "tardia"
                              ? rt("late30")
                              : comp ? followupAuthoredText(locale, comp.momento) : undefined;
                          return (
                            <div key={code} className="flex gap-3 p-3 rounded-lg border bg-red-50 border-red-200">
                              <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                              <div>
                                <div className="flex items-center gap-2">
                                  {parsed.category === "geral" && comp && (
                                    <span className="text-xs font-mono font-bold text-red-700">{code}</span>
                                  )}
                                  <span className="text-sm font-medium text-red-900">{comp ? followupAuthoredText(locale, comp.nome) : parsed.label}</span>
                                  {categoryLabel && <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded">{categoryLabel}</span>}
                                </div>
                                {comp && <p className="text-xs text-red-700 mt-0.5">{followupAuthoredText(locale, comp.sinais)}</p>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Observações */}
                  {followup.observacoes && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{t("observations")}</p>
                      <p className="text-sm text-muted-foreground bg-white dark:bg-slate-900 p-3 rounded-lg border">{followup.observacoes}</p>
                    </div>
                  )}

                </div>
              </section>
            )}

          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FullReport — todas as avaliações combinadas
// ─────────────────────────────────────────────────────────────────────────────

const COMPLICATIONS_MAP: Record<string, { nome: string; momento: string }> = {
  "NEURO-01": { nome: "Lesão nervo fibular",         momento: "Intraop." },
  "NEURO-02": { nome: "Lesão nervo safeno",          momento: "Intraop." },
  "VASCU-01": { nome: "Lesão vascular",              momento: "Intraop." },
  "TROM-01":  { nome: "TEP / TVP",                   momento: "Pós-op" },
  "TROM-02":  { nome: "Hematoma",                    momento: "Pós-op imediato" },
  "INFEC-01": { nome: "Infecção superficial",        momento: "Pós-op" },
  "INFEC-02": { nome: "Infecção profunda (PJI)",     momento: "Pós-op" },
  "MECA-01":  { nome: "Instabilidade de componente", momento: "Tardio" },
  "MECA-02":  { nome: "Fratura periprotética",       momento: "Tardio" },
  "OSSO-01":  { nome: "Afundamento de componente",   momento: "Tardio" },
  "RIGI-01":  { nome: "Rigidez articular",           momento: "Pós-op" },
  "PAT-INST": { nome: "Instabilidade recorrente",    momento: "Tardio" },
  "PAT-FRAT": { nome: "Fratura patelar",             momento: "Tardio" },
  "PAT-RIGI": { nome: "Limitação de flexão",         momento: "Pós-op" },
  "PAT-DOR":  { nome: "Dor persistente",             momento: "Tardio" },
  "PAT-INF":  { nome: "Complicação infecciosa",      momento: "Pós-op" },
  "PAT-NFIB": { nome: "Neuropraxia nervo fibular",   momento: "Intraop./Pós-op" },
  "PAT-HEMA": { nome: "Hematoma",                    momento: "Pós-op imediato" },
  "PAT-REOP": { nome: "Reoperação necessária",       momento: "Tardio" },
  "OC-HEMA":  { nome: "Hemartrose",                        momento: "0–14 dias" },
  "OC-INFS":  { nome: "Infecção superficial",              momento: "0–30 dias" },
  "OC-INFP":  { nome: "Infecção articular profunda",       momento: "15–30 dias" },
  "OC-TVP":   { nome: "Trombose Venosa Profunda (TVP)",    momento: "0–30 dias" },
  "OC-RIGI":  { nome: "Rigidez articular",                 momento: "15–60 dias" },
  "OC-SOLT":  { nome: "Soltura do enxerto (OATS/OCA)",     momento: "15–90 dias" },
  "OC-FALC":  { nome: "Falha de consolidação do enxerto",  momento: "1–6 meses" },
  "OC-SOBR":  { nome: "Sobrecrescimento ósseo",            momento: "1–3 meses" },
  "OC-DELA":  { nome: "Delaminação da fibrocartilagem",    momento: "1–6 meses" },
  "OC-DOAD":  { nome: "Dor no sítio doador (OATS)",        momento: "1–12 meses" },
  "OC-FALT":  { nome: "Falha tardia do reparo",            momento: "6–24 meses" },
  "OC-PROG":  { nome: "Progressão para osteoartrose",      momento: ">6 meses" },
  "LCM-LAXR": { nome: "Falha de reparo / Laxidade residual medial",  momento: "3–24 meses" },
  "LCM-RIGI": { nome: "Rigidez articular / Perda de flexão",         momento: "2–12 semanas" },
  "LCM-NSAF": { nome: "Lesão de nervo safeno",                       momento: "0–30 dias" },
  "LCM-TUNN": { nome: "Síndrome do Túnel / Dor medial persistente",  momento: "2–12 semanas" },
  "LCM-OSSF": { nome: "Heterotopificação / Ossificação",             momento: "2–6 meses" },
  "LCM-INFP": { nome: "Infecção articular profunda",                 momento: "7–30 dias" },
  "LCM-MENI": { nome: "Lesão meniscal medial associada",             momento: "6–24 meses" },
  "LCM-DEGM": { nome: "Degeneração articular medial",               momento: "12–60 meses" },
  "LCM-FALH": { nome: "Falha de enxerto (reconstruções)",            momento: "6–24 meses" },
  "LCM-VASC": { nome: "Lesão de artéria poplítea",                  momento: "0–7 dias" },
  "CPL-FALH": { nome: "Falha de enxerto / Ruptura recidivante",  momento: "6–24 meses" },
  "CPL-NPER": { nome: "Lesão de nervo peroneal comum",           momento: "0–30 dias" },
  "CPL-RIGI": { nome: "Rigidez articular / Perda de rotação",   momento: "2–12 semanas" },
  "CPL-LAXR": { nome: "Laxidade residual postero-lateral",      momento: "6–24 meses" },
  "CPL-VASC": { nome: "Lesão vascular poplítea",                momento: "0–7 dias" },
  "CPL-TUNE": { nome: "Síndrome do Túnel",                      momento: "2–6 semanas" },
  "CPL-DEGL": { nome: "Degeneração articular lateral",          momento: "12–60 meses" },
  "CPL-INFP": { nome: "Infecção articular profunda",            momento: "7–30 dias" },
  "MEN-FALH": { nome: "Falha de consolidação / Ruptura recidivante", momento: "3–12 meses" },
  "MEN-INFP": { nome: "Infecção articular profunda",                 momento: "7–30 dias" },
  "MEN-NSAF": { nome: "Lesão de nervo safeno",                       momento: "0–30 dias" },
  "MEN-NPER": { nome: "Lesão de nervo peroneal",                     momento: "0–30 dias" },
  "MEN-RIGI": { nome: "Rigidez articular / Artrofibrose",            momento: "2–8 semanas" },
  "MEN-TUNE": { nome: "Síndrome do Túnel",                           momento: "2–6 semanas" },
  "MEN-CART": { nome: "Lesão de cartilagem adjacente",               momento: "6–24 meses" },
  "MEN-EFUS": { nome: "Efusão articular persistente / Sinovite",     momento: "2–12 semanas" },
  "LCP-FALH": { nome: "Falha de enxerto / Ruptura",          momento: "3–24 meses" },
  "LCP-RIGI": { nome: "Rigidez articular / Artrofibrose",    momento: "2–12 semanas" },
  "LCP-LAXR": { nome: "Laxidade residual posterior",         momento: "6–24 meses" },
  "LCP-NPER": { nome: "Lesão de nervo peroneal",             momento: "0–30 dias" },
  "LCP-DEGM": { nome: "Degeneração articular medial",        momento: "12–60 meses" },
  "LCP-INFP": { nome: "Infecção articular profunda",         momento: "7–30 dias" },
  "LCP-VASC": { nome: "Lesão vascular poplítea",             momento: "0–7 dias" },
  "LCP-MENI": { nome: "Lesão meniscal posterior",            momento: "6–24 meses" },
  "LCA-DOR":  { nome: "Dor refratária",                          momento: "0–14 dias" },
  "LCA-HEMA": { nome: "Hemartrose",                              momento: "0–14 dias" },
  "LCA-INFS": { nome: "Infecção superficial",                    momento: "0–30 dias" },
  "LCA-INFP": { nome: "Infecção articular profunda",             momento: "7–30 dias" },
  "LCA-TVP":  { nome: "Trombose Venosa Profunda (TVP)",          momento: "0–30 dias" },
  "LCA-TEP":  { nome: "Embolia Pulmonar",                        momento: "0–30 dias" },
  "LCA-RIGI": { nome: "Rigidez articular / Artrofibrose",        momento: "2–12 semanas" },
  "LCA-TUNE": { nome: "Síndrome do Túnel",                       momento: "2–6 semanas" },
  "LCA-NSAF": { nome: "Lesão de nervo safeno",                   momento: "0–30 dias" },
  "LCA-FALH": { nome: "Falha de enxerto / Ruptura",              momento: "3–24 meses" },
  "LCA-CICA": { nome: "Cicatriz hipertrófica / Queloide",        momento: "1–6 meses" },
  "LCA-SINO": { nome: "Sinovite reativa",                        momento: "2–8 semanas" },
  "LCA-MENI": { nome: "Lesão meniscal associada",                momento: "3–12 meses" },
  "LCA-CART": { nome: "Lesão de cartilagem",                     momento: "6–24 meses" },
  "LCA-FRAT": { nome: "Fratura do túnel (tíbia/fêmur)",          momento: "0–6 semanas" },
  "LCA-LAXR": { nome: "Laxidade residual / Instabilidade",       momento: "6–24 meses" },
  "LCA-RETP": { nome: "Retorno precoce à atividade",             momento: "3–12 meses" },
  "LCA-ATRO": { nome: "Atrofia muscular persistente",            momento: "1–6 meses" },
  "LCA-PATF": { nome: "Dor patelofemoral",                       momento: "2–12 meses" },
  "LCA-SDRC": { nome: "Síndrome Dolorosa Regional Complexa",     momento: "2–12 semanas" },
};


interface FullReportProps {
  open: boolean;
  onClose: () => void;
  followups: FollowupReportFollowup[];
  surgeryContext?: SurgeryContext;
}

function buildFullSurgeryName(ctx?: SurgeryContext, locale: Locale = "pt-BR"): string {
  const tipos = ctx?.tiposProcedimento ?? [];
  if (!tipos.length) return "—";
  const TYPE_MAP: Record<string, string> = {
    "TKA": "Artroplastia Total do Joelho (ATJ)",
    "UKA": "Artroplastia Unicompartimental do Joelho (UKA)",
    "PKA": "Artroplastia Patelofemoral (PKA)",
    "Revisao": "Revisão de Artroplastia",
  };
  const COMP_MAP: Record<string, string> = {
    "Tricompartimental": "Artroplastia Total do Joelho (ATJ)",
    "Unicompartimental": "Artroplastia Unicompartimental do Joelho (UKA)",
  };
  const labels = tipos.map((t) => {
    if (t === "Artroplastias") {
      try {
        const d = JSON.parse(ctx?.procedimentosDetalhados ?? "{}");
        const atj = d.artroplastia;
        if (atj?.tipo && TYPE_MAP[atj.tipo]) return TYPE_MAP[atj.tipo];
        if (atj?.compartimento && COMP_MAP[atj.compartimento]) return COMP_MAP[atj.compartimento];
        return "Artroplastia do Joelho";
      } catch { return "Artroplastia do Joelho"; }
    }
    return t;
  });
  return labels.map((label) => followupAuthoredText(locale, label)).join(" · ");
}

export function FollowupFullReport({ open, onClose, followups, surgeryContext }: FullReportProps) {
  const t = useScopedTranslations(operationalCoreMessages);
  const rt = useScopedTranslations(followupReportMessages);
  const { locale } = useLanguage();
  const contentRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const [pdfShareUrl, setPdfShareUrl] = useState<string | null>(null);
  const [ladoOverride, setLadoOverride] = useState<string>(
    surgeryContext?.lado || ""
  );

  if (!followups.length) return null;

  const chartData = followups.length ? buildChartData(followups as unknown as Record<string, number | null | string>[], locale) : [];
  const scalesWithAnyData = SCALES.filter(s => followups.some(fu => (fu as unknown as Record<string, unknown>)[s.key] != null));
  const scalesWithHistory = SCALES.filter(s => followups.filter(fu => (fu as unknown as Record<string, unknown>)[s.key] != null).length >= 2);
  const admChartData = chartData.filter(d => d.admFlexao != null || d.admExtensao != null);
  const hasAdmData = admChartData.length >= 2;
  const eventsFollowups = followups.filter(fu => fu.retornoEsporte || fu.falha || (fu.complicacoes && fu.complicacoes.length > 0) || fu.observacoes);

  const TABLE_BG: Record<string, string> = {
    excellent: "bg-emerald-50 text-emerald-800",
    good:      "bg-blue-50 text-blue-800",
    fair:      "bg-amber-50 text-amber-800",
    poor:      "bg-red-50 text-red-800",
    alert:     "bg-red-50 text-red-800",
  };

  const handleExportPdf = async () => {
    if (pdfShareUrl) {
      handlePdfOpenClick(pdfShareUrl, () => setPdfShareUrl(null));
      return;
    }
    const el = contentRef.current;
    if (!el) return;
    setExporting(true);
    try {
      const fullWidth = el.scrollWidth;
      const fullHeight = el.scrollHeight;

      const dataUrl = await toJpeg(el, {
        quality: 0.95,
        backgroundColor: "#ffffff",
        pixelRatio: 2,
        skipFonts: true,
        width: fullWidth,
        height: fullHeight,
        style: {
          overflow: "visible",
          height: `${fullHeight}px`,
          width: `${fullWidth}px`,
        },
      });

      const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 24;
      const usableW = pageW - margin * 2;
      const usableH = pageH - margin * 2;

      const imgW = usableW;
      const imgH = (fullHeight * imgW) / fullWidth;
      const totalPages = Math.ceil(imgH / usableH);

      for (let i = 0; i < totalPages; i++) {
        if (i > 0) pdf.addPage();
        pdf.addImage(
          dataUrl,
          "JPEG",
          margin,
          margin - i * usableH,
          imgW,
          imgH,
        );
      }

      const patName = (surgeryContext?.patientNome ?? "paciente").replace(/\s+/g, "_");
      await sharePdfOrDownload(
        pdf,
        `RelatorioCompleto_${patName}_${format(new Date(), "dd-MM-yyyy")}.pdf`,
        setPdfShareUrl,
      );
    } catch (err) {
      console.error("Erro ao gerar PDF do relatório completo:", err);
      alert(rt("pdfError"));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl max-h-[93vh] p-0 overflow-hidden flex flex-col">
        <DialogHeader className="px-6 pt-5 pb-3 border-b shrink-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              <DialogTitle>{t("clinicalReportComplete")}</DialogTitle>
            </div>
            <Button
              size="sm" variant="outline" className="gap-1.5 shrink-0"
              onClick={handleExportPdf}
              disabled={exporting}
            >
              {exporting ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("generatingPdf")}</>
              ) : (
                 <><FileDown className="h-3.5 w-3.5" /> {pdfShareUrl ? rt("openPdf") : rt("exportPdf")}</>
              )}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-2 text-sm text-muted-foreground">
            {surgeryContext?.patientNome && <span className="font-medium text-foreground">{surgeryContext.patientNome}</span>}
            {surgeryContext?.dataCirurgia && <span>{rt("surgery")} {format(new Date(surgeryContext.dataCirurgia), "dd/MM/yyyy")}</span>}
            <span>{rt("generatedEvaluations", { count: followups.length })}</span>
            {surgeryContext?.ligamentosAcometidos?.length ? (
              <div className="flex gap-1">
                {surgeryContext.ligamentosAcometidos.map(l => <Badge key={l} variant="secondary" className="text-xs">{l}</Badge>)}
              </div>
            ) : null}

            {/* Lado da cirurgia — sempre editável no diálogo */}
            <div className="flex items-center gap-1.5 ml-auto">
              <span className={`text-xs font-semibold ${!ladoOverride ? "text-amber-600" : "text-muted-foreground"}`}>
                 {!ladoOverride ? rt("informSide") : rt("side")}
              </span>
              <div className="flex gap-1">
                {["Direito", "Esquerdo"].map(opt => (
                  <button
                    key={opt}
                    onClick={() => setLadoOverride(ladoOverride === opt ? "" : opt)}
                    className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border transition-colors ${
                      ladoOverride === opt
                        ? "bg-[#1A365D] text-white border-[#1A365D]"
                        : "bg-white text-[#1A365D] border-[#1A365D]/40 hover:border-[#1A365D]"
                    }`}
                  >
                    {opt === "Direito" ? rt("right") : rt("left")}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </DialogHeader>

        <ScrollArea className="flex-1 overflow-y-auto">
          <div ref={contentRef} className="px-6 py-4 space-y-6 bg-white">

            {/* ── Cabeçalho de identificação (capturado no PDF) ── */}
            {(() => {
              const ladoCirurgia =
                ladoOverride ||
                (["Direito", "Esquerdo"].includes(surgeryContext?.alinhamento ?? "")
                  ? surgeryContext?.alinhamento
                  : null);
              return (
                <div className="rounded-xl border border-[#1A365D]/20 bg-[#1A365D] text-white px-6 py-4 flex flex-col gap-1.5">
                  <div className="text-xs font-semibold uppercase tracking-widest text-[#1FB6E1] mb-1">{t("followupClinicalReport")}</div>
                  <div className="text-xl font-bold leading-tight tracking-wide uppercase">
                    {(surgeryContext?.patientNome ?? "—").toUpperCase()}
                  </div>
                  <div className="flex flex-wrap gap-x-6 gap-y-1 mt-1 text-sm text-white/90">
                    <span>
                      <span className="text-white/60 font-medium mr-1">{t("surgery")}</span>
                      {buildFullSurgeryName(surgeryContext, locale)}
                    </span>
                    {ladoCirurgia && (
                      <span>
                        <span className="text-white/60 font-medium mr-1">{t("side")}</span>
                        {ladoCirurgia}
                      </span>
                    )}
                    {surgeryContext?.dataCirurgia && (
                      <span>
                        <span className="text-white/60 font-medium mr-1">{t("surgeryDate")}</span>
                        {format(new Date(surgeryContext.dataCirurgia), "dd/MM/yyyy")}
                      </span>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* ── Sem follow-ups ainda ── */}
            {!followups.length && (
              <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/10 px-6 py-5 text-center text-sm text-muted-foreground">
                {rt("noPostop")}
              </div>
            )}

            {/* ── Tabela resumo ── */}
            {followups.length > 0 && (
              <section>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">{t("allEvaluationsSummary")}</h3>
              <div className="rounded-lg border bg-card overflow-x-auto">
                <table className="w-full text-xs min-w-max">
                  <thead>
                    <tr className="bg-muted/50 border-b">
                      <th className="text-left px-3 py-2 font-semibold text-muted-foreground sticky left-0 bg-muted/50">{t("scale")}</th>
                      {followups.map(fu => (
                        <th key={fu.id} className="text-center px-3 py-2 font-semibold text-muted-foreground whitespace-nowrap min-w-[90px]">
                          <div>{followupPeriodText(locale, fu.tempo)}</div>
                          {fu.dataAvaliacao && (
                            <div className="font-normal opacity-70">{format(new Date(fu.dataAvaliacao), "dd/MM/yy")}</div>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {scalesWithAnyData.map((s, si) => (
                      <tr key={s.key} className={si % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                        <td className="px-3 py-2 font-medium sticky left-0 bg-inherit border-r">
                          {followupAuthoredText(locale, s.label)}
                          <span className="text-muted-foreground font-normal ml-1 opacity-60">/{s.max}</span>
                        </td>
                        {followups.map(fu => {
                          const val = (fu as unknown as Record<string, unknown>)[s.key] as number | null | undefined;
                          if (val == null) return (
                            <td key={fu.id} className="text-center px-3 py-2 text-muted-foreground opacity-40">—</td>
                          );
                           const { rating } = interpretFollowupScale(s.key, val, locale)!;
                          return (
                            <td key={fu.id} className={`text-center px-3 py-2 font-bold ${TABLE_BG[rating]}`}>
                              {s.max === 10 ? val.toFixed(1) : Math.round(val)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}

                    {/* ADM row */}
                    {followups.some(fu => (fu as any).admFlexao != null) && (
                      <tr className="bg-blue-50/50">
                        <td className="px-3 py-2 font-medium sticky left-0 bg-blue-50 border-r text-blue-800">ADM {t("flexionDegrees")}</td>
                        {followups.map(fu => {
                          const v = (fu as any).admFlexao as number | null;
                          return (
                            <td key={fu.id} className={`text-center px-3 py-2 font-bold ${v != null ? (v >= 120 ? "text-emerald-700" : v >= 90 ? "text-blue-700" : "text-amber-700") : "text-muted-foreground opacity-40"}`}>
                              {v != null ? `${v}°` : "—"}
                            </td>
                          );
                        })}
                      </tr>
                    )}
                    {followups.some(fu => (fu as any).admExtensao != null) && (
                      <tr className="bg-purple-50/30">
                        <td className="px-3 py-2 font-medium sticky left-0 bg-purple-50 border-r text-purple-800">ADM {t("extensionDegrees")}</td>
                        {followups.map(fu => {
                          const v = (fu as any).admExtensao as number | null;
                          return (
                            <td key={fu.id} className={`text-center px-3 py-2 font-bold ${v != null ? "text-purple-700" : "text-muted-foreground opacity-40"}`}>
                              {v != null ? `${v}°` : "—"}
                            </td>
                          );
                        })}
                      </tr>
                    )}
                  </tbody>
                </table>
                <div className="px-3 py-2 bg-muted/20 border-t">
                  <div className="flex gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-200 inline-block" /> {t("excellent")}</span>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-blue-200 inline-block" /> {t("good")}</span>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-200 inline-block" /> {t("regular")}</span>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-200 inline-block" /> {t("poorAlert")}</span>
                  </div>
                </div>
              </div>
            </section>
            )}

            {/* ── Evolução por escala ── */}
            {scalesWithHistory.length > 0 && (
              <section>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">{t("scaleEvolution")}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {scalesWithHistory.map(s => {
                    const color = LINE_COLORS[s.key] ?? "#94a3b8";
                    const reversed = !s.higherIsBetter;
                    const isVas = s.key === "vasDor";
                    return (
                      <div key={s.key} className="rounded-lg border bg-card p-3">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-1.5">
                            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: color }} />
                            <span className="text-xs font-semibold">{followupAuthoredText(locale, s.label)}</span>
                          </div>
                          <span className="text-xs text-muted-foreground">{isVas ? "0–10 ↓" : `0–${s.max} ↑`}</span>
                        </div>
                        <ResponsiveContainer width="100%" height={130}>
                          <LineChart
                            data={chartData.map(d => ({ name: d.name, value: d[s.key as keyof typeof d] as number | null }))}
                            margin={{ top: 4, right: 6, left: -18, bottom: 4 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                            <XAxis dataKey="name" tick={{ fontSize: 9 }} interval={0} />
                            <YAxis domain={[0, s.max]} reversed={reversed} tick={{ fontSize: 9 }} />
                            <Tooltip
                              contentStyle={{ fontSize: 11, borderRadius: 6, padding: "4px 8px" }}
                              formatter={(v: number) => [s.max === 10 ? v.toFixed(1) : Math.round(v), followupAuthoredText(locale, s.label)]}
                            />
                            {!isVas && <ReferenceLine y={70} stroke="#22c55e" strokeDasharray="4 4" strokeOpacity={0.35} />}
                            {isVas && <ReferenceLine y={4} stroke="#f59e0b" strokeDasharray="4 4" strokeOpacity={0.5} />}
                            <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={{ r: 3, fill: color }} activeDot={{ r: 5 }} connectNulls />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* ── ADM chart ── */}
            {hasAdmData && (
              <section>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">{t("motionEvolution")}</h3>
                <div className="rounded-lg border bg-card p-4">
                  <div className="flex items-center gap-4 mb-3">
                    <div className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-500" /><span className="text-xs text-muted-foreground">{t("flexionDegrees")}</span></div>
                    <div className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full bg-purple-500" /><span className="text-xs text-muted-foreground">{t("extensionDegrees")}</span></div>
                  </div>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={admChartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6 }} formatter={(v: number, name: string) => [`${v}°`, name === "admFlexao" ? rt("flexion") : rt("extension")]} />
                      <ReferenceLine y={90} stroke="#22c55e" strokeDasharray="4 4" strokeOpacity={0.4} label={{ value: rt("flexionTarget"), fontSize: 9, fill: "#22c55e" }} />
                      <Line type="monotone" dataKey="admFlexao" name="admFlexao" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} connectNulls activeDot={{ r: 6 }} />
                      <Line type="monotone" dataKey="admExtensao" name="admExtensao" stroke="#a855f7" strokeWidth={2} dot={{ r: 4 }} connectNulls activeDot={{ r: 6 }} strokeDasharray="5 3" />
                    </LineChart>
                  </ResponsiveContainer>
                  <p className="text-xs text-muted-foreground mt-2 text-center">{t("flexionGoalLegend")}</p>
                </div>
              </section>
            )}

            {/* ── Eventos e observações ── */}
            {eventsFollowups.length > 0 && (
              <section>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">{t("clinicalEventsObservations")}</h3>
                <div className="space-y-3">
                  {eventsFollowups.map(fu => (
                    <div key={fu.id} className="rounded-lg border bg-card p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-bold text-foreground bg-muted px-2 py-0.5 rounded">{followupPeriodText(locale, fu.tempo)}</span>
                        {fu.dataAvaliacao && <span className="text-xs text-muted-foreground">{format(new Date(fu.dataAvaliacao), "dd/MM/yyyy")}</span>}
                      </div>
                      <div className="space-y-1.5">
                        {fu.retornoEsporte && (
                          <div className="flex gap-2 text-sm text-emerald-700">
                            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                            <span>{rt("returnedSport", { detail: fu.nivelRetorno ? `: ${fu.nivelRetorno}` : "" })}</span>
                          </div>
                        )}
                        {fu.falha && (
                          <div className="flex gap-2 text-sm text-red-700">
                            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                            <span>{rt("failure", { detail: fu.falhaType ? `: ${fu.falhaType}` : "" })}</span>
                          </div>
                        )}
                        {fu.complicacoes?.map(code => {
                          const parsed = parseFollowupComplication(code);
                          const categoryLabel = parsed.category === "aguda"
                            ? rt("acute")
                            : parsed.category === "tardia"
                              ? rt("late")
                              : null;
                          return (
                            <div key={code} className="flex gap-2 text-sm text-red-700">
                              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                              <span>
                                {categoryLabel && <strong>{categoryLabel}: </strong>}
                                {COMPLICATIONS_MAP[code] ? followupAuthoredText(locale, COMPLICATIONS_MAP[code].nome) : parsed.label}
                              </span>
                            </div>
                          );
                        })}
                        {fu.observacoes && (
                          <div className="flex gap-2 text-sm text-muted-foreground">
                            <Info className="h-4 w-4 shrink-0 mt-0.5" />
                            <span>{fu.observacoes}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
