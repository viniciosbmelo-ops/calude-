/**
 * Starts the same local stack as the E2E global setup and keeps it running
 * until Ctrl+C — handy for debugging a spec or clicking around by hand.
 *   pnpm run e2e:serve
 */
import globalSetup from "./global-setup";
import { URLS } from "./support/env";

void (async () => {
  const teardown = await globalSetup();
  console.log(`DocKnee:  ${URLS.dockneeWeb}/\nDocRegen: ${URLS.docregenWeb}/docregen/\nCtrl+C to stop.`);
  const stop = () => { void teardown().then(() => process.exit(0)); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
})();
