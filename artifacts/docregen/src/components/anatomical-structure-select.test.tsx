// @vitest-environment happy-dom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AnatomicalStructureSelect } from "./anatomical-structure-select";

afterEach(cleanup);

const LABELS = { placeholder: "—", previous: "Valor salvo anteriormente", detail: "Especifique a estrutura" };

function renderSelect(props: Partial<React.ComponentProps<typeof AnatomicalStructureSelect>> = {}) {
  const onChange = vi.fn();
  const onDetailChange = vi.fn();
  render(
    <AnatomicalStructureSelect
      index={0} value="" detail="" locale="pt-BR" labels={LABELS}
      onChange={onChange} onDetailChange={onDetailChange} {...props}
    />,
  );
  const select = screen.getByTestId("application-structure-0") as HTMLSelectElement;
  const groups = Array.from(select.querySelectorAll("optgroup"));
  return { select, groups, onChange, onDetailChange };
}

describe("AnatomicalStructureSelect (grouped by region)", () => {
  it("renders one optgroup per region with its structures (pt-BR)", () => {
    const { groups } = renderSelect();
    expect(groups.map(g => g.label)).toEqual([
      "Ombro", "Cotovelo", "Punho e Mão", "Quadril", "Joelho", "Tornozelo e Pé", "Coluna", "Pelve", "Outros",
    ]);
    const hand = groups.find(g => g.label === "Punho e Mão")!;
    expect(Array.from(hand.querySelectorAll("option")).map(o => o.textContent)).toContain("Polia A1 (dedo em gatilho)");
    expect(groups.find(g => g.label === "Joelho")!.querySelectorAll("option")).toHaveLength(11);
    expect(groups.find(g => g.label === "Pelve")!.textContent).toBe("Articulação sacroilíaca");
    // Legacy codes are not offered for new rows.
    expect(Array.from(groups.flatMap(g => Array.from(g.querySelectorAll("option")))).map(o => o.value)).not.toContain("JOELHO");
  });

  it("renders Spanish region headers and labels", () => {
    const { groups } = renderSelect({ locale: "es" });
    expect(groups[0].label).toBe("Hombro");
    expect(groups.map(g => g.label)).toContain("Muñeca y Mano");
    expect(screen.getByRole("option", { name: "Polea A1 (dedo en gatillo)" })).toBeTruthy();
  });

  it("reports the chosen code", () => {
    const { select, onChange } = renderSelect();
    fireEvent.change(select, { target: { value: "MAO_POLIA_A1" } });
    expect(onChange).toHaveBeenCalledWith("MAO_POLIA_A1");
  });

  it("keeps a stored legacy code selectable with its label", () => {
    const { select, groups } = renderSelect({ value: "MENISCO" });
    expect(groups[0].label).toBe("Valor salvo anteriormente");
    expect(select.value).toBe("MENISCO");
    expect(select.selectedOptions[0].textContent).toBe("Menisco");
  });

  it("asks for free text only for Músculo/Outro", () => {
    const { onDetailChange } = renderSelect({ value: "MUSCULO", detail: "reto" });
    const input = screen.getByTestId("application-structure-detail-0") as HTMLInputElement;
    expect(input.value).toBe("reto");
    fireEvent.change(input, { target: { value: "reto femoral" } });
    expect(onDetailChange).toHaveBeenCalledWith("reto femoral");
    cleanup();
    renderSelect({ value: "MAO_POLIA_A1" });
    expect(screen.queryByTestId("application-structure-detail-0")).toBeNull();
  });
});
