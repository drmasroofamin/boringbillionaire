"""Install and run the local demo on Linux using only standard-library tooling.

Only child process groups created here are stopped. Existing configuration,
secrets, databases, and unrelated processes are never replaced or reset.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import time
from urllib.error import URLError
from urllib.request import build_opener, ProxyHandler
import webbrowser

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
URL = "http://localhost:5173"


def run(command: list[str], cwd: Path, env: dict[str, str] | None = None):
    subprocess.run(command, cwd=cwd, env=env, check=True)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def changed(marker: Path, source: Path) -> bool:
    return not marker.exists() or marker.read_text().strip() != digest(source)


def check_prerequisites():
    if os.name != "posix" or not sys.platform.startswith("linux"):
        raise RuntimeError(
            "This launcher targets Linux. See README.md for manual setup on other systems."
        )
    if sys.version_info < (3, 12):
        raise RuntimeError("Python 3.12+ is required; run with a newer python3.")
    if not shutil.which("node") or not shutil.which("npm"):
        raise RuntimeError("Install Node.js 22+ and npm from nodejs.org, then retry.")
    version = subprocess.check_output(["node", "--version"], text=True).strip()
    if int(version.removeprefix("v").split(".")[0]) < 22:
        raise RuntimeError(f"Node.js 22+ is required (found {version}).")


def setup(reinstall: bool):
    python = BACKEND / ".venv" / "bin" / "python"
    if not python.exists():
        print("Creating a project-local Python environment…", flush=True)
        try:
            run([sys.executable, "-m", "venv", str(BACKEND / ".venv")], ROOT)
        except subprocess.CalledProcessError as exc:
            raise RuntimeError(
                "Could not create a virtual environment. Install venv support for your Python version and retry. No sudo commands were run."
            ) from exc
    cache = ROOT / ".cache"
    backend_marker = BACKEND / ".venv" / ".bb-requirements.sha256"
    requirements = BACKEND / "requirements.txt"
    if reinstall or changed(backend_marker, requirements):
        print("Installing pinned Python dependencies…", flush=True)
        env = {**os.environ, "PIP_CACHE_DIR": str(cache / "pip")}
        run(
            [str(python), "-m", "pip", "install", "-r", str(requirements)], BACKEND, env
        )
        backend_marker.write_text(digest(requirements) + "\n")
    frontend_marker = FRONTEND / "node_modules" / ".bb-package-lock.sha256"
    lock = FRONTEND / "package-lock.json"
    if reinstall or changed(frontend_marker, lock):
        print("Installing locked frontend dependencies…", flush=True)
        run(["npm", "ci", "--cache", str(cache / "npm")], FRONTEND)
        frontend_marker.write_text(digest(lock) + "\n")

    # Exclusive creation preserves existing secrets, including on subsequent runs.
    try:
        fd = os.open(BACKEND / ".env", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        print("Keeping existing backend/.env.", flush=True)
    else:
        with os.fdopen(fd, "w") as stream:
            stream.write(
                "DEMO_MODE=true\nJWT_SECRET="
                + secrets.token_urlsafe(48)
                + "\nCORS_ORIGIN=http://localhost:5173\n"
            )
        print(
            "Created private demo configuration with a random signing key.", flush=True
        )

    # Never auto-stamp, delete, or replace an unversioned or incompatible database.
    print("Applying versioned database migrations…", flush=True)
    try:
        run([str(python), "-m", "alembic", "upgrade", "head"], BACKEND)
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(
            "Migration failed. No automatic reset was attempted. Back up your database and follow docs/DEPLOYMENT.md before retrying."
        ) from exc
    return python


def require_free_ports():
    for port in (8000, 5173):
        with socket.socket() as probe:
            if probe.connect_ex(("127.0.0.1", port)) == 0:
                raise RuntimeError(
                    f"Port {port} is already in use. Stop that server yourself, or use the app already running. This launcher will not kill it."
                )


def wait_ready(processes: list[subprocess.Popen]):
    # Local probes must remain local even on PCs with an HTTP proxy configured.
    opener = build_opener(ProxyHandler({}))
    deadline = time.monotonic() + 40
    while time.monotonic() < deadline:
        if any(process.poll() is not None for process in processes):
            raise RuntimeError(
                "A server exited during startup. Check its output above; no real-money bypass is attempted."
            )
        try:
            with opener.open("http://127.0.0.1:8000/api/health", timeout=1) as response:
                health = json.load(response)
            with opener.open("http://127.0.0.1:5173", timeout=1) as response:
                frontend_ok = response.status == 200
            if health.get("status") == "ok" and frontend_ok:
                return
        except (URLError, OSError, ValueError):
            pass
        time.sleep(0.25)
    raise RuntimeError(
        "The servers did not become ready within 40 seconds. Check their output above."
    )


def stop(processes: list[subprocess.Popen]):
    # npm spawns Vite: stop the entire owned group, not just the npm parent.
    for process in reversed(processes):
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    for process in reversed(processes):
        try:
            process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Set up and start Boring Billionaire on Linux. Demo payments only."
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="Print the local address without opening a browser.",
    )
    parser.add_argument(
        "--setup-only",
        action="store_true",
        help="Install dependencies and migrate, without starting servers.",
    )
    parser.add_argument(
        "--reinstall",
        action="store_true",
        help="Reinstall dependencies even if lockfiles have not changed.",
    )
    args = parser.parse_args()
    children: list[subprocess.Popen] = []
    try:
        check_prerequisites()
        if not args.setup_only:
            require_free_ports()
        python = setup(args.reinstall)
        if args.setup_only:
            print("Setup complete. Run ./run-local.sh to start the app.")
            return 0
        # Check again in case a port was taken while dependencies were installing.
        require_free_ports()
        children.append(
            subprocess.Popen(
                [
                    str(python),
                    "-m",
                    "uvicorn",
                    "app.main:app",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    "8000",
                ],
                cwd=BACKEND,
                start_new_session=True,
            )
        )
        children.append(
            subprocess.Popen(
                [
                    "npm",
                    "run",
                    "dev",
                    "--",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    "5173",
                    "--strictPort",
                ],
                cwd=FRONTEND,
                start_new_session=True,
            )
        )
        wait_ready(children)
        print(
            f"\nBoring Billionaire is ready at {URL}\nDemo payments only. Use the demo role buttons to sign in.\nKeep this terminal open. Press Ctrl+C to stop both servers.\n",
            flush=True,
        )
        if not args.no_browser:
            try:
                webbrowser.open(URL)
            except webbrowser.Error:
                print(f"Open {URL} in your browser.")
        while all(child.poll() is None for child in children):
            time.sleep(0.5)
        raise RuntimeError(
            "A server stopped. Both local servers have been shut down; see output above."
        )
    except KeyboardInterrupt:
        print("\nStopping local servers…", flush=True)
        return 0
    except (RuntimeError, OSError, subprocess.CalledProcessError) as exc:
        print(f"\nLocal startup failed: {exc}", file=sys.stderr, flush=True)
        return 1
    finally:
        stop(children)


def interrupt(signum, frame):
    raise KeyboardInterrupt()


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, interrupt)
    raise SystemExit(main())
