import {
  getGetPatientQueryKey,
  getListPatientsQueryKey,
  useGetPatient,
  useDeletePatient,
  useUpdatePatient,
} from "@workspace/docregen-api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useParams, Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/lib/i18n";
import { useScopedTranslations } from "@/lib/i18n";
import { operationalCoreMessages } from "@/locales/operational-core";
import { operationalPatientRecordMessages } from "@/locales/operational-patient-record";
import { useAuth } from "@/lib/auth";
import { lgpdMessages } from "@/locales/lgpd";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { format, differenceInYears } from "date-fns";
import { formatCalendarDate, formatPersonName, parseCalendarDate } from "@/lib/utils";
import { regenConditionLabel } from "@/lib/regen-conditions";
import { es, ptBR } from "date-fns/locale";
import { useState, useEffect } from "react";
import { UserX, ArrowLeft, Trash2, Plus, Save, Pencil, ClipboardList, Phone, FileDown, Building2, Paperclip, Upload, FileText, FileImage, Film, File, X, Download, AlertCircle, ExternalLink } from "lucide-react";
import { generateProntuarioPDF } from "@/lib/prontuario-pdf";
import { sharePdfOrDownload, handlePdfOpenClick } from "@/lib/pdf-share";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PreConsultTab } from "@/components/patient/pre-consult-tab";
import { DateInput } from "@/components/ui/date-input";

const AVATAR_COLORS = [
  "linear-gradient(135deg,#0B1F4B,#0E9AA7)",
  "linear-gradient(135deg,#0B1F4B,#0E9AA7)",
  "linear-gradient(135deg,#0B1F4B,#0E9AA7)",
  "linear-gradient(135deg,#0B1F4B,#0E9AA7)",
  "linear-gradient(135deg,#0B1F4B,#0E9AA7)",
];

type DocTipo = "evolucao" | "receita" | "laudo" | "atestado";
type Aba = "visao-geral" | "pre-consulta" | "anamnese" | "evolucao" | "receitas" | "laudos" | "atestados" | "arquivos";

interface PatientAttachment {
  id: number;
  fileName: string;
  mimeType: string;
  objectPath: string;
  fileSize: number | null;
  category: string | null;
  descricao: string | null;
  createdAt: string;
  downloadUrl: string | null;
}

interface Documento {
  id: string;
  tipo: DocTipo;
  titulo: string;
  conteudo: string;
  data: string;
  cid?: string;
  tempoAfastamento?: string;
}

const ABAS: Aba[] = ["visao-geral", "pre-consulta", "anamnese", "evolucao", "receitas", "laudos", "atestados", "arquivos"];

const ABA_DOC_TIPO: Partial<Record<Aba, DocTipo>> = {
  evolucao: "evolucao",
  receitas: "receita",
  laudos: "laudo",
  atestados: "atestado",
};

const PDF_TIPOS: DocTipo[] = ["receita", "laudo", "atestado"];

export default function PatientDetail() {
  const { locale } = useLanguage();
  const t = useScopedTranslations(operationalCoreMessages);
  const tr = useScopedTranslations(operationalPatientRecordMessages);
  const tl = useScopedTranslations(lgpdMessages);
  const params = useParams();
  const id = parseInt(params.id || "0");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user: doctor } = useAuth();
  const queryClient = useQueryClient();

  const { data: patient, isLoading, error } = useGetPatient(id);
  const deleteMutation = useDeletePatient();
  const updateMutation = useUpdatePatient();

  const [abaAtiva, setAbaAtiva] = useState<Aba>(() => {
    const requested = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("aba") : null;
    return ABAS.includes(requested as Aba) ? (requested as Aba) : "visao-geral";
  });
  const [anamneseText, setAnamneseText] = useState("");
  const [editandoAnamnese, setEditandoAnamnese] = useState(false);
  const [documentos, setDocumentos] = useState<Documento[]>([]);
  const [novoDoc, setNovoDoc] = useState<{ titulo: string; conteudo: string } | null>(null);
  const [pdfLoading, setPdfLoading] = useState<string | null>(null);
  const [pdfShareUrl, setPdfShareUrl] = useState<{ url: string; docId: string } | null>(null);

  // ── Casos Regenerativos ──
  const [regenCases, setRegenCases] = useState<Array<{
    id: string; status: string; condition_code: string; condition_custom?: string;
    data_caso?: string; planned_products?: string[]; created_at: string;
  }>>([]);

  // ── Attachments state ──
  const [attachments, setAttachments] = useState<PatientAttachment[]>([]);
  const [attachLoading, setAttachLoading] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<{ name: string; progress: number }[]>([]);

  const fetchAttachments = async (patientId: number) => {
    try {
      const res = await fetch(`/regen-api/patients/${patientId}/attachments`, {
        credentials: "same-origin",
      });
      if (res.ok) setAttachments(await res.json());
    } catch {}
  };

  const handleUploadFiles = async (files: FileList) => {
    const fileArr = Array.from(files);
    setUploadingFiles(fileArr.map(f => ({ name: f.name, progress: 0 })));
    for (let i = 0; i < fileArr.length; i++) {
      const file = fileArr[i];
      try {
        // 1. Request a pre-authorised upload grant (patient_attachment purpose)
        const urlRes = await fetch("/regen-api/storage/uploads/request-url", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: file.name, contentType: file.type, size: file.size,
            purpose: "patient_attachment", patientId: Number(id),
          }),
        });
        if (!urlRes.ok) throw new Error("Upload URL error");
        const { uploadURL, token } = await urlRes.json();
        // 2. Upload file directly to GCS
        setUploadingFiles(prev => prev.map((u, idx) => idx === i ? { ...u, progress: 30 } : u));
        const uploadRes = await fetch(uploadURL, {
          method: "PUT", body: file, headers: { "Content-Type": file.type },
        });
        if (!uploadRes.ok) throw new Error("Upload failed");
        setUploadingFiles(prev => prev.map((u, idx) => idx === i ? { ...u, progress: 80 } : u));
        // 3. Atomically consume the grant token to register the attachment
        await fetch(`/regen-api/patients/${id}/attachments`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        setUploadingFiles(prev => prev.map((u, idx) => idx === i ? { ...u, progress: 100 } : u));
      } catch {
        toast({ title: tr("uploadError", { name: file.name }), variant: "destructive" });
      }
    }
    setUploadingFiles([]);
    await fetchAttachments(id);
  };

  const handleDeleteAttachment = async (attachmentId: number) => {
    try {
      await fetch(`/regen-api/patients/${id}/attachments/${attachmentId}`, {
        method: "DELETE", credentials: "same-origin",
      });
      setAttachments(prev => prev.filter(a => a.id !== attachmentId));
      toast({ title: tr("fileRemoved") });
    } catch {
      toast({ title: tr("fileRemoveError"), variant: "destructive" });
    }
  };

  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    nome: "", cpf: "", dataNascimento: "", email: "",
    sexo: "", telefone: "",
    planoSaude: "", numeroCarteirinha: "", indicadoPor: "", pais: "",
    endereco: "", cidade: "", estado: "", cep: "",
  });

  const formatCpf = (value: string) => {
    const d = value.replace(/\D/g, "").slice(0, 11);
    if (d.length <= 3) return d;
    if (d.length <= 6) return `${d.slice(0,3)}.${d.slice(3)}`;
    if (d.length <= 9) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6)}`;
    return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`;
  };

  const [laudoInssOpen, setLaudoInssOpen] = useState(false);
  const [laudoInssForm, setLaudoInssForm] = useState({
    tipo: "INSS e Fisioterapia" as string,
    cid: "",
    tempoAfastamento: "",
    procedimentosRealizados: "",
    planoReabilitacao: "",
    observacoes: "",
    carga: "",
    cargaTempo: "",
    adm: "",
    admTempo: "",
  });

  useEffect(() => {
    if (id) fetchAttachments(id);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    fetch(`/regen-api/regen/cases?patientId=${id}`, { credentials: "same-origin" })
      .then(r => r.ok ? r.json() : [])
      .then(setRegenCases)
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    if (patient) {
      setAnamneseText((patient as any).anamnese || "");
      try {
        const parsed = JSON.parse((patient as any).laudos || "[]");
        const docsArr: Documento[] = Array.isArray(parsed) ? parsed : [];
        docsArr.sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime());
        setDocumentos(docsArr);
      } catch {
        setDocumentos([]);
      }
      setEditForm({
        nome: (patient as any).nome || "",
        cpf: (patient as any).cpf || "",
        dataNascimento: (patient as any).dataNascimento || "",
        email: (patient as any).email || "",
        sexo: (patient as any).sexo || "",
        telefone: (patient as any).telefone || "",
        planoSaude: (patient as any).planoSaude || "",
        numeroCarteirinha: (patient as any).numeroCarteirinha || "",
        indicadoPor: (patient as any).indicadoPor || "",
        pais: (patient as any).pais || "",
        endereco: (patient as any).endereco || "",
        cidade: (patient as any).cidade || "",
        estado: (patient as any).estado || "",
        cep: (patient as any).cep || "",
      });
    }
  }, [patient]);

  const handleAnonymize = async () => {
    try {
      const response = await fetch(`/regen-api/lgpd/anonimizar-paciente/${id}`, { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw new Error(String(response.status));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetPatientQueryKey(id) }),
        queryClient.invalidateQueries({ queryKey: getListPatientsQueryKey() }),
      ]);
      toast({ title: tl("anonymized") });
    } catch {
      toast({ title: tl("anonymizeError"), variant: "destructive" });
    }
  };

  const handleDelete = () => {
    deleteMutation.mutate(
      { id },
      {
        onSuccess: async () => {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: getListPatientsQueryKey() }),
            queryClient.invalidateQueries({ queryKey: ["regen-stats"] }),
            queryClient.invalidateQueries({ queryKey: ["regen-by-product"] }),
            queryClient.invalidateQueries({ queryKey: ["regen-outcomes"] }),
            queryClient.invalidateQueries({ queryKey: ["regen-followup-overview"] }),
            queryClient.invalidateQueries({ queryKey: ["reports/regen"] }),
          ]);
          queryClient.removeQueries({ queryKey: getGetPatientQueryKey(id) });
          toast({ title: tr("patientDeleted") });
          setLocation("/patients");
        },
        onError: () => toast({ title: tr("deleteError"), variant: "destructive" }),
      }
    );
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate(
      {
        id,
        data: {
          nome: editForm.nome || undefined,
          cpf: editForm.cpf || undefined,
          dataNascimento: editForm.dataNascimento || undefined,
          email: editForm.email || undefined,
          sexo: editForm.sexo || undefined,
          telefone: editForm.telefone || undefined,
          planoSaude: editForm.planoSaude || undefined,
          numeroCarteirinha: editForm.numeroCarteirinha || undefined,
          indicadoPor: editForm.indicadoPor || undefined,
          pais: editForm.pais || undefined,
          endereco: editForm.endereco || undefined,
          cidade: editForm.cidade || undefined,
          estado: editForm.estado || undefined,
          cep: editForm.cep || undefined,
        } as any,
      },
      {
        onSuccess: () => { setEditOpen(false); toast({ title: tr("registrationUpdated") }); },
        onError: () => toast({ title: tr("saveError"), variant: "destructive" }),
      }
    );
  };

  const saveAnamnese = () => {
    updateMutation.mutate(
      { id, data: { anamnese: anamneseText } as any },
      {
        onSuccess: () => { setEditandoAnamnese(false); toast({ title: tr("anamnesisSaved") }); },
        onError: () => toast({ title: tr("saveError"), variant: "destructive" }),
      }
    );
  };

  const addDocumento = () => {
    if (!novoDoc) return;
    const tipo = ABA_DOC_TIPO[abaAtiva];
    if (!tipo) return;
    if (!novoDoc.conteudo.trim()) {
      toast({ title: tr("contentRequired"), variant: "destructive" });
      return;
    }
    const novo: Documento = {
      id: Date.now().toString(),
      tipo,
      titulo: novoDoc.titulo.trim() || tr("document"),
      conteudo: novoDoc.conteudo,
      data: new Date().toISOString(),
    };
    const updated = [novo, ...documentos];
    updateMutation.mutate(
      { id, data: { laudos: JSON.stringify(updated) } as any },
      {
        onSuccess: () => { setDocumentos(updated); setNovoDoc(null); toast({ title: tr("documentSaved") }); },
        onError: () => toast({ title: tr("saveError"), variant: "destructive" }),
      }
    );
  };

  const deleteDocumento = (docId: string) => {
    const updated = documentos.filter(d => d.id !== docId);
    updateMutation.mutate(
      { id, data: { laudos: JSON.stringify(updated) } as any },
      {
        onSuccess: () => setDocumentos(updated),
        onError: () => toast({ title: tr("deleteError"), variant: "destructive" }),
      }
    );
  };

  const handleGerarPDF = async (doc: Documento) => {
    if (!patient || !doctor) return;
    setPdfLoading(doc.id);
    try {
      const { doc: pdfDoc, filename } = await generateProntuarioPDF({
        tipo: doc.tipo as "receita" | "laudo" | "atestado",
        titulo: doc.titulo,
        conteudo: doc.conteudo,
        data: doc.data,
        pacienteNome: patient.nome,
        pacienteDataNascimento: (patient as any).dataNascimento ?? null,
        medicoNome: (doctor as any).nome || tr("doctorFallback"),
        medicoCrm: (doctor as any).crm || "",
        medicoCrmEstado: (doctor as any).crmEstado || "",
        cid: doc.cid,
        tempoAfastamento: doc.tempoAfastamento,
      }, locale);
      const result = await sharePdfOrDownload(pdfDoc, filename, (url) => setPdfShareUrl({ url, docId: doc.id }));
      if (result.deferred) {
        toast({ title: tr("pdfReady"), description: tr("pdfReadyDescription") });
      }
    } catch {
      toast({ title: tr("pdfError"), variant: "destructive" });
    } finally {
      setPdfLoading(null);
    }
  };

  const handleOpenProntuarioPDF = () => {
    if (!pdfShareUrl) return;
    handlePdfOpenClick(pdfShareUrl.url, () => setPdfShareUrl(null));
  };

  const openLaudoInssModal = () => {
    setLaudoInssForm({
      tipo: "INSS e Fisioterapia",
      cid: "",
      tempoAfastamento: "",
      procedimentosRealizados: "",
      planoReabilitacao: "",
      observacoes: "",
      carga: "",
      cargaTempo: "",
      adm: "",
      admTempo: "",
    });
    setLaudoInssOpen(true);
  };

  const handleSalvarLaudoInss = () => {
    if (!patient) return;
    const f = laudoInssForm;
    const optionDisplay = (value: string) => {
      const labels: Record<string, string> = {
        "Sem carga": tr("noLoad"), "Carga parcial (apoio com suporte)": tr("partialLoad"),
        "Carga total progressiva": tr("progressiveFullLoad"), "Carga total liberada": tr("fullLoad"),
        "1 semana": tr("week1"), "2 semanas": tr("week2"), "3 semanas": tr("week3"),
        "4 semanas": tr("week4"), "6 semanas": tr("week6"), "8 semanas": tr("week8"), "12 semanas": tr("week12"),
        "Livre (sem restrição)": tr("unrestricted"), "30 dias": tr("days30"), "60 dias": tr("days60"),
        "90 dias": tr("days90"), "120 dias": tr("days120"), "6 meses": tr("months6"), "12 meses": tr("months12"),
      };
      return labels[value] ?? value;
    };

    const linhas: string[] = [];
    if (f.procedimentosRealizados.trim()) {
      linhas.push(tr("performedHeading"));
      linhas.push(f.procedimentosRealizados.trim());
      linhas.push("");
    }
    if (f.planoReabilitacao.trim()) {
      linhas.push(tr("rehabilitationHeading"));
      linhas.push(f.planoReabilitacao.trim());
      linhas.push("");
    }
    if (f.carga.trim()) {
      const cargaLinha = f.cargaTempo.trim()
        ? `${tr("loadHeading")} ${optionDisplay(f.carga.trim())} ${tr("forDuration")} ${optionDisplay(f.cargaTempo.trim())}`
        : `${tr("loadHeading")} ${optionDisplay(f.carga.trim())}`;
      linhas.push(cargaLinha);
      linhas.push("");
    }
    if (f.adm.trim()) {
      const admLinha = f.admTempo.trim()
        ? `${tr("rangeHeading")} ${optionDisplay(f.adm.trim())} ${tr("forDuration")} ${optionDisplay(f.admTempo.trim())}`
        : `${tr("rangeHeading")} ${optionDisplay(f.adm.trim())}`;
      linhas.push(admLinha);
      linhas.push("");
    }
    if (f.tempoAfastamento.trim()) {
      linhas.push(`${tr("leaveHeading")} ${optionDisplay(f.tempoAfastamento.trim())}`);
      linhas.push("");
    }
    if (f.observacoes.trim()) {
      linhas.push(tr("notesHeading"));
      linhas.push(f.observacoes.trim());
    }

    const conteudo = linhas.join("\n").trim();
    if (!conteudo) {
      toast({ title: tr("reportFieldRequired"), variant: "destructive" });
      return;
    }

    const recipientLabel = f.tipo === "Fisioterapia" ? tr("recipientPhysio") : f.tipo === "INSS e Fisioterapia" ? tr("recipientBoth") : f.tipo;
    const subtipo = f.tipo !== "INSS e Fisioterapia" ? ` (${recipientLabel})` : "";
    const novo: Documento = {
      id: Date.now().toString(),
      tipo: "laudo",
      titulo: `${tr("medicalReport")}${subtipo}${f.cid ? ` — CID ${f.cid}` : ""}`,
      conteudo,
      data: new Date().toISOString(),
      cid: f.cid || undefined,
      tempoAfastamento: f.tempoAfastamento || undefined,
    };

    const updated = [novo, ...documentos];
    updateMutation.mutate(
      { id, data: { laudos: JSON.stringify(updated) } as any },
      {
        onSuccess: async () => {
          setDocumentos(updated);
          setLaudoInssOpen(false);
          toast({ title: tr("reportSaved") });
          await handleGerarPDF(novo);
        },
        onError: () => toast({ title: tr("reportSaveError"), variant: "destructive" }),
      }
    );
  };

  if (isLoading) {
    return (
      <div className="p-8 max-w-5xl mx-auto space-y-4">
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (error || !patient) {
    return <div className="p-8 text-center text-destructive">{tr("patientLoadError")}</div>;
  }

  const birthDate = parseCalendarDate(patient.dataNascimento);
  const idade = birthDate ? differenceInYears(new Date(), birthDate) : null;

  const docsDaAba = ABA_DOC_TIPO[abaAtiva]
    ? documentos.filter(d => d.tipo === ABA_DOC_TIPO[abaAtiva])
    : [];

  const hasAnamnese = !!anamneseText.trim();
  const dateLocale = locale === "es" ? es : ptBR;
  const tabs: Record<Aba, string> = {
    "visao-geral": tr("tabOverview"), "pre-consulta": tr("tabPreConsult"), anamnese: tr("tabAnamnesis"),
    evolucao: tr("tabEvolution"), receitas: tr("tabPrescriptions"), laudos: tr("tabReports"),
    atestados: tr("tabCertificates"), arquivos: tr("tabFiles"),
  };
  const documentTypes: Partial<Record<Aba, string>> = {
    evolucao: tr("evolution"), receitas: tr("prescription"), laudos: tr("report"), atestados: tr("certificate"),
  };
  const documentPlaceholders: Partial<Record<Aba, string>> = {
    evolucao: tr("evolutionPlaceholder"), receitas: tr("prescriptionPlaceholder"),
    laudos: tr("reportPlaceholder"), atestados: tr("certificatePlaceholder"),
  };
  const hoje = format(new Date(), "EEEE, dd 'de' MMMM 'de' yyyy", { locale: dateLocale });

  return (
    <>
    <div className="min-h-screen bg-background">

      {/* ── Mobile navy banner (hidden md+) ── */}
      <div className="md:hidden" style={{ background: "linear-gradient(135deg, #0B1F4B 0%, #0D2040 100%)" }}>
        <div className="px-4 pt-5 pb-4">
          <div className="flex items-center gap-3">
            <Link href="/patients">
              <button title={t("back")} aria-label={t("back")} className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(255,255,255,0.1)", border: "none", cursor: "pointer" }}>
                <ArrowLeft className="h-4 w-4 text-white" />
              </button>
            </Link>
            <div
              className="w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-base shrink-0"
              style={{ background: AVATAR_COLORS[patient.id % AVATAR_COLORS.length], boxShadow: "0 2px 8px rgba(0,0,0,0.25)" }}
            >
              {patient.nome.split(" ").slice(0, 2).map((n: string) => n[0]).join("").toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-bold text-white truncate" style={{ margin: 0 }}>{formatPersonName(patient.nome)}</h1>
              <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.55)", margin: 0 }}>
                {birthDate ? formatCalendarDate(birthDate, locale) : ''}
                {idade !== null ? ` · ${idade} ${tr("years")}` : ''}
                {patient.sexo === 'M' ? ` · ${tr("male")}` : patient.sexo === 'F' ? ` · ${tr("female")}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <button onClick={() => setEditOpen(true)} title={tr("editRegistration")} aria-label={tr("editRegistration")} className="w-8 h-8 flex items-center justify-center shrink-0 rounded-full" style={{ background: "rgba(14,154,167,0.18)", border: "none", cursor: "pointer" }}>
                <Pencil className="h-3.5 w-3.5" style={{ color: "#0E9AA7" }} />
              </button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button title={tl("anonymize")} aria-label={tl("anonymize")} className="w-8 h-8 flex items-center justify-center shrink-0 rounded-full" style={{ background: "rgba(255,255,255,0.08)", border: "none", cursor: "pointer" }}>
                    <UserX className="h-4 w-4" style={{ color: "rgba(255,255,255,0.45)" }} />
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{tl("anonymizeTitle")}</AlertDialogTitle>
                    <AlertDialogDescription>{tl("anonymizeDescription")}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                    <AlertDialogAction onClick={handleAnonymize}>{tl("anonymizeConfirm")}</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button title={tr("delete")} aria-label={tr("delete")} className="w-8 h-8 flex items-center justify-center shrink-0 rounded-full" style={{ background: "rgba(255,255,255,0.08)", border: "none", cursor: "pointer" }}>
                    <Trash2 className="h-4 w-4" style={{ color: "rgba(255,255,255,0.45)" }} />
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{tr("confirmDeletion")}</AlertDialogTitle>
                    <AlertDialogDescription>{tr("confirmDeletionDescription")}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">{tr("delete")}</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
          {patient.telefone && (
            <div className="flex items-center gap-1.5 mt-2 ml-[76px]" style={{ color: "rgba(255,255,255,0.5)" }}>
              <Phone className="h-3 w-3" />
              <span className="text-xs">{patient.telefone}</span>
            </div>
          )}
          {(patient as any).numeroRegistro && (
            <div className="flex items-center gap-1.5 mt-1 ml-[76px]">
              <span className="text-xs font-mono px-2 py-0.5 rounded" style={{ background: "rgba(14,154,167,0.15)", color: "#0E9AA7", letterSpacing: "0.04em" }}>
                {(patient as any).numeroRegistro}
              </span>
            </div>
          )}
        </div>
        {/* Mobile tab pills */}
        <div
          className="w-full max-w-full px-4 pb-3 flex gap-1.5 overflow-x-auto overscroll-x-contain no-scrollbar"
          role="tablist"
          aria-label="Navegação do prontuário"
        >
          {ABAS.map(aba => (
            <button
              key={aba}
              onClick={() => { setAbaAtiva(aba); setNovoDoc(null); }}
              className="shrink-0"
              role="tab"
              aria-selected={abaAtiva === aba}
              style={{
                padding: "6px 12px", borderRadius: 8, fontSize: 12,
                fontWeight: abaAtiva === aba ? 600 : 400,
                background: abaAtiva === aba ? "#0E9AA7" : "rgba(255,255,255,0.08)",
                color: abaAtiva === aba ? "#fff" : "rgba(255,255,255,0.55)",
                border: "none", cursor: "pointer", transition: "all 0.15s", whiteSpace: "nowrap",
              }}
            >
              {tabs[aba]}
            </button>
          ))}
        </div>
      </div>

      {/* ── Desktop header (hidden on mobile) ── */}
      <div className="hidden md:block bg-card border-b border-border">
        <div className="max-w-5xl mx-auto px-6 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <Link href="/patients">
                <button title={t("back")} aria-label={t("back")} className="w-8 h-8 flex items-center justify-center rounded-lg border border-border hover:bg-muted/50 transition-colors mt-0.5 shrink-0" style={{ background: "none", cursor: "pointer" }}>
                  <ArrowLeft className="h-4 w-4 text-muted-foreground" />
                </button>
              </Link>
              <div className="w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-base shrink-0" style={{ background: AVATAR_COLORS[patient.id % AVATAR_COLORS.length] }}>
                {patient.nome.split(" ").slice(0, 2).map((n: string) => n[0]).join("").toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-lg font-bold text-foreground truncate">{formatPersonName(patient.nome)}</h1>
                  <Badge variant="outline" className="text-green-700 border-green-200 bg-green-50 dark:bg-green-950/30 dark:text-green-400 text-xs">{tr("active")}</Badge>
                </div>
                <p className="text-muted-foreground text-sm mt-0.5">
                  {birthDate ? formatCalendarDate(birthDate, locale) : ''}
                  {idade !== null ? ` · ${idade} ${tr("years")}` : ''}
                  {patient.sexo === 'M' ? ` · ${tr("male")}` : patient.sexo === 'F' ? ` · ${tr("female")}` : ''}
                </p>
                {patient.telefone && (
                  <div className="flex items-center gap-1.5 mt-1 text-muted-foreground text-xs">
                    <Phone className="h-3 w-3" />{patient.telefone}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1 mt-1 shrink-0">
              <button onClick={() => setEditOpen(true)} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors" style={{ background: "none", border: "none", cursor: "pointer" }} title={tr("editRegistration")}>
                <Pencil className="h-4 w-4" />
              </button>
              <AlertDialog>
              <AlertDialogTrigger asChild>
                <button title={tr("delete")} aria-label={tr("delete")} className="p-1.5 text-muted-foreground/40 hover:text-destructive transition-colors" style={{ background: "none", border: "none", cursor: "pointer" }}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{tr("confirmDeletion")}</AlertDialogTitle>
                  <AlertDialogDescription>{tr("confirmDeletionDescription")}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{tr("cancel")}</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">{tr("delete")}</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
          </div>
          {/* Desktop tabs */}
          <div className="flex mt-4 -mb-px">
            {ABAS.map(aba => (
              <button
                key={aba}
                onClick={() => { setAbaAtiva(aba); setNovoDoc(null); }}
                className="px-4 py-2 text-sm font-medium border-b-2 transition-colors"
                style={{
                  borderColor: abaAtiva === aba ? "#0B1F4B" : "transparent",
                  color: abaAtiva === aba ? "#0B1F4B" : undefined,
                  background: "none", cursor: "pointer", fontFamily: "inherit",
                }}
              >
                {tabs[aba]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Tab content ── */}
      <div className="max-w-5xl mx-auto px-4 md:px-6 py-4 md:py-6 space-y-4">

        {/* VISÃO GERAL */}
        {abaAtiva === "visao-geral" && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: tr("regenerativeCases"), value: regenCases.length },
                { label: tr("evolutions"), value: documentos.filter(d => d.tipo === "evolucao").length },
                { label: tr("prescriptions"), value: documentos.filter(d => d.tipo === "receita").length },
                { label: tr("reports"), value: documentos.filter(d => d.tipo === "laudo").length },
              ].map(card => (
                <div key={card.label} className="bg-card border border-border rounded-xl p-4" style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">{card.label}</p>
                  <p className="text-3xl font-bold mt-1" style={{ color: "#0B1F4B" }}>{card.value}</p>
                </div>
              ))}
            </div>

            {/* ── Casos Regenerativos ── */}
            {(() => {
              const PROD_LABELS: Record<string, string> = {
                PRP: "PRP", LP_PRP: "LP-PRP", LR_PRP: "LR-PRP", PRF: "PRF",
                AH: tr("productHyaluronic"), COLAGENO: tr("productCollagen"), BMAC: "BMA",
                MFAT: "MFAT", NANOFAT: "Nanofat", SVF: "SVF", LISADO: tr("productLysate"),
                SUBCONDROPLASTIA: "Subcondroplastia", HIDROGEL: "Hidrogel", OUTRO: tr("productOther"),
              };
              const STATUS_LABEL: Record<string, string> = { draft: tr("draft"), active: tr("active"), closed: tr("closed") };
              const STATUS_COLOR: Record<string, string> = { draft: "#B45309", active: "#15803D", closed: "#6B7280" };
              const STATUS_BG: Record<string, string> = { draft: "#FEF3C7", active: "#DCFCE7", closed: "#F3F4F6" };
              return (
                <div className="bg-card border border-border rounded-xl overflow-hidden" style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}>
                  <div className="px-5 py-4 border-b border-border flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <h2 className="text-sm font-semibold text-foreground">{tr("regenerativeCases")}</h2>
                      <p className="text-xs text-muted-foreground mt-0.5">{tr("regenerativeSubtitle")}</p>
                    </div>
                    <div className="flex gap-2">
                      <Link href="/regen">
                        <Button size="sm" variant="outline" className="gap-1 text-xs">
                          <ExternalLink className="h-3.5 w-3.5" /> {tr("viewAll")}
                        </Button>
                      </Link>
                      <Link href="/regen/caso/novo">
                        <Button size="sm" className="gap-1 text-xs" style={{ background: "#0B1F4B" }}>
                          <Plus className="h-3.5 w-3.5" /> {tr("newRegenerativeCase")}
                        </Button>
                      </Link>
                    </div>
                  </div>
                  <div className="p-4 flex flex-col gap-2">
                    {regenCases.length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-6">{tr("noRegenerativeCase")}</p>
                    )}
                    {regenCases.map(rc => (
                      <Link key={rc.id} href={`/regen/caso/${rc.id}`}>
                        <div className="flex items-center justify-between p-3.5 rounded-lg border border-border bg-muted/20 hover:bg-muted/40 transition-colors cursor-pointer">
                          <div className="flex flex-col gap-1 min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-semibold text-foreground">
                                {regenConditionLabel(rc.condition_code, locale, rc.condition_custom)}
                              </span>
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                                style={{ background: STATUS_BG[rc.status] ?? "#F3F4F6", color: STATUS_COLOR[rc.status] ?? "#6B7280" }}>
                                {STATUS_LABEL[rc.status] ?? rc.status}
                              </span>
                            </div>
                            {rc.data_caso && (
                              <span className="text-xs text-muted-foreground">{formatCalendarDate(rc.data_caso, locale)}</span>
                            )}
                            {(rc.planned_products ?? []).length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-0.5">
                                {(rc.planned_products ?? []).map(code => (
                                  <span key={code} className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700">
                                    {PROD_LABELS[code] ?? code}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          <ExternalLink className="h-4 w-4 text-muted-foreground shrink-0 ml-2" />
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })()}
          </>
        )}

        {/* PRÉ-CONSULTA */}
        {abaAtiva === "pre-consulta" && (
          <PreConsultTab patientId={patient.id} />
        )}

        {/* ANAMNESE */}
        {abaAtiva === "anamnese" && (
          <div className="bg-card border border-border rounded-xl overflow-hidden" style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}>
            <div className="px-5 py-4 border-b border-border flex justify-between items-center">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-foreground">{tr("tabAnamnesis")}</h2>
                {hasAnamnese && <Badge className="bg-blue-100 text-blue-800 border-none text-xs dark:bg-blue-950/50 dark:text-blue-300">{tr("filled")}</Badge>}
              </div>
              {!editandoAnamnese && (
                <Button variant="outline" size="sm" onClick={() => setEditandoAnamnese(true)} className="gap-1.5 text-xs h-8">
                  <Pencil className="h-3.5 w-3.5" />{hasAnamnese ? tr("edit") : tr("fill")}
                </Button>
              )}
            </div>
            <div className="p-5">
              {editandoAnamnese ? (
                <div className="flex flex-col gap-3">
                  <textarea
                    value={anamneseText}
                    onChange={e => setAnamneseText(e.target.value)}
                    placeholder={tr("anamnesisPlaceholder")}
                    rows={14}
                    autoFocus
                    className="w-full px-3 py-2.5 rounded-lg border border-input bg-background text-foreground text-sm leading-relaxed resize-vertical outline-none focus:border-primary transition-colors"
                    style={{ fontFamily: "inherit" }}
                  />
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setEditandoAnamnese(false); setAnamneseText((patient as any).anamnese || ""); }}>{tr("cancel")}</Button>
                    <Button size="sm" onClick={saveAnamnese} disabled={updateMutation.isPending} className="gap-1.5" style={{ background: "#0B1F4B" }}>
                      <Save className="h-4 w-4" />{tr("saveAnamnesis")}
                    </Button>
                  </div>
                </div>
              ) : hasAnamnese ? (
                <p className="text-sm leading-relaxed text-foreground/80 whitespace-pre-wrap">{anamneseText}</p>
              ) : (
                <div className="text-center py-10 text-muted-foreground">
                  <ClipboardList className="h-10 w-10 mx-auto mb-3 text-muted-foreground/30" />
                  <p className="text-sm mb-4">{tr("noAnamnesis")}</p>
                  <Button variant="outline" size="sm" onClick={() => setEditandoAnamnese(true)}>{tr("fillAnamnesis")}</Button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* EVOLUÇÃO / RECEITAS / LAUDOS / ATESTADOS */}
        {(abaAtiva === "evolucao" || abaAtiva === "receitas" || abaAtiva === "laudos" || abaAtiva === "atestados") && (
          <div className="bg-card border border-border rounded-xl overflow-hidden" style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}>
            <div className="px-5 py-4 border-b border-border flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-foreground">{tabs[abaAtiva]}</h2>
                <p className="text-xs text-muted-foreground mt-0.5">{tr("documentCount", { count: docsDaAba.length, suffix: docsDaAba.length !== 1 ? "s" : "" })}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {abaAtiva === "laudos" && !novoDoc && (
                  <Button variant="outline" size="sm" onClick={openLaudoInssModal} className="gap-1.5 text-xs h-8">
                    <Building2 className="h-3.5 w-3.5" />{tr("inssReport")}
                  </Button>
                )}
                {!novoDoc && (
                  <Button size="sm" onClick={() => setNovoDoc({ titulo: "", conteudo: "" })} style={{ background: "#0B1F4B" }} className="gap-1.5 text-xs h-8">
                    <Plus className="h-3.5 w-3.5" />{tr("newDocument", { type: documentTypes[abaAtiva] ?? tr("document") })}
                  </Button>
                )}
              </div>
            </div>

            <div className="p-4 flex flex-col gap-3">
              {/* Novo documento form */}
              {novoDoc && (
                <div className="rounded-lg border border-border p-4 bg-muted/20 flex flex-col gap-2.5">
                  <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-blue-50 border border-blue-100 dark:bg-blue-950/30 dark:border-blue-800">
                    <span className="text-xs text-blue-700 dark:text-blue-300 font-semibold">{hoje.charAt(0).toUpperCase() + hoje.slice(1)}</span>
                  </div>
                  <input
                    type="text"
                    value={novoDoc.titulo}
                    onChange={e => setNovoDoc(v => v ? { ...v, titulo: e.target.value } : null)}
                    placeholder={tr("titlePlaceholder", { type: (documentTypes[abaAtiva] ?? tr("document")).toLowerCase() })}
                    className="w-full px-3 py-2 rounded-md border border-input bg-background text-foreground text-sm outline-none focus:border-primary transition-colors"
                    style={{ fontFamily: "inherit" }}
                  />
                  <textarea
                    value={novoDoc.conteudo}
                    onChange={e => setNovoDoc(v => v ? { ...v, conteudo: e.target.value } : null)}
                    placeholder={documentPlaceholders[abaAtiva]}
                    rows={7}
                    autoFocus
                    className="w-full px-3 py-2 rounded-md border border-input bg-background text-foreground text-sm leading-relaxed resize-vertical outline-none focus:border-primary transition-colors"
                    style={{ fontFamily: "inherit" }}
                  />
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => setNovoDoc(null)}>{tr("cancel")}</Button>
                    <Button size="sm" onClick={addDocumento} disabled={updateMutation.isPending} style={{ background: "#0B1F4B" }} className="gap-1">
                      <Save className="h-4 w-4" />{tr("save")}
                    </Button>
                  </div>
                </div>
              )}

              {/* Document list */}
              {docsDaAba.length === 0 && !novoDoc ? (
                <div className="text-center py-10 text-muted-foreground">
                  <ClipboardList className="h-10 w-10 mx-auto mb-3 text-muted-foreground/30" />
                  <p className="text-sm">{tr("noDocument")}</p>
                </div>
              ) : (
                docsDaAba.map(doc => (
                  <div key={doc.id} className="rounded-lg border border-border p-4 bg-muted/20">
                    <div className="flex justify-between items-start mb-2 gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-foreground">{doc.titulo}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {format(new Date(doc.data), locale === "es" ? "EEEE, dd 'de' MMMM 'de' yyyy HH:mm" : "EEEE, dd 'de' MMMM 'de' yyyy 'às' HH:mm", { locale: dateLocale })}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {PDF_TIPOS.includes(doc.tipo) && (
                          <>
                            {pdfShareUrl?.docId === doc.id && (
                              <Button size="sm" onClick={handleOpenProntuarioPDF} className="gap-1 text-xs h-7 px-2 bg-green-600 hover:bg-green-700 text-white animate-in fade-in">
                                <ExternalLink className="h-3.5 w-3.5" />
                                {tr("open")}
                              </Button>
                            )}
                            <Button variant="outline" size="sm" onClick={() => handleGerarPDF(doc)} disabled={pdfLoading === doc.id} className="gap-1 text-xs h-7 px-2">
                              <FileDown className="h-3.5 w-3.5" />
                              {pdfLoading === doc.id ? "..." : "PDF"}
                            </Button>
                          </>
                        )}
                        <button onClick={() => deleteDocumento(doc.id)} title={tr("delete")} aria-label={tr("delete")} disabled={updateMutation.isPending} className="p-1.5 text-muted-foreground/40 hover:text-destructive transition-colors disabled:opacity-40 disabled:cursor-not-allowed" style={{ background: "none", border: "none", cursor: "pointer" }}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    <p className="text-sm leading-relaxed text-foreground/75 whitespace-pre-wrap">{doc.conteudo}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* ARQUIVOS */}
        {abaAtiva === "arquivos" && (
          <div className="bg-card border border-border rounded-xl overflow-hidden" style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}>
            <div className="px-5 py-4 border-b border-border flex justify-between items-center">
              <div>
                <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Paperclip className="h-4 w-4 text-primary" />
                  {tr("attachedFiles")}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">{tr("fileCount", { count: attachments.length, suffix: attachments.length !== 1 ? "s" : "" })}</p>
              </div>
              <label className="cursor-pointer">
                <input
                  type="file"
                  multiple
                  accept="image/*,video/*,.pdf,.xls,.xlsx,.ppt,.pptx,.doc,.docx,.csv,.txt"
                  className="hidden"
                  onChange={e => e.target.files && handleUploadFiles(e.target.files)}
                />
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white cursor-pointer transition-all hover:opacity-90" style={{ background: "#0B1F4B" }}>
                  <Upload className="h-3.5 w-3.5" />
                  {tr("attachFile")}
                </span>
              </label>
            </div>

            <div className="p-4">
              {/* Upload progress */}
              {uploadingFiles.length > 0 && (
                <div className="mb-3 space-y-2">
                  {uploadingFiles.map((f, i) => (
                    <div key={i} className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-medium text-foreground truncate max-w-[80%]">{f.name}</span>
                        <span className="text-xs text-muted-foreground">{f.progress}%</span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-300" style={{ width: `${f.progress}%`, background: "#0E9AA7" }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {attachments.length === 0 && uploadingFiles.length === 0 ? (
                <label className="cursor-pointer block">
                  <input
                    type="file"
                    multiple
                    accept="image/*,video/*,.pdf,.xls,.xlsx,.ppt,.pptx,.doc,.docx,.csv,.txt"
                    className="hidden"
                    onChange={e => e.target.files && handleUploadFiles(e.target.files)}
                  />
                  <div className="flex flex-col items-center justify-center py-12 gap-3 text-center border-2 border-dashed border-border rounded-xl hover:border-primary/50 transition-colors">
                    <div className="w-12 h-12 rounded-xl bg-muted/60 flex items-center justify-center">
                      <Upload className="h-6 w-6 text-muted-foreground/50" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">{tr("clickAttach")}</p>
                      <p className="text-xs text-muted-foreground mt-1">{tr("supportedFiles")}</p>
                    </div>
                  </div>
                </label>
              ) : (
                <div className="space-y-2">
                  {attachments.map(att => {
                    const isImage = att.mimeType.startsWith("image/");
                    const isVideo = att.mimeType.startsWith("video/");
                    const isPdf = att.mimeType === "application/pdf";
                    const isOffice = att.mimeType.includes("spreadsheet") || att.mimeType.includes("excel") ||
                      att.mimeType.includes("presentation") || att.mimeType.includes("powerpoint") ||
                      att.mimeType.includes("wordprocessingml") || att.mimeType.includes("msword");
                    const IconComp = isImage ? FileImage : isVideo ? Film : isPdf || isOffice ? FileText : File;
                    const iconColor = isImage ? "#0E9AA7" : isVideo ? "#8338EC" : isPdf ? "#E63946" : isOffice ? "#2B9348" : "#6B7280";
                    const sizeMb = att.fileSize ? (att.fileSize / 1024 / 1024).toFixed(1) + " MB" : null;
                    // Signed URLs are preferred, but keep same-origin access available
                    // for older attachments or a temporary signing failure.
                    const openUrl = att.downloadUrl ||
                      (att.objectPath.startsWith("/objects/")
                        ? `/regen-api/storage/objects/${att.objectPath.slice("/objects/".length)}`
                        : null);

                    return (
                      <div key={att.id} className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/20 hover:bg-muted/40 transition-colors group">
                        {openUrl ? (
                          <a
                            href={openUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-3 flex-1 min-w-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            aria-label={`${tr("download")}: ${att.fileName}`}
                          >
                            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${iconColor}18` }}>
                              <IconComp className="h-4.5 w-4.5" style={{ color: iconColor, width: 18, height: 18 }} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-foreground truncate">{att.fileName}</p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {format(new Date(att.createdAt), locale === "es" ? "dd/MM/yyyy HH:mm" : "dd/MM/yyyy 'às' HH:mm", { locale: dateLocale })}
                                {sizeMb && ` · ${sizeMb}`}
                              </p>
                            </div>
                          </a>
                        ) : (
                          <>
                            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${iconColor}18` }}>
                              <IconComp className="h-4.5 w-4.5" style={{ color: iconColor, width: 18, height: 18 }} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-foreground truncate">{att.fileName}</p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {format(new Date(att.createdAt), locale === "es" ? "dd/MM/yyyy HH:mm" : "dd/MM/yyyy 'às' HH:mm", { locale: dateLocale })}
                                {sizeMb && ` · ${sizeMb}`}
                              </p>
                            </div>
                          </>
                        )}
                        <div className="flex items-center gap-1 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                          {openUrl && (
                            <a
                              href={openUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
                              title={tr("download")}
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              <span className="hidden sm:inline">{tr("download")}</span>
                            </a>
                          )}
                          <button
                            onClick={() => handleDeleteAttachment(att.id)}
                            className="p-1.5 rounded-lg text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-colors"
                            title={tr("remove")}
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>

    {/* ── Modal: Laudo INSS / Fisioterapia ── */}
    <Dialog open={laudoInssOpen} onOpenChange={setLaudoInssOpen}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <Building2 className="h-5 w-5" />
            {tr("inssPhysioReport")}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 mt-1">
          {/* Tipo do laudo */}
          <div className="flex flex-col gap-2">
            <Label className="text-sm font-semibold text-muted-foreground">{tr("recipient")}</Label>
            <div className="flex gap-2 flex-wrap">
              {[
                { value: "INSS e Fisioterapia", label: tr("recipientBoth") },
                { value: "INSS", label: "INSS" },
                { value: "Fisioterapia", label: tr("recipientPhysio") },
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setLaudoInssForm(f => ({ ...f, tipo: opt.value }))}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all border cursor-pointer ${laudoInssForm.tipo === opt.value ? "bg-[#0B1F4B] text-white border-[#0B1F4B]" : "bg-card text-muted-foreground border-border hover:border-primary/50"}`}
                  style={{ fontFamily: "inherit" }}
                >{opt.label}</button>
              ))}
            </div>
          </div>

          {/* CID */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm font-semibold text-muted-foreground">{tr("diseaseCode")} <span className="font-normal text-muted-foreground/60">{tr("diseaseCodeHelp")}</span></Label>
            <input type="text" placeholder={tr("cidPlaceholder")} value={laudoInssForm.cid} onChange={e => setLaudoInssForm(f => ({ ...f, cid: e.target.value }))} className="w-full px-3 py-2 rounded-md border border-input bg-background text-foreground text-sm outline-none focus:border-primary transition-colors" style={{ fontFamily: "inherit" }} />
          </div>

          {/* Procedimentos */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm font-semibold text-muted-foreground">{tr("proceduresDone")}</Label>
            <textarea rows={3} placeholder={tr("proceduresPlaceholder")} value={laudoInssForm.procedimentosRealizados} onChange={e => setLaudoInssForm(f => ({ ...f, procedimentosRealizados: e.target.value }))} className="w-full px-3 py-2 rounded-md border border-input bg-background text-foreground text-sm resize-vertical outline-none focus:border-primary transition-colors" style={{ fontFamily: "inherit", lineHeight: 1.6 }} />
          </div>

          {/* Plano de reabilitação */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm font-semibold text-muted-foreground">{tr("rehabilitationPlan")}</Label>
            <textarea rows={4} placeholder={tr("rehabilitationPlaceholder")} value={laudoInssForm.planoReabilitacao} onChange={e => setLaudoInssForm(f => ({ ...f, planoReabilitacao: e.target.value }))} className="w-full px-3 py-2 rounded-md border border-input bg-background text-foreground text-sm resize-vertical outline-none focus:border-primary transition-colors" style={{ fontFamily: "inherit", lineHeight: 1.6 }} />
          </div>

          {/* Protocolo de carga */}
          <div className="flex flex-col gap-3 p-4 rounded-xl border border-border bg-muted/20">
            <Label className="text-sm font-bold text-foreground">{tr("loadProtocol")}</Label>
            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-muted-foreground">{tr("allowedSupport")}</span>
              <div className="flex gap-2 flex-wrap">
                {[["Sem carga", "noLoad"], ["Carga parcial (apoio com suporte)", "partialLoad"], ["Carga total progressiva", "progressiveFullLoad"], ["Carga total liberada", "fullLoad"]].map(([value, key]) => (
                  <button key={value} type="button" onClick={() => setLaudoInssForm(f => ({ ...f, carga: f.carga === value ? "" : value }))} className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all border cursor-pointer ${laudoInssForm.carga === value ? "bg-[#0B1F4B] text-white border-[#0B1F4B]" : "bg-card text-muted-foreground border-border"}`} style={{ fontFamily: "inherit" }}>{tr(key as "noLoad")}</button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-muted-foreground">{tr("howLong")}</span>
              <div className="flex gap-1.5 flex-wrap">
                {[["1 semana", "week1"], ["2 semanas", "week2"], ["3 semanas", "week3"], ["4 semanas", "week4"], ["6 semanas", "week6"], ["8 semanas", "week8"], ["12 semanas", "week12"]].map(([value, key]) => (
                  <button key={value} type="button" onClick={() => setLaudoInssForm(f => ({ ...f, cargaTempo: f.cargaTempo === value ? "" : value }))} className={`px-3 py-1 rounded-full text-xs font-medium transition-all border cursor-pointer ${laudoInssForm.cargaTempo === value ? "bg-cyan-100 text-cyan-700 border-cyan-400 dark:bg-cyan-950/50 dark:text-cyan-300" : "bg-card text-muted-foreground border-border"}`} style={{ fontFamily: "inherit" }}>{tr(key as "week1")}</button>
                ))}
              </div>
              <input type="text" placeholder={tr("manualDaysPlaceholder")} value={laudoInssForm.cargaTempo} onChange={e => setLaudoInssForm(f => ({ ...f, cargaTempo: e.target.value }))} className="w-full px-3 py-1.5 rounded-md border border-input bg-background text-foreground text-xs outline-none focus:border-primary transition-colors" style={{ fontFamily: "inherit" }} />
            </div>
          </div>

          {/* Arco de Movimento */}
          <div className="flex flex-col gap-3 p-4 rounded-xl border border-border bg-muted/20">
            <Label className="text-sm font-bold text-foreground">{tr("rangeOfMotion")}</Label>
            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-muted-foreground">{tr("allowedRange")}</span>
              <div className="flex gap-2 flex-wrap">
                {["0° a 30°", "0° a 60°", "0° a 90°", "0° a 120°", "0° a 135°", "Livre (sem restrição)"].map(opt => (
                  <button key={opt} type="button" onClick={() => setLaudoInssForm(f => ({ ...f, adm: f.adm === opt ? "" : opt }))} className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all border cursor-pointer ${laudoInssForm.adm === opt ? "bg-[#0B1F4B] text-white border-[#0B1F4B]" : "bg-card text-muted-foreground border-border"}`} style={{ fontFamily: "inherit" }}>{opt === "Livre (sem restrição)" ? tr("unrestricted") : opt}</button>
                ))}
              </div>
              <input type="text" placeholder={tr("manualRangePlaceholder")} value={laudoInssForm.adm} onChange={e => setLaudoInssForm(f => ({ ...f, adm: e.target.value }))} className="w-full px-3 py-1.5 rounded-md border border-input bg-background text-foreground text-xs outline-none focus:border-primary transition-colors mt-1" style={{ fontFamily: "inherit" }} />
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-muted-foreground">{tr("howLong")}</span>
              <div className="flex gap-1.5 flex-wrap">
                {[["1 semana", "week1"], ["2 semanas", "week2"], ["3 semanas", "week3"], ["4 semanas", "week4"], ["6 semanas", "week6"], ["8 semanas", "week8"], ["12 semanas", "week12"]].map(([value, key]) => (
                  <button key={value} type="button" onClick={() => setLaudoInssForm(f => ({ ...f, admTempo: f.admTempo === value ? "" : value }))} className={`px-3 py-1 rounded-full text-xs font-medium transition-all border cursor-pointer ${laudoInssForm.admTempo === value ? "bg-cyan-100 text-cyan-700 border-cyan-400 dark:bg-cyan-950/50 dark:text-cyan-300" : "bg-card text-muted-foreground border-border"}`} style={{ fontFamily: "inherit" }}>{tr(key as "week1")}</button>
                ))}
              </div>
              <input type="text" placeholder={tr("manualWeeksPlaceholder")} value={laudoInssForm.admTempo} onChange={e => setLaudoInssForm(f => ({ ...f, admTempo: e.target.value }))} className="w-full px-3 py-1.5 rounded-md border border-input bg-background text-foreground text-xs outline-none focus:border-primary transition-colors" style={{ fontFamily: "inherit" }} />
            </div>
          </div>

          {/* Tempo de afastamento */}
          <div className="flex flex-col gap-2">
            <Label className="text-sm font-semibold text-muted-foreground">{tr("leaveDuration")}</Label>
            <div className="flex gap-2 flex-wrap mb-1">
              {[["30 dias", "days30"], ["60 dias", "days60"], ["90 dias", "days90"], ["120 dias", "days120"], ["6 meses", "months6"], ["12 meses", "months12"]].map(([value, key]) => (
                <button key={value} onClick={() => setLaudoInssForm(f => ({ ...f, tempoAfastamento: value }))} className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all border cursor-pointer ${laudoInssForm.tempoAfastamento === value ? "bg-amber-100 text-amber-700 border-amber-400 dark:bg-amber-950/50 dark:text-amber-300" : "bg-card text-muted-foreground border-border"}`} style={{ fontFamily: "inherit" }}>{tr(key as "days30")}</button>
              ))}
            </div>
            <input type="text" placeholder={tr("manualLeavePlaceholder")} value={laudoInssForm.tempoAfastamento} onChange={e => setLaudoInssForm(f => ({ ...f, tempoAfastamento: e.target.value }))} className="w-full px-3 py-2 rounded-md border border-input bg-background text-foreground text-sm outline-none focus:border-primary transition-colors" style={{ fontFamily: "inherit" }} />
          </div>

          {/* Observações */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm font-semibold text-muted-foreground">{tr("additionalNotes")} <span className="font-normal text-muted-foreground/60">{tr("optional")}</span></Label>
            <textarea rows={2} placeholder={tr("notesPlaceholder")} value={laudoInssForm.observacoes} onChange={e => setLaudoInssForm(f => ({ ...f, observacoes: e.target.value }))} className="w-full px-3 py-2 rounded-md border border-input bg-background text-foreground text-sm resize-vertical outline-none focus:border-primary transition-colors" style={{ fontFamily: "inherit", lineHeight: 1.6 }} />
          </div>

          {/* Buttons */}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => setLaudoInssOpen(false)}>{tr("cancel")}</Button>
            <Button size="sm" disabled={updateMutation.isPending} onClick={handleSalvarLaudoInss} style={{ background: "#0B1F4B" }} className="gap-2">
              <FileDown className="h-4 w-4" />{tr("saveGeneratePdf")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    {/* ── Modal Editar Cadastro ── */}
    <Dialog open={editOpen} onOpenChange={setEditOpen}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4 text-primary" />
            {tr("editPatient")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {tr("editPatientDescription")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSaveEdit} className="space-y-4 pt-1">

          {/* Nome */}
          <div className="space-y-1.5">
            <Label htmlFor="edit-nome" className="text-sm font-medium">{tr("fullNameEdit")}</Label>
            <Input
              id="edit-nome"
              value={editForm.nome}
              onChange={e => setEditForm(f => ({ ...f, nome: e.target.value.toLocaleUpperCase("pt-BR") }))}
              placeholder={tr("fullNamePlaceholder")}
              required
            />
          </div>

          {/* CPF + Telefone */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5 min-w-0">
              <Label htmlFor="edit-cpf" className="text-sm font-medium">CPF</Label>
              <Input
                id="edit-cpf"
                value={editForm.cpf}
                onChange={e => setEditForm(f => ({ ...f, cpf: formatCpf(e.target.value) }))}
                placeholder="000.000.000-00"
                maxLength={14}
              />
              <p className="text-xs text-muted-foreground">{tr("accessPasswordHelp")}</p>
            </div>
            <div className="space-y-1.5 min-w-0">
              <Label htmlFor="edit-telefone" className="text-sm font-medium">{tr("phone")}</Label>
              <Input
                id="edit-telefone"
                value={editForm.telefone}
                onChange={e => setEditForm(f => ({ ...f, telefone: e.target.value }))}
                placeholder="(00) 00000-0000"
              />
            </div>
          </div>

          {/* Email + Data Nascimento */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5 min-w-0">
              <Label htmlFor="edit-email" className="text-sm font-medium">{tr("email")}</Label>
              <Input
                id="edit-email"
                type="email"
                value={editForm.email}
                onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}
                placeholder={tr("emailPlaceholder")}
              />
            </div>
            <div className="space-y-1.5 min-w-0">
              <Label htmlFor="edit-nascimento" className="text-sm font-medium">{tr("birthDate")}</Label>
              <DateInput
                id="edit-nascimento"
                value={editForm.dataNascimento}
                onValueChange={(v) => setEditForm(f => ({ ...f, dataNascimento: v }))}
              />
            </div>
          </div>

          {/* Sexo */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">{tr("sex")}</Label>
            <Select value={editForm.sexo} onValueChange={v => setEditForm(f => ({ ...f, sexo: v }))}>
              <SelectTrigger><SelectValue placeholder={tr("select")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="M">{tr("male")}</SelectItem>
                <SelectItem value="F">{tr("female")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* País de Residência */}
          <div className="space-y-1.5">
            <Label htmlFor="edit-pais" className="text-sm font-medium">{tr("country")}</Label>
            <Input
              id="edit-pais"
              value={editForm.pais}
              onChange={e => setEditForm(f => ({ ...f, pais: e.target.value }))}
              placeholder={tr("countryPlaceholder")}
            />
          </div>

          {/* Plano de Saúde + Carteirinha + Indicado por */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5 min-w-0">
              <Label className="text-sm font-medium">{tr("healthPlan")}</Label>
              <Input
                value={editForm.planoSaude}
                onChange={e => setEditForm(f => ({ ...f, planoSaude: e.target.value }))}
                placeholder={tr("healthPlanPlaceholder")}
              />
            </div>
            <div className="space-y-1.5 min-w-0">
              <Label className="text-sm font-medium">{tr("memberNumber")}</Label>
              <Input
                value={editForm.numeroCarteirinha}
                onChange={e => setEditForm(f => ({ ...f, numeroCarteirinha: e.target.value }))}
                placeholder="Ex: 0012345678901"
              />
            </div>
            <div className="space-y-1.5 min-w-0">
              <Label className="text-sm font-medium">{tr("referredBy")}</Label>
              <Input
                value={editForm.indicadoPor}
                onChange={e => setEditForm(f => ({ ...f, indicadoPor: e.target.value }))}
                placeholder={tr("referredByPlaceholder")}
              />
            </div>
          </div>

          {/* Endereço */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">{tr("address")}</Label>
            <Input
              value={editForm.endereco}
              onChange={e => setEditForm(f => ({ ...f, endereco: e.target.value }))}
              placeholder={tr("addressPlaceholder")}
            />
          </div>

          {/* Cidade + Estado + CEP */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5 min-w-0">
              <Label className="text-sm font-medium">{tr("city")}</Label>
              <Input
                value={editForm.cidade}
                onChange={e => setEditForm(f => ({ ...f, cidade: e.target.value }))}
                placeholder={tr("cityPlaceholder")}
              />
            </div>
            <div className="space-y-1.5 min-w-0">
              <Label className="text-sm font-medium">{tr("state")}</Label>
              <Input
                value={editForm.estado}
                onChange={e => setEditForm(f => ({ ...f, estado: e.target.value }))}
                placeholder="SP"
                maxLength={2}
              />
            </div>
            <div className="space-y-1.5 min-w-0">
              <Label className="text-sm font-medium">CEP</Label>
              <Input
                value={editForm.cep}
                onChange={e => setEditForm(f => ({ ...f, cep: e.target.value }))}
                placeholder="00000-000"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>{tr("cancel")}</Button>
            <Button type="submit" disabled={updateMutation.isPending} className="gap-2">
              <Save className="h-4 w-4" />
              {updateMutation.isPending ? tr("saving") : tr("saveChanges")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
    </>
  );
}
