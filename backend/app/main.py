"""Boring Billionaire API. Demo money is isolated from live payment operations.

PostgreSQL row locks serialize funding. WebSockets carry invalidations only;
clients re-fetch permission-filtered data instead of receiving private payloads.
"""

import asyncio
import hashlib
import secrets
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone, date
from pathlib import Path
from typing import Literal
import jwt
import pyotp
from fastapi import (
    FastAPI,
    Depends,
    HTTPException,
    Request,
    UploadFile,
    File,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from pwdlib import PasswordHash
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from .config import settings, engine, db_session
from .models import (
    Base,
    User,
    Bill,
    BillFile,
    Wallet,
    Transaction,
    Payout,
    Notification,
    AuditLog,
    Dispute,
    BillPreview,
    PayoutAccount,
    PayoutRoute,
    now,
)
from .seed import seed

ph = PasswordHash.recommended()
security = HTTPBearer()
# Single-instance demo limiter. Deploy behind a shared Redis limiter in production.
hits = defaultdict(deque)
otps = {}
peers: set[WebSocket] = set()
funding_lock = asyncio.Lock()


@asynccontextmanager
async def lifespan(app):
    from .readiness import require_demo_or_certified

    require_demo_or_certified(settings)
    Base.metadata.create_all(engine)
    seed()
    yield


app = FastAPI(title="Boring Billionaire", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.cors_origin],
    allow_methods=["GET", "POST", "PATCH"],
    allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
)


@app.middleware("http")
async def rate_limit(request: Request, call_next):
    key = (request.client.host if request.client else "unknown", request.url.path)
    bucket = hits[key]
    now = time.monotonic()
    while bucket and bucket[0] < now - 60:
        bucket.popleft()
    cap = 10 if "/auth/" in request.url.path else 180
    if len(bucket) >= cap:
        from fastapi.responses import JSONResponse

        return JSONResponse(
            {"detail": "Too many requests. Try again in a minute."},
            status_code=429,
            headers={"Retry-After": "60"},
        )
    bucket.append(now)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Cache-Control"] = "no-store"
    return response


def token(user, purpose="access", minutes=60):
    return jwt.encode(
        {
            "sub": str(user.id),
            "iss": "boring-billionaire",
            "aud": "boring-web",
            "jti": secrets.token_hex(16),
            "purpose": purpose,
            "exp": datetime.now(timezone.utc) + timedelta(minutes=minutes),
        },
        settings.jwt_secret,
        algorithm="HS256",
    )


def decode(raw, purpose="access"):
    try:
        data = jwt.decode(
            raw,
            settings.jwt_secret,
            algorithms=["HS256"],
            issuer="boring-billionaire",
            audience="boring-web",
        )
        if data.get("purpose") != purpose:
            raise ValueError()
        return int(data["sub"])
    except Exception:
        raise HTTPException(401, "Session expired or invalid")


def current_user(
    auth: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(db_session),
):
    user = db.get(User, decode(auth.credentials))
    if not user:
        raise HTTPException(401, "Account not found")
    return user


def require(user, *roles):
    if user.role not in roles:
        raise HTTPException(403, "This action is not available for your role")


def public_user(user):
    return {
        k: getattr(user, k)
        for k in [
            "id",
            "name",
            "email",
            "mobile",
            "role",
            "approved",
            "kyc_status",
            "location",
        ]
    }


async def changed():
    for peer in list(peers):
        try:
            await peer.send_json({"type": "refresh"})
        except Exception:
            peers.discard(peer)


class Login(BaseModel):
    email: str
    password: str
    role: Literal["general", "donor", "admin"]
    code: str = ""


class Signup(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=10, max_length=128)
    role: Literal["general", "donor"]
    mobile: str | None = Field(default=None, pattern=r"^\d{10}$")


@app.post("/api/auth/signup")
def signup(data: Signup, db: Session = Depends(db_session)):
    if "@" not in data.email:
        raise HTTPException(422, "Enter a valid email")
    if db.scalar(select(User).where(User.email == data.email.lower())) or (
        data.mobile and db.scalar(select(User).where(User.mobile == data.mobile))
    ):
        raise HTTPException(409, "Account already exists")
    secret = pyotp.random_base32() if data.role == "donor" else None
    user = User(
        name=data.name,
        email=data.email.lower(),
        password_hash=ph.hash(data.password),
        mobile=data.mobile,
        role=data.role,
        totp_secret=secret,
    )
    db.add(user)
    db.flush()
    db.add(Wallet(user_id=user.id))
    db.commit()
    return {
        "message": "Account created. Donor accounts require admin approval and KYC.",
        "totp_uri": pyotp.TOTP(secret).provisioning_uri(
            data.email, issuer_name="Boring Billionaire"
        )
        if secret
        else None,
    }


@app.post("/api/auth/login")
def login(data: Login, db: Session = Depends(db_session)):
    user = db.scalar(select(User).where(User.email == data.email.lower()))
    if (
        not user
        or user.role != data.role
        or not ph.verify(data.password, user.password_hash)
    ):
        raise HTTPException(401, "Email or password is incorrect")
    if user.role == "donor":
        if not user.approved:
            raise HTTPException(403, "Your donor account is awaiting approval")
        if user.totp_secret and not pyotp.TOTP(user.totp_secret).verify(
            data.code, valid_window=1
        ):
            raise HTTPException(401, "Enter a valid authenticator code")
        if not user.totp_secret and not settings.demo_mode:
            raise HTTPException(403, "Set up 2FA first")
    return {"access_token": token(user), "user": public_user(user)}


class OTPRequest(BaseModel):
    mobile: str = Field(pattern=r"^\d{10}$")


class OTPVerify(OTPRequest):
    code: str
    name: str = Field(default="New member", min_length=2, max_length=100)


@app.post("/api/auth/otp")
def request_otp(data: OTPRequest):
    if not settings.demo_mode:
        raise HTTPException(503, "SMS provider is not configured")
    code = f"{secrets.randbelow(1000000):06d}"
    otps[data.mobile] = {
        "hash": hashlib.sha256(code.encode()).hexdigest(),
        "expires": time.monotonic() + 300,
        "attempts": 0,
    }
    return {"message": "Demo OTP generated. No SMS is sent.", "demo_code": code}


@app.post("/api/auth/otp/verify")
def verify_otp(data: OTPVerify, db: Session = Depends(db_session)):
    item = otps.get(data.mobile)
    if not item or item["expires"] < time.monotonic() or item["attempts"] >= 5:
        raise HTTPException(401, "OTP expired. Request a new code.")
    item["attempts"] += 1
    if not secrets.compare_digest(
        item["hash"], hashlib.sha256(data.code.encode()).hexdigest()
    ):
        raise HTTPException(401, "Incorrect OTP")
    del otps[data.mobile]
    user = db.scalar(select(User).where(User.mobile == data.mobile))
    if not user:
        user = User(name=data.name, mobile=data.mobile, role="general")
        db.add(user)
        db.flush()
        db.add(Wallet(user_id=user.id))
        db.commit()
    if user.role != "general":
        raise HTTPException(403, "Use your role login")
    return {"access_token": token(user), "user": public_user(user)}


@app.get("/api/me")
def me(user=Depends(current_user)):
    return public_user(user)


class Profile(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    mobile: str = Field(pattern=r"^\d{10}$")
    location: str = Field(min_length=2, max_length=100)


@app.patch("/api/me")
def profile(
    data: Profile, user=Depends(current_user), db: Session = Depends(db_session)
):
    existing = db.scalar(
        select(User).where(User.mobile == data.mobile, User.id != user.id)
    )
    if existing:
        raise HTTPException(409, "Mobile number already registered")
    if user.mobile != data.mobile:
        user.kyc_status = "pending"
    for k, v in data.model_dump().items():
        setattr(user, k, v)
    db.commit()
    return public_user(user)


def bill_json(b, db, user):
    owner = db.get(User, b.user_id)
    files = db.scalars(select(BillFile).where(BillFile.bill_id == b.id)).all()
    return {
        **{
            k: getattr(b, k)
            for k in [
                "id",
                "title",
                "bill_type",
                "amount",
                "funded",
                "due_date",
                "biller",
                "note",
                "location",
                "status",
                "urgent",
            ]
        },
        "preview_id": db.scalar(
            select(BillPreview.id).where(BillPreview.bill_id == b.id)
        ),
        "beneficiary": f"{owner.name.split()[0][0]}•••",
        "kyc_status": owner.kyc_status,
        "files": [{"id": f.id, "content_type": f.content_type} for f in files],
        "created_at": b.created_at.isoformat(),
    }


@app.get("/api/bills")
def bills(user=Depends(current_user), db: Session = Depends(db_session)):
    q = select(Bill).order_by(Bill.id.desc())
    if user.role == "general":
        q = q.where(Bill.user_id == user.id)
    if user.role == "donor":
        q = q.where(Bill.status.in_(["Live", "Funded", "Paid"]))
    return [bill_json(b, db, user) for b in db.scalars(q)]


class BillInput(BaseModel):
    title: str = Field(min_length=3, max_length=160)
    bill_type: Literal[
        "electricity", "rent", "medical", "school fees", "phone", "loan EMI", "other"
    ]
    amount: int = Field(gt=0, le=100000000, strict=True)
    due_date: date
    biller: str = Field(min_length=2, max_length=160)
    note: str = Field(min_length=10, max_length=1500)
    location: str = Field(min_length=2, max_length=100)


@app.post("/api/bills")
async def create_bill(
    data: BillInput, user=Depends(current_user), db: Session = Depends(db_session)
):
    require(user, "general")
    duplicate = db.scalar(
        select(Bill).where(
            Bill.user_id == user.id,
            Bill.biller == data.biller,
            Bill.amount == data.amount,
            Bill.due_date == str(data.due_date),
            Bill.status != "Rejected",
        )
    )
    if duplicate:
        raise HTTPException(409, "This bill appears to have already been submitted")
    bill = Bill(
        **{**data.model_dump(), "due_date": str(data.due_date)},
        user_id=user.id,
        urgent=int((data.due_date - date.today()).days <= 2),
    )
    db.add(bill)
    db.commit()
    await changed()
    return bill_json(bill, db, user)


@app.post("/api/bills/{bill_id}/file")
async def upload(
    bill_id: int,
    file: UploadFile = File(...),
    user=Depends(current_user),
    db: Session = Depends(db_session),
):
    b = db.get(Bill, bill_id)
    if not b or b.user_id != user.id or b.status != "Pending Review":
        raise HTTPException(403, "Bill cannot be edited")
    content = await file.read(10 * 1024 * 1024 + 1)
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(413, "Maximum file size is 10 MB")
    mime = (
        "application/pdf"
        if content.startswith(b"%PDF-")
        else "image/png"
        if content.startswith(b"\x89PNG\r\n\x1a\n")
        else "image/jpeg"
        if content.startswith(b"\xff\xd8\xff")
        else None
    )
    if not mime:
        raise HTTPException(422, "Upload a valid PDF, PNG, or JPEG")
    digest = hashlib.sha256(content).hexdigest()
    if db.scalar(select(BillFile).where(BillFile.sha256 == digest)):
        raise HTTPException(409, "This document was already uploaded")
    key = f"bills/{secrets.token_hex(24)}"
    if settings.s3_bucket:
        import boto3

        boto3.client("s3", region_name=settings.aws_region).put_object(
            Bucket=settings.s3_bucket,
            Key=key,
            Body=content,
            ContentType=mime,
            ServerSideEncryption="AES256",
        )
    else:
        Path("uploads/bills").mkdir(parents=True, exist_ok=True)
        Path("uploads", key).write_bytes(content)
    f = BillFile(bill_id=b.id, storage_key=key, sha256=digest, content_type=mime)
    db.add(f)
    db.commit()
    return {"id": f.id}


@app.get("/api/files/{file_id}")
def get_file(
    file_id: int, user=Depends(current_user), db: Session = Depends(db_session)
):
    f = db.get(BillFile, file_id)
    if not f:
        raise HTTPException(404, "Document not found")
    b = db.get(Bill, f.bill_id)
    # Donors never access raw documents: admin review must redact and publish a safe preview first.
    if user.role != "admin" and user.id != b.user_id:
        raise HTTPException(
            403, "Original documents are private to the owner and review team"
        )
    if settings.s3_bucket:
        import boto3

        url = boto3.client(
            "s3", region_name=settings.aws_region
        ).generate_presigned_url(
            "get_object",
            Params={"Bucket": settings.s3_bucket, "Key": f.storage_key},
            ExpiresIn=60,
        )
        return RedirectResponse(url)
    return FileResponse(Path("uploads", f.storage_key), media_type=f.content_type)


@app.get("/api/wallet")
def wallet(user=Depends(current_user), db: Session = Depends(db_session)):
    w = db.scalar(select(Wallet).where(Wallet.user_id == user.id))
    total = db.scalar(
        select(func.coalesce(func.sum(Transaction.amount), 0)).where(
            Transaction.user_id == user.id,
            Transaction.kind == "funding",
            Transaction.status == "completed",
        )
    )
    count = db.scalar(
        select(func.count(func.distinct(Transaction.bill_id))).where(
            Transaction.user_id == user.id,
            Transaction.kind == "funding",
            Transaction.status == "completed",
        )
    )
    return {
        "balance": w.balance,
        "impact": total,
        "bills_helped": count,
        "demo_mode": settings.demo_mode,
    }


class Money(BaseModel):
    amount: int = Field(gt=0, le=100000000, strict=True)


@app.post("/api/wallet/topup")
async def topup(
    data: Money,
    request: Request,
    user=Depends(current_user),
    db: Session = Depends(db_session),
):
    require(user, "donor")
    if not user.approved or user.kyc_status != "verified":
        raise HTTPException(403, "Approval and verified KYC are required")
    if not settings.demo_mode:
        raise HTTPException(503, "Payoneer merchant payment adapter is not configured")
    async with funding_lock:
        key = request.headers.get("Idempotency-Key", "")
        if not 8 <= len(key) <= 64:
            raise HTTPException(422, "An Idempotency-Key is required")
        old = db.scalar(select(Transaction).where(Transaction.idempotency_key == key))
        if old:
            if (
                old.user_id != user.id
                or old.kind != "topup"
                or old.amount != data.amount
            ):
                raise HTTPException(409, "Idempotency key already used")
            return {"transaction_id": old.id, "status": old.status}
        w = db.scalar(select(Wallet).where(Wallet.user_id == user.id).with_for_update())
        w.balance += data.amount
        t = Transaction(
            id=secrets.token_hex(16),
            user_id=user.id,
            kind="topup",
            amount=data.amount,
            status="completed",
            idempotency_key=key,
            provider_id="DEMO-" + secrets.token_hex(12),
        )
        db.add(t)
        db.add(
            AuditLog(
                actor_id=user.id,
                action="demo_topup",
                detail=f"{t.id}: +{data.amount} paise",
            )
        )
        db.commit()
    await changed()
    return {"transaction_id": t.id, "status": "completed", "demo": True}


@app.post("/api/bills/{bill_id}/pay")
async def pay(
    bill_id: int,
    data: Money,
    request: Request,
    user=Depends(current_user),
    db: Session = Depends(db_session),
):
    require(user, "donor")
    if not user.approved or user.kyc_status != "verified":
        raise HTTPException(403, "Approval and verified KYC are required")
    if not settings.demo_mode:
        raise HTTPException(503, "Live Payoneer payouts are not configured")
    async with funding_lock:
        key = request.headers.get("Idempotency-Key", "")
        if not 8 <= len(key) <= 64:
            raise HTTPException(422, "An Idempotency-Key is required")
        old = db.scalar(select(Transaction).where(Transaction.idempotency_key == key))
        if old:
            if (
                old.user_id != user.id
                or old.bill_id != bill_id
                or old.amount != data.amount
            ):
                raise HTTPException(409, "Idempotency key already used")
            return {"transaction_id": old.id, "status": old.status}
        b = db.scalar(select(Bill).where(Bill.id == bill_id).with_for_update())
        if not b or b.status != "Live":
            raise HTTPException(409, "This bill is no longer available")
        owner = db.get(User, b.user_id)
        account = db.scalar(
            select(PayoutAccount).where(
                PayoutAccount.user_id == owner.id,
                PayoutAccount.provider == "payoneer",
                PayoutAccount.status == "verified",
            )
        )
        if owner.kyc_status != "verified" or not account:
            raise HTTPException(
                409,
                "Recipient needs verified KYC and an approved Payoneer payout account",
            )
        if settings.demo_mode and not account.is_demo:
            raise HTTPException(
                409, "A real Payoneer account cannot receive simulated payments"
            )
        if data.amount > b.amount - b.funded:
            raise HTTPException(409, "Amount exceeds the remaining bill balance")
        w = db.scalar(select(Wallet).where(Wallet.user_id == user.id).with_for_update())
        if data.amount > w.balance:
            raise HTTPException(409, "Insufficient wallet balance. Top up first.")
        w.balance -= data.amount
        b.funded += data.amount
        # Demo settles immediately. Production must reserve funds and queue an idempotent payout;
        # only an authenticated provider status may mark it paid.
        b.status = "Paid" if b.funded == b.amount else "Live"
        t = Transaction(
            id=secrets.token_hex(16),
            user_id=user.id,
            bill_id=b.id,
            kind="funding",
            amount=data.amount,
            status="completed",
            idempotency_key=key,
            provider_id="DEMO-" + secrets.token_hex(12),
        )
        db.add(t)
        db.flush()
        db.add(
            Payout(
                transaction_id=t.id,
                recipient_id=owner.id,
                status="demo_completed",
                attempts=1,
                provider_id=t.provider_id,
            )
        )
        db.add(
            PayoutRoute(
                transaction_id=t.id,
                provider="payoneer",
                payee_id=account.payee_id,
                currency="INR",
                is_demo=1,
            )
        )
        db.add(
            Notification(
                user_id=owner.id,
                message=f"Demo payment of ₹{data.amount / 100:,.2f} for “{b.title}”. No real money was transferred.",
            )
        )
        db.add(
            AuditLog(
                actor_id=user.id,
                action="demo_funding",
                detail=f"{t.id}: {data.amount} paise to recipient {owner.id}; provider=payoneer, route={account.id}, demo=true",
            )
        )
        db.commit()
    await changed()
    return {"transaction_id": t.id, "status": "completed", "demo": True}


@app.get("/api/transactions")
def transactions(user=Depends(current_user), db: Session = Depends(db_session)):
    q = select(Transaction).order_by(Transaction.created_at.desc())
    if user.role == "general":
        q = q.join(Bill, Transaction.bill_id == Bill.id).where(Bill.user_id == user.id)
    elif user.role != "admin":
        q = q.where(Transaction.user_id == user.id)
    return [
        {
            "id": t.id,
            "bill_id": t.bill_id,
            "kind": t.kind,
            "amount": t.amount,
            "status": t.status,
            "provider_id": t.provider_id,
            "created_at": t.created_at.isoformat(),
        }
        for t in db.scalars(q)
    ]


@app.get("/api/notifications")
def notifications(user=Depends(current_user), db: Session = Depends(db_session)):
    return [
        {"id": n.id, "message": n.message, "created_at": n.created_at.isoformat()}
        for n in db.scalars(
            select(Notification)
            .where(Notification.user_id == user.id)
            .order_by(Notification.id.desc())
            .limit(30)
        )
    ]


@app.get("/api/admin/users")
def admin_users(user=Depends(current_user), db: Session = Depends(db_session)):
    require(user, "admin")
    return [public_user(u) for u in db.scalars(select(User))]


class Review(BaseModel):
    decision: Literal["approve", "reject"]


@app.post("/api/admin/bills/{bill_id}/review")
async def review(
    bill_id: int,
    data: Review,
    user=Depends(current_user),
    db: Session = Depends(db_session),
):
    require(user, "admin")
    b = db.get(Bill, bill_id)
    if not b or b.status != "Pending Review":
        raise HTTPException(409, "Bill is not awaiting review")
    if data.decision == "approve":
        owner = db.get(User, b.user_id)
        if owner.kyc_status != "verified":
            raise HTTPException(409, "Verify recipient KYC first")
        if not db.scalar(select(BillFile.id).where(BillFile.bill_id == b.id)):
            raise HTTPException(409, "A bill document is required")
    b.status = "Live" if data.decision == "approve" else "Rejected"
    db.add(
        AuditLog(actor_id=user.id, action="bill_review", detail=f"{b.id}: {b.status}")
    )
    db.commit()
    await changed()
    return {"status": b.status}


@app.post("/api/admin/users/{uid}/approve")
async def approve(
    uid: int, user=Depends(current_user), db: Session = Depends(db_session)
):
    require(user, "admin")
    target = db.get(User, uid)
    if not target:
        raise HTTPException(404, "Account not found")
    target.approved = 1
    db.add(AuditLog(actor_id=user.id, action="account_approved", detail=str(uid)))
    db.commit()
    await changed()
    return public_user(target)


@app.post("/api/admin/users/{uid}/kyc")
async def verify_kyc(
    uid: int, user=Depends(current_user), db: Session = Depends(db_session)
):
    require(user, "admin")
    if not settings.demo_mode:
        raise HTTPException(503, "KYC provider is not configured")
    target = db.get(User, uid)
    if not target:
        raise HTTPException(404, "Account not found")
    target.kyc_status = "verified"
    db.add(AuditLog(actor_id=user.id, action="demo_kyc_verified", detail=str(uid)))
    db.commit()
    await changed()
    return public_user(target)


class DisputeInput(BaseModel):
    transaction_id: str
    reason: str = Field(min_length=10, max_length=1000)


@app.post("/api/disputes")
def dispute(
    data: DisputeInput, user=Depends(current_user), db: Session = Depends(db_session)
):
    t = db.get(Transaction, data.transaction_id)
    b = db.get(Bill, t.bill_id) if t and t.bill_id else None
    if not t or (t.user_id != user.id and (not b or b.user_id != user.id)):
        raise HTTPException(403, "Transaction is not yours")
    d = Dispute(user_id=user.id, **data.model_dump())
    db.add(d)
    db.commit()
    return {"id": d.id, "status": d.status}


@app.get("/api/admin/disputes")
def disputes(user=Depends(current_user), db: Session = Depends(db_session)):
    require(user, "admin")
    return [
        {
            "id": d.id,
            "transaction_id": d.transaction_id,
            "reason": d.reason,
            "status": d.status,
        }
        for d in db.scalars(select(Dispute))
    ]


@app.post("/api/admin/disputes/{did}/resolve")
def resolve(did: int, user=Depends(current_user), db: Session = Depends(db_session)):
    require(user, "admin")
    d = db.get(Dispute, did)
    if not d:
        raise HTTPException(404, "Dispute not found")
    d.status = "resolved"
    db.add(AuditLog(actor_id=user.id, action="dispute_resolved", detail=str(d.id)))
    db.commit()
    return {"status": d.status}


@app.post("/api/payoneer/webhook")
def payoneer_webhook():
    # Fail closed: never trust a browser callback or an unsigned amount/status.
    raise HTTPException(
        503, "Live Payoneer webhooks are disabled. No wallet credit was applied."
    )


@app.post("/api/admin/payouts/{pid}/retry")
def retry_payout(pid: int, user=Depends(current_user)):
    require(user, "admin")
    raise HTTPException(
        503,
        "Live payout retries require a configured Payoneer provider; demo payouts settle immediately",
    )


@app.post("/api/realtime-ticket")
def realtime_ticket(user=Depends(current_user)):
    return {"ticket": token(user, purpose="websocket", minutes=1)}


@app.websocket("/api/ws")
async def websocket(ws: WebSocket):
    # Auth arrives in the first message to keep bearer credentials out of access-log URLs.
    await ws.accept()
    try:
        data = await asyncio.wait_for(ws.receive_json(), timeout=5)
        decode(data.get("ticket", ""), purpose="websocket")
    except Exception:
        await ws.close(code=1008)
        return
    peers.add(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        peers.discard(ws)


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "mode": "demo" if settings.demo_mode else "live",
        "provider": "payoneer",
        "real_money_enabled": False,
    }


@app.post("/api/admin/transactions/{tid}/refund")
async def refund(
    tid: str, user=Depends(current_user), db: Session = Depends(db_session)
):
    require(user, "admin")
    if not settings.demo_mode:
        raise HTTPException(503, "Settled payouts require provider-confirmed reversals")
    async with funding_lock:
        t = db.scalar(
            select(Transaction).where(Transaction.id == tid).with_for_update()
        )
        if not t or t.kind != "funding":
            raise HTTPException(422, "Only bill contributions can be refunded")
        if t.status == "refunded":
            return {"status": "refunded"}
        if t.status != "completed":
            raise HTTPException(409, "Payment is not refundable")
        b = db.scalar(select(Bill).where(Bill.id == t.bill_id).with_for_update())
        w = db.scalar(
            select(Wallet).where(Wallet.user_id == t.user_id).with_for_update()
        )
        payout = db.scalar(
            select(Payout).where(Payout.transaction_id == t.id).with_for_update()
        )
        if not payout or payout.status != "demo_completed":
            raise HTTPException(409, "Payout needs manual reconciliation")
        w.balance += t.amount
        b.funded -= t.amount
        b.status = "Live"
        t.status = "refunded"
        payout.status = "demo_reversed"
        db.add(
            Transaction(
                id=secrets.token_hex(16),
                user_id=t.user_id,
                bill_id=t.bill_id,
                kind="refund",
                amount=t.amount,
                status="completed",
                idempotency_key="refund-" + t.id,
                provider_id="DEMO-REFUND-" + t.id,
            )
        )
        db.add(
            AuditLog(
                actor_id=user.id,
                action="demo_refund",
                detail=f"{t.id}: {t.amount} paise reversed",
            )
        )
        db.add(
            Notification(
                user_id=payout.recipient_id,
                message=f"A demo payment of ₹{t.amount / 100:,.2f} was reversed after review. No real funds were affected.",
            )
        )
        db.commit()
    await changed()
    return {"status": "refunded"}


@app.post("/api/admin/bills/{bill_id}/preview")
async def publish_preview(
    bill_id: int,
    file: UploadFile = File(...),
    user=Depends(current_user),
    db: Session = Depends(db_session),
):
    require(user, "admin")
    if not db.get(Bill, bill_id):
        raise HTTPException(404, "Bill not found")
    content = await file.read(10 * 1024 * 1024 + 1)
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(413, "Maximum file size is 10 MB")
    mime = (
        "image/png"
        if content.startswith(b"\x89PNG\r\n\x1a\n")
        else "image/jpeg"
        if content.startswith(b"\xff\xd8\xff")
        else None
    )
    if not mime:
        raise HTTPException(
            422, "Redact personal details and upload a PNG or JPEG preview"
        )
    digest = hashlib.sha256(content).hexdigest()
    if db.scalar(select(BillFile).where(BillFile.sha256 == digest)):
        raise HTTPException(
            409, "Upload a separately redacted image, not an existing original"
        )
    key = f"bills/{secrets.token_hex(24)}"
    if settings.s3_bucket:
        import boto3

        boto3.client("s3", region_name=settings.aws_region).put_object(
            Bucket=settings.s3_bucket,
            Key=key,
            Body=content,
            ContentType=mime,
            ServerSideEncryption="AES256",
        )
    else:
        Path("uploads/bills").mkdir(parents=True, exist_ok=True)
        Path("uploads", key).write_bytes(content)
    record = BillFile(
        bill_id=bill_id, storage_key=key, sha256=digest, content_type=mime
    )
    db.add(record)
    db.flush()
    preview = db.scalar(select(BillPreview).where(BillPreview.bill_id == bill_id))
    if preview:
        preview.file_id = record.id
    else:
        db.add(BillPreview(bill_id=bill_id, file_id=record.id))
    db.add(
        AuditLog(
            actor_id=user.id, action="redacted_preview_published", detail=str(bill_id)
        )
    )
    db.commit()
    await changed()
    return {"status": "published"}


@app.get("/api/previews/{pid}")
def preview_file(
    pid: int, user=Depends(current_user), db: Session = Depends(db_session)
):
    p = db.get(BillPreview, pid)
    if not p:
        raise HTTPException(404, "Preview not found")
    b = db.get(Bill, p.bill_id)
    if (
        user.role != "admin"
        and user.id != b.user_id
        and not (
            user.role == "donor"
            and user.approved
            and b.status in ["Live", "Funded", "Paid"]
        )
    ):
        raise HTTPException(403, "Preview unavailable")
    f = db.get(BillFile, p.file_id)
    if settings.s3_bucket:
        import boto3

        return RedirectResponse(
            boto3.client("s3", region_name=settings.aws_region).generate_presigned_url(
                "get_object",
                Params={"Bucket": settings.s3_bucket, "Key": f.storage_key},
                ExpiresIn=60,
            )
        )
    return FileResponse(Path("uploads", f.storage_key), media_type=f.content_type)


@app.get("/api/payout-account")
def payout_account(user=Depends(current_user), db: Session = Depends(db_session)):
    require(user, "general")
    account = db.scalar(select(PayoutAccount).where(PayoutAccount.user_id == user.id))
    return {
        "provider": "payoneer",
        "status": account.status if account else "not_connected",
        "is_demo": bool(account.is_demo) if account else settings.demo_mode,
        "reference": ("••••" + account.payee_id[-6:]) if account else None,
    }


@app.post("/api/payout-account/connect")
async def connect_payout_account(
    user=Depends(current_user), db: Session = Depends(db_session)
):
    require(user, "general")
    if not settings.demo_mode:
        raise HTTPException(
            503,
            "Payoneer-hosted payee registration requires an approved partner integration",
        )
    account = db.scalar(
        select(PayoutAccount).where(PayoutAccount.user_id == user.id).with_for_update()
    )
    if account and not account.is_demo:
        raise HTTPException(
            409, "A real payee identity cannot be replaced by a demo connection"
        )
    if not account:
        account = PayoutAccount(
            user_id=user.id,
            provider="payoneer",
            payee_id="demo-payoneer-" + secrets.token_hex(12),
            status="verified",
            is_demo=1,
            verified_at=now(),
        )
        db.add(account)
        db.add(
            AuditLog(
                actor_id=user.id,
                action="demo_payoneer_connected",
                detail="Synthetic recipient identity; no external account linked",
            )
        )
        db.commit()
    await changed()
    return {
        "provider": "payoneer",
        "status": account.status,
        "is_demo": True,
        "reference": "••••" + account.payee_id[-6:],
    }


@app.get("/api/admin/readiness")
def readiness(user=Depends(current_user)):
    require(user, "admin")
    from .readiness import report

    return report(settings)
