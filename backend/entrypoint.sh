#!/bin/sh
set -eu
# Refuse to modify a live deployment or serve real-money traffic until certified.
python -c 'from app.config import settings; from app.readiness import require_demo_or_certified; require_demo_or_certified(settings)'
python -m alembic upgrade head
exec python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
