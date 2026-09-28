/**
 * TOTP 2FA endpoints for admin accounts only.
 *
 * Setup flow (admin only):
 *   POST /auth/totp/setup     — generates secret, returns otpauth URI (requires current password)
 *   POST /auth/totp/confirm   — confirms a valid TOTP code to activate 2FA
 *   POST /auth/totp/disable   — disables 2FA (requires current password)
 *
 * Login challenge flow (preserves existing non-admin login):
 *   POST /auth/login          — if admin with 2FA enabled, returns { requires2FA: true, challengeToken }
 *   POST /auth/totp/challenge — validates TOTP/recovery code, establishes session
 *
 * Rules:
 *   - Secrets are stored AES-256-GCM encrypted, key derived from SESSION_SECRET.
 *   - Recovery codes are bcrypt-hashed; consumed on use.
 *   - Sessions are NOT established until a valid TOTP/recovery code is supplied.
 *   - Secrets/codes are NEVER logged.
 *   - Replay window: ±1 TOTP period (90 s) with in-memory dedup.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { db, doctorsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/requireAuth";
import { comparePassword, signToken } from "../lib/auth";
import { establishSession } from "../lib/session";
import { serializeDoctor } from "../lib/doctorSerializer";
import {
  attachAnalyticsActor,
  emitAnalyticsEvent,
  resolveAnalyticsSessionId,
} from "../lib/analyticsEmitter";
import {
  generateTotpSecret,
  encryptTotpSecret,
  decryptTotpSecret,
  verifyTotpCode,
  buildTotpUri,
  generateRecoveryCodes,
  hashRecoveryCodes,
  findMatchingRecoveryCode,
  consumeRecoveryCode,
} from "../lib/totp";
import jwt from "jsonwebtoken";

const router: IRouter = Router();

async function consumeRecoveryCodeAtomically(
  doctorId: number,
  suppliedCode: string,
  initialHashes: string,
): Promise<boolean> {
  let currentHashes: string | null = initialHashes;

  // A compare-and-swap keeps each code single-use even when two challenge
  // requests validate the same bcrypt hash concurrently. Retrying also lets
  // two different valid recovery codes succeed when used at the same time.
  for (let attempt = 0; attempt < 3 && currentHashes; attempt += 1) {
    const index = await findMatchingRecoveryCode(suppliedCode, currentHashes);
    if (index < 0) return false;

    const nextHashes = consumeRecoveryCode(currentHashes, index);
    if (nextHashes === null) return false;

    const [claimed] = await db
      .update(doctorsTable)
      .set({ totpRecoveryCodesHash: nextHashes })
      .where(and(
        eq(doctorsTable.id, doctorId),
        eq(doctorsTable.aprovado, true),
        eq(doctorsTable.totpEnabled, true),
        eq(doctorsTable.totpRecoveryCodesHash, currentHashes),
      ))
      .returning({ id: doctorsTable.id });

    if (claimed) return true;

    const [refreshed] = await db
      .select({ hashes: doctorsTable.totpRecoveryCodesHash })
      .from(doctorsTable)
      .where(and(
        eq(doctorsTable.id, doctorId),
        eq(doctorsTable.aprovado, true),
        eq(doctorsTable.totpEnabled, true),
      ))
      .limit(1);
    currentHashes = refreshed?.hashes ?? null;
  }

  return false;
}

// ── Challenge token (short-lived, pre-session) ────────────────────────────────

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const JWT_SECRET = process.env["SESSION_SECRET"] ?? "";

interface ChallengePayload {
  sub: "totp_challenge";
  doctorId: number;
  sessionVersion: number;
  exp: number;
}

function signChallengeToken(doctorId: number, sessionVersion: number): string {
  return jwt.sign(
    { sub: "totp_challenge", doctorId, sessionVersion },
    JWT_SECRET,
    { algorithm: "HS256", expiresIn: "5m" },
  );
}

function verifyChallengeToken(token: string): ChallengePayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] }) as unknown;
    if (
      typeof decoded === "object" && decoded !== null &&
      (decoded as Record<string, unknown>)["sub"] === "totp_challenge" &&
      typeof (decoded as Record<string, unknown>)["doctorId"] === "number" &&
      typeof (decoded as Record<string, unknown>)["sessionVersion"] === "number"
    ) {
      return decoded as ChallengePayload;
    }
    return null;
  } catch {
    return null;
  }
}

// ── POST /auth/totp/setup ─────────────────────────────────────────────────────

const SetupBody = z.object({
  currentPassword: z.string().min(1),
});

/**
 * Generates a new TOTP secret for the authenticated admin.
 * Returns an otpauth URI for QR code display.
 * Does NOT activate 2FA until /auth/totp/confirm is called.
 */
router.post("/auth/totp/setup", requireAdmin, async (req, res): Promise<void> => {
  const parsed = SetupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "currentPassword is required" });
    return;
  }

  const [doctor] = await db.select()
    .from(doctorsTable)
    .where(eq(doctorsTable.id, req.doctorId!))
    .limit(1);

  if (!doctor) { res.status(404).json({ error: "Account not found" }); return; }
  if (!doctor.isAdmin) { res.status(403).json({ error: "2FA is only available for admin accounts" }); return; }

  const valid = await comparePassword(parsed.data.currentPassword, doctor.senhaHash);
  if (!valid) { res.status(401).json({ error: "Current password is incorrect" }); return; }

  const secret = generateTotpSecret();
  const encSecret = encryptTotpSecret(secret);

  // Store encrypted secret but leave totpEnabled = false until confirmed
  await db.update(doctorsTable)
    .set({ totpSecretEnc: encSecret, totpEnabled: false })
    .where(eq(doctorsTable.id, doctor.id));

  const uri = buildTotpUri(secret, doctor.email);

  req.log.info({ doctorId: doctor.id }, "TOTP setup initiated");

  res.json({ uri, secret });
});

// ── POST /auth/totp/confirm ───────────────────────────────────────────────────

const ConfirmBody = z.object({
  code: z.string().length(6).regex(/^\d{6}$/),
});

/**
 * Confirms a TOTP code to activate 2FA. Returns one-time recovery codes.
 * Codes are shown exactly once — never stored in plaintext.
 */
router.post("/auth/totp/confirm", requireAdmin, async (req, res): Promise<void> => {
  const parsed = ConfirmBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A 6-digit TOTP code is required" });
    return;
  }

  const [doctor] = await db.select()
    .from(doctorsTable)
    .where(eq(doctorsTable.id, req.doctorId!))
    .limit(1);

  if (!doctor?.totpSecretEnc) {
    res.status(400).json({ error: "TOTP setup not initiated. Call /auth/totp/setup first." });
    return;
  }
  if (doctor.totpEnabled) {
    res.status(400).json({ error: "TOTP is already enabled" });
    return;
  }

  let secret: string;
  try {
    secret = decryptTotpSecret(doctor.totpSecretEnc);
  } catch {
    res.status(500).json({ error: "Failed to read TOTP configuration" });
    return;
  }

  if (!verifyTotpCode(secret, parsed.data.code)) {
    res.status(401).json({ error: "Invalid TOTP code" });
    return;
  }

  const recoveryCodes = generateRecoveryCodes(8);
  const hashedCodes = await hashRecoveryCodes(recoveryCodes);

  await db.update(doctorsTable)
    .set({ totpEnabled: true, totpRecoveryCodesHash: hashedCodes })
    .where(eq(doctorsTable.id, doctor.id));

  req.log.info({ doctorId: doctor.id }, "TOTP 2FA activated");

  res.json({
    success: true,
    recoveryCodes, // Shown once — user must save these
    message: "2FA activated. Save these recovery codes securely — they cannot be shown again.",
  });
});

// ── POST /auth/totp/disable ───────────────────────────────────────────────────

const DisableBody = z.object({
  currentPassword: z.string().min(1),
});

/**
 * Disables TOTP 2FA for the authenticated admin.
 * Requires current password.
 */
router.post("/auth/totp/disable", requireAdmin, async (req, res): Promise<void> => {
  const parsed = DisableBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "currentPassword is required" });
    return;
  }

  const [doctor] = await db.select()
    .from(doctorsTable)
    .where(eq(doctorsTable.id, req.doctorId!))
    .limit(1);

  if (!doctor) { res.status(404).json({ error: "Account not found" }); return; }

  const valid = await comparePassword(parsed.data.currentPassword, doctor.senhaHash);
  if (!valid) { res.status(401).json({ error: "Current password is incorrect" }); return; }

  await db.update(doctorsTable)
    .set({ totpEnabled: false, totpSecretEnc: null, totpRecoveryCodesHash: null })
    .where(eq(doctorsTable.id, doctor.id));

  req.log.info({ doctorId: doctor.id }, "TOTP 2FA disabled");

  res.json({ success: true });
});

// ── POST /auth/totp/challenge ─────────────────────────────────────────────────

const ChallengeBody = z.object({
  challengeToken: z.string().min(1),
  code: z.string().min(6).max(12), // 6 digits for TOTP or 12 chars for recovery
});

/**
 * Validates a TOTP code or recovery code and establishes a full session.
 * The challengeToken is issued by /auth/login when admin 2FA is required.
 * A full session cookie is set only on success.
 */
router.post("/auth/totp/challenge", async (req, res): Promise<void> => {
  const parsed = ChallengeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "challengeToken and code are required" });
    return;
  }

  const { challengeToken, code } = parsed.data;

  const challenge = verifyChallengeToken(challengeToken);
  if (!challenge) {
    res.status(401).json({ error: "Challenge token is invalid or expired" });
    return;
  }

  const [doctor] = await db.select()
    .from(doctorsTable)
    .where(and(
      eq(doctorsTable.id, challenge.doctorId),
      eq(doctorsTable.aprovado, true),
      eq(doctorsTable.totpEnabled, true),
    ))
    .limit(1);

  if (!doctor) {
    res.status(401).json({ error: "Account not found or 2FA not active" });
    return;
  }

  // Verify session version hasn't changed since challenge was issued
  if (doctor.sessionVersion !== challenge.sessionVersion) {
    res.status(401).json({ error: "Session invalidated — please log in again" });
    return;
  }

  if (!doctor.totpSecretEnc) {
    res.status(401).json({ error: "2FA configuration incomplete" });
    return;
  }

  let authenticated = false;

  if (/^\d{6}$/.test(code)) {
    // TOTP code
    let secret: string;
    try {
      secret = decryptTotpSecret(doctor.totpSecretEnc);
    } catch {
      res.status(500).json({ error: "Failed to read 2FA configuration" });
      return;
    }
    authenticated = verifyTotpCode(secret, code);
  } else if (code.length === 12) {
    // Recovery code
    if (doctor.totpRecoveryCodesHash) {
      authenticated = await consumeRecoveryCodeAtomically(
        doctor.id,
        code.toUpperCase(),
        doctor.totpRecoveryCodesHash,
      );
      if (authenticated) {
        req.log.warn({ doctorId: doctor.id }, "TOTP recovery code used");
      }
    }
  }

  if (!authenticated) {
    res.status(401).json({ error: "Invalid code" });
    return;
  }

  // Update lastLoginAt and establish full session
  const [loggedIn] = await db.update(doctorsTable)
    .set({ lastLoginAt: new Date() })
    .where(eq(doctorsTable.id, doctor.id))
    .returning();

  if (!loggedIn) {
    res.status(500).json({ error: "Login failed" });
    return;
  }

  const token = signToken({
    doctorId: loggedIn.id,
    isAdmin: loggedIn.isAdmin,
    sessionVersion: loggedIn.sessionVersion,
  });
  establishSession(res, "doctor", token);

  const doctorData = serializeDoctor(loggedIn);
  const analyticsSessionId = await resolveAnalyticsSessionId(req.get("X-Analytics-Session-Id"));
  void attachAnalyticsActor(analyticsSessionId, loggedIn.id);
  void emitAnalyticsEvent("login", loggedIn.id, analyticsSessionId);
  req.log.info({ doctorId: doctor.id }, "TOTP challenge passed — session established");

  res.json({
    doctor: {
      ...doctorData,
      createdAt: doctorData.createdAt.toISOString(),
      lastLoginAt: doctorData.lastLoginAt?.toISOString() ?? null,
    },
  });
});

// ── Export helpers for auth route integration ─────────────────────────────────

export { signChallengeToken };
export default router;
