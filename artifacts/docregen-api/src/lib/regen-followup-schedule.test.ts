import { describe, expect, it } from "vitest";
import {
  REGEN_FOLLOWUP_SCHEDULE,
  REGEN_PATIENT_SCALES,
  REGEN_PROM_INSTRUMENTS,
  isRegenPatientScale,
  addDaysToCalendarDate,
  clinicToday,
  regenFollowupScheduleFor,
} from "./regen-followup-schedule";
import { localeDate } from "./locale";

describe("regenerative follow-up schedule", () => {
  it("adds the 6-week HA checkpoint only for hyaluronic acid", () => {
    expect(regenFollowupScheduleFor(["PRP"]).map((s) => s.periodo)).not.toContain("6 semanas (HA)");
    expect(regenFollowupScheduleFor([]).map((s) => s.periodo)).not.toContain("6 semanas (HA)");
    expect(regenFollowupScheduleFor(["AH"]).map((s) => s.periodo)).toContain("6 semanas (HA)");
    expect(regenFollowupScheduleFor(["prp", "ah"]).map((s) => s.periodo)).toContain("6 semanas (HA)");
    expect(regenFollowupScheduleFor(["PRP"])).toHaveLength(REGEN_FOLLOWUP_SCHEDULE.length - 1);
  });

  it("does calendar arithmetic without timezone drift", () => {
    expect(addDaysToCalendarDate("2026-09-29", 42, "2000-01-01")).toBe("2026-11-10");
    expect(addDaysToCalendarDate("2026-09-29T00:00:00.000Z", 1, "2000-01-01")).toBe("2026-09-30");
    expect(addDaysToCalendarDate(null, 30, "2026-09-29")).toBe("2026-10-29");
    expect(addDaysToCalendarDate("2024-02-28", 1, "2000-01-01")).toBe("2024-02-29");
  });

  it("uses the clinic (São Paulo) calendar for today", () => {
    // 02:00 UTC on the 30th is still the 29th in São Paulo.
    expect(clinicToday(new Date("2026-09-30T02:00:00Z"))).toBe("2026-09-29");
  });
});

describe("localeDate for documents", () => {
  it("formats calendar dates without shifting them, whatever the server timezone", () => {
    const original = process.env.TZ;
    process.env.TZ = "America/Sao_Paulo";
    try {
      expect(localeDate("2026-09-29", "pt-BR")).toBe("29/09/2026");
      expect(localeDate("2026-09-29", "es")).toBe("29/9/2026");
      expect(localeDate("not-a-date", "pt-BR")).toBe("");
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});

describe("knee cases ask VAS + SANE-joelho", () => {
  it("adds SANE Joelho to every slot for knee conditions only", () => {
    for (const code of ["OA_JOELHO_KL1", "OA_JOELHO_KL4", "LESAO_MENISCAL_DEGENERATIVA", "TENDINOPATIA_PATELAR", "CONDROPATIA_PATELAR"]) {
      const slots = regenFollowupScheduleFor(["PRP"], code);
      expect(slots.every((s) => s.scales.join("|") === "VAS Dor|SANE Joelho"), code).toBe(true);
    }
    for (const code of ["OA_QUADRIL", "OA_OMBRO", null, undefined]) {
      expect(regenFollowupScheduleFor(["PRP"], code).some((s) => s.scales.includes("SANE Joelho"))).toBe(false);
    }
    // The shared schedule constant itself is never mutated.
    expect(REGEN_FOLLOWUP_SCHEDULE.every((s) => s.scales.join("|") === "VAS Dor")).toBe(true);
  });
});

describe("every case asks VAS + the SANE of its condition region", () => {
  const expected: Record<string, string> = {
    OA_OMBRO: "SANE Ombro",
    TENDINOPATIA_OMBRO: "SANE Ombro",
    BURSITE_OMBRO: "SANE Ombro",
    LESAO_LABRAL_OMBRO: "SANE Ombro",
    OA_QUADRIL: "SANE Quadril",
    OA_COTOVELO: "SANE Cotovelo",
    TENDINOPATIA_COTOVELO: "SANE Cotovelo",
    EPICONDILITE: "SANE Cotovelo",
    OA_TORNOZELO: "SANE Tornozelo e Pé",
    FASCITE_PLANTAR: "SANE Tornozelo e Pé",
    OA_PUNHO: "SANE Punho e Mão",
    TENDINOPATIA_PUNHO: "SANE Punho e Mão",
    SINDROME_TUNEL_CARPO: "SANE Punho e Mão",
    OA_COLUNA_CERVICAL: "SANE Coluna",
    HERNIA_DISCAL_CERVICAL: "SANE Coluna",
    OA_COLUNA_TORACICA: "SANE Coluna",
    HERNIA_DISCAL_TORACICA: "SANE Coluna",
    OA_COLUNA_LOMBAR: "SANE Coluna",
    HERNIA_DISCAL_LOMBAR: "SANE Coluna",
    OA_JOELHO_KL2: "SANE Joelho",
  };

  it("adds exactly one region SANE per slot", () => {
    for (const [code, scale] of Object.entries(expected)) {
      const slots = regenFollowupScheduleFor(["AH"], code);
      expect(slots.length, code).toBe(REGEN_FOLLOWUP_SCHEDULE.length);
      expect(slots.every((s) => s.scales.join("|") === `VAS Dor|${scale}`), code).toBe(true);
    }
  });

  it("asks VAS only when the condition has no defined region or is unknown/legacy", () => {
    for (const code of ["CONDRAL_FOCAL", "OSTEOCONDRAL", "TENDINOPATIA", "SINOVITE", "BURSITE", "FRATURA_FADIGA",
      "POS_OPERATORIO", "CUSTOM", "hip_oa", "OA_JOELHO", "NOPE", "", null, undefined]) {
      expect(regenFollowupScheduleFor(["PRP"], code).every((s) => s.scales.join("|") === "VAS Dor"), String(code)).toBe(true);
    }
  });

  it("patient/clinician allowlists hold exactly VAS + the seven region SANEs", () => {
    expect([...REGEN_PATIENT_SCALES].sort()).toEqual([
      "SANE Coluna", "SANE Cotovelo", "SANE Joelho", "SANE Ombro", "SANE Punho e Mão", "SANE Quadril",
      "SANE Tornozelo e Pé", "VAS Dor",
    ]);
    expect([...REGEN_PROM_INSTRUMENTS].sort()).toEqual([
      "SANE Coluna", "SANE Cotovelo", "SANE Joelho", "SANE Ombro", "SANE Punho e Mão", "SANE Quadril",
      "SANE Tornozelo e Pé", "SANE_COLUNA", "SANE_COTOVELO", "SANE_JOELHO", "SANE_OMBRO", "SANE_PUNHO_MAO",
      "SANE_QUADRIL", "SANE_TORNOZELO_PE", "VAS",
    ]);
    for (const name of ["KOOS", "WOMAC", "IKDC", "ASES", "DASH", "SANE"]) expect(isRegenPatientScale(name)).toBe(false);
  });
});
