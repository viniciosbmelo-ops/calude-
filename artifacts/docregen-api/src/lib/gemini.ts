import { GoogleGenAI } from "@google/genai";

/**
 * Optional Gemini client for DocRegen's AI features.
 *
 * Gemini is an optional integration: the API must start (and every non-AI
 * route must work) without `AI_INTEGRATIONS_GEMINI_BASE_URL` /
 * `AI_INTEGRATIONS_GEMINI_API_KEY`. The client is therefore created lazily on
 * first use, and AI routes answer 503 when it is not configured instead of the
 * whole process refusing to boot.
 */
export const GEMINI_ENV_KEYS = [
  "AI_INTEGRATIONS_GEMINI_BASE_URL",
  "AI_INTEGRATIONS_GEMINI_API_KEY",
] as const;

export function isGeminiConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return GEMINI_ENV_KEYS.every((key) => Boolean(env[key]?.trim()));
}

let cached: { baseUrl: string; apiKey: string; client: GoogleGenAI } | null = null;

/** Returns the Gemini client, or null when the integration is not configured. */
export function getGeminiClient(env: NodeJS.ProcessEnv = process.env): GoogleGenAI | null {
  if (!isGeminiConfigured(env)) return null;
  const baseUrl = env["AI_INTEGRATIONS_GEMINI_BASE_URL"]!.trim();
  const apiKey = env["AI_INTEGRATIONS_GEMINI_API_KEY"]!.trim();
  if (!cached || cached.baseUrl !== baseUrl || cached.apiKey !== apiKey) {
    cached = {
      baseUrl,
      apiKey,
      client: new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "", baseUrl } }),
    };
  }
  return cached.client;
}
