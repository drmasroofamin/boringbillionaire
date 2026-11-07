import pytest
from app.config import Settings
from app.readiness import report, require_demo_or_certified


def test_credentials_cannot_bypass_unimplemented_money_integrations():
    config = Settings(
        _env_file=None,
        demo_mode=False,
        database_url="postgresql+psycopg://user@db/app",
        jwt_secret="s" * 48,
        cors_origin="https://app.example.org",
        s3_bucket="private-bills",
        payoneer_environment="live",
        payoneer_client_id="test-id",
        payoneer_client_secret="TEST-SECRET-NOT-REAL",
        payoneer_program_id="test-program",
    )
    result = report(config)
    assert not result["ready_for_real_money"]
    assert "TEST-SECRET-NOT-REAL" not in str(result)
    checks = {x["id"]: x["passed"] for x in result["checks"]}
    assert checks["payoneer_credentials"] and checks["postgresql"]
    assert not checks["payoneer_partner_adapter"] and not checks["verified_webhooks"]
    with pytest.raises(RuntimeError, match="Real-money startup blocked"):
        require_demo_or_certified(config)


def test_demo_boot_is_allowed_but_never_reports_live_ready():
    config = Settings(_env_file=None, demo_mode=True)
    require_demo_or_certified(config)
    assert report(config)["mode"] == "demo"
    assert not report(config)["ready_for_real_money"]
