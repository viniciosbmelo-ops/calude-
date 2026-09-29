import { describe, expect, it } from "vitest";
import {
  REGEN_FOLLOWUP_SCHEDULE,
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
      expect(regenFollowupScheduleFor(["PRP"], code).every((s) => s.scales.join("|") === "VAS Dor")).toBe(true);
    }
    // The shared schedule constant itself is never mutated.
    expect(REGEN_FOLLOWUP_SCHEDULE.every((s) => s.scales.join("|") === "VAS Dor")).toBe(true);
  });
});
