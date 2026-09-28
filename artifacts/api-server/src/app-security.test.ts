import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import app, { privacySafeRequestPath } from "./app";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe("HTTP origin and session protections", () => {
  it("redacts pre-consult bearer tokens from request paths before logging", () => {
    expect(
      privacySafeRequestPath("/api/pre-consult/raw-secret-token/uploads/request-url?x=1"),
    ).toBe("/api/pre-consult/:token/uploads/request-url");
    expect(
      privacySafeRequestPath("/pre-consult/raw-secret-token/verify"),
    ).toBe("/pre-consult/:token/verify");
  });

  it("returns 403, not 500, for an untrusted browser origin", async () => {
    const response = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Origin: "https://evil.example" },
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Origem da requisição não autorizada.",
    });
  });

  it("rejects unsafe cookie-authenticated requests with no origin or referer", async () => {
    const response = await fetch(`${baseUrl}/api/stats/visit`, {
      method: "POST",
      headers: {
        Cookie: "docknee_session=opaque-session-cookie",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path: "/" }),
    });

    expect(response.status).toBe(403);
  });

  it("accepts a same-origin referer for an unsafe cookie-authenticated request", async () => {
    const response = await fetch(`${baseUrl}/api/stats/visit`, {
      method: "POST",
      headers: {
        Cookie: "docknee_session=opaque-session-cookie",
        Referer: "http://127.0.0.1/safe-page",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path: "/" }),
    });

    expect(response.status).toBe(204);
  });

  it("accepts an allowed origin for an unsafe cookie-authenticated request", async () => {
    const response = await fetch(`${baseUrl}/api/stats/visit`, {
      method: "POST",
      headers: {
        Cookie: "docknee_session=opaque-session-cookie",
        Origin: "http://127.0.0.1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path: "/" }),
    });

    expect(response.status).toBe(204);
  });

  it("allows the local preview origin in development without a session", async () => {
    const response = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Origin: "http://127.0.0.1" },
    });

    expect(response.status).toBe(204);
  });

  it("requires authentication for clinical calculation endpoints", async () => {
    for (const endpoint of ["calculate-krirs", "calculate-pics", "calculate-acl-decision"]) {
      const response = await fetch(`${baseUrl}/api/surgeries/${endpoint}`, {
        method: "POST",
        headers: {
          Origin: "http://127.0.0.1",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      expect(response.status).toBe(401);
    }
  });
});