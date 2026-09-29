/**
 * DocRegen — Módulo 12: Pesquisa Clínica
 * Banco de dados anonimizado com filtros e exportação CSV
 */
import { useState, useCallback } from "react";
import { useLocation } from "wouter";
import {
  ChevronLeft, Download, Filter, Search, FlaskConical,
  Users, AlertCircle, Loader2, X,
} from "lucide-react";
import { sortByPtBrName } from "@/lib/utils";
import { REGEN_CONDITION_CATALOG, regenConditionLabel } from "@/lib/regen-conditions";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { regenCoreMessages } from "@/locales/regen-core";
import { regenKneeMessages } from "@/locales/regen-knee";
import { KNEE_PERFORMANCE_BY_CODE, assessChange } from "@/lib/regen-knee-measures";

function authHeaders() {
  return {};
}

const CONDITIONS = REGEN_CONDITION_CATALOG.map(condition => condition.code);
const PRODUCTS = ["PRP","LP_PRP","LR_PRP","BMAC","MFAT","AH","COLAGENO","LISADO"];

interface ResearchRow {
  id: string;
  age: number | null;
  sex: string | null;
  imc: number | null;
  condition: string;
  status: string;
  procedure_count: number;
  adverse_events: number;
  avg_vas: number | null;
  dm: boolean;
  created_at: string;
  /** Knee measures: `<key>_baseline`, `<key>_last`, `<key>_change` (SANE-joelho, OARSI tests, ROM per side). */
  [measureColumn: string]: unknown;
}

/** Knee measure change columns shown in the table (the CSV carries every measure). */
const KNEE_RESEARCH_COLUMNS = [
  { key: "sane_joelho", better: "higher" as const },
  { key: "chair_stand_30s", better: KNEE_PERFORMANCE_BY_CODE.get("CHAIR_STAND_30S")!.better },
  { key: "walk_40m", better: KNEE_PERFORMANCE_BY_CODE.get("WALK_40M")!.better },
  { key: "tug", better: KNEE_PERFORMANCE_BY_CODE.get("TUG")!.better },
  { key: "stair_climb", better: KNEE_PERFORMANCE_BY_CODE.get("STAIR_CLIMB")!.better },
];

export default function RegenPesquisa() {
  const [, navigate] = useLocation();
  const { locale } = useLanguage();
  const t = useScopedTranslations(regenCoreMessages);
  const tk = useScopedTranslations(regenKneeMessages);
  const kneeHeaders: Record<string, string> = {
    sane_joelho: tk("saneKnee"),
    chair_stand_30s: tk("measure_CHAIR_STAND_30S"),
    walk_40m: "40 m",
    tug: "TUG",
    stair_climb: tk("measure_STAIR_CLIMB"),
  };

  // Filters
  const [sex,       setSex]       = useState("");
  const [condition, setCondition] = useState("");
  const [procedure, setProcedure] = useState("");
  const [ageMin,    setAgeMin]    = useState("");
  const [ageMax,    setAgeMax]    = useState("");
  const [imcMin,    setImcMin]    = useState("");
  const [imcMax,    setImcMax]    = useState("");

  const [rows,    setRows]    = useState<ResearchRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  function buildQS(extra?: Record<string, string>) {
    const p: Record<string, string> = {};
    if (sex)       p.sex       = sex;
    if (condition) p.condition = condition;
    if (procedure) p.procedure = procedure;
    if (ageMin)    p.age_min   = ageMin;
    if (ageMax)    p.age_max   = ageMax;
    if (imcMin)    p.imc_min   = imcMin;
    if (imcMax)    p.imc_max   = imcMax;
    if (extra)     Object.assign(p, extra);
    return new URLSearchParams(p).toString();
  }

  const handleSearch = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/regen-api/regen/research?${buildQS()}`, { credentials: "same-origin", headers: authHeaders() });
      if (!res.ok) throw new Error(await res.text());
      setRows(await res.json());
    } catch (e: any) {
      setError(t("searchError", { message: e.message }));
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sex, condition, procedure, ageMin, ageMax, imcMin, imcMax, t]);

  const handleExportCSV = () => {
    const url = `/regen-api/regen/research?${buildQS({ format: "csv" })}`;
    const a = document.createElement("a");
    a.href = url;
    a.setAttribute("download", "regen-pesquisa.csv");
    // Need auth — fetch and blob
    fetch(url, { credentials: "same-origin", headers: authHeaders() })
      .then(r => r.blob())
      .then(blob => {
        a.href = URL.createObjectURL(blob);
        a.click();
      });
  };

  const clearFilters = () => {
    setSex(""); setCondition(""); setProcedure("");
    setAgeMin(""); setAgeMax(""); setImcMin(""); setImcMax("");
    setRows(null);
  };

  const hasFilters = sex || condition || procedure || ageMin || ageMax || imcMin || imcMax;

  return (
    <div>
      {/* Topbar */}
      <div className="sticky top-0 z-10 bg-background border-b border-border px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate("/regen")} data-analytics-destination="/regen"
          className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-100 transition-colors">
          <ChevronLeft className="h-4 w-4 text-gray-700" />
        </button>
        <div className="flex-1">
          <p className="text-sm font-bold text-gray-900">{t("researchTitle")}</p>
          <p className="text-xs text-gray-500">{t("researchSubtitle")}</p>
        </div>
        {rows && rows.length > 0 && (
          <button onClick={handleExportCSV}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-green-600 text-white hover:bg-green-700 transition-colors">
            <Download className="h-3.5 w-3.5" /> {t("exportCsv")}
          </button>
        )}
      </div>

      <div className="max-w-3xl mx-auto px-4 py-5 space-y-4">

        {/* Filters card */}
        <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-blue-500" />
              <p className="text-sm font-bold text-gray-900">{t("filters")}</p>
            </div>
            {hasFilters && (
              <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors">
                <X className="h-3 w-3" /> {t("clear")}
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Sex */}
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t("sex")}</label>
              <select value={sex} onChange={e => setSex(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-800 outline-none focus:border-blue-400">
                <option value="">{t("all")}</option>
                <option value="M">{t("male")}</option>
                <option value="F">{t("female")}</option>
              </select>
            </div>

            {/* Condition */}
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t("diagnosis")}</label>
              <select value={condition} onChange={e => setCondition(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-800 outline-none focus:border-blue-400">
                <option value="">{t("all")}</option>
                {CONDITIONS.map(c => <option key={c} value={c}>{regenConditionLabel(c, locale)}</option>)}
              </select>
            </div>

            {/* Procedure */}
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t("procedure")}</label>
              <select value={procedure} onChange={e => setProcedure(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-800 outline-none focus:border-blue-400">
                <option value="">{t("all")}</option>
                {sortByPtBrName(PRODUCTS, (product) => product).map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>

            {/* Age */}
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t("age")}</label>
              <div className="flex gap-2">
                <input type="number" placeholder={t("min")} value={ageMin} onChange={e => setAgeMin(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-800 outline-none focus:border-blue-400" />
                <input type="number" placeholder={t("max")} value={ageMax} onChange={e => setAgeMax(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-800 outline-none focus:border-blue-400" />
              </div>
            </div>

            {/* IMC */}
            <div className="space-y-1 col-span-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">IMC</label>
              <div className="flex gap-2">
                <input type="number" step="0.1" placeholder="Mín (ex: 18.5)" value={imcMin} onChange={e => setImcMin(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-800 outline-none focus:border-blue-400" />
                <input type="number" step="0.1" placeholder="Máx (ex: 35.0)" value={imcMax} onChange={e => setImcMax(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-800 outline-none focus:border-blue-400" />
              </div>
            </div>
          </div>

          <button onClick={handleSearch} disabled={loading}
            className="w-full py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
             {loading ? t("searching") : t("search")}
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        {/* Results */}
        {rows !== null && (
          <div className="rounded-xl bg-white border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-blue-500" />
                 <p className="text-sm font-bold text-gray-900">{t((rows.length) === 1 ? "resultsOne" : "results", { count: rows.length })}</p>
              </div>
               <p className="text-xs text-gray-400">{t("anonymizedData")}</p>
            </div>

            {rows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-2 text-gray-400">
                <FlaskConical className="h-8 w-8" />
                 <p className="text-sm">{t("noFilteredCases")}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                       {[t("age"),t("sex"),"IMC",t("diagnosis"),"Status","Proced.",t("adverseEvents"),t("averageVas"),...KNEE_RESEARCH_COLUMNS.map(col => `Δ ${kneeHeaders[col.key]}`),"DM",t("registration")].map(h => (
                        <th key={h} className="px-3 py-2 text-left font-semibold text-gray-500 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {rows.map((r, i) => (
                      <tr key={r.id} className={i % 2 === 0 ? "bg-white" : "bg-gray-50/50"}>
                        <td className="px-3 py-2 text-gray-700">{r.age ?? "—"}</td>
                        <td className="px-3 py-2 text-gray-700">{r.sex === "M" ? "M" : r.sex === "F" ? "F" : "—"}</td>
                        <td className="px-3 py-2 text-gray-700">{r.imc ?? "—"}</td>
                        <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{regenConditionLabel(r.condition, locale)}</td>
                        <td className="px-3 py-2">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            r.status === "active" ? "bg-green-50 text-green-700" :
                            r.status === "closed" ? "bg-blue-50 text-blue-700" :
                            "bg-gray-100 text-gray-600"
                           }`}>{r.status === "active" ? t("statusActive") : r.status === "closed" ? t("statusClosed") : t("statusDraft")}</span>
                        </td>
                        <td className="px-3 py-2 text-center text-gray-700">{r.procedure_count}</td>
                        <td className="px-3 py-2 text-center">
                          {r.adverse_events > 0
                            ? <span className="text-red-600 font-bold">{r.adverse_events}</span>
                            : <span className="text-gray-400">0</span>}
                        </td>
                        <td className="px-3 py-2 text-center text-gray-700">{r.avg_vas ?? "—"}</td>
                        {KNEE_RESEARCH_COLUMNS.map(col => {
                          const change = r[`${col.key}_change`];
                          if (typeof change !== "number") return <td key={col.key} className="px-3 py-2 text-center text-gray-400">—</td>;
                          const assessment = assessChange(col.better, change);
                          return (
                            <td key={col.key} data-assessment={assessment}
                              className={`px-3 py-2 text-center font-semibold ${assessment === "better" ? "text-green-700" : assessment === "worse" ? "text-red-700" : "text-gray-600"}`}>
                              {change > 0 ? "+" : ""}{new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(change)}
                            </td>
                          );
                        })}
                         <td className="px-3 py-2 text-center text-gray-700">{r.dm ? t("yes") : t("no")}</td>
                        <td className="px-3 py-2 text-gray-400 whitespace-nowrap">
                           {new Date(r.created_at).toLocaleDateString(locale)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Export note */}
        {rows && rows.length > 0 && (
          <div className="text-xs text-center text-gray-400 pb-4">
             {t("exportNote")}
          </div>
        )}
      </div>
    </div>
  );
}
