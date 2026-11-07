"""Repair the known unversioned-demo role FK gap without changing user data."""

from alembic import op
import sqlalchemy as sa

revision = "0003_legacy_role_fk"
down_revision = "0002_payoneer_accounts"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    keys = sa.inspect(bind).get_foreign_keys("users")
    if not any(
        fk["constrained_columns"] == ["role"] and fk["referred_table"] == "roles"
        for fk in keys
    ):
        # Fail before a rebuild if old data contains unrecognized roles.
        count = bind.scalar(
            sa.text(
                "SELECT COUNT(*) FROM users u LEFT JOIN roles r ON u.role=r.name WHERE r.name IS NULL"
            )
        )
        if count:
            raise RuntimeError(
                "Unrecognized user roles require manual repair before adding the role FK"
            )
        with op.batch_alter_table("users") as batch:
            batch.create_foreign_key("user_role_fk", "roles", ["role"], ["name"])


def downgrade():
    raise RuntimeError(
        "Do not remove role integrity checks from a payment application."
    )
