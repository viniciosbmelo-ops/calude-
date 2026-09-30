// @vitest-environment happy-dom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/i18n", () => ({
  useScopedTranslations: () => (key: string) => key,
}));

import { TermsModal, useRegenTermsGate } from "./regen-terms-modal";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Harness() {
  const gate = useRegenTermsGate();
  return (
    <>
      <output data-testid="needs">{String(gate.needsAcceptance)}</output>
      {gate.needsAcceptance && <TermsModal onAccept={gate.accept} loading={gate.accepting} />}
    </>
  );
}

describe("useRegenTermsGate (new regenerative case reached without the /regen dashboard)", () => {
  it("shows the terms modal when the API says they were not accepted, and accepting hides it", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET" });
      if (url.endsWith("/terms/status")) return new Response(JSON.stringify({ accepted: false }), { status: 200 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }));

    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId("needs").textContent).toBe("true"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /termsAccept/ }));
    });
    await waitFor(() => expect(screen.getByTestId("needs").textContent).toBe("false"));
    expect(screen.queryByRole("button", { name: /termsAccept/ })).toBeNull();
    expect(calls).toContainEqual({ url: "/regen-api/regen/terms/accept", method: "POST" });
  });

  it("does not show the modal when the terms were already accepted or the status is unknown", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ accepted: true }), { status: 200 })));
    render(<Harness />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId("needs").textContent).toBe("false");
    cleanup();

    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    render(<Harness />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId("needs").textContent).toBe("false");
  });
});
