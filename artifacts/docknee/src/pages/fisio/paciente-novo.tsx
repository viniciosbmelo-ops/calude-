import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { physioFetch } from "@/lib/physio-auth";
import FisioShell from "./shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { assessmentLabel } from "@/lib/rehab-assessments";
import { Trash2, Plus, CheckCircle2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { useScopedTranslations } from "@/lib/i18n";
import { physioMessages, usePhysioClinicalLabel } from "@/locales/physio";

interface ProtocolOption {
  id: number;
  code: string;
  name: string;
  startReference: "surgery_date" | "treatment_start";
}

interface FollowupPreview {
  phase: number | null;
  title: string;
  requiredAssessments: string[];
  dueDate: string;
}

export default function FisioPacienteNovo() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const t = useScopedTranslations(physioMessages);
  const clinicalLabel = usePhysioClinicalLabel();

  const { data: protocols } = useQuery<ProtocolOption[]>({
    queryKey: ["physio-protocols"],
    queryFn: async () => {
      const res = await physioFetch("/api/physio/protocols");
      if (!res.ok) throw new Error(t("protocolLoadError"));
      return res.json();
    },
  });

  const [fullName, setFullName] = useState("");
  const [cpf, setCpf] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [phone, setPhone] = useState("");
  const [diagnosisCode, setDiagnosisCode] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [startDate, setStartDate] = useState("");
  const [saving, setSaving] = useState(false);

  // Etapa de revisão do cronograma
  const [createdPatientId, setCreatedPatientId] = useState<number | null>(null);
  const [preview, setPreview] = useState<FollowupPreview[] | null>(null);
  const [originalPreview, setOriginalPreview] = useState<string>("");

  // Paywall (402): limite de 2 pacientes gratuitos atingido
  const [paywall, setPaywall] = useState<{ checkoutUrl: string | null; message: string } | null>(null);

  const selectedProtocol = protocols?.find((p) => p.code === diagnosisCode);
  const isKnee = Boolean(selectedProtocol);
  const isOutro = diagnosisCode === "outro";
  const dateLabel = selectedProtocol?.startReference === "treatment_start"
    ? t("treatmentStartDate")
    : t("surgeryDate");

  const canSubmit =
    fullName.trim().length >= 2 &&
    diagnosisCode !== "" &&
    (isOutro ? diagnosis.trim().length > 0 : startDate !== "");

  async function handleCreate() {
    if (!canSubmit || saving) return;
    setSaving(true);
    try {
      const res = await physioFetch("/api/physio/patients", {
        method: "POST",
        body: JSON.stringify({
          fullName: fullName.trim(),
          cpf: cpf.trim() || undefined,
          birthDate: birthDate || undefined,
          phone: phone.trim() || undefined,
          diagnosisCode,
          diagnosis: isOutro ? diagnosis.trim() : undefined,
          protocolStartDate: isKnee ? startDate : undefined,
        }),
      });
      const data = await res.json();
      if (res.status === 402) {
        setPaywall({
          checkoutUrl: data.checkoutUrl ?? null,
          message: data.message ?? t("subscribeAddPatients"),
        });
        return;
      }
      if (!res.ok) {
        toast.error(data.error ?? t("patientCreateError"));
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["physio-patients"] });
      if (data.followupsPreview) {
        setCreatedPatientId(data.patient.id);
        setPreview(data.followupsPreview);
        setOriginalPreview(JSON.stringify(data.followupsPreview));
      } else {
        toast.success(t("patientCreated"));
        navigate(`/fisio/pacientes/${data.patient.id}`);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirm() {
    if (!createdPatientId || !preview || preview.length === 0 || saving) return;
    setSaving(true);
    try {
      const customized = JSON.stringify(preview) !== originalPreview;
      const res = await physioFetch(`/api/physio/patients/${createdPatientId}/confirm-protocol`, {
        method: "POST",
        body: JSON.stringify({ followups: preview, customized }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? t("scheduleConfirmError"));
        return;
      }
      toast.success(t("scheduleConfirmed"));
      queryClient.invalidateQueries({ queryKey: ["physio-dashboard"] });
      navigate(`/fisio/pacientes/${createdPatientId}`);
    } finally {
      setSaving(false);
    }
  }

  function updatePreview(idx: number, patch: Partial<FollowupPreview>) {
    setPreview((prev) => prev!.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  }

  // ── Etapa 2: revisão do cronograma ────────────────────────────────────────
  if (preview && createdPatientId) {
    return (
      <FisioShell>
        <div className="space-y-5 max-w-3xl mx-auto">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{t("protocolReview")}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {t("protocolReviewHelp", { protocol: clinicalLabel(selectedProtocol?.name ?? "") })}
            </p>
          </div>

          <div className="space-y-2">
            {preview.map((f, idx) => (
              <Card key={idx}>
                <CardContent className="py-3 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1 space-y-1.5 min-w-0">
                    <Input
                      value={f.title}
                      onChange={(e) => updatePreview(idx, { title: e.target.value })}
                      className="text-sm font-medium"
                      data-testid={`preview-title-${idx}`}
                    />
                    <div className="flex flex-wrap gap-1">
                      {f.phase !== null && <Badge variant="outline">{t("phase", { phase: f.phase })}</Badge>}
                      {f.requiredAssessments.map((a) => (
                        <Badge key={a} variant="secondary" className="text-[10px]">{clinicalLabel(assessmentLabel(a))}</Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Input
                      type="date"
                      value={f.dueDate}
                      onChange={(e) => updatePreview(idx, { dueDate: e.target.value })}
                      className="w-40"
                      data-testid={`preview-date-${idx}`}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setPreview((prev) => prev!.filter((_, i) => i !== idx))}
                      className="text-muted-foreground hover:text-red-600"
                      data-testid={`preview-remove-${idx}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Button
            variant="outline"
            className="gap-1.5"
            onClick={() =>
              setPreview((prev) => [
                ...prev!,
                { phase: null, title: t("newFollowup"), requiredAssessments: [], dueDate: new Date().toISOString().slice(0, 10) },
              ])
            }
            data-testid="preview-add"
          >
            <Plus className="h-4 w-4" /> {t("addFollowup")}
          </Button>

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button
              onClick={handleConfirm}
              disabled={saving || preview.length === 0}
              className="gap-1.5"
              data-testid="button-confirmar-cronograma"
            >
              <CheckCircle2 className="h-4 w-4" />
              {saving ? t("confirming") : t("confirmSchedule")}
            </Button>
          </div>
        </div>
      </FisioShell>
    );
  }

  // ── Paywall: limite gratuito atingido ─────────────────────────────────────
  if (paywall) {
    return (
      <FisioShell>
        <div className="max-w-md mx-auto">
          <Card data-testid="card-paywall">
            <CardContent className="pt-6 space-y-4 text-center">
              <p className="text-base font-semibold text-foreground">{t("freeLimitReached")}</p>
              <p className="text-sm text-muted-foreground">{paywall.message}</p>
              {paywall.checkoutUrl ? (
                <Button
                  className="w-full bg-[#1FB6E1] hover:bg-[#199ec4] text-white"
                  onClick={() => { window.location.href = paywall.checkoutUrl!; }}
                  data-testid="button-paywall-checkout"
                >
                  {t("subscribeNow")}
                </Button>
              ) : (
                <Button className="w-full" onClick={() => navigate("/fisio/planos")}>{t("viewPlans")}</Button>
              )}
              <Button variant="ghost" className="w-full" onClick={() => navigate("/fisio/pacientes")}>
                {t("backPatients")}
              </Button>
            </CardContent>
          </Card>
        </div>
      </FisioShell>
    );
  }

  // ── Etapa 1: dados do paciente ────────────────────────────────────────────
  return (
    <FisioShell>
      <div className="space-y-5 max-w-2xl mx-auto">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate("/fisio/pacientes")} data-testid="button-voltar">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-2xl font-bold text-foreground">{t("newPatient")}</h1>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("patientData")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t("fullName")}</Label>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} data-testid="input-nome" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>CPF</Label>
                <Input value={cpf} onChange={(e) => setCpf(e.target.value)} data-testid="input-cpf" />
              </div>
              <div className="space-y-1.5">
                <Label>{t("birthDate")}</Label>
                <Input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} data-testid="input-nascimento" />
              </div>
              <div className="space-y-1.5">
                <Label>{t("mobilePlain")}</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} data-testid="input-celular" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>{t("diagnosisTreatment")}</Label>
              <Select value={diagnosisCode} onValueChange={setDiagnosisCode}>
                <SelectTrigger data-testid="select-diagnostico">
                  <SelectValue placeholder={t("selectDiagnosis")} />
                </SelectTrigger>
                <SelectContent>
                  {(protocols?.length ?? 0) > 0 && (
                    <>
                      <SelectGroup>
                        <SelectLabel>{t("protocolsGroup")}</SelectLabel>
                        {protocols?.map((p) => (
                          <SelectItem key={p.code} value={p.code}>{clinicalLabel(p.name)}</SelectItem>
                        ))}
                      </SelectGroup>
                      <SelectSeparator />
                    </>
                  )}
                  <SelectItem value="outro">{t("otherDescribe")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {isOutro && (
              <div className="space-y-1.5">
                <Label>{t("diagnosisRequired")}</Label>
                <Textarea
                  value={diagnosis}
                  onChange={(e) => setDiagnosis(e.target.value)}
                  placeholder={t("describeDiagnosis")}
                  data-testid="input-diagnostico-livre"
                />
                <p className="text-xs text-muted-foreground">
                  {t("noAutomaticProtocol")}
                </p>
              </div>
            )}

            {isKnee && (
              <div className="space-y-1.5">
                <Label>{dateLabel}</Label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} data-testid="input-data-inicio" />
              </div>
            )}

            <div className="flex justify-end pt-2">
              <Button onClick={handleCreate} disabled={!canSubmit || saving} data-testid="button-continuar">
                {saving ? t("saving") : isKnee ? t("continue") : t("save")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </FisioShell>
  );
}
