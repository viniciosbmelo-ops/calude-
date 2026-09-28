/**
 * DOCKNEE — API Server (Express 5 + TypeScript)
 *
 * Plataforma de documentação cirúrgica do joelho — LGPD-compliant
 *
 * Conformidade:
 *   - LGPD (Lei nº 13.709/2018): Arts. 7, 9, 11, 16, 17–22, 37, 41, 46, 48
 *   - Resolução CFM nº 1.821/2007: prontuário eletrônico, sigilo profissional
 *   - OWASP Top 10: implementado (BOLA, injection, broken auth, etc.)
 *
 * Medidas de Segurança:
 *   ✅ Autenticação   — JWT assinado com SESSION_SECRET + bcryptjs
 *   ✅ Autorização    — BOLA enforced em todos os 23 endpoints /api/:id
 *   ✅ Headers HTTP   — Helmet.js (HSTS 1 ano, X-Frame, nosniff, Referrer-Policy)
 *   ✅ Rate Limiting  — 4 camadas: global 300/min, auth 10/15min, registro 3/h, IA 20/dia
 *   ✅ Auditoria      — Middleware auditLog: SHA-256 + redação de sensíveis (5 anos)
 *   ✅ Direitos LGPD  — 7 endpoints /api/lgpd/* (consentimento, acesso, portabilidade, exclusão, anonimização)
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
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { auditLog } from "./middlewares/auditLog";
import { processStripeWebhook } from "./lib/webhookHandlers";
import { recordSecurityEvent } from "./lib/securityMonitor";
import { hasAnySessionCookie } from "./lib/session";

export function privacySafeRequestPath(value: string | undefined): string | undefined {
  if (!value) return value;
  return value
    .split("?")[0]
    .replace(
      /^(\/api)?\/pre-consult\/[^/]+/,
      (_match, apiPrefix: string | undefined) => `${apiPrefix ?? ""}/pre-consult/:token`,
    )
    .replace(
      /^(\/api)?\/patient-orientations\/[^/]+/,
      (_match, apiPrefix: string | undefined) => `${apiPrefix ?? ""}/patient-orientations/:token`,
    );
}

const app: Express = express();

// Replit routes requests through a reverse proxy — trust the first hop so
// express-rate-limit can read the real client IP from X-Forwarded-For.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: privacySafeRequestPath(req.url),
        };
      },
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
      // external frames blocked while allowing DocKnee's own /api/pdf/temp URL.
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
  "/api/stripe/webhook",
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

// CORS — permite apenas origens conhecidas (domínio de produção + previews Replit)
const allowedOrigins = new Set<string>([
  "https://dockneeapp.com",
  "https://www.dockneeapp.com",
  "https://fisio.dockneeapp.com",
]);
// Adiciona domínios de preview da Replit dinamicamente
for (const d of (process.env["REPLIT_DOMAINS"] ?? "").split(",")) {
  const h = d.trim();
  if (h) allowedOrigins.add(`https://${h}`);
}

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

// Cookie-authenticated state changes must originate from the DocKnee frontend.
// SameSite=Lax is the primary CSRF barrier; this origin check is defense-in-depth.
app.use("/api", (req: Request, res: Response, next: NextFunction) => {
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

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// 1) Global limiter — 300 req/min per IP (DDoS / scraping protection)
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: "draft-6",
  legacyHeaders: false,
  message: { error: "Muitas requisições. Tente novamente em instantes.", code: "RATE_LIMIT" },
  skip: () => process.env["NODE_ENV"] === "test",
});

// 2) Auth limiter — 10 failed attempts / 15 min per IP (brute-force protection)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-6",
  legacyHeaders: false,
  message: { error: "Muitas tentativas de autenticação. Tente novamente em 15 minutos.", code: "AUTH_RATE_LIMIT" },
  skipSuccessfulRequests: true,
  skip: () => process.env["NODE_ENV"] === "test",
});

// 3) Password reset limiter — all attempts count because the endpoint always
// returns the same successful response to prevent account enumeration.
const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-6",
  legacyHeaders: false,
  message: { error: "Muitas tentativas. Tente novamente em 15 minutos.", code: "PASSWORD_RESET_RATE_LIMIT" },
  skip: () => process.env["NODE_ENV"] === "test",
});

// 4) Register limiter — 3 registrations / hour per IP (spam / bot protection)
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  standardHeaders: "draft-6",
  legacyHeaders: false,
  message: { error: "Limite de registros atingido. Tente novamente em 1 hora.", code: "REGISTER_RATE_LIMIT" },
  skip: () => process.env["NODE_ENV"] === "test",
});

// 5) AI analysis limiter — 20 analyses / day per authenticated user (protect AI costs)
const aiAnalysisLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-6",
  legacyHeaders: false,
  message: { error: "Limite diário de análises de imagem atingido. Tente novamente amanhã.", code: "AI_RATE_LIMIT" },
  keyGenerator: (req: Request) => req.doctorId ? String(req.doctorId) : ipKeyGenerator(req.ip ?? ""),
  skip: () => process.env["NODE_ENV"] === "test",
});

app.use("/api", globalLimiter);
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/forgot-password", passwordResetLimiter);
app.use("/api/auth/reset-password-token", passwordResetLimiter);
app.use("/api/auth/register", registerLimiter);
app.use("/api/xray/analyze", aiAnalysisLimiter);

app.use("/api", auditLog);
app.use("/api", router);

// Global error handler — must have 4 params so Express recognises it as error middleware
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  // Log com detalhe completo server-side; nunca expor stack trace ou mensagem interna ao cliente
  logger.error({ err }, "Unhandled error");
  recordSecurityEvent("server_error", err instanceof Error ? err.constructor.name : "UnknownError");
  res.status(500).json({ error: "Erro interno do servidor. Tente novamente em instantes." });
});

export default app;
