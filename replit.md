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
- `pnpm --filter @workspace/docregen run dev` — run DocRegen frontend (needs `PORT` and `BASE_PATH`; set `API_PROXY_TARGET=http://localhost:8080` to proxy `/api` when running outside the Replit router)

## DocRegen (artifacts/docregen)

Standalone app with only the regenerative-medicine and pain module of the platform
(previewPath `/docregen/`, port 20452). It reuses the same API server, database and
`@workspace/api-client-react`/`@workspace/clinical` libs. Includes: login/registration,
a regenerative/pain home dashboard (`/dashboard`: regen cases, pending PROM follow-ups,
upcoming appointments, pre-consultations), patients and their record (pre-consultation,
anamnesis, evolutions, prescriptions, reports, certificates, files), pre-consultation
invites with exam uploads (RX/MRI/CT/US, public page `/pre-consulta/:token`), the
appointments agenda (`/agenda`, consultations and regenerative-procedure sessions), the
secretary portal (`/secretary/login`, agenda + patients + pre-consultation invites +
regenerative cases + regenerative follow-up alerts; managed from the profile page), regenerative cases (`/regen`), consent, patient guidance, research
export, regenerative follow-ups and reports, and the public patient questionnaire and
guidance links. Surgical procedures, the surgical schedule, pre-operative assessment,
surgical follow-ups, physio/institutional portals, the AI assistant and the admin console
are not part of DocRegen.

App-aware links: DocRegen tags every same-origin `/api` request with `X-App: docregen`
(`artifacts/docregen/src/lib/app-header.ts`). The API maps that header through a fixed
allowlist (`artifacts/api-server/src/lib/app-links.ts`) so patient-facing links it builds
(pre-consultation, regenerative follow-up, patient orientations, password reset, Stripe
checkout return) point to `/docregen/...` and use DocRegen branding. Missing/unknown values
keep the DocKnee root links; pages DocRegen does not have (e.g. the surgical questionnaire
`/patient/:token`) always stay at the root. Scheduled jobs have no calling app and keep
DocKnee links (they only cover surgical follow-ups).

DocRegen-specific endpoints on the shared API: `GET /api/pre-consults/summary` (exact
per-doctor pre-consultation counts for the dashboard), `GET /api/secretary/regen-cases`
(read-only regenerative case summary for the secretary, scoped to her doctor; sessions are
scheduled through `/api/appointments`) and `GET /api/secretary/followup-alerts?type=regen`
(pending regenerative follow-ups; without `type` the endpoint keeps returning the surgical
alerts used by DocKnee). The DocRegen secretary portal has Agenda, Pacientes, Regenerativa
and Alertas tabs.

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
