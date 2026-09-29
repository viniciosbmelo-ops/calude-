import { logger } from "./logger";

/**
 * Valida variáveis de ambiente obrigatórias do DocRegen no startup.
 *
 * O DocRegen é independente do DocKnee: banco, segredo de sessão e demais
 * credenciais usam variáveis com prefixo DOCREGEN_. Não há fallback para as
 * variáveis do DocKnee (DATABASE_URL, SESSION_SECRET, PRIVATE_OBJECT_DIR...), e
 * valores idênticos aos do DocKnee são recusados.
 */

const CRITICAL: { key: string; descricao: string }[] = [
  {
    key: "DOCREGEN_DATABASE_URL",
    descricao: "URL de conexão com o banco PostgreSQL próprio do DocRegen",
  },
  {
    key: "DOCREGEN_SESSION_SECRET",
    descricao: "Chave de assinatura JWT do DocRegen (mín. 32 caracteres)",
  },
];

/** DocRegen variables that must never equal DocKnee's counterpart. */
const MUST_DIFFER_FROM_DOCKNEE: ReadonlyArray<readonly [docregen: string, docknee: string]> = [
  ["DOCREGEN_DATABASE_URL", "DATABASE_URL"],
  ["DOCREGEN_SESSION_SECRET", "SESSION_SECRET"],
  ["DOCREGEN_PRIVATE_OBJECT_DIR", "PRIVATE_OBJECT_DIR"],
];

const OPTIONAL: { key: string; descricao: string; feature: string }[] = [
  {
    key: "DOCREGEN_WHATSAPP_ACCESS_TOKEN",
    descricao: "Token de acesso da API do WhatsApp Business (DocRegen)",
    feature: "Envio de mensagens via WhatsApp",
  },
  {
    key: "DOCREGEN_WHATSAPP_PHONE_NUMBER_ID",
    descricao: "Phone Number ID do WhatsApp Business (DocRegen)",
    feature: "Envio de mensagens via WhatsApp",
  },
  {
    key: "AI_INTEGRATIONS_GEMINI_BASE_URL",
    descricao: "Integração Gemini (URL base)",
    feature: "Resumo clínico por IA",
  },
  {
    key: "AI_INTEGRATIONS_GEMINI_API_KEY",
    descricao: "Integração Gemini (chave)",
    feature: "Resumo clínico por IA",
  },
];

/** Pure check (testable): returns the list of fatal configuration problems. */
export function findSecretProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  const problems: string[] = [];
  for (const { key, descricao } of CRITICAL) {
    if (!env[key]?.trim()) problems.push(`${key} — ${descricao}`);
  }
  const sessionSecret = env["DOCREGEN_SESSION_SECRET"];
  if (sessionSecret && sessionSecret.length < 32) {
    problems.push("DOCREGEN_SESSION_SECRET — deve ter ao menos 32 caracteres");
  }
  for (const [own, docknee] of MUST_DIFFER_FROM_DOCKNEE) {
    const ownValue = env[own]?.trim();
    const dockneeValue = env[docknee]?.trim();
    if (ownValue && dockneeValue && ownValue === dockneeValue) {
      problems.push(`${own} — não pode ser igual a ${docknee} (DocKnee); o DocRegen é independente`);
    }
  }
  return problems;
}

export function validateSecrets(): void {
  const problems = findSecretProblems();
  if (problems.length > 0) {
    logger.error(
      { secretProblems: problems },
      "FATAL: configuração do DocRegen inválida. Configure em: Replit → Secrets",
    );
    problems.forEach((m) => logger.error(`  ❌ ${m}`));
    process.exit(1);
  }

  for (const { key, descricao, feature } of OPTIONAL) {
    if (!process.env[key]) {
      logger.warn(
        { secret: key },
        `Secret opcional ausente — feature desabilitada: "${feature}" (${descricao})`,
      );
    }
  }

  logger.info("✅ Secrets validados: DOCREGEN_DATABASE_URL, DOCREGEN_SESSION_SECRET");
}
