import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";
import { TZ, URLS } from "./support/env";

// Use a preinstalled Chromium when PLAYWRIGHT_CHROMIUM_EXECUTABLE is set
// (or /opt/pw-browsers/chromium exists); otherwise Playwright's own download.
const preinstalled = process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE"]
  ?? (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

const chromium = {
  ...devices["Desktop Chrome"],
  ...(preinstalled ? { launchOptions: { executablePath: preinstalled } } : {}),
};

export default defineConfig({
  testDir: ".",
  outputDir: "./test-results/artifacts",
  globalSetup: "./global-setup.ts",
  // Specs share one database per app and build on each other's data within a file.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { outputFolder: "./test-results/report", open: "never" }]],
  use: {
    ...chromium,
    locale: "pt-BR",
    timezoneId: TZ,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
  },
  projects: [
    { name: "docregen", testMatch: /docregen\/.*\.spec\.ts/, use: { baseURL: URLS.docregenWeb } },
    { name: "docknee", testMatch: /docknee\/.*\.spec\.ts/, use: { baseURL: URLS.dockneeWeb } },
    {
      name: "docregen-en-US",
      testMatch: /docregen\/.*\.en-us\.ts/,
      use: { baseURL: URLS.docregenWeb, locale: "en-US" },
    },
  ],
});
