/** Página da cirurgia de ombro/cotovelo: registro, relatório, fotos, fisioterapia e seguimento. */
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getGetSurgeryQueryKey, useDeleteSurgery, useGetSurgery } from "@workspace/api-client-react";
import { ArrowLeft, Calendar, ClipboardList, Download, ExternalLink, FileText, Loader2, Pencil, Save, Trash2, X } from "lucide-react";
import { CASE_TYPE_BY_KEY, type ClinicalPayload } from "@workspace/clinical/web";
import { SurgeryClinicalView, useSurgeryReport } from "@/components/shoulder/surgery-clinical-view";
import { SurgeryFollowupSection, type SurgeryFollowup } from "@/components/shoulder/surgery-followup-section";
import { SurgeryRehabSection } from "@/components/shoulder/surgery-rehab-section";
import { SurgeryMedia } from "@/components/surgery-media";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { handlePdfOpenClick, sharePdfOrDownload } from "@/lib/pdf-share";
import { generateShoulderReportPDF, reportFilename } from "@/lib/shoulder-report-pdf";
import { surgeryViewMessages } from "@/locales/surgery-view";

const mobileButton = { display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 500, padding: "8px 12px", borderRadius: 10, background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.8)", border: "none", cursor: "pointer" } as const;

export default function SurgeryDetail() {
  const { formatDate, locale } = useLanguage();
  const t = useScopedTranslations(surgeryViewMessages);
  const params = useParams();
  const id = parseInt(params.id || "0");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: surgery, isLoading, error } = useGetSurgery(id, {
    query: { queryKey: getGetSurgeryQueryKey(id), enabled: !!id },
  });
  const lado = (surgery as { lado?: string | null } | undefined)?.lado ?? null;
  const clinicalPayload = (surgery?.regiao && surgery.dadosClinicos ? surgery.dadosClinicos : null) as ClinicalPayload | null;
  // Data, lado e hospital entram no relatório: recarrega quando mudam.
  const report = useSurgeryReport(surgery?.id ?? null, !!clinicalPayload, `${surgery?.dataCirurgia}|${lado}|${surgery?.hospital}`);
  const deleteMutation = useDeleteSurgery();

  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfShareUrl, setPdfShareUrl] = useState<string | null>(null);
  const pdfGenerationRef = useRef(0);
  const [editingLado, setEditingLado] = useState(false);
  const [ladoValue, setLadoValue] = useState("");
  const [savingLado, setSavingLado] = useState(false);
  const [editingData, setEditingData] = useState(false);
  const [dataValue, setDataValue] = useState("");
  const [savingData, setSavingData] = useState(false);

  // O link diferido do PDF pertence à versão da cirurgia que o gerou.
  useEffect(() => {
    pdfGenerationRef.current += 1;
    setPdfShareUrl(null);
  }, [surgery, locale]);

  const sideLabel = (value: string | null | undefined) =>
    value === "Direito" ? t("t_right") : value === "Esquerdo" ? t("t_left") : value || "-";

  const patchSurgery = async (body: Record<string, unknown>) => {
    const r = await fetch(`/api/surgeries/${id}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.ok) await queryClient.invalidateQueries({ queryKey: getGetSurgeryQueryKey(id) });
    return r.ok;
  };

  const saveLado = async (value: string) => {
    setSavingLado(true);
    try {
      if (await patchSurgery({ lado: value || null })) { setEditingLado(false); toast({ title: t("t_sideUpdated") }); }
      else toast({ title: t("t_error"), variant: "destructive" });
    } catch {
      toast({ title: t("t_error"), variant: "destructive" });
    } finally { setSavingLado(false); }
  };

  const saveData = async (value: string) => {
    if (!value) return;
    setSavingData(true);
    try {
      if (await patchSurgery({ dataCirurgia: value })) { setEditingData(false); toast({ title: t("t_dateUpdated") }); }
      else toast({ title: t("t_error"), variant: "destructive" });
    } catch {
      toast({ title: t("t_error"), variant: "destructive" });
    } finally { setSavingData(false); }
  };

  const handleDownloadPDF = async () => {
    if (!surgery || report.status !== "ready") return;
    const generation = ++pdfGenerationRef.current;
    setPdfShareUrl(null);
    setPdfLoading(true);
    try {
      const { doc, filename } = generateShoulderReportPDF(report.texto, { patientName: surgery.patient.nome, date: surgery.dataCirurgia });
      const result = await sharePdfOrDownload(doc, filename, (url) => {
        if (pdfGenerationRef.current === generation) setPdfShareUrl(url);
      });
      if (pdfGenerationRef.current !== generation) return;
      if (result.deferred) toast({ title: t("t_pdfReady"), description: t("t_pdfShareHint") });
    } catch (err) {
      if (pdfGenerationRef.current !== generation) return;
      console.error("Erro ao gerar PDF:", err);
      toast({ title: t("t_pdfError"), description: t("t_tryAgain"), variant: "destructive" });
    } finally {
      setPdfLoading(false);
    }
  };

  const handleDownloadTxt = () => {
    if (!surgery || report.status !== "ready") return;
    const url = URL.createObjectURL(new Blob([report.texto], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = reportFilename(surgery.patient.nome, surgery.dataCirurgia, "txt");
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleOpenPDF = () => {
    if (pdfShareUrl) handlePdfOpenClick(pdfShareUrl, () => setPdfShareUrl(null));
  };

  const handleDelete = () => {
    if (deleteMutation.isPending) return;
    deleteMutation.mutate({ id }, {
      onSuccess: () => { toast({ title: t("t_surgeryDeleted") }); setLocation("/surgeries"); },
      onError: (err: unknown) => {
        const status = typeof err === "object" && err && "status" in err ? (err as { status?: number }).status : undefined;
        if (status === 404) { toast({ title: t("t_surgeryAlreadyDeleted") }); setLocation("/surgeries"); return; }
        toast({ title: t("t_deleteSurgeryError"), variant: "destructive" });
      },
    });
  };

  if (isLoading) {
    return <div className="p-8 max-w-4xl mx-auto space-y-6" aria-label={t("t_loading")}><Skeleton className="h-10 w-1/3" /><Skeleton className="h-64 w-full" /></div>;
  }
  if (error || !surgery) {
    return <div className="p-8 text-center text-destructive">{t("t_loadSurgeryError")}</div>;
  }

  const reportReady = report.status === "ready";
  const regionLabel = surgery.regiao === "shoulder" ? t("shoulder") : surgery.regiao === "elbow" ? t("elbow") : "-";
  const deleteDialog = (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" className="gap-2"><Trash2 className="h-4 w-4" />{t("t_delete")}</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("t_deleteSurgeryTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("t_deleteSurgeryDescription")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("t_cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={handleDelete} disabled={deleteMutation.isPending} className="bg-destructive text-destructive-foreground">
            {deleteMutation.isPending ? t("t_deleting") : t("t_delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return (
    <div className="w-full max-w-5xl min-w-0 mx-auto">
      {/* ── Cabeçalho móvel ── */}
      <div className="md:hidden" style={{ background: "linear-gradient(135deg, #0A1628 0%, #0D2040 100%)" }}>
        <div className="px-4 pt-5 pb-3">
          <Link href="/surgeries">
            <button style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "rgba(31,182,225,0.85)", background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: 10 }}>
              <ArrowLeft className="h-3.5 w-3.5" />
              {t("t_proceduresNav")}
            </button>
          </Link>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "#fff", margin: 0 }}>{t("t_surgeryRecord")}</h1>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", margin: "3px 0 0" }}>
            {t("t_patientPrefix")} <span style={{ color: "#fff", fontWeight: 500 }}>{surgery.patient.nome}</span>
          </p>
        </div>
        <div className="px-4 pb-4 flex gap-2 flex-wrap">
          <Link href={`/patients/${surgery.patientId}`}>
            <button style={mobileButton}><ClipboardList className="h-4 w-4" />{t("t_medicalRecord")}</button>
          </Link>
          <Link href={`/surgeries/new?draft=${id}`}>
            <button style={mobileButton}><Pencil className="h-4 w-4" />{t("t_edit")}</button>
          </Link>
          {pdfShareUrl && (
            <button onClick={handleOpenPDF} style={{ ...mobileButton, flex: 1, justifyContent: "center", fontWeight: 600, background: "#16a34a", color: "#fff" }}>
              <ExternalLink className="h-4 w-4" />{t("t_openPdf")}
            </button>
          )}
          <button onClick={handleDownloadTxt} disabled={!reportReady} style={mobileButton}>
            <FileText className="h-4 w-4" />{t("t_downloadTxt")}
          </button>
          <button onClick={handleDownloadPDF} disabled={pdfLoading || !reportReady}
            style={{ ...mobileButton, flex: 1, justifyContent: "center", fontWeight: 600, background: "#1FB6E1", color: "#fff" }}>
            {pdfLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {pdfLoading ? t("t_generating") : t("t_downloadPdf")}
          </button>
        </div>
      </div>

      <div className="w-full min-w-0 p-4 md:p-8 space-y-6 md:space-y-8 animate-in fade-in">
        {/* ── Cabeçalho desktop ── */}
        <div className="hidden md:flex justify-between items-start gap-3">
          <div className="flex items-center gap-3">
            <Link href="/surgeries">
              <Button variant="outline" size="icon" className="shrink-0" aria-label={t("t_proceduresNav")}><ArrowLeft className="h-4 w-4" /></Button>
            </Link>
            <div className="min-w-0">
              <h1 className="text-xl md:text-3xl font-bold tracking-tight truncate">{t("t_surgeryRecord")}</h1>
              <p className="text-muted-foreground mt-0.5 text-xs md:text-sm truncate">{t("t_patientPrefix")} <span className="font-medium text-foreground">{surgery.patient.nome}</span></p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0">
            <Link href={`/patients/${surgery.patientId}`}>
              <Button variant="outline" className="gap-2"><ClipboardList className="h-4 w-4" />{t("td_detail001")}</Button>
            </Link>
            <Link href={`/surgeries/new?draft=${id}`}>
              <Button variant="outline" className="gap-2"><Pencil className="h-4 w-4" />{t("td_detail003")}</Button>
            </Link>
            {pdfShareUrl && (
              <Button className="gap-2 bg-green-600 hover:bg-green-700 text-white animate-in fade-in" onClick={handleOpenPDF}>
                <ExternalLink className="h-4 w-4" />{t("td_detail004")}
              </Button>
            )}
            <Button variant="outline" className="gap-2" onClick={handleDownloadTxt} disabled={!reportReady}>
              <FileText className="h-4 w-4" />{t("t_downloadTxt")}
            </Button>
            <Button className="gap-2 bg-[#1A365D] hover:bg-[#1A365D]/90 text-white" onClick={handleDownloadPDF} disabled={pdfLoading || !reportReady}>
              {pdfLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {pdfLoading ? t("t_generating") : t("t_downloadPdf")}
            </Button>
            {deleteDialog}
          </div>
        </div>

        <div className="grid min-w-0 gap-6 md:grid-cols-3">
          <Card className="min-w-0 md:col-span-1 shadow-sm border-border h-fit">
            <CardHeader><CardTitle>{t("t_basicDetails")}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <Calendar className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-muted-foreground">{t("t_procedureDate")}</p>
                  {editingData ? (
                    <div className="flex items-center gap-1.5 mt-1">
                      <input type="date" aria-label={t("t_procedureDate")} value={dataValue} onChange={(e) => setDataValue(e.target.value)}
                        className="h-7 rounded border border-input bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
                      <Button size="icon" variant="ghost" className="h-7 w-7" disabled={savingData || !dataValue} onClick={() => saveData(dataValue)}>
                        {savingData ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5 text-primary" />}
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingData(false)}><X className="h-3.5 w-3.5" /></Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <p>{surgery.dataCirurgia ? formatDate(`${surgery.dataCirurgia.slice(0, 10)}T12:00:00`, { day: "2-digit", month: "2-digit", year: "numeric" }) : "-"}</p>
                      <Button size="icon" variant="ghost" className="h-6 w-6 opacity-60 hover:opacity-100" aria-label={t("t_edit")}
                        onClick={() => { setDataValue(surgery.dataCirurgia ? surgery.dataCirurgia.slice(0, 10) : ""); setEditingData(true); }}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Calendar className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium text-muted-foreground">{t("t_registrationDate")}</p>
                  <p>{formatDate(surgery.createdAt, { day: "2-digit", month: "2-digit", year: "numeric" })}</p>
                </div>
              </div>
              <div className="pt-4 border-t border-border space-y-2">
                <div className="flex justify-between gap-2">
                  <span className="text-sm text-muted-foreground shrink-0">{t("t_surgeryType")}</span>
                  <span className="font-medium text-right">{surgery.tipoCaso || "-"}</span>
                </div>
                {surgery.diagnostico && (
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm text-muted-foreground">{t("td_detail005")}</span>
                    <p className="text-sm font-medium whitespace-pre-wrap">{surgery.diagnostico}</p>
                  </div>
                )}
                <div className="flex justify-between items-center gap-2">
                  <span className="text-sm text-muted-foreground shrink-0">{t("region")}</span>
                  <span className="font-medium text-right">{regionLabel}</span>
                </div>
                <div className="flex justify-between items-center gap-2">
                  <span className="text-sm text-muted-foreground">{t("t_surgerySide")}</span>
                  {editingLado ? (
                    <div className="flex items-center gap-1.5">
                      <Select value={ladoValue} onValueChange={setLadoValue}>
                        <SelectTrigger className="h-7 w-32 text-xs" aria-label={t("t_surgerySide")}><SelectValue placeholder={t("select")} /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Direito">{t("t_right")}</SelectItem>
                          <SelectItem value="Esquerdo">{t("t_left")}</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button size="icon" variant="ghost" className="h-7 w-7" disabled={savingLado} onClick={() => saveLado(ladoValue)}>
                        {savingLado ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5 text-primary" />}
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingLado(false)}><X className="h-3.5 w-3.5" /></Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium">{sideLabel(lado)}</span>
                      <Button size="icon" variant="ghost" className="h-6 w-6 opacity-60 hover:opacity-100" aria-label={t("t_edit")}
                        onClick={() => { setLadoValue(lado || ""); setEditingLado(true); }}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </div>
              </div>
              <div className="pt-4 border-t border-border">
                <p className="text-sm font-medium text-muted-foreground mb-2">{t("td_detail007")}</p>
                <div className="flex flex-wrap gap-1">
                  {surgery.tiposProcedimento.map((proc) => (
                    <Badge key={proc} variant="outline" className="bg-primary/5 text-primary border-primary/20">{CASE_TYPE_BY_KEY.get(proc)?.label ?? proc}</Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="min-w-0 md:col-span-2 space-y-6">
            <Tabs defaultValue="detalhes" className="w-full min-w-0">
              <TabsList className="grid w-full grid-cols-1">
                <TabsTrigger value="detalhes">{t("td_detail023")}</TabsTrigger>
              </TabsList>
              <TabsContent value="detalhes" className="min-w-0 space-y-4 mt-4">
                {clinicalPayload && <SurgeryClinicalView payload={clinicalPayload} report={report} />}
                {surgery.observacoes && (
                  <Card className="shadow-sm">
                    <CardHeader className="pb-2"><CardTitle className="text-lg">{t("td_detail099")}</CardTitle></CardHeader>
                    <CardContent><p className="text-sm whitespace-pre-wrap bg-muted/30 p-4 rounded-md">{surgery.observacoes}</p></CardContent>
                  </Card>
                )}
                <Card className="shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg">{t("td_detail100")}</CardTitle>
                    <p className="text-sm text-muted-foreground">{t("td_detail101")}</p>
                  </CardHeader>
                  <CardContent><SurgeryMedia surgeryId={surgery.id} /></CardContent>
                </Card>
              </TabsContent>
            </Tabs>

            <SurgeryRehabSection surgeryId={surgery.id} patientId={surgery.patientId} patientPhone={surgery.patient.telefone} />

            <SurgeryFollowupSection
              surgeryId={surgery.id}
              surgeryDate={surgery.dataCirurgia}
              patientPhone={surgery.patient.telefone}
              followups={surgery.followups as SurgeryFollowup[]}
            />

            <div className="md:hidden flex justify-end">{deleteDialog}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
