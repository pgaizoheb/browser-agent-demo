# Shared components and visual rules

Visual rules are unchanged from the supplied mock (see the original `portal-components.md`): Roboto/Helvetica stack, `#fafafa` background, `#0d47a1` primary bar, 92 px header, 64 px primary and secondary bars, 960 px search panels with three-column underline fields, 56 px table headers and 48 px rows, 451 px sign-in card, local Material Icons font, persistent demo banner. `src/styles.css` is the mock stylesheet verbatim, followed by an appended section for Supabase-era components that reuse the same palette and spacing.

## Component map

| Component | Source | Notes |
|---|---|---|
| Shell: header, Current IPA selector, account/sign-out, primary and expanding secondary navigation | `src/components/shell.js` | Navigation definition mirrors the observed menu. Expanding a group re-renders only the nav bars, not the page. |
| Underline field / select / date / textarea / file | `src/components/field.js` → `field()` | Same markup and floating-label CSS as the mock; adds `aria-describedby` error slots (`data-testid="error-<name>"`). |
| Date preset filter (Any / Today / Last 7 Days / Last 30 Days / Custom) | `field.js` → `dateRangeField()` | Custom reveals from/to inputs; converted to server-side `gte`/`lte`. |
| Search panel (collapsible, More Options, Reset) | `src/pages/search.js` + `src/pages/searchConfigs.js` | One generic renderer; each observed search page is a config of filters, columns, source view, default sort. State lives in the URL query. |
| Server-paginated table + paginator | `src/components/dataTable.js` | Sortable headers (`aria-sort`), loading/idle/empty/error rows, page sizes 10/25/50/100, `data-record-id` / `data-status` on rows. |
| Report list page | `src/pages/reports.js` | Approximation lists (My Requests, member reports, My Documents, Activity Log) with optional quick filters and toolbar. |
| Modal, in-page confirm, toast, state panels, status badge, busy button | `src/components/feedback.js` | No native `alert/confirm` dialogs — agents interact with ordinary DOM. |
| File download / preview | `src/components/files.js` | Private Storage download → blob; PDF in `<iframe>` (CSP `frame-src blob:`), text in `<pre>`, images in `<img>`. |
| Attachments section + upload form | `src/components/attachments.js` | Client validation (type, 5 MB, empty) mirrors bucket limits enforced server-side. |
| Consult notes list / form / edit dialog | `src/components/notes.js` | Edit/delete shown only to author or IPA admin; RLS enforces the same rule. |
| Sign-in, test CAPTCHA, verification, demo test mailbox | `src/pages/signIn.js`, `src/pages/help.js` | CAPTCHA appears once a password is entered, as described by the user. |
| Authorization detail and decision dialogs | `src/pages/authorizationDetail.js` | Actions computed from role + status; sends `p_expected_updated_at` for optimistic concurrency. |

## Responsive behavior

Breakpoints 900 px and 600 px are inherited from the mock and remain **inferred** (production mobile layout was never observed). At 390 px: fields stack to one column, navigation scrolls horizontally, tables scroll inside `.table-wrap`, and the document has no horizontal overflow (covered by `tests/e2e/responsive.spec.js`).

## Identity

Persistent `LOCAL MOCK / DEMO — NO REAL DATA` banner on every page, `LOCAL MOCK / DEMO` in every document title, synthetic organizations (`DEMO IPA — SYNTHETIC ORGANIZATION`, etc.) and demo users (`Demo User`, `Demo Reviewer`, …). Approximation pages carry a visible notice.
