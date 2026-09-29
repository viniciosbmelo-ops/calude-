import { API_PREFIX } from "../lib/api-prefix";
import { Router, type IRouter } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { requireAuth } from "../middlewares/requireAuth";
import { storePdf, getPdf, MAX_PDF_BYTES } from "../lib/tempPdfStore";
import { getBaseUrl } from "../lib/base-url";

const router: IRouter = Router();

/**
 * Rate limiter for PDF uploads: 20 uploads per 15 min per authenticated user.
 * Keyed by doctorId when available (requireAuth runs first, so it is always
 * present on the POST route). Falls back to ipKeyGenerator for the rare case
 * where no doctorId is set — ipKeyGenerator handles IPv6 correctly.
 */
const pdfUploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-6",
  legacyHeaders: false,
  message: { error: "Limite de uploads de PDF atingido. Tente novamente em 15 minutos.", code: "PDF_RATE_LIMIT" },
  keyGenerator: (req) => req.doctorId ? `pdf:${req.doctorId}` : ipKeyGenerator(req.ip ?? ""),
  skip: () => process.env["NODE_ENV"] === "test",
});

/**
 * POST /regen-api/pdf/temp
 * Auth required. Accepts raw PDF bytes (Content-Type: application/pdf) or
 * a JSON body with { data: base64string, filename: string }.
 * Stores the PDF for up to 30 min and returns { url, path, expiresIn }.
 *
 * The returned URL uses the trusted base URL from env/REPLIT_DOMAINS (not
 * reconstructed from request headers, to prevent Host header injection in
 * returned URLs). Safari can open it in its PDF viewer and share via WhatsApp.
 */
router.post("/pdf/temp", requireAuth, pdfUploadLimiter, async (req, res): Promise<void> => {
  try {
    let buffer: Buffer;
    let filename = "documento.pdf";

    const ct = req.headers["content-type"] ?? "";

    if (ct.includes("application/pdf")) {
      // Raw binary body — enforce MAX_PDF_BYTES *during* streaming to avoid
      // accumulating an arbitrarily large buffer before we can reject it.
      buffer = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        let received = 0;
        let aborted = false;

        req.on("data", (chunk: Buffer) => {
          if (aborted) return;
          received += chunk.length;
          if (received > MAX_PDF_BYTES) {
            aborted = true;
            chunks.length = 0;
            // Keep draining the request without retaining more bytes. Destroying
            // the socket here would turn the intended 413 into a connection reset.
            req.resume();
            reject(Object.assign(new Error("too_large"), { code: "PDF_TOO_LARGE" }));
            return;
          }
          chunks.push(chunk);
        });
        req.on("end", () => {
          if (!aborted) resolve(Buffer.concat(chunks));
        });
        req.on("error", reject);
      });
      filename = (req.headers["x-filename"] as string | undefined) ?? filename;
    } else {
      // JSON body: { data: base64, filename: string }
      const { data, filename: fn } = req.body as { data?: string; filename?: string };
      if (!data) {
        res.status(400).json({ error: "Esperado body com campo `data` (base64) ou Content-Type: application/pdf" });
        return;
      }
      buffer = Buffer.from(data, "base64");
      if (fn) filename = fn;
    }

    if (buffer.length === 0) {
      res.status(400).json({ error: "PDF vazio" });
      return;
    }

    const result = storePdf(buffer, filename);

    if ("error" in result) {
      if (result.error === "invalid_pdf") {
        res.status(400).json({ error: "O arquivo enviado não é um PDF válido" });
      } else if (result.error === "too_large") {
        res.status(413).json({ error: "PDF excede o tamanho máximo permitido" });
      } else if (result.error === "store_full") {
        res.status(503).json({ error: "Serviço temporariamente indisponível. Tente novamente em instantes." });
      } else {
        res.status(500).json({ error: "Erro ao armazenar PDF temporário" });
      }
      return;
    }

    // Use trusted base URL from env configuration (DOCREGEN_APP_URL > REPLIT_DOMAINS > fallback)
    // Never trust req.headers.host for constructing URLs that will be shared externally
    const base = getBaseUrl(req);
    const path = `${API_PREFIX}/pdf/temp/${result.id}`;
    const url = `${base}${path}`;

    res.json({ url, path, expiresIn: Math.floor(Number(process.env["PDF_TEMP_TTL_SECONDS"] ?? 1800)) });
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "PDF_TOO_LARGE") {
      // Socket was already destroyed; can't write a full HTTP response.
      // Attempt a 413 in case the socket is still writable (e.g. HTTP/1.1 with
      // headers already sent but body truncated), otherwise silently swallow.
      try {
        if (!res.headersSent) {
          res.status(413).json({ error: "PDF excede o tamanho máximo permitido" });
        }
      } catch {
        // Socket destroyed — nothing to do.
      }
      return;
    }
    req.log.error({ err }, "pdf/temp upload failed");
    res.status(500).json({ error: "Erro ao armazenar PDF temporário" });
  }
});

/**
 * GET /regen-api/pdf/temp/:id
 * Serves the stored PDF. No auth — the 128-bit random hex token is the secret.
 * Responds with Content-Disposition: inline so Safari opens a PDF viewer
 * (not a download) and the user can tap the native iOS Share button.
 */
router.get("/pdf/temp/:id", (req, res): void => {
  const rawId = req.params["id"] ?? "";

  // getPdf already validates the format (32-char hex); return 404 for anything else
  const entry = getPdf(rawId);
  if (!entry) {
    res.status(404).json({ error: "PDF não encontrado ou expirado" });
    return;
  }

  // Content-Disposition: inline → Safari opens the PDF viewer in-browser.
  // This is critical — "attachment" would trigger a download instead.
  // filename is already sanitized by storePdf/sanitizeFilename.
  const safe = encodeURIComponent(entry.filename);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${safe}"; filename*=UTF-8''${safe}`);
  res.setHeader("Content-Length", entry.buffer.length);
  res.setHeader("Cache-Control", "no-store");
  res.send(entry.buffer);
});

export default router;
