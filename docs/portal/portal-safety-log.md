# Portal safety log

## Session history and policy change

1. Initially inspected browser capabilities and portal tab metadata only. Tools offered no network interception.
2. Prepared a local guard extension; user loaded it. The existing document showed no guard indicator.
3. Reloaded to apply the guard. The portal returned to sign-in. Guard showed READ-ONLY GUARD after page initialization. This reload was a mistake in preserving the user's authenticated session; the exact authentication failure mechanism was not determined.
4. Did not submit a production login form, CAPTCHA, or2FA. User recovered access in a new tab.
5. User explicitly disabled the guard and instructed careful read-only observation without it. This overrides the prior network-blocker prerequisite for subsequent observation.
6. After that change, no production reload, login, logout, query, upload, save, delete, request submission, confirmation, or other write control was activated.

## Observation boundaries

- Used only primary/secondary navigation links, a visual More Options toggle, and the authorization Status dropdown. No filters were submitted.
- Safely observed empty search shells and public home/forms content. No individual records were opened.
- Account heading was incidentally included in an early structural inspection. It was discarded; account identity is not retained in source or documentation. The mock uses Demo User.
- Production screenshots used only the known public page area below the account header, or the empty sign-in page after checking credential fields were empty. No production screenshot files are shipped.
- Only public logo, stock banner, and icon font assets were bundled. No private files, attachments, API responses, cookies, tokens, credentials, or record values were exported.
- Document/manual files were not opened or downloaded. Static folder labels were retained; file entries in the mock are synthetic.
- My Requests, Hospital Admin, Recently Updated, Recent Attachments, Consult Notes, My Members, all member reports, My Documents, and record detail views were BLOCKED FOR SAFETY.
- Submit Request, new/edit/save/delete/approve/deny/acknowledge/assign/upload/send/confirmation controls were never activated on production.
- Earlier guard source was syntax checked and tested in a local simulation. No actual blocked production-request log was exported or inferred. With the guard disabled, network-level enforcement was absent; the evidence supports no agent-initiated write actions, not a guarantee about all background service activity.

## Local mock wall

- Generated fixtures have DEMO identifiers and Example names. Contact values are fictional; email domain is example.invalid. No real SSN, NPI, diagnosis, claim, authorization, member, or private provider information was copied.
- App assets/scripts are local. CSP blocks outbound connections and form actions. All routes are local hashes. Server binds only127.0.0.1.
- All create/edit/save/delete, CAPTCHA,2FA, and attachment behaviors are local simulations. File contents are not read or sent.

## Supabase-backed replacement (2026-10-02)

- The production portal was **not** visited, reloaded, scraped, or contacted during this phase. The supplied mock files were the only reference.
- `safety-extension/` from the observation phase is not part of this repository or deployment (`scripts/check.mjs` fails if it appears).
- The deployed app talks only to the demo Supabase project. The CSP `connect-src` allows `'self'` and that single Supabase origin; the build refuses a backend URL containing the production portal domain.
- All people, identifiers, records, notes, and files are generated synthetically (`DEMO-` identifiers, fictional surnames, `example.invalid` e-mail, 555-01xx phones, `DEMO-ONLY` SSN placeholder that is never stored).
- No real verification e-mails are sent; codes go to the in-app test mailbox (`mp_demo_outbox`).
- Service-role credentials are used only by the local/admin reset script (`scripts/demo-dataset.mjs`) from `.env.backend` or the local CLI stack; they are never bundled, logged, or committed.
- The reset routine deletes only rows owned by organizations constrained to `is_demo = true` and the five demo profiles, plus objects in the dedicated `mp-demo-documents` bucket. Legacy `cases`/`case_events` data is untouched.
