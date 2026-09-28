import { describe, expect, it } from "vitest";
import { capitalizeFirst } from "./utils";

describe("capitalizeFirst", () => {
  it("uppercases only the first letter of long pt-BR and es dates", () => {
    const date = new Date(2026, 8, 28, 12);
    const opts: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" };
    expect(capitalizeFirst(new Intl.DateTimeFormat("pt-BR", opts).format(date), "pt-BR")).toBe("Segunda-feira, 28 de setembro");
    expect(capitalizeFirst(new Intl.DateTimeFormat("es", opts).format(date), "es")).toBe("Lunes, 28 de septiembre");
  });

  it("handles empty and accented input", () => {
    expect(capitalizeFirst("")).toBe("");
    expect(capitalizeFirst("éxito total")).toBe("Éxito total");
  });
});
