import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Opt-in local fake of the Replit object-storage sidecar (OBJECT_STORAGE_FAKE=1).
    setupFiles: ["src/test-support/setupObjectStorage.ts"],
    // Integration suites share one PostgreSQL schema and clean up their own
    // fixtures. Running files concurrently can deadlock those cleanup queries.
    fileParallelism: false,
  },
});
