import { describe, expect, it } from "vitest";
import { runOcdAlgorithm } from "../ocd-algorithm";

const osteochondralCase = {
  symptomatic: true,
  conservativeFailure: true,
  diffuseOA: false,
  lesionPattern: "osteochondral" as const,
  boneStatus: "compromised" as const,
  sizeCm2: 5,
};

describe("runOcdAlgorithm OCA availability gate", () => {
  it("recommends OCA only after tissue-bank availability is explicitly confirmed", () => {
    const result = runOcdAlgorithm({
      ...osteochondralCase,
      bancoTecidosDisponivel: true,
    });

    expect(result.recommendations.some((recommendation) =>
      recommendation.procedure.includes("OCA — aloenxerto osteocondral fresco"),
    )).toBe(true);
  });

  it("omits OCA and identifies missing confirmation when availability is undefined", () => {
    const result = runOcdAlgorithm(osteochondralCase);

    expect(result.recommendations.some((recommendation) =>
      recommendation.procedure.includes("OCA — aloenxerto osteocondral fresco"),
    )).toBe(false);
    expect(result.nextDataNeeded).toContain(
      "Confirmação de disponibilidade do banco de tecidos para OCA",
    );
  });

  it("omits OCA and explains confirmed tissue-bank non-availability", () => {
    const result = runOcdAlgorithm({
      ...osteochondralCase,
      bancoTecidosDisponivel: false,
    });

    expect(result.recommendations.some((recommendation) =>
      recommendation.procedure.includes("OCA — aloenxerto osteocondral fresco"),
    )).toBe(false);
    expect(result.warnings).toContain(
      "Banco de tecidos não disponível: OCA (aloenxerto osteocondral fresco) não será recomendado.",
    );
    expect(result.nextDataNeeded).not.toContain(
      "Confirmação de disponibilidade do banco de tecidos para OCA",
    );
  });
});