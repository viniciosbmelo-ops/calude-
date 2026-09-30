// @vitest-environment happy-dom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DateInput, DateTimeInput, TimeInput } from "./date-input";

afterEach(() => cleanup());

function typeDigits(input: HTMLElement, digits: string) {
  let acc = "";
  for (const ch of digits) {
    acc = (input as HTMLInputElement).value + ch;
    fireEvent.change(input, { target: { value: acc } });
  }
}

function Controlled({ initial = "", onValue, ...props }: { initial?: string; onValue?: (v: string) => void; min?: string; max?: string; locale?: "pt-BR" | "es" }) {
  const [value, setValue] = React.useState(initial);
  return (
    <>
      <label htmlFor="dt">Data do caso</label>
      <DateInput id="dt" value={value} onValueChange={(v) => { setValue(v); onValue?.(v); }} {...props} />
      <output data-testid="value">{value}</output>
    </>
  );
}

describe("DateInput", () => {
  it("is a text field associated with its label, numeric keyboard, DD/MM/AAAA placeholder", () => {
    render(<Controlled />);
    const input = screen.getByLabelText("Data do caso") as HTMLInputElement;
    expect(input.type).toBe("text");
    expect(input.inputMode).toBe("numeric");
    expect(input.placeholder).toBe("DD/MM/AAAA");
    expect(input.value).toBe("");
    expect(screen.getByTestId("value").textContent).toBe("");
  });

  it('typing "29092026" yields value "2026-09-29" and shows 29/09/2026', () => {
    const onValue = vi.fn();
    render(<Controlled onValue={onValue} />);
    const input = screen.getByLabelText("Data do caso") as HTMLInputElement;
    typeDigits(input, "2909202");
    expect(input.value).toBe("29/09/202");
    expect(screen.getByTestId("value").textContent).toBe("");
    expect(onValue).not.toHaveBeenCalled();
    typeDigits(input, "6");
    expect(input.value).toBe("29/09/2026");
    expect(screen.getByTestId("value").textContent).toBe("2026-09-29");
    expect(onValue).toHaveBeenLastCalledWith("2026-09-29");
    expect(input.getAttribute("aria-invalid")).toBeNull();
  });

  it("marks 31/04 as invalid and keeps the value empty", () => {
    render(<Controlled />);
    const input = screen.getByLabelText("Data do caso") as HTMLInputElement;
    typeDigits(input, "31042026");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toBe("Data inválida");
    expect(screen.getByTestId("value").textContent).toBe("");
  });

  it("accepts 29/02 on leap years only", () => {
    render(<Controlled />);
    const input = screen.getByLabelText("Data do caso") as HTMLInputElement;
    typeDigits(input, "29022024");
    expect(screen.getByTestId("value").textContent).toBe("2024-02-29");
    fireEvent.change(input, { target: { value: "29/02/2026" } });
    expect(screen.getByTestId("value").textContent).toBe("");
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("clears the value when the text is erased or becomes incomplete (never fills today)", () => {
    render(<Controlled initial="2026-09-29" />);
    const input = screen.getByLabelText("Data do caso") as HTMLInputElement;
    expect(input.value).toBe("29/09/2026");
    fireEvent.change(input, { target: { value: "29/09/202" } });
    expect(screen.getByTestId("value").textContent).toBe("");
    expect(input.value).toBe("29/09/202");
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.getByTestId("value").textContent).toBe("");
    fireEvent.blur(input);
    expect(input.getAttribute("aria-invalid")).toBeNull();
  });

  it("flags incomplete text on blur", () => {
    render(<Controlled />);
    const input = screen.getByLabelText("Data do caso") as HTMLInputElement;
    typeDigits(input, "2909");
    expect(input.getAttribute("aria-invalid")).toBeNull();
    fireEvent.blur(input);
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("honours min/max", () => {
    render(<Controlled min="2026-01-01" max="2026-12-31" />);
    const input = screen.getByLabelText("Data do caso") as HTMLInputElement;
    typeDigits(input, "31122025");
    expect(screen.getByRole("alert").textContent).toBe("Data anterior a 01/01/2026");
    expect(screen.getByTestId("value").textContent).toBe("");
    fireEvent.change(input, { target: { value: "01/01/2027" } });
    expect(screen.getByRole("alert").textContent).toBe("Data posterior a 31/12/2026");
    fireEvent.change(input, { target: { value: "15/06/2026" } });
    expect(screen.getByTestId("value").textContent).toBe("2026-06-15");
  });

  it("follows external value changes (form reset / data load)", () => {
    const { rerender } = render(<DateInput aria-label="d" value="2026-09-29" onValueChange={() => {}} />);
    const input = screen.getByLabelText("d") as HTMLInputElement;
    expect(input.value).toBe("29/09/2026");
    rerender(<DateInput aria-label="d" value="" onValueChange={() => {}} />);
    expect(input.value).toBe("");
    rerender(<DateInput aria-label="d" value="2024-02-29T03:00:00.000Z" onValueChange={() => {}} />);
    expect(input.value).toBe("29/02/2024");
  });

  it("submits the ISO value through a hidden input when uncontrolled with a name", () => {
    const { container } = render(<DateInput aria-label="d" name="startsAt" defaultValue="2026-09-29" />);
    const hidden = container.querySelector('input[type="hidden"][name="startsAt"]') as HTMLInputElement;
    expect(hidden.value).toBe("2026-09-29");
    fireEvent.change(screen.getByLabelText("d"), { target: { value: "01/10/2026" } });
    expect(hidden.value).toBe("2026-10-01");
  });

  it("opens a Portuguese calendar (setembro, week starting on Sunday) and picks a day", async () => {
    render(<Controlled initial="2026-09-29" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Abrir calendário" }));
    });
    const grid = await screen.findByRole("grid");
    expect(grid.getAttribute("aria-label") ?? "").toMatch(/setembro/i);
    expect(document.body.textContent).toMatch(/setembro/i);
    const headers = Array.from(grid.querySelectorAll("th")).map((th) => th.getAttribute("aria-label") ?? th.textContent);
    expect((headers[0] ?? "").toLowerCase()).toMatch(/^dom/);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /15.*setembro.*2026/i }));
    });
    expect(screen.getByTestId("value").textContent).toBe("2026-09-15");
    expect((screen.getByLabelText("Data do caso") as HTMLInputElement).value).toBe("15/09/2026");
  });

  it("uses Spanish month names when the app language is ES", async () => {
    render(<Controlled initial="2026-09-29" locale="es" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Abrir calendario" }));
    });
    const grid = await screen.findByRole("grid");
    expect(grid.getAttribute("aria-label") ?? "").toMatch(/septiembre/i);
    expect((screen.getByLabelText("Data do caso") as HTMLInputElement).value).toBe("29/09/2026");
  });
});

describe("TimeInput / DateTimeInput (24h)", () => {
  it("masks HH:MM and rejects 24:00", () => {
    const onValue = vi.fn();
    render(<TimeInput aria-label="hora" value="" onValueChange={onValue} />);
    const input = screen.getByLabelText("hora") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "1430" } });
    expect(input.value).toBe("14:30");
    expect(onValue).toHaveBeenLastCalledWith("14:30");
    fireEvent.change(input, { target: { value: "2400" } });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(onValue).toHaveBeenLastCalledWith("");
  });

  it("DateTimeInput keeps the datetime-local contract", () => {
    const onValue = vi.fn();
    render(<DateTimeInput aria-label="Início" value="2026-09-29T08:15" onValueChange={onValue} />);
    const date = screen.getByLabelText("Início") as HTMLInputElement;
    const time = screen.getByLabelText("Início (HH:MM)") as HTMLInputElement;
    expect(date.value).toBe("29/09/2026");
    expect(time.value).toBe("08:15");
    fireEvent.change(time, { target: { value: "18:45" } });
    expect(onValue).toHaveBeenLastCalledWith("2026-09-29T18:45");
  });
});
