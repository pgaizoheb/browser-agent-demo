# MedPoint-style Payer Portal — LOCAL MOCK / DEMO

A browser-agent testing environment that reproduces the observable MedPoint provider-portal interface on top of a **synthetic** Supabase dataset. It replaces the earlier prior-authorization demo UI in this repository, using the same hosting (GitHub Pages), deployment workflow, and Supabase project.

> **LOCAL MOCK / DEMO — NO REAL DATA.** Every person, identifier, record, note, and file is synthetic. The app never connects to the real MedPoint portal; its Content-Security-Policy only permits the configured demo Supabase origin.

- Live site: <https://pgaizoheb.github.io/browser-agent-demo/>
- Portal inventory: [`docs/portal/portal-map.md`](docs/portal/portal-map.md) · progress: [`docs/portal/portal-progress.md`](docs/portal/portal-progress.md) · workflows/assumptions: [`docs/portal/testing-workflows.md`](docs/portal/testing-workflows.md) · components: [`docs/portal/portal-components.md`](docs/portal/portal-components.md) · safety log: [`docs/portal/portal-safety-log.md`](docs/portal/portal-safety-log.md)

## Architecture

```text
GitHub Pages (static Vite build, hash routes)
  └─ Supabase (anon/publishable key only in the browser)
       ├─ Auth: email+password for seeded demo accounts
       ├─ RPC: test-mode e-mail verification, authorization workflow, hospital admin
       ├─ Postgres: mp_* tables + security_invoker views, RLS on every table
       └─ Storage: private bucket mp-demo-documents (synthetic files)
```

There is no application server. Authorization is enforced by Postgres RLS, column privileges, `SECURITY DEFINER` RPCs that check role and status, and Storage policies. Service-role credentials are used only by the administrative reset script on a trusted machine.

## Demo accounts

| Username | Role | Password (local) |
|---|---|---|
| `demo.user` | Provider office staff (DEMO IPA, Demo Empty IPA) | `MedPointDemo!2026` |
| `demo.reviewer` | Utilization reviewer (DEMO IPA) | `MedPointDemo!2026` |
| `demo.admin` | IPA administrator (all four demo IPAs) | `MedPointDemo!2026` |
| `demo.viewer` | Read-only (DEMO IPA) | `MedPointDemo!2026` |
| `demo.other` | Provider office staff (Demo Community Network only) | `MedPointDemo!2026` |

Hosted deployments use the password passed as `MP_DEMO_PASSWORD` when seeding. The documented default is the same value unless you choose otherwise. The sign-in page has a **Fill demo credentials** helper; hide it with the GitHub variable `VITE_DEMO_FILL=false`.

### Sign-in and verification behavior

Username + password → **DEMO TEST CAPTCHA** appears (check it) → **Sign in** → **Email verification**.

- The verification code is random per session and is delivered **only** to the in-app **demo test mailbox** (`Open demo test mailbox` on the verification screen; also in the account menu). **No e-mail is ever sent.**
- 5 wrong codes lock the code; codes expire after 10 minutes; **Resend code** issues a new one (max 10 per session).
- Until verified, RLS returns no records, even to direct API calls.

Details of every workflow and its design assumptions: [`docs/portal/testing-workflows.md`](docs/portal/testing-workflows.md).

## Project structure

```text
index.html                     CSP placeholder (filled at build), demo banner, modal + toast roots
vite.config.js                 base path + narrow CSP for the configured Supabase origin
src/main.js                    router, auth guard, shell wiring
src/components/                shell, field, dataTable, feedback, files, attachments, notes
src/pages/                     sign-in, home, search (+ configs), reports, request form, details, workflows
src/lib/                       supabase client, session/roles, data access, errors, formatting
src/assets/                    public logo, banner, icon font copied from the supplied mock
supabase/migrations/           202609180001-2 legacy demo; 202610020001 portal schema; 202610020002 seed functions
supabase/seeds/medpoint_demo.sql   local `supabase db reset` seed entry
supabase/seed.sql              legacy cases seed (unchanged)
supabase/tests/database/       pgTAP tests
supabase/plain-postgres/       legacy auth stub for running old migrations on plain Postgres
scripts/demo-dataset.mjs       scoped reset + synthetic file sync
scripts/visual-compare.mjs     mock vs app screenshots
tests/e2e/                     Playwright suite; tests/fixtures/ synthetic upload files
```

## Local development

Prerequisites: Node 22+, Docker.

```bash
npm ci
npm run supabase:start     # local Supabase stack; applies migrations and seeds rows
npm run demo:reset         # deterministic rows + synthetic Storage files (local)
npm run dev:local          # Vite dev server wired to the local stack
```

Open <http://localhost:5173/browser-agent-demo/>. `dev:local` injects the local URL and anon key from `supabase status`, so no local keys are committed.

## Tests and reset

| Command | What it does |
|---|---|
| `npm run check` | JS syntax for every source/script/test, safety guards (no production domain, no privileged keys, no safety-extension), production build |
| `npm run db:test` | pgTAP: RLS, verified-session gating, role/transition rules, column privileges, Storage policies, reset scope |
| `npm run test:e2e` | Playwright against the **production build** (`vite preview`, real CSP), desktop + 390 px mobile projects. Global setup runs `demo:reset` locally and signs in every role |
| `npm run test:visual` | Serves the supplied mock on loopback and writes mock/app/diff composites to `visual-comparison/` (`MOCK_DIR` overrides the mock location) |
| `npm run demo:reset` | Resets **only** the synthetic MedPoint dataset on the local stack: rows owned by demo organizations/profiles and objects in `mp-demo-documents` |
| `npm run demo:reset:remote -- --confirm=<project-ref>` | The same against the hosted project, using `.env.backend` (see `.env.backend.example`). Refuses without the matching `--confirm` |

The reset calls `mp_private.reset_demo_dataset(password)`, which deletes only rows whose organization is a demo organization (`mp_organizations.is_demo` is constrained to `true`) and re-seeds them deterministically. It never touches legacy `cases`/`case_events`, other auth users, or other buckets. There is no broad wipe.

Useful E2E variables: `E2E_SKIP_RESET=1` (keep current data), `E2E_PORT` (preview port; note that 4190 is a browser-blocked port).

## Hosted setup and deployment

1. **Supabase project** (`kmlmsvgwhnprvmxcwpdc`). Put admin values in `.env.backend` (gitignored; template in `.env.backend.example`).
2. **Migrations.** `npx supabase link --project-ref <ref>`. If the legacy tables were created through the SQL editor, first mark them applied: `npx supabase migration repair --status applied 202609180001 202609180002`. Then run `npx supabase db push`.
3. **Seed.** `npm run demo:reset:remote -- --confirm=<ref>` creates the demo auth users, synthetic rows, and Storage files.
4. **Auth settings.** Keep the Email provider enabled (password sign-in). Disable new sign-ups: the app never creates accounts, and only seeded profiles can verify.
5. **GitHub Pages.** Repository variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (public), plus optional `VITE_DEMO_PASSWORD` and `VITE_DEMO_FILL`. Run **Actions → Deploy GitHub Pages → Run workflow** on `main`. The workflow runs `scripts/check.mjs`, builds with `VITE_BASE_PATH=/browser-agent-demo/`, and deploys `dist/`.

Pull requests run `.github/workflows/test.yml`: check, local Supabase, pgTAP, and Playwright.

## Rollback

- The pre-replacement deployment is tagged **`pre-medpoint-replacement`** (commit `fd25a7c`). Uncommitted work present at replacement time is preserved on branch `checkpoint/pre-medpoint-worktree`.
- **Frontend:** the Pages environment only deploys from `main`. Revert the merge commit on `main` (`git revert -m 1 <merge-sha> && git push`), then run **Deploy GitHub Pages**. Alternatively, restore files from the tag with `git checkout pre-medpoint-replacement -- index.html src vite.config.js package.json package-lock.json`, commit, and deploy.
- **Database:** the new schema is additive (`mp_*` tables, `mp_private` schema, `mp-demo-documents` bucket). The legacy `cases`/`case_events` tables and RPCs are untouched, so the old UI works again after a frontend rollback without any database change. To remove the demo schema entirely, drop the `mp_*` objects and bucket deliberately; this is not needed for rollback.

## Legacy prior-authorization demo

The previous UI is removed. Its tables (`cases`, `case_events`), RPCs, migrations, and `supabase/seed.sql` remain unchanged so that existing data is preserved and rollback stays possible. The new portal does not read or write them.

## Known limitations

- Private pages, record details, request forms, notes, Hospital Admin, and all write workflows are **approximations**. They were never observed in production, and the UI labels them.
- Responsive breakpoints are inferred; production mobile behavior was not observed.
- The CAPTCHA is a labeled test control; the verification "e-mail" is an in-app test mailbox.
- With publicly documented demo credentials, anyone can sign in to the hosted demo and change synthetic data (uploads are capped at 5 MB and limited to PDF/TXT/PNG/JPEG). Use `VITE_DEMO_FILL=false` plus a private `MP_DEMO_PASSWORD` to restrict access, and `demo:reset:remote` to restore the dataset.
