import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useSecretaryAuth, secretaryFetch } from "@/lib/secretary-auth";
import { useTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";
import { CalendarDays, Users, LogOut, Plus, Pencil, Trash2, Phone, Sun, Moon, AlertTriangle, Send, ClipboardList, FlaskConical, Bell, Clock, CheckCircle2 } from "lucide-react";
import { cn, formatLocalDate, formatPersonName, sortByPtBrName } from "@/lib/utils";
import { APPOINTMENT_STATUSES, appointmentStatusLabel, appointmentTypeLabel, selectableAppointmentTypes } from "@/lib/appointment-types";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { consoleMessages } from "@/locales/console";
import {
  REGEN_SESSION_TYPE,
  daysUntil,
  urgentRegenAlerts,
  type SecretaryRegenAlert,
  type SecretaryRegenCase,
} from "@/lib/secretary-regen";
import { DateInput, TimeInput } from "@/components/ui/date-input";

type Patient = { id: number; nome: string; telefone: string | null; email: string | null; dataNascimento: string | null };
type Appointment = {
  id: number; patientId: number; data: string; hora: string; tipo: string;
  observacoes: string | null; status: string; patientNome: string | null; patientTelefone: string | null;
};

function cleanPhone(phone: string) {
  const d = phone.replace(/\D/g, "");
  return d.startsWith("55") ? d : `55${d}`;
}

function statusColor(status: string) {
  if (status === "agendado") return "bg-blue-100 text-blue-800 border-blue-200";
  if (status === "confirmado") return "bg-green-100 text-green-800 border-green-200";
  if (status === "cancelado") return "bg-red-100 text-red-800 border-red-200";
  if (status === "realizado") return "bg-gray-100 text-gray-700 border-gray-200";
  if (status === "faltou") return "bg-orange-100 text-orange-800 border-orange-200";
  return "bg-gray-100 text-gray-700";
}

async function responseError(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { error?: string; message?: string };
    return payload.error ?? payload.message ?? `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

function SectionError({ message, onRetry, retryLabel }: { message: string; onRetry: () => void; retryLabel: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
        <AlertTriangle className="h-7 w-7 text-destructive" />
        <p className="text-sm text-muted-foreground">{message}</p>
        <Button variant="outline" size="sm" onClick={onRetry}>{retryLabel}</Button>
      </CardContent>
    </Card>
  );
}

export default function SecretaryDashboard() {
  const { secretary, isLoading: authLoading, logout } = useSecretaryAuth();
  const [, navigate] = useLocation();
  const { theme, toggleTheme } = useTheme();
  const { toast } = useToast();
  const { formatDate, formatCalendarDate, setLanguage, locale } = useLanguage();
  const t = useScopedTranslations(consoleMessages);

  // DocRegen secretary portal: agenda (consultations / regenerative sessions),
  // patients and pre-consultation invites, a read-only view of the doctor's
  // regenerative cases (to schedule procedure sessions) and the pending
  // regenerative follow-up alerts. The surgical agenda and the post-operative
  // follow-up alerts stay in DocKnee.
  const [tab, setTab] = useState<"agenda" | "patients" | "regen" | "alerts">("agenda");
  const [patients, setPatients] = useState<Patient[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [regenCases, setRegenCases] = useState<SecretaryRegenCase[]>([]);
  const [alerts, setAlerts] = useState<SecretaryRegenAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErrors, setLoadErrors] = useState<Record<"patients" | "appointments" | "regen" | "alerts", string | null>>({
    patients: null, appointments: null, regen: null, alerts: null,
  });

  const [newAppt, setNewAppt] = useState({ patientId: "", data: "", hora: "", tipo: "consulta", observacoes: "", status: "agendado" });
  const [showApptDialog, setShowApptDialog] = useState(false);
  const [editingAppt, setEditingAppt] = useState<Appointment | null>(null);
  const [savingAppt, setSavingAppt] = useState(false);

  const [waDialog, setWaDialog] = useState<{ phone: string; msg: string; label: string } | null>(null);
  const [preConsultPatientId, setPreConsultPatientId] = useState<number | null>(null);

  const openWaConfirm = (phone: string, nome: string, data: string, hora: string, tipo: string) => {
    const dataFormatada = formatCalendarDate(data, { weekday: "long", day: "numeric", month: "long" });
    const msg = t("appointmentWhatsappMessage", { name: nome, type: appointmentTypeLabel(tipo, locale).toLocaleLowerCase(locale), date: dataFormatada, time: hora });
    setWaDialog({ phone: cleanPhone(phone), msg, label: nome });
  };

  const preparePreConsultWhatsApp = async (patient: Patient) => {
    if (!patient.telefone) {
      toast({ title: t("noPhone"), description: t("noPhoneDescription"), variant: "destructive" });
      return;
    }

    setPreConsultPatientId(patient.id);
    try {
      const response = await secretaryFetch(`/regen-api/patients/${patient.id}/pre-consult/invite`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      const payload = await response.json();
      if (!response.ok) {
        toast({ title: t("preConsultError"), description: payload.error ?? t("tryAgain"), variant: "destructive" });
        return;
      }

      setWaDialog({
        phone: cleanPhone(patient.telefone),
        msg: payload.whatsappMessage,
        label: `${t("preConsultation")} — ${patient.nome}`,
      });
      toast({ title: t("preConsultReady"), description: t("preConsultReadyDescription") });
    } catch {
      toast({ title: t("preConsultError"), description: t("verifyConnection"), variant: "destructive" });
    } finally {
      setPreConsultPatientId(null);
    }
  };

  const [newPatient, setNewPatient] = useState({ nome: "", cpf: "", telefone: "", email: "", dataNascimento: "", sexo: "", planoSaude: "", indicadoPor: "", endereco: "", cidade: "", estado: "", cep: "" });
  const [showPatientDialog, setShowPatientDialog] = useState(false);
  const [savingPatient, setSavingPatient] = useState(false);
  const [patientSearch, setPatientSearch] = useState("");

  const loadPatients = useCallback(async () => {
    try {
      const response = await secretaryFetch("/regen-api/patients");
      if (!response.ok) throw new Error(await responseError(response));
      setPatients(await response.json());
      setLoadErrors(errors => ({ ...errors, patients: null }));
    } catch (error) {
      setLoadErrors(errors => ({ ...errors, patients: error instanceof Error ? error.message : t("verifyConnection") }));
    }
  }, [t]);

  const loadAppointments = useCallback(async () => {
    try {
      const response = await secretaryFetch("/regen-api/appointments");
      if (!response.ok) throw new Error(await responseError(response));
      setAppointments(await response.json());
      setLoadErrors(errors => ({ ...errors, appointments: null }));
    } catch (error) {
      setLoadErrors(errors => ({ ...errors, appointments: error instanceof Error ? error.message : t("verifyConnection") }));
    }
  }, [t]);

  const loadRegenCases = useCallback(async () => {
    try {
      const response = await secretaryFetch("/regen-api/secretary/regen-cases");
      if (!response.ok) throw new Error(await responseError(response));
      setRegenCases(await response.json());
      setLoadErrors(errors => ({ ...errors, regen: null }));
    } catch (error) {
      setLoadErrors(errors => ({ ...errors, regen: error instanceof Error ? error.message : t("verifyConnection") }));
    }
  }, [t]);

  const loadAlerts = useCallback(async () => {
    try {
      const response = await secretaryFetch("/regen-api/secretary/followup-alerts?type=regen");
      if (!response.ok) throw new Error(await responseError(response));
      setAlerts(await response.json());
      setLoadErrors(errors => ({ ...errors, alerts: null }));
    } catch (error) {
      setLoadErrors(errors => ({ ...errors, alerts: error instanceof Error ? error.message : t("verifyConnection") }));
    }
  }, [t]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadPatients(), loadAppointments(), loadRegenCases(), loadAlerts()]);
    setLoading(false);
  }, [loadAlerts, loadAppointments, loadPatients, loadRegenCases]);

  useEffect(() => {
    if (authLoading) return;
    if (!secretary) { navigate("/secretary/login"); return; }
    void setLanguage(secretary.idioma === "es" ? "es" : "pt-BR");
    void loadAll();
  }, [authLoading, loadAll, navigate, secretary, setLanguage]);

  const saveAppointment = async () => {
    setSavingAppt(true);
    try {
      if (editingAppt) {
        const res = await secretaryFetch(`/regen-api/appointments/${editingAppt.id}`, {
          method: "PATCH", body: JSON.stringify(newAppt),
        });
        if (!res.ok) {
          toast({ title: t("operationError"), description: await responseError(res), variant: "destructive" });
          return;
        }
        toast({ title: t("appointmentUpdated") });
      } else {
        const res = await secretaryFetch("/regen-api/appointments", {
          method: "POST",
          body: JSON.stringify({ ...newAppt, patientId: Number(newAppt.patientId) }),
        });
        if (!res.ok) {
          toast({ title: t("operationError"), description: await responseError(res), variant: "destructive" });
          return;
        }
        toast({ title: t("appointmentScheduled") });
      }
      setShowApptDialog(false);
      setEditingAppt(null);
      resetAppt();
      await loadAll();
    } catch (error) {
      toast({
        title: t("operationError"),
        description: error instanceof Error ? error.message : t("verifyConnection"),
        variant: "destructive",
      });
    } finally { setSavingAppt(false); }
  };

  const [deletingAppointmentId, setDeletingAppointmentId] = useState<number | null>(null);

  const deleteAppointment = async (id: number) => {
    if (deletingAppointmentId !== null) return;
    setDeletingAppointmentId(id);
    try {
      const response = await secretaryFetch(`/regen-api/appointments/${id}`, { method: "DELETE" });
      if (!response.ok) {
        toast({ title: t("operationError"), description: await responseError(response), variant: "destructive" });
        return;
      }
      toast({ title: t("appointmentRemoved") });
      await Promise.all([loadAppointments(), loadRegenCases()]);
    } catch (error) {
      toast({ title: t("operationError"), description: error instanceof Error ? error.message : t("verifyConnection"), variant: "destructive" });
    } finally {
      setDeletingAppointmentId(null);
    }
  };

  const resetAppt = () => setNewAppt({ patientId: "", data: "", hora: "", tipo: "consulta", observacoes: "", status: "agendado" });

  const openScheduleSession = (regenCase: SecretaryRegenCase) => {
    if (regenCase.patientId === null) return;
    setEditingAppt(null);
    setNewAppt({
      patientId: String(regenCase.patientId),
      data: "",
      hora: "",
      tipo: REGEN_SESSION_TYPE,
      // The front desk never sees the diagnosis (LGPD minimization).
      observacoes: t("regenSessionNote"),
      status: "agendado",
    });
    setShowApptDialog(true);
  };

  const openEditAppt = (a: Appointment) => {
    setEditingAppt(a);
    setNewAppt({ patientId: String(a.patientId), data: a.data, hora: a.hora, tipo: a.tipo, observacoes: a.observacoes ?? "", status: a.status });
    setShowApptDialog(true);
  };

  const savePatient = async () => {
    if (!newPatient.nome.trim()) { toast({ title: t("nameRequired"), variant: "destructive" }); return; }
    setSavingPatient(true);
    try {
      const payload: Record<string, string> = { nome: newPatient.nome.trim() };
      const optionals: Array<keyof typeof newPatient> = ["cpf","telefone","email","dataNascimento","sexo","planoSaude","indicadoPor","endereco","cidade","estado","cep"];
      for (const k of optionals) {
        const value = newPatient[k].trim();
        if (value) payload[k] = value;
      }
      const res = await secretaryFetch("/regen-api/patients", { method: "POST", body: JSON.stringify(payload) });
      if (!res.ok) {
        toast({ title: t("operationError"), description: await responseError(res), variant: "destructive" });
        return;
      }
      toast({ title: t("patientRegistered") });
      setShowPatientDialog(false);
      setNewPatient({ nome: "", cpf: "", telefone: "", email: "", dataNascimento: "", sexo: "", planoSaude: "", indicadoPor: "", endereco: "", cidade: "", estado: "", cep: "" });
      loadAll();
    } catch (error) {
      toast({
        title: t("operationError"),
        description: error instanceof Error ? error.message : t("verifyConnection"),
        variant: "destructive",
      });
    } finally { setSavingPatient(false); }
  };

  const sortedPatients = sortByPtBrName(patients, (patient) => patient.nome, (patient) => patient.id);
  const filteredPatients = sortedPatients.filter(p => p.nome.toLowerCase().includes(patientSearch.toLowerCase()));
  // Same labels as the doctor's agenda (lib/appointment-types).
  const appointmentLabel = (value: string) => {
    const status = appointmentStatusLabel(value, locale);
    return status !== value ? status : appointmentTypeLabel(value, locale);
  };

  const todayStr = formatLocalDate();
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowStr = formatLocalDate(tomorrowDate);
  const upcomingAppts = appointments.filter(a => a.data >= todayStr && a.status !== "cancelado").sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora));

  function formatDayHeader(dateStr: string) {
    if (dateStr === todayStr) return t("today");
    if (dateStr === tomorrowStr) return t("tomorrow");
    return formatCalendarDate(dateStr, { weekday: "long", day: "numeric", month: "short" });
  }

  const apptsByDay = upcomingAppts.reduce((acc, a) => {
    (acc[a.data] = acc[a.data] ?? []).push(a);
    return acc;
  }, {} as Record<string, typeof upcomingAppts>);
  const urgentAlertCount = urgentRegenAlerts(alerts, todayStr).length;
  const caseStatusLabel = (status: string | null) => {
    if (status === "active") return t("caseActive");
    if (status === "draft") return t("caseDraft");
    if (status === "closed") return t("caseClosed");
    return status ?? "";
  };
  const alertKindLabel = (kind: SecretaryRegenAlert["kind"]) =>
    kind === "overdue" ? t("alertOverdue") : kind === "awaiting" ? t("alertAwaiting") : t("alertScheduled");

  if (authLoading) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">{t("loading")}</div>;
  }
  if (!secretary) return null;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header style={{ background: "linear-gradient(135deg, #0B1F4B 0%, #12306B 100%)" }} className="px-4 py-3 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <img
            src={`${import.meta.env.BASE_URL}logo-docregen-white.png`}
            alt="DocRegen" className="h-7 w-auto object-contain"
          />
          <div>
            <p className="text-white text-sm font-semibold leading-tight">{secretary.nome}</p>
            <p className="text-white/50 text-xs">{t("secretary")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={toggleTheme} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.1)" }}>
            {theme === "dark" ? <Sun className="h-4 w-4 text-white/80" /> : <Moon className="h-4 w-4 text-white/80" />}
          </button>
          <button onClick={logout} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.1)" }}>
            <LogOut className="h-4 w-4 text-white/80" />
          </button>
        </div>
      </header>

      {/* Tab bar */}
      <div className="flex overflow-x-auto border-b border-border bg-background sticky top-[56px] z-30">
        {([
          { key: "agenda", label: t("agenda"), Icon: CalendarDays, count: 0 },
          { key: "patients", label: t("patients"), Icon: Users, count: 0 },
          { key: "regen", label: t("regenTab"), Icon: FlaskConical, count: 0 },
          { key: "alerts", label: t("alertsTab"), Icon: Bell, count: urgentAlertCount },
        ] as const).map(({ key, label, Icon, count }) => (
          <button key={key} onClick={() => setTab(key)}
            className={cn("min-w-max flex-1 flex items-center justify-center gap-1.5 px-3 py-3 text-sm font-medium border-b-2 transition-colors relative",
              tab === key ? "border-primary text-primary" : "border-transparent text-muted-foreground"
            )}>
            <Icon className="h-4 w-4" />
            {label}
            {count > 0 && (
              <span className="ml-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      <main className="flex-1 p-4 max-w-2xl mx-auto w-full pb-8">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">{t("loading")}</div>
        ) : (
          <>
            {/* AGENDA */}
            {tab === "agenda" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold text-foreground">{t("agenda")}</h2>
                  <Button size="sm" onClick={() => { resetAppt(); setEditingAppt(null); setShowApptDialog(true); }} className="gap-1.5">
                    <Plus className="h-4 w-4" /> {t("schedule")}
                  </Button>
                </div>

                {loadErrors.appointments ? (
                  <SectionError message={loadErrors.appointments} onRetry={loadAppointments} retryLabel={t("tryAgain")} />
                ) : Object.keys(apptsByDay).length === 0 ? (
                  <Card><CardContent className="py-10 text-center text-muted-foreground text-sm">{t("noAppointments")}</CardContent></Card>
                ) : (
                  Object.entries(apptsByDay).map(([day, dayAppts]) => (
                    <div key={day} className="space-y-2">
                      <div className="flex items-center gap-2 pt-1">
                        <span className={cn(
                          "text-xs font-bold uppercase tracking-wide px-2 py-0.5 rounded-full",
                          day === todayStr ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                        )}>
                          {formatDayHeader(day)}
                        </span>
                        <div className="flex-1 h-px bg-border" />
                        <span className="text-xs text-muted-foreground">{t("appointmentCount", { count: dayAppts.length, suffix: dayAppts.length !== 1 ? "s" : "" })}</span>
                      </div>
                      {dayAppts.map(a => (
                        <Card key={a.id} className="shadow-sm">
                          <CardContent className="py-3 px-4">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-semibold text-sm text-foreground truncate">{a.patientNome ? formatPersonName(a.patientNome) : t("patient")}</span>
                                  <span className={cn("text-xs px-2 py-0.5 rounded-full border font-medium", statusColor(a.status))}>{appointmentLabel(a.status)}</span>
                                </div>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  {a.hora} · {appointmentLabel(a.tipo)}
                                </p>
                                {a.observacoes && <p className="text-xs text-muted-foreground mt-0.5 italic">{a.observacoes}</p>}
                              </div>
                              <div className="flex gap-1 shrink-0">
                                {a.patientTelefone && (
                                  <button
                                    onClick={() => openWaConfirm(a.patientTelefone!, a.patientNome ?? "paciente", a.data, a.hora, a.tipo)}
                                    className="w-8 h-8 rounded-full flex items-center justify-center bg-green-100 text-green-700 hover:bg-green-200"
                                    title={t("whatsappAppointmentTitle")}
                                  >
                                    <Phone className="h-3.5 w-3.5" />
                                  </button>
                                )}
                                <button onClick={() => openEditAppt(a)} className="w-8 h-8 rounded-full flex items-center justify-center bg-muted hover:bg-muted/80">
                                  <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                                </button>
                                <button disabled={deletingAppointmentId !== null} onClick={() => deleteAppointment(a.id)} className="w-8 h-8 rounded-full flex items-center justify-center bg-red-50 hover:bg-red-100 text-red-500 disabled:cursor-wait disabled:opacity-60">
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  ))
                )}
              </div>
            )}

            {/* PATIENTS */}
            {tab === "patients" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold text-foreground">{t("patients")}</h2>
                  <Button size="sm" onClick={() => setShowPatientDialog(true)} className="gap-1.5">
                    <Plus className="h-4 w-4" /> {t("new")}
                  </Button>
                </div>
                <Input placeholder={t("searchPatient")} value={patientSearch} onChange={e => setPatientSearch(e.target.value)} />
                {loadErrors.patients ? (
                  <SectionError message={loadErrors.patients} onRetry={loadPatients} retryLabel={t("tryAgain")} />
                ) : filteredPatients.length === 0 ? (
                  <Card><CardContent className="py-10 text-center text-muted-foreground text-sm">{t("noPatients")}</CardContent></Card>
                ) : (
                  filteredPatients.map(p => (
                    <Card key={p.id} className="shadow-sm">
                      <CardContent className="py-3 px-4 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold text-sm text-foreground truncate">{formatPersonName(p.nome)}</p>
                          <p className="text-xs text-muted-foreground">{p.telefone || p.email || t("noContact")}</p>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          {p.telefone && (
                            <>
                              <button
                                onClick={() => preparePreConsultWhatsApp(p)}
                                disabled={preConsultPatientId === p.id}
                                className="h-8 rounded-full flex items-center justify-center gap-1 bg-sky-100 px-2 text-sky-700 hover:bg-sky-200 disabled:cursor-wait disabled:opacity-60"
                                title={t("preConsultWhatsappTitle")}
                              >
                                <ClipboardList className="h-3.5 w-3.5" />
                                <span className="text-xs font-semibold">{t("preConsultation")}</span>
                              </button>
                              <button
                                onClick={() => setWaDialog({ phone: cleanPhone(p.telefone!), msg: t("greetingWhatsappMessage", { name: p.nome }), label: p.nome })}
                                className="w-8 h-8 rounded-full flex items-center justify-center bg-green-100 text-green-700 hover:bg-green-200"
                                title={t("whatsappMessageTitle")}
                              >
                                <Phone className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                          <button onClick={() => { setNewAppt(a => ({ ...a, patientId: String(p.id) })); resetAppt(); setNewAppt(v => ({ ...v, patientId: String(p.id) })); setEditingAppt(null); setShowApptDialog(true); }}
                            className="w-8 h-8 rounded-full flex items-center justify-center bg-muted hover:bg-muted/80">
                            <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                          </button>
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            )}

            {/* REGENERATIVE CASES (read-only) */}
            {tab === "regen" && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-lg font-bold text-foreground">{t("regenTitle")}</h2>
                  <p className="text-sm text-muted-foreground">{t("regenIntro")}</p>
                </div>
                {loadErrors.regen ? (
                  <SectionError message={loadErrors.regen} onRetry={loadRegenCases} retryLabel={t("tryAgain")} />
                ) : regenCases.length === 0 ? (
                  <Card><CardContent className="py-10 text-center text-muted-foreground text-sm">{t("noRegenCases")}</CardContent></Card>
                ) : (
                  regenCases.map(c => (
                    <Card key={c.id} className="shadow-sm">
                      <CardContent className="py-3 px-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-sm text-foreground truncate">{c.patientNome ? formatPersonName(c.patientNome) : t("patient")}</span>
                              {c.status && (
                                <span className="text-xs px-2 py-0.5 rounded-full border font-medium bg-teal-50 text-teal-800 border-teal-200 dark:bg-teal-950/40 dark:text-teal-200 dark:border-teal-900">
                                  {caseStatusLabel(c.status)}
                                </span>
                              )}
                            </div>
                            {c.dataCaso && (
                              <p className="text-xs text-muted-foreground mt-0.5">{formatCalendarDate(c.dataCaso)}</p>
                            )}
                            <p className="text-xs text-muted-foreground">{t("regenSessions", { count: c.procedureCount })}</p>
                            <p className="text-xs text-muted-foreground">
                              {c.nextSessionDate
                                ? t("regenNextSession", { date: formatCalendarDate(c.nextSessionDate), time: c.nextSessionTime ?? "" })
                                : t("regenNoSession")}
                            </p>
                            {c.nextFollowupDate && (
                              <p className="text-xs text-muted-foreground">
                                {t("regenNextFollowup", { date: formatCalendarDate(c.nextFollowupDate) })}
                              </p>
                            )}
                          </div>
                          <div className="flex gap-1 shrink-0">
                            {c.patientTelefone && (
                              <button
                                onClick={() => setWaDialog({ phone: cleanPhone(c.patientTelefone!), msg: t("greetingWhatsappMessage", { name: c.patientNome ?? "" }), label: c.patientNome ?? t("patient") })}
                                className="w-8 h-8 rounded-full flex items-center justify-center bg-green-100 text-green-700 hover:bg-green-200"
                                title={t("whatsappMessageTitle")}
                              >
                                <Phone className="h-3.5 w-3.5" />
                              </button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1"
                              disabled={c.patientId === null}
                              title={c.patientId === null ? t("regenNoPatientLink") : t("scheduleSession")}
                              onClick={() => openScheduleSession(c)}
                            >
                              <CalendarDays className="h-3.5 w-3.5" /> {t("scheduleSession")}
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            )}

            {/* REGENERATIVE FOLLOW-UP ALERTS */}
            {tab === "alerts" && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-lg font-bold text-foreground">{t("alertsTitle")}</h2>
                  <p className="text-sm text-muted-foreground">{t("alertsIntro")}</p>
                </div>
                {loadErrors.alerts ? (
                  <SectionError message={loadErrors.alerts} onRetry={loadAlerts} retryLabel={t("tryAgain")} />
                ) : alerts.length === 0 ? (
                  <Card><CardContent className="py-10 text-center text-muted-foreground text-sm flex flex-col items-center gap-2">
                    <CheckCircle2 className="h-8 w-8 text-green-500" />
                    <span>{t("noAlerts")}</span>
                  </CardContent></Card>
                ) : (
                  alerts.map(a => {
                    const days = daysUntil(a.scheduledDate, todayStr);
                    const isOverdue = a.kind === "overdue";
                    const isAwaiting = a.kind === "awaiting";
                    return (
                      <Card key={a.id} className={cn("shadow-sm border", isOverdue ? "border-red-300" : isAwaiting ? "border-amber-300" : "border-border")}>
                        <CardContent className="py-3 px-4">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                {isOverdue
                                  ? <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
                                  : isAwaiting
                                    ? <Clock className="h-4 w-4 text-amber-500 shrink-0" />
                                    : <Bell className="h-4 w-4 text-blue-500 shrink-0" />}
                                <span className="font-semibold text-sm text-foreground truncate">{a.patientNome ? formatPersonName(a.patientNome) : t("patient")}</span>
                                <span className={cn("text-[10px] font-bold uppercase tracking-wide", isOverdue ? "text-red-600" : isAwaiting ? "text-amber-600" : "text-blue-600")}>
                                  {alertKindLabel(a.kind)}
                                </span>
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {t("followupPeriod")}: <span className="font-medium text-foreground">{a.periodo}</span>
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {t("estimatedDate")} {formatCalendarDate(a.scheduledDate)}
                                {days !== null && days !== 0 && (
                                  <span className={cn("ml-2 font-semibold", days < 0 ? "text-red-500" : "text-blue-600")}>
                                    {days < 0 ? t("overdueDays", { days: Math.abs(days) }) : t("inDays", { days })}
                                  </span>
                                )}
                                {days === 0 && <span className="ml-2 font-semibold text-amber-600">{t("today")}</span>}
                              </p>
                            </div>
                            {a.patientTelefone && (
                              <button
                                onClick={() => setWaDialog({
                                  phone: cleanPhone(a.patientTelefone!),
                                  msg: t("regenAlertWhatsappMessage", { name: a.patientNome ?? "", period: a.periodo }),
                                  label: a.patientNome ?? t("patient"),
                                })}
                                className="flex items-center gap-1.5 bg-green-500 hover:bg-green-600 text-white text-xs font-semibold px-3 py-1.5 rounded-full shrink-0"
                              >
                                <Phone className="h-3 w-3" />
                                WhatsApp
                              </button>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })
                )}
              </div>
            )}

          </>
        )}
      </main>

      {/* Appointment Dialog */}
      <Dialog open={showApptDialog} onOpenChange={v => { setShowApptDialog(v); if (!v) setEditingAppt(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingAppt ? t("editAppointment") : t("newAppointment")}</DialogTitle>
            <DialogDescription className="sr-only">
              {editingAppt ? t("editAppointment") : t("newAppointment")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>{t("patient")} *</Label>
              <Select value={newAppt.patientId} onValueChange={v => setNewAppt(a => ({ ...a, patientId: v }))}>
                <SelectTrigger><SelectValue placeholder={t("selectPatient")} /></SelectTrigger>
                <SelectContent className="max-h-52">
                  {sortedPatients.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{t("date")} *</Label>
                <DateInput value={newAppt.data} onValueChange={(v) => setNewAppt(a => ({ ...a, data: v }))} />
              </div>
              <div className="space-y-1">
                <Label>{t("time")} *</Label>
                <TimeInput value={newAppt.hora} onValueChange={(v) => setNewAppt(a => ({ ...a, hora: v }))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>{t("type")}</Label>
              <Select value={newAppt.tipo} onValueChange={v => setNewAppt(a => ({ ...a, tipo: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {sortByPtBrName(selectableAppointmentTypes(editingAppt?.tipo), (tipo) => tipo).map(t => (
                    <SelectItem key={t} value={t}>{appointmentLabel(t)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t("status")}</Label>
              <Select value={newAppt.status} onValueChange={v => setNewAppt(a => ({ ...a, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {sortByPtBrName([...APPOINTMENT_STATUSES], (status) => status).map(s => (
                    <SelectItem key={s} value={s}>{appointmentLabel(s)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t("notes")}</Label>
              <Input placeholder={t("optional")} value={newAppt.observacoes} onChange={e => setNewAppt(a => ({ ...a, observacoes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowApptDialog(false)}>{t("cancel")}</Button>
            <Button onClick={saveAppointment} disabled={savingAppt || !newAppt.patientId || !newAppt.data || !newAppt.hora}>
              {savingAppt ? t("saving") : t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Patient Dialog */}
      <Dialog open={showPatientDialog} onOpenChange={setShowPatientDialog}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("registerPatient")}</DialogTitle>
            <DialogDescription className="sr-only">{t("registerPatient")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("identification")}</p>
            <div className="space-y-1">
              <Label>{t("fullName")} *</Label>
              <Input placeholder="João da Silva" value={newPatient.nome} onChange={e => setNewPatient(v => ({ ...v, nome: e.target.value }))} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>CPF</Label>
                <Input placeholder="000.000.000-00" value={newPatient.cpf} onChange={e => setNewPatient(v => ({ ...v, cpf: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>{t("birthDate")}</Label>
                <DateInput value={newPatient.dataNascimento} onValueChange={(val) => setNewPatient(p => ({ ...p, dataNascimento: val }))} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{t("phoneWhatsapp")}</Label>
                <Input placeholder="(11) 99999-9999" value={newPatient.telefone} onChange={e => setNewPatient(v => ({ ...v, telefone: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>{t("sex")}</Label>
                <Select value={newPatient.sexo} onValueChange={v => setNewPatient(p => ({ ...p, sexo: v }))}>
                  <SelectTrigger><SelectValue placeholder={t("selectPatient")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="M">{t("male")}</SelectItem>
                    <SelectItem value="F">{t("female")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>E-mail</Label>
              <Input type="email" placeholder="paciente@email.com" value={newPatient.email} onChange={e => setNewPatient(v => ({ ...v, email: e.target.value }))} />
            </div>

            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-1">{t("healthOrigin")}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{t("healthPlan")}</Label>
                <Input placeholder="Ex: Unimed" value={newPatient.planoSaude} onChange={e => setNewPatient(v => ({ ...v, planoSaude: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>{t("referredBy")}</Label>
                <Input placeholder="Ex: Dr. João Silva" value={newPatient.indicadoPor} onChange={e => setNewPatient(v => ({ ...v, indicadoPor: e.target.value }))} />
              </div>
            </div>

            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-1">{t("address")}</p>
            <div className="space-y-1">
              <Label>{t("address")}</Label>
              <Input placeholder="Rua, número, complemento" value={newPatient.endereco} onChange={e => setNewPatient(v => ({ ...v, endereco: e.target.value }))} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{t("city")}</Label>
                <Input placeholder="São Paulo" value={newPatient.cidade} onChange={e => setNewPatient(v => ({ ...v, cidade: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>CEP</Label>
                <Input placeholder="00000-000" value={newPatient.cep} onChange={e => setNewPatient(v => ({ ...v, cep: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPatientDialog(false)}>{t("cancel")}</Button>
            <Button onClick={savePatient} disabled={savingPatient}>
              {savingPatient ? t("saving") : t("register")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* WhatsApp Confirmation Dialog */}
      <Dialog open={!!waDialog} onOpenChange={v => { if (!v) setWaDialog(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-green-500 flex items-center justify-center shrink-0">
                <Phone className="h-3.5 w-3.5 text-white" />
              </div>
              {t("sendWhatsapp")}
            </DialogTitle>
            <DialogDescription className="sr-only">{t("sendWhatsapp")}</DialogDescription>
          </DialogHeader>
          {waDialog && (
            <div className="space-y-3 py-1">
              <p className="text-sm text-muted-foreground">
                {t("messageFor")} <span className="font-semibold text-foreground">{waDialog.label}</span>. {t("editBeforeSending")}
              </p>
              <Textarea
                rows={8}
                value={waDialog.msg}
                onChange={e => setWaDialog(d => d ? { ...d, msg: e.target.value } : null)}
                className="text-sm leading-relaxed resize-none font-mono"
              />
              <p className="text-[11px] text-muted-foreground">
                {t("whatsappNotice")}
              </p>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setWaDialog(null)}>{t("cancel")}</Button>
            {waDialog && (
              <a
                href={`https://wa.me/${waDialog.phone}?text=${encodeURIComponent(waDialog.msg)}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setWaDialog(null)}
              >
                <Button className="gap-2 bg-green-600 hover:bg-green-700 text-white">
                  <Send className="h-4 w-4" />
                  {t("sendOnWhatsapp")}
                </Button>
              </a>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
