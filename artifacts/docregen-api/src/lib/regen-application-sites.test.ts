import { describe, expect, it } from "vitest";
import {
  applicationSitesForProductDetails,
  hasValidApplicationSitesExtension,
  synchronizeApplicationSiteLegacyFields,
} from "./regen-application-sites";

describe("regen application-site API boundary", () => {
  it("accepts a serialized repeatable array and preserves legacy-compatible rows", () => {
    const details = {
      locaisAplicacao: JSON.stringify([
        { localAplicacao: "Intra-articular", guia: "Ultrassom" },
        { localAplicacao: "Ligamento", guia: "Fluoroscopia" },
      ]),
      observacoes: "Sem alterações",
    };
    expect(hasValidApplicationSitesExtension(details)).toBe(true);
    expect(applicationSitesForProductDetails(details)).toHaveLength(2);
  });

  it("rejects malformed or incorrectly shaped serialized values", () => {
    expect(hasValidApplicationSitesExtension({ locaisAplicacao: "{bad" })).toBe(false);
    expect(hasValidApplicationSitesExtension({
      locaisAplicacao: JSON.stringify([{ localAplicacao: "Ligamento" }]),
    })).toBe(false);
    expect(hasValidApplicationSitesExtension({
      locaisAplicacao: JSON.stringify(["Ligamento"]),
    })).toBe(false);
  });

  it("falls back to legacy singular values", () => {
    expect(applicationSitesForProductDetails({
      localAplicacao: "Intra-articular",
      guia: "Artroscopia",
    })).toEqual([{ localAplicacao: "Intra-articular", guia: "Artroscopia" }]);
  });

  it("synchronizes singular compatibility fields to the first repeatable row", () => {
    expect(synchronizeApplicationSiteLegacyFields({
      locaisAplicacao: JSON.stringify([
        { localAplicacao: "Ligamento", guia: "Fluoroscopia" },
        { localAplicacao: "Ligamento", guia: "Ultrassom" },
      ]),
      localAplicacao: "Intra-articular",
      guia: "Artroscopia",
      observacoes: "Preservar",
    })).toMatchObject({
      localAplicacao: "Ligamento",
      guia: "Fluoroscopia",
      observacoes: "Preservar",
    });
  });
});
