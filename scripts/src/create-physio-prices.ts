import { getUncachableStripeClient } from "./stripeClient";

/**
 * Cria produtos e preços Stripe para o plano DocKnee Fisio.
 *
 * Preços:
 *   - R$ 69,90/mês  (6990 centavos)
 *   - R$ 699,90/ano (69990 centavos)
 *
 * Os produtos recebem metadata { plan_target: "physio" } para que:
 *   - GET /stripe/products-with-prices (médico) os EXCLUA
 *   - listFisioPlans() os INCLUA (filtra por plan_target = 'physio')
 *
 * Assinaturas existentes NÃO são afetadas.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/create-physio-prices.ts
 */

const FISIO_PRICES = [
  {
    productName: "DocKnee Fisio",
    description:
      "Acesso individual à plataforma DocKnee para fisioterapeutas. Prontuário, agenda, protocolos de reabilitação e conexão com o cirurgião. Cancele quando quiser.",
    interval: "month" as const,
    unitAmount: 6990, // R$ 69,90
    productMetadata: { plan_target: "physio", plano: "fisio_mensal" },
    priceMetadata: { plano: "mensal", trial_dias: "7" },
  },
  {
    productName: "DocKnee Fisio Anual",
    description:
      "Acesso individual à plataforma DocKnee para fisioterapeutas. Plano anual equivale a R$ 58,33/mês (2 meses grátis).",
    interval: "year" as const,
    unitAmount: 69990, // R$ 699,90
    productMetadata: { plan_target: "physio", plano: "fisio_anual" },
    priceMetadata: {
      plano: "anual",
      economia: "2 meses grátis",
      trial_dias: "7",
    },
  },
];

async function run() {
  const stripe = await getUncachableStripeClient();

  for (const cfg of FISIO_PRICES) {
    console.log(`\n── ${cfg.productName} ──`);

    // 1. Busca produto existente por nome
    let productId: string | null = null;

    const found = await stripe.products.search({
      query: `name:'${cfg.productName}' AND active:'true'`,
    });
    const exact = found.data.find((p) => p.name === cfg.productName);

    if (exact) {
      // Garante metadata correta no produto já existente
      await stripe.products.update(exact.id, {
        metadata: cfg.productMetadata,
        description: cfg.description,
      });
      productId = exact.id;
      console.log(`  • Produto já existe: ${cfg.productName} (${exact.id})`);
    } else {
      const p = await stripe.products.create({
        name: cfg.productName,
        description: cfg.description,
        metadata: cfg.productMetadata,
      });
      productId = p.id;
      console.log(`  • Produto criado: ${cfg.productName} (${productId})`);
    }

    // 2. Verifica se já existe preço ativo com o valor correto
    const allPrices = await stripe.prices.list({
      product: productId,
      active: true,
      limit: 100,
    });
    const alreadyExists = allPrices.data.find(
      (p) =>
        p.unit_amount === cfg.unitAmount &&
        p.currency === "brl" &&
        p.recurring?.interval === cfg.interval,
    );

    if (alreadyExists) {
      console.log(
        `  • Preço já existe: R$ ${(cfg.unitAmount / 100).toFixed(2)}/${cfg.interval} (${alreadyExists.id})`,
      );
    } else {
      const newPrice = await stripe.prices.create({
        product: productId,
        unit_amount: cfg.unitAmount,
        currency: "brl",
        recurring: { interval: cfg.interval },
        metadata: Object.fromEntries(
          Object.entries(cfg.priceMetadata).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        ),
      });
      console.log(
        `  • Novo preço criado: R$ ${(cfg.unitAmount / 100).toFixed(2)}/${cfg.interval} (${newPrice.id})`,
      );
    }

    // 3. Desativa preços antigos com valores diferentes para o mesmo intervalo
    const toDeactivate = allPrices.data.filter(
      (p) =>
        p.unit_amount !== cfg.unitAmount &&
        p.recurring?.interval === cfg.interval,
    );
    for (const old of toDeactivate) {
      await stripe.prices.update(old.id, { active: false });
      console.log(
        `  • Preço antigo desativado: R$ ${((old.unit_amount ?? 0) / 100).toFixed(2)}/${old.recurring?.interval} (${old.id})`,
      );
    }
  }

  console.log(
    "\n✓ Produtos/preços Fisio criados. Aguarde o webhook sincronizar o banco ou rode sync-stripe manualmente.",
  );
}

run().catch((err) => {
  console.error("Erro:", err?.message ?? err);
  process.exit(1);
});
