import { describe, expect, it } from "vitest";
import { classifyFollowupNotification, clinicToday, isScheduledDateOverdue } from "./followup-assessment";

const pending = (scheduledDate: string | null) => ({ status: "pending", scheduledDate, followupId: null });

describe("clinicToday (America/Sao_Paulo)", () => {
  it("returns the São Paulo calendar date, not the UTC one, in the evening", () => {
    // 2026-10-05 22:30 em São Paulo (UTC-3) = 2026-10-06 01:30 UTC.
    const evening = new Date("2026-10-06T01:30:00Z");
    expect(evening.toISOString().slice(0, 10)).toBe("2026-10-06");
    expect(clinicToday(evening)).toBe("2026-10-05");
  });

  it("rolls over at local midnight", () => {
    expect(clinicToday(new Date("2026-10-06T02:59:59Z"))).toBe("2026-10-05");
    expect(clinicToday(new Date("2026-10-06T03:00:00Z"))).toBe("2026-10-06");
  });
});

describe("follow-up overdue classification", () => {
  const today = "2026-10-05";

  it("today is due, not overdue", () => {
    expect(isScheduledDateOverdue("2026-10-05", today)).toBe(false);
    expect(classifyFollowupNotification(pending("2026-10-05"), false, today)).toBe("agendados");
  });

  it("yesterday is overdue", () => {
    expect(isScheduledDateOverdue("2026-10-04", today)).toBe(true);
    expect(classifyFollowupNotification(pending("2026-10-04"), false, today)).toBe("vencidos");
  });

  it("tomorrow is upcoming", () => {
    expect(isScheduledDateOverdue("2026-10-06", today)).toBe(false);
    expect(classifyFollowupNotification(pending("2026-10-06"), false, today)).toBe("agendados");
  });

  it("a follow-up for today stays due at 22:30 in São Paulo (already the next day in UTC)", () => {
    const evening = new Date("2026-10-06T01:30:00Z");
    expect(classifyFollowupNotification(pending("2026-10-05"), false, clinicToday(evening))).toBe("agendados");
    expect(classifyFollowupNotification(pending("2026-10-06"), false, clinicToday(evening))).toBe("agendados");
    expect(classifyFollowupNotification(pending("2026-10-04"), false, clinicToday(evening))).toBe("vencidos");
  });

  it("missing dates are never overdue", () => {
    expect(isScheduledDateOverdue(null, today)).toBe(false);
    expect(classifyFollowupNotification(pending(null), false, today)).toBe("agendados");
  });
});
