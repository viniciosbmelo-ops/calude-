/**
 * DocRegen — Consentimento Inteligente
 * Gera PDFs de consentimento pré-preenchidos por produto
 */
import { useState, useEffect, useCallback } from "react";
import { useLocation, useSearch } from "wouter";
import {
  ChevronLeft, FileText, Download, CheckCircle2,
  Loader2, AlertCircle, User,
} from "lucide-react";
import { sortByPtBrName, toDisplayDate } from "@/lib/utils";
import { sharePdfBlobOrDownload, handlePdfOpenClick } from "@/lib/pdf-share";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { regenCoreMessages } from "@/locales/regen-core";

function authHeaders() {
  return {};
}

const PRODUCTS = [
  { code: "PRP",           label: "PRP",              sub: "Plasma Rico em Plaquetas",      color: "#EFF6FF", border: "#BFDBFE", text: "#1D4ED8" },
  { code: "PRF",           label: "PRF",              sub: "Fibrina Rica em Plaquetas",     color: "#EFF6FF", border: "#93C5FD", text: "#1E40AF" },
  { code: "BMAC",          label: "BMA",              sub: "Concentrado de Medula Óssea",   color: "#F0FDF4", border: "#BBF7D0", text: "#15803D" },
  { code: "MFAT",          label: "MFAT",             sub: "Gordura Micro-Fragmentada",     color: "#FFFBEB", border: "#FDE68A", text: "#B45309" },
  { code: "NANOFAT",       label: "Nanofat",          sub: "Gordura Nanofragmentada",       color: "#FEF9C3", border: "#FDE047", text: "#854D0E" },
  { code: "SVF",           label: "SVF",              sub: "Fração Vascular Estromal",      color: "#FDF4FF", border: "#E9D5FF", text: "#7E22CE" },
  { code: "LISADO",        label: "Lisado",           sub: "Lisado Plaquetário",            color: "#FFF1F2", border: "#FECDD3", text: "#9F1239" },
  { code: "COLAGENO",      label: "Colágeno",         sub: "Scaffold Biológico",            color: "#F0FDFA", border: "#99F6E4", text: "#0F766E" },
  { code: "AH",            label: "Ácido Hialurônico",sub: "Viscossuplementação",            color: "#F5F3FF", border: "#DDD6FE", text: "#6D28D9" },
  { code: "RADIOFREQUENCIA",label: "Radiofrequência", sub: "Neurotomia / Ablação",          color: "#FFF7ED", border: "#FED7AA", text: "#C2410C" },
  { code: "BLOQUEIOS",     label: "Bloqueios",        sub: "Anestésico / Corticoide",       color: "#FEF2F2", border: "#FECACA", text: "#B91C1C" },
  { code: "HIDROGEL",      label: "Hidrogel",         sub: "Scaffold Polimérico",           color: "#F0FDF4", border: "#A7F3D0", text: "#065F46" },
];

interface Case { id: string; patient_name: string; patient_dob?: string }

export default function RegenConsentimento() {
  const [, navigate] = useLocation();
  const { locale } = useLanguage();
  const t = useScopedTranslations(regenCoreMessages);
  const search = useSearch();
  const params  = new URLSearchParams(search);
  const preselectedCase = params.get("caseId") ?? "";
  const returnTo = params.get("returnTo") ?? "";

  const [cases,      setCases]      = useState<Case[]>([]);
  const [selectedCase, setSelected] = useState(preselectedCase);
  const [downloading, setDownloading] = useState<Record<string, boolean>>({});
  const [done,        setDone]       = useState<Record<string, boolean>>({});
  const [pdfShareUrls, setPdfShareUrls] = useState<Record<string, string>>({});
  const [error,       setError]      = useState<string | null>(null);

  const fetchCases = useCallback(async () => {
    try {
      const res = await fetch("/regen-api/regen/cases", { credentials: "same-origin", headers: authHeaders() });
      if (res.ok) {
        const data: any[] = await res.json();
        setCases(sortByPtBrName(
          data.map(c => ({ id: c.id, patient_name: c.patient_name, patient_dob: c.patient_dob })),
          (caseItem) => caseItem.patient_name,
          (caseItem) => caseItem.id,
        ));
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchCases(); }, [fetchCases]);

  const handleDownload = async (productCode: string) => {
    setDownloading(d => ({ ...d, [productCode]: true }));
    setError(null);
    try {
      const qs = selectedCase ? `?caseId=${selectedCase}` : "";
      const res = await fetch(`/regen-api/regen/consent/${productCode}${qs}`, { credentials: "same-origin", headers: authHeaders() });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      await sharePdfBlobOrDownload(
        blob,
        `consentimento-${productCode.toLowerCase()}.pdf`,
        (url) => setPdfShareUrls(current => ({ ...current, [productCode]: url })),
      );
      setDone(d => ({ ...d, [productCode]: true }));
      setTimeout(() => setDone(d => { const n = { ...d }; delete n[productCode]; return n; }), 3000);
    } catch (e: any) {
      setError(t("pdfError", { message: e.message }));
    } finally {
      setDownloading(d => ({ ...d, [productCode]: false }));
    }
  };

  const selectedCaseData = cases.find(c => c.id === selectedCase);
  const caseReady = !!selectedCase && !!selectedCaseData;
  const analyticsReturnDestination = returnTo?.startsWith("/regen/caso/novo")
    ? "/regen/caso/novo"
    : returnTo?.startsWith("/regen/caso/")
      ? "/regen/caso/:id"
      : preselectedCase
        ? "/regen/caso/:id"
        : "/regen";

  return (
    <div>
      {/* Topbar */}
      <div className="sticky top-0 z-10 bg-background border-b border-border px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => navigate(returnTo ? returnTo : preselectedCase ? `/regen/caso/${preselectedCase}` : "/regen")}
          data-analytics-destination={analyticsReturnDestination}
          className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-100 transition-colors">
          <ChevronLeft className="h-4 w-4 text-gray-700" />
        </button>
        <div className="flex-1">
          <p className="text-sm font-bold text-gray-900">{t("consentTitle")}</p>
          <p className="text-xs text-gray-500">{t("consentSubtitle")}</p>
        </div>
        {(preselectedCase || returnTo) && (
          <button
            onClick={() => navigate(returnTo ? returnTo : `/regen/caso/${preselectedCase}`)}
            data-analytics-destination={analyticsReturnDestination}
            className="text-xs px-3 py-1.5 rounded-lg bg-teal-50 border border-teal-200 text-teal-700 font-medium hover:bg-teal-100 transition-colors flex items-center gap-1.5">
            <ChevronLeft className="h-3.5 w-3.5" />
            {returnTo ? t("returnPlan") : t("returnCase")}
          </button>
        )}
      </div>

      <div className="max-w-xl mx-auto px-4 py-5 space-y-4">

        {/* Patient selector */}
        <div className={`rounded-xl bg-white border shadow-sm p-4 space-y-3 transition-colors ${caseReady ? "border-blue-200" : "border-amber-200"}`}>
          <div className="flex items-center gap-2">
            <User className={`h-4 w-4 ${caseReady ? "text-blue-500" : "text-amber-500"}`} />
            <p className="text-sm font-bold text-gray-900">{t("patient")}</p>
            {!caseReady && (
              <span className="ml-auto text-[11px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                {t("required")}
              </span>
            )}
          </div>
          <select value={selectedCase} onChange={e => setSelected(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-800 outline-none focus:border-blue-400">
            <option value="">{t("selectCase")}</option>
            {cases.map(c => (
              <option key={c.id} value={c.id}>{c.patient_name}</option>
            ))}
          </select>
          {caseReady && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-blue-50 border border-blue-100">
              <CheckCircle2 className="h-4 w-4 text-blue-500 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-blue-800">{selectedCaseData!.patient_name}</p>
                {selectedCaseData!.patient_dob && (
                  <p className="text-xs text-blue-500">
                     {t("birthDate", { date: toDisplayDate(selectedCaseData!.patient_dob).toLocaleDateString(locale) })}
                  </p>
                )}
              </div>
            </div>
          )}
          {!caseReady && (
            <p className="text-xs text-amber-600">
               {t("selectCaseWarning")}
            </p>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        {/* Products grid */}
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 px-1">
             {t("selectProcedure")}
          </p>
          {sortByPtBrName(PRODUCTS, (product) => product.label, (product) => product.code).map(p => {
            const isLoading = downloading[p.code];
            const isDone    = done[p.code];
            const pdfShareUrl = pdfShareUrls[p.code];
            const disabled  = isLoading || !caseReady;
            return (
              <div key={p.code}
                className={`rounded-xl bg-white border shadow-sm overflow-hidden transition-opacity ${!caseReady ? "opacity-50" : ""}`}
                style={{ borderColor: caseReady ? undefined : "#E5E7EB" }}>
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: p.color, border: `1px solid ${p.border}` }}>
                    <FileText className="h-4 w-4" style={{ color: p.text }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900">{p.label}</p>
                    <p className="text-xs text-gray-500">{p.sub}</p>
                  </div>
                  {pdfShareUrl ? (
                    <button
                      onClick={() => handlePdfOpenClick(pdfShareUrl, () => setPdfShareUrls(current => {
                        const next = { ...current };
                        delete next[p.code];
                        return next;
                      }))}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0 bg-blue-50 border border-blue-200 text-blue-700"
                    >
                       <FileText className="h-3 w-3" /> {t("openPdf")}
                    </button>
                  ) : (
                    <button
                      onClick={() => caseReady && handleDownload(p.code)}
                      disabled={disabled}
                       title={!caseReady ? t("selectCaseFirst") : undefined}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0"
                      style={{
                        background:  isDone    ? "#ECFDF5" : disabled ? "#F3F4F6" : p.color,
                        border:      `1px solid ${isDone ? "#BBF7D0" : disabled ? "#E5E7EB" : p.border}`,
                        color:       isDone    ? "#059669" : disabled  ? "#9CA3AF" : p.text,
                        cursor:      disabled  ? "not-allowed" : "pointer",
                      }}>
                      {isLoading ? (
                         <><Loader2 className="h-3 w-3 animate-spin" /> {t("generating")}</>
                      ) : isDone ? (
                         <><CheckCircle2 className="h-3 w-3" /> {t("ready")}</>
                      ) : (
                        <><Download className="h-3 w-3" /> PDF</>
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="text-xs text-center text-gray-400 pb-4 px-4">
           {t("consentNote")}
        </div>
      </div>
    </div>
  );
}
