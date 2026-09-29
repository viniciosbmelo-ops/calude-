import { describe, expect, it } from "vitest";
import { publicPageMessages } from "@/locales/public-pages";

describe("public, authentication, and marketing localization", () => {
  it("keeps the PT-BR and Spanish public-page catalogs in exact key parity", () => {
    expect(Object.keys(publicPageMessages.es).sort()).toEqual(
      Object.keys(publicPageMessages["pt-BR"]).sort(),
    );
  });

  it("provides Spanish copy for forms, validation, pricing, and status pages", () => {
    expect(publicPageMessages.es.loginTitle).toBe("Acceda a su cuenta");
    expect(publicPageMessages.es.passwordsMismatch).toBe("Las contraseñas no coinciden.");
    expect(publicPageMessages.es.choosePlan).toBe("Elija su plan");
    expect(publicPageMessages.es.subscriptionConfirmed).toBe("¡Suscripción confirmada!");
    expect(publicPageMessages.es.paymentCancelled).toBe("Pago no completado");
    expect(publicPageMessages.es.notFoundTitle).toBe("404 — Página no encontrada");
  });
});
