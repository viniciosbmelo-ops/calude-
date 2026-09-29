import { describe, expect, it, vi } from "vitest";
import { APP_HEADER_NAME, installAppHeader, isSameOriginApiRequest, withAppHeader } from "./app-header";

const ORIGIN = "https://app.example";

function recorder() {
  const calls: Array<{ url: string; headers: Headers }> = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, headers: new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)) });
    return new Response("{}");
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

describe("DocRegen app header", () => {
  it("detects same-origin API requests only", () => {
    expect(isSameOriginApiRequest("/api/patients", ORIGIN)).toBe(true);
    expect(isSameOriginApiRequest(`${ORIGIN}/api/regen/cases`, ORIGIN)).toBe(true);
    expect(isSameOriginApiRequest("/docregen/logo.png", ORIGIN)).toBe(false);
    expect(isSameOriginApiRequest("/apix", ORIGIN)).toBe(false);
    expect(isSameOriginApiRequest("https://storage.googleapis.com/api/x", ORIGIN)).toBe(false);
  });

  it("tags API calls and keeps existing headers", async () => {
    const { impl, calls } = recorder();
    const wrapped = withAppHeader(impl, ORIGIN);
    await wrapped("/api/patients/1/pre-consult/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(calls[0]!.headers.get(APP_HEADER_NAME)).toBe("docregen");
    expect(calls[0]!.headers.get("Content-Type")).toBe("application/json");

    await wrapped(new Request(`${ORIGIN}/api/auth/me`, { headers: { Accept: "application/json" } }));
    expect(calls[1]!.headers.get(APP_HEADER_NAME)).toBe("docregen");
    expect(calls[1]!.headers.get("Accept")).toBe("application/json");
  });

  it("leaves cross-origin requests untouched", async () => {
    const { impl, calls } = recorder();
    await withAppHeader(impl, ORIGIN)("https://storage.googleapis.com/bucket/object", { method: "PUT" });
    expect(calls[0]!.headers.has(APP_HEADER_NAME)).toBe(false);
  });

  it("installs only once", async () => {
    const { impl, calls } = recorder();
    const target = { fetch: impl, location: { origin: ORIGIN } } as unknown as typeof globalThis & { location: Location };
    installAppHeader(target);
    const first = target.fetch;
    installAppHeader(target);
    expect(target.fetch).toBe(first);
    await target.fetch("/api/auth/me");
    expect(calls[0]!.headers.get(APP_HEADER_NAME)).toBe("docregen");
  });
});
