import { hasActiveTemporaryAccess } from "./temporaryAccess";
import { resolveDoctorLocale, type SupportedLocale } from "./locale";
import { message } from "./locale-catalog";
import { db, doctorsTable } from "@workspace/docregen-db";
import { eq, sql } from "drizzle-orm";

export type SubscriptionAccessBody = {
  canWrite: boolean;
  isFree: boolean;
  status: unknown;
  currentPeriodEnd: unknown;
  cancelAtPeriodEnd: boolean;
  temporaryAccessExpiresAt?: string;
  error?: string;
  code?: "SUBSCRIPTION_STATUS_UNAVAILABLE";
};

type BillingDoctor = {
  isAdmin: boolean | null;
  isFree: boolean | null;
  idioma: string | null;
  stripeCustomerId: string | null;
  temporaryAccessExpiresAt: Date | null;
};

type SubscriptionRow = {
  status?: unknown;
  current_period_end?: unknown;
  cancel_at_period_end?: unknown;
};

export type SubscriptionAccessResult =
  | { httpStatus: 200; body: SubscriptionAccessBody }
  | { httpStatus: 404; body: { error: string } }
  | { httpStatus: 503; body: SubscriptionAccessBody };

export type SubscriptionAccessDependencies = {
  findDoctor: (doctorId: number) => Promise<BillingDoctor | undefined>;
  findLatestSubscription: (stripeCustomerId: string) => Promise<SubscriptionRow | undefined>;
  onError?: (error: unknown, operation: "doctor" | "subscription") => void;
};

function unavailable(locale: SupportedLocale): SubscriptionAccessResult {
  return {
    httpStatus: 503,
    body: {
      canWrite: false,
      isFree: false,
      status: "unknown",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      code: "SUBSCRIPTION_STATUS_UNAVAILABLE",
      error: message(locale, "subscriptionStatusUnavailable"),
    },
  };
}

/**
 * Resolves write access from local account and synchronized Stripe data.
 * Every dependency failure is deliberately fail-closed.
 */
export async function resolveSubscriptionAccess(
  doctorId: number,
  dependencies: SubscriptionAccessDependencies,
): Promise<SubscriptionAccessResult> {
  let doctor: BillingDoctor | undefined;
  try {
    doctor = await dependencies.findDoctor(doctorId);
  } catch (error) {
    dependencies.onError?.(error, "doctor");
    return unavailable("pt-BR");
  }

  if (!doctor) {
    return { httpStatus: 404, body: { error: message("pt-BR", "doctorNotFound") } };
  }

  const locale = resolveDoctorLocale(doctor.idioma);
  if (doctor.isAdmin || doctor.isFree) {
    return {
      httpStatus: 200,
      body: {
        canWrite: true,
        isFree: true,
        status: "exempt",
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      },
    };
  }

  if (hasActiveTemporaryAccess(doctor.temporaryAccessExpiresAt)) {
    return {
      httpStatus: 200,
      body: {
        canWrite: true,
        isFree: true,
        status: "temporary_access",
        currentPeriodEnd: Math.floor(doctor.temporaryAccessExpiresAt!.getTime() / 1_000),
        temporaryAccessExpiresAt: doctor.temporaryAccessExpiresAt!.toISOString(),
        cancelAtPeriodEnd: false,
      },
    };
  }

  if (!doctor.stripeCustomerId) {
    return {
      httpStatus: 200,
      body: {
        canWrite: false,
        isFree: false,
        status: "none",
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      },
    };
  }

  let subscription: SubscriptionRow | undefined;
  try {
    subscription = await dependencies.findLatestSubscription(doctor.stripeCustomerId);
  } catch (error) {
    dependencies.onError?.(error, "subscription");
    return unavailable(locale);
  }

  if (!subscription) {
    return {
      httpStatus: 200,
      body: {
        canWrite: false,
        isFree: false,
        status: "none",
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      },
    };
  }

  // A payment-past-due subscription is read-only. In particular, do not use
  // a stale period end as a grace-period authorization for mutations.
  const canWrite = subscription.status === "active" || subscription.status === "trialing";

  return {
    httpStatus: 200,
    body: {
      canWrite,
      isFree: false,
      status: subscription.status,
      currentPeriodEnd: subscription.current_period_end ?? null,
      cancelAtPeriodEnd: !!subscription.cancel_at_period_end,
    },
  };
}

/** Production data source shared by the status endpoint and write guard. */
export function resolveStoredSubscriptionAccess(doctorId: number): Promise<SubscriptionAccessResult> {
  return resolveSubscriptionAccess(doctorId, {
    findDoctor: async (id) => {
      const [doctor] = await db
        .select()
        .from(doctorsTable)
        .where(eq(doctorsTable.id, id))
        .limit(1);
      return doctor;
    },
    findLatestSubscription: async (customerId) => {
      const query = await db.execute(sql`
        SELECT id, status, current_period_end, cancel_at_period_end
        FROM stripe.subscriptions
        WHERE customer = ${customerId}
        ORDER BY created DESC
        LIMIT 1
      `);
      return query.rows[0] as SubscriptionRow | undefined;
    },
  });
}