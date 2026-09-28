import { getStripeSync } from "./stripeClient";

async function run() {
  const sync = await getStripeSync();
  console.log("Sincronizando produtos...");
  await sync.syncProducts();
  console.log("Sincronizando preços...");
  await sync.syncPrices();
  console.log("✓ Sync completo.");
  process.exit(0);
}

run().catch(err => {
  console.error("Erro:", err?.message ?? err);
  process.exit(1);
});
