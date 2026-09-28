import { useGetDoctorDashboard } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users, FileText, Activity, Trophy, Plus, ChevronRight,
  UserPlus, Bell, CheckCircle2, Clock, AlertCircle, Send, Phone, CalendarDays,
  FlaskConical,
} from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { capitalizeFirst, cn } from "@/lib/utils";
import { useLanguage } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n";
import { useScopedTranslations } from "@/lib/i18n";
import { operationalCoreMessages } from "@/locales/operational-core";
import { reportingDashboardMessages } from "@/locales/reporting-dashboard";
import { caseTypeLabel } from "@/locales/case-types";
import {
  reportCatalogLabels,
  reportFollowupPeriodLabel,
  reportScaleLabel,
  reportScaleLabels,
} from "@/locales/reporting-catalogs";
import { useState } from "react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

/* ─── helpers ─── */
function toTitleCase(str: string) {
  const skip = new Set(["de", "da", "do", "das", "dos", "e"]);
  return str.toLowerCase().split(" ")
    .map((w, i) => (i === 0 || !skip.has(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}
function formatDoctorFirstName(nome: string | undefined) {
  if (!nome) return "";
  return toTitleCase(nome.replace(/^Dr\.?\s*/i, "").replace(/^Dra\.?\s*/i, "")).split(" ")[0];
}
function cleanPhone(phone: string) {
  const d = phone.replace(/\D/g, "");
  return d.startsWith("55") ? d : `55${d}`;
}
function buildWaLink(phone: string, message: string) {
  return `https://wa.me/${cleanPhone(phone)}?text=${encodeURIComponent(message)}`;
}
type AppointmentDayLabels = { today: string; tomorrow: string };

export function formatAppointmentDay(
  date: string,
  locale: Locale,
  labels: AppointmentDayLabels,
  referenceDate = new Date(),
) {
  const [year, month, day] = date.split("-").map(Number);
  const appointmentDate = new Date(year, month - 1, day);
  const referenceDay = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
  const tomorrow = new Date(referenceDay);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (appointmentDate.getTime() === referenceDay.getTime()) return labels.today;
  if (appointmentDate.getTime() === tomorrow.getTime()) return labels.tomorrow;

  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(appointmentDate);
}
export function buildDashboardFollowupMessage(
  locale: Locale,
  patientNome: string,
  periodo: string,
  scales: string[],
  doctorNome: string,
) {
  const scaleList = scales.length > 0
    ? reportScaleLabels(locale, scales).join(", ")
    : locale === "es" ? "evaluaciones postoperatorias" : "avaliações pós-operatórias";
  if (locale === "es") {
    return (
      `¡Hola, *${patientNome}*! 👋\n\n` +
      `Dr(a). ${doctorNome} solicita que complete sus evaluaciones de *${reportFollowupPeriodLabel(locale, periodo)}* después de la cirugía.\n\n` +
      `📋 *Escalas por completar:* ${scaleList}\n\n` +
      `Acceda mediante el siguiente enlace; le tomará menos de 5 minutos:\n_(enlace enviado por separado)_\n\n` +
      `🔐 *Contraseña de acceso:* su CPF (solo números)\n\n` +
      `_¿Tiene alguna duda? Comuníquese con el consultorio._`
    );
  }
  return (
    `Olá, *${patientNome}*! 👋\n\n` +
    `Dr(a). ${doctorNome} solicita o preenchimento das suas avaliações de *${periodo}* após a cirurgia.\n\n` +
    `📋 *Escalas a preencher:* ${scaleList}\n\n` +
    `Acesse pelo link abaixo — leva menos de 5 minutos:\n_(link enviado em separado)_\n\n` +
    `🔐 *Senha de acesso:* seu CPF (somente números)\n\n` +
    `_Dúvidas? Entre em contato com o consultório._`
  );
}

/* ─── types ─── */
type FollowupRow = {
  notifId: number; status: string; periodo: string; scheduledDate: string | null;
  sentAt: string | null; followupId: number | null; surgeryId: number;
  scales: string[]; patientNome: string; patientId: number;
  patientTelefone: string | null; dataCirurgia: string | null;
};
type FollowupOverview = {
  vencidos: FollowupRow[]; agendados: FollowupRow[];
  respondidos: FollowupRow[]; aguardando: FollowupRow[];
  counts: { vencidos: number; agendados: number; respondidos: number; aguardando: number };
};
type RegenFollowupRow = {
  notif_id: string; case_id: string; periodo: string; status: string;
  scheduled_date: string | null; sent_at: string | null;
  patient_name: string; patient_phone: string | null;
  condition_code: string | null; response_count: number;
};
type RegenFollowupOverview = {
  vencidos: RegenFollowupRow[]; agendados: RegenFollowupRow[];
  respondidos: RegenFollowupRow[]; aguardando: RegenFollowupRow[];
  counts: { vencidos: number; agendados: number; respondidos: number; aguardando: number };
};
type ProductStat = { code: string; label: string; count: number };
type RegenStats = { total_cases: number };
type AppointmentRow = {
  id: number; patientId: number; data: string; hora: string; tipo: string;
  observacoes: string | null; status: string; patientNome: string | null; patientTelefone: string | null;
};
type TabKey = "overview" | "followup" | "agenda";

/* ─── hooks ─── */
function useFollowupOverview() {
  return useQuery<FollowupOverview>({
    queryKey: ["followup-overview"],
    queryFn: async () => {
      const res = await fetch("/api/notifications/followup-overview", { credentials: "same-origin" });
      if (!res.ok) throw new Error("Erro ao carregar follow-up");
      return res.json();
    },
    staleTime: 60_000,
  });
}
function useRegenFollowupOverview() {
  return useQuery<RegenFollowupOverview>({
    queryKey: ["regen-followup-overview"],
    queryFn: async () => {
      const res = await fetch("/api/regen/followup-overview", { credentials: "same-origin" });
      if (!res.ok) throw new Error("Erro ao carregar follow-ups regenerativos");
      return res.json();
    },
    staleTime: 60_000,
  });
}
function useRegenByProduct() {
  return useQuery<ProductStat[]>({
    queryKey: ["regen-by-product"],
    queryFn: async () => {
      const res = await fetch("/api/regen/stats/by-product", { credentials: "same-origin" });
      if (!res.ok) throw new Error("Erro ao carregar estatísticas por produto");
      return res.json();
    },
    staleTime: 120_000,
  });
}
function useRegenStats() {
  return useQuery<RegenStats>({
    queryKey: ["regen-stats"],
    queryFn: async () => {
      const res = await fetch("/api/regen/stats", { credentials: "same-origin" });
      if (!res.ok) throw new Error("Erro ao carregar estatísticas da Regenerativa");
      return res.json();
    },
    staleTime: 60_000,
  });
}
type OutcomeRow = { nome_escala: string; periodo: string; avg_score: number; n: number };
function useRegenOutcomes() {
  return useQuery<OutcomeRow[]>({
    queryKey: ["regen-outcomes"],
    queryFn: async () => {
      const res = await fetch("/api/regen/stats/outcomes", { credentials: "same-origin" });
      if (!res.ok) throw new Error("Erro ao carregar desfechos regenerativos");
      return res.json();
    },
    staleTime: 120_000,
  });
}
function useAppointments() {
  return useQuery<AppointmentRow[]>({
    queryKey: ["appointments"],
    queryFn: async () => {
      const res = await fetch("/api/appointments", { credentials: "same-origin" });
      if (!res.ok) throw new Error("Erro ao carregar agendamentos");
      return res.json();
    },
    staleTime: 30_000,
  });
}

/* ─── WhatsApp icon ─── */
const WA_ICON = (
  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current shrink-0">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
  </svg>
);

/* ─── FollowupRowCard ─── */
function FollowupRowCard({ row, color, doctorNome, showWa }: {
  row: FollowupRow; color: "red" | "green" | "yellow" | "blue"; doctorNome: string; showWa: boolean;
}) {
  const { locale } = useLanguage();
  const rt = useScopedTranslations(reportingDashboardMessages);
  const colorMap = {
    red:    { dot: "bg-red-500",    bg: "bg-red-50 dark:bg-red-950/40",       border: "border-red-200 dark:border-red-800",       text: "text-red-700 dark:text-red-300" },
    green:  { dot: "bg-green-500",  bg: "bg-green-50 dark:bg-green-950/40",   border: "border-green-200 dark:border-green-800",   text: "text-green-700 dark:text-green-300" },
    yellow: { dot: "bg-yellow-500", bg: "bg-yellow-50 dark:bg-yellow-950/40", border: "border-yellow-200 dark:border-yellow-800", text: "text-yellow-700 dark:text-yellow-300" },
    blue:   { dot: "bg-blue-400",   bg: "bg-blue-50 dark:bg-blue-950/40",     border: "border-blue-200 dark:border-blue-800",     text: "text-blue-700 dark:text-blue-300" },
  }[color];
  const hasPhone = !!row.patientTelefone;
  const waLink = showWa && hasPhone
    ? buildWaLink(row.patientTelefone!, buildDashboardFollowupMessage(locale, row.patientNome, row.periodo, row.scales ?? [], doctorNome))
    : null;
  return (
    <div className={cn("flex items-center gap-3 px-4 py-3 rounded-xl border", colorMap.border, colorMap.bg)}>
      <span className={cn("w-2 h-2 rounded-full shrink-0", colorMap.dot)} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground truncate">{toTitleCase(row.patientNome)}</p>
        <p className={cn("text-xs font-medium truncate", colorMap.text)}>
          {reportFollowupPeriodLabel(locale, row.periodo)}{row.scheduledDate ? ` · ${row.scheduledDate}` : ""}
        </p>
        {showWa && !hasPhone && (
          <p className="text-[10px] text-red-500 flex items-center gap-0.5 mt-0.5">
            <Phone className="h-3 w-3" /> {rt("noPhone")}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {waLink && (
          <a href={waLink} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold text-white transition-opacity hover:opacity-90 active:scale-95"
            style={{ background: "#25D366" }}>
            {WA_ICON}<span className="hidden sm:inline">WhatsApp</span>
          </a>
        )}
        <Link href={`/surgeries/${row.surgeryId}`}>
          <button type="button" className="inline-flex items-center h-8 px-2 rounded-lg text-muted-foreground/50 hover:text-muted-foreground transition-colors">
            <ChevronRight className="h-4 w-4" />
          </button>
        </Link>
      </div>
    </div>
  );
}

/* ─── chart colors (metallic/jewel palette) ─── */
const CHART_COLORS = [
  "#2563EB", /* sapphire   */
  "#7C3AED", /* amethyst   */
  "#059669", /* emerald    */
  "#D97706", /* gold       */
  "#DC2626", /* ruby       */
  "#0891B2", /* teal steel */
  "#B45309", /* bronze     */
];

/* ─── Tooltip claro ─── */
function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 8, padding: "8px 14px", boxShadow: "0 4px 16px rgba(0,0,0,0.10)" }}>
      <p style={{ color: "#64748B", fontSize: 11, marginBottom: 3 }}>{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: "#1E293B", fontSize: 14, fontWeight: 700 }}>{p.value}</p>
      ))}
    </div>
  );
}

/* ─── Main Component ─── */
export default function Dashboard() {
  const { locale, formatDate } = useLanguage();
  const t = useScopedTranslations(operationalCoreMessages);
  const tx = useScopedTranslations(reportingDashboardMessages);
  const { data, isLoading, error } = useGetDoctorDashboard();
  const { user } = useAuth();
  const [tab, setTab] = useState<TabKey>("overview");
  const [fuTab, setFuTab] = useState<"vencidos" | "agendados" | "respondidos" | "aguardando">("vencidos");
  const [fuType, setFuType] = useState<"cirurgia" | "regen">("cirurgia");
  const { data: appointments, isLoading: apptLoading, error: appointmentsError } = useAppointments();
  const { data: fuData, isLoading: fuLoading } = useFollowupOverview();
  const {
    data: regenFuData,
    isLoading: regenFuLoading,
    error: regenFuError,
    refetch: refetchRegenFu,
  } = useRegenFollowupOverview();
  const { data: productStats, error: productStatsError } = useRegenByProduct();
  const { data: regenStats } = useRegenStats();
  const { data: outcomeRows, error: outcomeRowsError } = useRegenOutcomes();

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12
    ? t("dashboardGreetingMorning")
    : hour < 18
      ? t("dashboardGreetingAfternoon")
      : t("dashboardGreetingEvening");
  const dateStr = formatDate(now, { weekday: "long", day: "numeric", month: "long" });

  if (isLoading) {
    return (
      <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-5">
        <Skeleton className="h-7 w-48" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        </div>
        <Skeleton className="h-52 rounded-2xl" />
        <div className="grid md:grid-cols-2 gap-4">
          <Skeleton className="h-52 rounded-2xl" />
          <Skeleton className="h-52 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (error || appointmentsError || productStatsError || outcomeRowsError || !data) {
    return <div className="p-8 text-destructive">{tx("loadError")}</div>;
  }

  /* ── KPI derivations ── */
  const vencidosBadge = fuData?.counts.vencidos ?? 0;
  const doctorNome = user?.nome ?? "";
  const avgPain = data.avgPain ?? null;

  /* ── Cirurgias por tipo de caso (catálogo de ombro/cotovelo) ── */
  const pieData = data.surgeriesByType.length > 0
    ? [...data.surgeriesByType]
        .sort((x, y) => y.count - x.count)
        .slice(0, 6)
        .map((item, i) => ({
          key: item.tipo,
          name: caseTypeLabel(locale, item.tipo),
          value: item.count,
          color: CHART_COLORS[i % CHART_COLORS.length],
        }))
    : null;

  /* ── Ortobiológicos by product donut data ── */
  const ORTOBIO_COLORS = ["#7C3AED","#059669","#0891B2","#D97706","#DC2626","#B45309","#6366F1","#EC4899"];
  const orthoPieData = (productStats?.length ?? 0) > 0
    ? productStats!.slice(0, 8).map((item, i) => ({
        name: item.label,
        value: item.count,
        color: ORTOBIO_COLORS[i % ORTOBIO_COLORS.length],
      }))
    : null;
  const orthoTotal = productStats?.reduce((s, p) => s + p.count, 0) ?? 0;
  const regenCaseCount = regenStats?.total_cases ?? 0;

  /* ── Regen follow-up combined badge ── */
  const regenVencidosBadge = regenFuData?.counts.vencidos ?? 0;
  const totalVencidosBadge = (fuData?.counts.vencidos ?? 0) + regenVencidosBadge;

  /* ── Regen follow-up categories (computed here to avoid IIFE in JSX) ── */
  const rfuCats = [
    { key: "vencidos"    as const, label: tx("pending"), color: "red"    as const, Icon: AlertCircle, count: regenFuData?.counts.vencidos ?? 0, rows: (regenFuData?.vencidos ?? []) as RegenFollowupRow[], emptyMsg: tx("noOverdueFollowups") },
    { key: "agendados"   as const, label: tx("toSend"), color: "yellow" as const, Icon: Clock, count: regenFuData?.counts.agendados ?? 0, rows: (regenFuData?.agendados ?? []) as RegenFollowupRow[], emptyMsg: tx("noScheduledFollowups") },
    { key: "respondidos" as const, label: tx("answered"), color: "green" as const, Icon: CheckCircle2, count: regenFuData?.counts.respondidos ?? 0, rows: (regenFuData?.respondidos ?? []) as RegenFollowupRow[], emptyMsg: tx("noResponses") },
    { key: "aguardando" as const, label: tx("awaiting"), color: "blue" as const, Icon: Send, count: regenFuData?.counts.aguardando ?? 0, rows: (regenFuData?.aguardando ?? []) as RegenFollowupRow[], emptyMsg: tx("noAwaitingAnswer") },
  ];
  const rSelCat = rfuCats.find(c => c.key === fuTab) ?? rfuCats[0];
  const rfuColorStyle = {
    red:    { card: "border-red-400 bg-red-50",     num: "text-red-600",    icon: "bg-red-100",    iconColor: "#DC2626" },
    yellow: { card: "border-yellow-400 bg-yellow-50", num: "text-yellow-600", icon: "bg-yellow-100", iconColor: "#D97706" },
    green:  { card: "border-green-400 bg-green-50", num: "text-green-600",  icon: "bg-green-100",  iconColor: "#16A34A" },
    blue:   { card: "border-blue-400 bg-blue-50",   num: "text-blue-600",   icon: "bg-blue-100",   iconColor: "#2563EB" },
  };

  /* ── Regen outcomes line chart data ── */
  const PERIODO_ORDER = ["preop","30d","90d","180d","1y","2y","5y"];
  const PERIODO_LABEL: Record<string,string> = { preop: tx("preoperativeAbbreviation"), "30d":"30d", "90d":"90d", "180d":"6m", "1y":"1a", "2y":"2a", "5y":"5a" };
  const SCALE_COLORS: Record<string,string> = { VAS:"#DC2626" };
  const SCALE_DEFAULT_COLORS = ["#6366F1","#EC4899","#0891B2","#B45309"];

  // Build per-scale series and collect all periods that have data
  const outcomeChartData = (() => {
    if (!outcomeRows || outcomeRows.length === 0) return null;
    const scales = [...new Set(outcomeRows.map(r => r.nome_escala))];
    const periods = PERIODO_ORDER.filter(p => outcomeRows.some(r => r.periodo === p));
    if (periods.length < 2) return null; // need at least 2 points for a line
    const points = periods.map(p => {
      const point: Record<string, string | number> = { periodo: PERIODO_LABEL[p] ?? p };
      scales.forEach(s => {
        const row = outcomeRows.find(r => r.nome_escala === s && r.periodo === p);
        if (row) point[s] = Number(row.avg_score);
      });
      return point;
    });
    return { points, scales };
  })();

  /* ── Próximos follow-ups (vencidos + agendados top 4) ── */
  const proximosFollowups = [
    ...(fuData?.vencidos ?? []).slice(0, 2),
    ...(fuData?.agendados ?? []).slice(0, 3),
  ].slice(0, 4);

  /* ── follow-up categories ── */
  const fuCategories = [
    { key: "vencidos" as const, label: tx("pending"), desc: tx("overdueWithoutSending"), color: "red" as const, Icon: AlertCircle, showWa: true, count: fuData?.counts.vencidos ?? 0, rows: fuData?.vencidos ?? [], emptyMsg: tx("noOverdueFollowups") },
    { key: "agendados" as const, label: tx("toSend"), desc: tx("upcomingScheduled"), color: "yellow" as const, Icon: Clock, showWa: true, count: fuData?.counts.agendados ?? 0, rows: fuData?.agendados ?? [], emptyMsg: tx("noScheduledFollowups") },
    { key: "respondidos" as const, label: tx("answered"), desc: tx("questionnaireCompleted"), color: "green" as const, Icon: CheckCircle2, showWa: false, count: fuData?.counts.respondidos ?? 0, rows: fuData?.respondidos ?? [], emptyMsg: tx("noResponsesYet") },
    { key: "aguardando" as const, label: tx("awaiting"), desc: tx("sentWithoutAnswer"), color: "blue" as const, Icon: Send, showWa: false, count: fuData?.counts.aguardando ?? 0, rows: fuData?.aguardando ?? [], emptyMsg: tx("noAwaitingAnswer") },
  ];
  const colorTabActive: Record<string, string> = {
    vencidos:    "border-red-500 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40",
    agendados:   "border-yellow-500 text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-950/40",
    respondidos: "border-green-500 text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/40",
    aguardando:  "border-blue-400 text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40",
  };
  const colorTabInactive = "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40";
  const colorCountBadge: Record<string, string> = {
    vencidos:    "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300",
    agendados:   "bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300",
    respondidos: "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300",
    aguardando:  "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300",
  };
  const selectedCat = fuCategories.find(c => c.key === fuTab) ?? fuCategories[0];

  /* ─ KPI cards config ─ */
  const kpiCards = [
    {
      label: t("dashboardSurgeriesCompleted"),
      value: String(data.totalSurgeries),
      // totalSurgeries exclui rascunhos (API); o subtítulo é a contagem de pacientes.
      sub: t((data.totalPatients) === 1 ? "dashboardSurgeriesCompletedPatientsOne" : "dashboardSurgeriesCompletedPatients", { count: data.totalPatients }),
      href: "/surgeries",
      accent: "#2563EB",
    },
    {
      label: t("dashboardFollowupsCompleted"),
      value: `${data.followupCompliance.toFixed(0)}%`,
      sub: `${fuData?.counts.respondidos ?? "—"} ${tx("answered").toLowerCase()}`,
      href: "/followup",
      accent: "#059669",
    },
    {
      label: tx("averagePain"),
      value: avgPain != null ? avgPain.toFixed(1) : "—",
      sub: tx("painScale"),
      href: null,
      accent: "#7C3AED",
    },
    {
      label: t("dashboardReturnToSport"),
      value: data.returnToSportRate ? `${data.returnToSportRate.toFixed(0)}%` : "—",
      sub: tx("clearanceRecorded"),
      href: null,
      accent: "#D97706",
    },
  ];

  /* ── CARD style — fundo claro ── */
  const CARD = {
    background: "#FFFFFF",
    border: "1px solid #E2E8F0",
    borderRadius: 16,
    boxShadow: "0 1px 6px rgba(0,0,0,0.06)",
  };

  return (
    <div className="max-w-6xl mx-auto animate-in fade-in duration-500">

      {/* ── Mobile greeting banner ── */}
      <div className="md:hidden px-5 pt-5 pb-4 mb-1"
        style={{ background: "linear-gradient(135deg, #0A1628 0%, #0D2040 100%)" }}>
        <p className="text-xs font-medium mb-0.5" style={{ color: "rgba(31,182,225,0.8)" }}>{capitalizeFirst(dateStr, locale)}</p>
        <h1 className="text-xl font-bold text-white">{greeting}, Dr. {formatDoctorFirstName(user?.nome)}</h1>
        <p className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.4)" }}>{tx("overviewDescription")}</p>
      </div>

      {/* ── Desktop heading ── */}
      <div className="hidden md:flex p-8 pb-4 justify-between items-start gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("dashboard")}</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {greeting}, Dr. {formatDoctorFirstName(user?.nome)} · {dateStr}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/patients/new"><Button variant="outline" className="gap-1.5"><UserPlus className="h-4 w-4" />{tx("patient")}</Button></Link>
          <Link href="/surgeries/new"><Button className="gap-1.5"><Plus className="h-4 w-4" />{tx("procedure")}</Button></Link>
        </div>
      </div>

      <div className="px-4 md:px-8 pb-6 space-y-5">

        {/* ── KPI cards ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {kpiCards.map(({ label, value, sub, href, accent }) => {
            const tile = (
              <div style={{ ...CARD, borderTop: `3px solid ${accent}` }} className="p-4 flex flex-col gap-2 transition-all active:scale-[0.97] hover:shadow-md cursor-pointer">
                <p className="text-xs font-medium text-slate-500">{label}</p>
                <p className="text-3xl font-extrabold leading-tight text-slate-900" style={{ letterSpacing: "-0.02em" }}>{value}</p>
                <p className="text-[11px] font-semibold" style={{ color: accent }}>{sub}</p>
              </div>
            );
            return href
              ? <Link key={label} href={href}>{tile}</Link>
              : <div key={label}>{tile}</div>;
          })}
        </div>

        {/* ── Quick actions (mobile only) ── */}
        <div className="md:hidden">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2.5 px-0.5">{tx("quickActions")}</p>
          <div className="grid grid-cols-2 gap-2.5">
            {[
              { href: "/patients/new",  label: tx("patient"),  Icon: UserPlus },
              { href: "/surgeries/new", label: tx("surgery"),  Icon: Plus },
            ].map(({ href, label, Icon }) => (
              <Link key={href} href={href}>
                <div className="rounded-2xl p-3.5 flex flex-col items-center gap-2 transition-transform active:scale-95 cursor-pointer bg-card border border-border shadow-sm">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-primary/10">
                    <Icon style={{ color: "#1FB6E1", width: 20, height: 20 }} strokeWidth={2} />
                  </div>
                  <span className="text-[11px] font-semibold text-foreground">{label}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* ── Tab switcher ── */}
        <div className="flex gap-1 bg-muted/50 rounded-xl p-1 w-fit">
          {[
            { key: "overview" as const, label: t("dashboardOverview"), icon: null },
            { key: "followup" as const, label: tx("followup"), icon: <Bell className="h-3.5 w-3.5" />, badge: totalVencidosBadge },
            { key: "agenda" as const, label: tx("schedule"), icon: <CalendarDays className="h-3.5 w-3.5" /> },
          ].map(({ key, label, icon, badge }) => (
            <button key={key} type="button" onClick={() => setTab(key)}
              className={cn("relative px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2",
                tab === key ? "bg-card shadow-sm text-foreground border border-border" : "text-muted-foreground hover:text-foreground hover:bg-muted/40")}>
              {icon}{label}
              {badge && badge > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1 shadow">
                  {badge > 99 ? "99+" : badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ══════════════ OVERVIEW TAB ══════════════ */}
        {tab === "overview" && (
          <div className="space-y-4">

            {/* ── Charts row: Donut Cirurgias + Donut Ortobiológicos ── */}
            <div className="grid md:grid-cols-2 gap-4">

              {/* Donut: Cirurgias por tipo */}
              <div style={CARD} className="p-5">
                <p className="text-sm font-bold text-slate-800 mb-4">{t("dashboardSurgeriesByType")}</p>
                {pieData && pieData.length > 0 ? (
                  <div className="flex items-center gap-4">
                    <ResponsiveContainer width={140} height={140}>
                      <PieChart>
                        <Pie data={pieData} dataKey="value" cx="50%" cy="50%" innerRadius={42} outerRadius={64} paddingAngle={3}>
                          {pieData.map((entry, i) => (
                            <Cell key={i} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(value, name) => [value, name]}
                          contentStyle={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.10)" }}
                          labelStyle={{ color: "#64748B", fontSize: 11 }}
                          itemStyle={{ color: "#1E293B", fontSize: 13, fontWeight: 700 }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex-1 min-w-0 space-y-2.5">
                      {pieData.map((entry) => {
                        const pct = data.totalSurgeries > 0 ? ((entry.value / data.totalSurgeries) * 100).toFixed(0) : 0;
                        return (
                          <div key={entry.key} className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: entry.color }} />
                            <span className="text-xs text-slate-600 min-w-0 break-words">{entry.name}</span>
                            <span className="ml-auto text-xs font-bold whitespace-nowrap" style={{ color: entry.color }}>{entry.value} · {pct}%</span>
                          </div>
                        );
                      })}
                      <p className="text-[10px] leading-snug text-slate-400 pt-1">{t("dashboardSurgeriesByTypeShareNote")}</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-10 gap-2">
                    <FileText className="h-8 w-8 text-slate-200" />
                    <p className="text-xs text-slate-400">{t("dashboardInsufficientData")}</p>
                  </div>
                )}
              </div>

              {/* Donut: Ortobiológicos por produto */}
              <div style={CARD} className="p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <FlaskConical className="h-4 w-4 text-violet-600" />
                    <p className="text-sm font-bold text-slate-800">{tx("orthobiologics")}</p>
                  </div>
                  <Link
                    href="/regen"
                    className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-bold text-violet-700 hover:bg-violet-100"
                  >
                    {regenCaseCount === 1 ? tx("caseCount", { count: regenCaseCount }) : tx("casesCount", { count: regenCaseCount })}
                  </Link>
                </div>
                {orthoPieData && orthoPieData.length > 0 ? (
                  <>
                    <p className="mb-2 text-xs text-slate-500">{tx("proceduresByProduct")}</p>
                    <div className="flex items-center gap-4">
                      <ResponsiveContainer width={140} height={140}>
                        <PieChart>
                          <Pie data={orthoPieData} dataKey="value" cx="50%" cy="50%" innerRadius={42} outerRadius={64} paddingAngle={3}>
                            {orthoPieData.map((entry, i) => (
                              <Cell key={i} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(value, name) => [value, name]}
                            contentStyle={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.10)" }}
                            labelStyle={{ color: "#64748B", fontSize: 11 }}
                            itemStyle={{ color: "#1E293B", fontSize: 13, fontWeight: 700 }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="flex-1 space-y-2.5">
                        {orthoPieData.map((entry) => {
                          const pct = orthoTotal > 0 ? ((entry.value / orthoTotal) * 100).toFixed(0) : 0;
                          return (
                            <div key={entry.name} className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: entry.color }} />
                              <span className="text-xs text-slate-600">{entry.name}</span>
                              <span className="ml-auto text-xs font-bold" style={{ color: entry.color }}>{pct}%</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center py-10 gap-2">
                    <FlaskConical className="h-8 w-8 text-slate-200" />
                    <p className="text-xs text-slate-500">
                      {regenCaseCount > 0
                        ? (regenCaseCount === 1 ? tx("registeredCaseCount", { count: regenCaseCount }) : tx("registeredCasesCount", { count: regenCaseCount }))
                        : t("dashboardNoOrthobiologicalCases")}
                    </p>
                    {regenCaseCount > 0 && (
                      <p className="text-center text-xs text-slate-400">
                        {tx("productAppearsAfterProcedure")}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* ── Line: Evolução de scores regenerativos ── */}
            <div style={CARD} className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <FlaskConical className="h-4 w-4 text-violet-600" />
                <p className="text-sm font-bold text-slate-800">{t("dashboardRegenerativeScoresEvolution")}</p>
              </div>
              {outcomeChartData ? (
                <>
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={outcomeChartData.points} margin={{ top: 4, right: 12, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                      <XAxis dataKey="periodo" stroke="#CBD5E1" tick={{ fontSize: 11, fill: "#94A3B8" }} />
                      <YAxis domain={[0, "auto"]} stroke="#E2E8F0" tick={{ fontSize: 11, fill: "#94A3B8" }} />
                      <Tooltip
                        contentStyle={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.10)" }}
                        labelStyle={{ color: "#64748B", fontSize: 11 }}
                        itemStyle={{ fontSize: 13, fontWeight: 700 }}
                      />
                      <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                      {outcomeChartData.scales.map((scale, i) => (
                        <Line
                          key={scale}
                          type="monotone"
                          dataKey={scale}
                          name={reportScaleLabel(locale, scale)}
                          stroke={SCALE_COLORS[scale.toUpperCase()] ?? SCALE_DEFAULT_COLORS[i % SCALE_DEFAULT_COLORS.length]}
                          strokeWidth={2}
                          dot={{ r: 4 }}
                          activeDot={{ r: 6 }}
                          connectNulls
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                  <p className="text-[10px] text-slate-400 mt-2 text-right">{tx("averageRespondedPatients")}</p>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center py-10 gap-2">
                  <Activity className="h-8 w-8 text-slate-200" />
                  <p className="text-xs text-slate-400 text-center">{t("dashboardRegisterScoredFollowupsForEvolution")}</p>
                </div>
              )}
            </div>

            {/* ── Próximos follow-ups ── */}
            {proximosFollowups.length > 0 && (
              <div style={CARD} className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm font-bold text-slate-800">{tx("upcomingFollowups")}</p>
                  <Link href="/followup">
                    <span className="text-xs font-semibold text-blue-600">{tx("viewAll")}</span>
                  </Link>
                </div>
                <div className="space-y-2">
                  {proximosFollowups.map((row) => {
                    const isOverdue = fuData?.vencidos.some(v => v.notifId === row.notifId);
                    return (
                      <div key={row.notifId}
                        className="flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-100 bg-slate-50 hover:bg-slate-100 transition-colors">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-blue-50">
                          <Users className="h-4 w-4 text-blue-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-800 truncate">{toTitleCase(row.patientNome)}</p>
                          <p className="text-xs text-slate-400 break-words line-clamp-2">
                            {row.scales?.length
                              ? reportScaleLabels(locale, row.scales).join(", ")
                              : reportFollowupPeriodLabel(locale, row.periodo)}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          {row.scheduledDate && (
                            <p className={cn("text-xs font-medium mb-1", isOverdue ? "text-red-500" : "text-slate-400")}>
                              {row.scheduledDate}
                            </p>
                          )}
                          <Link href={`/surgeries/${row.surgeryId}`}>
                            <button type="button" className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors hover:bg-blue-100 bg-blue-50 text-blue-600 border border-blue-200">
                              {tx("viewDetails")}
                            </button>
                          </Link>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Cirurgias recentes ── */}
            {data.recentSurgeries.length > 0 && (
              <div style={CARD} className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm font-bold text-slate-800">{tx("recentSurgeries")}</p>
                  <Link href="/surgeries">
                    <span className="text-xs font-semibold text-blue-600">{tx("viewAll")}</span>
                  </Link>
                </div>
                <div className="space-y-2">
                  {data.recentSurgeries.slice(0, 5).map((s) => (
                    <Link key={s.id} href={`/surgeries/${s.id}`}>
                      <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-100 bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-violet-50">
                          <FileText className="h-4 w-4 text-violet-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-800 truncate">{toTitleCase(s.patientNome)}</p>
                          <p className="text-xs text-slate-400 truncate">
                            {s.tiposProcedimento.map((k) => caseTypeLabel(locale, k)).join(", ") || tx("procedureFallback")}
                            {s.dataCirurgia ? ` · ${formatDate(s.dataCirurgia)}` : ""}
                          </p>
                        </div>
                        <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══════════════ FOLLOW-UP TAB ══════════════ */}
        {tab === "followup" && (
          <div className="space-y-4">

            {/* ── Tipo de follow-up: Cirurgia | Regenerativa ── */}
            <div className="flex gap-1 bg-muted/40 rounded-xl p-1 w-fit">
              {[
                { key: "cirurgia" as const, label: tx("surgeryFollowup"),      badge: fuData?.counts.vencidos ?? 0 },
                { key: "regen"    as const, label: tx("regenerativeFollowup"), badge: regenFuData?.counts.vencidos ?? 0 },
              ].map(({ key, label, badge }) => (
                <button key={key} type="button" onClick={() => { setFuType(key); setFuTab("vencidos"); }}
                  className={cn("relative px-4 py-1.5 rounded-lg text-sm font-semibold transition-all",
                    fuType === key ? "bg-card shadow-sm text-foreground border border-border" : "text-muted-foreground hover:text-foreground hover:bg-muted/40")}>
                  {label}
                  {badge > 0 && (
                    <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-bold px-1">
                      {badge}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* ── CIRURGIA: skeleton ── */}
            {fuType === "cirurgia" && fuLoading && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
              </div>
            )}
            {/* ── CIRURGIA: category cards ── */}
            {fuType === "cirurgia" && !fuLoading && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {fuCategories.map(({ key, label, desc, color, Icon, count }) => {
                  const isActive = fuTab === key;
                  const styles = {
                    red:    { card: isActive ? "border-red-400 bg-red-50 dark:bg-red-950/40 dark:border-red-700"           : "border-border bg-card", num: "text-red-600 dark:text-red-400",    icon: "bg-red-100 dark:bg-red-900/40",    iconColor: "#DC2626" },
                    yellow: { card: isActive ? "border-yellow-400 bg-yellow-50 dark:bg-yellow-950/40 dark:border-yellow-700" : "border-border bg-card", num: "text-yellow-600 dark:text-yellow-400", icon: "bg-yellow-100 dark:bg-yellow-900/40", iconColor: "#D97706" },
                    green:  { card: isActive ? "border-green-400 bg-green-50 dark:bg-green-950/40 dark:border-green-700"     : "border-border bg-card", num: "text-green-600 dark:text-green-400",  icon: "bg-green-100 dark:bg-green-900/40",  iconColor: "#16A34A" },
                    blue:   { card: isActive ? "border-blue-400 bg-blue-50 dark:bg-blue-950/40 dark:border-blue-700"         : "border-border bg-card", num: "text-blue-600 dark:text-blue-400",   icon: "bg-blue-100 dark:bg-blue-900/40",   iconColor: "#2563EB" },
                  }[color];
                  return (
                    <button key={key} type="button" onClick={() => setFuTab(key)}
                      className={cn("rounded-2xl p-4 flex flex-col gap-3 transition-all border-2 text-left w-full cursor-pointer hover:shadow-md active:scale-[0.97]", styles.card, isActive ? "shadow-md" : "shadow-sm")}>
                      <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center", styles.icon)}>
                        <Icon style={{ color: styles.iconColor, width: 18, height: 18 }} />
                      </div>
                      <div>
                        <p className={cn("text-2xl font-bold leading-tight", styles.num)}>{count}</p>
                        <p className="text-xs font-semibold text-foreground mt-0.5">{label}</p>
                        <p className="text-[10px] text-muted-foreground">{desc}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            {/* ── CIRURGIA: tab strip + rows ── */}
            {fuType === "cirurgia" && !fuLoading && (
              <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-none">
                {fuCategories.map(({ key, label, count }) => (
                  <button key={key} type="button" onClick={() => setFuTab(key)}
                    className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg border-b-2 text-xs font-semibold transition-all whitespace-nowrap",
                      fuTab === key ? colorTabActive[key] : colorTabInactive)}>
                    {label}
                    <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-full", colorCountBadge[key])}>{count}</span>
                  </button>
                ))}
              </div>
            )}
            {fuType === "cirurgia" && !fuLoading && selectedCat.rows.length === 0 && (
              <div className="rounded-2xl flex flex-col items-center justify-center py-12 gap-2"
                style={{ background: "rgba(31,182,225,0.04)", border: "1px dashed rgba(31,182,225,0.2)" }}>
                <selectedCat.Icon className="h-8 w-8 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">{selectedCat.emptyMsg}</p>
              </div>
            )}
            {fuType === "cirurgia" && !fuLoading && selectedCat.rows.length > 0 && (
              <div className="space-y-2">
                {selectedCat.rows.map(row => (
                  <FollowupRowCard key={row.notifId} row={row} color={selectedCat.color} doctorNome={doctorNome} showWa={selectedCat.showWa} />
                ))}
                <Link href="/followup">
                  <p className="text-center text-xs font-semibold pt-1" style={{ color: "#1FB6E1" }}>
                    {tx("manageAllFollowups")}
                  </p>
                </Link>
              </div>
            )}

            {/* ── REGENERATIVA: skeleton ── */}
            {fuType === "regen" && regenFuLoading && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
              </div>
            )}
            {fuType === "regen" && !regenFuLoading && regenFuError && (
              <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-center">
                <p className="text-sm font-semibold text-red-700">{tx("loadError")}</p>
                <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void refetchRegenFu()}>
                  {t("retry")}
                </Button>
              </div>
            )}
            {/* ── REGENERATIVA: category cards ── */}
            {fuType === "regen" && !regenFuLoading && !regenFuError && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {rfuCats.map(({ key, label, color, Icon, count }) => {
                  const isActive = fuTab === key;
                  const s = rfuColorStyle[color];
                  return (
                    <button key={key} type="button" onClick={() => setFuTab(key)}
                      className={cn("rounded-2xl p-4 flex flex-col gap-3 transition-all border-2 text-left w-full cursor-pointer hover:shadow-md active:scale-[0.97]",
                        isActive ? s.card : "border-border bg-card", isActive ? "shadow-md" : "shadow-sm")}>
                      <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center", isActive ? s.icon : "bg-muted/50")}>
                        <Icon style={{ color: isActive ? s.iconColor : "#94A3B8", width: 18, height: 18 }} />
                      </div>
                      <div>
                        <p className={cn("text-2xl font-bold leading-tight", isActive ? s.num : "text-foreground")}>{count}</p>
                        <p className="text-xs font-semibold text-foreground mt-0.5">{label}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            {/* ── REGENERATIVA: tab strip + rows ── */}
            {fuType === "regen" && !regenFuLoading && !regenFuError && (
              <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-none">
                {rfuCats.map(({ key, label, count }) => (
                  <button key={key} type="button" onClick={() => setFuTab(key)}
                    className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg border-b-2 text-xs font-semibold transition-all whitespace-nowrap",
                      fuTab === key ? colorTabActive[key] : colorTabInactive)}>
                    {label}
                    <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-full", colorCountBadge[key])}>{count}</span>
                  </button>
                ))}
              </div>
            )}
            {fuType === "regen" && !regenFuLoading && !regenFuError && rSelCat.rows.length === 0 && (
              <div className="rounded-2xl flex flex-col items-center justify-center py-12 gap-2"
                style={{ background: "rgba(124,58,237,0.04)", border: "1px dashed rgba(124,58,237,0.2)" }}>
                <FlaskConical className="h-8 w-8 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">{rSelCat.emptyMsg}</p>
              </div>
            )}
            {fuType === "regen" && !regenFuLoading && !regenFuError && rSelCat.rows.length > 0 && (
              <div className="space-y-2">
                {rSelCat.rows.map((row) => (
                  <div key={row.notif_id}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl border border-violet-100 bg-violet-50 hover:bg-violet-100 transition-colors">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-violet-100">
                      <FlaskConical className="h-4 w-4 text-violet-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{row.patient_name}</p>
                      <p className="text-xs text-slate-400 truncate">{reportFollowupPeriodLabel(locale, row.periodo)}{row.condition_code ? ` · ${row.condition_code}` : ""}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      {row.scheduled_date && (
                        <p className={cn("text-xs font-medium mb-1",
                          row.scheduled_date <= new Date().toISOString().slice(0, 10) && row.status === "pending"
                            ? "text-red-500" : "text-slate-400")}>
                          {row.scheduled_date}
                        </p>
                      )}
                      <Link href={`/regen/caso/${row.case_id}`}>
                        <button type="button" className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors hover:bg-violet-200 bg-violet-100 text-violet-700 border border-violet-200">
                          {tx("viewCase")}
                        </button>
                      </Link>
                    </div>
                  </div>
                ))}
                <Link href="/regen">
                  <p className="text-center text-xs font-semibold pt-1" style={{ color: "#7C3AED" }}>
                    {tx("manageRegenerativeFollowups")}
                  </p>
                </Link>
              </div>
            )}
          </div>
        )}

        {/* ══════════════ AGENDA TAB ══════════════ */}
        {tab === "agenda" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{tx("secretaryAppointments")}</p>
              <Link href="/secretary/dashboard">
                <button type="button" className="text-xs font-semibold" style={{ color: "#1FB6E1" }}>{tx("secretaryDashboard")}</button>
              </Link>
            </div>
            {apptLoading ? (
              <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
            ) : !appointments || appointments.length === 0 ? (
              <div className="rounded-2xl flex flex-col items-center justify-center py-14 gap-2"
                style={{ background: "rgba(31,182,225,0.04)", border: "1px dashed rgba(31,182,225,0.2)" }}>
                <CalendarDays className="h-8 w-8 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">{tx("noAppointments")}</p>
                <p className="text-xs text-muted-foreground/60">{tx("secretaryCanSchedule")}</p>
              </div>
            ) : (() => {
              const now = new Date();
              const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
              const dayLabels = { today: tx("today"), tomorrow: tx("tomorrow") };
              const typeLabels: Record<string, string> = {
                consulta: tx("appointmentTypeConsultation"),
                retorno: tx("appointmentTypeReturn"),
                avaliacao: tx("appointmentTypeAssessment"),
              };
              const statusLabels: Record<string, string> = {
                agendado: tx("appointmentStatusScheduled"),
                confirmado: tx("appointmentStatusConfirmed"),
                cancelado: tx("appointmentStatusCancelled"),
                realizado: tx("appointmentStatusCompleted"),
              };
              const sorted = [...appointments].sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora));
              const byDay = sorted.reduce((acc, a) => { (acc[a.data] = acc[a.data] ?? []).push(a); return acc; }, {} as Record<string, AppointmentRow[]>);
              function statusColor(status: string) {
                if (status === "agendado") return "bg-blue-100 text-blue-800 border-blue-200";
                if (status === "confirmado") return "bg-green-100 text-green-800 border-green-200";
                if (status === "cancelado") return "bg-red-100 text-red-800 border-red-200";
                if (status === "realizado") return "bg-gray-100 text-gray-700 border-gray-200";
                return "bg-gray-100 text-gray-700";
              }
              return (
                <div className="space-y-4">
                  {Object.entries(byDay).map(([day, appts]) => (
                    <div key={day} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className={cn("text-xs font-bold uppercase tracking-wide px-2.5 py-0.5 rounded-full",
                          day === todayStr ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                          {formatAppointmentDay(day, locale, dayLabels, now)}
                        </span>
                        <div className="flex-1 h-px bg-border" />
                        <span className="text-xs text-muted-foreground">
                          {appts.length === 1 ? tx("appointmentCount", { count: appts.length }) : tx("appointmentsCountLabel", { count: appts.length })}
                        </span>
                      </div>
                      {appts.map(a => (
                        <div key={a.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-sm text-foreground">{a.patientNome ?? tx("appointmentPatientFallback")}</span>
                              <span className={cn("text-xs px-2 py-0.5 rounded-full border font-medium", statusColor(a.status))}>{statusLabels[a.status] ?? a.status}</span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {a.hora} · <span className="capitalize">{typeLabels[a.tipo] ?? a.tipo}</span>
                            </p>
                            {a.observacoes && <p className="text-xs text-muted-foreground mt-0.5 italic truncate">{a.observacoes}</p>}
                          </div>
                          <Link href={`/patients/${a.patientId}`}>
                            <button type="button" className="shrink-0 inline-flex items-center h-8 px-3 rounded-lg text-xs font-semibold text-primary border border-primary/20 bg-primary/5 hover:bg-primary/10 transition-colors gap-1">
                              {tx("openPatientRecord")}
                            </button>
                          </Link>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        )}

      </div>
    </div>
  );
}
