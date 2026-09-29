import type jsPDF from "jspdf";
import { openPdfInAppViewer } from "@/components/pdf-viewer-overlay";

const isDesktopModeIPad =
  navigator.platform === "MacIntel" &&
  navigator.maxTouchPoints > 1;

export const IS_MOBILE =
  /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
  isDesktopModeIPad;

type PdfShareResult = { deferred: false } | { deferred: true };

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
    anchor.remove();
  }, 2000);
}

/**
 * Uses a real HTTPS URL on mobile instead of navigating to a blob URL.
 * Safari can then open the PDF in its own viewer without replacing the
 * application's history, and the user can return to DocRegen normally.
 */
export async function sharePdfBlobOrDownload(
  blob: Blob,
  filename: string,
  onDefer: (httpsUrl: string) => void,
): Promise<PdfShareResult> {
  if (!IS_MOBILE) {
    downloadBlob(blob, filename);
    return { deferred: false };
  }

  const resp = await fetch("/regen-api/pdf/temp", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/pdf",
      "X-Filename": filename,
    },
    body: blob,
  });

  if (!resp.ok) {
    throw new Error("Não foi possível preparar o PDF para abrir no iPhone.");
  }

  const { url, path } = (await resp.json()) as { url?: string; path?: string };
  const sameOriginPath = typeof path === "string" && /^\/regen-api\/pdf\/temp\/[a-f0-9]{32}$/.test(path)
    ? path
    : undefined;
  const openUrl = sameOriginPath ?? url;
  if (!openUrl) {
    throw new Error("O servidor não retornou o endereço do PDF.");
  }

  // Keep the temporary PDF on the same app origin that stored it. In a preview,
  // a canonical production URL points at a different process with an empty
  // in-memory store and would return 404.
  onDefer(openUrl);
  return { deferred: true };
}

/**
 * After generating a PDF on mobile:
 *   1. POST the raw bytes to /regen-api/pdf/temp (real HTTPS URL, auth required).
 *   2. Call onDefer(httpsUrl) so the caller shows an "Abrir PDF" button.
 *   3. On button tap, handlePdfOpenClick opens the URL in DocRegen's
 *      in-app viewer, which keeps a visible back button on iOS.
 *
 * Why the server URL is needed:
 *   blob: URLs are local to the page and cannot be accessed by other apps.
 *   When iOS shares a blob URL via the native share sheet it sends the URL
 *   string as text — WhatsApp sees "blob:https://..." and fails.
 *   A real HTTPS URL is fetched by iOS and the file content is passed to
 *   WhatsApp, which uploads and sends it correctly.
 *
 * Desktop: doc.save() downloads with the correct filename directly.
 */
export async function sharePdfOrDownload(
  doc: jsPDF,
  filename: string,
  onDefer: (httpsUrl: string) => void,
): Promise<PdfShareResult> {
  return sharePdfBlobOrDownload(doc.output("blob"), filename, onDefer);
}

/**
 * Open the server-hosted PDF in DocRegen's in-app viewer.
 * This avoids handing navigation to the iOS full-screen PDF viewer, which
 * can hide the browser back controls in an installed PWA or embedded Safari.
 *
 * This MUST be called synchronously from a button's onClick so the popup
 * is not blocked by Safari (window.open requires transient activation).
 */
export function handlePdfOpenClick(
  httpsUrl: string,
  onClear: () => void,
): void {
  onClear();
  openPdfInAppViewer(httpsUrl);
}
