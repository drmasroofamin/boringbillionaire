"""Fail-closed, inspectable production prerequisites. Never reports live readiness
based solely on credentials or an operator-supplied approval flag.
"""

import json
from urllib.parse import urlsplit
from .config import Settings, settings


def report(config: Settings) -> dict:
    origin = urlsplit(config.cors_origin)
    secret = config.jwt_secret
    checks = [
        (
            "demo_disabled",
            not config.demo_mode,
            "Demo mode must be off for real money.",
        ),
        (
            "postgresql",
            config.database_url.startswith("postgresql"),
            "Use PostgreSQL with migrations, backups, and restore verification.",
        ),
        (
            "jwt_secret",
            len(secret) >= 32
            and not any(
                word in secret.lower()
                for word in ["replace-with", "change-me", "example", "demopass"]
            ),
            "Provide a strong, persistent JWT signing key.",
        ),
        (
            "https_origin",
            origin.scheme == "https"
            and bool(origin.hostname)
            and origin.hostname not in ["localhost", "127.0.0.1"],
            "Use an HTTPS app origin and restrict cross-origin access.",
        ),
        (
            "private_storage",
            bool(config.s3_bucket),
            "Configure and verify private bill storage and document scanning.",
        ),
        (
            "payoneer_credentials",
            bool(
                config.payoneer_client_id
                and config.payoneer_client_secret.get_secret_value()
                and config.payoneer_program_id
            ),
            "Supply partner credentials through secure environment settings, never Git.",
        ),
        (
            "payoneer_environment",
            config.payoneer_environment == "live",
            "Select live only after sandbox certification.",
        ),
        # These are code/integration blockers, deliberately not configurable booleans.
        (
            "payoneer_partner_adapter",
            False,
            "Approved Payoneer API contract, hosted payee registration, merchant funding, and payout adapters remain to be implemented and certified.",
        ),
        (
            "verified_webhooks",
            False,
            "Provider-specific webhook authentication, status lookup, amount/currency reconciliation, and replay protection are not implemented.",
        ),
        (
            "durable_settlement",
            False,
            "Implement reservation/outbox processing, idempotent payout retries, ambiguous-result reconciliation, and provider-confirmed refunds.",
        ),
        (
            "identity_and_sessions",
            False,
            "Connect verified SMS/KYC, enforce 2FA, and implement durable OTP/rate-limit/session revocation stores.",
        ),
        (
            "operational_certification",
            False,
            "Validate supported countries/currencies, approved custody flow, monitoring, reconciliation, and recovery before enabling money movement.",
        ),
    ]
    return {
        "provider": "payoneer",
        "mode": "demo" if config.demo_mode else "live_requested",
        "ready_for_real_money": all(ok for _, ok, _ in checks),
        "checks": [
            {"id": name, "passed": ok, "requirement": message}
            for name, ok, message in checks
        ],
    }


def require_demo_or_certified(config: Settings):
    if not config.demo_mode:
        blockers = [
            check["id"] for check in report(config)["checks"] if not check["passed"]
        ]
        raise RuntimeError(
            "Real-money startup blocked: "
            + ", ".join(blockers)
            + ". Run python -m app.readiness; see docs/PAYONEER.md."
        )


if __name__ == "__main__":
    result = report(settings)
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result["ready_for_real_money"] else 1)
