import { describe, expect, it } from "vitest";
import { formatCentralFollowupValues } from "./followup-central";

describe("follow-up central presentation values", () => {
  it("localizes controlled Spanish values without changing unknown values", () => {
    expect(formatCentralFollowupValues("es", "1 mês", ["VAS Dor", "IKDC", "Texto livre"])).toEqual({
      periodo: "1 mes",
      scales: ["VAS Dolor", "IKDC", "Texto livre"],
    });
  });

  it("keeps canonical values in Portuguese", () => {
    expect(formatCentralFollowupValues("pt-BR", "1 mês", ["VAS Dor"])).toEqual({
      periodo: "1 mês",
      scales: ["VAS Dor"],
    });
  });
});