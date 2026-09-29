import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { useLanguage } from "@/lib/i18n";
import { useScopedTranslations } from "@/lib/i18n";
import { operationalCoreMessages } from "@/locales/operational-core";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, RefreshCw, CheckCircle2, Clock, Calendar, Phone, AlertTriangle, Zap, FlaskConical, MessageSquare, Bot, ExternalLink } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { reportFollowupPeriodLabel } from "@/locales/reporting-catalogs";

// ─── Regen follow-up types ────────────────────────────────────────────────────

interface RegenNotifRow {
  notif_id: string;
  case_id: string;
  periodo: string;
  status: string;
  scheduled_date: string | null;
  sent_at: string | null;
  patient_name: string;
  patient_phone: string | null;
  condition_code: string | null;
  response_count: number;
}

interface RegenOverview {
  vencidos: RegenNotifRow[];
  agendados: RegenNotifRow[];
  respondidos: RegenNotifRow[];
  aguardando: RegenNotifRow[];
  counts: { vencidos: number; agendados: number; respondidos: number; aguardando: number };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────


function RegenNotifCard({
  row,
  doctorNome,
  onSent,
}: {
  row: RegenNotifRow;
  doctorNome: string;
  onSent: (caseId: string, notifId: string) => void;
}) {
  const t = useScopedTranslations(operationalCoreMessages);
  const { formatDate, locale } = useLanguage();
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const isOverdue = row.scheduled_date && row.scheduled_date <= today && row.status === "pending";
  const isToday   = row.scheduled_date === today;

  // Send via DocRegen number (Evolution API) — primary
  const handleSendDocRegen = async () => {
    const popup = window.open("", "_blank");
    if (popup) popup.opener = null;
    setLoading(true);
    try {
      // 1. Prepare message + phone
      const prepRes = await fetch(`/regen-api/regen/cases/${row.case_id}/notifications/${row.notif_id}/prepare-whatsapp`, {
        method: "POST",
        credentials: "same-origin",
      });
      if (!prepRes.ok) throw new Error(t("followupPrepareError"));
      const data = await prepRes.json();

      if (!data.hasTelefone) {
        popup?.close();
        toast({ title: t("followupPatientNoPhoneRegistered"), variant: "destructive" });
        return;
      }

      // 2. Send via Evolution API on the server
      const sendRes = await fetch("/regen-api/notifications/send-text", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: data.phone, text: data.message }),
      });

      if (sendRes.ok) {
        popup?.close();
        // 3. Mark notification as sent
        await fetch(`/regen-api/regen/cases/${row.case_id}/notifications/${row.notif_id}`, {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "sent" }),
        });
        onSent(row.case_id, row.notif_id);
        toast({ title: t("followupMessageSent", { name: row.patient_name }) });
      } else {
        // Fallback: open in personal WhatsApp
        const waUrl = `https://wa.me/${data.phone}?text=${encodeURIComponent(data.message)}`;
        if (!popup) throw new Error(t("followupPrepareError"));
        popup.location.href = waUrl;
        await fetch(`/regen-api/regen/cases/${row.case_id}/notifications/${row.notif_id}`, {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "sent" }),
        });
        onSent(row.case_id, row.notif_id);
        toast({ title: t("followupPersonalWhatsappOpenedUnavailable") });
      }
    } catch {
      popup?.close();
      toast({ title: t("followupPrepareError"), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // Manual fallback — opens personal WhatsApp
  const handleSendManual = async () => {
    const popup = window.open("", "_blank");
    if (popup) popup.opener = null;
    setLoading(true);
    try {
      const res = await fetch(`/regen-api/regen/cases/${row.case_id}/notifications/${row.notif_id}/prepare-whatsapp`, {
        method: "POST",
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error(t("followupPrepareError"));
      const data = await res.json();
      if (!data.hasTelefone) {
        popup?.close();
        toast({ title: t("followupPatientNoPhoneRegistered"), variant: "destructive" });
        return;
      }
      const waUrl = `https://wa.me/${data.phone}?text=${encodeURIComponent(data.message)}`;
      if (!popup) throw new Error(t("followupPrepareError"));
      popup.location.href = waUrl;
      await fetch(`/regen-api/regen/cases/${row.case_id}/notifications/${row.notif_id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "sent" }),
      });
      onSent(row.case_id, row.notif_id);
      toast({ title: t("followupWhatsappOpenedMarkedSent") });
    } catch {
      popup?.close();
      toast({ title: t("followupPrepareError"), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 py-3 px-3 rounded-lg border border-violet-100 bg-violet-50/50 hover:bg-violet-50 transition-colors">
      <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-violet-100 mt-0.5 sm:mt-0">
        <FlaskConical className="h-4 w-4 text-violet-600" />
      </div>

      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm text-foreground truncate">{row.patient_name}</span>
          {row.status === "sent" || row.status === "completed"
            ? <Badge className="bg-green-100 text-green-800 border-green-200 gap-1"><CheckCircle2 className="h-3 w-3" /> {t("followupSent")}</Badge>
            : row.response_count > 0
            ? <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 gap-1"><MessageSquare className="h-3 w-3" /> {t("followupAnswered")}</Badge>
            : isOverdue
            ? <Badge className="bg-orange-100 text-orange-800 border-orange-200 gap-1"><AlertTriangle className="h-3 w-3" /> {t("followupOverdue")}</Badge>
            : isToday
            ? <Badge className="bg-blue-100 text-blue-800 border-blue-200 gap-1"><Zap className="h-3 w-3" /> {t("followupToday")}</Badge>
            : <Badge variant="outline" className="gap-1"><Clock className="h-3 w-3" /> {t("followupScheduled")}</Badge>
          }
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {row.scheduled_date ? formatDate(row.scheduled_date + "T00:00:00") : "—"}
          </span>
          <span className="font-medium text-foreground/70">{reportFollowupPeriodLabel(locale, row.periodo)}</span>
          {row.condition_code && <span className="truncate max-w-28 text-violet-600">{row.condition_code}</span>}
          {!row.patient_phone && <span className="text-red-500 flex items-center gap-1"><Phone className="h-3 w-3" /> {t("followupNoPhone")}</span>}
        </div>
        {row.response_count > 0 && (
          <p className="text-xs text-emerald-600 font-medium">{t((row.response_count) === 1 ? "followupResponsesReceivedOne" : "followupResponsesReceived", { count: row.response_count })}</p>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
        {row.sent_at && (row.status === "sent" || row.status === "completed") && (
          <span className="text-xs text-muted-foreground">{formatDate(row.sent_at)}</span>
        )}
        {row.status === "pending" && (
          <>
            {/* Primary: server-side via DocRegen */}
            <Button
              size="sm"
              disabled={loading || !row.patient_phone}
              onClick={handleSendDocRegen}
              className="h-8 text-xs gap-1.5 text-white font-semibold"
              style={{ background: "#7C3AED" }}
              title={t("followupSendDockneeRegenTooltip")}
            >
              {loading
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <Bot className="h-3.5 w-3.5" />
              }
              {loading ? t("followupSending") : t("followupSendDocknee")}
            </Button>
            {/* Fallback: personal WhatsApp */}
            {row.patient_phone && (
              <button
                type="button"
                disabled={loading}
                onClick={handleSendManual}
                className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md text-xs font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
                title={t("followupPersonalWhatsapp")}
              >
                <ExternalLink className="h-3 w-3" />
                {t("followupPersonal")}
              </button>
            )}
          </>
        )}
        <Link href={`/regen/caso/${row.case_id}`}>
          <Button size="sm" variant="ghost" className="h-8 text-xs text-violet-700 hover:bg-violet-100">{t("followupViewCase")}</Button>
        </Link>
      </div>
    </div>
  );
}

// ─── Regen follow-up tab ──────────────────────────────────────────────────────

function RegenFollowupTab({ doctorNome }: { doctorNome: string }) {
  const t = useScopedTranslations(operationalCoreMessages);
  const { toast } = useToast();
  const [regenData, setRegenData] = useState<RegenOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"vencidos" | "agendados" | "aguardando" | "respondidos">("vencidos");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/regen-api/regen/followup-overview", {
        credentials: "same-origin",
      });
      if (res.ok) setRegenData(await res.json());
    } catch {
      toast({ title: t("followupLoadRegenError"), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => { load(); }, [load]);

  const handleSent = useCallback((caseId: string, notifId: string) => {
    setRegenData(prev => {
      if (!prev) return prev;
      const moveRow = (arr: RegenNotifRow[]) => arr.find(r => r.notif_id === notifId);
      const row = moveRow(prev.vencidos) ?? moveRow(prev.agendados) ?? moveRow(prev.aguardando);
      if (!row) return prev;
      const updated = { ...row, status: "sent", sent_at: new Date().toISOString() };
      const removeFrom = (arr: RegenNotifRow[]) => arr.filter(r => r.notif_id !== notifId);
      return {
        ...prev,
        vencidos:   removeFrom(prev.vencidos),
        agendados:  removeFrom(prev.agendados),
        aguardando: [...removeFrom(prev.aguardando), updated],
        counts: {
          ...prev.counts,
          vencidos:   prev.vencidos.filter(r => r.notif_id !== notifId).length,
          agendados:  prev.agendados.filter(r => r.notif_id !== notifId).length,
          aguardando: prev.aguardando.length + (prev.vencidos.some(r => r.notif_id === notifId) || prev.agendados.some(r => r.notif_id === notifId) ? 1 : 0),
        },
      };
    });
  }, []);

  const rfuCategories: Array<{
    key: "vencidos" | "agendados" | "aguardando" | "respondidos";
    label: string;
    color: string;
    bgColor: string;
    textColor: string;
    count: number;
    rows: RegenNotifRow[];
    emptyMsg: string;
  }> = [
    {
      key: "vencidos",
       label: t("followupPending"),
      color: "#EA580C",
      bgColor: "bg-orange-100",
      textColor: "text-orange-700",
      count: regenData?.counts.vencidos ?? 0,
      rows: regenData?.vencidos ?? [],
       emptyMsg: t("followupNoPendingOrOverdue"),
    },
    {
      key: "agendados",
       label: t("followupScheduled"),
      color: "#0E9AA7",
      bgColor: "bg-sky-100",
      textColor: "text-sky-700",
      count: regenData?.counts.agendados ?? 0,
      rows: regenData?.agendados ?? [],
       emptyMsg: t("followupNoScheduledNextDays"),
    },
    {
      key: "aguardando",
       label: t("followupWaiting"),
      color: "#D97706",
      bgColor: "bg-amber-100",
      textColor: "text-amber-700",
      count: regenData?.counts.aguardando ?? 0,
      rows: regenData?.aguardando ?? [],
       emptyMsg: t("followupNoWaiting"),
    },
    {
      key: "respondidos",
       label: t("followupAnswered"),
      color: "#16A34A",
      bgColor: "bg-green-100",
      textColor: "text-green-700",
      count: regenData?.counts.respondidos ?? 0,
      rows: regenData?.respondidos ?? [],
       emptyMsg: t("followupNoPatientAnswered"),
    },
  ];

  const selectedCat = rfuCategories.find(c => c.key === activeTab) ?? rfuCategories[0];

  // Switch to first non-empty tab if current is empty
  useEffect(() => {
    if (!regenData) return;
    const hasRows = rfuCategories.find(c => c.key === activeTab)?.rows.length;
    if (!hasRows) {
      const first = rfuCategories.find(c => c.rows.length > 0);
      if (first) setActiveTab(first.key);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regenData]);

  const totalPending = regenData?.counts.vencidos ?? 0;

  return (
    <div className="space-y-5">
      {/* Info + refresh */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="rounded-lg border border-violet-200 bg-violet-50 dark:bg-violet-950/20 dark:border-violet-800 px-4 py-3 flex items-start gap-3 flex-1">
          <FlaskConical className="h-4 w-4 text-violet-600 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="text-xs font-semibold text-violet-800 dark:text-violet-300">{t("followupOrthobiological")}</p>
            <p className="text-xs text-violet-700 dark:text-violet-400 leading-relaxed">
              {t("followupRegenInstructions")}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5 shrink-0">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {t("followupRefresh")}
        </Button>
      </div>

      {loading && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {!loading && regenData && (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {rfuCategories.map(cat => (
              <button
                key={cat.key}
                type="button"
                onClick={() => setActiveTab(cat.key)}
                className={cn(
                  "rounded-xl border-2 p-3 flex flex-col gap-2 text-left transition-all cursor-pointer hover:shadow-md active:scale-[0.97]",
                  activeTab === cat.key
                    ? "border-violet-400 bg-violet-50 dark:bg-violet-950/40 dark:border-violet-600 shadow-md"
                    : "border-border bg-card shadow-sm"
                )}
              >
                <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", activeTab === cat.key ? cat.bgColor : "bg-muted/50")}>
                  <FlaskConical className="h-4 w-4" style={{ color: activeTab === cat.key ? cat.color : "#94A3B8" }} />
                </div>
                <div>
                  <p className={cn("text-xl font-bold leading-none", activeTab === cat.key ? cat.textColor : "text-foreground")}>{cat.count}</p>
                  <p className="text-xs font-semibold text-foreground mt-0.5 leading-tight">{cat.label}</p>
                </div>
              </button>
            ))}
          </div>

          {/* Tab strip */}
          <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-none">
            {rfuCategories.map(cat => (
              <button
                key={cat.key}
                type="button"
                onClick={() => setActiveTab(cat.key)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border-b-2 text-xs font-semibold transition-all whitespace-nowrap",
                  activeTab === cat.key
                    ? "border-violet-500 text-violet-700 bg-violet-50"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40"
                )}
              >
                {cat.label}
                <span className={cn(
                  "text-[10px] font-bold px-1.5 py-0.5 rounded-full",
                  activeTab === cat.key ? "bg-violet-500 text-white" : "bg-muted text-muted-foreground"
                )}>{cat.count}</span>
              </button>
            ))}
          </div>

          {/* Rows */}
          {selectedCat.rows.length === 0 ? (
            <div
              className="rounded-2xl flex flex-col items-center justify-center py-12 gap-2"
              style={{ background: "rgba(124,58,237,0.04)", border: "1px dashed rgba(124,58,237,0.2)" }}
            >
              <FlaskConical className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">{selectedCat.emptyMsg}</p>
            </div>
          ) : (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <FlaskConical className="h-4 w-4 text-violet-500" />
                   {t("followupCategoryCount", { count: selectedCat.count, category: selectedCat.label })}
                  {selectedCat.key === "vencidos" && totalPending > 0 && (
                    <Badge className="bg-orange-500 text-white text-xs">{totalPending}</Badge>
                  )}
                </CardTitle>
                {selectedCat.key === "vencidos" && (
                  <CardDescription className="text-xs">
                     {t("followupPrepareAndSendInstructions")}
                  </CardDescription>
                )}
                {selectedCat.key === "aguardando" && (
                  <CardDescription className="text-xs">
                     {t("followupWaitingScalesInstructions")}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent className="space-y-1 pt-0">
                {selectedCat.rows.map(row => (
                  <RegenNotifCard
                    key={row.notif_id}
                    row={row}
                    doctorNome={doctorNome}
                    onSent={handleSent}
                  />
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function FollowupCentral() {
  const t = useScopedTranslations(operationalCoreMessages);
  const { user } = useAuth();
  const doctorNome = (user as { nome?: string } | null)?.nome ?? t("followupDoctorFallback");

  return (
    <div className="max-w-4xl mx-auto animate-in fade-in space-y-6 px-4 py-6 md:px-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("followupCenter")}</h1>
        <p className="text-muted-foreground text-sm mt-0.5">{t("followupSubtitle")}</p>
      </div>
      <RegenFollowupTab doctorNome={doctorNome} />
    </div>
  );
}
