import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { es, ptBR } from "date-fns/locale";
import {
  Activity, CheckCircle2, AlertCircle, Copy, ExternalLink, RefreshCw, Send, Save, Ban, Lock, FileText, User, 
  MessageCircle, Download, Eye, File, FileDown, UploadCloud, Clock
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { preConsultClinicianMessages } from "@/locales/pre-consult-clinician";
import { 
  useGetPhysicianPreConsult, useCreatePreConsultInvite, useRevokePreConsultInvite, 
  useUpdatePhysicianPreConsult, PreConsultAnswers, emptyPreConsultAnswers 
} from "@/hooks/use-pre-consult";

const PIORA_SINTOMAS_OPCOES = [
  "caminhar", "escadas", "agachar", "correr", "esporte", "sentado", "em_pe", "noite", "outro",
];

const TRATAMENTOS_OPCOES = [
  "fisioterapia", "medicamentos", "infiltracao", "acido_hialuronico", "prp", "bma", "gordura_microfragmentada", "cirurgia", "outro",
];

const ORTOBIOLOGICOS_OPCOES = [
  "prp", "bma", "gordura_microfragmentada", "outro",
];

const EXAMES_OPCOES = [
  "radiografia", "ressonancia", "tomografia", "ultrassom", "laboratoriais", "outro",
];

const TIPO_INICIO_OPCOES = [
  "trauma", "atividade_fisica", "progressivo", "pos_cirurgia", "outro",
];

const OBJETIVO_OPCOES = [
  "reduzir_dor", "caminhar_melhor", "retornar_trabalho", "atividade_fisica", "retornar_esporte", "evitar_cirurgia", "avaliar_cirurgia", "outro",
];

export function PreConsultTab({ patientId }: { patientId: number }) {
  const { toast } = useToast();
  const pc = useScopedTranslations(preConsultClinicianMessages);
  const { locale } = useLanguage();
  const dateLocale = locale === "es" ? es : ptBR;
  const optionLabel = (value: string, options?: { goal?: boolean; pluralOther?: boolean }) =>
    pc((options?.goal && value === "atividade_fisica" ? "retomar_atividade" : options?.pluralOther && value === "outro" ? "outros" : value) as "outro");
  const answerLabels: Record<keyof PreConsultAnswers, string> = {
    sobreVoce: pc("sobreVoce"), queixaPrincipal: pc("queixaPrincipal"), tempoProblema: pc("tempoProblema"),
    inicioSintomasTipo: pc("inicioSintomasTipo"), inicioSintomasDescricao: pc("inicioSintomasDescricao"),
    localProblema: pc("localProblema"), caracteristicaDor: pc("caracteristicaDor"), intensidadeDor: pc("intensidadeDor"),
    pioraSintomas: pc("pioraSintomas"), pioraSintomasOutro: pc("pioraSintomasOutro"), melhoraSintomas: pc("melhoraSintomas"),
    limitacoesDiarias: pc("limitacoesDiarias"), condicoesSaude: pc("condicoesSaude"), medicamentos: pc("medicamentos"),
    alergias: pc("alergias"), cirurgiasPrevias: pc("cirurgiasPrevias"), complicacoes: pc("complicacoes"),
    tratamentosPrevios: pc("tratamentosPrevios"), tratamentosDescricao: pc("tratamentosDescricao"),
    cirurgiaRegiaoAfetada: pc("cirurgiaRegiaoAfetada"), ortobiologicos: pc("ortobiologicos"),
    ortobiologicosDescricao: pc("ortobiologicosDescricao"), examesPossui: pc("examesPossui"), examesInfo: pc("examesInfo"),
    outrasInformacoesMedicas: pc("outrasInformacoesMedicas"), objetivoTratamento: pc("objetivoTratamento"),
    objetivoTratamentoOutro: pc("objetivoTratamentoOutro"), preocupacaoCirurgia: pc("preocupacaoCirurgia"),
    expectativaConsulta: pc("expectativaConsulta"), observacoes: pc("observacoes"),
  };
  const { data, isLoading } = useGetPhysicianPreConsult(patientId);
  const createInvite = useCreatePreConsultInvite(patientId);
  const revokeInvite = useRevokePreConsultInvite(patientId);
  const updateAnswers = useUpdatePhysicianPreConsult(patientId);

  const [generatedInvite, setGeneratedInvite] = useState<{ link: string; whatsappMessage: string } | null>(null);
  const [answersVersion, setAnswersVersion] = useState<"edit" | "original">("edit");

  // Auto-save form state
  const [formState, setFormState] = useState<PreConsultAnswers>(emptyPreConsultAnswers);
  const lastSaved = useRef<PreConsultAnswers>(emptyPreConsultAnswers);
  const initRef = useRef<number | null>(null);

  useEffect(() => {
    if (data?.questionnaire?.currentAnswers && initRef.current !== patientId) {
      initRef.current = patientId;
      setFormState(data.questionnaire.currentAnswers);
      lastSaved.current = data.questionnaire.currentAnswers;
    }
  }, [data, patientId]);

  const handleFieldChange = (key: keyof PreConsultAnswers, value: any) => {
    setFormState(prev => ({ ...prev, [key]: value }));
  };

  const handleArrayChange = (key: keyof PreConsultAnswers, item: string, checked: boolean) => {
    setFormState(prev => {
      const arr = (prev[key] as string[]) || [];
      return { ...prev, [key]: checked ? [...arr, item] : arr.filter(i => i !== item) };
    });
  };

  const handleGenerateInvite = () => {
    createInvite.mutate(undefined, {
      onSuccess: (res) => {
        setGeneratedInvite(res);
        toast({ title: pc("inviteGenerated") });
      },
      onError: (err) => {
        toast({ title: pc("error"), description: err.message, variant: "destructive" });
      }
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: pc("copied") });
  };

  const openWhatsApp = (msg: string) => {
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
  };

  const handleSave = () => {
    updateAnswers.mutate(formState, {
      onSuccess: () => {
        lastSaved.current = formState;
        toast({ title: pc("changesSaved"), description: pc("questionnaireUpdated") });
      },
      onError: (err) => {
        toast({ title: pc("saveError"), description: err.message, variant: "destructive" });
      }
    });
  };

  const formatAnswerValue = (key: keyof PreConsultAnswers, value: unknown): string => {
    if (Array.isArray(value)) {
      return value.map(item => {
        const allOptions = [...PIORA_SINTOMAS_OPCOES, ...TRATAMENTOS_OPCOES, ...ORTOBIOLOGICOS_OPCOES, ...EXAMES_OPCOES];
        return typeof item === "string" && allOptions.includes(item)
          ? optionLabel(item, { pluralOther: key === "ortobiologicos" || key === "examesPossui" })
          : String(item);
      }).join(", ");
    }
    if (typeof value === "string") {
      const allOptions = [...TIPO_INICIO_OPCOES, ...OBJETIVO_OPCOES];
      return allOptions.includes(value)
        ? optionLabel(value, { goal: key === "objetivoTratamento" })
        : value;
    }
    return value == null ? "" : String(value);
  };

  const handleExportTxt = () => {
    const answers = answersVersion === "original"
      ? questionnaire?.patientAnswers
      : formState;
    if (!answers) return;

    const lines = [
      pc("txtTitle"),
      `${pc("txtVersion")}: ${answersVersion === "original" ? pc("patientOriginal") : pc("currentEditable")}`,
      questionnaire?.submittedAt
        ? `${pc("txtCompletedAt")}: ${format(new Date(questionnaire.submittedAt), "dd/MM/yyyy HH:mm", { locale: dateLocale })}`
        : "",
      "",
      ...Object.entries(answers).flatMap(([rawKey, value]) => {
        if (value === null || value === "" || (Array.isArray(value) && value.length === 0)) return [];
        const key = rawKey as keyof PreConsultAnswers;
        return [`${answerLabels[key] ?? rawKey}:`, formatAnswerValue(key, value), ""];
      }),
    ].filter((line, index, allLines) => line !== "" || allLines[index - 1] !== "");

    const blob = new Blob([`\uFEFF${lines.join("\r\n").trim()}\r\n`], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `pre-consulta-paciente-${patientId}-${answersVersion === "original" ? "original" : "atual"}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast({ title: pc("txtExported") });
  };

  if (isLoading) {
    return <div className="p-8 text-center text-muted-foreground">{pc("loading")}</div>;
  }

  const { invite, questionnaire, attachments } = data || { invite: null, questionnaire: null, attachments: [] };

  const activeInvite = invite && invite.status === "active";
  const hasSubmitted = questionnaire?.status === "submitted";

  return (
    <div className="space-y-6">
      {/* HEADER & INVITE SECTION */}
      <Card className="border-border shadow-sm">
        <CardHeader className="pb-4">
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2" style={{ color: "#0B1F4B" }}>
                <FileText className="h-5 w-5" />
                {pc("title")}
              </CardTitle>
              <CardDescription>
                {pc("description")}
              </CardDescription>
            </div>
            {hasSubmitted ? (
              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">{pc("answered")}</Badge>
            ) : activeInvite ? (
              <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">{pc("awaiting")}</Badge>
            ) : (
              <Badge variant="outline" className="bg-muted text-muted-foreground">{pc("notSent")}</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!hasSubmitted && !activeInvite && !generatedInvite && (
            <div className="bg-muted/30 border rounded-lg p-5 text-center space-y-3">
              <UploadCloud className="h-8 w-8 mx-auto text-muted-foreground opacity-50" />
              <div>
                <p className="text-sm font-medium text-foreground">{pc("generatePatientLink")}</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
                  {pc("patientLinkHelp")}
                </p>
              </div>
              <Button onClick={handleGenerateInvite} disabled={createInvite.isPending} style={{ background: "#0B1F4B" }}>
                {createInvite.isPending ? pc("generating") : pc("generateLink")}
              </Button>
            </div>
          )}

          {generatedInvite && (
            <div className="bg-[#0E9AA7]/10 border border-[#0E9AA7]/20 rounded-lg p-4 space-y-4">
              <div>
                <p className="text-sm font-medium text-[#0B1F4B]">{pc("linkGenerated")}</p>
                <p className="text-xs text-muted-foreground">{pc("valid7Days")}</p>
              </div>
              <div className="bg-white dark:bg-black/20 p-2 rounded border break-all text-xs text-muted-foreground">
                {generatedInvite.link}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => copyToClipboard(generatedInvite.link)} className="gap-1.5">
                  <Copy className="h-4 w-4" /> {pc("copyLink")}
                </Button>
                <Button variant="outline" size="sm" onClick={() => copyToClipboard(generatedInvite.whatsappMessage)} className="gap-1.5">
                  <Copy className="h-4 w-4" /> {pc("copyMessage")}
                </Button>
                <Button size="sm" onClick={() => openWhatsApp(generatedInvite.whatsappMessage)} className="gap-1.5 bg-green-600 hover:bg-green-700 text-white border-transparent">
                  <MessageCircle className="h-4 w-4" /> {pc("openWhatsapp")}
                </Button>
              </div>
            </div>
          )}

          {activeInvite && !generatedInvite && (
            <div className="bg-amber-50/50 border border-amber-100 rounded-lg p-4 flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="text-sm font-medium text-amber-900">{pc("activeInvite")}</p>
                <p className="text-xs text-amber-700/80 mt-1">
                  {pc("sentExpires", { sent: format(new Date(invite.createdAt), "dd/MM/yyyy"), expires: format(new Date(invite.expiresAt), "dd/MM/yyyy") })}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleGenerateInvite} disabled={createInvite.isPending}>
                  <RefreshCw className="h-4 w-4 mr-1.5" /> {pc("resend")}
                </Button>
                <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10" onClick={() => {
                   if (confirm(pc("revokeConfirm"))) revokeInvite.mutate(invite.id);
                }} disabled={revokeInvite.isPending}>
                  <Ban className="h-4 w-4 mr-1.5" /> {pc("revoke")}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* RESPONSES SECTION */}
      {questionnaire && questionnaire.currentAnswers && (
        <Card className="border-border shadow-sm">
          <CardHeader className="pb-3 border-b border-border/50 flex flex-row items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-base">{pc("patientAnswers")}</CardTitle>
              {questionnaire.submittedAt ? (
                <CardDescription className="flex items-center gap-1.5 mt-1">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                  {pc("completedAt", { date: format(new Date(questionnaire.submittedAt), locale === "es" ? "dd/MM/yyyy HH:mm" : "dd/MM/yyyy 'às' HH:mm", { locale: dateLocale }) })}
                </CardDescription>
              ) : questionnaire.lastPatientSavedAt ? (
                <CardDescription className="flex items-center gap-1.5 mt-1">
                  <Clock className="h-3.5 w-3.5 text-amber-500" />
                  {pc("partialAt", { date: format(new Date(questionnaire.lastPatientSavedAt), "dd/MM/yyyy HH:mm", { locale: dateLocale }) })}
                </CardDescription>
              ) : null}
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" variant="outline" onClick={handleExportTxt} className="gap-1.5">
                <FileDown className="h-4 w-4" /> {pc("exportTxt")}
              </Button>
              <Button size="sm" variant="default" onClick={handleSave} disabled={updateAnswers.isPending} className="gap-1.5" style={{ background: "#0E9AA7" }}>
                <Save className="h-4 w-4" /> {pc("saveEdits")}
              </Button>
            </div>
          </CardHeader>
          
          <Tabs value={answersVersion} onValueChange={value => setAnswersVersion(value as "edit" | "original")} className="w-full">
            <div className="px-6 py-2 border-b border-border/50 flex items-center justify-between bg-muted/20">
              <TabsList className="h-8">
                <TabsTrigger value="edit" className="text-xs h-6 px-3">{pc("currentEditable")}</TabsTrigger>
                <TabsTrigger value="original" className="text-xs h-6 px-3">{pc("patientOriginal")}</TabsTrigger>
              </TabsList>
              {questionnaire.doctorEditedAt && (
                <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <User className="h-3 w-3" />
                  {pc("doctorEdited")}
                </span>
              )}
            </div>

            <TabsContent value="edit" className="p-0 m-0">
              <div className="p-6 space-y-8 divide-y divide-border/40">
                {/* 1. Sobre Você */}
                <section className="pt-2 first:pt-0 space-y-4">
                  <h3 className="text-sm font-bold tracking-wide uppercase text-muted-foreground">{pc("aboutYou")}</h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label className="text-xs">{pc("profession")}</Label>
                      <Textarea value={formState.sobreVoce || ""} onChange={e => handleFieldChange("sobreVoce", e.target.value)} className="min-h-20 text-sm" />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label className="text-xs text-[#0B1F4B] font-semibold">{pc("mainComplaint")}</Label>
                      <Textarea value={formState.queixaPrincipal || ""} onChange={e => handleFieldChange("queixaPrincipal", e.target.value)} className="min-h-20 text-sm border-[#0E9AA7]/30 focus-visible:ring-[#0E9AA7]" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">{pc("problemDuration")}</Label>
                      <Input value={formState.tempoProblema || ""} onChange={e => handleFieldChange("tempoProblema", e.target.value)} className="text-sm h-8" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">{pc("symptomsStart")}</Label>
                      <select 
                        value={formState.inicioSintomasTipo || ""} 
                        onChange={e => handleFieldChange("inicioSintomasTipo", e.target.value)}
                        className="flex h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <option value="">{pc("select")}</option>
                        {TIPO_INICIO_OPCOES.map(opt => (
                          <option key={opt} value={opt}>{optionLabel(opt)}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label className="text-xs">{pc("startDetails")}</Label>
                      <Textarea value={formState.inicioSintomasDescricao || ""} onChange={e => handleFieldChange("inicioSintomasDescricao", e.target.value)} className="min-h-16 text-sm" />
                    </div>
                  </div>
                </section>

                {/* 2. Sintomas */}
                <section className="pt-6 space-y-4">
                  <h3 className="text-sm font-bold tracking-wide uppercase text-muted-foreground">{pc("symptoms")}</h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">{pc("location")}</Label>
                      <Input value={formState.localProblema || ""} onChange={e => handleFieldChange("localProblema", e.target.value)} className="text-sm h-8" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">{pc("painCharacteristic")}</Label>
                      <Input value={formState.caracteristicaDor || ""} onChange={e => handleFieldChange("caracteristicaDor", e.target.value)} className="text-sm h-8" />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label className="text-xs">{pc("painIntensity")}</Label>
                      <div className="flex items-center gap-3">
                        <Input type="number" min="0" max="10" value={formState.intensidadeDor ?? ""} onChange={e => handleFieldChange("intensidadeDor", e.target.value ? Number(e.target.value) : null)} className="w-20 text-sm h-8" />
                        <span className="text-xs text-muted-foreground">{formState.intensidadeDor != null ? (formState.intensidadeDor > 7 ? pc("severePain") : formState.intensidadeDor > 3 ? pc("moderatePain") : pc("mildPain")) : ""}</span>
                      </div>
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label className="text-xs">{pc("worsens")}</Label>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-1 mb-2">
                        {PIORA_SINTOMAS_OPCOES.map(opt => (
                          <div key={opt} className="flex items-center space-x-2">
                            <Checkbox 
                              id={`edit-piora-${opt}`}
                              checked={(formState.pioraSintomas || []).includes(opt)}
                              onCheckedChange={(c) => handleArrayChange("pioraSintomas", opt, !!c)}
                            />
                            <Label htmlFor={`edit-piora-${opt}`} className="text-xs font-normal cursor-pointer">{optionLabel(opt)}</Label>
                          </div>
                        ))}
                      </div>
                      <Input value={formState.pioraSintomasOutro || ""} onChange={e => handleFieldChange("pioraSintomasOutro", e.target.value)} placeholder={pc("otherDescribe")} className="text-sm h-8" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">{pc("improves")}</Label>
                      <Textarea value={formState.melhoraSintomas || ""} onChange={e => handleFieldChange("melhoraSintomas", e.target.value)} className="text-sm min-h-16" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">{pc("dailyLimitations")}</Label>
                      <Textarea value={formState.limitacoesDiarias || ""} onChange={e => handleFieldChange("limitacoesDiarias", e.target.value)} className="text-sm min-h-16" />
                    </div>
                  </div>
                </section>

                {/* 3. Histórico */}
                <section className="pt-6 space-y-4">
                  <h3 className="text-sm font-bold tracking-wide uppercase text-muted-foreground">{pc("medicalHistory")}</h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">{pc("healthConditions")}</Label>
                      <Textarea value={formState.condicoesSaude || ""} onChange={e => handleFieldChange("condicoesSaude", e.target.value)} className="text-sm min-h-16" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">{pc("medicamentos")}</Label>
                      <Textarea value={formState.medicamentos || ""} onChange={e => handleFieldChange("medicamentos", e.target.value)} className="text-sm min-h-16" />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label className="text-xs text-red-600 dark:text-red-400 font-medium">{pc("allergies")}</Label>
                      <Textarea value={formState.alergias || ""} onChange={e => handleFieldChange("alergias", e.target.value)} className="text-sm min-h-16 border-red-200 focus-visible:ring-red-500" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">{pc("previousSurgeries")}</Label>
                      <Textarea value={formState.cirurgiasPrevias || ""} onChange={e => handleFieldChange("cirurgiasPrevias", e.target.value)} className="text-sm min-h-16" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">{pc("complications")}</Label>
                      <Textarea value={formState.complicacoes || ""} onChange={e => handleFieldChange("complicacoes", e.target.value)} className="text-sm min-h-16" />
                    </div>
                  </div>
                </section>

                {/* 4. Tratamentos */}
                <section className="pt-6 space-y-4">
                  <h3 className="text-sm font-bold tracking-wide uppercase text-muted-foreground">{pc("priorTreatments")}</h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label className="text-xs">{pc("treatmentsDone")}</Label>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-1 mb-2">
                        {TRATAMENTOS_OPCOES.map(opt => (
                          <div key={opt} className="flex items-center space-x-2">
                            <Checkbox 
                              id={`edit-trat-${opt}`}
                              checked={(formState.tratamentosPrevios || []).includes(opt)}
                              onCheckedChange={(c) => handleArrayChange("tratamentosPrevios", opt, !!c)}
                            />
                            <Label htmlFor={`edit-trat-${opt}`} className="text-xs font-normal cursor-pointer">{optionLabel(opt)}</Label>
                          </div>
                        ))}
                      </div>
                      <Textarea value={formState.tratamentosDescricao || ""} onChange={e => handleFieldChange("tratamentosDescricao", e.target.value)} placeholder={pc("treatmentDetails")} className="text-sm min-h-16" />
                    </div>
                    
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label className="text-xs">{pc("orthobiologics")}</Label>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-1 mb-2">
                        {ORTOBIOLOGICOS_OPCOES.map(opt => (
                          <div key={opt} className="flex items-center space-x-2">
                            <Checkbox 
                              id={`edit-orto-${opt}`}
                              checked={(formState.ortobiologicos || []).includes(opt)}
                              onCheckedChange={(c) => handleArrayChange("ortobiologicos", opt, !!c)}
                            />
                            <Label htmlFor={`edit-orto-${opt}`} className="text-xs font-normal cursor-pointer">{optionLabel(opt, { pluralOther: true })}</Label>
                          </div>
                        ))}
                      </div>
                      <Textarea value={formState.ortobiologicosDescricao || ""} onChange={e => handleFieldChange("ortobiologicosDescricao", e.target.value)} placeholder={pc("orthobiologicDetails")} className="text-sm min-h-16" />
                    </div>

                    <div className="space-y-1.5 sm:col-span-2">
                      <Label className="text-xs">{pc("affectedRegionSurgery")}</Label>
                      <Textarea value={formState.cirurgiaRegiaoAfetada || ""} onChange={e => handleFieldChange("cirurgiaRegiaoAfetada", e.target.value)} className="text-sm min-h-16" />
                    </div>
                  </div>
                </section>

                {/* 5. Exames */}
                <section className="pt-6 space-y-4">
                  <h3 className="text-sm font-bold tracking-wide uppercase text-muted-foreground">{pc("exams")}</h3>
                  <div className="space-y-1.5">
                    <Label className="text-xs">{pc("examsOwned")}</Label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-1 mb-2">
                      {EXAMES_OPCOES.map(opt => (
                        <div key={opt} className="flex items-center space-x-2">
                          <Checkbox 
                            id={`edit-exame-${opt}`}
                            checked={(formState.examesPossui || []).includes(opt)}
                            onCheckedChange={(c) => handleArrayChange("examesPossui", opt, !!c)}
                          />
                          <Label htmlFor={`edit-exame-${opt}`} className="text-xs font-normal cursor-pointer">{optionLabel(opt, { pluralOther: true })}</Label>
                        </div>
                      ))}
                    </div>
                    <Textarea value={formState.examesInfo || ""} onChange={e => handleFieldChange("examesInfo", e.target.value)} placeholder={pc("examInfo")} className="text-sm min-h-16 mt-2" />
                  </div>
                  
                  <div className="space-y-1.5">
                    <Label className="text-xs">{pc("otherMedicalInfo")}</Label>
                    <Textarea value={formState.outrasInformacoesMedicas || ""} onChange={e => handleFieldChange("outrasInformacoesMedicas", e.target.value)} className="text-sm min-h-16" />
                  </div>
                  
                  {attachments.length > 0 && (
                    <div className="bg-muted/30 rounded-lg p-4 border border-border">
                      <Label className="text-xs mb-3 block text-foreground">{pc("attachedFiles", { count: attachments.length })}</Label>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {attachments.map(att => (
                          <a key={att.id} href={att.url} target="_blank" rel="noreferrer" className="flex items-center gap-3 p-2 bg-background border rounded-md hover:bg-muted/50 transition-colors group">
                            <div className="h-8 w-8 rounded bg-muted flex items-center justify-center shrink-0">
                              <File className="h-4 w-4 text-muted-foreground" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium truncate">{att.fileName}</p>
                              <p className="text-[10px] text-muted-foreground">{(att.fileSize / 1024 / 1024).toFixed(2)} MB</p>
                            </div>
                            <Download className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </section>

                {/* 6. Expectativas */}
                <section className="pt-6 space-y-4">
                  <h3 className="text-sm font-bold tracking-wide uppercase text-muted-foreground">{pc("expectations")}</h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label className="text-xs text-[#0B1F4B] font-semibold">{pc("mainGoal")}</Label>
                      <select 
                        value={formState.objetivoTratamento || ""} 
                        onChange={e => handleFieldChange("objetivoTratamento", e.target.value)}
                        className="flex h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 mb-2"
                      >
                        <option value="">{pc("select")}</option>
                        {OBJETIVO_OPCOES.map(opt => (
                          <option key={opt} value={opt}>{optionLabel(opt, { goal: true })}</option>
                        ))}
                      </select>
                      <Input value={formState.objetivoTratamentoOutro || ""} onChange={e => handleFieldChange("objetivoTratamentoOutro", e.target.value)} placeholder={pc("otherGoal")} className="text-sm h-8" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">{pc("consultationExpectation")}</Label>
                      <Textarea value={formState.expectativaConsulta || ""} onChange={e => handleFieldChange("expectativaConsulta", e.target.value)} className="text-sm min-h-24" />
                    </div>
                    {/* DocRegen no longer asks the surgical-concern question; answers
                        recorded earlier (shared database) stay visible and editable. */}
                    {Boolean(formState.preocupacaoCirurgia) && (
                      <div className="space-y-1.5">
                        <Label className="text-xs">{pc("surgeryConcern")}</Label>
                        <Textarea value={formState.preocupacaoCirurgia || ""} onChange={e => handleFieldChange("preocupacaoCirurgia", e.target.value)} className="text-sm min-h-24" />
                      </div>
                    )}
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label className="text-xs">{pc("freeNotes")}</Label>
                      <Textarea value={formState.observacoes || ""} onChange={e => handleFieldChange("observacoes", e.target.value)} className="text-sm min-h-20 bg-muted/10" />
                    </div>
                  </div>
                </section>

              </div>
            </TabsContent>
            
            <TabsContent value="original" className="p-0 m-0">
              <div className="p-6 bg-muted/10 opacity-80 pointer-events-none filter grayscale-[20%]">
                <div className="bg-amber-50/50 border border-amber-200 text-amber-800 text-xs p-3 rounded mb-6 flex items-center gap-2">
                  <Lock className="h-4 w-4" />
                  {pc("originalReadOnly")}
                </div>
                
                <div className="space-y-6 divide-y divide-border/40 text-sm">
                  {questionnaire.patientAnswers && Object.entries(questionnaire.patientAnswers).map(([key, value]) => {
                    if (value === null || value === "" || (Array.isArray(value) && value.length === 0)) return null;
                    
                    const displayValue = formatAnswerValue(key as keyof PreConsultAnswers, value);
                    
                    return (
                      <div key={key} className="pt-3 first:pt-0">
                        <span className="font-semibold text-muted-foreground block mb-1 text-xs uppercase">{answerLabels[key as keyof PreConsultAnswers] ?? key}</span>
                        <span className="text-foreground whitespace-pre-wrap">{displayValue}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </Card>
      )}
    </div>
  );
}
