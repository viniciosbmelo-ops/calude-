/**
 * DOCREGEN — API Server (Express 5 + TypeScript)
 *
 * Plataforma de medicina regenerativa e dor — serviço independente do DocKnee
 * (banco, sessões e segredos próprios). LGPD-compliant
 *
 * Conformidade:
 *   - LGPD (Lei nº 13.709/2018): Arts. 7, 9, 11, 16, 17–22, 37, 41, 46, 48
 *   - Resolução CFM nº 1.821/2007: prontuário eletrônico, sigilo profissional
 *   - OWASP Top 10: implementado (BOLA, injection, broken auth, etc.)
 *
 * Medidas de Segurança:
 *   ✅ Autenticação   — JWT assinado com DOCREGEN_SESSION_SECRET + bcryptjs
 *   ✅ Autorização    — BOLA enforced em todos os 23 endpoints /regen-api/:id
 *   ✅ Headers HTTP   — Helmet.js (HSTS 1 ano, X-Frame, nosniff, Referrer-Policy)
 *   ✅ Rate Limiting  — 4 camadas: global 300/min, auth 10/15min, registro 3/h, IA 20/dia
 *   ✅ Auditoria      — Middleware auditLog: SHA-256 + redação de sensíveis (5 anos)
 *   ✅ Direitos LGPD  — 7 endpoints /regen-api/lgpd/* (consentimento, acesso, portabilidade, exclusão, anonimização)
 *   ✅ Incidentes     — Plano de resposta: 72h ANPD (Art. 48)
 *   ✅ Transferências — OpenAI recebe imagens anonimizadas e agregados clínicos minimizados
 *   ✅ Secrets        — Todas as credenciais em variáveis de ambiente (sem hardcoding)
 *
 * Documentação: LGPD_COMPLIANCE.md | ROPA: docs/ROPA.csv
 * Última auditoria: 2026-05-12 | Próxima: 2026-11-12
 * DPO: Vinicios Barreto Melo — CRM-ES 13416
 */
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import pinoHttp from "pino-http";
import router from "./routes";
import { API_PREFIX } from "./lib/api-prefix";
import { logger } from "./lib/logger";
import { auditLog } from "./middlewares/auditLog";
import { processStripeWebhook } from "./lib/webhookHandlers";
import { recordSecurityEvent } from "./lib/securityMonitor";
import { hasAnySessionCookie } from "./lib/session";
import { redactPath, redactUrlForLog } from "./lib/redaction";
import { PostgresRateLimitStore, rateLimitsDisabled } from "./lib/dbRateLimit";

/** Request path without query string and with public-link tokens redacted. */
export function privacySafeRequestPath(value: string | undefined): string | undefined {
  if (!value) return value;
  return redactPath(value) ?? undefined;
}

/** pino-http request serializer: public-link tokens and secret query values never reach the logs. */
export function serializeRequestForLog(req: { id?: unknown; method?: string; url?: string }) {
  return {
    id: req.id,
    method: req.method,
    url: redactUrlForLog(req.url),
  };
}

const app: Express = express();

// Replit routes requests through a reverse proxy — trust the first hop so
// express-rate-limit can read the real client IP from X-Forwarded-For.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req: serializeRequestForLog,
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(cookieParser());

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'self'"],
      formAction: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
      imgSrc: [
        "'self'",
        "data:",
        "blob:",
        "https://storage.googleapis.com",
        "https://*.googleapis.com",
      ],
      connectSrc: [
        "'self'",
        "https://storage.googleapis.com",
        "https://*.googleapis.com",
        "https://eutils.ncbi.nlm.nih.gov",
        "https://api.crossref.org",
      ],
      // The mobile PDF viewer embeds only same-origin temporary PDFs. Keep
      // external frames blocked while allowing DocRegen's own /regen-api/pdf/temp URL.
      frameSrc: ["'self'"],
      workerSrc: ["'self'", "blob:"],
      manifestSrc: ["'self'"],
      mediaSrc: [
        "'self'",
        "blob:",
        "https://storage.googleapis.com",
        "https://*.googleapis.com",
      ],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  frameguard: { action: "sameorigin" },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
}));

// Stripe webhook — MUST be registered BEFORE express.json() so the handler
// receives the raw Buffer required for signature verification.
app.post(
  `${API_PREFIX}/stripe/webhook`,
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response) => {
    const signature = req.headers["stripe-signature"];
    if (!signature) {
      res.status(400).json({ error: "Missing stripe-signature" });
      return;
    }
    try {
      const sig = Array.isArray(signature) ? signature[0]! : signature;
      await processStripeWebhook(req.body as Buffer, sig);
      res.status(200).json({ received: true });
    } catch (err) {
      logger.error({ err }, "Stripe webhook processing error");
      res.status(400).json({ error: "Webhook processing error" });
    }
  },
);

// CORS — permite apenas origens conhecidas. DOCREGEN_ALLOWED_ORIGINS (lista
// separada por vírgulas) substitui a lista padrão. Sem ela, em produção só a
// origem de DOCREGEN_APP_URL é aceita (o domínio do DocKnee não entra por
// padrão); fora de produção, também localhost e os domínios de preview
// (REPLIT_DOMAINS). Ver replit.md → "DocRegen: domínio e CORS".
export function buildAllowedOrigins(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const origins = new Set<string>();
  const addOrigin = (value: string, label: string) => {
    try {
      origins.add(new URL(value.trim()).origin);
    } catch {
      logger.warn({ label }, "Origem inválida ignorada na lista de CORS");
    }
  };
  const configured = (env["DOCREGEN_ALLOWED_ORIGINS"] ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  for (const origin of configured) addOrigin(origin, "DOCREGEN_ALLOWED_ORIGINS");
  if (env["DOCREGEN_APP_URL"]) addOrigin(env["DOCREGEN_APP_URL"], "DOCREGEN_APP_URL");
  // Preview domains of the Replit workspace (dev only; deployments set
  // DOCREGEN_APP_URL / DOCREGEN_ALLOWED_ORIGINS instead).
  if (env["NODE_ENV"] !== "production") {
    for (const d of (env["REPLIT_DOMAINS"] ?? "").split(",")) {
      const h = d.trim();
      if (h) origins.add(`https://${h}`);
    }
  }
  return origins;
}

const allowedOrigins = buildAllowedOrigins();

function isAllowedOrigin(origin: string): boolean {
  if (allowedOrigins.has(origin)) return true;
  return (
    process.env["NODE_ENV"] !== "production" &&
    /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin)
  );
}

function hasAllowedBrowserSource(req: Request): boolean {
  const origin = req.headers.origin;
  if (typeof origin === "string") return isAllowedOrigin(origin);

  const referer = req.headers.referer;
  if (typeof referer !== "string") return false;
  try {
    return isAllowedOrigin(new URL(referer).origin);
  } catch {
    return false;
  }
}

app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (!origin || isAllowedOrigin(origin)) {
    next();
    return;
  }

  logger.warn({ origin }, "Origem bloqueada");
  recordSecurityEvent(
    "forbidden",
    `${req.method} ${privacySafeRequestPath(req.originalUrl)} — origem não autorizada`,
  );
  res.status(403).json({ error: "Origem da requisição não autorizada." });
});

app.use(cors({
  origin(origin, callback) {
    // Permitir requisições sem origin (mobile, curl, Postman) e origens conhecidas
    if (!origin || isAllowedOrigin(origin)) return callback(null, true);
    callback(null, false);
  },
  credentials: true,
}));

// Cookie-authenticated state changes must originate from the DocRegen frontend.
// SameSite=Lax is the primary CSRF barrier; this origin check is defense-in-depth.
app.use(API_PREFIX, (req: Request, res: Response, next: NextFunction) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method) || !hasAnySessionCookie(req)) {
    next();
    return;
  }

  if (hasAllowedBrowserSource(req)) {
    next();
    return;
  }

  recordSecurityEvent(
    "forbidden",
    `${req.method} ${privacySafeRequestPath(req.originalUrl)} — origem/referer de sessão inválido`,
  );
  res.status(403).json({ error: "Origem da requisição não autorizada." });
});

// Body size: 1 MB by default. Only the temporary-PDF upload (JSON base64
// variant) needs more; the raw application/pdf variant is streamed with its
// own cap in routes/pdf.ts.
const PDF_JSON_BODY_LIMIT = "30mb";
app.use(`${API_PREFIX}/pdf/temp`, express.json({ limit: PDF_JSON_BODY_LIMIT }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// Malformed / oversized bodies are client errors (400/413), never 500 and
// never counted as server errors by the security monitor.
app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  const bodyError = err as { type?: string; status?: number } | null;
  if (bodyError?.type === "entity.parse.failed") {
    res.status(400).json({ error: "JSON inválido no corpo da requisição.", code: "INVALID_JSON" });
    return;
  }
  if (bodyError?.type === "entity.too.large") {
    res.status(413).json({ error: "Corpo da requisição excede o tamanho máximo permitido.", code: "PAYLOAD_TOO_LARGE" });
    return;
  }
  if (typeof bodyError?.status === "number" && bodyError.status >= 400 && bodyError.status < 500 && bodyError.type) {
    res.status(bodyError.status).json({ error: "Requisição inválida." });
    return;
  }
  next(err);
});

// 1) Global limiter — 300 req/min per IP (DDoS / scraping protection).
// Instance-local (memory) on purpose: a DB write per request would cost more
// than it protects; the security-relevant limiters below are DB-backed.
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: "draft-6",
  legacyHeaders: false,
  message: { error: "Muitas requisições. Tente novamente em instantes.", code: "RATE_LIMIT" },
  skip: rateLimitsDisabled,
});

// 2) Auth limiter — 10 failed attempts / 15 min per IP, shared by every
// credential endpoint (doctor/secretary login, password change, patient CPF
// verification on public links). DB-backed (autoscale-safe).
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-6",
  legacyHeaders: false,
  message: { error: "Muitas tentativas de autenticação. Tente novamente em 15 minutos.", code: "AUTH_RATE_LIMIT" },
  skipSuccessfulRequests: true,
  store: new PostgresRateLimitStore("auth"),
  passOnStoreError: true,
  skip: rateLimitsDisabled,
});

// 3) Password reset limiter — all attempts count because the endpoint always
// returns the same successful response to prevent account enumeration.
const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-6",
  legacyHeaders: false,
  message: { error: "Muitas tentativas. Tente novamente em 15 minutos.", code: "PASSWORD_RESET_RATE_LIMIT" },
  store: new PostgresRateLimitStore("pwreset"),
  passOnStoreError: true,
  skip: rateLimitsDisabled,
});

// 4) Register limiter — 3 registrations / hour per IP (spam / bot protection)
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  standardHeaders: "draft-6",
  legacyHeaders: false,
  message: { error: "Limite de registros atingido. Tente novamente em 1 hora.", code: "REGISTER_RATE_LIMIT" },
  store: new PostgresRateLimitStore("register"),
  passOnStoreError: true,
  skip: rateLimitsDisabled,
});

/** Credential-checking endpoints guarded by the per-IP auth limiter. */
export const AUTH_LIMITED_ROUTES = [
  `${API_PREFIX}/auth/login`,
  `${API_PREFIX}/auth/change-password`,
  `${API_PREFIX}/secretary-auth/login`,
  `${API_PREFIX}/patient/regen/:token/verify`,
  `${API_PREFIX}/pre-consult/:token/verify`,
] as const;

app.use(API_PREFIX, globalLimiter);
for (const route of AUTH_LIMITED_ROUTES) app.post(route, authLimiter);
app.post(`${API_PREFIX}/auth/forgot-password`, passwordResetLimiter);
app.post(`${API_PREFIX}/auth/reset-password-token`, passwordResetLimiter);
app.post(`${API_PREFIX}/auth/register`, registerLimiter);

app.use(API_PREFIX, auditLog);
app.use(API_PREFIX, router);

// Global error handler — must have 4 params so Express recognises it as error middleware
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  // Log com detalhe completo server-side; nunca expor stack trace ou mensagem interna ao cliente
  logger.error({ err }, "Unhandled error");
  recordSecurityEvent("server_error", err instanceof Error ? err.constructor.name : "UnknownError");
  res.status(500).json({ error: "Erro interno do servidor. Tente novamente em instantes." });
});

export default app;
