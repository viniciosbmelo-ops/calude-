import { useEffect, useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  Clock,
  Copy,
  FileText,
  Loader2,
  MessageCircle,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { useLanguage } from "@/lib/i18n";
import { useScopedTranslations } from "@/lib/i18n";
import { operationalCoreMessages } from "@/locales/operational-core";
import { generateSurgicalConsentPDF } from "@/lib/surgery-consent-pdf";
import { handlePdfOpenClick, sharePdfOrDownload } from "@/lib/pdf-share";

interface PreopNotification {
  id: number | string;
  periodo: string;
  scales: string[];
  status: string;
  followupId?: number | null;
  token?: string | null;
  notes?: string | null;
  scheduledDate?: string | null;
  scheduled_date?: string | null;
}

interface PreparedFollowup {
  link: string;
  message: string;
  followupId?: number;
}

interface CardViewProps {
  notification: PreopNotification | null;
  prepared: PreparedFollowup | null;
  loading: boolean;
  busy: boolean;
  copied: boolean;
  showFollowup?: boolean;
  consentBusy?: boolean;
  consentShareUrl?: string | null;
  onPrepare: () => void;
  onOpenWhatsApp: () => void;
  onCopy: () => void;
  onGenerateConsent?: () => void;
  onOpenConsent?: () => void;
  accent: "blue" | "amber";
}

function responseError(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "error" in data) {
    const error = (data as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) return error;
  }
  return fallback;
}

async function readJson(response: Response): Promise<any> {
  return response.json().catch(() => ({}));
}

function whatsappPhone(value?: string): string {
  const digits = (value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.startsWith("55") ? digits : `55${digits}`;
}

function StatusBadge({ status }: { status?: string }) {
  if (status === "completed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-100 px-2 py-1 text-[10px] font-bold text-green-700">
        <CheckCircle2 className="h-3 w-3" /> Concluído
      </span>
    );
  }
  if (status === "sent") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-100 px-2 py-1 text-[10px] font-bold text-blue-700">
        <Send className="h-3 w-3" /> Enviado
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-100 px-2 py-1 text-[10px] font-bold text-gray-600">
      <Clock className="h-3 w-3" /> Pendente
    </span>
  );
}

function PreopCardView({
  notification,
  prepared,
  loading,
  busy,
  copied,
  showFollowup = true,
  consentBusy = false,
  consentShareUrl = null,
  onPrepare,
  onOpenWhatsApp,
  onCopy,
  onGenerateConsent,
  onOpenConsent,
  accent,
}: CardViewProps) {
  const { formatCalendarDate } = useLanguage();
  const t = useScopedTranslations(operationalCoreMessages);
  const isBlue = accent === "blue";
  const date = notification?.scheduledDate ?? notification?.scheduled_date;
  const borderClass = isBlue ? "border-blue-200" : "border-amber-200";
  const headerClass = isBlue ? "bg-blue-50/80" : "bg-amber-50/80";
  const iconClass = isBlue ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700";
  const titleClass = isBlue ? "text-blue-950" : "text-amber-950";

  return (
    <section className={`overflow-hidden rounded-xl border ${borderClass} bg-white shadow-sm`}>
      <div className={`flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between ${headerClass}`}>
        <div className="flex items-start gap-3">
          <div className={`rounded-lg p-2 ${iconClass}`}>
            <CalendarClock className="h-5 w-5" />
          </div>
          <div>
            <p className={`text-sm font-bold ${titleClass}`}>
              {showFollowup ? "Follow-up pré-operatório" : "Documentação pré-operatória"}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {showFollowup
                ? "Envie as escalas de linha de base ao paciente antes do procedimento."
                : "Gere e revise o termo de consentimento antes do procedimento."}
            </p>
          </div>
        </div>
        {showFollowup && <StatusBadge status={notification?.status} />}
      </div>

      <div className="space-y-4 px-4 py-4">
        {showFollowup && loading ? (
          <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando follow-up...
          </div>
        ) : showFollowup && notification ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <p className="text-sm font-semibold text-foreground">{notification.periodo}</p>
              {date && (
                <span className="text-xs text-muted-foreground">
                  {formatCalendarDate(date)}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(notification.scales ?? []).map((scale) => (
                <span
                  key={scale}
                  className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-700"
                >
                  {scale}
                </span>
              ))}
            </div>
            {notification.notes && (
              <p className="text-xs leading-relaxed text-muted-foreground">{notification.notes}</p>
            )}
          </div>
        ) : showFollowup ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            O protocolo e as escalas serão definidos automaticamente conforme o procedimento selecionado.
          </p>
        ) : null}

        {showFollowup && prepared?.link && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              Link do paciente
            </p>
            <p className="truncate text-xs text-blue-700">{prepared.link}</p>
          </div>
        )}

        {showFollowup && !prepared ? (
          <Button type="button" onClick={onPrepare} disabled={busy || loading} className="w-full sm:w-auto">
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            {notification?.status === "sent" || notification?.status === "completed"
              ? "Reabrir link do paciente"
              : "Preparar link do paciente"}
          </Button>
        ) : showFollowup && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" onClick={onOpenWhatsApp} className="bg-green-600 hover:bg-green-700">
              <MessageCircle className="mr-2 h-4 w-4" /> Abrir no WhatsApp
            </Button>
            <Button type="button" variant="outline" onClick={onCopy}>
              {copied ? <CheckCircle2 className="mr-2 h-4 w-4 text-green-600" /> : <Copy className="mr-2 h-4 w-4" />}
              {copied ? "Link copiado" : "Copiar link"}
            </Button>
          </div>
        )}

        {onGenerateConsent && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-900">{t("consent")}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-600">
                PDF específico para os procedimentos registrados, pronto para revisão e assinatura presencial.
              </p>
            </div>
            <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                onClick={onGenerateConsent}
                disabled={consentBusy || loading}
                className="border-slate-300 bg-white"
              >
                {consentBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
                Gerar termo
              </Button>
              {consentShareUrl && onOpenConsent && (
                <Button type="button" onClick={onOpenConsent}>
                  <FileText className="mr-2 h-4 w-4" /> Abrir PDF
                </Button>
              )}
            </div>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
            Revise o conteúdo clínico e jurídico com o médico responsável antes do uso assistencial.
          </p>
          </div>
        )}
      </div>
    </section>
  );
}

interface SurgeryPreopFollowupCardProps {
  draftId: number | null;
  patientPhone?: string;
  ensureCurrentDraft: () => Promise<number>;
  ready?: boolean;
  showFollowup?: boolean;
}

export function SurgeryPreopFollowupCard({
  draftId,
  patientPhone,
  ensureCurrentDraft,
  ready = true,
  showFollowup = true,
}: SurgeryPreopFollowupCardProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { locale } = useLanguage();
  const t = useScopedTranslations(operationalCoreMessages);
  const [notification, setNotification] = useState<PreopNotification | null>(null);
  const [prepared, setPrepared] = useState<PreparedFollowup | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [consentBusy, setConsentBusy] = useState(false);
  const [consentShareUrl, setConsentShareUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!draftId || !ready || !showFollowup) {
      setNotification(null);
      setPrepared(null);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setPrepared(null);
    void (async () => {
      try {
        const response = await fetch(`/api/surgeries/${draftId}/schedule`, { credentials: "same-origin" });
        const rows = response.ok ? await readJson(response) : [];
        if (!active) return;
        const preop = Array.isArray(rows)
          ? rows.find((row) => row.periodo === "Pré-operatório")
          : null;
        setNotification(preop ?? null);

        if (preop?.followupId) {
          const preparedResponse = await fetch(
            `/api/surgeries/${draftId}/schedule/${preop.id}/prepare-whatsapp`,
            { method: "POST", credentials: "same-origin" },
          );
          const result = await readJson(preparedResponse);
          if (active && preparedResponse.ok) setPrepared(result);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [draftId, ready, showFollowup]);

  const prepare = async () => {
    setBusy(true);
    try {
      const id = await ensureCurrentDraft();
      const ensuredResponse = await fetch(`/api/surgeries/${id}/schedule/preop`, {
        method: "POST",
        credentials: "same-origin",
      });
      const ensured = await readJson(ensuredResponse);
      if (!ensuredResponse.ok) {
        throw new Error(responseError(ensured, t("prepareFollowupError")));
      }
      setNotification(ensured);

      const preparedResponse = await fetch(
        `/api/surgeries/${id}/schedule/${ensured.id}/prepare-whatsapp`,
        { method: "POST", credentials: "same-origin" },
      );
      const result = await readJson(preparedResponse);
      if (!preparedResponse.ok) {
        throw new Error(responseError(result, t("patientLinkError")));
      }
      setPrepared(result);
      toast({ title: t("followupPrepared"), description: t("patientLinkReady") });
    } catch (error) {
      toast({
        title: t("prepareFollowupTitleError"),
        description: error instanceof Error ? error.message : t("retry"),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const openWhatsApp = async () => {
    if (!prepared || !notification) return;
    const phone = whatsappPhone(patientPhone);
    const url = phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(prepared.message)}`
      : `https://wa.me/?text=${encodeURIComponent(prepared.message)}`;
    window.open(url, "_blank", "noopener,noreferrer");

    if (notification.status !== "completed") {
      const response = await fetch(
        `/api/surgeries/${draftId}/schedule/${notification.id}/status`,
        {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "sent" }),
        },
      );
      if (response.ok) setNotification((current) => current ? { ...current, status: "sent" } : current);
    }
  };

  const copyLink = async () => {
    if (!prepared?.link) return;
    await navigator.clipboard.writeText(prepared.link);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const generateConsent = async () => {
    setConsentBusy(true);
    try {
      const id = await ensureCurrentDraft();
      const response = await fetch(`/api/surgeries/${id}`, { credentials: "same-origin" });
      const surgery = await readJson(response);
      if (!response.ok) {
        throw new Error(responseError(surgery, t("surgeryLoadError")));
      }
      const { doc, filename } = await generateSurgicalConsentPDF(surgery, user ?? undefined, locale);
      const result = await sharePdfOrDownload(doc, filename, setConsentShareUrl);
      if (result.deferred) {
        toast({ title: t("consentReady"), description: t("openPdfInstruction") });
      } else {
        toast({ title: t("consentGenerated"), description: t("pdfDownloadedReview") });
      }
    } catch (error) {
      toast({
        title: t("consentGenerationError"),
        description: error instanceof Error ? error.message : t("retry"),
        variant: "destructive",
      });
    } finally {
      setConsentBusy(false);
    }
  };

  const openConsent = () => {
    if (!consentShareUrl) return;
    handlePdfOpenClick(consentShareUrl, () => setConsentShareUrl(null));
  };

  return (
    <PreopCardView
      notification={notification}
      prepared={prepared}
      loading={loading}
      busy={busy}
      copied={copied}
      showFollowup={showFollowup}
      consentBusy={consentBusy}
      consentShareUrl={consentShareUrl}
      onPrepare={prepare}
      onOpenWhatsApp={openWhatsApp}
      onCopy={copyLink}
      onGenerateConsent={generateConsent}
      onOpenConsent={openConsent}
      accent="blue"
    />
  );
}

interface RegenPreopFollowupCardProps {
  caseId: string | null;
  baseDate?: string;
  patientPhone?: string;
  ensureCurrentCase: () => Promise<string>;
}

export function RegenPreopFollowupCard({
  caseId,
  baseDate,
  patientPhone,
  ensureCurrentCase,
}: RegenPreopFollowupCardProps) {
  const { toast } = useToast();
  const t = useScopedTranslations(operationalCoreMessages);
  const [notification, setNotification] = useState<PreopNotification | null>(null);
  const [prepared, setPrepared] = useState<PreparedFollowup | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!caseId) {
      setNotification(null);
      setPrepared(null);
      return;
    }
    let active = true;
    setLoading(true);
    setPrepared(null);
    void (async () => {
      try {
        const response = await fetch(`/api/regen/cases/${caseId}/notifications`, { credentials: "same-origin" });
        const rows = response.ok ? await readJson(response) : [];
        if (!active) return;
        const preop = Array.isArray(rows)
          ? rows.find((row) => row.periodo === "Pré-op (Baseline)")
          : null;
        setNotification(preop ?? null);

        if (preop?.token) {
          const preparedResponse = await fetch(
            `/api/regen/cases/${caseId}/notifications/${preop.id}/prepare-whatsapp`,
            {
              method: "POST",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({}),
            },
          );
          const result = await readJson(preparedResponse);
          if (active && preparedResponse.ok) setPrepared(result);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [caseId]);

  const prepare = async () => {
    setBusy(true);
    try {
      const id = await ensureCurrentCase();
      const initResponse = await fetch(`/api/regen/cases/${id}/notifications/init`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseDate }),
      });
      const notifications = await readJson(initResponse);
      if (!initResponse.ok) {
        throw new Error(responseError(notifications, t("scheduleStartError")));
      }
      const preop = Array.isArray(notifications)
        ? notifications.find((row) => row.periodo === "Pré-op (Baseline)")
        : null;
      if (!preop) throw new Error(t("baselineNotFound"));
      setNotification(preop);

      const preparedResponse = await fetch(
        `/api/regen/cases/${id}/notifications/${preop.id}/prepare-whatsapp`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      const result = await readJson(preparedResponse);
      if (!preparedResponse.ok) {
        throw new Error(responseError(result, t("patientLinkError")));
      }
      setPrepared(result);
      toast({ title: t("followupPrepared"), description: t("baselineReady") });
    } catch (error) {
      toast({
        title: t("prepareFollowupTitleError"),
        description: error instanceof Error ? error.message : t("retry"),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const openWhatsApp = async () => {
    if (!prepared || !notification || !caseId) return;
    const phone = whatsappPhone(patientPhone);
    const url = phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(prepared.message)}`
      : `https://wa.me/?text=${encodeURIComponent(prepared.message)}`;
    window.open(url, "_blank", "noopener,noreferrer");

    if (notification.status !== "completed") {
      const response = await fetch(
        `/api/regen/cases/${caseId}/notifications/${notification.id}`,
        {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "sent" }),
        },
      );
      if (response.ok) setNotification((current) => current ? { ...current, status: "sent" } : current);
    }
  };

  const copyLink = async () => {
    if (!prepared?.link) return;
    await navigator.clipboard.writeText(prepared.link);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <PreopCardView
      notification={notification}
      prepared={prepared}
      loading={loading}
      busy={busy}
      copied={copied}
      onPrepare={prepare}
      onOpenWhatsApp={openWhatsApp}
      onCopy={copyLink}
      accent="amber"
    />
  );
}