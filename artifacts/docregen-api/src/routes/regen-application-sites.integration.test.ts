import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { inflateSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  db,
  doctorsTable,
  pool,
  regenCasesTable,
  regenTermsAcceptanceTable,
} from "@workspace/docregen-db";
import app from "../app";
import { hashPassword, signToken } from "../lib/auth";

let server: Server;
let baseUrl: string;
let doctorId: number;
let auth: string;

async function apiRequest(path: string, method: string, body?: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${auth}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function extractPdfText(pdf: Buffer): string {
  const latin = pdf.toString("latin1");
  const text: string[] = [];
  const decodeStream = (stream: Buffer): string => {
    const source = stream.toString("latin1");
    const hexText = [...source.matchAll(/<([0-9a-fA-F]+)>/g)]
      .map(match => Buffer.from(match[1], "hex").toString("latin1"))
      .join("");
    return `${source}\n${hexText}`;
  };
  const streamPattern = /stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = streamPattern.exec(latin)) !== null) {
    const start = match.index + match[0].length;
    const end = latin.indexOf("endstream", start);
    if (end < 0) break;
    const stream = pdf.subarray(start, end);
    try {
      text.push(decodeStream(inflateSync(stream)));
    } catch {
      text.push(decodeStream(stream));
    }
    streamPattern.lastIndex = end + "endstream".length;
  }
  return text.join("\n");
}

const firstSite = { localAplicacao: "Intra-articular", guia: "Ultrassom" };
const secondSite = { localAplicacao: "Ligamento", guia: "Referência anatômica (às cegas)" };

beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const suffix = randomUUID();
  const [doctor] = await db
    .insert(doctorsTable)
    .values({
      nome: "Regen Application Sites Integration Doctor",
      email: `regen-application-sites-${suffix}@example.test`,
      senhaHash: await hashPassword("regen-application-sites-password"),
      isFree: true,
    })
    .returning();
  doctorId = doctor.id;
  auth = signToken({
    doctorId,
    isAdmin: false,
    sessionVersion: doctor.sessionVersion,
  });

  await db.insert(regenTermsAcceptanceTable).values({
    doctorId,
    termsVersion: "terms_regen_v1",
    dpaVersion: "dpa_regen_v1",
  });
});

afterAll(async () => {
  if (doctorId) {
    await db.delete(regenCasesTable).where(eq(regenCasesTable.doctorId, doctorId));
    await db
      .delete(regenTermsAcceptanceTable)
      .where(eq(regenTermsAcceptanceTable.doctorId, doctorId));
    await db.delete(doctorsTable).where(eq(doctorsTable.id, doctorId));
  }
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

describe.sequential("regenerative application sites API persistence", () => {
  it("persists POST values, synchronizes legacy fields, and PATCHes all rows", async () => {
    const createResponse = await apiRequest("/regen-api/regen/cases", "POST", {
      patientName: "Application Sites Integration Patient",
      conditionCode: "OA_OMBRO",
      plannedProducts: ["PRP"],
      productDetails: {
        locaisAplicacao: JSON.stringify([firstSite]),
        localAplicacao: "stale legacy location",
        guia: "stale legacy guide",
        observacoes: "POST notes",
        futureTechnicalField: "preserve me",
      },
    });
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json() as {
      id: string;
      product_details: Record<string, string>;
    };
    expect(created.product_details).toMatchObject({
      localAplicacao: firstSite.localAplicacao,
      guia: firstSite.guia,
      observacoes: "POST notes",
      futureTechnicalField: "preserve me",
    });
    expect(JSON.parse(created.product_details.locaisAplicacao)).toEqual([firstSite]);

    const patchResponse = await apiRequest(`/regen-api/regen/cases/${created.id}`, "PATCH", {
      productDetails: {
        locaisAplicacao: JSON.stringify([firstSite, secondSite]),
        localAplicacao: "legacy value replaced by first row",
        guia: "legacy value replaced by first row",
        observacoes: "PATCH notes",
        futureTechnicalField: "preserve after patch",
      },
    });
    expect(patchResponse.status).toBe(200);
    const patched = await patchResponse.json() as {
      product_details: Record<string, string>;
    };
    expect(JSON.parse(patched.product_details.locaisAplicacao)).toEqual([firstSite, secondSite]);
    expect(patched.product_details).toMatchObject({
      localAplicacao: firstSite.localAplicacao,
      guia: firstSite.guia,
      observacoes: "PATCH notes",
      futureTechnicalField: "preserve after patch",
    });

    const getResponse = await apiRequest(`/regen-api/regen/cases/${created.id}`, "GET");
    expect(getResponse.status).toBe(200);
    const reopened = await getResponse.json() as {
      product_details: Record<string, string>;
    };
    expect(JSON.parse(reopened.product_details.locaisAplicacao)).toEqual([firstSite, secondSite]);
    expect(reopened.product_details.observacoes).toBe("PATCH notes");

    const [stored] = await db
      .select({ productDetails: regenCasesTable.productDetails })
      .from(regenCasesTable)
      .where(eq(regenCasesTable.id, created.id));
    expect(stored.productDetails).toEqual(reopened.product_details);

    for (const reportPath of ["report", "clinical-report"]) {
      const reportResponse = await apiRequest(`/regen-api/regen/cases/${created.id}/${reportPath}`, "GET");
      expect(reportResponse.status).toBe(200);
      expect(reportResponse.headers.get("content-type")).toContain("application/pdf");
      const reportText = extractPdfText(Buffer.from(await reportResponse.arrayBuffer()));
      expect(reportText).toContain(firstSite.localAplicacao);
      expect(reportText).toContain(secondSite.localAplicacao);
      expect(reportText).toContain("PATCH notes");
    }

    await db.update(doctorsTable).set({ idioma: "es" }).where(eq(doctorsTable.id, doctorId));
    for (const reportPath of ["report", "clinical-report"]) {
      const reportResponse = await apiRequest(`/regen-api/regen/cases/${created.id}/${reportPath}`, "GET");
      expect(reportResponse.status).toBe(200);
      const reportText = extractPdfText(Buffer.from(await reportResponse.arrayBuffer()));
      expect(reportText).toContain("Intraarticular");
      expect(reportText).toContain("Ligamento");
      expect(reportText).toContain("PATCH notes");
    }

    const clearResponse = await apiRequest(`/regen-api/regen/cases/${created.id}`, "PATCH", {
      productDetails: {
        locaisAplicacao: JSON.stringify([]),
        localAplicacao: "",
        guia: "",
        observacoes: "Notes survive removal",
      },
    });
    expect(clearResponse.status).toBe(200);
    const cleared = await clearResponse.json() as {
      product_details: Record<string, string>;
    };
    expect(JSON.parse(cleared.product_details.locaisAplicacao)).toEqual([]);
    expect(cleared.product_details.localAplicacao).toBe("");
    expect(cleared.product_details.guia).toBe("");
    expect(cleared.product_details.observacoes).toBe("Notes survive removal");
  });

  it("rejects a malformed repeatable extension on both create and patch", async () => {
    const malformed = { locaisAplicacao: JSON.stringify([{ localAplicacao: "Ligamento" }]) };
    const createResponse = await apiRequest("/regen-api/regen/cases", "POST", {
      patientName: "Malformed Application Sites Patient",
      conditionCode: "OA_OMBRO",
      productDetails: malformed,
    });
    expect(createResponse.status).toBe(400);

    const createValidResponse = await apiRequest("/regen-api/regen/cases", "POST", {
      patientName: "Patch Validation Patient",
      conditionCode: "OA_OMBRO",
      productDetails: { locaisAplicacao: JSON.stringify([firstSite]) },
    });
    expect(createValidResponse.status).toBe(201);
    const created = await createValidResponse.json() as { id: string };
    const patchResponse = await apiRequest(`/regen-api/regen/cases/${created.id}`, "PATCH", {
      productDetails: malformed,
    });
    expect(patchResponse.status).toBe(400);
  });
});
