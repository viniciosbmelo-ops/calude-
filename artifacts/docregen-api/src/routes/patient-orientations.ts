import { createHmac, randomBytes } from "node:crypto";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { db, doctorsTable } from "@workspace/docregen-db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { localeForDoctorId, resolveDoctorLocale } from "../lib/locale";
import { message } from "../lib/locale-catalog";
import { buildAppLink } from "../lib/app-links";

const router: IRouter = Router();

// These keys are the public protocol identifiers implemented by the patient UI.
// Do not infer a key from any patient or procedure data supplied by a browser.
export const PATIENT_ORIENTATION_PROC_KEYS = [
  "prp_articular",
  "prp_tendineo",
  "prp_ligamentar",
  "prp_muscular",
  "ctm_osso",
  "fatores_crescimento",
] as const;

type ProcedureKey = typeof PATIENT_ORIENTATION_PROC_KEYS[number];
type OrientationTab = "pre" | "pos";

const ORIENTATION_ISSUER = "docregen-api";
const ORIENTATION_AUDIENCE = "docregen-patient";
const ORIENTATION_TYPE = "patient-orientation";
const ORIENTATION_VERSION = 1;
const ORIENTATION_TTL = "7d";
const ALLOWED_PAYLOAD_KEYS = new Set([
  "doctorId", "procKey", "tab", "typ", "version",
  "iss", "aud", "iat", "exp", "jti",
]);
const ALLOWED_HEADER_KEYS = new Set(["alg", "typ"]);

const MintBodySchema = z.object({
  procKey: z.enum(PATIENT_ORIENTATION_PROC_KEYS),
}).strict();

function orientationSigningKey(): Buffer {
  const sessionSecret = process.env["DOCREGEN_SESSION_SECRET"];
  if (!sessionSecret) throw new Error("DOCREGEN_SESSION_SECRET is required");
  // Deriving a separate key prevents this bearer link from being accepted as a
  // normal authenticated-session token, even when algorithms/settings drift.
  return createHmac("sha256", sessionSecret)
    .update("docregen:patient-orientation:v1", "utf8")
    .digest();
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isProcedureKey(value: unknown): value is ProcedureKey {
  return typeof value === "string" &&
    (PATIENT_ORIENTATION_PROC_KEYS as readonly string[]).includes(value);
}

function isOrientationPayload(payload: unknown): payload is JwtPayload & {
  doctorId: number;
  procKey: ProcedureKey;
  tab: OrientationTab;
} {
  if (!payload || typeof payload !== "object") return false;
  const claims = payload as Record<string, unknown>;
  if (Object.keys(claims).some((key) => !ALLOWED_PAYLOAD_KEYS.has(key))) return false;
  return isPositiveInteger(claims.doctorId) &&
    isProcedureKey(claims.procKey) &&
    (claims.tab === "pre" || claims.tab === "pos") &&
    claims.typ === ORIENTATION_TYPE &&
    claims.version === ORIENTATION_VERSION &&
    typeof claims.iss === "string" &&
    typeof claims.aud === "string" &&
    typeof claims.iat === "number" &&
    typeof claims.exp === "number" &&
    claims.exp > claims.iat &&
    typeof claims.jti === "string" &&
    /^[A-Za-z0-9_-]{22}$/.test(claims.jti);
}

function signOrientationToken(doctorId: number, procKey: ProcedureKey, tab: OrientationTab): string {
  return jwt.sign(
    { doctorId, procKey, tab, typ: ORIENTATION_TYPE, version: ORIENTATION_VERSION },
    orientationSigningKey(),
    {
      algorithm: "HS256",
      issuer: ORIENTATION_ISSUER,
      audience: ORIENTATION_AUDIENCE,
      expiresIn: ORIENTATION_TTL,
      jwtid: randomBytes(16).toString("base64url"),
      header: { alg: "HS256", typ: ORIENTATION_TYPE },
    },
  );
}

function verifyOrientationToken(token: string): (JwtPayload & {
  doctorId: number; procKey: ProcedureKey; tab: OrientationTab;
}) | null {
  try {
    const verified = jwt.verify(token, orientationSigningKey(), {
      algorithms: ["HS256"],
      issuer: ORIENTATION_ISSUER,
      audience: ORIENTATION_AUDIENCE,
      complete: true,
    });
    if (
      typeof verified !== "object" ||
      !("header" in verified) ||
      verified.header.alg !== "HS256" ||
      verified.header.typ !== ORIENTATION_TYPE ||
      Object.keys(verified.header).some((key) => !ALLOWED_HEADER_KEYS.has(key)) ||
      !isOrientationPayload(verified.payload)
    ) return null;
    return verified.payload;
  } catch {
    return null;
  }
}

function patientUrl(baseUrl: string, token: string): string {
  return buildAppLink(baseUrl, `/orientacoes-paciente?token=${encodeURIComponent(token)}`);
}

function getCanonicalPatientBaseUrl(): string {
  const raw = process.env.DOCREGEN_APP_URL;
  if (!raw || raw !== raw.trim()) {
    throw new Error("DOCREGEN_APP_URL is required for patient orientation links");
  }
  const parsed = new URL(raw);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("DOCREGEN_APP_URL must be a canonical HTTPS URL");
  }
  return parsed.origin;
}

router.post("/patient-orientations/token", requireAuth, async (req, res): Promise<void> => {
  const parsed = MintBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: message(await localeForDoctorId(req.doctorId), "invalidProcedure") });
    return;
  }

  try {
    const baseUrl = getCanonicalPatientBaseUrl();
    const preToken = signOrientationToken(req.doctorId!, parsed.data.procKey, "pre");
    const posToken = signOrientationToken(req.doctorId!, parsed.data.procKey, "pos");
    res.setHeader("Cache-Control", "no-store");
    res.status(201).json({
      preUrl: patientUrl(baseUrl, preToken),
      posUrl: patientUrl(baseUrl, posToken),
    });
  } catch {
    res.status(503).json({ error: message(await localeForDoctorId(req.doctorId), "orientationsGenerationFailed") });
  }
});

router.get("/patient-orientations/:token", async (req, res): Promise<void> => {
  const rawToken = Array.isArray(req.params.token) ? req.params.token[0] : req.params.token;
  const payload = typeof rawToken === "string" && rawToken.length <= 4096
    ? verifyOrientationToken(rawToken)
    : null;
  if (!payload) {
    res.status(404).json({ error: "Este link é inválido ou expirou." });
    return;
  }

  const [doctor] = await db
    .select({ idioma: doctorsTable.idioma })
    .from(doctorsTable)
    .where(eq(doctorsTable.id, payload.doctorId))
    .limit(1);
  if (!doctor) {
    res.status(404).json({ error: "Este link é inválido ou expirou." });
    return;
  }

  res.setHeader("Cache-Control", "no-store");
  res.json({
    procKey: payload.procKey,
    tab: payload.tab,
    doctorLocale: resolveDoctorLocale(doctor.idioma),
  });
});

export { signOrientationToken, verifyOrientationToken };
export default router;