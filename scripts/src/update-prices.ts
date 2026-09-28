import { getUncachableStripeClient } from "./stripeClient";

/**
 * Atualiza os preços DocKnee Médico para R$129,90/mês e R$1.299,90/ano.
 * - Cria novos preços com os valores corretos
 * - Desativa os preços antigos (R$99 / R$990) para que não apareçam no cadastro
 *
 * Assinaturas existentes NÃO são afetadas — o Stripe mantém cada assinante
 * no preço que ela foi criada.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/update-prices.ts
 */

const NEW_PRICES = [
  {
    productName: "DocKnee Médico",
    oldProductNames: ["DocKnee Individual"],
    newName: "DocKnee Médico",
    description:
      "Acesso individual à plataforma DocKnee. Prontuário, IA, agendamento e KRIRS/PICS. Cancele quando quiser.",
    interval: "month" as const,
    unitAmount: 12990, // R$ 129,90
    metadata: { plano: "mensal", trial_dias: "7" },
  },
  {
    productName: "DocKnee Médico Anual",
    oldProductNames: ["DocKnee Individual Anual"],
    newName: "DocKnee Médico Anual",
    description:
      "Acesso individual à plataforma DocKnee. Plano anual equivale a R$ 108,25/mês (2 meses grátis).",
    interval: "year" as const,
    unitAmount: 129990, // R$ 1.299,90
    metadata: { plano: "anual", economia: "2 meses grátis", trial_dias: "7" },
  },
];

async function run() {
  const stripe = await getUncachableStripeClient();

  for (const cfg of NEW_PRICES) {
    console.log(`\n── ${cfg.newName} ──`);

    // 1. Busca produto antigo pelo nome legado ou cria novo
    let productId: string | null = null;

    for (const oldName of cfg.oldProductNames) {
      const found = await stripe.products.search({
        query: `name:'${oldName}' AND active:'true'`,
      });
      const exact = found.data.find((p) => p.name === oldName);
      if (exact) {
        // Renomeia se necessário
        if (exact.name !== cfg.newName) {
          await stripe.products.update(exact.id, {
            name: cfg.newName,
            description: cfg.description,
          });
          console.log(
            `  • Produto renomeado: ${oldName} → ${cfg.newName} (${exact.id})`,
          );
        } else {
          console.log(`  • Produto já existe: ${cfg.newName} (${exact.id})`);
        }
        productId = exact.id;
        break;
      }
    }

    // Se não encontrou produto antigo, cria novo
    if (!productId) {
      const p = await stripe.products.create({
        name: cfg.newName,
        description: cfg.description,
        metadata: Object.fromEntries(
          Object.entries(cfg.metadata).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        ),
      });
      productId = p.id;
      console.log(`  • Produto criado: ${cfg.newName} (${productId})`);
    }

    // 2. Verifica se já existe um preço ativo com o novo valor
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
        `  • Preço novo já existe: R$ ${(cfg.unitAmount / 100).toFixed(2)}/${cfg.interval} (${alreadyExists.id})`,
      );
    } else {
      const newPrice = await stripe.prices.create({
        product: productId,
        unit_amount: cfg.unitAmount,
        currency: "brl",
        recurring: { interval: cfg.interval },
        metadata: Object.fromEntries(
          Object.entries(cfg.metadata).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        ),
      });
      console.log(
        `  • Novo preço criado: R$ ${(cfg.unitAmount / 100).toFixed(2)}/${cfg.interval} (${newPrice.id})`,
      );
    }

    // 3. Desativa preços antigos com valores diferentes
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
    "\n✓ Preços atualizados. Aguarde o webhook sincronizar o banco (ou rode sync-stripe manualmente).",
  );
}

run().catch((err) => {
  console.error("Erro:", err?.message ?? err);
  process.exit(1);
});
