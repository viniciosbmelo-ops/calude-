// @vitest-environment happy-dom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/i18n", () => ({
  useScopedTranslations: () => (key: string) => key,
}));

import { DeletePatientDialog } from "./delete-patient-dialog";

const BLOCKED = "Este paciente tem registros clínicos e não pode ser excluído. Use \"Anonimizar dados identificáveis\".";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderDialog() {
  const onDeleted = vi.fn();
  const onAnonymize = vi.fn(async () => undefined);
  const onError = vi.fn();
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DeletePatientDialog
        patientId={7}
        onDeleted={onDeleted}
        onAnonymize={onAnonymize}
        onError={onError}
        trigger={<button type="button">open-delete</button>}
      />
    </QueryClientProvider>,
  );
  return { onDeleted, onAnonymize, onError };
}

async function openAndConfirm() {
  fireEvent.click(screen.getByRole("button", { name: "open-delete" }));
  await screen.findByText("deleteTitle");
  // The confirmation explains that only patients without clinical records can be deleted.
  expect(screen.getByText("deleteDescription")).toBeTruthy();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "delete" }));
  });
}

describe("DeletePatientDialog", () => {
  it("patient with clinical records: explains the 409 and offers anonymization (with its own confirmation)", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? "GET" });
      return new Response(
        JSON.stringify({ error: BLOCKED, code: "patient_has_clinical_records", clinicalRecords: { regenCases: 1 } }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      );
    }));
    const { onDeleted, onAnonymize, onError } = renderDialog();

    await openAndConfirm();

    await screen.findByText("deleteBlockedTitle");
    expect(screen.getByTestId("delete-blocked-message").textContent).toBe(BLOCKED);
    expect(calls).toEqual([{ url: "/regen-api/patients/7", method: "DELETE" }]);
    expect(onDeleted).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "anonymize" }));
    await screen.findByText("anonymizeTitle");
    expect(screen.getByText("anonymizeDescription")).toBeTruthy();
    expect(onAnonymize).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "anonymizeConfirm" }));
    });
    expect(onAnonymize).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText("anonymizeTitle")).toBeNull());
  });

  it("cancelling the blocked dialog does not anonymize", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ error: BLOCKED, code: "patient_has_clinical_records", clinicalRecords: {} }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    )));
    const { onAnonymize } = renderDialog();
    await openAndConfirm();
    await screen.findByText("deleteBlockedTitle");
    fireEvent.click(screen.getByRole("button", { name: "cancel" }));
    await waitFor(() => expect(screen.queryByText("deleteBlockedTitle")).toBeNull());
    expect(onAnonymize).not.toHaveBeenCalled();
  });

  it("patient without clinical records: deleted (204) and the caller is notified", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    const { onDeleted, onAnonymize, onError } = renderDialog();
    await openAndConfirm();
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(onAnonymize).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(screen.queryByText("deleteBlockedTitle")).toBeNull();
  });

  it("other failures report an error instead of offering anonymization", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ error: "boom" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    )));
    const { onDeleted, onError } = renderDialog();
    await openAndConfirm();
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onDeleted).not.toHaveBeenCalled();
    expect(screen.queryByText("deleteBlockedTitle")).toBeNull();
  });
});
