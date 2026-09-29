import { Router, type IRouter } from "express";
import { db, doctorsTable } from "@workspace/docregen-db";
import { eq, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { getUncachableStripeClient } from "../lib/stripeClient";
import { getCheckoutRedirectBase } from "../lib/base-url";
import { buildAppLink } from "../lib/app-links";
import { emitAnalyticsEvent, resolveAnalyticsSessionId } from "../lib/analyticsEmitter";
import { resolveDoctorLocale } from "../lib/locale";
import { localeForDoctorId } from "../lib/locale";
import { message } from "../lib/locale-catalog";
import { resolveStoredSubscriptionAccess } from "../lib/subscriptionAccess";

const router: IRouter = Router();

/**
 * GET /stripe/products-with-prices  (public)
 * Lists active products joined with their active recurring prices, so the
 * registration page can render the plan picker. Returns an empty list (never
 * an error) if Stripe is not connected / synced yet.
 */
router.get("/stripe/products-with-prices", async (req, res): Promise<void> => {
  try {
    const result = await db.execute(sql`
      SELECT DISTINCT ON (pr.recurring->>'interval')
        p.id            AS product_id,
        p.name          AS product_name,
        p.description   AS product_description,
        p.metadata      AS product_metadata,
        pr.id           AS price_id,
        pr.unit_amount  AS unit_amount,
        pr.currency     AS currency,
        pr.recurring    AS recurring,
        pr.metadata     AS price_metadata
      FROM stripe.products p
      JOIN stripe.prices pr ON pr.product = p.id AND pr.active = true
      WHERE p.active = true
        AND (p.metadata->>'plan_target' IS NULL OR p.metadata->>'plan_target' <> 'physio')
      ORDER BY pr.recurring->>'interval', pr.id DESC
    `);
    res.json({ data: result.rows });
  } catch (err) {
    req.log.warn({ err }, "stripe/products-with-prices: returning empty (Stripe not ready)");
    res.json({ data: [] });
  }
});

/**
 * POST /stripe/checkout  (auth required)
 * Body: { priceId: string; paymentMethods?: ("card" | "boleto" | "pix")[] }
 * Creates (or reuses) the Stripe customer for the logged-in doctor and opens a
 * subscription Checkout Session. Returns { url }.
 */
router.post("/stripe/checkout", requireAuth, async (req, res): Promise<void> => {
  const doctorId = req.doctorId;
  const locale = await localeForDoctorId(doctorId);
  if (!doctorId) {
    res.status(401).json({ error: message(locale, "unauthenticated") });
    return;
  }

  const priceId = typeof req.body?.priceId === "string" ? req.body.priceId : "";
  if (!priceId) {
    res.status(400).json({ error: message(locale, "priceRequired") });
    return;
  }

  // Validate requested payment methods.
  // PIX does not support recurring subscriptions in Stripe — strip it.
  // Boleto alone is OK. If nothing passed, default to ["card"].
  // Note: automatic_payment_methods is not supported in subscription Checkout Sessions
  // with the current Stripe API version — always supply an explicit list.
  const ALLOWED = ["card", "boleto"] as const;
  type PM = (typeof ALLOWED)[number];
  const rawMethods: unknown[] = Array.isArray(req.body?.paymentMethods) ? req.body.paymentMethods : [];
  const paymentMethods: PM[] = rawMethods.filter((m): m is PM => ALLOWED.includes(m as PM));
  const effectiveMethods: PM[] = paymentMethods.length > 0 ? paymentMethods : ["card"];

  const [doctor] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, doctorId)).limit(1);
  if (!doctor) {
    res.status(404).json({ error: message(locale, "doctorNotFound") });
    return;
  }

  // Billing integrity: only allow checking out an active price that belongs to
  // an active DocRegen product. Rejects arbitrary/foreign price IDs.
  try {
    const allowed = await db.execute(sql`
      SELECT pr.id
      FROM stripe.prices pr
      JOIN stripe.products p ON p.id = pr.product
      WHERE pr.id = ${priceId} AND pr.active = true AND p.active = true
      LIMIT 1
    `);
    if (allowed.rows.length === 0) {
      res.status(400).json({ error: message(locale, "invalidPlan") });
      return;
    }
  } catch (err) {
    req.log.error({ err }, "stripe/checkout: price validation failed");
    res.status(502).json({ error: message(locale, "planValidationFailed") });
    return;
  }

  try {
    const stripe = await getUncachableStripeClient();

    let customerId = doctor.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: doctor.email,
        name: doctor.nome,
        metadata: { doctorId: String(doctor.id) },
      });
      customerId = customer.id;
      await db
        .update(doctorsTable)
        .set({ stripeCustomerId: customerId })
        .where(eq(doctorsTable.id, doctor.id));
    }

    // Trial de 7 dias apenas para clientes NOVOS (sem stripeCustomerId prévia).
    // Se já tinha customerId antes do checkout (renovação), nunca aplica trial.
    const isNewCustomer = !doctor.stripeCustomerId;
    const trialDays = isNewCustomer ? 7 : undefined;

    const base = getCheckoutRedirectBase(req);
    // Idempotency: collapse rapid double-submits (same doctor+price within a
    // ~10-minute bucket) into one session, while still allowing later retries.
    const bucket = Math.floor(Date.now() / (10 * 60 * 1000));
    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        payment_method_types: effectiveMethods,
        subscription_data: trialDays ? { trial_period_days: trialDays } : undefined,
        success_url: buildAppLink(base, "/sucesso?session_id={CHECKOUT_SESSION_ID}"),
        cancel_url: buildAppLink(base, "/assinatura-cancelada"),
        // Stripe accepts "es" for Spanish and "pt-BR" for Brazilian Portuguese.
        // This is derived solely from the authenticated doctor's saved profile.
        locale: resolveDoctorLocale(doctor.idioma),
        allow_promotion_codes: true,
      },
      { idempotencyKey: `checkout_${doctor.id}_${priceId}_${bucket}` },
    );

    // Emit canonical checkout_started event attributed to the current opaque
    // analytics session when available.
    const analyticsSessionId = await resolveAnalyticsSessionId(req.get("X-Analytics-Session-Id"));
    void emitAnalyticsEvent("checkout_started", doctor.id, analyticsSessionId);

    res.json({ url: session.url });
  } catch (err) {
    req.log.error({ err }, "stripe/checkout failed");
    res.status(502).json({ error: message(locale, "checkoutFailed") });
  }
});

/**
 * GET /stripe/subscription  (auth required)
 * Returns the most recent subscription for the logged-in doctor, or null.
 */
router.get("/stripe/subscription", requireAuth, async (req, res): Promise<void> => {
  const doctorId = req.doctorId;
  if (!doctorId) {
    res.status(401).json({ error: "Não autenticado" });
    return;
  }

  let locale = resolveDoctorLocale(null);
  try {
    const [doctor] = await db
      .select()
      .from(doctorsTable)
      .where(eq(doctorsTable.id, doctorId))
      .limit(1);
    locale = resolveDoctorLocale(doctor?.idioma);
    if (!doctor?.stripeCustomerId) {
      res.json({ subscription: null });
      return;
    }

    const result = await db.execute(sql`
      SELECT *
      FROM stripe.subscriptions
      WHERE customer = ${doctor.stripeCustomerId}
      ORDER BY created DESC
      LIMIT 1
    `);
    res.json({ subscription: result.rows[0] ?? null });
  } catch (err) {
    req.log.warn({ err }, "stripe/subscription: lookup failed");
    res.status(503).json({
      subscription: null,
      code: "SUBSCRIPTION_STATUS_UNAVAILABLE",
      error: message(locale, "subscriptionStatusUnavailable"),
    });
  }
});

/**
 * GET /stripe/subscription-status  (auth required)
 * Returns canWrite flag + billing details. Fails closed on billing lookup errors.
 */
router.get("/stripe/subscription-status", requireAuth, async (req, res): Promise<void> => {
  const doctorId = req.doctorId;
  if (!doctorId) { res.status(401).json({ error: "Não autenticado" }); return; }

  const result = await resolveStoredSubscriptionAccess(doctorId);
  if (result.httpStatus === 503) {
    req.log.warn("stripe/subscription-status: lookup failed, failing closed");
  }
  res.status(result.httpStatus).json(result.body);
});

/**
 * POST /stripe/cancel-subscription  (auth required)
 * Sets cancel_at_period_end=true on the most recent active subscription.
 */
router.post("/stripe/cancel-subscription", requireAuth, async (req, res): Promise<void> => {
  const doctorId = req.doctorId;
  if (!doctorId) { res.status(401).json({ error: "Não autenticado" }); return; }

  const [doctor] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, doctorId)).limit(1);
  if (!doctor?.stripeCustomerId) {
    res.status(400).json({ error: "Nenhuma assinatura encontrada" });
    return;
  }

  try {
    const result = await db.execute(sql`
      SELECT id, status
      FROM stripe.subscriptions
      WHERE customer = ${doctor.stripeCustomerId}
        AND status IN ('active', 'trialing')
      ORDER BY created DESC
      LIMIT 1
    `);
    const sub = result.rows[0] as Record<string, unknown> | undefined;
    if (!sub) {
      res.status(400).json({ error: "Nenhuma assinatura ativa encontrada" });
      return;
    }
    const stripe = await getUncachableStripeClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updated = await stripe.subscriptions.update(String(sub.id), { cancel_at_period_end: true }) as any;
    res.json({
      status: updated.status,
      cancelAtPeriodEnd: updated.cancel_at_period_end,
      currentPeriodEnd: updated.current_period_end,
    });
  } catch (err) {
    req.log.error({ err }, "stripe/cancel-subscription failed");
    res.status(502).json({ error: "Não foi possível cancelar. Tente novamente." });
  }
});

export default router;
