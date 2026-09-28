/** Encaminhamento ao fisioterapeuta a partir da página da cirurgia. */
import { useEffect, useState } from "react";
import { CheckCircle2, Clock, Loader2, Send, UserCheck, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { surgeryViewMessages } from "@/locales/surgery-view";

type RehabInviteItem = { id: number; surgeryId: number; status: string; consentMethod: string; expiresAt: string; acceptedAt: string | null; createdAt: string };
type CareLinkItem = { id: number; surgeryId: number; status: string; physioNome: string; physioCrefito: string | null; physioClinica: string | null; createdAt: string };

export function SurgeryRehabSection({ surgeryId, patientId, patientPhone }: { surgeryId: number; patientId: number; patientPhone?: string | null }) {
  const t = useScopedTranslations(surgeryViewMessages);
  const { formatDate } = useLanguage();
  const { toast } = useToast();
  const [data, setData] = useState<{ invites: RehabInviteItem[]; careLinks: CareLinkItem[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [consentMethod, setConsentMethod] = useState("verbal_presencial");
  const [generating, setGenerating] = useState(false);
  const [revoking, setRevoking] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/patients/${patientId}/rehab`, { credentials: "same-origin" });
      if (r.ok) setData(await r.json());
    } catch { /* sem dados de reabilitação */ } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [patientId]); // eslint-disable-line react-hooks/exhaustive-deps

  const generateInvite = async () => {
    setGenerating(true);
    try {
      const r = await fetch(`/api/patients/${patientId}/rehab-invite`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ surgeryId, consentMethod }),
      });
      if (r.ok) {
        const body = await r.json();
        const digits = (patientPhone ?? "").replace(/\D/g, "");
        const wa = digits ? `https://wa.me/55${digits}?text=${encodeURIComponent(body.whatsappText)}` : null;
        toast({ title: t("t_inviteGenerated"), description: t("t_referralReady") });
        await load();
        setDialogOpen(false);
        if (wa) window.open(wa, "_blank");
      } else {
        const err = await r.json().catch(() => ({}));
        toast({ title: t("t_inviteError"), description: (err as Record<string, string>).error ?? t("t_tryAgain"), variant: "destructive" });
      }
    } catch {
      toast({ title: t("t_inviteError"), variant: "destructive" });
    } finally { setGenerating(false); }
  };

  const revoke = async (linkId: number) => {
    setRevoking(linkId);
    try {
      const r = await fetch(`/api/care-links/${linkId}/revoke`, { method: "POST", credentials: "same-origin" });
      if (r.ok) { toast({ title: t("t_linkRevoked") }); await load(); }
      else toast({ title: t("t_revokeLinkError"), variant: "destructive" });
    } catch {
      toast({ title: t("t_revokeLinkError"), variant: "destructive" });
    } finally { setRevoking(null); }
  };

  const activeLink = (data?.careLinks ?? []).find((l) => l.surgeryId === surgeryId && l.status === "active");
  const pendingInvite = (data?.invites ?? []).find((i) => i.surgeryId === surgeryId && i.status === "pending");

  const inviteDialog = (trigger: React.ReactNode, title: string, description: string, consentLabel: string, showNote: boolean) => (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="rehab-consent">{consentLabel}</Label>
            <Select value={consentMethod} onValueChange={setConsentMethod}>
              <SelectTrigger id="rehab-consent"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="verbal_presencial">{t("td_detail107")}</SelectItem>
                <SelectItem value="whatsapp">{t("td_detail108")}</SelectItem>
                <SelectItem value="termo_assinado">{t("td_detail109")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {showNote && <p className="text-xs text-muted-foreground">{t("td_detail110")}</p>}
          <Button onClick={generateInvite} disabled={generating} className="w-full gap-2">
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {t("td_detail111")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );

  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <UserCheck className="h-5 w-5 text-indigo-600" />
          <h2 className="text-lg font-semibold">{t("td_detail102")}</h2>
        </div>
        {!activeLink && !pendingInvite && inviteDialog(
          <Button size="sm" variant="outline" className="gap-1.5"><Send className="h-4 w-4" />{t("td_detail103")}</Button>,
          t("td_detail104"), t("td_detail105"), t("td_detail106"), true,
        )}
      </div>

      {loading && <p className="text-xs text-muted-foreground">{t("td_detail112")}</p>}

      {activeLink && (
        <div className="flex items-start justify-between gap-3 rounded-xl border-2 border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-emerald-900">{activeLink.physioNome}</p>
              {activeLink.physioCrefito && <p className="text-xs text-emerald-700">{t("td_detail113")} {activeLink.physioCrefito}</p>}
              {activeLink.physioClinica && <p className="text-xs text-emerald-700">{activeLink.physioClinica}</p>}
              <p className="text-xs text-emerald-600 mt-1">{t("t_activeLinkSince", { date: formatDate(activeLink.createdAt) })}</p>
            </div>
          </div>
          <Button size="sm" variant="outline" className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50 shrink-0"
            onClick={() => revoke(activeLink.id)} disabled={revoking === activeLink.id}>
            {revoking === activeLink.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserX className="h-3.5 w-3.5" />}
            {t("td_detail114")}
          </Button>
        </div>
      )}

      {!activeLink && pendingInvite && (
        <div className="flex items-start justify-between gap-3 rounded-xl border-2 border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start gap-3">
            <Clock className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-amber-900">{t("td_detail115")}</p>
              <p className="text-xs text-amber-700">{t("td_detail116")}</p>
              <p className="text-xs text-amber-600">{t("t_validUntil", { date: formatDate(pendingInvite.expiresAt) })}</p>
            </div>
          </div>
          {inviteDialog(
            <Button size="sm" variant="outline" className="gap-1.5 shrink-0"><Send className="h-3.5 w-3.5" />{t("td_detail117")}</Button>,
            t("td_detail118"), t("td_detail119"), t("td_detail120"), false,
          )}
        </div>
      )}

      {!activeLink && !pendingInvite && !loading && (
        <p className="text-sm text-muted-foreground">{t("td_detail121")}</p>
      )}
    </div>
  );
}
