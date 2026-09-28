import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { physioFetch } from "@/lib/physio-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { FileText, Plus, Lock, Download, Trash2, Pencil, FileCheck2 } from "lucide-react";
import { toast } from "sonner";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { physioMessages, usePhysioClinicalLabel } from "@/locales/physio";

export interface PhysioDocument {
  id: number;
  docType: string;
  title: string | null;
  content: Record<string, unknown>;
  pdfUrl: string | null;
  lockedAt: string | null;
  createdAt: string;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  anamnese: "Anamnese",
  evolucao: "Evolução",
  laudo: "Laudo",
  atestado: "Atestado",
  followup_note: "Nota de follow-up",
};

interface FieldDef {
  key: string;
  label: string;
  type: "text" | "textarea" | "date" | "number";
  nested?: string;
}

const DOC_FIELDS: Record<string, FieldDef[]> = {
  anamnese: [
    { key: "queixa_principal", label: "Queixa principal", type: "textarea" },
    { key: "hda", label: "História da doença atual (HDA)", type: "textarea" },
    { key: "hpp", label: "História patológica pregressa (HPP)", type: "textarea" },
    { key: "tipo", label: "Cirurgia — tipo", type: "text", nested: "cirurgia" },
    { key: "data", label: "Cirurgia — data", type: "date", nested: "cirurgia" },
    { key: "cirurgiao", label: "Cirurgia — cirurgião", type: "text", nested: "cirurgia" },
    { key: "medicamentos", label: "Medicamentos", type: "textarea" },
    { key: "nivel_atividade_pre", label: "Nível de atividade prévio", type: "text" },
    { key: "objetivo_paciente", label: "Objetivo do paciente", type: "textarea" },
    { key: "exame_fisico_inicial", label: "Exame físico inicial", type: "textarea" },
  ],
  evolucao: [
    { key: "data_sessao", label: "Data da sessão", type: "date" },
    { key: "sessao_numero", label: "Nº da sessão", type: "number" },
    { key: "condutas", label: "Condutas realizadas", type: "textarea" },
    { key: "intercorrencias", label: "Intercorrências", type: "textarea" },
    { key: "resposta_ao_tratamento", label: "Resposta ao tratamento", type: "textarea" },
    { key: "plano_proxima_sessao", label: "Plano para próxima sessão", type: "textarea" },
  ],
  laudo: [
    { key: "inicio", label: "Período — início", type: "date", nested: "periodo" },
    { key: "fim", label: "Período — fim", type: "date", nested: "periodo" },
    { key: "sessoes_realizadas", label: "Sessões realizadas", type: "number" },
    { key: "diagnostico_fisioterapeutico", label: "Diagnóstico fisioterapêutico", type: "textarea" },
    { key: "evolucao_resumo", label: "Resumo da evolução", type: "textarea" },
    { key: "prognostico", label: "Prognóstico", type: "textarea" },
    { key: "destinatario", label: "Destinatário", type: "text" },
  ],
  atestado: [
    { key: "texto", label: "Texto do atestado", type: "textarea" },
    { key: "finalidade", label: "Finalidade", type: "text" },
    { key: "data_emissao", label: "Data de emissão", type: "date" },
    { key: "validade", label: "Validade", type: "date" },
  ],
  followup_note: [
    { key: "observacoes", label: "Observações", type: "textarea" },
  ],
};

function getFieldValue(content: Record<string, unknown>, f: FieldDef): string {
  const source = f.nested ? ((content[f.nested] ?? {}) as Record<string, unknown>) : content;
  const v = source[f.key];
  return v === null || v === undefined ? "" : String(v);
}

function setFieldValue(content: Record<string, unknown>, f: FieldDef, raw: string): Record<string, unknown> {
  let value: unknown = raw;
  if (f.type === "number") value = raw === "" ? null : Number(raw);
  if (f.type === "date") value = raw === "" ? null : raw;
  if (f.nested) {
    const nested = { ...((content[f.nested] ?? {}) as Record<string, unknown>), [f.key]: value };
    return { ...content, [f.nested]: nested };
  }
  return { ...content, [f.key]: value };
}

export default function ProntuarioSection({ patientId }: { patientId: string }) {
  const queryClient = useQueryClient();
  const { formatDate } = useLanguage();
  const t = useScopedTranslations(physioMessages);
  const clinicalLabel = usePhysioClinicalLabel();
  const displayDate = (date: string) => formatDate(new Date(`${date.slice(0, 10)}T12:00:00`));

  const { data: docs = [], isLoading } = useQuery<PhysioDocument[]>({
    queryKey: ["physio-documents", patientId],
    queryFn: async () => {
      const res = await physioFetch(`/api/physio/patients/${patientId}/documents`);
      if (!res.ok) throw new Error(t("documentLoadError"));
      return res.json();
    },
  });

  const refetch = () => queryClient.invalidateQueries({ queryKey: ["physio-documents", patientId] });

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [docType, setDocType] = useState("evolucao");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [emittingId, setEmittingId] = useState<number | null>(null);

  function openNew() {
    setEditingId(null);
    setDocType("evolucao");
    setTitle("");
    setContent({});
    setOpen(true);
  }

  function openEdit(doc: PhysioDocument) {
    setEditingId(doc.id);
    setDocType(doc.docType);
    setTitle(doc.title ?? "");
    setContent(doc.content ?? {});
    setOpen(true);
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const res = editingId
        ? await physioFetch(`/api/physio/documents/${editingId}`, {
            method: "PUT",
            body: JSON.stringify({ title: title || undefined, content }),
          })
        : await physioFetch(`/api/physio/patients/${patientId}/documents`, {
            method: "POST",
            body: JSON.stringify({ docType, title: title || undefined, content }),
          });
      const body = await res.json();
      if (!res.ok) { toast.error(body.error ?? t("documentSaveError")); return; }
      toast.success(editingId ? t("documentUpdated") : t("documentCreated"));
      setOpen(false);
      refetch();
    } finally {
      setSaving(false);
    }
  }

  async function removeDoc(docId: number) {
    if (!confirm(t("deleteDocument"))) return;
    const res = await physioFetch(`/api/physio/documents/${docId}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? t("documentDeleteError"));
      return;
    }
    toast.success(t("documentDeleted"));
    refetch();
  }

  async function emitPdf(docId: number) {
    if (emittingId) return;
    if (!confirm(t("issuePdfConfirm"))) return;
    setEmittingId(docId);
    try {
      const res = await physioFetch(`/api/physio/documents/${docId}/emit`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) { toast.error(body.error ?? t("issuePdfError")); return; }
      toast.success(t("pdfIssued"));
      if (body.pdfSignedUrl) window.open(body.pdfSignedUrl, "_blank");
      refetch();
    } finally {
      setEmittingId(null);
    }
  }

  async function downloadPdf(docId: number) {
    const res = await physioFetch(`/api/physio/documents/${docId}`);
    const body = await res.json();
    if (!res.ok || !body.pdfSignedUrl) { toast.error(t("pdfUnavailable")); return; }
    window.open(body.pdfSignedUrl, "_blank");
  }

  const fields = DOC_FIELDS[docType] ?? [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
             <FileText className="h-4 w-4" style={{ color: "#1FB6E1" }} /> {t("record")}
          </CardTitle>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={openNew} data-testid="button-novo-documento">
             <Plus className="h-4 w-4" /> {t("document")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
         {isLoading && <p className="text-sm text-muted-foreground">{t("loading")}</p>}
        {!isLoading && docs.length === 0 && (
           <p className="text-sm text-muted-foreground">{t("noDocuments")}</p>
        )}
        {docs.map((doc) => (
          <div key={doc.id} className="rounded-lg border border-border px-3 py-2" data-testid={`documento-${doc.id}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                   <Badge variant="secondary" className="text-[10px]">{clinicalLabel(DOC_TYPE_LABELS[doc.docType] ?? doc.docType)}</Badge>
                  {doc.lockedAt && (
                     <Badge variant="outline" className="text-[10px] gap-1"><Lock className="h-3 w-3" /> {t("issued")}</Badge>
                  )}
                </div>
                <p className="text-sm font-medium text-foreground truncate mt-0.5">
                   {doc.title || clinicalLabel(DOC_TYPE_LABELS[doc.docType])}
                </p>
                 <p className="text-xs text-muted-foreground">{displayDate(doc.createdAt)}</p>
              </div>
              <div className="flex gap-1 shrink-0">
                {doc.lockedAt ? (
                  <Button variant="ghost" size="sm" className="h-7 px-2 gap-1 text-xs" onClick={() => downloadPdf(doc.id)} data-testid={`button-baixar-pdf-${doc.id}`}>
                    <Download className="h-3.5 w-3.5" /> PDF
                  </Button>
                ) : (
                  <>
                    {(doc.docType === "laudo" || doc.docType === "atestado") && (
                      <Button
                        variant="ghost" size="sm" className="h-7 px-2 gap-1 text-xs"
                        disabled={emittingId === doc.id}
                        onClick={() => emitPdf(doc.id)}
                        data-testid={`button-emitir-${doc.id}`}
                      >
                         <FileCheck2 className="h-3.5 w-3.5" /> {emittingId === doc.id ? t("issuing") : t("issuePdf")}
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(doc)} data-testid={`button-editar-doc-${doc.id}`}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={() => removeDoc(doc.id)} data-testid={`button-excluir-doc-${doc.id}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
             <DialogTitle>{editingId ? t("editDocument") : t("newDocument")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {!editingId && (
              <div className="space-y-1.5">
                 <Label>{t("typeRequired")}</Label>
                <Select value={docType} onValueChange={(v) => { setDocType(v); setContent({}); }}>
                  <SelectTrigger data-testid="select-tipo-documento"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(DOC_TYPE_LABELS).map(([v, l]) => (
                       <SelectItem key={v} value={v}>{clinicalLabel(l)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
               <Label>{t("title")}</Label>
               <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={clinicalLabel(DOC_TYPE_LABELS[docType])} data-testid="input-doc-titulo" />
            </div>
            {docType === "laudo" && !editingId && (
              <p className="text-xs text-muted-foreground">
                 {t("objectiveDataHelp")}
              </p>
            )}
            {fields.map((f) => (
              <div key={`${f.nested ?? ""}${f.key}`} className="space-y-1.5">
                 <Label>{clinicalLabel(f.label)}</Label>
                {f.type === "textarea" ? (
                  <Textarea
                    value={getFieldValue(content, f)}
                    onChange={(e) => setContent((prev) => setFieldValue(prev, f, e.target.value))}
                    data-testid={`campo-doc-${f.key}`}
                  />
                ) : (
                  <Input
                    type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                    value={getFieldValue(content, f)}
                    onChange={(e) => setContent((prev) => setFieldValue(prev, f, e.target.value))}
                    data-testid={`campo-doc-${f.key}`}
                  />
                )}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button onClick={save} disabled={saving} data-testid="button-doc-salvar">
               {saving ? t("saving") : t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
