import type { SupportedLocale } from "./locale";
import { regenPeriodForLocale, regenScaleForLocale } from "./regen-labels";

export interface WhatsAppMessage {
  to: string;
  text: string;
}

export interface WhatsAppResult {
  ok: boolean;
  messageId?: string;
  error?: string;
  provider?: "evolution" | "meta";
  deliveryUncertain?: boolean;
}

const PROVIDER_TIMEOUT_MS = 15_000;
const SAFE_ERROR_MAX_LENGTH = 240;

function isExplicitPreAcceptanceRejection(status: number): boolean {
  // A provider response is safe for fallback only when it rejected the
  // request before dispatch. Timeouts, rate limits, conflicts, and server
  // errors can all race with provider acceptance and must remain ambiguous.
  return status >= 400 && status < 500 && ![408, 409, 425, 429].includes(status);
}

export function sanitizeWhatsAppError(error: unknown): string {
  const value = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const normalized = value
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b(api[_-]?key|token|authorization)\b\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[phone]")
    .replace(/[\r\n\t]+/g, " ")
    .trim();
  return (normalized || "Falha temporária no envio pelo WhatsApp.").slice(0, SAFE_ERROR_MAX_LENGTH);
}

async function fetchProvider(
  provider: "evolution" | "meta",
  url: string,
  init: RequestInit,
): Promise<{ response?: Response; data?: any; error?: WhatsAppResult }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    try {
      return { response, data: await response.json() };
    } catch {
      return {
        response,
        error: {
          ok: false,
          error: `${provider === "evolution" ? "Evolution" : "Meta"} retornou uma resposta inválida.`,
          provider,
          deliveryUncertain: !isExplicitPreAcceptanceRejection(response.status),
        },
      };
    }
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return {
      error: {
        ok: false,
        error: timedOut
          ? `${provider === "evolution" ? "Evolution" : "Meta"} excedeu o tempo limite.`
          : `${provider === "evolution" ? "Evolution" : "Meta"} indisponível no momento.`,
        provider,
        deliveryUncertain: true,
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function normalizeWhatsAppPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("55")) return digits;
  if (digits.length === 11 || digits.length === 10) return `55${digits}`;
  return digits;
}

// ── Evolution API ─────────────────────────────────────────────────────────────
async function sendViaEvolution(phone: string, text: string, idempotencyKey?: string): Promise<WhatsAppResult> {
  const baseUrl  = process.env["EVOLUTION_API_URL"]?.replace(/\/$/, "");
  const apiKey   = process.env["EVOLUTION_API_KEY"];
  const instance = process.env["EVOLUTION_INSTANCE"] ?? "docknee-clinica-1";

  if (!baseUrl || !apiKey) {
    return { ok: false, error: "Evolution API não configurada (EVOLUTION_API_URL ou EVOLUTION_API_KEY ausente)." };
  }

  const number = normalizeWhatsAppPhone(phone);

  const providerResponse = await fetchProvider("evolution", `${baseUrl}/message/sendText/${instance}`, {
    method: "POST",
    headers: {
      "apikey": apiKey,
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify({ number, text }),
  });
  if (providerResponse.error || !providerResponse.response) {
    return providerResponse.error ?? { ok: false, error: "Evolution indisponível no momento.", provider: "evolution" };
  }
  const { response, data } = providerResponse;

  if (response.ok && (data?.key?.id || data?.messageId || data?.status === "PENDING" || data?.status === "SENT")) {
    return { ok: true, messageId: data?.key?.id ?? data?.messageId, provider: "evolution" };
  }
  if (response.ok) {
    return {
      ok: false,
      error: "Evolution aceitou a requisição sem confirmar o estado da mensagem.",
      provider: "evolution",
      deliveryUncertain: true,
    };
  }

  return {
    ok: false,
    error: `Evolution rejeitou o envio (HTTP ${response.status}).`,
    provider: "evolution",
    deliveryUncertain: !isExplicitPreAcceptanceRejection(response.status),
  };
}

// ── Meta (Facebook Graph API) ─────────────────────────────────────────────────
async function sendViaMeta(phone: string, text: string, idempotencyKey?: string): Promise<WhatsAppResult> {
  const phoneNumberId = process.env["WHATSAPP_PHONE_NUMBER_ID"];
  const accessToken   = process.env["WHATSAPP_ACCESS_TOKEN"];

  if (!phoneNumberId || !accessToken) {
    return { ok: false, error: "Meta API não configurada (WHATSAPP_PHONE_NUMBER_ID ou WHATSAPP_ACCESS_TOKEN ausente)." };
  }

  const to = normalizeWhatsAppPhone(phone);

  const body = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { preview_url: true, body: text },
  };

  const providerResponse = await fetchProvider(
    "meta",
    `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
    }
  );
  if (providerResponse.error || !providerResponse.response) {
    return providerResponse.error ?? { ok: false, error: "Meta indisponível no momento.", provider: "meta" };
  }
  const { response, data } = providerResponse;

  if (response.ok && data?.messages?.[0]?.id) {
    return { ok: true, messageId: data.messages[0].id, provider: "meta" };
  }
  if (response.ok) {
    return {
      ok: false,
      error: "Meta aceitou a requisição sem confirmar o estado da mensagem.",
      provider: "meta",
      deliveryUncertain: true,
    };
  }

  return {
    ok: false,
    error: `Meta rejeitou o envio (HTTP ${response.status}).`,
    provider: "meta",
    deliveryUncertain: !isExplicitPreAcceptanceRejection(response.status),
  };
}

// ── API pública — tenta Evolution primeiro, Meta como fallback ────────────────
export async function sendWhatsAppText(
  phone: string,
  text: string,
  options: { idempotencyKey?: string } = {},
): Promise<WhatsAppResult> {
  const evolutionConfigured = !!(process.env["EVOLUTION_API_URL"] && process.env["EVOLUTION_API_KEY"]);

  if (evolutionConfigured) {
    const result = await sendViaEvolution(phone, text, options.idempotencyKey);
    if (result.ok) return result;
    if (result.deliveryUncertain) return result;

    // Fallback is safe only after an explicit provider rejection. Transport
    // errors are ambiguous and must never fan out the same clinical message.
    const metaResult = await sendViaMeta(phone, text, options.idempotencyKey);
    if (metaResult.ok) return metaResult;
    if (metaResult.deliveryUncertain) return metaResult;

    // Both providers explicitly rejected the send; preserve the primary error.
    return result;
  }

  // Evolution não configurada → usar Meta diretamente
  return sendViaMeta(phone, text, options.idempotencyKey);
}

export function buildFollowupMessage(params: {
  patientName: string;
  periodo: string | null | undefined;
  scales: string[];
  link: string;
  doctorName?: string;
  locale?: SupportedLocale;
}): string {
  const { patientName, periodo, scales, link, doctorName, locale = "pt-BR" } = params;
  const spanish = locale === "es";
  const effectivePeriod = typeof periodo === "string" && periodo.trim()
    ? periodo
    : "pós-operatório";
  const presentedPeriod = regenPeriodForLocale(effectivePeriod, locale);
  const scaleList = scales.length > 0
    ? scales.map(scale => regenScaleForLocale(scale, locale)).join(", ")
    : spanish ? "evaluaciones clínicas" : "avaliações clínicas";
  const doctor = doctorName
    ? spanish ? `Dr(a). ${doctorName}` : `Dr(a). ${doctorName}`
    : spanish ? "su médico" : "seu médico";

  const isPre = /pr[eé]-?op/i.test(effectivePeriod) || effectivePeriod.toLowerCase().includes("pré");

  const contexto = isPre
    ? spanish
      ? "para su *cirugía de rodilla* (evaluación preoperatoria)"
      : "para a sua *cirurgia do joelho* (avaliação pré-operatória)"
    : spanish
      ? `de *${presentedPeriod}* después de su cirugía de rodilla`
      : `de *${presentedPeriod}* após a sua cirurgia do joelho`;

  if (spanish) {
    return (
      `¡Hola, *${patientName}*! 👋\n\n` +
      `${doctor} solicita que complete las evaluaciones ${contexto}.\n\n` +
      `📋 *Escalas para completar:* ${scaleList}\n\n` +
      `Acceda mediante el siguiente enlace — tarda menos de 5 minutos:\n${link}\n\n` +
      `🔐 *Contraseña de acceso:* su CPF (solo números)\n\n` +
      `_¿Tiene dudas? Comuníquese con el consultorio._`
    );
  }
  return (
    `Olá, *${patientName}*! 👋\n\n` +
    `${doctor} solicita o preenchimento das avaliações ${contexto}.\n\n` +
    `📋 *Escalas a preencher:* ${scaleList}\n\n` +
    `Acesse pelo link abaixo — leva menos de 5 minutos:\n${link}\n\n` +
    `🔐 *Senha de acesso:* seu CPF (somente números)\n\n` +
    `_Dúvidas? Entre em contato com o consultório._`
  );
}
