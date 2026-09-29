import { describe, expect, it } from "vitest";
import { getGeminiClient, isGeminiConfigured } from "./gemini";

describe("optional Gemini client", () => {
  it("is not configured (and returns no client) without both variables", () => {
    expect(isGeminiConfigured({})).toBe(false);
    expect(isGeminiConfigured({ AI_INTEGRATIONS_GEMINI_BASE_URL: "http://x" })).toBe(false);
    expect(getGeminiClient({ AI_INTEGRATIONS_GEMINI_API_KEY: "k", AI_INTEGRATIONS_GEMINI_BASE_URL: "  " })).toBeNull();
  });

  it("creates a client lazily when configured", () => {
    const env = { AI_INTEGRATIONS_GEMINI_BASE_URL: "http://127.0.0.1:9", AI_INTEGRATIONS_GEMINI_API_KEY: "k" };
    expect(isGeminiConfigured(env)).toBe(true);
    const client = getGeminiClient(env);
    expect(client).not.toBeNull();
    expect(getGeminiClient(env)).toBe(client);
  });
});
