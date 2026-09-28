import { describe, expect, it } from "vitest";
import {
  buildRedFlagMessage,
  classifyOutboxDelivery,
  expiredDispatchRequiresIntervention,
  flagLabel,
} from "./redFlagAlerts";

describe("red flag alert content", () => {
  it("uses patient initials and controlled clinical labels", () => {
    const text = buildRedFlagMessage({
      patientName: "Maria da Silva",
      physioName: "Ana Souza",
      redFlags: ["sinal_desconhecido"],
    });
    expect(text).toContain("M.D.S.");
    expect(text).toContain("Sinal clínico de atenção");
    expect(text).not.toContain("Maria da Silva");
  });

  it("does not echo an unknown flag into a WhatsApp alert", () => {
    expect(flagLabel("token=secret clinical payload")).toBe("Sinal clínico de atenção");
  });
});

describe("red flag outbox delivery policy", () => {
  it("does not retry a timeout or crash after dispatch blindly", () => {
    expect(classifyOutboxDelivery({ ok: false, deliveryUncertain: true }, 1, 5)).toBe("uncertain");
    expect(expiredDispatchRequiresIntervention()).toEqual({
      status: "uncertain",
      interventionRequired: true,
      alternateEscalation: true,
    });
  });

  it("retries explicit provider rejections but records a final failure at the limit", () => {
    expect(classifyOutboxDelivery({ ok: false }, 1, 5)).toBe("pending");
    expect(classifyOutboxDelivery({ ok: false }, 5, 5)).toBe("failed");
  });

  it("keeps provider success without a message ID uncertain", () => {
    expect(classifyOutboxDelivery({ ok: true }, 1, 5)).toBe("uncertain");
    expect(classifyOutboxDelivery({ ok: true, messageId: "provider-1" }, 1, 5)).toBe("sent");
  });
});