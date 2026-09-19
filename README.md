# Browser Agent Prior Authorization Demo

A deliberately simple static browser-automation playground for fictional prior-authorization workflows. The browser talks directly to Supabase Auth, Postgres, RPC, and Realtime. No application backend is required.

All names, IDs, facts, and case records are fictional. Never load PHI or production healthcare information.

## Architecture

```text
GitHub Pages / Vite static assets
  ├─ Supabase Auth: email OTP and persistent browser session
  ├─ Supabase Postgres: cases and case_events
  ├─ Postgres RPC: atomic case status update plus audit event
  └─ Supabase Realtime: dashboard and detail refresh
```

The frontend exposes facts and controls. It contains no authorization decision rules and never recommends approve or deny.

## Automation contract

The site intentionally supports ordinary automated Chromium interaction. It has no CAPTCHA, Turnstile, bot detection, browser fingerprint checks, headless-browser rejection, behavioral challenges, automation-framework detection, randomized selectors, challenge pages, anti-scraping code, or application-level rate limiting.

Every workflow control is visible in semantic HTML with associated labels and stable `data-testid`, `data-record-id`, `data-status`, or `data-action` attributes. Security comes from Supabase Auth, RLS, and constrained RPC permissions—not from obstructing browser interaction.

## Project structure

```text
index.html
package.json
package-lock.json
vite.config.js
src/
  main.js
  styles.css
supabase/
  migrations/
    202609180001_initial.sql
    202609180002_case_context.sql
  seed.sql
  tests/
    local_auth_stub.sql
```

## Create the Supabase project

1. Create a project at <https://supabase.com/dashboard>.
2. Open **SQL Editor**.
3. Run every file in `supabase/migrations/` in timestamp order.
4. Run `supabase/seed.sql`.
5. In **Project Settings → API**, copy the project URL and publishable key. A legacy anon key also works.
6. Never copy the `service_role` key into this project.

Re-run `supabase/seed.sql` whenever you want to delete current demo cases/events and restore the original eight fictional cases.

## Configure email OTP

1. Open **Authentication → Providers → Email**.
2. Enable email authentication.
3. Disable new-user signups if only explicit demo accounts should log in.
4. Open **Authentication → Email Templates → Magic Link**.
5. Put `{{ .Token }}` in the template instead of relying only on `{{ .ConfirmationURL }}`.
6. Use a subject such as `Browser Agent Demo verification code`.
7. Set the email OTP length to `8` so it matches the portal input.
8. Configure OTP expiration and email rate limits in Supabase Auth settings.

Supabase's built-in sender is enough for a small demonstration but has delivery restrictions. A custom SMTP provider can be configured inside Supabase later without changing this frontend.

## Create the demo user

Open **Authentication → Users → Add user** and enter the demo email. Confirm the user if prompted. The login page calls `signInWithOtp` with `shouldCreateUser: false`, so unknown email addresses cannot create accounts through this application.

## Local configuration

```bash
cp .env.example .env
```

Set:

```dotenv
VITE_SUPABASE_URL=https://project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-publishable-or-anon-key
VITE_SIMULATOR_ENABLED=false
VITE_BASE_PATH=/browser-agent-demo/
```

These values are embedded in public browser assets. The Supabase URL and anon/publishable key are intentionally public; RLS enforces authorization. Never use a database password or `service_role` key here.

## Start locally

```bash
npm install
npm run dev
```

Open <http://localhost:5173/browser-agent-demo/>.

## Authentication test

1. Open the site while logged out; it should show the email form.
2. Enter the explicit Supabase demo-user email.
3. Click **Send verification code**.
4. Read the numeric code from email.
5. Enter it on the OTP page.
6. Refresh the dashboard; the Supabase session should remain active.
7. Click **Log out**; protected routes should return to login.

OTP values are never displayed, logged, or stored in application tables.

## Database and RLS

Application tables:

- `cases`: fictional request facts and current workflow state
- `case_events`: immutable audit history

Both tables have RLS enabled. The `anon` role has no table privileges. Authenticated users can select both tables but cannot directly insert, update, or delete. Writes are limited to two authenticated RPC functions:

- `perform_case_action`: locks the case, changes status, and inserts the audit event in one transaction; actor is fixed to `demo_user`.
- `simulate_case_change`: makes only controlled fictional queue/information updates; actor is fixed to `simulator`.

Both functions reject calls where `auth.uid()` is null. No browser-provided actor is trusted.

### Verify anonymous access is rejected

Replace the URL and anon key, then run:

```bash
curl -i "$VITE_SUPABASE_URL/rest/v1/cases?select=*" \
  -H "apikey: $VITE_SUPABASE_ANON_KEY"

curl -i -X PATCH "$VITE_SUPABASE_URL/rest/v1/cases?id=eq.10000000-0000-4000-8000-000000000001" \
  -H "apikey: $VITE_SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status":"approved"}'

curl -i "$VITE_SUPABASE_URL/rest/v1/case_events?select=*" \
  -H "apikey: $VITE_SUPABASE_ANON_KEY"
```

Each request must return an authorization/permission error and no case data. Do the same with `POST /rest/v1/case_events`; it must be rejected.

## Case actions

The detail view exposes approve, deny, request information, submit, move pending, and close controls. Deny and request-information actions require a note in both the UI and database RPC. After success, the page re-fetches the case and its event history.

## Realtime

The migration adds `cases` and `case_events` to the `supabase_realtime` publication. The dashboard subscribes to all case changes. A detail page subscribes to that case and its new audit events. Realtime notifications trigger a database re-fetch rather than trusting notification payloads.

## Simulator

The simulator is an authenticated frontend demo mode because it requires no privileged browser secret. Enable it with:

```dotenv
VITE_SIMULATOR_ENABLED=true
```

Every 20–60 seconds the page calls `simulate_case_change`. The database function either marks fictional requested information as received or creates a new fictional queue item. It never approves or denies a case. RLS and the RPC authentication check still apply.

The simulator runs only while an authenticated demo browser session is open.

## GitHub Pages build

```bash
npm run build
```

Static output is written to `dist/`. Vite defaults to `/browser-agent-demo/`, and hash routing keeps client views working under the repository subpath without server rewrites.

For a custom domain or root-hosted preview:

```bash
VITE_BASE_PATH=/ npm run build
```

GitHub Pages limitations:

- Build-time public Supabase values are visible to every visitor.
- Security therefore depends on Supabase RLS, not key secrecy.
- GitHub Pages cannot run the simulator without an authenticated browser remaining open.
- Auth email delivery, database migrations, and user creation remain Supabase responsibilities.

Before a GitHub Pages deployment:

1. In **GitHub → repository → Settings → Pages**, select **GitHub Actions** as the source.
2. Provide `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as repository variables to the build workflow. They are public browser configuration; never use a `service_role` key.
3. Build with `VITE_BASE_PATH=/browser-agent-demo/` and `VITE_SIMULATOR_ENABLED=false`.
4. In **Supabase → Authentication → URL Configuration**, set the hosted site URL to `https://<github-username>.github.io/browser-agent-demo/` and add the same URL to the allowed redirect URLs. Keep the local URL while developing.
5. Deploy the generated `dist/` artifact with the Pages workflow. This repository does not deploy automatically.

## Browser-agent readiness

Stable attributes include `data-testid`, `data-record-id`, `data-status`, and `data-action`. The agent should discover records from the current DOM, inspect full detail facts, choose one external decision, submit it, verify the status and audit event, then return to the dashboard and continue monitoring Realtime.
