import { useMemo, useRef, useState } from "react";
import { AlertTriangle, Clipboard, Download, FileText, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { surgeryCoreMessages } from "@/locales/surgery-core";
import {
  buildSurgeryTextExport,
  copySurgeryText,
  downloadSurgeryText,
  getSurgeryTextFilename,
  selectSurgeryText,
} from "@/lib/surgery-text-export";
import type { BioReadyResult } from "@/lib/regen-bioready";
import { toast } from "sonner";

interface SurgeryTextExportDialogProps {
  open: boolean;
  onClose: () => void;
  surgery: any;
  privacyMode?: boolean;
  bioReady?: BioReadyResult | null;
}

export function SurgeryTextExportDialog({
  open,
  onClose,
  surgery,
  privacyMode = false,
  bioReady = null,
}: SurgeryTextExportDialogProps) {
  const { locale } = useLanguage();
  const t = useScopedTranslations(surgeryCoreMessages);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [copying, setCopying] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [copyBlocked, setCopyBlocked] = useState(false);

  const text = useMemo(
    () => surgery
      ? buildSurgeryTextExport(surgery, { privacyMode, bioReady, locale })
      : "",
    [bioReady, locale, privacyMode, surgery],
  );
  const filename = useMemo(
    () => surgery ? getSurgeryTextFilename(surgery, privacyMode) : "PROCEDIMENTO.txt",
    [privacyMode, surgery],
  );

  const selectFallback = () => selectSurgeryText(textareaRef.current);

  const handleCopy = async () => {
    // Keep this call directly in the button activation path. In particular,
    // do not defer clipboard access with a timer: iOS rejects that gesture.
    setCopying(true);
    setCopyBlocked(false);
    try {
      await copySurgeryText(text);
      toast.success(t("textCopied"));
    } catch (error) {
      console.error("Erro ao copiar arquivo de texto:", error);
      setCopyBlocked(true);
      selectFallback();
      toast.error(t("clipboardBlocked"));
    } finally {
      setCopying(false);
    }
  };

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const result = await downloadSurgeryText(text, filename);
      toast.success(result === "shared" ? t("textReady") : t("textDownloaded"));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      console.error("Erro ao baixar arquivo de texto:", error);
      toast.error(t("textError"));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-3xl max-h-[90vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="px-4 sm:px-6 pt-5 pb-3 border-b border-border shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            {t("textPreview")}
          </DialogTitle>
          <DialogDescription>
            {t("selectTextHint")}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-6 py-4">
          {copyBlocked && (
            <div
              role="alert"
              className="mb-3 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t("clipboardBlocked")}</span>
            </div>
          )}
          <textarea
            ref={textareaRef}
            aria-label={t("textPreview")}
            readOnly
            value={text}
            onFocus={(event) => event.currentTarget.select()}
            className="min-h-[50vh] w-full resize-y rounded-md border border-border bg-muted/20 p-3 font-mono text-xs leading-relaxed text-foreground outline-none focus:ring-2 focus:ring-ring"
          />
          <p className="mt-2 break-all text-xs text-muted-foreground">{filename}</p>
        </div>

        <DialogFooter className="flex-col gap-2 border-t border-border px-4 py-3 sm:flex-row sm:justify-between sm:px-6">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("close")}
          </Button>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Button
              type="button"
              variant="outline"
              className="w-full gap-2 sm:w-auto"
              onClick={handleCopy}
              disabled={copying || downloading}
            >
              {copying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clipboard className="h-4 w-4" />}
              {copying ? t("generating") : t("copyText")}
            </Button>
            <Button
              type="button"
              className="w-full gap-2 sm:w-auto"
              onClick={handleDownload}
              disabled={copying || downloading}
            >
              {downloading
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Download className="h-4 w-4" />
              }
              {downloading ? t("generating") : t("downloadTxt")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}