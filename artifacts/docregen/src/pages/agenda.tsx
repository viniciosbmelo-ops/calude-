import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { CalendarDays, Plus, Phone, Pencil, Trash2, User } from "lucide-react";
import { cn, formatLocalDate, sortByPtBrName } from "@/lib/utils";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { operationalAgendaMessages } from "@/locales/operational-agenda";
import { APPOINTMENT_STATUSES, selectableAppointmentTypes } from "@/lib/appointment-types";

type Appointment = {
  id: number; patientId: number; data: string; hora: string; tipo: string;
  observacoes: string | null; status: string; patientNome: string | null; patientTelefone: string | null;
};

type Patient = { id: number; nome: string };

function statusColor(status: string) {
  if (status === "agendado") return "bg-blue-100 text-blue-800 border-blue-200";
  if (status === "confirmado") return "bg-green-100 text-green-800 border-green-200";
  if (status === "cancelado") return "bg-red-100 text-red-800 border-red-200";
  if (status === "realizado") return "bg-gray-100 text-gray-700 border-gray-200";
  if (status === "faltou") return "bg-orange-100 text-orange-800 border-orange-200";
  return "bg-gray-100 text-gray-700";
}

function authHeaders() {
  return { "Content-Type": "application/json" };
}

function cleanPhone(phone: string) {
  const d = phone.replace(/\D/g, "");
  return d.startsWith("55") ? d : `55${d}`;
}

const todayStr = formatLocalDate();
const tomorrowDate = new Date();
tomorrowDate.setDate(tomorrowDate.getDate() + 1);
const tomorrowStr = formatLocalDate(tomorrowDate);

async function responseError(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { error?: string; message?: string };
    return payload.error ?? payload.message ?? `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

function fmtDay(d: string, locale: string, today: string, tomorrow: string) {
  if (d === todayStr) return today;
  if (d === tomorrowStr) return tomorrow;
  const [y, mo, day] = d.split("-").map(Number);
  const dt = new Date(y, mo - 1, day);
  return new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "short" }).format(dt);
}


export default function AgendaPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { locale } = useLanguage();
  const t = useScopedTranslations(operationalAgendaMessages);
  const appointmentTypeLabel: Record<string, string> = {
    consulta: t("typeConsulta"), retorno: t("typeRetorno"), "procedimento regenerativo": t("typeRegen"), "avaliação pré-op": t("typePreop"),
    "avaliação pós-op": t("typePostop"), curativo: t("typeCurativo"), outro: t("typeOutro"),
  };
  const appointmentStatusLabel: Record<string, string> = {
    agendado: t("statusAgendado"), confirmado: t("statusConfirmado"), cancelado: t("statusCancelado"),
    realizado: t("statusRealizado"), faltou: t("statusFaltou"),
  };

  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [form, setForm] = useState({ patientId: "", data: "", hora: "", tipo: "consulta", observacoes: "", status: "agendado" });
  const [filter, setFilter] = useState<"upcoming" | "all">("upcoming");

  const {
    data: appointments = [],
    isLoading,
    isError: appointmentsError,
    error: appointmentsQueryError,
    refetch: refetchAppointments,
  } = useQuery<Appointment[]>({
    queryKey: ["appointments"],
    queryFn: async () => {
      const res = await fetch("/api/appointments", { credentials: "same-origin", headers: authHeaders() });
      if (!res.ok) throw new Error(await responseError(res));
      return res.json();
    },
    staleTime: 30_000,
  });

  const { data: patients = [], isError: patientsError, error: patientsQueryError, refetch: refetchPatients } = useQuery<Patient[]>({
    queryKey: ["patients-list"],
    queryFn: async () => {
      const res = await fetch("/api/patients", { credentials: "same-origin", headers: authHeaders() });
      if (!res.ok) throw new Error(await responseError(res));
      const data = await res.json();
      return data.map((p: any) => ({ id: p.id, nome: p.nome }));
    },
  });

  const sortedPatients = sortByPtBrName(patients, (patient) => patient.nome, (patient) => patient.id);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const url = editing ? `/api/appointments/${editing.id}` : "/api/appointments";
      const method = editing ? "PATCH" : "POST";
      const body = editing
        ? { ...form }
        : { ...form, patientId: Number(form.patientId) };
      const res = await fetch(url, { method, credentials: "same-origin", headers: authHeaders(), body: JSON.stringify(body) });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? t("error")); }
    },
    onSuccess: () => {
      toast({ title: editing ? t("updated") : t("scheduled") });
      qc.invalidateQueries({ queryKey: ["appointments"] });
      closeDialog();
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/appointments/${id}`, { method: "DELETE", credentials: "same-origin", headers: authHeaders() });
      if (!response.ok) throw new Error(await responseError(response));
    },
    onSuccess: () => {
      toast({ title: t("removed") });
      qc.invalidateQueries({ queryKey: ["appointments"] });
    },
    onError: (error: Error) => toast({ title: error.message, variant: "destructive" }),
  });

  function openNew() {
    setEditing(null);
    setForm({ patientId: "", data: todayStr, hora: "", tipo: "consulta", observacoes: "", status: "agendado" });
    setShowDialog(true);
  }

  function openEdit(a: Appointment) {
    setEditing(a);
    setForm({ patientId: String(a.patientId), data: a.data, hora: a.hora, tipo: a.tipo, observacoes: a.observacoes ?? "", status: a.status });
    setShowDialog(true);
  }

  function closeDialog() {
    setShowDialog(false);
    setEditing(null);
  }

  const filtered = filter === "upcoming"
    ? appointments.filter(a => a.data >= todayStr && a.status !== "cancelado")
    : appointments;

  const sorted = [...filtered].sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora));
  const byDay = sorted.reduce((acc, a) => {
    (acc[a.data] = acc[a.data] ?? []).push(a);
    return acc;
  }, {} as Record<string, Appointment[]>);

  return (
    <div className="max-w-3xl mx-auto">
      {/* Mobile navy banner */}
      <div className="md:hidden" style={{ background: "linear-gradient(135deg, #0B1F4B 0%, #12306B 100%)" }}>
        <div className="px-4 pt-5 pb-5">
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#fff", margin: 0 }}>{t("appointments")}</h1>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", margin: "4px 0 0" }}>{t("subtitle")}</p>
        </div>
      </div>

      {/* Desktop header */}
      <div className="hidden md:flex items-center justify-between p-8 pb-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <CalendarDays className="h-7 w-7 text-primary" />
            {t("appointments")}
          </h1>
          <p className="text-muted-foreground mt-1">{t("subtitle")}</p>
        </div>
        <Button onClick={openNew} className="gap-2">
          <Plus className="h-4 w-4" /> {t("newAppointment")}
        </Button>
      </div>

      <div className="p-4 md:px-8 space-y-4 pb-8">
        {/* Actions row */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2 overflow-x-auto">
            <button
              onClick={() => setFilter("upcoming")}
              className={cn("px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors", filter === "upcoming" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground")}
            >
              {t("upcoming")}
            </button>
            <button
              onClick={() => setFilter("all")}
              className={cn("px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors", filter === "all" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground")}
            >
              {t("all")}
            </button>
          </div>
          <div className="md:hidden">
            <Button size="sm" onClick={openNew} className="gap-1.5">
              <Plus className="h-4 w-4" /> {t("schedule")}
            </Button>
          </div>
          <Link href="/secretary/dashboard" className="hidden md:block">
            <span className="text-xs font-semibold" style={{ color: "#0E9AA7" }}>{t("secretaryDashboard")}</span>
          </Link>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">{t("loading")}</div>
        ) : appointmentsError ? (
          <div className="rounded-2xl flex flex-col items-center justify-center py-12 gap-3 text-center"
            style={{ background: "rgba(239,68,68,0.04)", border: "1px solid rgba(239,68,68,0.2)" }}>
            <p className="text-sm text-muted-foreground">{appointmentsQueryError.message}</p>
            <Button variant="outline" size="sm" onClick={() => void refetchAppointments()}>{t("retry")}</Button>
          </div>
        ) : Object.keys(byDay).length === 0 ? (
          <div className="rounded-2xl flex flex-col items-center justify-center py-20 gap-3"
            style={{ background: "rgba(14,154,167,0.04)", border: "1px dashed rgba(14,154,167,0.25)" }}>
            <CalendarDays className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-muted-foreground text-sm">{t("empty")}</p>
            <Button variant="outline" size="sm" onClick={openNew} className="gap-1.5 mt-1">
              <Plus className="h-4 w-4" /> {t("create")}
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            {Object.entries(byDay).map(([day, appts]) => (
              <div key={day} className="space-y-2">
                {/* Day header */}
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "flex flex-col items-center justify-center rounded-xl px-3 py-1.5 min-w-[56px]",
                    day === todayStr ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                  )}>
                    <span className="text-[10px] font-bold uppercase tracking-wide leading-tight">
                      {day === todayStr ? t("today").toUpperCase() : day === tomorrowStr ? t("tomorrow").toUpperCase() : new Intl.DateTimeFormat(locale, { weekday: "short" }).format(new Date(day + "T12:00:00")).toUpperCase().replace(".", "")}
                    </span>
                    <span className="text-lg font-bold leading-tight">{day.split("-")[2]}</span>
                    <span className="text-[10px] leading-tight opacity-80">
                      {new Intl.DateTimeFormat(locale, { month: "short" }).format(new Date(day + "T12:00:00")).replace(".", "")}
                    </span>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-foreground">{fmtDay(day, locale, t("today"), t("tomorrow"))}</p>
                    <p className="text-xs text-muted-foreground">{appts.length} {appts.length === 1 ? t("appointment") : t("appointmentsCount")}</p>
                  </div>
                  <div className="h-px flex-1 max-w-[40%] bg-border" />
                </div>

                {/* Appointments for this day */}
                <div className="ml-[68px] space-y-2">
                  {appts.map(a => (
                    <Card key={a.id} className="shadow-sm hover:shadow-md transition-shadow">
                      <CardContent className="py-3 px-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-sm text-foreground">{a.patientNome ?? t("patient")}</span>
                              <Badge variant="outline" className={cn("text-xs border font-medium", statusColor(a.status))}>
                                {appointmentStatusLabel[a.status] ?? a.status}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              <span className="font-medium">{a.hora}</span> · <span>{appointmentTypeLabel[a.tipo] ?? a.tipo}</span>
                            </p>
                            {a.observacoes && (
                              <p className="text-xs text-muted-foreground mt-0.5 italic truncate max-w-xs">{a.observacoes}</p>
                            )}
                          </div>
                          <div className="flex gap-1 shrink-0 items-center">
                            {a.patientTelefone && (
                              <a href={`https://wa.me/${cleanPhone(a.patientTelefone)}`} target="_blank" rel="noopener noreferrer">
                                <button className="w-8 h-8 rounded-full flex items-center justify-center bg-green-100 text-green-700 hover:bg-green-200 transition-colors">
                                  <Phone className="h-3.5 w-3.5" />
                                </button>
                              </a>
                            )}
                            <Link href={`/patients/${a.patientId}`}>
                              <button className="w-8 h-8 rounded-full flex items-center justify-center bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
                                <User className="h-3.5 w-3.5" />
                              </button>
                            </Link>
                            <button onClick={() => openEdit(a)} className="w-8 h-8 rounded-full flex items-center justify-center bg-muted hover:bg-muted/80 transition-colors">
                              <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                            </button>
                            <button disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate(a.id)} className="w-8 h-8 rounded-full flex items-center justify-center bg-red-50 hover:bg-red-100 text-red-500 transition-colors disabled:cursor-wait disabled:opacity-60">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Appointment dialog */}
      <Dialog open={showDialog} onOpenChange={v => { if (!v) closeDialog(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? t("edit") : t("new")}</DialogTitle>
            <DialogDescription className="sr-only">{editing ? t("edit") : t("new")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {patientsError && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/30 p-3 text-sm text-muted-foreground">
                <span>{patientsQueryError.message}</span>
                <Button variant="outline" size="sm" onClick={() => void refetchPatients()}>{t("retry")}</Button>
              </div>
            )}
            <div className="space-y-1">
              <Label>{t("patient")} *</Label>
              <Select value={form.patientId} onValueChange={v => setForm(f => ({ ...f, patientId: v }))}>
                <SelectTrigger><SelectValue placeholder={t("selectPatient")} /></SelectTrigger>
                <SelectContent className="max-h-52">
                  {sortedPatients.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{t("date")} *</Label>
                <Input type="date" value={form.data} onChange={e => setForm(f => ({ ...f, data: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>{t("time")} *</Label>
                <Input type="time" value={form.hora} onChange={e => setForm(f => ({ ...f, hora: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>{t("type")}</Label>
              <Select value={form.tipo} onValueChange={v => setForm(f => ({ ...f, tipo: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {selectableAppointmentTypes(editing?.tipo).map(tipo => <SelectItem key={tipo} value={tipo}>{appointmentTypeLabel[tipo] ?? tipo}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t("status")}</Label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {APPOINTMENT_STATUSES.map(status => <SelectItem key={status} value={status}>{appointmentStatusLabel[status]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t("notes")}</Label>
              <Input placeholder={t("optional")} value={form.observacoes} onChange={e => setForm(f => ({ ...f, observacoes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>{t("cancel")}</Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !form.patientId || !form.data || !form.hora}
            >
              {saveMutation.isPending ? t("saving") : t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
