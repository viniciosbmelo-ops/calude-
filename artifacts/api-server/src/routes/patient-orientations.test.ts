import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createHmac, randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, doctorsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import app, { privacySafeRequestPath } from "../app";
import { signToken } from "../lib/auth";
import { privacySafeAuditPath } from "../middlewares/auditLog";
import {
  signOrientationToken,
  verifyOrientationToken,
} from "./patient-orientations";

let server: Server;
let baseUrl: string;
let doctorId: number;
let authorization: string;
const originalAppUrl = process.env["APP_URL"];
const originalReplitDomains = process.env["REPLIT_DOMAINS"];

function orientationKey(): Buffer {
  return createHmac("sha256", process.env["SESSION_SECRET"]!)
    .update("docknee:patient-orientation:v1", "utf8")
    .digest();
}

function maliciousToken(
  payload: Record<string, unknown>,
  header: jwt.SignOptions["header"] = { alg: "HS256", typ: "patient-orientation" },
): string {
  return jwt.sign(payload, orientationKey(), {
    algorithm: "HS256",
    issuer: "docknee-api",
    audience: "docknee-patient",
    expiresIn: "7d",
    jwtid: "1234567890123456789012",
    header,
  });
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, init);
}

beforeAll(async () => {
  process.env["APP_URL"] = "https://patient.example";
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) => error ? reject(error) : resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const [doctor] = await db.insert(doctorsTable).values({
    nome: "Patient Orientation Test Doctor",
    email: `patient-orientation-${randomUUID()}@example.test`,
    senhaHash: "not-used-by-this-test",
    idioma: "es",
    isFree: true,
  }).returning();
  doctorId = doctor.id;
  authorization = `Bearer ${signToken({ doctorId, isAdmin: false })}`;
});

afterAll(async () => {
  await db.delete(doctorsTable).where(eq(doctorsTable.id, doctorId));
  if (originalAppUrl === undefined) delete process.env["APP_URL"];
  else process.env["APP_URL"] = originalAppUrl;
  if (originalReplitDomains === undefined) delete process.env["REPLIT_DOMAINS"];
  else process.env["REPLIT_DOMAINS"] = originalReplitDomains;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

describe("patient orientation bearer links", () => {
  it("rejects unauthenticated and non-contract mint requests", async () => {
    const unauthenticated = await request("/api/patient-orientations/token", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ procKey: "prp_articular" }),
    });
    expect(unauthenticated.status).toBe(401);

    const invalid = await request("/api/patient-orientations/token", {
      method: "POST",
      headers: { Authorization: authorization, "Content-Type": "application/json" },
      body: JSON.stringify({ procKey: "prp_articular", locale: "es", patientName: "PHI" }),
    });
    expect(invalid.status).toBe(400);
  });

  it("mints distinct doctor-bound pre/post links on the canonical authority", async () => {
    const response = await request("/api/patient-orientations/token", {
      method: "POST",
      headers: {
        Authorization: authorization, "Content-Type": "application/json",
        Host: "attacker.example", "X-Forwarded-Host": "attacker.example",
      },
      body: JSON.stringify({ procKey: "prp_articular" }),
    });
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json() as { preUrl: string; posUrl: string };
    expect(new URL(body.preUrl).origin).toBe("https://patient.example");
    expect(new URL(body.posUrl).origin).toBe("https://patient.example");

    const pre = verifyOrientationToken(new URL(body.preUrl).searchParams.get("token")!);
    const pos = verifyOrientationToken(new URL(body.posUrl).searchParams.get("token")!);
    expect(pre).toMatchObject({ doctorId, procKey: "prp_articular", tab: "pre", typ: "patient-orientation", version: 1 });
    expect(pos).toMatchObject({ doctorId, procKey: "prp_articular", tab: "pos", typ: "patient-orientation", version: 1 });
    expect(pre?.jti).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(pre?.jti).not.toBe(pos?.jti);
  });

  it("fails closed without a valid HTTPS APP_URL and never falls back to request or Replit hosts", async () => {
    const savedAppUrl = process.env["APP_URL"];
    const savedDomains = process.env["REPLIT_DOMAINS"];
    process.env["REPLIT_DOMAINS"] = "replit-fallback.example";
    try {
      for (const appUrl of [
        undefined,
        "http://not-secure.example",
        "not a URL",
        " https://patient.example ",
        "https://patient.example/path",
        "https://patient.example:8443",
      ]) {
        if (appUrl === undefined) delete process.env["APP_URL"];
        else process.env["APP_URL"] = appUrl;
        const response = await request("/api/patient-orientations/token", {
          method: "POST",
          headers: {
            Authorization: authorization,
            "Content-Type": "application/json",
            Host: "attacker.example",
            "X-Forwarded-Host": "attacker.example",
          },
          body: JSON.stringify({ procKey: "prp_articular" }),
        });
        expect(response.status).toBe(503);
        const body = await response.json() as Record<string, unknown>;
        expect(body).not.toHaveProperty("preUrl");
        expect(body).not.toHaveProperty("posUrl");
        expect(JSON.stringify(body)).not.toContain("attacker.example");
        expect(JSON.stringify(body)).not.toContain("replit-fallback.example");
      }
    } finally {
      if (savedAppUrl === undefined) delete process.env["APP_URL"];
      else process.env["APP_URL"] = savedAppUrl;
      if (savedDomains === undefined) delete process.env["REPLIT_DOMAINS"];
      else process.env["REPLIT_DOMAINS"] = savedDomains;
    }
  });

  it("uses the doctor's current Spanish setting, then safely falls back to pt-BR", async () => {
    const token = signOrientationToken(doctorId, "ctm_osso", "pos");
    const spanish = await request(`/api/patient-orientations/${token}?locale=pt-BR`);
    expect(spanish.status).toBe(200);
    expect(spanish.headers.get("cache-control")).toBe("no-store");
    await expect(spanish.json()).resolves.toEqual({
      procKey: "ctm_osso", tab: "pos", doctorLocale: "es",
    });

    await db.update(doctorsTable).set({ idioma: "untrusted-language" })
      .where(eq(doctorsTable.id, doctorId));
    const fallback = await request(`/api/patient-orientations/${token}?locale=es`);
    await expect(fallback.json()).resolves.toMatchObject({ doctorLocale: "pt-BR" });
  });

  it("rejects malformed, altered, and invalid signed claims without leaking bearer data", async () => {
    const valid = signOrientationToken(doctorId, "prp_articular", "pre");
    const [head, payload, signature] = valid.split(".");
    const altered = `${head}.${payload}.${signature!.slice(0, -1)}x`;
    const badTokens = [
      "not-a-jwt",
      altered,
      maliciousToken({ doctorId, procKey: "prp_articular", tab: "pre", typ: "wrong", version: 1 }),
      maliciousToken({ doctorId, procKey: "prp_articular", tab: "pre", typ: "patient-orientation", version: 2 }),
      maliciousToken({ doctorId, procKey: "unknown", tab: "pre", typ: "patient-orientation", version: 1 }),
      maliciousToken({ doctorId, procKey: "prp_articular", tab: "unknown", typ: "patient-orientation", version: 1 }),
      maliciousToken({ doctorId, procKey: "prp_articular", tab: "pre", typ: "patient-orientation", version: 1, extra: true }),
      maliciousToken({ doctorId: 999999999, procKey: "prp_articular", tab: "pre", typ: "patient-orientation", version: 1 }),
      jwt.sign({ doctorId, procKey: "prp_articular", tab: "pre", typ: "patient-orientation", version: 1 }, orientationKey(), { algorithm: "HS256", issuer: "wrong", audience: "docknee-patient", expiresIn: "7d", jwtid: "1234567890123456789012" }),
      jwt.sign({ doctorId, procKey: "prp_articular", tab: "pre", typ: "patient-orientation", version: 1 }, orientationKey(), { algorithm: "HS256", issuer: "docknee-api", audience: "wrong", expiresIn: "7d", jwtid: "1234567890123456789012" }),
      jwt.sign({ doctorId, procKey: "prp_articular", tab: "pre", typ: "patient-orientation", version: 1 }, orientationKey(), { algorithm: "HS256", issuer: "docknee-api", audience: "docknee-patient", expiresIn: -1, jwtid: "1234567890123456789012" }),
      maliciousToken({ doctorId, procKey: "prp_articular", tab: "pre", typ: "patient-orientation", version: 1 }, { alg: "HS384", typ: "patient-orientation" }),
      maliciousToken({ doctorId, procKey: "prp_articular", tab: "pre", typ: "patient-orientation", version: 1 }, { alg: "HS256", typ: "wrong" }),
    ];
    for (const token of badTokens) {
      const response = await request(`/api/patient-orientations/${token}`);
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain(token);
    }
  });

  it("does not retain bearer tokens in log-safe paths or responses", () => {
    const rawToken = signOrientationToken(doctorId, "prp_articular", "pre");
    expect(privacySafeRequestPath(`/api/patient-orientations/${rawToken}?x=1`))
      .toBe("/api/patient-orientations/:token");
    expect(privacySafeAuditPath(`/api/patient-orientations/${rawToken}`))
      .toBe("/api/patient-orientations/:token");
  });
});