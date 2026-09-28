/**
 * Public page for Regen patients to complete PROMs from a doctor's link.
 * Route: /patient/regen/:token
 * Verification: linked patient's CPF
 */
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
import { normalizeDoctorLocale, publicPatientFlowMessages } from "@/locales/public-patient-flows";
import { getRegenScales, type RegenScaleDef } from "@/locales/regen-questionnaire";
import { publicRegenFallbackLocale, publicRegenServerError } from "./regen-public-flow";

/*
 * All questionnaire copy is authored in regen-questionnaire.ts. The clinical
 * scale name, question id and option value deliberately remain unchanged,
 * because they are persisted in the response payload.
 */
/*
const SCALES: Record<string, ScaleDef> = {
  "VAS Dor": {
    id: "VAS Dor",
    title: "Escala de Dor (VAS)",
    description: "Avalie a dor na região tratada. Mova o controle deslizante para indicar o nível de dor.",
    maxScore: 10,
    questions: [
      { id: "vas", label: "Como você avalia hoje a dor na região tratada? (0 = sem dor, 10 = pior dor imaginável)", type: "slider", min: 0, max: 10, step: 1 },
    ],
    calcScore: (a) => a["vas"] ?? 0,
  },
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

// ─── CPF Gate ──────────────────────────────────────────────────────────────────

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
      const res = await fetch(`/api/patient/regen/${token}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ cpf }),
      });
      const data = await readJsonSafely(res);
      if (!res.ok || !data.ok) {
        setError(publicRegenServerError(data, t("incorrectCpf")));
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
          <p className="text-muted-foreground text-sm">{t("orthobiologicQuestionnaires")}</p>
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
                  onChange={(e) => { setCpf(formatCpf(e.target.value)); setError(""); }}
                  className={error ? "border-destructive" : ""}
                  autoComplete="off"
                  inputMode="numeric"
                  maxLength={14}
                />
                 {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
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

// ─── Scale Questionnaire ───────────────────────────────────────────────────────

function ScaleForm({
  scaleDef,
  answers,
  onChange,
}: {
  scaleDef: RegenScaleDef;
  answers: Record<string, number>;
  onChange: (id: string, value: number) => void;
}) {
  return (
    <div className="space-y-6">
      {scaleDef.questions.map((q) => (
        <div key={q.id} className="space-y-3">
          <p className="text-sm font-medium text-foreground">{q.label}</p>
          {q.type === "slider" && (
            <div className="space-y-2">
              <Slider
                min={q.min ?? 0}
                max={q.max ?? 10}
                step={q.step ?? 1}
                value={[answers[q.id] ?? Math.floor(((q.min ?? 0) + (q.max ?? 10)) / 2)]}
                onValueChange={([v]) => onChange(q.id, v)}
                className="w-full"
                aria-label={q.label}
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{q.min ?? 0}</span>
                 <span className="font-bold text-primary" aria-live="polite">{answers[q.id] ?? "—"}</span>
                <span>{q.max ?? 10}</span>
              </div>
            </div>
          )}
          {q.type === "radio" && q.options && (
            <div className="space-y-2">
              {q.options.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    answers[q.id] === opt.value
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/40"
                  }`}
                >
                  <div
                    className={`mt-0.5 h-4 w-4 rounded-full border-2 flex-shrink-0 transition-colors ${
                      answers[q.id] === opt.value
                        ? "border-primary bg-primary"
                        : "border-muted-foreground"
                    }`}
                  />
                  <span className="text-sm text-foreground leading-snug">{opt.label}</span>
                  <input
                    type="radio"
                     name={q.id}
                    className="sr-only"
                    checked={answers[q.id] === opt.value}
                    onChange={() => onChange(q.id, opt.value)}
                  />
                </label>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function RegenPatientPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const { beginTemporaryDisplayLanguage, formatDate, locale } = useLanguage();
  const t = useScopedTranslations(publicPatientFlowMessages);

  const [info, setInfo] = useState<PatientInfo | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [currentScaleIdx, setCurrentScaleIdx] = useState(0);
  const [completed, setCompleted] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [allDone, setAllDone] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [bootstrapError, setBootstrapError] = useState("");
  const [bootstrapLocale, setBootstrapLocale] = useState<"pt-BR" | "es">(
    publicRegenFallbackLocale(locale),
  );
  const [localeReady, setLocaleReady] = useState(false);

  // Check token validity on load
  useEffect(() => {
    let mounted = true;
    let releaseDisplayLanguage: (() => void) | undefined;

    fetch(`/api/patient/regen/${token}`)
      .then(async r => ({ ok: r.ok, data: await readJsonSafely(r) }))
      .then(({ ok, data: d }) => {
        if (!mounted) return;
        const responseLocale = publicRegenFallbackLocale(d.doctorLocale);
        if (!ok || d.error || (d.doctorLocale !== "pt-BR" && d.doctorLocale !== "es")) {
          setBootstrapLocale(responseLocale);
          setBootstrapError(publicRegenServerError(d, publicPatientFlowMessages[responseLocale].invalidLink));
          setNotFound(true);
        } else {
          releaseDisplayLanguage = beginTemporaryDisplayLanguage(responseLocale);
        }
        setLocaleReady(true);
      })
      .catch(() => {
        if (mounted) {
          const responseLocale = publicRegenFallbackLocale(locale);
          setBootstrapLocale(responseLocale);
          setBootstrapError(publicPatientFlowMessages[responseLocale].invalidLink);
          setNotFound(true);
        }
      });

    return () => {
      mounted = false;
      releaseDisplayLanguage?.();
    };
  }, [beginTemporaryDisplayLanguage, token]);

  if (notFound) {
    const safeFallback = publicPatientFlowMessages[bootstrapLocale];
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-sm w-full text-center">
          <CardContent className="pt-8 pb-6 space-y-3">
            <p className="text-lg font-bold text-destructive">{bootstrapError || safeFallback.invalidLink}</p>
            <p className="text-sm text-muted-foreground">
              {safeFallback.invalidRegenLinkDescription}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Do not render the CPF gate in the browser's previous language while the
  // token bootstrap determines the doctor's public-page locale.
  if (!localeReady) {
    const safeFallback = publicPatientFlowMessages[publicRegenFallbackLocale(locale)];
    return (
      <div className="min-h-screen flex items-center justify-center p-4" aria-busy="true">
        <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {safeFallback.loadingQuestionnaires}
        </div>
      </div>
    );
  }

  if (!info) {
    return <CpfGate token={token} onVerified={(i) => {
      const completedScales = i.completedScales ?? [];
      const firstPending = (i.scales ?? []).findIndex(scale => !completedScales.includes(scale));
      setInfo(i);
      setCompleted(completedScales);
      setCurrentScaleIdx(Math.max(0, firstPending));
      setAllDone(i.scales.length > 0 && i.scales.every(scale => completedScales.includes(scale)));
    }} />;
  }

  if (info.noScales || info.scales.length === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex items-center justify-center p-4">
        <Card className="max-w-md w-full shadow-md">
          <CardContent className="pt-10 pb-8 space-y-4 text-center">
            <ClipboardList className="h-10 w-10 mx-auto text-amber-500" />
            <p className="text-lg font-bold text-foreground">{t("questionnairesPreparing")}</p>
            <p className="text-sm text-muted-foreground">{t("waitAndAccessAgain")}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const currentScaleName = info.scales[currentScaleIdx];
  // Public pages must follow the locale issued by the token, rather than a
  // previously saved browser preference. The temporary display language above
  // keeps the surrounding public-flow messages and formatted dates in sync.
  const questionnaireLocale = normalizeDoctorLocale(info.doctorLocale ?? locale);
  const scales = getRegenScales(questionnaireLocale);
  const currentScaleDef = currentScaleName ? scales[currentScaleName] : null;

  const handleAnswer = (id: string, value: number) => {
    setAnswers(prev => ({ ...prev, [id]: value }));
  };

  const handleSubmit = async () => {
    if (!currentScaleDef) return;
    const score = currentScaleDef.calcScore(answers);
    setSubmitting(true);
    setSubmitError("");
    try {
      const res = await fetch(`/api/patient/regen/${token}/scale/${encodeURIComponent(currentScaleName)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ respostas: answers, score }),
      });
      const data = await readJsonSafely(res);
      if (!res.ok || data.ok !== true) {
          setSubmitError(publicRegenServerError(data, t("saveError")));
      } else {
        const newCompleted = Array.from(new Set([...completed, currentScaleName]));
        setCompleted(newCompleted);
        setAnswers({});
        if (data.allCompleted || newCompleted.length === info.scales.length) {
          setAllDone(true);
        } else {
          const nextIdx = info.scales.findIndex(e => !newCompleted.includes(e));
          if (nextIdx !== -1) setCurrentScaleIdx(nextIdx);
        }
      }
    } catch {
       setSubmitError(t("regenConnectionError"));
    } finally {
      setSubmitting(false);
    }
  };

  const completedCount = completed.length;
  const totalCount = info.scales.length;

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
              <p className="text-muted-foreground mt-1 text-sm">
                 {t("completionDescription", { total: totalCount, plural: totalCount !== 1 ? "s" : "" }).split("\n").map((line, index) => (
                   <span key={index}>{line}{index === 0 && <br />}</span>
                 ))}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!currentScaleDef) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex items-center justify-center p-4">
        <Card className="max-w-md w-full text-center shadow-md">
          <CardContent className="pt-8 pb-6 space-y-4">
            <p role="alert" className="text-lg font-bold text-destructive">
              {t("questionnaireUnavailable")}
            </p>
            <p className="text-sm text-muted-foreground">
              {t("invalidLinkContactDoctor")}
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setInfo(null);
                setCompleted([]);
                setCurrentScaleIdx(0);
                setAnswers({});
                setSubmitError("");
              }}
            >
              {t("retry")}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Check all questions answered for submit button enablement
  const allAnswered = currentScaleDef.questions.every(q => answers[q.id] != null);

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      <div className="max-w-2xl mx-auto p-4 space-y-4 pb-16">
        {/* Header */}
        <div className="pt-6 text-center space-y-1">
          <h1 className="text-xl font-bold text-foreground">DocSholder</h1>
          <p className="text-xs text-muted-foreground">
             {t("assessment", { period: info.periodoLabel ?? info.periodo })}
            {info.scheduledDate && ` · ${formatDate(info.scheduledDate, { dateStyle: "short" })}`}
          </p>
        </div>

        {/* Progress */}
        <Card className="shadow-sm">
          <CardContent className="py-3 px-4">
            <div className="flex justify-between text-xs text-muted-foreground mb-2">
              <span>{t("progress")}</span>
               <span>{t("scalesProgress", { completed: completedCount, total: totalCount })}</span>
            </div>
            <Progress
              value={totalCount > 0 ? (completedCount / totalCount) * 100 : 0}
              className="h-2"
              aria-label={t("progress")}
              aria-valuetext={t("scalesProgressAria", { completed: completedCount, total: totalCount })}
            />
            <div className="flex flex-wrap gap-1 mt-2">
              {info.scales.map(name => (
                <span
                  key={name}
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    completed.includes(name)
                      ? "bg-green-100 text-green-700"
                      : name === currentScaleName
                      ? "bg-primary/10 text-primary font-semibold"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {completed.includes(name) && "✓ "}{name}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Current scale */}
        <Card className="shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-base">{currentScaleDef.title}</CardTitle>
            <CardDescription className="text-xs">{currentScaleDef.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ScaleForm scaleDef={currentScaleDef} answers={answers} onChange={handleAnswer} />

             {submitError && <p role="alert" className="text-xs text-destructive">{submitError}</p>}

            <Button
              className="w-full gap-2"
              onClick={handleSubmit}
              disabled={submitting || !allAnswered}
              aria-busy={submitting}
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
               {submitting ? t("saving") : currentScaleIdx < info.scales.length - 1 ? t("nextScale") : t("finish")}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
