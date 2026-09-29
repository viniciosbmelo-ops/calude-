/**
 * DocRegen API entry point.
 *
 * Configuration is validated BEFORE any module that opens the database is
 * loaded: DocRegen refuses to start without its own DOCREGEN_DATABASE_URL and
 * DOCREGEN_SESSION_SECRET (no fallback to DocKnee's DATABASE_URL /
 * SESSION_SECRET). The DocRegen DB module enforces the same rule on import.
 */
import { logger } from "./lib/logger";
import { validateSecrets } from "./lib/validate-secrets";

validateSecrets();

const { startServer } = await import("./server");

// Top-level entry point — only this module calls process.exit.
startServer().catch((err: unknown) => {
  logger.fatal({ err }, "Startup failed — aborting");
  process.exitCode = 1;
  // Allow pino to flush before hard exit.
  setImmediate(() => process.exit(1));
});
