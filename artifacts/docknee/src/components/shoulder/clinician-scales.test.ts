import { describe, expect, it } from "vitest";
import { CLINICIAN_SCALE_ITEMS, applicableClinicianScales } from "@workspace/clinical/web";
import { surgeryViewMessages } from "@/locales/surgery-view";
import {
  buildClinicianScalesPayload,
  emptyDraft,
  evaluateDraft,
  hasDirectionHint,
  itemHintKey,
  itemLabelKey,
  optionLabelKey,
  scaleMax,
  scaleNameKey,
  visibleItems,
  type ScaleDraft,
} from "./clinician-scales";

function constantDraft(withDynamometer = false): ScaleDraft {
  return {
    withDynamometer,
    values: {
      pain: "10", sleep: "2", work: "3", recreation: "3", hand_position: "neck",
      flexion_deg: "140", abduction_deg: "100",
      er_achieved: ["hand_behind_head_elbow_forward", "hand_behind_head_elbow_back"],
      ir_position: "waist_L3", strength_kg: withDynamometer ? "5,0" : "",
    },
  };
}

describe("clinician scales form logic", () => {
  it("Constant without dynamometer hides strength and scores over 75", () => {
    const draft = constantDraft(false);
    expect(visibleItems("CONSTANT", draft).map((i) => i.field)).not.toContain("strength_kg");
    expect(scaleMax("CONSTANT", draft)).toBe(75);
    const ev = evaluateDraft("CONSTANT", draft);
    expect(ev).toMatchObject({ kind: "ok", result: { score: 48, max: 75 } });
  });

  it("Constant with dynamometer accepts a decimal comma and scores over 100", () => {
    const draft = constantDraft(true);
    expect(scaleMax("CONSTANT", draft)).toBe(100);
    expect(evaluateDraft("CONSTANT", draft)).toMatchObject({ kind: "ok", result: { score: 59, max: 100 } });
  });

  it("payload skips untouched scales and reports the first missing or invalid item", () => {
    const drafts = { CONSTANT: constantDraft(false), ROWE: emptyDraft("ROWE") };
    const ok = buildClinicianScalesPayload(drafts, ["CONSTANT", "ROWE"]);
    expect(ok.ok && Object.keys(ok.payload)).toEqual(["CONSTANT"]);
    expect(ok.ok && ok.payload.CONSTANT).not.toHaveProperty("strength_kg");

    const partialRowe = { ROWE: { ...emptyDraft("ROWE"), values: { stability: "subluxation", motion: "", function: "" } } };
    expect(buildClinicianScalesPayload(partialRowe, ["ROWE"])).toEqual({ ok: false, scale: "ROWE", field: "motion" });

    const badPain = { CONSTANT: { ...constantDraft(), values: { ...constantDraft().values, pain: "16" } } };
    expect(buildClinicianScalesPayload(badPain, ["CONSTANT"])).toEqual({ ok: false, scale: "CONSTANT", field: "pain" });

    // Rascunho de escala não aplicável não é enviado
    expect(buildClinicianScalesPayload({ CONSTANT: constantDraft() }, ["ROWE"])).toEqual({ ok: true, payload: {} });
  });

  it("applicable scales come from the pathology catalog", () => {
    expect(applicableClinicianScales({ tiposProcedimento: ["SH_CUFF"] })).toEqual(["CONSTANT"]);
    expect(applicableClinicianScales({ tiposProcedimento: ["SH_INSTABILITY"] })).toEqual(["ROWE"]);
    expect(applicableClinicianScales({ tiposProcedimento: ["SH_BICEPS_SLAP"] })).toEqual([]);
  });

  it("every scale, item and option has pt-BR and es labels", () => {
    const pt = surgeryViewMessages["pt-BR"] as Record<string, string>;
    const es = surgeryViewMessages.es as Record<string, string>;
    const keys: string[] = [];
    for (const [code, items] of Object.entries(CLINICIAN_SCALE_ITEMS)) {
      keys.push(scaleNameKey(code));
      for (const item of items) {
        keys.push(itemLabelKey(code, item.field));
        if (hasDirectionHint(code, item.field)) keys.push(itemHintKey(code, item.field));
        if (item.kind === "choice" || item.kind === "multi") {
          for (const o of item.options) keys.push(optionLabelKey(code, item.field, o.value));
        }
      }
    }
    expect(keys.filter((k) => !pt[k])).toEqual([]);
    expect(keys.filter((k) => !es[k])).toEqual([]);
    const csPt = Object.keys(pt).filter((k) => k.startsWith("cs_")).sort();
    const csEs = Object.keys(es).filter((k) => k.startsWith("cs_")).sort();
    expect(csEs).toEqual(csPt);
  });
});

describe("Constant range direction hints", () => {
  it("marks the higher end as better for the subjective items, matching the score", () => {
    const pt = surgeryViewMessages["pt-BR"] as Record<string, string>;
    const es = surgeryViewMessages.es as Record<string, string>;
    const items = CLINICIAN_SCALE_ITEMS.CONSTANT;
    for (const field of ["pain", "sleep", "work", "recreation"]) {
      expect(hasDirectionHint("CONSTANT", field)).toBe(true);
      const item = items.find((i) => i.field === field);
      const max = item && "max" in item ? item.max : NaN;
      // A dica cita o máximo da faixa como o melhor valor.
      expect(pt[itemHintKey("CONSTANT", field)]).toMatch(new RegExp(`^${max} = `));
      expect(es[itemHintKey("CONSTANT", field)]).toMatch(new RegExp(`^${max} = `));
    }
    // Mais pontos no item = escore maior (maior é melhor no escore).
    const low = evaluateDraft("CONSTANT", { ...constantDraft(false), values: { ...constantDraft(false).values, pain: "0" } });
    const high = evaluateDraft("CONSTANT", { ...constantDraft(false), values: { ...constantDraft(false).values, pain: "15" } });
    expect(low.kind === "ok" && high.kind === "ok" && high.result.score - low.result.score).toBe(15);
  });
});
