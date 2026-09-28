import { useState } from "react";
import { useLocation, useRoute } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { physioFetch } from "@/lib/physio-auth";
import FisioShell from "./shell";
import ProntuarioSection from "./prontuario";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ASSESSMENT_META, COMMON_FIELDS, RED_FLAG_LABELS, assessmentLabel, computedLabel, computedValueLabel, isControlledComputedValue, type AssessmentField,
} from "@/lib/rehab-assessments";
import { ArrowLeft, Plus, ClipboardList, Activity, AlertTriangle, CheckCircle2, CircleDashed } from "lucide-react";
import { toast } from "sonner";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { physioMessages, usePhysioClinicalLabel } from "@/locales/physio";

interface Patient {
  id: number;
  fullName: string;
  cpf: string | null;
  birthDate: string | null;
  phone: string | null;
  diagnosis: string | null;
  diagnosisCode: string;
  protocolId: number | null;
  protocolStartDate: string | null;
  protocolCustomized: boolean;
  status: string;
}

interface Followup {
  id: number;
  source: string;
  phase: number | null;
  title: string;
  requiredAssessments: string[] | null;
  dueDate: string;
  status: string;
  completedAt: string | null;
}

interface Assessment {
  id: number;
  phase: number | null;
  assessmentType: string;
  payload: Record<string, unknown>;
  computed: Record<string, unknown> | null;
  redFlags: string[] | null;
  createdAt: string;
}

interface Detail {
  patient: Patient;
  protocol: { id: number; code: string; name: string } | null;
  followups: Followup[];
  assessments: Assessment[];
}

export default function FisioPacienteDetalhe() {
  const [, navigate] = useLocation();
  const [, params] = useRoute("/fisio/pacientes/:id");
  const id = params?.id;
  const queryClient = useQueryClient();
  const { formatDate } = useLanguage();
  const t = useScopedTranslations(physioMessages);
  const clinicalLabel = usePhysioClinicalLabel();
  const statusLabel: Record<string, string> = { active: t("active"), discharged: t("discharged"), abandoned: t("abandoned") };
  const displayDate = (date: string) => formatDate(new Date(`${date.slice(0, 10)}T12:00:00`));

  const { data, isLoading } = useQuery<Detail>({
    queryKey: ["physio-patient", id],
    queryFn: async () => {
      const res = await physioFetch(`/api/physio/patients/${id}`);
      if (!res.ok) throw new Error(t("notFoundPatient"));
      return res.json();
    },
    enabled: Boolean(id),
  });

  const refetch = () => {
    queryClient.invalidateQueries({ queryKey: ["physio-patient", id] });
    queryClient.invalidateQueries({ queryKey: ["physio-dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["physio-patients"] });
  };

  // ── Follow-up manual ──────────────────────────────────────────────────────
  const [fuOpen, setFuOpen] = useState(false);
  const [fuTitle, setFuTitle] = useState("");
  const [fuDate, setFuDate] = useState("");
  const [fuAssessments, setFuAssessments] = useState<string[]>([]);
  const [fuSaving, setFuSaving] = useState(false);

  async function saveManualFollowup() {
    if (!fuTitle.trim() || !fuDate || fuSaving) return;
    setFuSaving(true);
    try {
      const res = await physioFetch(`/api/physio/patients/${id}/followups`, {
        method: "POST",
        body: JSON.stringify({ title: fuTitle.trim(), dueDate: fuDate, requiredAssessments: fuAssessments }),
      });
      const body = await res.json();
      if (!res.ok) { toast.error(body.error ?? t("followupCreateError")); return; }
      toast.success(t("followupCreated"));
      setFuOpen(false); setFuTitle(""); setFuDate(""); setFuAssessments([]);
      refetch();
    } finally {
      setFuSaving(false);
    }
  }

  async function setFollowupStatus(fid: number, status: string) {
    const res = await physioFetch(`/api/physio/followups/${fid}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    if (!res.ok) { toast.error(t("followupUpdateError")); return; }
    refetch();
  }

  // ── Nova avaliação ────────────────────────────────────────────────────────
  const [avOpen, setAvOpen] = useState(false);
  const [avType, setAvType] = useState("");
  const [avPhase, setAvPhase] = useState("");
  const [avValues, setAvValues] = useState<Record<string, unknown>>({});
  const [avSaving, setAvSaving] = useState(false);

  const avFields: AssessmentField[] = avType ? [...(ASSESSMENT_META[avType]?.fields ?? []), ...COMMON_FIELDS] : [];

  function setValue(key: string, value: unknown) {
    setAvValues((prev) => ({ ...prev, [key]: value }));
  }

  async function saveAssessment() {
    if (!avType || avSaving) return;
    const payload: Record<string, unknown> = {};
    for (const f of avFields) {
      const v = avValues[f.key];
      if (v === undefined || v === "" || v === null) {
        if (f.required) { toast.error(t("fillField", { field: clinicalLabel(f.label) })); return; }
        continue;
      }
      payload[f.key] = f.type === "number" ? Number(v) : v;
    }
    setAvSaving(true);
    try {
      const res = await physioFetch(`/api/physio/patients/${id}/assessments`, {
        method: "POST",
        body: JSON.stringify({
          assessmentType: avType,
          phase: avPhase ? Number(avPhase) : undefined,
          payload,
        }),
      });
      const body = await res.json();
      if (!res.ok) { toast.error(body.error ?? t("assessmentSaveError")); return; }
      if (body.completedFollowupIds?.length > 0) {
        toast.success(t("assessmentAutoCompleted", { count: body.completedFollowupIds.length }));
      } else {
        toast.success(t("assessmentSaved"));
      }
      setAvOpen(false); setAvType(""); setAvPhase(""); setAvValues({});
      refetch();
    } finally {
      setAvSaving(false);
    }
  }

  async function updateStatus(status: string) {
    const res = await physioFetch(`/api/physio/patients/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    if (!res.ok) { toast.error(t("statusUpdateError")); return; }
    refetch();
  }

  if (isLoading || !data) {
    return (
      <FisioShell>
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      </FisioShell>
    );
  }

  const { patient, protocol, followups, assessments } = data;
  const isOutro = patient.diagnosisCode === "outro";
  const pending = followups.filter((f) => f.status === "pending");
  const doneOrSkipped = followups.filter((f) => f.status !== "pending");
  const today = new Date().toISOString().slice(0, 10);

  return (
    <FisioShell>
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => navigate("/fisio/pacientes")} data-testid="button-voltar">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-foreground" data-testid="text-nome-paciente">{patient.fullName}</h1>
              <p className="text-sm text-muted-foreground">
                 {isOutro ? (patient.diagnosis ?? t("other")) : clinicalLabel(protocol?.name ?? "")}
                 {patient.protocolStartDate && ` • ${t("startPrefix", { date: displayDate(patient.protocolStartDate) })}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select value={patient.status} onValueChange={updateStatus}>
              <SelectTrigger className="w-32" data-testid="select-status-paciente">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                 {Object.entries(statusLabel).map(([v, l]) => (
                  <SelectItem key={v} value={v}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {/* Follow-up manual (qualquer paciente) */}
          <Dialog open={fuOpen} onOpenChange={setFuOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-1.5" data-testid="button-followup-manual">
                 <Plus className="h-4 w-4" /> {t("manualFollowup")}
              </Button>
            </DialogTrigger>
            <DialogContent>
               <DialogHeader><DialogTitle>{t("newManualFollowup")}</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="space-y-1.5">
                   <Label>{t("titleRequired")}</Label>
                  <Input value={fuTitle} onChange={(e) => setFuTitle(e.target.value)} data-testid="input-fu-titulo" />
                </div>
                <div className="space-y-1.5">
                   <Label>{t("dateRequired")}</Label>
                  <Input type="date" value={fuDate} onChange={(e) => setFuDate(e.target.value)} data-testid="input-fu-data" />
                </div>
                <div className="space-y-1.5">
                   <Label>{t("requiredAssessments")}</Label>
                  <div className="grid grid-cols-2 gap-1.5 max-h-44 overflow-y-auto pr-1">
                    {Object.entries(ASSESSMENT_META).map(([type, meta]) => (
                      <label key={type} className="flex items-center gap-2 text-xs text-foreground">
                        <Checkbox
                          checked={fuAssessments.includes(type)}
                          onCheckedChange={(c) =>
                            setFuAssessments((prev) => c ? [...prev, type] : prev.filter((t) => t !== type))
                          }
                        />
                         {clinicalLabel(meta.label)}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={saveManualFollowup} disabled={fuSaving || !fuTitle.trim() || !fuDate} data-testid="button-fu-salvar">
                   {fuSaving ? t("saving") : t("save")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Nova avaliação (somente pacientes com protocolo publicado) */}
          {!isOutro && (
            <Dialog open={avOpen} onOpenChange={setAvOpen}>
              <DialogTrigger asChild>
                <Button className="gap-1.5" data-testid="button-nova-avaliacao">
                   <Activity className="h-4 w-4" /> {t("newAssessment")}
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[85vh] overflow-y-auto">
                 <DialogHeader><DialogTitle>{t("registerAssessment")}</DialogTitle></DialogHeader>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                       <Label>{t("typeRequired")}</Label>
                      <Select value={avType} onValueChange={(v) => { setAvType(v); setAvValues({}); }}>
                         <SelectTrigger data-testid="select-tipo-avaliacao"><SelectValue placeholder={t("select")} /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(ASSESSMENT_META).map(([type, meta]) => (
                             <SelectItem key={type} value={type}>{clinicalLabel(meta.label)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                       <Label>{t("phaseLabel")}</Label>
                      <Select value={avPhase} onValueChange={(v) => setAvPhase(v === "__none__" ? "" : v)}>
                        <SelectTrigger data-testid="select-fase"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">—</SelectItem>
                          {[1, 2, 3, 4].map((p) => (
                             <SelectItem key={p} value={String(p)}>{t("phase", { phase: p })}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {avFields.map((f) => (
                    <div key={f.key} className="space-y-1.5">
                      {f.type === "boolean" ? (
                        <label className="flex items-center gap-2 text-sm text-foreground">
                          <Checkbox
                            checked={Boolean(avValues[f.key])}
                            onCheckedChange={(c) => setValue(f.key, Boolean(c))}
                          />
                           {clinicalLabel(f.label)}
                        </label>
                      ) : f.type === "select" ? (
                        <>
                           <Label>{clinicalLabel(f.label)}{f.required && " *"}</Label>
                          <Select
                            value={(avValues[f.key] as string) ?? ""}
                            onValueChange={(v) => setValue(f.key, v)}
                          >
                             <SelectTrigger data-testid={`campo-${f.key}`}><SelectValue placeholder={t("select")} /></SelectTrigger>
                            <SelectContent>
                              {f.options?.map((o) => (
                                 <SelectItem key={o.value} value={o.value}>{clinicalLabel(o.label)}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </>
                      ) : f.key === "observacoes" || f.key === "justificativa" ? (
                        <>
                           <Label>{clinicalLabel(f.label)}{f.required && " *"}</Label>
                          <Textarea
                            value={(avValues[f.key] as string) ?? ""}
                            onChange={(e) => setValue(f.key, e.target.value)}
                            data-testid={`campo-${f.key}`}
                          />
                        </>
                      ) : (
                        <>
                           <Label>{clinicalLabel(f.label)}{f.required && " *"}</Label>
                          <Input
                            type={f.type === "number" ? "number" : "text"}
                            step={f.step}
                            min={f.min}
                            max={f.max}
                            value={(avValues[f.key] as string) ?? ""}
                            onChange={(e) => setValue(f.key, e.target.value)}
                            data-testid={`campo-${f.key}`}
                          />
                        </>
                      )}
                    </div>
                  ))}
                </div>
                <DialogFooter>
                  <Button onClick={saveAssessment} disabled={avSaving || !avType} data-testid="button-av-salvar">
                     {avSaving ? t("saving") : t("register")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Follow-ups */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <ClipboardList className="h-4 w-4" style={{ color: "#1FB6E1" }} /> Follow-ups
                 {patient.protocolCustomized && <Badge variant="outline" className="text-[10px]">{t("customizedSchedule")}</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {followups.length === 0 && (
                 <p className="text-sm text-muted-foreground">{t("noFollowupsManual")}</p>
              )}
              {pending.map((f) => {
                const overdue = f.dueDate < today;
                return (
                  <div
                    key={f.id}
                    className={`rounded-lg border px-3 py-2 ${overdue ? "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/30" : "border-border"}`}
                    data-testid={`followup-${f.id}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{f.title}</p>
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {(f.requiredAssessments ?? []).map((a) => (
                             <Badge key={a} variant="secondary" className="text-[10px]">{clinicalLabel(assessmentLabel(a))}</Badge>
                          ))}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                         <Badge variant={overdue ? "destructive" : "secondary"}>{displayDate(f.dueDate)}</Badge>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setFollowupStatus(f.id, "done")}>
                             {t("complete")}
                          </Button>
                          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground" onClick={() => setFollowupStatus(f.id, "skipped")}>
                             {t("skip")}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {doneOrSkipped.map((f) => (
                <div key={f.id} className="rounded-lg border border-border px-3 py-2 opacity-60" data-testid={`followup-${f.id}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {f.status === "done"
                        ? <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                        : <CircleDashed className="h-4 w-4 text-muted-foreground shrink-0" />}
                      <p className="text-sm text-foreground truncate line-through decoration-muted-foreground/50">{f.title}</p>
                    </div>
                     <Badge variant="outline">{displayDate(f.dueDate)}</Badge>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Avaliações */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                 <Activity className="h-4 w-4" style={{ color: "#1FB6E1" }} /> {t("assessments")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {isOutro && (
                <p className="text-sm text-muted-foreground">
                   {t("structuredNotApplicable")}
                </p>
              )}
              {!isOutro && assessments.length === 0 && (
                 <p className="text-sm text-muted-foreground">{t("noAssessments")}</p>
              )}
              {!isOutro && assessments.map((a) => (
                <div key={a.id} className="rounded-lg border border-border px-3 py-2" data-testid={`assessment-${a.id}`}>
                  <div className="flex items-center justify-between gap-2">
                     <p className="text-sm font-medium text-foreground">{clinicalLabel(assessmentLabel(a.assessmentType))}</p>
                     <span className="text-xs text-muted-foreground">{displayDate(a.createdAt)}</span>
                  </div>
                  {a.computed && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {Object.entries(a.computed).map(([k, v]) => {
                        const value = computedValueLabel(k, v);
                        return `${clinicalLabel(computedLabel(k))}: ${isControlledComputedValue(k, v) ? clinicalLabel(value) : value}`;
                      }).join(" • ")}
                    </p>
                  )}
                  {a.redFlags && a.redFlags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {a.redFlags.map((rf) => (
                        <Badge key={rf} variant="destructive" className="text-[10px] gap-1">
                           <AlertTriangle className="h-3 w-3" /> {clinicalLabel(RED_FLAG_LABELS[rf] ?? rf)}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <ProntuarioSection patientId={String(id)} />
      </div>
    </FisioShell>
  );
}
