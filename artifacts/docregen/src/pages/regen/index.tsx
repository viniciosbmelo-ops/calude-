/**
 * DocRegen — Dashboard / Lista de casos
 * Tema claro, igual ao Dashboard principal
 */
import { useEffect, useState, useCallback, useRef } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { regenCoreMessages } from "@/locales/regen-core";
import {
  Plus, FlaskConical, AlertCircle, CheckCircle2, Clock,
  Activity, ChevronRight, FileText, ClipboardList,
  Users, TrendingUp, Loader2, Info, Shield,
  Brain, Search, Syringe, BarChart2, AlertTriangle,
} from "lucide-react";

function authHeaders() { return { "Content-Type": "application/json" }; }

// ─── Terms Modal (mantém dark — diálogo sobre overlay) ──────────────────────
function TermsModal({ onAccept, loading }: { onAccept: () => void; loading: boolean }) {
  const t = useScopedTranslations(regenCoreMessages);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.55)" }}>
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden border border-gray-200">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-gray-100 flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-blue-50 shrink-0">
            <Shield className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <p className="font-bold text-gray-900 text-base">{t("termsTitle")}</p>
            <p className="text-xs text-gray-500 mt-0.5">{t("termsVersion")}</p>
          </div>
        </div>
        {/* Body */}
        <div className="px-6 py-5 space-y-3 max-h-64 overflow-y-auto text-sm text-gray-700">
          <p>{t("termsIntro")}</p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>{t("termsBullet1")}</li>
            <li>{t("termsBullet2")}</li>
            <li>{t("termsBullet3")}</li>
            <li>{t("termsBullet4")}</li>
            <li>{t("termsBullet5")}</li>
          </ul>
        </div>
        {/* Footer */}
        <div className="px-6 pb-6 pt-3">
          <button
            onClick={onAccept}
            disabled={loading}
            className="w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {t("termsAccept")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Stat card (tema claro — igual ao Dashboard) ──────────────────────────────
function StatCard({ label, value, icon: Icon, color, bg, onClick, active }: {
  label: string; value: number | string; icon: any; color: string; bg: string;
  onClick?: () => void; active?: boolean;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={[
        "rounded-xl p-4 flex items-center gap-4 bg-white border shadow-sm w-full text-left transition-all",
        onClick ? "cursor-pointer hover:shadow-md hover:-translate-y-0.5" : "",
        active ? "ring-2 ring-offset-1" : "border-gray-200",
      ].join(" ")}
      style={active ? { borderColor: color } : undefined}
    >
      <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: active ? color : bg }}>
        <Icon className="h-5 w-5" style={{ color: active ? "#fff" : color }} />
      </div>
      <div>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        <p className="text-xs text-gray-500">{label}</p>
      </div>
    </Tag>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const t = useScopedTranslations(regenCoreMessages);
  const cfg: Record<string, { label: string; color: string; bg: string }> = {
    draft:  { label: t("statusDraft"), color: "#64748B", bg: "#F1F5F9" },
    active: { label: t("statusActive"), color: "#059669", bg: "#ECFDF5" },
    closed: { label: t("statusClosed"), color: "#2563EB", bg: "#EFF6FF" },
  };
  const c = cfg[status] ?? cfg.draft;
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium" style={{ color: c.color, background: c.bg }}>
      {c.label}
    </span>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function RegenDashboard() {
  const { user } = useAuth();
  const { locale } = useLanguage();
  const t = useScopedTranslations(regenCoreMessages);
  const [, navigate] = useLocation();

  const [termsStatus, setTermsStatus]  = useState<{ accepted: boolean } | null>(null);
  const [acceptingTerms, setAccepting] = useState(false);
  const [stats, setStats]              = useState<any>(null);
  const [cases, setCases]              = useState<any[]>([]);
  const [loading, setLoading]          = useState(true);
  const [error, setError]              = useState<string | null>(null);
  const [search, setSearch]            = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filterAndScroll = (filter: string | null) => {
    setStatusFilter(filter);
    setTimeout(() => listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [termsRes, statsRes, casesRes] = await Promise.all([
        fetch("/regen-api/regen/terms/status", { credentials: "same-origin", headers: authHeaders() }),
        fetch("/regen-api/regen/stats",        { credentials: "same-origin", headers: authHeaders() }),
        fetch("/regen-api/regen/cases",        { credentials: "same-origin", headers: authHeaders() }),
      ]);
      setTermsStatus(await termsRes.json());
      if (statsRes.ok) setStats(await statsRes.json());
      if (casesRes.ok) setCases(await casesRes.json());
    } catch {
      setError(t("loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleAcceptTerms = async () => {
    setAccepting(true);
    try {
      const res = await fetch("/regen-api/regen/terms/accept", { method: "POST", credentials: "same-origin", headers: authHeaders() });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error ?? t("termsError"));
        return;
      }
      setTermsStatus({ accepted: true });
      fetchAll();
    } catch {
      alert(t("connectionError"));
    } finally {
      setAccepting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-24 px-6">
        <div className="text-center space-y-3">
          <AlertCircle className="h-10 w-10 mx-auto text-red-400" />
          <p className="text-gray-700 font-semibold">{error}</p>
          <button onClick={fetchAll} className="text-sm px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors">
             {t("retry")}
          </button>
        </div>
      </div>
    );
  }

  const notAccepted = !termsStatus?.accepted;

  const filteredCases = cases.filter(c => {
    const matchSearch = !search ||
      c.patient_name?.toLowerCase().includes(search.toLowerCase()) ||
      c.condition_code?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = !statusFilter || c.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const statusCounts = {
    active: cases.filter(c => c.status === "active").length,
    draft:  cases.filter(c => c.status === "draft").length,
    closed: cases.filter(c => c.status === "closed").length,
  };

  return (
    <div className="max-w-5xl mx-auto">
      {notAccepted && <TermsModal onAccept={handleAcceptTerms} loading={acceptingTerms} />}

      {/* ── Mobile navy banner (hidden md+) ── */}
      <div className="md:hidden" style={{ background: "linear-gradient(135deg, #0B1F4B 0%, #0D2040 100%)" }}>
        <div className="px-4 pt-5 pb-5 flex items-center justify-between">
          <div>
            <p aria-label="DocRegen Regen" style={{ margin: 0, fontSize: 24, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.1 }}>
              <span style={{ color: "#fff" }}>Doc</span><span style={{ color: "#609DBC" }}>Sholder</span>
              <span style={{ color: "#2DD4BF", fontStyle: "italic", fontWeight: 500, marginLeft: 6 }}>Regen</span>
            </p>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", margin: "3px 0 0" }}>
               {loading ? t("loading") : t("caseCount", { count: cases.length, suffix: cases.length !== 1 ? "s" : "" })}
            </p>
          </div>
          <Link href="/regen/caso/novo">
            <button
              disabled={notAccepted}
              style={{ background: notAccepted ? "rgba(255,255,255,0.12)" : "#0E9AA7", border: "none", borderRadius: 10, height: 38, padding: "0 12px", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, color: "#fff", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", cursor: notAccepted ? "default" : "pointer" }}
            >
              <Plus className="h-5 w-5" style={{ color: "#fff" }} />
              {t("newCase")}
            </button>
          </Link>
        </div>
      </div>

      <div className="p-4 md:p-8 space-y-5">

        {/* ── Desktop header (hidden on mobile) ── */}
        <div className="hidden md:flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-blue-50 border border-blue-100">
              <FlaskConical className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-3xl font-bold tracking-tight text-foreground">Regenerativa</h1>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider bg-blue-100 text-blue-600">BETA</span>
              </div>
               <p className="text-muted-foreground text-sm mt-0.5">{t("dashboardSubtitle", { name: user?.nome ?? "" })}</p>
            </div>
          </div>
          <Link href="/regen/caso/novo">
            <button disabled={notAccepted} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors active:scale-95 disabled:opacity-50 disabled:cursor-default">
               <Plus className="h-4 w-4" /> {t("newCase")}
            </button>
          </Link>
        </div>

        {/* ── Search + status filters ── */}
        <div className="flex gap-2 items-center flex-wrap">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
               placeholder={t("searchCases")}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 bg-white text-sm text-gray-800 placeholder-gray-400 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50"
            />
          </div>
          {(["active", "draft", "closed"] as const).map(s => {
             const labels = { active: t("activeCases"), draft: t("drafts"), closed: t("closedCases") };
            const cnt = statusCounts[s];
            if (cnt === 0) return null;
            const isActive = statusFilter === s;
            const colors = {
              active: isActive ? "bg-green-100 border-green-300 text-green-800" : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50",
              draft:  isActive ? "bg-amber-100 border-amber-300 text-amber-800"  : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50",
              closed: isActive ? "bg-blue-100 border-blue-300 text-blue-800"    : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50",
            };
            return (
              <button key={s} onClick={() => setStatusFilter(f => f === s ? null : s)}
                className={`flex items-center gap-1.5 text-sm px-3 py-2 rounded-xl border transition-colors shrink-0 ${colors[s]}`}>
                <span className="font-bold">{cnt}</span>
                <span className="hidden sm:inline">{labels[s]}</span>
              </button>
            );
          })}
        </div>

        {/* ── Stats (condensed row) ── */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
             <StatCard label={t("totalCases")}   value={stats.total_cases}              icon={FileText}      color="#2563EB" bg="#EFF6FF"
              onClick={() => filterAndScroll(null)}
              active={statusFilter === null} />
             <StatCard label={t("casesActive")}     value={stats.active_cases}             icon={Activity}      color="#059669" bg="#ECFDF5"
              onClick={() => filterAndScroll("active")}
              active={statusFilter === "active"} />
             <StatCard label={t("proceduresMonth")}      value={stats.procedures_this_month}    icon={TrendingUp}    color="#D97706" bg="#FFFBEB"
              onClick={() => filterAndScroll(null)} />
             <StatCard label={t("complications")}     value={stats.complications_count ?? 0} icon={AlertTriangle} color="#DC2626" bg="#FEF2F2" />
          </div>
        )}

        {/* ── Quick actions (chip style) ── */}
        <div className="flex gap-2 flex-wrap">
          <Link href="/regen/pesquisa">
            <button className="flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 transition-colors text-sm font-medium text-gray-700 shadow-sm">
               <Search className="h-4 w-4 text-indigo-500" /> {t("research")}
            </button>
          </Link>
        </div>

        {/* ── Info (terms not accepted) ── */}
        {notAccepted && (
          <div className="rounded-xl flex items-start gap-3 p-4 bg-sky-50 border border-sky-200">
            <Info className="h-4 w-4 mt-0.5 shrink-0 text-sky-600" />
             <p className="text-sm text-sky-800">{t("acceptTermsNotice")}</p>
          </div>
        )}

        {/* ── Cases list ── */}
        <div ref={listRef} />
        {filteredCases.length === 0 ? (
          <div className="rounded-2xl flex flex-col items-center justify-center py-16 gap-4 bg-gray-50 border border-gray-200 border-dashed">
            <FlaskConical className="h-10 w-10 text-gray-300" />
            <p className="text-sm font-medium text-gray-400">
               {search || statusFilter ? t("noCasesFound") : t("noCases")}
            </p>
            {!search && !statusFilter && (
              <Link href="/regen/caso/novo">
                <button className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors">
                   <Plus className="h-4 w-4" /> {t("createFirstCase")}
                </button>
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredCases.map((c) => {
              const date = new Date(c.created_at);
              const isDraft = c.status === "draft";
              return (
                <Link key={c.id} href={`/regen/caso/${c.id}`}>
                  <div className={`border rounded-xl p-4 flex items-start gap-3 active:bg-muted/40 transition-colors cursor-pointer ${isDraft ? "bg-amber-50/60 border-amber-200" : "bg-white border-gray-200"} shadow-sm hover:bg-gray-50`}>
                    {/* Date badge */}
                    <div className="shrink-0 text-center min-w-[38px]">
                      <div className="text-[10px] text-gray-400 font-mono uppercase leading-tight">
                         {date.toLocaleString(locale, { month: "short" }).replace(".", "")}
                      </div>
                      <div className="text-lg font-bold text-gray-900 leading-none">
                        {String(date.getDate()).padStart(2, "0")}
                      </div>
                      <div className="text-[10px] text-gray-400 font-mono leading-tight">
                        {date.getFullYear()}
                      </div>
                    </div>
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-gray-900 truncate">{c.patient_name}</p>
                        {isDraft && (
                          <span className="text-[10px] font-semibold bg-amber-100 text-amber-700 border border-amber-300 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                            {t("statusDraft")}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5 truncate">
                        {c.condition_code.replace(/_/g, " ")}
                         {c.procedure_count > 0 && ` · ${t("procedureCount", { count: c.procedure_count, suffix: c.procedure_count !== 1 ? "s" : "" })}`}
                      </p>
                    </div>
                    {/* Status + chevron */}
                    <div className="shrink-0 flex items-center gap-2">
                      <StatusBadge status={c.status} />
                      <ChevronRight className="h-4 w-4 text-gray-400" />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {/* ── Footer disclaimer ── */}
        <p className="text-xs text-center pb-4 text-gray-400">
           {t("clinicalDisclaimer")}
        </p>
      </div>
    </div>
  );
}
