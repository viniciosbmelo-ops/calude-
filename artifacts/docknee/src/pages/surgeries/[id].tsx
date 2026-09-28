import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { useGetSurgery, useDeleteSurgery, useCreateFollowup } from "@workspace/api-client-react";
import { useParams, Link, useLocation } from "wouter";
import { ScaleQuestionnaireDialog } from "@/components/scale-questionnaire";
import { FollowupReport, FollowupFullReport, type FollowupReportFollowup } from "@/components/followup-report";
import { SurgeryFullSummary } from "@/components/surgery-full-summary";
import { SurgeryTextExportDialog } from "@/components/surgery-text-export-dialog";
import { SurgeryMedia } from "@/components/surgery-media";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Trash2, Calendar, Activity, Plus, Save, Send, Copy, CheckCircle2, Clock, ChevronDown, ChevronRight, Eye, LayoutList, Download, Loader2, AlertTriangle, Bell, BellOff, CheckCheck, Pencil, X, ClipboardList, FileText, Scan, ExternalLink, UserCheck, UserX } from "lucide-react";
import { generateSurgeryPDF } from "@/lib/surgery-pdf";
import { sharePdfOrDownload, handlePdfOpenClick } from "@/lib/pdf-share";
import {
  generateXRayPDF,
  isOsteotomySelectionRequired,
  isValidOsteotomySelection,
  resolveSelectedOsteotomyOption,
} from "@/lib/xray-pdf";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQueryClient } from "@tanstack/react-query";
import { getGetSurgeryQueryKey } from "@workspace/api-client-react";
import {
  FRACTURE_ACUTE_COMPLICATION_OPTIONS,
  FRACTURE_LATE_COMPLICATION_OPTIONS,
  categorizeFollowupComplications,
  encodeFractureComplication,
  splitComplicationText,
} from "@/lib/followup-complications";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { surgeryCoreMessages } from "@/locales/surgery-core";
import { surgeryDetailMessages } from "@/locales/surgery-detail";
import { surgeryDetailProtocolMessages } from "@/locales/surgery-detail-protocols";
import { surgeryDetailSchedulingMessages } from "@/locales/surgery-detail-scheduling";
import { surgeryDetailActionsMessages } from "@/locales/surgery-detail-actions";
import { surgeryDetailClinicalMessages } from "@/locales/surgery-detail-clinical";
import { getKrirsDisplayJustification, getKrirsRiskLabel, getKrirsRiskLevel } from "@/lib/krirs-risk";
import { limbHeading, readBilateralDocumentation } from "@/lib/bilateral-surgery";
import { classifyPTS, getPTSClassificationLabel, getPTSClassificationRange } from "@/lib/pts-classification";

export default function SurgeryDetail() {
  const { formatDate, locale } = useLanguage();
  const t = useScopedTranslations(surgeryCoreMessages);
  const td = useScopedTranslations(surgeryDetailMessages);
  const tp = useScopedTranslations(surgeryDetailProtocolMessages);
  const ts = useScopedTranslations(surgeryDetailSchedulingMessages);
  const ta = useScopedTranslations(surgeryDetailActionsMessages);
  const tc = useScopedTranslations(surgeryDetailClinicalMessages);
  // Stored side values are API values; only their presentation is localized.
  const sideLabel = (value: string | null | undefined) =>
    value === "Direito" ? t("right") : value === "Esquerdo" ? t("left") : value || "-";
  const params = useParams();
  const id = parseInt(params.id || "0");
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const { data: surgery, isLoading, error } = useGetSurgery(id, {
    query: { queryKey: getGetSurgeryQueryKey(id), enabled: !!id }
  });
  
  const deleteMutation = useDeleteSurgery();
  const createFollowupMutation = useCreateFollowup();

  // Send scales to patient
  const [sendScalesOpen, setSendScalesOpen] = useState(false);
  const [sendScalesFollowupId, setSendScalesFollowupId] = useState<number | null>(null);
  const [selectedScales, setSelectedScales] = useState<string[]>(["VAS Dor", "Lysholm"]);
  const [patientLink, setPatientLink] = useState<string | null>(null);
  const [sendingScales, setSendingScales] = useState(false);

  // WhatsApp message editor dialog
  const [waDialogOpen, setWaDialogOpen] = useState(false);
  const [waNotifId, setWaNotifId] = useState<number | null>(null);
  const [waMessage, setWaMessage] = useState("");
  const [waLink, setWaLink] = useState<string>("");
  const [waPreparing, setWaPreparing] = useState<number | null>(null);
  const [admDialog, setAdmDialog] = useState<{
    followupId: number;
    flexao: string;
    extensao: string;
    complicacoes: string;
    complicacoesAgudas: string;
    complicacoesTardias: string;
    obs: string;
  } | null>(null);
  const [savingAdm, setSavingAdm] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [scaleDialogOpen, setScaleDialogOpen] = useState<string | null>(null);
  const [reportFollowupId, setReportFollowupId] = useState<number | null>(null);
  const [fullReportOpen, setFullReportOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [textPreviewOpen, setTextPreviewOpen] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfShareUrl, setPdfShareUrl] = useState<string | null>(null);
  const [rxPdfLoading, setRxPdfLoading] = useState(false);
  const [rxPdfShareUrl, setRxPdfShareUrl] = useState<string | null>(null);
  const pdfGenerationRef = useRef(0);
  const rxPdfGenerationRef = useRef(0);
  const [editingLado, setEditingLado] = useState(false);
  const [ladoValue, setLadoValue] = useState<string>("");
  const [savingLado, setSavingLado] = useState(false);
  const [editingData, setEditingData] = useState(false);
  const [dataValue, setDataValue] = useState<string>("");
  const [savingData, setSavingData] = useState(false);
  const [savingOsteotomia, setSavingOsteotomia] = useState(false);

  type ScheduledNotif = { id: number; periodo: string; scheduledDate: string | null; sentAt: string | null; scales: string[]; status: string; daysAfterSurgery: number | null; notes: string | null };
  const [schedule, setSchedule] = useState<ScheduledNotif[]>([]);

  // Deferred links are bound to the exact source used to create each PDF.
  // Keep the general surgery document and RX planning document independent.
  useEffect(() => {
    pdfGenerationRef.current += 1;
    setPdfShareUrl(null);
  }, [surgery, locale]);

  useEffect(() => {
    rxPdfGenerationRef.current += 1;
    setRxPdfShareUrl(null);
  }, [surgery?.rxAnaliseJson, (surgery as any)?.rxImageUrl, locale]);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/surgeries/${id}/schedule`, {
      credentials: "same-origin",
    })
      .then(r => r.ok ? r.json() : [])
      .then(data => setSchedule(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [id]);

  const markNotifStatus = async (notifId: number, status: string) => {
    const r = await fetch(`/api/surgeries/${id}/schedule/${notifId}/status`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (r.ok) {
      const updated = await r.json();
      setSchedule(prev => prev.map(n => n.id === notifId ? { ...n, status: updated.status } : n));
    }
  };

  const [generatingSchedule, setGeneratingSchedule] = useState(false);
  const generateSchedule = async () => {
    setGeneratingSchedule(true);
    try {
      const r = await fetch(`/api/surgeries/${id}/schedule/generate`, {
        method: "POST",
        credentials: "same-origin",
      });
      if (r.ok) {
        const data = await r.json();
        setSchedule(Array.isArray(data) ? data : []);
        toast({ title: t("generatedSchedule"), description: t("evaluationsScheduled", { count: Array.isArray(data) ? data.length : 0 }) });
      }
    } catch {
        toast({ title: t("scheduleError"), variant: "destructive" });
    } finally {
      setGeneratingSchedule(false);
    }
  };

  // ── Encaminhamento do Fisioterapeuta ──────────────────────────────────────
  type RehabInviteItem = { id: number; surgeryId: number; status: string; consentMethod: string; expiresAt: string; acceptedAt: string | null; createdAt: string };
  type CareLinkItem    = { id: number; surgeryId: number; status: string; physioNome: string; physioCrefito: string | null; physioClinica: string | null; createdAt: string };

  const [rehabData, setRehabData] = useState<{ invites: RehabInviteItem[]; careLinks: CareLinkItem[] } | null>(null);
  const [rehabLoading, setRehabLoading] = useState(false);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteConsentMethod, setInviteConsentMethod] = useState("verbal_presencial");
  const [generatingInvite, setGeneratingInvite] = useState(false);
  const [revokingLink, setRevokingLink] = useState<number | null>(null);

  const fetchRehab = async () => {
    if (!surgery?.patientId) return;
    setRehabLoading(true);
    try {
      const r = await fetch(`/api/patients/${surgery.patientId}/rehab`, {
        credentials: "same-origin",
      });
      if (r.ok) setRehabData(await r.json());
    } catch { /* ignore */ } finally { setRehabLoading(false); }
  };

  useEffect(() => {
    if (surgery?.patientId) fetchRehab();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surgery?.patientId]);

  const generateInvite = async () => {
    if (!surgery) return;
    setGeneratingInvite(true);
    try {
      const r = await fetch(`/api/patients/${surgery.patientId}/rehab-invite`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ surgeryId: surgery.id, consentMethod: inviteConsentMethod }),
      });
      if (r.ok) {
        const data = await r.json();
        const digits = (surgery.patient?.telefone ?? "").replace(/\D/g, "");
        const wa = digits ? `https://wa.me/55${digits}?text=${encodeURIComponent(data.whatsappText)}` : null;
        toast({ title: t("inviteGenerated"), description: t("referralReady") });
        await fetchRehab();
        setInviteDialogOpen(false);
        if (wa) window.open(wa, "_blank");
      } else {
        const err = await r.json().catch(() => ({}));
        toast({ title: t("inviteError"), description: (err as Record<string, string>).error ?? t("tryAgain"), variant: "destructive" });
      }
    } catch {
      toast({ title: t("inviteError"), variant: "destructive" });
    } finally { setGeneratingInvite(false); }
  };

  const revokeLink = async (linkId: number) => {
    setRevokingLink(linkId);
    try {
      const r = await fetch(`/api/care-links/${linkId}/revoke`, {
        method: "POST",
        credentials: "same-origin",
      });
      if (r.ok) { toast({ title: t("linkRevoked") }); await fetchRehab(); }
      else toast({ title: t("revokeLinkError"), variant: "destructive" });
    } catch {
      toast({ title: t("revokeLinkError"), variant: "destructive" });
    } finally { setRevokingLink(null); }
  };
  // ──────────────────────────────────────────────────────────────────────────

  const saveLado = async (valor: string) => {
    if (!surgery) return;
    setSavingLado(true);
    try {
      const r = await fetch(`/api/surgeries/${id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lado: valor || null }),
      });
      if (r.ok) {
        await queryClient.invalidateQueries({ queryKey: getGetSurgeryQueryKey(id) });
        setEditingLado(false);
        toast({ title: t("sideUpdated") });
      } else {
        toast({ title: t("error"), variant: "destructive" });
      }
    } catch {
      toast({ title: t("error"), variant: "destructive" });
    } finally {
      setSavingLado(false);
    }
  };

  const saveData = async (valor: string) => {
    if (!surgery || !valor) return;
    setSavingData(true);
    try {
      const r = await fetch(`/api/surgeries/${id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataCirurgia: valor }),
      });
      if (r.ok) {
        await queryClient.invalidateQueries({ queryKey: getGetSurgeryQueryKey(id) });
        setEditingData(false);
        toast({ title: t("dateUpdated") });
      } else {
        toast({ title: t("error"), variant: "destructive" });
      }
    } catch {
      toast({ title: t("error"), variant: "destructive" });
    } finally {
      setSavingData(false);
    }
  };

  const handleDownloadPDF = async () => {
    if (!surgery) return;
    const pdfGeneration = ++pdfGenerationRef.current;
    setPdfShareUrl(null);
    setPdfLoading(true);
    try {
      const { doc, filename } = await generateSurgeryPDF(surgery, undefined, locale);
      if (pdfGenerationRef.current !== pdfGeneration) return;
      const result = await sharePdfOrDownload(
        doc,
        filename,
        (url) => {
          if (pdfGenerationRef.current === pdfGeneration) setPdfShareUrl(url);
        },
      );
      if (pdfGenerationRef.current !== pdfGeneration) return;
      if (result.deferred) {
        toast({ title: t("pdfReady"), description: t("pdfShareHint") });
      }
    } catch (err) {
      if (pdfGenerationRef.current !== pdfGeneration) return;
      console.error("Erro ao gerar PDF:", err);
      toast({ title: t("pdfError"), description: t("tryAgain"), variant: "destructive" });
    } finally {
      setPdfLoading(false);
    }
  };

  const handleOpenPDF = () => {
    if (!pdfShareUrl) return;
    handlePdfOpenClick(pdfShareUrl, () => setPdfShareUrl(null));
  };

  const handleOpenRxPDF = () => {
    if (!rxPdfShareUrl) return;
    handlePdfOpenClick(rxPdfShareUrl, () => setRxPdfShareUrl(null));
  };

  const handleDownloadRxPDF = async () => {
    if (!surgery?.rxAnaliseJson) return;
    const rxPdfGeneration = ++rxPdfGenerationRef.current;
    setRxPdfShareUrl(null);
    setRxPdfLoading(true);
    try {
      const analysis = JSON.parse(surgery.rxAnaliseJson);
      const selectedIdx: number | null = resolveSelectedOsteotomyOption(
        analysis,
        analysis._selectedOsteotomiaIdx,
        typeof analysis._selectedOsteotomiaId === "string" ? analysis._selectedOsteotomiaId : undefined,
      )
        ? analysis._selectedOsteotomiaIdx
        : null;
      const rxOptionsAvailable = Array.isArray(analysis.opcoesOsteotomia)
        && analysis.opcoesOsteotomia.length > 0;
      if (isOsteotomySelectionRequired(analysis) && !isValidOsteotomySelection(analysis, selectedIdx)) {
        toast({
          title: rxOptionsAvailable
            ? t("rxOsteotomySelectionRequired")
            : t("rxOsteotomyOptionsUnavailable"),
          description: rxOptionsAvailable
            ? t("rxOsteotomySelectionDescription")
            : t("rxOsteotomyOptionsUnavailableDescription"),
          variant: "destructive",
        });
        return;
      }

      // Load RX image
      let xrayImageDataUrl: string | undefined;
      const imageUrlRaw = (surgery as any).rxImageUrl as string | null | undefined;
      const imageUrl = imageUrlRaw?.startsWith("/objects/")
        ? "/api/storage" + imageUrlRaw
        : imageUrlRaw;
      if (!imageUrl) {
        throw new Error("XRAY_IMAGE_UNAVAILABLE");
      }
      if (imageUrl) {
        let resp: Response;
        try {
          resp = await fetch(imageUrl);
        } catch {
          throw new Error("XRAY_IMAGE_UNAVAILABLE");
        }
        if (!resp.ok) throw new Error("XRAY_IMAGE_UNAVAILABLE");
        const blob = await resp.blob();
        xrayImageDataUrl = await new Promise<string>((res, reject) => {
          const fr = new FileReader();
          fr.onload = () => res(fr.result as string);
          fr.onerror = () => reject(new Error("XRAY_IMAGE_UNAVAILABLE"));
          fr.readAsDataURL(blob);
        });
      }
      const { doc, filename } = generateXRayPDF(
        analysis,
        surgery.patient?.nome ?? undefined,
        xrayImageDataUrl,
        selectedIdx,
        locale,
      );
      if (rxPdfGenerationRef.current !== rxPdfGeneration) return;
      const result = await sharePdfOrDownload(
        doc,
        filename,
        (url) => {
          if (rxPdfGenerationRef.current === rxPdfGeneration) setRxPdfShareUrl(url);
        },
      );
      if (rxPdfGenerationRef.current !== rxPdfGeneration) return;
      if (result.deferred) {
        toast({ title: t("pdfReady"), description: t("pdfShareHint") });
      }
    } catch (err) {
      if (rxPdfGenerationRef.current !== rxPdfGeneration) return;
      console.error("Erro ao gerar PDF do planejamento RX:", err);
      toast({
        title: err instanceof Error && err.message === "XRAY_IMAGE_UNAVAILABLE"
          ? t("rxImageUnavailable")
          : t("rxPdfError"),
        description: t("tryAgain"),
        variant: "destructive",
      });
    } finally {
      setRxPdfLoading(false);
    }
  };

  const ALL_SCALES = ["VAS Dor", "Lysholm", "IKDC", "Tegner", "ACL-RSI", "Marx", "Kujala", "KOOS-12", "WOMAC"];

  const ligamentosArr = ((surgery?.ligamentosAcometidos ?? []) as string[]);
  const isLcpSurgery = ligamentosArr.includes("LCP");
  const isLcmSurgery = ligamentosArr.includes("LCM");
  const isCpmSurgery = ligamentosArr.includes("CPM");
  const isCplSurgery = ligamentosArr.includes("CPL") || ligamentosArr.includes("PLC");
  const isLcaSurgery = ligamentosArr.includes("LCA");
  const tiposArr = ((surgery?.tiposProcedimento ?? []) as string[]);
  const isPatelarSurgery = tiposArr.includes("Instabilidade Patelar");
  const isOsteocondralSurgery = tiposArr.includes("Lesões Osteocondrais");
  const isOrtobiologicoSurgery = tiposArr.includes("Ortobiológicos");
  const isArtroplastiaSurgery = tiposArr.includes("Artroplastias");
  const isSuturaMeniscalSurgery = tiposArr.includes("Sutura Meniscal");
  const isFractureSurgery = tiposArr.includes("Fraturas")
    || Boolean((surgery as any)?.periprostheticFracture)
    || Boolean((surgery as any)?.distalFemurFracture)
    || Boolean((surgery as any)?.tibialPlateauFracture)
    || Boolean((surgery as any)?.patellaFracture)
    || Boolean((surgery as any)?.tibialSpineFracture);
  const displayedSchedule = isFractureSurgery
    ? schedule.filter((notification) => notification.periodo !== "Pré-operatório")
    : schedule;
  type SchedulingTranslationKey = Parameters<typeof ts>[0];
  const schedulePeriodKeys: Record<string, SchedulingTranslationKey> = {
    "Pré-operatório": "periodPreoperative",
    "30 dias": "period30Days",
    "90 dias": "period90Days",
    "180 dias": "period180Days",
    "1 ano": "period1Year",
    "1 ano ★": "period1YearCritical",
    "2 anos": "period2Years",
    "5 anos": "period5Years",
    "1 mês": "period1Month",
    "2 semanas": "period2Weeks",
    "3 semanas": "period3Weeks",
    "6 semanas": "period6Weeks",
    "3 meses": "period3Months",
    "3 meses ★": "period3MonthsCritical",
    "6 meses": "period6Months",
    "6 meses ★": "period6MonthsCritical",
    "12 meses": "period12Months",
    "24 meses": "period24Months",
    "4 anos": "period4Years",
    "7-14 dias": "period7To14Days",
    "Anual (≥3 anos)": "periodAnnual3Years",
  };
  const schedulePeriodLabel = (value: string) => {
    const key = schedulePeriodKeys[value];
    return key ? ts(key) : value;
  };
  const fractureComplicationKeys: Record<string, SchedulingTranslationKey> = {
    "Infecção superficial": "compSuperficialInfection",
    "Infecção profunda": "compDeepInfection",
    "Infecção": "compInfection",
    "TVP/TEP": "compDvtPe",
    "Lesão nervosa": "compNerveInjury",
    "Lesão vascular": "compVascularInjury",
    "Síndrome compartimental": "compCompartmentSyndrome",
    "Falha de fixação": "compFixationFailure",
    "Falha de implante": "compImplantFailure",
    "Hematoma": "compHematoma",
    "Deiscência": "compDehiscence",
    "Ruptura do mecanismo extensor": "compExtensorMechanismRupture",
    "Irritação do fio de aço": "compWireIrritation",
    "Óbito": "compDeath",
    "Pseudartrose": "compNonunion",
    "Pseudoartrose": "compNonunionVariant",
    "Atraso de consolidação": "compDelayedUnion",
    "Consolidação viciosa": "compMalunion",
    "Soltura asséptica": "compAsepticLoosening",
    "Infecção crônica": "compChronicInfection",
    "Rigidez articular": "compJointStiffness",
    "Perda de arco de movimento": "compMotionLoss",
    "Instabilidade protética": "compProstheticInstability",
    "Instabilidade patelar": "compPatellarInstability",
    "Fratura periimplante recorrente": "compRecurrentPeriImplantFracture",
    "Artrose pós-traumática": "compPostTraumaticArthrosis",
    "Artrose patelofemoral": "compPatellofemoralArthrosis",
    "Falha de material de síntese": "compSynthesisMaterialFailure",
    "Dor refratária": "compRefractoryPain",
    "Reoperação (retirada de implante)": "compReoperationRemoval",
  };
  const fractureComplicationLabel = (value: string) => {
    const key = fractureComplicationKeys[value];
    return key ? ts(key) : value;
  };
  const scaleDisplayLabel = (value: string) => value === "VAS Dor" ? ts("scaleVasPain") : value;

  const protocolPeriodLabel = (period: string) => {
    const labels: Record<string, keyof typeof surgeryCoreMessages["pt-BR"]> = {
      "pre-op": "protocolPreoperative", "7-14d": "protocol7to14Days", "3sem": "protocol3Weeks",
      "6sem": "protocol6Weeks", "1m": "protocol1MonthOptional", "1mStandard": "protocol1Month", "3m": "protocol3Months",
      "6m": "protocol6MonthsCritical", "12m": "protocol12Months", "24m": "protocol24Months",
      "1a": "protocol1YearMandatory", "2a": "protocol2Years", "4a": "protocol4Years",
      "5a": "protocol5Years", anual: "protocolAnnual", anual3: "protocolAnnual3Years",
    };
    return t(labels[period]);
  };
  const protocol = (period: string, scales: string[], note: keyof typeof surgeryCoreMessages["pt-BR"]) => ({
    label: protocolPeriodLabel(period), scales, note: t(note),
  });

  const PROTOCOL_SUGGESTIONS: Record<string, { label: string; scales: string[]; note?: string }> = isFractureSurgery
    ? {
        "6sem": protocol("6sem", ["VAS Dor", "Lysholm"], "protocolFracture6Weeks"),
        "3m": protocol("3m", ["VAS Dor", "Lysholm", "IKDC"], "protocolFracture3Months"),
        "6m": protocol("6m", ["VAS Dor", "Lysholm", "IKDC"], "protocolFracture6Months"),
        "12m": protocol("12m", ["Lysholm", "IKDC", "VAS Dor"], "protocolFracture12Months"),
      }
    : isPatelarSurgery
    ? {
        "pre-op": protocol("pre-op", ["Kujala", "IKDC", "VAS Dor", "Tegner"], "protocolPatellarPreop"),
        "6sem": protocol("6sem", ["VAS Dor", "Kujala"], "protocolPatellar6Weeks"),
        "3m": protocol("3m", ["Kujala", "IKDC", "VAS Dor"], "protocolPatellar3Months"),
        "6m": protocol("6m", ["Kujala", "IKDC", "Tegner", "VAS Dor"], "protocolPatellar6Months"),
        "12m": protocol("12m", ["Kujala", "IKDC", "Tegner", "VAS Dor"], "protocolPatellar12Months"),
        "24m": protocol("24m", ["Kujala", "IKDC", "Tegner", "VAS Dor"], "protocolPatellar24Months"),
      }
    : isLcmSurgery
    ? {
        "pre-op": protocol("pre-op", ["Lysholm", "IKDC", "Tegner"], "protocolMclPreop"),
        "6sem": protocol("6sem", ["Lysholm", "IKDC"], "protocolMcl6Weeks"),
        "3m": protocol("3m", ["Lysholm", "IKDC", "Tegner"], "protocolMcl3Months"),
        "6m": protocol("6m", ["Lysholm", "IKDC", "Tegner"], "protocolMcl6Months"),
        "12m": protocol("12m", ["Lysholm", "IKDC", "Tegner"], "protocolMcl12Months"),
        "24m": protocol("24m", ["Lysholm", "IKDC", "Tegner"], "protocolMcl24Months"),
      }
    : isCplSurgery
    ? {
        "pre-op": protocol("pre-op", ["Lysholm", "IKDC", "Tegner"], "protocolCplPreop"),
        "1m": protocol("1m", ["VAS Dor", "Lysholm"], "protocolCpl1Month"),
        "3m": protocol("3m", ["VAS Dor", "Lysholm", "IKDC"], "protocolCpl3Months"),
        "6m": protocol("6m", ["IKDC", "Lysholm", "Tegner"], "protocolCpl6Months"),
        "12m": protocol("12m", ["IKDC", "Lysholm", "Tegner", "VAS Dor"], "protocolCpl12Months"),
        "24m": protocol("24m", ["IKDC", "Lysholm", "Tegner", "VAS Dor"], "protocolCpl24Months"),
      }
    : isLcpSurgery
    ? {
        "pre-op": protocol("pre-op", ["IKDC", "Lysholm", "Tegner"], "protocolLcpPreop"),
        "1m": protocol("1m", ["VAS Dor", "Lysholm"], "protocolLcp1Month"),
        "3m": protocol("3m", ["VAS Dor", "Lysholm", "IKDC"], "protocolLcp3Months"),
        "6m": protocol("6m", ["VAS Dor", "Lysholm", "IKDC", "Tegner"], "protocolLcp6Months"),
        "12m": protocol("12m", ["Lysholm", "IKDC", "Tegner", "VAS Dor"], "protocolLcp12Months"),
        "24m": protocol("24m", ["Lysholm", "IKDC", "Tegner", "VAS Dor"], "protocolLcp24Months"),
        "anual": protocol("anual", ["Lysholm", "IKDC", "Tegner", "VAS Dor"], "protocolLcpAnnual"),
      }
    : isOsteocondralSurgery
    ? {
        "pre-op": protocol("pre-op", ["IKDC", "KOOS-12", "WOMAC", "VAS Dor", "Tegner"], "protocolOsteochondralPreop"),
        "6sem": protocol("6sem", ["VAS Dor", "KOOS-12", "WOMAC"], "protocolOsteochondral6Weeks"),
        "3m": protocol("3m", ["VAS Dor", "IKDC", "KOOS-12", "WOMAC"], "protocolOsteochondral3Months"),
        "6m": protocol("6m", ["IKDC", "KOOS-12", "WOMAC", "Tegner", "VAS Dor"], "protocolOsteochondral6Months"),
        "12m": protocol("12m", ["IKDC", "KOOS-12", "WOMAC", "Tegner", "VAS Dor"], "protocolOsteochondral12Months"),
        "24m": protocol("24m", ["IKDC", "KOOS-12", "WOMAC", "Tegner", "VAS Dor"], "protocolOsteochondral24Months"),
        "5a": protocol("5a", ["IKDC", "KOOS-12", "WOMAC", "Tegner"], "protocolOsteochondral5Years"),
      }
    : isArtroplastiaSurgery
    ? {
        "pre-op": protocol("pre-op", ["VAS Dor", "WOMAC", "KOOS-12", "Tegner"], "protocolArthroplastyPreop"),
        "7-14d": protocol("7-14d", ["VAS Dor"], "protocolArthroplasty7to14Days"),
        "3sem": protocol("3sem", ["VAS Dor"], "protocolArthroplasty3Weeks"),
        "6sem": protocol("6sem", ["VAS Dor", "WOMAC"], "protocolArthroplasty6Weeks"),
        "3m": protocol("3m", ["VAS Dor", "WOMAC", "KOOS-12"], "protocolArthroplasty3Months"),
        "6m": protocol("6m", ["VAS Dor", "WOMAC", "KOOS-12", "Tegner"], "protocolArthroplasty6Months"),
        "1a": protocol("1a", ["VAS Dor", "WOMAC", "KOOS-12", "Tegner"], "protocolArthroplasty1Year"),
        "2a": protocol("2a", ["WOMAC", "KOOS-12"], "protocolArthroplasty2Years"),
        "anual": protocol("anual3", ["WOMAC", "KOOS-12"], "protocolArthroplastyAnnual"),
      }
    : isOrtobiologicoSurgery
    ? {
        "pre-op": protocol("pre-op", ["VAS Dor", "WOMAC", "IKDC", "KOOS-12", "Tegner"], "protocolOrthobiologicPreop"),
        "1m": protocol("1mStandard", ["VAS Dor", "WOMAC"], "protocolOrthobiologic1Month"),
        "6sem": protocol("6sem", ["VAS Dor", "WOMAC"], "protocolOrthobiologic6Weeks"),
        "3m": protocol("3m", ["VAS Dor", "WOMAC", "IKDC"], "protocolOrthobiologic3Months"),
        "6m": protocol("6m", ["VAS Dor", "WOMAC", "IKDC", "KOOS-12", "Tegner"], "protocolOrthobiologic6Months"),
        "12m": protocol("12m", ["VAS Dor", "WOMAC", "IKDC", "KOOS-12", "Tegner"], "protocolOrthobiologic12Months"),
        "24m": protocol("24m", ["VAS Dor", "WOMAC", "IKDC", "KOOS-12", "Tegner"], "protocolOrthobiologic24Months"),
        "4a": protocol("4a", ["VAS Dor", "WOMAC", "IKDC", "KOOS-12", "Tegner"], "protocolOrthobiologic4Years"),
      }
    : {
        "pre-op": protocol("pre-op", ["IKDC", "VAS Dor", "Lysholm", "ACL-RSI"], "protocolLcaPreop"),
        "1m": protocol("1m", ["VAS Dor", "Lysholm"], "protocolLca1Month"),
        "3m": protocol("3m", ["VAS Dor", "Lysholm", "IKDC"], "protocolLca3Months"),
        "6m": protocol("6m", ["VAS Dor", "IKDC", "Lysholm", "ACL-RSI", "Marx"], "protocolLca6Months"),
        "12m": protocol("12m", ["IKDC", "Lysholm", "ACL-RSI", "Tegner", "Marx", "VAS Dor"], "protocolLca12Months"),
        "24m": protocol("24m", ["IKDC", "Lysholm", "Tegner", "VAS Dor"], "protocolLca24Months"),
      };

  type ScalePreviewOption = { value: string; label: string };
  const ly = (value: string, key: keyof typeof surgeryCoreMessages["pt-BR"]): ScalePreviewOption => ({ value, label: t(key) });
  const SCALE_PREVIEWS: Record<string, { title: string; description: string; questions: { label: string; type: string; options?: (string | ScalePreviewOption)[] }[] }> = {
    "VAS Dor": {
      title: t("scaleVasTitle"),
      description: t("scaleVasDescription"),
      questions: [
        { label: t("scaleVasQuestion"), type: "slider" },
      ],
    },
    "Tegner": {
      title: t("scaleTegnerTitle"),
      description: t("scaleTegnerDescription"),
      questions: [
        { label: t("scaleTegnerQuestion"), type: "radio",
          options: [
            { value: "0 — Licença por invalidez", label: t("scaleTegner0") }, { value: "1 — Trabalho de escritório", label: t("scaleTegner1") },
            { value: "2 — Caminhada em terreno plano", label: t("scaleTegner2") }, { value: "3 — Natação ou caminhada na floresta", label: t("scaleTegner3") },
            { value: "4 — Ciclismo, ski, jogging 2×/sem", label: t("scaleTegner4") }, { value: "5 — Jogging 5×/sem ou futebol recreativo", label: t("scaleTegner5") },
            { value: "6 — Tênis, handebol recreativo", label: t("scaleTegner6") }, { value: "7 — Futebol/handebol divisão baixa", label: t("scaleTegner7") },
            { value: "8 — Futebol/handebol elite júnior", label: t("scaleTegner8") }, { value: "9 — Futebol/handebol divisão superior", label: t("scaleTegner9") },
            { value: "10 — Futebol/handebol nível nacional/internacional", label: t("scaleTegner10") },
          ] },
      ],
    },
    "Lysholm": {
      title: t("lyTitle"),
      description: t("lyDescription"),
      questions: [
        { label: t("lyQ1"), type: "radio", options: [ly("Nenhuma", "lyO1"), ly("Leve ou periódica", "lyO2"), ly("Grave ou constante", "lyO3")] },
        { label: t("lyQ2"), type: "radio", options: [ly("Apoio completo sem suporte", "lyO4"), ly("Necessita de bengala ou muleta", "lyO5"), ly("Não consegue apoiar o peso", "lyO6")] },
        { label: t("lyQ3"), type: "radio", options: [ly("Nenhum bloqueio", "lyO7"), ly("Bloqueio parcial ocasional", "lyO8"), ly("Bloqueio frequente", "lyO9"), ly("Articulação bloqueada no exame", "lyO10"), ly("Articulação bloqueada e fixada", "lyO11")] },
        { label: t("lyQ4"), type: "radio", options: [ly("Nunca", "lyO12"), ly("Raramente em atividades intensas", "lyO13"), ly("Frequentemente em atividades intensas", "lyO14"), ly("Ocasionalmente em atividades diárias", "lyO15"), ly("Frequentemente em atividades diárias", "lyO16"), ly("A cada passo", "lyO17")] },
        { label: t("lyQ5"), type: "radio", options: [ly("Nenhuma", "lyO1"), ly("Inconstante e leve com exercício intenso", "lyO18"), ly("Marcante com exercício intenso", "lyO19"), ly("Marcante após caminhada >2km", "lyO20"), ly("Marcante após caminhada <2km", "lyO21"), ly("Constante", "lyO22")] },
        { label: t("lyQ6"), type: "radio", options: [ly("Nenhum", "lyO23"), ly("Com esforço intenso", "lyO24"), ly("Com esforço moderado", "lyO25"), ly("Constante", "lyO22")] },
        { label: t("lyQ7"), type: "radio", options: [ly("Sem problema", "lyO26"), ly("Levemente comprometido", "lyO27"), ly("Um degrau por vez", "lyO28"), ly("Incapaz", "lyO29")] },
        { label: t("lyQ8"), type: "radio", options: [ly("Sem problema", "lyO26"), ly("Levemente comprometido", "lyO27"), ly("Não além de 90 graus", "lyO30"), ly("Incapaz", "lyO29")] },
      ],
    },
    "IKDC": {
      title: t("ikTitle"),
      description: t("ikDescription"),
      questions: [
        { label: t("ikQ1"), type: "radio", options: [ly("Atividades muito intensas (saltar, corte em esportes)", "ikO1"), ly("Atividades intensas (trabalho físico pesado, ski, tênis)", "ikO2"), ly("Atividades moderadas (trabalho físico moderado, corrida)", "ikO3"), ly("Atividades leves (caminhada, serviço doméstico leve)", "ikO4"), ly("Incapaz de realizar qualquer atividade", "ikO5")] },
        { label: t("ikQ2"), type: "radio", options: ["Nunca", "Raramente", "Às vezes", "Frequentemente", "Sempre"].map((value, i) => ly(value, (`ikO${i + 6}`) as keyof typeof surgeryCoreMessages["pt-BR"])) },
        { label: t("ikQ3"), type: "slider" },
        { label: t("ikQ4"), type: "radio", options: ["Nenhuma", "Leve", "Moderada", "Grave", "Extrema"].map((value, i) => ly(value, (`ikO${i + 11}`) as keyof typeof surgeryCoreMessages["pt-BR"])) },
        { label: t("ikQ5"), type: "radio", options: ["Nunca", "Raramente", "Às vezes", "Frequentemente", "Sempre"].map((value, i) => ly(value, (`ikO${i + 6}`) as keyof typeof surgeryCoreMessages["pt-BR"])) },
        { label: t("ikQ6"), type: "radio", options: ["Nunca", "Raramente", "Às vezes", "Frequentemente", "Sempre"].map((value, i) => ly(value, (`ikO${i + 6}`) as keyof typeof surgeryCoreMessages["pt-BR"])) },
        { label: t("ikQ7"), type: "radio", options: ["Nunca", "Raramente", "Às vezes", "Frequentemente", "Sempre"].map((value, i) => ly(value, (`ikO${i + 6}`) as keyof typeof surgeryCoreMessages["pt-BR"])) },
        { label: t("ikQ8"), type: "radio", options: ["Atividades muito intensas", "Atividades intensas", "Atividades moderadas", "Atividades leves", "Incapaz"].map((value, i) => ly(value, (`ikO${i + 16}`) as keyof typeof surgeryCoreMessages["pt-BR"])) },
        { label: t("ikQ9"), type: "slider" }, { label: t("ikQ10"), type: "slider" },
      ],
    },
    "Kujala": {
      title: t("kujTitle"),
      description: t("kujDescription"),
      questions: [
        { label: t("kujQ1"), type: "radio", options: [ly("Nenhuma", "kujO1"), ly("Leve / periódica", "kujO2"), ly("Constante", "kujO3")] },
        { label: t("kujQ2"), type: "radio", options: [ly("Apoio completo", "kujO4"), ly("Com bengala / muleta", "kujO5"), ly("Não consegue apoiar", "kujO6")] },
        { label: t("kujQ3"), type: "radio", options: [ly("Ilimitado", "kujO7"), ly("Mais de 2km", "kujO8"), ly("1 a 2km", "kujO9"), ly("Menos de 1km", "kujO10")] },
        { label: t("kujQ4"), type: "radio", options: [ly("Sem problema", "kujO11"), ly("Leve dificuldade", "kujO12"), ly("Muito devagar", "kujO13"), ly("Menos de 10 degraus", "kujO14"), ly("Incapaz", "kujO15")] },
        { label: t("kujQ5"), type: "radio", options: [ly("Sem problema", "kujO11"), ly("Leve dificuldade", "kujO12"), ly("Não além de 90°", "kujO16"), ly("Leve flexão apenas", "kujO17"), ly("Incapaz", "kujO15")] },
        { label: t("kujQ6"), type: "radio", options: [ly("Sem problema", "kujO11"), ly("Dor após mais de 2km", "kujO18"), ly("Dor após menos de 2km", "kujO19"), ly("Dor após menos de 1km", "kujO20"), ly("Sempre com dor", "kujO21")] },
        { label: t("kujQ7"), type: "radio", options: [ly("Sem problema", "kujO11"), ly("Leve dificuldade", "kujO12"), ly("Dificuldade moderada", "kujO22"), ly("Apenas um salto", "kujO23"), ly("Incapaz", "kujO15")] },
        { label: t("kujQ8"), type: "radio", options: [ly("Sem problema", "kujO11"), ly("Dói após algum tempo", "kujO24"), ly("Dói após menos de 30 min", "kujO25"), ly("Dói imediatamente", "kujO26"), ly("Incapaz", "kujO15")] },
        { label: t("kujQ9"), type: "radio", options: [ly("Nenhuma", "kujO1"), ly("Leve / ocasional", "kujO27"), ly("Moderada / às vezes", "kujO28"), ly("Grave / frequente", "kujO29"), ly("Constante / intensa", "kujO30")] },
        { label: t("kujQ10"), type: "radio", options: [ly("Nenhum", "kujO31"), ly("Após atividade intensa", "kujO32"), ly("Após atividade moderada", "kujO33"), ly("Após atividade leve", "kujO34"), ly("Constante", "kujO3")] },
        { label: t("kujQ11"), type: "radio", options: [ly("Nunca", "kujO35"), ly("1 episódio", "kujO36"), ly("2 episódios", "kujO37"), ly("3 ou mais episódios", "kujO38"), ly("Com qualquer atividade", "kujO39")] },
        { label: t("kujQ12"), type: "radio", options: [ly("Nenhuma", "kujO1"), ly("Leve (1–2 cm)", "kujO40"), ly("Grave (mais de 2 cm)", "kujO41")] },
        { label: t("kujQ13"), type: "radio", options: [ly("Normal (mais de 130°)", "kujO42"), ly("130° ou menos", "kujO43"), ly("120° ou menos", "kujO44"), ly("90° ou menos", "kujO45"), ly("60° ou menos", "kujO46")] },
      ],
    },
    "ACL-RSI": {
      title: t("aclRsiTitle"),
      description: t("aclRsiDescription"),
      questions: [
        { label: t("aclRsiQ1"), type: "slider" }, { label: t("aclRsiQ2"), type: "slider" }, { label: t("aclRsiQ3"), type: "slider" }, { label: t("aclRsiQ4"), type: "slider" }, { label: t("aclRsiQ5"), type: "slider" }, { label: t("aclRsiQ6"), type: "slider" }, { label: t("aclRsiQ7"), type: "slider" }, { label: t("aclRsiQ8"), type: "slider" }, { label: t("aclRsiQ9"), type: "slider" }, { label: t("aclRsiQ10"), type: "slider" }, { label: t("aclRsiQ11"), type: "slider" }, { label: t("aclRsiQ12"), type: "slider" },
      ],
    },
    "Marx": {
      title: t("marxTitle"),
      description: t("marxDescription"),
      questions: [
        { label: t("marxQ1"), type: "radio", options: ["Nunca", "Raramente (<1×/mês)", "Às vezes (1–3×/mês)", "Frequentemente (≥1×/sem)", "Diariamente"].map((value, i) => ly(value, (`marxO${i + 1}`) as keyof typeof surgeryCoreMessages["pt-BR"])) },
        { label: t("marxQ2"), type: "radio", options: ["Nunca", "Raramente (<1×/mês)", "Às vezes (1–3×/mês)", "Frequentemente (≥1×/sem)", "Diariamente"].map((value, i) => ly(value, (`marxO${i + 1}`) as keyof typeof surgeryCoreMessages["pt-BR"])) },
        { label: t("marxQ3"), type: "radio", options: ["Nunca", "Raramente (<1×/mês)", "Às vezes (1–3×/mês)", "Frequentemente (≥1×/sem)", "Diariamente"].map((value, i) => ly(value, (`marxO${i + 1}`) as keyof typeof surgeryCoreMessages["pt-BR"])) },
        { label: t("marxQ4"), type: "radio", options: ["Nunca", "Raramente (<1×/mês)", "Às vezes (1–3×/mês)", "Frequentemente (≥1×/sem)", "Diariamente"].map((value, i) => ly(value, (`marxO${i + 1}`) as keyof typeof surgeryCoreMessages["pt-BR"])) },
      ],
    },
    "WOMAC": {
      title: t("womacTitle"),
      description: t("womacDescription"),
      questions: [
        { label: t("womacQ1"), type: "radio", options: ["Nenhuma", "Pouca", "Moderada", "Intensa", "Muitíssima"].map((value, i) => ly(value, (`womacO${i + 1}`) as keyof typeof surgeryCoreMessages["pt-BR"])) },
        { label: t("womacQ2"), type: "radio", options: ["Nenhuma", "Pouca", "Moderada", "Intensa", "Muitíssima"].map((value, i) => ly(value, (`womacO${i + 1}`) as keyof typeof surgeryCoreMessages["pt-BR"])) },
        { label: t("womacQ3"), type: "radio", options: ["Nenhuma", "Pouca", "Moderada", "Intensa", "Muitíssima"].map((value, i) => ly(value, (`womacO${i + 1}`) as keyof typeof surgeryCoreMessages["pt-BR"])) },
        { label: t("womacQ4"), type: "radio", options: ["Nenhuma", "Pouca", "Moderada", "Intensa", "Muitíssima"].map((value, i) => ly(value, (`womacO${i + 1}`) as keyof typeof surgeryCoreMessages["pt-BR"])) },
        { label: t("womacQ5"), type: "radio", options: ["Nenhuma", "Pouca", "Moderada", "Intensa", "Muitíssima"].map((value, i) => ly(value, (`womacO${i + 1}`) as keyof typeof surgeryCoreMessages["pt-BR"])) },
        { label: t("womacQ6"), type: "radio", options: ["Nenhuma", "Pouca", "Moderada", "Intensa", "Muitíssima"].map((value, i) => ly(value, (`womacO${i + 1}`) as keyof typeof surgeryCoreMessages["pt-BR"])) },
        { label: t("womacQ7"), type: "radio", options: ["Nenhuma", "Pouca", "Moderada", "Intensa", "Muitíssima"].map((value, i) => ly(value, (`womacO${i + 1}`) as keyof typeof surgeryCoreMessages["pt-BR"])) },
        { label: t("womacQ8"), type: "radio", options: ["Nenhuma", "Pouca", "Moderada", "Intensa", "Muitíssima"].map((value, i) => ly(value, (`womacO${i + 1}`) as keyof typeof surgeryCoreMessages["pt-BR"])) },
        ...["FUNÇÃO — 9. Subir escadas", "FUNÇÃO — 10. Levantar de uma cadeira", "FUNÇÃO — 11. Ficar em pé", "FUNÇÃO — 12. Agachar", "FUNÇÃO — 13. Caminhar em terreno plano", "FUNÇÃO — 14. Entrar e sair do carro", "FUNÇÃO — 15. Fazer compras", "FUNÇÃO — 16. Calçar meias / meia-calça"].map((value, i) => ({ label: t((`womacQ${i + 9}`) as keyof typeof surgeryCoreMessages["pt-BR"]), type: "radio", options: ["Nenhuma", "Pouca", "Moderada", "Intensa", "Muitíssima"].map((option, oi) => ly(option, (`womacO${oi + 1}`) as keyof typeof surgeryCoreMessages["pt-BR"])) })),
        ...["FUNÇÃO — 17. Levantar da cama", "FUNÇÃO — 18. Tirar meias / meia-calça", "FUNÇÃO — 19. Deitar na cama", "FUNÇÃO — 20. Entrar e sair da banheira", "FUNÇÃO — 21. Sentar", "FUNÇÃO — 22. Sentar e levantar do vaso sanitário", "FUNÇÃO — 23. Realizar tarefas domésticas pesadas", "FUNÇÃO — 24. Realizar tarefas domésticas leves"].map((value, i) => ({ label: t((`womacQ${i + 17}`) as keyof typeof surgeryCoreMessages["pt-BR"]), type: "radio", options: ["Nenhuma", "Pouca", "Moderada", "Intensa", "Muitíssima"].map((option, oi) => ly(option, (`womacO${oi + 1}`) as keyof typeof surgeryCoreMessages["pt-BR"])) })),
      ],
    },
  };

  const handleSendScales = async () => {
    if (!sendScalesFollowupId || selectedScales.length === 0) return;
    setSendingScales(true);
    try {
      const r = await fetch(`/api/followup/${sendScalesFollowupId}/send-scales`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ escalasEnviadas: selectedScales }),
      });
      const data = await r.json();
      if (data.token) {
        const link = data.link ?? `${window.location.origin}${import.meta.env.BASE_URL}patient/${data.token}`.replace(/\/\//g, "/").replace(":/", "://");
        setPatientLink(link);
        queryClient.invalidateQueries({ queryKey: getGetSurgeryQueryKey(id) });
      }
    } catch {
      toast({ title: t("linkGenerationError"), variant: "destructive" });
    } finally {
      setSendingScales(false);
    }
  };

  const copyLink = (link: string) => {
    navigator.clipboard.writeText(link);
    toast({ title: t("linkCopied") });
  };

  const handlePrepareWhatsApp = async (notifId: number) => {
    setWaPreparing(notifId);
    try {
      const r = await fetch(`/api/surgeries/${id}/schedule/${notifId}/prepare-whatsapp`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
      });
      const data = await r.json();
      if (data.followupId) {
        if (surgery?.patient?.telefone) {
          // Abrir wa.me direto no WhatsApp do médico, sem o dialog
          const digits = surgery.patient.telefone.replace(/\D/g, "");
          const waPhone = digits.startsWith("55") ? digits : `55${digits}`;
          window.open(`https://wa.me/${waPhone}?text=${encodeURIComponent(data.message)}`, "_blank");
          void markNotifStatus(notifId, "sent");
          toast({ title: t("whatsappOpened"), description: t("completeSending") });
        } else {
          setWaNotifId(notifId);
          setWaMessage(data.message);
          setWaLink(data.link ?? "");
          setWaDialogOpen(true);
        }
      } else {
        toast({ title: t("prepareMessageError"), description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: t("prepareMessageError"), variant: "destructive" });
    } finally {
      setWaPreparing(null);
    }
  };

  const handleSaveAdm = async () => {
    if (!admDialog) return;
    setSavingAdm(true);
    try {
      const complicacoesArr = isFractureSurgery
        ? Array.from(new Set([
            ...splitComplicationText(admDialog.complicacoes),
            ...splitComplicationText(admDialog.complicacoesAgudas)
              .map((item) => encodeFractureComplication("aguda", item)),
            ...splitComplicationText(admDialog.complicacoesTardias)
              .map((item) => encodeFractureComplication("tardia", item)),
          ]))
        : splitComplicationText(admDialog.complicacoes);
      const body: Record<string, unknown> = {
        complicacoes: complicacoesArr,
        observacoes: admDialog.obs || null,
      };
      if (admDialog.flexao !== "") body.admFlexao = Number(admDialog.flexao);
      if (admDialog.extensao !== "") body.admExtensao = Number(admDialog.extensao);
      const r = await fetch(`/api/surgeries/${id}/followups/${admDialog.followupId}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.ok) {
        const updated = await r.json();
        queryClient.setQueryData(getGetSurgeryQueryKey(id), (prev: any) => prev ? {
          ...prev,
          followups: (prev.followups as any[]).map((f: any) => f.id === admDialog.followupId ? { ...f, ...updated } : f),
        } : prev);
        toast({ title: t("admSaved") });
        setAdmDialog(null);
      } else {
        const err = await r.json();
        toast({ title: t("saveError"), description: err.error, variant: "destructive" });
      }
    } catch {
      toast({ title: t("saveError"), variant: "destructive" });
    } finally {
      setSavingAdm(false);
    }
  };

  const handlePrepareFollowupWhatsApp = async (followupId: number) => {
    setWaPreparing(followupId);
    try {
      const r = await fetch(`/api/followup/${followupId}/prepare-whatsapp`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
      });
      const data = await r.json();
      if (data.followupId) {
        setWaNotifId(null);
        setWaMessage(data.message);
        setWaLink(data.link ?? "");
        setWaDialogOpen(true);
      } else {
        toast({ title: t("prepareMessageError"), description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: t("prepareMessageError"), variant: "destructive" });
    } finally {
      setWaPreparing(null);
    }
  };


  const SCALE_SCORE_FIELDS: Record<string, string> = {
    "VAS Dor": "vasDor",
    "Tegner": "tegner",
    "Lysholm": "lysholm",
    "IKDC": "ikdc",
    "Kujala": "kujala",
    "ACL-RSI": "aclRsi",
    "Marx": "marx",
    "WOMAC": "womac",
  };

  const ARTHROPLASTY_COMPLICATIONS = [
    { code: "NEURO-01", nome: t("complicationNeuro01Name"), momento: t("complicationNeuro01Timing"), sinais: t("complicationNeuro01Signs") },
    { code: "NEURO-02", nome: t("complicationNeuro02Name"), momento: t("complicationNeuro02Timing"), sinais: t("complicationNeuro02Signs") },
    { code: "VASCU-01", nome: t("complicationVascu01Name"), momento: t("complicationVascu01Timing"), sinais: t("complicationVascu01Signs") },
    { code: "TROM-01", nome: t("complicationTrom01Name"), momento: t("complicationTrom01Timing"), sinais: t("complicationTrom01Signs") },
    { code: "TROM-02", nome: t("complicationTrom02Name"), momento: t("complicationTrom02Timing"), sinais: t("complicationTrom02Signs") },
    { code: "INFEC-01", nome: t("complicationInfec01Name"), momento: t("complicationInfec01Timing"), sinais: t("complicationInfec01Signs") },
    { code: "INFEC-02", nome: t("complicationInfec02Name"), momento: t("complicationInfec02Timing"), sinais: t("complicationInfec02Signs") },
    { code: "MECA-01", nome: t("complicationMeca01Name"), momento: t("complicationMeca01Timing"), sinais: t("complicationMeca01Signs") },
    { code: "MECA-02", nome: t("complicationMeca02Name"), momento: t("complicationMeca02Timing"), sinais: t("complicationMeca02Signs") },
    { code: "OSSO-01", nome: t("complicationOsso01Name"), momento: t("complicationOsso01Timing"), sinais: t("complicationOsso01Signs") },
    { code: "RIGI-01", nome: t("complicationRigi01Name"), momento: t("complicationRigi01Timing"), sinais: t("complicationRigi01Signs") },
  ];

  const catalogComplication = (code: string) => {
    const key = `complication${code.replace(/-/g, "")}`;
    return {
      code,
      nome: t(`${key}Name` as keyof typeof surgeryCoreMessages["pt-BR"]),
      momento: t(`${key}Timing` as keyof typeof surgeryCoreMessages["pt-BR"]),
      sinais: t(`${key}Signs` as keyof typeof surgeryCoreMessages["pt-BR"]),
    };
  };

  const PATELAR_COMPLICATIONS = [
    { code: "PAT-INST", nome: t("complicationPatInstName"), momento: t("complicationPatInstTiming"), sinais: t("complicationPatInstSigns") },
    { code: "PAT-FRAT", nome: t("complicationPatFratName"), momento: t("complicationPatFratTiming"), sinais: t("complicationPatFratSigns") },
    { code: "PAT-RIGI", nome: t("complicationPatRigiName"), momento: t("complicationPatRigiTiming"), sinais: t("complicationPatRigiSigns") },
    { code: "PAT-DOR", nome: t("complicationPatDorName"), momento: t("complicationPatDorTiming"), sinais: t("complicationPatDorSigns") },
    ...["PAT-INF", "PAT-NFIB", "PAT-HEMA", "PAT-REOP"].map(catalogComplication),
  ];

  const SUTURA_MENISCAL_COMPLICATIONS = [
    ...["MEN-FALH", "MEN-INFP", "MEN-NSAF", "MEN-NPER", "MEN-RIGI", "MEN-TUNE", "MEN-CART", "MEN-EFUS"].map(catalogComplication),
  ];

  const LCM_COMPLICATIONS = [
    ...["LCM-LAXR", "LCM-RIGI", "LCM-NSAF", "LCM-TUNN", "LCM-OSSF", "LCM-INFP", "LCM-MENI", "LCM-DEGM", "LCM-FALH", "LCM-VASC"].map(catalogComplication),
  ];

  const CPL_COMPLICATIONS = [
    ...["CPL-FALH", "CPL-NPER", "CPL-RIGI", "CPL-LAXR", "CPL-VASC", "CPL-TUNE", "CPL-DEGL", "CPL-INFP"].map(catalogComplication),
  ];

  const LCP_COMPLICATIONS = [
    ...["LCP-FALH", "LCP-RIGI", "LCP-LAXR", "LCP-NPER", "LCP-DEGM", "LCP-INFP", "LCP-VASC", "LCP-MENI"].map(catalogComplication),
  ];

  const LCA_COMPLICATIONS = [
    ...["LCA-DOR", "LCA-HEMA", "LCA-INFS", "LCA-INFP", "LCA-TVP", "LCA-TEP", "LCA-RIGI", "LCA-TUNE", "LCA-NSAF", "LCA-FALH", "LCA-CICA", "LCA-SINO", "LCA-MENI", "LCA-CART", "LCA-FRAT", "LCA-LAXR", "LCA-RETP", "LCA-ATRO", "LCA-PATF", "LCA-SDRC"].map(catalogComplication),
  ];

  const OSTEOCONDRAL_COMPLICATIONS = [
    ...["OC-HEMA", "OC-INFS", "OC-INFP", "OC-TVP", "OC-RIGI", "OC-SOLT", "OC-FALC", "OC-SOBR", "OC-DELA", "OC-DOAD", "OC-FALT", "OC-PROG"].map(catalogComplication),
  ];

  const FOLLOWUP_EMPTY = {
    tempo: "",
    dataAvaliacao: new Date().toISOString().split('T')[0],
    ikdc: "",
    koos12: "",
    lysholm: "",
    tegner: "",
    kujala: "",
    vasDor: "",
    aclRsi: "",
    marx: "",
    womac: "",
    admFlexao: "",
    admExtensao: "",
    complicacoes: [] as string[],
    complicacoesAgudasOutro: "",
    complicacoesTardiasOutro: "",
    retornoEsporte: false,
    nivelRetorno: "",
    falha: false,
    falhaType: "",
    observacoes: ""
  };

  const [followupOpen, setFollowupOpen] = useState(false);
  const [followupData, setFollowupData] = useState({ ...FOLLOWUP_EMPTY });

  // Tempos considerados >= 9 meses para escalas específicas (ACL-RSI, Marx)
  const tempoGte9m = ["1 ano", "2 anos", "5 anos"].includes(followupData.tempo);

  const handleFollowupOpenChange = (open: boolean) => {
    if (open) {
      setFollowupData({ ...FOLLOWUP_EMPTY, dataAvaliacao: new Date().toISOString().split('T')[0] });
    }
    setFollowupOpen(open);
  };

  const handleDelete = () => {
    if (deleteMutation.isPending) return;

    deleteMutation.mutate(
      { id },
      {
        onSuccess: () => {
          toast({ title: t("surgeryDeleted") });
          setLocation("/surgeries");
        },
        onError: (error: unknown) => {
          const status = typeof error === "object" && error && "status" in error
            ? (error as { status?: number }).status
            : undefined;

          if (status === 404) {
            toast({ title: t("surgeryAlreadyDeleted") });
            setLocation("/surgeries");
            return;
          }

          toast({ title: t("deleteSurgeryError"), variant: "destructive" });
        }
      }
    );
  };

  const handleCreateFollowup = (e: React.FormEvent) => {
    e.preventDefault();
    const safeFloat = (v: string) => { const n = parseFloat(v); return isNaN(n) ? undefined : n; };
    const safeInt   = (v: string) => { const n = parseInt(v, 10); return isNaN(n) ? undefined : n; };
    const complicacoes = isFractureSurgery
      ? Array.from(new Set([
          ...followupData.complicacoes,
          ...splitComplicationText(followupData.complicacoesAgudasOutro)
            .map((item) => encodeFractureComplication("aguda", item)),
          ...splitComplicationText(followupData.complicacoesTardiasOutro)
            .map((item) => encodeFractureComplication("tardia", item)),
        ]))
      : followupData.complicacoes;
    createFollowupMutation.mutate(
      {
        data: {
          surgeryId: id,
          tempo: followupData.tempo,
          dataAvaliacao: followupData.dataAvaliacao || undefined,
          ikdc:       followupData.ikdc       ? safeFloat(followupData.ikdc) : undefined,
          koos12:     followupData.koos12     ? safeFloat(followupData.koos12 as string) : undefined,
          lysholm:    followupData.lysholm    ? safeFloat(followupData.lysholm) : undefined,
          tegner:     followupData.tegner     ? safeFloat(followupData.tegner) : undefined,
          kujala:     followupData.kujala     ? safeFloat(followupData.kujala) : undefined,
          vasDor:     followupData.vasDor     ? safeFloat(followupData.vasDor) : undefined,
          aclRsi:     followupData.aclRsi     ? safeFloat(followupData.aclRsi) : undefined,
          marx:       followupData.marx       ? safeFloat(followupData.marx) : undefined,
          womac:      followupData.womac      ? safeFloat(followupData.womac) : undefined,
          admFlexao:  followupData.admFlexao  ? safeInt(followupData.admFlexao as string) : undefined,
          admExtensao: followupData.admExtensao ? safeInt(followupData.admExtensao as string) : undefined,
          complicacoes: complicacoes.length > 0 ? complicacoes : undefined,
          retornoEsporte: followupData.retornoEsporte,
          nivelRetorno: followupData.nivelRetorno || undefined,
          falha: followupData.falha,
          falhaType: followupData.falhaType || undefined,
          observacoes: followupData.observacoes || undefined,
        }
      },
      {
        onSuccess: () => {
          toast({ title: t("followupSaved") });
          queryClient.invalidateQueries({ queryKey: getGetSurgeryQueryKey(id) });
          setFollowupData({ ...FOLLOWUP_EMPTY, dataAvaliacao: new Date().toISOString().split('T')[0] });
          setFollowupOpen(false);
        },
        onError: () => {
          toast({ title: t("followupSaveError"), variant: "destructive" });
        }
      }
    );
  };

  if (isLoading) {
    return <div className="p-8 max-w-4xl mx-auto space-y-6" aria-label={t("loading")}><Skeleton className="h-10 w-1/3" /><Skeleton className="h-64 w-full" /></div>;
  }

  if (error || !surgery) {
    return <div className="p-8 text-center text-destructive">{t("loadSurgeryError")}</div>;
  }

  return (
    <>
    <div className="w-full max-w-5xl min-w-0 mx-auto">

    {/* ── Mobile navy banner (hidden md+) ── */}
    <div className="md:hidden" style={{ background: "linear-gradient(135deg, #0A1628 0%, #0D2040 100%)" }}>
      <div className="px-4 pt-5 pb-3">
        <Link href="/surgeries">
          <button style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "rgba(31,182,225,0.85)", background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: 10 }}>
            <ArrowLeft className="h-3.5 w-3.5" />
            {t("proceduresNav")}
          </button>
        </Link>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#fff", margin: 0 }}>{t("surgeryRecord")}</h1>
        <p style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", margin: "3px 0 0" }}>
          {t("patientPrefix")} <span style={{ color: "#fff", fontWeight: 500 }}>{surgery.patient.nome}</span>
        </p>
      </div>
      {/* Mobile action buttons */}
      <div className="px-4 pb-4 flex gap-2 flex-wrap">
        <Link href={`/patients/${surgery.patientId}`}>
          <button style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 500, padding: "8px 12px", borderRadius: 10, background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.8)", border: "none", cursor: "pointer" }}>
            <ClipboardList className="h-4 w-4" />
            {t("medicalRecord")}
          </button>
        </Link>
        <button
          onClick={() => setSummaryOpen(true)}
          style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 500, padding: "8px 12px", borderRadius: 10, background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.8)", border: "none", cursor: "pointer" }}
        >
          <LayoutList className="h-4 w-4" />
          {t("summary")}
        </button>
        <Link href={`/surgeries/new?draft=${id}`}>
          <button style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 500, padding: "8px 12px", borderRadius: 10, background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.8)", border: "none", cursor: "pointer" }}>
            <Pencil className="h-4 w-4" />
          {t("edit")}
          </button>
        </Link>
        {pdfShareUrl && (
          <button
            onClick={handleOpenPDF}
            style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, fontSize: 12, fontWeight: 600, padding: "8px 0", borderRadius: 10, background: "#16a34a", color: "#fff", border: "none", cursor: "pointer" }}
          >
            <ExternalLink className="h-4 w-4" />
            {t("openPdf")}
          </button>
        )}
        <button
          onClick={() => setTextPreviewOpen(true)}
          style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 500, padding: "8px 12px", borderRadius: 10, background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.8)", border: "none", cursor: "pointer" }}
        >
          <FileText className="h-4 w-4" />
          {t("downloadTxt")}
        </button>
        <button
          onClick={handleDownloadPDF}
          disabled={pdfLoading}
          style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, fontSize: 12, fontWeight: 600, padding: "8px 0", borderRadius: 10, background: "#1FB6E1", color: "#fff", border: "none", cursor: pdfLoading ? "default" : "pointer" }}
        >
          {pdfLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {pdfLoading ? "Gerando..." : "Baixar PDF"}
        </button>
      </div>
    </div>

    <div className="w-full min-w-0 p-4 md:p-8 space-y-6 md:space-y-8 animate-in fade-in">
      <div className="hidden md:flex justify-between items-start gap-3">
        <div className="flex items-center gap-3">
          <Link href="/surgeries">
            <Button variant="outline" size="icon" className="shrink-0">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="min-w-0">
            <h1 className="text-xl md:text-3xl font-bold tracking-tight truncate">{t("surgeryRecord")}</h1>
            <p className="text-muted-foreground mt-0.5 text-xs md:text-sm truncate">{t("patientPrefix")} <span className="font-medium text-foreground">{surgery.patient.nome}</span></p>
          </div>
        </div>
        {/* Action buttons */}
        <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0">
          {/* Prontuário */}
          <Link href={`/patients/${surgery.patientId}`}>
            <Button variant="outline" className="gap-2">
              <ClipboardList className="h-4 w-4" />
              {td("detail001")}
            </Button>
          </Link>
          {/* Resumo Completo */}
          <Button variant="outline" className="gap-2" onClick={() => setSummaryOpen(true)}>
            <LayoutList className="h-4 w-4" />
            {td("detail002")}
          </Button>
          {/* Editar Cirurgia */}
          <Link href={`/surgeries/new?draft=${id}`}>
            <Button variant="outline" className="gap-2">
              <Pencil className="h-4 w-4" />
              {td("detail003")}
            </Button>
          </Link>
          {/* Baixar / Abrir PDF */}
          {pdfShareUrl && (
            <Button
              className="gap-2 bg-green-600 hover:bg-green-700 text-white animate-in fade-in"
              onClick={handleOpenPDF}
            >
              <ExternalLink className="h-4 w-4" />
              {td("detail004")}
            </Button>
          )}
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => setTextPreviewOpen(true)}
          >
            <FileText className="h-4 w-4" />
            {t("downloadTxt")}
          </Button>
          <Button
            className="gap-2 bg-[#1A365D] hover:bg-[#1A365D]/90 text-white"
            onClick={handleDownloadPDF}
            disabled={pdfLoading}
          >
            {pdfLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {pdfLoading ? t("generating") : t("downloadPdf")}
          </Button>
          {/* Excluir */}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" className="gap-2">
                <Trash2 className="h-4 w-4" />
                {t("delete")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("deleteSurgeryTitle")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("deleteSurgeryDescription")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDelete}
                  disabled={deleteMutation.isPending}
                  className="bg-destructive text-destructive-foreground"
                >
                  {deleteMutation.isPending ? t("deleting") : t("delete")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <div className="grid min-w-0 gap-6 md:grid-cols-3">
        <Card className="min-w-0 md:col-span-1 shadow-sm border-border h-fit">
          <CardHeader>
            <CardTitle>{t("basicDetails")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Calendar className="h-5 w-5 text-muted-foreground flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-muted-foreground">{t("procedureDate")}</p>
                {editingData ? (
                  <div className="flex items-center gap-1.5 mt-1">
                    <input
                      type="date"
                      value={dataValue}
                      onChange={e => setDataValue(e.target.value)}
                      className="h-7 rounded border border-input bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <Button size="icon" variant="ghost" className="h-7 w-7" disabled={savingData || !dataValue} onClick={() => saveData(dataValue)}>
                      {savingData ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5 text-primary" />}
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingData(false)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <p>{surgery.dataCirurgia ? formatDate(surgery.dataCirurgia, { day: "2-digit", month: "2-digit", year: "numeric" }) : '-'}</p>
                    <Button
                      size="icon" variant="ghost" className="h-6 w-6 opacity-60 hover:opacity-100"
                      onClick={() => {
                        const d = surgery.dataCirurgia ? surgery.dataCirurgia.slice(0, 10) : "";
                        setDataValue(d);
                        setEditingData(true);
                      }}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Calendar className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">{t("registrationDate")}</p>
                <p>{surgery.createdAt ? formatDate(surgery.createdAt, { day: "2-digit", month: "2-digit", year: "numeric" }) : '-'}</p>
              </div>
            </div>
            <div className="pt-4 border-t border-border space-y-2">
              <div className="flex justify-between gap-2">
                <span className="text-sm text-muted-foreground shrink-0">{t("surgeryType")}</span>
                <span className="font-medium text-right">{surgery.tipoCaso || '-'}</span>
              </div>
              {surgery.diagnostico && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm text-muted-foreground">{td("detail005")}</span>
                  <p className="text-sm font-medium whitespace-pre-wrap">{surgery.diagnostico}</p>
                </div>
              )}
              <div className="flex justify-between items-center gap-2">
                <span className="text-sm text-muted-foreground shrink-0">{td("detail006")}</span>
                <span className="font-medium text-right">{surgery.alinhamento || '-'}</span>
              </div>
              <div className="flex justify-between items-center gap-2">
                <span className="text-sm text-muted-foreground">{t("surgerySide")}</span>
                {editingLado ? (
                  <div className="flex items-center gap-1.5">
                    <Select value={ladoValue} onValueChange={setLadoValue}>
                      <SelectTrigger className="h-7 w-32 text-xs">
                        <SelectValue placeholder={t("selectPatient")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Direito">{t("right")}</SelectItem>
                        <SelectItem value="Esquerdo">{t("left")}</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button size="icon" variant="ghost" className="h-7 w-7" disabled={savingLado} onClick={() => saveLado(ladoValue)}>
                      {savingLado ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5 text-primary" />}
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingLado(false)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium">{sideLabel((surgery as any).lado)}</span>
                    <Button
                      size="icon" variant="ghost" className="h-6 w-6 opacity-60 hover:opacity-100"
                      onClick={() => { setLadoValue((surgery as any).lado || ""); setEditingLado(true); }}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
            
            <div className="pt-4 border-t border-border">
              <p className="text-sm font-medium text-muted-foreground mb-2">{td("detail007")}</p>
              <div className="flex flex-wrap gap-1">
                {surgery.tiposProcedimento.map(proc => (
                  <Badge key={proc} variant="outline" className="bg-primary/5 text-primary border-primary/20">{proc}</Badge>
                ))}
              </div>
            </div>
            
            <div className="pt-4 border-t border-border space-y-3">
              <p className="text-sm font-medium text-muted-foreground">{td("detail008")}</p>
              {surgery.ligamentosAcometidos.map(lig => {
                const det = (() => {
                  try {
                    const d = JSON.parse((surgery as any).procedimentosDetalhados ?? "{}");
                    if (lig === "LCM" && d.lcm) return d.lcm as { tecnica?: string; enxerto?: string; fixacaoProximal?: string; fixacaoDistal?: string };
                    return null;
                  } catch { return null; }
                })();
                const isLca = lig === "LCA";
                return (
                  <div key={lig} className="rounded-lg border border-border p-2.5">
                    <div className="flex items-center gap-2 mb-1.5">
                      <Badge variant="default" className="text-xs">{lig === "PLC" ? "CPL" : lig}</Badge>
                      <span className="text-xs text-muted-foreground font-medium">{td("detail009")}</span>
                    </div>
                    {isLca && (surgery as any).tipoLca === "Reparo" && (
                      <div className="space-y-0.5">
                        <p className="text-xs"><span className="text-muted-foreground">{td("detail010")} </span><span className="font-medium">{td("detail011")}</span></p>
                        {(surgery as any).localizacaoLesaoLca && <p className="text-xs"><span className="text-muted-foreground">{td("detail012")} </span><span className="font-medium">{(surgery as any).localizacaoLesaoLca}</span></p>}
                        {(surgery as any).fixacaoReparoLca && <p className="text-xs"><span className="text-muted-foreground">{td("detail013")} </span><span className="font-medium">{(surgery as any).fixacaoReparoLca}</span></p>}
                        {surgery.internalBrace && <p className="text-xs"><span className="text-muted-foreground">{td("detail014")} </span><span className="font-medium">{surgery.internalBrace}</span></p>}
                      </div>
                    )}
                    {isLca && (surgery as any).tipoLca !== "Reparo" && (surgery.enxerto || surgery.diametroEnxerto || (surgery as any).flipCutter || surgery.fixacaoFemoral || surgery.fixacaoTibial || surgery.internalBrace || (surgery as any).preservacaoRemanescente) && (
                      <div className="space-y-0.5">
                        {surgery.enxerto && <p className="text-xs"><span className="text-muted-foreground">{td("detail015")} </span><span className="font-medium">{surgery.enxerto}{surgery.diametroEnxerto ? ` (${surgery.diametroEnxerto})` : ""}</span></p>}
                        {(surgery as any).flipCutter && <p className="text-xs"><span className="text-muted-foreground">{t("flipCutter")}: </span><span className="font-medium">{(surgery as any).flipCutter}</span></p>}
                        {surgery.fixacaoFemoral && <p className="text-xs"><span className="text-muted-foreground">{td("detail016")} </span><span className="font-medium">{surgery.fixacaoFemoral}</span></p>}
                        {surgery.fixacaoTibial && <p className="text-xs"><span className="text-muted-foreground">{td("detail017")} </span><span className="font-medium">{surgery.fixacaoTibial}</span></p>}
                        {surgery.internalBrace && <p className="text-xs"><span className="text-muted-foreground">{td("detail014")} </span><span className="font-medium">{surgery.internalBrace}</span></p>}
                        {(surgery as any).preservacaoRemanescente && <p className="text-xs"><span className="text-muted-foreground">{td("detail018")} </span><span className="font-medium">{(surgery as any).preservacaoRemanescente}</span></p>}
                      </div>
                    )}
                    {det && (det.tecnica || det.enxerto || det.fixacaoProximal || det.fixacaoDistal) && (
                      <div className="space-y-0.5">
                        {det.tecnica && <p className="text-xs"><span className="text-muted-foreground">{td("detail019")} </span><span className="font-medium">{det.tecnica}</span></p>}
                        {det.enxerto && <p className="text-xs"><span className="text-muted-foreground">{td("detail015")} </span><span className="font-medium">{det.enxerto}</span></p>}
                        {det.fixacaoProximal && <p className="text-xs"><span className="text-muted-foreground">{td("detail020")} </span><span className="font-medium">{det.fixacaoProximal}</span></p>}
                        {det.fixacaoDistal && <p className="text-xs"><span className="text-muted-foreground">{td("detail021")} </span><span className="font-medium">{det.fixacaoDistal}</span></p>}
                      </div>
                    )}
                    {!isLca && !det && <p className="text-xs text-muted-foreground italic">{td("detail022")}</p>}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <div className="min-w-0 md:col-span-2 space-y-6">
          <Tabs defaultValue="detalhes" className="w-full min-w-0">
            <TabsList className="grid w-full grid-cols-1">
              <TabsTrigger value="detalhes">{td("detail023")}</TabsTrigger>
            </TabsList>
            
            <TabsContent value="detalhes" className="min-w-0 space-y-4 mt-4">
              {/* ── Planejamento RX ─────────────────────────────────────────── */}
              {surgery.rxAnaliseJson && (() => {
                type RxAnalysis = {
                  eixoMecanico?: { desvio: string; graus: number };
                  mLDFA?: { valor: number; referencia: string; status: string };
                  aMPTA?: { valor: number; referencia: string; status: string };
                  JLCA?: { valor: number; referencia: string; status: string };
                  MAD?: { valor: number; unidade: string; lado: string; status: string };
                  percentualWBL?: { preCorrecao?: number; posCorrecao?: number; alvo?: string; interpretacao?: string };
                  origemDesvio?: string;
                  grauVaro?: string;
                  indicacaoOsteotomia?: boolean;
                  opcoesOsteotomia?: unknown[];
                  alertas?: string[];
                  qualidadeImagem?: string;
                  justificativa?: string;
                  tipoAnalise?: string;
                  ladoAvaliado?: string;
                  _selectedOsteotomiaIdx?: number | null;
                  _selectedOsteotomiaId?: string | null;
                  deformidadeExtraArticular?: { presente: boolean; recomendacao: string; osso: string };
                };
                let rx: RxAnalysis;
                try { rx = JSON.parse(surgery.rxAnaliseJson); } catch { return null; }
                if (!rx.eixoMecanico && !rx.mLDFA && !rx.aMPTA && !Array.isArray(rx.opcoesOsteotomia)) return null;
                const selectedIdx = resolveSelectedOsteotomyOption(
                  rx,
                  rx._selectedOsteotomiaIdx,
                  typeof rx._selectedOsteotomiaId === "string" ? rx._selectedOsteotomiaId : undefined,
                )
                  ? rx._selectedOsteotomiaIdx!
                  : null;
                const rxPdfOptionsAvailable = Array.isArray(rx.opcoesOsteotomia)
                  && rx.opcoesOsteotomia.length > 0;
                const rxPdfSelectionRequired = isOsteotomySelectionRequired(rx);
                const rxPdfSelectionValid = isValidOsteotomySelection(rx, selectedIdx);
                const selectedOpcao = (selectedIdx !== null && Array.isArray(rx.opcoesOsteotomia))
                  ? (rx.opcoesOsteotomia[selectedIdx] as Record<string, unknown> | undefined)
                  : null;
                const rxImageUrlRaw = (surgery as any).rxImageUrl as string | null | undefined;
                // objectPath stored as "/objects/..." → serve via "/api/storage/objects/..."
                const rxImageUrl = rxImageUrlRaw
                  ? rxImageUrlRaw.startsWith("/objects/")
                    ? "/api/storage" + rxImageUrlRaw
                    : rxImageUrlRaw
                  : undefined;
                const hkaDesvio = rx.eixoMecanico?.desvio ?? "—";
                const hkaGraus = rx.eixoMecanico?.graus ?? null;
                const desvioColor = hkaDesvio === "Varo"
                  ? "bg-orange-100 text-orange-800 border-orange-300"
                  : hkaDesvio === "Valgo"
                  ? "bg-blue-100 text-blue-800 border-blue-300"
                  : "bg-muted text-muted-foreground";
                const statusColor = (s?: string) => {
                  if (!s) return "text-muted-foreground";
                  if (s === "Normal") return "text-emerald-600";
                  if (s === "Aumentado" || s === "Diminuído" || s === "Alterado") return "text-amber-600";
                  return "text-muted-foreground";
                };
                const isDupla = (id: unknown) => String(id ?? "").startsWith("dupla");
                const isHTO = (id: unknown) => String(id ?? "").startsWith("hto");
                const opcaoColor = selectedOpcao
                  ? isDupla(selectedOpcao.id)
                    ? "border-purple-200 bg-purple-50/60"
                    : isHTO(selectedOpcao.id)
                    ? "border-blue-200 bg-blue-50/60"
                    : "border-orange-200 bg-orange-50/60"
                  : "";
                const opcaoLabelColor = selectedOpcao
                  ? isDupla(selectedOpcao.id) ? "text-purple-700"
                    : isHTO(selectedOpcao.id) ? "text-blue-700"
                    : "text-orange-700"
                  : "";
                return (
                  <Card className="border-teal-200 bg-teal-50/30 shadow-sm">
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-3">
                        <CardTitle className="text-base text-teal-800 flex items-center gap-2">
                          <Scan className="h-4 w-4 text-teal-600" />
                          {td("detail024")}
                        </CardTitle>
                        <div className="flex items-center gap-2 shrink-0">
                          {rxImageUrl && (
                            <a href={rxImageUrl} target="_blank" rel="noopener noreferrer">
                              <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5 border-teal-300 text-teal-700 hover:bg-teal-100">
                                <ExternalLink className="h-3 w-3" />
                                {td("detail025")}
                              </Button>
                            </a>
                          )}
                          {rxPdfShareUrl && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs gap-1.5 border-green-300 text-green-700 hover:bg-green-50"
                              onClick={handleOpenRxPDF}
                            >
                              <ExternalLink className="h-3 w-3" />
                              {td("detail004")}
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs gap-1.5 border-teal-300 text-teal-700 hover:bg-teal-100"
                            onClick={handleDownloadRxPDF}
                            disabled={rxPdfLoading || (rxPdfSelectionRequired && !rxPdfSelectionValid)}
                          >
                            {rxPdfLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                            {td("detail026")}
                          </Button>
                          {rxPdfSelectionRequired && !rxPdfSelectionValid && (
                            <p className="max-w-xs text-[10px] leading-snug text-amber-700">
                              {rxPdfOptionsAvailable
                                ? t("rxOsteotomySelectionRequired")
                                : t("rxOsteotomyOptionsUnavailable")}{" "}
                              {rxPdfOptionsAvailable
                                ? t("rxOsteotomySelectionDescription")
                                : t("rxOsteotomyOptionsUnavailableDescription")}
                            </p>
                          )}
                        </div>
                      </div>
                      {rx.tipoAnalise && (
                        <p className="text-xs text-teal-600 mt-0.5">{rx.tipoAnalise}{rx.ladoAvaliado ? ` · ${rx.ladoAvaliado}` : ""}</p>
                      )}
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* ── Eixo Mecânico / HKA ── */}
                      <div className="space-y-2">
                        <p className="text-xs font-bold uppercase tracking-widest text-teal-600">{td("detail027")}</p>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-semibold ${desvioColor}`}>
                            {td("detail028")} {hkaGraus !== null ? `${hkaGraus}°` : "—"} {hkaDesvio !== "Neutro" && hkaDesvio !== "—" ? hkaDesvio : ""}
                          </span>
                          {rx.origemDesvio && (
                            <span className="text-sm text-muted-foreground">
                              {td("detail029")} <span className="font-medium text-foreground">{rx.origemDesvio}</span>
                            </span>
                          )}
                          {rx.grauVaro && (
                            <span className="text-sm text-muted-foreground">
                              {td("detail030")} <span className="font-medium text-foreground">{rx.grauVaro}</span>
                            </span>
                          )}
                        </div>
                      </div>

                      {/* ── Ângulos Articulares ── */}
                      <div className="space-y-2 border-t border-teal-100 pt-3">
                        <p className="text-xs font-bold uppercase tracking-widest text-teal-600">{td("detail031")}</p>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          {rx.mLDFA && (
                            <div className="bg-white/70 border border-teal-100 rounded-lg p-2.5 text-center">
                              <p className="text-[10px] font-bold uppercase tracking-wide text-teal-600 mb-1">{td("detail032")}</p>
                              <p className="text-lg font-bold text-foreground">{rx.mLDFA.valor}{td("detail033")}</p>
                              <p className={`text-xs mt-0.5 ${statusColor(rx.mLDFA.status)}`}>{rx.mLDFA.status}</p>
                              <p className="text-[10px] text-muted-foreground">{rx.mLDFA.referencia}</p>
                            </div>
                          )}
                          {rx.aMPTA && (
                            <div className="bg-white/70 border border-teal-100 rounded-lg p-2.5 text-center">
                              <p className="text-[10px] font-bold uppercase tracking-wide text-teal-600 mb-1">{td("detail034")}</p>
                              <p className="text-lg font-bold text-foreground">{rx.aMPTA.valor}{td("detail033")}</p>
                              <p className={`text-xs mt-0.5 ${statusColor(rx.aMPTA.status)}`}>{rx.aMPTA.status}</p>
                              <p className="text-[10px] text-muted-foreground">{rx.aMPTA.referencia}</p>
                            </div>
                          )}
                          {rx.JLCA && (
                            <div className="bg-white/70 border border-teal-100 rounded-lg p-2.5 text-center">
                              <p className="text-[10px] font-bold uppercase tracking-wide text-teal-600 mb-1">{td("detail035")}</p>
                              <p className="text-lg font-bold text-foreground">{rx.JLCA.valor}{td("detail033")}</p>
                              <p className={`text-xs mt-0.5 ${statusColor(rx.JLCA.status)}`}>{rx.JLCA.status}</p>
                              <p className="text-[10px] text-muted-foreground">{rx.JLCA.referencia}</p>
                            </div>
                          )}
                          {rx.MAD && (
                            <div className="bg-white/70 border border-teal-100 rounded-lg p-2.5 text-center">
                              <p className="text-[10px] font-bold uppercase tracking-wide text-teal-600 mb-1">{td("detail036")}</p>
                              <p className="text-lg font-bold text-foreground">{rx.MAD.valor}<span className="text-xs font-normal ml-0.5">{rx.MAD.unidade}</span></p>
                              <p className={`text-xs mt-0.5 ${statusColor(rx.MAD.status)}`}>{rx.MAD.lado}</p>
                              <p className="text-[10px] text-muted-foreground">{rx.MAD.status}</p>
                            </div>
                          )}
                          {rx.percentualWBL?.preCorrecao !== undefined && (
                            <div className="bg-white/70 border border-teal-100 rounded-lg p-2.5 text-center">
                              <p className="text-[10px] font-bold uppercase tracking-wide text-teal-600 mb-1">{td("detail037")}</p>
                              <p className="text-lg font-bold text-foreground">{rx.percentualWBL.preCorrecao}{td("detail038")}</p>
                              <p className="text-xs mt-0.5 text-muted-foreground">{td("detail039")}</p>
                              {rx.percentualWBL.alvo && <p className="text-[10px] text-teal-600">{td("detail040")} {rx.percentualWBL.alvo}</p>}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* ── Deformidade Extra-Articular ── */}
                      {rx.deformidadeExtraArticular?.presente && (
                        <div className="flex items-start gap-2.5 p-3 rounded-lg border-2 border-amber-300 bg-amber-50 text-amber-800">
                          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                          <div>
                            <p className="text-xs font-bold uppercase tracking-wide">{td("detail041")} {rx.deformidadeExtraArticular.osso}</p>
                            <p className="text-sm mt-0.5">{rx.deformidadeExtraArticular.recomendacao}</p>
                          </div>
                        </div>
                      )}

                      {/* ── Osteotomia — Seleção Inline ── */}
                      {Array.isArray(rx.opcoesOsteotomia) && rx.opcoesOsteotomia.length > 0 && (() => {
                        const opcoes = rx.opcoesOsteotomia as Array<Record<string, unknown>>;
                        const handleSelectOsteotomia = async (newIdx: number) => {
                          if (newIdx === selectedIdx || savingOsteotomia) return;
                          rxPdfGenerationRef.current += 1;
                          setRxPdfShareUrl(null);
                          setSavingOsteotomia(true);
                          try {
                            const updatedRx = {
                              ...rx,
                              _selectedOsteotomiaIdx: newIdx,
                              _selectedOsteotomiaId: String(opcoes[newIdx]?.id ?? ""),
                            };
                            const r = await fetch(`/api/surgeries/${id}`, {
                              method: "PATCH",
                              credentials: "same-origin",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ rxAnaliseJson: JSON.stringify(updatedRx) }),
                            });
                            if (r.ok) {
                              await queryClient.invalidateQueries({ queryKey: getGetSurgeryQueryKey(id) });
                              toast({ title: t("osteotomyUpdated") });
                            } else {
                              toast({ title: t("osteotomySaveError"), variant: "destructive" });
                            }
                          } catch {
                            toast({ title: t("osteotomySaveError"), variant: "destructive" });
                          } finally {
                            setSavingOsteotomia(false);
                          }
                        };
                        return (
                          <div className="border-t border-teal-100 pt-3 space-y-2">
                            <div className="flex items-center justify-between">
                              <p className="text-xs font-bold uppercase tracking-widest text-teal-600">
                                {selectedOpcao ? tp("osteotomySelected") : tp("osteotomyOptions")}
                              </p>
                              {opcoes.length > 1 && (
                                <span className="text-[10px] text-muted-foreground">{td("detail042")}</span>
                              )}
                            </div>
                            {/* Selected option — full card */}
                            {selectedOpcao && (
                              <div className={`rounded-xl border-2 ${opcaoColor} p-4 space-y-3`}>
                                <div className="flex items-start justify-between gap-2">
                                  <div>
                                    <p className={`font-bold text-base ${opcaoLabelColor}`}>{String(selectedOpcao.nome ?? "")}</p>
                                    {!!selectedOpcao.nivel && (
                                      <p className="text-sm text-muted-foreground mt-0.5">
                                        {String(selectedOpcao.nivel).replace(/\s*\(meta[^)]*\)/gi, "").trim()}
                                      </p>
                                    )}
                                  </div>
                                  <div className="text-right shrink-0">
                                    <p className={`text-2xl font-bold ${opcaoLabelColor}`}>{Number(selectedOpcao.correcao ?? 0)}{td("detail033")}</p>
                                    <p className="text-xs text-muted-foreground">{td("detail043")}</p>
                                  </div>
                                </div>
                                {(() => {
                                  const isDuplaOp = isDupla(selectedOpcao.id);
                                  const isHTOOp = isHTO(selectedOpcao.id);
                                  if (isDuplaOp) {
                                    const wF = Number(selectedOpcao.wedgeFemoral_mm ?? 0);
                                    const wT = Number(selectedOpcao.wedgeTibial_mm ?? 0);
                                    if (!wF && !wT) return null;
                                    return (
                                      <div className="flex gap-4 text-sm">
                                        {wF > 0 && <div><span className="text-muted-foreground">{td("detail044")} </span><span className="font-semibold">{wF} {td("detail045")}</span></div>}
                                        {wT > 0 && <div><span className="text-muted-foreground">{td("detail046")} </span><span className="font-semibold">{wT} {td("detail045")}</span></div>}
                                      </div>
                                    );
                                  }
                                  const wMm = Number(selectedOpcao.wedge_mm ?? 0);
                                  if (!wMm) return null;
                                  return (
                                    <div className="text-sm">
                                       <span className="text-muted-foreground">{isHTOOp ? tp("tibialWedge") : tp("femoralWedge")}{td("detail047")} </span>
                                      <span className="font-semibold">{wMm} {td("detail045")}</span>
                                    </div>
                                  );
                                })()}
                                {!!(selectedOpcao.angulosPre && selectedOpcao.angulosPos) && (() => {
                                  const pre = selectedOpcao.angulosPre as { HKA: number; desvio?: string; mLDFA: number; aMPTA: number };
                                  const pos = selectedOpcao.angulosPos as { HKA: number; mLDFA: number; aMPTA: number };
                                  return (
                                    <div className="overflow-x-auto">
                                      <table className="w-full text-sm border-collapse">
                                        <thead>
                                          <tr className="border-b border-teal-100">
                                            <th className="text-left py-1 pr-4 text-xs text-muted-foreground font-medium">{td("detail048")}</th>
                                            <th className="text-right py-1 pr-4 text-xs text-muted-foreground font-medium">{td("detail039")}</th>
                                            <th className="text-right py-1 text-xs text-muted-foreground font-medium">{td("detail049")}</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {[
                                            { label: `HKA${pre.desvio ? ` (${pre.desvio})` : ""}`, preVal: `${pre.HKA}°`, posVal: `${pos.HKA}°` },
                                            { label: "AmLDF", preVal: `${pre.mLDFA}°`, posVal: `${pos.mLDFA}°` },
                                            { label: "AmMPT", preVal: `${pre.aMPTA}°`, posVal: `${pos.aMPTA}°` },
                                          ].map(row => (
                                            <tr key={row.label} className="border-b border-teal-50/60">
                                              <td className="py-1 pr-4 text-muted-foreground">{row.label}</td>
                                              <td className="py-1 pr-4 text-right font-medium">{row.preVal}</td>
                                              <td className={`py-1 text-right font-bold ${opcaoLabelColor}`}>{row.posVal}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  );
                                })()}
                                {Array.isArray(selectedOpcao.alertas) && (selectedOpcao.alertas as string[]).length > 0 && (
                                  <div className="space-y-1 pt-1">
                                    {(selectedOpcao.alertas as string[]).map((a, i) => (
                                      <div key={i} className="flex items-start gap-1.5 text-xs text-amber-700">
                                        <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                                        <span>{a}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                            {/* Other options — compact clickable rows */}
                            {opcoes.length > 1 && (
                              <div className="space-y-1.5 pt-1">
                                {opcoes.map((opcao, idx) => {
                                  if (idx === selectedIdx) return null;
                                  const isD = isDupla(opcao.id);
                                  const isH = isHTO(opcao.id);
                                  const bc = isD ? "border-purple-200 hover:border-purple-400 hover:bg-purple-50" : isH ? "border-blue-200 hover:border-blue-400 hover:bg-blue-50" : "border-orange-200 hover:border-orange-400 hover:bg-orange-50";
                                  const lc = isD ? "text-purple-700" : isH ? "text-blue-700" : "text-orange-700";
                                  return (
                                    <button
                                      key={idx}
                                      type="button"
                                      disabled={savingOsteotomia}
                                      onClick={() => handleSelectOsteotomia(idx)}
                                      className={`w-full rounded-xl border ${bc} bg-white/50 dark:bg-slate-800/30 px-3 py-2 flex items-center justify-between gap-2 opacity-60 hover:opacity-100 transition-all cursor-pointer text-left disabled:cursor-not-allowed`}
                                    >
                                      <div className="flex items-center gap-2 min-w-0">
                                        <span className={`w-1.5 h-1.5 rounded-full ${isD ? "bg-purple-400" : isH ? "bg-blue-400" : "bg-orange-400"} shrink-0`} />
                                        <span className={`text-xs font-semibold ${lc} truncate`}>{String(opcao.nome)}</span>
                                        <span className="text-[10px] text-muted-foreground">{String(opcao.nivel ?? "").replace(/\s*\(meta[^)]*\)/gi, "").trim()}</span>
                                      </div>
                                      <div className="flex items-center gap-2 shrink-0">
                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${bc} ${lc}`}>
                                          {Number(opcao.correcao)}{td("detail050")}
                                        </span>
                                        {savingOsteotomia
                                          ? <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                                          : <span className={`text-[10px] underline ${lc}`}>{td("detail051")}</span>
                                        }
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* ── Alertas Técnicos ── */}
                      {Array.isArray(rx.alertas) && rx.alertas.length > 0 && (
                        <div className="space-y-1.5 border-t border-teal-100 pt-3">
                          <p className="text-xs font-bold uppercase tracking-widest text-teal-600">{td("detail052")}</p>
                          <div className="space-y-1">
                            {rx.alertas.map((a, i) => (
                              <div key={i} className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5">
                                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                                <span>{a}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}


                      {/* ── RX Image Thumbnail ── */}
                      {rxImageUrl && (
                        <div className="border-t border-teal-100 pt-3">
                          <p className="text-xs font-bold uppercase tracking-widest text-teal-600 mb-2">{td("detail053")}</p>
                          <a href={rxImageUrl} target="_blank" rel="noopener noreferrer" className="inline-block">
                            <img
                              src={rxImageUrl}
                              alt={tp("panoramicXrayAlt")}
                              className="max-h-48 rounded-lg border border-teal-200 shadow-sm object-contain hover:opacity-90 transition-opacity cursor-zoom-in"
                            />
                          </a>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })()}

              {isArtroplastiaSurgery && (() => {
                const atj = (() => { try { return JSON.parse((surgery as any).procedimentosDetalhados ?? "{}").artroplastia ?? {}; } catch { return {}; } })();
                const hasData = atj.tipo || atj.alinhamentoMembro || atj.gonartroseMedial || atj.gonartroseLateral || atj.femoropatelar || atj.flexaoGraus || atj.fixacao || atj.garrote;
                if (!hasData) return null;
                return (
                  <Card className="border-indigo-200 bg-indigo-50/40 shadow-sm">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base text-indigo-800 flex items-center gap-2">
                        <span className="h-4 w-1 rounded-full bg-indigo-500 inline-block" />
                        {td("detail054")}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* Avaliação Clínica */}
                      {(atj.alinhamentoMembro || atj.gonartroseMedial || atj.gonartroseLateral || atj.femoropatelar || atj.flexaoGraus || atj.instabilidade) && (
                        <div className="space-y-2">
                          <p className="text-xs font-bold uppercase tracking-widest text-indigo-600">{td("detail055")}</p>
                          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                            {atj.alinhamentoMembro && <div><span className="text-muted-foreground">{td("detail056")} </span><span className="font-medium">{atj.alinhamentoMembro}</span></div>}
                            {atj.gonartroseMedial && <div><span className="text-muted-foreground">{td("detail057")} </span><span className="font-medium">{atj.gonartroseMedial}{atj.gonartroseMedialAhlback ? ` — Ahlbäck ${atj.gonartroseMedialAhlback}` : ""}</span></div>}
                            {atj.gonartroseLateral && <div><span className="text-muted-foreground">{td("detail058")} </span><span className="font-medium">{atj.gonartroseLateral}</span></div>}
                            {atj.femoropatelar && <div><span className="text-muted-foreground">{td("detail059")} </span><span className="font-medium">{atj.femoropatelar}</span></div>}
                            {(atj.flexaoGraus || atj.extensaoGraus) && <div><span className="text-muted-foreground">{td("detail060")} </span><span className="font-medium">{td("detail061")} {atj.flexaoGraus || "—"}{td("detail062")} {atj.extensaoGraus || "—"}{td("detail033")}</span></div>}
                            {atj.instabilidade && <div><span className="text-muted-foreground">{td("detail063")} </span><span className="font-medium">{atj.instabilidade}{atj.instabilidadeGrau ? ` — ${atj.instabilidadeGrau}` : ""}</span></div>}
                          </div>
                        </div>
                      )}
                      {/* Técnica */}
                      {(atj.tipo || atj.compartimento || atj.tecnologia || atj.fixacao) && (
                        <div className="space-y-2 border-t border-indigo-100 pt-3">
                          <p className="text-xs font-bold uppercase tracking-widest text-indigo-600">{td("detail064")}</p>
                          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                            {atj.tipo && <div><span className="text-muted-foreground">{td("detail065")} </span><span className="font-medium">{atj.tipo}</span></div>}
                            {atj.compartimento && <div><span className="text-muted-foreground">{td("detail066")} </span><span className="font-medium">{atj.compartimento}</span></div>}
                            {atj.tecnologia && <div><span className="text-muted-foreground">{td("detail067")} </span><span className="font-medium">{atj.tecnologia}</span></div>}
                            {atj.fixacao && <div><span className="text-muted-foreground">{td("detail013")} </span><span className="font-medium">{atj.fixacao}</span></div>}
                            {atj.revisaoComponentes && <div><span className="text-muted-foreground">{td("detail068")} </span><span className="font-medium">{atj.revisaoComponentes}</span></div>}
                            {atj.defeitoOsseo && (atj.aoriGrauFemoral || atj.aoriGrauTibial) && (() => {
                              const aoriDesc: Record<string, string> = {
                                "1": tp("aoriSmallBoneLoss"),
                                "2A": tp("aoriOneSideMetaphysealLoss"),
                                "2B": tp("aoriBilateralMetaphysealLoss"),
                                "3": tp("aoriMassiveMetaphysealLoss"),
                              };
                              return (
                                <div className="col-span-2 rounded-lg border border-indigo-100 dark:border-indigo-800/40 bg-white/60 dark:bg-slate-800/40 p-3 space-y-1.5">
                                  <p className="text-xs font-bold uppercase tracking-widest text-indigo-600">{td("detail069")}</p>
                                  <div className="flex flex-wrap gap-4 text-sm">
                                    {atj.aoriGrauFemoral && (
                                      <div><span className="text-muted-foreground">{td("detail070")} </span><span className="font-semibold text-indigo-700">{td("detail071")} {atj.aoriGrauFemoral}</span><span className="text-xs text-muted-foreground ml-1">{td("detail072")} {aoriDesc[atj.aoriGrauFemoral] ?? ""}</span></div>
                                    )}
                                    {atj.aoriGrauTibial && (
                                      <div><span className="text-muted-foreground">{td("detail073")} </span><span className="font-semibold text-indigo-700">{td("detail071")} {atj.aoriGrauTibial}</span><span className="text-xs text-muted-foreground ml-1">{td("detail072")} {aoriDesc[atj.aoriGrauTibial] ?? ""}</span></div>
                                    )}
                                  </div>
                                </div>
                              );
                            })()}
                            {atj.garrote && <div><span className="text-muted-foreground">{td("detail074")} </span><span className="font-medium">{atj.garrote}</span></div>}
                            {atj.txa && <div><span className="text-muted-foreground">{td("detail075")} </span><span className="font-medium">{atj.txa}</span></div>}
                            {atj.calcosFemoral?.length > 0 && <div><span className="text-muted-foreground">{td("detail076")} </span><span className="font-medium">{atj.calcosFemoral.join(", ")}</span></div>}
                            {atj.calcosTibial?.length > 0 && <div><span className="text-muted-foreground">{td("detail077")} </span><span className="font-medium">{atj.calcosTibial.join(", ")}</span></div>}
                            {atj.coneMetafisario && <div><span className="text-muted-foreground">{td("detail078")} </span><span className="font-medium">{atj.coneMetafisario === "Sim" ? tp("yes") : atj.coneMetafisario === "Não" ? tp("no") : atj.coneMetafisario}{atj.coneMetafisario === "Sim" && atj.coneMetafisarioLocal ? ` — ${atj.coneMetafisarioLocal}` : ""}</span></div>}
                          </div>
                          {atj.observacoes && <p className="text-sm text-muted-foreground italic mt-1">{td("detail079")}{atj.observacoes}{td("detail079")}</p>}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })()}

              {surgery.lcaAlgorithm && (surgery.lcaAlgorithm.krirsInterpretacao != null || surgery.lcaAlgorithm.krirsScore != null) && (() => {
                const aderPositivo = surgery.exameLigamentar?.aderTest === true;
                const gavetaRotInterna = surgery.exameLigamentar?.gavetaRotInterna === true;
                const instabAL = gavetaRotInterna || (surgery.lcaAlgorithm.pivotShift ?? 0) >= 2;
                const instabAM = aderPositivo;
                const riskLevel = getKrirsRiskLevel(
                  surgery.lcaAlgorithm.krirsScore,
                  surgery.lcaAlgorithm.flagAltoRisco,
                  surgery.lcaAlgorithm.krirsInterpretacao,
                );
                return (
                  <Card className="min-w-0 border-primary/20 bg-primary/5 shadow-sm">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-lg">{td("detail080")}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
                        <div className="min-w-0">
                          <p className="text-sm text-muted-foreground">{td("detail081")}</p>
                          <p className="text-lg font-bold text-primary">{getKrirsRiskLabel(riskLevel, locale)}</p>
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm text-muted-foreground">{td("detail084")}</p>
                          <p className="font-semibold">{surgery.lcaAlgorithm.tecnicaRecomendada}</p>
                        </div>
                        <div className="min-w-0 sm:col-span-2">
                          <p className="text-sm text-muted-foreground">{td("detail085")}</p>
                          <p className="text-sm bg-card p-3 rounded-md border mt-1">
                            {getKrirsDisplayJustification(surgery.lcaAlgorithm.justificativa, riskLevel, locale)}
                          </p>
                        </div>
                      </div>
                      {/* Extra-articular instability alerts */}
                      {(instabAM || instabAL) && (
                        <div className="space-y-2">
                          {instabAM && instabAL && (
                            <div className="flex items-start gap-2.5 p-3 rounded-lg border-2 border-red-300 bg-red-50 text-red-800">
                              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                              <div>
                                <p className="text-xs font-bold uppercase tracking-wide">{td("detail086")}</p>
                                <p className="text-sm font-medium mt-0.5">{td("detail087")}</p>
                              </div>
                            </div>
                          )}
                          {instabAM && !instabAL && (
                            <div className="flex items-start gap-2.5 p-3 rounded-lg border-2 border-amber-300 bg-amber-50 text-amber-800">
                              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                              <div>
                                <p className="text-xs font-bold uppercase tracking-wide">{td("detail088")}</p>
                                <p className="text-sm font-medium mt-0.5">{td("detail089")}</p>
                              </div>
                            </div>
                          )}
                          {!instabAM && instabAL && (
                            <div className="flex items-start gap-2.5 p-3 rounded-lg border-2 border-blue-300 bg-blue-50 text-blue-800">
                              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                              <div>
                                <p className="text-xs font-bold uppercase tracking-wide">{td("detail090")}</p>
                                <p className="text-sm font-medium mt-0.5">{td("detail091")}</p>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })()}

              {surgery.picsScore && surgery.picsScore.ptsTotal != null && (
                  <Card className="min-w-0 border-primary/20 bg-primary/5 shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg">{td("detail092")}</CardTitle>
                  </CardHeader>
                  <CardContent className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-3">
                    <div className="min-w-0">
                      <p className="text-sm text-muted-foreground">{td("detail093")}</p>
                      <p className="text-2xl font-bold text-primary">{surgery.picsScore.ptsTotal}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm text-muted-foreground">{td("detail094")}</p>
                      <p className="font-semibold">{surgery.picsScore.ptsRisco}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm text-muted-foreground">{td("detail095")}</p>
                      <p className="font-semibold">{surgery.picsScore.ptsConduta}</p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {surgery.exameLigamentar && Object.keys(surgery.exameLigamentar).length > 2 && (
                <Card className="min-w-0 shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg">{td("detail096")}</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm space-y-3">
                    {/* Hiperextensão — destaque especial */}
                    {surgery.exameLigamentar.hiperextensao && (() => {
                      const hx = surgery.exameLigamentar.hiperextensao;
                      const isHigh = hx === ">6.5" || hx === ">7.5";
                      const isMid  = hx === "5-6.5" || hx === "5-7.5";
                      return (
                        <div className={`flex items-center justify-between p-3 rounded-lg border-2 ${
                          isHigh ? "bg-red-50 border-red-300 text-red-800"
                          : isMid  ? "bg-amber-50 border-amber-300 text-amber-800"
                          : "bg-green-50 border-green-200 text-green-800"
                        }`}>
                          <div>
                            <p className="font-semibold">{td("detail097")}</p>
                            <p className="text-xs mt-0.5">
                              {hx === "<5" && `< 5° — ${tp("normal")}`}
                              {isMid  && `5 – 6,5° — ${tp("borderline")}`}
                              {isHigh && `≥ 6,5° — ${tp("hyperlaxity")}`}
                            </p>
                            {isHigh && (
                              <p className="text-xs font-medium mt-1">
                                {td("detail098")}
                              </p>
                            )}
                          </div>
                          <Badge variant="outline" className={
                            isHigh ? "border-red-400 text-red-700" :
                            isMid  ? "border-amber-400 text-amber-700" :
                            "border-green-400 text-green-700"
                          }>
                            {hx === "<5" ? "< 5°" : isMid ? "5–6,5°" : "≥ 6,5°"}
                          </Badge>
                        </div>
                      );
                    })()}
                    {surgery.exameLigamentar.slopeTibialPts != null && (() => {
                      const ptsValue = surgery.exameLigamentar.slopeTibialPts;
                      const classification = classifyPTS(ptsValue);
                      return (
                        <div className={`flex items-center justify-between p-3 rounded-lg border-2 ${
                          classification === "pathological"
                            ? "bg-red-50 border-red-300 text-red-800"
                            : classification === "borderline"
                              ? "bg-amber-50 border-amber-300 text-amber-800"
                              : classification === "normal"
                                ? "bg-green-50 border-green-200 text-green-800"
                                : "bg-muted border-border text-muted-foreground"
                        }`}>
                          <div>
                            <p className="font-semibold">
                              {locale === "es" ? "Pendiente tibial posterior (PTS)" : "Slope Tibial Posterior (PTS)"}
                            </p>
                            <p className="text-xs mt-0.5">
                              {classification
                                ? getPTSClassificationRange(classification, locale)
                                : (locale === "es" ? "No clasificado" : "Não classificado")}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-2xl font-bold">{ptsValue}°</p>
                            <Badge variant="outline" className={
                              classification === "pathological" ? "border-red-400 text-red-700" :
                              classification === "borderline" ? "border-amber-400 text-amber-700" :
                              classification === "normal" ? "border-green-400 text-green-700" :
                              "border-border text-muted-foreground"
                            }>
                              {classification
                                ? getPTSClassificationLabel(classification, locale)
                                : (locale === "es" ? "No clasificado" : "Não classificado")}
                            </Badge>
                          </div>
                        </div>
                      );
                    })()}
                    <div className="grid min-w-0 grid-cols-1 gap-y-3 gap-x-6 sm:grid-cols-2">
                      {Object.entries(surgery.exameLigamentar).map(([k, v]) => {
                        if (v === null || k === 'id' || k === 'surgeryId' || k === 'hiperextensao' || k === 'slopeTibialPts' || k === 'createdAt' || k === 'laerTest') return null;
                        const labelMap: Record<string, string> = {
                          lachman: tp("lachman"), gavetaNeutra: tp("neutralDrawer"),
                          pivotShift: tp("pivotShift"), aderTest: tp("aderTest"),
                          gavetaRotInterna: tp("internalRotationDrawer"), estresseValgo0: tp("valgusStress0"),
                          estresseValgo30: tp("valgusStress30"), estresseVaro0: tp("varusStress0"),
                          estresseVaro30: tp("varusStress30"), gavetaPosterior: tp("posteriorDrawer"),
                          sagSign: tp("sagSign"), quadricepsAtivo: tp("activeQuadriceps"),
                          dialTest: tp("dialTest"), dialTest30: tp("dialTest30"), dialTest90: tp("dialTest90"),
                          recurvato: tp("recurvatum"), gavetaRotatoria: tp("posterolateralRotatoryDrawer"),
                        };
                        return (
                          <div key={k} className="flex justify-between border-b pb-1 border-border/50">
                            <span className="text-muted-foreground">{labelMap[k] ?? k}</span>
                            <span className="font-medium">{typeof v === 'boolean' ? (v ? tp("yes") : tp("no")) : String(v)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}

              {(() => {
                const patellarExam = surgery.examePatelar as Record<string, any> | null | undefined;
                const surgeryRecord = surgery as typeof surgery & Record<string, any>;
                const bilateral = surgeryRecord.lado === "Bilateral"
                  ? readBilateralDocumentation(surgeryRecord.procedimentosDetalhados)
                  : null;
                const exams = bilateral
                  ? (["direito", "esquerdo"] as const).map((limb) => ({
                      limb,
                      exam: (bilateral.byLimb[limb]?.examePatelar as Record<string, any> | undefined),
                    }))
                  : [{ limb: null, exam: patellarExam }];
                if (!exams.some(({ exam }) => exam && Object.entries(exam).some(([key, value]) => (
                  !["id", "surgeryId", "createdAt"].includes(key) && value != null
                )))) return null;
                return (
                  <Card className="min-w-0 shadow-sm">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-lg">{t("patellarExam")}</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm space-y-3">
                      {exams.map(({ limb, exam }) => exam && (
                        <div key={limb ?? "flat"} className="space-y-2">
                          {limb && <p className="font-semibold text-primary">{limbHeading(limb, locale)}</p>}
                          <div className="grid min-w-0 grid-cols-1 gap-y-3 gap-x-6 sm:grid-cols-2">
                            {Object.entries(exam).map(([key, value]) => {
                              if (["id", "surgeryId", "createdAt", "jSignGrau"].includes(key) || value == null) return null;
                              const label = key === "jSign"
                                ? t("jSign")
                                : key.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase()).trim();
                              return (
                                <div key={key} className="flex justify-between border-b pb-1 border-border/50">
                                  <span className="text-muted-foreground">{label}</span>
                                  <span className="font-medium">
                                    {typeof value === "boolean" ? (value ? tp("yes") : tp("no")) : String(value)}
                                  </span>
                                </div>
                              );
                            })}
                            {exam.jSign === true && exam.jSignGrau != null && (
                              <div className="flex justify-between border-b pb-1 border-border/50">
                                <span className="text-muted-foreground">{t("jSignGrade")}</span>
                                <span className="font-medium">{Number(exam.jSignGrau)}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                );
              })()}

              {surgery.observacoes && (
                <Card className="shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg">{td("detail099")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm whitespace-pre-wrap bg-muted/30 p-4 rounded-md">{surgery.observacoes}</p>
                  </CardContent>
                </Card>
              )}

              <Card className="shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">{td("detail100")}</CardTitle>
                  <p className="text-sm text-muted-foreground">{td("detail101")}</p>
                </CardHeader>
                <CardContent>
                  <SurgeryMedia surgeryId={surgery.id} />
                </CardContent>
              </Card>
            </TabsContent>

          </Tabs>

          {/* ── Encaminhamento do Fisioterapeuta ── */}
          {(() => {
            const activeLink = (rehabData?.careLinks ?? []).find(l => l.surgeryId === surgery.id && l.status === "active");
            const pendingInvite = (rehabData?.invites ?? []).find(i => i.surgeryId === surgery.id && i.status === "pending");
            return (
              <div className="space-y-3 border-t pt-4">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <UserCheck className="h-5 w-5 text-indigo-600" />
                    <h2 className="text-lg font-semibold">{td("detail102")}</h2>
                  </div>
                  {!activeLink && !pendingInvite && (
                    <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="outline" className="gap-1.5">
                          <Send className="h-4 w-4" />
                          {td("detail103")}
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>{td("detail104")}</DialogTitle>
                          <DialogDescription>
                            {td("detail105")}
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-2">
                          <div className="space-y-2">
                            <Label>{td("detail106")}</Label>
                            <Select value={inviteConsentMethod} onValueChange={setInviteConsentMethod}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="verbal_presencial">{td("detail107")}</SelectItem>
                                <SelectItem value="whatsapp">{td("detail108")}</SelectItem>
                                <SelectItem value="termo_assinado">{td("detail109")}</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {td("detail110")}
                          </p>
                          <Button onClick={generateInvite} disabled={generatingInvite} className="w-full gap-2">
                            {generatingInvite ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                            {td("detail111")}
                          </Button>
                        </div>
                      </DialogContent>
                    </Dialog>
                  )}
                </div>

                {rehabLoading && <p className="text-xs text-muted-foreground">{td("detail112")}</p>}

                {activeLink && (
                  <div className="flex items-start justify-between gap-3 rounded-xl border-2 border-emerald-200 bg-emerald-50 p-4">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />
                      <div>
                        <p className="font-semibold text-emerald-900">{activeLink.physioNome}</p>
                        {activeLink.physioCrefito && <p className="text-xs text-emerald-700">{td("detail113")} {activeLink.physioCrefito}</p>}
                        {activeLink.physioClinica && <p className="text-xs text-emerald-700">{activeLink.physioClinica}</p>}
                        <p className="text-xs text-emerald-600 mt-1">{t("activeLinkSince", { date: formatDate(activeLink.createdAt) })}</p>
                      </div>
                    </div>
                    <Button size="sm" variant="outline" className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50 shrink-0"
                      onClick={() => revokeLink(activeLink.id)} disabled={revokingLink === activeLink.id}>
                      {revokingLink === activeLink.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserX className="h-3.5 w-3.5" />}
                      {td("detail114")}
                    </Button>
                  </div>
                )}

                {!activeLink && pendingInvite && (
                  <div className="flex items-start justify-between gap-3 rounded-xl border-2 border-amber-200 bg-amber-50 p-4">
                    <div className="flex items-start gap-3">
                      <Clock className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
                      <div>
                        <p className="font-semibold text-amber-900">{td("detail115")}</p>
                        <p className="text-xs text-amber-700">{td("detail116")}</p>
                        <p className="text-xs text-amber-600">{t("validUntil", { date: formatDate(pendingInvite.expiresAt) })}</p>
                      </div>
                    </div>
                    <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="outline" className="gap-1.5 shrink-0">
                          <Send className="h-3.5 w-3.5" />
                          {td("detail117")}
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>{td("detail118")}</DialogTitle>
                          <DialogDescription>{td("detail119")}</DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-2">
                          <div className="space-y-2">
                            <Label>{td("detail120")}</Label>
                            <Select value={inviteConsentMethod} onValueChange={setInviteConsentMethod}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="verbal_presencial">{td("detail107")}</SelectItem>
                                <SelectItem value="whatsapp">{td("detail108")}</SelectItem>
                                <SelectItem value="termo_assinado">{td("detail109")}</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <Button onClick={generateInvite} disabled={generatingInvite} className="w-full gap-2">
                            {generatingInvite ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                            {td("detail111")}
                          </Button>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                )}

                {!activeLink && !pendingInvite && !rehabLoading && (
                  <p className="text-sm text-muted-foreground">{td("detail121")}</p>
                )}
              </div>
            );
          })()}

          {/* ── Sessão de Follow-up ── */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 pt-2 border-t">
              <Activity className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">{td("detail122")}</h2>
            </div>

              {/* ── LCA Cronogram ── */}
              {isLcaSurgery && (
                <div className="rounded-xl border-2 border-green-200 bg-green-50/60 p-4 space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Activity className="h-4 w-4 text-green-600 shrink-0" />
                    <span className="font-semibold text-green-800 text-sm">{tp("lcaTitle")}</span>
                    <span className="ml-auto text-xs text-green-600 italic">{tp("lcaSubtitle")}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-[520px] text-xs border-collapse">
                      <thead>
                        <tr className="bg-green-100/70">
                          {[tp("moment"),"Lysholm","IKDC","ACL-RSI","Marx","Tegner",tp("additionalAssessments")].map(h => (
                            <th key={h} className="text-center px-2 py-1.5 font-semibold text-green-700 border border-green-200 first:text-left">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {([
                          { momento: tp("preop"), lysholm:"✅", ikdc:"✅", aclrsi:"✅", marx:"✅", tegner:"—", adicional:tp("baselineRequired"), critical: false },
                          { momento: tp("oneMonth"), lysholm:"Opt.", ikdc:"—", aclrsi:"—", marx:"—", tegner:"—", adicional:tp("clinicalRomEdema"), critical: false },
                          { momento: tp("threeMonths"), lysholm:"✅", ikdc:"✅", aclrsi:"—", marx:"—", tegner:"—", adicional:tp("functionalAssessment"), critical: false },
                          { momento: tp("sixMonthsCritical"), lysholm:"✅", ikdc:"✅", aclrsi:"✅", marx:"✅", tegner:"—", adicional:tp("returnToSportDecision"), critical: true },
                          { momento: tp("twelveMonths"), lysholm:"✅", ikdc:"✅", aclrsi:"✅", marx:"✅", tegner:"✅", adicional:tp("hopTestsIsokineticReturn"), critical: false },
                          { momento: tp("twentyFourMonths"), lysholm:"✅", ikdc:"✅", aclrsi:"—", marx:"—", tegner:"✅", adicional:tp("definitiveAssessment"), critical: false },
                        ] as {momento:string;lysholm:string;ikdc:string;aclrsi:string;marx:string;tegner:string;adicional:string;critical:boolean}[]).map((row, i) => (
                          <tr key={i} className={row.critical ? "bg-amber-50 font-semibold" : i % 2 === 0 ? "bg-white/60 dark:bg-slate-800/40" : "bg-green-50/30"}>
                            <td className={`px-2 py-1.5 border border-green-100 ${row.critical ? "text-amber-700" : "text-green-800"}`}>{row.momento}</td>
                            {[row.lysholm, row.ikdc, row.aclrsi, row.marx, row.tegner].map((v, ci) => (
                              <td key={ci} className="px-2 py-1.5 border border-green-100 text-center">{v}</td>
                            ))}
                            <td className={`px-2 py-1.5 border border-green-100 text-muted-foreground ${row.critical ? "text-amber-700 font-medium" : ""}`}>{row.adicional}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-green-700 italic">{tp("lcaFooter")}</p>
                </div>
              )}

              {/* ── LCM Cronogram ── */}
              {isLcmSurgery && (
                <div className="rounded-xl border-2 border-purple-200 bg-purple-50/60 p-4 space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Activity className="h-4 w-4 text-purple-600 shrink-0" />
                    <span className="font-semibold text-purple-800 text-sm">{tp("lcmTitle")}</span>
                    <span className="ml-auto text-xs text-purple-600 italic">{tp("lcmSubtitle")}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-[520px] text-xs border-collapse">
                      <thead>
                        <tr className="bg-purple-100/70">
                          {[tp("moment"),"Lysholm","IKDC","Tegner",tp("additionalAssessments")].map(h => (
                            <th key={h} className="text-center px-2 py-1.5 font-semibold text-purple-700 border border-purple-200 first:text-left">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {([
                          { momento: tp("preop"), lysholm:"✅", ikdc:"✅", tegner:"✅", adicional:tp("valgusTestsRom"), critical: false },
                          { momento: tp("sixWeeks"), lysholm:"✅", ikdc:"✅", tegner:"Opt.", adicional:tp("quadricepsIndex"), critical: false },
                          { momento: tp("threeMonths"), lysholm:"✅", ikdc:"✅", tegner:"✅", adicional:tp("advancedPhaseTransition"), critical: false },
                          { momento: tp("sixMonthsCritical"), lysholm:"✅", ikdc:"✅", tegner:"✅", adicional:tp("valgusReturnDecision"), critical: true },
                          { momento: tp("twelveMonths"), lysholm:"✅", ikdc:"✅", tegner:"✅", adicional:tp("formalHopAssessment"), critical: false },
                          { momento: tp("twentyFourMonths"), lysholm:"✅", ikdc:"✅", tegner:"✅", adicional:tp("definitiveLongTermResult"), critical: false },
                          { momento: tp("tenYearsMlki"), lysholm:"✅", ikdc:"✅", tegner:"✅", adicional:tp("complexMultiligamentInjuries"), critical: false },
                        ] as {momento:string;lysholm:string;ikdc:string;tegner:string;adicional:string;critical:boolean}[]).map((row, i) => (
                          <tr key={i} className={row.critical ? "bg-amber-50 font-semibold" : i % 2 === 0 ? "bg-white/60 dark:bg-slate-800/40" : "bg-purple-50/30"}>
                            <td className={`px-2 py-1.5 border border-purple-100 ${row.critical ? "text-amber-700" : "text-purple-800"}`}>{row.momento}</td>
                            {[row.lysholm, row.ikdc, row.tegner].map((v, ci) => (
                              <td key={ci} className="px-2 py-1.5 border border-purple-100 text-center">{v}</td>
                            ))}
                            <td className={`px-2 py-1.5 border border-purple-100 text-muted-foreground ${row.critical ? "text-amber-700 font-medium" : ""}`}>{row.adicional}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-purple-700 italic">{tp("lcmFooter")}</p>
                </div>
              )}

              {/* ── CPM Cronogram ── */}
              {isCpmSurgery && (
                <div className="rounded-xl border-2 border-teal-200 bg-teal-50/60 p-4 space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Activity className="h-4 w-4 text-teal-600 shrink-0" />
                    <span className="font-semibold text-teal-800 text-sm">{tp("cpmTitle")}</span>
                    <span className="ml-auto text-xs text-teal-600 italic">{tp("cpmSubtitle")}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-[520px] text-xs border-collapse">
                      <thead>
                        <tr className="bg-teal-100/70">
                          {[tp("moment"),"Lysholm","IKDC","Tegner",tp("additionalAssessments")].map(h => (
                            <th key={h} className="text-center px-2 py-1.5 font-semibold text-teal-700 border border-teal-200 first:text-left">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {([
                          { momento: tp("preop"), lysholm:"✅", ikdc:"✅", tegner:"✅", adicional:tp("medialDialTest"), critical: false },
                          { momento: tp("sixWeeks"), lysholm:"✅", ikdc:"✅", tegner:"Opt.", adicional:tp("quadricepsMclPopliteal"), critical: false },
                          { momento: tp("threeMonths"), lysholm:"✅", ikdc:"✅", tegner:"✅", adicional:tp("advancedPhaseValgus"), critical: false },
                          { momento: tp("sixMonthsCritical"), lysholm:"✅", ikdc:"✅", tegner:"✅", adicional:tp("valgusReturnDecision"), critical: true },
                          { momento: tp("twelveMonths"), lysholm:"✅", ikdc:"✅", tegner:"✅", adicional:tp("formalHopAssessment"), critical: false },
                          { momento: tp("twentyFourMonths"), lysholm:"✅", ikdc:"✅", tegner:"✅", adicional:tp("definitiveLongTermResult"), critical: false },
                        ] as {momento:string;lysholm:string;ikdc:string;tegner:string;adicional:string;critical:boolean}[]).map((row, i) => (
                          <tr key={i} className={row.critical ? "bg-amber-50 font-semibold" : i % 2 === 0 ? "bg-white/60 dark:bg-slate-800/40" : "bg-teal-50/30"}>
                            <td className={`px-2 py-1.5 border border-teal-100 ${row.critical ? "text-amber-700" : "text-teal-800"}`}>{row.momento}</td>
                            {[row.lysholm, row.ikdc, row.tegner].map((v, ci) => (
                              <td key={ci} className="px-2 py-1.5 border border-teal-100 text-center">{v}</td>
                            ))}
                            <td className={`px-2 py-1.5 border border-teal-100 text-muted-foreground ${row.critical ? "text-amber-700 font-medium" : ""}`}>{row.adicional}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-teal-700 italic">{tp("lcmFooter")}</p>
                </div>
              )}

              {/* ── CPL Cronogram ── */}
              {isCplSurgery && (
                <div className="rounded-xl border-2 border-orange-200 bg-orange-50/60 p-4 space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Activity className="h-4 w-4 text-orange-600 shrink-0" />
                    <span className="font-semibold text-orange-800 text-sm">{tp("cplTitle")}</span>
                    <span className="ml-auto text-xs text-orange-600 italic">{tp("cplSubtitle")}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-[520px] text-xs border-collapse">
                      <thead>
                        <tr className="bg-orange-100/70">
                          {[tp("moment"),"Lysholm","IKDC","Tegner",tp("additionalAssessments")].map(h => (
                            <th key={h} className="text-center px-2 py-1.5 font-semibold text-orange-700 border border-orange-200 first:text-left">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {([
                          { momento: tp("preop"), lysholm:"✅", ikdc:"✅", tegner:"✅", adicional:tp("recurvatumExternalRotationStress"), critical: false },
                          { momento: tp("oneMonth"), lysholm:"Opt.", ikdc:"—", tegner:"—", adicional:tp("clinicalRomEdema"), critical: false },
                          { momento: tp("threeMonths"), lysholm:"✅", ikdc:"✅", tegner:"—", adicional:tp("initialFunctionalAssessment"), critical: false },
                          { momento: tp("sixMonthsCritical"), lysholm:"✅", ikdc:"✅", tegner:"✅", adicional:tp("returnToSportDecision"), critical: true },
                          { momento: tp("twelveMonths"), lysholm:"✅", ikdc:"✅", tegner:"✅", adicional:tp("hopTestsPosterolateralStability"), critical: false },
                          { momento: tp("twentyFourMonths"), lysholm:"✅", ikdc:"✅", tegner:"✅", adicional:tp("definitiveAssessment"), critical: false },
                        ] as {momento:string;lysholm:string;ikdc:string;tegner:string;adicional:string;critical:boolean}[]).map((row, i) => (
                          <tr key={i} className={row.critical ? "bg-amber-50 font-semibold" : i % 2 === 0 ? "bg-white/60 dark:bg-slate-800/40" : "bg-orange-50/30"}>
                            <td className={`px-2 py-1.5 border border-orange-100 ${row.critical ? "text-amber-700" : "text-orange-800"}`}>{row.momento}</td>
                            {[row.lysholm, row.ikdc, row.tegner].map((v, ci) => (
                              <td key={ci} className="px-2 py-1.5 border border-orange-100 text-center">{v}</td>
                            ))}
                            <td className={`px-2 py-1.5 border border-orange-100 text-muted-foreground ${row.critical ? "text-amber-700 font-medium" : ""}`}>{row.adicional}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-orange-700 italic">{tp("cplFooter")}</p>
                </div>
              )}

              {/* ── LCP Protocol Cronogram Card ── */}
              {isLcpSurgery && (
                <div className="rounded-xl border-2 border-blue-200 bg-blue-50/60 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Activity className="h-4 w-4 text-blue-600 shrink-0" />
                    <span className="font-semibold text-blue-800 text-sm">{tp("lcpTitle")}</span>
                    <span className="ml-auto text-xs text-blue-500 italic">{tp("lcpSubtitle")}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-[520px] text-xs border-collapse">
                      <thead>
                        <tr className="bg-blue-100/70">
                          <th className="text-left px-2 py-1.5 font-semibold text-blue-700 border border-blue-200 rounded-tl-md">{tp("moment")}</th>
                          <th className="text-center px-2 py-1.5 font-semibold text-blue-700 border border-blue-200">Lysholm</th>
                          <th className="text-center px-2 py-1.5 font-semibold text-blue-700 border border-blue-200">IKDC</th>
                          <th className="text-center px-2 py-1.5 font-semibold text-blue-700 border border-blue-200">Tegner</th>
                          <th className="text-left px-2 py-1.5 font-semibold text-blue-700 border border-blue-200 rounded-tr-md">{tp("additionalAssessments")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          { momento: tp("preop"), lysholm: "✅", ikdc: "✅", tegner: "✅", adicional: tp("posteriorDrawerStressXray") },
                          { momento: tp("oneMonth"), lysholm: tp("optional"), ikdc: tp("optional"), tegner: "—", adicional: tp("clinicalRomEdemaComplications") },
                          { momento: tp("threeMonths"), lysholm: "✅", ikdc: "✅", tegner: "—", adicional: tp("initialFunctionalAssessment") },
                          { momento: tp("sixMonthsCritical"), lysholm: "✅", ikdc: "✅", tegner: "✅", adicional: tp("kneelingStressXray"), critical: true },
                          { momento: tp("twelveMonths"), lysholm: "✅", ikdc: "✅", tegner: "✅", adicional: tp("jumpTestsIsokinetic") },
                          { momento: tp("twentyFourMonths"), lysholm: "✅", ikdc: "✅", tegner: "✅", adicional: tp("definitiveAssessment") },
                          { momento: tp("annualAfterTwoYears"), lysholm: "✅", ikdc: "✅", tegner: "✅", adicional: tp("osteoarthritisPosteriorLaxity") },
                        ].map((row, i) => (
                          <tr key={i} className={(row as any).critical ? "bg-amber-50 font-semibold" : i % 2 === 0 ? "bg-white/60 dark:bg-slate-800/40" : "bg-blue-50/30"}>
                            <td className={`px-2 py-1.5 border border-blue-100 ${(row as any).critical ? "text-amber-700" : "text-blue-800"}`}>{row.momento}</td>
                            <td className="px-2 py-1.5 border border-blue-100 text-center">{row.lysholm}</td>
                            <td className="px-2 py-1.5 border border-blue-100 text-center">{row.ikdc}</td>
                            <td className="px-2 py-1.5 border border-blue-100 text-center">{row.tegner}</td>
                            <td className={`px-2 py-1.5 border border-blue-100 text-muted-foreground ${(row as any).critical ? "text-amber-700 font-medium" : ""}`}>{row.adicional}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-blue-600 italic">{tp("lcpFooter")}</p>
                </div>
              )}


              {/* ── Lesões Osteocondrais — Cronograma Follow-up ── */}
              {isOsteocondralSurgery && (
                <div className="rounded-xl border-2 border-teal-200 bg-teal-50/60 p-4 space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Activity className="h-4 w-4 text-teal-600 shrink-0" />
                    <span className="font-semibold text-teal-800 text-sm">{tp("locTitle")}</span>
                    <span className="ml-auto text-xs text-teal-600 italic">{tp("locSubtitle")}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-[520px] text-xs border-collapse">
                      <thead>
                        <tr className="bg-teal-100/70">
                          {[tp("moment"),"IKDC","KOOS-12","WOMAC","Tegner"].map(h => (
                            <th key={h} className="text-center px-2 py-1.5 font-semibold text-teal-700 border border-teal-200 first:text-left">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {([
                          { momento:tp("preop"),     ikdc:"✅", koos12:"✅", womac:"✅", tegner:"✅", critical:false },
                          { momento:tp("sixWeeks"),  ikdc:"—",  koos12:"✅", womac:"✅", tegner:"—",  critical:false },
                          { momento:tp("threeMonths"),    ikdc:"✅", koos12:"✅", womac:"✅", tegner:"—",  critical:false },
                          { momento:tp("sixMonthsCritical"),  ikdc:"✅", koos12:"✅", womac:"✅", tegner:"✅", critical:true },
                          { momento:tp("oneYear"),      ikdc:"✅", koos12:"✅", womac:"✅", tegner:"✅", critical:false },
                          { momento:tp("twoYears"),     ikdc:"✅", koos12:"✅", womac:"✅", tegner:"✅", critical:false },
                          { momento:tp("fiveYears"),     ikdc:"✅", koos12:"✅", womac:"✅", tegner:"✅", critical:false },
                        ] as {momento:string;ikdc:string;koos12:string;womac:string;tegner:string;critical:boolean}[]).map((row, i) => (
                          <tr key={i} className={row.critical ? "bg-amber-50 font-semibold" : i % 2 === 0 ? "bg-white/60 dark:bg-slate-800/40" : "bg-teal-50/30"}>
                            <td className={`px-2 py-1.5 border border-teal-100 ${row.critical ? "text-amber-700" : "text-teal-800"}`}>{row.momento}</td>
                            {[row.ikdc, row.koos12, row.womac, row.tegner].map((v, ci) => (
                              <td key={ci} className="px-2 py-1.5 border border-teal-100 text-center">{v}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-teal-700 italic">{tp("locFooter")}</p>
                </div>
              )}

              {/* ── Artroplastias — Cronograma Follow-up ── */}
              {isArtroplastiaSurgery && (
                <div className="rounded-xl border-2 border-indigo-200 bg-indigo-50/60 p-4 space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Activity className="h-4 w-4 text-indigo-600 shrink-0" />
                    <span className="font-semibold text-indigo-800 text-sm">{tp("atjTitle")}</span>
                    <span className="ml-auto text-xs text-indigo-600 italic">{tp("atjSubtitle")}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-[520px] text-xs border-collapse">
                      <thead>
                        <tr className="bg-indigo-100/70">
                          {[tp("moment"),"EVA","WOMAC","KOOS-12","Tegner"].map(h => (
                            <th key={h} className="text-center px-2 py-1.5 font-semibold text-indigo-700 border border-indigo-200 first:text-left">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {([
                          { momento:tp("preop"),        eva:"✅", womac:"✅", koos12:"✅", tegner:"✅", critical:false },
                          { momento:tp("sevenToFourteenDays"),     eva:"✅", womac:"—",  koos12:"—",  tegner:"—",  critical:false },
                          { momento:tp("threeWeeks"),     eva:"✅", womac:"—",  koos12:"—",  tegner:"—",  critical:false },
                          { momento:tp("sixWeeks"),     eva:"✅", womac:"✅", koos12:"—",  tegner:"—",  critical:false },
                          { momento:tp("threeMonths"),       eva:"✅", womac:"✅", koos12:"✅", tegner:"—",  critical:false },
                          { momento:tp("sixMonths"),       eva:"✅", womac:"✅", koos12:"✅", tegner:"✅", critical:false },
                          { momento:tp("oneYearCritical"),       eva:"✅", womac:"✅", koos12:"✅", tegner:"✅", critical:true },
                          { momento:tp("twoYears"),        eva:"—",  womac:"✅", koos12:"✅", tegner:"—",  critical:false },
                          { momento:tp("annualAfterThreeYears"),   eva:"—",  womac:"✅", koos12:"✅", tegner:"—",  critical:false },
                        ] as {momento:string;eva:string;womac:string;koos12:string;tegner:string;critical:boolean}[]).map((row, i) => (
                          <tr key={i} className={row.critical ? "bg-amber-50 font-semibold" : i % 2 === 0 ? "bg-white/60 dark:bg-slate-800/40" : "bg-indigo-50/30"}>
                            <td className={`px-2 py-1.5 border border-indigo-100 dark:border-indigo-800/40 ${row.critical ? "text-amber-700" : "text-indigo-800"}`}>{row.momento}</td>
                            {[row.eva, row.womac, row.koos12, row.tegner].map((v, ci) => (
                              <td key={ci} className="px-2 py-1.5 border border-indigo-100 dark:border-indigo-800/40 text-center">{v}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="text-xs text-indigo-700 space-y-0.5">
                    <p>{tp("atjFooter1")}</p>
                    <p>{tp("atjFooter2")}</p>
                  </div>
                </div>
              )}

              {/* ── Ortobiológicos — Cronograma Follow-up ── */}
              {isOrtobiologicoSurgery && (
                <div className="rounded-xl border-2 border-amber-200 bg-amber-50/60 p-4 space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Activity className="h-4 w-4 text-amber-600 shrink-0" />
                    <span className="font-semibold text-amber-800 text-sm">{tp("orthobiologicTitle")}</span>
                    <span className="ml-auto text-xs text-amber-600 italic">{tp("orthobiologicSubtitle")}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-[520px] text-xs border-collapse">
                      <thead>
                        <tr className="bg-amber-100/70">
                          {[tp("moment"),"EVA","WOMAC","IKDC","KOOS-12","Tegner"].map(h => (
                            <th key={h} className="text-center px-2 py-1.5 font-semibold text-amber-700 border border-amber-200 first:text-left">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {([
                          { momento:tp("preopBaseline"), eva:"✅", womac:"✅", ikdc:"✅", koos12:"✅", tegner:"✅", critical:false },
                          { momento:tp("oneMonth"),             eva:"✅", womac:"✅", ikdc:"—",  koos12:"—",  tegner:"—",  critical:false },
                          { momento:tp("sixWeeksHa"),    eva:"✅", womac:"✅", ikdc:"—",  koos12:"—",  tegner:"—",  critical:false },
                          { momento:tp("threeMonths"),           eva:"✅", womac:"✅", ikdc:"✅", koos12:"—",  tegner:"—",  critical:false },
                          { momento:tp("sixMonthsCritical"),         eva:"✅", womac:"✅", ikdc:"✅", koos12:"✅", tegner:"✅", critical:true },
                          { momento:tp("twelveMonths"),          eva:"✅", womac:"✅", ikdc:"✅", koos12:"✅", tegner:"✅", critical:false },
                          { momento:tp("twentyFourMonths"),          eva:"✅", womac:"✅", ikdc:"✅", koos12:"✅", tegner:"✅", critical:false },
                          { momento:tp("fourYears"),            eva:"✅", womac:"✅", ikdc:"✅", koos12:"✅", tegner:"✅", critical:false },
                        ] as {momento:string;eva:string;womac:string;ikdc:string;koos12:string;tegner:string;critical:boolean}[]).map((row, i) => (
                          <tr key={i} className={row.critical ? "bg-amber-100 font-semibold" : i % 2 === 0 ? "bg-white/60 dark:bg-slate-800/40" : "bg-amber-50/30"}>
                            <td className={`px-2 py-1.5 border border-amber-100 ${row.critical ? "text-amber-800" : "text-amber-800"}`}>{row.momento}</td>
                            {[row.eva, row.womac, row.ikdc, row.koos12, row.tegner].map((v, ci) => (
                              <td key={ci} className="px-2 py-1.5 border border-amber-100 text-center">{v}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="text-xs text-amber-700 space-y-0.5">
                    <p>{tp("orthobiologicFooter1")}</p>
                    <p>{tp("orthobiologicFooter2")}</p>
                  </div>
                </div>
              )}

              {/* ── Instabilidade Patelar Cronogram ── */}
              {isPatelarSurgery && (
                <div className="rounded-xl border-2 border-pink-200 bg-pink-50/60 p-4 space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Activity className="h-4 w-4 text-pink-600 shrink-0" />
                    <span className="font-semibold text-pink-800 text-sm">{tp("patellarTitle")}</span>
                    <span className="ml-auto text-xs text-pink-600 italic">{tp("patellarSubtitle")}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-[520px] text-xs border-collapse">
                      <thead>
                        <tr className="bg-pink-100/70">
                          {[tp("moment"),"Kujala","IKDC",tp("painVas"),"Tegner",tp("additionalAssessments")].map(h => (
                            <th key={h} className="text-center px-2 py-1.5 font-semibold text-pink-700 border border-pink-200 first:text-left">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {([
                          { momento: tp("preop"),      kujala:"✅", ikdc:"✅", vas:"✅", tegner:"✅", adicional:tp("patellarPreopAssessment"), critical: false },
                          { momento: tp("sixWeeks"),   kujala:"✅", ikdc:"—",  vas:"✅", tegner:"—",  adicional:tp("patellarSixWeeksAssessment"), critical: false },
                          { momento: tp("ninetyDays"),     kujala:"✅", ikdc:"✅", vas:"✅", tegner:"—",  adicional:tp("patellarNinetyDaysAssessment"), critical: false },
                          { momento: tp("oneHundredEightyDaysCritical"),  kujala:"✅", ikdc:"✅", vas:"✅", tegner:"✅", adicional:tp("patellarReturnDecision"), critical: true },
                          { momento: tp("oneYear"),       kujala:"✅", ikdc:"✅", vas:"✅", tegner:"✅", adicional:tp("patellarOneYearAssessment"), critical: false },
                          { momento: tp("twoYears"),      kujala:"✅", ikdc:"✅", vas:"✅", tegner:"✅", adicional:tp("patellarTwoYearsAssessment"), critical: false },
                        ] as {momento:string;kujala:string;ikdc:string;vas:string;tegner:string;adicional:string;critical:boolean}[]).map((row, i) => (
                          <tr key={i} className={row.critical ? "bg-amber-50 font-semibold" : i % 2 === 0 ? "bg-white/60 dark:bg-slate-800/40" : "bg-pink-50/30"}>
                            <td className={`px-2 py-1.5 border border-pink-100 ${row.critical ? "text-amber-700" : "text-pink-800"}`}>{row.momento}</td>
                            {[row.kujala, row.ikdc, row.vas, row.tegner].map((v, ci) => (
                              <td key={ci} className="px-2 py-1.5 border border-pink-100 text-center">{v}</td>
                            ))}
                            <td className={`px-2 py-1.5 border border-pink-100 text-muted-foreground ${row.critical ? "text-amber-700 font-medium" : ""}`}>{row.adicional}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-pink-700 italic">{tp("patellarFooter")}</p>
                </div>
              )}

              {/* ── Agendamentos automáticos de follow-up ── */}
              {displayedSchedule.length === 0 && surgery && (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/40 p-4 flex items-center gap-3">
                  <Bell className="h-5 w-5 text-slate-400 shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-slate-600">{ts("followupTimeline")}</p>
                    <p className="text-xs text-slate-400">{ts("noScheduledEvaluations")}</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={generateSchedule} disabled={generatingSchedule} className="gap-1.5 shrink-0">
                    {generatingSchedule ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bell className="h-3.5 w-3.5" />}
                    {ts("generateSchedule")}
                  </Button>
                </div>
              )}

              {displayedSchedule.length > 0 && (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-4 space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Bell className="h-4 w-4 text-slate-500 shrink-0" />
                    <span className="font-semibold text-slate-700 text-sm">{ts("scaleDeliveryTimeline")}</span>
                    <span className="ml-auto text-xs text-slate-500">
                       {ts("scheduleSummary", {
                         pending: displayedSchedule.filter(n => n.status === "pending").length,
                         sent: displayedSchedule.filter(n => n.status === "sent" || n.status === "completed").length,
                       })}
                    </span>
                    <button onClick={generateSchedule} disabled={generatingSchedule} title={ts("regenerateSchedule")} className="text-xs text-slate-400 hover:text-slate-600 transition-colors flex items-center gap-1">
                      {generatingSchedule ? <Loader2 className="h-3 w-3 animate-spin" /> : <Activity className="h-3 w-3" />}
                      {ts("regenerate")}
                    </button>
                  </div>
                  <div className="space-y-1.5">
                     {displayedSchedule.map((notif) => {
                      const now = new Date();
                      const schedDate = notif.scheduledDate ? new Date(notif.scheduledDate + "T12:00:00") : null;
                      const sentAtDate = notif.sentAt ? new Date(notif.sentAt) : null;
                      const sentLate = notif.status === "sent" && sentAtDate && (now.getTime() - sentAtDate.getTime()) > 7 * 86400000;
                      const isOverdue = schedDate && schedDate < now && notif.status === "pending";
                      const isDueThisWeek = schedDate && !isOverdue && schedDate <= new Date(Date.now() + 7 * 86400000) && notif.status === "pending";
                      const statusColor =
                        notif.status === "completed" ? "text-green-700 bg-green-50 border-green-200"
                        : sentLate ? "text-red-600 bg-red-50 border-red-200"
                        : notif.status === "sent" ? "text-yellow-700 bg-yellow-50 border-yellow-300"
                        : notif.status === "skipped" ? "text-slate-400 bg-slate-50 border-slate-200"
                        : isOverdue ? "text-red-600 bg-red-50 border-red-200"
                        : isDueThisWeek ? "text-amber-700 bg-amber-50 border-amber-200"
                        : "text-slate-600 bg-white border-slate-200";
                      const statusIcon =
                        notif.status === "completed" ? <CheckCheck className="h-3.5 w-3.5 text-green-600" />
                        : sentLate ? <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                        : notif.status === "sent" ? <Clock className="h-3.5 w-3.5 text-yellow-500" />
                        : notif.status === "skipped" ? <BellOff className="h-3.5 w-3.5 text-slate-400" />
                        : isOverdue ? <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                        : <Clock className="h-3.5 w-3.5 text-slate-400" />;
                      return (
                        <div key={notif.id} className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-xs ${statusColor}`}>
                          <div className="shrink-0 w-4">{statusIcon}</div>
                          <div className="flex-1 min-w-0">
                            <span className="font-medium">{schedulePeriodLabel(notif.periodo)}</span>
                            {notif.status === "sent" && (
                              <span className={`ml-2 font-semibold ${sentLate ? "text-red-600" : "text-yellow-700"}`}>
                                {sentLate ? ts("noResponseSevenDays") : ts("awaitingResponse")}
                              </span>
                            )}
                            {notif.status === "completed" && <span className="ml-2 font-semibold text-green-700">{ts("answered")}</span>}
                            {notif.notes && notif.status === "pending" && <span className="ml-2 opacity-70">{notif.notes}</span>}
                            {notif.scales && notif.scales.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-0.5">
                                {notif.scales.map(s => <span key={s} className="px-1.5 py-0.5 bg-black/5 rounded text-[10px]">{scaleDisplayLabel(s)}</span>)}
                              </div>
                            )}
                          </div>
                          <div className="shrink-0 text-right">
                            {notif.status === "sent" && sentAtDate && (
                              <div className="font-mono opacity-80">
                                {t("sentOn", { date: formatDate(sentAtDate) })}
                              </div>
                            )}
                            {notif.status === "completed" && notif.scheduledDate && (
                              <div className="font-mono opacity-70">
                                {t("scheduledFor", { date: formatDate(new Date(notif.scheduledDate + "T12:00:00")) })}
                              </div>
                            )}
                            {notif.status === "pending" && notif.scheduledDate && (
                              <div className="font-mono opacity-70">
                                {t("dueOn", { date: formatDate(new Date(notif.scheduledDate + "T12:00:00")) })}
                              </div>
                            )}
                            {notif.status === "pending" && (
                              <div className="flex flex-col gap-1 mt-1 items-end">
                                <button
                                  onClick={() => handlePrepareWhatsApp(notif.id)}
                                  disabled={waPreparing === notif.id}
                                  className="text-[10px] px-2 py-0.5 rounded bg-green-600 text-white hover:bg-green-700 transition-colors flex items-center gap-1 disabled:opacity-60"
                                >
                                  {waPreparing === notif.id ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : "📱"}
                                  {ts("openWhatsApp")}
                                </button>
                                <button
                                  onClick={() => {
                                    setSendScalesFollowupId(null);
                                    setSelectedScales(notif.scales ?? []);
                                    setSendScalesOpen(true);
                                  }}
                                  className="text-[10px] px-2 py-0.5 rounded bg-slate-200 text-slate-700 hover:bg-slate-300 transition-colors"
                                >
                                  🔗 {ts("copyLink")}
                                </button>
                                <button
                                  onClick={() => markNotifStatus(notif.id, "skipped")}
                                  className="text-[10px] px-1.5 py-0.5 rounded text-slate-400 hover:text-slate-600 transition-colors"
                                >
                                  {ts("skip")}
                                </button>
                              </div>
                            )}
                            {(notif.status === "sent" || notif.status === "completed") && (
                              <button
                                onClick={() => markNotifStatus(notif.id, "pending")}
                                className="text-[10px] px-2 py-0.5 mt-1 rounded bg-slate-200 text-slate-600 hover:bg-slate-300 transition-colors"
                              >
                                {ts("reopen")}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {!surgery?.dataCirurgia && (
                    <p className="text-xs text-amber-600 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> {ts("surgeryDateScheduleWarning")}
                    </p>
                  )}
                </div>
              )}

              <div className="flex justify-between items-center flex-wrap gap-2">
                <h3 className="text-lg font-medium">{ts("postoperativeEvaluations")}</h3>
                <div className="flex gap-2 flex-wrap">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    onClick={() => setFullReportOpen(true)}
                  >
                    <Activity className="h-4 w-4" /> {ts("completeReport")}
                  </Button>
                  <Dialog open={followupOpen} onOpenChange={handleFollowupOpenChange}>
                  <DialogTrigger asChild>
                    <Button size="sm" className="gap-1">
                      <Plus className="h-4 w-4" /> {ts("registerEvaluation")}
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>{ts("newFollowup")}</DialogTitle>
                      <DialogDescription>{ts("newFollowupDescription")}</DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleCreateFollowup} className="space-y-6 pt-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>{ts("returnTime")}</Label>
                          <Select value={followupData.tempo} onValueChange={v => setFollowupData({...followupData, tempo: v})} required>
                            <SelectTrigger><SelectValue placeholder={ts("select")} /></SelectTrigger>
                            <SelectContent>
                              {!isFractureSurgery && (
                                <SelectItem value="Pré-operatório">{ts("periodPreoperative")}</SelectItem>
                              )}
                              <SelectItem value="30 dias">{ts("period30DaysDetail")}</SelectItem>
                              <SelectItem value="90 dias">{ts("period90DaysDetail")}</SelectItem>
                              <SelectItem value="180 dias">{ts("period180DaysDetail")}</SelectItem>
                              <SelectItem value="1 ano">{ts("period1YearDetail")}</SelectItem>
                              <SelectItem value="2 anos">{ts("period2YearsDetail")}</SelectItem>
                              <SelectItem value="5 anos">{ts("period5Years")}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>{ts("evaluationDate")}</Label>
                          <Input type="date" value={followupData.dataAvaliacao} onChange={e => setFollowupData({...followupData, dataAvaliacao: e.target.value})} />
                        </div>
                      </div>

                      {/* Scale inputs with questionnaire buttons */}
                      <div className="space-y-1">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{ts("clinicalScales")}</p>
                        <p className="text-xs text-muted-foreground">
                          {ts("scaleEntryHelp")}
                          {!tempoGte9m && followupData.tempo !== "" && (
                            <span className="ml-1 text-amber-600 dark:text-amber-400"> {ts("delayedScalesHelp")}</span>
                          )}
                        </p>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {([
                          { key: "ikdc" as const, label: "IKDC", scale: "IKDC", max: 100, step: 0.1 },
                          { key: "lysholm" as const, label: "Lysholm", scale: "Lysholm", max: 100, step: 1 },
                          { key: "tegner" as const, label: "Tegner", scale: "Tegner", max: 10, step: 1 },
                          ...(!isFractureSurgery
                            ? [{ key: "vasDor" as const, label: ts("scaleVasPain"), scale: "VAS Dor", max: 10, step: 1 }]
                            : []),
                          ...(tempoGte9m && !isLcpSurgery ? [
                            { key: "aclRsi" as const, label: "ACL-RSI", scale: "ACL-RSI" as string | null, max: 100, step: 0.1 },
                            { key: "marx" as const, label: "Marx", scale: "Marx" as string | null, max: 16, step: 1 },
                          ] : []),
                        ]).map(({ key, label, scale, max, step }) => (
                          <div key={key} className="space-y-1">
                            <Label className="text-xs text-muted-foreground">{label} <span className="opacity-50">/ {max}</span></Label>
                            <div className="flex gap-1.5">
                              <Input
                                type="number"
                                min={0}
                                max={max}
                                step={step}
                                value={followupData[key]}
                                onChange={e => setFollowupData({...followupData, [key]: e.target.value})}
                                placeholder="—"
                                className="h-8 text-sm"
                              />
                              {scale && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-8 px-2 text-xs gap-1 shrink-0 border-primary/40 text-primary hover:bg-primary/5"
                                  onClick={() => setScaleDialogOpen(scale)}
                                >
                                  {ts("calculate")}
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* KOOS-12 */}
                      <div className="border rounded-lg border-border">
                        <div className="px-3 py-2 flex items-center justify-between border-b">
                          <span className="text-xs font-semibold text-muted-foreground">
                            {ts("koosHeading")}
                          </span>
                          <span className="text-xs text-muted-foreground opacity-60">{ts("optional")}</span>
                        </div>
                        <div className="p-3">
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">{ts("koosTotal")} <span className="opacity-50">/ 100</span></Label>
                            <div className="flex gap-1.5">
                              <Input
                                type="number" step="0.1" min={0} max={100}
                                value={followupData.koos12}
                                onChange={e => setFollowupData(prev => ({ ...prev, koos12: e.target.value }))}
                                className="h-8"
                                placeholder="0–100"
                              />
                              <Button type="button" variant="outline" size="sm" className="h-8 px-2 text-xs whitespace-nowrap"
                                onClick={() => setScaleDialogOpen("KOOS-12")}>
                                {ts("calculate12Items")}
                              </Button>
                            </div>
                            <p className="text-xs text-muted-foreground opacity-70 mt-1">{ts("koosFormula")}</p>
                          </div>
                        </div>
                      </div>

                      {/* WOMAC */}
                      <div className="border rounded-lg border-border">
                        <div className="px-3 py-2 flex items-center justify-between border-b">
                          <span className="text-xs font-semibold text-muted-foreground">
                            {ts("womacHeading")}
                          </span>
                          <span className="text-xs text-muted-foreground opacity-60">{ts("optional")}</span>
                        </div>
                        <div className="p-3">
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">{ts("womacTotal")} <span className="opacity-50">/ 100</span></Label>
                            <div className="flex gap-1.5">
                              <Input
                                type="number" step="0.1" min={0} max={100}
                                value={followupData.womac}
                                onChange={e => setFollowupData(prev => ({ ...prev, womac: e.target.value }))}
                                className="h-8"
                                placeholder="0–100"
                              />
                              <Button type="button" variant="outline" size="sm" className="h-8 px-2 text-xs whitespace-nowrap"
                                onClick={() => setScaleDialogOpen("WOMAC")}>
                                {ts("calculate")}
                              </Button>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">{ts("womacHelp")}</p>
                          </div>
                        </div>
                      </div>

                      {isFractureSurgery && (
                        <div className="border-t pt-5 space-y-4">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{ts("fractureAssessment")}</span>
                            <div className="flex-1 h-px bg-border" />
                          </div>
                          <p className="text-xs text-muted-foreground -mt-2">
                            {ts("fractureAssessmentHelp")}
                          </p>

                          <div className="border rounded-lg border-blue-200 bg-blue-50/30">
                            <div className="px-3 py-2 border-b border-blue-200">
                              <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">{ts("painVas")}</span>
                            </div>
                            <div className="p-3 space-y-1">
                              <Label className="text-xs text-muted-foreground">{ts("painIntensity")} <span className="opacity-60">{ts("painRange")}</span></Label>
                              <div className="flex gap-2">
                                <Input
                                  type="number"
                                  min={0}
                                  max={10}
                                  step={1}
                                  value={followupData.vasDor}
                                  onChange={e => setFollowupData(prev => ({ ...prev, vasDor: e.target.value }))}
                                  placeholder="0–10"
                                  className="h-9"
                                />
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-9 px-3 text-xs border-blue-300 text-blue-700"
                                  onClick={() => setScaleDialogOpen("VAS Dor")}
                                >
                                  {ts("calculate")}
                                </Button>
                              </div>
                            </div>
                          </div>

                          <div className="grid lg:grid-cols-2 gap-4">
                            <div className="border rounded-lg border-amber-200 bg-amber-50/20 overflow-hidden">
                              <div className="px-3 py-2 border-b border-amber-200">
                                <span className="text-xs font-semibold text-amber-800 uppercase tracking-wide">{ts("acuteComplications")}</span>
                              </div>
                              <div className="p-3 space-y-3">
                                <div className="flex flex-wrap gap-1.5">
                                  {FRACTURE_ACUTE_COMPLICATION_OPTIONS.map((option) => {
                                    const encoded = encodeFractureComplication("aguda", option);
                                    const selected = followupData.complicacoes.includes(encoded);
                                    return (
                                      <button
                                        key={option}
                                        type="button"
                                        onClick={() => setFollowupData(prev => ({
                                          ...prev,
                                          complicacoes: selected
                                            ? prev.complicacoes.filter((item) => item !== encoded)
                                            : [...prev.complicacoes, encoded],
                                        }))}
                                        className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                                          selected
                                            ? "border-amber-500 bg-amber-100 text-amber-900 font-medium"
                                            : "border-amber-200 bg-white hover:border-amber-400"
                                        }`}
                                      >
                                        {selected && <CheckCircle2 className="inline h-3 w-3 mr-1" />}
                                        {fractureComplicationLabel(option)}
                                      </button>
                                    );
                                  })}
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs text-muted-foreground">{ts("otherAcuteComplications")}</Label>
                                  <Textarea
                                    value={followupData.complicacoesAgudasOutro}
                                    onChange={e => setFollowupData(prev => ({ ...prev, complicacoesAgudasOutro: e.target.value }))}
                                    placeholder={ts("onePerLine")}
                                    rows={3}
                                    className="text-sm resize-none bg-white"
                                  />
                                </div>
                              </div>
                            </div>

                            <div className="border rounded-lg border-red-200 bg-red-50/20 overflow-hidden">
                              <div className="px-3 py-2 border-b border-red-200">
                                <span className="text-xs font-semibold text-red-700 uppercase tracking-wide">{ts("lateComplications")}</span>
                              </div>
                              <div className="p-3 space-y-3">
                                <div className="flex flex-wrap gap-1.5">
                                  {FRACTURE_LATE_COMPLICATION_OPTIONS.map((option) => {
                                    const encoded = encodeFractureComplication("tardia", option);
                                    const selected = followupData.complicacoes.includes(encoded);
                                    return (
                                      <button
                                        key={option}
                                        type="button"
                                        onClick={() => setFollowupData(prev => ({
                                          ...prev,
                                          complicacoes: selected
                                            ? prev.complicacoes.filter((item) => item !== encoded)
                                            : [...prev.complicacoes, encoded],
                                        }))}
                                        className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                                          selected
                                            ? "border-red-500 bg-red-100 text-red-900 font-medium"
                                            : "border-red-200 bg-white hover:border-red-400"
                                        }`}
                                      >
                                        {selected && <CheckCircle2 className="inline h-3 w-3 mr-1" />}
                                        {fractureComplicationLabel(option)}
                                      </button>
                                    );
                                  })}
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs text-muted-foreground">{ts("otherLateComplications")}</Label>
                                  <Textarea
                                    value={followupData.complicacoesTardiasOutro}
                                    onChange={e => setFollowupData(prev => ({ ...prev, complicacoesTardiasOutro: e.target.value }))}
                                    placeholder={ts("onePerLine")}
                                    rows={3}
                                    className="text-sm resize-none bg-white"
                                  />
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* ─── Seção separada: Avaliação Clínica — apenas artroplastia ─── */}
                      {isPatelarSurgery && (
                        <div className="border-t pt-5 space-y-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{tc("patellarAssessment")}</span>
                            <div className="flex-1 h-px bg-border" />
                          </div>
                          <p className="text-xs text-muted-foreground -mt-1">{tc("assessmentDescription")}</p>

                          {/* ADM */}
                          <div className="border rounded-lg border-blue-200 bg-blue-50/30">
                            <div className="px-3 py-2 border-b border-blue-200">
                              <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">{tc("rangeOfMotion")}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-3 p-3">
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">{tc("flexion")} <span className="opacity-50">{tc("degrees")}</span></Label>
                                <Input
                                  type="number" min={0} max={160} step={5}
                                  value={followupData.admFlexao}
                                  onChange={e => setFollowupData(prev => ({ ...prev, admFlexao: e.target.value }))}
                                  placeholder={tc("example120")}
                                  className="h-8"
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">{tc("extension")} <span className="opacity-50">{tc("extensionDegrees")}</span></Label>
                                <Input
                                  type="number" min={-10} max={30} step={1}
                                  value={followupData.admExtensao}
                                  onChange={e => setFollowupData(prev => ({ ...prev, admExtensao: e.target.value }))}
                                  placeholder={tc("example0")}
                                  className="h-8"
                                />
                              </div>
                            </div>
                          </div>

                          {/* Complicações Instabilidade Patelar */}
                          <div className="border rounded-lg border-red-200 bg-red-50/20">
                            <div className="px-3 py-2 border-b border-red-200 flex items-center justify-between">
                              <span className="text-xs font-semibold text-red-700 uppercase tracking-wide">{t("complicationMonitoring")}</span>
                              {followupData.complicacoes.length > 0 && (
                                <span className="text-xs font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full">
                                  {tc(followupData.complicacoes.length === 1 ? "complicationRegistered" : "complicationsRegistered", { count: followupData.complicacoes.length })}
                                </span>
                              )}
                            </div>
                            <div className="p-3 space-y-1">
                              <p className="text-xs text-muted-foreground mb-2">{t("complicationSelectPrompt")}</p>
                              <div className="space-y-2">
                                {PATELAR_COMPLICATIONS.map(c => {
                                  const isChecked = followupData.complicacoes.includes(c.code);
                                  return (
                                    <label key={c.code} className={`flex items-start gap-2.5 p-2 rounded cursor-pointer transition-colors ${isChecked ? "bg-red-100 border border-red-300" : "hover:bg-red-50/50 border border-transparent"}`}>
                                      <input
                                        type="checkbox"
                                        className="mt-0.5 accent-red-600"
                                        checked={isChecked}
                                        onChange={e => {
                                          setFollowupData(prev => ({
                                            ...prev,
                                            complicacoes: e.target.checked
                                              ? [...prev.complicacoes, c.code]
                                              : prev.complicacoes.filter(x => x !== c.code)
                                          }));
                                        }}
                                      />
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <span className="text-xs font-medium">{c.nome}</span>
                                          <span className="text-xs text-muted-foreground bg-muted px-1 py-0.5 rounded">{c.momento}</span>
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-0.5">{c.sinais}</p>
                                      </div>
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {isLcmSurgery && (
                        <div className="border-t pt-5 space-y-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{tc("mclAssessment")}</span>
                            <div className="flex-1 h-px bg-border" />
                          </div>
                          <p className="text-xs text-muted-foreground -mt-1">{tc("assessmentDescription")}</p>

                          <div className="border rounded-lg border-blue-200 bg-blue-50/30">
                            <div className="px-3 py-2 border-b border-blue-200">
                              <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">{tc("rangeOfMotion")}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-3 p-3">
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">{tc("flexion")} <span className="opacity-50">{tc("degrees")}</span></Label>
                                <Input type="number" min={0} max={160} step={5} value={followupData.admFlexao} onChange={e => setFollowupData(prev => ({ ...prev, admFlexao: e.target.value }))} placeholder={tc("example120")} className="h-8" />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">{tc("extension")} <span className="opacity-50">{tc("extensionDegrees")}</span></Label>
                                <Input type="number" min={-10} max={30} step={1} value={followupData.admExtensao} onChange={e => setFollowupData(prev => ({ ...prev, admExtensao: e.target.value }))} placeholder={tc("example0")} className="h-8" />
                              </div>
                            </div>
                          </div>

                          <div className="border rounded-lg border-red-200 bg-red-50/20">
                            <div className="px-3 py-2 border-b border-red-200 flex items-center justify-between">
                              <span className="text-xs font-semibold text-red-700 uppercase tracking-wide">{t("complicationMonitoring")}</span>
                              {followupData.complicacoes.length > 0 && (
                                <span className="text-xs font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full">
                                  {tc(followupData.complicacoes.length === 1 ? "complicationRegistered" : "complicationsRegistered", { count: followupData.complicacoes.length })}
                                </span>
                              )}
                            </div>
                            <div className="p-3 space-y-1">
                              <p className="text-xs text-muted-foreground mb-2">{t("complicationSelectPrompt")}</p>
                              <div className="space-y-2">
                                {LCM_COMPLICATIONS.map(c => {
                                  const isChecked = followupData.complicacoes.includes(c.code);
                                  return (
                                    <label key={c.code} className={`flex items-start gap-2.5 p-2 rounded cursor-pointer transition-colors ${isChecked ? "bg-red-100 border border-red-300" : "hover:bg-red-50/50 border border-transparent"}`}>
                                      <input type="checkbox" className="mt-0.5 accent-red-600" checked={isChecked}
                                        onChange={e => setFollowupData(prev => ({ ...prev, complicacoes: e.target.checked ? [...prev.complicacoes, c.code] : prev.complicacoes.filter(x => x !== c.code) }))} />
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <span className="text-xs font-medium">{c.nome}</span>
                                          <span className="text-xs text-muted-foreground bg-muted px-1 py-0.5 rounded">{c.momento}</span>
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-0.5">{c.sinais}</p>
                                      </div>
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {isCplSurgery && (
                        <div className="border-t pt-5 space-y-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{tc("plcAssessment")}</span>
                            <div className="flex-1 h-px bg-border" />
                          </div>
                          <p className="text-xs text-muted-foreground -mt-1">{tc("assessmentDescription")}</p>

                          <div className="border rounded-lg border-blue-200 bg-blue-50/30">
                            <div className="px-3 py-2 border-b border-blue-200">
                              <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">{tc("rangeOfMotion")}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-3 p-3">
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">{tc("flexion")} <span className="opacity-50">{tc("degrees")}</span></Label>
                                <Input type="number" min={0} max={160} step={5} value={followupData.admFlexao} onChange={e => setFollowupData(prev => ({ ...prev, admFlexao: e.target.value }))} placeholder={tc("example120")} className="h-8" />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">{tc("extension")} <span className="opacity-50">{tc("extensionDegrees")}</span></Label>
                                <Input type="number" min={-10} max={30} step={1} value={followupData.admExtensao} onChange={e => setFollowupData(prev => ({ ...prev, admExtensao: e.target.value }))} placeholder={tc("example0")} className="h-8" />
                              </div>
                            </div>
                          </div>

                          <div className="border rounded-lg border-red-200 bg-red-50/20">
                            <div className="px-3 py-2 border-b border-red-200 flex items-center justify-between">
                              <span className="text-xs font-semibold text-red-700 uppercase tracking-wide">{t("complicationMonitoring")}</span>
                              {followupData.complicacoes.length > 0 && (
                                <span className="text-xs font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full">
                                  {tc(followupData.complicacoes.length === 1 ? "complicationRegistered" : "complicationsRegistered", { count: followupData.complicacoes.length })}
                                </span>
                              )}
                            </div>
                            <div className="p-3 space-y-1">
                              <p className="text-xs text-muted-foreground mb-2">{t("complicationSelectPrompt")}</p>
                              <div className="space-y-2">
                                {CPL_COMPLICATIONS.map(c => {
                                  const isChecked = followupData.complicacoes.includes(c.code);
                                  return (
                                    <label key={c.code} className={`flex items-start gap-2.5 p-2 rounded cursor-pointer transition-colors ${isChecked ? "bg-red-100 border border-red-300" : "hover:bg-red-50/50 border border-transparent"}`}>
                                      <input type="checkbox" className="mt-0.5 accent-red-600" checked={isChecked}
                                        onChange={e => setFollowupData(prev => ({ ...prev, complicacoes: e.target.checked ? [...prev.complicacoes, c.code] : prev.complicacoes.filter(x => x !== c.code) }))} />
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <span className="text-xs font-medium">{c.nome}</span>
                                          <span className="text-xs text-muted-foreground bg-muted px-1 py-0.5 rounded">{c.momento}</span>
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-0.5">{c.sinais}</p>
                                      </div>
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {isSuturaMeniscalSurgery && (
                        <div className="border-t pt-5 space-y-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{tc("meniscalAssessment")}</span>
                            <div className="flex-1 h-px bg-border" />
                          </div>
                          <p className="text-xs text-muted-foreground -mt-1">{tc("assessmentDescription")}</p>

                          {/* ADM */}
                          <div className="border rounded-lg border-blue-200 bg-blue-50/30">
                            <div className="px-3 py-2 border-b border-blue-200">
                              <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">{tc("rangeOfMotion")}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-3 p-3">
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">{tc("flexion")} <span className="opacity-50">{tc("degrees")}</span></Label>
                                <Input
                                  type="number" min={0} max={160} step={5}
                                  value={followupData.admFlexao}
                                  onChange={e => setFollowupData(prev => ({ ...prev, admFlexao: e.target.value }))}
                                  placeholder={tc("example120")}
                                  className="h-8"
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">{tc("extension")} <span className="opacity-50">{tc("extensionDegrees")}</span></Label>
                                <Input
                                  type="number" min={-10} max={30} step={1}
                                  value={followupData.admExtensao}
                                  onChange={e => setFollowupData(prev => ({ ...prev, admExtensao: e.target.value }))}
                                  placeholder={tc("example0")}
                                  className="h-8"
                                />
                              </div>
                            </div>
                          </div>

                          {/* Complicações Sutura Meniscal */}
                          <div className="border rounded-lg border-red-200 bg-red-50/20">
                            <div className="px-3 py-2 border-b border-red-200 flex items-center justify-between">
                              <span className="text-xs font-semibold text-red-700 uppercase tracking-wide">{t("complicationMonitoring")}</span>
                              {followupData.complicacoes.length > 0 && (
                                <span className="text-xs font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full">
                                  {tc(followupData.complicacoes.length === 1 ? "complicationRegistered" : "complicationsRegistered", { count: followupData.complicacoes.length })}
                                </span>
                              )}
                            </div>
                            <div className="p-3 space-y-1">
                              <p className="text-xs text-muted-foreground mb-2">{t("complicationSelectPrompt")}</p>
                              <div className="space-y-2">
                                {SUTURA_MENISCAL_COMPLICATIONS.map(c => {
                                  const isChecked = followupData.complicacoes.includes(c.code);
                                  return (
                                    <label key={c.code} className={`flex items-start gap-2.5 p-2 rounded cursor-pointer transition-colors ${isChecked ? "bg-red-100 border border-red-300" : "hover:bg-red-50/50 border border-transparent"}`}>
                                      <input
                                        type="checkbox"
                                        className="mt-0.5 accent-red-600"
                                        checked={isChecked}
                                        onChange={e => {
                                          setFollowupData(prev => ({
                                            ...prev,
                                            complicacoes: e.target.checked
                                              ? [...prev.complicacoes, c.code]
                                              : prev.complicacoes.filter(x => x !== c.code)
                                          }));
                                        }}
                                      />
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <span className="text-xs font-medium">{c.nome}</span>
                                          <span className="text-xs text-muted-foreground bg-muted px-1 py-0.5 rounded">{c.momento}</span>
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-0.5">{c.sinais}</p>
                                      </div>
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {isLcpSurgery && (
                        <div className="border-t pt-5 space-y-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{tc("pclAssessment")}</span>
                            <div className="flex-1 h-px bg-border" />
                          </div>
                          <p className="text-xs text-muted-foreground -mt-1">{tc("assessmentDescription")}</p>

                          {/* ADM */}
                          <div className="border rounded-lg border-blue-200 bg-blue-50/30">
                            <div className="px-3 py-2 border-b border-blue-200">
                              <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">{tc("rangeOfMotion")}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-3 p-3">
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">{tc("flexion")} <span className="opacity-50">{tc("degrees")}</span></Label>
                                <Input
                                  type="number" min={0} max={160} step={5}
                                  value={followupData.admFlexao}
                                  onChange={e => setFollowupData(prev => ({ ...prev, admFlexao: e.target.value }))}
                                  placeholder={tc("example120")}
                                  className="h-8"
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">{tc("extension")} <span className="opacity-50">{tc("extensionDegrees")}</span></Label>
                                <Input
                                  type="number" min={-10} max={30} step={1}
                                  value={followupData.admExtensao}
                                  onChange={e => setFollowupData(prev => ({ ...prev, admExtensao: e.target.value }))}
                                  placeholder={tc("example0")}
                                  className="h-8"
                                />
                              </div>
                            </div>
                          </div>

                          {/* Complicações LCP */}
                          <div className="border rounded-lg border-red-200 bg-red-50/20">
                            <div className="px-3 py-2 border-b border-red-200 flex items-center justify-between">
                              <span className="text-xs font-semibold text-red-700 uppercase tracking-wide">{t("complicationMonitoring")}</span>
                              {followupData.complicacoes.length > 0 && (
                                <span className="text-xs font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full">
                                  {tc(followupData.complicacoes.length === 1 ? "complicationRegistered" : "complicationsRegistered", { count: followupData.complicacoes.length })}
                                </span>
                              )}
                            </div>
                            <div className="p-3 space-y-1">
                              <p className="text-xs text-muted-foreground mb-2">{t("complicationSelectPrompt")}</p>
                              <div className="space-y-2">
                                {LCP_COMPLICATIONS.map(c => {
                                  const isChecked = followupData.complicacoes.includes(c.code);
                                  return (
                                    <label key={c.code} className={`flex items-start gap-2.5 p-2 rounded cursor-pointer transition-colors ${isChecked ? "bg-red-100 border border-red-300" : "hover:bg-red-50/50 border border-transparent"}`}>
                                      <input
                                        type="checkbox"
                                        className="mt-0.5 accent-red-600"
                                        checked={isChecked}
                                        onChange={e => {
                                          setFollowupData(prev => ({
                                            ...prev,
                                            complicacoes: e.target.checked
                                              ? [...prev.complicacoes, c.code]
                                              : prev.complicacoes.filter(x => x !== c.code)
                                          }));
                                        }}
                                      />
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <span className="text-xs font-medium">{c.nome}</span>
                                          <span className="text-xs text-muted-foreground bg-muted px-1 py-0.5 rounded">{c.momento}</span>
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-0.5">{c.sinais}</p>
                                      </div>
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {isLcaSurgery && (
                        <div className="border-t pt-5 space-y-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{tc("aclAssessment")}</span>
                            <div className="flex-1 h-px bg-border" />
                          </div>
                          <p className="text-xs text-muted-foreground -mt-1">{tc("assessmentDescription")}</p>

                          {/* ADM */}
                          <div className="border rounded-lg border-blue-200 bg-blue-50/30">
                            <div className="px-3 py-2 border-b border-blue-200">
                              <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">{tc("rangeOfMotion")}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-3 p-3">
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">{tc("flexion")} <span className="opacity-50">{tc("degrees")}</span></Label>
                                <Input
                                  type="number" min={0} max={160} step={5}
                                  value={followupData.admFlexao}
                                  onChange={e => setFollowupData(prev => ({ ...prev, admFlexao: e.target.value }))}
                                  placeholder={tc("example130")}
                                  className="h-8"
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">{tc("extension")} <span className="opacity-50">{tc("extensionDegrees")}</span></Label>
                                <Input
                                  type="number" min={-10} max={30} step={1}
                                  value={followupData.admExtensao}
                                  onChange={e => setFollowupData(prev => ({ ...prev, admExtensao: e.target.value }))}
                                  placeholder={tc("example0")}
                                  className="h-8"
                                />
                              </div>
                            </div>
                          </div>

                          {/* Complicações LCA */}
                          <div className="border rounded-lg border-red-200 bg-red-50/20">
                            <div className="px-3 py-2 border-b border-red-200 flex items-center justify-between">
                              <span className="text-xs font-semibold text-red-700 uppercase tracking-wide">{t("complicationMonitoring")}</span>
                              {followupData.complicacoes.length > 0 && (
                                <span className="text-xs font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full">
                                  {tc(followupData.complicacoes.length === 1 ? "complicationRegistered" : "complicationsRegistered", { count: followupData.complicacoes.length })}
                                </span>
                              )}
                            </div>
                            <div className="p-3 space-y-1">
                              <p className="text-xs text-muted-foreground mb-2">{t("complicationSelectPrompt")}</p>
                              <div className="space-y-2">
                                {LCA_COMPLICATIONS.map(c => {
                                  const isChecked = followupData.complicacoes.includes(c.code);
                                  return (
                                    <label key={c.code} className={`flex items-start gap-2.5 p-2 rounded cursor-pointer transition-colors ${isChecked ? "bg-red-100 border border-red-300" : "hover:bg-red-50/50 border border-transparent"}`}>
                                      <input
                                        type="checkbox"
                                        className="mt-0.5 accent-red-600"
                                        checked={isChecked}
                                        onChange={e => {
                                          setFollowupData(prev => ({
                                            ...prev,
                                            complicacoes: e.target.checked
                                              ? [...prev.complicacoes, c.code]
                                              : prev.complicacoes.filter(x => x !== c.code)
                                          }));
                                        }}
                                      />
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <span className="text-xs font-medium">{c.nome}</span>
                                          <span className="text-xs text-muted-foreground bg-muted px-1 py-0.5 rounded">{c.momento}</span>
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-0.5">{c.sinais}</p>
                                      </div>
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {isOsteocondralSurgery && (
                        <div className="border-t pt-5 space-y-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{tc("osteochondralAssessment")}</span>
                            <div className="flex-1 h-px bg-border" />
                          </div>
                          <p className="text-xs text-muted-foreground -mt-1">{tc("assessmentDescription")}</p>

                          {/* ADM */}
                          <div className="border rounded-lg border-blue-200 bg-blue-50/30">
                            <div className="px-3 py-2 border-b border-blue-200">
                              <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">{tc("rangeOfMotion")}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-3 p-3">
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">{tc("flexion")} <span className="opacity-50">{tc("degrees")}</span></Label>
                                <Input
                                  type="number" min={0} max={160} step={5}
                                  value={followupData.admFlexao}
                                  onChange={e => setFollowupData(prev => ({ ...prev, admFlexao: e.target.value }))}
                                  placeholder={tc("example120")}
                                  className="h-8"
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">{tc("extension")} <span className="opacity-50">{tc("extensionDegrees")}</span></Label>
                                <Input
                                  type="number" min={-10} max={30} step={1}
                                  value={followupData.admExtensao}
                                  onChange={e => setFollowupData(prev => ({ ...prev, admExtensao: e.target.value }))}
                                  placeholder={tc("example0")}
                                  className="h-8"
                                />
                              </div>
                            </div>
                          </div>

                          {/* Complicações Osteocondral */}
                          <div className="border rounded-lg border-red-200 bg-red-50/20">
                            <div className="px-3 py-2 border-b border-red-200 flex items-center justify-between">
                              <span className="text-xs font-semibold text-red-700 uppercase tracking-wide">{t("complicationMonitoring")}</span>
                              {followupData.complicacoes.length > 0 && (
                                <span className="text-xs font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full">
                                  {tc(followupData.complicacoes.length === 1 ? "complicationRegistered" : "complicationsRegistered", { count: followupData.complicacoes.length })}
                                </span>
                              )}
                            </div>
                            <div className="p-3 space-y-1">
                              <p className="text-xs text-muted-foreground mb-2">{t("complicationSelectPrompt")}</p>
                              <div className="space-y-2">
                                {OSTEOCONDRAL_COMPLICATIONS.map(c => {
                                  const isChecked = followupData.complicacoes.includes(c.code);
                                  return (
                                    <label key={c.code} className={`flex items-start gap-2.5 p-2 rounded cursor-pointer transition-colors ${isChecked ? "bg-red-100 border border-red-300" : "hover:bg-red-50/50 border border-transparent"}`}>
                                      <input
                                        type="checkbox"
                                        className="mt-0.5 accent-red-600"
                                        checked={isChecked}
                                        onChange={e => {
                                          setFollowupData(prev => ({
                                            ...prev,
                                            complicacoes: e.target.checked
                                              ? [...prev.complicacoes, c.code]
                                              : prev.complicacoes.filter(x => x !== c.code)
                                          }));
                                        }}
                                      />
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <span className="text-xs font-medium">{c.nome}</span>
                                          <span className="text-xs text-muted-foreground bg-muted px-1 py-0.5 rounded">{c.momento}</span>
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-0.5">{c.sinais}</p>
                                      </div>
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {isArtroplastiaSurgery && (
                        <div className="border-t pt-5 space-y-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{tc("arthroplastyAssessment")}</span>
                            <div className="flex-1 h-px bg-border" />
                          </div>
                          <p className="text-xs text-muted-foreground -mt-1">{tc("assessmentDescription")}</p>

                          {/* ADM */}
                          <div className="border rounded-lg border-blue-200 bg-blue-50/30">
                            <div className="px-3 py-2 border-b border-blue-200">
                              <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">{tc("rangeOfMotion")}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-3 p-3">
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">{tc("flexion")} <span className="opacity-50">{tc("degrees")}</span></Label>
                                <Input
                                  type="number" min={0} max={160} step={5}
                                  value={followupData.admFlexao}
                                  onChange={e => setFollowupData(prev => ({ ...prev, admFlexao: e.target.value }))}
                                  placeholder={tc("example110")}
                                  className="h-8"
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">{tc("extension")} <span className="opacity-50">{tc("extensionDegrees")}</span></Label>
                                <Input
                                  type="number" min={-10} max={30} step={1}
                                  value={followupData.admExtensao}
                                  onChange={e => setFollowupData(prev => ({ ...prev, admExtensao: e.target.value }))}
                                  placeholder={tc("example0")}
                                  className="h-8"
                                />
                              </div>
                            </div>
                          </div>

                          {/* Complicações */}
                          <div className="border rounded-lg border-red-200 bg-red-50/20">
                            <div className="px-3 py-2 border-b border-red-200 flex items-center justify-between">
                              <span className="text-xs font-semibold text-red-700 uppercase tracking-wide">{t("complicationMonitoring")}</span>
                              {followupData.complicacoes.length > 0 && (
                                <span className="text-xs font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full">
                                  {tc(followupData.complicacoes.length === 1 ? "complicationRegistered" : "complicationsRegistered", { count: followupData.complicacoes.length })}
                                </span>
                              )}
                            </div>
                            <div className="p-3 space-y-1">
                              <p className="text-xs text-muted-foreground mb-2">{t("complicationSelectPrompt")}</p>
                              <div className="space-y-2">
                                {ARTHROPLASTY_COMPLICATIONS.map(c => {
                                  const isChecked = followupData.complicacoes.includes(c.code);
                                  return (
                                    <label key={c.code} className={`flex items-start gap-2.5 p-2 rounded cursor-pointer transition-colors ${isChecked ? "bg-red-100 border border-red-300" : "hover:bg-red-50/50 border border-transparent"}`}>
                                      <input
                                        type="checkbox"
                                        className="mt-0.5 accent-red-600"
                                        checked={isChecked}
                                        onChange={e => {
                                          setFollowupData(prev => ({
                                            ...prev,
                                            complicacoes: e.target.checked
                                              ? [...prev.complicacoes, c.code]
                                              : prev.complicacoes.filter(x => x !== c.code)
                                          }));
                                        }}
                                      />
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <span className="text-xs font-medium">{c.nome}</span>
                                          <span className="text-xs text-muted-foreground bg-muted px-1 py-0.5 rounded">{c.momento}</span>
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-0.5">{c.sinais}</p>
                                      </div>
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="grid sm:grid-cols-2 gap-6 pt-4 border-t">
                        <div className="space-y-4">
                          <div className="flex items-center space-x-2">
                            <Switch checked={followupData.retornoEsporte} onCheckedChange={c => setFollowupData({...followupData, retornoEsporte: c})} />
                            <Label>{tc("returnedToSport")}</Label>
                          </div>
                          {followupData.retornoEsporte && (
                            <div className="space-y-2">
                              <Label>{tc("returnLevel")}</Label>
                              <Input placeholder={tc("returnLevelPlaceholder")} value={followupData.nivelRetorno} onChange={e => setFollowupData({...followupData, nivelRetorno: e.target.value})} />
                            </div>
                          )}
                        </div>

                        {surgery?.tiposProcedimento?.includes("Lesão Ligamentar") && (
                          <div className="space-y-4">
                            <div className="flex items-center space-x-2">
                              <Switch checked={followupData.falha} onCheckedChange={c => setFollowupData({...followupData, falha: c})} />
                              <Label className="text-destructive">{tc("failureOrRerupture")}</Label>
                            </div>
                            {followupData.falha && (
                              <div className="space-y-2">
                                <Label>{tc("failureType")}</Label>
                                <Input placeholder={tc("failureTypePlaceholder")} value={followupData.falhaType} onChange={e => setFollowupData({...followupData, falhaType: e.target.value})} />
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label>{tc("observations")}</Label>
                        <Textarea 
                          placeholder={tc("observationsPlaceholder")}
                          value={followupData.observacoes} 
                          onChange={e => setFollowupData({...followupData, observacoes: e.target.value})} 
                        />
                      </div>

                      <div className="flex justify-end pt-4 border-t">
                        <Button type="submit" disabled={createFollowupMutation.isPending} className="gap-2">
                          <Save className="h-4 w-4" />
                          {tc("saveFollowup")}
                        </Button>
                      </div>
                    </form>
                  </DialogContent>
                </Dialog>
                </div>{/* end flex gap-2 */}

                {/* Scale questionnaire dialogs for doctor */}
                {[
                  "IKDC", "Lysholm", "Tegner", "VAS Dor",
                  "Kujala", "ACL-RSI", "Marx", "WOMAC",
                  "KOOS-12",
                ].map(scaleId => (
                  <ScaleQuestionnaireDialog
                    key={scaleId}
                    scaleId={scaleId}
                    open={scaleDialogOpen === scaleId}
                    onClose={() => setScaleDialogOpen(null)}
                    onConfirm={(score) => {
                      const fieldMap: Record<string, string> = {
                        "IKDC": "ikdc",
                        "Lysholm": "lysholm",
                        "Tegner": "tegner",
                        "VAS Dor": "vasDor",
                        "Kujala": "kujala",
                        "ACL-RSI": "aclRsi",
                        "Marx": "marx",
                        "WOMAC": "womac",
                        "KOOS-12": "koos12",
                      };
                      const field = fieldMap[scaleId];
                      if (field) setFollowupData(prev => ({ ...prev, [field]: String(score) }));
                    }}
                  />
                ))}
              </div>

              {surgery.followups && surgery.followups.length > 0 ? (
                <div className="space-y-4 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-border before:to-transparent">
                  {surgery.followups.map((f, i) => (
                    <div key={f.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active mt-4 first:mt-0">
                      <div className="flex items-center justify-center w-10 h-10 rounded-full border-2 border-background bg-primary text-primary-foreground shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10">
                        {i + 1}
                      </div>
                      <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded-lg border border-border bg-card shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex justify-between mb-3 border-b pb-2">
                          <span className="font-bold text-primary">{f.tempo}</span>
                          <span className="text-xs text-muted-foreground">{f.dataAvaliacao ? formatDate(f.dataAvaliacao, { day: "2-digit", month: "2-digit", year: "numeric" }) : ''}</span>
                        </div>

                        {/* Scale scores */}
                        {(f.ikdc != null || f.lysholm != null || f.tegner != null || f.vasDor != null || f.kujala != null || (f as any).aclRsi != null || (f as any).marx != null) && (
                          <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                            {f.ikdc != null && <div><span className="text-muted-foreground">IKDC:</span> <span className="font-medium">{f.ikdc}</span></div>}
                            {f.lysholm != null && <div><span className="text-muted-foreground">Lysholm:</span> <span className="font-medium">{f.lysholm}</span></div>}
                            {f.tegner != null && <div><span className="text-muted-foreground">Tegner:</span> <span className="font-medium">{f.tegner}</span></div>}
                            {f.vasDor != null && <div><span className="text-muted-foreground">{ta("painVas")}:</span> <span className="font-medium">{f.vasDor}</span></div>}
                            {f.kujala != null && <div><span className="text-muted-foreground">Kujala:</span> <span className="font-medium">{f.kujala}</span></div>}
                            {(f as any).aclRsi != null && <div><span className="text-muted-foreground">ACL-RSI:</span> <span className="font-medium">{(f as any).aclRsi}</span></div>}
                            {(f as any).marx != null && <div><span className="text-muted-foreground">Marx:</span> <span className="font-medium">{(f as any).marx}/16</span></div>}
                          </div>
                        )}

                        {/* Complicações categorizadas — fraturas */}
                        {isFractureSurgery && (() => {
                          const categorized = categorizeFollowupComplications((f as any).complicacoes as string[] | null);
                          const groups = [
                            { label: ta("acuteComplications"), items: categorized.agudas, className: "bg-amber-50 border-amber-200 text-amber-900" },
                            { label: ta("lateComplications"), items: categorized.tardias, className: "bg-red-50 border-red-200 text-red-900" },
                            { label: ta("uncategorizedComplications"), items: categorized.gerais, className: "bg-slate-50 border-slate-200 text-slate-800" },
                          ].filter((group) => group.items.length > 0);
                          if (groups.length === 0) return null;
                          return (
                            <div className="mb-2 space-y-2">
                              {groups.map((group) => (
                                <div key={group.label} className={`px-2 py-1.5 rounded border ${group.className}`}>
                                  <p className="text-xs font-semibold mb-1">{group.label}:</p>
                                  <div className="flex flex-wrap gap-1">
                                    {group.items.map((item, index) => (
                                      <span key={`${item}-${index}`} className="text-xs bg-white/70 border border-current/20 px-1.5 py-0.5 rounded">
                                        {item}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          );
                        })()}

                        {/* ADM e Complicações — artroplastia */}
                        {isArtroplastiaSurgery && ((f as any).admFlexao != null || (f as any).admExtensao != null) && (
                          <div className="flex items-center gap-2 mb-2 px-2 py-1.5 rounded bg-blue-50 border border-blue-100">
                            <span className="text-xs font-semibold text-blue-700">ADM:</span>
                            {(f as any).admFlexao != null && <span className="text-xs text-blue-800">{ta("flexion")} <strong>{(f as any).admFlexao}°</strong></span>}
                            {(f as any).admExtensao != null && <span className="text-xs text-blue-800">· {ta("extension")} <strong>{(f as any).admExtensao}°</strong></span>}
                          </div>
                        )}
                        {!isFractureSurgery && isArtroplastiaSurgery && (f as any).complicacoes?.length > 0 && (
                          <div className="mb-2 px-2 py-1.5 rounded bg-red-50 border border-red-200">
                            <p className="text-xs font-semibold text-red-700 mb-1">⚠ {ta("complications")}:</p>
                            <div className="flex flex-wrap gap-1">
                              {((f as any).complicacoes as string[]).map((code: string) => {
                                const comp = ARTHROPLASTY_COMPLICATIONS.find(c => c.code === code);
                                return (
                                  <span key={code} className="text-xs bg-red-100 border border-red-300 text-red-800 px-1.5 py-0.5 rounded" title={comp?.sinais}>
                                    {comp?.nome ?? code}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        {!isFractureSurgery && isLcmSurgery && (f as any).complicacoes?.length > 0 && (
                          <div className="mb-2 px-2 py-1.5 rounded bg-red-50 border border-red-200">
                            <p className="text-xs font-semibold text-red-700 mb-1">⚠ {ta("complications")}:</p>
                            <div className="flex flex-wrap gap-1">
                              {((f as any).complicacoes as string[]).map((code: string) => {
                                const comp = LCM_COMPLICATIONS.find(c => c.code === code);
                                return (
                                  <span key={code} className="text-xs bg-red-100 border border-red-300 text-red-800 px-1.5 py-0.5 rounded" title={comp?.sinais ?? code}>
                                    {comp?.nome ?? code}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        {!isFractureSurgery && isCplSurgery && (f as any).complicacoes?.length > 0 && (
                          <div className="mb-2 px-2 py-1.5 rounded bg-red-50 border border-red-200">
                            <p className="text-xs font-semibold text-red-700 mb-1">⚠ {ta("complications")}:</p>
                            <div className="flex flex-wrap gap-1">
                              {((f as any).complicacoes as string[]).map((code: string) => {
                                const comp = CPL_COMPLICATIONS.find(c => c.code === code);
                                return (
                                  <span key={code} className="text-xs bg-red-100 border border-red-300 text-red-800 px-1.5 py-0.5 rounded" title={comp?.sinais ?? code}>
                                    {comp?.nome ?? code}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        {!isFractureSurgery && isSuturaMeniscalSurgery && (f as any).complicacoes?.length > 0 && (
                          <div className="mb-2 px-2 py-1.5 rounded bg-red-50 border border-red-200">
                            <p className="text-xs font-semibold text-red-700 mb-1">⚠ {ta("complications")}:</p>
                            <div className="flex flex-wrap gap-1">
                              {((f as any).complicacoes as string[]).map((code: string) => {
                                const comp = SUTURA_MENISCAL_COMPLICATIONS.find(c => c.code === code);
                                return (
                                  <span key={code} className="text-xs bg-red-100 border border-red-300 text-red-800 px-1.5 py-0.5 rounded" title={comp?.sinais ?? code}>
                                    {comp?.nome ?? code}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        {!isFractureSurgery && isLcpSurgery && (f as any).complicacoes?.length > 0 && (
                          <div className="mb-2 px-2 py-1.5 rounded bg-red-50 border border-red-200">
                            <p className="text-xs font-semibold text-red-700 mb-1">⚠ {ta("complications")}:</p>
                            <div className="flex flex-wrap gap-1">
                              {((f as any).complicacoes as string[]).map((code: string) => {
                                const comp = LCP_COMPLICATIONS.find(c => c.code === code);
                                return (
                                  <span key={code} className="text-xs bg-red-100 border border-red-300 text-red-800 px-1.5 py-0.5 rounded" title={comp?.sinais ?? code}>
                                    {comp?.nome ?? code}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        {!isFractureSurgery && isLcaSurgery && (f as any).complicacoes?.length > 0 && (
                          <div className="mb-2 px-2 py-1.5 rounded bg-red-50 border border-red-200">
                            <p className="text-xs font-semibold text-red-700 mb-1">⚠ {ta("complications")}:</p>
                            <div className="flex flex-wrap gap-1">
                              {((f as any).complicacoes as string[]).map((code: string) => {
                                const comp = LCA_COMPLICATIONS.find(c => c.code === code);
                                return (
                                  <span key={code} className="text-xs bg-red-100 border border-red-300 text-red-800 px-1.5 py-0.5 rounded" title={comp?.sinais ?? code}>
                                    {comp?.nome ?? code}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        {(isFractureSurgery || isPatelarSurgery || isOsteocondralSurgery || isLcaSurgery || isLcpSurgery || isSuturaMeniscalSurgery || isCplSurgery || isLcmSurgery) && ((f as any).admFlexao != null || (f as any).admExtensao != null) && (
                          <div className="flex items-center gap-2 mb-2 px-2 py-1.5 rounded bg-blue-50 border border-blue-100">
                            <span className="text-xs font-semibold text-blue-700">ADM:</span>
                            {(f as any).admFlexao != null && <span className="text-xs text-blue-800">{ta("flexion")} <strong>{(f as any).admFlexao}°</strong></span>}
                            {(f as any).admExtensao != null && <span className="text-xs text-blue-800">· {ta("extension")} <strong>{(f as any).admExtensao}°</strong></span>}
                          </div>
                        )}
                        {!isFractureSurgery && isOsteocondralSurgery && (f as any).complicacoes?.length > 0 && (
                          <div className="mb-2 px-2 py-1.5 rounded bg-red-50 border border-red-200">
                            <p className="text-xs font-semibold text-red-700 mb-1">⚠ {ta("complications")}:</p>
                            <div className="flex flex-wrap gap-1">
                              {((f as any).complicacoes as string[]).map((code: string) => {
                                const comp = OSTEOCONDRAL_COMPLICATIONS.find(c => c.code === code);
                                return (
                                  <span key={code} className="text-xs bg-red-100 border border-red-300 text-red-800 px-1.5 py-0.5 rounded" title={comp?.sinais ?? code}>
                                    {comp?.nome ?? code}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        {!isFractureSurgery && isPatelarSurgery && (f as any).complicacoes?.length > 0 && (
                          <div className="mb-2 px-2 py-1.5 rounded bg-red-50 border border-red-200">
                            <p className="text-xs font-semibold text-red-700 mb-1">⚠ {ta("complications")}:</p>
                            <div className="flex flex-wrap gap-1">
                              {((f as any).complicacoes as string[]).map((code: string) => {
                                const comp = PATELAR_COMPLICATIONS.find(c => c.code === code);
                                return (
                                  <span key={code} className="text-xs bg-red-100 border border-red-300 text-red-800 px-1.5 py-0.5 rounded" title={comp?.sinais ?? code}>
                                    {comp?.nome ?? code}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Escalas enviadas ao paciente */}
                        {(f as any).escalasEnviadas?.length > 0 && (
                          <div className="mb-3 p-2 rounded-lg bg-muted/30 border border-border space-y-2">
                            <p className="text-xs font-semibold text-muted-foreground">{ta("patientScales")}</p>
                            <div className="flex flex-wrap gap-1">
                              {((f as any).escalasEnviadas as string[]).map((escala) => {
                                const scoreField = SCALE_SCORE_FIELDS[escala];
                                const filled = scoreField ? (f as any)[scoreField] != null : false;
                                return (
                                  <span
                                    key={escala}
                                    className={`text-xs px-2 py-0.5 rounded-full flex items-center gap-1 ${filled ? "bg-green-50 border border-green-200 text-green-700" : "bg-amber-50 border border-amber-200 text-amber-700"}`}
                                  >
                                    {filled ? <CheckCircle2 className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                                    {escala}
                                  </span>
                                );
                              })}
                            </div>
                            {(f as any).token && (
                              <div className="flex gap-1.5">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="flex-1 h-7 text-xs gap-1"
                                  onClick={async () => {
                                    try {
                                      const r = await fetch(`/api/followup/${f.id}/prepare-whatsapp`, {
                                        method: "POST",
                                        credentials: "same-origin",
                                        headers: { "Content-Type": "application/json" },
                                      });
                                      const d = await r.json();
                                      const fallbackToken = (f as any).token;
                                      const linkToCopy = d.link ?? (fallbackToken ? `${window.location.origin}${import.meta.env.BASE_URL}patient/${fallbackToken}`.replace(/([^:])\/\//g, "$1/") : null);
                                      if (linkToCopy) {
                                        copyLink(linkToCopy);
                                      } else {
                                        toast({ title: t("linkGenerationUnavailable"), description: t("tryAgainShortly"), variant: "destructive" });
                                      }
                                    } catch {
                                      toast({ title: t("linkGenerationError"), description: t("checkConnection"), variant: "destructive" });
                                    }
                                  }}
                                >
                                  <Copy className="h-3 w-3" /> {ta("copyLink")}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="flex-1 h-7 text-xs gap-1 border-green-300 text-green-700 hover:bg-green-50"
                                  disabled={waPreparing === f.id}
                                  onClick={() => handlePrepareFollowupWhatsApp(f.id)}
                                >
                                  {waPreparing === f.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "📱"}
                                  WhatsApp
                                </Button>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Send scales button — always shown */}
                        {(() => {
                          const already = !!(f as any).escalasEnviadas?.length;
                          const getProtocolScales = (tempo: string): string[] => {
                            if (isLcpSurgery) {
                              if (tempo.toLowerCase().includes("pré") || tempo.toLowerCase().includes("pre")) return ["IKDC", "Lysholm", "Tegner"];
                              if (tempo.includes("1 mês") || tempo.includes("30 dias")) return ["VAS Dor", "Lysholm"];
                              if (tempo.includes("3 meses") || tempo.includes("90 dias")) return ["VAS Dor", "Lysholm", "IKDC"];
                              if (tempo.includes("6 meses") || tempo.includes("180 dias")) return ["VAS Dor", "Lysholm", "IKDC", "Tegner"];
                              if (tempo.includes("1 ano") || tempo.includes("12")) return ["Lysholm", "IKDC", "Tegner", "VAS Dor"];
                              if (tempo.includes("2 anos") || tempo.includes("24")) return ["Lysholm", "IKDC", "Tegner", "VAS Dor"];
                              if (tempo.includes("5 anos") || tempo.includes("60")) return ["Lysholm", "IKDC", "Tegner", "VAS Dor"];
                              return ["VAS Dor", "Lysholm", "IKDC"];
                            }
                            if (tempo.includes("pré") || tempo.includes("pre")) return ["IKDC", "VAS Dor"];
                            if (tempo.includes("3 meses")) return ["VAS Dor", "Lysholm"];
                            if (tempo.includes("6 meses")) return ["VAS Dor", "IKDC", "Lysholm"];
                            if (tempo.includes("1 ano") || tempo.includes("12")) return ["IKDC", "Lysholm", "VAS Dor", "ACL-RSI"];
                            if (tempo.includes("2 anos") || tempo.includes("24")) return ["IKDC", "Lysholm", "VAS Dor", "ACL-RSI", "Marx"];
                            if (tempo.includes("5 anos") || tempo.includes("60")) return ["IKDC", "Lysholm", "VAS Dor", "ACL-RSI", "Marx"];
                            return ["VAS Dor", "Lysholm"];
                          };
                          return (
                            <div className={`mb-3 ${already ? "" : ""}`}>
                              <Button
                                size="sm"
                                variant={already ? "ghost" : "outline"}
                                className={`w-full h-8 text-xs gap-1 ${already ? "text-muted-foreground" : "border-dashed"}`}
                                onClick={() => {
                                  setSendScalesFollowupId(f.id);
                                  setPatientLink(null);
                                  setSelectedScales(getProtocolScales(f.tempo));
                                  setSendScalesOpen(true);
                                }}
                              >
                                <Send className="h-3 w-3" />
                                 {already ? ta("resendPatientLink") : ta("sendScalesToPatient")}
                              </Button>
                            </div>
                          );
                        })()}

                        {f.retornoEsporte && (
                          <div className="mt-3 pt-2 border-t text-sm font-medium text-emerald-600 bg-emerald-50/50 p-2 rounded">
                            {ta("returnToSport")}: {f.nivelRetorno || ta("yes")}
                          </div>
                        )}
                        {f.falha && (
                          <div className="mt-3 pt-2 border-t text-sm font-medium text-destructive bg-destructive/10 p-2 rounded">
                            {ta("failureRerupture")}: {f.falhaType || ta("yes")}
                          </div>
                        )}
                        {f.observacoes && (
                          <div className="mt-3 pt-2 border-t text-sm text-muted-foreground">
                            <p className="line-clamp-2" title={f.observacoes}>{f.observacoes}</p>
                          </div>
                        )}

                        {/* ADM / Complications button */}
                        <div className="mt-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className={`w-full h-8 text-xs gap-1.5 ${(f as any).admFlexao != null || (f as any).admExtensao != null || (f as any).complicacoes?.length ? "border-blue-300 text-blue-700 hover:bg-blue-50" : "border-dashed"}`}
                            onClick={() => {
                              const categorized = categorizeFollowupComplications((f as any).complicacoes as string[] | null);
                              setAdmDialog({
                                followupId: f.id,
                                flexao: (f as any).admFlexao != null ? String((f as any).admFlexao) : "",
                                extensao: (f as any).admExtensao != null ? String((f as any).admExtensao) : "",
                                complicacoes: isFractureSurgery
                                  ? categorized.gerais.join("\n")
                                  : ((f as any).complicacoes as string[] | null)?.join("\n") ?? "",
                                complicacoesAgudas: categorized.agudas.join("\n"),
                                complicacoesTardias: categorized.tardias.join("\n"),
                                obs: (f as any).observacoes ?? "",
                              });
                            }}
                          >
                            <Activity className="h-3 w-3" />
                            {(f as any).admFlexao != null || (f as any).admExtensao != null || (f as any).complicacoes?.length
                              ? t("editMotionComplications")
                              : t("registerMotionComplications")}
                          </Button>
                        </div>

                        {/* Report button */}
                        <div className="mt-2 pt-2 border-t">
                          <Button
                            size="sm"
                            variant="default"
                            className="w-full h-8 text-xs gap-1.5"
                            onClick={() => setReportFollowupId(f.id)}
                          >
                            <Activity className="h-3 w-3" /> {ta("viewClinicalReport")}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Card className="bg-muted/20 border-dashed">
                  <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                    <Activity className="h-8 w-8 text-muted-foreground mb-4 opacity-20" />
                    <p className="text-muted-foreground font-medium">{t("noFollowups")}</p>
                    <p className="text-sm text-muted-foreground mt-1 mb-4">{t("followupStatisticsHint")}</p>
                  </CardContent>
                </Card>
              )}
          </div>
        </div>
      </div>
    </div>
    </div>

    {/* Follow-up Clinical Report */}
    {reportFollowupId != null && surgery?.followups && (() => {
      const allFu = surgery.followups as FollowupReportFollowup[];
      const idx = allFu.findIndex(f => f.id === reportFollowupId);
      const fu = allFu[idx];
      const prev = idx > 0 ? allFu[idx - 1] : null;
      if (!fu) return null;
      return (
        <FollowupReport
          open={true}
          onClose={() => setReportFollowupId(null)}
          followup={fu}
          previousFollowup={prev}
          allFollowups={allFu}
          surgeryContext={{
            patientNome: surgery.patient?.nome ?? null,
            dataCirurgia: surgery.dataCirurgia ?? null,
            ligamentosAcometidos: surgery.ligamentosAcometidos ?? [],
            enxerto: surgery.enxerto ?? null,
          }}
        />
      );
    })()}

    {/* Full Clinical Report — all evaluations */}
    {fullReportOpen && surgery?.followups && (
      <FollowupFullReport
        open={fullReportOpen}
        onClose={() => setFullReportOpen(false)}
        followups={surgery.followups as FollowupReportFollowup[]}
        surgeryContext={{
          patientNome: surgery.patient?.nome ?? null,
          dataCirurgia: surgery.dataCirurgia ?? null,
          ligamentosAcometidos: surgery.ligamentosAcometidos ?? [],
          enxerto: surgery.enxerto ?? null,
          tiposProcedimento: surgery.tiposProcedimento ?? [],
          lado: (surgery as any).lado ?? null,
          alinhamento: surgery.alinhamento ?? null,
          procedimentosDetalhados: (surgery as any).procedimentosDetalhados ?? null,
        }}
      />
    )}

    {/* Send Scales to Patient Dialog */}
    <Dialog open={sendScalesOpen} onOpenChange={(o) => { setSendScalesOpen(o); if (!o) { setPatientLink(null); setPreviewOpen(false); } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("sendScales")}</DialogTitle>
          <DialogDescription>
            {ta("sendScalesDescription")}
          </DialogDescription>
        </DialogHeader>
        {!patientLink ? (
          <div className="space-y-4 pt-2">
            <div className="space-y-3">
              <div>
                <Label className="text-sm font-medium">
                  {ta("suggestedProtocolByPeriod")}
                  {isLcmSurgery && <span className="ml-2 text-xs font-normal text-purple-600 bg-purple-50 border border-purple-200 px-1.5 py-0.5 rounded">{ta("protocolMcl")}</span>}
                  {isCplSurgery && <span className="ml-2 text-xs font-normal text-orange-600 bg-orange-50 border border-orange-200 px-1.5 py-0.5 rounded">{ta("protocolPlc")}</span>}
                  {isLcpSurgery && <span className="ml-2 text-xs font-normal text-blue-600 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded">{ta("protocolPcl")}</span>}
                  {isPatelarSurgery && <span className="ml-2 text-xs font-normal text-pink-600 bg-pink-50 border border-pink-200 px-1.5 py-0.5 rounded">{ta("protocolPfi")}</span>}
                  {isOsteocondralSurgery && <span className="ml-2 text-xs font-normal text-teal-600 bg-teal-50 border border-teal-200 px-1.5 py-0.5 rounded">{ta("protocolOcl")}</span>}
                  {isOrtobiologicoSurgery && <span className="ml-2 text-xs font-normal text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">{ta("protocolObl")}</span>}
                  {isArtroplastiaSurgery && <span className="ml-2 text-xs font-normal text-indigo-600 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded">{ta("protocolTka")}</span>}
                </Label>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {Object.entries(PROTOCOL_SUGGESTIONS).map(([key, proto]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSelectedScales(proto.scales)}
                      className={`text-xs px-2.5 py-1 rounded-md border transition-all ${key === "6m" ? "bg-amber-50 border-amber-300 hover:bg-amber-100 text-amber-700" : key === "pre-op" ? "bg-slate-100 border-slate-300 hover:bg-slate-200 text-slate-700" : "bg-muted hover:bg-primary/10 hover:text-primary border-border"}`}
                    >
                      <div>{proto.label}</div>
                      {proto.note && <div className="text-[10px] opacity-60">{proto.note}</div>}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-1">{t("selectPeriodHint")}</p>
              </div>
              <div>
                <Label className="text-sm font-medium">{t("scalesToSend")}</Label>
                <div className="flex flex-wrap gap-2 mt-1.5">
                  {ALL_SCALES.map((s) => {
                    const sel = selectedScales.includes(s);
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() =>
                          setSelectedScales(prev =>
                            sel ? prev.filter(x => x !== s) : [...prev, s]
                          )
                        }
                        className={`text-sm px-3 py-1.5 rounded-lg border-2 transition-all ${sel ? "border-primary bg-primary/5 font-medium text-primary" : "border-border hover:border-primary/40"}`}
                      >
                        {sel && <CheckCircle2 className="inline h-3 w-3 mr-1" />}
                        {s}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">
                  {isLcmSurgery ? ta("mclMinimum")
                    : isCplSurgery ? ta("plcMinimum")
                    : isLcpSurgery ? ta("pclMinimum")
                    : ta("aclPublicationMinimum")}
                </p>
              </div>
            </div>
            {/* Questionnaire Preview */}
            {selectedScales.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setPreviewOpen(o => !o)}
                  className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 font-medium transition-colors"
                >
                  <Eye className="h-3.5 w-3.5" />
                  {previewOpen ? t("closePreview") : t("showPreview")}
                  {previewOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </button>

                {previewOpen && (
                  <div className="mt-3 max-h-80 overflow-y-auto border border-border rounded-lg divide-y divide-border">
                    {selectedScales.map(scaleName => {
                      const def = SCALE_PREVIEWS[scaleName];
                      if (!def) return null;
                      return (
                        <div key={scaleName} className="p-3">
                          <div className="font-semibold text-sm text-foreground mb-0.5">{def.title}</div>
                          <div className="text-xs text-muted-foreground mb-2 italic">{def.description}</div>
                          <div className="space-y-2">
                            {def.questions.map((q, qi) => (
                              <div key={qi} className="text-xs">
                                <div className="font-medium text-foreground/80 mb-1">{q.label}</div>
                                {q.type === "slider" ? (
                                  <div className="flex items-center gap-2 pl-2">
                                    <div className="h-1.5 flex-1 bg-muted rounded-full relative">
                                      <div className="absolute left-1/2 top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-muted-foreground/40 -translate-x-1/2" />
                                    </div>
                                    <span className="text-muted-foreground text-xs">0 — 10</span>
                                  </div>
                                ) : (
                                  <ul className="pl-2 space-y-0.5">
                                    {q.options?.map((opt, oi) => (
                                      <li key={oi} className="flex items-start gap-1.5 text-muted-foreground">
                                        <span className="mt-0.5 h-3 w-3 rounded-full border border-muted-foreground/40 shrink-0" />
                                        {typeof opt === "string" ? opt : opt.label}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setSendScalesOpen(false)}>{t("cancel")}</Button>
              <Button
                disabled={selectedScales.length === 0 || sendingScales}
                onClick={handleSendScales}
                className="gap-2"
              >
                <Send className="h-4 w-4" /> {ta("generateLink")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 pt-2">
            <div className="rounded-lg bg-green-50 border border-green-200 p-4 space-y-2">
              <div className="flex items-center gap-2 text-green-700 font-semibold text-sm">
                <CheckCircle2 className="h-4 w-4" /> {ta("linkGenerated")}
              </div>
              <p className="text-xs text-muted-foreground break-all">{patientLink}</p>
              <Button
                className="w-full h-8 gap-2 text-sm"
                onClick={() => copyLink(patientLink)}
              >
                <Copy className="h-3.5 w-3.5" /> {ta("copyLinkTitle")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground text-center">
              {ta("generatedLinkAdvisory")}
            </p>
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => setSendScalesOpen(false)}>{t("close")}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>

    {/* Surgery Full Summary */}
    <SurgeryFullSummary
      open={summaryOpen}
      onClose={() => setSummaryOpen(false)}
      surgery={surgery}
    />
    <SurgeryTextExportDialog
      open={textPreviewOpen}
      onClose={() => setTextPreviewOpen(false)}
      surgery={surgery}
    />

    {/* WhatsApp Message Editor Dialog */}
    <Dialog open={waDialogOpen} onOpenChange={setWaDialogOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>📱</span> {ta("whatsappMessage")}
          </DialogTitle>
          <DialogDescription>
            {ta("whatsappDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md bg-green-50 border border-green-200 px-3 py-2 text-xs text-green-800 flex items-start gap-2">
            <span className="mt-0.5">🔐</span>
            <span>{t("patientCpfHint")}</span>
          </div>
          {waLink && (
            <div className="rounded-md border bg-muted/30 px-3 py-2 space-y-1">
              <p className="text-xs font-medium text-muted-foreground">{t("patientLink")}</p>
              <p className="text-xs break-all font-mono text-foreground">{waLink}</p>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5 mt-1"
                onClick={() => copyLink(waLink)}
              >
                <Copy className="h-3 w-3" /> {t("copyLink")}
              </Button>
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t("message")}</Label>
            <Textarea
              value={waMessage}
              onChange={e => setWaMessage(e.target.value)}
              rows={10}
              className="text-sm font-mono resize-none"
            />
            <p className="text-xs text-muted-foreground">
              {t("editMessageHint")}
            </p>
          </div>

          {/* Abrir no meu WhatsApp — sempre disponível se o paciente tiver telefone */}
          {surgery?.patient?.telefone && (() => {
            const digits = surgery.patient.telefone.replace(/\D/g, "");
            const waPhone = digits.startsWith("55") ? digits : `55${digits}`;
            const waLink = `https://wa.me/${waPhone}?text=${encodeURIComponent(waMessage)}`;
            return (
              <div className="rounded-lg border border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-800 px-3 py-3 space-y-2">
                <p className="text-xs font-medium text-green-800 dark:text-green-300">{t("manualWhatsApp")}</p>
                <p className="text-xs text-green-700 dark:text-green-400">
                  {t("manualWhatsAppHint")}
                </p>
                <a
                  href={waLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold text-white bg-green-600 hover:bg-green-700 transition-colors"
                  onClick={() => {
                    if (waNotifId != null) {
                      void markNotifStatus(waNotifId, "sent");
                    }
                    setWaDialogOpen(false);
                  }}
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" xmlns="http://www.w3.org/2000/svg">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                  </svg>
                  {t("openMyWhatsApp")}
                </a>
              </div>
            );
          })()}
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={() => setWaDialogOpen(false)}>
            {ta("close")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    {/* ADM + Complications Dialog */}
    <Dialog open={!!admDialog} onOpenChange={(open) => { if (!open && !savingAdm) setAdmDialog(null); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("motionAndComplications")}</DialogTitle>
          <DialogDescription>
            {ta("admDescription")}
          </DialogDescription>
        </DialogHeader>
        {admDialog && (
          <div className="space-y-4">
            {/* ADM */}
            <div>
              <Label className="text-sm font-semibold">{t("rangeOfMotion")}</Label>
              <div className="flex gap-3 mt-2">
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground">{t("flexion")}</Label>
                  <Input
                    type="number"
                    min={0}
                    max={180}
                    placeholder="Ex: 120"
                    value={admDialog.flexao}
                    onChange={e => setAdmDialog(d => d ? { ...d, flexao: e.target.value } : d)}
                    className="mt-1 h-9"
                  />
                </div>
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground">{t("extension")}</Label>
                  <Input
                    type="number"
                    min={-30}
                    max={30}
                    placeholder="Ex: 0"
                    value={admDialog.extensao}
                    onChange={e => setAdmDialog(d => d ? { ...d, extensao: e.target.value } : d)}
                    className="mt-1 h-9"
                  />
                </div>
              </div>
            </div>

            {/* Complications */}
            {isFractureSurgery ? (
              <div className="space-y-3">
                <div>
                  <Label className="text-sm font-semibold text-amber-800">{t("acuteComplications")}</Label>
                  <p className="text-xs text-muted-foreground mt-0.5 mb-1.5">{t("onePerLine")}</p>
                  <Textarea
                    placeholder={t("exampleAcuteComplications")}
                    value={admDialog.complicacoesAgudas}
                    onChange={e => setAdmDialog(d => d ? { ...d, complicacoesAgudas: e.target.value } : d)}
                    rows={3}
                    className="text-sm resize-none"
                  />
                </div>
                <div>
                  <Label className="text-sm font-semibold text-red-700">{t("lateComplications")}</Label>
                  <p className="text-xs text-muted-foreground mt-0.5 mb-1.5">{t("onePerLine")}</p>
                  <Textarea
                    placeholder={t("exampleLateComplications")}
                    value={admDialog.complicacoesTardias}
                    onChange={e => setAdmDialog(d => d ? { ...d, complicacoesTardias: e.target.value } : d)}
                    rows={3}
                    className="text-sm resize-none"
                  />
                </div>
                {admDialog.complicacoes && (
                  <div>
                    <Label className="text-sm font-semibold">{t("previousUncategorized")}</Label>
                    <p className="text-xs text-muted-foreground mt-0.5 mb-1.5">
                      {t("previousUncategorizedHint")}
                    </p>
                    <Textarea
                      value={admDialog.complicacoes}
                      onChange={e => setAdmDialog(d => d ? { ...d, complicacoes: e.target.value } : d)}
                      rows={3}
                      className="text-sm resize-none"
                    />
                  </div>
                )}
              </div>
            ) : (
              <div>
                <Label className="text-sm font-semibold">{t("complications")}</Label>
                <p className="text-xs text-muted-foreground mt-0.5 mb-1.5">
                  {t("complicationPerLine")}
                </p>
                <Textarea
                  placeholder={t("exampleComplications")}
                  value={admDialog.complicacoes}
                  onChange={e => setAdmDialog(d => d ? { ...d, complicacoes: e.target.value } : d)}
                  rows={4}
                  className="text-sm resize-none"
                />
              </div>
            )}

            {/* Notes */}
            <div>
              <Label className="text-sm font-semibold">{t("physicianNotes")}</Label>
              <Textarea
                placeholder={t("physicianNotesPlaceholder")}
                value={admDialog.obs}
                onChange={e => setAdmDialog(d => d ? { ...d, obs: e.target.value } : d)}
                rows={3}
                className="text-sm resize-none mt-1.5"
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setAdmDialog(null)} disabled={savingAdm}>
                {t("cancel")}
              </Button>
              <Button onClick={handleSaveAdm} disabled={savingAdm} className="gap-2">
                {savingAdm ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {savingAdm ? t("saving") : t("save")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}
