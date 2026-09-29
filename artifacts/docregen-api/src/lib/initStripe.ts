import { API_PREFIX } from "./api-prefix";
import { runMigrations } from "stripe-replit-sync";
import { getStripeSync } from "./stripeClient";
import { logger } from "./logger";

const STRIPE_WEBHOOK_PATH = `${API_PREFIX}/stripe/webhook`;

export function resolveManagedWebhookUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (env["REPLIT_DEPLOYMENT"] !== "1") return null;

  const explicitUrl = env["DOCREGEN_STRIPE_WEBHOOK_URL"]?.trim();
  const appUrl = env["DOCREGEN_APP_URL"]?.trim();

  if (!appUrl) {
    throw new Error(
      "Published Stripe webhook requires canonical DOCREGEN_APP_URL",
    );
  }

  const canonicalAppUrl = new URL(appUrl);
  const url = new URL(STRIPE_WEBHOOK_PATH, canonicalAppUrl);
  if (
    url.protocol !== "https:" ||
    url.pathname !== STRIPE_WEBHOOK_PATH ||
    url.search ||
    url.hash ||
    url.hostname === "localhost" ||
    url.hostname.endsWith(".replit.dev")
  ) {
    throw new Error(
      "Stripe webhook URL must be the canonical HTTPS production /regen-api/stripe/webhook endpoint",
    );
  }

  if (explicitUrl && new URL(explicitUrl).toString() !== url.toString()) {
    throw new Error(
      "DOCREGEN_STRIPE_WEBHOOK_URL must match the canonical DOCREGEN_APP_URL webhook endpoint",
    );
  }

  return url.toString();
}

/**
 * Initializes the Stripe schema and syncs data on startup.
 *
 * IMPORTANT: This must NEVER crash the server. The DocRegen medical platform must
 * keep working even if Stripe is not connected yet. All failures are logged and
 * swallowed.
 *
 * Order (per stripe-replit-sync requirements):
 *   1. runMigrations()              -> create the `stripe` schema/tables
 *   2. getStripeSync()              -> needs credentials from the connection API
 *   3. findOrCreateManagedWebhook() -> register the managed webhook
 *   4. syncBackfill()               -> pull existing Stripe data into the DB
 */
export async function initStripe(): Promise<void> {
  const databaseUrl = process.env["DOCREGEN_DATABASE_URL"];
  if (!databaseUrl) {
    logger.warn("initStripe: DOCREGEN_DATABASE_URL missing — skipping Stripe init");
    return;
  }

  try {
    await runMigrations({ databaseUrl });

    const stripeSync = await getStripeSync();

    const webhookUrl = resolveManagedWebhookUrl();
    if (webhookUrl) {
      const result = await stripeSync.findOrCreateManagedWebhook(webhookUrl);
      logger.info({ webhook: result?.url ?? webhookUrl }, "Stripe managed webhook configured");
    } else {
      logger.info("Stripe managed webhook unchanged outside published deployment");
    }

    // syncBackfill() does not pull the product catalog (products/prices) by
    // default, so sync those explicitly — the registration plan picker reads
    // them from the local `stripe` schema.
    Promise.resolve()
      .then(() => stripeSync.syncProducts())
      .then(() => stripeSync.syncPrices())
      .then(() => stripeSync.syncBackfill())
      .then(() => logger.info("Stripe data synced (products, prices, backfill complete)"))
      .catch((err) => logger.warn({ err }, "Stripe sync failed"));

    logger.info("Stripe initialized");
  } catch (err) {
    logger.warn(
      { err },
      "initStripe failed (Stripe likely not connected yet) — continuing without Stripe",
    );
  }
}
