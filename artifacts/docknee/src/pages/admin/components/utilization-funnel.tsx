import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { adminConsoleMessages } from "@/locales/admin-console";
import type { AdminAnalyticsData } from "../types";

function formatNumber(num: number | null | undefined, locale = "pt-BR"): string {
  if (num == null) return "—";
  return new Intl.NumberFormat(locale).format(num);
}

export function UtilizationFunnel({ funnel }: { funnel: NonNullable<AdminAnalyticsData["usageFunnel"]> | undefined }) {
  const { locale, formatDate } = useLanguage();
  const t = useScopedTranslations(adminConsoleMessages);

  if (!funnel) return null;

  return (
    <Card className="shadow-sm border-border/50">
      <CardHeader>
        <CardTitle className="text-base font-bold">{t("overview.utilization.title")}</CardTitle>
        <CardDescription>
          {t("overview.utilization.subtitle")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {funnel.coverage.unavailableReason ? (
           <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">
             {t("overview.utilization.unavailable")}
           </div>
        ) : funnel.coverage.empty ? (
           <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">
             {t("overview.utilization.empty")}
           </div>
        ) : (
          <>
            <div className="text-xs text-muted-foreground mb-4">
              <p className="font-semibold">{t("overview.utilization.coverage")} {funnel.coverage.start ? t("overview.utilization.coverageSince", { date: formatDate(funnel.coverage.start) }) : t("overview.utilization.coverageHistoric")}</p>
              <ul className="list-disc list-inside ml-4 mt-1 space-y-1">
                <li>{t("overview.utilization.sources")}</li>
                <li>{t("overview.utilization.limitation.time")}</li>
                <li>{t("overview.utilization.limitation.physio")}</li>
                <li>{t("overview.utilization.limitation.xray")}</li>
              </ul>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
               <div className="rounded-lg bg-muted/30 px-4 py-3 border border-border/50">
                 <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("overview.utilization.activeDoctors")}</p>
                 <p className="mt-1 text-2xl font-bold font-mono">{formatNumber(funnel.activeDoctors, locale)}</p>
               </div>
               <div className="rounded-lg bg-emerald-50/50 dark:bg-emerald-950/20 px-4 py-3 border border-emerald-200/50 dark:border-emerald-900/50">
                 <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-800 dark:text-emerald-400">{t("overview.utilization.documented")}</p>
                 <p className="mt-1 text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-500">{formatNumber(funnel.documentedDoctors, locale)}</p>
                 <p className="text-[10px] text-emerald-700/70 mt-1">
                   {t("overview.utilization.documentedPct", { pct: String(funnel.activeDoctors > 0 ? Math.round((funnel.documentedDoctors / funnel.activeDoctors) * 100) : 0) })}
                 </p>
               </div>
               <div className="rounded-lg bg-amber-50/50 dark:bg-amber-950/20 px-4 py-3 border border-amber-200/50 dark:border-amber-900/50">
                 <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-400">{t("overview.utilization.noDoc")}</p>
                 <p className="mt-1 text-2xl font-bold font-mono text-amber-600 dark:text-amber-500">{formatNumber(funnel.enteredWithoutDocumentationDoctors, locale)}</p>
                 <p className="text-[10px] text-amber-700/70 mt-1">
                   {t("overview.utilization.noDocPct", { pct: String(funnel.activeDoctors > 0 ? Math.round((funnel.enteredWithoutDocumentationDoctors / funnel.activeDoctors) * 100) : 0) })}
                 </p>
               </div>
               <div className="rounded-lg bg-cyan-50/50 dark:bg-cyan-950/20 px-4 py-3 border border-cyan-200/50 dark:border-cyan-900/50 relative overflow-hidden">
                 <div className="absolute top-2 right-2 text-[10px] bg-cyan-200/50 text-cyan-800 px-1.5 py-0.5 rounded font-bold">{t("overview.utilization.subgroup")}</div>
                 <p className="text-[10px] font-semibold uppercase tracking-wider text-cyan-800 dark:text-cyan-400 pr-12">{t("overview.utilization.rxOnly")}</p>
                 <p className="mt-1 text-2xl font-bold font-mono text-cyan-600 dark:text-cyan-500">{formatNumber(funnel.rxOnlyDoctors, locale)}</p>
                 <p className="text-[10px] text-cyan-700/70 mt-1">
                   {t("overview.utilization.rxOnlyPct", { pct: String(funnel.enteredWithoutDocumentationDoctors > 0 ? Math.round((funnel.rxOnlyDoctors / funnel.enteredWithoutDocumentationDoctors) * 100) : 0) })}
                 </p>
               </div>
            </div>

            <div className="bg-muted/40 rounded-lg p-3 text-[11px] text-muted-foreground border border-border/40">
              <strong>{t("overview.utilization.noteTitle")}</strong> {funnel.overlap.rxOnlyIncludedInEnteredWithoutDocumentation ? t("overview.utilization.rxOnlyExplanation") : t("overview.utilization.rxOnlyExplanationNoOverlap")}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
              <div className="border border-border/60 rounded-lg overflow-hidden flex flex-col">
                <div className="bg-muted/30 px-3 py-2 border-b border-border/50">
                  <h4 className="text-xs font-bold text-foreground">{t("overview.utilization.listNoDoc")}</h4>
                </div>
                <div className="flex-1 overflow-auto max-h-[200px] bg-background">
                  {funnel.enteredWithoutDocumentationDoctorList.length === 0 ? (
                    <div className="p-4 text-center text-xs text-muted-foreground">{t("overview.utilization.noDoctors")}</div>
                  ) : (
                    <ul className="divide-y divide-border/50 text-xs">
                      {funnel.enteredWithoutDocumentationDoctorList.map((doc, i) => (
                        <li key={i} className="px-3 py-2 flex flex-col">
                          <span className="font-semibold">{doc.name}</span>
                          <span className="text-muted-foreground text-[10px]">{doc.email}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <div className="border border-border/60 rounded-lg overflow-hidden flex flex-col">
                <div className="bg-muted/30 px-3 py-2 border-b border-border/50">
                  <h4 className="text-xs font-bold text-foreground">{t("overview.utilization.listRxOnly")}</h4>
                </div>
                <div className="flex-1 overflow-auto max-h-[200px] bg-background">
                  {funnel.rxOnlyDoctorList.length === 0 ? (
                    <div className="p-4 text-center text-xs text-muted-foreground">{t("overview.utilization.noDoctors")}</div>
                  ) : (
                    <ul className="divide-y divide-border/50 text-xs">
                      {funnel.rxOnlyDoctorList.map((doc, i) => (
                        <li key={i} className="px-3 py-2 flex flex-col">
                          <span className="font-semibold">{doc.name}</span>
                          <span className="text-muted-foreground text-[10px]">{doc.email}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function NavigationClickRanking({ ranking }: { ranking: NonNullable<AdminAnalyticsData["navigationClickRanking"]> | undefined }) {
  const { locale, formatDate } = useLanguage();
  const t = useScopedTranslations(adminConsoleMessages);

  if (!ranking) return null;

  return (
    <Card className="shadow-sm border-border/50">
      <CardHeader>
        <CardTitle className="text-base font-bold">{t("overview.clicks.title")}</CardTitle>
        <CardDescription>
          {t("overview.clicks.subtitle")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {ranking.unavailableReason ? (
           <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">
             {t("overview.clicks.unavailable")}
           </div>
        ) : ranking.empty ? (
           <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">
             {ranking.coverageStart ? t("overview.clicks.empty", { date: formatDate(ranking.coverageStart) }) : t("overview.clicks.coverageUnknown")}
           </div>
        ) : (
          <div className="space-y-4">
            <div className="text-xs text-muted-foreground">
               {ranking.coverageStart ? t("overview.clicks.coverageStart", { date: formatDate(ranking.coverageStart) }) : t("overview.clicks.coverageUnknown")}
            </div>
            <div className="overflow-x-auto rounded-lg border border-border/60">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/20 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left">{t("overview.clicks.route")}</th>
                    <th className="px-4 py-3 text-left">{t("overview.clicks.feature")}</th>
                    <th className="px-4 py-3 text-right">{t("overview.clicks.totalClicks")}</th>
                    <th className="px-4 py-3 text-right">{t("overview.clicks.uniqueDoctors")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {ranking.items.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-xs text-muted-foreground">{t("overview.clicks.noRecords")}</td>
                    </tr>
                  ) : (
                    ranking.items.map((item, idx) => (
                      <tr key={idx} className="hover:bg-muted/10">
                         <td className="px-4 py-3 font-mono text-xs">{item.route}</td>
                         <td className="px-4 py-3 font-medium">{item.feature}</td>
                         <td className="px-4 py-3 text-right font-mono">{formatNumber(item.count, locale)}</td>
                         <td className="px-4 py-3 text-right font-mono">{formatNumber(item.uniqueDoctors, locale)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
