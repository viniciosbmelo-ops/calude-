import { describe, expect, it, vi } from "vitest";
import type { Request } from "express";

const resolveAnalyticsSessionId = vi.fn();
const emitAnalyticsEvent = vi.fn();

vi.mock("../lib/analyticsEmitter.js", () => ({
  resolveAnalyticsSessionId,
  emitAnalyticsEvent,
}));

describe("successful RX telemetry boundary", () => {
  it("does not reject a successful analysis when analytics storage fails", async () => {
    resolveAnalyticsSessionId.mockResolvedValue("fixture-session");
    emitAnalyticsEvent.mockRejectedValue(new Error("telemetry database unavailable"));

    const { emitSuccessfulXrayAnalytics } = await import("./xray.js");
    const request = {
      doctorId: 17,
      get: () => "fixture-session",
    } as unknown as Request;

    await expect(emitSuccessfulXrayAnalytics(request, "standalone")).resolves.toBeUndefined();
    expect(emitAnalyticsEvent).toHaveBeenCalledWith(
      "xray_analyzed",
      17,
      "fixture-session",
      { pagePath: "/xray-planning", featureName: "xray_standalone" },
    );
  });

  it("does not classify missing provenance as standalone planning", async () => {
    const { emitSuccessfulXrayAnalytics } = await import("./xray.js");
    const request = {
      doctorId: 17,
      get: () => "fixture-session",
    } as unknown as Request;

    emitAnalyticsEvent.mockClear();
    await expect(emitSuccessfulXrayAnalytics(request, null)).resolves.toBeUndefined();
    expect(emitAnalyticsEvent).not.toHaveBeenCalled();
  });

  it("keeps surgery analysis provenance outside the standalone RX cohort", async () => {
    resolveAnalyticsSessionId.mockResolvedValue("fixture-session");
    emitAnalyticsEvent.mockResolvedValue(undefined);
    const { emitSuccessfulXrayAnalytics } = await import("./xray.js");
    const request = {
      doctorId: 17,
      get: () => "fixture-session",
    } as unknown as Request;

    emitAnalyticsEvent.mockClear();
    await emitSuccessfulXrayAnalytics(request, "surgery");
    expect(emitAnalyticsEvent).toHaveBeenCalledWith(
      "xray_analyzed",
      17,
      "fixture-session",
      { pagePath: "/surgeries/new", featureName: "xray_surgery" },
    );
  });
});
