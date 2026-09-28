/**
 * TOTP 2FA helpers — uses built-in Node.js crypto only (no external packages).
 *
 * Algorithm: RFC 6238 (TOTP) based on RFC 4226 (HOTP), SHA-1, 6 digits, 30-second window.
 * Key storage: AES-256-GCM, key derived from SESSION_SECRET via HKDF-SHA256.
 *
 * Recovery codes: 8 random codes (12 chars each), bcrypt-hashed at storage time,
 * consumed (deleted) on use. Never logged or returned in API responses.
 *
 * Replay prevention: valid codes are tracked in a short-lived in-memory set
 * (covers ±1 window = 3 × 30 s). Sufficient for a low-volume admin use-case;
 * for higher scale, persist used codes to the DB.
 */
import { createHmac, createCipheriv, createDecipheriv, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { logger } from "./logger";

// ── Key derivation ─────────────────────────────────────────────────────────────

const SESSION_SECRET = process.env["SESSION_SECRET"] ?? "";

/** Derives a 256-bit AES key from SESSION_SECRET using HKDF-SHA256. */
function deriveTotpEncKey(): Buffer {
  if (!SESSION_SECRET) throw new Error("SESSION_SECRET is not set");
  return Buffer.from(
    hkdfSync("sha256", SESSION_SECRET, "docknee-totp-v1", "", 32),
  );
}

// ── Secret encryption / decryption ────────────────────────────────────────────

/**
 * Encrypts a TOTP secret (base32 string) using AES-256-GCM.
 * Returns a string in the format: "<iv_hex>:<authTag_hex>:<ciphertext_hex>"
 */
export function encryptTotpSecret(secret: string): string {
  const key = deriveTotpEncKey();
  const iv = randomBytes(12); // 96-bit IV for GCM
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${ct.toString("hex")}`;
}

/**
 * Decrypts a TOTP secret previously encrypted with encryptTotpSecret.
 * Returns the base32 secret string, or throws on failure.
 */
export function decryptTotpSecret(enc: string): string {
  const [ivHex, tagHex, ctHex] = enc.split(":");
  if (!ivHex || !tagHex || !ctHex) throw new Error("Invalid encrypted secret format");
  const key = deriveTotpEncKey();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const pt = Buffer.concat([decipher.update(Buffer.from(ctHex, "hex")), decipher.final()]);
  return pt.toString("utf8");
}

// ── TOTP core ─────────────────────────────────────────────────────────────────

/** Decodes a base32 string (RFC 4648 — uppercase, no padding required). */
function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const str = input.replace(/=+$/, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const char of str) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) throw new Error(`Invalid base32 character: ${char}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

/** Generates a random base32-encoded TOTP secret (20 bytes = 160 bits). */
export function generateTotpSecret(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes = randomBytes(20);
  let result = "";
  let buffer = 0;
  let bitsLeft = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bitsLeft += 8;
    while (bitsLeft >= 5) {
      result += alphabet[(buffer >>> (bitsLeft - 5)) & 31];
      bitsLeft -= 5;
    }
  }
  if (bitsLeft > 0) result += alphabet[(buffer << (5 - bitsLeft)) & 31];
  return result;
}

/**
 * Computes a TOTP code for the given secret and counter (Unix timestamp / 30).
 * Returns a zero-padded 6-digit string.
 */
function computeHotp(secretBase32: string, counter: bigint): string {
  const key = base32Decode(secretBase32);
  const msg = Buffer.allocUnsafe(8);
  msg.writeBigInt64BE(counter);
  const hmac = createHmac("sha1", key).update(msg).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

/** Returns the current TOTP counter (Unix time / 30). */
function currentCounter(): bigint {
  return BigInt(Math.floor(Date.now() / 1000 / 30));
}

// ── Replay prevention ─────────────────────────────────────────────────────────

// In-memory used-code cache: key = "secretHash:counter:code"
// Entries are auto-expired after 120 s to bound memory use.
const usedCodes = new Map<string, number>();

function markUsed(secretBase32: string, counter: bigint, code: string): void {
  const key = `${secretBase32.slice(0, 8)}:${counter}:${code}`;
  usedCodes.set(key, Date.now());
  // Prune stale entries
  const cutoff = Date.now() - 120_000;
  for (const [k, ts] of usedCodes) {
    if (ts < cutoff) usedCodes.delete(k);
  }
}

function wasUsed(secretBase32: string, counter: bigint, code: string): boolean {
  const key = `${secretBase32.slice(0, 8)}:${counter}:${code}`;
  return usedCodes.has(key);
}

// ── Public TOTP verification ───────────────────────────────────────────────────

/**
 * Verifies a 6-digit TOTP code against the secret.
 * Allows ±1 window (90-second tolerance) to account for clock skew.
 * Returns true only if the code is valid AND has not been used within the window.
 */
export function verifyTotpCode(secretBase32: string, code: string): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const counter = currentCounter();
  for (const delta of [-1n, 0n, 1n]) {
    const c = counter + delta;
    const expected = computeHotp(secretBase32, c);
    // Timing-safe comparison
    if (timingSafeEqual(Buffer.from(code), Buffer.from(expected))) {
      if (wasUsed(secretBase32, c, code)) return false;
      markUsed(secretBase32, c, code);
      return true;
    }
  }
  return false;
}

/**
 * Builds a otpauth:// URI for QR-code display.
 * Issuer and account name must not contain `:` or `%`.
 */
export function buildTotpUri(secret: string, email: string, issuer = "DocKnee"): string {
  const safeEmail = encodeURIComponent(email);
  const safeIssuer = encodeURIComponent(issuer);
  return `otpauth://totp/${safeIssuer}:${safeEmail}?secret=${secret}&issuer=${safeIssuer}&algorithm=SHA1&digits=6&period=30`;
}

// ── Recovery codes ─────────────────────────────────────────────────────────────

const RECOVERY_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // excludes I, O, 0, 1

/** Generates n random alphanumeric recovery codes (12 chars each). */
export function generateRecoveryCodes(n = 8): string[] {
  return Array.from({ length: n }, () => {
    const bytes = randomBytes(12);
    return Array.from(bytes, (b) => RECOVERY_CODE_CHARS[b % RECOVERY_CODE_CHARS.length]).join("");
  });
}

/** Hashes a list of recovery codes with bcrypt (cost 10). Returns JSON string. */
export async function hashRecoveryCodes(codes: string[]): Promise<string> {
  const hashed = await Promise.all(codes.map((c) => bcrypt.hash(c, 10)));
  return JSON.stringify(hashed);
}

/**
 * Checks if a supplied recovery code matches any stored hash.
 * If matched, returns the index so the caller can remove it.
 * Returns -1 if no match.
 */
export async function findMatchingRecoveryCode(
  code: string,
  hashedCodesJson: string,
): Promise<number> {
  let hashes: string[];
  try {
    hashes = JSON.parse(hashedCodesJson) as string[];
  } catch {
    return -1;
  }
  for (let i = 0; i < hashes.length; i++) {
    const match = await bcrypt.compare(code, hashes[i]!);
    if (match) return i;
  }
  return -1;
}

/**
 * Removes a recovery code at the given index and returns the updated JSON string.
 * Returns null if index is out of bounds.
 */
export function consumeRecoveryCode(hashedCodesJson: string, index: number): string | null {
  let hashes: string[];
  try {
    hashes = JSON.parse(hashedCodesJson) as string[];
  } catch {
    return null;
  }
  if (index < 0 || index >= hashes.length) return null;
  hashes.splice(index, 1);
  return JSON.stringify(hashes);
}

// Suppress unused logger warning — it's used indirectly through logger import
void logger;
