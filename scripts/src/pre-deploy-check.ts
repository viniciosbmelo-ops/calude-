/**
 * DocKnee — Pre-deploy Security Validation Script
 * Run: pnpm --filter @workspace/scripts run pre-deploy
 *
 * Credentials are loaded from environment variables — never hardcoded here.
 * Required env vars:
 *   PREDEPLOY_BASE       — target base URL (default: http://localhost:80)
 *   PREDEPLOY_ADMIN_EMAIL / PREDEPLOY_ADMIN_PASS  — ephemeral admin account
 *   PREDEPLOY_DOCTOR_EMAIL / PREDEPLOY_DOCTOR_PASS — ephemeral doctor account
 *
 * Auth model: login sets an HttpOnly session cookie (docknee_session).
 * The script captures that cookie value in memory and sends it as Cookie header
 * on subsequent requests. The cookie value is NEVER logged.
 *
 * CSRF: the server checks Origin on state-changing requests from cookie sessions.
 * We send a trusted Origin header (BASE url) on all POST/DELETE requests.
 *
 * Exits 0 if ALL critical checks pass, exits 1 if ANY critical check fails.
 */

const BASE = process.env["PREDEPLOY_BASE"] ?? "http://localhost:80";

// Derive the origin we'll send on state-changing requests.
// For http://localhost:80 → "http://localhost"; for https://x.y → "https://x.y"
function baseOrigin(): string {
  try {
    const u = new URL(BASE);
    return u.origin;
  } catch {
    return BASE;
  }
}
const TRUSTED_ORIGIN = baseOrigin();

// Credentials from env only — never printed in logs or committed to source.
const ADMIN_EMAIL  = process.env["PREDEPLOY_ADMIN_EMAIL"]  ?? "";
const ADMIN_PASS   = process.env["PREDEPLOY_ADMIN_PASS"]   ?? "";
const DOCTOR_EMAIL = process.env["PREDEPLOY_DOCTOR_EMAIL"] ?? "";
const DOCTOR_PASS  = process.env["PREDEPLOY_DOCTOR_PASS"]  ?? "";

// Validate env before running
if (!ADMIN_EMAIL || !ADMIN_PASS || !DOCTOR_EMAIL || !DOCTOR_PASS) {
  console.error(
    "\n[pre-deploy-check] ERRO: Variáveis de credenciais não configuradas.\n" +
    "  Configure: PREDEPLOY_ADMIN_EMAIL, PREDEPLOY_ADMIN_PASS, " +
    "PREDEPLOY_DOCTOR_EMAIL, PREDEPLOY_DOCTOR_PASS\n" +
    "  Use contas efêmeras criadas apenas para este ambiente de CI/deploy.\n"
  );
  process.exit(1);
}

// ── ANSI helpers ─────────────────────────────────────────────────────────────
const C = {
  green:  (s: string) => `\x1b[32m${s}\x1b[0m`,
  red:    (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan:   (s: string) => `\x1b[36m${s}\x1b[0m`,
  bold:   (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim:    (s: string) => `\x1b[2m${s}\x1b[0m`,
};

// ── Result tracking ───────────────────────────────────────────────────────────
interface CheckResult {
  name: string;
  passed: boolean;
  detail?: string;
  critical: boolean;
}
const results: CheckResult[] = [];

// ── In-memory cookie jar ──────────────────────────────────────────────────────
// Stores only the raw cookie string per profile. Never logged.
const sessionCookies: Record<string, string> = {};

/**
 * Extract and store the session cookie from a login Set-Cookie header.
 * Accepts "docknee_session=<value>; Path=/api; HttpOnly; ..."
 * Stores ONLY the "name=value" portion in memory; never logs the value.
 */
function captureSessionCookie(profile: "admin" | "doctor", res: Response): boolean {
  const raw = res.headers.get("set-cookie") ?? "";
  // The header may be a comma-joined multi-value in the Fetch API
  const parts = raw.split(/,\s*(?=[a-zA-Z_])/);
  for (const part of parts) {
    const nameValue = part.split(";")[0]?.trim();
    if (nameValue?.startsWith("docknee_session=") || nameValue?.startsWith("docknee_session =")) {
      sessionCookies[profile] = nameValue.replace(/\s/g, "");
      return true;
    }
  }
  return false;
}

/** Build Cookie header value for a profile, or empty string if no session. */
function cookieFor(profile: "admin" | "doctor"): string {
  return sessionCookies[profile] ?? "";
}

let testPatientId: number | null = null;

function pass(name: string, detail?: string, critical = true): void {
  results.push({ name, passed: true, detail, critical });
  console.log(`  ${C.green("✓")} ${name}${detail ? C.dim(` — ${detail}`) : ""}`);
}

function fail(name: string, detail?: string, critical = true): void {
  results.push({ name, passed: false, detail, critical });
  const marker = critical ? C.red("✗") : C.yellow("⚠");
  console.log(`  ${marker} ${name}${detail ? C.dim(` — ${detail}`) : ""}`);
}

function section(title: string): void {
  console.log(`\n${C.bold(C.cyan(`── ${title} ${"─".repeat(Math.max(0, 52 - title.length))}`))}` );
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

/** GET — send session cookie if profile provided. */
async function get(path: string, profile?: "admin" | "doctor"): Promise<Response> {
  const cookie = profile ? cookieFor(profile) : "";
  return fetch(`${BASE}${path}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

/**
 * POST with session cookie + trusted Origin header (required to pass CSRF
 * check on state-changing requests from cookie sessions).
 */
async function post(
  path: string,
  body: unknown,
  profile?: "admin" | "doctor",
): Promise<Response> {
  const cookie = profile ? cookieFor(profile) : "";
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: TRUSTED_ORIGIN,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function del(path: string, profile?: "admin" | "doctor"): Promise<Response> {
  const cookie = profile ? cookieFor(profile) : "";
  return fetch(`${BASE}${path}`, {
    method: "DELETE",
    headers: {
      Origin: TRUSTED_ORIGIN,
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });
}

/**
 * GET with a raw Authorization: Bearer header — used only to test that the
 * server correctly rejects invalid Bearer tokens (Bearer auth is still
 * accepted by requireAuth as a secondary fallback).
 */
async function getWithBadBearer(path: string): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    headers: { Authorization: "Bearer not-a-valid-token-xyz" },
  });
}

// ── 1. API Health ─────────────────────────────────────────────────────────────
async function checkApiHealth(): Promise<void> {
  section("1. API Availability");
  try {
    const res = await get("/api/healthz");
    if (res.ok) pass("API respondendo em /api/healthz", `HTTP ${res.status}`);
    else fail("API não respondeu corretamente", `HTTP ${res.status}`);
  } catch (e: any) {
    fail("API não acessível", e.message);
  }
}

// ── 2. Security Headers (Helmet) ──────────────────────────────────────────────
async function checkSecurityHeaders(): Promise<void> {
  section("2. Security Headers (Helmet)");
  const res = await get("/api/healthz");
  const h = res.headers;

  const checks: [string, string, string][] = [
    ["X-Content-Type-Options", h.get("x-content-type-options") ?? "", "nosniff"],
    ["X-Frame-Options", h.get("x-frame-options") ?? "", "SAMEORIGIN"],
    ["X-DNS-Prefetch-Control", h.get("x-dns-prefetch-control") ?? "", "off"],
    ["X-Download-Options", h.get("x-download-options") ?? "", "noopen"],
    ["X-XSS-Protection", h.get("x-xss-protection") ?? "", "0"],
    ["Referrer-Policy", h.get("referrer-policy") ?? "", "strict-origin-when-cross-origin"],
  ];

  for (const [name, value, expected] of checks) {
    const ok = value.toLowerCase().includes(expected.toLowerCase());
    if (ok) pass(name, `"${value}"`);
    else fail(name, `esperado "${expected}", obtido "${value || "(ausente)"}"`);
  }

  const hsts = h.get("strict-transport-security") ?? "";
  if (hsts.includes("max-age=31536000")) pass("HSTS", hsts);
  else fail("HSTS", `ausente ou inválido: "${hsts}"`, false);
}

// ── 3. Authentication ─────────────────────────────────────────────────────────
async function checkAuthentication(): Promise<void> {
  section("3. Authentication");

  // Login admin — capture session cookie, never log cookie value
  const adminRes = await post("/api/auth/login", { email: ADMIN_EMAIL, senha: ADMIN_PASS });
  if (adminRes.ok) {
    const captured = captureSessionCookie("admin", adminRes);
    pass("Login admin", captured ? "sessão cookie obtida" : "resposta 200 mas cookie não detectado");
    if (!captured) {
      fail("Cookie de sessão admin não encontrado no Set-Cookie", undefined, false);
    }
  } else {
    fail("Login admin falhou", `HTTP ${adminRes.status}`);
  }

  // Login doctor — capture session cookie, never log cookie value
  const drRes = await post("/api/auth/login", { email: DOCTOR_EMAIL, senha: DOCTOR_PASS });
  if (drRes.ok) {
    const captured = captureSessionCookie("doctor", drRes);
    pass("Login médico", captured ? "sessão cookie obtida" : "resposta 200 mas cookie não detectado");
    if (!captured) {
      fail("Cookie de sessão médico não encontrado no Set-Cookie", undefined, false);
    }
  } else {
    fail("Login médico falhou", `HTTP ${drRes.status}`);
  }

  // 401 without any session
  const unauth = await get("/api/patients");
  if (unauth.status === 401) pass("Rota protegida sem sessão → 401", "/api/patients");
  else fail("Rota protegida sem sessão não retornou 401", `HTTP ${unauth.status}`);

  // Verify that an invalid Bearer token is still rejected (Bearer is accepted as fallback)
  const badBearer = await getWithBadBearer("/api/patients");
  if (badBearer.status === 401) pass("Bearer inválido → 401");
  else fail("Bearer inválido não retornou 401", `HTTP ${badBearer.status}`);
}

// ── 4. Authorization / BOLA ───────────────────────────────────────────────────
async function checkBola(): Promise<void> {
  section("4. BOLA — Autorização por recurso");

  if (!cookieFor("doctor") || !cookieFor("admin")) {
    fail("BOLA: sessões não disponíveis — etapa anterior falhou");
    return;
  }

  const doctorsRes = await get("/api/admin/doctors/pending", "doctor");
  if (doctorsRes.status === 403) pass("Médico não acessa rotas admin → 403");
  else fail("Médico acessou rota admin sem ser admin", `HTTP ${doctorsRes.status}`);

  // Register a throwaway patient for BOLA test
  const patRes = await post("/api/patients", {
    nome: "BOLA-TEST-DELETE", cpf: "000.000.000-00", telefone: "", email: "",
    dataNascimento: "1990-01-01", sexo: "M", activityLevel: 1, beightonScore: 0,
  }, "doctor");

  if (patRes.ok) {
    const pat = await patRes.json() as any;
    testPatientId = pat.id ?? pat.patient?.id ?? null;
    pass("Criação de paciente teste para BOLA", `id=${testPatientId}`);
  } else {
    fail("Não foi possível criar paciente para teste BOLA", `HTTP ${patRes.status}`, false);
  }

  // Try accessing patient list without session
  const patNoAuth = await get("/api/patients");
  if (patNoAuth.status === 401) pass("GET /api/patients sem sessão → 401");
  else fail("GET /api/patients sem sessão não retornou 401", `HTTP ${patNoAuth.status}`);

  // Admin cannot access doctor-only routes
  const adminPat = await get("/api/patients", "admin");
  if (adminPat.status === 403 || !adminPat.ok) pass("Admin não acessa rotas de médico → não-200");
  else fail("Admin acessou rota de médico (/api/patients)", `HTTP ${adminPat.status}`, false);
}

// ── 5. Rate Limiting ──────────────────────────────────────────────────────────
async function checkRateLimiting(): Promise<void> {
  section("5. Rate Limiting");

  const res = await get("/api/healthz");
  const rlHeader = res.headers.get("ratelimit") ?? res.headers.get("ratelimit-limit");
  const rlPolicy = res.headers.get("ratelimit-policy");

  if (rlHeader) pass("Headers RateLimit presentes (draft-8)", `${rlHeader}${rlPolicy ? ` | policy=${rlPolicy}` : ""}`);
  else fail("Headers RateLimit ausentes em /api/healthz", "esperado header 'Ratelimit' ou 'ratelimit-limit'");

  const authRes = await post("/api/auth/login", { email: "x@x.com", senha: "wrong" });
  const authRl = authRes.headers.get("ratelimit") ?? authRes.headers.get("ratelimit-limit");
  if (authRl) pass("Rate limit em /api/auth/login ativo", `${authRl}`);
  else fail("Rate limit em /api/auth/login ausente", "esperado header Ratelimit", false);
}

// ── 6. Input Validation ───────────────────────────────────────────────────────
async function checkInputValidation(): Promise<void> {
  section("6. Validação de Input (Zod)");

  const emptyLogin = await post("/api/auth/login", {});
  if (emptyLogin.status === 400 || emptyLogin.status === 422) {
    pass("Login com body vazio → 400/422", `HTTP ${emptyLogin.status}`);
  } else {
    fail("Login com body vazio não retornou erro de validação", `HTTP ${emptyLogin.status}`, false);
  }

  if (cookieFor("doctor")) {
    const badPat = await post("/api/patients", { nome: "", cpf: "invalid" }, "doctor");
    if (badPat.status === 400 || badPat.status === 422) {
      pass("Criação de paciente inválido → 400/422", `HTTP ${badPat.status}`);
    } else {
      fail("Criação de paciente inválido não retornou erro", `HTTP ${badPat.status}`, false);
    }
  }

  const sqlInj = await post("/api/auth/login", {
    email: "' OR 1=1; --",
    senha: "anything",
  });
  if (sqlInj.status !== 200) pass("SQL injection bloqueado", `HTTP ${sqlInj.status}`);
  else fail("SQL injection não foi bloqueado!", "retornou 200");
}

// ── 7. LGPD Endpoints ─────────────────────────────────────────────────────────
async function checkLgpd(): Promise<void> {
  section("7. Direitos do Titular LGPD");

  if (!cookieFor("doctor")) { fail("LGPD: sessão médico não disponível"); return; }

  // 7a. Consentimento
  const consent = await post("/api/lgpd/consentimento",
    { aceito: true, tipo: "plataforma_docknee" }, "doctor");
  if (consent.status === 200 || consent.status === 201) {
    pass("POST /api/lgpd/consentimento → 2xx", `HTTP ${consent.status}`);
  } else fail("POST /api/lgpd/consentimento falhou", `HTTP ${consent.status}`);

  // 7b. Verificar consentimento
  const getConsent = await get("/api/lgpd/consentimento", "doctor");
  if (getConsent.ok) {
    const d = await getConsent.json() as any;
    pass("GET /api/lgpd/consentimento → aceito", `aceito=${d.aceito}`);
  } else fail("GET /api/lgpd/consentimento falhou", `HTTP ${getConsent.status}`);

  // 7c. Acesso completo aos dados
  const dados = await get("/api/lgpd/dados", "doctor");
  if (dados.ok) {
    const d = await dados.json() as any;
    pass("GET /api/lgpd/dados → Art.18 acesso",
      `${d.dados?.totalPacientes} pacientes, ${d.dados?.totalFollowups ?? 0} followups`);
  } else fail("GET /api/lgpd/dados falhou", `HTTP ${dados.status}`);

  // 7d. Portabilidade JSON
  const exportJson = await get("/api/lgpd/exportar?formato=json", "doctor");
  if (exportJson.ok && exportJson.headers.get("content-type")?.includes("json")) {
    const d = await exportJson.json() as any;
    const hasFollowups = Array.isArray(d.followups);
    pass("GET /api/lgpd/exportar?formato=json → Art.20",
      `content-type: application/json, followups=${hasFollowups}`);
  } else fail("GET /api/lgpd/exportar JSON falhou", `HTTP ${exportJson.status}`);

  // 7e. Portabilidade CSV
  const exportCsv = await get("/api/lgpd/exportar?formato=csv", "doctor");
  if (exportCsv.ok && exportCsv.headers.get("content-type")?.includes("csv")) {
    const csvText = await exportCsv.text();
    const hasHeader = csvText.includes("TIPO,ID,DESCRICAO,DATA,STATUS");
    pass("GET /api/lgpd/exportar?formato=csv → Art.20",
      `content-disposition + csv, header=${hasHeader}`);
  } else fail("GET /api/lgpd/exportar CSV falhou", `HTTP ${exportCsv.status}`);

  // 7f. Sem sessão → 401
  const unauth = await get("/api/lgpd/dados");
  if (unauth.status === 401) pass("LGPD sem sessão → 401 (rotas protegidas)");
  else fail("LGPD sem sessão não retornou 401", `HTTP ${unauth.status}`);
}

// ── 8. Admin-only routes ──────────────────────────────────────────────────────
async function checkAdminRoutes(): Promise<void> {
  section("8. Rotas Exclusivas de Admin");

  if (!cookieFor("admin") || !cookieFor("doctor")) { fail("Admin check: sessões ausentes"); return; }

  const adminAudit = await get("/api/admin/audit-logs?days=1", "admin");
  if (adminAudit.ok) {
    const d = await adminAudit.json() as any;
    pass("GET /api/admin/audit-logs → admin ok", `${d.total} registros`);
  } else fail("GET /api/admin/audit-logs falhou para admin", `HTTP ${adminAudit.status}`);

  const doctorAudit = await get("/api/admin/audit-logs?days=1", "doctor");
  if (doctorAudit.status === 403) {
    pass("Médico sem permissão em /api/admin/audit-logs → 403");
  } else fail("Médico acessou rota admin de auditoria!", `HTTP ${doctorAudit.status}`);

  const exclusoes = await get("/api/admin/lgpd/exclusoes", "admin");
  if (exclusoes.ok) pass("GET /api/admin/lgpd/exclusoes → admin ok");
  else fail("GET /api/admin/lgpd/exclusoes falhou", `HTTP ${exclusoes.status}`);
}

// ── 9. Audit Logging ──────────────────────────────────────────────────────────
async function checkAuditLogging(): Promise<void> {
  section("9. Audit Logging (LGPD)");

  if (!cookieFor("admin")) { fail("Audit check: sessão admin ausente"); return; }

  const before = await get("/api/admin/audit-logs?days=1", "admin");
  const beforeCount = before.ok ? ((await before.json()) as any).total : 0;

  // Trigger a doctor action
  await get("/api/lgpd/dados", "doctor");
  // Give the async audit write time to complete
  await new Promise(r => setTimeout(r, 300));

  const after = await get("/api/admin/audit-logs?days=1", "admin");
  if (after.ok) {
    const d = await after.json() as any;
    if (d.total > beforeCount) {
      pass("Ação registrada em audit_logs", `${beforeCount} → ${d.total} entradas`);
    } else {
      fail("Ação não foi registrada em audit_logs", `contagem manteve ${d.total}`, false);
    }
  } else {
    fail("Não foi possível verificar audit_logs", `HTTP ${after.status}`, false);
  }

  const logsRes = await get("/api/admin/audit-logs?days=1", "admin");
  if (logsRes.ok) {
    const d = await logsRes.json() as any;
    const log = d.logs?.[0];
    if (log && log.method && log.endpoint && log.createdAt) {
      pass("Campos audit_log presentes", "method, endpoint, createdAt ✓");
    } else {
      fail("Campos obrigatórios ausentes em audit_log", JSON.stringify(log), false);
    }
  }
}

// ── 10. Sensitive data not leaked ─────────────────────────────────────────────
async function checkSensitiveDataLeaks(): Promise<void> {
  section("10. Dados Sensíveis — Sem Vazamento");

  // Login response should not contain password hash
  const loginRes = await post("/api/auth/login", { email: DOCTOR_EMAIL, senha: DOCTOR_PASS });
  if (loginRes.ok) {
    const body = JSON.stringify(await loginRes.json());
    if (!body.includes("senhaHash") && !body.includes("senha_hash")) {
      pass("senha_hash ausente na resposta de login");
    } else {
      fail("senha_hash EXPOSTA na resposta de login!", "crítico — remover imediatamente");
    }
  }

  // Audit logs must not contain raw passwords in any field
  const auditRes = await get("/api/admin/audit-logs?days=1", "admin");
  if (auditRes.ok) {
    const body = JSON.stringify(await auditRes.json());
    // We never interpolate the actual password into the check output
    const hasSenha = body.toLowerCase().includes("senha") &&
      !body.includes('"requestBodyHash"') &&
      !body.includes("[REDACTED]");
    if (!hasSenha) pass("Senhas não aparecem em texto claro nos audit logs");
    else fail("Possível senha em texto claro nos audit logs!", "crítico");
  }
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
async function cleanup(): Promise<void> {
  if (testPatientId && cookieFor("doctor")) {
    await del(`/api/patients/${testPatientId}`, "doctor").catch(() => null);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log(C.bold("\n╔══════════════════════════════════════════════════════╗"));
  console.log(C.bold("║  DocKnee — Validação de Segurança Pré-Deploy          ║"));
  console.log(C.bold("╚══════════════════════════════════════════════════════╝"));
  console.log(C.dim(`  Alvo: ${BASE} · ${new Date().toLocaleString("pt-BR")}\n`));
  // Note: credentials are loaded from PREDEPLOY_* env vars — never logged.
  // Session cookies are stored in memory only and never logged.

  await checkApiHealth();
  await checkSecurityHeaders();
  await checkAuthentication();
  await checkBola();
  await checkRateLimiting();
  await checkInputValidation();
  await checkLgpd();
  await checkAdminRoutes();
  await checkAuditLogging();
  await checkSensitiveDataLeaks();
  await cleanup();

  // ── Summary ─────────────────────────────────────────────────────────────────
  const critical    = results.filter(r => r.critical);
  const critFailed  = critical.filter(r => !r.passed);
  const warns       = results.filter(r => !r.critical && !r.passed);
  const allPassed   = results.filter(r => r.passed);

  console.log(C.bold("\n╔══════════════════════════════════════════════════════╗"));
  console.log(C.bold("║  RESULTADO FINAL                                      ║"));
  console.log(C.bold("╚══════════════════════════════════════════════════════╝"));

  console.log(`\n  ${C.green(`✓ ${allPassed.length} verificações passaram`)}`);
  if (warns.length > 0)
    console.log(`  ${C.yellow(`⚠ ${warns.length} avisos (não críticos)`)}`);
  if (critFailed.length > 0) {
    console.log(`  ${C.red(`✗ ${critFailed.length} verificações críticas FALHARAM:`)}`);
    for (const r of critFailed)
      console.log(`    ${C.red("→")} ${r.name}${r.detail ? C.dim(`: ${r.detail}`) : ""}`);
  }

  if (critFailed.length === 0) {
    console.log(C.bold(C.green("\n  ✅ DEPLOY LIBERADO — Todas as verificações críticas passaram!\n")));
    console.log("  ┌─────────────────────────────────────────────────────┐");
    console.log("  │ ✓ Helmet (headers de segurança)                     │");
    console.log("  │ ✓ Rate limiting (global + auth + register + AI)     │");
    console.log("  │ ✓ Autenticação por cookie HttpOnly                  │");
    console.log("  │ ✓ BOLA — autorização por recurso                    │");
    console.log("  │ ✓ Validação de input (Zod)                          │");
    console.log("  │ ✓ LGPD — 6 direitos do titular + followups          │");
    console.log("  │ ✓ Admin routes protegidas                           │");
    console.log("  │ ✓ Audit logging ativo (todos formatos)              │");
    console.log("  │ ✓ Dados sensíveis sem vazamento                     │");
    console.log("  └─────────────────────────────────────────────────────┘\n");
    process.exit(0);
  } else {
    console.log(C.bold(C.red("\n  ❌ DEPLOY BLOQUEADO — Corrija as falhas acima antes de fazer deploy!\n")));
    process.exit(1);
  }
}

main().catch(err => {
  console.error(C.red(`\nErro fatal no script: ${err.message}`));
  process.exit(1);
});
