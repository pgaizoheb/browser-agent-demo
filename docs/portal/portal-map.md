# Portal inventory (Supabase-backed demo)

Inventory of the MedPoint-style **LOCAL MOCK / DEMO** portal after replacing the static mock with a Supabase-backed application. "Observed" means the empty shell was safely observed in production during the earlier read-only session (see `portal-safety-log.md`). "Approximation" means the production page was **not** opened; its layout and workflow were designed locally for testing and are labeled in the UI with an approximation notice.

All routes are hash routes under `https://pgaizoheb.github.io/browser-agent-demo/`. Every record is synthetic and fetched from the demo Supabase project; nothing connects to the production portal.

| Page | Hash route | Production evidence | Implementation | Supabase source | Testable workflows |
|---|---|---|---|---|---|
| Sign-in | `#/sign-in` | Observed (empty form) | Mock layout + real Supabase password auth, labeled test CAPTCHA, test-mode e-mail code | Auth, `mp_begin_verification`, `mp_verify_login_code`, `mp_demo_outbox` | Login, wrong password, CAPTCHA required, wrong/locked/expired code, resend, deep-link return |
| Home | `#/` | Observed (public content) | Mock layout; announcements synthetic | static | Navigation, help dialog |
| Authorizations Search | `#/authorizations/search` | Observed (empty shell, status options) | 11 columns, 6 basic + 6 advanced filters, server-side filter/sort/page | `mp_authorization_list` | Filters, date presets, sorting, paging, URL state persistence |
| Claims Search | `#/claims/search` | Observed (empty shell) | 6 columns, 6 basic + 5 advanced filters | `mp_claim_list` | Status/member/plan/date filters, claim detail |
| Members Search (Eligibility) | `#/members/search` | Observed (empty shell) | 9 columns; SSN column always `DEMO-ONLY` (never stored) | `mp_member_list` | Eligibility lookup, member detail |
| Providers Search | `#/providers/search` | Observed (empty shell) | 7 columns, 8 filters incl. array-contains Health Plan / Hospital | `mp_provider_list` | Specialty/hospital/NPI filters, provider detail |
| Reference Search | `#/references` | Observed (radio layout) | Type radios + code/description search | `mp_reference_codes` (global) | Code lookup by type |
| Document Search | `#/documents/search` | Observed (empty shell) | 9 columns, 25/page, bulk "Mark selected as read" (approximation) | `mp_document_list`, Storage | Inbox/tax-id/category/date filters, download, preview |
| Forms and Manuals | `#/forms` | Observed (folder labels) | 9 observed folders; file entries synthetic | `mp_forms_manuals`, Storage `shared/forms/` | Download, preview, refresh |
| Submit Request | `#/authorization-request` | Not observed — approximation | Full request form; member lookup; attachments | `mp_save_authorization`, Storage | Validation, draft, submit, attachments |
| Edit / Resubmit Request | `#/authorization-request/:auth/edit` | Not observed — approximation | Draft edit; deferred resubmission | `mp_save_authorization` | Draft edit, resubmission after deferral |
| My Requests | `#/authorization-request/my` | Not observed — approximation | Requests created by the signed-in user | `mp_authorization_list` (`created_by`) | Status filter, persistence |
| Authorization detail | `#/authorizations/:auth` | Not observed — approximation | Facts, role-aware decisions, attachments, notes, related claims, timeline | `mp_authorization_list`, `mp_transition_authorization`, `mp_delete_authorization` | Status transitions, conflict detection, audit |
| Hospital Admin | `#/hospital-admin` | Locked control not activated — approximation; path invented | Admin-only inpatient census: record admission / discharge | `mp_member_list`, `mp_set_member_admission` | Admin permission, mutations |
| Recently Updated | `#/my-data/recently-updated-authorizations` | Not observed — approximation | Authorizations updated in the last 30 days | `mp_authorization_list` | Ordering by update |
| Recent Attachments | `#/my-data/recent-authorization-attachments` | Not observed — approximation | Authorization-linked documents, newest first | `mp_document_list` | Download/preview |
| Consult Notes | `#/my-data/consult-notes` | Not observed — approximation | Note list, create by Auth. No., view/edit/delete | `mp_note_list`, `mp_consult_notes` | Note CRUD, author permissions |
| My Members | `#/my-data/my-members` | Not observed — approximation | All members in the current IPA | `mp_member_list` | Paging, last-name filter |
| Members Approaching 65 | `#/my-data/members-approaching-65` | Not observed — approximation | Members aged 64 | `mp_member_list.approaching_65` | Report correctness |
| Members Hospitalized | `#/my-data/members-hospitalized-pcp` | Not observed — approximation | Members with an open admission | `mp_member_list.hospitalized` | Reflects Hospital Admin changes |
| Members Without Visits in the Past Year | `#/my-data/members-without-pcp-visits-in-the-past-year` | Not observed — approximation | No PCP visit in 12 months | `mp_member_list.no_visit_past_year` | Report correctness |
| Members Without Visits Since Enrollment | `#/my-data/members-without-pcp-visits-since-enrollment` | Not observed — approximation | No PCP visit ever | `mp_member_list.no_visit_since_enrollment` | Report correctness |
| My Documents | `#/documents` | Not observed — approximation | IPA inbox with upload, mark read/archive, delete | `mp_document_list`, Storage | Upload/download/delete, status changes |
| Member detail | `#/members/:member` | Not observed — approximation | Demographics, eligibility, related auths/claims/notes | `mp_member_list` + related views | Related-record navigation |
| Claim detail | `#/claims/:claim` | Not observed — approximation | Amounts, linked authorization | `mp_claim_list` | Read-only detail |
| Provider detail | `#/providers/:npi` | Not observed — approximation | Profile with PCP-member and request counts | `mp_provider_list` | Read-only detail |
| Activity Log | `#/activity` (account menu) | Demo-only feature | Audit trail of portal mutations | `mp_activity_events` | Verify side effects of agent actions |

The header **Current IPA** selector lists the signed-in user's organizations (`mp_memberships`) and scopes every query.
