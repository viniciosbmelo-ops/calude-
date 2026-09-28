import { describe, expect, it } from "vitest";
import { publicRegenFallbackLocale, publicRegenServerError } from "./regen-public-flow";

describe("public regenerative flow response handling", () => {
  it("uses the safe Spanish error supplied for a known link without scales", () => {
    expect(publicRegenServerError(
      { error: "Este enlace no es válido o venció." },
      "Enlace inválido o vencido.",
    )).toBe("Este enlace no es válido o venció.");
  });

  it("uses the safe Spanish error supplied for a known invalid verification", () => {
    expect(publicRegenServerError(
      { error: "La fecha de nacimiento es incorrecta. Verifique los datos." },
      "La fecha de nacimiento es incorrecta. Verifique los datos.",
    )).toBe("La fecha de nacimiento es incorrecta. Verifique los datos.");
  });

  it("rejects malformed response errors and uses the resolved locale fallback", () => {
    expect(publicRegenServerError({ error: { internal: "detail" } }, "Enlace inválido o vencido."))
      .toBe("Enlace inválido o vencido.");
    expect(publicRegenFallbackLocale("es")).toBe("es");
    expect(publicRegenFallbackLocale("unknown")).toBe("pt-BR");
  });
});