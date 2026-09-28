import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { physioFetch } from "@/lib/physio-auth";
import FisioShell from "./shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Plus, CalendarDays, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { sortByPtBrName } from "@/lib/utils";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { physioMessages } from "@/locales/physio";

interface Appointment {
  id: number;
  physioPatientId: number | null;
  startsAt: string;
  endsAt: string;
  appointmentType: string;
  status: string;
  notes: string | null;
  patientName: string | null;
}

interface PatientOption {
  id: number;
  fullName: string;
}

const TYPE_COLORS: Record<string, string> = {
  sessao: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300 border-sky-300 dark:border-sky-800",
  avaliacao: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800",
  reavaliacao: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border-amber-300 dark:border-amber-800",
  bloqueio: "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 border-zinc-300 dark:border-zinc-700",
};

function startOfWeek(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  r.setDate(r.getDate() - r.getDay());
  return r;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function FisioAgenda() {
  const queryClient = useQueryClient();
  const { locale } = useLanguage();
  const t = useScopedTranslations(physioMessages);
  const typeLabels: Record<string, string> = { sessao: t("session"), avaliacao: t("assessment"), reavaliacao: t("reassessment"), bloqueio: t("block") };
  const statusLabels: Record<string, string> = { scheduled: t("scheduled"), done: t("completed"), no_show: t("noShow"), canceled: t("canceled") };
  const [view, setView] = useState<"semana" | "dia">("semana");
  const [anchor, setAnchor] = useState(() => new Date());

  const rangeStart = view === "semana" ? startOfWeek(anchor) : (() => { const d = new Date(anchor); d.setHours(0, 0, 0, 0); return d; })();
  const rangeEnd = addDays(rangeStart, view === "semana" ? 7 : 1);

  const { data: appointments = [], isLoading } = useQuery<Appointment[]>({
    queryKey: ["physio-agenda", rangeStart.toISOString(), rangeEnd.toISOString()],
    queryFn: async () => {
      const res = await physioFetch(`/api/physio/appointments?from=${encodeURIComponent(rangeStart.toISOString())}&to=${encodeURIComponent(rangeEnd.toISOString())}`);
      if (!res.ok) throw new Error(t("appointmentSaveError"));
      return res.json();
    },
  });

  const { data: patients = [] } = useQuery<PatientOption[]>({
    queryKey: ["physio-patients-options"],
    queryFn: async () => {
      const res = await physioFetch("/api/physio/patients");
      if (!res.ok) return [];
      const body = await res.json();
      const list = Array.isArray(body) ? body : body.patients ?? [];
      return list.map((p: { id: number; fullName: string }) => ({ id: p.id, fullName: p.fullName }));
    },
  });
  const sortedPatients = sortByPtBrName(patients, (patient) => patient.fullName, (patient) => patient.id);

  const refetch = () => queryClient.invalidateQueries({ queryKey: ["physio-agenda"] });

  const byDay = useMemo(() => {
    const map: Record<string, Appointment[]> = {};
    for (const a of appointments) {
      const k = dayKey(new Date(a.startsAt));
      (map[k] ??= []).push(a);
    }
    for (const k of Object.keys(map)) map[k].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    return map;
  }, [appointments]);

  // ── Dialog de criação/edição ──────────────────────────────────────────────
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [fType, setFType] = useState("sessao");
  const [fPatient, setFPatient] = useState("");
  const [fStart, setFStart] = useState("");
  const [fEnd, setFEnd] = useState("");
  const [fStatus, setFStatus] = useState("scheduled");
  const [fNotes, setFNotes] = useState("");
  const [saving, setSaving] = useState(false);

  function openNew(day?: Date) {
    const base = day ?? new Date();
    const start = new Date(base);
    start.setHours(9, 0, 0, 0);
    const end = new Date(start);
    end.setHours(10, 0, 0, 0);
    setEditing(null);
    setFType("sessao");
    setFPatient("");
    setFStart(toLocalInputValue(start.toISOString()));
    setFEnd(toLocalInputValue(end.toISOString()));
    setFStatus("scheduled");
    setFNotes("");
    setOpen(true);
  }

  function openEdit(a: Appointment) {
    setEditing(a);
    setFType(a.appointmentType);
    setFPatient(a.physioPatientId ? String(a.physioPatientId) : "");
    setFStart(toLocalInputValue(a.startsAt));
    setFEnd(toLocalInputValue(a.endsAt));
    setFStatus(a.status);
    setFNotes(a.notes ?? "");
    setOpen(true);
  }

  async function save() {
    if (saving) return;
    if (!fStart || !fEnd) { toast.error(t("appointmentTimesRequired")); return; }
    if (fType !== "bloqueio" && !fPatient) { toast.error(t("patientRequired")); return; }
    setSaving(true);
    try {
      const payload = {
        physioPatientId: fType === "bloqueio" ? null : Number(fPatient),
        startsAt: new Date(fStart).toISOString(),
        endsAt: new Date(fEnd).toISOString(),
        appointmentType: fType,
        notes: fNotes || undefined,
        ...(editing ? { status: fStatus } : {}),
      };
      const res = editing
        ? await physioFetch(`/api/physio/appointments/${editing.id}`, { method: "PUT", body: JSON.stringify(payload) })
        : await physioFetch("/api/physio/appointments", { method: "POST", body: JSON.stringify(payload) });
      const body = await res.json();
      if (!res.ok) { toast.error(body.error ?? t("appointmentSaveError")); return; }
      toast.success(editing ? t("appointmentUpdated") : t("appointmentCreated"));
      setOpen(false);
      refetch();
    } finally {
      setSaving(false);
    }
  }

  async function removeAppointment() {
    if (!editing) return;
    if (!confirm(t("deleteAppointment"))) return;
    const res = await physioFetch(`/api/physio/appointments/${editing.id}`, { method: "DELETE" });
    if (!res.ok) { toast.error(t("appointmentDeleteError")); return; }
    toast.success(t("appointmentDeleted"));
    setOpen(false);
    refetch();
  }

  const days = view === "semana"
    ? Array.from({ length: 7 }, (_, i) => addDays(rangeStart, i))
    : [rangeStart];

  const todayKey = dayKey(new Date());
  const rangeLabel = view === "semana"
    ? `${rangeStart.toLocaleDateString(locale)} – ${addDays(rangeStart, 6).toLocaleDateString(locale)}`
    : rangeStart.toLocaleDateString(locale, { weekday: "long", day: "2-digit", month: "long" });

  return (
    <FisioShell>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <CalendarDays className="h-6 w-6" style={{ color: "#1FB6E1" }} /> {t("agenda")}
          </h1>
          <Button className="gap-1.5" onClick={() => openNew()} data-testid="button-novo-agendamento">
            <Plus className="h-4 w-4" /> {t("appointment")}
          </Button>
        </div>

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setAnchor(addDays(anchor, view === "semana" ? -7 : -1))} data-testid="button-agenda-anterior">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" className="h-8" onClick={() => setAnchor(new Date())} data-testid="button-agenda-hoje">
              {t("today")}
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setAnchor(addDays(anchor, view === "semana" ? 7 : 1))} data-testid="button-agenda-proximo">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <span className="text-sm text-muted-foreground ml-2 capitalize">{rangeLabel}</span>
          </div>
          <div className="flex gap-1">
            <Button variant={view === "semana" ? "secondary" : "ghost"} size="sm" onClick={() => setView("semana")} data-testid="button-visao-semana">
              {t("week")}
            </Button>
            <Button variant={view === "dia" ? "secondary" : "ghost"} size="sm" onClick={() => setView("dia")} data-testid="button-visao-dia">
              {t("day")}
            </Button>
          </div>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t("loading")}</p>
        ) : (
          <div className={view === "semana" ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2" : "grid grid-cols-1 gap-2"}>
            {days.map((day) => {
              const k = dayKey(day);
              const items = byDay[k] ?? [];
              return (
                <Card key={k} className={k === todayKey ? "border-sky-400 dark:border-sky-700" : ""}>
                  <CardContent className="p-2 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <p className={`text-xs font-semibold ${k === todayKey ? "text-sky-600 dark:text-sky-400" : "text-muted-foreground"}`}>
                        {day.toLocaleDateString(locale, { weekday: "short", day: "2-digit", month: "2-digit" })}
                      </p>
                      <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => openNew(day)} data-testid={`button-agendar-${k}`}>
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                    {items.length === 0 && <p className="text-[11px] text-muted-foreground/60">—</p>}
                    {items.map((a) => (
                      <button
                        key={a.id}
                        onClick={() => openEdit(a)}
                        className={`w-full text-left rounded border px-1.5 py-1 text-[11px] leading-tight ${TYPE_COLORS[a.appointmentType] ?? ""} ${a.status === "canceled" ? "opacity-40 line-through" : ""}`}
                        data-testid={`agendamento-${a.id}`}
                      >
                        <span className="font-semibold">{fmtTime(a.startsAt)}–{fmtTime(a.endsAt)}</span>{" "}
                        {a.appointmentType === "bloqueio" ? t("block") : (a.patientName ?? t("patient"))}
                        {view === "dia" && (
                          <span className="block text-[10px] opacity-75">
                            {typeLabels[a.appointmentType]} • {statusLabels[a.status]}
                            {a.notes ? ` • ${a.notes}` : ""}
                          </span>
                        )}
                      </button>
                    ))}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? t("editAppointment") : t("newAppointment")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t("type")}</Label>
              <Select value={fType} onValueChange={(v) => { setFType(v); if (v === "bloqueio") setFPatient(""); }}>
                <SelectTrigger data-testid="select-tipo-agendamento"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {sortByPtBrName(Object.entries(typeLabels), ([, label]) => label, ([value]) => value).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {fType !== "bloqueio" && (
              <div className="space-y-1.5">
                <Label>{t("patient")} *</Label>
                <Select value={fPatient} onValueChange={setFPatient}>
                  <SelectTrigger data-testid="select-paciente-agendamento"><SelectValue placeholder={t("select")} /></SelectTrigger>
                  <SelectContent>
                    {sortedPatients.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>{p.fullName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t("start")}</Label>
                <Input type="datetime-local" value={fStart} onChange={(e) => setFStart(e.target.value)} data-testid="input-inicio" />
              </div>
              <div className="space-y-1.5">
                <Label>{t("end")}</Label>
                <Input type="datetime-local" value={fEnd} onChange={(e) => setFEnd(e.target.value)} data-testid="input-termino" />
              </div>
            </div>
            {editing && (
              <div className="space-y-1.5">
                <Label>{t("status")}</Label>
                <Select value={fStatus} onValueChange={setFStatus}>
                  <SelectTrigger data-testid="select-status-agendamento"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {sortByPtBrName(Object.entries(statusLabels), ([, label]) => label, ([value]) => value).map(([v, l]) => (
                      <SelectItem key={v} value={v}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>{t("notes")}</Label>
              <Textarea value={fNotes} onChange={(e) => setFNotes(e.target.value)} data-testid="input-obs-agendamento" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            {editing && (
              <Button variant="ghost" className="gap-1.5 text-destructive mr-auto" onClick={removeAppointment} data-testid="button-excluir-agendamento">
                <Trash2 className="h-4 w-4" /> {t("delete")}
              </Button>
            )}
            <Button onClick={save} disabled={saving} data-testid="button-agendamento-salvar">
              {saving ? t("saving") : t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </FisioShell>
  );
}
