import { describe, expect, it } from "vitest";
import {
  getRegenPlanningPayload,
  removeProductFromPlanning,
} from "../regen-case-payload";

describe("getRegenPlanningPayload", () => {
  it("sends explicit empty values so a saved plan can be cleared", () => {
    expect(getRegenPlanningPayload({
      plannedProducts: [],
      productDetails: {},
      coMeds: [],
      assocProcedures: [],
    })).toEqual({
      plannedProducts: [],
      productDetails: {},
      coMeds: [],
      assocProcedures: [],
    });
  });

  it("preserves selected products, technical details, medications and procedures", () => {
    expect(getRegenPlanningPayload({
      plannedProducts: ["PRP"],
      productDetails: { PRP__volumeFinal: "4" },
      coMeds: [{ name: "Motix", dose: "1 AMP" }],
      assocProcedures: ["Bloqueio de Nervos Geniculares"],
    })).toEqual({
      plannedProducts: ["PRP"],
      productDetails: { PRP__volumeFinal: "4" },
      coMeds: [{ name: "Motix", dose: "1 AMP" }],
      assocProcedures: ["Bloqueio de Nervos Geniculares"],
    });
  });
});

describe("removeProductFromPlanning", () => {
  it("removes only the deselected product's technical details when others remain", () => {
    expect(removeProductFromPlanning({
      plannedProducts: ["PRP", "BMAC"],
      productDetails: {
        PRP__volumeFinal: "4",
        BMAC__volumeFinal: "10",
        localAplicacao: "Intra-articular",
      },
      coMeds: [{ name: "Motix", dose: "1 AMP" }],
    }, "PRP")).toEqual({
      plannedProducts: ["BMAC"],
      productDetails: {
        BMAC__volumeFinal: "10",
        localAplicacao: "Intra-articular",
      },
      coMeds: [{ name: "Motix", dose: "1 AMP" }],
    });
  });

  it("clears details and co-medications when the last product is removed", () => {
    expect(removeProductFromPlanning({
      plannedProducts: ["PRP"],
      productDetails: {
        PRP__sistema: "ACP Double Syringe",
        localAplicacao: "Intra-articular",
      },
      coMeds: [{ name: "Motix", dose: "1 AMP" }],
    }, "PRP")).toEqual({
      plannedProducts: [],
      productDetails: {},
      coMeds: [],
    });
  });
});