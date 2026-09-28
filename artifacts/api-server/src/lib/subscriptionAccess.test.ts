import { describe, expect, it, vi } from "vitest";
import { resolveSubscriptionAccess, type SubscriptionAccessDependencies } from "./subscriptionAccess";

const paidDoctor = {
  isAdmin: false,
  isFree: false,
  idioma: "pt-BR",
  stripeCustomerId: "cus_paid",
  temporaryAccessExpiresAt: null,
};

function dependencies(
  overrides: Partial<SubscriptionAccessDependencies> = {},
): SubscriptionAccessDependencies {
  return {
    findDoctor: vi.fn().mockResolvedValue(paidDoctor),
    findLatestSubscription: vi.fn().mockResolvedValue({
      status: "active",
      current_period_end: 2_000_000_000,
      cancel_at_period_end: false,
    }),
    ...overrides,
  };
}

describe("resolveSubscriptionAccess fail-closed behavior", () => {
  it("never grants write access when the doctor lookup database is unavailable", async () => {
    const result = await resolveSubscriptionAccess(42, dependencies({
      findDoctor: vi.fn().mockRejectedValue(new Error("database unavailable")),
    }));

    expect(result.httpStatus).toBe(503);
    expect(result.body).toMatchObject({
      canWrite: false,
      status: "unknown",
      code: "SUBSCRIPTION_STATUS_UNAVAILABLE",
    });
    expect(result.body.error).not.toContain("database unavailable");
  });

  it("never grants write access when the synchronized Stripe query fails", async () => {
    const result = await resolveSubscriptionAccess(42, dependencies({
      findLatestSubscription: vi.fn().mockRejectedValue(new Error("stripe schema missing")),
    }));

    expect(result.httpStatus).toBe(503);
    expect(result.body).toMatchObject({
      canWrite: false,
      status: "unknown",
      code: "SUBSCRIPTION_STATUS_UNAVAILABLE",
    });
    expect(result.body.error).not.toContain("stripe schema missing");
  });

  it("localizes and sanitizes a synchronized Stripe query failure", async () => {
    const result = await resolveSubscriptionAccess(42, dependencies({
      findDoctor: vi.fn().mockResolvedValue({ ...paidDoctor, idioma: "es" }),
      findLatestSubscription: vi.fn().mockRejectedValue(new Error("secret database detail")),
    }));

    expect(result.httpStatus).toBe(503);
    expect(result.body).toMatchObject({
      canWrite: false,
      error: "No se pudo verificar su suscripción. Inténtelo de nuevo.",
    });
    expect(result.body.error).not.toContain("secret database detail");
  });

  it("preserves normal active subscription access", async () => {
    const result = await resolveSubscriptionAccess(42, dependencies());

    expect(result.httpStatus).toBe(200);
    expect(result.body).toMatchObject({
      canWrite: true,
      isFree: false,
      status: "active",
    });
  });

  it("does not grant writes to a past_due subscription", async () => {
    const result = await resolveSubscriptionAccess(42, dependencies({
      findLatestSubscription: vi.fn().mockResolvedValue({
        status: "past_due",
        current_period_end: Math.floor(Date.now() / 1_000),
        cancel_at_period_end: false,
      }),
    }));

    expect("canWrite" in result.body && result.body.canWrite).toBe(false);
  });
});