# Pluto-ERP-Project · Frontend (`Pluto-ERP-Project-Frontend`)

React 19 + TypeScript (strict) SPA for **Pluto ERP**, built with Vite, TanStack Query and React Hook Form + zod, rendering the prebuilt Pluto design-system components (`public/ds/pluto`, notes in `public/ds/README.md`). It talks only to `/api/*` on its own origin: locally the Vite dev server proxies that to the backend, live the Vercel `/api` proxy does (backlog P0.6).

> **Team docs:** [CONTRIBUTING.md](CONTRIBUTING.md) (Jira, branches, PRs, Definition of Done) · [CLAUDE.md](CLAUDE.md) (rules and the frontend recipe for AI sessions). Work is planned in Jira project **PEP**.

## Run locally
Prerequisites: **Docker**, **git**, **Node.js 20+** (npm 10+).

1. Clone both repos **side by side** (the frontend scripts expect `../backend`):
   ```bash
   git clone https://github.com/Samin1362/Pluto-ERP-Project-Backend.git backend
   git clone https://github.com/Samin1362/Pluto-ERP-Project-Frontend.git frontend
   ```
2. Start the backend once (it asks for a demo owner password):
   ```bash
   cd backend && ./scripts/setup.sh
   ```
   API on `http://localhost:8080`; sign-in `owner@pluto.local` with the password you chose.
3. Start the frontend:
   ```bash
   cd ../frontend
   npm ci
   cp .env.example .env.local      # optional; defaults point at the Docker backend
   npm run dev                     # http://localhost:5173
   ```
4. Smoke check: sign in as the demo owner → Customers opens; reload the page → still signed in; add, edit and delete a customer; profile menu → Settings → 2-step verification set-up opens; Sign out. A **LOCAL · not the live site** strip shows above the top bar everywhere except production.

To work without Docker, set `VITE_DEV_API_TARGET` in `.env.local` to the live tunnel URL (ask the backend dev for `./scripts/tunnel-url.sh`); sign-in needs a live account and a reload signs you out there (see `.env.example`).

## Commands
| Command | Does |
|---|---|
| `npm run dev` | dev server with hot reload on :5173; `/api` → `VITE_DEV_API_TARGET` (default `http://localhost:8080`) |
| `npm run build` | type check + production build into `dist/` (hashed assets, served at `/`) |
| `npm run preview` | serve `dist/` on :4173 with the same `/api` proxy |
| `npm run typecheck` | TypeScript strict check |
| `npm test` | unit tests (`tests/unit`, node:test via esbuild) |
| `E2E_PASSWORD=<10+ chars> ./scripts/e2e.sh` | end-to-end tests: resets the backend's E2E stack (`../backend/scripts/e2e-prepare.sh`, API on :8081), builds, serves on :4173 and runs `tests/e2e` with Playwright. One-time: `npx playwright install chromium` |

## Sync the API contract
Field names come only from the backend's contract. Run after any backend PR marked **Contract changed**:
```bash
./scripts/sync-contract.sh          # copies from ../backend (BACKEND_DIR to change); --pull updates the backend first
```
It copies `contract/contract.gen.ts` → `src/api/contract.gen.ts`, and `openapi.yaml`, `VERSION` and specs 01, 02, 05, 06, 08, 09 → `docs/`, then runs the type check. Commit the synced files in your feature branch with the message `<PEP-KEY>: sync contract <VERSION>`. Never edit `src/api/contract.gen.ts` or `docs/*` by hand.

## Environment variables
Only `VITE_*` values reach the browser, so never put secrets in them. `.env.local` is git-ignored.

| Variable | Purpose | Default |
|---|---|---|
| `VITE_APP_ENV` | `local` · `preview` · `production`; anything but production shows the environment strip | `local` |
| `VITE_DEV_API_TARGET` | where `npm run dev` / `preview` proxy `/api` | `http://localhost:8080` |

The API base in the code is always the relative `/api/v1` (`src/api/client.ts`); never add an absolute API URL.

## Deploy (Vercel)
- Project `pluto-erp-frontend` imports this repo: framework Vite, build `npm run build`, output `dist`. `main` deploys to production; every PR gets a preview URL.
- `vercel.json`: `/api/*` → `api/proxy.ts` (Edge Function that forwards to the backend with `X-Pluto-Proxy-Secret`), every other path → `index.html`, security headers (CSP etc.), long cache for `/assets`.
- Vercel environment variables (Production and Preview): `BACKEND_ORIGIN` (current tunnel URL), `PROXY_SHARED_SECRET` (same as the backend's `.env.live`, from the password manager), `VITE_APP_ENV` = `production` / `preview`.
- **Tunnel URL changed?** `./scripts/point-backend.sh https://<words>.trycloudflare.com` (one-time: `npm i -g vercel && vercel login && vercel link`) updates `BACKEND_ORIGIN` and redeploys. Full runbook: backend repo `docs/runbooks/tunnel-url-changed.md`.
- If the backend is down, API calls answer `backend_unreachable` ("The Pluto server is offline…") instead of crashing the app.

