import { db, scheduledNotificationsTable, surgeriesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  buildNotificationsForSurgery,
  hasFractureProcedure,
  isPreoperativePeriod,
} from "./followup-schedule";

export interface SurgeryScheduleSource {
  id: number;
  patientId: number;
  tiposProcedimento?: readonly string[] | null;
  dataCirurgia?: string | null;
}

type DesiredNotification = ReturnType<typeof buildNotificationsForSurgery>[number];
type ScheduledNotification = typeof scheduledNotificationsTable.$inferSelect;

function preservationRank(notification: ScheduledNotification): number {
  if (notification.status === "completed") return 4;
  if (notification.status === "sent") return 3;
  if (notification.followupId) return 2;
  return 1;
}

function chooseKeeper(rows: ScheduledNotification[]): ScheduledNotification | undefined {
  return [...rows].sort((a, b) => {
    const rankDiff = preservationRank(b) - preservationRank(a);
    return rankDiff !== 0 ? rankDiff : a.id - b.id;
  })[0];
}

function hasNotificationHistory(notification: ScheduledNotification): boolean {
  return Boolean(
    notification.followupId
    || notification.status !== "pending"
    || notification.sentAt
    || notification.whatsappMessageId
    || notification.attempts > 0,
  );
}

async function disableOrDeletePreoperative(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  notification: ScheduledNotification,
): Promise<void> {
  if (!hasNotificationHistory(notification)) {
    await tx
      .delete(scheduledNotificationsTable)
      .where(eq(scheduledNotificationsTable.id, notification.id));
    return;
  }

  if (!["sent", "completed", "skipped"].includes(notification.status)) {
    await tx
      .update(scheduledNotificationsTable)
      .set({
        status: "skipped",
        nextAttemptAt: null,
        claimedAt: null,
      })
      .where(eq(scheduledNotificationsTable.id, notification.id));
  }
}

async function reconcileDesiredEntries(
  source: SurgeryScheduleSource,
  mode: "all" | "preoperative",
  removeMissingPeriods: boolean,
): Promise<ScheduledNotification[]> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(87001, CAST(${source.id} AS integer))`,
    );

    const [currentSurgery] = await tx
      .select({
        id: surgeriesTable.id,
        patientId: surgeriesTable.patientId,
        tiposProcedimento: surgeriesTable.tiposProcedimento,
        dataCirurgia: surgeriesTable.dataCirurgia,
      })
      .from(surgeriesTable)
      .where(eq(surgeriesTable.id, source.id))
      .for("update")
      .limit(1);
    if (!currentSurgery) return [];

    const allDesired = buildDesired(currentSurgery);
    const desired = mode === "preoperative"
      ? allDesired.filter((entry) => isPreoperativePeriod(entry.periodo))
      : allDesired;
    const disablePreoperative = hasFractureProcedure(currentSurgery.tiposProcedimento);

    const existing = await tx
      .select()
      .from(scheduledNotificationsTable)
      .where(eq(scheduledNotificationsTable.surgeryId, source.id))
      .for("update");

    const existingByPeriod = new Map<string, ScheduledNotification[]>();
    for (const row of existing) {
      const rows = existingByPeriod.get(row.periodo) ?? [];
      rows.push(row);
      existingByPeriod.set(row.periodo, rows);
    }

    const desiredPeriods = new Set(desired.map((entry) => entry.periodo));
    const reconciled: ScheduledNotification[] = [];

    for (const entry of desired) {
      const matches = existingByPeriod.get(entry.periodo) ?? [];
      const keeper = chooseKeeper(matches);

      if (keeper) {
        const [updated] = await tx
          .update(scheduledNotificationsTable)
          .set({
            patientId: entry.patientId,
            daysAfterSurgery: entry.daysAfterSurgery,
            scheduledDate: entry.scheduledDate,
            scales: entry.scales,
            notes: entry.notes,
          })
          .where(eq(scheduledNotificationsTable.id, keeper.id))
          .returning();
        reconciled.push(updated);

        for (const duplicate of matches) {
          if (duplicate.id !== keeper.id && !hasNotificationHistory(duplicate)) {
            await tx
              .delete(scheduledNotificationsTable)
              .where(eq(scheduledNotificationsTable.id, duplicate.id));
          }
        }
      } else {
        const [created] = await tx
          .insert(scheduledNotificationsTable)
          .values(entry)
          .returning();
        reconciled.push(created);
      }
    }

    if (removeMissingPeriods) {
      for (const row of existing) {
        if (!desiredPeriods.has(row.periodo)) {
          if (disablePreoperative && isPreoperativePeriod(row.periodo)) {
            await disableOrDeletePreoperative(tx, row);
          } else if (!hasNotificationHistory(row)) {
            await tx
              .delete(scheduledNotificationsTable)
              .where(eq(scheduledNotificationsTable.id, row.id));
          }
        }
      }
    }

    return reconciled.sort(
      (a, b) => (a.daysAfterSurgery ?? 0) - (b.daysAfterSurgery ?? 0),
    );
  });
}

function buildDesired(source: SurgeryScheduleSource): DesiredNotification[] {
  return buildNotificationsForSurgery(
    source.id,
    source.patientId,
    source.dataCirurgia,
    [...(source.tiposProcedimento ?? [])],
  );
}

export async function syncSurgerySchedule(
  source: SurgeryScheduleSource,
): Promise<ScheduledNotification[]> {
  return reconcileDesiredEntries(
    source,
    "all",
    true,
  );
}

export async function ensurePreoperativeNotification(
  source: SurgeryScheduleSource,
): Promise<ScheduledNotification | null> {
  const [notification] = await reconcileDesiredEntries(
    source,
    "preoperative",
    false,
  );
  return notification ?? null;
}

export async function removePreoperativeNotifications(
  surgeryId: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(87001, CAST(${surgeryId} AS integer))`,
    );
    const existing = await tx
      .select()
      .from(scheduledNotificationsTable)
      .where(eq(scheduledNotificationsTable.surgeryId, surgeryId));

    for (const row of existing) {
      if (isPreoperativePeriod(row.periodo)) {
        await disableOrDeletePreoperative(tx, row);
      }
    }
  });
}