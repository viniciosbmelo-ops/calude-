import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Integration suites share one PostgreSQL schema and clean up their own
    // fixtures. Running files concurrently can deadlock those cleanup queries.
    fileParallelism: false,
  },
});
