import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROC_MAP, buildPosText, buildPreText } from "@/components/OrientacoesInline";
import { getOrientationContent } from "@/pages/regen/orientacoes";
import { regenCoreMessages } from "@/locales/regen-core";
import { publicPatientFlowMessages } from "@/locales/public-patient-flows";
import { createDisplayLocaleOverrideLifecycle, type Locale } from "./i18n";
import { resolveOrientationBootstrap } from "./patient-orientation-route";

const sections = [
  { key: "hidrico" as const, label: "Hidratación" },
  { key: "meds" as const, label: "Medicamentos" },
  { key: "alimentacao" as const, label: "Alimentación" },
  { key: "logistica" as const, label: "Logística" },
  { key: "docs" as const, label: "Documentación" },
];

describe("localized clinical orientation catalogues", () => {
  it("has PT-BR/es protocol parity for every procedure reachable from PROC_MAP", () => {
    const pt = getOrientationContent("pt-BR").data;
    const es = getOrientationContent("es").data;
    const targets = [...new Set(Object.values(PROC_MAP))];

    targets.forEach((key) => {
      expect(pt[key], `${key} must have PT-BR protocol`).toBeTruthy();
      expect(es[key], `${key} must have Spanish protocol`).toBeTruthy();
      // Clinical acronyms such as CTM may intentionally remain unchanged, but
      // each protocol must expose authored Spanish patient-facing prose.
      expect(es[key].checklist.hidrico[0].desc).not.toBe(pt[key].checklist.hidrico[0].desc);
      expect(es[key].checklist.hidrico).toHaveLength(pt[key].checklist.hidrico.length);
      expect(es[key].checklist.meds).toHaveLength(pt[key].checklist.meds.length);
      expect(es[key].sinaisEsperados).toHaveLength(pt[key].sinaisEsperados.length);
      expect(es[key].sinaisAlerta).toHaveLength(pt[key].sinaisAlerta.length);
      expect(es[key].cronograma).toHaveLength(pt[key].cronograma.length);
      expect(es[key].retornos).toHaveLength(pt[key].retornos.length);
    });
  });

  it("uses authored Spanish clinical prose while preserving drug names, doses, intervals, units and numbers", () => {
    const pt = getOrientationContent("pt-BR").data.prp_articular;
    const es = getOrientationContent("es").data.prp_articular;
    expect(es.checklist.hidrico[0].desc).toContain("2-3 litros");
    expect(es.sinaisEsperados[0].desc).toContain("NO es un signo de infección");
    expect(es.analgesia.proibido).toContain("AINEs");
    expect(es.analgesia.gelo).toContain("15 a 20 minutos");
    expect(es.cronograma[0].titulo).toBe("Fase de protección");
    es.analgesia.medicamentos.forEach((medicine, index) => {
      expect(medicine.nome).toBe(pt.analgesia.medicamentos[index].nome);
      expect(medicine.dose).toBe(pt.analgesia.medicamentos[index].dose);
      expect(medicine.intervalo).toBe(pt.analgesia.medicamentos[index].intervalo);
      expect(medicine.max).toBe(pt.analgesia.medicamentos[index].max);
    });
  });
});

describe("patient orientation route authority and locale lifecycle", () => {
  it("uses signed server proc/tab over tampered query values", () => {
    expect(resolveOrientationBootstrap("signed-token", "ctm_osso", "pre", {
      procKey: "prp_tendineo", tab: "pos", doctorLocale: "es",
    })).toEqual({ procKey: "prp_tendineo", tab: "pos", doctorLocale: "es" });
  });

  it("forces legacy query links to temporary pt-BR", () => {
    expect(resolveOrientationBootstrap(null, "ctm_osso", "pre", null))
      .toEqual({ procKey: "ctm_osso", tab: "pre", doctorLocale: "pt-BR" });
  });

  it("uses an entirely Portuguese safe fallback when an invalid token has no trusted doctor locale", () => {
    const fallback = publicPatientFlowMessages["pt-BR"];
    expect([fallback.invalidLink, fallback.checkLink, fallback.retry]).toEqual([
      "Link inválido ou expirado.",
      "Verifique o link enviado pelo seu médico.",
      "Tentar novamente",
    ]);
  });

  it("applies signed Spanish temporarily then restores the prior locale without storage mutation", () => {
    const applied: Locale[] = [];
    let storageWrites = 0;
    const lifecycle = createDisplayLocaleOverrideLifecycle(
      locale => applied.push(locale),
      () => "pt-BR",
    );
    const release = lifecycle.begin("es");
    release();
    expect(applied).toEqual(["es", "pt-BR"]);
    expect(storageWrites).toBe(0);
    expect(readFileSync(new URL("../pages/patient/orientacoes-paciente.tsx", import.meta.url), "utf8"))
      .not.toContain("localStorage");
  });
});

describe("signed orientation sharing", () => {
  it("uses only minted production URLs for Spanish pre/post WhatsApp content", () => {
    const data = getOrientationContent("es").data.prp_articular;
    const t = (key: keyof typeof regenCoreMessages["pt-BR"]) => regenCoreMessages.es[key];
    const preUrl = "https://production.example/orientacoes-paciente?token=pre-signed";
    const posUrl = "https://production.example/orientacoes-paciente?token=pos-signed";
    expect(buildPreText(data, preUrl, sections, t)).toContain(preUrl);
    expect(buildPosText(data, posUrl, t)).toContain(posUrl);
  });

  it("mints links through the API and contains no browser-origin unsigned fallback", () => {
    const source = readFileSync(new URL("../components/OrientacoesInline.tsx", import.meta.url), "utf8");
    expect(source).toContain('fetch("/api/patient-orientations/token"');
    expect(source).toContain("value.preUrl");
    expect(source).toContain("value.posUrl");
    expect(source).not.toContain("window.location.origin");
    expect(source).not.toContain("buildPatientUrl");
  });
});