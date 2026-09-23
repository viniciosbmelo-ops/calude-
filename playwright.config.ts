import { defineConfig } from '@playwright/test';

// Requer o app rodando com DEV_LOGIN=1 (ver README): E2E_BASE_URL=http://localhost:3000 npx playwright test
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3200',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : undefined
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 900 } } },
    { name: 'celular', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }
  ]
});
