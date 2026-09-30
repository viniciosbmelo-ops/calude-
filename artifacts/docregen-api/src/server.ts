import app from "./app";
import { logger } from "./lib/logger";
import { initStripe } from "./lib/initStripe";
import { assertRequiredSchema } from "./lib/schema-guard";
import { initRegenData } from "./routes/regen";
import { purgeExpiredGrants } from "./lib/uploadGrants";
import { processStorageCleanupJobs } from "./lib/storageCleanup";
import { purgeExpiredPdfs } from "./lib/tempPdfStore";
import { startWhatsAppOutboxWorker } from "./services/whatsappOutbox";

// ─────────────────────────────────────────────────────────────────────────────
// Server startup
//
// startServer() throws on any pre-listen failure — no process.exit() inside
// the function so it remains testable. The top-level caller handles exit.
//
// NOTE: No DDL runs here. Managed PostgreSQL forbids startup-time schema
// mutation, so we only assert (read-only) that the schema is present before
// accepting traffic. Schema is applied by drizzle-kit push (dev) or the Publish
// schema diff (prod).
// ─────────────────────────────────────────────────────────────────────────────

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

export async function startServer(): Promise<void> {
  // ── 1. Read-only schema assertion (no DDL) ─────────────────────────────────
  await assertRequiredSchema();

  // ── 2. Required reference-data bootstrap ──────────────────────────────────
  await initRegenData();

  // ── 3. Start HTTP server ───────────────────────────────────────────────────
  await new Promise<void>((resolve, reject) => {
    const server = app.listen(port, () => {
      logger.info({ port }, "Server listening");
      resolve();
    });
    server.on("error", reject);
  });

  // ── 4. Non-critical background tasks (after listen) ───────────────────────
  void initStripe();
  startWhatsAppOutboxWorker();
  void purgeExpiredGrants().catch((err) => {
    logger.warn({ err }, "Falha na limpeza inicial de uploads expirados");
  });
  void processStorageCleanupJobs().then((result) => {
    if (result.failed > 0) {
      logger.warn({ failed: result.failed }, "Arquivos permaneceram na fila de exclusão");
    }
  }).catch((err) => {
    logger.warn({ err }, "Falha na limpeza inicial de arquivos excluídos");
  });
  const uploadCleanupTimer = setInterval(() => {
    void purgeExpiredPdfs().catch((err) => {
      logger.warn({ err }, "Falha na limpeza periódica de PDFs temporários");
    });
    void purgeExpiredGrants().catch((err) => {
      logger.warn({ err }, "Falha na limpeza periódica de uploads expirados");
    });
    void processStorageCleanupJobs().then((result) => {
      if (result.failed > 0) {
        logger.warn({ failed: result.failed }, "Arquivos permaneceram na fila de exclusão");
      }
    }).catch((err) => {
      logger.warn({ err }, "Falha na limpeza periódica de arquivos excluídos");
    });
  }, 60 * 60 * 1000);
  uploadCleanupTimer.unref();
}
