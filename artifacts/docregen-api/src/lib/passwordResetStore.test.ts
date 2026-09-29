import { afterEach, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  doctorsTable,
  passwordResetTokensTable,
} from "@workspace/docregen-db";
import { comparePassword, hashPassword } from "./auth";
import { createResetToken, resetPasswordWithToken } from "./passwordResetStore";

describe.sequential("persistent password reset tokens", () => {
  const doctorIds: number[] = [];

  afterEach(async () => {
    if (doctorIds.length > 0) {
      await db.delete(doctorsTable).where(inArray(doctorsTable.id, doctorIds));
      doctorIds.length = 0;
    }
  });

  it("stores only a digest and atomically permits one concurrent reset", async () => {
    const suffix = randomUUID();
    const [doctor] = await db
      .insert(doctorsTable)
      .values({
        nome: "Reset Test",
        email: `reset-${suffix}@example.test`,
        senhaHash: await hashPassword("old-password"),
      })
      .returning();
    doctorIds.push(doctor.id);

    const token = await createResetToken(doctor.id);
    const [stored] = await db
      .select()
      .from(passwordResetTokensTable)
      .where(eq(passwordResetTokensTable.doctorId, doctor.id))
      .limit(1);

    expect(stored.tokenHash).not.toBe(token);
    expect(stored.tokenHash).toBe(
      createHash("sha256").update(token, "utf8").digest("hex"),
    );

    const newHash = await hashPassword("new-password");
    const attempts = await Promise.all([
      resetPasswordWithToken(token, newHash),
      resetPasswordWithToken(token, newHash),
    ]);

    expect(attempts.filter(Boolean)).toHaveLength(1);
    expect(attempts.filter((result) => !result)).toHaveLength(1);

    const [updatedDoctor] = await db
      .select()
      .from(doctorsTable)
      .where(eq(doctorsTable.id, doctor.id))
      .limit(1);
    const [consumed] = await db
      .select()
      .from(passwordResetTokensTable)
      .where(eq(passwordResetTokensTable.doctorId, doctor.id))
      .limit(1);

    expect(await comparePassword("new-password", updatedDoctor.senhaHash)).toBe(true);
    expect(updatedDoctor.sessionVersion).toBe(1);
    expect(consumed.usedAt).toBeInstanceOf(Date);
  });
});