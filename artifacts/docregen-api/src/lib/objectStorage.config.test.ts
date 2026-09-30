import { afterEach, describe, expect, it, vi } from "vitest";

const ENV_KEYS = ["NODE_ENV", "OBJECT_STORAGE_API_ENDPOINT", "OBJECT_STORAGE_SIDECAR_ENDPOINT", "DOCREGEN_PRIVATE_OBJECT_DIR"] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

async function loadWith(env: Record<string, string>) {
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  vi.resetModules();
  return import("./objectStorage");
}

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.resetModules();
});

describe("object storage endpoint overrides", () => {
  it("are ignored in production: only storage.googleapis.com URLs are normalised", async () => {
    const { ObjectStorageService } = await loadWith({
      NODE_ENV: "production",
      OBJECT_STORAGE_API_ENDPOINT: "http://127.0.0.1:9999",
      DOCREGEN_PRIVATE_OBJECT_DIR: "/bucket/private",
    });
    const service = new ObjectStorageService();
    expect(service.normalizeObjectEntityPath("https://storage.googleapis.com/bucket/private/uploads/abc?sig=1"))
      .toBe("/objects/uploads/abc");
    expect(service.normalizeObjectEntityPath("http://127.0.0.1:9999/bucket/private/uploads/abc"))
      .toBe("http://127.0.0.1:9999/bucket/private/uploads/abc");
  });

  it("outside production, URLs from the configured test endpoint are normalised", async () => {
    const { ObjectStorageService } = await loadWith({
      NODE_ENV: "test",
      OBJECT_STORAGE_API_ENDPOINT: "http://127.0.0.1:9999/",
      DOCREGEN_PRIVATE_OBJECT_DIR: "/bucket/private",
    });
    const service = new ObjectStorageService();
    expect(service.normalizeObjectEntityPath("http://127.0.0.1:9999/bucket/private/uploads/abc?sig=1"))
      .toBe("/objects/uploads/abc");
  });
});
