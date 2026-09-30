import { describe, expect, it } from "vitest";
import { lgpdMessages } from "./lgpd";

describe("LGPD copy", () => {
  it("keeps the same keys in both locales", () => {
    expect(Object.keys(lgpdMessages.es).sort()).toEqual(Object.keys(lgpdMessages["pt-BR"]).sort());
  });

  it("never promises deletion of the medical record and states the 20-year retention", () => {
    for (const messages of [lgpdMessages["pt-BR"], lgpdMessages.es]) {
      expect(messages.anonymizeDescription).toMatch(/20/);
      expect(messages.requestDeletionDescription).toMatch(/20/);
      expect(messages.anonymized).not.toMatch(/exclu[ií]d|apagad|eliminad|borrad/i);
    }
    expect(lgpdMessages["pt-BR"].anonymized).toMatch(/registros clínicos mantidos/);
  });
});
