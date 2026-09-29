import { describe, expect, it } from "vitest";
import {
  classifyOutboxDelivery,
  expiredDispatchRequiresIntervention,
} from "./whatsappOutbox";

describe("WhatsApp outbox delivery policy", () => {
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