import { describe, expect, it } from "vitest";
import {
  createDisplayLocaleOverrideLifecycle,
  resolveRestoredDisplayLocale,
  resolveScopedTranslation,
  type Locale,
} from "./i18n";

describe("temporary public display locale", () => {
  it("restores a logged-in PT-BR account after an ES token page unmounts", () => {
    const applied: Locale[] = [];
    const lifecycle = createDisplayLocaleOverrideLifecycle(
      (locale) => applied.push(locale),
      () => "pt-BR",
    );

    const release = lifecycle.begin("es");
    release();

    expect(applied).toEqual(["es", "pt-BR"]);
    expect(lifecycle.isActive()).toBe(false);
  });

  it("restores the persisted language for an unauthenticated visitor", () => {
    const applied: Locale[] = [];
    const lifecycle = createDisplayLocaleOverrideLifecycle(
      (locale) => applied.push(locale),
      () => resolveRestoredDisplayLocale(null, "es"),
    );

    lifecycle.begin("pt-BR")();

    expect(applied).toEqual(["pt-BR", "es"]);
  });

  it("falls back to PT-BR when neither account nor browser preference is valid", () => {
    expect(resolveRestoredDisplayLocale(null, null)).toBe("pt-BR");
    expect(resolveRestoredDisplayLocale(undefined, "fr")).toBe("pt-BR");
    expect(resolveRestoredDisplayLocale("es", "pt-BR")).toBe("es");
  });

  it("does not let a stale page cleanup replace a newer override", () => {
    const applied: Locale[] = [];
    const lifecycle = createDisplayLocaleOverrideLifecycle(
      (locale) => applied.push(locale),
      () => "pt-BR",
    );

    const releaseFirstPage = lifecycle.begin("es");
    const releaseSecondPage = lifecycle.begin("es");
    releaseFirstPage();

    expect(applied).toEqual(["es", "es"]);

    releaseSecondPage();
    expect(applied).toEqual(["es", "es", "pt-BR"]);
  });
});

describe("scoped translations", () => {
  it("falls back to Portuguese instead of throwing when a Spanish entry is absent at runtime", () => {
    const catalog = {
      "pt-BR": { greeting: "Olá, {name}" },
      es: {},
    } as any;

    expect(resolveScopedTranslation(catalog, "es", "greeting", { name: "Ana" }))
      .toBe("Olá, Ana");
  });
});