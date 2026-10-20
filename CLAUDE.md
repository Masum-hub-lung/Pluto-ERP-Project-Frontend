# CLAUDE.md · Pluto-ERP-Project frontend

React 19 + TypeScript SPA for **LedgerFlow ERP** (product name in code, docs and the design system; project name Pluto-ERP-Project): a multi-company ERP for Bangladeshi trading firms — customers, suppliers, inventory, sales, purchases, LC, cash and bank, accounting and reports. Money is BDT with lakh/crore formatting; the financial year runs July–June. The backend (Laravel, separate repo `Pluto-ERP-Project-Backend`, cloned at `../backend`) owns every calculation; this app shows and edits what the API returns. Live it runs on Vercel and reaches the API through `api/proxy.ts`; locally Vite proxies `/api` to the Docker backend.

**This file keeps every AI session (Opus first, then Sonnet) consistent. Update it in the same PR whenever a convention changes or a shared component is added.**

## Before each task
1. Read the task in Jira (project **PEP**; the issue description is the full task text) — Goal, Read first, Do, Files, Contract, Done when. Do only that task.
2. Open `docs/02-UI-Inventory.md` at the task's page anchor (e.g. `#page-f3`) and `docs/05-API-Specification.md` at its actions anchor (e.g. `#actions-f3`).
3. Find the request/response types in `src/api/contract.gen.ts`, then open the pattern file the task names.

## Rules
1. Work on **one task key at a time**. Put the key in the branch name and every commit message (CONTRIBUTING.md §2).
2. Before coding, read the task's **Read first** sections and the frontend recipe below. Do not re-read the whole docs folder.
3. **Never invent API fields.** Field names come from `src/api/contract.gen.ts` (frontend) or `docs/openapi.yaml` (backend). If something is missing, stop and add a note to the task: "Contract gap: …".
4. **Never compute money, tax, stock or balances in the frontend.** The backend returns them (see 08 §16).
5. Copy the existing pattern files named in the task; do not introduce new libraries unless the task says so.
6. When unsure between two behaviours, the order of authority is: `docs/01-SRS.md` business rules (BR-xxx) → `docs/06` posting rules → `docs/05` API → `docs/02` UI.
7. Finish with the task's **Done when** list, then run the checks in §5.8 below.
8. Git is run **by the developer manually**. AI sessions do not commit, push or open PRs unless the developer asks.
9. **Never compute money, tax, stock or balances here**: no `parseFloat`/`Number()` on money, no adding or multiplying amounts; totals come from the API (`/calculate` endpoints) and are shown with `<Amount>` or `formatTaka()`.
10. **Never edit synced or generated files**: `src/api/contract.gen.ts` and everything in `docs/` (refresh them with `./scripts/sync-contract.sh`).
11. The API base is always the relative `/api/v1`; never add an absolute API URL. Only `VITE_*` variables reach the browser — never put secrets in them.
12. Keep code identifiers named LedgerFlow; only the repos, Jira, Vercel and Docker use "Pluto".

## Shared components (update this list as P1.2 adds them)
Design system through `lf()` (`src/ds.ts`): Button, IconButton, Icon, Badge, Amount, Field, Input, Select, Segmented, Tabs, Card, DataTable, Pagination, PageHeader, Banner, Toast, Dialog, EmptyState, Skeleton, Menu, Switch, Logo, Sidebar, NavSection, NavItem, NavSubItem, Topbar (props typed in `LedgerFlowLibrary`). App pieces today: `src/app/Shell.tsx` (sidebar, top bar, environment strip), `src/app/guards.tsx` (RequireAuth, RequirePermission), `src/app/toast.tsx` (`useToast`), `src/pages/customers/shared.tsx` (problem banner with request id), `src/lib/format.ts`, `src/lib/customerSchema.ts`. `src/components/` arrives with P1.2 (ProblemBanner, ConflictBanner, applyProblemToForm, useIdempotencyKey, useListParams, ConfirmDialog, DeleteDialog, useUnsavedChangesBlocker, PageSkeleton, ListCard, SummaryTile, SelectableTable, ActivityTimeline, AsyncSelect / PartyPicker / LedgerPicker).

## Commands
```bash
npm run dev                         # http://localhost:5173, /api → VITE_DEV_API_TARGET (default Docker backend :8080)
npm run typecheck && npm test && npm run build
./scripts/sync-contract.sh          # after a backend PR marked "Contract changed"
E2E_PASSWORD=<10+ chars> ./scripts/e2e.sh   # Playwright E2E against the backend's E2E stack (:8081)
./scripts/point-backend.sh <url>    # point Vercel at a new tunnel URL (runbook in the backend repo)
```
Backend once: `cd ../backend && ./scripts/setup.sh` (demo sign-in `owner@ledgerflow.local`).

## Frontend recipe
### 5.1 Stack and folders
React 19 · TypeScript strict · Vite · React Router 6 · TanStack Query 5 · React Hook Form + zod · **LedgerFlow design system** (prebuilt bundle at `public/ds/ledgerflow/components/bundle.js`, typed in `src/ds.ts`, used through `lf()`).
```
src/
  api/client.ts            fetch wrapper (token in memory, refresh, X-Company-Id, Idempotency-Key, If-Match, ApiError)
  api/contract.gen.ts      GENERATED types — never edit (synced from backend)
  api/<module>.ts          query + mutation hooks per module (pattern: src/api/parties.ts)
  app/router.tsx           routes (pattern: existing customer routes)
  app/Shell.tsx            sidebar + top bar
  app/guards.tsx           RequireAuth, RequirePermission
  components/              shared building blocks (built in P1.2)
  lib/format.ts            formatTaka() (lakh/crore), initials(), termLabel()
  pages/<module>/…         one file per page (pattern: src/pages/customers/*)
docs/                      SYNCED specs (02 UI, 05 API, 06, 08, 09, 01) — never edit
```

### 5.2 Before writing a page
1. Open `docs/02-UI-Inventory.md` at the page anchor (e.g. `#page-f3`): fields, columns, actions, validation, empty/loading/error states, roles.
2. Open `docs/05-API-Specification.md` at `#actions-<code>` (e.g. `#actions-f3`): what the page **loads** and what each action **calls**, with the errors to handle.
3. Find the request/response types in `src/api/contract.gen.ts` (search the schema name shown in the action map, e.g. `PurchaseBillInput`).
4. Open the pattern file the task names and copy its structure.

### 5.3 Data access rules
- One hooks file per module: `src/api/<module>.ts`. Query keys are hierarchical and company-scoped: `['company', cid, '<resource>', …]` (copy `keys` from `parties.ts`).
- Lists: filters/sort/page live in the **URL search params** (copy `set()` from `CustomerList.tsx`); `placeholderData: keepPreviousData`.
- Lookups (payment terms, units, tax rules, warehouses…): `staleTime: 5 * 60_000`.
- Mutations: generate the `Idempotency-Key` **once per user action** with `useIdempotencyKey()` (P1.2) and reuse it on retry; send `ifMatch: W/"<version>"` for updates; after success **invalidate** every affected key (08 §8 table).
- Never use optimistic updates for financial data.

### 5.4 UI rules
- Use only design-system components from `lf()` and the shared components in `src/components/`. Styling: CSS variables (`var(--ink)`, `var(--line)`, …) as in existing pages; **no hard-coded colours**.
- Money: display with `<Amount>` or `formatTaka()`. **Never** `parseFloat`/`Number()` on money; never add or multiply money. Totals come from the API (`/calculate` endpoints).
- Hide buttons the user lacks permission for with `can('<perm>')` from `useSession()`. Wrap routes in `<RequirePermission permission="…">`.
- Every page handles: **loading** (skeleton / `loading` prop), **empty** (`EmptyState` with the design copy), **error** (`ProblemBanner` with request id), **403** (Forbidden page), **404** (NotFound page). Forms also handle **422** (field errors + summary banner via `applyProblemToForm`), **409** (`ConflictBanner`, keep user input) and **unsaved changes** (`useUnsavedChangesBlocker`).
- Copy text (titles, helper text, toasts) from `docs/02` for the page. Toast after every successful mutation saying what happened (L12).
- Responsive: must work at 1440 px and 390 px without sideways page scroll (tables may scroll inside their card).
- Accessibility: every input has a label (`Field label`), buttons have text or `aria-label`, focus moves to the first error on submit.

### 5.5 Routes and navigation
- Route paths follow 08 §3 (e.g. `/suppliers/:id/edit`, `/purchases/bills/new`).
- Add each new page to `src/app/router.tsx` inside the Shell children, wrapped in `RequirePermission`.
- Update the sidebar entry in `Shell.tsx` (module item + sub-items) so the page is reachable; modules not built yet still go to "not in this release".

### 5.6 Forms
- React Hook Form + zod schema in `src/lib/<entity>Schema.ts` (pattern: `src/lib/customerSchema.ts`). zod checks **shape only** (required, formats, lengths); business rules come back as 422.
- Default values: a fresh object per form instance (see the bug note in the backend repo, docs/15 §5).
- Buttons: Cancel · Save draft (documents only) · primary action, sticky footer, primary shows `loading` while pending; disable double submit.

### 5.7 Trade documents (bills, invoices, notes, POs, quotations)
- Use the shared document editor built in P4.4 (`src/components/document/*`): line grid, totals panel, party panel.
- Totals, tax, rounding, amount in words, warnings: **only** from the debounced (300 ms) `POST …/calculate` response; while pending, show skeletons in the totals panel.

### 5.8 Frontend checks before PR
```bash
npm run typecheck && npm test && npm run build
npm run dev   # click through the page as Owner and as a restricted role; check 390 px width
```
Add or update a unit test when you add a pure function (formatters, schema). E2E tests are written in VAL tasks.
