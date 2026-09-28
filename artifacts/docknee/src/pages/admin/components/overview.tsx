import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, Users, Stethoscope, MapPin, Globe2, TrendingUp, AlertTriangle, ArrowRight, ScanLine, type LucideIcon } from "lucide-react";
import { useAdminAnalytics } from "../queries";
import type { AdminAnalyticsData } from "../types";
import { useGetAdminDashboard } from "@workspace/api-client-react";
import { GeographicAccessItem } from "@workspace/api-client-react";
import { useState } from "react";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { toDisplayDate } from "@/lib/utils";
import { adminConsoleMessages } from "@/locales/admin-console";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import {
  CAMPAIGN_PERFORMANCE_COLUMNS,
  getCampaignPerformanceCells,
} from "./campaign-performance";
import { UtilizationFunnel, NavigationClickRanking } from "./utilization-funnel";

function formatNumber(num: number | null | undefined, locale = "pt-BR"): string {
  if (num == null) return "—";
  return new Intl.NumberFormat(locale).format(num);
}

function formatPercent(num: number | null | undefined): string {
  if (num == null) return "—";
  return `${num}%`;
}

function formatCurrency(cents: number | null | undefined, locale = "pt-BR"): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat(locale, { style: "currency", currency: "BRL" }).format(cents / 100);
}

interface MetricCardProps {
  title: string;
  value: number | null | undefined;
  delta?: number | null;
  source?: string;
  unavailableReason?: string | null;
  icon: LucideIcon;
  valueFormat?: "number" | "currency" | "percent";
}

function MetricCard({ title, value, delta, source, unavailableReason, icon: Icon, valueFormat = "number" }: MetricCardProps) {
  const { locale } = useLanguage();
  const t = useScopedTranslations(adminConsoleMessages);
  const isUnavailable = source === "unavailable";

  let displayValue = "—";
  if (!isUnavailable && value != null) {
    displayValue = valueFormat === "currency" ? formatCurrency(value, locale) : valueFormat === "percent" ? formatPercent(value) : formatNumber(value, locale);
  }

  return (
    <Card className="shadow-sm border-border/50">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground/50" />
      </CardHeader>
      <CardContent>
        {isUnavailable ? (
          <div className="space-y-1">
            <div className="text-xl font-bold text-muted-foreground opacity-50">{t("noData")}</div>
            <p className="text-[10px] text-muted-foreground/80 leading-tight">{unavailableReason}</p>
          </div>
        ) : (
          <>
            <div className="text-2xl font-bold font-mono tracking-tight">{displayValue}</div>
            {delta != null && (
              <p className={`text-[11px] font-medium mt-1 ${delta > 0 ? "text-emerald-600" : delta < 0 ? "text-rose-600" : "text-muted-foreground"}`}>
                {delta > 0 ? "↑" : delta < 0 ? "↓" : ""}{Math.abs(delta)}% {t("overview.previousPeriod")}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function GeographyRanking({ title, items, accent, icon: Icon }: { title: string; items: GeographicAccessItem[]; accent: string; icon: LucideIcon }) {
  const { locale } = useLanguage();
  const t = useScopedTranslations(adminConsoleMessages);
  const total = items.reduce((sum, item) => sum + item.count, 0);

  return (
    <div className="rounded-xl border border-border/70 bg-background/70 p-4">
      <div className="mb-4 flex items-center gap-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: `${accent}18`, color: accent }}>
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="text-[11px] text-muted-foreground">{t("overview.accessesPeriod", { count: formatNumber(total, locale) })}</p>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center">
          <MapPin className="mx-auto mb-2 h-4 w-4 text-muted-foreground/50" />
          <p className="text-xs text-muted-foreground">{t("overview.noAccess")}</p>
        </div>
      ) : (
        <div className="max-h-[300px] space-y-3 overflow-y-auto pr-1 custom-scrollbar">
          {items.map((item) => {
            const percentage = total > 0 ? Math.max(2, (item.count / total) * 100) : 0;
            return (
              <div key={`${item.kind}-${item.code ?? "unknown"}`} className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs">
                  <span className="min-w-[2rem] rounded px-1 py-0.5 text-center font-bold text-[10px]" style={{ background: `${accent}14`, color: accent }}>
                    {item.code ?? "—"}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-foreground font-medium" title={item.label}>
                    {item.label}
                  </span>
                   <span className="font-mono text-[11px] text-muted-foreground">{formatNumber(item.count, locale)}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted/50">
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${percentage}%`, background: accent }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Overview() {
  const [period, setPeriod] = useState("30d");
  const { data: analytics, isLoading: analyticsLoading } = useAdminAnalytics(period);
  const { data: dashboard, isLoading: dashboardLoading } = useGetAdminDashboard();
  const { formatDate } = useLanguage();
  const t = useScopedTranslations(adminConsoleMessages);
  const campaignChannelLabel = (value: string) => ({
    in_app: t("option.inApp"),
    email: t("option.email"),
    social: t("option.social"),
    other: t("option.other"),
  }[value] ?? value);
  const campaignStatusLabel = (value: string) => ({
    draft: t("option.draft"),
    active: t("option.active"),
    paused: t("option.paused"),
    ended: t("option.ended"),
  }[value] ?? value);
  const campaignLabels = {
    budget: t("campaign.budget"),
    visits: t("campaign.visits"),
    registrations: t("campaign.registrations"),
    cac: t("campaign.cac"),
    revenue: t("campaign.revenue"),
    roi: t("campaign.roi"),
  };

  if (analyticsLoading || dashboardLoading) {
    return <div className="space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-[400px] w-full" /></div>;
  }

  const kpis = analytics?.kpis;
  const webVitals = analytics?.webVitals;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">{t("overview.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("overview.subtitle")}</p>
        </div>
        <div className="flex bg-muted/50 p-1 rounded-lg border border-border/50">
          {[
             { id: "7d", label: t("overview.days7") },
             { id: "30d", label: t("overview.days30") },
             { id: "90d", label: t("overview.months3") },
             { id: "12m", label: t("overview.months12") }
          ].map(p => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                period === p.id
                  ? "bg-background text-foreground shadow-sm border border-border/50"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {analytics?.meta.dataAvailability.note && (
        <div className="bg-blue-50 border border-blue-200 text-blue-800 text-xs px-4 py-2 rounded-lg flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {analytics.meta.dataAvailability.note}
        </div>
      )}

      {/* KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        <MetricCard
          title={t("explicit.090")}
          icon={Users}
          value={dashboard?.totalDoctors}
          source="doctors"
        />
        <MetricCard
          title={t("explicit.091")}
          icon={Users}
          value={kpis?.activeUsers.current}
          delta={kpis?.activeUsers.deltaPercent}
          source={kpis?.activeUsers.source}
        />
        <MetricCard
          title={t("explicit.261")}
          icon={Stethoscope}
          value={kpis?.newDoctors.current}
          delta={kpis?.newDoctors.deltaPercent}
          source={kpis?.newDoctors.source}
        />
        <MetricCard
          title={t("explicit.092")}
          icon={Activity}
          value={kpis?.activationRate.current}
          valueFormat="percent"
          source={kpis?.activationRate.source}
          unavailableReason={kpis?.activationRate.unavailableReason}
        />
        <MetricCard
          title={t("explicit.093")}
          icon={TrendingUp}
          value={kpis?.revenue.mrrCents}
          valueFormat="currency"
          source={kpis?.revenue.source}
          unavailableReason={kpis?.revenue.unavailableReason}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title={t("explicit.094")}
          icon={TrendingUp}
          value={kpis?.revenue.arpuCents}
          valueFormat="currency"
          source={kpis?.revenue.source}
          unavailableReason={kpis?.revenue.unavailableReason}
        />
        <MetricCard
          title={t("explicit.095")}
          icon={Activity}
          value={kpis?.revenue.churnRate}
          valueFormat="percent"
          source={kpis?.revenue.churnRate == null ? "unavailable" : kpis?.revenue.source}
          unavailableReason={kpis?.revenue.churnUnavailableReason}
        />
        <MetricCard
          title="LTV estimado"
          icon={TrendingUp}
          value={kpis?.revenue.ltvCents}
          valueFormat="currency"
          source={kpis?.revenue.ltvCents == null ? "unavailable" : kpis?.revenue.source}
          unavailableReason={kpis?.revenue.ltvUnavailableReason}
        />
        <MetricCard
          title={t("explicit.096")}
          icon={Activity}
          value={kpis?.api.p95DurationMs}
          source={kpis?.api.p95DurationMs == null ? "unavailable" : kpis?.api.source}
          unavailableReason={kpis?.api.p95DurationMs == null ? t("explicit.097") : kpis?.api.unavailableReason}
        />
      </div>


      <UtilizationFunnel funnel={analytics?.usageFunnel} />

      <NavigationClickRanking ranking={analytics?.navigationClickRanking} />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="col-span-1 md:col-span-3 shadow-sm border-border/50 flex flex-col">
          <CardHeader>
            <CardTitle className="text-base font-bold">{t("explicit.098")}</CardTitle>
            <CardDescription>{t("explicit.099")}</CardDescription>
          </CardHeader>
          <CardContent className="flex-1">
            {analytics?.timeSeries.dailySessions && analytics.timeSeries.dailySessions.length > 0 ? (
              <div className="h-[250px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={analytics.timeSeries.dailySessions} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorSessions" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="colorActive" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--accent))" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="hsl(var(--accent))" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => { const d = toDisplayDate(v); return `${d.getDate()}/${d.getMonth()+1}` }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "hsl(var(--background))", borderRadius: "8px", border: "1px solid hsl(var(--border))", fontSize: "12px" }}
                       labelFormatter={(v) => formatDate(String(v))}
                    />
                    <Area type="monotone" dataKey="sessions" name="Sessões" stroke="hsl(var(--primary))" strokeWidth={2} fillOpacity={1} fill="url(#colorSessions)" />
                    <Area type="monotone" dataKey="activeUsers" name="Usuários Únicos" stroke="hsl(var(--accent))" strokeWidth={2} fillOpacity={1} fill="url(#colorActive)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[250px] flex items-center justify-center border border-dashed border-border rounded-lg text-sm text-muted-foreground">
                {t("explicit.100")}
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-6 border-t border-border/50">
              <div>
                <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">{t("explicit.101")}</p>
                {kpis?.subscriptions.source === "unavailable" ? (
                  <p className="text-xs text-muted-foreground italic mt-1">{kpis.subscriptions.unavailableReason}</p>
                ) : (
                  <div className="text-lg font-bold font-mono text-emerald-600">{formatNumber(kpis?.subscriptions.active)}</div>
                )}
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">{t("explicit.102")}</p>
                {kpis?.subscriptions.source === "unavailable" ? (
                  <p className="text-xs text-muted-foreground italic mt-1">—</p>
                ) : (
                  <div className="text-lg font-bold font-mono text-blue-600">{formatNumber(kpis?.subscriptions.trial)}</div>
                )}
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">{t("explicit.103")}</p>
                {kpis?.subscriptions.source === "unavailable" ? (
                  <p className="text-xs text-muted-foreground italic mt-1">—</p>
                ) : (
                  <div className="text-lg font-bold font-mono text-amber-600">{formatNumber(kpis?.subscriptions.pastDue)}</div>
                )}
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">{t("explicit.104")}</p>
                {kpis?.revenue.source === "unavailable" ? (
                  <p className="text-xs text-muted-foreground italic mt-1">{kpis.revenue.unavailableReason}</p>
                ) : (
                  <div className="text-lg font-bold font-mono">{formatCurrency(kpis?.revenue.arrCents)}</div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-1 shadow-sm border-border/50 flex flex-col">
          <CardHeader>
            <CardTitle className="text-base font-bold">{t("explicit.105")}</CardTitle>
            <CardDescription>{t("explicit.106")}</CardDescription>
          </CardHeader>
          <CardContent className="flex-1">
            {analytics?.funnel ? (
              <div className="space-y-4">
                <div className="space-y-1">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-semibold">{t("explicit.107")}</span>
                    <span className="font-mono">{formatNumber(analytics.funnel.acquisitionVisit)}</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-slate-300 w-full" />
                  </div>
                </div>

                <div className="flex justify-center -my-2"><ArrowRight className="h-4 w-4 text-muted-foreground/50 rotate-90" /></div>

                <div className="space-y-1">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-semibold">{t("explicit.262")}</span>
                    <span className="font-mono">{formatNumber(analytics.funnel.register)}</span>
                  </div>
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>{t("explicit.108")} {formatPercent(analytics.funnel.acquisitionToRegisterPct)}</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-blue-400" style={{ width: `${Math.max(5, analytics.funnel.acquisitionToRegisterPct || 0)}%` }} />
                  </div>
                </div>

                <div className="flex justify-center -my-2"><ArrowRight className="h-4 w-4 text-muted-foreground/50 rotate-90" /></div>

                <div className="space-y-1">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-semibold">{t("explicit.109")}</span>
                    <span className="font-mono">{formatNumber(analytics.funnel.checkoutStarted)}</span>
                  </div>
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>{t("explicit.108")} {formatPercent(analytics.funnel.registerToCheckoutPct)}</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-500" style={{ width: `${Math.max(5, analytics.funnel.registerToCheckoutPct || 0)}%` }} />
                  </div>
                </div>

                <div className="flex justify-center -my-2"><ArrowRight className="h-4 w-4 text-muted-foreground/50 rotate-90" /></div>

                <div className="space-y-1">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-semibold text-emerald-700 dark:text-emerald-400">{t("explicit.101")}</span>
                    <span className="font-mono text-emerald-700 dark:text-emerald-400">{formatNumber(analytics.funnel.subscriptionActivated)}</span>
                  </div>
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>{t("explicit.263")} {formatPercent(analytics.funnel.checkoutToSubscriptionPct)}</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500" style={{ width: `${Math.max(5, analytics.funnel.checkoutToSubscriptionPct || 0)}%` }} />
                  </div>
                </div>

                <div className="pt-3 mt-3 border-t border-border/50 text-center">
                  <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">{t("explicit.110")}</p>
                  <p className="text-xl font-bold font-mono text-foreground mt-1">{formatPercent(analytics.funnel.totalConversionPct)}</p>
                </div>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center border border-dashed border-border rounded-lg text-sm text-muted-foreground p-4 text-center">
                {t("explicit.111")}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="col-span-1 md:col-span-2 shadow-sm border-border/50">
          <CardHeader>
            <CardTitle className="text-base font-bold">{t("explicit.112")}</CardTitle>
            <CardDescription>{t("explicit.113")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div className="space-y-1 bg-muted/30 p-3 rounded-lg border border-border/50">
                <p className="text-[10px] text-muted-foreground font-semibold uppercase">{t("explicit.114")}</p>
                {kpis?.api.source === "unavailable" ? (
                  <div className="text-xs text-muted-foreground italic mt-1">{kpis.api.unavailableReason}</div>
                ) : (
                  <>
                    <div className="text-lg font-bold font-mono">{formatNumber(kpis?.api.requestsCurrent)}</div>
                    <p className={`text-[10px] font-medium mt-1 ${kpis?.api.requestsPrior && kpis.api.requestsCurrent > kpis.api.requestsPrior ? "text-amber-600" : "text-emerald-600"}`}>
                      vs {formatNumber(kpis?.api.requestsPrior)} {t("explicit.264")}
                    </p>
                  </>
                )}
              </div>
              <div className="space-y-1 bg-muted/30 p-3 rounded-lg border border-border/50">
                <p className="text-[10px] text-muted-foreground font-semibold uppercase">{t("explicit.115")}</p>
                <div className="text-lg font-bold font-mono">
                  {kpis?.api.p95DurationMs == null ? "—" : `${formatNumber(kpis.api.p95DurationMs)} ms`}
                </div>
              </div>
              <div className="space-y-1 bg-muted/30 p-3 rounded-lg border border-border/50">
                <p className="text-[10px] text-muted-foreground font-semibold uppercase">{t("explicit.116")}</p>
                {kpis?.api.source === "unavailable" ? (
                  <div className="text-xs text-muted-foreground italic mt-1">—</div>
                ) : (
                  <div className={`text-lg font-bold font-mono ${kpis?.api.errorRateCurrent && kpis.api.errorRateCurrent > 1 ? 'text-red-600' : 'text-emerald-600'}`}>
                    {formatPercent(kpis?.api.errorRateCurrent)}
                  </div>
                )}
              </div>
              <div className="space-y-1 bg-muted/30 p-3 rounded-lg border border-border/50">
                <p className="text-[10px] text-muted-foreground font-semibold uppercase">{t("explicit.117")}</p>
                <div className="text-lg font-bold font-mono">{formatNumber(kpis?.support.openTickets)}</div>
              </div>
              <div className="space-y-1 bg-red-50/50 dark:bg-red-950/20 p-3 rounded-lg border border-red-200/50 dark:border-red-900/50">
                <p className="text-[10px] text-red-800 dark:text-red-400 font-semibold uppercase">{t("explicit.118")}</p>
                <div className="text-lg font-bold font-mono text-red-600 dark:text-red-500">{formatNumber(kpis?.support.criticalTickets)}</div>
              </div>

              <div className="col-span-2 sm:col-span-3 pt-2 border-t border-border/50 mt-2">
                <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-3">{t("explicit.119")}</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-[10px] text-muted-foreground">LCP (Largest Contentful Paint - p75)</p>
                    {webVitals?.source === "unavailable" ? (
                      <p className="text-sm font-mono text-muted-foreground/50 mt-1">{webVitals.unavailableReason}</p>
                    ) : (
                      <p className={`text-sm font-mono font-bold mt-1 ${webVitals?.lcpP75Ms && webVitals.lcpP75Ms > 2500 ? 'text-amber-600' : 'text-emerald-600'}`}>
                        {webVitals?.lcpP75Ms}ms <span className="text-[10px] font-normal text-muted-foreground ml-1">{webVitals?.lcpP75Ms && webVitals.lcpP75Ms <= 2500 ? "(Bom)" : t("explicit.120")}</span>
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">CLS (Cumulative Layout Shift - p75)</p>
                    {webVitals?.source === "unavailable" ? (
                      <p className="text-sm font-mono text-muted-foreground/50 mt-1">—</p>
                    ) : (
                      <p className={`text-sm font-mono font-bold mt-1 ${webVitals?.clsP75 && webVitals.clsP75 > 0.1 ? 'text-amber-600' : 'text-emerald-600'}`}>
                        {webVitals?.clsP75} <span className="text-[10px] font-normal text-muted-foreground ml-1">{webVitals?.clsP75 && webVitals.clsP75 <= 0.1 ? "(Bom)" : t("explicit.120")}</span>
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {dashboard?.geographicAccesses && (
          <div className="space-y-4">
            <GeographyRanking
              title={t("explicit.222")}
              items={dashboard.geographicAccesses.platform || []}
              accent="#1FB6E1"
              icon={MapPin}
            />
            <GeographyRanking
              title={t("explicit.223")}
              items={dashboard.geographicAccesses.site || []}
              accent="#1A365D"
              icon={Globe2}
            />
          </div>
        )}
      </div>

      {analytics?.retention.cohorts && analytics.retention.cohorts.length > 0 && (
        <Card className="shadow-sm border-border/50">
          <CardHeader>
            <CardTitle className="text-base font-bold">{t("explicit.121")}</CardTitle>
            <CardDescription>{t("explicit.122")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left">{t("explicit.123")}</th>
                    <th className="px-4 py-3 text-right">{t("explicit.124")}</th>
                    <th className="px-4 py-3 text-right">{t("explicit.125")}</th>
                    <th className="px-4 py-3 text-right">{t("explicit.126")}</th>
                    <th className="px-4 py-3 text-right">{t("explicit.127")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {analytics.retention.cohorts.map((cohort) => (
                    <tr key={cohort.cohortWeek}>
                       <td className="px-4 py-3">{formatDate(`${cohort.cohortWeek}T12:00:00`)}</td>
                      <td className="px-4 py-3 text-right font-mono">{formatNumber(cohort.cohortSize)}</td>
                      <td className="px-4 py-3 text-right font-mono">{formatPercent(cohort.week1Percent)}</td>
                      <td className="px-4 py-3 text-right font-mono">{formatPercent(cohort.week2Percent)}</td>
                      <td className="px-4 py-3 text-right font-mono">{formatPercent(cohort.week4Percent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {analytics?.campaigns && analytics.campaigns.length > 0 && (
        <Card className="shadow-sm border-border/50">
          <CardHeader>
            <CardTitle className="text-base font-bold">{t("explicit.128")}</CardTitle>
            <CardDescription>{t("explicit.129")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-muted/30 text-xs uppercase text-muted-foreground border-b border-border/50">
                  <tr>
                    <th className="px-4 py-3 font-semibold">{t("explicit.130")}</th>
                    {CAMPAIGN_PERFORMANCE_COLUMNS.map((column) => (
                      <th key={column.key} className="px-4 py-3 font-semibold text-right">
                        {campaignLabels[column.key]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {analytics.campaigns.map(camp => (
                    <tr key={camp.id} className="hover:bg-muted/10">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-foreground">{camp.name}</div>
                        <div className="text-[10px] text-muted-foreground uppercase">{campaignChannelLabel(camp.channel)} · {campaignStatusLabel(camp.status)}</div>
                        <div className="text-[10px] text-muted-foreground">{camp.utmCampaign ? `utm_campaign=${camp.utmCampaign}` : t("explicit.131")}</div>
                      </td>
                       {getCampaignPerformanceCells(camp).map((metric) => (
                         <td key={metric.key} data-metric={metric.key} className="px-4 py-3 text-right font-mono">
                           {metric.key === "cac" && (camp.source === "unavailable" || metric.value === null) ? (
                             <span className="text-[10px] text-muted-foreground italic" title={camp.unavailableReason}>
                               {t("explicit.132")}
                             </span>
                           ) : metric.key === "cac" ? (
                             <Badge variant="outline" className="font-mono bg-background">{formatCurrency(metric.value)}</Badge>
                           ) : metric.format === "currency" ? (
                             formatCurrency(metric.value)
                           ) : metric.format === "percent" ? (
                             formatPercent(metric.value)
                           ) : (
                             formatNumber(metric.value)
                           )}
                         </td>
                       ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
