import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Activity, AlertTriangle, Copy, Link2Off, MessageCircle, Send } from "lucide-react";
import { useScopedTranslations } from "@/lib/i18n";
import { rehabReferralMessages } from "@/locales/rehab-referral";
import { usePhysioClinicalLabel } from "@/locales/physio";
import { RED_FLAG_LABELS, assessmentLabel } from "@/lib/rehab-assessments";

interface SurgeryOption {
  id: number;
  dataCirurgia?: string | null;
  tiposProcedimento?: string[] | null;
}

interface RehabData {
  invites: Array<{
    id: number; surgeryId: number; status: string; consentMethod: string;
    expiresAt: string; acceptedAt: string | null; createdAt: string;
  }>;
  careLinks: Array<{
    id: number; surgeryId: number; status: string;
    physioNome: string; physioCrefito: string | null; physioClinica: string | null;
    createdAt: string;
  }>;
  rehabSummary: {
    progressPercent: number | null;
    lsiQuadriceps: number | null;
    lsiHop: number | null;
    aclRsi: number | null;
    nextFollowup: { title: string; dueDate: string } | null;
    totalAssessments: number;
    redFlags: Array<{ flag: string; assessmentType: string; createdAt: string }>;
  } | null;
  assessments: Array<{
    id: number; assessmentType: string; phase: number | null;
    computed: Record<string, unknown> | null; redFlags: string[] | null; createdAt: string;
  }>;
}

function doctorFetch(url: string, options: RequestInit = {}) {
  return fetch(url, {
    ...options,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string> ?? {}),
    },
  });
}

export function RehabReferralCard({ patientId, surgeries }: { patientId: number; surgeries: SurgeryOption[] }) {
  const { toast } = useToast();
  const rr = useScopedTranslations(rehabReferralMessages);
  const clinicalLabel = usePhysioClinicalLabel();
  const consentLabels: Record<string, string> = { verbal_presencial: rr("verbal"), whatsapp: "WhatsApp", termo_assinado: rr("signed") };
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [surgeryId, setSurgeryId] = useState<string>("");
  const [consentMethod, setConsentMethod] = useState<string>("");
  const [generated, setGenerated] = useState<{ link: string; whatsappText: string } | null>(null);

  const { data, isLoading } = useQuery<RehabData>({
    queryKey: ["patient-rehab", patientId],
    queryFn: async () => {
      const res = await doctorFetch(`/api/patients/${patientId}/rehab`);
      if (!res.ok) throw new Error(rr("loadError"));
      return res.json();
    },
  });

  const createInvite = useMutation({
    mutationFn: async () => {
      const res = await doctorFetch(`/api/patients/${patientId}/rehab-invite`, {
        method: "POST",
        body: JSON.stringify({ surgeryId: Number(surgeryId), consentMethod }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? rr("inviteError"));
      return body as { link: string; whatsappText: string };
    },
    onSuccess: (body) => {
      setGenerated(body);
      queryClient.invalidateQueries({ queryKey: ["patient-rehab", patientId] });
    },
    onError: (err: Error) => toast({ title: rr("error"), description: err.message, variant: "destructive" }),
  });

  const revoke = useMutation({
    mutationFn: async (careLinkId: number) => {
      const res = await doctorFetch(`/api/care-links/${careLinkId}/revoke`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? rr("revokeError"));
      return body;
    },
    onSuccess: () => {
      toast({ title: rr("revoked"), description: rr("revokedDescription") });
      queryClient.invalidateQueries({ queryKey: ["patient-rehab", patientId] });
    },
    onError: (err: Error) => toast({ title: rr("error"), description: err.message, variant: "destructive" }),
  });

  const activeLink = data?.careLinks.find((c) => c.status === "active");
  const pendingInvites = data?.invites.filter((i) => i.status === "pending") ?? [];
  const summary = data?.rehabSummary;

  const openDialog = () => {
    setGenerated(null);
    setSurgeryId(surgeries.length === 1 ? String(surgeries[0].id) : "");
    setConsentMethod("");
    setDialogOpen(true);
  };

  const copyLink = async () => {
    if (!generated) return;
    await navigator.clipboard.writeText(generated.link);
    toast({ title: rr("copied") });
  };

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden" style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}>
      <div className="px-5 py-4 border-b border-border flex justify-between items-center">
        <div>
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Activity className="h-4 w-4" style={{ color: "#1A365D" }} />
            {rr("rehabilitation")}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">{rr("subtitle")}</p>
        </div>
        {!activeLink && surgeries.length > 0 && (
          <Button size="sm" className="gap-1" style={{ background: "#1A365D" }} onClick={openDialog}>
            <Send className="h-4 w-4" />{rr("refer")}
          </Button>
        )}
      </div>

      <div className="p-4 space-y-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground text-center py-4">{rr("loading")}</p>
        ) : (
          <>
            {activeLink ? (
              <div className="flex items-start justify-between gap-3 p-3.5 rounded-lg border border-border bg-muted/20">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-foreground">{activeLink.physioNome}</span>
                    <Badge className="text-xs bg-green-100 text-green-800 hover:bg-green-100">{rr("activeLink")}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {activeLink.physioCrefito ? `CREFITO ${activeLink.physioCrefito}` : ""}
                    {activeLink.physioClinica ? `${activeLink.physioCrefito ? " · " : ""}${activeLink.physioClinica}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">{rr("since", { date: format(new Date(activeLink.createdAt), "dd/MM/yyyy") })}</p>
                </div>
                <Button
                  variant="ghost" size="sm" className="shrink-0 text-destructive gap-1"
                  onClick={() => {
                    if (window.confirm(rr("revokeAccessConfirm"))) {
                      revoke.mutate(activeLink.id);
                    }
                  }}
                  disabled={revoke.isPending}
                >
                  <Link2Off className="h-4 w-4" />{rr("revoke")}
                </Button>
              </div>
            ) : pendingInvites.length > 0 ? (
              <div className="p-3.5 rounded-lg border border-dashed border-border bg-muted/10">
                <p className="text-sm text-foreground font-medium">{rr("awaitingInvite")}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {rr("inviteDetails", { sent: format(new Date(pendingInvites[0].createdAt), "dd/MM/yyyy"), expires: format(new Date(pendingInvites[0].expiresAt), "dd/MM/yyyy"), consent: consentLabels[pendingInvites[0].consentMethod] ?? pendingInvites[0].consentMethod })}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-2">
                {surgeries.length === 0
                  ? rr("needProcedure")
                  : rr("noPhysio")}
              </p>
            )}

            {summary && (
              <div className="space-y-3">
                {summary.redFlags.length > 0 && (
                  <div className="p-3 rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900">
                    <p className="text-xs font-semibold text-red-700 dark:text-red-400 flex items-center gap-1.5 mb-1.5">
                      <AlertTriangle className="h-3.5 w-3.5" />{rr("warningSigns")}
                    </p>
                    <ul className="space-y-0.5">
                      {summary.redFlags.slice(0, 5).map((rf, i) => (
                        <li key={i} className="text-xs text-red-700 dark:text-red-400">
                          • {clinicalLabel(RED_FLAG_LABELS[rf.flag] ?? rf.flag)} <span className="opacity-70">({format(new Date(rf.createdAt), "dd/MM")})</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {[
                    { label: rr("progress"), value: summary.progressPercent !== null ? `${summary.progressPercent}%` : "—" },
                    { label: rr("quadricepsLsi"), value: summary.lsiQuadriceps !== null ? `${summary.lsiQuadriceps}%` : "—" },
                    { label: rr("hopLsi"), value: summary.lsiHop !== null ? `${summary.lsiHop}%` : "—" },
                    { label: rr("aclRsi"), value: summary.aclRsi !== null ? String(summary.aclRsi) : "—" },
                  ].map((m) => (
                    <div key={m.label} className="rounded-lg border border-border p-2.5 text-center">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{m.label}</p>
                      <p className="text-lg font-bold" style={{ color: "#1A365D" }}>{m.value}</p>
                    </div>
                  ))}
                </div>
                {summary.nextFollowup && (
                  <p className="text-xs text-muted-foreground">
                    {rr("nextMilestone")} <span className="font-medium text-foreground">{summary.nextFollowup.title}</span> — {format(new Date(`${summary.nextFollowup.dueDate}T12:00:00`), "dd/MM/yyyy")}
                  </p>
                )}
                {data && data.assessments.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-foreground mb-1.5">{rr("latestAssessments")}</p>
                    <div className="space-y-1">
                      {data.assessments.slice(0, 5).map((a) => (
                        <div key={a.id} className="flex items-center justify-between text-xs py-1 border-b border-border/50 last:border-0">
                          <span className="text-foreground">
                            {a.assessmentType === "clinico" ? rr("clinical") : clinicalLabel(assessmentLabel(a.assessmentType))}
                            {a.phase ? ` · ${rr("phase", { phase: a.phase })}` : ""}
                          </span>
                          <span className="text-muted-foreground flex items-center gap-1.5">
                            {a.redFlags && a.redFlags.length > 0 && <AlertTriangle className="h-3 w-3 text-red-500" />}
                            {format(new Date(a.createdAt), "dd/MM/yyyy")}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{rr("dialogTitle")}</DialogTitle>
            <DialogDescription>
              {rr("dialogDescription")}
            </DialogDescription>
          </DialogHeader>

          {!generated ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>{rr("surgery")}</Label>
                <Select value={surgeryId} onValueChange={setSurgeryId}>
                  <SelectTrigger><SelectValue placeholder={rr("selectSurgery")} /></SelectTrigger>
                  <SelectContent>
                    {surgeries.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.dataCirurgia ? format(new Date(s.dataCirurgia), "dd/MM/yyyy") : rr("surgeryNumber", { id: s.id })}
                        {s.tiposProcedimento && s.tiposProcedimento.length > 0 ? ` — ${s.tiposProcedimento.join(", ")}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{rr("consent")}</Label>
                <Select value={consentMethod} onValueChange={setConsentMethod}>
                  <SelectTrigger><SelectValue placeholder={rr("consentPlaceholder")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="verbal_presencial">{rr("verbalAuthorization")}</SelectItem>
                    <SelectItem value="whatsapp">{rr("whatsappAuthorization")}</SelectItem>
                    <SelectItem value="termo_assinado">{rr("signedAuthorization")}</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {rr("consentDeclaration")}
                </p>
              </div>
              <DialogFooter>
                <Button
                  onClick={() => createInvite.mutate()}
                  disabled={!surgeryId || !consentMethod || createInvite.isPending}
                  style={{ background: "#1A365D" }}
                >
                  {createInvite.isPending ? rr("generating") : rr("generateInvite")}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-muted/40 border border-border">
                <p className="text-xs text-muted-foreground break-all">{generated.link}</p>
              </div>
              <p className="text-xs text-muted-foreground">
                {rr("linkHelp")}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 gap-1.5" onClick={copyLink}>
                  <Copy className="h-4 w-4" />{rr("copyLink")}
                </Button>
                <Button
                  className="flex-1 gap-1.5 bg-green-600 hover:bg-green-700 text-white"
                  onClick={() => {
                    window.open(`https://wa.me/?text=${encodeURIComponent(generated.whatsappText)}`, "_blank");
                  }}
                >
                  <MessageCircle className="h-4 w-4" />WhatsApp
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
