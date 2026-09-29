import { db, doctorsTable, secretariesTable } from "@workspace/docregen-db";
import { and, eq } from "drizzle-orm";
import type { AuthTokenPayload } from "./auth";

/**
 * Revalidates a signed session against current persistent account state.
 * Returns a fresh payload sourced from the database, never trusting mutable
 * role/ownership claims from the token alone.
 */
export async function validateCurrentAccount(
  payload: AuthTokenPayload,
): Promise<AuthTokenPayload | null> {
  if (payload.role === "doctor") {
    const [doctor] = await db
      .select({
        id: doctorsTable.id,
        isAdmin: doctorsTable.isAdmin,
        aprovado: doctorsTable.aprovado,
        sessionVersion: doctorsTable.sessionVersion,
      })
      .from(doctorsTable)
      .where(eq(doctorsTable.id, payload.doctorId))
      .limit(1);

    if (
      !doctor?.aprovado ||
      doctor.sessionVersion !== payload.sessionVersion
    ) {
      return null;
    }

    return {
      role: "doctor",
      doctorId: doctor.id,
      isAdmin: doctor.isAdmin,
      sessionVersion: doctor.sessionVersion,
    };
  }

  if (payload.role === "secretary") {
    const [secretary] = await db
      .select({
        id: secretariesTable.id,
        doctorId: secretariesTable.doctorId,
        sessionVersion: secretariesTable.sessionVersion,
      })
      .from(secretariesTable)
      .innerJoin(doctorsTable, eq(secretariesTable.doctorId, doctorsTable.id))
      .where(and(
        eq(secretariesTable.id, payload.secretaryId),
        eq(secretariesTable.ativo, true),
        eq(doctorsTable.aprovado, true),
      ))
      .limit(1);

    if (
      !secretary ||
      secretary.doctorId !== payload.doctorId ||
      secretary.sessionVersion !== payload.sessionVersion
    ) {
      return null;
    }

    return {
      role: "secretary",
      secretaryId: secretary.id,
      doctorId: secretary.doctorId,
      isAdmin: false,
      sessionVersion: secretary.sessionVersion,
    };
  }

  return null;
}
