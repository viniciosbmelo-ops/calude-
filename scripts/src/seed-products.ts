import { getUncachableStripeClient } from "./stripeClient";

/**
 * Creates the DocKnee subscription products and prices in Stripe.
 *
 * Idempotent: checks for existing products by name before creating.
 * Run with: pnpm --filter @workspace/scripts exec tsx src/seed-products.ts
 *
 * Plans:
 *   - DocKnee Individual       -> R$ 99,00 / mês  (trial de 7 dias no checkout)
 *   - DocKnee Individual Anual -> R$ 990,00 / ano (2 meses grátis embutidos no preço)
 */
async function seedProducts(): Promise<void> {
  const stripe = await getUncachableStripeClient();

  // ---- Plano Mensal -------------------------------------------------------
  await ensureProductWithPrice(stripe, {
    name: "DocKnee Individual",
    description:
      "Acesso individual à plataforma DocKnee. Assinatura mensal com 7 dias grátis. Cancele quando quiser.",
    metadata: {
      plano: "mensal",
      destaque: "Mais popular",
      trial_dias: "7",
    },
    unitAmount: 9900, // R$ 99,00
    interval: "month",
  });

  // ---- Plano Anual --------------------------------------------------------
  await ensureProductWithPrice(stripe, {
    name: "DocKnee Individual Anual",
    description:
      "Acesso individual à plataforma DocKnee. Plano anual com economia de 2 meses (equivale a R$ 82,50/mês).",
    metadata: {
      plano: "anual",
      economia: "2 meses grátis",
      trial_dias: "7",
    },
    unitAmount: 99000, // R$ 990,00
    interval: "year",
  });

  console.log("\n✓ Produtos e preços prontos. Os webhooks sincronizam tudo no banco automaticamente.");
}

async function ensureProductWithPrice(
  stripe: Awaited<ReturnType<typeof getUncachableStripeClient>>,
  opts: {
    name: string;
    description: string;
    metadata: Record<string, string>;
    unitAmount: number;
    interval: "month" | "year";
  },
): Promise<void> {
  const existing = await stripe.products.search({
    query: `name:'${opts.name}' AND active:'true'`,
  });
  // Stripe search can return prefix matches — filter to exact name only.
  const exactMatch = existing.data.find(p => p.name === opts.name);

  let productId: string;
  if (exactMatch) {
    productId = exactMatch.id;
    console.log(`• Produto já existe: ${opts.name} (${productId})`);
  } else {
    const product = await stripe.products.create({
      name: opts.name,
      description: opts.description,
      metadata: opts.metadata,
    });
    productId = product.id;
    console.log(`• Produto criado: ${opts.name} (${productId})`);
  }

  // Check whether an active recurring price with the right amount/interval exists.
  const prices = await stripe.prices.list({ product: productId, active: true, limit: 100 });
  const match = prices.data.find(
    (p) =>
      p.unit_amount === opts.unitAmount &&
      p.currency === "brl" &&
      p.recurring?.interval === opts.interval,
  );

  if (match) {
    console.log(`  preço já existe: ${(opts.unitAmount / 100).toFixed(2)} BRL/${opts.interval} (${match.id})`);
    return;
  }

  const price = await stripe.prices.create({
    product: productId,
    unit_amount: opts.unitAmount,
    currency: "brl",
    recurring: { interval: opts.interval },
    metadata: opts.metadata,
  });
  console.log(`  preço criado: ${(opts.unitAmount / 100).toFixed(2)} BRL/${opts.interval} (${price.id})`);
}

seedProducts().catch((err) => {
  console.error("Erro ao criar produtos:", err?.message ?? err);
  process.exit(1);
});
