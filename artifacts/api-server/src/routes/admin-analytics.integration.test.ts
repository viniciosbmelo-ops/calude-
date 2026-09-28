/**
 * Deterministic admin-utilization regression coverage.
 *
 * This suite is opt-in to a PostgreSQL test database and runs every fixture
 * inside one transaction that is deliberately rolled back. It never uses
 * production data and does not leave synthetic clinical records behind.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  db,
  doctorsTable,
  patientsTable,
  surgeriesTable,
  regenCasesTable,
  physiotherapistsTable,
  careLinksTable,
  physioPatientsTable,
  physioDocumentsTable,
  analyticsSessionsTable,
  analyticsEventsTable,
} from "@workspace/db";
import {
  computeNavigationClickRanking,
  computeUsageFunnel,
  type DateRange,
} from "./admin-analytics";

const canUseTestDatabase =
  Boolean(process.env["DATABASE_URL"]) && process.env["NODE_ENV"] !== "production";

const period: DateRange = {
  start: new Date("2099-01-01T00:00:00.000Z"),
  end: new Date("2099-01-31T23:59:59.999Z"),
  label: "fixture",
  days: 31,
};

const inside = new Date("2099-01-15T12:00:00.000Z");
const atStart = period.start;
const atEnd = period.end;
const outside = new Date("2098-12-31T23:59:59.999Z");

describe.skipIf(!canUseTestDatabase).sequential("admin utilization SQL regressions", () => {
  it("classifies cohorts by bounded records, actors, and real clicks only", async () => {
    const suffix = randomUUID();
    const rollback = Symbol("rollback-admin-analytics-fixtures");
    let assertionsCompleted = false;

    try {
      await db.transaction(async (tx) => {
        const [owner, regenOnly, rxOnly, entered, sessionOnly, lastLoginOnly, admin, physioActor] =
          await tx.insert(doctorsTable).values([
            {
              nome: "Analytics Fixture Owner",
              email: `analytics-owner-${suffix}@example.test`,
              senhaHash: "fixture-password-hash",
            },
            {
              nome: "Analytics Fixture Regen",
              email: `analytics-regen-${suffix}@example.test`,
              senhaHash: "fixture-password-hash",
            },
            {
              nome: "Analytics Fixture RX",
              email: `analytics-rx-${suffix}@example.test`,
              senhaHash: "fixture-password-hash",
            },
            {
              nome: "Analytics Fixture Entered",
              email: `analytics-entered-${suffix}@example.test`,
              senhaHash: "fixture-password-hash",
            },
            {
              nome: "Analytics Fixture Session",
              email: `analytics-session-${suffix}@example.test`,
              senhaHash: "fixture-password-hash",
            },
            {
              nome: "Analytics Fixture Last Login",
              email: `analytics-last-login-${suffix}@example.test`,
              senhaHash: "fixture-password-hash",
              lastLoginAt: inside,
            },
            {
              nome: "Analytics Fixture Admin",
              email: `analytics-admin-${suffix}@example.test`,
              senhaHash: "fixture-password-hash",
              isAdmin: true,
              lastLoginAt: inside,
            },
            {
              nome: "Analytics Fixture Physio Actor",
              email: `analytics-physio-actor-${suffix}@example.test`,
              senhaHash: "fixture-password-hash",
            },
          ]).returning();

        // This old patient proves that an RX user with records outside the
        // selected period is still RX-only for the selected period.
        await tx.insert(patientsTable).values({
          doctorId: rxOnly!.id,
          nome: "SYNTHETIC ANALYTICS PATIENT",
          createdAt: outside,
          updatedAt: outside,
        });

        const [ownerPatient] = await tx.insert(patientsTable).values({
          doctorId: owner!.id,
          nome: "SYNTHETIC ANALYTICS OWNER PATIENT",
          createdAt: inside,
          updatedAt: inside,
        }).returning();

        const [ownerSurgery] = await tx.insert(surgeriesTable).values({
          doctorId: owner!.id,
          patientId: ownerPatient!.id,
          status: "completo",
          createdAt: inside,
          updatedAt: inside,
        }).returning();

        // A regen case is a covered clinical record even without a patients row.
        await tx.insert(regenCasesTable).values({
          doctorId: regenOnly!.id,
          conditionCode: "fixture_condition",
          status: "draft",
          createdAt: inside,
          updatedAt: inside,
        });

        // Physio records are attributed through the care link to the owning
        // surgeon, never to the physiotherapist who authored the document.
        const [physio] = await tx.insert(physiotherapistsTable).values({
          nome: "Analytics Fixture Physiotherapist",
          email: `analytics-physio-${suffix}@example.test`,
          senhaHash: "fixture-password-hash",
          celular: "5511999999999",
        }).returning();
        const [careLink] = await tx.insert(careLinksTable).values({
          patientId: ownerPatient!.id,
          // This doctor is deliberately only present as a care-link relation;
          // that relation is not authenticated doctor authorship.
          surgeonId: physioActor!.id,
          physioId: physio!.id,
          surgeryId: ownerSurgery!.id,
          status: "active",
        }).returning();
        const [physioPatient] = await tx.insert(physioPatientsTable).values({
          physioId: physio!.id,
          patientId: ownerPatient!.id,
          careLinkId: careLink!.id,
          fullName: "SYNTHETIC ANALYTICS PHYSIO PATIENT",
          diagnosisCode: "outro",
          createdAt: inside,
        }).returning();
        await tx.insert(physioDocumentsTable).values({
          physioId: physio!.id,
          physioPatientId: physioPatient!.id,
          docType: "evolucao",
          title: "Synthetic fixture",
          content: {},
          createdAt: inside,
          updatedAt: inside,
        });

        const sessionOnlySessionId = randomUUID();
        await tx.insert(analyticsSessionsTable).values({
          sessionId: sessionOnlySessionId,
          doctorId: sessionOnly!.id,
          actorType: "authenticated",
          startedAt: atStart,
          lastHeartbeatAt: atEnd,
        });

        const sessionId = randomUUID();
        await tx.insert(analyticsSessionsTable).values({
          sessionId,
          doctorId: entered!.id,
          actorType: "authenticated",
          startedAt: inside,
          lastHeartbeatAt: inside,
        });

        const event = (
          doctorId: number,
          eventName: string,
          createdAt: Date,
          pagePath: string | null = null,
          featureName: string | null = null,
        ) => ({
          sessionId: randomUUID(),
          doctorId,
          eventName,
          createdAt,
          pagePath,
          featureName,
        });

        await tx.insert(analyticsEventsTable).values([
          // Login at the inclusive lower bound and click at the inclusive
          // upper bound prove both period edges are retained.
          event(entered!.id, "login", atStart),
          event(entered!.id, "page_view", atEnd, "/surgeries"),
          // Deliberately mismatched client feature; ranking derives
          // canonical "surgeries" from the sanitized route.
          event(entered!.id, "navigation_click", atEnd, "/surgeries", "surgery"),
          event(entered!.id, "navigation_click", inside, "/surgeries", "surgeries"),
          // This page view must not inflate the click count.
          event(entered!.id, "page_view", inside, "/surgeries", "surgery"),
          event(rxOnly!.id, "navigation_click", inside, "/surgeries", "surgeries"),
          // Only an explicitly contextualized standalone planning event
          // qualifies as RX-only; surgery analysis is excluded.
          event(rxOnly!.id, "xray_analyzed", inside, "/xray-planning", "xray_standalone"),
          event(rxOnly!.id, "xray_analyzed", inside, "/surgeries/new", "xray_surgery"),
          // Legacy path/feature data has no bounded context and is not
          // retroactively classified as standalone.
          event(rxOnly!.id, "xray_analyzed", inside, "/xray-planning", "xray"),
          // Admin activity must not enter doctor counts or click rankings.
          event(admin!.id, "navigation_click", inside, "/surgeries", "surgery"),
          event(admin!.id, "page_view", inside, "/surgeries"),
        ]);

        const usage = await computeUsageFunnel(period, tx);
        const clicks = await computeNavigationClickRanking(period, tx);

        expect(usage.coverage.unavailableReason).toBeUndefined();
        expect(usage.period.bounds).toBe("inclusive [start, end] UTC");
        expect(usage.activeDoctors).toBe(6);
        expect(usage.documentedDoctors).toBe(2);
        expect(usage.rxOnlyDoctors).toBe(1);
        // RX-only is itself an authenticated product entry and overlaps this
        // cohort even when no separate page_view/click was recorded.
        expect(usage.enteredWithoutDocumentationDoctors).toBe(3);
        expect(usage.overlap.rxOnlyIncludedInEnteredWithoutDocumentation).toBe(true);
        expect(usage.overlap.rxOnlyAndDocumentedDoctors).toBe(0);

        const rxList = usage.rxOnlyDoctorList;
        expect(rxList).toEqual([
          { name: "Analytics Fixture RX", email: `analytics-rx-${suffix}@example.test` },
        ]);
        expect(usage.enteredWithoutDocumentationDoctorList.map((doctor) => doctor.name).sort())
          .toEqual([
            "Analytics Fixture Entered",
            "Analytics Fixture RX",
            "Analytics Fixture Session",
          ]);
        for (const doctor of [
          ...usage.rxOnlyDoctorList,
          ...usage.enteredWithoutDocumentationDoctorList,
        ]) {
          expect(Object.keys(doctor).sort()).toEqual(["email", "name"]);
        }
        expect(JSON.stringify(usage)).not.toContain("SYNTHETIC ANALYTICS");
        expect(JSON.stringify(usage)).not.toContain("Analytics Fixture Admin");
        expect(JSON.stringify(usage)).not.toContain("Analytics Fixture Physiotherapist");
        expect(JSON.stringify(usage)).not.toContain("Analytics Fixture Physio Actor");

        expect(clicks.unavailableReason).toBeUndefined();
        expect(clicks.bounds).toBe("inclusive [period.start, period.end] UTC");
        const surgeryClicks = clicks.items.find((item) => item.route === "/surgeries");
        expect(surgeryClicks).toEqual({
          route: "/surgeries",
          feature: "surgeries",
          count: 3,
          uniqueDoctors: 2,
        });
        expect(clicks.items.some((item) => item.route === "/xray-planning")).toBe(false);
        expect(clicks.coverageStart).not.toBeNull();
        expect(clicks.empty).toBe(false);

        assertionsCompleted = true;
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }

    expect(assertionsCompleted).toBe(true);
    const leftovers = await db.execute(sql`
      SELECT count(*)::int AS count
      FROM doctors
      WHERE email LIKE ${`analytics-%-${suffix}@example.test`}
    `);
    expect(Number((leftovers.rows[0] as { count: number }).count)).toBe(0);
  });
});
