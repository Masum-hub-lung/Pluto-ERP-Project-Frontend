# Contributing to Pluto-ERP-Project · Frontend

Team: **Md. Samin Israk** (backend, tech lead) · **Masum Billah** (frontend). Work is planned in Jira project **PEP** (`saminisrak1991.atlassian.net`) from the backlog (each sub-task's Jira description holds the full task text): one sprint per phase, Epic = phase, Story = feature track, Sub-task = one backlog task key such as `P4.3-BE-02`.

## 1. Jira
- Move your sub-task to **In Progress** when you start and to **Done** when every "Done when" box is ticked and the PR is merged; add a short comment saying what changed and how you checked it. Never delete issues.
- The parent story goes to Done when all its sub-tasks are Done; the sprint (phase) closes after its validation tasks.
- A bug found while validating is a **Bug** linked to the task it breaks.

## 2. Git (each repo)
- `main` = what is live. Protected: PR required, 1 approving review, CI green.
- Branch per task (or per small group of tasks in one story), carrying the **Jira issue key** (what Jira uses to link) and the backlog key: `feat/PEP-142-P4.3-BE-02-bill-posting`, `fix/PEP-150-P4.3-BE-02-avg-cost-rounding`, `chore/PEP-12-P0.2-BE-01-dockerfile`.
- Commit message: `PEP-142 P4.3-BE-02: post purchase bill (stock in, journal)`.
- PR title: `PEP-142 · P4.3-BE-02 · Post purchase bill`. Fill the PR template. Squash-merge.
- Tag a release when a feature goes live: backend `vYYYY.MM.DD-n`, frontend the same.

## 3. Feature lifecycle (every feature, in this order)
```
1. BE tasks  → PR(s) merged to backend main  → "contract changed?" noted in PR
2. FE runs scripts/sync-contract.sh (if contract changed) → FE tasks → PR merged (Vercel preview checked)
3. VAL tasks → run on local Docker + Vercel preview → bugs fixed
4. Go live: host runs scripts/deploy.sh (backend) · Vercel promotes main (frontend)
5. VAL smoke check on the live URL → mark the feature's stories Done → next feature
```
The frontend dev may start FE tasks **before** BE is merged only against a BE branch running locally; never against guesses.

## 4. Definition of Ready (a task may start when)
- Dependencies are Done (or merged on a branch you can run).
- The task's "Read first" sections exist and the contract has the endpoints it needs.

## 5. Definition of Done (every task)
- All **Done when** boxes ticked.
- Track checks pass: backend `make test` (PHPUnit in Docker) · frontend `npm run typecheck && npm test && npm run build`.
- No secrets committed; no generated file edited by hand.
- PR reviewed by the other developer and merged.
- If behaviour differs from the docs: the doc source (`docs/source/*.py` or the `.md`) is updated in the same PR, or a "Deviation" note is added to the task and to `docs/15`-style implementation notes.

## 6. When the API contract changes
The backend PR says **Contract changed**. In your feature branch run `./scripts/sync-contract.sh` (add `--pull` to update `../backend` first), fix any type errors it reveals, and commit the synced files with `<PEP-KEY>: sync contract <VERSION>`. Never edit `src/api/contract.gen.ts` or `docs/` by hand; if a field you need is missing, stop and ask the backend dev ("Contract gap: …").

## 7. Checks before you open a PR
```bash
npm run typecheck && npm test && npm run build
npm run dev     # click through the page as Owner and as a restricted role; check 390 px width
```
CI runs typecheck, unit tests and build on every PR; Vercel adds a preview link — check the page there too. E2E tests (`./scripts/e2e.sh`) run in the VAL tasks.

## 8. Secrets
Never commit `.env.local`, `.vercel/`, `PROXY_SHARED_SECRET` or any password or token. Share secrets through the team password manager, never through chat or git.
