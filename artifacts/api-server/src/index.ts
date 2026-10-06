import app from "./app";
import { logger } from "./lib/logger";
import { validateSecrets } from "./lib/validate-secrets";
import { startFollowupCron } from "./lib/followup-cron";
import { initStripe } from "./lib/initStripe";
import { assertRequiredSchema } from "./lib/schema-guard";
import { checkDecisionSupportProtection } from "./lib/decision-support-protection";
import { db, doctorsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashPassword } from "./lib/auth";
import { initRegenData } from "./routes/regen";
import { purgeExpiredGrants } from "./lib/uploadGrants";
import { processStorageCleanupJobs } from "./lib/storageCleanup";
import { startRedFlagOutboxWorker } from "./services/redFlagAlerts";

validateSecrets();

// ─────────────────────────────────────────────────────────────────────────────
// Admin bootstrap (data, not DDL)
// ─────────────────────────────────────────────────────────────────────────────

async function ensureAdminExists(): Promise<void> {
  const email = process.env["ADMIN_BOOTSTRAP_EMAIL"]?.trim().toLowerCase();
  const password = process.env["ADMIN_BOOTSTRAP_PASSWORD"];

  if (!email && !password) {
    logger.info("Admin bootstrap disabled; no bootstrap credentials configured");
    return;
  }
  if (!email || !password) {
    throw new Error(
      "ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD must be configured together",
    );
  }
  if (password.length < 12) {
    throw new Error("ADMIN_BOOTSTRAP_PASSWORD must contain at least 12 characters");
  }

  const [existing] = await db
    .select({ id: doctorsTable.id, isAdmin: doctorsTable.isAdmin, aprovado: doctorsTable.aprovado })
    .from(doctorsTable)
    .where(eq(doctorsTable.email, email))
    .limit(1);

  if (!existing) {
    const senhaHash = await hashPassword(password);
    await db.insert(doctorsTable).values({
      nome: process.env["ADMIN_BOOTSTRAP_NAME"]?.trim() || "Administrador DocSholder",
      email,
      senhaHash,
      isAdmin: true,
      aprovado: true,
    });
    logger.info("Admin account created from explicit bootstrap configuration");
  } else if (!existing.isAdmin || !existing.aprovado) {
    await db
      .update(doctorsTable)
      .set({ isAdmin: true, aprovado: true })
      .where(eq(doctorsTable.email, email));
    logger.info("Admin account role restored from explicit bootstrap configuration");
  }
}

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
  // Gatilhos só de inserção do apoio à decisão (não roda no deploy): ausentes → erro no log e gravação do
  // apoio à decisão em 503; o restante do servidor sobe normalmente.
  await checkDecisionSupportProtection();

  // ── 2. Required reference-data bootstrap ──────────────────────────────────
  await initRegenData();

  // ── 3. Admin data bootstrap ───────────────────────────────────────────────
  await ensureAdminExists();

  // ── 4. Start HTTP server ───────────────────────────────────────────────────
  await new Promise<void>((resolve, reject) => {
    const server = app.listen(port, () => {
      logger.info({ port }, "Server listening");
      resolve();
    });
    server.on("error", reject);
  });

  // ── 5. Non-critical background tasks (after listen) ───────────────────────
  void initStripe();
  startFollowupCron();
  startRedFlagOutboxWorker();
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

// Top-level entry point — only this module calls process.exit.
startServer().catch((err: unknown) => {
  logger.fatal({ err }, "Startup failed — aborting");
  process.exitCode = 1;
  // Allow pino to flush before hard exit.
  setImmediate(() => process.exit(1));
});
