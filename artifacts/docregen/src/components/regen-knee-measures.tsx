/**
 * Knee outcome measures UI for the regenerative case page:
 * - recommendation hint (VAS + SANE-joelho and the performance tests per condition);
 * - clinician entry form, small-multiple charts (one axis per measure, with
 *   units) and history table for the OARSI performance tests + knee ROM.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Activity, BarChart2, ChevronDown, ChevronUp, Info, LayoutList, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { cn, formatLocalDate as formatLocalDateInput } from "@/lib/utils";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { regenKneeMessages } from "@/locales/regen-knee";
import { calendarDateToNoonIso } from "@/lib/regen-case-detail";
import {
  KNEE_PERFORMANCE_BY_CODE,
  KNEE_PERFORMANCE_MEASURES,
  kneeRecommendation,
  performanceChartRows,
  performanceGroups,
  performanceInputError,
  performancePoints,
  type KneePerformanceDef,
  type KneePerformanceMeasure,
  type PerformanceTestRow,
} from "@/lib/regen-knee-measures";

type KneeKey = keyof typeof regenKneeMessages["pt-BR"];
type T = ReturnType<typeof useScopedTranslations<typeof regenKneeMessages["pt-BR"]>>;

/** Validated (dataviz) two-series palette: right / left knee. */
const SIDE_COLORS = { D: "#2563EB", E: "#D97706", value: "#2563EB" } as const;
const TONE_CLASS = { better: "text-green-700 bg-green-50 border-green-200", worse: "text-red-700 bg-red-50 border-red-200", same: "text-gray-600 bg-gray-50 border-gray-200" } as const;

export function measureLabel(t: T, code: string): string {
  return KNEE_PERFORMANCE_BY_CODE.has(code) ? t(`measure_${code}` as KneeKey) : code;
}

export function unitLabel(t: T, unit: KneePerformanceDef["unit"], short = false): string {
  if (unit === "rep") return short ? t("unitShort_rep") : t("unit_rep");
  return t(`unit_${unit}` as KneeKey);
}

function formatValue(locale: string, value: number, unit: KneePerformanceDef["unit"], t: T): string {
  const n = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
  return unit === "deg" ? `${n}${unitLabel(t, unit)}` : `${n} ${unitLabel(t, unit, true)}`;
}

function signed(locale: string, value: number): string {
  const n = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
  return value > 0 ? `+${n}` : n;
}

// ─── Recommendation hint ────────────────────────────────────────────────────

export function KneeRecommendationHint({
  conditionCode,
  onGoToTests,
}: {
  conditionCode: string | null | undefined;
  onGoToTests?: () => void;
}) {
  const t = useScopedTranslations(regenKneeMessages);
  const rec = kneeRecommendation(conditionCode);
  if (!rec) return null;
  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs text-sky-900" data-testid="knee-recommendation">
      <div className="flex items-start gap-2">
        <Info className="h-4 w-4 shrink-0 text-sky-600 mt-0.5" aria-hidden="true" />
        <div className="min-w-0 space-y-1.5">
          <p className="font-semibold">{t("recommendedTitle")}</p>
          <p>
            <span className="font-medium">{t("recommendedProms")}:</span>{" "}
            {t("vas")} · {t("saneKnee")}
          </p>
          {rec.tests.length > 0 && (
            <p>
              <span className="font-medium">{t("recommendedTests")}:</span>{" "}
              {rec.tests.map((code) => measureLabel(t, code)).join(" · ")}
            </p>
          )}
          <p className="text-[11px] text-sky-700">{t("recommendedNote")}</p>
          {onGoToTests && rec.tests.length > 0 && (
            <button type="button" onClick={onGoToTests} className="text-[11px] font-semibold text-sky-700 underline underline-offset-2">
              {t("recommendedGoToTests")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Entry form ─────────────────────────────────────────────────────────────

function PerformanceTestForm({
  caseId,
  conditionCode,
  timepoints,
  timepointLabel,
  onSaved,
}: {
  caseId: string;
  conditionCode: string;
  timepoints: readonly string[];
  timepointLabel: (timepoint: string) => string;
  onSaved: () => void;
}) {
  const t = useScopedTranslations(regenKneeMessages);
  const recommended = kneeRecommendation(conditionCode)?.tests ?? [];
  // Recommended tests first, then the rest (nothing is blocked).
  const ordered = useMemo(
    () => [...recommended, ...KNEE_PERFORMANCE_MEASURES.map((m) => m.code).filter((c) => !recommended.includes(c))],
    [recommended],
  );
  const [open, setOpen] = useState(false);
  const [measure, setMeasure] = useState<KneePerformanceMeasure>(ordered[0] ?? "CHAIR_STAND_30S");
  const [timepoint, setTimepoint] = useState("");
  const [value, setValue] = useState("");
  const [side, setSide] = useState("");
  const [steps, setSteps] = useState("");
  const [measuredOn, setMeasuredOn] = useState(() => formatLocalDateInput());
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const def = KNEE_PERFORMANCE_BY_CODE.get(measure)!;
  const unit = unitLabel(t, def.unit);

  const reset = () => { setValue(""); setSteps(""); setError(""); };

  const handleSave = async () => {
    if (!timepoint) { setError(t("selectTimepoint")); return; }
    const problem = performanceInputError(measure, value, side, steps);
    if (problem) {
      setError(t(`error_${problem}` as KneeKey, { min: def.min, max: def.max, unit }));
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/regen-api/regen/cases/${caseId}/performance-tests`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          measure,
          timepoint,
          value: Number(value.replace(",", ".")),
          side: def.perSide ? side : undefined,
          steps: measure === "STAIR_CLIMB" && steps.trim() ? Number(steps) : undefined,
          measuredAt: calendarDateToNoonIso(measuredOn),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const issue = Array.isArray(body?.issues) ? body.issues[0]?.message : null;
        throw new Error(issue || body?.error || res.statusText);
      }
      reset();
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const chip = (active: boolean) => cn(
    "px-3 py-1.5 rounded-lg border-2 text-xs font-medium transition-all text-left",
    active ? "bg-blue-50 border-blue-300 text-blue-800" : "bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100",
  );

  return (
    <div>
      <button type="button" onClick={() => setOpen((v) => !v)} data-testid="performance-form-toggle"
        className="w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 border-dashed border-blue-200 text-blue-600 bg-blue-50 hover:bg-blue-100 transition-all">
        <span className="flex items-center gap-2 text-sm font-semibold"><Plus className="h-4 w-4" />{t("registerTest")}</span>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {open && (
        <div className="mt-3 rounded-xl p-4 space-y-4 bg-white border border-gray-200 shadow-sm" data-testid="performance-form">
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t("measureLabel")}</p>
            <div className="flex flex-wrap gap-1.5">
              {ordered.map((code) => (
                <button key={code} type="button" onClick={() => { setMeasure(code); setSide(""); reset(); }}
                  className={chip(measure === code)} aria-pressed={measure === code}>
                  {measureLabel(t, code)}
                  {recommended.includes(code) && <span className="ml-1 text-[10px] text-sky-600">★</span>}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t("colTimepoint")}</p>
            <div className="flex flex-wrap gap-1.5">
              {timepoints.map((tp) => (
                <button key={tp} type="button" onClick={() => setTimepoint(tp)} className={chip(timepoint === tp)} aria-pressed={timepoint === tp}>
                  {timepointLabel(tp)}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="space-y-1 block">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t("valueLabel")} ({unit})</span>
              <input type="number" inputMode="decimal" step={def.integer ? 1 : 0.1} min={def.min} max={def.max}
                value={value} onChange={(e) => setValue(e.target.value)} data-testid="performance-value"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-800 outline-none focus:border-blue-400" />
              <span className="block text-[11px] text-gray-400">
                {t("rangeHint", { min: def.min, max: def.max, unit })} · {t(def.better === "lower" ? "better_lower" : "better_higher")}
              </span>
            </label>
            <label className="space-y-1 block">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t("colDate")}</span>
              <input type="date" value={measuredOn} onChange={(e) => setMeasuredOn(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-800 outline-none focus:border-blue-400" />
            </label>
            {def.perSide && (
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t("sideLabel")}</p>
                <div className="flex gap-1.5">
                  {(["D", "E"] as const).map((s) => (
                    <button key={s} type="button" onClick={() => setSide(s)} className={chip(side === s)} aria-pressed={side === s}>
                      {t(s === "D" ? "sideD" : "sideE")}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {measure === "STAIR_CLIMB" && (
              <label className="space-y-1 block">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t("stepsLabel")}</span>
                <input type="number" inputMode="numeric" step={1} min={1} max={100} value={steps} onChange={(e) => setSteps(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-800 outline-none focus:border-blue-400" />
              </label>
            )}
          </div>
          {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
          <button type="button" onClick={handleSave} disabled={saving}
            className="w-full py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-40">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {t("registerTest")}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Tab ────────────────────────────────────────────────────────────────────

export function PerformanceTestsTab({
  caseId,
  conditionCode,
  timepoints,
  timepointLabel,
}: {
  caseId: string;
  conditionCode: string;
  timepoints: readonly string[];
  timepointLabel: (timepoint: string) => string;
}) {
  const t = useScopedTranslations(regenKneeMessages);
  const { locale, formatDate } = useLanguage();
  const [rows, setRows] = useState<PerformanceTestRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/regen-api/regen/cases/${caseId}/performance-tests`, { credentials: "same-origin" });
      if (res.ok) setRows(await res.json());
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => { load(); }, [load]);

  const remove = async (id: string) => {
    const res = await fetch(`/regen-api/regen/cases/${caseId}/performance-tests/${id}`, { method: "DELETE", credentials: "same-origin" });
    if (res.ok) load();
  };

  const groups = useMemo(() => performanceGroups(rows), [rows]);
  const points = useMemo(() => performancePoints(rows), [rows]);

  return (
    <div className="space-y-4" data-testid="performance-tab">
      <KneeRecommendationHint conditionCode={conditionCode} />
      <PerformanceTestForm caseId={caseId} conditionCode={conditionCode} timepoints={timepoints} timepointLabel={timepointLabel} onSaved={load} />

      <div className="rounded-xl bg-white border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
          <BarChart2 className="h-4 w-4 text-blue-500" />
          <p className="text-sm font-bold text-gray-900">{t("testsEvolution")}</p>
        </div>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-blue-500" /></div>
        ) : groups.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-6">{t("testsEmpty")}</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3" data-testid="performance-charts">
            {groups.map((group) => {
              const unit = unitLabel(t, group.def.unit, true);
              const data = performanceChartRows(group, timepointLabel);
              const keys = group.series.map((s) => s.side ?? "value");
              return (
                <div key={group.def.code} className="rounded-lg border border-gray-100 p-3" data-testid={`performance-chart-${group.def.code}`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-1">
                    <p className="text-xs font-bold text-gray-900">{measureLabel(t, group.def.code)} <span className="font-normal text-gray-500">({unitLabel(t, group.def.unit)})</span></p>
                    <p className="text-[10px] text-gray-500">{t(group.def.better === "lower" ? "better_lower" : "better_higher")}</p>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {group.series.map((s) => (
                      <span key={s.side ?? "value"} data-testid="performance-change" data-assessment={s.assessment}
                        className={cn("rounded-md border px-2 py-0.5 text-[11px] font-semibold", TONE_CLASS[s.assessment])}>
                        {s.side ? `${t(s.side === "D" ? "sideD" : "sideE")}: ` : ""}
                        {formatValue(locale, s.baseline, group.def.unit, t)} → {formatValue(locale, s.last, group.def.unit, t)}
                        {s.points.length > 1 && <> ({signed(locale, s.change)} · {t(s.assessment)})</>}
                      </span>
                    ))}
                  </div>
                  {data.length < 2 ? (
                    <p className="text-[11px] text-gray-400 text-center py-4">{t("testsOnePoint")}</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={160}>
                      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                        <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#6B7280" }} interval={0} padding={{ left: 16, right: 16 }} />
                        <YAxis tick={{ fontSize: 10, fill: "#6B7280" }} width={44} domain={["auto", "auto"]}
                          tickFormatter={(v: number) => `${v}${group.def.unit === "deg" ? "°" : ""}`}
                          label={group.def.unit === "deg" ? undefined : { value: unit, angle: -90, position: "insideLeft", fontSize: 10, fill: "#6B7280" }} />
                        <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #E5E7EB" }}
                          formatter={(v) => formatValue(locale, Number(v), group.def.unit, t)} />
                        {keys.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
                        {keys.map((key) => (
                          <Line key={key} type="monotone" dataKey={key} isAnimationActive={false} connectNulls
                            name={key === "value" ? measureLabel(t, group.def.code) : t(key === "D" ? "sideD" : "sideE")}
                            stroke={SIDE_COLORS[key as keyof typeof SIDE_COLORS]} strokeWidth={2} dot={{ r: 4 }} />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-xl bg-white border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
          <LayoutList className="h-4 w-4 text-blue-500" />
          <p className="text-sm font-bold text-gray-900">{t("testsHistory")}</p>
        </div>
        {points.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-6">{t("testsEmpty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs" data-testid="performance-table">
              <thead>
                <tr className="bg-gray-50 text-gray-500">
                  <th className="text-left px-4 py-2 font-semibold">{t("colDate")}</th>
                  <th className="text-left px-3 py-2 font-semibold">{t("colTimepoint")}</th>
                  <th className="text-left px-3 py-2 font-semibold">{t("colMeasure")}</th>
                  <th className="text-left px-3 py-2 font-semibold">{t("colSide")}</th>
                  <th className="text-right px-3 py-2 font-semibold">{t("colValue")}</th>
                  <th className="text-left px-3 py-2 font-semibold">{t("colDetails")}</th>
                  <th className="px-2 py-2"><span className="sr-only">{t("remove")}</span></th>
                </tr>
              </thead>
              <tbody>
                {points.map((p, i) => {
                  const def = KNEE_PERFORMANCE_BY_CODE.get(p.measure)!;
                  return (
                    <tr key={p.id} className={i % 2 === 0 ? "bg-white" : "bg-gray-50/50"}>
                      <td className="px-4 py-2 text-gray-600 whitespace-nowrap">{formatDate(p.date, { day: "2-digit", month: "2-digit", year: "numeric" })}</td>
                      <td className="px-3 py-2 text-gray-800 whitespace-nowrap">{timepointLabel(p.timepoint)}</td>
                      <td className="px-3 py-2 text-gray-800">{measureLabel(t, p.measure)}</td>
                      <td className="px-3 py-2 text-gray-600">{p.side ? t(p.side === "D" ? "sideD" : "sideE") : "—"}</td>
                      <td className="px-3 py-2 text-right font-bold text-gray-900 whitespace-nowrap">{formatValue(locale, p.value, def.unit, t)}</td>
                      <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                        {p.speedMps != null ? `${t("speedLabel")}: ${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(p.speedMps)} m/s` : ""}
                        {p.steps != null ? t("stepsDetail", { steps: p.steps }) : ""}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <button type="button" onClick={() => remove(p.id)} aria-label={t("remove")} className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-600">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="flex items-start gap-1.5 px-1 text-[11px] text-gray-500">
        <Activity className="h-3.5 w-3.5 shrink-0 mt-px" aria-hidden="true" />
        {t("referenceNote")}
      </p>
    </div>
  );
}
