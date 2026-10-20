#!/usr/bin/env bash
# Points the Vercel site at a new backend tunnel URL and redeploys production (backlog P0.6-FE-03).
#   ./scripts/point-backend.sh https://<words>.trycloudflare.com
# One-time: npm i -g vercel && vercel login && vercel link (project pluto-erp-frontend).
# Environment variables only apply to new deployments, which is why this redeploys. Runbook: backend repo
# docs/runbooks/tunnel-url-changed.md.
set -euo pipefail
URL="${1:?usage: ./scripts/point-backend.sh https://<words>.trycloudflare.com}"
URL="${URL%/}"
[[ "$URL" =~ ^https://[a-z0-9.-]+$ ]] || { echo "Expected an https origin without a path, got: $URL" >&2; exit 1; }
command -v vercel >/dev/null || { echo "Install the Vercel CLI first: npm i -g vercel" >&2; exit 1; }

echo "==> Checking $URL/api/ready"
curl -fsS -m 20 "$URL/api/ready" || { echo; echo "The backend does not answer at $URL; fix that first." >&2; exit 1; }
echo
cd "$(dirname "$0")/.."
for ENV in production preview; do
  vercel env rm BACKEND_ORIGIN "$ENV" -y >/dev/null 2>&1 || true
  printf '%s' "$URL" | vercel env add BACKEND_ORIGIN "$ENV" >/dev/null
  echo "==> BACKEND_ORIGIN ($ENV) = $URL"
done
echo "==> Redeploying production"
vercel deploy --prod --yes
