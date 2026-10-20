# Pluto-ERP-Project · Frontend (`Pluto-ERP-Project-Frontend`)

React 19 + TypeScript (strict) SPA for **LedgerFlow ERP** (the product name used in code and the design system), built with Vite, TanStack Query and React Hook Form + zod, rendering the LedgerFlow design-system components (`public/ds/ledgerflow`). It talks only to `/api/*` on its own origin: locally the Vite dev server proxies that to the backend, live the Vercel `/api` proxy does (backlog P0.6).

> The full README, CONTRIBUTING and CLAUDE.md for this repo come with backlog task P0.9-FE-01. Work is planned in Jira project **PEP**; see the backend repo's `CONTRIBUTING.md` for branches, commits and the Definition of Done.

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
   API on `http://localhost:8080`; sign-in `owner@ledgerflow.local` with the password you chose.
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

## Environment variables
Only `VITE_*` values reach the browser, so never put secrets in them. `.env.local` is git-ignored.

| Variable | Purpose | Default |
|---|---|---|
| `VITE_APP_ENV` | `local` · `preview` · `production`; anything but production shows the environment strip | `local` |
| `VITE_DEV_API_TARGET` | where `npm run dev` / `preview` proxy `/api` | `http://localhost:8080` |

The API base in the code is always the relative `/api/v1` (`src/api/client.ts`); never add an absolute API URL.
