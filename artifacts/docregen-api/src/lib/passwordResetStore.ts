import { createHash, randomBytes } from "crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import {
  db,
  doctorsTable,
  passwordResetTokensTable,
} from "@workspace/docregen-db";

const TOKEN_TTL_MS = 60 * 60 * 1000;

function hashResetToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Creates a one-time reset token.
 *
 * Only the SHA-256 digest is persisted. Creating a new token invalidates any
 * older unused token for the same doctor, so only the newest email remains
 * actionable.
 */
export async function createResetToken(doctorId: number): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashResetToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TOKEN_TTL_MS);

  await db.transaction(async (tx) => {
    await tx
      .update(passwordResetTokensTable)
      .set({ usedAt: now })
      .where(and(
        eq(passwordResetTokensTable.doctorId, doctorId),
        isNull(passwordResetTokensTable.usedAt),
      ));

    await tx.insert(passwordResetTokensTable).values({
      doctorId,
      tokenHash,
      expiresAt,
    });
  });

  return token;
}

/**
 * Atomically consumes a valid token, changes the password, and advances the
 * doctor's session version. If any write fails, the transaction rolls back and
 * the token remains usable until its original expiry.
 */
export async function resetPasswordWithToken(
  token: string,
  senhaHash: string,
): Promise<boolean> {
  const tokenHash = hashResetToken(token);
  const now = new Date();

  return db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(passwordResetTokensTable)
      .set({ usedAt: now })
      .where(and(
        eq(passwordResetTokensTable.tokenHash, tokenHash),
        isNull(passwordResetTokensTable.usedAt),
        gt(passwordResetTokensTable.expiresAt, now),
      ))
      .returning({ doctorId: passwordResetTokensTable.doctorId });

    if (!claimed) return false;

    const [updatedDoctor] = await tx
      .update(doctorsTable)
      .set({
        senhaHash,
        sessionVersion: sql`${doctorsTable.sessionVersion} + 1`,
      })
      .where(eq(doctorsTable.id, claimed.doctorId))
      .returning({ id: doctorsTable.id });

    if (!updatedDoctor) {
      throw new Error("Password reset doctor no longer exists");
    }

    return true;
  });
}