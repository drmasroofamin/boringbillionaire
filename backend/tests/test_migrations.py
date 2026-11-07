import os
import subprocess
import sys
from pathlib import Path
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError
import pytest


def test_fresh_migration_is_repeatable_and_money_constraints_hold(tmp_path):
    url = f"sqlite:///{tmp_path / 'migrated.db'}"
    env = {**os.environ, "DATABASE_URL": url}
    backend = Path(__file__).resolve().parents[1]
    for _ in range(2):
        result = subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            cwd=backend,
            env=env,
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, result.stderr
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "check"],
        cwd=backend,
        env=env,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    engine = create_engine(url)
    assert {"payout_accounts", "payout_routes", "alembic_version"} <= set(
        inspect(engine).get_table_names()
    )
    with engine.begin() as db:
        db.execute(text("INSERT INTO roles (name) VALUES ('donor')"))
        db.execute(
            text(
                "INSERT INTO users (id,name,password_hash,role,approved,kyc_status,location) VALUES (1,'Test','','donor',1,'verified','India')"
            )
        )
        db.execute(text("INSERT INTO wallets (user_id,balance) VALUES (1,5000000000)"))
    with pytest.raises(IntegrityError), engine.begin() as db:
        db.execute(text("UPDATE wallets SET balance=-1"))
    with engine.connect() as db:
        assert db.scalar(text("SELECT balance FROM wallets")) == 5000000000


def test_known_legacy_role_gap_is_repaired_without_losing_data(tmp_path):
    from sqlalchemy import MetaData, ForeignKeyConstraint
    from app.models import User

    url = f"sqlite:///{tmp_path / 'legacy.db'}"
    env = {**os.environ, "DATABASE_URL": url}
    backend = Path(__file__).resolve().parents[1]
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "0001_demo_schema"],
        cwd=backend,
        env=env,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    engine = create_engine(url)
    legacy = User.__table__.to_metadata(MetaData())
    for constraint in list(legacy.constraints):
        if isinstance(constraint, ForeignKeyConstraint):
            legacy.constraints.remove(constraint)
    legacy.foreign_keys.clear()
    legacy.c.role.foreign_keys.clear()
    with engine.begin() as db:
        db.execute(text("DROP TABLE users"))
        legacy.create(db)
        db.execute(text("INSERT INTO roles (name) VALUES ('general')"))
        db.execute(
            text(
                "INSERT INTO users (id,name,password_hash,role,approved,kyc_status,location) VALUES (42,'Preserved member','','general',0,'pending','India')"
            )
        )
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=backend,
        env=env,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    # External DDL invalidates SQLite's cached schema on existing pooled handles.
    engine.dispose()
    assert any(
        key["referred_table"] == "roles"
        for key in inspect(engine).get_foreign_keys("users")
    )
    with engine.connect() as db:
        assert (
            db.scalar(text("SELECT name FROM users WHERE id=42")) == "Preserved member"
        )
        assert db.execute(text("PRAGMA foreign_key_check")).fetchall() == []
