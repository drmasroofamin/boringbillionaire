"""Exercise money invariants and role boundaries through the real API."""

from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient
from sqlalchemy import select
from app.main import app
from app.config import SessionLocal
from app.models import AuditLog, Bill, Payout


def login(c, role="donor"):
    email = {"general": "user", "donor": "donor", "admin": "admin"}[
        role
    ] + "@example.com"
    r = c.post(
        "/api/auth/login",
        json={"email": email, "password": "DemoPass123!", "role": role},
    )
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["access_token"]}


def test_full_workflow_and_money_invariants():
    with TestClient(app) as c:
        donor = login(c)
        general = login(c, "general")
        admin = login(c, "admin")
        bill = c.get("/api/bills", headers=donor).json()[-1]
        assert "mobile" not in bill and "user_id" not in bill
        assert c.get("/api/admin/users", headers=donor).status_code == 403
        start = c.get("/api/wallet", headers=donor).json()["balance"]
        headers = {**donor, "Idempotency-Key": "test-contribution-0001"}
        path = f"/api/bills/{bill['id']}/pay"
        r = c.post(path, headers=headers, json={"amount": 10000})
        assert r.status_code == 200, r.text
        tid = r.json()["transaction_id"]
        assert (
            c.post(path, headers=headers, json={"amount": 10000}).json()[
                "transaction_id"
            ]
            == tid
        )
        assert c.get("/api/wallet", headers=donor).json()["balance"] == start - 10000
        assert (
            c.post(
                path,
                headers={**donor, "Idempotency-Key": "overpay-test-0001"},
                json={"amount": bill["amount"]},
            ).status_code
            == 409
        )
        assert (
            c.post(
                path,
                headers={**general, "Idempotency-Key": "role-test-0001"},
                json={"amount": 100},
            ).status_code
            == 403
        )
        assert (
            c.post(
                path,
                headers={**donor, "Idempotency-Key": "negative-test-0001"},
                json={"amount": -1},
            ).status_code
            == 422
        )
        assert c.post(path, headers=headers, json={"amount": 20000}).status_code == 409
        assert len(c.get("/api/notifications", headers=general).json()) >= 1
        assert (
            c.post(
                "/api/disputes",
                headers=donor,
                json={
                    "transaction_id": tid,
                    "reason": "Please review this demo contribution.",
                },
            ).status_code
            == 200
        )
        for _ in range(2):
            assert (
                c.post(
                    f"/api/admin/transactions/{tid}/refund", headers=admin
                ).status_code
                == 200
            )
        assert c.get("/api/wallet", headers=donor).json()["balance"] == start
        assert (
            c.post(
                "/api/payoneer/webhook", json={"status": "success", "amount": 100000}
            ).status_code
            == 503
        )
        assert c.get("/api/wallet", headers=donor).json()["balance"] == start
        with SessionLocal() as db:
            assert db.scalar(select(AuditLog).where(AuditLog.action == "demo_funding"))
            assert (
                db.scalar(select(Payout).where(Payout.transaction_id == tid)).status
                == "demo_reversed"
            )


def test_upload_review_document_privacy_and_concurrency():
    with TestClient(app) as c:
        donor = login(c)
        general = login(c, "general")
        admin = login(c, "admin")
        data = {
            "title": "A new medical bill",
            "bill_type": "medical",
            "amount": 50000,
            "due_date": "2027-01-01",
            "biller": "Test Clinic",
            "note": "A test family needs a little support.",
            "location": "Delhi",
        }
        r = c.post("/api/bills", headers=general, json=data)
        assert r.status_code == 200, r.text
        bid = r.json()["id"]
        assert c.post("/api/bills", headers=general, json=data).status_code == 409
        assert not any(
            b["id"] == bid for b in c.get("/api/bills", headers=donor).json()
        )
        assert (
            c.post(
                f"/api/admin/bills/{bid}/review",
                headers=admin,
                json={"decision": "approve"},
            ).status_code
            == 409
        )
        assert (
            c.post(
                f"/api/bills/{bid}/file",
                headers=general,
                files={"file": ("bad.png", b"not a png", "image/png")},
            ).status_code
            == 422
        )
        doc = b"%PDF-1.4\nDemo bill for API privacy tests\n%%EOF"
        r = c.post(
            f"/api/bills/{bid}/file",
            headers=general,
            files={"file": ("bill.pdf", doc, "application/pdf")},
        )
        assert r.status_code == 200
        fid = r.json()["id"]
        assert (
            c.post(
                f"/api/bills/{bid}/file",
                headers=general,
                files={"file": ("bill.pdf", doc, "application/pdf")},
            ).status_code
            == 409
        )
        assert c.get(f"/api/files/{fid}", headers=donor).status_code == 403
        assert c.get(f"/api/files/{fid}", headers=admin).content == doc
        import base64

        image = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1cAAAAASUVORK5CYII="
        )
        assert (
            c.post(
                f"/api/admin/bills/{bid}/preview",
                headers=donor,
                files={"file": ("safe.png", image, "image/png")},
            ).status_code
            == 403
        )
        assert (
            c.post(
                f"/api/admin/bills/{bid}/preview",
                headers=admin,
                files={"file": ("safe.png", image, "image/png")},
            ).status_code
            == 200
        )
        pending = next(
            b for b in c.get("/api/bills", headers=admin).json() if b["id"] == bid
        )
        assert (
            c.get(f"/api/previews/{pending['preview_id']}", headers=donor).status_code
            == 403
        )
        assert (
            c.post(
                f"/api/admin/bills/{bid}/review",
                headers=admin,
                json={"decision": "approve"},
            ).json()["status"]
            == "Live"
        )
        assert (
            c.get(f"/api/previews/{pending['preview_id']}", headers=donor).content
            == image
        )
        assert any(b["id"] == bid for b in c.get("/api/bills", headers=donor).json())

        def fund(i):
            return c.post(
                f"/api/bills/{bid}/pay",
                headers={**donor, "Idempotency-Key": f"concurrent-payment-{i}"},
                json={"amount": 50000},
            ).status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            codes = list(pool.map(fund, [1, 2]))
        assert sorted(codes) == [200, 409]
        with SessionLocal() as db:
            b = db.get(Bill, bid)
            assert b.funded == 50000 and b.status == "Paid"


def test_otp_single_use_and_realtime():
    with TestClient(app) as c:
        phone = "9000000001"
        r = c.post("/api/auth/otp", json={"mobile": phone})
        assert r.status_code == 200
        code = r.json()["demo_code"]
        assert (
            c.post(
                "/api/auth/otp/verify", json={"mobile": phone, "code": "invalid"}
            ).status_code
            == 401
        )
        r = c.post(
            "/api/auth/otp/verify",
            json={"mobile": phone, "code": code, "name": "Test member"},
        )
        assert r.status_code == 200
        assert (
            c.post(
                "/api/auth/otp/verify", json={"mobile": phone, "code": code}
            ).status_code
            == 401
        )
        donor = login(c)
        ticket = c.post("/api/realtime-ticket", headers=donor).json()["ticket"]
        with c.websocket_connect("/api/ws") as ws:
            ws.send_json({"ticket": ticket})
            ws.send_text("ping")
            r = c.post(
                "/api/wallet/topup",
                headers={**donor, "Idempotency-Key": "websocket-topup-0001"},
                json={"amount": 10000},
            )
            assert r.status_code == 200
            assert ws.receive_json() == {"type": "refresh"}
            assert (
                c.post(
                    "/api/wallet/topup",
                    headers={**donor, "Idempotency-Key": "websocket-topup-0001"},
                    json={"amount": 10000},
                ).json()["transaction_id"]
                == r.json()["transaction_id"]
            )
