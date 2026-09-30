/**
 * /healthz stays cheap, /readyz checks the database; the CORS allowlist is
 * configurable and, in production, does not include DocKnee's origins by
 * default.
 */
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { pool } from "@workspace/docregen-db";
import app, { buildAllowedOrigins } from "../app";
import { databaseReady } from "./health";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) => (error ? reject(error) : resolve()));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("health endpoints", () => {
  it("/healthz answers without touching the database", async () => {
    const spy = vi.spyOn(pool, "query");
    const response = await fetch(`${baseUrl}/regen-api/healthz`);
    expect(response.status).toBe(200);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("/readyz runs SELECT 1", async () => {
    const response = await fetch(`${baseUrl}/regen-api/readyz`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", database: "ok" });
  });

  it("/readyz is 503 when the database does not answer in time", async () => {
    const spy = vi.spyOn(pool, "query").mockImplementation((() => new Promise(() => undefined)) as never);
    try {
      expect(await databaseReady(50)).toBe(false);
    } finally {
      spy.mockRestore();
    }
    const failing = vi.spyOn(pool, "query").mockImplementation((() => Promise.reject(new Error("down"))) as never);
    try {
      const response = await fetch(`${baseUrl}/regen-api/readyz`);
      expect(response.status).toBe(503);
    } finally {
      failing.mockRestore();
    }
  });
});

describe("CORS allowlist", () => {
  it("production default: DOCREGEN_APP_URL and the Repl's own domains, never DocKnee's domain", () => {
    const origins = buildAllowedOrigins({
      NODE_ENV: "production",
      DOCREGEN_APP_URL: "https://docregen.example/app",
      REPLIT_DOMAINS: "docregen.replit.app",
    });
    expect([...origins].sort()).toEqual(["https://docregen.example", "https://docregen.replit.app"]);
    expect(origins.has("https://dockneeapp.com")).toBe(false);
    expect(origins.has("https://www.dockneeapp.com")).toBe(false);
    expect(buildAllowedOrigins({ NODE_ENV: "production" }).size).toBe(0);
  });

  it("DOCREGEN_ALLOWED_ORIGINS adds explicit origins (comma-separated, invalid ignored)", () => {
    const origins = buildAllowedOrigins({
      NODE_ENV: "production",
      DOCREGEN_ALLOWED_ORIGINS: "https://a.example, https://b.example:8443/path, not a url",
    });
    expect([...origins].sort()).toEqual(["https://a.example", "https://b.example:8443"]);
  });

  it("development also accepts the Replit preview domains", () => {
    const origins = buildAllowedOrigins({ NODE_ENV: "development", REPLIT_DOMAINS: "x.replit.dev" });
    expect(origins.has("https://x.replit.dev")).toBe(true);
  });
});
