"""Idempotent demo-only seed. Never inserts demo identities in live mode."""

from datetime import date, timedelta
from pwdlib import PasswordHash
from sqlalchemy import select
from .config import SessionLocal, settings
from .models import User, Wallet, Bill, Role, PayoutAccount, now

EXAMPLES = [
    (
        "A little light goes a long way",
        "electricity",
        245000,
        2,
        "BSES Rajdhani",
        "A tough month shouldn’t mean a dark home. Help a family keep the lights on while they get back on their feet.",
        "New Delhi",
        1,
    ),
    (
        "Help her stay in the classroom",
        "school fees",
        1250000,
        5,
        "Sunrise Public School",
        "A bright student with big dreams. Your support covers this term’s school fees and keeps her learning.",
        "Jaipur",
        0,
    ),
    (
        "A healthier tomorrow starts here",
        "medical",
        870000,
        1,
        "City Care Hospital",
        "An unexpected hospital visit has stretched this family’s savings. A little help will make recovery easier.",
        "Mumbai",
        1,
    ),
    (
        "Keep a roof over their dreams",
        "rent",
        650000,
        4,
        "Monthly housing rent",
        "Between jobs, but not giving up. Help a small family stay in their home for another month.",
        "Pune",
        0,
    ),
    (
        "One less thing on his plate",
        "loan EMI",
        420000,
        7,
        "Education loan",
        "A first-generation graduate is finding his footing. Help him cover an education loan instalment.",
        "Bengaluru",
        0,
    ),
    (
        "Stay connected to possibility",
        "phone",
        79900,
        3,
        "Jio Postpaid",
        "A working phone means access to interviews, work, and family. Help keep those connections alive.",
        "Lucknow",
        0,
    ),
]


def seed():
    if not settings.demo_mode:
        return
    with SessionLocal() as db:
        for role in ["general", "donor", "admin"]:
            if not db.get(Role, role):
                db.add(Role(name=role))
        db.commit()
        # Upgrade existing local demos without changing identities or balances.
        for member in db.scalars(
            select(User).where(User.role == "general", User.email == "user@example.com")
        ):
            if not db.scalar(
                select(PayoutAccount).where(PayoutAccount.user_id == member.id)
            ):
                db.add(
                    PayoutAccount(
                        user_id=member.id,
                        provider="payoneer",
                        payee_id=f"demo-payoneer-seed-{member.id}",
                        status="verified",
                        is_demo=1,
                        verified_at=now(),
                    )
                )
        db.commit()
        if db.scalar(select(User.id).limit(1)):
            return
        ph = PasswordHash.recommended()
        for name, email, mobile, role in [
            ("Aarav Mehta", "donor@example.com", None, "donor"),
            ("Priya Sharma", "user@example.com", "9876543210", "general"),
            ("Admin", "admin@example.com", None, "admin"),
        ]:
            user = User(
                name=name,
                email=email,
                mobile=mobile,
                role=role,
                password_hash=ph.hash("DemoPass123!"),
                approved=1,
                kyc_status="verified",
            )
            db.add(user)
            db.flush()
            db.add(Wallet(user_id=user.id, balance=25000000 if role == "donor" else 0))
        db.flush()
        db.add(
            PayoutAccount(
                user_id=2,
                provider="payoneer",
                payee_id="demo-payoneer-seed-2",
                status="verified",
                is_demo=1,
                verified_at=now(),
            )
        )
        for title, kind, amount, days, biller, note, location, urgent in EXAMPLES:
            db.add(
                Bill(
                    user_id=2,
                    title=title,
                    bill_type=kind,
                    amount=amount,
                    due_date=str(date.today() + timedelta(days=days)),
                    biller=biller,
                    note=note,
                    location=location,
                    urgent=urgent,
                    status="Live",
                )
            )
        db.commit()
