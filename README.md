# Shift Handover System

A shift tracking and plant handover application built with Express 5, TypeScript,
Prisma 7.10.1, and PostgreSQL. The browser interface supports Turkish and English.

## Setup

Use Node.js 22.12+ (22.x) or Node.js 24 or later.

```sh
npm ci
cp .env.example .env
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp`.
Set your PostgreSQL connection string as `DATABASE_URL` in `.env`, and set
`JWT_SECRET` to a random secret of at least 32 bytes. Generate a secret with:

```sh
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Then run each command in order, continuing only when the previous command succeeds:

```sh
npx prisma migrate deploy
npm run build
npm start
```

For development, use `npm run dev`. Open **http://localhost:3000/app/**.
The root URL `/` also redirects to this page. The frontend lives in `public/`
and runs on the same server as the API; no separate frontend installation or build is needed.

Prisma commands require `DATABASE_URL`. Unit tests require a generated Prisma
client (`npx prisma generate`), but do not use a real database.

### Windows installation troubleshooting

Stop the project's running development server with Ctrl+C before `npm ci`.
An `EPERM` error removing `esbuild.exe` usually means a running process has locked
the file. Stop that process, or restart Windows and retry `npm ci` before starting
the application. Do not continue to migration or build commands until installation
succeeds. A failed installation can leave local `prisma` and `tsx` commands missing.
Do not accept an unrelated Prisma version offered by `npx` after a failed install.
After installation succeeds, `.\node_modules\.bin\prisma.cmd migrate deploy`
explicitly uses the project's local CLI in PowerShell.

## Security behavior

- `/register` requires a valid email address, a name of 1–100 characters, and a
  password of at least 12 characters and at most 256 bytes. It only creates
  `WORKER` accounts. Existing accounts with shorter passwords can still log in.
- `/login` and `/register` allow 20 and 10 requests per IP address per 15 minutes,
  respectively.
- `/users` requires the user's current database role to be `MANAGER`.
- Shift endpoints use the identity of the authenticated user from the token.
- JWTs accept only HS256 and expire after 8 hours. The current user role is read
  from the database on each authenticated request.
- Existing salt:scrypt password records and expiring HS256 tokens continue to
  work with the same secret.
- JSON request bodies are limited to 16 KB. Internal error details are not
  returned to clients. Photo uploads have separate multipart limits.

## Deployment and remaining work

- Serve production traffic over HTTPS. Do not log tokens.
- Rate limits currently use process memory. Use a shared store for multiple
  application instances. Configure `trust proxy` only for the actual reverse
  proxy topology; do not blindly trust client IP headers.
- Public registration remains available. Invitations, approval, and email
  verification have not been implemented.
- Logout and password changes do not yet revoke issued tokens; tokens expire
  after 8 hours.
- Concurrent `/shifts/start` requests for the same user can create only one
  active shift; other requests receive `409`. Completed shift history is retained.
- The conditional unique index uses Prisma's `partialIndexes` preview feature
  and is also created by the migration. Do not remove it or replace it with
  unconditional uniqueness on `userId`, which would prevent shift history.
- Lists are paginated. Production error monitoring remains to be configured.
- Prisma's client, CLI, and PostgreSQL adapter use version 7.10.1. Runtime
  connections use `PrismaPg` in `src/database.ts`; CLI connections are configured
  in `prisma.config.ts`. The last audit reported no vulnerabilities; future
  advisories may change that result.

## Updating an existing installation

Back up the database. First check for duplicate active shifts:

```sql
SELECT "userId", COUNT(*) FROM "Shift"
WHERE "status" = 'ACTIVE' GROUP BY "userId" HAVING COUNT(*) > 1;
```

If duplicates exist, the migration stops without deleting or closing any shift.
Decide which records to close according to your business rules and correct them.
Only if this migration has failed, mark that failed migration as rolled back
before retrying:

```sh
npx prisma migrate resolve --rolled-back 20261019000100_one_active_shift_per_user
npx prisma migrate deploy
```

For normal updates, stop the development server, then run these commands one at a time:

```sh
npm ci
npx prisma migrate deploy
npm run build
npm start
```

The unique-index migration temporarily locks table writes and stops if it cannot
acquire the lock within 10 seconds. Schedule a maintenance window for large databases.
Migration `20261019000200_operations_handover` adds equipment, entry, and photo
tables, seeds GT1/GT2/ST, and adds nullable shift schedule fields.
The handover migrations add tables and nullable shift fields without deleting
existing users, shifts, or operation records. Photos are stored in PostgreSQL
and are included in database backups.

## Tests

Unit/API checks:

```sh
npm test
npm run typecheck
```

### PostgreSQL integration tests

Use a disposable PostgreSQL database dedicated to tests. Both `DATABASE_URL` and
`TEST_DATABASE_URL` must point to that database. Apply migrations, then run:

```sh
npm run test:integration
```

The concurrency tests use two independent Prisma clients/API instances. Twelve
concurrent starts must produce one `201` and otherwise `409`; eight concurrent
ends must produce one `200` and otherwise `404`. Direct database writes are
subject to the same uniqueness constraint. Tests also cover another user's shift,
completed history, and a migration stopping on duplicate data without changing records.
Test-created records are cleaned up.

Handover tests cover shared records, authorized photos, equipment update conflicts,
immutable closure details, versioned summaries, idempotent/concurrent acknowledgments,
stale-version rejection, authenticated actor selection, combined filters, and pagination.
Tests that share plant state run sequentially.

### Browser tests

Run `npm run build` and apply migrations to the test database first. Set
`TEST_DATABASE_URL` to that dedicated PostgreSQL database, then run:

```sh
npx playwright install chromium
npm run test:e2e
```

Optionally set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to a system Chromium binary.
Tests start and stop their own local server; port 3000 must be available.
They cover authentication, shift actions, filtering, real Excel downloads,
manager access, mobile overflow, themes, photos, handover acknowledgments,
unsaved changes, and account-specific draft restoration.

## Web interface and Excel

- Log in or create an account. New accounts have the `WORKER` role.
- Start or end a shift from the top card. Actual start and end times are recorded.
- Choose dates in shift history and press **Apply**.
- **Export to Excel** downloads every record matching the applied filters,
  rather than only the visible page. Empty date fields include all dates.
- Managers can select **Records → All staff**. Other roles can only view and
  export their own shifts.

The workbook includes shift ID, staff ID/name/email, actual start and end,
status, shift date, and selected shift hours. Dates filter by actual shift start
in the Istanbul time zone, including both boundary dates. Active shifts have
an empty actual end time. Exports are limited to 5,000 rows; exceeding the limit
returns an error requesting a narrower date range instead of silently truncating
results. Empty results still produce a valid workbook with headers. User text
is not interpreted as Excel formulas. Passwords and JWTs are excluded.

Tokens stay only in page memory; refreshing requires logging in again. Tokens
are not written to browser storage. Excel downloads allow 5 requests per IP
address per 15 minutes.

### Shift list and export endpoints

These endpoints require `Authorization: Bearer <token>`:

- `GET /shifts?from=2026-10-01&to=2026-10-31&scope=own&page=1`
  returns `{ items, total, page, pageSize }`, with 20 records per page, newest first.
- `GET /shifts/export?from=2026-10-01&to=2026-10-31&scope=own`
  returns an `.xlsx` attachment ordered by start time, oldest first.

`scope=own` is the default. `scope=all` requires the current database role
`MANAGER`. Dates are optional and use `YYYY-MM-DD` format.
ExcelJS's transitive uuid dependency is pinned to the CommonJS-compatible
version 11.1.1, which includes the security fix.

### Language and theme

The compact **文 / A** control opens the Turkish/English selector on both the
authentication screen and dashboard. Interface text and Excel headers are
translated; operator-written notes are not automatically translated. Both
languages use the Istanbul time zone. The `vardiya-language` preference is
stored in the browser.

The **sun/moon theme switch** changes between light and dark mode. On first use,
the device preference is used. A manual choice is stored under `vardiya-theme`
and survives refreshes, screen changes, and logout. Passwords and tokens are
not stored with this preference. If browser storage is unavailable, the theme
still works for the current page and falls back to the device preference next time.

## Plant handover dashboard

- GT1/GT2 gas turbines and the ST steam turbine support **Unspecified / Active /
  Inactive / Maintenance** status, with a note, updater, and timestamp. Status
  is entered manually; no unit is assumed active on a new installation. Changes
  are retained in `EquipmentChange`. Updates based on an outdated version return
  `409` and require refreshing.
- **Event / Note / Active valve / Attention item / Ongoing task** records include
  a title, description, and priority. Open valve, attention, and task records
  remain on the shared handover board across shifts until someone closes them.
  Closure notes, actor, and time are retained in history. Events and notes appear
  directly in history.
- This release supports one plant. All authenticated roles can view shared
  equipment and handover records, create entries, update equipment status, and
  close open work. Personal shift lists and exports retain their role restrictions.
- Each entry accepts up to 3 JPEG/PNG/WebP photos, each at most 5 MB. Actual image
  contents are validated, resized to at most 1600×1600, and converted to JPEG
  without EXIF metadata. Photos are stored in PostgreSQL. Photo endpoints also
  require JWT authentication; files are not publicly served. The page uses
  temporary blob URLs after authenticated downloads.
- The shared dashboard refreshes every 30 seconds, or immediately with **Refresh**.
- When starting a shift, choose its date and **00:00–08:00 / 08:00–16:00 /
  16:00–00:00** schedule. The date is the day the scheduled interval starts;
  16:00–00:00 ends the next day. Actual start/end times are recorded separately.
  No elapsed-time counter is shown. Existing shifts without a schedule remain
  unspecified rather than receiving an assumed interval.

All operation endpoints require `Authorization: Bearer <token>`:

- `GET /operations/equipment`
- `PUT /operations/equipment/:code`
- `GET /operations/entries?view=open|history&page=1`
- `POST /operations/entries` (JSON or multipart; photo field: `photos`)
- `POST /operations/entries/:id/close`
- `GET /operations/photos/:id`

## Handover overview, quick entry, and search

### Handover overview and acknowledgment

The overview shows equipment status, total open and important record counts,
important open titles, and recent event/note titles. Each title list contains
at most five items; use the handover board to review all open records.
After starting an active shift, select **I have read the handover summary**.
This records the displayed summary's revision and data snapshot, user, shift,
and acknowledgment time in `HandoverRead`. It does not claim that every detailed
record has been read.

Equipment updates, new entries, and closures increment a shared revision within
the same database transaction. The summary uses a consistent PostgreSQL snapshot.
Acknowledging an outdated revision returns `409` and requires reviewing the new
summary. Repeating the same acknowledgment for the same user, shift, and revision
does not create another record. A new shift cannot reuse the previous shift's
acknowledgment. Revision tracking depends on application API writes; do not
update operation tables directly through SQL.

Endpoints: `GET /operations/summary` and `POST /operations/summary/read`
(JSON `{ "revision": 123 }`). Both require JWT authentication. The server selects
the user and active shift. Previous acknowledgment records remain unchanged.

### Quick entries and photos

Event, valve, task, and attention shortcuts prepare the form without deleting
existing text. Optional GT1/GT2/ST selection tags an entry with its equipment.
Older or untagged entries appear as **General / shared**.

Choose photos from the gallery or use **Take photo** on a supported phone.
If the device/browser does not offer a camera, use file selection. Photos have
previews and can be removed individually. The limits remain three photos total,
5 MB per photo. Browser tests verify file selection, the capture attribute, and
uploads; physical phone camera automation is outside their scope.

Unsaved text/photos trigger a warning on logout or leaving the page. Form edits
are disabled while saving so newly entered text cannot be accidentally cleared.
If the session expires, the draft stays only in the current page's memory and
is restored after logging in to the same account. Logging in to another account
discards it without displaying it. Drafts are not automatically persisted to
browser storage, the server, or disk. Accepting the warning and closing the page
loses the draft; use **Save** for a permanent record. Temporary photo preview URLs
are released when removed or on logout.

### Search events and handover records

Combine text (title, description, closure note), equipment, record type,
open/closed status, and an inclusive Istanbul date range. Search includes open
and closed records and retains filters when paging. **Clear** restores the
normal event/handover history. The open-status filter only returns closable
valve, attention, and task entries; leave status empty for events and general notes.
Search filters do not hide records from the separate open handover board.

```text
GET /operations/entries?view=all&q=pump&equipment=GT1&kind=TASK&status=open&from=2026-10-01&to=2026-10-31&page=1
```

Supported values: `equipment=GT1|GT2|ST|GENERAL`,
`kind=EVENT|NOTE|VALVE|ATTENTION|TASK`, and `status=open|closed`.
Filters are optional. Responses contain 20 records per page. Existing
`view=open` and `view=history` behavior is preserved. Prisma parameterizes queries;
`%` and `_` in search text are escaped and matched literally rather than as wildcards.

The `20261019000300_handover_reads_and_entry_units` migration adds acknowledgment
records, the shared revision, and a nullable equipment tag without deleting
existing records. Back up the database before applying updates.

## Contribution language

Use English for branch descriptions, pull request titles and descriptions,
commit subjects and bodies, README files, and other project documentation.
Use the `AtaK/` prefix for new working branches. Application interface text
continues to support both Turkish and English.
