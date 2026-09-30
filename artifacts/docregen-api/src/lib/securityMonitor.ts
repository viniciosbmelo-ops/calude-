/**
 * Security Monitor — rastreia eventos suspeitos e envia alertas por email.
 *
 * Eventos monitorados:
 *  - Falhas de autenticação (brute-force)
 *  - Tentativas de acesso não autorizado (403)
 *  - Erros internos consecutivos (500)
 *
 * Alertas enviados via Gmail (DOCREGEN_GMAIL_USER / DOCREGEN_GMAIL_APP_PASSWORD) para DOCREGEN_CONTACT_EMAIL.
 * Em produção substitua por Sentry / Logtail conforme a escala crescer.
 */

import nodemailer from "nodemailer";
import { logger } from "./logger";
import { escapeHtml, identifierFingerprint } from "./redaction";

const EMAIL_RE = /[^\s@<>"'=]+@[^\s@<>"'=]+\.[^\s@<>"'=]+/g;
const CPF_RE = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;

/**
 * Defense in depth: any e-mail or CPF that reaches a security event is
 * replaced by a short SHA-256 fingerprint before it is logged or e-mailed.
 */
export function scrubSecurityDetails(details: string): string {
  return details
    .replace(EMAIL_RE, (match) => `email#${identifierFingerprint(match)}`)
    .replace(CPF_RE, (match) => `cpf#${identifierFingerprint(match.replace(/\D/g, ""))}`)
    .slice(0, 500);
}

export function buildSecurityAlertHtml(eventType: string, count: number, details: string, at = new Date()): string {
  return `
    <div style="font-family:Arial,sans-serif;max-width:520px;padding:24px;background:#fff3cd;border:1px solid #ffc107;border-radius:8px;">
      <h2 style="color:#856404;margin:0 0 12px;">⚠️ Alerta de Segurança — DocRegen</h2>
      <p><strong>Evento:</strong> ${escapeHtml(eventType)}</p>
      <p><strong>Ocorrências:</strong> ${count} nos últimos 5 minutos</p>
      <p><strong>Detalhes:</strong> ${escapeHtml(details)}</p>
      <p style="color:#6c757d;font-size:12px;margin-top:16px;">
        Horário: ${at.toISOString()}<br/>
        Se isso é legítimo, ignore. Caso contrário, acesse o painel e revise os logs.
      </p>
    </div>
  `.trim();
}

interface EventBucket {
  count: number;
  firstAt: number;
  lastAlertAt: number;
}

// Em-memory buckets — suficiente para alertas; não persiste entre restarts (ok para MVP)
const buckets = new Map<string, EventBucket>();

const WINDOW_MS   = 5 * 60 * 1000; // janela de 5 min
const ALERT_COOLDOWN_MS = 30 * 60 * 1000; // não repetir alerta por 30 min

const THRESHOLDS: Record<string, number> = {
  auth_failure:     10,  // 10 falhas de login em 5 min
  forbidden:        20,  // 20 respostas 403 em 5 min
  server_error:     15,  // 15 erros 500 em 5 min
};

function getBucket(key: string): EventBucket {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.firstAt > WINDOW_MS) {
    b = { count: 0, firstAt: now, lastAlertAt: 0 };
    buckets.set(key, b);
  }
  return b;
}

function createTransporter() {
  const user = process.env["DOCREGEN_GMAIL_USER"];
  const pass = process.env["DOCREGEN_GMAIL_APP_PASSWORD"];
  if (!user || !pass) return null;
  return nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
}

async function sendAlert(eventType: string, count: number, details: string): Promise<void> {
  const to = process.env["DOCREGEN_CONTACT_EMAIL"] ?? process.env["DOCREGEN_GMAIL_USER"];
  if (!to) return;

  const transporter = createTransporter();
  if (!transporter) return;

  const subject = `[DocRegen] Alerta de segurança: ${eventType}`;
  const html = buildSecurityAlertHtml(eventType, count, details);

  try {
    await transporter.sendMail({
      from: `"DocRegen Security" <${process.env["DOCREGEN_GMAIL_USER"]}>`,
      to,
      subject,
      html,
    });
    logger.warn({ eventType, count }, "Security alert email sent");
  } catch (err) {
    logger.error({ err }, "Failed to send security alert email");
  }
}

/**
 * Registra um evento de segurança. Se o threshold for atingido e o cooldown
 * tiver passado, envia um email de alerta.
 */
export function recordSecurityEvent(
  eventType: keyof typeof THRESHOLDS,
  details: string = "",
): void {
  const threshold = THRESHOLDS[eventType];
  if (threshold === undefined) return;
  details = scrubSecurityDetails(details);

  const bucket = getBucket(eventType);
  bucket.count += 1;

  logger.info({ eventType, count: bucket.count, details }, "Security event recorded");

  const now = Date.now();
  if (bucket.count >= threshold && now - bucket.lastAlertAt > ALERT_COOLDOWN_MS) {
    bucket.lastAlertAt = now;
    // fire-and-forget — não bloqueia a request
    void sendAlert(eventType, bucket.count, details);
  }
}
