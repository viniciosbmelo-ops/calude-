/**
 * Seguimento pós-operatório: agenda automática de envio pelo WhatsApp e avaliações
 * registradas. Dor (VAS), retorno ao esporte, falha, complicações e as escalas do
 * médico (Constant/Rowe) aplicáveis à cirurgia pelo catálogo de patologias.
 */
import { useEffect, useState } from "react";
import { Activity, AlertTriangle, Bell, BellOff, CheckCheck, Clock, Copy, Loader2, Plus } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetSurgeryQueryKey, useCreateFollowup, type ClinicianScaleSummary, type CreateFollowupBody, type PatientScaleSummary } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { surgeryViewMessages } from "@/locales/surgery-view";
import { ClinicianScalesFields } from "./clinician-scales-fields";
import {
  buildClinicianScalesPayload,
  emptyDraft,
  itemLabelKey,
  scaleNameKey,
  type ScaleDraft,
} from "./clinician-scales";
import { followupPainDisplay, followupPatientSane } from "./followup-patient-scales";

type ScheduledNotif = { id: number; periodo: string; scheduledDate: string | null; sentAt: string | null; scales: string[]; status: string; daysAfterSurgery: number | null; notes: string | null };
export type SurgeryFollowup = {
  id: number;
  tempo: string;
  dataAvaliacao?: string | null;
  vasDor?: number | null;
  retornoEsporte?: boolean | null;
  nivelRetorno?: string | null;
  falha?: boolean | null;
  falhaType?: string | null;
  complicacoes?: string[] | null;
  observacoes?: string | null;
  escalasClinicas?: ClinicianScaleSummary[] | null;
  /** Respostas do paciente pelo link (VAS Dor, SANE); não substituem vasDor. */
  escalasPaciente?: PatientScaleSummary[] | null;
  createdAt: string;
};

type MessageKey = keyof (typeof surgeryViewMessages)["pt-BR"];
const emptyDrafts = (codes: readonly string[]) => Object.fromEntries(codes.map((c) => [c, emptyDraft(c)])) as Record<string, ScaleDraft>;

const EMPTY_FORM = { tempo: "", dataAvaliacao: "", vasDor: "", retornoEsporte: false, nivelRetorno: "", falha: false, falhaType: "", complicacoes: "", observacoes: "" };

export function SurgeryFollowupSection({ surgeryId, surgeryDate, patientPhone, followups, clinicianScales = [] }: {
  surgeryId: number;
  surgeryDate?: string | null;
  patientPhone?: string | null;
  followups: SurgeryFollowup[];
  /** Escalas do médico aplicáveis (applicableClinicianScales do @workspace/clinical). */
  clinicianScales?: readonly string[];
}) {
  const t = useScopedTranslations(surgeryViewMessages);
  const tk = (key: string) => t(key as MessageKey);
  const { formatDate } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createFollowup = useCreateFollowup();

  const [schedule, setSchedule] = useState<ScheduledNotif[]>([]);
  const [generating, setGenerating] = useState(false);
  const [preparing, setPreparing] = useState<number | null>(null);
  const [wa, setWa] = useState<{ notifId: number | null; message: string; link: string } | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [formError, setFormError] = useState<string | null>(null);
  const [scaleDrafts, setScaleDrafts] = useState<Record<string, ScaleDraft>>(() => emptyDrafts(clinicianScales));

  useEffect(() => {
    fetch(`/api/surgeries/${surgeryId}/schedule`, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setSchedule(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [surgeryId]);

  const periodLabel = (value: string) => ({
    "Pré-operatório": t("ts_periodPreoperative"),
    "6 semanas": t("ts_period6Weeks"),
    "3 meses": t("ts_period3Months"),
    "6 meses": t("ts_period6Months"),
    "1 ano": t("ts_period1Year"),
  } as Record<string, string>)[value] ?? value;
  const scaleLabel = (value: string) => (value === "VAS Dor" ? t("ts_scaleVasPain") : value);

  const markStatus = async (notifId: number, status: string) => {
    const r = await fetch(`/api/surgeries/${surgeryId}/schedule/${notifId}/status`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (r.ok) {
      const updated = await r.json();
      setSchedule((prev) => prev.map((n) => (n.id === notifId ? { ...n, status: updated.status } : n)));
    }
  };

  const generateSchedule = async () => {
    setGenerating(true);
    try {
      const r = await fetch(`/api/surgeries/${surgeryId}/schedule/generate`, { method: "POST", credentials: "same-origin" });
      if (r.ok) {
        const data = await r.json();
        setSchedule(Array.isArray(data) ? data : []);
        toast({ title: t("t_generatedSchedule"), description: t("t_evaluationsScheduled", { count: Array.isArray(data) ? data.length : 0 }) });
      } else {
        toast({ title: t("t_scheduleError"), variant: "destructive" });
      }
    } catch {
      toast({ title: t("t_scheduleError"), variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const openWhatsApp = (message: string) => {
    const digits = (patientPhone ?? "").replace(/\D/g, "");
    const waPhone = digits.startsWith("55") ? digits : `55${digits}`;
    window.open(`https://wa.me/${waPhone}?text=${encodeURIComponent(message)}`, "_blank");
  };

  const prepareScheduled = async (notifId: number) => {
    setPreparing(notifId);
    try {
      const r = await fetch(`/api/surgeries/${surgeryId}/schedule/${notifId}/prepare-whatsapp`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
      });
      const data = await r.json();
      if (!data.followupId) {
        toast({ title: t("t_prepareMessageError"), description: data.error, variant: "destructive" });
      } else if (patientPhone) {
        openWhatsApp(data.message);
        void markStatus(notifId, "sent");
        toast({ title: t("t_whatsappOpened"), description: t("t_completeSending") });
      } else {
        setWa({ notifId, message: data.message, link: data.link ?? "" });
      }
    } catch {
      toast({ title: t("t_prepareMessageError"), variant: "destructive" });
    } finally {
      setPreparing(null);
    }
  };

  const copyLink = (link: string) => {
    void navigator.clipboard.writeText(link);
    toast({ title: t("t_linkCopied") });
  };

  const submitEvaluation = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!form.tempo.trim()) { setFormError(t("periodRequired")); return; }
    const pain = form.vasDor.trim() === "" ? undefined : Number(form.vasDor.replace(",", "."));
    if (pain !== undefined && (!Number.isFinite(pain) || pain < 0 || pain > 10)) { setFormError(t("invalidPain")); return; }
    const complicacoes = form.complicacoes.split(",").map((c) => c.trim()).filter(Boolean);
    const scales = buildClinicianScalesPayload(scaleDrafts, clinicianScales);
    if (!scales.ok) {
      setFormError(t("cs_invalidItem", { scale: tk(scaleNameKey(scales.scale)), item: tk(itemLabelKey(scales.scale, scales.field)) }));
      return;
    }
    // escalasClinicas vai no mesmo POST; o servidor valida, pontua e grava na mesma transação.
    const data: CreateFollowupBody = {
      surgeryId,
      tempo: form.tempo.trim(),
      dataAvaliacao: form.dataAvaliacao || undefined,
      vasDor: pain,
      retornoEsporte: form.retornoEsporte,
      nivelRetorno: form.nivelRetorno || undefined,
      falha: form.falha,
      falhaType: form.falha ? form.falhaType || undefined : undefined,
      complicacoes: complicacoes.length > 0 ? complicacoes : undefined,
      observacoes: form.observacoes || undefined,
      ...(Object.keys(scales.payload).length > 0 ? { escalasClinicas: scales.payload } : {}),
    };
    createFollowup.mutate(
      { data },
      {
        onSuccess: () => {
          toast({ title: t("t_followupSaved") });
          void queryClient.invalidateQueries({ queryKey: getGetSurgeryQueryKey(surgeryId) });
          setForm({ ...EMPTY_FORM });
          setScaleDrafts(emptyDrafts(clinicianScales));
          setFormOpen(false);
        },
        onError: (err) => {
          const serverMessage = (err as { data?: { error?: unknown } } | null)?.data?.error;
          toast({ title: t("t_followupSaveError"), description: typeof serverMessage === "string" ? serverMessage : undefined, variant: "destructive" });
        },
      },
    );
  };

  const yesNo = (value: boolean | null | undefined) => (value == null ? t("notInformed") : value ? t("yes") : t("no"));
  const now = Date.now();

  return (
    <div className="space-y-4 border-t pt-4">
      <div className="flex items-center gap-2">
        <Activity className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">{t("td_detail122")}</h2>
      </div>
      <p className="text-xs text-muted-foreground">{t("scaleNotice")}</p>

      {schedule.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/40 p-4 flex items-center gap-3">
          <Bell className="h-5 w-5 text-slate-400 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-slate-600">{t("ts_followupTimeline")}</p>
            <p className="text-xs text-slate-400">{t("ts_noScheduledEvaluations")}</p>
          </div>
          <Button size="sm" variant="outline" onClick={generateSchedule} disabled={generating} className="gap-1.5 shrink-0">
            {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bell className="h-3.5 w-3.5" />}
            {t("ts_generateSchedule")}
          </Button>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Bell className="h-4 w-4 text-slate-500 shrink-0" />
            <span className="font-semibold text-slate-700 text-sm">{t("ts_scaleDeliveryTimeline")}</span>
            <span className="ml-auto text-xs text-slate-500">
              {(() => {
                const pending = schedule.filter((n) => n.status === "pending").length;
                const sent = schedule.filter((n) => n.status === "sent" || n.status === "completed").length;
                return t("ts_scheduleSummary", {
                  pending: t(pending === 1 ? "ts_pendingCountOne" : "ts_pendingCount", { count: pending }),
                  sent: t(sent === 1 ? "ts_sentCountOne" : "ts_sentCount", { count: sent }),
                });
              })()}
            </span>
            <button onClick={generateSchedule} disabled={generating} title={t("ts_regenerateSchedule")} className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1">
              {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Activity className="h-3 w-3" />}
              {t("ts_regenerate")}
            </button>
          </div>
          <div className="space-y-1.5">
            {schedule.map((notif) => {
              const scheduled = notif.scheduledDate ? new Date(`${notif.scheduledDate}T12:00:00`) : null;
              const sentAt = notif.sentAt ? new Date(notif.sentAt) : null;
              const sentLate = notif.status === "sent" && sentAt && now - sentAt.getTime() > 7 * 86400000;
              const overdue = scheduled && scheduled.getTime() < now && notif.status === "pending";
              const tone = notif.status === "completed" ? "text-green-700 bg-green-50 border-green-200"
                : sentLate || overdue ? "text-red-600 bg-red-50 border-red-200"
                : notif.status === "sent" ? "text-yellow-700 bg-yellow-50 border-yellow-300"
                : notif.status === "skipped" ? "text-slate-400 bg-slate-50 border-slate-200"
                : "text-slate-600 bg-white border-slate-200";
              const icon = notif.status === "completed" ? <CheckCheck className="h-3.5 w-3.5 text-green-600" />
                : sentLate || overdue ? <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                : notif.status === "skipped" ? <BellOff className="h-3.5 w-3.5 text-slate-400" />
                : <Clock className="h-3.5 w-3.5 text-slate-400" />;
              return (
                <div key={notif.id} className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-xs ${tone}`}>
                  <div className="shrink-0 w-4">{icon}</div>
                  <div className="flex-1 min-w-0">
                    <span className="font-medium">{periodLabel(notif.periodo)}</span>
                    {notif.status === "sent" && <span className="ml-2 font-semibold">{sentLate ? t("ts_noResponseSevenDays") : t("ts_awaitingResponse")}</span>}
                    {notif.status === "completed" && <span className="ml-2 font-semibold text-green-700">{t("ts_answered")}</span>}
                    {notif.scales?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {notif.scales.map((s) => <span key={s} className="px-1.5 py-0.5 bg-black/5 rounded text-[10px]">{scaleLabel(s)}</span>)}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    {notif.status === "sent" && sentAt && <div className="font-mono opacity-80">{t("t_sentOn", { date: formatDate(sentAt) })}</div>}
                    {notif.status !== "sent" && scheduled && (
                      <div className="font-mono opacity-70">{t(notif.status === "pending" ? "t_dueOn" : "t_scheduledFor", { date: formatDate(scheduled) })}</div>
                    )}
                    {notif.status === "pending" && (
                      <div className="flex flex-col gap-1 mt-1 items-end">
                        <button onClick={() => prepareScheduled(notif.id)} disabled={preparing === notif.id}
                          className="text-[10px] px-2 py-0.5 rounded bg-green-600 text-white hover:bg-green-700 flex items-center gap-1 disabled:opacity-60">
                          {preparing === notif.id && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                          {t("ts_openWhatsApp")}
                        </button>
                        <button onClick={() => markStatus(notif.id, "skipped")} className="text-[10px] px-1.5 py-0.5 rounded text-slate-400 hover:text-slate-600">
                          {t("ts_skip")}
                        </button>
                      </div>
                    )}
                    {(notif.status === "sent" || notif.status === "completed" || notif.status === "skipped") && (
                      <button onClick={() => markStatus(notif.id, "pending")} className="text-[10px] px-2 py-0.5 mt-1 rounded bg-slate-200 text-slate-600 hover:bg-slate-300">
                        {t("ts_reopen")}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {!surgeryDate && (
            <p className="text-xs text-amber-600 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> {t("ts_surgeryDateScheduleWarning")}</p>
          )}
        </div>
      )}

      <div className="flex justify-between items-center flex-wrap gap-2">
        <h3 className="text-base font-medium">{t("ts_postoperativeEvaluations")}</h3>
        <Button size="sm" className="gap-1" onClick={() => { setForm({ ...EMPTY_FORM, dataAvaliacao: new Date().toISOString().slice(0, 10) }); setScaleDrafts(emptyDrafts(clinicianScales)); setFormError(null); setFormOpen(true); }}>
          <Plus className="h-4 w-4" /> {t("newEvaluation")}
        </Button>
      </div>

      {followups.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noEvaluations")}</p>
      ) : (
        <ul className="space-y-2">
          {followups.map((f) => {
            const pain = followupPainDisplay(f.vasDor, f.escalasPaciente);
            const patientSane = followupPatientSane(f.escalasPaciente);
            return (
            <li key={f.id} className="rounded-xl border p-3 text-sm space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">{periodLabel(f.tempo)}</span>
                <span className="text-xs text-muted-foreground">{formatDate(f.dataAvaliacao ? `${f.dataAvaliacao}T12:00:00` : f.createdAt)}</span>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                {pain.kind === "both" ? (
                  <Badge variant="outline" data-vas="clinician-patient">{t("fu_vasClinicianPatient", { clinician: pain.clinician, patient: pain.patient })}</Badge>
                ) : pain.kind === "patientOnly" ? (
                  <Badge variant="outline" data-vas="patient">{t("fu_vasPatientOnly", { patient: pain.patient })}</Badge>
                ) : (
                  <Badge variant="outline">{t("vasPain")}: {pain.value ?? "—"}</Badge>
                )}
                {patientSane != null && (
                  <Badge variant="outline" data-patient-scale="SANE">{t("fu_patientSane", { score: patientSane })}</Badge>
                )}
                <Badge variant="outline">{t("returnToSport")}: {yesNo(f.retornoEsporte)}{f.nivelRetorno ? ` (${f.nivelRetorno})` : ""}</Badge>
                <Badge variant="outline" className={f.falha ? "border-red-300 text-red-700" : undefined}>{t("failure")}: {yesNo(f.falha)}{f.falha && f.falhaType ? ` — ${f.falhaType}` : ""}</Badge>
                {(f.escalasClinicas ?? []).map((s) => (
                  <Badge key={s.escala} variant="secondary" data-clinician-scale={s.escala}>
                    {s.max != null
                      ? t("cs_scoreBadge", { scale: tk(scaleNameKey(s.escala)), score: s.score ?? "—", max: s.max })
                      : t("cs_scoreBadgeNoMax", { scale: tk(scaleNameKey(s.escala)), score: s.score ?? "—" })}
                  </Badge>
                ))}
              </div>
              {f.complicacoes && f.complicacoes.length > 0 && <p className="text-xs"><span className="text-muted-foreground">{t("complications")}:</span> {f.complicacoes.join(", ")}</p>}
              {f.observacoes && <p className="text-xs whitespace-pre-wrap text-muted-foreground">{f.observacoes}</p>}
            </li>
            );
          })}
        </ul>
      )}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("evaluationTitle")}</DialogTitle>
            <DialogDescription>{t("evaluationDescription")}</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitEvaluation} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="fu-tempo">{t("period")} *</Label>
                <Input id="fu-tempo" value={form.tempo} placeholder={t("periodPlaceholder")} maxLength={60} onChange={(e) => setForm({ ...form, tempo: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fu-data">{t("evaluationDate")}</Label>
                <Input id="fu-data" type="date" value={form.dataAvaliacao} onChange={(e) => setForm({ ...form, dataAvaliacao: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fu-vas">{t("vasPain")}</Label>
                <Input id="fu-vas" inputMode="decimal" value={form.vasDor} onChange={(e) => setForm({ ...form, vasDor: e.target.value })} />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label htmlFor="fu-retorno">{t("returnToSport")}</Label>
              <Switch id="fu-retorno" checked={form.retornoEsporte} onCheckedChange={(v) => setForm({ ...form, retornoEsporte: v })} />
            </div>
            {form.retornoEsporte && (
              <div className="space-y-1.5">
                <Label htmlFor="fu-nivel">{t("returnLevel")}</Label>
                <Input id="fu-nivel" value={form.nivelRetorno} maxLength={120} onChange={(e) => setForm({ ...form, nivelRetorno: e.target.value })} />
              </div>
            )}
            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label htmlFor="fu-falha">{t("failure")}</Label>
              <Switch id="fu-falha" checked={form.falha} onCheckedChange={(v) => setForm({ ...form, falha: v })} />
            </div>
            {form.falha && (
              <div className="space-y-1.5">
                <Label htmlFor="fu-falha-tipo">{t("failureType")}</Label>
                <Input id="fu-falha-tipo" value={form.falhaType} maxLength={120} onChange={(e) => setForm({ ...form, falhaType: e.target.value })} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="fu-comp">{t("complications")}</Label>
              <Input id="fu-comp" value={form.complicacoes} onChange={(e) => setForm({ ...form, complicacoes: e.target.value })} />
              <p className="text-xs text-muted-foreground">{t("complicationsHint")}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fu-obs">{t("observations")}</Label>
              <Textarea id="fu-obs" rows={3} value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} />
            </div>
            <ClinicianScalesFields
              scales={clinicianScales}
              drafts={scaleDrafts}
              onChange={(code, draft) => setScaleDrafts((prev) => ({ ...prev, [code]: draft }))}
            />
            {formError && <p className="text-sm text-destructive">{formError}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>{t("t_cancel")}</Button>
              <Button type="submit" disabled={createFollowup.isPending}>{createFollowup.isPending ? t("saving") : t("save")}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={wa !== null} onOpenChange={(open) => { if (!open) setWa(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("ta_whatsappMessage")}</DialogTitle>
            <DialogDescription>{t("ta_whatsappDescription")}</DialogDescription>
          </DialogHeader>
          {wa && (
            <div className="space-y-3">
              <p className="rounded-md bg-green-50 border border-green-200 px-3 py-2 text-xs text-green-800">{t("t_patientCpfHint")}</p>
              {wa.link && (
                <div className="rounded-md border bg-muted/30 px-3 py-2 space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">{t("t_patientLink")}</p>
                  <p className="text-xs break-all font-mono">{wa.link}</p>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 mt-1" onClick={() => copyLink(wa.link)}>
                    <Copy className="h-3 w-3" /> {t("t_copyLink")}
                  </Button>
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="wa-msg" className="text-xs text-muted-foreground">{t("t_message")}</Label>
                <Textarea id="wa-msg" value={wa.message} onChange={(e) => setWa({ ...wa, message: e.target.value })} rows={8} className="text-sm font-mono resize-none" />
                <p className="text-xs text-muted-foreground">{t("t_editMessageHint")}</p>
              </div>
              <div className="flex justify-end">
                <Button variant="outline" onClick={() => setWa(null)}>{t("ta_close")}</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
