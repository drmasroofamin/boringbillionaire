"""Configure isolation before any app import, including non-workflow tests."""

import os
import tempfile
from pathlib import Path
import pytest

_test_dir = tempfile.TemporaryDirectory(prefix="bb-tests-")
os.environ["DATABASE_URL"] = os.environ.get(
    "BB_TEST_DATABASE_URL", f"sqlite:///{Path(_test_dir.name) / 'test.db'}"
)
os.environ["DEMO_MODE"] = "true"
os.environ["JWT_SECRET"] = "test-only-signing-key-never-use-in-production-12345"


@pytest.fixture(autouse=True)
def reset_rate_limits():
    from app.main import hits, otps

    hits.clear()
    otps.clear()
    yield
