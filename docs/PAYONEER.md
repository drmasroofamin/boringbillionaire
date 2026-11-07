# Payoneer integration contract — launch blocked

Payoneer replaces the previous provider throughout the application. This document is an implementation and acceptance contract, not a claim of an approved or working live integration. No actual Payoneer request has been sent.

## What exists

- Provider-specific recipient accounts, distinct from mobile-number login.
- Synthetic demo payees generated on the server, masked when displayed, and not user-selectable provider IDs.
- A snapshot of provider, recipient ID, INR demo currency, and demo flag on each new payment route.
- Atomic simulated wallet debit, bill funding, transaction, payout, notification, and audit records.
- Idempotency checks, PostgreSQL locks, database checks against negative balances/overfunded bills, and 64-bit monetary columns.
- Versioned migrations, an admin launch-readiness report, and a live startup guard.
- A disabled webhook endpoint that never trusts a browser status or credits a balance.

`PAYONEER_CLIENT_ID`, `PAYONEER_CLIENT_SECRET`, and `PAYONEER_PROGRAM_ID` are reserved for the eventual approved partner adapter. These are not used to submit real requests today. Store credentials in deployment/environment secrets, never Git or frontend variables. The client secret is redacted in application settings representations.

## Required from the business/payment partner

1. Written approval for this specific bill-helping, donor-funding, custodial/pooled-balance flow, countries, beneficiaries, and currencies. Payoneer may require a different funding/settlement design; the app must adapt to the approved design rather than invent a wallet product.
2. The contracted product and API versions for **both funding and payouts**. Confirm whether a separate merchant-payments product is available; do not assume a payout API can charge donors.
3. Official sandbox endpoints, authentication/token lifecycle, application/program IDs, permissions, rate limits, idempotency rules, status codes, and test credentials entered securely.
4. Hosted payee registration/onboarding details, return URLs, authoritative verification/status lookup, and recipient eligibility/restrictions.
5. Webhook registration and signature specification (exact signed bytes, headers, timestamp tolerance, replay ID, key rotation), status-query API, and provider references for reconciliation.
6. An HTTPS app domain, callback/return domains approved by the partner, private object storage, SMS and KYC providers, and operational support ownership.

Documentation entry points to verify against the partner's contract:

- https://developer.payoneer.com/
- https://checkoutdocs.payoneer.com/

The current environment's outbound policy blocked these documentation hosts during setup. Required host additions were saved to the environment draft; they must be reviewed/applied before documentation and provider connectivity can be verified. A saved network draft does not prove access works. Do not add guessed API domains or transmit credentials until approved endpoints are known.

## Required implementation after the contract is available

### Hosted recipient registration

Create the payee registration session on the server and redirect the authenticated general user to the provider's hosted flow. Bind the flow to the existing user with a nonce and expiration. A return URL is a navigation event, not proof of verification. Mark `payout_accounts.status` verified only after an authenticated provider callback plus status query confirms the expected user/program/payee. Never accept an arbitrary payee ID supplied by the browser. Store live payees with `is_demo=0`; synthetic payees cannot enter the live adapter.

### Funding

Create a server-side order with stable ID, donor identity, approved amount and currency. Keep it pending until an authenticated provider lookup confirms settled funds, matching merchant/program, order, amount, currency, and a unique provider transaction ID. Deduplicate events atomically. Redirect/query-string success never credits a wallet. Use provider-hosted checkout and do not collect card credentials on this application. Define chargeback handling before making deposited funds withdrawable.

### Durable settlement and reconciliation

Reserve donor funds and bill amount in one PostgreSQL transaction, insert an outbox job with a stable provider order ID, and snapshot the verified payee. Do not hold database locks while making network requests. A fully reserved bill becomes `Funded`, not `Paid`.

A durable worker claims jobs with a lease (`FOR UPDATE SKIP LOCKED`), queries provider status before resubmitting an uncertain request, and always reuses the original provider order/idempotency ID. Signed status plus a server-to-server query determines the outcome. Network timeouts and ambiguous responses keep funds reserved; never mark paid or release a reservation just because a request timed out. Retry only documented retryable failures with bounded backoff, jitter, attempt limits, and manual reconciliation. Unverified or mismatched statuses go to manual review. Confirm all partial payouts before marking the bill `Paid`.

Failed, definitively unsubmitted/rejected payouts release reservations once. A successful external payout cannot be undone by increasing a database balance: refunds need provider-confirmed return of funds or a separately funded compensation transaction, with an explicit audit trail. Support disputes independently of settlement and preserve all provider references without logging secrets or raw sensitive callbacks.

### Identity, custody, and operations

Integrate genuine KYC/SMS and durable OTP/rate-limit storage; enforce donor/admin MFA, session revocation, secure cookies with CSRF protection, encrypted secret handling, and privacy-reviewed bill previews. Add append-only accounting entries and external reconciliation, audit export, alerting, disaster recovery tests, and payment-partner-approved custody/AML rules before launch. The current audit records and mutable wallet totals alone are not a production accounting system.

## Required acceptance tests

- Successful and declined funding, abandoned browser flow, mismatched amount/currency/merchant, forged/replayed/stale signatures, repeated events, and duplicate provider IDs.
- Successful/partial/failed payouts, suspended or changed payees, unsupported currency, provider throttling, timeout-after-acceptance, query-before-retry, worker crash/lease expiry, and multiple workers competing for one job.
- Database rollback at each money-moving step; no duplicate debit/credit/payout; balances reconcile to append-only accounting and provider statements.
- Chargeback/refund after payout, manual reconciliation, webhook key rotation, expired OAuth tokens, clock skew, permissions boundaries, and private documents.
- A complete partner sandbox certification run and small controlled live verification approved by the business before a wider release.

Until these pass, `python -m app.readiness` must fail and `DEMO_MODE=false` must prevent startup. Keep the launch guard in place; setting credentials is not certification.
