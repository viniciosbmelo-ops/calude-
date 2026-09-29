/**
 * DocRegen is independent from DocKnee: it must refuse to start without its
 * OWN database (DOCREGEN_DATABASE_URL) and session secret, and it must never
 * fall back to — or share — DocKnee's DATABASE_URL / SESSION_SECRET.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveDocregenDatabaseUrl } from "@workspace/docregen-db/config";
import { findSecretProblems } from "./validate-secrets";

const OWN_DB = "postgres://docregen@db.example:5432/docregen";
const DOCKNEE_DB = "postgres://docknee@db.example:5432/docknee";
const OWN_SECRET = "docregen-secret-with-at-least-32-characters";
const DOCKNEE_SECRET = "docknee-secret-with-at-least-32-characters";

describe("resolveDocregenDatabaseUrl", () => {
  it("returns DOCREGEN_DATABASE_URL when it is set", () => {
    expect(resolveDocregenDatabaseUrl({ DOCREGEN_DATABASE_URL: OWN_DB, DATABASE_URL: DOCKNEE_DB })).toBe(OWN_DB);
  });

  it("never falls back to DocKnee's DATABASE_URL", () => {
    expect(() => resolveDocregenDatabaseUrl({ DATABASE_URL: DOCKNEE_DB })).toThrow(
      /DOCREGEN_DATABASE_URL must be set.*never falls back to DATABASE_URL/,
    );
    expect(() => resolveDocregenDatabaseUrl({ DOCREGEN_DATABASE_URL: "   ", DATABASE_URL: DOCKNEE_DB })).toThrow(
      /DOCREGEN_DATABASE_URL must be set/,
    );
  });

  it("refuses to point at DocKnee's database, even when spelled differently", () => {
    for (const same of [
      DOCKNEE_DB,
      "postgres://other-user:pw@DB.EXAMPLE/docknee?sslmode=require",
    ]) {
      expect(() => resolveDocregenDatabaseUrl({ DOCREGEN_DATABASE_URL: same, DATABASE_URL: DOCKNEE_DB })).toThrow(
        /same database as DATABASE_URL/,
      );
    }
  });
});

describe("findSecretProblems", () => {
  it("accepts DocRegen's own database and session secret", () => {
    expect(findSecretProblems({
      DOCREGEN_DATABASE_URL: OWN_DB,
      DOCREGEN_SESSION_SECRET: OWN_SECRET,
      DATABASE_URL: DOCKNEE_DB,
      SESSION_SECRET: DOCKNEE_SECRET,
    })).toEqual([]);
  });

  it("reports a missing DOCREGEN_DATABASE_URL even when DocKnee's variables exist", () => {
    const problems = findSecretProblems({
      DOCREGEN_SESSION_SECRET: OWN_SECRET,
      DATABASE_URL: DOCKNEE_DB,
      SESSION_SECRET: DOCKNEE_SECRET,
    });
    expect(problems.some((p) => p.startsWith("DOCREGEN_DATABASE_URL"))).toBe(true);
  });

  it("reports a missing or short DOCREGEN_SESSION_SECRET", () => {
    expect(findSecretProblems({ DOCREGEN_DATABASE_URL: OWN_DB, SESSION_SECRET: DOCKNEE_SECRET })
      .some((p) => p.startsWith("DOCREGEN_SESSION_SECRET"))).toBe(true);
    expect(findSecretProblems({ DOCREGEN_DATABASE_URL: OWN_DB, DOCREGEN_SESSION_SECRET: "short" })
      .some((p) => p.includes("32"))).toBe(true);
  });

  it("rejects values shared with DocKnee", () => {
    const problems = findSecretProblems({
      DOCREGEN_DATABASE_URL: DOCKNEE_DB,
      DATABASE_URL: DOCKNEE_DB,
      DOCREGEN_SESSION_SECRET: DOCKNEE_SECRET,
      SESSION_SECRET: DOCKNEE_SECRET,
      DOCREGEN_PRIVATE_OBJECT_DIR: "/bucket/private",
      PRIVATE_OBJECT_DIR: "/bucket/private",
    });
    expect(problems).toHaveLength(3);
    expect(problems.join("\n")).toMatch(/DOCREGEN_DATABASE_URL.*DATABASE_URL/);
    expect(problems.join("\n")).toMatch(/DOCREGEN_SESSION_SECRET.*SESSION_SECRET/);
    expect(problems.join("\n")).toMatch(/DOCREGEN_PRIVATE_OBJECT_DIR.*PRIVATE_OBJECT_DIR/);
  });
});

describe("server entry point", () => {
  const artifactDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");

  function startServer(env: Record<string, string>) {
    const baseEnv: Record<string, string> = {
      PATH: process.env["PATH"] ?? "",
      NODE_ENV: "test",
      PORT: "0",
      LOG_LEVEL: "error",
    };
    return spawnSync(process.execPath, [tsxCli, "src/index.ts"], {
      cwd: artifactDir,
      env: { ...baseEnv, ...env },
      encoding: "utf8",
      timeout: 60_000,
    });
  }

  it("refuses to start with only DocKnee's DATABASE_URL (no fallback)", () => {
    const result = startServer({
      DATABASE_URL: DOCKNEE_DB,
      SESSION_SECRET: DOCKNEE_SECRET,
      DOCREGEN_SESSION_SECRET: OWN_SECRET,
    });
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain("DOCREGEN_DATABASE_URL");
  }, 70_000);

  it("refuses to start when DOCREGEN_DATABASE_URL points at DocKnee's database", () => {
    const result = startServer({
      DATABASE_URL: DOCKNEE_DB,
      DOCREGEN_DATABASE_URL: DOCKNEE_DB,
      DOCREGEN_SESSION_SECRET: OWN_SECRET,
    });
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toMatch(/DOCREGEN_DATABASE_URL[^\n]*DATABASE_URL/);
  }, 70_000);
});
