from fastapi.testclient import TestClient
from sqlalchemy import select
from app.main import app
from app.models import PayoutRoute, PayoutAccount
from app.config import SessionLocal
from test_workflows import login


def test_payee_identity_is_separate_from_mobile_and_cannot_be_injected():
    with TestClient(app) as c:
        phone = "9000000009"
        code = c.post("/api/auth/otp", json={"mobile": phone}).json()["demo_code"]
        result = c.post(
            "/api/auth/otp/verify",
            json={"mobile": phone, "code": code, "name": "Payoneer member"},
        ).json()
        auth = {"Authorization": "Bearer " + result["access_token"]}
        assert (
            c.get("/api/payout-account", headers=auth).json()["status"]
            == "not_connected"
        )
        # User-supplied provider IDs never bind another person's real account.
        result = c.post(
            "/api/payout-account/connect",
            headers=auth,
            json={"payee_id": "someone-elses-payee", "status": "verified"},
        )
        assert result.status_code == 200
        assert result.json()["is_demo"] and result.json()["status"] == "verified"
        with SessionLocal() as db:
            account = db.scalar(
                select(PayoutAccount).where(
                    PayoutAccount.user_id == c.get("/api/me", headers=auth).json()["id"]
                )
            )
            assert (
                account.payee_id.startswith("demo-payoneer-")
                and account.payee_id != "someone-elses-payee"
            )
        assert (
            c.post("/api/payout-account/connect", headers=auth).json() == result.json()
        )
        assert c.get("/api/payout-account", headers=login(c)).status_code == 403
        assert c.get("/api/admin/readiness", headers=auth).status_code == 403
        readiness = c.get("/api/admin/readiness", headers=login(c, "admin")).json()
        assert (
            readiness["provider"] == "payoneer"
            and readiness["ready_for_real_money"] is False
        )
        assert (
            c.post(
                "/api/payoneer/webhook", json={"status": "paid", "amount": 999999}
            ).status_code
            == 503
        )


def test_payout_records_provider_and_recipient_snapshot():
    with TestClient(app) as c:
        donor = login(c)
        b = next(
            b
            for b in c.get("/api/bills", headers=donor).json()
            if b["status"] == "Live"
        )
        result = c.post(
            f"/api/bills/{b['id']}/pay",
            headers={**donor, "Idempotency-Key": "payoneer-route-snapshot"},
            json={"amount": 100},
        )
        assert result.status_code == 200, result.text
        with SessionLocal() as db:
            route = db.scalar(
                select(PayoutRoute).where(
                    PayoutRoute.transaction_id == result.json()["transaction_id"]
                )
            )
            assert route.provider == "payoneer" and route.payee_id.startswith(
                "demo-payoneer-"
            )
            assert route.currency == "INR" and route.is_demo == 1
        assert (
            c.post(
                "/api/wallet/topup",
                headers={**donor, "Idempotency-Key": "reject-bool-money"},
                json={"amount": True},
            ).status_code
            == 422
        )
        assert (
            c.post(
                "/api/wallet/topup",
                headers={**donor, "Idempotency-Key": "reject-fractional-paise"},
                json={"amount": 1.5},
            ).status_code
            == 422
        )
