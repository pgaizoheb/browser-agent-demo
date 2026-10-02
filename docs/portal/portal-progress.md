# Portal progress

Status after replacing the static mock with the Supabase-backed demo (2026-10-02). See `portal-map.md` for routes and data sources.

| Page / work | Status | Fidelity / limitations |
|---|---|---|
| Home | OBSERVED / IMPLEMENTED / VISUALLY COMPARED | Public layout and copy reproduced; announcements synthetic |
| Sign-in | OBSERVED / IMPLEMENTED / VISUALLY COMPARED | Real Supabase password auth; labeled test CAPTCHA and test-mode e-mail code (user-described sequence; production 2FA screen never observed). Adds a demo-account selector; the mock's "Open synthetic demo directly" bypass was removed because data now requires authentication |
| Authorizations Search | OBSERVED / IMPLEMENTED / SUPABASE-BACKED / VISUALLY COMPARED | Observed fields, status options, and 11 columns; server-side filter/sort/page |
| Claims Search | OBSERVED / IMPLEMENTED / SUPABASE-BACKED / VISUALLY COMPARED | Observed fields and columns; claim status values designed locally |
| Members Search | OBSERVED / IMPLEMENTED / SUPABASE-BACKED / VISUALLY COMPARED | SSN column shows `DEMO-ONLY`; no SSN stored |
| Providers Search | OBSERVED / IMPLEMENTED / SUPABASE-BACKED / VISUALLY COMPARED | Observed fields and columns |
| Reference Search | OBSERVED / IMPLEMENTED / SUPABASE-BACKED / VISUALLY COMPARED | Synthetic `DEMO-` code sets |
| Document Search | OBSERVED / IMPLEMENTED / SUPABASE-BACKED / VISUALLY COMPARED | Adds bulk "Mark selected as read" (approximation) |
| Forms and Manuals | OBSERVED / IMPLEMENTED / SUPABASE-BACKED / VISUALLY COMPARED | Observed folder labels; synthetic files in Storage |
| Submit Request / Edit / Resubmit | BLOCKED FOR SAFETY / IMPLEMENTED AS APPROXIMATION / SUPABASE-BACKED | Form and validation designed locally |
| My Requests | BLOCKED FOR SAFETY / IMPLEMENTED AS APPROXIMATION / SUPABASE-BACKED | |
| Authorization detail and decisions | BLOCKED FOR SAFETY / IMPLEMENTED AS APPROXIMATION / SUPABASE-BACKED | Role-aware transitions, optimistic concurrency, audit timeline |
| Hospital Admin | BLOCKED FOR SAFETY / IMPLEMENTED AS APPROXIMATION / SUPABASE-BACKED | Invented path and admin-only census workflow |
| Recently Updated, Recent Attachments, Consult Notes | BLOCKED FOR SAFETY / IMPLEMENTED AS APPROXIMATION / SUPABASE-BACKED | |
| My Members and four member reports | BLOCKED FOR SAFETY / IMPLEMENTED AS APPROXIMATION / SUPABASE-BACKED | Report criteria designed locally |
| My Documents | BLOCKED FOR SAFETY / IMPLEMENTED AS APPROXIMATION / SUPABASE-BACKED | Upload, mark read/archive, delete |
| Member / Claim / Provider detail | NOT OBSERVED / IMPLEMENTED AS APPROXIMATION / SUPABASE-BACKED | |
| Activity Log | DEMO-ONLY FEATURE / SUPABASE-BACKED | Audit trail for verifying agent side effects |
| Persistence | IMPLEMENTED / TESTED | Every create/update/delete goes to Supabase and survives reload; URL holds search state |
| Access control | IMPLEMENTED / TESTED | Verified-session RLS, org isolation, role checks in RPCs, column privileges, Storage policies |
| Responsive layout | TESTED at 390 px | Breakpoints inferred; production mobile behavior unobserved |
| Visual comparison vs supplied mock | DONE | 1126 px, `npm run test:visual`: mismatch 0.4%–2.6% per page; remaining differences are the deliberate additions listed above |
| Deployment to GitHub Pages + hosted Supabase | BLOCKED ON ACCESS | Hosted project hostname did not resolve and the stored management token was rejected on 2026-10-02; see README "Hosted setup and deployment" |
| Comprehensive 1:1 production replica | NOT ACHIEVED (by design) | Private/write workflows were never observed |

## Verification results (local Supabase stack, 2026-10-02)

| Check | Result |
|---|---|
| `npm run check` | 44 JS files parsed; safety guards passed; production build OK |
| `npm run db:test` (fresh `supabase db reset`) | 3 files, 77 tests, PASS |
| `npm run test:e2e` (global scoped reset, `--retries=0`) | 134 passed (128 desktop + 6 mobile) |
| `E2E_SKIP_RESET=1 npm run test:e2e` (repeat on mutated data) | 134 passed |
| `npm run test:visual` | 10 page pairs captured; mismatch 0.4%–2.6% |

## Bugs found by the suite and fixed

- Draft → requested transition skipped the member-eligibility check (now enforced in `mp_transition_authorization`).
- Server validation errors in `mp_save_authorization` raised `22P02` (array-literal coercion) instead of `22023` with field details (now `array_append`).
- Claims "Service From/To Date" filters were dropped by the date-range companion logic (`src/pages/search.js`).
- Documents could not be inserted by users because the number default needed sequence privileges (moved into a `SECURITY DEFINER` trigger).
- Test-mailbox code reads could race across concurrent sign-ins of the same account (mailbox now marks the current session's code).
