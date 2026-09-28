import { useState, useEffect, useCallback } from "react";
import { useRoute, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  ArrowLeft, Stethoscope, Calendar, Activity, TrendingUp,
  AlertTriangle, FileText, ChevronRight, User, Hospital,
  Microscope, Brain, Dumbbell, RotateCcw, Loader2, KeyRound,
  CalendarClock,
} from "lucide-react";
import { SurgeryClinicalView } from "@/components/shoulder/surgery-clinical-view";
import { CASE_TYPE_BY_KEY, type ClinicalPayload } from "@workspace/clinical/web";
import { useToast } from "@/hooks/use-toast";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { toDisplayDate } from "@/lib/utils";
import { adminConsoleMessages } from "@/locales/admin-console";

// ─── Types ────────────────────────────────────────────────────────────────────
type Surgery = {
  id: number;
  dataCirurgia: string | null;
  tipoCaso: string | null;
  tiposProcedimento: string[];
  regiao?: string | null;
  hospital: string | null;
  patientSexo: string | null;
  patientLado: string | null;
  createdAt: string;
};

type FullSurgery = Surgery & {
  diagnostico?: string | null;
  procedimentoRealizado?: string | null;
  dadosClinicos?: ClinicalPayload | null;
  patient?: { id: number; nome?: string | null; sexo?: string | null; lado?: string | null } | null;
  followups?: Followup[];
};

type Followup = {
  id: number;
  tempo: string;
  dataAvaliacao: string | null;
  vasDor?: number | null;
  retornoEsporte?: boolean | null;
  falha?: boolean | null;
  complicacoes?: string[] | null;
  observacoes?: string | null;
};

type DoctorInfo = {
  id: number;
  nome: string;
  email: string;
  crm?: string | null;
  crmEstado?: string | null;
  estrangeiro?: boolean;
  paisOrigem?: string | null;
  isFree?: boolean;
  temporaryAccessExpiresAt?: string | null;
  telefone?: string | null;
  cpf?: string | null;
  dataNascimento?: string | null;
  endereco?: string | null;
  cidade?: string | null;
  estado?: string | null;
  cep?: string | null;
  especialidade?: string | null;
  whatsappBusiness?: string | null;
  aprovado?: boolean;
  isAdmin?: boolean;
  createdAt?: string;
};

// ─── Labels ───────────────────────────────────────────────────────────────────
// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(d: string | null | undefined, locale: string) {
  if (!d) return "—";
  return toDisplayDate(d).toLocaleDateString(locale);
}

function caseTypeLabels(surgery: Surgery): string[] {
  return surgery.tiposProcedimento.map((key) => CASE_TYPE_BY_KEY.get(key)?.label ?? key);
}

// ─── UI sub-components ────────────────────────────────────────────────────────
function Row({ label, value }: { label: string; value?: string | number | null }) {
  if (value == null || value === "") return null;
  return (
    <div className="flex justify-between items-start gap-4 py-1.5 border-b border-border/30 last:border-0">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className="text-xs font-medium text-right">{value}</span>
    </div>
  );
}

function ProfileRow({ label, value }: { label: string; value?: string | number | null }) {
  if (value == null || value === "") return null;
  return (
    <div className="flex justify-between items-start gap-4 py-2 border-b border-border/30 last:border-0">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className="text-xs font-medium text-right break-all">{value}</span>
    </div>
  );
}

function SectionBlock({ title, icon: Icon, children }: { title: string; icon?: any; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 pb-1 border-b-2 border-primary/20">
        {Icon && <Icon className="h-3.5 w-3.5 text-primary" />}
        <h3 className="text-xs font-bold uppercase tracking-wide text-primary">{title}</h3>
      </div>
      <div>{children}</div>
    </div>
  );
}

function ScorePill({ label, value }: { label: string; value: number | null | undefined }) {
  if (value == null) return null;
  return (
    <div className="flex flex-col items-center min-w-[52px] bg-muted/50 rounded px-2 py-1">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className="text-sm font-bold">{value.toFixed(0)}</span>
    </div>
  );
}

// ─── Surgery detail panel ─────────────────────────────────────────────────────
function AdminSurgerySheet({ surgeryId, onClose }: { surgeryId: number | null; onClose: () => void }) {
  const { locale } = useLanguage();
  const t = useScopedTranslations(adminConsoleMessages);
  const [detail, setDetail] = useState<FullSurgery | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!surgeryId) { setDetail(null); return; }
    setLoading(true);
    fetch(`/api/admin/surgeries/${surgeryId}`, { credentials: "same-origin" })
      .then(r => r.json())
      .then(d => { setDetail(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [surgeryId]);

  const followups = detail?.followups ?? [];
  const region = detail?.regiao === "shoulder" ? "Ombro" : detail?.regiao === "elbow" ? "Cotovelo" : null;

  return (
    <Sheet open={surgeryId !== null} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto p-0">
        <SheetHeader className="px-5 pt-5 pb-3 border-b border-border sticky top-0 bg-background z-10">
          <SheetTitle className="text-base">{t("explicit.005")}</SheetTitle>
          {detail && (
            <p className="text-xs text-muted-foreground">
              {fmtDate(detail.dataCirurgia, locale)} · {detail.hospital || t("explicit.006")} · ID #{detail.id}
            </p>
          )}
        </SheetHeader>

        <div className="px-5 py-4 space-y-5">
          {loading && (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}
            </div>
          )}

          {!loading && detail && (
            <>
              <SectionBlock title={t("explicit.007")} icon={Calendar}>
                <Row label={t("explicit.163")} value={fmtDate(detail.dataCirurgia, locale)} />
                <Row label={t("explicit.164")} value={detail.hospital} />
                <Row label={t("explicit.165")} value={detail.patient?.sexo ?? detail.patientSexo} />
                <Row label={t("explicit.166")} value={detail.patient?.lado ?? detail.patientLado} />
                <Row label="Região" value={region} />
                <Row label={t("doctor.caseType")} value={detail.tipoCaso} />
                <Row label="Diagnóstico" value={detail.diagnostico} />
                <Row label="Procedimentos" value={detail.procedimentoRealizado} />
              </SectionBlock>

              {detail.regiao && detail.dadosClinicos && (
                <SurgeryClinicalView payload={detail.dadosClinicos} />
              )}

              <SectionBlock title={t("explicit.018")} icon={Dumbbell}>
                {followups.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic py-2">{t("explicit.019")}</p>
                ) : followups.map((fu) => (
                  <div key={fu.id} className="rounded-lg border border-border/60 bg-muted/20 p-3 mb-2">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <Badge variant="secondary" className="text-xs font-mono">{fu.tempo}</Badge>
                      {fu.dataAvaliacao && <span className="text-xs text-muted-foreground">{fmtDate(fu.dataAvaliacao, locale)}</span>}
                      {fu.retornoEsporte === true && (
                        <Badge variant="outline" className="text-xs text-green-700 border-green-300 bg-green-50">{t("explicit.020")}</Badge>
                      )}
                      {fu.falha === true && <Badge variant="destructive" className="text-xs">{t("explicit.021")}</Badge>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <ScorePill label={t("explicit.251")} value={fu.vasDor} />
                    </div>
                    {fu.complicacoes && fu.complicacoes.length > 0 && (
                      <div className="mt-2 flex items-center gap-1 text-xs text-destructive">
                        <AlertTriangle className="h-3 w-3" />
                        {fu.complicacoes.join(", ")}
                      </div>
                    )}
                    {fu.observacoes && <p className="mt-2 text-xs text-muted-foreground italic">{fu.observacoes}</p>}
                  </div>
                ))}
              </SectionBlock>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Surgery table row ────────────────────────────────────────────────────────
function SurgeryRow({ surgery, onSelect }: { surgery: Surgery; onSelect: (id: number) => void }) {
  const { locale } = useLanguage();
  const procedimentos = caseTypeLabels(surgery);
  return (
    <TableRow
      className="cursor-pointer hover:bg-muted/50 transition-colors"
      onClick={() => onSelect(surgery.id)}
    >
      <TableCell className="font-medium text-sm whitespace-nowrap">
        {surgery.dataCirurgia
          ? toDisplayDate(surgery.dataCirurgia).toLocaleDateString(locale)
          : <span className="text-muted-foreground">–</span>}
      </TableCell>
      <TableCell className="text-sm">
        {surgery.tipoCaso
          ? <Badge variant="secondary" className="text-xs font-normal">{surgery.tipoCaso}</Badge>
          : <span className="text-muted-foreground">–</span>}
      </TableCell>
      <TableCell>
        {procedimentos.length > 0
          ? <div className="flex flex-wrap gap-1">{procedimentos.map(p => <Badge key={p} variant="outline" className="text-xs font-mono">{p}</Badge>)}</div>
          : <span className="text-muted-foreground text-sm">–</span>}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">{surgery.hospital || <span>–</span>}</TableCell>
      <TableCell className="text-sm">
        {[surgery.patientSexo, surgery.patientLado].filter(Boolean).join(" · ") || <span className="text-muted-foreground">–</span>}
      </TableCell>
      <TableCell className="text-right">
        <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto" />
      </TableCell>
    </TableRow>
  );
}

// ─── Fetch hook ───────────────────────────────────────────────────────────────
function useAdminFetch<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    fetch(url, { credentials: "same-origin" })
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [url]);
  useEffect(() => { load(); }, [load]);
  return { data, loading };
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function AdminDoctorView() {
  const [, params] = useRoute("/admin/doctors/:id");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const t = useScopedTranslations(adminConsoleMessages);
  const { formatDate } = useLanguage();
  const [selectedSurgeryId, setSelectedSurgeryId] = useState<number | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  const doctorId = Number(params?.id);
  const { data: doctor, loading: doctorLoading } = useAdminFetch<DoctorInfo>(`/api/doctors/${doctorId}`);
  const { data: surgeriesRaw, loading: surgeriesLoading } = useAdminFetch<Surgery[]>(`/api/admin/doctors/${doctorId}/surgeries`);
  const surgeries = (surgeriesRaw ?? []).slice().sort((a, b) => {
    const da = a.dataCirurgia ?? a.createdAt;
    const db = b.dataCirurgia ?? b.createdAt;
    return db.localeCompare(da);
  });

  const [isFreeState, setIsFreeState] = useState<boolean | null>(null);
  const [isFreeLoading, setIsFreeLoading] = useState(false);
  const [temporaryAccessExpiresAt, setTemporaryAccessExpiresAt] = useState<string | null>(null);
  const [temporaryAccessLoading, setTemporaryAccessLoading] = useState(false);

  useEffect(() => {
    if (doctor && typeof doctor.isFree === "boolean") {
      setIsFreeState(doctor.isFree);
      setTemporaryAccessExpiresAt(doctor.temporaryAccessExpiresAt ?? null);
    }
  }, [doctor]);

  const handleResetPassword = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!doctor || resetLoading) return;
    setResetLoading(true);
    try {
      const res = await fetch(`/api/admin/doctors/${doctorId}/reset-password`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ novaSenha: "123456" }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? t("error"));
      toast({ title: `✅ ${t("doctor.passwordReset", { name: doctor.nome })}`, description: t("doctor.passwordResetDescription") });
    } catch {
      toast({ title: t("doctor.passwordResetError"), variant: "destructive" });
    } finally {
      setResetLoading(false);
    }
  };

  const handleToggleFree = async () => {
    if (isFreeLoading || isFreeState === null) return;
    const next = !isFreeState;
    setIsFreeLoading(true);
    try {
      const resp = await fetch(`/api/admin/doctors/${doctorId}/set-free`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isFree: next }),
      });
      if (resp.ok) setIsFreeState(next);
    } finally {
      setIsFreeLoading(false);
    }
  };

  const handleGrantTemporaryAccess = async () => {
    if (temporaryAccessLoading) return;
    if (!window.confirm(t("doctor.temporaryConfirm"))) return;
    setTemporaryAccessLoading(true);
    try {
      const response = await fetch(`/api/admin/doctors/${doctorId}/grant-temporary-access`, {
        method: "PATCH",
        credentials: "same-origin",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? t("error"));
      setIsFreeState(false);
      setTemporaryAccessExpiresAt(data.temporaryAccessExpiresAt ?? null);
      toast({
        title: t("doctor.temporaryGranted"),
        description: data.temporaryAccessExpiresAt
          ? t("doctor.temporaryUntil", { date: formatDate(data.temporaryAccessExpiresAt) })
          : undefined,
      });
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : t("staff.operationError"),
        variant: "destructive",
      });
    } finally {
      setTemporaryAccessLoading(false);
    }
  };

  if (doctorLoading || surgeriesLoading) {
    return (
      <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!doctor) {
    return (
      <div className="p-8 text-center">
        <p className="text-destructive mb-4">{t("doctor.notFound")}</p>
        <Button variant="outline" onClick={() => setLocation("/admin")}>
          <ArrowLeft className="h-4 w-4 mr-2" /> {t("doctor.back")}
        </Button>
      </div>
    );
  }

  const initials = doctor.nome.split(" ").slice(0, 2).map((n: string) => n[0]).join("").toUpperCase();
  const avatarGradient = "linear-gradient(135deg,#1A365D,#2A4A7F)";

  return (
    <div className="max-w-5xl mx-auto animate-in fade-in">

      {/* ── Mobile navy banner with doctor avatar (hidden md+) ── */}
      <div className="md:hidden" style={{ background: "linear-gradient(135deg, #0A1628 0%, #0D2040 100%)" }}>
        <div className="px-4 pt-5 pb-5">
          <button
            onClick={() => setLocation("/admin")}
            style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "rgba(31,182,225,0.85)", background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: 12 }}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
             {t("doctor.back")}
          </button>
          <div
            style={{ display: "flex", alignItems: "center", gap: 14, cursor: "pointer" }}
            onClick={() => setProfileOpen(true)}
             title={t("doctor.viewProfile")}
          >
            <div
              style={{ width: 48, height: 48, borderRadius: "50%", background: avatarGradient, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, flexShrink: 0, boxShadow: "0 2px 8px rgba(0,0,0,0.25)" }}
            >
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <h1 style={{ fontSize: 18, fontWeight: 700, color: "#fff", margin: 0 }} className="truncate">{doctor.nome}</h1>
                <button
                  onClick={handleResetPassword}
                  disabled={resetLoading}
                  title={t("doctor.resetTooltip")}
                  style={{ background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 8, padding: "4px 8px", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, flexShrink: 0, opacity: resetLoading ? 0.5 : 1 }}
                >
                  {resetLoading ? <RotateCcw style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : <KeyRound style={{ width: 12, height: 12 }} />}
                   {t("doctor.resetPassword")}
                </button>
              </div>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", margin: "3px 0 0" }}>
                {doctor.estrangeiro && doctor.paisOrigem
                  ? `🌍 ${doctor.paisOrigem}`
                  : `CRM ${doctor.crmEstado ?? ""} ${doctor.crm ?? ""}`}
                {doctor.especialidade ? ` · ${doctor.especialidade}` : ""}
              </p>
            </div>
            <div style={{ textAlign: "center", flexShrink: 0 }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: "#fff" }}>{surgeries.length}</div>
               <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{t("doctor.surgeries")}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="p-6 md:p-8 space-y-6">

      {/* ── Desktop header (hidden on mobile) ── */}
      <div className="hidden md:flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => setLocation("/admin")} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4 mr-1" /> {t("doctor.back")}
        </Button>
      </div>

      {/* Doctor card - desktop only */}
      <Card
        className="hidden md:block border-border shadow-sm cursor-pointer hover:border-primary/40 transition-colors"
        onClick={() => setProfileOpen(true)}
         title={t("doctor.viewProfile")}
      >
        <CardHeader className="pb-3">
          <div className="flex items-start gap-4">
            <div
              className="h-12 w-12 rounded-full flex items-center justify-center flex-shrink-0 text-white font-bold text-lg"
              style={{ background: avatarGradient }}
            >
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <CardTitle className="text-xl" style={{ color: "#1A365D" }}>{doctor.nome}</CardTitle>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 text-xs border-blue-300 text-blue-700 hover:bg-blue-50"
                  disabled={resetLoading}
                  onClick={handleResetPassword}
                  title={t("doctor.resetTooltip")}
                >
                  {resetLoading ? <RotateCcw className="h-3 w-3 animate-spin" /> : <KeyRound className="h-3 w-3" />}
                   {t("doctor.resetPassword")}
                </Button>
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">
                {doctor.estrangeiro && doctor.paisOrigem
                  ? `🌍 ${doctor.paisOrigem}`
                  : `CRM ${doctor.crmEstado ?? ""} ${doctor.crm ?? ""}`}
                {doctor.especialidade && ` · ${doctor.especialidade}`}
              </p>
              {doctor.cidade && doctor.estado && (
                <p className="text-xs text-muted-foreground mt-0.5">{doctor.cidade} – {doctor.estado}</p>
              )}
            </div>
            <div className="flex gap-3 flex-shrink-0">
              <div className="text-center">
                <div className="text-2xl font-bold text-foreground">{surgeries.length}</div>
                 <div className="text-xs text-muted-foreground">{t("doctor.surgeries")}</div>
              </div>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* ── Isenção de Cobrança ── */}
      {isFreeState !== null && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
          background: isFreeState ? "linear-gradient(135deg,#f0fdf4,#dcfce7)" : "#fafafa",
          border: `1.5px solid ${isFreeState ? "#86efac" : "#e2e8f0"}`,
          borderRadius: 14, padding: "14px 18px",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
              background: isFreeState ? "#16a34a" : "#94a3b8",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <span style={{ fontSize: 16 }}>{isFreeState ? "🎁" : "💳"}</span>
            </div>
            <div>
              <p style={{ fontSize: 13, fontWeight: 700, margin: 0, color: isFreeState ? "#15803d" : "#334155" }}>
                {isFreeState ? t("doctor.exempt") : t("doctor.billingActive")}
              </p>
              <p style={{ fontSize: 11, color: isFreeState ? "#16a34a" : "#94a3b8", margin: "2px 0 0" }}>
                {isFreeState
                  ? t("doctor.exemptDescription")
                  : t("doctor.billingDescription")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleToggleFree}
            disabled={isFreeLoading}
            style={{
              padding: "7px 16px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
              background: isFreeState ? "#fee2e2" : "#dbeafe",
              border: `1px solid ${isFreeState ? "#fca5a5" : "#93c5fd"}`,
              color: isFreeState ? "#dc2626" : "#1d4ed8",
              whiteSpace: "nowrap", flexShrink: 0,
              opacity: isFreeLoading ? 0.6 : 1,
            }}
          >
            {isFreeLoading ? t("doctor.saving") : isFreeState ? t("doctor.removeExemption") : t("doctor.makeExempt")}
          </button>
        </div>
      )}

      {/* ── Acesso temporário ── */}
      {isFreeState !== null && (
        <div className="flex flex-col gap-3 rounded-[14px] border border-violet-200 bg-violet-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-600 text-white">
              <CalendarClock className="h-4 w-4" />
            </div>
            <div>
              <p className="m-0 text-[13px] font-bold text-violet-900">{t("doctor.temporaryAccess")}</p>
              <p className="mt-0.5 text-[11px] text-violet-700">
                {temporaryAccessExpiresAt && new Date(temporaryAccessExpiresAt).getTime() > Date.now()
                  ? t("doctor.temporaryUntil", { date: formatDate(temporaryAccessExpiresAt) })
                  : t("doctor.temporaryDescription")}
              </p>
            </div>
          </div>
          <Button
            type="button"
            onClick={handleGrantTemporaryAccess}
            disabled={temporaryAccessLoading}
            className="shrink-0 gap-2 bg-violet-600 hover:bg-violet-700"
          >
            {temporaryAccessLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            {temporaryAccessExpiresAt && new Date(temporaryAccessExpiresAt).getTime() > Date.now()
              ? t("doctor.renewTemporary")
              : t("doctor.grantTemporary")}
          </Button>
        </div>
      )}

      {/* Surgeries table */}
      <Card className="border-border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Calendar className="h-4 w-4 text-primary" />
             {t("doctor.procedures")}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {t("doctor.proceduresDescription")}
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {surgeries.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <Activity className="h-8 w-8 mx-auto mb-2 opacity-40" />
               <p className="text-sm">{t("doctor.noSurgeries")}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="text-xs">{t("doctor.date")}</TableHead>
                  <TableHead className="text-xs">{t("doctor.caseType")}</TableHead>
                  <TableHead className="text-xs">{t("doctor.procedures")}</TableHead>
                  <TableHead className="text-xs">{t("doctor.hospital")}</TableHead>
                  <TableHead className="text-xs">{t("doctor.patient")}</TableHead>
                  <TableHead className="text-right text-xs"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {surgeries.map(s => (
                  <SurgeryRow key={s.id} surgery={s} onSelect={setSelectedSurgeryId} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-center text-muted-foreground pb-4">
        <TrendingUp className="h-3 w-3 inline mr-1" />
        {t("doctor.privacy")}
      </p>

      {/* Detalhe da cirurgia com privacidade do paciente (iniciais) */}
      <AdminSurgerySheet surgeryId={selectedSurgeryId} onClose={() => setSelectedSurgeryId(null)} />

      {/* ── Doctor full profile sheet ── */}
      <Sheet open={profileOpen} onOpenChange={setProfileOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader className="pb-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div
                className="h-14 w-14 rounded-full flex items-center justify-center text-white font-bold text-xl flex-shrink-0"
                style={{ background: avatarGradient }}
              >
                {initials}
              </div>
              <div>
                <SheetTitle className="text-lg leading-tight">{doctor.nome}</SheetTitle>
                <p className="text-sm text-muted-foreground">
                  {doctor.estrangeiro && doctor.paisOrigem
                    ? `🌍 ${doctor.paisOrigem}`
                    : `CRM ${doctor.crmEstado ?? ""} ${doctor.crm ?? ""}`}
                  {doctor.especialidade ? ` · ${doctor.especialidade}` : ""}
                </p>
              </div>
            </div>
          </SheetHeader>

          <div className="py-5 space-y-5">
            {/* Profissional */}
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-3">{t("doctor.professionalData")}</p>
              <div className="space-y-0.5">
                <ProfileRow label={t("doctor.fullName")} value={doctor.nome} />
                <ProfileRow label={t("option.email")} value={doctor.email} />
                {doctor.estrangeiro
                  ? <ProfileRow label={t("doctor.originCountry")} value={doctor.paisOrigem ?? "—"} />
                  : <ProfileRow label="CRM" value={doctor.crm && doctor.crmEstado ? `${doctor.crm} (${doctor.crmEstado})` : (doctor.crm ?? null)} />
                }
                <ProfileRow label={t("doctor.specialty")} value={doctor.especialidade} />
                <ProfileRow label="WhatsApp Business" value={doctor.whatsappBusiness} />
              </div>
            </div>

            {/* Pessoal */}
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-3">{t("doctor.personalData")}</p>
              <div className="space-y-0.5">
                <ProfileRow label="CPF" value={doctor.cpf ? doctor.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") : null} />
                 <ProfileRow label={t("doctor.birthDate")} value={doctor.dataNascimento ? formatDate(new Date(doctor.dataNascimento + "T12:00:00")) : null} />
                <ProfileRow label={t("doctor.phone")} value={doctor.telefone} />
              </div>
            </div>

            {/* Endereço */}
            {(doctor.endereco || doctor.cidade || doctor.estado || doctor.cep) && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-3">{t("doctor.address")}</p>
                <div className="space-y-0.5">
                  <ProfileRow label={t("doctor.street")} value={doctor.endereco} />
                  <ProfileRow label={t("doctor.city")} value={doctor.cidade} />
                  <ProfileRow label={t("doctor.state")} value={doctor.estado} />
                  <ProfileRow label={t("explicit.254")} value={doctor.cep} />
                </div>
              </div>
            )}

            {/* Plataforma */}
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-3">{t("doctor.platform")}</p>
              <div className="space-y-0.5">
                <ProfileRow label={t("status")} value={doctor.aprovado ? t("staff.approved") : t("doctor.pending")} />
                <ProfileRow label={t("doctor.billing")} value={isFreeState ? t("doctor.freePlan") : t("doctor.stripePlan")} />
                 <ProfileRow label={t("doctor.registeredAt")} value={doctor.createdAt ? formatDate(doctor.createdAt) : null} />
                <ProfileRow label={t("doctor.totalSurgeries")} value={String(surgeries.length)} />
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      </div>
    </div>
  );
}
