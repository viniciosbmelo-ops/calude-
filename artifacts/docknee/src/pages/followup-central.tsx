import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { useLanguage } from "@/lib/i18n";
import { useScopedTranslations } from "@/lib/i18n";
import { operationalCoreMessages } from "@/locales/operational-core";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Send, RefreshCw, CheckCircle2, XCircle, Clock, Calendar, Phone, AlertTriangle, Zap, FlaskConical, MessageSquare, Bot, ExternalLink } from "lucide-react";
import { Link } from "wouter";
import { cn, formatLocalDate, toCalendarDateKey } from "@/lib/utils";
import { ErrorBoundary } from "@/components/route-error-boundary";
import {
  reportFollowupPeriodLabel,
  reportScaleLabels,
} from "@/locales/reporting-catalogs";
import type { Locale } from "@/lib/i18n";

// WhatsApp SVG icon helper
function WaIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  );
}

// ─── Surgery follow-up types ──────────────────────────────────────────────────

interface NotifRow {
  notif: {
    id: number;
    periodo: string;
    scheduledDate: string | null;
    status: string;
    scales: string[];
    sentAt: string | null;
  };
  patient: { id: number; nome: string; telefone: string | null };
  surgery: { id: number; dataCirurgia: string | null; diagnostico: string | null };
}

interface NotifData {
  pending: NotifRow[];
  upcoming: NotifRow[];
  sent: NotifRow[];
  failed: NotifRow[];
}

interface DispatchResult {
  sent: number;
  failed: number;
  skipped: number;
  total: number;
  details: Array<{ notifId: number; patientNome: string; periodo: string; result: string; reason?: string }>;
}

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

function cleanPhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  return d.startsWith("55") ? d : `55${d}`;
}

function buildWaLink(phone: string, message: string) {
  return `https://wa.me/${cleanPhone(phone)}?text=${encodeURIComponent(message)}`;
}

export function formatCentralFollowupValues(locale: Locale, periodo: string, scales: readonly string[]) {
  return {
    periodo: reportFollowupPeriodLabel(locale, periodo),
    scales: reportScaleLabels(locale, scales),
  };
}

function StatusChip({ status, scheduledDate }: { status: string; scheduledDate: string | null }) {
  const t = useScopedTranslations(operationalCoreMessages);
  // Calendar comparison on the user's local day; accepts "YYYY-MM-DD" and
  // serialised timestamps alike.
  const today = formatLocalDate();
  const scheduledKey = toCalendarDateKey(scheduledDate);
  if (status === "sent" || status === "completed") return <Badge className="bg-green-100 text-green-800 border-green-200 gap-1"><CheckCircle2 className="h-3 w-3" /> {t("followupSent")}</Badge>;
  if (status === "failed") return <Badge className="bg-red-100 text-red-800 border-red-200 gap-1"><XCircle className="h-3 w-3" /> {t("followupFailed")}</Badge>;
  if (scheduledKey && scheduledKey < today) return <Badge className="bg-orange-100 text-orange-800 border-orange-200 gap-1"><AlertTriangle className="h-3 w-3" /> {t("followupOverdue")}</Badge>;
  if (scheduledKey === today) return <Badge className="bg-blue-100 text-blue-800 border-blue-200 gap-1"><Zap className="h-3 w-3" /> {t("followupToday")}</Badge>;
  return <Badge variant="outline" className="gap-1"><Clock className="h-3 w-3" /> {t("followupScheduled")}</Badge>;
}

function NotifCard({
  row,
  doctorNome,
  onReset,
  onSent,
}: {
  row: NotifRow;
  doctorNome: string;
  onReset?: (id: number) => void;
  onSent?: (id: number) => void;
}) {
  const t = useScopedTranslations(operationalCoreMessages);
  const { formatDate, formatCalendarDate, locale } = useLanguage();
  const { notif, patient, surgery } = row;
  const [sending, setSending] = useState(false);
  const [localStatus, setLocalStatus] = useState(notif.status);
  const { toast } = useToast();

  const hasPhone = !!patient.telefone;
  const presentation = formatCentralFollowupValues(locale, notif.periodo, notif.scales ?? []);
  const waMsg = hasPhone ? t("followupManualMessage", {
    patientNome: patient.nome, periodo: presentation.periodo,
    scales: presentation.scales.length ? presentation.scales.join(", ") : t("followupKneeAssessments"),
    doctorNome,
  }) : "";
  const waLink = hasPhone ? buildWaLink(patient.telefone!, waMsg) : null;

  const handleSendDocSholder = async () => {
    setSending(true);
    try {
      const res = await fetch(`/api/notifications/${notif.id}/dispatch`, {
        method: "POST",
        credentials: "same-origin",
      });
      if (res.ok) {
        setLocalStatus("sent");
        onSent?.(notif.id);
        toast({ title: t("followupMessageSent", { name: patient.nome }) });
      } else {
        const err = await res.json().catch(() => ({}));
        toast({ title: t("followupSendError"), description: err.error ?? t("followupTryAgain"), variant: "destructive" });
      }
    } catch {
      toast({ title: t("followupConnectionError"), variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const isSent = localStatus === "sent";

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 py-3 px-3 rounded-lg border border-border bg-background hover:bg-muted/30 transition-colors">
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm text-foreground truncate">{patient.nome}</span>
          <StatusChip status={localStatus} scheduledDate={notif.scheduledDate} />
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {formatCalendarDate(notif.scheduledDate)}
          </span>
          <span className="font-medium text-foreground/70">{presentation.periodo}</span>
          {surgery.diagnostico && <span className="truncate max-w-28">{surgery.diagnostico}</span>}
          {!hasPhone && <span className="text-red-500 flex items-center gap-1"><Phone className="h-3 w-3" /> {t("followupNoPhone")}</span>}
        </div>
        {notif.scales?.length > 0 && (
          <p className="text-xs text-muted-foreground truncate">{presentation.scales.join(" · ")}</p>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
        {isSent && notif.sentAt && (
          <span className="text-xs text-muted-foreground">{formatDate(notif.sentAt)}</span>
        )}
        {localStatus === "failed" && onReset && (
          <Button size="sm" variant="outline" onClick={() => onReset(notif.id)} className="h-8 text-xs gap-1">
            <RefreshCw className="h-3 w-3" /> {t("followupRetry")}
          </Button>
        )}
        {!isSent && localStatus !== "failed" && (
          <>
            {/* Primary: server-side send via DocSholder number */}
            <Button
              size="sm"
              disabled={sending || !hasPhone}
              onClick={handleSendDocSholder}
              className="h-8 text-xs gap-1.5 text-white font-semibold"
              style={{ background: "#25D366" }}
              title={!hasPhone ? t("followupPatientNoPhone") : t("followupSendDockneeTooltip")}
            >
              {sending
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <Bot className="h-3 w-3" />
              }
              {sending ? t("followupSending") : t("followupSendDocknee")}
            </Button>
            {/* Secondary: manual fallback */}
            {waLink && (
              <a
                href={waLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md text-xs font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                title={t("followupPersonalWhatsappFallback")}
              >
                <ExternalLink className="h-3 w-3" />
                {t("followupPersonal")}
              </a>
            )}
          </>
        )}
        <Link href={`/surgeries/${surgery.id}`}>
          <Button size="sm" variant="ghost" className="h-8 text-xs">{t("followupViewSurgery")}</Button>
        </Link>
      </div>
    </div>
  );
}

// ─── Regen notification card ──────────────────────────────────────────────────

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
  const { formatDate, formatCalendarDate, locale } = useLanguage();
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const today = formatLocalDate();
  // scheduled_date is a calendar date; accept both "YYYY-MM-DD" and a
  // serialised timestamp so an API format change can never break this card.
  const scheduledKey = toCalendarDateKey(row.scheduled_date);
  const isOverdue = !!scheduledKey && scheduledKey <= today && row.status === "pending";
  const isToday   = scheduledKey === today;

  // Send via DocSholder number (Evolution API) — primary
  const handleSendDocSholder = async () => {
    const popup = window.open("", "_blank");
    if (popup) popup.opener = null;
    setLoading(true);
    try {
      // 1. Prepare message + phone
      const prepRes = await fetch(`/api/regen/cases/${row.case_id}/notifications/${row.notif_id}/prepare-whatsapp`, {
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
      const sendRes = await fetch("/api/notifications/send-text", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: data.phone, text: data.message }),
      });

      if (sendRes.ok) {
        popup?.close();
        // 3. Mark notification as sent
        await fetch(`/api/regen/cases/${row.case_id}/notifications/${row.notif_id}`, {
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
        await fetch(`/api/regen/cases/${row.case_id}/notifications/${row.notif_id}`, {
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
      const res = await fetch(`/api/regen/cases/${row.case_id}/notifications/${row.notif_id}/prepare-whatsapp`, {
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
      await fetch(`/api/regen/cases/${row.case_id}/notifications/${row.notif_id}`, {
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
            {formatCalendarDate(row.scheduled_date)}
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
            {/* Primary: server-side via DocSholder */}
            <Button
              size="sm"
              disabled={loading || !row.patient_phone}
              onClick={handleSendDocSholder}
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
      const res = await fetch("/api/regen/followup-overview", {
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
      color: "#1FB6E1",
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
                  <ErrorBoundary key={row.notif_id} inline>
                    <RegenNotifCard
                      row={row}
                      doctorNome={doctorNome}
                      onSent={handleSent}
                    />
                  </ErrorBoundary>
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
  const { locale } = useLanguage();
  const { user } = useAuth();
  const { toast } = useToast();
  const [mode, setMode] = useState<"cirurgia" | "regen">("cirurgia");
  const [data, setData] = useState<NotifData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dispatching, setDispatching] = useState(false);
  const [dispatchResult, setDispatchResult] = useState<DispatchResult | null>(null);

  const doctorNome = (user as any)?.nome ?? t("followupDoctorFallback");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/notifications/pending", {
        credentials: "same-origin",
      });
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDispatch = async () => {
    setDispatching(true);
    setDispatchResult(null);
    try {
      const res = await fetch("/api/notifications/dispatch-pending", {
        method: "POST",
        credentials: "same-origin",
      });
      const result = await res.json() as DispatchResult;
      setDispatchResult(result);
      if (result.sent > 0) {
        toast({ title: t((result.sent) === 1 ? "followupDispatchSentSuccessOne" : "followupDispatchSentSuccess", { count: result.sent }) });
      } else if (result.total === 0) {
        toast({ title: t("followupNoPendingToday") });
      } else if (result.failed > 0) {
        toast({ title: t((result.failed) === 1 ? "followupDispatchFailedOne" : "followupDispatchFailed", { count: result.failed }), description: t("followupEvolutionCheck"), variant: "destructive" });
      }
      await load();
    } catch {
      toast({ title: t("followupDispatchError"), variant: "destructive" });
    } finally {
      setDispatching(false);
    }
  };

  const handleReset = async (notifId: number) => {
    await fetch(`/api/notifications/${notifId}/reset`, {
      method: "POST",
      credentials: "same-origin",
    });
    await load();
    toast({ title: t("followupReactivated") });
  };

  const handleNotifSent = useCallback((notifId: number) => {
    setData(prev => {
      if (!prev) return prev;
      const move = prev.pending.find(r => r.notif.id === notifId);
      if (!move) return prev;
      const updated = { ...move, notif: { ...move.notif, status: "sent", sentAt: new Date().toISOString() } };
      return {
        ...prev,
        pending: prev.pending.filter(r => r.notif.id !== notifId),
        sent: [updated, ...prev.sent],
      };
    });
  }, []);

  const pendingCount = data?.pending.length ?? 0;
  const todayKey = formatLocalDate();
  const overdueCount = data?.pending.filter(r => { const k = toCalendarDateKey(r.notif.scheduledDate); return !!k && k < todayKey; }).length ?? 0;
  const todayCount = data?.pending.filter(r => toCalendarDateKey(r.notif.scheduledDate) === todayKey).length ?? 0;

  return (
    <div className="max-w-4xl mx-auto animate-in fade-in space-y-6 px-4 py-6 md:px-8">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("followupCenter")}</h1>
          <p className="text-muted-foreground text-sm mt-0.5">{t("followupSubtitle")}</p>
        </div>
        {mode === "cirurgia" && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              {t("followupRefresh")}
            </Button>
            <Button
              onClick={handleDispatch}
              disabled={dispatching || pendingCount === 0}
              size="sm"
              className="gap-1.5 bg-green-600 hover:bg-green-700 text-white"
            >
              {dispatching
                ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("followupDispatching")}</>
                : <><Send className="h-4 w-4" /> {t("followupDispatchAll", { count: pendingCount })}</>
              }
            </Button>
          </div>
        )}
      </div>

      {/* Mode toggle */}
      <div className="flex gap-1 bg-muted/40 rounded-xl p-1 w-fit">
        {[
          { key: "cirurgia" as const, label: `🏥 ${t("followupSurgery")}`,     badge: pendingCount },
          { key: "regen"    as const, label: `🌿 ${t("followupRegenerative")}`, badge: 0 },
        ].map(({ key, label, badge }) => (
          <button
            key={key}
            type="button"
            onClick={() => setMode(key)}
            className={cn(
              "relative px-4 py-1.5 rounded-lg text-sm font-semibold transition-all",
              mode === key
                ? "bg-card shadow-sm text-foreground border border-border"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
            )}
          >
            {label}
            {badge > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-orange-500 text-white text-[10px] font-bold px-1">
                {badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── CIRURGIA MODE ── */}
      {mode === "cirurgia" && (
        <>
          {/* Automation status banner */}
          <div className="rounded-xl border-2 border-green-300 bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/20 dark:border-green-700 px-4 py-3.5 flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center shrink-0 mt-0.5">
              <Bot className="h-4 w-4 text-white" />
            </div>
            <div className="flex-1 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-bold text-green-800 dark:text-green-300">{t("followupAutomationActive")}</p>
                <Badge className="bg-green-500 text-white text-[10px] px-1.5 py-0.5 gap-1 font-bold">
                  <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                  {t("followupOnline")}
                </Badge>
              </div>
              <p className="text-xs text-green-700 dark:text-green-400 leading-relaxed">
                {t("followupAutomationInstructions")}
              </p>
            </div>
          </div>

          {/* Dispatch result */}
          {dispatchResult && dispatchResult.total > 0 && (
            <div className="rounded-lg border px-4 py-3 space-y-2" style={{ borderColor: dispatchResult.sent > 0 ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)", background: dispatchResult.sent > 0 ? "rgba(34,197,94,0.05)" : "rgba(239,68,68,0.05)" }}>
              <p className="text-sm font-semibold">{t("followupDispatchResult")}</p>
              <div className="flex gap-4 text-xs flex-wrap">
                <span className="text-green-700"><CheckCircle2 className="h-3 w-3 inline mr-1" />{t("followupSentByDocknee", { count: dispatchResult.sent })}</span>
                <span className="text-red-600"><XCircle className="h-3 w-3 inline mr-1" />{t("followupWithFailure", { count: dispatchResult.failed })}</span>
                <span className="text-muted-foreground"><AlertTriangle className="h-3 w-3 inline mr-1" />{t("followupWithoutPhone", { count: dispatchResult.skipped })}</span>
              </div>
              {dispatchResult.failed > 0 && (
                <p className="text-xs text-red-600">{t("followupDispatchFailureInstructions")}</p>
              )}
              {dispatchResult.details && dispatchResult.details.length > 0 && (
                <div className="space-y-0.5 pt-1 border-t border-border">
                  {dispatchResult.details.map(d => (
                    <div key={d.notifId} className="flex items-center gap-2 text-xs">
                      {d.result === "sent"
                        ? <CheckCircle2 className="h-3 w-3 text-green-600 shrink-0" />
                        : d.result === "skipped"
                        ? <Phone className="h-3 w-3 text-muted-foreground shrink-0" />
                        : <XCircle className="h-3 w-3 text-red-500 shrink-0" />
                      }
                      <span className="font-medium">{d.patientNome}</span>
                      <span className="text-muted-foreground">{reportFollowupPeriodLabel(locale, d.periodo)}</span>
                      {d.reason && <span className="text-red-500">— {d.reason}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Stat cards */}
          {!loading && data && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: t("followupPendingToday"), value: todayCount, color: "#1FB6E1", icon: Zap },
                { label: t("followupOverdue"), value: overdueCount, color: "#F97316", icon: AlertTriangle },
                { label: t("followupUpcoming"), value: data.upcoming.length, color: "#64748B", icon: Calendar },
                { label: t("followupSent"), value: data.sent.length, color: "#22C55E", icon: CheckCircle2 },
              ].map(({ label, value, color, icon: Icon }) => (
                <Card key={label} className="shadow-none border-border">
                  <CardContent className="p-3 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${color}18` }}>
                      <Icon className="h-4 w-4" style={{ color }} />
                    </div>
                    <div>
                      <p className="text-xl font-bold text-foreground leading-none">{value}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Loading state */}
          {loading && (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Tabs */}
          {!loading && data && (
            <Tabs defaultValue="pending">
              <TabsList className="w-full sm:w-auto">
                <TabsTrigger value="pending" className="gap-1.5">
                  {t("followupPending")}
                  {pendingCount > 0 && <Badge className="h-4 px-1.5 text-xs bg-orange-500 text-white">{pendingCount}</Badge>}
                </TabsTrigger>
                <TabsTrigger value="upcoming">
                  {t("followupUpcoming")}
                  {data.upcoming.length > 0 && <Badge variant="secondary" className="h-4 px-1.5 text-xs">{data.upcoming.length}</Badge>}
                </TabsTrigger>
                <TabsTrigger value="failed">
                  {t("followupFailedTab")}
                  {data.failed.length > 0 && <Badge className="h-4 px-1.5 text-xs bg-red-500 text-white">{data.failed.length}</Badge>}
                </TabsTrigger>
                <TabsTrigger value="sent">
                  {t("followupSent")}
                  {data.sent.length > 0 && <Badge variant="secondary" className="h-4 px-1.5 text-xs">{data.sent.length}</Badge>}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="pending" className="mt-4">
                {data.pending.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <CheckCircle2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <p className="text-sm font-medium">{t("followupNoPending")}</p>
                    <p className="text-xs mt-1">{t("followupAllUpToDate")}</p>
                  </div>
                ) : (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-orange-500" />
                        {t((pendingCount) === 1 ? "followupAwaitingSendOne" : "followupAwaitingSend", { count: pendingCount })}
                      </CardTitle>
                      <CardDescription className="text-xs">
                        {t("followupSurgerySendInstructions")}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-1 pt-0">
                      {data.pending.map(row => (
                        <ErrorBoundary key={row.notif.id} inline><NotifCard row={row} doctorNome={doctorNome} onSent={handleNotifSent} /></ErrorBoundary>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="upcoming" className="mt-4">
                {data.upcoming.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Calendar className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <p className="text-sm font-medium">{t("followupNoScheduled")}</p>
                    <p className="text-xs mt-1">{t("followupRegisterSurgeriesInstruction")}</p>
                  </div>
                ) : (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-blue-500" />
                        {t((data.upcoming.length) === 1 ? "followupUpcomingCountOne" : "followupUpcomingCount", { count: data.upcoming.length })}
                      </CardTitle>
                      <CardDescription className="text-xs">{t("followupScheduledDispatchInstruction")}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-1 pt-0">
                      {data.upcoming.map(row => (
                        <ErrorBoundary key={row.notif.id} inline><NotifCard row={row} doctorNome={doctorNome} onSent={handleNotifSent} /></ErrorBoundary>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="failed" className="mt-4">
                {data.failed.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <CheckCircle2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <p className="text-sm font-medium">{t("followupNoFailures")}</p>
                  </div>
                ) : (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <XCircle className="h-4 w-4 text-red-500" />
                        {t("followupWithFailure", { count: data.failed.length })}
                      </CardTitle>
                      <CardDescription className="text-xs">{t("followupRetryInstruction")}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-1 pt-0">
                      {data.failed.map(row => (
                        <ErrorBoundary key={row.notif.id} inline><NotifCard row={row} doctorNome={doctorNome} onReset={handleReset} /></ErrorBoundary>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="sent" className="mt-4">
                {data.sent.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Send className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <p className="text-sm font-medium">{t("followupNoSendsYet")}</p>
                  </div>
                ) : (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                        {t((data.sent.length) === 1 ? "followupSentCountOne" : "followupSentCount", { count: data.sent.length })}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1 pt-0">
                      {data.sent.map(row => (
                        <ErrorBoundary key={row.notif.id} inline><NotifCard row={row} doctorNome={doctorNome} /></ErrorBoundary>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </TabsContent>
            </Tabs>
          )}
        </>
      )}

      {/* ── REGEN MODE ── */}
      {mode === "regen" && (
        <RegenFollowupTab doctorNome={doctorNome} />
      )}
    </div>
  );
}
