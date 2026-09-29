import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runMigrations: vi.fn(),
  getStripeSync: vi.fn(),
  findOrCreateManagedWebhook: vi.fn(),
  syncProducts: vi.fn(),
  syncPrices: vi.fn(),
  syncBackfill: vi.fn(),
}));

vi.mock("stripe-replit-sync", () => ({
  runMigrations: mocks.runMigrations,
}));

vi.mock("./stripeClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./stripeClient")>();
  return {
    ...actual,
    getStripeSync: mocks.getStripeSync,
  };
});

vi.mock("./logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  },
}));

import { initStripe, resolveManagedWebhookUrl } from "./initStripe";
import { assertStripeKeyMode } from "./stripeClient";

async function flushBackgroundSync(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("Stripe environment isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runMigrations.mockResolvedValue(undefined);
    mocks.findOrCreateManagedWebhook.mockResolvedValue({
      url: "https://dockneeapp.com/api/stripe/webhook",
    });
    mocks.syncProducts.mockResolvedValue(undefined);
    mocks.syncPrices.mockResolvedValue(undefined);
    mocks.syncBackfill.mockResolvedValue(undefined);
    mocks.getStripeSync.mockResolvedValue({
      findOrCreateManagedWebhook: mocks.findOrCreateManagedWebhook,
      syncProducts: mocks.syncProducts,
      syncPrices: mocks.syncPrices,
      syncBackfill: mocks.syncBackfill,
    });
    vi.stubEnv("DOCREGEN_DATABASE_URL", "postgres://unit-test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("never manages a webhook from development or preview", async () => {
    vi.stubEnv("REPLIT_DEPLOYMENT", "");
    vi.stubEnv("REPLIT_DOMAINS", "temporary-preview.replit.dev");
    vi.stubEnv("DOCREGEN_APP_URL", "https://dockneeapp.com");

    await initStripe();
    await flushBackgroundSync();

    expect(mocks.findOrCreateManagedWebhook).not.toHaveBeenCalled();
    expect(mocks.syncProducts).toHaveBeenCalledOnce();
  });

  it("uses the canonical production URL only in an official deployment", async () => {
    vi.stubEnv("REPLIT_DEPLOYMENT", "1");
    vi.stubEnv("DOCREGEN_APP_URL", "https://dockneeapp.com");

    await initStripe();
    await flushBackgroundSync();

    expect(mocks.findOrCreateManagedWebhook).toHaveBeenCalledOnce();
    expect(mocks.findOrCreateManagedWebhook).toHaveBeenCalledWith(
      "https://dockneeapp.com/api/stripe/webhook",
    );
  });

  it("rejects temporary deployment hosts before webhook management", async () => {
    vi.stubEnv("REPLIT_DEPLOYMENT", "1");
    vi.stubEnv("DOCREGEN_APP_URL", "https://temporary-preview.replit.dev");

    await initStripe();

    expect(mocks.findOrCreateManagedWebhook).not.toHaveBeenCalled();
  });

  it("rejects an explicit webhook on a noncanonical HTTPS host", () => {
    expect(() => resolveManagedWebhookUrl({
      REPLIT_DEPLOYMENT: "1",
      DOCREGEN_APP_URL: "https://dockneeapp.com",
      DOCREGEN_STRIPE_WEBHOOK_URL: "https://unrelated.example/api/stripe/webhook",
    })).toThrow("must match the canonical DOCREGEN_APP_URL");
  });

  it("does not resolve any managed webhook outside official deployment", () => {
    expect(resolveManagedWebhookUrl({
      REPLIT_DEPLOYMENT: "",
      DOCREGEN_STRIPE_WEBHOOK_URL: "https://dockneeapp.com/api/stripe/webhook",
    })).toBeNull();
  });

  it("enforces Stripe key mode without exposing key material", () => {
    expect(() => assertStripeKeyMode("sk_live_example", "live")).not.toThrow();
    expect(() => assertStripeKeyMode("rk_test_example", "test")).not.toThrow();
    expect(() => assertStripeKeyMode("sk_test_example", "live"))
      .toThrow("expected live key");
    expect(() => assertStripeKeyMode("not-a-key", "test"))
      .toThrow("expected test key");
  });
});