import { describe, expect, it } from "vitest";
import { homeSpanish } from "@/locales/home";
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

  it("has explicit Spanish marketing and pricing labels", () => {
    expect(homeSpanish["Documentação"]).toBe("Documentación");
    expect(homeSpanish["Planos e preços"]).toBe("Planes y precios");
    expect(homeSpanish["Mensal"]).toBe("Mensual");
    expect(homeSpanish["Cancelamento a qualquer momento · Sem multa · Sem fidelidade"])
      .toContain("Sin permanencia");
  });
});