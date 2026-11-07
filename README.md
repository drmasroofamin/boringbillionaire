# Boring Billionaire

A responsive React + Tailwind application backed by FastAPI, SQLAlchemy, PostgreSQL, and authenticated WebSockets. White, deep navy, and warm gold; everyday bills meet everyday kindness.

**Current release is a working, single-server demo. No real money is accepted or transferred. Live mode deliberately refuses to start.** Payoneer gateway/payout execution, signed webhook processing, durable retries, external KYC, and SMS delivery still require production adapters and merchant onboarding. Environment variables alone do not enable these integrations.

## Quick start

Requires Python 3.12+, Node 22+, and npm. The checked-in lockfile pins frontend dependencies.

```bash
cd backend
python -m venv .venv
.venv/bin/pip install -r requirements.txt
cp -n ../.env.example .env
# Replace JWT_SECRET with a securely generated random value before use.
.venv/bin/python -m alembic upgrade head
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
```

In a second terminal:

```bash
cd frontend
npm ci --cache /tmp/boring-npm-cache
npm run dev
```

Open the frontend on port 5173. Vite proxies `/api` and WebSockets to port 8000. The default database is local SQLite for an easy demo; use PostgreSQL for development with production-like row locking. Seed data is inserted once into an empty database, only in demo mode. Keep one API worker: WebSockets, OTPs, and rate-limit state are process-local.

### Demo accounts

Use the three demo buttons on the sign-in screen, or:

| Role | Email | Password |
| --- | --- | --- |
| Billionaire | donor@example.com | DemoPass123! |
| General user | user@example.com | DemoPass123! |
| Admin | admin@example.com | DemoPass123! |

The donor starts with ₹2,50,000 in **simulated** funds. Six reviewed bills cover electricity, education, medical, rent, loan EMI, and phone categories. Seed users have demo KYC and the seeded general user has a synthetic verified Payoneer recipient. New accounts start unapproved with pending KYC. Donor signup returns a TOTP provisioning URI exactly once; add it to an authenticator and wait for admin approval. Demo seeded donor bypasses 2FA explicitly; new donor accounts require TOTP. General-user OTPs are random, expire after five minutes, allow five attempts, and are single use; the demo exposes the code on screen and sends no SMS.

## PostgreSQL

A Compose file starts PostgreSQL 16 and the API; run the frontend separately. Supply your own local development password and signing secret. Do not reuse the example credentials in deployment.

```bash
export POSTGRES_PASSWORD='your-local-development-password'
export JWT_SECRET="$(python -c 'import secrets; print(secrets.token_urlsafe(48))')"
docker compose up --build
```

Alternatively point `backend/.env` at an existing database:

```dotenv
DATABASE_URL=postgresql+psycopg://user:password@localhost:5432/boring
```

For Docker builds behind a TLS-inspecting proxy, mount the platform CA as a BuildKit secret and configure `PIP_CERT` for the installing step; never disable TLS verification. The Dockerfile supports an optional `proxy_ca` secret.

```bash
docker build --secret id=proxy_ca,src=/path/to/trusted-ca-bundle.pem -t boring-api backend
```

## Workflows

- **Billionaire:** sign in, browse live bills, filter by category/location/urgency, sort by amount/date, inspect a bill summary, contribute partially or fully, top up simulated funds, inspect impact and transactions, submit payment disputes.
- **General user:** sign in with OTP or the seeded demo account, complete profile, connect a synthetic demo Payoneer recipient from My profile, upload a JPEG/PNG/PDF bill (10 MB max), inspect review status and outstanding debt, receive demo payment notifications and history.
- **Admin:** review bill documents, approve/reject bills, approve donors, mark demo KYC, inspect transactions, resolve disputes, reverse a demo contribution with an idempotent refund.
- Changes invalidate authenticated clients via WebSockets; clients fetch fresh, role-filtered data. A subtle “New bill” animation marks newly published requests. Reconnects fetch new short-lived tickets.

A bill remains `Pending Review` until a document and recipient KYC are present and an admin approves it. Live bills remain available through partial contributions and become `Paid` on full simulated settlement. `Funded` is reserved for a future asynchronous provider settlement phase; demo payments settle immediately. A bill with a failed upload remains pending so the owner can attach the file from its detail screen without recreating the bill.

### Privacy & storage

Original documents are accessible only to the owner and admin via authorized file endpoints. Donors see a bill summary, masked beneficiary identity, and an optional admin-published redacted image. Admins can publish a separately redacted JPEG/PNG from bill details; this is a **manual privacy review**, not automatic redaction. Without a published image, only the bill summary appears. Admins must review public notes, title, biller, and location for accidental personal information. Uploaded document hashes detect identical files globally; metadata detects repeat submissions per user. Magic-byte and size validation is implemented; malware scanning and full document parsing are not.

Set `S3_BUCKET` and `AWS_REGION` to use private AWS S3 with server-side AES256 encryption and short-lived signed reads; AWS credentials use the standard SDK credential chain. Keep the bucket private with public access blocked and allow GET CORS from your frontend origin for signed document reads. Without a bucket, files use ignored `backend/uploads/`. Original filenames never become filesystem paths. S3 integration requires AWS access and is not part of the offline demo validation.

### Money and security

All monetary values are integer paise. Funding validates approval, KYC, bill status, verified Payoneer payee identity, remaining bill amount, and available balance. A transaction, payout, audit record, notification, wallet debit, and funded amount are committed atomically. PostgreSQL `FOR UPDATE` locks serialize writes; a process mutex also makes local SQLite demos deterministic. Every funding/top-up request requires an idempotency key and checks replay ownership and parameters. Demo refunds reverse the contribution once, reopen the remaining bill, and retain the original audit trail. Refunds do not claim to reverse a real external wallet credit.

JWTs expire after one hour. Passwords use Argon2. Role restrictions are enforced on the API. WebSockets authenticate through a short-lived purpose-bound ticket in the first message, keeping access tokens out of URLs. CORS permits one configured origin. All responses disable caching and MIME sniffing. Uploaded files and account lists require authorization. The per-IP/path rate limiter, OTP store, socket fanout, and JWT revocation are intentionally single-instance; production needs shared infrastructure, strict trusted proxy configuration, and session revocation. JWTs are held in tab session storage; a production deployment should use secure HttpOnly cookies with CSRF protection and a strict CSP.

## Payoneer and real-money readiness

The provider is now **Payoneer**. A phone number is a login/contact detail, never a payout destination. `payout_accounts` stores a provider-issued payee identity and verification state; `payout_routes` freezes the payee, provider, currency, and demo flag for each new payout. The demo recipient connection generates an unmistakably synthetic identity and cannot bind a user-supplied real account ID.

Payoneer funding and payouts require a product/partner contract that supports this platform's flow. A personal Payoneer account or a client secret is not sufficient evidence. Do not assume a particular country, INR settlement, wallet-like custody, donation use case, or merchant checkout is supported. The rupee UI is demo-only until the contracted currency and funding model are confirmed.

See [Payoneer integration requirements](docs/PAYONEER.md) and [deployment and migrations](docs/DEPLOYMENT.md). No guessed Payoneer API endpoint, signature scheme, or production money-moving adapter is included. The webhook route `/api/payoneer/webhook` rejects requests without modifying balances; payout retries remain disabled. The earlier provider is no longer configured or presented in the UI.

Run the inspectable readiness report from `backend`:

```bash
.venv/bin/python -m app.readiness
```

It deliberately exits **1** while launch blockers exist. Admins can see the same report in **Payment readiness**. Even with all credentials present, live startup fails until the adapter, authenticated status reconciliation, durable settlement/retries, identity providers, session controls, and operational certification are implemented and verified. No environment flag can declare missing code certified.

## Checks

```bash
cd backend
.venv/bin/python -m pytest -q
cd ../frontend
npm run build
```

The API tests exercise funding/idempotency, overpayment/negative-amount rejection, simultaneous payment attempts, role boundaries, document access and duplicates, review/publish, dispute/refund accounting, forged callback rejection, single-use OTPs, and authenticated WebSocket invalidation. Tests create an isolated SQLite database and do not contact Payoneer or AWS. PostgreSQL integration may be tested separately with `BB_TEST_DATABASE_URL` pointing at a **disposable empty** database; test seed data is retained in that database.

```bash
cd backend
BB_TEST_DATABASE_URL=postgresql+psycopg://user:password@localhost:5432/boring_test .venv/bin/python -m pytest -q
```

For browser checks, start both servers then run `npm run test:e2e` from `frontend`. Set `CHROMIUM_PATH` to an existing Chromium executable or run `npx playwright install chromium`. The browser test checks donor funding/top-up, user upload, admin publishing, live updates, and a 390px viewport. It uses demo data and modifies the current demo database.

## Structure

```text
frontend/src/main.tsx       React role workflows and live client
frontend/src/styles.css     Responsive design, Tailwind, reduced-motion support
backend/app/main.py         Auth, bills, money, admin, uploads, WebSockets
backend/app/models.py       SQLAlchemy tables and money ledger
backend/app/seed.py         Idempotent demo identities and six bills
backend/tests/              API integration tests
compose.yaml               PostgreSQL + API services
.env.example               Server configuration names, no real credentials
```

The UI is a mobile-responsive website, not a native iOS/Android binary. OCR is optional and not implemented. Deploy the built frontend behind an HTTPS reverse proxy that serves `frontend/dist`, proxies `/api`, and supports WebSocket upgrades. The Vite server is for development only. No remote deployment has been performed.
