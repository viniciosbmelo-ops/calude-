import { useState, useEffect, useRef } from "react";
import { useParams, Link } from "wouter";
import { Ban, User, CheckCircle2, ChevronRight, ChevronLeft, Loader2, Lock, FileText, Activity, AlertCircle, UploadCloud, File as FileIcon, X, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { normalizeDoctorLocale, preConsultationMessages, publicPatientFlowMessages } from "@/locales/public-patient-flows";

import { 
  useGetPreConsultInvite, useVerifyPreConsult, useGetPreConsultForm, 
  useSavePreConsultAnswers, useSubmitPreConsult, useUploadPreConsultAttachment,
  PreConsultAnswers, emptyPreConsultAnswers
} from "@/hooks/use-pre-consult";

// Format CPF for display
const formatCpf = (value: string) => {
  const d = value.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0,3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6)}`;
  return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`;
};

export default function PreConsultPatientFlow() {
  const params = useParams();
  const token = params.token || "";
  const { toast } = useToast();
  const { beginTemporaryDisplayLanguage, formatDate } = useLanguage();
  const t = useScopedTranslations(publicPatientFlowMessages);
  const preT = useScopedTranslations(preConsultationMessages);
  const PIORA_SINTOMAS_OPCOES = [["caminhar", "optWalk"], ["escadas", "optStairs"], ["agachar", "optSquat"], ["correr", "optRun"], ["esporte", "optSport"], ["sentado", "optSitting"], ["em_pe", "optStanding"], ["noite", "optNight"], ["outro", "other"]] as const;
  const TRATAMENTOS_OPCOES = [["fisioterapia", "optPhysiotherapy"], ["medicamentos", "optMedicines"], ["infiltracao", "optInfiltration"], ["acido_hialuronico", "optHyaluronicAcid"], ["prp", "prp"], ["bma", "optBma"], ["gordura_microfragmentada", "optMicrofragmentedFat"], ["cirurgia", "optSurgery"], ["outro", "other"]] as const;
  const ORTOBIOLOGICOS_OPCOES = [["prp", "prp"], ["bma", "optBmaConcentrate"], ["gordura_microfragmentada", "optMicrofragmentedFat"], ["outro", "optOthers"]] as const;
  const EXAMES_OPCOES = [["radiografia", "optXray"], ["ressonancia", "optMri"], ["tomografia", "optCt"], ["ultrassom", "optUltrasound"], ["laboratoriais", "optLab"], ["outro", "optOthers"]] as const;
  const OBJETIVO_OPCOES = [["reduzir_dor", "optReducePain"], ["caminhar_melhor", "optWalkBetter"], ["retornar_trabalho", "optReturnWork"], ["atividade_fisica", "optPhysicalActivity"], ["retornar_esporte", "optReturnSport"], ["evitar_cirurgia", "optAvoidSurgery"], ["avaliar_cirurgia", "optAssessSurgery"], ["outro", "other"]] as const;

  const [verified, setVerified] = useState(false);
  const [cpf, setCpf] = useState("");
  const [currentStep, setCurrentStep] = useState(1);
  
  const inviteQuery = useGetPreConsultInvite(token);
  const verifyMutation = useVerifyPreConsult(token);
  const formQuery = useGetPreConsultForm(token, verified);
  const saveMutation = useSavePreConsultAnswers(token);
  const submitMutation = useSubmitPreConsult(token);
  const uploadMutation = useUploadPreConsultAttachment(token);

  // The locale comes only from the token's server-side doctor lookup.
  useEffect(() => {
    const doctorLocale = (inviteQuery.data as { doctorLocale?: unknown } | undefined)?.doctorLocale;
    if (!doctorLocale) return;

    return beginTemporaryDisplayLanguage(normalizeDoctorLocale(doctorLocale));
  }, [beginTemporaryDisplayLanguage, inviteQuery.data]);

  const [answers, setAnswers] = useState<PreConsultAnswers>(emptyPreConsultAnswers);
  const lastSavedRef = useRef<PreConsultAnswers>(emptyPreConsultAnswers);
  const saveTimerRef = useRef<number | null>(null);

  // Init answers from server
  useEffect(() => {
    if (formQuery.data?.answers && !formQuery.data.answers.sobreVoce && answers.sobreVoce === "") {
      setAnswers({ ...emptyPreConsultAnswers, ...formQuery.data.answers });
      lastSavedRef.current = { ...emptyPreConsultAnswers, ...formQuery.data.answers };
    } else if (formQuery.data?.answers && formQuery.data.answers.sobreVoce) {
      // Only set once
      if (answers.sobreVoce === "") {
        setAnswers({ ...emptyPreConsultAnswers, ...formQuery.data.answers });
        lastSavedRef.current = { ...emptyPreConsultAnswers, ...formQuery.data.answers };
      }
    }
  }, [formQuery.data]);

  // Auto-save
  useEffect(() => {
    if (!verified || formQuery.data?.status === "submitted") return;
    
    // Check if answers changed
    const hasChanged = JSON.stringify(answers) !== JSON.stringify(lastSavedRef.current);
    if (!hasChanged) return;

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveMutation.mutate(answers, {
        onSuccess: () => {
          lastSavedRef.current = { ...answers };
        }
      });
    }, 2000); // 2s debounce
    
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, [answers, verified, formQuery.data?.status, saveMutation]);

  const handleVerify = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCpf = cpf.replace(/\D/g, "");
    if (cleanCpf.length !== 11) {
      toast({ title: preT("invalidCpf"), description: preT("enterElevenDigits"), variant: "destructive" });
      return;
    }
    verifyMutation.mutate(cleanCpf, {
      onSuccess: () => setVerified(true),
      onError: () => toast({ title: preT("accessDenied"), description: preT("cpfDoesNotMatch"), variant: "destructive" })
    });
  };

  const updateField = (key: keyof PreConsultAnswers, value: any) => {
    setAnswers(prev => ({ ...prev, [key]: value }));
  };

  const updateArrayField = (key: keyof PreConsultAnswers, item: string, checked: boolean) => {
    setAnswers(prev => {
      const arr = (prev[key] as string[]) || [];
      return { ...prev, [key]: checked ? [...arr, item] : arr.filter(i => i !== item) };
    });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    Array.from(files).forEach(file => {
      if (file.size > 25 * 1024 * 1024) {
        toast({ title: preT("fileTooLarge"), description: preT("fileOverLimit", { name: file.name }), variant: "destructive" });
        return;
      }
      uploadMutation.mutate(file, {
        onSuccess: () => toast({ title: preT("fileSent"), description: file.name }),
        onError: () => toast({ title: preT("uploadError"), description: preT("uploadFailed", { name: file.name }), variant: "destructive" })
      });
    });
    
    // Reset input
    if (e.target) e.target.value = '';
  };

  const handleSubmit = () => {
    if (confirm(preT("submitConfirmation"))) {
      submitMutation.mutate(answers, {
        onSuccess: () => {
          toast({ title: preT("questionnaireSubmitted"), description: preT("thanksForAnswers") });
          window.scrollTo({ top: 0, behavior: 'smooth' });
        },
        onError: () => toast({ title: preT("submitError"), description: preT("tryAgain"), variant: "destructive" })
      });
    }
  };

  const nextStep = () => {
    setCurrentStep(p => Math.min(p + 1, 6));
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // Force a save when moving steps explicitly
    saveMutation.mutate(answers);
  };
  
  const prevStep = () => {
    setCurrentStep(p => Math.max(p - 1, 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (inviteQuery.isLoading) {
    return <div className="min-h-screen flex items-center justify-center bg-muted/20"><Loader2 className="h-8 w-8 animate-spin text-[#1FB6E1]" /></div>;
  }

  if (inviteQuery.isError || !inviteQuery.data?.valid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/20 p-4">
        <Card className="max-w-md w-full border-border shadow-lg">
          <CardContent className="pt-10 pb-8 text-center space-y-4">
            <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <Ban className="h-8 w-8 text-red-600 dark:text-red-400" />
            </div>
            <h1 className="text-xl font-bold text-[#1A365D] dark:text-white">{t("invalidLink")}</h1>
            <p className="text-muted-foreground text-sm">{preT("invalidInviteDescription")}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!verified && !inviteQuery.data.submitted) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-[#1A365D] to-[#0A1628] p-4">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-bold text-white tracking-tight">DocSholder</h1>
            <p className="text-[#1FB6E1] text-sm">{t("preConsultation")}</p>
          </div>
          
          <Card className="border-none shadow-xl bg-white dark:bg-zinc-950">
            <CardHeader className="text-center pb-2">
              <div className="w-12 h-12 bg-[#1A365D]/10 rounded-full flex items-center justify-center mx-auto mb-3">
                <Lock className="h-5 w-5 text-[#1A365D]" />
              </div>
              <CardTitle className="text-lg">{t("confirmIdentity")}</CardTitle>
              <CardDescription>{preT("cpfAccessDescription")}</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleVerify} className="space-y-4 mt-2">
                <div className="space-y-2">
                  <Label htmlFor="cpf" className="sr-only">CPF</Label>
                  <Input 
                    id="cpf" 
                    placeholder="000.000.000-00" 
                    value={cpf} 
                    onChange={e => setCpf(formatCpf(e.target.value))}
                    className="text-center text-lg h-12"
                    maxLength={14}
                    inputMode="numeric"
                  />
                </div>
                <Button type="submit" className="w-full h-12 text-base bg-[#1A365D] hover:bg-[#1A365D]/90" disabled={verifyMutation.isPending || cpf.length < 14}>
                  {verifyMutation.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : t("access")}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (formQuery.isLoading && !inviteQuery.data.submitted) {
    return <div className="min-h-screen flex items-center justify-center bg-muted/20"><Loader2 className="h-8 w-8 animate-spin text-[#1FB6E1]" /></div>;
  }

  const formStatus = formQuery.data?.status;
  const isSubmitted = inviteQuery.data.submitted || formStatus === "submitted";

  if (isSubmitted) {
    return (
      <div className="min-h-screen bg-muted/20 p-4 md:p-8 flex items-center justify-center">
        <Card className="max-w-md w-full shadow-lg border-border">
          <CardContent className="pt-10 pb-8 text-center space-y-5">
            <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto shadow-sm">
              <CheckCircle2 className="h-10 w-10 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-[#1A365D] dark:text-white">{t("questionnaireSent")}</h1>
              <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                {preT("submittedDescription")}
              </p>
            </div>
            {formQuery.data?.lastSavedAt && (
              <p className="text-xs text-muted-foreground opacity-70">
                {t("sentOn", { date: formatDate(formQuery.data.lastSavedAt, { dateStyle: "short", timeStyle: "short" }) })}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const sections = [
    { title: preT("sectionAbout"), description: preT("sectionAboutDescription"), icon: <User className="h-4 w-4" /> },
    { title: preT("sectionSymptoms"), description: preT("sectionSymptomsDescription"), icon: <Activity className="h-4 w-4" /> },
    { title: preT("sectionHistory"), description: preT("sectionHistoryDescription"), icon: <FileText className="h-4 w-4" /> },
    { title: preT("sectionTreatments"), description: preT("sectionTreatmentsDescription"), icon: <FileText className="h-4 w-4" /> },
    { title: preT("sectionExams"), description: preT("sectionExamsDescription"), icon: <FileIcon className="h-4 w-4" /> },
    { title: preT("sectionExpectations"), description: preT("sectionExpectationsDescription"), icon: <AlertCircle className="h-4 w-4" /> },
  ];

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-zinc-950 pb-20">
      {/* Header */}
      <header className="bg-white dark:bg-zinc-900 border-b border-border sticky top-0 z-10 shadow-sm">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-gradient-to-br from-[#1A365D] to-[#1FB6E1] flex items-center justify-center shadow-inner">
              <FileText className="h-4 w-4 text-white" />
            </div>
            <span className="font-bold text-[#1A365D] dark:text-white">{t("preConsultation")}</span>
          </div>
          <div className="text-xs text-muted-foreground flex items-center gap-1.5 bg-muted/50 px-2 py-1 rounded">
            {saveMutation.isPending ? (
              <><Loader2 className="h-3 w-3 animate-spin text-amber-500" /> {t("saving")}</>
            ) : formQuery.data?.lastSavedAt ? (
              <><CheckCircle2 className="h-3 w-3 text-green-500" /> {t("saved")}</>
            ) : (
              t("draft")
            )}
          </div>
        </div>
        {/* Progress bar */}
        <Progress value={(currentStep / 6) * 100} className="h-1 rounded-none bg-muted" />
      </header>

      <main className="max-w-3xl mx-auto px-4 pt-8">
        
        {/* Stepper Navigation (Desktop) */}
        <div className="hidden md:flex justify-between items-center mb-8 relative">
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-[1px] bg-border -z-10" />
          {sections.map((sec, i) => {
            const stepNum = i + 1;
            const isActive = currentStep === stepNum;
            const isPast = currentStep > stepNum;
            return (
              <button 
                key={stepNum}
                onClick={() => setCurrentStep(stepNum)}
                className={`flex flex-col items-center gap-2 group focus:outline-none`}
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold transition-all shadow-sm ${
                  isActive ? "bg-[#1A365D] text-white ring-4 ring-[#1A365D]/20" : 
                  isPast ? "bg-[#1FB6E1] text-white" : 
                  "bg-white dark:bg-zinc-800 text-muted-foreground border border-border group-hover:border-[#1FB6E1]"
                }`}>
                  {isPast ? <CheckCircle2 className="h-4 w-4" /> : stepNum}
                </div>
                <span className={`text-[10px] font-medium uppercase tracking-wider ${isActive ? "text-[#1A365D] dark:text-white" : "text-muted-foreground"}`}>
                  {sec.title}
                </span>
              </button>
            )
          })}
        </div>

        {/* Mobile Step Indicator */}
        <div className="md:hidden mb-6 flex items-center justify-between bg-white dark:bg-zinc-900 p-3 rounded-lg border border-border shadow-sm">
          <span className="text-sm font-semibold text-[#1A365D] dark:text-white">{t("step", { current: currentStep, total: 6 })}</span>
          <span className="text-xs text-muted-foreground font-medium">{sections[currentStep-1].title}</span>
        </div>

        <Card className="border-border shadow-sm bg-white dark:bg-zinc-900 overflow-hidden">
          <CardHeader className="bg-muted/10 border-b border-border/50 pb-4">
            <CardTitle className="text-xl text-[#1A365D] dark:text-white">{sections[currentStep-1].title}</CardTitle>
            <CardDescription>
              {sections[currentStep - 1].description}
            </CardDescription>
          </CardHeader>
          
          <CardContent className="pt-6 space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
            
            {currentStep === 1 && (
              <>
                <div className="space-y-3">
                  <Label className="text-base font-semibold text-foreground">{preT("q1")}</Label>
                  <p className="text-sm text-muted-foreground">{preT("h1")}</p>
                  <Textarea 
                    value={answers.sobreVoce} 
                    onChange={e => updateField("sobreVoce", e.target.value)} 
                    placeholder={preT("p1")}
                    className="min-h-24 text-base focus-visible:ring-[#1FB6E1]"
                  />
                </div>
                
                <div className="space-y-3">
                  <Label className="text-base font-semibold text-foreground">{preT("q2")}</Label>
                  <p className="text-sm text-muted-foreground">{preT("h2")}</p>
                  <Textarea 
                    value={answers.queixaPrincipal} 
                    onChange={e => updateField("queixaPrincipal", e.target.value)} 
                    placeholder={preT("p2")}
                    className="min-h-24 text-base focus-visible:ring-[#1FB6E1]"
                  />
                </div>

                <div className="grid gap-6 sm:grid-cols-2">
                  <div className="space-y-3">
                    <Label className="text-sm font-semibold">{preT("q3")}</Label>
                    <Input 
                      value={answers.tempoProblema} 
                      onChange={e => updateField("tempoProblema", e.target.value)} 
                      placeholder={preT("p3")}
                    />
                  </div>
                  <div className="space-y-3">
                    <Label className="text-sm font-semibold">{preT("q4")}</Label>
                    <select 
                      value={answers.inicioSintomasTipo} 
                      onChange={e => updateField("inicioSintomasTipo", e.target.value)}
                      className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <option value="">{preT("select")}</option>
                      <option value="trauma">{preT("onsetTrauma")}</option>
                      <option value="atividade_fisica">{preT("onsetActivity")}</option>
                      <option value="progressivo">{preT("onsetProgressive")}</option>
                      <option value="pos_cirurgia">{preT("onsetSurgery")}</option>
                      <option value="outro">{preT("other")}</option>
                    </select>
                  </div>
                </div>
                
                <div className="space-y-3">
                  <Label className="text-sm font-semibold text-foreground">{preT("onsetDetails")}</Label>
                  <Textarea 
                    value={answers.inicioSintomasDescricao} 
                    onChange={e => updateField("inicioSintomasDescricao", e.target.value)} 
                    placeholder={preT("onsetDetailsPlaceholder")}
                    className="min-h-20 text-sm focus-visible:ring-[#1FB6E1]"
                  />
                </div>
              </>
            )}

            {currentStep === 2 && (
              <>
                <div className="grid gap-6 sm:grid-cols-2">
                  <div className="space-y-3">
                    <Label className="text-sm font-semibold">{preT("q5")}</Label>
                    <Input 
                      value={answers.localProblema} 
                      onChange={e => updateField("localProblema", e.target.value)} 
                      placeholder={preT("p5")}
                    />
                  </div>
                  <div className="space-y-3">
                    <Label className="text-sm font-semibold">{preT("q6")}</Label>
                    <Input 
                      value={answers.caracteristicaDor} 
                      onChange={e => updateField("caracteristicaDor", e.target.value)} 
                      placeholder={preT("p6")}
                    />
                  </div>
                </div>

                <div className="space-y-4 bg-muted/20 p-5 rounded-lg border border-border">
                  <div className="space-y-1.5 text-center">
                    <Label className="text-base font-semibold text-foreground">{preT("q7")}</Label>
                    <p className="text-xs text-muted-foreground">{preT("painScale")}</p>
                  </div>
                  <div className="flex justify-between px-2">
                    {[0,1,2,3,4,5,6,7,8,9,10].map(num => (
                      <button
                        key={num}
                        onClick={() => updateField("intensidadeDor", num)}
                        className={`w-8 h-10 sm:w-10 sm:h-12 rounded-md font-bold transition-all ${
                          answers.intensidadeDor === num 
                            ? "bg-[#1A365D] text-white scale-110 shadow-md ring-2 ring-offset-1 ring-[#1A365D]" 
                            : "bg-white dark:bg-zinc-800 border border-border text-foreground hover:border-[#1FB6E1]"
                        }`}
                      >
                        {num}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <Label className="text-base font-semibold">{preT("q8")}</Label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-2">
                    {PIORA_SINTOMAS_OPCOES.map(([value, label]) => (
                      <div key={value} className="flex items-start space-x-2">
                        <Checkbox
                          id={`piora-${value}`}
                          checked={answers.pioraSintomas.includes(value)}
                          onCheckedChange={(c) => updateArrayField("pioraSintomas", value, !!c)}
                        />
                        <Label htmlFor={`piora-${value}`} className="text-sm font-normal leading-tight peer-disabled:cursor-not-allowed peer-disabled:opacity-70">{preT(label)}</Label>
                      </div>
                    ))}
                  </div>
                  {answers.pioraSintomas.includes("outro") && (
                    <Input
                      placeholder={preT("otherWhich")}
                      className="mt-3"
                      value={answers.pioraSintomasOutro}
                      onChange={e => updateField("pioraSintomasOutro", e.target.value)}
                    />
                  )}
                </div>

                <div className="space-y-3">
                  <Label className="text-sm font-semibold">{preT("q9")}</Label>
                  <Input 
                    value={answers.melhoraSintomas} 
                    onChange={e => updateField("melhoraSintomas", e.target.value)} 
                    placeholder={preT("p9")}
                  />
                </div>

                <div className="space-y-3">
                  <Label className="text-sm font-semibold">{preT("q10")}</Label>
                  <Textarea 
                    value={answers.limitacoesDiarias} 
                    onChange={e => updateField("limitacoesDiarias", e.target.value)} 
                    placeholder={preT("p10")}
                    className="min-h-20 text-sm focus-visible:ring-[#1FB6E1]"
                  />
                </div>
              </>
            )}

            {currentStep === 3 && (
              <>
                <div className="space-y-3">
                  <Label className="text-base font-semibold">{preT("q11")}</Label>
                  <p className="text-sm text-muted-foreground">{preT("h11")}</p>
                  <Textarea 
                    value={answers.condicoesSaude} 
                    onChange={e => updateField("condicoesSaude", e.target.value)} 
                    placeholder={preT("noneOrDetails")}
                    className="min-h-20"
                  />
                </div>
                
                <div className="space-y-3">
                  <Label className="text-base font-semibold">{preT("q12")}</Label>
                  <p className="text-sm text-muted-foreground">{preT("h12")}</p>
                  <Textarea 
                    value={answers.medicamentos} 
                    onChange={e => updateField("medicamentos", e.target.value)} 
                    placeholder={preT("noneOrDetails")}
                    className="min-h-20"
                  />
                </div>

                <div className="space-y-3">
                  <Label className="text-base font-semibold text-red-600 dark:text-red-400">{preT("q13")}</Label>
                  <p className="text-sm text-muted-foreground">{preT("h13")}</p>
                  <Textarea 
                    value={answers.alergias} 
                    onChange={e => updateField("alergias", e.target.value)} 
                    placeholder={preT("noneOrDetails")}
                    className="min-h-20 border-red-200 focus-visible:ring-red-400"
                  />
                </div>

                <div className="space-y-3">
                  <Label className="text-base font-semibold">{preT("q14")}</Label>
                  <p className="text-sm text-muted-foreground">{preT("h14")}</p>
                  <Textarea 
                    value={answers.cirurgiasPrevias} 
                    onChange={e => updateField("cirurgiasPrevias", e.target.value)} 
                    placeholder={preT("noneOrDetails")}
                    className="min-h-20"
                  />
                </div>

                <div className="space-y-3">
                  <Label className="text-base font-semibold">{preT("q15")}</Label>
                  <p className="text-sm text-muted-foreground">{preT("h15")}</p>
                  <Textarea 
                    value={answers.complicacoes} 
                    onChange={e => updateField("complicacoes", e.target.value)} 
                    placeholder={preT("noneOrDetails")}
                    className="min-h-20"
                  />
                </div>
              </>
            )}

            {currentStep === 4 && (
              <>
                <div className="space-y-3">
                  <Label className="text-base font-semibold">{preT("q16")}</Label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-2">
                    {TRATAMENTOS_OPCOES.map(([value, label]) => (
                      <div key={value} className="flex items-start space-x-2">
                        <Checkbox 
                          id={`trat-${value}`} checked={answers.tratamentosPrevios.includes(value)}
                          onCheckedChange={(c) => updateArrayField("tratamentosPrevios", value, !!c)}
                        />
                        <Label htmlFor={`trat-${value}`} className="text-sm font-normal">{label === "prp" ? "PRP" : preT(label)}</Label>
                      </div>
                    ))}
                  </div>
                  <Textarea 
                    placeholder={preT("treatmentResults")}
                    className="mt-3 min-h-20"
                    value={answers.tratamentosDescricao}
                    onChange={e => updateField("tratamentosDescricao", e.target.value)}
                  />
                </div>

                <div className="space-y-3">
                  <Label className="text-base font-semibold">{preT("q17")}</Label>
                  <p className="text-sm text-muted-foreground">{preT("h17")}</p>
                  <Textarea 
                    value={answers.cirurgiaRegiaoAfetada} 
                    onChange={e => updateField("cirurgiaRegiaoAfetada", e.target.value)} 
                    placeholder={preT("p17")}
                    className="min-h-20"
                  />
                </div>

                <div className="space-y-3">
                  <Label className="text-base font-semibold">{preT("q18")}</Label>
                  <p className="text-sm text-muted-foreground">{preT("h18")}</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-2">
                    {ORTOBIOLOGICOS_OPCOES.map(([value, label]) => (
                      <div key={value} className="flex items-start space-x-2">
                        <Checkbox 
                          id={`orto-${value}`} checked={answers.ortobiologicos.includes(value)}
                          onCheckedChange={(c) => updateArrayField("ortobiologicos", value, !!c)}
                        />
                        <Label htmlFor={`orto-${value}`} className="text-sm font-normal">{label === "prp" ? "PRP" : preT(label)}</Label>
                      </div>
                    ))}
                  </div>
                  <Input 
                    placeholder={preT("orthobiologicDetails")}
                    className="mt-3"
                    value={answers.ortobiologicosDescricao}
                    onChange={e => updateField("ortobiologicosDescricao", e.target.value)}
                  />
                </div>
              </>
            )}

            {currentStep === 5 && (
              <>
                <div className="space-y-3">
                  <Label className="text-base font-semibold">{preT("q19")}</Label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-2">
                    {EXAMES_OPCOES.map(([value, label]) => (
                      <div key={value} className="flex items-start space-x-2">
                        <Checkbox 
                          id={`exame-${value}`} checked={answers.examesPossui.includes(value)}
                          onCheckedChange={(c) => updateArrayField("examesPossui", value, !!c)}
                        />
                        <Label htmlFor={`exame-${value}`} className="text-sm font-normal">{preT(label)}</Label>
                      </div>
                    ))}
                  </div>
                  <Textarea 
                    placeholder={preT("examsDetails")}
                    className="mt-3 min-h-20"
                    value={answers.examesInfo}
                    onChange={e => updateField("examesInfo", e.target.value)}
                  />
                </div>

                <div className="space-y-3">
                  <Label className="text-base font-semibold">{preT("q21")}</Label>
                  <p className="text-sm text-muted-foreground">{preT("h21")}</p>
                  <Textarea 
                    value={answers.outrasInformacoesMedicas} 
                    onChange={e => updateField("outrasInformacoesMedicas", e.target.value)} 
                    placeholder={preT("p21")}
                    className="min-h-20"
                  />
                </div>

                <div className="mt-8 space-y-4">
                  <div className="space-y-1">
                    <Label className="text-base font-semibold">{preT("q20")}</Label>
                    <p className="text-sm text-muted-foreground">{preT("h20")}</p>
                  </div>
                  
                  <div className="border-2 border-dashed border-border rounded-lg p-6 flex flex-col items-center justify-center bg-muted/10 hover:bg-muted/30 transition-colors text-center relative">
                    <UploadCloud className="h-10 w-10 text-muted-foreground mb-3" />
                    <p className="text-sm font-medium">{preT("attachFiles")}</p>
                    <p className="text-xs text-muted-foreground mt-1">{preT("uploadFormats")}</p>
                    <input 
                      type="file" 
                      multiple 
                      accept="application/pdf,image/jpeg,image/png,image/webp"
                      onChange={handleFileUpload}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                  </div>
                  
                  {uploadMutation.isPending && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground p-3 bg-muted/20 rounded">
                      <Loader2 className="h-4 w-4 animate-spin" /> {preT("uploadingFile")}
                    </div>
                  )}

                  {formQuery.data?.attachments && formQuery.data.attachments.length > 0 && (
                    <div className="space-y-2 mt-4">
                      <Label className="text-xs font-semibold uppercase text-muted-foreground">{preT("attachedFiles")}</Label>
                      <div className="grid sm:grid-cols-2 gap-2">
                        {formQuery.data.attachments.map(att => (
                          <div key={att.id} className="flex items-center gap-3 p-2 bg-background border rounded-md">
                            <div className="h-8 w-8 rounded bg-muted flex items-center justify-center shrink-0">
                              <FileIcon className="h-4 w-4 text-muted-foreground" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium truncate">{att.fileName}</p>
                            </div>
                            <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {currentStep === 6 && (
              <>
                <div className="space-y-3">
                  <Label className="text-base font-semibold">{preT("q22")}</Label>
                  <select 
                    value={answers.objetivoTratamento} 
                    onChange={e => updateField("objetivoTratamento", e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1FB6E1]"
                  >
                    <option value="">{preT("select")}</option>
                    {OBJETIVO_OPCOES.map(([value, label]) => (
                      <option key={value} value={value}>{preT(label)}</option>
                    ))}
                  </select>
                  {answers.objetivoTratamento === "outro" && (
                    <Input 
                      placeholder={preT("otherWhich")}
                      value={answers.objetivoTratamentoOutro}
                      onChange={e => updateField("objetivoTratamentoOutro", e.target.value)}
                    />
                  )}
                </div>

                <div className="space-y-3">
                  <Label className="text-base font-semibold">{preT("q23")}</Label>
                  <Textarea 
                    value={answers.preocupacaoCirurgia} 
                    onChange={e => updateField("preocupacaoCirurgia", e.target.value)} 
                    className="min-h-20 text-base"
                  />
                </div>
                
                <div className="space-y-3">
                  <Label className="text-base font-semibold">{preT("q24")}</Label>
                  <Textarea 
                    value={answers.expectativaConsulta} 
                    onChange={e => updateField("expectativaConsulta", e.target.value)} 
                    className="min-h-20 text-base border-[#1FB6E1]/40"
                  />
                </div>

                <div className="space-y-3">
                  <Label className="text-base font-semibold">{preT("q25")}</Label>
                  <p className="text-sm text-muted-foreground">{preT("h25")}</p>
                  <Textarea 
                    value={answers.observacoes} 
                    onChange={e => updateField("observacoes", e.target.value)} 
                    className="min-h-20"
                  />
                </div>
              </>
            )}

          </CardContent>
          
          <CardFooter className="bg-muted/10 border-t border-border/50 p-4 sm:px-6 flex justify-between items-center">
            <Button 
              variant="outline" 
              onClick={prevStep} 
              disabled={currentStep === 1 || submitMutation.isPending}
              className="gap-1 px-3 sm:px-4"
            >
              <ChevronLeft className="h-4 w-4" /> <span className="hidden sm:inline">{t("previous")}</span>
            </Button>
            
            {currentStep < 6 ? (
              <Button 
                onClick={nextStep} 
                className="gap-1 px-6 sm:px-8 bg-[#1A365D] hover:bg-[#1A365D]/90"
              >
                {t("next")} <ChevronRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button 
                onClick={handleSubmit} 
                disabled={submitMutation.isPending}
                className="gap-2 px-6 sm:px-8 bg-[#1FB6E1] hover:bg-[#1FB6E1]/90 text-white font-bold"
              >
                {submitMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
                {preT("finishSubmission")}
              </Button>
            )}
          </CardFooter>
        </Card>
      </main>
    </div>
  );
}
