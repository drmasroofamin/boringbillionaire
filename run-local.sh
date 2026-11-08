#!/usr/bin/env bash
# Linux entrypoint. No sudo, system package changes, or public network binding.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
if ! command -v python3 >/dev/null 2>&1; then
  echo 'Python 3.12+ is required. Install Python and its venv support, then retry.' >&2
  exit 1
fi
exec python3 scripts/dev.py "$@"
