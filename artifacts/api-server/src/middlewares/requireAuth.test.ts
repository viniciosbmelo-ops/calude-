import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import type { AuthTokenPayload } from "../lib/auth";

vi.mock("../lib/sessionAccountStore", () => ({
  validateCurrentAccount: vi.fn(async (payload: AuthTokenPayload) => payload),
}));

import jwt from "jsonwebtoken";
import {
  signSecretaryToken,
  signServiceToken,
  signToken,
} from "../lib/auth";
import { validateCurrentAccount } from "../lib/sessionAccountStore";
import { SESSION_COOKIE_NAMES } from "../lib/session";
import {
  requireAdmin,
  requireAuth,
  requireDoctorOrSecretary,
  optionalDoctorAuth,
  requireSecretary,
  requireService,
} from "./requireAuth";

type Middleware = (req: Request, res: Response, next: NextFunction) => void;

async function runMiddleware(
  middleware: Middleware,
  options: {
    cookies?: Record<string, string>;
    authorization?: string;
  } = {},
) {
  const req = {
    method: "GET",
    originalUrl: "/api/test",
    headers: {
      authorization: options.authorization,
    },
    cookies: options.cookies ?? {},
  } as unknown as Request;
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const res = { status } as unknown as Response;
  const next = vi.fn();

  middleware(req, res, next);
  await vi.waitFor(() => {
    expect(next.mock.calls.length + status.mock.calls.length).toBeGreaterThan(0);
  });
  return { req, next, status, json };
}

describe("role-aware authentication middleware", () => {
  beforeEach(() => {
    vi.mocked(validateCurrentAccount).mockReset();
    vi.mocked(validateCurrentAccount).mockImplementation(
      async (payload) => payload,
    );
  });

  it("allows an anonymous optional session probe without assigning a role", async () => {
    const result = await runMiddleware(optionalDoctorAuth);

    expect(result.next).toHaveBeenCalledOnce();
    expect(result.req.doctorId).toBeUndefined();
    expect(result.req.role).toBeUndefined();
  });

  it("accepts a doctor HttpOnly session on doctor routes", async () => {
    const token = signToken({ doctorId: 12, isAdmin: false });
    const result = await runMiddleware(requireAuth, {
      cookies: { [SESSION_COOKIE_NAMES.doctor]: token },
    });

    expect(result.next).toHaveBeenCalledOnce();
    expect(result.req.doctorId).toBe(12);
    expect(result.req.role).toBe("doctor");
    expect(result.req.isAdmin).toBe(false);
  });

  it("rejects a valid JWT when the persistent account state revokes it", async () => {
    vi.mocked(validateCurrentAccount).mockResolvedValueOnce(null);
    const token = signToken({
      doctorId: 12,
      isAdmin: false,
      sessionVersion: 4,
    });

    const result = await runMiddleware(requireAuth, {
      cookies: { [SESSION_COOKIE_NAMES.doctor]: token },
    });

    expect(result.next).not.toHaveBeenCalled();
    expect(result.status).toHaveBeenCalledWith(401);
  });

  it("accepts a secretary only on shared and secretary routes", async () => {
    const token = signSecretaryToken({ doctorId: 12, secretaryId: 30 });
    const cookie = { [SESSION_COOKIE_NAMES.secretary]: token };

    const shared = await runMiddleware(requireDoctorOrSecretary, { cookies: cookie });
    expect(shared.next).toHaveBeenCalledOnce();
    expect(shared.req.doctorId).toBe(12);
    expect(shared.req.secretaryId).toBe(30);

    const secretary = await runMiddleware(requireSecretary, { cookies: cookie });
    expect(secretary.next).toHaveBeenCalledOnce();

    const doctorOnly = await runMiddleware(requireAuth, { cookies: cookie });
    expect(doctorOnly.next).not.toHaveBeenCalled();
    expect(doctorOnly.status).toHaveBeenCalledWith(401);
  });

  it("does not accept service cookies on doctor routes", async () => {
    const service = await runMiddleware(requireAuth, {
      cookies: {
        [SESSION_COOKIE_NAMES.service]: signServiceToken({ serviceId: 9 }),
      },
    });

    expect(service.next).not.toHaveBeenCalled();
    expect(service.status).toHaveBeenCalledWith(401);
  });

  it("rejects tokens of the removed physiotherapist role everywhere", async () => {
    // A still-valid token issued before the physio portal was removed.
    const legacyPhysioToken = jwt.sign(
      { physioId: 8, sessionVersion: 0, role: "physio", isAdmin: false },
      process.env["SESSION_SECRET"]!,
      { algorithm: "HS256", issuer: "docknee-api", audience: "docknee-web", expiresIn: "12h" },
    );
    for (const middleware of [requireAuth, requireDoctorOrSecretary, requireSecretary, requireService]) {
      const viaCookie = await runMiddleware(middleware, {
        cookies: { docknee_physio_session: legacyPhysioToken },
      });
      const viaBearer = await runMiddleware(middleware, {
        authorization: `Bearer ${legacyPhysioToken}`,
      });
      expect(viaCookie.next).not.toHaveBeenCalled();
      expect(viaCookie.status).toHaveBeenCalledWith(401);
      expect(viaBearer.next).not.toHaveBeenCalled();
      expect(viaBearer.status).toHaveBeenCalledWith(401);
    }
    expect(validateCurrentAccount).not.toHaveBeenCalledWith(expect.objectContaining({ role: "physio" }));
  });

  it("enforces each specialized role cookie", async () => {
    const service = await runMiddleware(requireService, {
      cookies: {
        [SESSION_COOKIE_NAMES.service]: signServiceToken({ serviceId: 9 }),
      },
    });

    expect(service.next).toHaveBeenCalledOnce();
    expect(service.req.serviceId).toBe(9);
  });

  it("requires the current database admin flag for admin routes", async () => {
    vi.mocked(validateCurrentAccount)
      .mockResolvedValueOnce({
        role: "doctor",
        doctorId: 12,
        isAdmin: false,
        sessionVersion: 0,
      })
      .mockResolvedValueOnce({
        role: "doctor",
        doctorId: 1,
        isAdmin: true,
        sessionVersion: 0,
      });

    const regular = await runMiddleware(requireAdmin, {
      cookies: {
        [SESSION_COOKIE_NAMES.doctor]: signToken({
          doctorId: 12,
          isAdmin: true,
        }),
      },
    });
    const admin = await runMiddleware(requireAdmin, {
      cookies: {
        [SESSION_COOKIE_NAMES.doctor]: signToken({
          doctorId: 1,
          isAdmin: false,
        }),
      },
    });

    expect(regular.next).not.toHaveBeenCalled();
    expect(regular.status).toHaveBeenCalledWith(403);
    expect(admin.next).toHaveBeenCalledOnce();
  });

  it("keeps bearer support for non-browser clients without weakening role checks", async () => {
    const token = signToken({ doctorId: 44, isAdmin: false });
    const result = await runMiddleware(requireAuth, {
      authorization: `Bearer ${token}`,
    });

    expect(result.next).toHaveBeenCalledOnce();
    expect(result.req.doctorId).toBe(44);
  });
});