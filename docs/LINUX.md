# Run Boring Billionaire on your Linux PC

You run these commands on **your PC**, in a terminal. The cloud workspace cannot install or launch software on your computer remotely.

## Prerequisites

- Git
- Python **3.12 or later**, including its `venv` module
- Node.js **22 or later** and npm (https://nodejs.org/)
- An internet connection for the first dependency installation

Check them with:

```bash
git --version
python3 --version
python3 -m venv --help
node --version
npm --version
```

On Ubuntu/Debian, install missing system packages through your distribution's package manager. Package names depend on the Python version and distribution; for example, Python 3.12's venv package may be called `python3.12-venv`. This launcher does not use sudo or replace your system Python/Node. Use official sources and keep TLS verification enabled.

## Download and launch

Until the pull request is merged, check out its feature branch:

```bash
git clone --branch feat/linux-local-launcher https://github.com/drmasroofamin/boringbillionaire.git
cd boringbillionaire
./run-local.sh
```

After merging, a normal clone of `main` contains the same launcher. If the repository is private, use your existing GitHub authentication for cloning.

The launcher creates a project-local Python environment, installs the pinned/locked dependencies, creates a private `backend/.env` only if absent, and applies database migrations. It starts the API and frontend on loopback interfaces, waits for both to respond, and opens **http://localhost:5173** in your default browser. Keep the terminal open. Press **Ctrl+C** to stop both servers.

Your PC must have Python 3.12+ available as `python3`. If it is named `python3.12` instead, run:

```bash
python3.12 scripts/dev.py
```

No Payoneer credentials or Docker installation are needed for the local demo. SQLite is the default database. Donor, general-user, and admin demo sign-in buttons are on the login screen. **No real money moves.** Production Payoneer integration still requires the work in [PAYONEER.md](PAYONEER.md).

## Useful options

```bash
./run-local.sh --no-browser    # Start servers and print the address
./run-local.sh --setup-only    # Install/migrate without starting servers
./run-local.sh --reinstall     # Refresh dependencies even when lockfiles match
```

Subsequent runs skip dependency installation when the requirements and lockfile hashes are unchanged. Use `--reinstall` if your local dependencies become incomplete. The existing `.env`, database, and bill files are preserved.

## Troubleshooting

- **Port 8000 or 5173 already in use:** use the app already running or stop that server yourself. The launcher refuses to take over those ports and never kills an unrelated process.
- **Migration failure / table already exists:** back up your database and follow [DEPLOYMENT.md](DEPLOYMENT.md) for an older unversioned database. The launcher never auto-stamps, deletes, or resets data.
- **Permission denied on the script:** run `bash run-local.sh` or `chmod +x run-local.sh`.
- **No browser opens:** visit http://localhost:5173 manually. A headless machine can use `--no-browser`.
- **Dependency download failure:** check your connection/proxy and certificate trust. No verification is disabled by the launcher.
- **Live startup blocked:** this is intentional. Keep `DEMO_MODE=true` locally. Adding keys or changing the flag does not implement or certify the missing payment adapters.

The generated configuration has a random signing key and file permissions `0600`. Do not commit `.env`, `.cache`, `.venv`, uploads, or database files. If you have configured a different database in `.env`, migrations target that database: back it up first and do not point a demo at valuable production data.
