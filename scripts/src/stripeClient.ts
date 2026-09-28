import Stripe from "stripe";
import { StripeSync } from "stripe-replit-sync";

/**
 * Fetches Stripe credentials from the Replit connection API.
 * Not cached -- tokens can rotate, so fetch fresh each time.
 */
async function getStripeCredentials(): Promise<{ secretKey: string }> {
  // When STRIPE_SECRET_KEY is set (e.g. for seeding live products), use it
  // directly instead of the connection API.
  const envKey = process.env["STRIPE_SECRET_KEY"];
  if (envKey) {
    return { secretKey: envKey };
  }

  const hostname = process.env["REPLIT_CONNECTORS_HOSTNAME"];
  const xReplitToken = process.env["REPL_IDENTITY"]
    ? "repl " + process.env["REPL_IDENTITY"]
    : process.env["WEB_REPL_RENEWAL"]
      ? "depl " + process.env["WEB_REPL_RENEWAL"]
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
    items?: Array<{ settings?: { secret_key?: string; secret?: string } }>;
  };
  const settings = data.items?.[0]?.settings;

  const secretKey = settings?.secret_key ?? settings?.secret;
  if (!secretKey) {
    throw new Error(
      "Stripe integration not connected or missing secret key. " +
        "Connect Stripe via the Integrations tab first.",
    );
  }

  return { secretKey };
}

/**
 * Returns a fresh authenticated Stripe client.
 */
export async function getUncachableStripeClient(): Promise<Stripe> {
  const { secretKey } = await getStripeCredentials();
  return new Stripe(secretKey);
}

/**
 * Returns a StripeSync instance for syncing Stripe data to the local DB.
 */
export async function getStripeSync(): Promise<StripeSync> {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) throw new Error("DATABASE_URL not set");
  const { secretKey } = await getStripeCredentials();
  return new StripeSync({
    poolConfig: { connectionString: databaseUrl },
    stripeSecretKey: secretKey,
    stripeWebhookSecret: "",
  });
}
