#!/usr/bin/env bash
# Brings the latest API contract and specs from the backend repo (backlog P0.7-FE-01).
# Run after any backend PR marked "Contract changed", then commit the synced files in your feature branch:
#   <PEP-KEY>: sync contract <VERSION>
#   ./scripts/sync-contract.sh            copy from ../backend (or BACKEND_DIR)
#   ./scripts/sync-contract.sh --pull     git pull --ff-only in the backend first
set -euo pipefail
cd "$(dirname "$0")/.."
BACKEND_DIR="${BACKEND_DIR:-../backend}"
[ -f "$BACKEND_DIR/contract/contract.gen.ts" ] || { echo "Backend repo not found at $BACKEND_DIR (set BACKEND_DIR)" >&2; exit 1; }
[ "${1:-}" = "--pull" ] && git -C "$BACKEND_DIR" pull --ff-only

mkdir -p docs
cp "$BACKEND_DIR/contract/contract.gen.ts" src/api/contract.gen.ts
cp "$BACKEND_DIR/contract/openapi.yaml" "$BACKEND_DIR/contract/VERSION" docs/
for f in 01-SRS.md 02-UI-Inventory.md 05-API-Specification.md 06-Accounting-and-Business-Rules.md \
         08-Frontend-Backend-Integration.md 09-Testing-Strategy.md; do
  cp "$BACKEND_DIR/docs/$f" docs/
done

echo "Contract $(cat docs/VERSION)"
git diff --stat -- src/api/contract.gen.ts docs/ 2>/dev/null || true
npm run -s typecheck && echo "Typecheck OK"
