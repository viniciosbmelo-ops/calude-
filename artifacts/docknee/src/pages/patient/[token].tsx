import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { CheckCircle2, ChevronRight, Loader2, Lock, ClipboardList } from "lucide-react";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { patientQuestionnaireProgress, patientScaleList } from "@/lib/patient-questionnaire";
import { normalizeDoctorLocale, publicPatientFlowMessages, surgicalJointPhrase, surgicalOptionSpanish, surgicalScaleSpanish } from "@/locales/public-patient-flows";

// ─── Scale definitions ────────────────────────────────────────────────────────

type ScaleQuestion = {
  id: string;
  label: string;
  type: "radio" | "slider" | "select";
  options?: { label: string; value: number }[];
  min?: number;
  max?: number;
  step?: number;
};

type ScaleDef = {
  id: string;
  title: string;
  description: string;
  maxScore: number;
  questions: ScaleQuestion[];
  calcScore: (answers: Record<string, number>) => number;
};

export type JointRegion = "shoulder" | "elbow";

/** "{joint}" nos enunciados vira a articulação da cirurgia ("seu ombro"/"su codo"). */
function withJoint(label: string, locale: "pt-BR" | "es", region: JointRegion | null | undefined): string {
  const phrases = surgicalJointPhrase[locale === "es" ? "es" : "pt-BR"];
  return label.replace(/\{joint\}/g, phrases[region ?? "unknown"]);
}

export function displayScale(
  def: ScaleDef,
  locale: "pt-BR" | "es",
  region?: JointRegion | null,
): ScaleDef {
  if (locale !== "es") {
    return {
      ...def,
      questions: def.questions.map((question) => ({
        ...question,
        label: withJoint(question.label, locale, region),
      })),
    };
  }
  return {
    ...def,
    title: surgicalScaleSpanish[`${def.id}.title`] ?? def.title,
    description: surgicalScaleSpanish[`${def.id}.description`] ?? def.description,
    questions: def.questions.map((question) => ({
      ...question,
      label: withJoint(surgicalScaleSpanish[`${def.id}.${question.id}`] ?? question.label, locale, region),
      options: question.options?.map((option) => ({
        ...option,
        label: surgicalScaleSpanish[`${def.id}.${question.id}.${option.value}`] ?? surgicalOptionSpanish[option.label] ?? option.label,
      })),
    })),
  };
}

export const SCALES: Record<string, ScaleDef> = {
  "VAS Dor": {
    id: "VAS Dor",
    title: "Escala de Dor (VAS)",
    description: "Avalie a dor na região operada. Mova o controle deslizante para indicar o nível de dor.",
    maxScore: 10,
    questions: [
      {
        id: "vas",
        label: "Como você avalia hoje a dor na região operada? (0 = sem dor, 10 = pior dor imaginável)",
        type: "slider",
        min: 0,
        max: 10,
        step: 1,
      },
    ],
    calcScore: (a) => a["vas"] ?? 0,
  },
  // SANE: item único, inteiro 0–100 (% do normal), pontuado no servidor pelo
  // núcleo clínico (scoreSANE). O núcleo não traz enunciado para o paciente:
  // texto mínimo neutro, com a articulação da cirurgia no lugar de {joint}.
  "SANE": {
    id: "SANE",
    title: "SANE (Avaliação Numérica Única)",
    description: "Mova o controle deslizante para indicar a porcentagem.",
    maxScore: 100,
    questions: [
      {
        id: "sane",
        label: "Como você avalia {joint} hoje, em porcentagem do normal? (0 a 100%, sendo 100% totalmente normal)",
        type: "slider",
        min: 0,
        max: 100,
        step: 1,
      },
    ],
    calcScore: (a) => a["sane"] ?? 0,
  },
};

// ─── Types ────────────────────────────────────────────────────────────────────

type PatientInfo = {
  tempo: string;
  escalasEnviadas: string[];
  completedScales: string[];
  noScales?: boolean;
  doctorLocale?: "pt-BR" | "es";
  regiao?: JointRegion | null;
};

async function readJsonSafely(response: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await response.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? body as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

// ─── CPF Gate Screen ──────────────────────────────────────────────────────────

function CpfGate({ token, onVerified }: { token: string; onVerified: (info: PatientInfo) => void }) {
  const t = useScopedTranslations(publicPatientFlowMessages);
  const [cpf, setCpf] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const formatCpf = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 11);
    return digits
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/(\d{3})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3-$4");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cpf.trim()) { setError(t("enterCpf")); return; }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/patient/${token}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ cpf }),
      });
      const data = await readJsonSafely(res);
      if (!res.ok || !data.ok) {
        // API errors are authored by the server and may be in its default
        // language. Keep this public flow in the token owner's locale.
        setError(t("incorrectCpf"));
      } else {
        onVerified(data as unknown as PatientInfo);
      }
    } catch {
      setError(t("connectionError"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-primary/10 mb-2">
            <ClipboardList className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">DocSholder</h1>
          <p className="text-muted-foreground text-sm">{t("surgicalQuestionnaires")}</p>
        </div>

        <Card className="shadow-md border-border/60">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <Lock className="h-4 w-4 text-primary" />
              {t("accessProtected")}
            </CardTitle>
            <CardDescription>
              {t("cpfInstructions")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="cpf">{t("cpfLabel")}</Label>
                <Input
                  id="cpf"
                  placeholder="000.000.000-00"
                  value={cpf}
                  onChange={(e) => {
                    setCpf(formatCpf(e.target.value));
                    setError("");
                  }}
                  className={error ? "border-destructive" : ""}
                  autoComplete="off"
                  inputMode="numeric"
                />
                {error && <p className="text-xs text-destructive">{error}</p>}
              </div>
              <Button type="submit" className="w-full gap-2" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
                {loading ? t("verifying") : t("accessQuestionnaires")}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          {t("contactResponsible")}
        </p>
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function PatientScalesPage() {
  const params = useParams();
  const token = params.token || "";
  const { beginTemporaryDisplayLanguage, locale } = useLanguage();
  const t = useScopedTranslations(publicPatientFlowMessages);

  const [verified, setVerified] = useState(false);
  const [info, setInfo] = useState<PatientInfo | null>(null);
  const [localeReady, setLocaleReady] = useState(false);
  const [bootstrapInvalid, setBootstrapInvalid] = useState(false);
  const [bootstrapRegion, setBootstrapRegion] = useState<JointRegion | null>(null);

  const [currentScaleIdx, setCurrentScaleIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [completed, setCompleted] = useState<string[]>([]);
  const [allDone, setAllDone] = useState(false);

  // Bootstrap determines the locale from the doctor who owns this link. The
  // browser never supplies a locale to the API.
  useEffect(() => {
    if (!token) {
      setBootstrapInvalid(true);
      setLocaleReady(true);
      return;
    }
    let mounted = true;
    let releaseDisplayLanguage: (() => void) | undefined;

    void fetch(`/api/patient/${token}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("invalid-patient-token");
        return readJsonSafely(response);
      })
      .then((data) => {
        if (!mounted) return;
        if (data.doctorLocale !== "pt-BR" && data.doctorLocale !== "es") {
          throw new Error("invalid-patient-bootstrap");
        }
        releaseDisplayLanguage = beginTemporaryDisplayLanguage(data.doctorLocale);
        if (data.regiao === "shoulder" || data.regiao === "elbow") setBootstrapRegion(data.regiao);
        setLocaleReady(true);
      })
      .catch(() => {
        if (!mounted) return;
        setBootstrapInvalid(true);
        setLocaleReady(true);
      });

    return () => {
      mounted = false;
      releaseDisplayLanguage?.();
    };
  }, [beginTemporaryDisplayLanguage, token]);

  // Auto-initialize slider answers to 0 (min) when changing scales so the
  // submit button is not blocked by an "unanswered" slider that visually shows a value.
  useEffect(() => {
    if (!info) return;
    const scaleName = info.escalasEnviadas[currentScaleIdx];
    const def = SCALES[scaleName];
    if (!def) return;
    const init: Record<string, number> = {};
    def.questions.forEach(q => {
      if (q.type === "slider") init[q.id] = q.min ?? 0;
    });
    setAnswers(init);
    setSubmitError("");
  }, [currentScaleIdx, info]);

  // Skip to the next defined+pending scale whenever the current one is missing
  // from SCALES (unknown scale sent by doctor) to avoid an infinite render loop.
  useEffect(() => {
    if (!info) return;
    const scaleName = info.escalasEnviadas[currentScaleIdx];
    if (!scaleName) return;
    if (!SCALES[scaleName] && !completed.includes(scaleName)) {
      const next = info.escalasEnviadas.findIndex(
        (e, i) => i !== currentScaleIdx && !completed.includes(e) && SCALES[e]
      );
      if (next !== -1) setCurrentScaleIdx(next);
      else setAllDone(true);
    }
  }, [currentScaleIdx, completed, info]);

  const handleVerified = (data: PatientInfo) => {
    // Só as escalas enviadas ao paciente e exibíveis aqui; respostas de outras
    // escalas do follow-up (ex.: Constant do médico) não entram no progresso.
    const scales = patientScaleList(data.escalasEnviadas, (name) => Boolean(SCALES[name]));
    const progress = patientQuestionnaireProgress(scales, data.completedScales);
    setInfo({ ...data, escalasEnviadas: scales, completedScales: progress.completed });
    setCompleted(progress.completed);
    setCurrentScaleIdx(Math.max(0, progress.firstPendingIdx));
    if (progress.allDone) setAllDone(true);
    setVerified(true);
  };

  if (!localeReady) {
    const safeFallback = publicPatientFlowMessages["pt-BR"];
    return (
      <div className="min-h-screen flex items-center justify-center p-4" aria-busy="true">
        <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {safeFallback.loadingQuestionnaires}
        </div>
      </div>
    );
  }

  if (bootstrapInvalid) {
    const safeFallback = publicPatientFlowMessages["pt-BR"];
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center space-y-2">
            <p className="text-destructive font-medium">{safeFallback.invalidLink}</p>
            <p className="text-sm text-muted-foreground">{safeFallback.invalidLinkContactDoctor}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!verified) {
    return <CpfGate token={token} onVerified={handleVerified} />;
  }

  // Verified but no scales configured yet
  if (info?.noScales || (info?.escalasEnviadas?.length === 0)) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex items-center justify-center p-4">
        <Card className="max-w-md w-full shadow-md">
          <CardContent className="pt-10 pb-8 space-y-4 text-center">
            <div className="flex justify-center">
              <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center">
                <ClipboardList className="h-8 w-8 text-amber-500" />
              </div>
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">{t("accessProtected")}</h2>
              <p className="text-sm text-muted-foreground mt-2">
                {t("questionnairesPreparing")}
                <br />
                {t("waitAndAccessAgain")}
              </p>
            </div>
            <p className="text-xs text-muted-foreground pt-2">
              {t("contactOffice")}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!info) return null;

  const pendingScales = info.escalasEnviadas.filter(e => !completed.includes(e));
  const currentScaleName = info.escalasEnviadas[currentScaleIdx];
  const currentScaleDef = SCALES[currentScaleName];
  const currentDisplayScaleDef = currentScaleDef && displayScale(currentScaleDef, locale, info.regiao ?? bootstrapRegion);

  const handleAnswerChange = (questionId: string, value: number) => {
    setAnswers(prev => ({ ...prev, [questionId]: value }));
  };

  const isCurrentScaleComplete = () => {
    if (!currentScaleDef) return false;
    return currentScaleDef.questions.every(q => answers[q.id] !== undefined);
  };

  const handleSubmitScale = async () => {
    if (!currentScaleDef || !isCurrentScaleComplete()) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const score = currentScaleDef.calcScore(answers);
      const res = await fetch(`/api/patient/${token}/scale/${encodeURIComponent(currentScaleName)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ respostas: answers, score }),
      });
      const data = await readJsonSafely(res);
      if (!res.ok || data.ok !== true) {
        // Do not surface a server-authored fallback that can be Portuguese
        // for a Spanish token owner.
        setSubmitError(t("submitAnswersError"));
        return;
      }
      if (data.ok === true) {
        const progress = patientQuestionnaireProgress(
          info.escalasEnviadas,
          [...completed, currentScaleName],
        );
        setCompleted(progress.completed);
        setAnswers({});
        if (data.allCompleted === true || progress.allDone) {
          setAllDone(true);
        } else if (progress.firstPendingIdx !== -1) {
          setCurrentScaleIdx(progress.firstPendingIdx);
        }
      }
    } catch {
      setSubmitError(t("internetConnectionError"));
    } finally {
      setSubmitting(false);
    }
  };

  const progressSummary = patientQuestionnaireProgress(info.escalasEnviadas, completed);
  const completedCount = progressSummary.completed.length;
  const totalCount = progressSummary.scales.length;
  const progressPct = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  if (allDone) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-green-50 to-white flex items-center justify-center p-4">
        <Card className="max-w-md w-full text-center shadow-md">
          <CardContent className="pt-10 pb-8 space-y-4">
            <div className="flex justify-center">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8 text-green-600" />
              </div>
            </div>
            <div>
              <h2 className="text-xl font-bold text-green-700">{t("completed")}</h2>
              <p className="text-muted-foreground mt-1 text-sm whitespace-pre-line">
                {t("completionDescription", { total: totalCount, plural: totalCount !== 1 ? "s" : "" })}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!currentScaleDef || !currentDisplayScaleDef || completed.includes(currentScaleName)) {
    const nextIdx = info.escalasEnviadas.findIndex(e => !completed.includes(e));
    if (nextIdx !== -1) {
      setCurrentScaleIdx(nextIdx);
      return null;
    }
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      <div className="max-w-2xl mx-auto p-4 space-y-4 pb-16">
        {/* Header */}
        <div className="pt-6 text-center space-y-1">
          <h1 className="text-xl font-bold text-foreground">DocSholder</h1>
        </div>

        {/* Progress */}
        <Card className="shadow-sm">
          <CardContent className="py-3 px-4">
            <div className="flex justify-between text-xs text-muted-foreground mb-2">
              <span>{t("progress")}</span>
              <span>{t("scalesProgress", { completed: completedCount, total: totalCount })}</span>
            </div>
            <Progress
              value={progressPct}
              className="h-2"
              aria-label={t("scalesProgress", { completed: completedCount, total: totalCount })}
              aria-valuetext={t("scalesProgress", { completed: completedCount, total: totalCount })}
            />
            <div className="flex flex-wrap gap-1 mt-2">
              {info.escalasEnviadas.map(name => {
                const scale = SCALES[name];
                const displayName = scale ? displayScale(scale, locale).title : name;
                return (
                  <span
                    key={name}
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      completed.includes(name)
                        ? "bg-green-100 text-green-700"
                        : name === currentScaleName
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {displayName}
                  </span>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Current Scale */}
        <Card className="shadow-md">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">{currentDisplayScaleDef.title}</CardTitle>
              <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded-full">
                {t("scalePosition", { current: currentScaleIdx + 1, total: totalCount })}
              </span>
            </div>
            <CardDescription>{currentDisplayScaleDef.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {currentDisplayScaleDef.questions.map((question) => (
              <div key={question.id} className="space-y-3">
                <p className="text-sm font-medium leading-relaxed">{question.label}</p>

                {question.type === "radio" && question.options && (
                  <div className="space-y-2">
                    {question.options.map((option) => (
                      <label
                        key={option.value}
                        className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                          answers[question.id] === option.value
                            ? "bg-primary/10 border-primary"
                            : "bg-background border-border hover:bg-muted/50"
                        }`}
                      >
                        <input
                          type="radio"
                          name={question.id}
                          value={option.value}
                          checked={answers[question.id] === option.value}
                          onChange={() => handleAnswerChange(question.id, option.value)}
                          className="mt-0.5 shrink-0"
                        />
                        <span className="text-sm">{option.label}</span>
                      </label>
                    ))}
                  </div>
                )}

                {question.type === "slider" && (
                  <div className="space-y-3">
                    <div className="flex justify-between text-xs text-muted-foreground px-1">
                      <span>{question.min ?? 0}</span>
                      <span className="text-base font-bold text-primary">
                        {answers[question.id] ?? Math.round(((question.max ?? 10) - (question.min ?? 0)) / 2)}
                      </span>
                      <span>{question.max ?? 10}</span>
                    </div>
                    <Slider
                      min={question.min ?? 0}
                      max={question.max ?? 10}
                      step={question.step ?? 1}
                      value={[answers[question.id] ?? Math.round(((question.max ?? 10) - (question.min ?? 0)) / 2)]}
                      onValueChange={(vals) => handleAnswerChange(question.id, vals[0])}
                      className="w-full"
                      aria-label={question.label}
                    />
                  </div>
                )}
              </div>
            ))}

            <div className="pt-4 border-t space-y-2">
              {submitError && (
                <p className="text-center text-xs text-destructive font-medium">{submitError}</p>
              )}
              <Button
                onClick={handleSubmitScale}
                disabled={!isCurrentScaleComplete() || submitting}
                className="w-full gap-2"
                size="lg"
              >
                {submitting
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("sending")}</>
                  : pendingScales.length > 1
                  ? <><ChevronRight className="h-4 w-4" /> {t("next")}</>
                  : <><CheckCircle2 className="h-4 w-4" /> {t("finish")}</>
                }
              </Button>
              {!isCurrentScaleComplete() && (
                <p className="text-center text-xs text-muted-foreground mt-2">
                  {t("answerAllQuestions")}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
