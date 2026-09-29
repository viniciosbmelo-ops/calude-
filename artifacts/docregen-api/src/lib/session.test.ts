import { describe, expect, it, vi } from "vitest";
import type { Response } from "express";
import {
  clearAllSessionCookies,
  establishSession,
  SESSION_COOKIE_NAMES,
} from "./session";

function createResponseMock() {
  const cookie = vi.fn();
  const clearCookie = vi.fn();
  return {
    response: { cookie, clearCookie } as unknown as Response,
    cookie,
    clearCookie,
  };
}

describe("session cookies", () => {
  it("sets an HttpOnly, same-site, API-scoped session without exposing the token", () => {
    const { response, cookie, clearCookie } = createResponseMock();

    establishSession(response, "doctor", "signed-session");

    expect(clearCookie).toHaveBeenCalledTimes(Object.keys(SESSION_COOKIE_NAMES).length);
    expect(cookie).toHaveBeenCalledWith(
      SESSION_COOKIE_NAMES.doctor,
      "signed-session",
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        path: "/regen-api",
        maxAge: 12 * 60 * 60 * 1000,
      }),
    );
  });

  it("clears every role cookie during logout", () => {
    const { response, clearCookie } = createResponseMock();

    clearAllSessionCookies(response);

    expect(clearCookie).toHaveBeenCalledTimes(Object.keys(SESSION_COOKIE_NAMES).length);
    for (const name of Object.values(SESSION_COOKIE_NAMES)) {
      expect(clearCookie).toHaveBeenCalledWith(
        name,
        expect.objectContaining({
          httpOnly: true,
          sameSite: "lax",
          path: "/regen-api",
        }),
      );
    }
  });
});