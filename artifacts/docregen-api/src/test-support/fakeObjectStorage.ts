/**
 * Test-only fake of the Replit object-storage sidecar + the subset of the
 * Google Cloud Storage API this server uses. It is never imported by
 * production code: the vitest setup (setupObjectStorage.ts) and the E2E runner
 * start it and point the real ObjectStorageService / @google-cloud/storage
 * client at it through OBJECT_STORAGE_SIDECAR_ENDPOINT and
 * OBJECT_STORAGE_API_ENDPOINT (both ignored when NODE_ENV=production).
 *
 * Implemented (and nothing else):
 *   Sidecar
 *     GET  /credential                         subject token (external_account)
 *     POST /token                              STS token exchange -> Bearer token
 *     POST /object-storage/signed-object-url   HMAC-signed V4-like URL
 *   Signed URLs (browser/test uploads and downloads, no Bearer token)
 *     PUT  /<bucket>/<object>?X-Goog-...       honours the signed ifGenerationMatch
 *     GET  /<bucket>/<object>?X-Goog-...
 *   JSON API (requires the Bearer token issued by /token)
 *     GET    /storage/v1/b/:b/o/:o             metadata (?alt=media -> bytes)
 *     GET    /download/storage/v1/b/:b/o/:o    bytes
 *     PATCH  /storage/v1/b/:b/o/:o             merge custom metadata
 *     DELETE /storage/v1/b/:b/o/:o             ?ifGenerationMatch
 *     POST   /upload/storage/v1/b/:b/o         uploadType=multipart|media
 *
 * This proves the application's storage flow (signing, direct upload, metadata
 * validation, ACL metadata, download, deletion). It does not prove the Replit
 * production bucket/sidecar configuration.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeObject {
  bucket: string;
  name: string;
  data: Buffer;
  contentType: string;
  generation: string;
  metageneration: string;
  metadata: Record<string, string>;
  updated: string;
}

export interface FakeObjectStorage {
  /** Base URL, used for both the sidecar and the storage API endpoints. */
  url: string;
  objects: Map<string, FakeObject>;
  /** Number of signed-URL requests served (useful for assertions). */
  signedUrlCount: () => number;
  close: () => Promise<void>;
}

const SUBJECT_TOKEN = "fake-replit-subject-token";

function key(bucket: string, name: string): string {
  return `${bucket}/${name}`;
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": payload.length });
  res.end(payload);
}

function gcsError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: { code: status, message, errors: [{ message, reason: "fake" }] } });
}

function resource(obj: FakeObject): Record<string, unknown> {
  return {
    kind: "storage#object",
    id: `${obj.bucket}/${obj.name}/${obj.generation}`,
    bucket: obj.bucket,
    name: obj.name,
    size: String(obj.data.length),
    contentType: obj.contentType,
    generation: obj.generation,
    metageneration: obj.metageneration,
    md5Hash: createHash("md5").update(obj.data).digest("base64"),
    updated: obj.updated,
    timeCreated: obj.updated,
    metadata: { ...obj.metadata },
  };
}

function sendMedia(res: ServerResponse, obj: FakeObject): void {
  res.writeHead(200, {
    "Content-Type": obj.contentType,
    "Content-Length": obj.data.length,
    "x-goog-generation": obj.generation,
    "x-goog-hash": `md5=${createHash("md5").update(obj.data).digest("base64")}`,
    "x-goog-stored-content-length": String(obj.data.length),
  });
  res.end(obj.data);
}

function parseMultipartRelated(body: Buffer, contentType: string): { meta: Record<string, unknown>; data: Buffer; mediaType: string } | null {
  const match = /boundary="?([^";]+)"?/i.exec(contentType);
  if (!match) return null;
  const delimiter = Buffer.from(`--${match[1]}`);
  const parts: Buffer[] = [];
  let start = body.indexOf(delimiter);
  while (start !== -1) {
    const next = body.indexOf(delimiter, start + delimiter.length);
    if (next === -1) break;
    parts.push(body.subarray(start + delimiter.length, next));
    start = next;
  }
  const parsed = parts.map((part) => {
    const text = part.subarray(0, Math.min(part.length, 2048)).toString("latin1");
    const headerEnd = text.indexOf("\r\n\r\n");
    const headers = text.slice(0, headerEnd);
    let content = part.subarray(headerEnd + 4);
    if (content.subarray(-2).toString("latin1") === "\r\n") content = content.subarray(0, -2);
    const type = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim() ?? "application/octet-stream";
    return { type, content };
  });
  if (parsed.length < 2) return null;
  return {
    meta: JSON.parse(parsed[0].content.toString("utf8")) as Record<string, unknown>,
    data: parsed[1].content,
    mediaType: parsed[1].type,
  };
}

export async function startFakeObjectStorage(options: { port?: number; host?: string } = {}): Promise<FakeObjectStorage> {
  const host = options.host ?? "127.0.0.1";
  const signingSecret = randomBytes(32);
  const accessTokens = new Set<string>();
  const objects = new Map<string, FakeObject>();
  let generationCounter = Date.now() * 1000;
  let signedUrls = 0;
  let baseUrl = "";

  function sign(method: string, bucket: string, name: string, expires: string, ifGen: string): string {
    return createHmac("sha256", signingSecret)
      .update([method, bucket, name, expires, ifGen].join("\n"))
      .digest("hex");
  }

  function store(bucket: string, name: string, data: Buffer, contentType: string, metadata: Record<string, string> = {}): FakeObject {
    generationCounter += 1;
    const obj: FakeObject = {
      bucket,
      name,
      data,
      contentType: contentType || "application/octet-stream",
      generation: String(generationCounter),
      metageneration: "1",
      metadata,
      updated: new Date().toISOString(),
    };
    objects.set(key(bucket, name), obj);
    return obj;
  }

  function authorized(req: IncomingMessage): boolean {
    const header = req.headers.authorization ?? "";
    return header.startsWith("Bearer ") && accessTokens.has(header.slice(7));
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", baseUrl);
    const method = req.method ?? "GET";
    const path = url.pathname;

    // Browser uploads are cross-origin (frontend origin -> storage origin).
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, PUT, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-goog-if-generation-match");
    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // ── Sidecar ────────────────────────────────────────────────────────────
    if (method === "GET" && path === "/credential") {
      sendJson(res, 200, { access_token: SUBJECT_TOKEN });
      return;
    }
    if (method === "POST" && path === "/token") {
      const form = new URLSearchParams((await readBody(req)).toString("utf8"));
      if (form.get("subject_token") !== SUBJECT_TOKEN) {
        sendJson(res, 400, { error: "invalid_grant" });
        return;
      }
      const token = `fake-gcs-${randomBytes(16).toString("hex")}`;
      accessTokens.add(token);
      sendJson(res, 200, {
        access_token: token,
        issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
        token_type: "Bearer",
        expires_in: 3600,
      });
      return;
    }
    if (method === "POST" && path === "/object-storage/signed-object-url") {
      const body = JSON.parse((await readBody(req)).toString("utf8")) as {
        bucket_name?: string;
        object_name?: string;
        method?: string;
        expires_at?: string;
        if_generation_match?: string;
      };
      if (!body.bucket_name || !body.object_name || !body.method || !body.expires_at) {
        sendJson(res, 400, { error: "missing fields" });
        return;
      }
      signedUrls += 1;
      const expires = String(Date.parse(body.expires_at));
      const ifGen = body.if_generation_match ?? "";
      const signed = new URL(`${baseUrl}/${body.bucket_name}/${body.object_name}`);
      signed.searchParams.set("X-Goog-Method", body.method);
      signed.searchParams.set("X-Goog-Expires", expires);
      if (ifGen) signed.searchParams.set("x-goog-if-generation-match", ifGen);
      signed.searchParams.set("X-Goog-Signature", sign(body.method, body.bucket_name, body.object_name, expires, ifGen));
      sendJson(res, 200, { signed_url: signed.toString() });
      return;
    }

    // ── JSON API ───────────────────────────────────────────────────────────
    const jsonObject = /^\/(?:download\/)?storage\/v1\/b\/([^/]+)\/o\/(.+)$/.exec(path);
    const uploadObject = /^\/upload\/storage\/v1\/b\/([^/]+)\/o$/.exec(path);
    if (jsonObject || uploadObject) {
      if (!authorized(req)) {
        gcsError(res, 401, "Missing or invalid Bearer token");
        return;
      }
    }
    if (uploadObject) {
      const bucket = decodeURIComponent(uploadObject[1]);
      const body = await readBody(req);
      const uploadType = url.searchParams.get("uploadType");
      let name = url.searchParams.get("name") ?? "";
      let data = body;
      let contentType = req.headers["content-type"] ?? "application/octet-stream";
      let metadata: Record<string, string> = {};
      if (uploadType === "multipart") {
        const parsed = parseMultipartRelated(body, contentType);
        if (!parsed) {
          gcsError(res, 400, "Invalid multipart body");
          return;
        }
        name = (parsed.meta["name"] as string | undefined) ?? name;
        contentType = (parsed.meta["contentType"] as string | undefined) ?? parsed.mediaType;
        metadata = (parsed.meta["metadata"] as Record<string, string> | undefined) ?? {};
        data = parsed.data;
      }
      if (!name) {
        gcsError(res, 400, "Missing object name");
        return;
      }
      const ifGen = url.searchParams.get("ifGenerationMatch");
      const existing = objects.get(key(bucket, name));
      if (ifGen !== null && (existing?.generation ?? "0") !== ifGen) {
        gcsError(res, 412, "Precondition Failed");
        return;
      }
      sendJson(res, 200, resource(store(bucket, name, data, contentType, metadata)));
      return;
    }
    if (jsonObject) {
      const bucket = decodeURIComponent(jsonObject[1]);
      const name = decodeURIComponent(jsonObject[2]);
      const obj = objects.get(key(bucket, name));
      if (!obj) {
        gcsError(res, 404, `No such object: ${bucket}/${name}`);
        return;
      }
      const ifGen = url.searchParams.get("ifGenerationMatch");
      if (ifGen !== null && ifGen !== obj.generation) {
        gcsError(res, 412, "Precondition Failed");
        return;
      }
      if (method === "GET" || method === "HEAD") {
        if (url.searchParams.get("alt") === "media" || path.startsWith("/download/")) {
          sendMedia(res, obj);
        } else {
          sendJson(res, 200, resource(obj));
        }
        return;
      }
      if (method === "PATCH") {
        const patch = JSON.parse((await readBody(req)).toString("utf8") || "{}") as {
          contentType?: string;
          metadata?: Record<string, string | null> | null;
        };
        if (patch.contentType) obj.contentType = patch.contentType;
        if (patch.metadata === null) obj.metadata = {};
        else if (patch.metadata) {
          for (const [k, v] of Object.entries(patch.metadata)) {
            if (v === null) delete obj.metadata[k];
            else obj.metadata[k] = String(v);
          }
        }
        obj.metageneration = String(Number(obj.metageneration) + 1);
        obj.updated = new Date().toISOString();
        sendJson(res, 200, resource(obj));
        return;
      }
      if (method === "DELETE") {
        objects.delete(key(bucket, name));
        res.writeHead(204);
        res.end();
        return;
      }
      gcsError(res, 405, "Method not allowed");
      return;
    }

    // ── Signed URLs ────────────────────────────────────────────────────────
    const signedMatch = /^\/([^/]+)\/(.+)$/.exec(path);
    if (signedMatch && url.searchParams.has("X-Goog-Signature")) {
      const bucket = decodeURIComponent(signedMatch[1]);
      const name = decodeURIComponent(signedMatch[2]);
      const signedMethod = url.searchParams.get("X-Goog-Method") ?? "";
      const expires = url.searchParams.get("X-Goog-Expires") ?? "";
      const ifGen = url.searchParams.get("x-goog-if-generation-match") ?? "";
      const expected = Buffer.from(sign(signedMethod, bucket, name, expires, ifGen));
      const given = Buffer.from(url.searchParams.get("X-Goog-Signature") ?? "");
      const effectiveMethod = method === "HEAD" ? "GET" : method;
      if (
        expected.length !== given.length ||
        !timingSafeEqual(expected, given) ||
        signedMethod !== effectiveMethod
      ) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("SignatureDoesNotMatch");
        return;
      }
      if (Number(expires) < Date.now()) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("ExpiredToken");
        return;
      }
      const existing = objects.get(key(bucket, name));
      if (method === "PUT") {
        if (ifGen && (existing?.generation ?? "0") !== ifGen) {
          res.writeHead(412, { "Content-Type": "text/plain" });
          res.end("PreconditionFailed");
          return;
        }
        const data = await readBody(req);
        const obj = store(bucket, name, data, req.headers["content-type"] ?? "application/octet-stream");
        res.writeHead(200, { ETag: `"${createHash("md5").update(data).digest("hex")}"`, "x-goog-generation": obj.generation });
        res.end();
        return;
      }
      if (method === "GET" || method === "HEAD") {
        if (!existing) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("NoSuchKey");
          return;
        }
        sendMedia(res, existing);
        return;
      }
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("fake object storage: unknown route");
  }

  const server: Server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      if (!res.headersSent) gcsError(res, 500, String(error));
      else res.destroy();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, host, () => resolve());
  });
  baseUrl = `http://${host}:${(server.address() as AddressInfo).port}`;

  return {
    url: baseUrl,
    objects,
    signedUrlCount: () => signedUrls,
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}
