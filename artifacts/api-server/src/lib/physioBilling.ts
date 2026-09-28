import { db, physiotherapistsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import type { Request } from "express";
import type Stripe from "stripe";
import { getUncachableStripeClient } from "./stripeClient";
import { getCheckoutRedirectBase } from "./base-url";

export const FREE_PATIENT_LIMIT = 2;

export type Physio = typeof physiotherapistsTable.$inferSelect;

export function hasActiveSubscription(physio: Physio): boolean {
  return physio.subscriptionStatus === "active" || physio.subscriptionStatus === "trialing";
}

/** past_due e canceled = somente leitura (guarda legal — nada é deletado). */
export function isReadOnly(physio: Physio): boolean {
  return physio.subscriptionStatus === "past_due" || physio.subscriptionStatus === "canceled";
}

/**
 * Incremento ATÔMICO e condicional do contador lifetime de pacientes.
 * Evita race TOCTOU: só incrementa se houver assinatura ativa OU se o
 * contador ainda estiver abaixo do limite gratuito. Retorna false se o
 * slot não pôde ser reivindicado (paywall deve responder 402).
 * Aceita transação (tx) para participar do rollback do fluxo chamador.
 */
export async function claimPatientSlot(
  executor: Pick<typeof db, "execute">,
  physioId: number,
): Promise<boolean> {
  const result = await executor.execute(sql`
    UPDATE physiotherapists
    SET patients_created_total = patients_created_total + 1
    WHERE id = ${physioId}
      AND (
        subscription_status IN ('active', 'trialing')
        OR patients_created_total < ${FREE_PATIENT_LIMIT}
      )
    RETURNING id
  `);
  return result.rows.length > 0;
}

export async function getPhysio(physioId: number): Promise<Physio | null> {
  const [physio] = await db
    .select()
    .from(physiotherapistsTable)
    .where(eq(physiotherapistsTable.id, physioId))
    .limit(1);
  return physio ?? null;
}

/**
 * Lists the active prices of the "DocSholder Fisio" product (plan_target=physio)
 * from the locally synced stripe schema. Returns [] if Stripe is not ready.
 */
export async function listFisioPlans(): Promise<
  Array<{
    productId: string;
    productName: string;
    priceId: string;
    unitAmount: number;
    currency: string;
    interval: string;
    priceMetadata: Record<string, string> | null;
  }>
> {
  try {
    const result = await db.execute(sql`
      SELECT DISTINCT ON (pr.recurring->>'interval')
        p.id           AS product_id,
        p.name         AS product_name,
        pr.id          AS price_id,
        pr.unit_amount AS unit_amount,
        pr.currency    AS currency,
        pr.recurring->>'interval' AS interval,
        pr.metadata    AS price_metadata
      FROM stripe.products p
      JOIN stripe.prices pr ON pr.product = p.id AND pr.active = true
      WHERE p.active = true AND p.metadata->>'plan_target' = 'physio'
      ORDER BY pr.recurring->>'interval', pr.id DESC
    `);
    return result.rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        productId: String(row["product_id"]),
        productName: String(row["product_name"]),
        priceId: String(row["price_id"]),
        unitAmount: Number(row["unit_amount"]),
        currency: String(row["currency"]),
        interval: String(row["interval"]),
        priceMetadata: (row["price_metadata"] as Record<string, string> | null) ?? null,
      };
    });
  } catch {
    return [];
  }
}

async function getOrCreateCustomer(stripe: Stripe, physio: Physio): Promise<string> {
  if (physio.stripeCustomerId) return physio.stripeCustomerId;
  const customer = await stripe.customers.create({
    email: physio.email,
    name: physio.nome,
    metadata: { physio_id: String(physio.id) },
  });
  await db
    .update(physiotherapistsTable)
    .set({ stripeCustomerId: customer.id })
    .where(eq(physiotherapistsTable.id, physio.id));
  return customer.id;
}

/**
 * Creates a subscription Checkout Session for the physio plan.
 * If inviteToken is given, success_url deep-links back to the invite with
 * ?paid=1 so the frontend retries the accept AFTER payment (o convite nunca
 * é consumido antes do pagamento).
 */
export async function createFisioCheckoutSession(
  physio: Physio,
  req: Request,
  opts: { priceId?: string; inviteToken?: string } = {},
): Promise<string | null> {
  const plans = await listFisioPlans();
  if (plans.length === 0) return null;

  let priceId = opts.priceId;
  if (priceId && !plans.some((p) => p.priceId === priceId)) return null;
  if (!priceId) {
    priceId = (plans.find((p) => p.interval === "month") ?? plans[0]).priceId;
  }

  const stripe = await getUncachableStripeClient();
  const customerId = await getOrCreateCustomer(stripe, physio);

  const base = getCheckoutRedirectBase(req);
  const successUrl = opts.inviteToken
    ? `${base}/fisio/convite/${encodeURIComponent(opts.inviteToken)}?paid=1`
    : `${base}/fisio/planos?paid=1`;

  const bucket = Math.floor(Date.now() / (10 * 60 * 1000));
  const session = await stripe.checkout.sessions.create(
    {
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      payment_method_types: ["card"],
      success_url: successUrl,
      cancel_url: `${base}/fisio/planos`,
      locale: "pt-BR",
      allow_promotion_codes: true,
      metadata: { physio_id: String(physio.id) },
      subscription_data: { metadata: { physio_id: String(physio.id) } },
    },
    { idempotencyKey: `physio_checkout_${physio.id}_${priceId}_${opts.inviteToken ? "inv" : "std"}_${bucket}` },
  );
  return session.url;
}

/**
 * Self-heal: if the local subscription_status is stale (webhook missed),
 * derive it from the synced stripe.subscriptions table and persist.
 */
export async function refreshPhysioSubscriptionStatus(physio: Physio): Promise<Physio> {
  if (!physio.stripeCustomerId) return physio;
  try {
    const result = await db.execute(sql`
      SELECT status FROM stripe.subscriptions
      WHERE customer = ${physio.stripeCustomerId}
      ORDER BY created DESC
      LIMIT 1
    `);
    const sub = result.rows[0] as { status?: string } | undefined;
    if (!sub?.status) return physio;
    const mapped = mapStripeStatus(sub.status);
    if (mapped && mapped !== physio.subscriptionStatus) {
      const [updated] = await db
        .update(physiotherapistsTable)
        .set({
          subscriptionStatus: mapped,
          plan: mapped === "active" || mapped === "trialing" ? "pro" : mapped === "canceled" ? "free" : physio.plan,
        })
        .where(eq(physiotherapistsTable.id, physio.id))
        .returning();
      return updated ?? physio;
    }
  } catch {
    // stripe schema not ready — keep local state
  }
  return physio;
}

export function mapStripeStatus(status: string): "trialing" | "active" | "past_due" | "canceled" | null {
  switch (status) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return null; // incomplete etc. — don't change local state
  }
}
