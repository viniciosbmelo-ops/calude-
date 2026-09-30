/** Ports, URLs and fictional credentials shared by the E2E global setup and specs. */
import path from "node:path";

export const ROOT = path.resolve(__dirname, "..", "..");

const port = (name: string, fallback: number) => Number(process.env[name] ?? fallback);

export const PORTS = {
  storage: port("E2E_STORAGE_PORT", 18090),
  dockneeApi: port("E2E_DOCKNEE_API_PORT", 18080),
  dockneeWeb: port("E2E_DOCKNEE_WEB_PORT", 18081),
  docregenApi: port("E2E_DOCREGEN_API_PORT", 18082),
  docregenWeb: port("E2E_DOCREGEN_WEB_PORT", 18083),
};

export const URLS = {
  storage: `http://127.0.0.1:${PORTS.storage}`,
  dockneeApi: `http://127.0.0.1:${PORTS.dockneeApi}`,
  dockneeWeb: `http://127.0.0.1:${PORTS.dockneeWeb}`,
  docregenApi: `http://127.0.0.1:${PORTS.docregenApi}`,
  docregenWeb: `http://127.0.0.1:${PORTS.docregenWeb}`,
};

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is required: point it at a DISPOSABLE PostgreSQL database (see e2e/README.md). ` +
      "The E2E suite drops and recreates its schema.",
    );
  }
  return value;
}

export const DB = {
  get docknee() { return requireEnv("E2E_DOCKNEE_DATABASE_URL"); },
  get docregen() { return requireEnv("E2E_DOCREGEN_DATABASE_URL"); },
};

/** Where key-step screenshots are written (in addition to Playwright's failure screenshots). */
export const SCREENSHOT_DIR = process.env["E2E_SCREENSHOT_DIR"] ?? path.join(ROOT, "e2e", "screenshots");

export const TZ = "America/Sao_Paulo";

/** Unique per run so specs also work against a reused (not reset) stack. */
export const RUN_ID = (process.env["E2E_RUN_ID"] ??= Date.now().toString(36));

/** Fictional accounts. Passwords only ever exist in the throwaway E2E databases. */
export const DOCREGEN_DOCTOR = {
  nome: "Dra. Helena Ficticia",
  email: `helena.${RUN_ID}@docregen.e2e.test`,
  senha: "SenhaE2E!2026",
};
export const DOCREGEN_OTHER_DOCTOR = {
  nome: "Dr. Outro Ficticio",
  email: `outro.${RUN_ID}@docregen.e2e.test`,
  senha: "SenhaE2E!2026",
};
export const DOCKNEE_DOCTOR = {
  nome: "Dr. Joelho Ficticio",
  email: `joelho.${RUN_ID}@docknee.e2e.test`,
  senha: "SenhaE2E!2026",
};
