# Targeted application security assessment — 2026-10-24

## Scope and method

Assessment date uses Europe/Istanbul. Reviewed baseline `a391c7b` and tested a
local application with an isolated PostgreSQL 17 database, synthetic users and
synthetic records. No production system, real operator data, real registration
code or live AI credentials were used. This is a bounded source-assisted
application assessment, not a certification or an exhaustive penetration test.

Methods: source review, authenticated and anonymous HTTP probes through the real
Express middleware and PostgreSQL adapter, Chromium tests, dependency auditing
and a limited tracked-source credential-pattern scan. Existing security tests
were retained. Shared operations/photos are intentionally accessible to every
authenticated team member; personal shift scope and manager-only user/export
access are separate boundaries. Shared team access was not misreported as IDOR.

No critical/high-severity exploit was demonstrated in the tested scope. One
low-severity validation defect was reproduced and corrected. An existing,
documented session-revocation limitation remains and is described separately.

## Confirmed findings

### AS-01 — NUL text reaches PostgreSQL and causes HTTP 500 (low, fixed)

Before the fix, all eight probes returned `500` when a NUL character was supplied
in registration email/name, login email, entry title/description, equipment note,
closure note or operation search text. This is improper input handling, not a
demonstrated SQL-injection or data-disclosure exploit. Error responses were
generic; no stack trace, credentials or database connection string was exposed.

Reject NUL in credential text, the shared operations text validator and the
search parser. Reuse the existing `400` errors. Password handling and registration
code comparison are unchanged. After the fix, all eight probes return `400`;
the test checks unchanged operation revision, equipment note and closure state,
and no account creation. The unit regression also verifies that invalid
credentials do not reach database processing.

Reproduction/regression: `tests/integration/security-assessment.test.ts`, test
`assessment: NUL text is rejected before database work instead of causing server errors`.
The test failed against the baseline with eight `500` responses and passed after
the correction. No migration or dependency change is required.

### AS-02 — Browser logout does not revoke an issued JWT (medium, conditional; remains)

The browser removes its in-memory credentials and private views on logout, but
there is no server-side logout/revocation operation. The browser assessment records
the status of a replayed, previously issued token after logout and its lifetime
in the `session-revocation-observation` attachment, without including the token.
In this run, replay returned `200`; the issued token lifetime was eight hours
(28,800 seconds).

This is already documented in README's deployment limitations. It does not give
an anonymous attacker a token. If a token has already been copied, however,
closing the browser session is not sufficient to terminate the copied session.
The server still checks account existence and current role on every request;
deleting the account or removing its manager role takes effect immediately.

Recommended next step: persistent server-side session revocation and an
authenticated logout endpoint, with tests rejecting replay after logout and
after process restart. Choose a session/token-version design explicitly before
implementation; an in-memory denylist alone would lose revocations on restart
and would not cover multiple instances. This assessment does not silently change
session lifetime or add a new session architecture.

## Checked boundaries

| Area | Evidence / outcome |
| --- | --- |
| Anonymous access | Twenty users/shift/operations/photo/AI read and write routes return `401`; no operation revision changes. |
| Roles and ownership | A WORKER token carrying fake MANAGER/userId claims cannot list users or export/list all shifts. Body-supplied userId/shiftId cannot start or end another worker's shift. Manager user listings omit passwords. |
| Registration gate | Missing/wrong/structured/oversized codes return generic `403` and create no account. Registration without configuration is closed. A correct code still creates WORKER despite a supplied MANAGER role, omits secrets, and retains duplicate-email `409`. |
| Token validation | Existing tests reject expired, unsigned, malformed, wrong-algorithm and invalid-claim JWTs; deleted users and stale manager claims fail. No JWT secret was brute-forced. |
| Query injection and parameter pollution | SQL-like search text remains literal. Repeated/structured query parameters fail validation. Object-valued login email is rejected. No unsafe raw SQL call was found in reviewed source. |
| Mass assignment / prototype input | Supplied authorId, closedAt, closedById, createdAt, role and JSON photo data cannot forge ownership, closure, timestamps or image storage. A JSON prototype-key probe does not mutate Object.prototype. |
| Stored XSS | Browser scenario stores markup in account name, title, description, responsible team, next step and progress note; checks observation, detail, updates and handover views for literal text and absence of injected elements/script effects. |
| Uploads | SVG/HTML disguised as JPEG/PNG, damaged WebP, disallowed MIME, files over 5 MB and four-photo submissions are rejected. A valid photo is private, rotated according to orientation, re-encoded as JPEG and served without original EXIF. List responses contain photo IDs, not bytes. |
| CORS / basic CSRF | A foreign Origin does not receive Access-Control-Allow-Origin. An anonymous cross-origin form write receives `401`. Authentication uses an explicit bearer header, not ambient cookies. This is not a test of every browser cross-origin vector. |
| Traversal and headers | Probes for .env, .git/config, source files and encoded parent-directory paths under /app return `404`. CSP restricts scripts and framing to self; nosniff is present, x-powered-by is absent, and private API/photo responses use no-store. |
| Guessing limits | Login/register retain 20/10 attempts per 15 minutes. Changing X-Real-IP and supplying a new X-Forwarded-For after exhaustion does not reset the limit under the current proxy configuration. |
| Excel injection | Existing workbook tests verify untrusted names remain string cells, never formulas, with authentication, ownership and export row limits retained. |
| AI boundary | Existing tests verify authentication, strict input/output validation, evidence provenance, bounded concurrent upstream calls, generic failures and absence of operation writes. No live provider was contacted. |
| Credential handling | Frontend token stays out of browser storage. Limited key-pattern scan of tracked non-test source found no private-key/GitHub/OpenAI-pattern candidate; tracked sensitive-name candidates consist of .env.example. This is not a full-history or entropy-based secret audit. |

## Resource hardening follow-up (not an observed denial of service)

Uploads have per-request limits (three files, 5 MB each), decoded pixel limits
and a write rate limit. They use memoryStorage and currently have no shared
application-wide upload concurrency budget. A per-IP time-window limit does not
itself cap simultaneous buffered uploads. Consider a bounded admission guard
before multipart buffering, request timeouts and deployment-level body/rate
limits before broader internet exposure. No saturation, distributed attack,
intentional memory exhaustion or service outage was attempted here.

Rate counters are process-local and the application currently does not trust
forwarded IP headers. Recheck rate behavior against the actual reverse proxy and
use a shared counter if multiple application instances are deployed. Do not set
trust proxy to true indiscriminately.

## Validation

- `npm run typecheck` and `npm run build`: passed.
- `npm test`: 46/46 passed, including the new credential regression.
- PostgreSQL 17 integration: 21/21 passed, including eight new assessment cases.
- Chromium: 62/62 scenarios passed across 13 isolated suites, including the new
  stored-XSS/logout scenario. The session observation recorded replay `200`
  after browser logout with a 28,800-second token lifetime.
- `npm audit --omit=dev --audit-level=high --json` and full `npm audit --json`:
  zero reported vulnerabilities at assessment time. This does not establish the
  absence of undisclosed dependency vulnerabilities.
- `git diff --check`: passed.
- Local runtime: Node 24.19.0, PostgreSQL 17 and system Chromium. Existing pg
  deprecation warnings about overlapping adapter queries remain visible; no
  dependency was patched or warning hidden to change test results.

## Limits

No deployed domain, TLS termination, DNS, firewall, operating-system exposure,
production database permissions/backups, physical phone or real AI account was
tested. Production must use HTTPS; NODE_ENV=production and CSP alone do not
encrypt HTTP API traffic. No assertion is made that the application is free of
vulnerabilities. GitHub Actions on Node 22 remains a separate verification step.
