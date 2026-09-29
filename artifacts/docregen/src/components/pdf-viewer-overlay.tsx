import { useEffect, useState } from "react";
import { ArrowLeft, FileText } from "lucide-react";

const PDF_OPEN_EVENT = "docknee:pdf-open";

type PdfOpenDetail = {
  url: string;
};

export function openPdfInAppViewer(url: string): void {
  window.dispatchEvent(new CustomEvent<PdfOpenDetail>(PDF_OPEN_EVENT, {
    detail: { url },
  }));
}

export function PdfViewerOverlay() {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const handleOpen = (event: Event) => {
      const detail = (event as CustomEvent<PdfOpenDetail>).detail;
      if (detail?.url) setUrl(detail.url);
    };

    window.addEventListener(PDF_OPEN_EVENT, handleOpen);
    return () => window.removeEventListener(PDF_OPEN_EVENT, handleOpen);
  }, []);

  useEffect(() => {
    if (!url) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setUrl(null);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [url]);

  if (!url) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Visualização do PDF"
      className="fixed inset-0 z-[9999] flex flex-col bg-black"
    >
      <div
        className="flex shrink-0 items-center gap-3 border-b border-white/10 bg-slate-950 px-3 pb-3 text-white sm:px-4"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <button
          type="button"
          onClick={() => setUrl(null)}
          className="flex min-h-10 items-center gap-2 rounded-lg bg-white/10 px-3 text-sm font-semibold transition-colors hover:bg-white/20"
          aria-label="Voltar ao DocRegen"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar ao DocRegen
        </button>
        <div className="flex min-w-0 items-center gap-2 text-sm text-white/80">
          <FileText className="h-4 w-4 shrink-0 text-cyan-300" />
          <span className="truncate">Visualização do PDF</span>
        </div>
      </div>
      <iframe
        title="Visualização do PDF"
        src={url}
        className="min-h-0 w-full flex-1 border-0 bg-white"
      />
    </div>
  );
}