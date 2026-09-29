# DocKnee - Plataforma de Documentação Cirúrgica do Joelho

## Overview

DocKnee is a full-stack medical platform for documenting and analyzing knee surgeries. Doctors can register, document patient surgeries with detailed clinical data, and view dashboards of their results. Administrators can aggregate all doctors' data for scientific publications.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + Vite (artifacts/docknee) at previewPath "/"
- **API framework**: Express 5 (artifacts/api-server)
- **Database**: PostgreSQL + Drizzle ORM
- **Authentication**: JWT + bcryptjs (stored in HTTP-only session cookie; legacy localStorage token also accepted for backwards compatibility)
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Admin Account

The admin account credentials are **not stored in this file**. Set credentials via environment variables or directly in the database (`is_admin = true`). Do not commit passwords to source control.

## Key Features

1. **Doctor Registration/Login** — Full profile with CRM, CPF, address, specialty
2. **Patient Management** — CRUD with clinical details (Beighton score, activity level, etc.)
3. **Surgery Documentation** — Multi-step wizard with:
   - Ligament selection (LCA, LCP, LCM, LCL, PLC, PMC, LAL)
   - Physical exam (Lachman, Pivot Shift, ADER test, etc.)
   - KRIRS Algorithm (ACL reconstruction technique recommendation)
   - PICS 2.0 Score (patellar instability risk)
   - Meniscal procedures
4. **Follow-up Tracking** — IKDC, KOOS, Lysholm, Tegner, Kujala scales
5. **Doctor Dashboard** — Personal stats + charts
6. **Admin Dashboard** — Aggregated data from all doctors for publications

## Key Commands

- `pnpm run typecheck` — full typecheck
- `pnpm run build` — typecheck + build all
- `pnpm --filter @workspace/api-spec run codegen` — regenerate hooks from OpenAPI
- `pnpm --filter @workspace/db run push-force` — apply schema to the development database only
- `pnpm --filter @workspace/api-server run dev` — run API server
- `pnpm --filter @workspace/docknee run dev` — run frontend
- DocRegen (independent app) commands: see "DocRegen" below

## DocRegen (independent app)

DocRegen (regenerative medicine and pain) started from DocKnee's codebase but is a
**fully independent product**: its own backend, its own PostgreSQL database, its own
secrets, cookies, storage and messaging credentials. Accounts, patients and clinical
data are never shared with DocKnee, and each app evolves on its own. DocRegen started
with an empty database (no data was migrated from DocKnee).

### Packages

| Package | Role |
|---------|------|
| `artifacts/docregen` | Frontend (React + Vite), previewPath `/docregen/`, port 20452 |
| `artifacts/docregen-api` | Backend (Express 5), mounted at `/regen-api`, port 8082 |
| `lib/docregen-db` | DocRegen Drizzle schema + pool (reads only `DOCREGEN_DATABASE_URL`) |
| `lib/docregen-api-spec` | DocRegen OpenAPI spec (health, auth, doctor profile, patients) + Orval config |
| `lib/docregen-api-client-react` | Generated React Query client (base URL `/regen-api`) — do not hand-edit `src/generated` |
| `lib/docregen-api-zod` | Generated zod schemas used by the DocRegen API — do not hand-edit `src/generated` |

Shared, app-neutral libs: `lib/clinical` (scoring/PROM instruments and report
engine) and the Replit AI integration libs (`lib/integrations-*`). They hold no app
state and no app-specific knowledge. Everything else (spec, client, zod, db schema)
is a DocRegen-owned copy so the two contracts and schemas can diverge freely.

Why `/regen-api`: the Replit path router sends each request to the service whose
`paths` entry is the longest matching prefix. DocKnee's `artifacts/api-server` owns
`/api` (port 8080); `/regen-api` shares no prefix with `/api`, `/docregen` (the
DocRegen frontend) or `/__mockup`, so the two backends can never receive each
other's traffic, and DocRegen's session cookies (path `/regen-api`) are never sent
to DocKnee's API. The DocKnee api-server, `lib/api-spec`, `lib/api-client-react`,
`lib/api-zod` and `lib/db` contain no DocRegen code.

What the DocRegen API contains: auth (doctor + secretary), subscription/Stripe,
patients and their record (attachments, orientations), regenerative cases/procedures/
PROMs/reports/consent/research export, pre-consultation (invites, public page, exam
uploads, `GET /regen-api/pre-consults/summary` for the dashboard), appointments
agenda, secretary portal (agenda, patients, pre-consultation invites,
`GET /regen-api/secretary/regen-cases` scoped to the secretary's doctor, and
`GET /regen-api/secretary/followup-alerts` with regenerative follow-up alerts), LGPD,
analytics, notifications/WhatsApp outbox and the public patient pages
(`/regen-api/patient/regen/:token`, `/regen-api/pre-consult/:token`,
`/regen-api/patient-orientations/:token`). Surgical procedures and follow-ups,
surgical schedule and pre-operative assessment, RX/surgical AI, admin console,
physiotherapy/institutional portals and decision support exist only in DocKnee.

Every link and message the DocRegen API builds (pre-consultation, regenerative
follow-up, patient orientations, password reset, Stripe checkout return) points to the
DocRegen frontend (`<DOCREGEN_APP_URL><DOCREGEN_FRONTEND_BASE_PATH>/...`, default base
path `/docregen`) and uses DocRegen branding. There is no calling-app flag.

### Environment variables (DocRegen API)

The API **refuses to start** without its own database and session secret and never
falls back to DocKnee's variables; it also refuses values equal to DocKnee's.

| Variable | Required | Purpose |
|----------|----------|---------|
| `DOCREGEN_DATABASE_URL` | yes | DocRegen's own PostgreSQL database (must differ from `DATABASE_URL`) |
| `DOCREGEN_SESSION_SECRET` | yes | JWT/cookie signing secret, ≥ 32 chars (must differ from `SESSION_SECRET`) |
| `DOCREGEN_APP_URL` | production | Canonical public origin used in links, CORS and the Stripe webhook |
| `DOCREGEN_FRONTEND_BASE_PATH` | no | Frontend base path in links (default `/docregen`; empty when served at a domain root) |
| `DOCREGEN_PRIVATE_OBJECT_DIR` | uploads | Private object-storage dir `/<bucket>/<prefix>` (must differ from `PRIVATE_OBJECT_DIR`) |
| `DOCREGEN_PUBLIC_OBJECT_SEARCH_PATHS` | no | Public object-storage paths |
| `DOCREGEN_STRIPE_SECRET_KEY`, `DOCREGEN_STRIPE_WEBHOOK_SECRET`, `DOCREGEN_STRIPE_WEBHOOK_URL` | production billing | DocRegen Stripe account (live keys only in the published deployment) |
| `DOCREGEN_GMAIL_USER`, `DOCREGEN_GMAIL_APP_PASSWORD`, `DOCREGEN_CONTACT_EMAIL` | email | Outgoing email and support contact |
| `DOCREGEN_EVOLUTION_API_URL`, `DOCREGEN_EVOLUTION_API_KEY`, `DOCREGEN_EVOLUTION_INSTANCE` | WhatsApp | Evolution API instance for DocRegen |
| `DOCREGEN_WHATSAPP_ACCESS_TOKEN`, `DOCREGEN_WHATSAPP_PHONE_NUMBER_ID` | WhatsApp fallback | Meta WhatsApp Business API |
| `AI_INTEGRATIONS_GEMINI_BASE_URL`, `AI_INTEGRATIONS_GEMINI_API_KEY` | yes (regen AI) | Replit-managed Gemini integration (provider credentials, no app data) |

Cookies: `docregen_session`, `docregen_secretary_session`, `docregen_patient_session`
(path `/regen-api`). JWT issuer/audience `docregen-api` / `docregen-web`.

### Running DocRegen

- `pnpm --filter @workspace/docregen-db run push-force` — apply DocRegen's schema to
  `DOCREGEN_DATABASE_URL` (development only; `scripts/post-merge.sh` does it
  automatically when `DOCREGEN_DATABASE_URL` is set)
- `pnpm --filter @workspace/docregen-api run dev` — run the DocRegen API (`PORT=8082`)
- `pnpm --filter @workspace/docregen run dev` — run the DocRegen frontend (needs `PORT`
  and `BASE_PATH=/docregen/`; outside the Replit router set
  `API_PROXY_TARGET=http://localhost:8082` to proxy `/regen-api`)
- `pnpm --filter @workspace/docregen-api-spec run codegen` — regenerate the DocRegen
  client and zod schemas after editing `lib/docregen-api-spec/openapi.yaml`
- `pnpm run test:docregen-api` — DocRegen API tests (need `DOCREGEN_DATABASE_URL` pointing
  at a disposable database with the schema applied, `DOCREGEN_SESSION_SECRET`, the Gemini
  integration variables; the pre-consultation upload test also needs object storage and
  `DOCREGEN_PRIVATE_OBJECT_DIR`). `pnpm test` runs web, DocKnee API and DocRegen API suites.

### Deploying DocRegen (manual steps for the owner)

1. Provision a **separate** PostgreSQL database for DocRegen (development and production)
   and set `DOCREGEN_DATABASE_URL` in Replit Secrets for each environment. Replit's
   Publish schema diff only covers the built-in `DATABASE_URL` database, so apply
   DocRegen's schema to the production database yourself (review first):
   `DOCREGEN_DATABASE_URL=<prod url> pnpm --filter @workspace/docregen-db run push`.
2. Set `DOCREGEN_SESSION_SECRET` (new random value, ≥ 32 chars) and `DOCREGEN_APP_URL`.
3. Create a separate object-storage bucket or prefix and set `DOCREGEN_PRIVATE_OBJECT_DIR`.
4. Configure DocRegen's own Stripe account/products (`DOCREGEN_STRIPE_*`), email
   (`DOCREGEN_GMAIL_*`, `DOCREGEN_CONTACT_EMAIL`) and WhatsApp (`DOCREGEN_EVOLUTION_*`,
   `DOCREGEN_WHATSAPP_*`) credentials.
5. Publish: the `artifacts/docregen-api` artifact builds and serves `/regen-api`
   (health check `/regen-api/healthz`) next to DocKnee's `/api`.

## DB Schema

Tables: doctors, patients, surgeries, exame_ligamentar, lca_algorithm, procedimento_meniscal, exame_patelar, pics_score, followup, audit_logs, consentimentos

### Schema deployment flow

- After a merge, Replit runs `scripts/post-merge.sh`, which non-interactively
  applies the Drizzle schema to the development database.
- On Publish, Replit computes and applies the development-to-production schema
  diff. Renames and destructive changes must be reviewed in the Publish UI.
- Application startup only performs a read-only schema assertion. Do not add
  DDL to startup, build, artifact deployment commands, or production scripts.

## Pre-deploy Security Check

Run `pnpm --filter @workspace/scripts run pre-deploy` to execute the security validation script.
Requires environment variables (no hardcoded credentials):
- `PREDEPLOY_BASE` (default: http://localhost:80)
- `PREDEPLOY_ADMIN_EMAIL` / `PREDEPLOY_ADMIN_PASS`
- `PREDEPLOY_DOCTOR_EMAIL` / `PREDEPLOY_DOCTOR_PASS`

Use ephemeral accounts created specifically for CI/deploy validation.

## Operational Runbook

> ⚠️ The items below require **external configuration actions** — they are not
> automatically applied by the application code. Each item is clearly marked
> with the responsible party and required tooling.

### Backup / Restore / RPO / RTO

**[ACTION REQUIRED — Database Administrator]**

| Metric | Target | Notes |
|--------|--------|-------|
| RPO (Recovery Point Objective) | ≤ 1 hour | Requires automated hourly backups |
| RTO (Recovery Time Objective) | ≤ 4 hours | Requires tested restore procedure |

**Backup procedure (PostgreSQL):**
```bash
# Full backup — run hourly via cron or managed database service
pg_dump "$DATABASE_URL" --format=custom --compress=9 \
  --file="docknee_$(date +%Y%m%d_%H%M%S).dump"

# Store in encrypted off-site storage (e.g. GCS bucket with CMEK)
# Retain daily backups for 30 days, weekly for 1 year
```

**Restore procedure:**
```bash
# 1. Spin up a new PostgreSQL instance
# 2. Restore from latest backup:
pg_restore --dbname="$DATABASE_URL" --clean --if-exists docknee_YYYYMMDD_HHMMSS.dump
# 3. Verify row counts: SELECT COUNT(*) FROM doctors; SELECT COUNT(*) FROM surgeries;
# 4. Run application health check: GET /api/healthz
# 5. Update DNS / load balancer to point to restored instance
```

**Lifecycle / data retention:**
- Clinical records (surgeries, followups): retain for minimum **20 years** (CFM Res. 1.821/2007)
- Audit logs: retain for minimum **5 years** (LGPD Art. 37)
- Consent records: retain for the duration of the relationship + 5 years
- Deletion requests (LGPD Art. 18): process within 15 business days; retain anonymised clinical data per Art. 16

### AI Governance

**[ACTION REQUIRED — DPO / Legal]**

The JoIA assistant (agent.ts) sends aggregated, minimised clinical data to OpenAI's API.

**Legal basis (LGPD):**
- Art. 7, VI — legitimate interest of the controller for scientific/medical research
- Art. 11, II, c — health protection and treatment (clinical statistics)
- Art. 18 — data subject rights respected via LGPD endpoints

**Data Processing Agreement (DPA):**
- **[ACTION REQUIRED]** Sign OpenAI's DPA before processing real patient data:
  https://openai.com/policies/data-processing-addendum
- Confirm that OpenAI's data residency meets requirements (data sent to US servers)
- For EU/EEA data subjects, Standard Contractual Clauses (SCCs) must be executed

**Data minimisation implemented:**
- Only aggregated statistics and anonymised reports are sent to OpenAI
- `summarizeReportForAi()` strips individual identifiers before transmission
- Scope enforcement: doctors can only query their own data; admins must declare scope
- All AI accesses are logged via `auditAgentAccess()`

**OpenAI data region / retention:**
- API calls are processed in the US by default
- OpenAI does not retain API data for training by default (confirm in your DPA)
- **[ACTION REQUIRED]** If LGPD/ANPD requires data to stay in Brazil, configure a
  Brazilian-based OpenAI-compatible endpoint via `AI_INTEGRATIONS_OPENAI_BASE_URL`

**Review cadence:**
- AI governance review: every 6 months or when the model/prompt changes significantly
- DPA renewal: annually or upon OpenAI policy changes
