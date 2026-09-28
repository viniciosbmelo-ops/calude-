/**
 * GET /admin/analytics?period=7d|30d|90d|12m
 *
 * Returns a stable JSON contract with aggregated operational/analytics metrics.
 * Data availability metadata is always explicit — never fabricated zeroes for
 * periods before instrumentation started.
 *
 * Uses America/Sao_Paulo timezone for all date arithmetic.
 * All queries are bounded (no full table scans without date filters).
 * No patient data is exposed.
 *
 * MRR is computed by joining stripe.subscription_items → stripe.prices and
 * normalising to monthly revenue (annual prices divided by 12, etc.).
 */
import { Router, type IRouter } from "express";
import {
  db,
  doctorsTable,
  analyticsSessionsTable,
  analyticsEventsTable,
  auditLogsTable,
  adminContactMessages,
  webVitalsTable,
  campaignsTable,
} from "@workspace/db";
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ── Period resolution ─────────────────────────────────────────────────────────

type Period = "7d" | "30d" | "90d" | "12m";

export interface DateRange {
  start: Date;
  end: Date;
  label: string;
  days: number;
}

const TZ = "America/Sao_Paulo";

function resolvePeriod(period: Period): { current: DateRange; prior: DateRange } {
  const nowUtc = new Date();
  const days = period === "7d" ? 7 : period === "30d" ? 30 : period === "90d" ? 90 : 365;
  const currentEnd = nowUtc;
  const currentStart = new Date(nowUtc.getTime() - days * 24 * 60 * 60 * 1000);
  const priorEnd = new Date(currentStart.getTime() - 1);
  const priorStart = new Date(priorEnd.getTime() - days * 24 * 60 * 60 * 1000);
  return {
    current: { start: currentStart, end: currentEnd, label: period, days },
    prior:   { start: priorStart,   end: priorEnd,   label: `prior_${period}`, days },
  };
}

// ── Data start / availability ─────────────────────────────────────────────────

async function getDataStart(table: "doctors" | "analytics_sessions" | "audit_logs"): Promise<Date | null> {
  try {
    const result = await db.execute(sql.raw(`SELECT MIN(created_at) AS earliest FROM ${table}`));
    const earliest = (result.rows[0] as { earliest: Date | string | null } | undefined)?.earliest;
    if (earliest == null) return null;
    const parsed = earliest instanceof Date ? earliest : new Date(earliest);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  } catch { return null; }
}

// ── Metric helpers ────────────────────────────────────────────────────────────

function pct(a: number, b: number): number | null {
  if (b === 0) return null;
  return Math.round((a / b) * 10000) / 100;
}

function delta(current: number, prior: number): number | null {
  if (prior === 0) return null;
  return Math.round(((current - prior) / prior) * 10000) / 100;
}

interface UsageDoctorRow {
  doctor_id: number | string;
  doctor_name: string;
  doctor_email: string;
  is_rx_only: boolean;
  is_entered_without_documentation: boolean;
  is_documented: boolean;
  coverage_start: Date | string | null;
}

interface UsageFunnel {
  period: {
    start: string;
    end: string;
    timezone: string;
    bounds: string;
  };
  coverage: {
    documentationSources: string[];
    xraySuccessSource: string;
    clickSource: string;
    documentationLimitations: string[];
    start: string | null;
    empty: boolean;
    unavailableReason?: string;
  };
  activeDoctors: number;
  rxOnlyDoctors: number;
  enteredWithoutDocumentationDoctors: number;
  documentedDoctors: number;
  overlap: {
    rxOnlyIncludedInEnteredWithoutDocumentation: boolean;
    rxOnlyAndDocumentedDoctors: number;
  };
  rxOnlyDoctorList: { name: string; email: string }[];
  enteredWithoutDocumentationDoctorList: { name: string; email: string }[];
}

interface NavigationClickRanking {
  bounds: string;
  coverageStart: string | null;
  empty: boolean;
  items: {
    route: string;
    feature: string;
    count: number;
    uniqueDoctors: number;
  }[];
  unavailableReason?: string;
}

function toIsoOrNull(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Computes the utilization cohorts from current source records rather than
 * inferring clinical work from patient totals. All identities are discarded
 * before this result leaves the route except for the explicitly permitted
 * doctor name/email lists.
 */
export async function computeUsageFunnel(
  current: DateRange,
  executor: Pick<typeof db, "execute"> = db,
): Promise<UsageFunnel> {
  const base: Omit<UsageFunnel, "period"> = {
    coverage: {
      documentationSources: ["patients", "surgeries", "regen"],
      xraySuccessSource: "server-emitted xray_analyzed events with featureName=xray_standalone after successful standalone /xray-planning analysis",
      clickSource: "navigation_click events (pagePath=destination, featureName=feature)",
      documentationLimitations: [
        "Current created_at/updated_at timestamps cannot recover overwritten or deleted prior edits.",
        "Physio activity is excluded because a care relation does not prove authenticated doctor authorship.",
        "Historical xray_analyzed events without explicit context cannot be attributed to standalone planning.",
      ],
      start: null,
      empty: true,
    },
    activeDoctors: 0,
    rxOnlyDoctors: 0,
    enteredWithoutDocumentationDoctors: 0,
    documentedDoctors: 0,
    overlap: {
      rxOnlyIncludedInEnteredWithoutDocumentation: true,
      rxOnlyAndDocumentedDoctors: 0,
    },
    rxOnlyDoctorList: [],
    enteredWithoutDocumentationDoctorList: [],
  };

  try {
    const result = await executor.execute(sql`
      WITH eligible_doctors AS (
        SELECT id, nome, email, last_login_at
        FROM doctors
        WHERE is_admin = false
          AND aprovado = true
      ),
      clinical_records AS (
        SELECT doctor_id, created_at AS observed_at FROM patients
        UNION ALL
        SELECT doctor_id, updated_at AS observed_at FROM patients
        UNION ALL
        SELECT doctor_id, created_at AS observed_at FROM surgeries
        UNION ALL
        SELECT doctor_id, updated_at AS observed_at FROM surgeries
        UNION ALL
        SELECT doctor_id, created_at AS observed_at FROM regen_cases
        UNION ALL
        SELECT doctor_id, updated_at AS observed_at FROM regen_cases
      ),
      documented_doctors AS (
        SELECT DISTINCT doctor_id
        FROM clinical_records
        WHERE observed_at >= ${current.start.toISOString()}
          AND observed_at <= ${current.end.toISOString()}
          AND doctor_id IS NOT NULL
      ),
      all_event_doctors AS (
        SELECT DISTINCT doctor_id
        FROM analytics_events
        WHERE doctor_id IS NOT NULL
          AND created_at >= ${current.start.toISOString()}
          AND created_at <= ${current.end.toISOString()}
      ),
      session_doctors AS (
        SELECT DISTINCT doctor_id
        FROM analytics_sessions
        WHERE doctor_id IS NOT NULL
          AND actor_type = 'authenticated'
          AND (
            (started_at >= ${current.start.toISOString()} AND started_at <= ${current.end.toISOString()})
            OR (last_heartbeat_at >= ${current.start.toISOString()} AND last_heartbeat_at <= ${current.end.toISOString()})
          )
      ),
      entered_doctors AS (
        SELECT DISTINCT doctor_id
        FROM analytics_events
        WHERE doctor_id IS NOT NULL
          AND (
            event_name IN ('login', 'page_view', 'navigation_click')
            OR (
              event_name = 'xray_analyzed'
              AND page_path = '/xray-planning'
              AND feature_name = 'xray_standalone'
            )
          )
          AND created_at >= ${current.start.toISOString()}
          AND created_at <= ${current.end.toISOString()}
        UNION
        SELECT doctor_id FROM session_doctors
      ),
      rx_doctors AS (
        SELECT DISTINCT doctor_id
        FROM analytics_events
        WHERE doctor_id IS NOT NULL
          AND event_name = 'xray_analyzed'
          AND page_path = '/xray-planning'
          AND feature_name = 'xray_standalone'
          AND created_at >= ${current.start.toISOString()}
          AND created_at <= ${current.end.toISOString()}
      ),
      active_doctors AS (
        SELECT doctor_id FROM all_event_doctors
        UNION
        SELECT doctor_id FROM session_doctors
        UNION
        SELECT id AS doctor_id
        FROM eligible_doctors
        WHERE last_login_at >= ${current.start.toISOString()}
          AND last_login_at <= ${current.end.toISOString()}
        UNION
        SELECT doctor_id FROM documented_doctors
      ),
      coverage_points AS (
        SELECT created_at AS observed_at FROM analytics_events
        UNION ALL
        SELECT started_at AS observed_at FROM analytics_sessions
        UNION ALL
        SELECT last_login_at AS observed_at FROM eligible_doctors
        WHERE last_login_at IS NOT NULL
        UNION ALL
        SELECT observed_at FROM clinical_records
      ),
      coverage_start AS (
        SELECT min(observed_at) AS value FROM coverage_points
      )
      SELECT
        d.id AS doctor_id,
        d.nome AS doctor_name,
        d.email AS doctor_email,
        (rx.doctor_id IS NOT NULL AND doc.doctor_id IS NULL) AS is_rx_only,
        (ent.doctor_id IS NOT NULL AND doc.doctor_id IS NULL) AS is_entered_without_documentation,
        (doc.doctor_id IS NOT NULL) AS is_documented,
        cs.value AS coverage_start
      FROM eligible_doctors d
      JOIN active_doctors active ON active.doctor_id = d.id
      LEFT JOIN rx_doctors rx ON rx.doctor_id = d.id
      LEFT JOIN entered_doctors ent ON ent.doctor_id = d.id
      LEFT JOIN documented_doctors doc ON doc.doctor_id = d.id
      CROSS JOIN coverage_start cs
    `);

    const rows = result.rows as unknown as UsageDoctorRow[];
    const rxOnly = rows.filter((row) => row.is_rx_only);
    const enteredWithoutDocumentation = rows.filter((row) => row.is_entered_without_documentation);
    const documented = rows.filter((row) => row.is_documented);
    const coverageStart = toIsoOrNull(rows[0]?.coverage_start);

    return {
      ...base,
      period: {
        start: current.start.toISOString(),
        end: current.end.toISOString(),
        timezone: TZ,
        bounds: "inclusive [start, end] UTC",
      },
      coverage: {
        ...base.coverage,
        start: coverageStart,
        empty: rows.length === 0,
      },
      activeDoctors: rows.length,
      rxOnlyDoctors: rxOnly.length,
      enteredWithoutDocumentationDoctors: enteredWithoutDocumentation.length,
      documentedDoctors: documented.length,
      overlap: {
        ...base.overlap,
        rxOnlyAndDocumentedDoctors: rows.filter((row) => row.is_rx_only && row.is_documented).length,
      },
      rxOnlyDoctorList: rxOnly.map((row) => ({
        name: row.doctor_name || "Médico sem nome",
        email: row.doctor_email,
      })),
      enteredWithoutDocumentationDoctorList: enteredWithoutDocumentation.map((row) => ({
        name: row.doctor_name || "Médico sem nome",
        email: row.doctor_email,
      })),
    };
  } catch (err) {
    logger.warn({ err }, "Unable to compute admin utilization cohorts");
    return {
      ...base,
      period: {
        start: current.start.toISOString(),
        end: current.end.toISOString(),
        timezone: TZ,
        bounds: "inclusive [start, end] UTC",
      },
      coverage: {
        ...base.coverage,
        unavailableReason: "As fontes clínicas/analíticas não estão disponíveis para este período.",
      },
    };
  }
}

export async function computeNavigationClickRanking(
  current: DateRange,
  executor: Pick<typeof db, "execute"> = db,
): Promise<NavigationClickRanking> {
  try {
    const result = await executor.execute(sql`
      WITH eligible_clicks AS (
        SELECT
          e.page_path AS route,
          CASE e.page_path
            WHEN '/agenda' THEN 'agenda'
            WHEN '/agenda-cirurgica' THEN 'agenda'
            WHEN '/dashboard' THEN 'dashboard'
            WHEN '/followup' THEN 'followup'
            WHEN '/followup-central' THEN 'followup'
            WHEN '/patients' THEN 'patients'
            WHEN '/patients/new' THEN 'patient'
            WHEN '/patients/:id' THEN 'patient'
            WHEN '/profile' THEN 'profile'
            WHEN '/regen' THEN 'regen'
            WHEN '/regen/caso/novo' THEN 'regen'
            WHEN '/regen/caso/:id' THEN 'regen'
            WHEN '/regen/consentimento' THEN 'regen'
            WHEN '/regen/orientacoes' THEN 'regen'
            WHEN '/regen/pesquisa' THEN 'regen'
            WHEN '/reports' THEN 'report'
            WHEN '/surgeries' THEN 'surgeries'
            WHEN '/surgeries/new' THEN 'surgery'
            WHEN '/surgeries/:id' THEN 'surgery'
            WHEN '/whatsapp-broadcast' THEN 'support'
            WHEN '/xray-planning' THEN 'xray'
          END AS feature,
          e.doctor_id,
          e.created_at
        FROM analytics_events e
        JOIN doctors d ON d.id = e.doctor_id
        WHERE e.event_name = 'navigation_click'
          AND e.page_path IS NOT NULL
          AND e.page_path IN (
            '/agenda', '/agenda-cirurgica', '/dashboard', '/followup',
            '/followup-central', '/patients', '/patients/new', '/patients/:id',
            '/profile', '/regen', '/regen/caso/novo', '/regen/caso/:id',
            '/regen/consentimento', '/regen/orientacoes', '/regen/pesquisa',
            '/reports', '/surgeries', '/surgeries/new', '/surgeries/:id',
            '/whatsapp-broadcast', '/xray-planning'
          )
          AND d.is_admin = false
          AND d.aprovado = true
          AND e.created_at >= ${current.start.toISOString()}
          AND e.created_at <= ${current.end.toISOString()}
      ),
      coverage_start AS (
        SELECT min(e.created_at) AS value
        FROM analytics_events e
        JOIN doctors d ON d.id = e.doctor_id
        WHERE e.event_name = 'navigation_click'
          AND e.page_path IS NOT NULL
          AND e.page_path IN (
            '/agenda', '/agenda-cirurgica', '/dashboard', '/followup',
            '/followup-central', '/patients', '/patients/new', '/patients/:id',
            '/profile', '/regen', '/regen/caso/novo', '/regen/caso/:id',
            '/regen/consentimento', '/regen/orientacoes', '/regen/pesquisa',
            '/reports', '/surgeries', '/surgeries/new', '/surgeries/:id',
            '/whatsapp-broadcast', '/xray-planning'
          )
          AND d.is_admin = false
          AND d.aprovado = true
      )
      SELECT
        ec.route,
        ec.feature,
        count(*)::int AS click_count,
        count(DISTINCT ec.doctor_id)::int AS unique_doctors,
        cs.value AS coverage_start
      FROM eligible_clicks ec
      CROSS JOIN coverage_start cs
      GROUP BY ec.route, ec.feature, cs.value
      ORDER BY click_count DESC, unique_doctors DESC, ec.route ASC, ec.feature ASC
      LIMIT 20
    `);
    const rows = result.rows as Array<{
      route: string;
      feature: string;
      click_count: number | string;
      unique_doctors: number | string;
      coverage_start: Date | string | null;
    }>;
    const coverageStart = toIsoOrNull(rows[0]?.coverage_start);
    return {
      bounds: "inclusive [period.start, period.end] UTC",
      coverageStart,
      empty: rows.length === 0,
      items: rows.map((row) => ({
        route: row.route,
        feature: row.feature,
        count: Number(row.click_count),
        uniqueDoctors: Number(row.unique_doctors),
      })),
    };
  } catch (err) {
    logger.warn({ err }, "Unable to compute navigation click ranking");
    return {
      bounds: "inclusive [period.start, period.end] UTC",
      coverageStart: null,
      empty: true,
      items: [],
      unavailableReason: "A coleta de navigation_click não está disponível.",
    };
  }
}

// ── Stripe MRR helper — joins subscription_items + prices ─────────────────────
/**
 * Normalises a price's unit_amount to a monthly value in BRL cents.
 * recurring.interval: 'day'|'week'|'month'|'year'
 * recurring.interval_count: number of intervals per billing cycle
 */
function toMonthlyCents(unitAmount: number, interval: string, intervalCount: number): number {
  const cnt = intervalCount || 1;
  switch (interval) {
    case "day":   return Math.round(unitAmount * 30 / cnt);
    case "week":  return Math.round(unitAmount * (30 / 7) / cnt);
    case "month": return Math.round(unitAmount / cnt);
    case "year":  return Math.round(unitAmount / (12 * cnt));
    default:      return 0;
  }
}

interface StripeMetrics {
  active: number; trial: number; pastDue: number; canceled: number;
  mrrCents: number | null;
  arrCents: number | null;
  arpuCents: number | null;
  churnRate: number | null;
  churnUnavailableReason: string | null;
  ltvCents: number | null;
  ltvUnavailableReason: string | null;
  source: "stripe" | "unavailable";
  unavailableReason?: string;
}

async function computeStripeMetrics(currentStart: Date, currentEnd: Date): Promise<StripeMetrics> {
  try {
    // 1. Subscription status counts
    const statusResult = await db.execute(sql`
      SELECT
        status,
        count(*)::int AS cnt
      FROM stripe.subscriptions
      WHERE status IN ('active', 'trialing', 'past_due', 'canceled')
      GROUP BY status
    `);
    const counts: Record<string, number> = {};
    for (const row of statusResult.rows as { status: string; cnt: number }[]) {
      counts[row.status] = Number(row.cnt);
    }
    const active  = counts["active"]   ?? 0;
    const trial   = counts["trialing"] ?? 0;
    const pastDue = counts["past_due"] ?? 0;
    const canceled = counts["canceled"] ?? 0;

    // 2. MRR: join subscription_items → prices, normalise to monthly
    const mrrResult = await db.execute(sql`
      SELECT
        si.quantity,
        p.unit_amount,
        p.recurring->>'interval'            AS interval,
        (p.recurring->>'interval_count')::int AS interval_count
      FROM stripe.subscription_items si
      JOIN stripe.subscriptions s ON s.id = si.subscription
      JOIN stripe.prices p ON p.id = si.price
       WHERE s.status = 'active'
        AND (si.deleted IS NULL OR si.deleted = false)
         AND p.unit_amount IS NOT NULL
         AND p.recurring->>'interval' IN ('day', 'week', 'month', 'year')
    `);
    type MrrRow = { quantity: number; unit_amount: number; interval: string; interval_count: number };
    let mrrCents = 0;
    for (const row of mrrResult.rows as MrrRow[]) {
      const qty = Number(row.quantity || 1);
      const unit = Number(row.unit_amount || 0);
      const interval = String(row.interval || "month");
      const cnt = Number(row.interval_count || 1);
      mrrCents += qty * toMonthlyCents(unit, interval, cnt);
    }

    const arrCents = mrrCents * 12;
    const arpuCents = active > 0 ? Math.round(mrrCents / active) : null;

    // 3. Gross logo churn = subscriptions ended in the window / subscriptions
    // active at the beginning of the window. This uses Stripe lifecycle dates,
    // not the current status as a proxy for historical state.
    const churnResult = await db.execute(sql`
      SELECT
        count(*) FILTER (
          WHERE ended_at IS NOT NULL
            AND ended_at >= extract(epoch from ${currentStart.toISOString()}::timestamptz)
            AND ended_at <= extract(epoch from ${currentEnd.toISOString()}::timestamptz)
        )::int AS churned,
        count(*) FILTER (
          WHERE created < extract(epoch from ${currentStart.toISOString()}::timestamptz)
            AND (
              ended_at IS NULL
              OR ended_at >= extract(epoch from ${currentStart.toISOString()}::timestamptz)
            )
        )::int AS active_at_start
      FROM stripe.subscriptions
      WHERE created IS NOT NULL
    `);
    const churnRow = churnResult.rows[0] as { churned: number; active_at_start: number } | undefined;
    const churned = Number(churnRow?.churned ?? 0);
    const activeAtStart = Number(churnRow?.active_at_start ?? 0);
    const churnRate = activeAtStart >= 5 ? pct(churned, activeAtStart) : null;
    const churnUnavailableReason = churnRate === null
      ? "Não há assinaturas ativas suficientes no início do período para calcular o churn com segurança."
      : null;

    const periodDays = Math.max(1, (currentEnd.getTime() - currentStart.getTime()) / 86_400_000);
    const monthlyChurnFraction = churnRate !== null
      ? 1 - Math.pow(1 - churnRate / 100, 30 / periodDays)
      : null;
    const ltvCents = arpuCents !== null && monthlyChurnFraction !== null && monthlyChurnFraction > 0
      ? Math.round(arpuCents / monthlyChurnFraction)
      : null;
    const ltvUnavailableReason = ltvCents === null
      ? churnRate === null
        ? churnUnavailableReason
        : "O LTV não é estimável enquanto o churn medido for zero."
      : null;

    return {
      active, trial, pastDue, canceled,
      mrrCents,
      arrCents,
      arpuCents,
      churnRate,
      churnUnavailableReason,
      ltvCents,
      ltvUnavailableReason,
      source: "stripe",
    };
  } catch (err) {
    return {
      active: 0, trial: 0, pastDue: 0, canceled: 0,
      mrrCents: null, arrCents: null, arpuCents: null,
      churnRate: null, churnUnavailableReason: null,
      ltvCents: null, ltvUnavailableReason: null,
      source: "unavailable",
      unavailableReason: "Os dados sincronizados do Stripe não estão disponíveis.",
    };
  }
}

// ── Main endpoint ─────────────────────────────────────────────────────────────

router.get("/admin/analytics", requireAdmin, async (req, res): Promise<void> => {
  const rawPeriod = String(req.query["period"] ?? "30d");
  const VALID_PERIODS: Period[] = ["7d", "30d", "90d", "12m"];
  const period: Period = VALID_PERIODS.includes(rawPeriod as Period) ? (rawPeriod as Period) : "30d";

  const { current, prior } = resolvePeriod(period);

  // ── Data availability ───────────────────────────────────────────────────────
  const [doctorDataStart, analyticsDataStart, auditDataStart] = await Promise.all([
    getDataStart("doctors"),
    getDataStart("analytics_sessions"),
    getDataStart("audit_logs"),
  ]);

  const dataAvailability = {
    doctors:    doctorDataStart?.toISOString() ?? null,
    analytics:  analyticsDataStart?.toISOString() ?? null,
    auditLogs:  auditDataStart?.toISOString() ?? null,
    note: analyticsDataStart && analyticsDataStart > current.start
      ? `A coleta analítica começou em ${analyticsDataStart.toISOString()}; o período selecionado começa antes da instrumentação.`
      : null,
  };

  // These cohorts deliberately combine first-party analytics with observable
  // clinical records. They are independent from the legacy KPI counters below
  // so missing tracker events do not erase documented author activity.
  const [usageFunnel, navigationClickRanking] = await Promise.all([
    computeUsageFunnel(current),
    computeNavigationClickRanking(current),
  ]);

  // ── Stripe metrics (parallel) ───────────────────────────────────────────────
  const stripeMetrics = await computeStripeMetrics(current.start, current.end);

  // ── Doctor KPIs ─────────────────────────────────────────────────────────────
  const [activeDoctorsCurrent, activeDoctorsPrior, newDoctorsCurrent, newDoctorsPrior] = await Promise.all([
    db.select({ cnt: sql<number>`count(*)::int` })
      .from(doctorsTable)
      .where(and(
        eq(doctorsTable.isAdmin, false), eq(doctorsTable.aprovado, true),
        gte(doctorsTable.lastLoginAt, current.start), lte(doctorsTable.lastLoginAt, current.end),
      )),
    db.select({ cnt: sql<number>`count(*)::int` })
      .from(doctorsTable)
      .where(and(
        eq(doctorsTable.isAdmin, false), eq(doctorsTable.aprovado, true),
        gte(doctorsTable.lastLoginAt, prior.start), lte(doctorsTable.lastLoginAt, prior.end),
      )),
    db.select({ cnt: sql<number>`count(*)::int` })
      .from(doctorsTable)
      .where(and(eq(doctorsTable.isAdmin, false), gte(doctorsTable.createdAt, current.start), lte(doctorsTable.createdAt, current.end))),
    db.select({ cnt: sql<number>`count(*)::int` })
      .from(doctorsTable)
      .where(and(eq(doctorsTable.isAdmin, false), gte(doctorsTable.createdAt, prior.start), lte(doctorsTable.createdAt, prior.end))),
  ]);

  const activeUsersCurrent = Number(activeDoctorsCurrent[0]?.cnt ?? 0);
  const activeUsersPrior   = Number(activeDoctorsPrior[0]?.cnt ?? 0);
  const newDoctorsCurrentVal = Number(newDoctorsCurrent[0]?.cnt ?? 0);
  const newDoctorsPriorVal   = Number(newDoctorsPrior[0]?.cnt ?? 0);

  // ── Activation rate ─────────────────────────────────────────────────────────
  let activationRate: number | null = null;
  try {
    const actResult = await db.execute(sql`
      SELECT
        count(DISTINCT d.id) FILTER (WHERE s.doctor_id IS NOT NULL)::int AS activated,
        count(DISTINCT d.id)::int AS total
      FROM doctors d
      LEFT JOIN surgeries s ON s.doctor_id = d.id
        AND s.created_at >= ${current.start.toISOString()} AND s.created_at <= ${current.end.toISOString()}
      WHERE d.is_admin = false
        AND d.created_at >= ${current.start.toISOString()} AND d.created_at <= ${current.end.toISOString()}
    `);
    const ar = actResult.rows[0] as { activated: number; total: number } | undefined;
    if (ar && ar.total > 0) activationRate = pct(ar.activated, ar.total);
  } catch { /* ignored */ }

  // ── Analytics session KPIs ──────────────────────────────────────────────────
  const analyticsAvailable = analyticsDataStart != null;
  interface SessionMetrics {
    visitsCurrent: number; visitsPrior: number;
    uniqueVisitorsCurrent: number; uniqueVisitorsPrior: number;
    conversionRate: number | null;
    source: "analytics" | "unavailable";
    unavailableReason?: string;
  }
  let sessionMetrics: SessionMetrics = {
    visitsCurrent: 0, visitsPrior: 0,
    uniqueVisitorsCurrent: 0, uniqueVisitorsPrior: 0,
    conversionRate: null,
    source: "unavailable",
    unavailableReason: "A coleta analítica ainda não foi iniciada.",
  };

  let funnelMetrics: {
    acquisitionVisit: number; register: number; checkoutStarted: number; subscriptionActivated: number;
    acquisitionToRegisterPct: number | null;
    registerToCheckoutPct: number | null;
    checkoutToSubscriptionPct: number | null;
    totalConversionPct: number | null;
    source: "analytics" | "unavailable";
    unavailableReason?: string;
  } = {
    acquisitionVisit: 0, register: 0, checkoutStarted: 0, subscriptionActivated: 0,
    acquisitionToRegisterPct: null, registerToCheckoutPct: null,
    checkoutToSubscriptionPct: null, totalConversionPct: null,
    source: "unavailable",
    unavailableReason: "A coleta analítica ainda não foi iniciada.",
  };

  let topFeatures: { featureName: string; count: number }[] = [];
  let topPages: { pagePath: string; count: number }[] = [];
  let standaloneXrayUsage: {
    source: "analytics" | "unavailable";
    unavailableReason?: string;
    totalDoctors: number;
    totalAccesses: number;
    totalAnalyses: number;
    doctors: {
      doctorId: number;
      doctorName: string;
      doctorEmail: string;
      patientCount: number;
      accessCount: number;
      analysisCount: number;
      firstUsedAt: string;
      lastUsedAt: string;
      usageDates: string[];
    }[];
  } = {
    source: "unavailable",
    unavailableReason: "A coleta analítica ainda não foi iniciada.",
    totalDoctors: 0,
    totalAccesses: 0,
    totalAnalyses: 0,
    doctors: [],
  };

  if (analyticsAvailable) {
    const [currSess, priorSess] = await Promise.all([
      db.select({
        total:  sql<number>`count(*)::int`,
        unique: sql<number>`count(distinct session_id)::int`,
      }).from(analyticsSessionsTable).where(and(
        gte(analyticsSessionsTable.startedAt, current.start),
        lte(analyticsSessionsTable.startedAt, current.end),
      )),
      db.select({
        total:  sql<number>`count(*)::int`,
        unique: sql<number>`count(distinct session_id)::int`,
      }).from(analyticsSessionsTable).where(and(
        gte(analyticsSessionsTable.startedAt, prior.start),
        lte(analyticsSessionsTable.startedAt, prior.end),
      )),
    ]);

    const visitsCurrent = Number(currSess[0]?.total ?? 0);
    const visitsPrior   = Number(priorSess[0]?.total ?? 0);
    const uniqueCurrent = Number(currSess[0]?.unique ?? 0);
    const uniquePrior   = Number(priorSess[0]?.unique ?? 0);

    // Funnel: acquisition_visit → register → checkout_started → subscription_activated
    const funnelResult = await db.execute(sql`
      SELECT
        event_name,
        count(*)::int AS cnt
      FROM analytics_events
      WHERE event_name IN ('acquisition_visit', 'register', 'checkout_started', 'subscription_activated')
        AND created_at >= ${current.start.toISOString()}
        AND created_at <= ${current.end.toISOString()}
      GROUP BY event_name
    `);
    const funnelMap: Record<string, number> = {};
    for (const row of funnelResult.rows as { event_name: string; cnt: number }[]) {
      funnelMap[row.event_name] = Number(row.cnt);
    }
    const fAcq   = funnelMap["acquisition_visit"]      ?? 0;
    const fReg   = funnelMap["register"]               ?? 0;
    const fCko   = funnelMap["checkout_started"]       ?? 0;
    const fSub   = funnelMap["subscription_activated"] ?? 0;

    funnelMetrics = {
      acquisitionVisit: fAcq,
      register: fReg,
      checkoutStarted: fCko,
      subscriptionActivated: fSub,
      acquisitionToRegisterPct: pct(fReg, fAcq),
      registerToCheckoutPct:    pct(fCko, fReg),
      checkoutToSubscriptionPct: pct(fSub, fCko),
      totalConversionPct: pct(fSub, fAcq),
      source: "analytics",
    };

    // Conversion rate (registrations / unique visitors)
    const conversionRate = pct(fReg, uniqueCurrent);

    sessionMetrics = {
      visitsCurrent,
      visitsPrior,
      uniqueVisitorsCurrent: uniqueCurrent,
      uniqueVisitorsPrior: uniquePrior,
      conversionRate,
      source: "analytics",
    };

    // Top features (feature_name non-null events)
    const featResult = await db.execute(sql`
      SELECT feature_name, count(*)::int AS cnt
      FROM analytics_events
      WHERE feature_name IS NOT NULL
        AND created_at >= ${current.start.toISOString()}
        AND created_at <= ${current.end.toISOString()}
      GROUP BY feature_name
      ORDER BY cnt DESC
      LIMIT 20
    `);
    topFeatures = (featResult.rows as { feature_name: string; cnt: number }[]).map((r) => ({
      featureName: r.feature_name,
      count: Number(r.cnt),
    }));

    // Top pages
    const pageResult = await db.execute(sql`
      SELECT page_path, count(*)::int AS cnt
      FROM analytics_events
      WHERE event_name = 'page_view'
        AND page_path IS NOT NULL
        AND created_at >= ${current.start.toISOString()}
        AND created_at <= ${current.end.toISOString()}
      GROUP BY page_path
      ORDER BY cnt DESC
      LIMIT 20
    `);
    topPages = (pageResult.rows as { page_path: string; cnt: number }[]).map((r) => ({
      pagePath: r.page_path,
      count: Number(r.cnt),
    }));

    // Standalone RX usage: only doctors with no patient currently registered.
    // The route path is the product boundary; no patient identifiers or clinical
    // values are included in this aggregate.
    const xrayUsageResult = await db.execute(sql`
      WITH patient_totals AS (
        SELECT doctor_id, count(*)::int AS patient_count
        FROM patients
        GROUP BY doctor_id
      ),
      usage_events AS (
        SELECT
          e.doctor_id,
          count(*) FILTER (
            WHERE e.event_name = 'page_view'
              AND e.page_path = '/xray-planning'
          )::int AS access_count,
          count(*) FILTER (
            WHERE e.event_name = 'xray_analyzed'
              AND e.page_path = '/xray-planning'
          )::int AS analysis_count,
          min(e.created_at) AS first_used_at,
          max(e.created_at) AS last_used_at,
          jsonb_agg(
            DISTINCT to_char(e.created_at AT TIME ZONE ${TZ}, 'YYYY-MM-DD')
            ORDER BY to_char(e.created_at AT TIME ZONE ${TZ}, 'YYYY-MM-DD')
          ) AS usage_dates
        FROM analytics_events e
        WHERE e.doctor_id IS NOT NULL
          AND e.page_path = '/xray-planning'
          AND e.event_name IN ('page_view', 'xray_analyzed')
          AND e.created_at >= ${current.start}
          AND e.created_at <= ${current.end}
        GROUP BY e.doctor_id
      )
      SELECT
        d.id AS doctor_id,
        d.nome AS doctor_name,
        d.email AS doctor_email,
        coalesce(pt.patient_count, 0)::int AS patient_count,
        u.access_count,
        u.analysis_count,
        u.first_used_at,
        u.last_used_at,
        u.usage_dates
      FROM usage_events u
      JOIN doctors d ON d.id = u.doctor_id
      LEFT JOIN patient_totals pt ON pt.doctor_id = d.id
      WHERE d.is_admin = false
        AND coalesce(pt.patient_count, 0) = 0
      ORDER BY u.last_used_at DESC
      LIMIT 200
    `);
    const xrayRows = xrayUsageResult.rows as Array<{
      doctor_id: number | string;
      doctor_name: string | null;
      doctor_email: string;
      patient_count: number | string;
      access_count: number | string;
      analysis_count: number | string;
      first_used_at: Date | string;
      last_used_at: Date | string;
      usage_dates: string[] | null;
    }>;
    const standaloneDoctors = xrayRows.map((row) => ({
      doctorId: Number(row.doctor_id),
      doctorName: row.doctor_name || "Médico sem nome",
      doctorEmail: row.doctor_email,
      patientCount: Number(row.patient_count),
      accessCount: Number(row.access_count),
      analysisCount: Number(row.analysis_count),
      firstUsedAt: new Date(row.first_used_at).toISOString(),
      lastUsedAt: new Date(row.last_used_at).toISOString(),
      usageDates: Array.isArray(row.usage_dates) ? row.usage_dates.map(String) : [],
    }));
    standaloneXrayUsage = {
      source: "analytics",
      totalDoctors: standaloneDoctors.length,
      totalAccesses: standaloneDoctors.reduce((sum, doctor) => sum + doctor.accessCount, 0),
      totalAnalyses: standaloneDoctors.reduce((sum, doctor) => sum + doctor.analysisCount, 0),
      doctors: standaloneDoctors,
    };
  }

  // ── Support ticket KPIs ─────────────────────────────────────────────────────
  const [openTickets, criticalTickets] = await Promise.all([
    db.select({ cnt: sql<number>`count(*)::int` })
      .from(adminContactMessages)
      .where(sql`(ticket_status IS NULL OR ticket_status IN ('open', 'in_progress'))`),
    db.select({ cnt: sql<number>`count(*)::int` })
      .from(adminContactMessages)
      .where(and(
        eq(adminContactMessages.ticketPriority, "critical"),
        sql`(ticket_status IS NULL OR ticket_status IN ('open', 'in_progress'))`,
      )),
  ]);

  // ── Audit log / API KPIs ────────────────────────────────────────────────────
  const auditAvailable = auditDataStart != null;
  interface ApiMetrics {
    requestsCurrent: number; requestsPrior: number;
    errorRateCurrent: number | null;
    p95DurationMs: number | null;
    source: "audit_logs" | "unavailable";
    unavailableReason?: string;
  }
  let apiMetrics: ApiMetrics = {
    requestsCurrent: 0, requestsPrior: 0,
    errorRateCurrent: null,
    p95DurationMs: null,
    source: "unavailable",
    unavailableReason: "Não há dados de auditoria no período selecionado.",
  };
  if (auditAvailable) {
    const [currAudit, priorAudit, errorAudit, latencyAudit] = await Promise.all([
      db.select({ cnt: sql<number>`count(*)::int` }).from(auditLogsTable)
        .where(and(gte(auditLogsTable.createdAt, current.start), lte(auditLogsTable.createdAt, current.end))),
      db.select({ cnt: sql<number>`count(*)::int` }).from(auditLogsTable)
        .where(and(gte(auditLogsTable.createdAt, prior.start), lte(auditLogsTable.createdAt, prior.end))),
      db.select({ errs: sql<number>`count(*)::int` }).from(auditLogsTable)
        .where(and(gte(auditLogsTable.createdAt, current.start), lte(auditLogsTable.createdAt, current.end), gte(auditLogsTable.responseStatus, 500))),
      db.execute(sql`
        SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_ms
        FROM audit_logs
        WHERE created_at >= ${current.start.toISOString()}
          AND created_at <= ${current.end.toISOString()}
          AND duration_ms IS NOT NULL
      `),
    ]);
    const reqCurr  = Number(currAudit[0]?.cnt ?? 0);
    const reqPrior = Number(priorAudit[0]?.cnt ?? 0);
    const errors   = Number(errorAudit[0]?.errs ?? 0);
    const p95Raw = (latencyAudit.rows[0] as { p95_ms: number | string | null } | undefined)?.p95_ms;
    apiMetrics = {
      requestsCurrent: reqCurr,
      requestsPrior:   reqPrior,
      errorRateCurrent: pct(errors, reqCurr),
      p95DurationMs: p95Raw == null ? null : Math.round(Number(p95Raw)),
      source: "audit_logs",
    };
  }

  // ── Time series ─────────────────────────────────────────────────────────────
  const [dailyRegistrations, dailyActiveSessions, dailyApiRequests] = await Promise.all([
    db.execute(sql`
      SELECT
        (created_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
        count(*)::int AS new_doctors
      FROM doctors
      WHERE is_admin = false
        AND created_at >= ${current.start.toISOString()}
        AND created_at <= ${current.end.toISOString()}
      GROUP BY 1 ORDER BY 1
    `),
    analyticsAvailable ? db.execute(sql`
      SELECT
        (started_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
        count(*)::int AS sessions,
        count(DISTINCT CASE WHEN doctor_id IS NOT NULL THEN doctor_id END)::int AS active_users
      FROM analytics_sessions
      WHERE started_at >= ${current.start.toISOString()}
        AND started_at <= ${current.end.toISOString()}
      GROUP BY 1 ORDER BY 1
    `) : Promise.resolve({ rows: [] }),
    auditAvailable ? db.execute(sql`
      SELECT
        (created_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
        count(*)::int AS requests,
        count(*) FILTER (WHERE response_status >= 500)::int AS errors
      FROM audit_logs
      WHERE created_at >= ${current.start.toISOString()}
        AND created_at <= ${current.end.toISOString()}
      GROUP BY 1 ORDER BY 1
    `) : Promise.resolve({ rows: [] }),
  ]);

  // Revenue time series from paid invoices
  let dailyRevenue: { day: string; amountPaidCents: number }[] = [];
  try {
    const invResult = await db.execute(sql`
      SELECT
        (to_timestamp(created) AT TIME ZONE 'America/Sao_Paulo')::date AS day,
        sum(amount_paid)::bigint AS amount_paid_cents
      FROM stripe.invoices
      WHERE paid = true
        AND status = 'paid'
        AND created >= extract(epoch from ${current.start.toISOString()}::timestamptz)
        AND created <= extract(epoch from ${current.end.toISOString()}::timestamptz)
      GROUP BY 1 ORDER BY 1
    `);
    dailyRevenue = (invResult.rows as { day: string; amount_paid_cents: number | string }[]).map((r) => ({
      day: String(r.day),
      amountPaidCents: Number(r.amount_paid_cents),
    }));
  } catch { /* invoices not available */ }

  // ── Subscription status distribution ────────────────────────────────────────
  let subscriptionDistribution: { status: string; count: number }[] = [];
  try {
    const distResult = await db.execute(sql`
      SELECT status, count(*)::int AS cnt
      FROM stripe.subscriptions
      GROUP BY status ORDER BY cnt DESC
    `);
    subscriptionDistribution = (distResult.rows as { status: string; cnt: number }[]).map((r) => ({
      status: r.status,
      count: Number(r.cnt),
    }));
  } catch { /* ignored */ }

  // ── Campaigns performance ────────────────────────────────────────────────────
  // First-touch attribution is deliberately narrow: the exact utm_campaign on
  // an anonymous session must match the campaign and the registration must occur
  // in that same opaque browser session.
  let campaignPerformance: {
    id: number; name: string; status: string; channel: string;
    utmCampaign: string | null;
    budgetCents: number | null;
    acquisitionVisits: number | null;
    registrations: number | null;
    cacCents: number | null;
    revenueCents: number | null;
    roiPercent: number | null;
    source: string;
    unavailableReason?: string;
  }[] = [];
  const campaigns = await db.select().from(campaignsTable).orderBy(desc(campaignsTable.createdAt)).limit(20);
  for (const campaign of campaigns) {
    const camStart = new Date(Math.max(
      (campaign.startsAt ?? current.start).getTime(),
      current.start.getTime(),
    ));
    const camEnd = new Date(Math.min(
      (campaign.endsAt ?? current.end).getTime(),
      current.end.getTime(),
    ));

    if (!analyticsAvailable || !campaign.utmCampaign || camStart >= camEnd) {
      campaignPerformance.push({
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        channel: campaign.channel,
        utmCampaign: campaign.utmCampaign,
        budgetCents: campaign.budgetCents,
        acquisitionVisits: null,
        registrations: null,
        cacCents: null,
        revenueCents: null,
        roiPercent: null,
        source: "unavailable",
        unavailableReason: !analyticsAvailable
          ? "A coleta analítica ainda não foi iniciada."
          : !campaign.utmCampaign
            ? "Configure a utm_campaign para habilitar a atribuição."
            : "A campanha não coincide com o período selecionado.",
      });
      continue;
    }

    try {
      const perf = await db.execute(sql`
        SELECT
          count(DISTINCT e.session_id) FILTER (
            WHERE e.event_name = 'acquisition_visit'
          )::int AS acquisition_visits,
          count(DISTINCT e.doctor_id) FILTER (
            WHERE e.event_name = 'register' AND e.doctor_id IS NOT NULL
          )::int AS registrations
        FROM analytics_sessions s
        LEFT JOIN analytics_events e
          ON e.session_id = s.session_id
         AND e.created_at >= ${camStart}
         AND e.created_at <= ${camEnd}
        WHERE lower(s.utm_campaign) = lower(${campaign.utmCampaign})
          AND s.started_at >= ${camStart}
          AND s.started_at <= ${camEnd}
      `);
      const perfRow = perf.rows[0] as {
        acquisition_visits: number | string;
        registrations: number | string;
      } | undefined;
      const acquisitionVisits = Number(perfRow?.acquisition_visits ?? 0);
      const registrations = Number(perfRow?.registrations ?? 0);
      const cacCents = campaign.budgetCents != null && registrations > 0
        ? Math.round(campaign.budgetCents / registrations)
        : null;

      let revenueCents: number | null = null;
      try {
        const attributedRevenue = await db.execute(sql`
          WITH attributed_doctors AS (
            SELECT DISTINCT e.doctor_id
            FROM analytics_sessions s
            JOIN analytics_events e
              ON e.session_id = s.session_id
             AND e.event_name = 'register'
             AND e.doctor_id IS NOT NULL
            WHERE lower(s.utm_campaign) = lower(${campaign.utmCampaign})
              AND e.created_at >= ${camStart}
              AND e.created_at <= ${camEnd}
          )
          SELECT coalesce(sum(i.amount_paid), 0)::bigint AS revenue_cents
          FROM stripe.invoices i
          JOIN doctors d ON d.stripe_customer_id = i.customer
          JOIN attributed_doctors a ON a.doctor_id = d.id
          WHERE i.status = 'paid'
            AND i.created >= extract(epoch from ${camStart.toISOString()}::timestamptz)
            AND i.created <= extract(epoch from ${camEnd.toISOString()}::timestamptz)
        `);
        revenueCents = Number(
          (attributedRevenue.rows[0] as { revenue_cents: number | string } | undefined)?.revenue_cents ?? 0,
        );
      } catch {
        revenueCents = null;
      }

      const roiPercent = campaign.budgetCents != null && campaign.budgetCents > 0 && revenueCents != null
        ? Math.round(((revenueCents - campaign.budgetCents) / campaign.budgetCents) * 10_000) / 100
        : null;

      campaignPerformance.push({
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        channel: campaign.channel,
        utmCampaign: campaign.utmCampaign,
        budgetCents: campaign.budgetCents,
        acquisitionVisits,
        registrations,
        cacCents,
        revenueCents,
        roiPercent,
        source: "analytics",
        unavailableReason: cacCents === null
          ? registrations === 0 ? "Não há cadastros atribuídos para calcular o CAC." : "A campanha não possui orçamento."
          : revenueCents === null ? "A receita atribuída do Stripe não está disponível." : undefined,
      });
    } catch {
      campaignPerformance.push({
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        channel: campaign.channel,
        utmCampaign: campaign.utmCampaign,
        budgetCents: campaign.budgetCents,
        acquisitionVisits: null,
        registrations: null,
        cacCents: null,
        revenueCents: null,
        roiPercent: null,
        source: "unavailable",
        unavailableReason: "Não foi possível calcular a atribuição da campanha.",
      });
    }
  }

  // ── Web Vitals summary ───────────────────────────────────────────────────────
  interface VitalsMetrics {
    lcpP75Ms: number | null; clsP75: number | null;
    source: "web_vitals" | "unavailable";
    unavailableReason?: string;
  }
  let vitalsMetrics: VitalsMetrics = {
    lcpP75Ms: null, clsP75: null,
    source: "unavailable",
    unavailableReason: "Ainda não há dados de Web Vitals.",
  };
  try {
    const vitResult = await db.execute(sql`
      SELECT
        metric_name,
        percentile_cont(0.75) WITHIN GROUP (ORDER BY value) AS p75
      FROM web_vitals
      WHERE created_at >= ${current.start.toISOString()}
        AND created_at <= ${current.end.toISOString()}
        AND metric_name IN ('LCP', 'CLS')
        AND value IS NOT NULL
      GROUP BY metric_name
    `);
    const vRows = vitResult.rows as { metric_name: string; p75: number }[];
    const lcpRow = vRows.find((r) => r.metric_name === "LCP");
    const clsRow = vRows.find((r) => r.metric_name === "CLS");
    vitalsMetrics = {
      lcpP75Ms: lcpRow ? Math.round(lcpRow.p75) : null,
      clsP75:   clsRow ? Math.round(clsRow.p75 * 1000) / 1000 : null,
      source: "web_vitals",
    };
  } catch { /* not yet populated */ }

  // ── Cohort retention ────────────────────────────────────────────────────────
  // Defensible only when analytics data covers ≥2× period length
  let retentionAvailabilityNote: string | null = (() => {
    if (!analyticsDataStart) return "A coleta analítica ainda não foi iniciada.";
    const daysSinceStart = (Date.now() - analyticsDataStart.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceStart < current.days * 2) {
      return `Histórico insuficiente para coortes de retenção: são necessários ${current.days * 2} dias e há ${Math.floor(daysSinceStart)}.`;
    }
    return null;
  })();
  let retentionCohorts: {
    cohortWeek: string;
    cohortSize: number;
    week1Percent: number | null;
    week2Percent: number | null;
    week4Percent: number | null;
  }[] = [];

  if (!retentionAvailabilityNote) {
    try {
      const retentionRows = await db.execute(sql`
        WITH cohort_members AS (
          SELECT
            d.id AS doctor_id,
            d.created_at,
            date_trunc('week', d.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS cohort_week
          FROM doctors d
          WHERE d.is_admin = false
            AND d.created_at >= ${current.start}
            AND d.created_at <= ${current.end}
        ),
        cohort_sizes AS (
          SELECT cohort_week, count(*)::int AS cohort_size
          FROM cohort_members
          GROUP BY cohort_week
        ),
        activity AS (
          SELECT DISTINCT
            c.doctor_id,
            c.cohort_week,
            floor(extract(epoch FROM (s.started_at - c.created_at)) / 604800)::int AS week_index
          FROM cohort_members c
          JOIN analytics_sessions s ON s.doctor_id = c.doctor_id
          WHERE s.started_at >= c.created_at
            AND s.started_at <= ${current.end}
        )
        SELECT
          cs.cohort_week::text,
          cs.cohort_size,
          CASE WHEN cs.cohort_week <= (${current.end}::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date - 14
            THEN round(100.0 * count(DISTINCT a.doctor_id) FILTER (WHERE a.week_index = 1) / nullif(cs.cohort_size, 0), 1)
            ELSE NULL END AS week1_percent,
          CASE WHEN cs.cohort_week <= (${current.end}::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date - 21
            THEN round(100.0 * count(DISTINCT a.doctor_id) FILTER (WHERE a.week_index = 2) / nullif(cs.cohort_size, 0), 1)
            ELSE NULL END AS week2_percent,
          CASE WHEN cs.cohort_week <= (${current.end}::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date - 35
            THEN round(100.0 * count(DISTINCT a.doctor_id) FILTER (WHERE a.week_index = 4) / nullif(cs.cohort_size, 0), 1)
            ELSE NULL END AS week4_percent
        FROM cohort_sizes cs
        LEFT JOIN activity a ON a.cohort_week = cs.cohort_week
        GROUP BY cs.cohort_week, cs.cohort_size
        ORDER BY cs.cohort_week DESC
        LIMIT 12
      `);
      retentionCohorts = (retentionRows.rows as {
        cohort_week: string;
        cohort_size: number | string;
        week1_percent: number | string | null;
        week2_percent: number | string | null;
        week4_percent: number | string | null;
      }[]).map((row) => ({
        cohortWeek: row.cohort_week,
        cohortSize: Number(row.cohort_size),
        week1Percent: row.week1_percent == null ? null : Number(row.week1_percent),
        week2Percent: row.week2_percent == null ? null : Number(row.week2_percent),
        week4Percent: row.week4_percent == null ? null : Number(row.week4_percent),
      }));
      if (retentionCohorts.length === 0) {
        retentionAvailabilityNote = "Não há coortes de cadastro elegíveis no período selecionado.";
      }
    } catch {
      retentionAvailabilityNote = "Não foi possível calcular as coortes de retenção.";
    }
  }

  // ── Assemble response ────────────────────────────────────────────────────────
  res.json({
    meta: {
      period,
      timezone: TZ,
      range:      { start: current.start.toISOString(), end: current.end.toISOString(), days: current.days },
      priorRange: { start: prior.start.toISOString(),   end: prior.end.toISOString(),   days: prior.days },
      dataAvailability,
      generatedAt: new Date().toISOString(),
    },

    kpis: {
      activeUsers: {
        current: activeUsersCurrent, prior: activeUsersPrior,
        deltaPercent: delta(activeUsersCurrent, activeUsersPrior),
        source: "doctors.last_login_at",
      },
      newDoctors: {
        current: newDoctorsCurrentVal, prior: newDoctorsPriorVal,
        deltaPercent: delta(newDoctorsCurrentVal, newDoctorsPriorVal),
        source: "doctors.created_at",
      },
      activationRate: {
        current: activationRate,
        source: activationRate !== null ? "surgeries" : "unavailable",
        unavailableReason: activationRate === null ? "Não há novos médicos no período." : undefined,
      },
      subscriptions: {
        active: stripeMetrics.active,
        trial:  stripeMetrics.trial,
        pastDue: stripeMetrics.pastDue,
        canceled: stripeMetrics.canceled,
        distribution: subscriptionDistribution,
        source: stripeMetrics.source,
        unavailableReason: stripeMetrics.unavailableReason,
      },
      revenue: {
        mrrCents:  stripeMetrics.mrrCents,
        arrCents:  stripeMetrics.arrCents,
        arpuCents: stripeMetrics.arpuCents,
        churnRate: stripeMetrics.churnRate,
        churnUnavailableReason: stripeMetrics.churnUnavailableReason,
        ltvCents: stripeMetrics.ltvCents,
        ltvUnavailableReason: stripeMetrics.ltvUnavailableReason,
        source: stripeMetrics.source,
        unavailableReason: stripeMetrics.unavailableReason,
      },
      visits: {
        current:      sessionMetrics.visitsCurrent,
        prior:        sessionMetrics.visitsPrior,
        uniqueCurrent: sessionMetrics.uniqueVisitorsCurrent,
        uniquePrior:   sessionMetrics.uniqueVisitorsPrior,
        conversionRate: sessionMetrics.conversionRate,
        source: sessionMetrics.source,
        unavailableReason: sessionMetrics.unavailableReason,
      },
      support: {
        openTickets:     Number(openTickets[0]?.cnt ?? 0),
        criticalTickets: Number(criticalTickets[0]?.cnt ?? 0),
        source: "admin_contact_messages",
      },
      api: {
        requestsCurrent: apiMetrics.requestsCurrent,
        requestsPrior:   apiMetrics.requestsPrior,
        errorRateCurrent: apiMetrics.errorRateCurrent,
        p95DurationMs: apiMetrics.p95DurationMs,
        source: apiMetrics.source,
        unavailableReason: apiMetrics.unavailableReason,
      },
    },

    funnel: funnelMetrics,

    usageFunnel,

    navigationClickRanking,

    topFeatures: analyticsAvailable
      ? { data: topFeatures, source: "analytics" }
      : { data: [], source: "unavailable", unavailableReason: "A coleta analítica ainda não foi iniciada." },

    topPages: analyticsAvailable
      ? { data: topPages, source: "analytics" }
      : { data: [], source: "unavailable", unavailableReason: "A coleta analítica ainda não foi iniciada." },

    timeSeries: {
      dailyRegistrations: (dailyRegistrations.rows as { day: string; new_doctors: number }[])
        .map((r) => ({ day: String(r.day), newDoctors: Number(r.new_doctors) })),
      dailySessions: analyticsAvailable
        ? (dailyActiveSessions.rows as { day: string; sessions: number; active_users: number }[])
            .map((r) => ({ day: String(r.day), sessions: Number(r.sessions), activeUsers: Number(r.active_users) }))
        : [],
      dailyApiRequests: auditAvailable
        ? (dailyApiRequests.rows as { day: string; requests: number; errors: number }[])
            .map((r) => ({ day: String(r.day), requests: Number(r.requests), errors: Number(r.errors) }))
        : [],
      dailyRevenue,
    },

    retention: {
      source: retentionAvailabilityNote ? "unavailable" : "analytics",
      unavailableReason: retentionAvailabilityNote ?? undefined,
      cohorts: retentionCohorts,
    },

    campaigns: campaignPerformance,

    webVitals: vitalsMetrics,

    standaloneXrayUsage,
  });
});

export default router;
