# Deployment and database operations

The checked-in app is a Payoneer-oriented **demo**, not a live-money release. Review `PAYONEER.md` first. Docker Compose runs the API and PostgreSQL for development; no public deployment has been performed.

## Fresh database

From `backend`, configure `DATABASE_URL` through a protected `.env` or injected secret, then run:

```bash
.venv/bin/python -m alembic upgrade head
.venv/bin/python -m alembic check
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Migration `0001_demo_schema` records the original schema. `0002_payoneer_accounts` adds provider accounts/routing, converts monetary columns to 64-bit integers, and adds nonnegative balance, positive amount, and funded-range constraints. `0003_legacy_role_fk` repairs the known missing roles foreign key in older local demo databases and rejects unknown role values. There is no automatic financial downgrade: it can narrow values or lose evidence. Use a reviewed, backed-up migration for recovery.

The API still creates missing tables in demo mode for convenience, but use migrations first so the version history is recorded. The Docker entrypoint checks the live guard, migrates, then starts one API process. For a future multi-replica deployment, run migrations as a separate one-off release job, never concurrently across replicas.

## Existing unversioned demo

Stop the API and make a recoverable database backup first. Inspect actual tables, columns, indexes, and data before assigning an Alembic baseline. `alembic stamp` does not verify or migrate schema.

Only a database verified to match the original schema (or its specifically reviewed missing-role-FK legacy variant) (with no `payout_accounts`, `payout_routes`, or new financial constraints yet) can be stamped `0001_demo_schema` and upgraded. A database already matching all current tables/types/constraints can be stamped to head after verification. Partial or unknown schemas require a tailored migration. Never blindly stamp a real-money database, delete financial data, or replace the user's database with a demo seed.

Existing legacy demo transactions are retained. They have no retrospectively invented provider route: new Payoneer-route snapshots begin with new payments. The demo seed only connects the original seeded `user@example.com` account to a synthetic Payoneer identity; newly registered members connect themselves from My profile.

## Secrets and network

- Keep `.env`, database files, uploads, signing keys, OAuth secrets, and provider callback payloads out of Git.
- Provide a strong, persistent `JWT_SECRET`, an exact HTTPS `CORS_ORIGIN`, private object storage, and a managed PostgreSQL database with TLS, backups, and restore tests.
- Only allow the provider destinations documented in your approved partner contract; retain inherited TLS/proxy trust. Do not disable signature/TLS verification.
- Rotate any secret exposed outside the intended environment. Never place provider secrets in `VITE_*`, browser code, screenshots, URLs, or logs.

## Serving the frontend

`npm ci && npm run build` in `frontend` creates `dist`. Serve that static directory behind a managed HTTPS reverse proxy. Proxy `/api/` to the API, preserving WebSocket upgrades, and serve the SPA entrypoint for application routes. Apply CSP/frame restrictions, a request-body limit consistent with 10 MB uploads, connection/time limits, and trusted proxy/rate-limit configuration. Vite's dev server is not a production server.

Demo state (OTP codes, rate limits, sockets) is process-local. Production requires shared infrastructure and removal of demo bypasses after genuine identity and payment providers are integrated. The startup guard intentionally blocks a premature live deployment.

## Validation and release

GitHub Actions runs migration drift checks and API tests against PostgreSQL, the frontend build, and browser workflows. Local tests additionally cover SQLite migrations/constraints and refusal to enable live mode with credentials alone. CI uses disposable demo credentials and does not contact Payoneer.

Before real money: pass `python -m app.readiness`, finish partner sandbox certification, verify reconciliation and rollback/recovery, conduct a controlled approved live test, and review the final launch configuration. Do not equate a successful Git push or CI run with payment-partner approval or production readiness.
