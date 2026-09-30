# End-to-end tests (Playwright)

Browser tests for **DocKnee (DocSholder)** and **DocRegen**, run against a local,
throwaway stack. Fictional data only; nothing talks to production services.

## What `pnpm run test:e2e` starts (e2e/global-setup.ts)

1. Resets two **disposable** PostgreSQL databases (`DROP SCHEMA public CASCADE`) and
   applies each app's Drizzle schema (`push-force`).
2. Starts the test-only fake of the Replit object-storage sidecar + GCS API
   (`artifacts/api-server/src/test-support/fakeObjectStorage.ts`) on port 18090.
3. Builds and starts both APIs (DocKnee :18080 `/api`, DocRegen :18082 `/regen-api`)
   with `NODE_ENV=test` (only disables the per-IP rate limiters: every request comes
   from 127.0.0.1) and `TZ=America/Sao_Paulo`. AI/WhatsApp/Stripe/e-mail point nowhere.
4. Starts both Vite dev servers (DocKnee :18081 `/`, DocRegen :18083 `/docregen/`),
   each proxying its own API (`API_PROXY_TARGET`).

Browser: Chromium, locale `pt-BR`, timezone `America/Sao_Paulo`; one extra project
repeats the date checks with an `en-US` browser.

## Run

```sh
# 1. Two disposable databases (never point these at real data: they are wiped).
eval "$(sh e2e/temp-postgres.sh start)"     # or export them yourself:
# export E2E_DOCKNEE_DATABASE_URL=postgres://…/docknee_e2e
# export E2E_DOCREGEN_DATABASE_URL=postgres://…/docregen_e2e

# 2. Browser: Playwright's Chromium (once: pnpm exec playwright install chromium),
#    or a preinstalled one via PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome
#    (/opt/pw-browsers/chromium is picked up automatically when present).

# 3. Run everything, or one project: docknee | docregen | docregen-en-US
pnpm run test:e2e
pnpm run test:e2e --project docregen

sh e2e/temp-postgres.sh stop                  # delete the throwaway database
```

Useful variables: `E2E_SCREENSHOT_DIR` (key-step screenshots, default
`e2e/screenshots/`), `E2E_SKIP_BUILD=1` (reuse the API `dist/`), `E2E_DEBUG=1`
(print failed API calls). Failure screenshots, traces and server logs go to
`e2e/test-results/` (HTML report in `e2e/test-results/report`).

To click around the same stack by hand: `pnpm run e2e:serve` (Ctrl+C stops it);
`E2E_REUSE_SERVERS=1 pnpm run test:e2e` then runs the specs against it without
resetting the databases.

## Coverage

- **DocRegen** (`docregen/docregen.spec.ts`): sign-up (approval/subscription gate
  set by SQL), patient with DD/MM/AAAA birth date, pré-consulta link → CPF → 6 steps →
  exam upload → doctor sees answers and downloads the exam; knee OA KL3 and shoulder
  regenerative cases; menu "Procedimentos" and case tab "Aplicações" (routes stay
  `/regen`); application; patient PROM link (VAS + region SANE) → PROMs tab and chart;
  condral-focal case applied to the knee → patient link asks SANE Joelho; grouped
  "Estrutura anatômica" select (region headers) → tendinopathy on the A1 pulley → patient
  link asks SANE Punho e Mão; knee functional test; KOOS/WOMAC/IKDC rejected by the API; agenda
  create/edit; dashboard counts; follow-up central dates; reports; research CSV (incl. anatomical labels);
  secretary (isolation from another doctor); logout.
  `docregen/dates.en-us.ts`: the same date contract with an en-US browser.
- **DocKnee** (`docknee/docknee.spec.ts`): login; patient; pré-consulta with upload;
  rotator-cuff surgery (wizard, required clinical fields) with follow-up schedule
  dates; patient follow-up link (VAS + SANE); clinician Constant and Rowe;
  regenerative case (procedures/PROMs tabs, schedule); follow-up central (surgical
  overdue + regenerative); agenda; reports; atestado/receita PDFs with the São Paulo
  issue date at 23:30; secretary portal; retired physiotherapy routes/pages → 404; logout.

## Limits

- Object storage is the local fake: it proves the apps' upload/download flow, not the
  Replit bucket/sidecar configuration in production.
- Patient-orientation links need an HTTPS `DOCREGEN_APP_URL`/`APP_URL` by design and
  are not exercised here. WhatsApp/e-mail sending, Stripe checkout and AI features
  are out of scope (no external calls).
