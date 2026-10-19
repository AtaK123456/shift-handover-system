# Application bug review — 2026-10-19

## Scope and method

Reviewed the shift/handover API, authentication, uploads, Excel export, database
constraints and migrations, bilingual frontend, theme controls, and floating AI
assistant. The starting application commit was `1735bf0`.

The existing 34 unit/API tests passed before changes, and npm audit reported zero
vulnerabilities. Seven new browser regression scenarios all failed against the
original implementation with the expected incorrect behavior. A further regression
reproduced the uncleared overview on logout. The development HTTP issue
was verified in the actual HTTP Content-Security-Policy response header. Fixes
preserve existing records, authorization rules, and manual operator approval.
No database migration or live deployment was performed.

## Confirmed and corrected findings

| Finding | Impact / reproduction | Correction | Verification |
| --- | --- | --- | --- |
| Development HTTP assets could be upgraded to unavailable HTTPS | Helmet emitted `upgrade-insecure-requests` for LAN development. A phone opening the server over its LAN IP could request scripts/styles over HTTPS even though only HTTP was listening. | Emit this directive only for `NODE_ENV=production`; keep the remaining CSP controls in both modes. | New security test verifies development and production headers. Physical phone access remains untested. |
| Outdated current-shift responses overwrote newer state | Delay the initial inactive response, request current status again, receive active status, then release the old response. The UI incorrectly returned to inactive. | Version current-shift requests and discard older or previous-session responses. | `older current-shift responses cannot overwrite newer state` |
| Invalid last history page after records changed | Open page 2, reduce matching records to one, then refresh. History stayed empty on page 2 despite a valid record on page 1. | Clamp both operation/history and open-board page requests to the last valid page and reload directly. | `history returns to a valid page after records disappear from the last page` |
| Failed pagination mislabeled existing rows | Request page 2 and return a server error. Page 1 rows remained but were labeled as page 2. | Keep requested pages separate from displayed state; commit page data only after successful responses. | `failed page requests retain the displayed page and its rows` |
| Closure errors dismissed the note editor | Return a temporary failure while closing a task. The dialog closed; reopening reset the typed closure note. | Keep the dialog and note open, show the error inside it, and allow retry. Expired-session handling continues to close private dialogs. | `failed closure retains the open dialog and operator note` |
| Equipment update errors dismissed unsaved edits | Return a temporary failure while updating equipment. Reopening the closed dialog restored old values and lost the operator's note. | Preserve the open editor, selected status, and note; show an inline error. Optimistic version conflicts remain enforced. | `failed equipment update retains status and note in its dialog` |
| A newly typed identical AI message was erased | Send a message, clear and retype exactly the same text before the response. The successful response incorrectly cleared this new draft because it compared values only. | Track composer edit revisions and clear only an unchanged submitted draft. | `typing the same text again during analysis does not erase the new message` |
| Prior overview remained in the DOM after logout | Logout hid the dashboard without clearing equipment/count/title lists. A subsequent login could display outdated overview and acknowledgment text while new requests were pending or failed. | Clear overview contents and its acknowledgment controls on logout; wait for the new session in the relogin browser helper instead of counting old hidden nodes. | `logout clears the prior handover overview before another login` |
| Ending an old shift carried its date into the next shift | End a shift with an old date. The inactive form retained that date, risking an incorrectly dated next shift. | Reset the schedule on an active-to-inactive transition and select today's Istanbul date/current slot. User selections during an already inactive shift remain intact. | `ending an old shift resets the next shift date instead of carrying it forward` |

All findings concern correctness or usability; the review did not demonstrate an
authentication bypass or automatic equipment-control action. This statement is
limited to the reviewed code and tests and is not a comprehensive penetration test.

## Validation

- Build and TypeScript checks passed.
- 35 unit/API/security tests passed, including development/production CSP behavior.
- Four PostgreSQL 17 integration tests passed, covering shift concurrency, migration
  duplicate protection, shared handover, photo authorization, optimistic equipment
  updates, and versioned handover acknowledgments.
- All 27 Chromium scenarios passed, including all eight new browser regressions.
  The relogin helper waits for the new dashboard and completed login rather than
  treating old hidden summary nodes as proof that authentication has finished.
- Database-to-Prisma comparison reported no differences.
- npm audit reported zero vulnerabilities before changes; dependencies were unchanged.
- JavaScript syntax and `git diff --check` passed.
- The separate ntfy helper's simulated configuration-preservation, Unicode summary,
  event filtering, and HTTP payload tests passed again without sending real messages.

## Limits and outstanding verification

- No OpenAI API key is configured here. Structured-output handling, disabled mode,
  failures, limits, and the chat interface use simulated provider responses. Live
  model availability, classification quality, billing, and outbound access still
  need verification with the deployment's credentials and representative records.
- The Windows computer and its actual `~/.codex/config.toml` are inaccessible from
  this Linux environment. Windows ntfy installation and real Android notification
  delivery have not been verified. No claim is made that the phone received a message.
- Chromium mobile viewport checks are not a physical Android camera or device test.
- Concurrent PostgreSQL integration checks emit an existing `pg` deprecation warning
  about overlapping client queries. Tests pass; no warning was hidden or dependency
  patched to silence it. Recheck Prisma adapter compatibility before upgrading to pg 9.

## Update

Use the review branch, install dependencies if needed, rebuild, and restart the
application. No new migration is required. For production, set `NODE_ENV=production`
and serve HTTPS. For local phone testing, keep development mode and use the
computer's LAN address on the same network.
