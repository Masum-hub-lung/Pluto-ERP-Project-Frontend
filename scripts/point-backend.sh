#!/usr/bin/env bash
# Points the Vercel site at a new backend tunnel URL and redeploys production (backlog P0.6-FE-03).
#   ./scripts/point-backend.sh https://<words>.trycloudflare.com
# One-time: npm i -g vercel && vercel login && vercel link (project pluto-erp-frontend).
# Environment variables only apply to new deployments, which is why this redeploys the current production build. Runbook: backend repo
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
PROD_HOST="${VERCEL_PROD_HOST:-pluto-erp-project-frontend.vercel.app}"
for ENV in production preview; do
  vercel env add BACKEND_ORIGIN --environment "$ENV" --value "$URL" --force --yes --sensitive --non-interactive </dev/null >/dev/null 2>&1
  echo "==> BACKEND_ORIGIN ($ENV) = $URL"
done
# Rebuild the deployment that is live now (same commit), so the new variable applies and nothing local is uploaded.
# awk reads to the end: closing the pipe early makes the Vercel CLI abort.
CURRENT="$(vercel inspect "$PROD_HOST" </dev/null 2>&1 | awk '$1 == "url" && !found { print $2; found = 1 }')"
[ -n "$CURRENT" ] || { echo "Could not find the current production deployment of $PROD_HOST" >&2; exit 1; }
echo "==> Redeploying production ($CURRENT)"
vercel redeploy "$CURRENT" --environment production --non-interactive </dev/null
echo "==> Check: https://$PROD_HOST/api/ready"
for _ in $(seq 20); do curl -fsS -m 15 "https://$PROD_HOST/api/ready" && echo && exit 0; sleep 5; done
echo "The site does not reach the backend yet; see the runbook." >&2; exit 1
