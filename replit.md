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
| `AI_INTEGRATIONS_GEMINI_BASE_URL`, `AI_INTEGRATIONS_GEMINI_API_KEY` | no (regen AI) | Replit-managed Gemini integration (provider credentials, no app data). Optional: without them the API still starts and the AI summary answers 503 "IA não configurada" |

| `DOCREGEN_ALLOWED_ORIGINS` | no | Extra CORS/CSRF origins, comma-separated (e.g. `https://dockneeapp.com` while DocRegen is still served there). Default allowlist: origin of `DOCREGEN_APP_URL` + `REPLIT_DOMAINS` (+ localhost outside production); DocKnee's domain is **not** included by default |
| `DOCREGEN_AI_DAILY_LIMIT` | no | AI summaries per doctor per 24 h (default 20; DB-backed, 429 when exceeded) |
| `DOCREGEN_WHATSAPP_HOURLY_LIMIT` | no | Messages per doctor per hour through the platform WhatsApp number (default 60; DB-backed) |
| `DB_POOL_MAX`, `DB_POOL_MIN` | no | PostgreSQL pool size (defaults 10 / 2) |
| `DB_CONN_TIMEOUT_MS`, `DB_IDLE_TIMEOUT_MS`, `DB_STMT_TIMEOUT_MS` | no | Pool connect timeout (10 000), idle timeout (30 000), server-side statement timeout (30 000) |
| `PDF_TEMP_TTL_SECONDS` | no | Lifetime of temporary shared PDFs (default 1800) |
| `PDF_TEMP_MAX_BYTES` | no | Max size of one temporary PDF (default 20 MB) |
| `PDF_TEMP_MAX_PER_DOCTOR`, `PDF_TEMP_MAX_BYTES_PER_DOCTOR` | no | Live temporary PDFs per doctor (default 10 files / 60 MB; 429 beyond) |
| `PDF_TEMP_MAX_TOTAL_BYTES` | no | Live temporary PDFs overall (default 512 MB; 503 beyond). `PDF_TEMP_MAX_ENTRIES` (in-memory store) no longer exists |
| `LOG_LEVEL` | no | pino log level (default `info`) |
| `TZ` | no | Process timezone. Calendar logic uses America/Sao_Paulo explicitly; the test suite runs in UTC and in São Paulo |
| `OBJECT_STORAGE_FAKE` | tests only | `1` starts the local object-storage fake in the API test suites (ignored in production) |
| `DOCREGEN_ENFORCE_RATE_LIMITS` | tests only | `1` re-enables the per-IP limiters under `NODE_ENV=test` (they are skipped in tests/E2E because every request comes from 127.0.0.1) |

Cookies: `docregen_session`, `docregen_secretary_session`, `docregen_patient_session`
(path `/regen-api`). JWT issuer/audience `docregen-api` / `docregen-web`. Logout bumps
the account's `session_version`, so every token of that doctor/secretary stops working.

### Security controls (DocRegen API)

- **Rate limits** (table `rate_limit_buckets`, shared by all instances): per IP, 10 failed
  attempts / 15 min on every credential endpoint (`/auth/login`, `/auth/change-password`,
  `/secretary-auth/login`, `/patient/regen/:token/verify`, `/pre-consult/:token/verify`);
  password reset 5 / 15 min; registration 3 / h; PDF upload 20 / 15 min per doctor;
  AI summaries and WhatsApp sends per doctor (see env vars). The global 300 req/min per IP
  limiter is in memory (per instance) on purpose.
- **Account lockout** (table `auth_lockouts`, key = SHA-256 of role + normalized e-mail/CPF):
  10 failed logins within 15 min lock the doctor or secretary account for 15 min, whatever
  the IP (429 `ACCOUNT_LOCKED`). The public follow-up/pré-consulta links keep their own
  lockout (`patient_verification_attempts`, 5 attempts per IP+link).
- **E-mails** are stored lowercase; `lower(email)` is unique for doctors and secretaries.
  Passwords: ≥ 8 characters everywhere (registration, reset, change, secretaries).
- **Secretaries** receive a front-desk projection of patients (id, name, phone, e-mail,
  birth date, registro) and a regenerative-case summary without diagnosis; every clinical
  route is doctor-only.
- **Redaction** (`src/lib/redaction.ts`) is applied to `page_visits`, `audit_logs`, pino
  request logs and security events: SPA base stripped, pré-consulta / follow-up /
  orientation tokens and temporary-PDF ids replaced by placeholders, secret query values
  masked. Security events and alert e-mails carry only SHA-256 fingerprints of e-mails/CPFs.
- **Audit trail** (`audit_logs`): `actor_role` (`doctor` | `secretary` | `patient_link` |
  `anonymous`), `doctor_id` (the owning doctor, also for secretaries), `secretary_id`,
  `patient_link_hash` (SHA-256 of the public link token), resource type/id.
- **AI summary**: the prompt carries age in years, sex, coded condition, products, relative
  days, scores and lab values — never name, birth date, CPF, contacts, calendar dates or
  free text. The AI tab tells the doctor that an external provider processes the data.
- **Research export**: per-export random pseudonyms, month/year, 5-year age bands, 5-unit
  BMI bands, coded values only; k<5 groups (age band × sex × BMI band, or an export with
  fewer than 5 cases) are flagged (`smallGroupWarning`, header `X-Research-Warning`, UI
  banner) and lose the anatomical-site column.
- **Body size**: JSON 1 MB by default; only `/regen-api/pdf/temp` (base64 variant) accepts
  30 MB. Malformed JSON → 400.
- **Temporary PDFs** are stored in the database (`temp_pdfs`) with TTL and quotas.
- **Health checks**: `/regen-api/healthz` = liveness (no I/O) — use it as the hosting
  platform's health check; `/regen-api/readyz` = readiness (`SELECT 1`, 2 s timeout, 503) —
  use it for uptime monitoring / load-balancer readiness.

### LGPD (DocRegen)

**Medical records are retained for 20 years** (Lei 13.787/2018; CFM Res. 1.821/2007 and
2.218/2018). No LGPD feature deletes a patient's clinical record, and the UI never says so.
`regen_cases.doctor_id` references `doctors` with `ON DELETE RESTRICT`: a doctor account
that owns cases cannot be deleted while the records must be kept.

**Patient anonymization** (`POST /regen-api/lgpd/anonimizar-paciente/:id`, button
"Anonimizar dados identificáveis" in the patient record) runs in one transaction
(`src/lib/patientAnonymization.ts`):

| Removed | Kept (de-identified) |
|---------|---------------------|
| patient name (→ `PACIENTE ANONIMIZADO #<hash>`), CPF, e-mail, phone, birth date, address, city/state/country, CEP, health plan, card number, "indicado por", anamnesis, reports | internal record number (`numero_registro`), sex, side, activity level |
| `regen_cases`: name snapshot, phone; birth date generalized to 1 January of the birth year; custom goal; free text inside `anamnese_regen` / `plano_otimizacao` (only numbers, booleans and short coded values survive) | condition, laterality, comorbidity flags, BMI, products, planned products, dates of care |
| procedure notes | products, doses, lots, adverse-event flag and description, compliance data |
| free text inside PROM answers, patient scale answers and pré-consulta answers | scores (VAS, SANE), coded pré-consulta answers |
| AI summaries (may quote the patient) | — |
| agenda notes; WhatsApp messages to the patient (recipient + text; pending ones cancelled) | appointment dates/status |
| attachments: rows deleted and files queued in `storage_cleanup_jobs` (deleted from object storage, retried until done) | lab results, performance tests |
| active follow-up tokens (set to NULL) and pré-consulta invites (revoked) | follow-up schedule and status |

Anonymization cannot be undone: export first when the record may still be needed in
identifiable form (the legal retention duty stays with the physician/clinic).
Residual note: `DELETE /regen-api/patients/:id` (patient "Excluir" button) still deletes the
patient together with its regenerative cases; the owner should decide whether to restrict it
given the 20-year retention duty.

**Account deletion requests** (`DELETE /regen-api/lgpd/solicitar-exclusao`, profile →
"Privacidade e dados") create a row in `lgpd_requests`, set `doctors.deletion_requested_at`
and e-mail `DOCREGEN_CONTACT_EMAIL` (via `DOCREGEN_GMAIL_*`). The doctor sees the real
status: `notified`, or `notification_failed` when the e-mail could not be sent (retried on
the next request). Operator procedure (manual, answer within 15 days — LGPD Art. 19, II):
1. Find open requests: `SELECT * FROM lgpd_requests WHERE status IN ('pending','notified','notification_failed');`
2. Confirm the requester's identity through the account e-mail.
3. Export the doctor's data if requested (`GET /regen-api/lgpd/exportar`, JSON or CSV).
4. Delete/anonymize account data not subject to retention: secretaries, appointments,
   consents, contact messages, Stripe subscription, sessions (`session_version`++ and
   `aprovado=false`), and the doctor's personal fields not needed to identify the author of
   clinical records. **Do not delete patients' clinical records** (regen cases, procedures,
   scores, labs) during the 20-year retention period — keep them (RESTRICT FK) and transfer
   custody if the clinic requires it.
5. Close the request: `UPDATE lgpd_requests SET status='completed' (or 'rejected'),
   resolved_at=now(), resolution_note='…' WHERE id=…;` — the note is shown to the doctor.

**Portability** (`GET /regen-api/lgpd/exportar?formato=json|csv`, profile card): patients,
cases, procedures, PROMs, labs, performance tests, follow-ups, scale responses, AI
summaries, pré-consultas, all attachments (metadata + 15-minute signed URLs), appointments,
secretaries (no password hashes), consent and LGPD requests. Link tokens are never exported.

### Hosting recommendations (decisions for the owner)

- **Autoscale vs Reserved VM (#12).** After these changes the security-relevant state is in
  PostgreSQL (rate limits, account lockout, temporary PDFs, WhatsApp outbox with leases,
  storage-cleanup queue), so several instances are safe. Still instance-local: the global
  300 req/min limiter, the security-monitor alert counters (e-mail alerts per instance), the
  WhatsApp outbox worker and the hourly cleanup timers (each instance runs them; the outbox
  uses row leases, cleanups are idempotent), and `node-cron` schedules. With autoscale
  scaled to zero, background work only runs while an instance is up — prefer a Reserved VM
  (or minimum 1 instance) if WhatsApp delivery and cleanups must run continuously.
- **Own domain (#15).** Serve DocRegen on its own subdomain/domain (e.g.
  `app.docregen.com.br`) instead of `dockneeapp.com/docregen`, set `DOCREGEN_APP_URL` to it
  and `DOCREGEN_FRONTEND_BASE_PATH=` (empty) if served at the root. The CORS/CSRF allowlist
  no longer includes `dockneeapp.com` by default: **while DocRegen is still served under
  dockneeapp.com, set `DOCREGEN_APP_URL=https://dockneeapp.com` (or
  `DOCREGEN_ALLOWED_ORIGINS=https://dockneeapp.com,https://www.dockneeapp.com`)**, otherwise
  browser writes are rejected with 403. Remove those origins once the move is done.

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
  `DOCREGEN_PRIVATE_OBJECT_DIR`). `pnpm run test:docregen-api:tz` runs the same suite with
  `TZ=America/Sao_Paulo` (calendar dates must not depend on the server timezone).
  `pnpm test` runs web, DocKnee API and DocRegen API suites (DocRegen in UTC/host TZ and São Paulo).
- Outside Replit (no object-storage sidecar at `127.0.0.1:1106`) run the API suites with
  `OBJECT_STORAGE_FAKE=1`: the vitest setup (`src/test-support/setupObjectStorage.ts` in each
  API) starts a local fake of the sidecar + the GCS endpoints the client uses and points the
  real storage client at it via `OBJECT_STORAGE_SIDECAR_ENDPOINT` / `OBJECT_STORAGE_API_ENDPOINT`
  (both ignored when `NODE_ENV=production`). This proves the app's upload flow (signed URL →
  PUT → register → doctor download, type/size/ownership checks) but not the Replit production
  bucket configuration. End-to-end browser tests: see `e2e/README.md`.

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
   (health check `/regen-api/healthz`; readiness `/regen-api/readyz`) next to DocKnee's `/api`.
6. Apply the schema changes of this release to the production DocRegen database
   (`push`, reviewed): new tables `rate_limit_buckets`, `auth_lockouts`, `temp_pdfs`,
   `lgpd_requests`; new columns `audit_logs.actor_role/secretary_id/patient_link_hash`,
   `whatsapp_outbox.doctor_id`; unique indexes on `lower(email)` (doctors, secretaries);
   FK `regen_cases.doctor_id → doctors (RESTRICT)`. The server refuses to start until they exist.

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
