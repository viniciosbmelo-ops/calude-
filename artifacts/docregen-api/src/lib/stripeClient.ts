import Stripe from "stripe";
import { StripeSync } from "stripe-replit-sync";

/**
 * Fetches Stripe credentials from the Replit connection API.
 * Not cached -- tokens can rotate, so fetch fresh each time.
 */
async function getStripeCredentials(): Promise<{ secretKey: string; webhookSecret?: string }> {
  // Only the official deployment marker authorizes production credentials.
  // WEB_REPL_RENEWAL is also present in infrastructure contexts that must not
  // be allowed to mutate the live Stripe account.
  const isDeployed = process.env["REPLIT_DEPLOYMENT"] === "1";
  if (isDeployed) {
    const envSecretKey = process.env["DOCREGEN_STRIPE_SECRET_KEY"];
    const envWebhookSecret = process.env["DOCREGEN_STRIPE_WEBHOOK_SECRET"];
    if (!envSecretKey) {
      throw new Error("DOCREGEN_STRIPE_SECRET_KEY is required in published deployments");
    }
    assertStripeKeyMode(envSecretKey, "live");
    return { secretKey: envSecretKey, webhookSecret: envWebhookSecret };
  }

  // Development/preview always uses the Replit connection and must be test
  // mode. A shared DOCREGEN_STRIPE_SECRET_KEY is intentionally ignored here.
  const hostname = process.env["REPLIT_CONNECTORS_HOSTNAME"];
  const xReplitToken = process.env["REPL_IDENTITY"]
    ? "repl " + process.env["REPL_IDENTITY"]
    : null;

  if (!hostname || !xReplitToken) {
    throw new Error(
      "Missing Replit environment variables. " +
        "Ensure the Stripe integration is connected via the Integrations tab.",
    );
  }

  const resp = await fetch(
    `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=stripe`,
    {
      headers: { Accept: "application/json", X_REPLIT_TOKEN: xReplitToken },
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (!resp.ok) {
    throw new Error(`Failed to fetch Stripe credentials: ${resp.status} ${resp.statusText}`);
  }

  const data = (await resp.json()) as {
    items?: Array<{
      settings?: {
        secret_key?: string;
        secret?: string;
        webhook_secret?: string;
        webhook?: string;
      };
    }>;
  };
  const settings = data.items?.[0]?.settings;

  // The Replit Stripe connection exposes the secret key as `secret`; older
  // templates use `secret_key`. Accept either.
  const secretKey = settings?.secret_key ?? settings?.secret;
  if (!secretKey) {
    throw new Error(
      "Stripe integration not connected or missing secret key. " +
        "Connect Stripe via the Integrations tab first.",
    );
  }
  assertStripeKeyMode(secretKey, "test");

  return {
    secretKey,
    webhookSecret: settings?.webhook_secret ?? settings?.webhook,
  };
}

export function assertStripeKeyMode(
  secretKey: string,
  expectedMode: "test" | "live",
): void {
  const acceptedPrefix = new RegExp(`^(?:sk|rk)_${expectedMode}_`);
  if (!acceptedPrefix.test(secretKey)) {
    throw new Error(`Stripe credential mode mismatch: expected ${expectedMode} key`);
  }
}

/**
 * Returns a fresh authenticated Stripe client.
 * Not cached -- fetches credentials on every call so rotated keys are picked up.
 */
export async function getUncachableStripeClient(): Promise<Stripe> {
  const { secretKey } = await getStripeCredentials();
  return new Stripe(secretKey);
}

/**
 * Returns a fresh StripeSync instance for webhook processing and data sync.
 * Not cached -- fetches credentials on every call so rotated keys are picked up.
 */
export async function getStripeSync(): Promise<StripeSync> {
  const databaseUrl = process.env["DOCREGEN_DATABASE_URL"];
  if (!databaseUrl) {
    throw new Error("DOCREGEN_DATABASE_URL environment variable is required");
  }

  const { secretKey, webhookSecret } = await getStripeCredentials();
  return new StripeSync({
    poolConfig: { connectionString: databaseUrl },
    stripeSecretKey: secretKey,
    stripeWebhookSecret: webhookSecret ?? "",
  });
}
