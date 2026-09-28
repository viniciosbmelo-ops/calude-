import { describe, expect, it } from "vitest";
import { operationalCoreMessages } from "./operational-core";
import { operationalPatientsListMessages } from "./operational-patients-list";
import { physioMessages } from "./physio";
import { regenCoreMessages } from "./regen-core";
import { surgeryShoulderMessages } from "./surgery-shoulder";
import { surgeryViewMessages } from "./surgery-view";

const catalogs = {
  operationalCoreMessages,
  operationalPatientsListMessages,
  physioMessages,
  regenCoreMessages,
  surgeryShoulderMessages,
  surgeryViewMessages,
} as Record<string, { "pt-BR": Record<string, string>; es: Record<string, string> }>;

describe("count-based locale strings", () => {
  for (const [name, catalog] of Object.entries(catalogs)) {
    it(`${name}: pt-BR and es keys match`, () => {
      expect(Object.keys(catalog.es).sort()).toEqual(Object.keys(catalog["pt-BR"]).sort());
    });

    it(`${name}: counted strings use real singular/plural pairs instead of "(s)"`, () => {
      for (const locale of ["pt-BR", "es"] as const) {
        for (const [key, value] of Object.entries(catalog[locale])) {
          if (/\{(count|n|pending|sent)\}/.test(value)) expect(value, `${locale}.${key}`).not.toMatch(/\(s\)|\(ns\)|\(is\)/);
          if (key.endsWith("One") && key.length > 3) expect(catalog[locale], `${locale}.${key}`).toHaveProperty(key.slice(0, -3));
        }
      }
    });
  }
});
