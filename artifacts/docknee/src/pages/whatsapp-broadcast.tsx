import { useState, useMemo, useEffect, useRef } from "react";
import { format } from "date-fns";
import {
  MessageCircle, Search, CheckSquare, Square, Users, Phone, Filter,
  X, ChevronDown, ChevronUp, Send, Calendar, Copy, Check, AlertCircle,
  Paperclip, Upload, FileText, FileImage, Film, File, Trash2, Link,
  Zap, Loader2, CheckCircle2, XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { sortByPtBrName } from "@/lib/utils";
import { useWhatsappBroadcastTranslations } from "@/locales/whatsapp-broadcast";

const WA_GREEN = "#25D366";

const ALL_PROCEDURES = "__ALL__";

const PROCEDURE_TYPES = [
  { value: ALL_PROCEDURES, labelKey: "procedureAll" },
  { value: "Lesão Ligamentar", labelKey: "procedureLigamentInjury" },
  { value: "LCA", labelKey: "procedureAcl" },
  { value: "LCP", labelKey: "procedurePcl" },
  { value: "Osteotomia", labelKey: "procedureOsteotomy" },
  { value: "Lesões Osteocondrais", labelKey: "procedureOsteochondral" },
  { value: "Ácido Hialurônico", labelKey: "procedureHyaluronicAcid" },
  { value: "Meniscal", labelKey: "procedureMeniscal" },
  { value: "Patela", labelKey: "procedurePatella" },
] as const;

const AVATAR_COLORS = [
  "#0A1628", "#1FB6E1", "#2D6A4F", "#8338EC", "#E63946", "#F77F00",
  "#2B9348", "#457B9D", "#6D2B7A", "#C77DFF",
];

function cleanPhone(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 8) return null;
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  return `55${digits}`;
}

function buildWaLink(phone: string, message: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

interface WaPatient {
  id: number;
  nome: string;
  telefone: string | null;
  email: string | null;
  sexo: string | null;
  dataNascimento: string | null;
  surgeries: {
    id: number;
    dataCirurgia: string | null;
    tiposProcedimento: string[];
    procedimentoRealizado: string | null;
    lado: string | null;
    hospital: string | null;
  }[];
}

export default function WhatsappBroadcast() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { t } = useWhatsappBroadcastTranslations();
  const doctorName = user?.nome ?? "Dr(a).";

  // Filters
  const [procedureType, setProcedureType] = useState(ALL_PROCEDURES);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Results
  const [patients, setPatients] = useState<WaPatient[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Message — initialise once doctor name is known
  const [messageTemplate, setMessageTemplate] = useState("");
  const messageInitialized = useRef(false);
  useEffect(() => {
    if (!doctorName || messageInitialized.current) return;
    messageInitialized.current = true;
    setMessageTemplate(current => current || t("defaultMessage", { doctor: doctorName }));
  }, [doctorName, t]);
  const [showSendPanel, setShowSendPanel] = useState(false);

  // Campaign file attachment
  interface CampaignFile {
    fileName: string;
    mimeType: string;
    objectPath: string;
    shareUrl: string;
  }
  const [campaignFile, setCampaignFile] = useState<CampaignFile | null>(null);
  const [campaignUploading, setCampaignUploading] = useState(false);
  const [campaignUploadProgress, setCampaignUploadProgress] = useState(0);

  const handleCampaignUpload = async (files: FileList) => {
    const file = files[0];
    if (!file) return;
    setCampaignUploading(true);
    setCampaignUploadProgress(10);
    try {
      // 1. Request a pre-authorised upload grant (whatsapp_broadcast purpose).
      //    No share URL is returned yet — it is issued only after the real
      //    uploaded object is validated in step 3 (finalize).
      const urlRes = await fetch("/api/storage/uploads/request-url", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, contentType: file.type, size: file.size, purpose: "whatsapp_broadcast" }),
      });
      if (!urlRes.ok) throw new Error(t("uploadUrlError"));
      const { uploadURL, token } = await urlRes.json();
      if (!token) throw new Error(t("uploadTokenError"));
      setCampaignUploadProgress(40);

      // 2. Upload file directly to storage
      const uploadRes = await fetch(uploadURL, {
        method: "PUT", body: file, headers: { "Content-Type": file.type },
      });
      if (!uploadRes.ok) throw new Error(t("uploadError"));
      setCampaignUploadProgress(70);

      // 3. Finalize: server validates the real object and returns a signed
      //    GCS GET URL (24 h) that patients can open without authentication.
      const finalizeRes = await fetch("/api/storage/uploads/finalize", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!finalizeRes.ok) throw new Error(t("uploadValidationError"));
      const { objectPath, shareUrl: signedShareUrl } = await finalizeRes.json();
      if (!signedShareUrl) throw new Error(t("shareUrlError"));
      setCampaignUploadProgress(95);

      // shareUrl is a signed GCS URL — no auth needed for the patient to open it
      setCampaignFile({ fileName: file.name, mimeType: file.type, objectPath, shareUrl: signedShareUrl });
      setCampaignUploadProgress(100);
      toast({ title: t("fileAttached"), description: file.name });
    } catch (err: any) {
      toast({ title: t("uploadToastError"), description: err?.message ?? t("tryAgain"), variant: "destructive" });
    } finally {
      setCampaignUploading(false);
      setCampaignUploadProgress(0);
    }
  };

  // Search
  const handleSearch = async () => {
    setLoading(true);
    setSearched(false);
    setSelectedIds(new Set());
    setShowSendPanel(false);
    try {
      const params = new URLSearchParams();
      if (procedureType && procedureType !== ALL_PROCEDURES) params.set("procedureType", procedureType);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      const res = await fetch(`/api/wa-broadcast/patients?${params.toString()}`, {
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error(t("patientSearchError"));
      const data: WaPatient[] = await res.json();
      setPatients(sortByPtBrName(data, (patient) => patient.nome, (patient) => patient.id));
      setSearched(true);
    } catch {
      toast({ title: t("error"), description: t("patientSearchDescriptionError"), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const patientsWithPhone = useMemo(() => patients.filter(p => cleanPhone(p.telefone)), [patients]);
  const selectedList = useMemo(() => patients.filter(p => selectedIds.has(p.id)), [patients, selectedIds]);
  const selectedWithPhone = useMemo(() => selectedList.filter(p => cleanPhone(p.telefone)), [selectedList]);

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(patients.map(p => p.id)));
  const deselectAll = () => setSelectedIds(new Set());
  const selectAllWithPhone = () => setSelectedIds(new Set(patientsWithPhone.map(p => p.id)));

  const allSelected = patients.length > 0 && selectedIds.size === patients.length;
  const someSelected = selectedIds.size > 0 && !allSelected;

  const resolveMessage = (template: string, nome: string) =>
    template
      .replace(/\{nome\}/gi, nome.split(" ")[0])
      .replace(/\{medico\}/gi, doctorName)
      .replace(/\{link\}/gi, campaignFile?.shareUrl ?? "");

  const procedureLabel = (value: string) => {
    const procedure = PROCEDURE_TYPES.find(option => option.value === value);
    return procedure ? t(procedure.labelKey) : value;
  };

  // Platform send (bulk dispatch via API)
  interface SendResult { id: number; nome: string; ok: boolean; error?: string; }
  const [sendResults, setSendResults] = useState<Map<number, SendResult>>(new Map());
  const [isSendingAll, setIsSendingAll] = useState(false);
  const [sendDone, setSendDone] = useState(false);

  const handleSendAll = async () => {
    if (isSendingAll || selectedWithPhone.length === 0) return;
    setIsSendingAll(true);
    setSendDone(false);
    setSendResults(new Map());
    try {
      const res = await fetch("/api/wa-broadcast/send", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientIds: selectedWithPhone.map(p => p.id),
          messageTemplate,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: t("sendError"), description: data.error, variant: "destructive" });
        return;
      }
      const map = new Map<number, SendResult>();
      for (const r of (data.results as SendResult[])) map.set(r.id, r);
      setSendResults(map);
      setSendDone(true);
      const ok = data.results.filter((r: SendResult) => r.ok).length;
      const fail = data.results.filter((r: SendResult) => !r.ok).length;
      toast({
        title: ok > 0
          ? t("messagesSent", {
              count: ok,
              messages: t(ok === 1 ? "singularMessage" : "pluralMessages"),
              sent: t(ok === 1 ? "singularSent" : "pluralSent"),
            })
          : t("noMessageSent"),
        description: fail > 0
          ? t("failuresCheckBelow", {
              count: fail,
              failures: t(fail === 1 ? "singularFailure" : "pluralFailures"),
            })
          : undefined,
        variant: ok > 0 ? "default" : "destructive",
      });
    } catch {
      toast({ title: t("connectionError"), variant: "destructive" });
    } finally {
      setIsSendingAll(false);
    }
  };

  const [copiedId, setCopiedId] = useState<number | null>(null);
  const copyLink = (link: string, id: number) => {
    navigator.clipboard.writeText(link).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const formatSurgeryDate = (d: string | null) => {
    if (!d) return "—";
    try { return format(new Date(d + "T12:00:00"), "dd/MM/yyyy"); }
    catch { return d; }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Page header */}
      <div className="border-b border-border bg-card">
        <div className="max-w-4xl mx-auto px-4 md:px-6 py-5">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: `${WA_GREEN}20` }}
            >
              <MessageCircle className="h-5 w-5" style={{ color: WA_GREEN }} />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">{t("title")}</h1>
              <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 md:px-6 py-6 space-y-6">

        {/* ── FILTER CARD ── */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Filter className="h-4 w-4 text-primary" />
            <h2 className="font-semibold text-foreground text-sm">{t("searchFilters")}</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            {/* Procedure type */}
            <div className="space-y-1.5 md:col-span-3">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("procedureType")}</Label>
              <Select value={procedureType} onValueChange={setProcedureType}>
                <SelectTrigger>
                  <SelectValue placeholder={t("procedureAll")} />
                </SelectTrigger>
                <SelectContent>
                  {PROCEDURE_TYPES.map(pt => (
                    <SelectItem key={pt.value || "__all"} value={pt.value || "__all_placeholder"}>
                      {t(pt.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Date From */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                 <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{t("surgeryDateFrom")}</span>
              </Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="text-sm"
              />
            </div>

            {/* Date To */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                 <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{t("surgeryDateTo")}</span>
              </Label>
              <Input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="text-sm"
              />
            </div>

            {/* Clear filters */}
            <div className="flex items-end">
              {(procedureType !== ALL_PROCEDURES || dateFrom || dateTo) && (
                <button
                  onClick={() => { setProcedureType(ALL_PROCEDURES); setDateFrom(""); setDateTo(""); }}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-muted"
                >
                  <X className="h-3 w-3" />
                   {t("clearFilters")}
                </button>
              )}
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <Button onClick={handleSearch} disabled={loading} className="gap-2">
              <Search className="h-4 w-4" />
               {loading ? t("searching") : t("searchPatients")}
            </Button>
          </div>

          {/* Active filter summary */}
          {(procedureType !== ALL_PROCEDURES || dateFrom || dateTo) && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {procedureType !== ALL_PROCEDURES && (
                <Badge variant="secondary" className="text-xs gap-1">
                   {t("procedureFilter", { procedure: procedureLabel(procedureType) })}
                  <button onClick={() => setProcedureType(ALL_PROCEDURES)}><X className="h-3 w-3" /></button>
                </Badge>
              )}
              {dateFrom && (
                <Badge variant="secondary" className="text-xs gap-1">
                   {t("fromFilter", { date: formatSurgeryDate(dateFrom) })}
                  <button onClick={() => setDateFrom("")}><X className="h-3 w-3" /></button>
                </Badge>
              )}
              {dateTo && (
                <Badge variant="secondary" className="text-xs gap-1">
                   {t("toFilter", { date: formatSurgeryDate(dateTo) })}
                  <button onClick={() => setDateTo("")}><X className="h-3 w-3" /></button>
                </Badge>
              )}
            </div>
          )}
        </div>

        {/* ── RESULTS ── */}
        {searched && (
          <>
            {patients.length === 0 ? (
              <div className="rounded-xl border border-border bg-card p-10 flex flex-col items-center gap-3 text-center">
                <AlertCircle className="h-8 w-8 text-muted-foreground/40" />
                 <p className="font-medium text-foreground">{t("noPatients")}</p>
                 <p className="text-sm text-muted-foreground">{t("adjustFilters")}</p>
              </div>
            ) : (
              <>
                {/* Summary bar */}
                <div className="rounded-xl border border-border bg-card px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-4 flex-wrap">
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">
                           {t("patientsFound", {
                             count: patients.length,
                             patients: t(patients.length === 1 ? "singularPatient" : "pluralPatients"),
                             found: t(patients.length === 1 ? "singularFound" : "pluralFound"),
                           })}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Phone className="h-4 w-4" style={{ color: WA_GREEN }} />
                        <span className="text-sm text-muted-foreground">
                           <span className="font-semibold" style={{ color: WA_GREEN }}>{patientsWithPhone.length}</span> {t("withWhatsapp")}
                        </span>
                      </div>
                      {selectedIds.size > 0 && (
                        <div className="flex items-center gap-2">
                          <CheckSquare className="h-4 w-4 text-primary" />
                          <span className="text-sm font-semibold text-primary">
                             {t("selectedWithWhatsapp", {
                               count: selectedIds.size,
                               selected: t(selectedIds.size === 1 ? "singularSelected" : "pluralSelected"),
                               whatsappCount: selectedWithPhone.length,
                             })}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Select buttons */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={selectAllWithPhone}
                        className="text-xs font-medium px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors"
                        style={{ color: WA_GREEN }}
                      >
                         {t("selectWithWhatsapp")}
                      </button>
                      <button
                        onClick={allSelected ? deselectAll : selectAll}
                        className="text-xs font-medium px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors text-foreground"
                      >
                         {allSelected ? t("deselectAll") : t("selectAll")}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Patient list */}
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                  <div className="divide-y divide-border">
                    {patients.map((patient) => {
                      const selected = selectedIds.has(patient.id);
                      const phone = cleanPhone(patient.telefone);
                      const hasWa = !!phone;
                      const initials = patient.nome.split(" ").slice(0, 2).map((n: string) => n[0]).join("").toUpperCase();
                      const color = AVATAR_COLORS[patient.id % AVATAR_COLORS.length];
                      const topSurgery = patient.surgeries[0];

                      return (
                        <div
                          key={patient.id}
                          onClick={() => toggleSelect(patient.id)}
                          className={`flex items-start gap-3 px-4 py-3.5 cursor-pointer transition-colors ${
                            selected ? "bg-primary/5 dark:bg-primary/10" : "hover:bg-muted/40"
                          }`}
                        >
                          {/* Checkbox */}
                          <div className="mt-0.5 shrink-0">
                            {selected
                              ? <CheckSquare className="h-5 w-5 text-primary" />
                              : <Square className="h-5 w-5 text-muted-foreground/40" />
                            }
                          </div>

                          {/* Avatar */}
                          <div
                            className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-xs shrink-0"
                            style={{ background: color }}
                          >
                            {initials}
                          </div>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2 flex-wrap">
                              <div>
                                <p className="font-medium text-foreground text-sm">{patient.nome}</p>
                                {patient.telefone && (
                                  <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                                    <Phone className="h-3 w-3" />
                                    {patient.telefone}
                                  </p>
                                )}
                              </div>

                              <div className="flex flex-col items-end gap-1 shrink-0">
                                {hasWa ? (
                                  <Badge className="text-[10px] gap-1 px-2 py-0.5" style={{ background: `${WA_GREEN}20`, color: WA_GREEN, border: `1px solid ${WA_GREEN}40` }}>
                                    <MessageCircle className="h-3 w-3" />
                                    WhatsApp
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-[10px] text-muted-foreground/50 px-2 py-0.5">
                                     {t("noPhone")}
                                  </Badge>
                                )}
                              </div>
                            </div>

                            {/* Surgery info */}
                            {topSurgery && (
                              <div className="mt-1.5 flex flex-wrap gap-1">
                                {topSurgery.dataCirurgia && (
                                  <span className="text-[11px] bg-muted text-muted-foreground rounded px-1.5 py-0.5">
                                    {formatSurgeryDate(topSurgery.dataCirurgia)}
                                  </span>
                                )}
                                {topSurgery.tiposProcedimento.slice(0, 3).map((tp: string) => (
                                  <span key={tp} className="text-[11px] bg-primary/10 text-primary rounded px-1.5 py-0.5 font-medium">
                                     {procedureLabel(tp)}
                                  </span>
                                ))}
                                {topSurgery.lado && (
                                  <span className="text-[11px] bg-muted text-muted-foreground rounded px-1.5 py-0.5">
                                    {topSurgery.lado}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {/* ── MESSAGE COMPOSER ── */}
        {selectedIds.size > 0 && (
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Send className="h-4 w-4 text-primary" />
                <h2 className="font-semibold text-foreground text-sm">
                   {t("messageForPatients", {
                     count: selectedIds.size,
                     patients: t(selectedIds.size === 1 ? "singularPatient" : "pluralPatients"),
                   })}
                </h2>
              </div>
              <button
                onClick={() => setShowSendPanel(prev => !prev)}
                className="flex items-center gap-1 text-xs text-primary font-medium hover:underline"
              >
                 {showSendPanel ? <><ChevronUp className="h-3.5 w-3.5" />{t("close")}</>
                   : <><ChevronDown className="h-3.5 w-3.5" />{t("viewSends")}</>}
              </button>
            </div>

            {/* ── Campaign File Attachment ── */}
            <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Paperclip className="h-4 w-4 text-primary" />
                   <span className="text-sm font-semibold text-foreground">{t("campaignFile")}</span>
                   <span className="text-xs text-muted-foreground">{t("optional")}</span>
                </div>
                {campaignFile && (
                  <button
                    onClick={() => setCampaignFile(null)}
                    className="flex items-center gap-1 text-xs text-destructive hover:underline"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                     {t("remove")}
                  </button>
                )}
              </div>

              {/* Upload in progress */}
              {campaignUploading && (
                <div className="rounded-lg border border-border bg-background px-3 py-2.5">
                  <div className="flex items-center justify-between mb-1.5">
                     <span className="text-xs text-muted-foreground">{t("uploadingFile")}</span>
                    <span className="text-xs font-medium text-foreground">{campaignUploadProgress}%</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{ width: `${campaignUploadProgress}%`, background: "#1FB6E1" }}
                    />
                  </div>
                </div>
              )}

              {/* No file yet */}
              {!campaignFile && !campaignUploading && (
                <label className="cursor-pointer block">
                  <input
                    type="file"
                    className="hidden"
                    accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,video/*"
                    onChange={e => e.target.files && handleCampaignUpload(e.target.files)}
                  />
                  <div className="flex flex-col items-center justify-center py-7 gap-2 border-2 border-dashed border-border rounded-xl hover:border-primary/50 transition-colors text-center">
                    <div className="w-10 h-10 rounded-xl bg-muted/60 flex items-center justify-center">
                      <Upload className="h-5 w-5 text-muted-foreground/50" />
                    </div>
                    <div>
                       <p className="text-sm font-medium text-foreground">{t("clickToAttach")}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                         {t("acceptedFiles")}
                      </p>
                      <p className="text-xs text-muted-foreground/70 mt-1">
                         {t("linkVariableHelp")}
                      </p>
                    </div>
                  </div>
                </label>
              )}

              {/* File attached — show preview */}
              {campaignFile && !campaignUploading && (() => {
                const isImage = campaignFile.mimeType.startsWith("image/");
                const isVideo = campaignFile.mimeType.startsWith("video/");
                const isPdf   = campaignFile.mimeType === "application/pdf";
                const IconComp = isImage ? FileImage : isVideo ? Film : isPdf ? FileText : File;
                const iconColor = isImage ? "#1FB6E1" : isVideo ? "#8338EC" : isPdf ? "#E63946" : "#6B7280";
                return (
                  <div className="space-y-2.5">
                    {/* File row */}
                    <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-background">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${iconColor}18` }}>
                        <IconComp style={{ color: iconColor, width: 18, height: 18 }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{campaignFile.fileName}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                          <Link className="h-3 w-3" />
                           {t("linkGenerated")}
                        </p>
                      </div>
                      <Badge variant="outline" className="text-xs shrink-0" style={{ color: "#2B9348", borderColor: "#2B9348" }}>
                         {t("ready")}
                      </Badge>
                    </div>

                    {/* Share URL box */}
                    <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
                       <p className="text-[10px] text-muted-foreground mb-1 font-medium uppercase tracking-wide">{t("fileUrlHelp")}</p>
                      <p className="text-xs text-foreground font-mono break-all leading-relaxed">{campaignFile.shareUrl}</p>
                    </div>

                    {/* Tip: add {link} if not in template */}
                    {!messageTemplate.includes("{link}") && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-3 py-2 flex items-start gap-2">
                        <AlertCircle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-xs text-amber-700 dark:text-amber-300">
                             {t("addLinkHelp")}
                          </p>
                          <button
                             onClick={() => setMessageTemplate(template => template + t("attachmentMessage"))}
                            className="text-xs font-semibold text-amber-700 dark:text-amber-300 underline underline-offset-2 shrink-0"
                          >
                             {t("insertNow")}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Variable hint */}
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 flex items-start gap-2">
              <AlertCircle className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
              <p className="text-xs text-muted-foreground">
                 {t("variables")}{" "}
                <code className="bg-muted px-1 rounded text-foreground font-mono">{"{nome}"}</code>{" "}
                 {t("patientFirstName")} ·{" "}
                <code className="bg-muted px-1 rounded text-foreground font-mono">{"{medico}"}</code>{" "}
                 {t("doctorName")} ·{" "}
                <code className="bg-muted px-1 rounded text-foreground font-mono">{"{link}"}</code>{" "}
                 {t("attachedFileLink")}
              </p>
            </div>

            <div className="space-y-1.5">
               <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("message")}</Label>
              <Textarea
                rows={6}
                value={messageTemplate}
                onChange={e => setMessageTemplate(e.target.value)}
                 placeholder={t("messagePlaceholder")}
                className="text-sm font-normal resize-none"
              />
            </div>

            {/* Preview */}
            {selectedList.length > 0 && (
              <div className="space-y-1.5">
                 <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("preview")}</Label>
                <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
                  <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                    {resolveMessage(messageTemplate, selectedList[0].nome)}
                  </p>
                </div>
              </div>
            )}

            {/* Summary of selected without phone */}
            {selectedIds.size > selectedWithPhone.length && (
              <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-2 flex items-center gap-2">
                <AlertCircle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                <p className="text-xs text-amber-700 dark:text-amber-300">
                   {t("withoutPhoneWarning", {
                     count: selectedIds.size - selectedWithPhone.length,
                     patients: t(selectedIds.size - selectedWithPhone.length === 1 ? "singularPatient" : "pluralPatients"),
                     willNotReceive: t(selectedIds.size - selectedWithPhone.length === 1 ? "singularWillNotReceive" : "pluralWillNotReceive"),
                   })}
                </p>
              </div>
            )}

            <Button
              onClick={() => setShowSendPanel(true)}
              disabled={selectedWithPhone.length === 0}
              className="w-full gap-2 text-white font-semibold"
              style={{ background: WA_GREEN }}
            >
              <MessageCircle className="h-4 w-4" />
               {t("generateLinks", {
                 count: selectedWithPhone.length,
                 patients: t(selectedWithPhone.length === 1 ? "singularPatient" : "pluralPatients"),
               })}
            </Button>
          </div>
        )}

        {/* ── SEND PANEL ── */}
        {showSendPanel && selectedWithPhone.length > 0 && (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <MessageCircle className="h-4 w-4" style={{ color: WA_GREEN }} />
                <h2 className="font-semibold text-foreground text-sm">
                   {t("sendToPatients", {
                     count: selectedWithPhone.length,
                     patients: t(selectedWithPhone.length === 1 ? "singularPatient" : "pluralPatients"),
                   })}
                </h2>
              </div>
              {/* Dispatch all via platform */}
              <Button
                onClick={handleSendAll}
                disabled={isSendingAll}
                size="sm"
                className="gap-2 text-white font-semibold shrink-0"
                style={{ background: isSendingAll ? "#666" : "#0A1628" }}
              >
                {isSendingAll
                   ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />{t("sending")}</>
                   : <><Zap className="h-3.5 w-3.5" />{t("sendAll")}</>
                }
              </Button>
            </div>

            {/* Result summary banner */}
            {sendDone && sendResults.size > 0 && (() => {
              const ok = [...sendResults.values()].filter(r => r.ok).length;
              const fail = [...sendResults.values()].filter(r => !r.ok).length;
              return (
                <div className={`px-5 py-3 flex items-center gap-2 text-sm font-medium border-b border-border ${ok > 0 && fail === 0 ? "bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400" : fail > 0 && ok === 0 ? "bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400" : "bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400"}`}>
                  {ok > 0 && fail === 0
                     ? <><CheckCircle2 className="h-4 w-4 shrink-0" />{t("sentSuccessfully", {
                         count: ok,
                         messages: t(ok === 1 ? "singularMessage" : "pluralMessages"),
                         sent: t(ok === 1 ? "singularSent" : "pluralSent"),
                       })}</>
                    : ok > 0
                       ? <><AlertCircle className="h-4 w-4 shrink-0" />{t("partialSuccess", {
                           sentCount: ok,
                           sent: t(ok === 1 ? "singularSent" : "pluralSent"),
                           failureCount: fail,
                           failures: t(fail === 1 ? "singularFailure" : "pluralFailures"),
                         })}</>
                       : <><XCircle className="h-4 w-4 shrink-0" />{t("noneSentCheckErrors")}</>
                  }
                </div>
              );
            })()}

            <div className="divide-y divide-border">
              {selectedWithPhone.map((patient) => {
                const phone = cleanPhone(patient.telefone)!;
                const msg = resolveMessage(messageTemplate, patient.nome);
                const link = buildWaLink(phone, msg);
                const initials = patient.nome.split(" ").slice(0, 2).map((n: string) => n[0]).join("").toUpperCase();
                const color = AVATAR_COLORS[patient.id % AVATAR_COLORS.length];
                const copied = copiedId === patient.id;
                const result = sendResults.get(patient.id);

                return (
                  <div key={patient.id} className="flex items-center gap-3 px-4 py-3">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs shrink-0"
                      style={{ background: color }}
                    >
                      {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{patient.nome}</p>
                      <p className="text-xs text-muted-foreground">{patient.telefone}</p>
                      {result && !result.ok && result.error && (
                        <p className="text-xs text-red-500 mt-0.5 flex items-center gap-1">
                          <XCircle className="h-3 w-3 shrink-0" />
                          {result.error}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Platform send status */}
                      {isSendingAll && !result && (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      )}
                      {result?.ok && (
                        <span className="flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400">
                          <CheckCircle2 className="h-4 w-4" />
                           {t("sentStatus")}
                        </span>
                      )}
                      {result && !result.ok && (
                        <span className="flex items-center gap-1 text-xs font-medium text-red-500">
                          <XCircle className="h-4 w-4" />
                           {t("failedStatus")}
                        </span>
                      )}
                      {/* Manual fallback */}
                      <button
                        onClick={() => copyLink(link, patient.id)}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                         title={t("copyLink")}
                      >
                        {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                      </button>
                      <a
                        href={link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all hover:opacity-90 active:scale-95"
                        style={{ background: WA_GREEN }}
                        onClick={e => e.stopPropagation()}
                      >
                        <MessageCircle className="h-3.5 w-3.5" />
                         {t("openWhatsapp")}
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="px-5 py-3 bg-muted/30 border-t border-border flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                 {t("sendModeHelp")}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
