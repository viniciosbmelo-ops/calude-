import { useCallback, useEffect, useState } from "react";
import { Download, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { lgpdMessages } from "@/locales/lgpd";

type LgpdRequest = {
  id: number;
  status: string;
  descricaoStatus: string;
  solicitadaEm: string;
};

async function downloadExport(format: "json" | "csv") {
  const response = await fetch(`/regen-api/lgpd/exportar?formato=${format}`, { credentials: "same-origin" });
  if (!response.ok) throw new Error(String(response.status));
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `docregen-meus-dados.${format}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Profile card: data portability export and account-deletion request with its real status. */
export function LgpdPrivacyCard() {
  const t = useScopedTranslations(lgpdMessages);
  const { formatDate } = useLanguage();
  const { toast } = useToast();
  const [requests, setRequests] = useState<LgpdRequest[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/regen-api/lgpd/solicitacoes", { credentials: "same-origin" });
      if (response.ok) setRequests(((await response.json()) as { solicitacoes: LgpdRequest[] }).solicitacoes);
    } catch {
      // Status is informative; the card still works without it.
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const exportData = async (format: "json" | "csv") => {
    try {
      await downloadExport(format);
    } catch {
      toast({ title: t("exportError"), variant: "destructive" });
    }
  };

  const requestDeletion = async () => {
    setBusy(true);
    try {
      const response = await fetch("/regen-api/lgpd/solicitar-exclusao", { method: "DELETE", credentials: "same-origin" });
      const body = await response.json().catch(() => ({})) as { mensagem?: string; error?: string };
      if (!response.ok) throw new Error(body.error ?? String(response.status));
      toast({ title: body.mensagem ?? t("requestStatus") });
      await load();
    } catch {
      toast({ title: t("requestError"), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const latest = requests[0];

  return (
    <Card className="shadow-sm border-border mb-5" data-testid="lgpd-privacy-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          {t("privacyTitle")}
        </CardTitle>
        <CardDescription className="text-xs">{t("privacyDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => exportData("json")}>
            <Download className="h-3.5 w-3.5 mr-1.5" />{t("exportJson")}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => exportData("csv")}>
            <Download className="h-3.5 w-3.5 mr-1.5" />{t("exportCsv")}
          </Button>
        </div>
        {latest && (
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs space-y-1" role="status">
            <p className="font-semibold">{t("requestStatus")}</p>
            <p>{latest.descricaoStatus}</p>
            <p className="text-muted-foreground">{t("requestedOn", { date: formatDate(latest.solicitadaEm) })}</p>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">{t("retentionNote")}</p>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="text-destructive" disabled={busy}>
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />{t("requestDeletion")}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("requestDeletionTitle")}</AlertDialogTitle>
              <AlertDialogDescription>{t("requestDeletionDescription")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={requestDeletion}>{t("confirmRequest")}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
