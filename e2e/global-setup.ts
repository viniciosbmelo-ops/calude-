/**
 * Boots everything the E2E suite needs, all local and throwaway:
 *   - resets the two disposable databases (E2E_DOCKNEE_DATABASE_URL,
 *     E2E_DOCREGEN_DATABASE_URL) and applies each app's Drizzle schema
 *   - starts the fake object-storage sidecar/GCS (test-only)
 *   - builds and starts both APIs, and both Vite dev servers (proxying their API)
 * Everything runs with TZ=America/Sao_Paulo. The returned function stops it all.
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { startFakeObjectStorage } from "../artifacts/api-server/src/test-support/fakeObjectStorage";
import { DB, PORTS, ROOT, SCREENSHOT_DIR, TZ, URLS } from "./support/env";

const children: ChildProcess[] = [];
const LOG_DIR = path.join(ROOT, "e2e", "test-results", "server-logs");

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv): void {
  execFileSync(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: "pipe" });
}

function resetDatabase(url: string): void {
  execFileSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-q", "-c",
    "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"], { stdio: "pipe" });
}

function start(name: string, cmd: string, args: string[], env: NodeJS.ProcessEnv, cwd = ROOT): void {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const log = fs.openSync(path.join(LOG_DIR, `${name}.log`), "w");
  const child = spawn(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", log, log],
    detached: true,
  });
  children.push(child);
}

async function waitFor(url: string, name: string, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${name} did not become ready at ${url}: ${String(lastError)} (see ${LOG_DIR}/${name}.log)`);
}

function stopAll(): void {
  for (const child of children) {
    if (child.pid && child.exitCode === null) {
      try { process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ }
    }
  }
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  if (process.env["E2E_REUSE_SERVERS"] === "1") {
    // A stack started with `pnpm run e2e:serve` is already running.
    await waitFor(`${URLS.dockneeApi}/api/healthz`, "docknee-api", 5_000);
    await waitFor(`${URLS.docregenApi}/regen-api/healthz`, "docregen-api", 5_000);
    return async () => {};
  }
  const dockneeDb = DB.docknee;
  const docregenDb = DB.docregen;
  if (dockneeDb === docregenDb) throw new Error("DocKnee and DocRegen E2E databases must differ");

  resetDatabase(dockneeDb);
  resetDatabase(docregenDb);
  run("pnpm", ["--filter", "@workspace/db", "run", "push-force"], { DATABASE_URL: dockneeDb });
  run("pnpm", ["--filter", "@workspace/docregen-db", "run", "push-force"], { DOCREGEN_DATABASE_URL: docregenDb });

  if (process.env["E2E_SKIP_BUILD"] !== "1") {
    run("pnpm", ["--filter", "@workspace/api-server", "run", "build"], {});
    run("pnpm", ["--filter", "@workspace/docregen-api", "run", "build"], {});
  }

  const storage = await startFakeObjectStorage({ port: PORTS.storage });

  const common: NodeJS.ProcessEnv = {
    TZ,
    // "test" only disables the per-IP rate limiters (every E2E request comes
    // from 127.0.0.1, doctor and patient alike, so a fast run exceeds the
    // 300 req/min global limit). Everything else behaves as in development.
    NODE_ENV: "test",
    LOG_LEVEL: "warn",
    OBJECT_STORAGE_SIDECAR_ENDPOINT: storage.url,
    OBJECT_STORAGE_API_ENDPOINT: storage.url,
    // AI integrations point at a closed port: AI features answer with errors,
    // nothing leaves the machine.
    AI_INTEGRATIONS_GEMINI_BASE_URL: "http://127.0.0.1:9/gemini",
    AI_INTEGRATIONS_GEMINI_API_KEY: "e2e-fake",
    AI_INTEGRATIONS_OPENAI_BASE_URL: "http://127.0.0.1:9/openai",
    AI_INTEGRATIONS_OPENAI_API_KEY: "e2e-fake",
    // Never reach real messaging/billing providers.
    REPLIT_CONNECTORS_HOSTNAME: "",
    REPL_IDENTITY: "",
    WEB_REPL_RENEWAL: "",
    STRIPE_SECRET_KEY: "",
    DOCREGEN_STRIPE_SECRET_KEY: "",
    EVOLUTION_API_URL: "",
    DOCREGEN_EVOLUTION_API_URL: "",
    GMAIL_USER: "",
    DOCREGEN_GMAIL_USER: "",
  };

  start("docknee-api", "node", ["--enable-source-maps", "dist/index.mjs"], {
    ...common,
    PORT: String(PORTS.dockneeApi),
    DATABASE_URL: dockneeDb,
    SESSION_SECRET: "e2e-docknee-session-secret-0123456789abcdef",
    APP_URL: URLS.dockneeWeb,
    PRIVATE_OBJECT_DIR: "/e2e-bucket/docknee-private",
    PUBLIC_OBJECT_SEARCH_PATHS: "/e2e-bucket/docknee-public",
  }, path.join(ROOT, "artifacts", "api-server"));
  start("docregen-api", "node", ["--enable-source-maps", "dist/index.mjs"], {
    ...common,
    PORT: String(PORTS.docregenApi),
    DOCREGEN_DATABASE_URL: docregenDb,
    DOCREGEN_SESSION_SECRET: "e2e-docregen-session-secret-0123456789abcdef",
    DOCREGEN_APP_URL: URLS.docregenWeb,
    DOCREGEN_PRIVATE_OBJECT_DIR: "/e2e-bucket/docregen-private",
    DOCREGEN_PUBLIC_OBJECT_SEARCH_PATHS: "/e2e-bucket/docregen-public",
  }, path.join(ROOT, "artifacts", "docregen-api"));
  start("docknee-web", "pnpm", ["--filter", "@workspace/docknee", "run", "dev"], {
    TZ,
    PORT: String(PORTS.dockneeWeb),
    BASE_PATH: "/",
    API_PROXY_TARGET: URLS.dockneeApi,
  });
  start("docregen-web", "pnpm", ["--filter", "@workspace/docregen", "run", "dev"], {
    TZ,
    PORT: String(PORTS.docregenWeb),
    BASE_PATH: "/docregen/",
    API_PROXY_TARGET: URLS.docregenApi,
  });

  const teardown = async () => {
    stopAll();
    await storage.close();
  };
  process.on("exit", stopAll);

  try {
    await Promise.all([
      waitFor(`${URLS.dockneeApi}/api/healthz`, "docknee-api"),
      waitFor(`${URLS.docregenApi}/regen-api/healthz`, "docregen-api"),
      waitFor(`${URLS.dockneeWeb}/`, "docknee-web"),
      waitFor(`${URLS.docregenWeb}/docregen/`, "docregen-web"),
    ]);
  } catch (error) {
    await teardown();
    throw error;
  }
  return teardown;
}
