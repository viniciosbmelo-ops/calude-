/**
 * DocRegen — home dashboard shown after login.
 * Regenerative medicine & pain focus: regenerative cases, pending PROM
 * follow-ups, upcoming appointments and pre-consultations.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  FlaskConical, BellRing, CalendarDays, ClipboardList, Plus, UserPlus, ChevronRight,
  AlertCircle, Send, Activity, Syringe, AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { operationalCoreMessages } from "@/locales/operational-core";
import { dashboardMessages } from "@/locales/dashboard";
import { reportFollowupPeriodLabel } from "@/locales/reporting-catalogs";
import { cn, formatDateOnly, formatLocalDate } from "@/lib/utils";
import {
  conditionCodeLabel,
  countAppointmentsWithin,
  formatAppointmentDay,
  EMPTY_PRE_CONSULT_SUMMARY,
  preConsultGroups,
  upcomingAppointments,
  type DashboardAppointment,
  type PreConsultSummary,
} from "@/lib/dashboard-metrics";

const BRAND_TEAL = "#0E9AA7";
const BRAND_NAVY = "#0B1F4B";
const PRE_CONSULT_COLORS = { awaiting: "#D97706", answered: "#16A34A" } as const;

type RegenStats = {
  total_cases: number;
  active_cases: number;
  procedures_this_month: number;
  total_procedures: number;
  complications_count: number;
  avg_vas: number | null;
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

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

function toTitleCase(str: string) {
  const skip = new Set(["de", "da", "do", "das", "dos", "e"]);
  return str.toLowerCase().split(" ")
    .map((w, i) => (i === 0 || !skip.has(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function doctorFirstName(nome: string | undefined) {
  if (!nome) return "";
  return toTitleCase(nome.replace(/^Dra?\.?\s*/i, "")).split(" ")[0];
}

function KpiCard({ label, value, hint, Icon, href, accent }: {
  label: string; value: number | string; hint: string; Icon: typeof FlaskConical; href: string; accent: string;
}) {
  return (
    <Link href={href}>
      <div className="bg-card border border-border rounded-2xl p-4 h-full cursor-pointer transition-shadow hover:shadow-md" style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}>
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</p>
          <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: `${accent}1A` }}>
            <Icon className="h-4 w-4" style={{ color: accent }} />
          </div>
        </div>
        <p className="text-3xl font-bold mt-2" style={{ color: BRAND_NAVY }}>{value}</p>
        <p className="text-xs text-muted-foreground mt-1">{hint}</p>
      </div>
    </Link>
  );
}

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-card border border-border rounded-2xl overflow-hidden" style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}>
      <div className="px-5 py-3.5 border-b border-border flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export default function Dashboard() {
  const { locale, formatDate } = useLanguage();
  const core = useScopedTranslations(operationalCoreMessages);
  const t = useScopedTranslations(dashboardMessages);
  const { user } = useAuth();
  const today = formatLocalDate();

  const statsQuery = useQuery<RegenStats>({
    queryKey: ["regen-stats"],
    queryFn: () => getJson<RegenStats>("/regen-api/regen/stats"),
    staleTime: 60_000,
  });
  const followupQuery = useQuery<RegenFollowupOverview>({
    queryKey: ["regen-followup-overview"],
    queryFn: () => getJson<RegenFollowupOverview>("/regen-api/regen/followup-overview"),
    staleTime: 60_000,
  });
  const appointmentsQuery = useQuery<DashboardAppointment[]>({
    queryKey: ["appointments"],
    queryFn: () => getJson<DashboardAppointment[]>("/regen-api/appointments"),
    staleTime: 30_000,
  });
  // Exact, doctor-wide pre-consultation counts from the aggregate endpoint.
  const preConsultQuery = useQuery<PreConsultSummary>({
    queryKey: ["pre-consults-summary"],
    queryFn: () => getJson<PreConsultSummary>("/regen-api/pre-consults/summary"),
    staleTime: 60_000,
  });

  const appointments = appointmentsQuery.data ?? [];
  const preConsults = preConsultQuery.data ?? EMPTY_PRE_CONSULT_SUMMARY;
  const preConsultLoading = preConsultQuery.isLoading;

  const hour = new Date().getHours();
  const greeting = hour < 12
    ? core("dashboardGreetingMorning")
    : hour < 18 ? core("dashboardGreetingAfternoon") : core("dashboardGreetingEvening");
  const firstName = doctorFirstName(user?.nome);
  const dateStr = formatDate(new Date(), { weekday: "long", day: "numeric", month: "long" });

  const stats = statsQuery.data;
  const fu = followupQuery.data;
  const upcoming = upcomingAppointments(appointments, today);
  const upcoming7 = countAppointmentsWithin(appointments, today, 7);
  const pendingFollowups: Array<RegenFollowupRow & { kind: "overdue" | "awaiting" }> = [
    ...(fu?.vencidos ?? []).map(r => ({ ...r, kind: "overdue" as const })),
    ...(fu?.aguardando ?? []).map(r => ({ ...r, kind: "awaiting" as const })),
  ];

  const typeLabel: Record<string, string> = {
    consulta: t("typeConsulta"), retorno: t("typeRetorno"),
    "procedimento regenerativo": t("typeRegen"), outro: t("typeOutro"),
  };
  const dayLabels = { today: t("today"), tomorrow: t("tomorrow") };
  const hasError = statsQuery.isError || followupQuery.isError || appointmentsQuery.isError || preConsultQuery.isError;
  const retryAll = () => {
    void statsQuery.refetch();
    void followupQuery.refetch();
    void appointmentsQuery.refetch();
    void preConsultQuery.refetch();
  };

  const kpisLoading = statsQuery.isLoading || followupQuery.isLoading || appointmentsQuery.isLoading;

  return (
    <div className="max-w-6xl mx-auto">
      {/* Mobile navy banner */}
      <div className="md:hidden" style={{ background: `linear-gradient(135deg, ${BRAND_NAVY} 0%, #12306B 100%)` }}>
        <div className="px-4 pt-5 pb-5">
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", margin: 0, textTransform: "capitalize" }}>{dateStr}</p>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#fff", margin: "2px 0 0" }}>
            {greeting}{firstName ? `, ${t("doctorPrefix")} ${firstName}` : ""}
          </h1>
          <p style={{ fontSize: 12, color: BRAND_TEAL, margin: "4px 0 0" }}>{t("subtitle")}</p>
        </div>
      </div>

      {/* Desktop header */}
      <div className="hidden md:flex items-end justify-between gap-4 p-8 pb-4">
        <div>
          <p className="text-sm text-muted-foreground capitalize">{dateStr}</p>
          <h1 className="text-3xl font-bold tracking-tight" style={{ color: BRAND_NAVY }}>
            {greeting}{firstName ? `, ${t("doctorPrefix")} ${firstName}` : ""}
          </h1>
          <p className="text-sm mt-1" style={{ color: BRAND_TEAL }}>{t("subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/patients/new">
            <Button variant="outline" className="gap-1.5"><UserPlus className="h-4 w-4" />{t("newPatient")}</Button>
          </Link>
          <Link href="/agenda">
            <Button variant="outline" className="gap-1.5"><CalendarDays className="h-4 w-4" />{t("newAppointment")}</Button>
          </Link>
          <Link href="/regen/caso/novo">
            <Button className="gap-1.5" style={{ background: BRAND_NAVY }}><Plus className="h-4 w-4" />{t("newRegenCase")}</Button>
          </Link>
        </div>
      </div>

      <div className="p-4 md:px-8 space-y-5 pb-10">
        {hasError && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
            <span className="flex items-center gap-2 text-destructive"><AlertTriangle className="h-4 w-4" />{t("loadError")}</span>
            <Button variant="outline" size="sm" onClick={retryAll}>{t("retry")}</Button>
          </div>
        )}

        {/* KPIs */}
        {kpisLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-28 rounded-2xl" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard
              label={t("kpiRegenCases")} value={stats?.total_cases ?? 0} Icon={FlaskConical} href="/regen" accent={BRAND_TEAL}
              hint={t("kpiRegenCasesHint", { active: stats?.active_cases ?? 0, month: stats?.procedures_this_month ?? 0 })}
            />
            <KpiCard
              label={t("kpiPendingProms")} value={(fu?.counts.vencidos ?? 0) + (fu?.counts.aguardando ?? 0)} Icon={BellRing} href="/followup-central" accent="#DC2626"
              hint={t("kpiPendingPromsHint", { overdue: fu?.counts.vencidos ?? 0, awaiting: fu?.counts.aguardando ?? 0 })}
            />
            <KpiCard
              label={t("kpiUpcoming")} value={upcoming7} Icon={CalendarDays} href="/agenda" accent="#2563EB"
              hint={t("kpiUpcomingHint", { total: upcoming.length })}
            />
            <KpiCard
              label={t("kpiPreConsults")} value={preConsultLoading ? "…" : preConsults.counts.awaiting} Icon={ClipboardList} href="/patients" accent="#D97706"
              hint={t("kpiPreConsultsHint", { answered: preConsults.counts.answered })}
            />
          </div>
        )}

        {/* Mobile quick actions */}
        <div className="grid grid-cols-2 gap-2 md:hidden">
          <Link href="/patients/new">
            <Button variant="outline" className="w-full gap-1.5"><UserPlus className="h-4 w-4" />{t("newPatient")}</Button>
          </Link>
          <Link href="/agenda">
            <Button variant="outline" className="w-full gap-1.5"><CalendarDays className="h-4 w-4" />{t("newAppointment")}</Button>
          </Link>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          {/* Upcoming appointments */}
          <Panel
            title={t("upcomingTitle")}
            action={<Link href="/agenda"><span className="text-xs font-semibold cursor-pointer" style={{ color: BRAND_TEAL }}>{t("viewAgenda")}</span></Link>}
          >
            {appointmentsQuery.isLoading ? (
              <Skeleton className="h-24 rounded-xl" />
            ) : upcoming.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">{t("upcomingEmpty")}</p>
            ) : (
              <div className="space-y-2">
                {upcoming.slice(0, 6).map(a => (
                  <Link key={a.id} href={`/patients/${a.patientId}`}>
                    <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-border bg-muted/20 hover:bg-muted/40 cursor-pointer transition-colors">
                      <div className="flex flex-col items-center justify-center rounded-lg px-2 py-1 min-w-[52px]" style={{ background: a.data === today ? BRAND_NAVY : "rgba(14,154,167,0.12)", color: a.data === today ? "#fff" : BRAND_NAVY }}>
                        <span className="text-sm font-bold leading-tight">{a.hora}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">{a.patientNome ? toTitleCase(a.patientNome) : t("patient")}</p>
                        <p className="text-xs text-muted-foreground truncate capitalize">
                          {formatAppointmentDay(a.data, locale, dayLabels)} · {typeLabel[a.tipo] ?? a.tipo}
                        </p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Panel>

          {/* Pending regenerative follow-ups / PROMs */}
          <Panel
            title={t("followupsTitle")}
            action={<Link href="/followup-central"><span className="text-xs font-semibold cursor-pointer" style={{ color: BRAND_TEAL }}>{t("viewFollowups")}</span></Link>}
          >
            {followupQuery.isLoading ? (
              <Skeleton className="h-24 rounded-xl" />
            ) : pendingFollowups.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">{t("followupsEmpty")}</p>
            ) : (
              <div className="space-y-2">
                {pendingFollowups.slice(0, 6).map(row => (
                  <Link key={row.notif_id} href={`/regen/caso/${row.case_id}`}>
                    <div className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-colors",
                      row.kind === "overdue"
                        ? "border-red-200 bg-red-50 hover:bg-red-100/70 dark:border-red-900 dark:bg-red-950/30"
                        : "border-blue-200 bg-blue-50 hover:bg-blue-100/70 dark:border-blue-900 dark:bg-blue-950/30",
                    )}>
                      {row.kind === "overdue"
                        ? <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
                        : <Send className="h-4 w-4 text-blue-600 shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">{toTitleCase(row.patient_name)}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {reportFollowupPeriodLabel(locale, row.periodo)}
                          {row.scheduled_date ? ` · ${formatDateOnly(row.scheduled_date, locale, undefined, row.scheduled_date)}` : ""}
                          {row.condition_code ? ` · ${conditionCodeLabel(row.condition_code)}` : ""}
                        </p>
                      </div>
                      <span className={cn("text-[10px] font-bold uppercase tracking-wide shrink-0", row.kind === "overdue" ? "text-red-600" : "text-blue-600")}>
                        {row.kind === "overdue" ? t("overdueTag") : t("awaitingTag")}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Panel>

          {/* Pre-consultations */}
          <Panel title={t("preConsultTitle")}>
            {preConsultLoading ? (
              <Skeleton className="h-24 rounded-xl" />
            ) : preConsults.counts.awaiting === 0 && preConsults.counts.answered === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">{t("preConsultEmpty")}</p>
            ) : (
              <div className="space-y-4">
                {preConsultGroups(preConsults).map(group => (
                  <div key={group.key} className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: PRE_CONSULT_COLORS[group.key] }}>
                      {group.key === "awaiting" ? t("preConsultAwaiting") : t("preConsultAnswered")} ({group.total})
                    </p>
                    {group.rows.map(row => (
                      <Link key={`${group.key}-${row.patientId}`} href={`/patients/${row.patientId}?aba=pre-consulta`}>
                        <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-border bg-muted/20 hover:bg-muted/40 cursor-pointer transition-colors">
                          <ClipboardList className="h-4 w-4 shrink-0" style={{ color: PRE_CONSULT_COLORS[group.key] }} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-foreground truncate">{toTitleCase(row.patientNome)}</p>
                            {row.date && (
                              <p className="text-xs text-muted-foreground">
                                {group.key === "awaiting"
                                  ? t("preConsultExpires", { date: formatDate(row.date, { day: "2-digit", month: "2-digit" }) })
                                  : t("preConsultSubmitted", { date: formatDate(row.date, { day: "2-digit", month: "2-digit" }) })}
                              </p>
                            )}
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
                        </div>
                      </Link>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {/* Regenerative indicators */}
          <Panel
            title={t("outcomesTitle")}
            action={<Link href="/regen"><span className="text-xs font-semibold cursor-pointer" style={{ color: BRAND_TEAL }}>{t("viewCases")}</span></Link>}
          >
            {statsQuery.isLoading ? (
              <Skeleton className="h-24 rounded-xl" />
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: t("totalProcedures"), value: stats?.total_procedures ?? 0, Icon: Syringe },
                  { label: t("avgVas"), value: stats?.avg_vas != null ? Number(stats.avg_vas).toFixed(1) : "—", Icon: Activity },
                  { label: t("adverseEvents"), value: stats?.complications_count ?? 0, Icon: AlertTriangle },
                ].map(({ label, value, Icon }) => (
                  <div key={label} className="rounded-xl border border-border bg-muted/20 p-3 text-center">
                    <Icon className="h-4 w-4 mx-auto" style={{ color: BRAND_TEAL }} />
                    <p className="text-2xl font-bold mt-1" style={{ color: BRAND_NAVY }}>{value}</p>
                    <p className="text-[11px] text-muted-foreground leading-tight">{label}</p>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
