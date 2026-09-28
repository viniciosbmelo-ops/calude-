import { logger } from "./logger";

/**
 * Valida variáveis de ambiente obrigatórias no startup.
 * Encerra o processo imediatamente se alguma crítica estiver ausente.
 */

const CRITICAL: { key: string; descricao: string }[] = [
  {
    key: "DATABASE_URL",
    descricao: "URL de conexão com o banco PostgreSQL",
  },
  {
    key: "SESSION_SECRET",
    descricao: "Chave de assinatura JWT (mín. 32 caracteres)",
  },
];

const OPTIONAL: { key: string; descricao: string; feature: string }[] = [
  {
    key: "WHATSAPP_ACCESS_TOKEN",
    descricao: "Token de acesso da API do WhatsApp Business",
    feature: "Disparo de follow-up via WhatsApp",
  },
  {
    key: "WHATSAPP_PHONE_NUMBER_ID",
    descricao: "Phone Number ID do WhatsApp Business",
    feature: "Disparo de follow-up via WhatsApp",
  },
];

export function validateSecrets(): void {
  const missing: string[] = [];

  for (const { key, descricao } of CRITICAL) {
    if (!process.env[key]) {
      missing.push(`${key} — ${descricao}`);
    }
  }

  if (missing.length > 0) {
    logger.error(
      { missingSecrets: missing },
      "FATAL: Secrets obrigatórios não configurados. Configure em: Replit → Secrets (ícone de cadeado)"
    );
    missing.forEach((m) => logger.error(`  ❌ ${m}`));
    process.exit(1);
  }

  const sessionSecret = process.env["SESSION_SECRET"]!;
  if (sessionSecret.length < 32) {
    logger.error(
      { comprimento: sessionSecret.length },
      "FATAL: SESSION_SECRET deve ter ao menos 32 caracteres para segurança adequada dos JWTs"
    );
    process.exit(1);
  }

  for (const { key, descricao, feature } of OPTIONAL) {
    if (!process.env[key]) {
      logger.warn(
        { secret: key },
        `Secret opcional ausente — feature desabilitada: "${feature}" (${descricao})`
      );
    }
  }

  logger.info("✅ Secrets validados: DATABASE_URL, SESSION_SECRET");
}
