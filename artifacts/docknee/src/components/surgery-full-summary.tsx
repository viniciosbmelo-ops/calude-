import { useState, useEffect, useMemo } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Calendar, Hospital, User, Download, Loader2, CheckCircle2,
  AlertTriangle, Activity, FileText, Microscope, Stethoscope, Brain, ExternalLink,
  FlaskConical,
} from "lucide-react";
import { generateSurgeryPDF } from "@/lib/surgery-pdf";
import { sharePdfOrDownload, handlePdfOpenClick } from "@/lib/pdf-share";
import { SurgeryTextExportDialog } from "@/components/surgery-text-export-dialog";
import { toast } from "sonner";
import { computeBioReadyScore, type BioReadyResult } from "@/lib/regen-bioready";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { surgeryCoreMessages } from "@/locales/surgery-core";
import {
  reportCatalogLabel,
  reportCatalogLabels,
  reportFollowupPeriodLabel,
  reportLesionLabels,
} from "@/locales/reporting-catalogs";
import { getKrirsDisplayJustification, getKrirsRiskLabel, getKrirsRiskLevel } from "@/lib/krirs-risk";
import {
  getLegacyMeniscalDetails,
  getExplicitMeniscalSideDetails,
  hasExplicitMeniscalSideDetails,
  hasMeaningfulMeniscalDetails,
} from "@/lib/meniscal-details";
import { limbHeading, readBilateralDocumentation } from "@/lib/bilateral-surgery";

interface SurgeryFullSummaryProps {
  open: boolean;
  onClose: () => void;
  surgery: any;
  privacyMode?: boolean;
}

function toInitials(nome: string | null | undefined): string {
  if (!nome) return "–";
  return nome.trim().split(/\s+/).map(n => n[0]?.toUpperCase() ?? "").join(". ") + ".";
}

const SUMMARY_LABEL_KEYS: Record<string, string> = {
  "4. Algoritmos Clínicos": "clinicalAlgorithmsSection", "Técnica Principal": "primaryTechnique",
  "5. Técnica Cirúrgica Principal — Ligamento Cruzado Anterior": "mainAclTechnique",
  "5. Procedimentos Realizados": "performedProceduresSection", "Tipo de Cirurgia": "summarySurgeryType",
  "Reparo do LCA": "aclRepair", "Localização da Lesão": "lesionLocation", "Fixação": "fixation",
  "Enxerto": "graft", "Diâmetro do Enxerto": "graftDiameter", "Túnel Femoral": "femoralTunnel",
  "Fixação Femoral": "femoralFixation", "Fixação Tibial": "tibialFixation",
  "Preservação do Remanescente": "preservation", "Reconstrução Extra-Articular": "reinforcement",
  "Procedimentos Realizados": "performedProcedures", "6. Procedimento Meniscal": "meniscalProcedure",
  "Estímulo Biológico": "biologicalStimulus", "Tipo de Procedimento": "procedureType",
  "Contexto": "context", "Menisco Medial": "medialMeniscus", "Menisco Lateral": "lateralMeniscus",
  "Lesão Rampa": "rampLesion", "Raiz Posterior": "posteriorRoot", "Raiz Anterior": "anteriorRoot",
  "Corno Anterior": "anteriorHorn", "Corno Posterior": "posteriorHorn", "Alça de Balde": "bucketHandle",
  "Lesão Radial": "radialLesion", "Lesão Corpo": "bodyLesion", "Técnicas de Sutura": "sutureTechniques",
  "Nº de Pontos": "numberOfStitches", "Pontos/Técnica": "stitchesPerTechnique", "Tipo de Fio": "sutureType",
  "Método de Fixação da Raiz": "rootFixationMethod", "Centralização da Raiz Posterior": "posteriorRootCentralization",
  "Método de Fixação da Centralização": "centralizationFixationMethod",
  "Fratura Periprotética": "periprostheticFracture", "Controle de Danos": "damageControl",
  "Data Controle de Danos": "damageControlDate", "Indicação": "indication",
  "Procedimento (Estágio 1)": "stageOneProcedure", "Data Cirurgia Definitiva": "definitiveSurgeryDate",
  "Acesso ao Fêmur": "femurAccess", "Acesso à Tíbia": "tibiaAccess", "Extensão da Abordagem": "approachExtension",
  "Fratura do Fêmur Distal": "distalFemurFracture", "Fratura do Platô Tibial": "tibialPlateauFracture",
  "Fratura de Patela": "patellaFracture", "Fratura da Espinha Tibial (Eminência Tibial)": "tibialSpineFracture",
  "Classificação (AO/OTA)": "aoOtaClassification", "Classificação (Schatzker)": "schatzkerClassification",
  "Classificação (Meyers & McKeever)": "meyersMcKeeverClassification", "Data da Lesão": "injuryDate",
  "Acesso Cirúrgico": "surgicalAccess", "Cirurgia / Materiais": "surgeryMaterials",
  "Complicações Agudas": "summaryAcuteComplications", "Complicações Tardias": "summaryLateComplications",
  "Lesões Associadas": "associatedLesions", "Observações": "observations", "Técnica": "technique",
  "Material de Sutura": "sutureMaterial", "Rupturas Tendíneas": "tendonRuptures",
  "Localização": "location", "Data da Cirurgia": "surgeryDate", "Acesso": "access",
  "Acesso (outro)": "accessOther", "Técnica (outro)": "techniqueOther",
};

function Row({ label, value }: { label: string; value?: string | number | null }) {
  const t = useScopedTranslations(surgeryCoreMessages);
  const { locale } = useLanguage();
  if (!value && value !== 0) return null;
  return (
    <div className="flex flex-col gap-0.5 py-1.5 border-b border-border/40 last:border-0 sm:flex-row sm:justify-between sm:gap-4">
      <span className="min-w-0 break-words text-sm text-muted-foreground sm:shrink-0">{SUMMARY_LABEL_KEYS[label] ? t(SUMMARY_LABEL_KEYS[label] as any) : label}</span>
      <span className="min-w-0 break-words text-sm font-medium sm:text-right">
        {typeof value === "string" ? reportCatalogLabel(locale, value) : value}
      </span>
    </div>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon?: any; children: React.ReactNode }) {
  const t = useScopedTranslations(surgeryCoreMessages);
  return (
    <div className="space-y-2">
      <div className="flex min-w-0 items-center gap-2 pb-1 border-b-2 border-primary/20">
        {Icon && <Icon className="h-4 w-4 text-primary" />}
        <h3 className="min-w-0 break-words text-sm font-bold uppercase tracking-wide text-primary">{SUMMARY_LABEL_KEYS[title] ? t(SUMMARY_LABEL_KEYS[title] as any) : title}</h3>
      </div>
      <div>{children}</div>
    </div>
  );
}

function parseReforco(reforcoStr: string | null | undefined, t: (key: any) => string): string | null {
  if (!reforcoStr) return null;
  try {
    const r = JSON.parse(reforcoStr);
    const parts: string[] = [];
    if (r.let) parts.push(t("letReinforcement"));
    if (r.lal) {
      let s = t("lalReinforcement");
      if (r.lalBanda) s += ` (${r.lalBanda})`;
      if (r.lalEnxerto) s += ` · ${t("graft")}: ${r.lalEnxerto}`;
      parts.push(s);
    }
    if (r.loa) {
      let s = t("loaReinforcement");
      if (r.loaEnxerto) s += ` · ${t("graft")}: ${r.loaEnxerto}`;
      if (r.loaFixacao) s += ` · ${t("femoralFixation")}: ${r.loaFixacao}`;
      parts.push(s);
    }
    return parts.length > 0 ? parts.join("\n") : null;
  } catch {
    return reforcoStr;
  }
}

const EXAME_LABEL_KEYS: Record<string, string> = {
  lachman: "lachman", gavetaNeutra: "neutralDrawer", pivotShift: "pivotShift",
  aderTest: "aderTest", gavetaRotInterna: "internalRotationDrawer",
  estresseValgo0: "valgusStress0", estresseValgo30: "valgusStress30",
  estresseVaro0: "varusStress0", estresseVaro30: "varusStress30",
  gavetaPosterior: "posteriorDrawer", sagSign: "sagSign",
  quadricepsAtivo: "activeQuadriceps", dialTest: "dialTest", recurvato: "recurvatum",
};

export function SurgeryFullSummary({ open, onClose, surgery, privacyMode = false }: SurgeryFullSummaryProps) {
  const { formatDate, locale } = useLanguage();
  const t = useScopedTranslations(surgeryCoreMessages);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [textPreviewOpen, setTextPreviewOpen] = useState(false);
  const [pdfShareUrl, setPdfShareUrl] = useState<string | null>(null);
  const [regenCase, setRegenCase] = useState<any | null>(null);
  const controlled = (value: string) => reportCatalogLabel(locale, value);
  const controlledList = (values: readonly string[]) => reportCatalogLabels(locale, values).join(", ");

  // Fetch the most recent regen case for this patient (used to compute BioReady Score)
  useEffect(() => {
    if (!open || !surgery?.patientId) { setRegenCase(null); return; }
    const isOrto = (surgery.tiposProcedimento ?? []).includes("Ortobiológicos")
      || surgery.tipoCaso === "Ortobiológicos";
    if (!isOrto) { setRegenCase(null); return; }
    fetch(`${import.meta.env.BASE_URL}api/regen/cases?patientId=${surgery.patientId}`)
      .then(r => r.ok ? r.json() : null)
      .then((data: any[] | null) => {
        if (!data || data.length === 0) { setRegenCase(null); return; }
        // Pick the most recent case (API returns sorted by created_at desc)
        setRegenCase(data[0]);
      })
      .catch(() => setRegenCase(null));
  }, [open, surgery?.patientId, surgery?.tipoCaso, surgery?.tiposProcedimento]);

  const bioReady = useMemo((): BioReadyResult | null => {
    if (!regenCase) return null;
    return computeBioReadyScore({
      activeInfection: regenCase.active_infection !== null ? regenCase.active_infection : undefined,
      malignancy:      regenCase.malignancy !== null ? regenCase.malignancy : undefined,
      dm:              regenCase.dm ?? undefined,
      hba1c:           regenCase.hba1c ?? null,
      imc:             regenCase.imc ? parseFloat(String(regenCase.imc)) : null,
      anticoagulant:   regenCase.anticoagulant ?? false,
      immunosuppressed: regenCase.immunosuppressed ?? false,
      anamnese:        regenCase.anamnese_regen ?? {},
    });
  }, [regenCase]);

  const handleDownloadPDF = async () => {
    if (!surgery) return;
    setPdfLoading(true);
    try {
      const { doc, filename } = await generateSurgeryPDF(surgery, bioReady ?? undefined, locale);
      const result = await sharePdfOrDownload(doc, filename, setPdfShareUrl);
      if (result.deferred) {
        toast.success(t("pdfReady"), { description: t("pdfShareInstruction"), duration: 6000 });
      }
    } finally {
      setPdfLoading(false);
    }
  };

  const handleOpenPDF = () => {
    if (!pdfShareUrl) return;
    handlePdfOpenClick(pdfShareUrl, () => setPdfShareUrl(null));
  };

  if (!surgery) return null;

  const rxAnalysis = surgery.rxAnaliseJson ? (() => {
    try { return JSON.parse(surgery.rxAnaliseJson); } catch { return null; }
  })() : null;

  const dateStr = surgery.dataCirurgia
    ? formatDate(surgery.dataCirurgia, { day: "2-digit", month: "2-digit", year: "numeric" })
    : "—";

  const followups = (surgery.followups ?? []) as any[];
  const exame = surgery.exameLigamentar;
  const examePatelar = surgery.examePatelar;
  const lca = surgery.lcaAlgorithm;
  const pics = surgery.picsScore;
  const menisco = surgery.procedimentoMeniscal;
  const lcpRec = (surgery as any).lcpReconstruction;
  const cpmRec = (surgery as any).cpmReconstruction;
  const cplRec = (surgery as any).cplReconstruction;
  const periprosthetic = (surgery as any).periprostheticFracture;
  const distalFemur = (surgery as any).distalFemurFracture;
  const tibialPlateau = (surgery as any).tibialPlateauFracture;
  const patella = (surgery as any).patellaFracture;
  const tibialSpine = (surgery as any).tibialSpineFracture;
  const reforcoFormatted = parseReforco(surgery.reforco, t);
  const bilateral = surgery.lado === "Bilateral"
    ? readBilateralDocumentation(surgery.procedimentosDetalhados)
    : null;

  const hasExame = exame && Object.keys(exame).some(
    k => !["id", "surgeryId", "createdAt"].includes(k) && exame[k] != null
  );
  const hasExamePatelar = examePatelar && Object.keys(examePatelar).some(
    k => !["id", "surgeryId", "createdAt"].includes(k) && examePatelar[k] != null
  );
  const hasAlgoritmos = lca?.krirsInterpretacao != null || lca?.krirsScore != null || pics?.ptsTotal != null;
  const hasLcaTecnica = !!(surgery.enxerto || surgery.diametroEnxerto || (surgery as any).flipCutter || surgery.fixacaoFemoral ||
    surgery.fixacaoTibial || reforcoFormatted || (surgery as any).internalBrace || (surgery as any).preservacaoRemanescente ||
    ((surgery as any).tipoLca === "Reparo" && ((surgery as any).localizacaoLesaoLca || (surgery as any).fixacaoReparoLca || (surgery as any).internalBrace)));
  const hasProcedimentos = !!(surgery.procedimentoRealizado || (surgery as any).procedimentosDetalhados);
  const hasTecnica = hasLcaTecnica || hasProcedimentos;
  const explicitMeniscalGroups = menisco
    ? (["medial", "lateral"] as const).flatMap((side) => {
        const details = getExplicitMeniscalSideDetails(menisco, side);
        return details ? [{ side, details }] : [];
      })
    : [];
  const meniscalDetailGroups = menisco
    ? hasExplicitMeniscalSideDetails(menisco)
      ? explicitMeniscalGroups
      : [{ side: null, details: getLegacyMeniscalDetails(menisco) }]
    : [];
  const hasMeniscal = menisco && !!(
    menisco.meniscectomia || menisco.sutura || menisco.estimuloBiologico ||
    menisco.dorInterlinha || menisco.mcMurrayMedial || menisco.mcMurrayLateral ||
    menisco.apleyCompressao || menisco.apleyTracao || menisco.marchaPato ||
    menisco.steinmann1 || menisco.steinmann2 || menisco.observacoesExame ||
    menisco.ladoMedial || menisco.ladoLateral ||
    menisco.lesaoRampa || menisco.lesaoRaiz || menisco.lesaoRaizAnterior ||
    menisco.lesaoCornoAnterior || menisco.lesaoCornoPosterior ||
    menisco.lesaoAlcaBalde || menisco.lesaoRadial || menisco.lesaoCorpo ||
    ((menisco.tecnicasSutura as string[] | null)?.length ?? 0) > 0 ||
    !!menisco.contexto ||
    meniscalDetailGroups.some(({ details }) => hasMeaningfulMeniscalDetails(details))
  );
  const isArtroplastia = (surgery.tiposProcedimento ?? []).includes("Artroplastias");

  return (
    <>
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-3xl max-h-[90vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="px-4 sm:px-6 pt-5 pb-3 border-b border-border shrink-0">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
              <DialogTitle className="text-xl">{t("completeSummary")}</DialogTitle>
                <DialogDescription className="sr-only">
                  {t("completeSummaryDescription")}
                </DialogDescription>
              <p className="text-sm text-muted-foreground mt-0.5">
                {privacyMode ? toInitials(surgery.patient?.nome) : surgery.patient?.nome} · {dateStr}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 shrink-0">
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                 onClick={() => setTextPreviewOpen(true)}
              >
                 <FileText className="h-3.5 w-3.5" />
                 {t("downloadTxt")}
              </Button>
              {pdfShareUrl && (
                <Button
                  size="sm"
                  className="gap-1.5 bg-green-600 hover:bg-green-700 text-white animate-in fade-in"
                  onClick={handleOpenPDF}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  {t("openPdf")}
                </Button>
              )}
              <Button
                size="sm"
                className="gap-1.5 bg-[#1A365D] hover:bg-[#1A365D]/90 text-white"
                onClick={handleDownloadPDF}
                disabled={pdfLoading}
              >
                {pdfLoading
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Download className="h-3.5 w-3.5" />
                }
                {pdfLoading ? t("generatingPdf") : t("downloadPdf")}
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="overflow-y-auto flex-1 min-w-0 px-4 sm:px-6 py-4 space-y-6">

          {/* ── 1. Identificação ─────────────────────────────────── */}
          <Section title={`1. ${t("identification")}`} icon={User}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 [&>*]:min-w-0">
              <div>
                <Row label={t("patient")} value={privacyMode ? toInitials(surgery.patient?.nome) : surgery.patient?.nome} />
                <Row label={t("sex")} value={surgery.patient?.sexo} />
                <Row label={t("side")} value={surgery.patient?.lado} />
              </div>
              <div>
                <Row label={t("procedureDate")} value={dateStr} />
                <Row label={t("hospital")} value={surgery.hospital} />
              </div>
            </div>
          </Section>

          {bilateral && (["direito", "esquerdo"] as const).map((limb) => {
            const snapshot = bilateral.byLimb[limb];
            if (!snapshot) return null;
            const compact = (value: unknown) => {
              if (Array.isArray(value)) return value.join(", ");
              if (value && typeof value === "object") {
                return Object.entries(value as Record<string, unknown>)
                  .filter(([key, nested]) => !key.startsWith("_") && nested != null && nested !== "" && nested !== false)
                  .map(([key, nested]) => `${key}: ${Array.isArray(nested) ? nested.join(", ") : typeof nested === "object" ? JSON.stringify(nested) : String(nested)}`)
                  .join(" · ");
              }
              return value == null ? "" : String(value);
            };
            return (
              <Section key={limb} title={limbHeading(limb, locale)} icon={Activity}>
                {Object.entries(snapshot)
                  .filter(([key, value]) => !key.startsWith("_") && value != null && value !== "" && value !== false && (!Array.isArray(value) || value.length > 0))
                  .map(([key, value]) => {
                    if (key === "examePatelar" && value && typeof value === "object" && !Array.isArray(value)) {
                      const exam = value as Record<string, any>;
                      return (
                        <div key={key} className="py-1.5 border-b border-border/40">
                          <p className="text-sm font-semibold text-primary mb-1">{t("patellarExam")}</p>
                          {exam.jSign != null && <Row label={t("jSign")} value={exam.jSign ? t("positive") : t("negative")} />}
                          {exam.jSign === true && exam.jSignGrau != null && (
                            <Row label={t("jSignGrade")} value={Number(exam.jSignGrau)} />
                          )}
                          {Object.entries(exam)
                            .filter(([examKey, examValue]) => (
                              !["id", "surgeryId", "createdAt", "jSign", "jSignGrau"].includes(examKey)
                              && examValue != null
                              && examValue !== ""
                              && examValue !== false
                            ))
                            .map(([examKey, examValue]) => (
                              <Row key={examKey} label={examKey.replace(/([A-Z])/g, " $1")} value={compact(examValue)} />
                            ))}
                        </div>
                      );
                    }
                    return <Row key={key} label={key.replace(/([A-Z])/g, " $1")} value={compact(value)} />;
                  })}
              </Section>
            );
          })}

          {/* ── 2. Classificação ──────────────────────────────────── */}
          {!bilateral && <Section title={`2. ${t("classification")}`} icon={FileText}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 [&>*]:min-w-0">
              <div>
                <Row label={t("caseType")} value={surgery.tipoCaso} />
                {surgery.diagnostico && <Row label={t("diagnosis")} value={surgery.diagnostico} />}
                <Row label={t("alignment")} value={surgery.alinhamento} />
                <Row label={t("alignmentDegree")} value={surgery.grauAlinhamento} />
              </div>
              <div>
                {(surgery.tiposProcedimento ?? []).length > 0 && (
                  <div className="py-1.5">
                    <p className="text-sm text-muted-foreground mb-1.5">{t("procedures")}</p>
                    <div className="flex flex-wrap gap-1">
                      {(surgery.tiposProcedimento ?? []).map((p: string) => (
                        <Badge key={p} variant="outline" className="bg-primary/5 text-primary border-primary/20">{controlled(p)}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                {(surgery.ligamentosAcometidos ?? []).length > 0 && (
                  <div className="py-1.5 border-t border-border/40">
                    <p className="text-sm text-muted-foreground mb-1.5">{t("affectedLigaments")}</p>
                    <div className="flex flex-wrap gap-1">
                      {surgery.ligamentosAcometidos.map((l: string) => (
                        <Badge key={l}>{l === "PLC" ? "CPL" : l}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Section>}

          {/* ── BioReady Score® ──────────────────────────────────── */}
          {bioReady && (
            <Section title={t("bioReadyTitle")} icon={FlaskConical}>
              <div className="space-y-3">
                {/* Score badge */}
                <div
                  className="flex items-center gap-4 rounded-xl px-4 py-3 border-2"
                  style={{ backgroundColor: bioReady.gradeBg, borderColor: bioReady.gradeColor + "40" }}
                >
                  <div
                    className="text-4xl font-black tabular-nums leading-none"
                    style={{ color: bioReady.gradeColor }}
                  >
                    {bioReady.score}
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">BioReady Score®</p>
                    <p className="text-sm font-bold mt-0.5" style={{ color: bioReady.gradeColor }}>
                      {bioReady.gradeLabel}
                    </p>
                    {bioReady.isIncomplete && (
                      <p className="text-[10px] text-amber-600 mt-0.5">{t("insufficientData")}</p>
                    )}
                  </div>
                  <div className="ml-auto text-right">
                    <p className="text-[10px] text-muted-foreground">{t("complete")}</p>
                    <p className="text-sm font-bold">{Math.round(bioReady.dataCompleteness * 100)}%</p>
                  </div>
                </div>

                {/* Fatores — compact grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 [&>*]:min-w-0">
                  {bioReady.factors.map(f => (
                    <div key={f.id} className="flex items-center gap-2 py-1 px-2 rounded-md bg-muted/30">
                      <span className={`h-2 w-2 rounded-full shrink-0 ${
                        f.status === "green" ? "bg-emerald-500"
                        : f.status === "yellow" ? "bg-amber-500"
                        : f.status === "red" ? "bg-red-500"
                        : "bg-gray-300"
                      }`} />
                      <span className="text-xs text-muted-foreground truncate flex-1">{f.label}</span>
                      <span className="text-xs font-bold tabular-nums">{f.status === "na" ? "—" : `${f.score}/10`}</span>
                    </div>
                  ))}
                </div>

                {/* Top recommendations */}
                {bioReady.topRecommendations.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("optimizationPriorities")}</p>
                    {bioReady.topRecommendations.map((r, i) => (
                      <div key={i} className="flex items-start gap-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5 leading-snug">
                        <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5 text-amber-600" />
                        {r}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Section>
          )}

          {!bilateral && <>
          {/* ── 3. Exame Físico Ligamentar ────────────────────────── */}
          {hasExame && (
            <Section title={`3. ${t("physicalExam")}`} icon={Stethoscope}>
              {exame.hiperextensao && exame.hiperextensao !== "<5" && exame.hiperextensao !== "normal" && (
                <div className={`flex items-center justify-between px-3 py-2 rounded-lg border mb-3 ${
                  (exame.hiperextensao === ">6.5" || exame.hiperextensao === ">7.5")
                    ? "bg-red-50 border-red-300 text-red-800"
                    : "bg-amber-50 border-amber-300 text-amber-800"
                }`}>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide">{t("kneeHyperextension")}</p>
                    <p className="text-sm font-semibold mt-0.5">
                      {(exame.hiperextensao === "5-6.5" || exame.hiperextensao === "5-7.5") && t("borderlineHyperextension")}
                      {(exame.hiperextensao === ">6.5" || exame.hiperextensao === ">7.5") && t("hyperlaxity")}
                    </p>
                    {(exame.hiperextensao === ">6.5" || exame.hiperextensao === ">7.5") && (
                      <p className="text-xs mt-1 font-medium flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        {t("lateralTenodesisIndicated")}
                      </p>
                    )}
                  </div>
                </div>
              )}
              {exame.hiperextensao === "<5" && (
                <div className="mb-1">
                  <Row label={t("kneeHyperextension")} value={t("normalHyperextension")} />
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 [&>*]:min-w-0">
                {/* LCA-specific */}
                {exame.lachman != null && <Row label={t("lachman")} value={String(exame.lachman)} />}
                {exame.gavetaNeutra != null && <Row label={t("neutralDrawer")} value={String(exame.gavetaNeutra)} />}
                {exame.pivotShift != null && <Row label={t("pivotShift")} value={String(exame.pivotShift)} />}
                {lca?.esportePivot != null && (
                  <Row label={t("pivotSports")} value={lca.esportePivot ? t("yes") : t("no")} />
                )}
                {/* Others */}
                {Object.entries(exame).map(([k, v]) => {
                  if (["id", "surgeryId", "hiperextensao", "createdAt", "lachman", "gavetaNeutra", "pivotShift"].includes(k) || v == null) return null;
                  const label = EXAME_LABEL_KEYS[k] ? t(EXAME_LABEL_KEYS[k] as any) : k.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase()).trim();
                  return (
                    <Row
                      key={k}
                      label={label}
                      value={typeof v === "boolean" ? (v ? t("positive") : t("negative")) : String(v)}
                    />
                  );
                })}
              </div>
            </Section>
          )}

          {hasExamePatelar && (
            <Section title={t("patellarExam")} icon={Activity}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 [&>*]:min-w-0">
                {Object.entries(examePatelar).map(([key, value]) => {
                  if (["id", "surgeryId", "createdAt", "jSignGrau"].includes(key) || value == null) return null;
                  const label = key === "jSign"
                    ? t("jSign")
                    : key.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase()).trim();
                  return (
                    <Row
                      key={key}
                      label={label}
                      value={typeof value === "boolean" ? (value ? t("positive") : t("negative")) : String(value)}
                    />
                  );
                })}
                {examePatelar.jSign === true && examePatelar.jSignGrau != null && (
                  <Row label={t("jSignGrade")} value={Number(examePatelar.jSignGrau)} />
                )}
              </div>
            </Section>
          )}

          {/* ── 4. Algoritmos Clínicos ────────────────────────────── */}
          {hasAlgoritmos && (
            <Section title={`4. ${t("clinicalAlgorithms")}`} icon={Brain}>
              <div className="space-y-3">
                {(lca?.krirsInterpretacao != null || lca?.krirsScore != null) && (() => {
                  const instabAM = exame?.aderTest === true;
                  const instabAL = exame?.gavetaRotInterna === true || (lca.pivotShift ?? 0) >= 2;
                  const riskLevel = getKrirsRiskLevel(lca.krirsScore, lca.flagAltoRisco, lca.krirsInterpretacao);
                  return (
                    <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 space-y-1.5">
                      <div className="flex items-center gap-3">
                        <p className="text-xs font-bold text-primary uppercase tracking-wide">KRIRS — LCA</p>
                        <span className="text-sm font-black text-primary">{getKrirsRiskLabel(riskLevel, locale)}</span>
                      </div>
                      <Row label={t("primaryTechnique")} value={lca.tecnicaRecomendada} />
                      {lca.justificativa && (
                        <p className="text-xs text-muted-foreground italic leading-snug">
                          {getKrirsDisplayJustification(lca.justificativa, riskLevel, locale)}
                        </p>
                      )}
                      {(instabAM || instabAL) && (
                        <div className="space-y-1 pt-0.5">
                          {instabAM && instabAL && (
                            <p className="text-xs font-semibold text-red-700 flex items-start gap-1.5">
                              <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                              {t("combinedInstabilityRecommendation")}
                            </p>
                          )}
                          {instabAM && !instabAL && (
                            <p className="text-xs font-semibold text-amber-700 flex items-start gap-1.5">
                              <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                              {t("anteromedialInstabilityRecommendation")}
                            </p>
                          )}
                          {!instabAM && instabAL && (
                            <p className="text-xs font-semibold text-blue-700 flex items-start gap-1.5">
                              <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                              {t("anterolateralInstabilityRecommendation")}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}
                {pics?.ptsTotal != null && (
                  <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 space-y-1.5">
                    <div className="flex items-center gap-3">
                      <p className="text-xs font-bold text-primary uppercase tracking-wide">{t("patellarScore")}</p>
                      <span className="text-lg font-black text-primary">{pics.ptsTotal}</span>
                      <span className="text-xs text-muted-foreground">{t("points")}</span>
                    </div>
                    <Row label={t("risk")} value={pics.ptsRisco} />
                    <Row label={t("conduct")} value={pics.ptsConduta} />
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* ── 5. Técnica Cirúrgica Principal ───────────────────── */}
          {hasTecnica && (
            <Section title={hasLcaTecnica ? `5. ${t("mainTechnique")} — ${t("anteriorCruciateLigament")}` : `5. ${t("performedProcedures")}`} icon={Activity}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 [&>*]:min-w-0">
                <div>
                  {(surgery as any).tipoLca === "Reparo" ? (
                    <>
                      <Row label={t("summarySurgeryType")} value={t("aclRepair")} />
                      <Row label={t("lesionLocation")} value={(surgery as any).localizacaoLesaoLca} />
                      <Row label={t("fixation")} value={(surgery as any).fixacaoReparoLca} />
                      <Row label={t("internalBrace")} value={(surgery as any).internalBrace} />
                    </>
                  ) : (
                    <>
                      <Row label={t("graft")} value={surgery.enxerto} />
                      <Row label={t("graftDiameter")} value={surgery.diametroEnxerto} />
                       <Row label={t("flipCutter")} value={(surgery as any).flipCutter} />
                      <Row label={t("femoralTunnel")} value={(surgery as any).tunelFemoral} />
                      <Row label={t("femoralFixation")} value={surgery.fixacaoFemoral} />
                      <Row label={t("tibialFixation")} value={surgery.fixacaoTibial} />
                      <Row label={t("internalBrace")} value={(surgery as any).internalBrace} />
                      <Row label={t("preservation")} value={(surgery as any).preservacaoRemanescente} />
                    </>
                  )}
                </div>
                <div>
                  {/* Extra-articular reconstruction */}
                  {reforcoFormatted && (
                    <div className="py-1.5">
                      <p className="text-sm text-muted-foreground mb-1.5">{t("reinforcement")}</p>
                      {reforcoFormatted.split("\n").map((line, i) => (
                        <div key={i} className="flex items-start gap-1.5 mb-1">
                          <CheckCircle2 className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
                          <span className="text-sm font-medium">{line}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {surgery.procedimentoRealizado && (
                    <div className="py-1.5 border-t border-border/40 mt-1">
                      <p className="text-sm text-muted-foreground mb-1">{t("performedProcedures")}</p>
                      <p className="text-sm bg-muted/30 rounded-md p-2.5 whitespace-pre-wrap leading-relaxed">
                        {surgery.procedimentoRealizado}
                      </p>
                    </div>
                  )}
                </div>
              </div>
              {/* procedimentosDetalhados — osteotomia/ortobio */}
              {(surgery as any).procedimentosDetalhados && (() => {
                try {
                  const d = JSON.parse((surgery as any).procedimentosDetalhados);
                  const ost = d.osteotomia;
                  const ostParts: string[] = [];
                  if (ost?.tibial) {
                    let s = t("tibialOsteotomy");
                    if (ost.tibialLado) s += ` ${controlled(ost.tibialLado)}`;
                    if (ost.tibialTipo) s += ` ${t("osteotomyTypeConnector", { value: controlled(ost.tibialTipo) })}`;
                    if (ost.tibialAngulo) s += ` — ${ost.tibialAngulo}°`;
                    ostParts.push(s);
                  } else if (ost?.tibialAberturaMedial) {
                    ostParts.push(t("medialOpeningTibialOsteotomy"));
                  }
                  if (ost?.femoral) {
                    let s = t("femoralOsteotomy");
                    if (ost.femoralLado) s += ` ${controlled(ost.femoralLado)}`;
                    if (ost.femoralTipo) s += ` ${t("osteotomyTypeConnector", { value: controlled(ost.femoralTipo) })}`;
                    if (ost.femoralAngulo) s += ` — ${ost.femoralAngulo}°`;
                    ostParts.push(s);
                  }
                  if (ost?.dupla) {
                    const tibPart = [ost.duplaTibialLado && controlled(ost.duplaTibialLado), ost.duplaTibialTipo && t("osteotomyTypeConnector", { value: controlled(ost.duplaTibialTipo) }), ost.duplaTibialAngulo && `${ost.duplaTibialAngulo}°`].filter(Boolean).join(" ");
                    const femPart = [ost.duplaFemoralLado && controlled(ost.duplaFemoralLado), ost.duplaFemoralTipo && t("osteotomyTypeConnector", { value: controlled(ost.duplaFemoralTipo) }), ost.duplaFemoralAngulo && `${ost.duplaFemoralAngulo}°`].filter(Boolean).join(" ");
                    ostParts.push(`${t("doubleOsteotomy")}${tibPart ? ` — ${t("tibialPrefix", { value: tibPart })}` : ""}${femPart ? ` / ${t("femoralPrefix", { value: femPart })}` : ""}`);
                  }
                  if (ost?.slop) {
                    let s = t("tibialSlopeCorrection");
                    if (ost.slopGrau) s += ` — ${ost.slopGrau}°`;
                    ostParts.push(s);
                  }
                  if (ost?.enxertoOsseo) {
                    let s = t("associatedBoneGraft");
                    if (ost.enxertoOsseoTipo) s += `: ${ost.enxertoOsseoTipo}`;
                    ostParts.push(s);
                  }
                  const ortoParts: string[] = [];
                  const ortoMap: Record<string, string> = {
                    bma: "BMA", ha: t("hyaluronicAcid"), prp: "PRP",
                    hidrogel: "Hidrogel", nanofat: "Nanofat",
                  };
                  if (d.ortobiologico) {
                    Object.entries(ortoMap).forEach(([k, label]) => { if (d.ortobiologico[k]) ortoParts.push(label); });
                  }
                  const orto = d.ortobiologico as any;
                  const diagTipo: Record<string, string> = {
                    osteoartrose: t("osteoarthritis"), condromalacia: t("patellarChondromalacia"),
                    lesaoMeniscal: t("meniscalLesion"), lesaoLigamentar: t("ligamentLesion"),
                    lesaoMuscular: t("muscleLesion"), edemaOsseo: t("osteochondralLesion"),
                  };
                  // Suporta tanto array (novo) quanto string (legado)
                  const diagTiposArr: string[] = Array.isArray(orto?.diagnosticoTipos)
                    ? orto.diagnosticoTipos
                    : orto?.diagnosticoTipo ? [orto.diagnosticoTipo] : [];
                  const ortodiagParts = diagTiposArr.map((tipo: string) => {
                    let label = diagTipo[tipo] || tipo;
                    if (tipo === "osteoartrose" && orto?.diagnosticoAhlback) label += ` — ${t("ahlbackGrade", { grade: orto.diagnosticoAhlback })}`;
                    if (tipo === "lesaoLigamentar" && orto?.diagnosticoLigamento) label += ` — ${orto.diagnosticoLigamento}`;
                    if (tipo === "edemaOsseo" && orto?.diagnosticoEdemaLocal) label += ` — ${orto.diagnosticoEdemaLocal}`;
                    return label;
                  });
                  const ortodiag = ortodiagParts.join(", ");
                  const lcm = d.lcm as { tecnica?: string; enxerto?: string; fixacaoProximal?: string; fixacaoDistal?: string } | undefined;
                  const hasLcm = lcm && (lcm.tecnica || lcm.enxerto || lcm.fixacaoProximal || lcm.fixacaoDistal);
                  const outrosProcs: string[] = Array.isArray(d.outrosProcedimentos) ? d.outrosProcedimentos : [];
                  const fraturasProcs: string[] = Array.isArray(d.fraturas) ? d.fraturas : [];
                  if (ostParts.length === 0 && ortoParts.length === 0 && outrosProcs.length === 0 && fraturasProcs.length === 0 && !hasLcm && !ortodiag) return null;
                  return (
                    <div className="mt-3 pt-3 border-t border-border/40 space-y-3">
                      {hasLcm && (
                        <div>
                          <p className="text-sm text-muted-foreground mb-1">{t("lcmTechnique")}</p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-1 [&>*]:min-w-0">
                            {lcm!.tecnica && <p className="text-sm font-medium"><span className="text-muted-foreground text-xs">{t("technique")}: </span>{lcm!.tecnica}</p>}
                            {lcm!.enxerto && <p className="text-sm font-medium"><span className="text-muted-foreground text-xs">{t("graft")}: </span>{lcm!.enxerto}</p>}
                            {lcm!.fixacaoProximal && <p className="text-sm font-medium"><span className="text-muted-foreground text-xs">{t("proximalFixation")}: </span>{lcm!.fixacaoProximal}</p>}
                            {lcm!.fixacaoDistal && <p className="text-sm font-medium"><span className="text-muted-foreground text-xs">{t("distalFixation")}: </span>{lcm!.fixacaoDistal}</p>}
                          </div>
                        </div>
                      )}
                      {(ostParts.length > 0 || ortoParts.length > 0) && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 [&>*]:min-w-0">
                          {ostParts.length > 0 && (
                            <div>
                              <p className="text-sm text-muted-foreground mb-1">{t("osteotomy")}</p>
                              {ostParts.map((s, i) => <p key={i} className="text-sm font-medium">{s}</p>)}
                            </div>
                          )}
                          {ortoParts.length > 0 && (
                            <div>
                              <p className="text-sm text-muted-foreground mb-1">{t("orthobiologics")}</p>
                              <p className="text-sm font-medium">{ortoParts.join(", ")}</p>
                              {ortodiag && (
                                <p className="text-xs text-muted-foreground mt-0.5">{t("diagnosisPrefix")} <span className="font-medium text-foreground">{ortodiag}</span></p>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      {outrosProcs.length > 0 && (
                        <div>
                          <p className="text-sm text-muted-foreground mb-1">{t("otherProcedures")}</p>
                          <p className="text-sm font-medium">{controlledList(outrosProcs)}</p>
                        </div>
                      )}
                      {fraturasProcs.length > 0 && (
                        <div>
                          <p className="text-sm text-muted-foreground mb-1">{t("fractures")}</p>
                          <p className="text-sm font-medium">{controlledList(fraturasProcs)}</p>
                        </div>
                      )}
                    </div>
                  );
                } catch { return null; }
              })()}
            </Section>
          )}

          {/* ── 5c. CPM (Canto Póstero-Medial) ─────────────────────── */}
          {cpmRec && (cpmRec.abordagem || cpmRec.lcmTecnica || cpmRec.lcmReparoTecnica || cpmRec.lopTecnica) && (
            <Section title={t("cpmTitle")} icon={Activity}>
              {/* Abordagem badge */}
              {cpmRec.abordagem && (
                <p className="text-xs font-semibold px-2 py-1 rounded bg-primary/8 text-primary inline-block mb-3">
                  {cpmRec.abordagem === "lcm_isolado"  && t("cpmApproachIsolated")}
                  {cpmRec.abordagem === "lcm_lop"      && t("cpmApproachLop")}
                  {cpmRec.abordagem === "reparo_lcm"   && t("cpmApproachRepair")}
                  {cpmRec.abordagem === "recon_reparo" && t("cpmApproachReconstructionRepair")}
                </p>
              )}

              {/* Reconstrução LCM */}
              {(cpmRec.lcmTecnica || cpmRec.lcmEnxerto || cpmRec.lcmFixacaoProximal || cpmRec.lcmFixacaoDistal) && (
                <div className="mb-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-primary mb-2">
                    {t("lcmReconstruction")}{cpmRec.abordagem === "recon_reparo" ? t("reconstructiveComponent") : ""}
                  </p>
                  <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
                    {[
                      [t("technique"), cpmRec.lcmTecnica === "Outra" ? cpmRec.lcmTecnicaCustom : cpmRec.lcmTecnica],
                      [t("graft"), cpmRec.lcmEnxerto],
                      [t("proximalFixation"), cpmRec.lcmFixacaoProximal],
                      [t("distalFixation"), cpmRec.lcmFixacaoDistal],
                    ].filter(([, v]) => v).map(([label, value]) => (
                      <div key={label} className="flex gap-1">
                        <span className="text-muted-foreground">{label}:</span>
                        <span className="font-semibold">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Reparo LCM */}
              {cpmRec.lcmReparoTecnica && (
                <div className="mb-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-primary mb-2">
                    {t("lcmRepair")}{cpmRec.abordagem === "recon_reparo" ? t("reinforcementComponent") : ""}
                  </p>
                  <div className="flex gap-1 text-sm">
                    <span className="text-muted-foreground">{t("technique")}:</span>
                    <span className="font-semibold">
                      {cpmRec.lcmReparoTecnica === "Outra" ? cpmRec.lcmReparoTecnicaCustom : cpmRec.lcmReparoTecnica}
                    </span>
                  </div>
                </div>
              )}

              {/* LOP */}
              {(cpmRec.lopTecnica || cpmRec.lopEnxerto || cpmRec.lopFixacao) && (
                <div className="mb-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-primary mb-2">{t("lopTitle")}</p>
                  <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
                    {[
                      [t("technique"), cpmRec.lopTecnica === "Outra" ? cpmRec.lopTecnicaCustom : cpmRec.lopTecnica],
                      [t("graft"), cpmRec.lopEnxerto],
                      [t("fixation"), cpmRec.lopFixacao],
                    ].filter(([, v]) => v).map(([label, value]) => (
                      <div key={label} className="flex gap-1">
                        <span className="text-muted-foreground">{label}:</span>
                        <span className="font-semibold">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {cpmRec.justificativa && (
                <p className="text-sm text-muted-foreground border-t pt-2 mt-2">{cpmRec.justificativa}</p>
              )}
            </Section>
          )}

          {/* ── 5d. Reconstrução do CPL ───────────────────────────── */}
          {cplRec && (cplRec.tecnica || (cplRec.enxertos?.length > 0)) && (
            <Section title={t("cplTitle")} icon={Activity}>
              {cplRec.tecnica && (
                <div className="flex items-start gap-3 px-3 py-2.5 rounded-lg border border-primary/30 bg-primary/5 mb-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-primary">{t("technique")}</p>
                    <p className="text-sm font-semibold mt-0.5">
                      {cplRec.tecnica === "Laprade" && t("lapradeTechnique")}
                      {cplRec.tecnica === "Arcieiro" && t("arcieiroTechnique")}
                      {cplRec.tecnica === "Fanelli" && t("fanelliTechnique")}
                    </p>
                  </div>
                </div>
              )}
              {cplRec.enxertos?.filter((e: any) => e.nome).length > 0 && (
                <div className="mb-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">{t("grafts")}</p>
                  <div className="flex flex-wrap gap-2">
                    {cplRec.enxertos.filter((e: any) => e.nome).map((e: any, i: number) => (
                      <span key={i} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-muted text-sm font-medium border">
                        {e.nome}{e.diametro ? ` — Ø ${e.diametro}` : ""}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
                {[
                  [t("femoralFixationOne"), cplRec.fixacaoFemoral1],
                  [t("femoralFixationTwo"), cplRec.fixacaoFemoral2],
                  [cplRec.tecnica === "Laprade" ? t("fibularFixationLaprade") : t("fibularFixation"), cplRec.fixacaoFibular],
                  [t("tibialFixationLpf"), cplRec.fixacaoTibial],
                ].filter(([, v]) => v).map(([label, value]) => (
                  <div key={label} className="flex gap-1">
                    <span className="text-muted-foreground">{label}:</span>
                    <span className="font-semibold">{value}</span>
                  </div>
                ))}
              </div>
              {cplRec.reaAssociada && (
                <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg border border-emerald-300 bg-emerald-50 text-sm">
                  <span className="font-semibold text-emerald-700">{t("associatedRea")}</span>
                  <span className="font-bold text-emerald-800">
                    {cplRec.reaTipo === "LAL" && t("lalAssociatedRea")}
                    {cplRec.reaTipo === "LET" && t("letAssociatedRea")}
                    {!cplRec.reaTipo && t("unspecifiedType")}
                  </span>
                </div>
              )}
              {cplRec.justificativa && (
                <div className="mt-3 bg-muted/30 rounded-lg px-3 py-2 text-sm">
                  <span className="text-muted-foreground font-medium">{t("justificationPrefix")} </span>
                  <span>{cplRec.justificativa}</span>
                </div>
              )}
            </Section>
          )}

          {/* ── 5b. Reconstrução do LCP ───────────────────────────── */}
          {lcpRec && (lcpRec.grauLesao || lcpRec.tecnica || lcpRec.enxerto || lcpRec.flipCutter) && (
            <Section title={t("lcpTitle")} icon={Activity}>
              {/* Grade alert */}
              {lcpRec.grauLesao && (
                <div className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border mb-3 ${
                  lcpRec.grauLesao === "III" ? "bg-red-50 border-red-300 text-red-800"
                  : lcpRec.grauLesao === "II" ? "bg-amber-50 border-amber-300 text-amber-800"
                  : "bg-green-50 border-green-300 text-green-800"
                }`}>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide">{t("lcpInjuryGrade")}</p>
                    <p className="text-sm font-semibold mt-0.5">
                      {lcpRec.grauLesao === "I" && t("lcpGradeI")}
                      {lcpRec.grauLesao === "II" && t("lcpGradeII")}
                      {lcpRec.grauLesao === "III" && t("lcpGradeIII")}
                    </p>
                  </div>
                </div>
              )}
              <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
                {[
                  [t("technique"), lcpRec.tecnica],
                  [t("approach"), lcpRec.abordagem],
                  [t("graft"), lcpRec.enxerto],
                  [t("graftDiameter"), lcpRec.diametroEnxerto],
                   [t("flipCutter"), lcpRec.flipCutter],
                  [t("femoralFixation"), lcpRec.fixacaoFemoral],
                  [t("tibialFixation"), lcpRec.fixacaoTibial],
                  [t("anteromedialFixation"), lcpRec.fixacaoAnteromedial],
                  [t("posterolateralFixation"), lcpRec.fixacaoPosterolateral],
                ].filter(([, v]) => v).map(([label, value]) => (
                  <div key={label} className="flex gap-1">
                    <span className="text-muted-foreground">{label}:</span>
                    <span className="font-semibold">{value}</span>
                  </div>
                ))}
              </div>
              {lcpRec.justificativa && (
                <div className="mt-3 bg-muted/30 rounded-lg px-3 py-2 text-sm">
                  <span className="text-muted-foreground font-medium">{t("justificationPrefix")} </span>
                  <span>{lcpRec.justificativa}</span>
                </div>
              )}
            </Section>
          )}

          {/* ── 6. Procedimento Meniscal ──────────────────────────── */}
          {hasMeniscal && !isArtroplastia && (
            <Section title={`6. ${t("meniscalProcedure")}`} icon={Activity}>
              <div className="space-y-4">
                {(() => {
                  const examLabels: Record<string, string> = {
                    contexto: "Contexto",
                    dorInterlinha: "Dor à Palpação da Interlinha",
                    mcMurrayMedial: "McMurray Medial",
                    mcMurrayLateral: "McMurray Lateral",
                    apleyCompressao: "Apley Compressão",
                    apleyTracao: "Apley Tração",
                    marchaPato: "Marcha do Pato",
                    steinmann1: "Steinmann I",
                    steinmann2: "Steinmann II",
                    observacoesExame: "Observações do Exame",
                  };
                  const rows = Object.entries(examLabels).flatMap(([key, label]) => {
                    const value = menisco[key];
                    if (value == null || value === false || value === "") return [];
                    return [(
                      <Row
                        key={`exam-${key}`}
                        label={label}
                        value={typeof value === "boolean" ? t("yes") : String(value)}
                      />
                    )];
                  });
                  return rows.length > 0
                    ? <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 [&>*]:min-w-0">{rows}</div>
                    : null;
                })()}
                {meniscalDetailGroups.map(({ side, details }, groupIndex) => {
                  const tipoProcedimento = details.sutura && details.meniscectomia
                    ? t("meniscalSuturePartialMeniscectomy")
                    : details.sutura
                    ? t("meniscalSuture")
                    : details.meniscectomia
                    ? t("meniscectomy")
                    : null;
                  const biologicalDetails = details.estimuloBiologico
                    ? [
                        details.estimuloPerfuracaoIntercondilo && t("intercondylarPerforation"),
                        details.estimuloCoaguloFibrina && "Coágulo de Fibrina",
                        details.estimuloOrtobiologico &&
                          (details.estimuloOrtobiologicoTipo
                            ? t("orthobiologicPrefix", { value: details.estimuloOrtobiologicoTipo })
                            : t("orthobiologic")),
                      ].filter(Boolean).join(" · ") || t("yes")
                    : null;
                  const labelMap: Record<string, string> = {
                    lesaoRampa: "Lesão Rampa", lesaoRaiz: "Raiz Posterior",
                    lesaoRaizAnterior: "Raiz Anterior", lesaoCornoAnterior: "Corno Anterior",
                    lesaoCornoPosterior: "Corno Posterior", lesaoAlcaBalde: "Alça de Balde",
                    lesaoRadial: "Lesão Radial", lesaoCorpo: "Lesão Corpo",
                    lesaoDiscoide: "Menisco Discoide", tecnicasSutura: "Técnicas de Sutura",
                    numPontos: "Nº de Pontos", pontosPorTecnica: "Pontos/Técnica",
                    tipoFio: "Tipo de Fio", fixacaoRaiz: "Método de Fixação da Raiz",
                    centralizacaoRaiz: "Centralização da Raiz Posterior",
                    centralizacaoMetodo: "Método de Fixação da Centralização",
                    saucerizacao: "Saucerização",
                  };
                  const SKIP = [
                    "estimuloBiologico", "estimuloPerfuracaoIntercondilo",
                    "estimuloCoaguloFibrina", "estimuloOrtobiologico",
                    "estimuloOrtobiologicoTipo", "meniscectomia",
                  ];

                  return (
                    <div key={side ?? `legacy-${groupIndex}`} className="rounded-lg border p-3">
                      {side && (
                        <p className="mb-2 text-sm font-semibold text-primary">
                          {controlledList([side === "medial" ? "Menisco Medial" : "Menisco Lateral"])}
                        </p>
                      )}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 [&>*]:min-w-0">
                        {tipoProcedimento && <Row label={t("procedureType")} value={tipoProcedimento} />}
                        {biologicalDetails && <Row label={t("biologicalStimulus")} value={biologicalDetails} />}
                        {Object.entries(details).flatMap(([k, v]) => {
                          if (SKIP.includes(k) || v == null || v === false || v === "") return [];
                          if (k === "pontosPorTecnica") {
                            try {
                              const parsed: Record<string, number> = typeof v === "string" ? JSON.parse(v) : (v as any);
                              return Object.entries(parsed).flatMap(([tecnica, pontos]) => [
                                <Row key={`${side}-${k}-tecnica-${tecnica}`} label={t("technique")} value={tecnica} />,
                                <Row key={`${side}-${k}-pontos-${tecnica}`} label={t("numberOfStitches")} value={String(pontos)} />,
                              ]);
                            } catch {
                              return [<Row key={`${side}-${k}`} label={t("stitchesPerTechnique")} value={String(v)} />];
                            }
                          }
                          const label = labelMap[k] ?? k.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase()).trim();
                          const displayValue = Array.isArray(v)
                            ? controlledList((v as any[]).map(String))
                            : typeof v === "boolean" ? (v ? t("yes") : t("no"))
                            : String(v);
                          return [<Row key={`${side}-${k}`} label={label} value={displayValue} />];
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {/* ── Fratura Periprotética ────────────────────────────── */}
          {periprosthetic && (
            <Section title={t("periprostheticFracture")} icon={AlertTriangle}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 [&>*]:min-w-0">
                <div>
                  <Row label={t("femurClassification")} value={periprosthetic.classificacaoFemur} />
                  <Row label={t("tibiaClassification")} value={periprosthetic.classificacaoTibia} />
                  <Row label={t("patellaClassification")} value={periprosthetic.classificacaoPatela} />
                  <Row label={t("patellarBoneStock")} value={periprosthetic.estoquePatelarMm} />
                </div>
                <div>
                  <Row label={t("damageControl")} value={periprosthetic.controleDanos ? t("yes") : t("no")} />
                  {periprosthetic.controleDanos && (
                    <>
                      <Row label={t("damageControlDate")} value={periprosthetic.controleDanosData} />
                      <Row label={t("indication")} value={controlledList(periprosthetic.controleDanosIndicacao ?? []) || undefined} />
                      <Row label={t("stageOneProcedure")} value={controlledList(periprosthetic.controleDanosProcedimento ?? []) || undefined} />
                      <Row label={t("definitiveSurgeryDate")} value={periprosthetic.definitivaData} />
                    </>
                  )}
                </div>
              </div>
              {(periprosthetic.acessoFemur?.length > 0 || periprosthetic.acessoTibia?.length > 0) && (
                <div className="pt-2">
                  <Row label={t("femurAccess")} value={controlledList(periprosthetic.acessoFemur ?? []) || undefined} />
                  <Row label={t("tibiaAccess")} value={controlledList(periprosthetic.acessoTibia ?? []) || undefined} />
                  <Row label={t("approachExtension")} value={periprosthetic.extensaoAbordagem ? (periprosthetic.extensaoAbordagemTipo || t("yes")) : undefined} />
                </div>
              )}
              {Array.isArray(periprosthetic.localizacao) && periprosthetic.localizacao.length > 0 && (
                <div className="pt-2">
                  <p className="text-sm text-muted-foreground mb-1.5">{t("injuryLocations")}</p>
                  <div className="space-y-1">
                    {periprosthetic.localizacao.map((l: any, i: number) => (
                      <div key={i} className="text-sm">{[l.estrutura, l.lado, l.classificacao, l.tipo].filter(Boolean).join(" · ")}</div>
                    ))}
                  </div>
                </div>
              )}
              {Array.isArray(periprosthetic.opme) && periprosthetic.opme.length > 0 && (
                <div className="pt-2">
                  <p className="text-sm text-muted-foreground mb-1.5">{t("surgeryMaterials")}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(periprosthetic.opme as any[]).map((item: any, i: number) => (
                      <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                        {typeof item === "string" ? item : [item.categoria, item.item, item.tamanho].filter(Boolean).join(" · ")}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {Array.isArray(periprosthetic.complicacoesAgudas) && periprosthetic.complicacoesAgudas.length > 0 && (
                <div className="pt-2">
                  <p className="text-sm text-muted-foreground mb-1.5">{t("acuteComplications30Days")}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(periprosthetic.complicacoesAgudas as any[]).map((c: any, i: number) => (
                      <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-destructive/10 text-destructive font-medium">
                        {typeof c === "string" ? controlled(c) : [c.ocorrencia ? controlled(c.ocorrencia) : null, c.data, c.descricao].filter(Boolean).join(" · ")}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {Array.isArray(periprosthetic.complicacoesTardias) && periprosthetic.complicacoesTardias.length > 0 && (
                <div className="pt-2">
                  <p className="text-sm text-muted-foreground mb-1.5">{t("lateComplications30Days")}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(periprosthetic.complicacoesTardias as any[]).map((c: any, i: number) => (
                      <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-destructive/10 text-destructive font-medium">
                        {typeof c === "string" ? controlled(c) : [c.ocorrencia ? controlled(c.ocorrencia) : null, c.data, c.descricao].filter(Boolean).join(" · ")}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {periprosthetic.observacoes && (
                <div className="pt-2">
                  <p className="text-sm text-muted-foreground mb-1">{t("observations")}</p>
                  <p className="text-sm whitespace-pre-wrap">{periprosthetic.observacoes}</p>
                </div>
              )}
            </Section>
          )}

          {/* ── Fratura do Fêmur Distal ──────────────────────────────── */}
          {distalFemur && (
            <Section title={t("distalFemurFracture")} icon={AlertTriangle}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 [&>*]:min-w-0">
                <div>
                  <Row label={t("aoOtaClassification")} value={distalFemur.classificacaoAoOta && distalFemur.classificacaoSubtipo ? `${distalFemur.classificacaoAoOta}${distalFemur.classificacaoSubtipo}` : distalFemur.classificacaoAoOta} />
                  <Row label={t("injuryDate")} value={distalFemur.dataLesao} />
                  <Row label={t("definitiveSurgeryDate")} value={distalFemur.dataCirurgiaDefinitiva} />
                </div>
                <div>
                  <Row label={t("damageControl")} value={distalFemur.controleDanos ? `${t("yes")}${distalFemur.controleDanosData ? ` (${distalFemur.controleDanosData})` : ""}` : t("no")} />
                  <Row label={t("boneGraft")} value={distalFemur.enxertoOsseo ? t("yes") : t("no")} />
                </div>
              </div>
              {(distalFemur.acesso?.length > 0 || distalFemur.acessoOutro) && (
                <div className="pt-2">
                  <Row label={t("surgicalAccess")} value={[controlledList(distalFemur.acesso ?? []), distalFemur.acessoOutro].filter(Boolean).join(", ") || undefined} />
                </div>
              )}
              {(distalFemur.cirurgia?.length > 0 || distalFemur.cirurgiaOutro) && (
                <div className="pt-2">
                  <Row label={t("surgeryMaterials")} value={[controlledList(distalFemur.cirurgia ?? []), distalFemur.cirurgiaOutro].filter(Boolean).join(", ") || undefined} />
                </div>
              )}
              {Array.isArray(distalFemur.opme) && distalFemur.opme.length > 0 && (
                <div className="pt-2">
                  <p className="text-sm text-muted-foreground mb-1.5">{t("opmeLegacy")}</p>
                  <div className="space-y-1">
                    {distalFemur.opme.map((o: string, i: number) => (
                      <div key={i} className="text-sm">{o}</div>
                    ))}
                  </div>
                </div>
              )}
              {(distalFemur.complicacoesAgudas?.length > 0 || distalFemur.complicacoesAgudasOutro) && (
                <div className="pt-2">
                  <Row label={t("summaryAcuteComplications")} value={[controlledList(distalFemur.complicacoesAgudas ?? []), distalFemur.complicacoesAgudasOutro].filter(Boolean).join(", ") || undefined} />
                </div>
              )}
              {(distalFemur.complicacoesTardias?.length > 0 || distalFemur.complicacoesTardiasOutro) && (
                <div className="pt-2">
                  <Row label={t("summaryLateComplications")} value={[controlledList(distalFemur.complicacoesTardias ?? []), distalFemur.complicacoesTardiasOutro].filter(Boolean).join(", ") || undefined} />
                </div>
              )}
              {(distalFemur.lesoesAssociadas?.length > 0 || distalFemur.lesoesAssociadasOutro) && (
                <div className="pt-2">
                  <Row label={t("associatedLesions")} value={[controlledList(distalFemur.lesoesAssociadas ?? []), distalFemur.lesoesAssociadasOutro].filter(Boolean).join(", ") || undefined} />
                </div>
              )}
              {distalFemur.observacoes && (
                <div className="pt-2">
                  <p className="text-sm text-muted-foreground mb-1">{t("observations")}</p>
                  <p className="text-sm whitespace-pre-wrap">{distalFemur.observacoes}</p>
                </div>
              )}
            </Section>
          )}

          {/* ── Fratura do Platô Tibial ──────────────────────────────── */}
          {tibialPlateau && (
            <Section title={t("tibialPlateauFracture")} icon={AlertTriangle}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 [&>*]:min-w-0">
                <div>
                  <Row label={t("schatzkerClassification")} value={tibialPlateau.classificacaoSchatzker} />
                  <Row label={t("injuryDate")} value={tibialPlateau.dataLesao} />
                  <Row label={t("definitiveSurgeryDate")} value={tibialPlateau.dataCirurgiaDefinitiva} />
                </div>
                <div>
                  <Row label={t("damageControl")} value={tibialPlateau.controleDanos ? t("yes") : t("no")} />
                  {tibialPlateau.controleDanos && (
                    <Row label={t("damageControlDate")} value={tibialPlateau.controleDanosData} />
                  )}
                  <Row label={t("boneGraft")} value={tibialPlateau.enxertoOsseo ? t("yes") : t("no")} />
                </div>
              </div>
              {(tibialPlateau.acesso?.length > 0 || tibialPlateau.acessoOutro) && (
                <div className="pt-2">
                  <Row label={t("surgicalAccess")} value={[controlledList(tibialPlateau.acesso ?? []), tibialPlateau.acessoOutro].filter(Boolean).join(", ") || undefined} />
                </div>
              )}
              {(tibialPlateau.cirurgia?.length > 0 || tibialPlateau.cirurgiaOutro) && (
                <div className="pt-2">
                  <Row label={t("surgeryMaterials")} value={[controlledList(tibialPlateau.cirurgia ?? []), tibialPlateau.cirurgiaOutro].filter(Boolean).join(", ") || undefined} />
                </div>
              )}
              {Array.isArray(tibialPlateau.opme) && tibialPlateau.opme.length > 0 && (
                <div className="pt-2">
                  <p className="text-sm text-muted-foreground mb-1.5">{t("opmeLegacy")}</p>
                  <div className="space-y-1">
                    {tibialPlateau.opme.map((o: any, i: number) => (
                      <div key={i} className="text-sm">{[o.item, o.quantidade ? t("quantity", { value: o.quantidade }) : ""].filter(Boolean).join(" · ")}</div>
                    ))}
                  </div>
                </div>
              )}
              {(tibialPlateau.complicacoesAgudas?.length > 0 || tibialPlateau.complicacoesAgudasOutro) && (
                <div className="pt-2">
                  <Row label={t("summaryAcuteComplications")} value={[controlledList(tibialPlateau.complicacoesAgudas ?? []), tibialPlateau.complicacoesAgudasOutro].filter(Boolean).join(", ") || undefined} />
                </div>
              )}
              {(tibialPlateau.complicacoesTardias?.length > 0 || tibialPlateau.complicacoesTardiasOutro) && (
                <div className="pt-2">
                  <Row label={t("summaryLateComplications")} value={[controlledList(tibialPlateau.complicacoesTardias ?? []), tibialPlateau.complicacoesTardiasOutro].filter(Boolean).join(", ") || undefined} />
                </div>
              )}
              {(tibialPlateau.lesoesAssociadas?.length > 0 || tibialPlateau.lesoesAssociadasOutro) && (
                <div className="pt-2">
                  <Row label={t("associatedLesions")} value={[controlledList(tibialPlateau.lesoesAssociadas ?? []), tibialPlateau.lesoesAssociadasOutro].filter(Boolean).join(", ") || undefined} />
                </div>
              )}
              {tibialPlateau.observacoes && (
                <div className="pt-2">
                  <p className="text-sm text-muted-foreground mb-1">{t("observations")}</p>
                  <p className="text-sm whitespace-pre-wrap">{tibialPlateau.observacoes}</p>
                </div>
              )}
            </Section>
          )}

          {/* ── Fratura de Patela ────────────────────────────────────── */}
          {patella && (
            <Section title={t("patellaFracture")} icon={AlertTriangle}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 [&>*]:min-w-0">
                <div>
                  <Row label={t("aoOtaClassification")} value={patella.classificacaoAoOta && patella.classificacaoSubtipo ? `${patella.classificacaoAoOta}${patella.classificacaoSubtipo}` : patella.classificacaoAoOta} />
                  <Row label={t("injuryDate")} value={patella.dataLesao} />
                  <Row label={t("definitiveSurgeryDate")} value={patella.dataCirurgiaDefinitiva} />
                </div>
              </div>
              {(patella.acesso?.length > 0 || patella.acessoOutro) && (
                <div className="pt-2">
                  <Row label={t("surgicalAccess")} value={[controlledList(patella.acesso ?? []), patella.acessoOutro].filter(Boolean).join(", ") || undefined} />
                </div>
              )}
              {(patella.cirurgia?.length > 0 || patella.cirurgiaOutro) && (
                <div className="pt-2">
                  <Row label={t("surgeryMaterials")} value={[controlledList(patella.cirurgia ?? []), patella.cirurgiaOutro].filter(Boolean).join(", ") || undefined} />
                </div>
              )}
              {(patella.complicacoesAgudas?.length > 0 || patella.complicacoesAgudasOutro) && (
                <div className="pt-2">
                  <Row label={t("summaryAcuteComplications")} value={[controlledList(patella.complicacoesAgudas ?? []), patella.complicacoesAgudasOutro].filter(Boolean).join(", ") || undefined} />
                </div>
              )}
              {(patella.complicacoesTardias?.length > 0 || patella.complicacoesTardiasOutro) && (
                <div className="pt-2">
                  <Row label={t("summaryLateComplications")} value={[controlledList(patella.complicacoesTardias ?? []), patella.complicacoesTardiasOutro].filter(Boolean).join(", ") || undefined} />
                </div>
              )}
              {(patella.lesoesAssociadas?.length > 0 || patella.lesoesAssociadasOutro) && (
                <div className="pt-2">
                  <Row label={t("associatedLesions")} value={[controlledList(patella.lesoesAssociadas ?? []), patella.lesoesAssociadasOutro].filter(Boolean).join(", ") || undefined} />
                </div>
              )}
              {patella.observacoes && (
                <div className="pt-2">
                  <p className="text-sm text-muted-foreground mb-1">{t("observations")}</p>
                  <p className="text-sm whitespace-pre-wrap">{patella.observacoes}</p>
                </div>
              )}
            </Section>
          )}

          {/* ── Fratura da Espinha Tibial (Eminência Tibial) ─────────── */}
          {tibialSpine && (
            <Section title={t("tibialSpineFracture")} icon={AlertTriangle}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 [&>*]:min-w-0">
                <div>
                  <Row label={t("meyersMcKeeverClassification")} value={tibialSpine.classificacaoMeyers ? t("fractureType", { value: tibialSpine.classificacaoMeyers }) : undefined} />
                  <Row label={t("injuryDate")} value={tibialSpine.dataLesao} />
                  <Row label={t("definitiveSurgeryDate")} value={tibialSpine.dataCirurgiaDefinitiva} />
                </div>
                <div>
                  <Row label={t("technique")} value={tibialSpine.tecnica} />
                  <Row label={t("sutureMaterial")} value={tibialSpine.materialSutura} />
                </div>
              </div>
              {Array.isArray(tibialSpine.opme) && tibialSpine.opme.length > 0 && (
                <div className="pt-2">
                  <p className="text-sm text-muted-foreground mb-1.5">{t("opmeImplants")}</p>
                  <div className="space-y-1">
                    {tibialSpine.opme.map((o: any, i: number) => (
                      <div key={i} className="text-sm">{[o.item, o.quantidade ? t("quantity", { value: o.quantidade }) : ""].filter(Boolean).join(" · ")}</div>
                    ))}
                  </div>
                </div>
              )}
              {(tibialSpine.lesoesAssociadas?.length > 0 || tibialSpine.lesoesAssociadasOutro || tibialSpine.lcaSubtipo) && (
                <div className="pt-2">
                  <Row label={t("associatedLesions")} value={[
                    ...reportLesionLabels(locale, tibialSpine.lesoesAssociadas ?? []).map((l: string) =>
                      l === "LCA" && tibialSpine.lcaSubtipo ? `LCA (${controlled(tibialSpine.lcaSubtipo)})` : l
                    ),
                    tibialSpine.lesoesAssociadasOutro,
                  ].filter(Boolean).join(", ") || undefined} />
                </div>
              )}
              {tibialSpine.observacoes && (
                <div className="pt-2">
                  <p className="text-sm text-muted-foreground mb-1">{t("observations")}</p>
                  <p className="text-sm whitespace-pre-wrap">{tibialSpine.observacoes}</p>
                </div>
              )}
            </Section>
          )}

          {/* ── 7. Análise de Raio-X ──────────────────────────────── */}
          {rxAnalysis && (
            <Section title={t("radiographicPlanning")} icon={Microscope}>
              {/* ── Narrativa do planejamento ── */}
              {(() => {
                const hka = rxAnalysis.eixoMecanico;
                const hkaVal = typeof hka === "object" ? hka.graus : (typeof hka === "number" ? hka : null);
                const hkaClass: string | null = typeof hka === "object" ? (hka.classificacao ?? null) : null;
                const correcao = rxAnalysis.anguloCorrecao;
                const wblPre = rxAnalysis.percentualWBL?.preCorrecao;
                const wblAlvo = rxAnalysis.percentualWBL?.valor ?? rxAnalysis.percentualWBL?.posCorrecao;
                let tipoOsteotomia: string | null = null;
                let wedgeMm: number | null = null;
                try {
                  const d = JSON.parse((surgery as any).procedimentosDetalhados || "{}");
                  const ost = d.osteotomia;
                  if (ost?.dupla) {
                    tipoOsteotomia = `${t("doubleOsteotomy")} (HTO + DFO)`;
                  } else if (ost?.tibial) {
                    tipoOsteotomia = `${t("htoTibial")}${ost.tibialTipo ? ` ${t("osteotomyTypeConnector", { value: ost.tibialTipo })}` : ""}${ost.tibialLado ? ` ${ost.tibialLado}` : ""}`;
                  } else if (ost?.femoral) {
                    tipoOsteotomia = `${t("dfoFemoral")}${ost.femoralTipo ? ` ${t("osteotomyTypeConnector", { value: ost.femoralTipo })}` : ""}${ost.femoralLado ? ` ${ost.femoralLado}` : ""}`;
                  }
                } catch { /* ignore */ }
                if (rxAnalysis.opcoes) {
                  if (tipoOsteotomia?.includes("HTO")) {
                    const opt = (rxAnalysis.opcoes as any[]).find((o) => String(o.id).startsWith("hto"));
                    if (opt?.wedgeTibial_mm != null) wedgeMm = opt.wedgeTibial_mm;
                  } else if (tipoOsteotomia?.includes("DFO")) {
                    const opt = (rxAnalysis.opcoes as any[]).find((o) => String(o.id).startsWith("dfo"));
                    if (opt?.wedgeFemoral_mm != null) wedgeMm = opt.wedgeFemoral_mm;
                  }
                }
                if (wedgeMm == null && rxAnalysis.wedgeTibial?.calculado_mm != null) wedgeMm = rxAnalysis.wedgeTibial.calculado_mm;
                if (wedgeMm == null && rxAnalysis.wedgeFemoral?.calculado_mm != null) wedgeMm = rxAnalysis.wedgeFemoral.calculado_mm;
                if (hkaVal == null && !tipoOsteotomia && correcao == null) return null;
                const hkaClassLabel = hkaClass ? hkaClass.charAt(0).toUpperCase() + hkaClass.slice(1) : null;
                return (
                  <div className="rounded-lg border-l-4 border-primary bg-primary/5 px-3 py-2.5 mb-3 space-y-1.5">
                    <p className="text-[10px] font-bold text-primary uppercase tracking-wide">{t("imagePlanningSummary")}</p>
                    <div className="flex flex-wrap gap-x-5 gap-y-1">
                      {hkaVal != null && (
                        <span className="text-sm">
                          <span className="text-muted-foreground">{t("hkaPreoperative")} </span>
                          <strong className={hkaClass === "varo" ? "text-amber-700" : hkaClass === "valgo" ? "text-blue-700" : ""}>
                            {hkaVal}° {hkaClassLabel ? `(${hkaClassLabel})` : ""}
                          </strong>
                          {wblPre != null && <span className="text-muted-foreground"> — WBL {wblPre}%</span>}
                        </span>
                      )}
                      {tipoOsteotomia && (
                        <span className="text-sm">
                          <span className="text-muted-foreground">{t("osteotomyPrefix")} </span>
                          <strong>{tipoOsteotomia}</strong>
                        </span>
                      )}
                      {correcao != null && (
                        <span className="text-sm">
                          <span className="text-muted-foreground">{t("correctionPrefix")} </span>
                          <strong className="text-amber-700">{correcao}°</strong>
                        </span>
                      )}
                      {wblAlvo != null && (
                        <span className="text-sm">
                          <span className="text-muted-foreground">{t("wblTarget")} </span>
                          <strong className="text-primary">{wblAlvo}%{wblAlvo === 62.5 ? " (Fujisawa)" : wblAlvo === 55 ? ` (${t("moderate")})` : wblAlvo === 66 ? ` (${t("severe")})` : ""}</strong>
                        </span>
                      )}
                      {wedgeMm != null && (
                        <span className="text-sm">
                          <span className="text-muted-foreground">{t("wedgePrefix")} </span>
                          <strong>{wedgeMm} mm</strong>
                        </span>
                      )}
                    </div>
                  </div>
                );
              })()}
              {surgery.rxImageUrl && (
                <div className="mb-3 rounded-lg overflow-hidden border border-border/40 bg-black flex justify-center">
                  <img
                    src={surgery.rxImageUrl.startsWith("http")
                      ? surgery.rxImageUrl
                      : surgery.rxImageUrl.replace(/^\/objects\//, "/api/storage/objects/")}
                    alt={t("panoramicRx")}
                    className="max-h-64 w-auto object-contain"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 [&>*]:min-w-0">
                {rxAnalysis.eixoMecanico && (
                  <div className="rounded-lg border p-3 text-center">
                    <p className={`text-lg font-black ${(typeof rxAnalysis.eixoMecanico === "object" ? rxAnalysis.eixoMecanico.classificacao : null) === "varo" ? "text-amber-700" : (typeof rxAnalysis.eixoMecanico === "object" ? rxAnalysis.eixoMecanico.classificacao : null) === "valgo" ? "text-blue-700" : "text-primary"}`}>
                      {typeof rxAnalysis.eixoMecanico === "object"
                        ? `${Math.abs(rxAnalysis.eixoMecanico.graus) ?? "—"}°`
                        : rxAnalysis.eixoMecanico}
                    </p>
                    {typeof rxAnalysis.eixoMecanico === "object" && rxAnalysis.eixoMecanico.classificacao && (
                      <p className={`text-[10px] font-bold uppercase ${rxAnalysis.eixoMecanico.classificacao === "varo" ? "text-amber-600" : rxAnalysis.eixoMecanico.classificacao === "valgo" ? "text-blue-600" : "text-muted-foreground"}`}>
                        {rxAnalysis.eixoMecanico.classificacao}
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-0.5">HKA</p>
                  </div>
                )}
                {rxAnalysis.aLDFA && (
                  <div className="rounded-lg border p-3 text-center">
                    <p className="text-lg font-black text-primary">
                      {typeof rxAnalysis.aLDFA === "object"
                        ? `${rxAnalysis.aLDFA.valor ?? "—"}°`
                        : rxAnalysis.aLDFA}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">aLDFA</p>
                  </div>
                )}
                {rxAnalysis.aMPTA && (
                  <div className="rounded-lg border p-3 text-center">
                    <p className="text-lg font-black text-primary">
                      {typeof rxAnalysis.aMPTA === "object"
                        ? `${rxAnalysis.aMPTA.valor ?? "—"}°`
                        : rxAnalysis.aMPTA}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">AmMPT</p>
                  </div>
                )}
                {rxAnalysis.JLCA && (
                  <div className="rounded-lg border p-3 text-center">
                    <p className="text-lg font-black text-primary">
                      {typeof rxAnalysis.JLCA === "object"
                        ? `${rxAnalysis.JLCA.valor ?? "—"}°`
                        : rxAnalysis.JLCA}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">JLCA</p>
                  </div>
                )}
                {rxAnalysis.anguloCorrecao != null && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-center">
                    <p className="text-lg font-black text-amber-700">{rxAnalysis.anguloCorrecao}°</p>
                    <p className="text-[10px] text-amber-600 mt-0.5">{t("correctionAngle")}</p>
                  </div>
                )}
                {rxAnalysis.percentualWBL?.valor != null && (
                  <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-center">
                    <p className="text-lg font-black text-primary">{rxAnalysis.percentualWBL.valor}%</p>
                    <p className="text-[10px] text-primary/70 mt-0.5">{t("wblTargetLabel")}</p>
                  </div>
                )}
                {rxAnalysis.wedgeTibial?.calculado_mm != null && (
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-center">
                    <p className="text-lg font-black text-blue-700">{rxAnalysis.wedgeTibial.calculado_mm} mm</p>
                    <p className="text-[10px] text-blue-600 mt-0.5">{t("tibialWedge")}</p>
                  </div>
                )}
                {rxAnalysis.wedgeFemoral?.calculado_mm != null && (
                  <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-center">
                    <p className="text-lg font-black text-orange-700">{rxAnalysis.wedgeFemoral.calculado_mm} mm</p>
                    <p className="text-[10px] text-orange-600 mt-0.5">{t("femoralWedge")}</p>
                  </div>
                )}
              </div>
              {rxAnalysis.diagnostico && (
                <p className="text-sm bg-muted/30 rounded-md p-2.5 mt-2 leading-relaxed">
                  <span className="font-semibold">{t("diagnosisPrefixPlain")} </span>{rxAnalysis.diagnostico}
                </p>
              )}
            </Section>
          )}

          {/* ── Rupturas Tendíneas ──────────────────────────────── */}
          {(surgery.patelarTendonRupture || surgery.quadricepsTendonRupture) && (
            <Section title={t("tendonRuptures")} icon={FileText}>
              <div className="space-y-4">
                {surgery.patelarTendonRupture && (() => {
                  const pt = surgery.patelarTendonRupture as any;
                  return (
                    <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-4 space-y-3">
                      <p className="font-semibold text-amber-800 text-sm">{t("patellarTendonRupture")}</p>
                      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                        {pt.classificacao && <Row label={t("location")} value={pt.classificacao} />}
                        {pt.dataLesao && <Row label={t("injuryDate")} value={pt.dataLesao} />}
                        {pt.dataCirurgiaDefinitiva && <Row label={t("surgeryDate")} value={pt.dataCirurgiaDefinitiva} />}
                        {Array.isArray(pt.cirurgia) && pt.cirurgia.length > 0 && <Row label={t("technique")} value={controlledList(pt.cirurgia)} />}
                        {pt.cirurgiaOutro && <Row label={t("techniqueOther")} value={pt.cirurgiaOutro} />}
                      </div>
                      {pt.reforco && (
                        <div className="text-sm space-y-1 border-t border-amber-200/60 pt-2">
                          <p className="font-medium text-amber-700">{t("biologicalReinforcement")}</p>
                          {Array.isArray(pt.reforcoTipo) && pt.reforcoTipo.length > 0 && <p className="text-muted-foreground">{t("typePrefix")} {controlledList(pt.reforcoTipo)}</p>}
                          {Array.isArray(pt.reforcoTendao) && pt.reforcoTendao.length > 0 && <p className="text-muted-foreground">{t("tendonPrefix")} {controlledList(pt.reforcoTendao)}{pt.reforcoTendaoOutro ? ` — ${pt.reforcoTendaoOutro}` : ""}</p>}
                        </div>
                      )}
                      {Array.isArray(pt.imageUrls) && pt.imageUrls.length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {pt.imageUrls.map((url: string, i: number) => (
                            <img key={i} src={url} alt={`img-${i}`} className="w-20 h-20 object-cover rounded-lg border border-amber-200" />
                          ))}
                        </div>
                      )}
                      {pt.observacoes && <p className="text-sm text-muted-foreground bg-muted/30 rounded p-2 mt-1">{pt.observacoes}</p>}
                    </div>
                  );
                })()}
                {surgery.quadricepsTendonRupture && (() => {
                  const qt = surgery.quadricepsTendonRupture as any;
                  return (
                    <div className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-4 space-y-3">
                      <p className="font-semibold text-indigo-800 text-sm">{t("quadricepsTendonRupture")}</p>
                      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                        {qt.classificacao && <Row label={t("location")} value={qt.classificacao} />}
                        {qt.dataLesao && <Row label={t("injuryDate")} value={qt.dataLesao} />}
                        {qt.dataCirurgiaDefinitiva && <Row label={t("surgeryDate")} value={qt.dataCirurgiaDefinitiva} />}
                        {Array.isArray(qt.acesso) && qt.acesso.length > 0 && <Row label={t("access")} value={controlledList(qt.acesso)} />}
                        {qt.acessoOutro && <Row label={t("accessOther")} value={qt.acessoOutro} />}
                        {Array.isArray(qt.cirurgia) && qt.cirurgia.length > 0 && <Row label={t("technique")} value={controlledList(qt.cirurgia)} />}
                        {qt.cirurgiaOutro && <Row label={t("techniqueOther")} value={qt.cirurgiaOutro} />}
                      </div>
                      {Array.isArray(qt.imageUrls) && qt.imageUrls.length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {qt.imageUrls.map((url: string, i: number) => (
                            <img key={i} src={url} alt={`img-${i}`} className="w-20 h-20 object-cover rounded-lg border border-indigo-200" />
                          ))}
                        </div>
                      )}
                      {qt.observacoes && <p className="text-sm text-muted-foreground bg-muted/30 rounded p-2 mt-1">{qt.observacoes}</p>}
                    </div>
                  );
                })()}
              </div>
            </Section>
          )}

          {/* ── 8. Observações ────────────────────────────────────── */}
          {surgery.observacoes && (
            <Section title={t("observationsSection")} icon={FileText}>
              <p className="text-sm bg-muted/30 rounded-md p-3 whitespace-pre-wrap leading-relaxed">
                {surgery.observacoes}
              </p>
            </Section>
          )}
          </>}

          {/* ── 9. Follow-up ──────────────────────────────────────── */}
          {followups.length > 0 && (
            <Section title={t("followupSection", { count: followups.length, evaluation: followups.length > 1 ? t("evaluationPlural") : t("evaluationSingular") })} icon={Activity}>
              <div className="space-y-3">
                {followups.map((f: any, i: number) => (
                  <div key={f.id ?? i} className="rounded-lg border border-border p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-primary">{reportFollowupPeriodLabel(locale, f.tempo)}</span>
                      <span className="text-xs text-muted-foreground">
                        {f.dataAvaliacao
                          ? formatDate(f.dataAvaliacao, { day: "2-digit", month: "2-digit", year: "numeric" })
                          : "—"}
                      </span>
                    </div>

                    {[
                      { label: "IKDC", val: f.ikdc },
                      { label: "Lysholm", val: f.lysholm },
                      { label: t("vasPain"), val: f.vasDor },
                      { label: "Kujala", val: f.kujala },
                      { label: "Tegner", val: f.tegner },
                      { label: "ACL-RSI", val: f.aclRsi },
                      { label: "Marx", val: f.marx },
                      { label: "KOOS-12", val: (f as any).koos12 },
                    ].filter(s => s.val != null).length > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 [&>*]:min-w-0">
                        {[
                          { label: "IKDC", val: f.ikdc },
                          { label: "Lysholm", val: f.lysholm },
                          { label: t("vasPain"), val: f.vasDor },
                          { label: "Kujala", val: f.kujala },
                          { label: "Tegner", val: f.tegner },
                          { label: "ACL-RSI", val: f.aclRsi },
                          { label: "Marx", val: f.marx },
                          { label: "KOOS-12", val: (f as any).koos12 },
                        ]
                          .filter(s => s.val != null)
                          .map(s => (
                            <div key={s.label} className="text-center rounded border p-2">
                              <p className="text-base font-black text-primary">{s.val}</p>
                              <p className="text-[9px] text-muted-foreground">{s.label}</p>
                            </div>
                          ))}
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2">
                      {f.retornoEsporte && (
                        <span className="flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1">
                          <CheckCircle2 className="h-3 w-3" />
                          {t("returnToSport", { level: f.nivelRetorno ? `: ${f.nivelRetorno}` : "" })}
                        </span>
                      )}
                      {f.falha && (
                        <span className="flex items-center gap-1 text-xs font-medium text-destructive bg-destructive/10 border border-destructive/20 rounded-full px-2.5 py-1">
                          <AlertTriangle className="h-3 w-3" />
                          {t("failureRerupture", { type: f.falhaType ? `: ${f.falhaType}` : "" })}
                        </span>
                      )}
                    </div>

                    {f.observacoes && (
                      <p className="text-xs text-muted-foreground bg-muted/20 rounded p-2 leading-relaxed">
                        {f.observacoes}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      </DialogContent>
    </Dialog>
    <SurgeryTextExportDialog
      open={textPreviewOpen}
      onClose={() => setTextPreviewOpen(false)}
      surgery={surgery}
      privacyMode={privacyMode}
      bioReady={bioReady}
    />
    </>
  );
}
