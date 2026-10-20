#!/usr/bin/env bash
# End-to-end tests against a fresh backend (backlog P0.5-FE-05). Needs Docker, Node and the backend repo cloned
# next to this one (../backend, or set BACKEND_DIR) and set up once with its ./scripts/setup.sh.
#   E2E_PASSWORD=<any 10+ chars> ./scripts/e2e.sh
# Steps: backend ./scripts/e2e-prepare.sh (API on :8081, database ledgerflow_e2e wiped, test users created) →
# npm run build → vite preview on :4173 proxying /api to :8081 → the Playwright tests in tests/e2e.
# One-time: npx playwright install chromium
set -euo pipefail
: "${E2E_PASSWORD:?Set E2E_PASSWORD (10+ characters; the test users get this password)}"
cd "$(dirname "$0")/.."
export BACKEND_DIR="$(cd "${BACKEND_DIR:-../backend}" && pwd)"
[ -x "$BACKEND_DIR/scripts/e2e-prepare.sh" ] || { echo "Backend not found at $BACKEND_DIR (set BACKEND_DIR)" >&2; exit 1; }

PREVIEW_PID=""
trap '[ -n "$PREVIEW_PID" ] && kill "$PREVIEW_PID" 2>/dev/null || true' EXIT

(cd "$BACKEND_DIR" && E2E_PASSWORD="$E2E_PASSWORD" ./scripts/e2e-prepare.sh)

echo "==> Building the frontend"
npm run -s build

echo "==> Serving dist/ on http://localhost:4173 (API → http://localhost:8081)"
VITE_DEV_API_TARGET=http://localhost:8081 npx vite preview --port 4173 --strictPort > /dev/null 2>&1 &
PREVIEW_PID=$!
for _ in $(seq 60); do curl -fs -o /dev/null http://localhost:4173/sign-in && break; sleep 0.5; done
curl -fs -o /dev/null http://localhost:4173/sign-in || { echo "vite preview did not start" >&2; exit 1; }

echo "==> Running the E2E tests"
E2E_BASE_URL=http://localhost:4173 E2E_PASSWORD="$E2E_PASSWORD" npm run -s e2e
