"""Separate Payoneer payees from mobile numbers and protect money invariants."""

from alembic import op
import sqlalchemy as sa

revision = "0002_payoneer_accounts"
down_revision = "0001_demo_schema"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "payout_accounts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id"),
            nullable=False,
            unique=True,
        ),
        sa.Column("provider", sa.String(30), nullable=False),
        sa.Column("payee_id", sa.String(160), nullable=False, unique=True),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("is_demo", sa.Integer(), nullable=False),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "payout_routes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "transaction_id",
            sa.String(64),
            sa.ForeignKey("transactions.id"),
            nullable=False,
            unique=True,
        ),
        sa.Column("provider", sa.String(30), nullable=False),
        sa.Column("payee_id", sa.String(160), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("is_demo", sa.Integer(), nullable=False),
    )
    with op.batch_alter_table("wallets") as batch:
        batch.alter_column(
            "balance",
            existing_type=sa.Integer(),
            type_=sa.BigInteger(),
            existing_nullable=False,
        )
        batch.create_check_constraint("wallet_balance_nonnegative", "balance >= 0")
    with op.batch_alter_table("bills") as batch:
        batch.alter_column(
            "amount",
            existing_type=sa.Integer(),
            type_=sa.BigInteger(),
            existing_nullable=False,
        )
        batch.alter_column(
            "funded",
            existing_type=sa.Integer(),
            type_=sa.BigInteger(),
            existing_nullable=False,
        )
        batch.create_check_constraint("bill_amount_positive", "amount > 0")
        batch.create_check_constraint(
            "bill_funded_in_range", "funded >= 0 AND funded <= amount"
        )
    with op.batch_alter_table("transactions") as batch:
        batch.alter_column(
            "amount",
            existing_type=sa.Integer(),
            type_=sa.BigInteger(),
            existing_nullable=False,
        )
        batch.create_check_constraint("transaction_amount_positive", "amount > 0")


def downgrade():
    # No automatic narrowing of monetary values: it can overflow and lose financial data.
    raise RuntimeError(
        "Financial schema downgrade requires a reviewed, backed-up migration."
    )
