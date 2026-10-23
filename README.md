# Shift Handover System

[![CI](https://github.com/AtaK123456/shift-handover-system/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/AtaK123456/shift-handover-system/actions/workflows/ci.yml)

An industrial shift logbook that helps operators pass important alerts and
unfinished work to the next shift. Built around GT1, GT2 and ST turbine operations.

## Features

- Overview of equipment status, important alerts and ongoing work.
- Shift schedules, handover acknowledgments and searchable history.
- Photos, progress notes, responsible teams and next steps.
- Excel export, Turkish/English interface, light/dark themes and mobile layouts.
- Optional AI chat with evidence and review suggestions; the operator makes the final decision.

**Stack:** TypeScript, Express 5, Prisma 7, PostgreSQL and vanilla JavaScript.

## Quick start

Requires **Node.js 22.12+ (22.x) or 24+** and PostgreSQL (CI uses version 17).

```sh
git clone https://github.com/AtaK123456/shift-handover-system.git
cd shift-handover-system
npm ci
cp .env.example .env
```

On Windows PowerShell, replace `cp` with `Copy-Item .env.example .env`.
Configure these values in `.env`:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Your PostgreSQL connection string. |
| `JWT_SECRET` | A random secret of at least 32 bytes. |
| `REGISTRATION_CODE` | A separate 12–128 character code to enable signup. Empty means registration is closed. |

Secret generation commands are included in [.env.example](.env.example).
Run each command below only after the previous one succeeds:

```sh
npx prisma migrate deploy
npm run build
npm start
```

Open **http://localhost:3000/app/**. For development, use `npm run dev`.
The frontend and API run together; no separate frontend setup is needed.

AI is disabled by default. To enable it, configure `AI_ENABLED`, `OPENAI_API_KEY`
and `OPENAI_MODEL` as described in the [AI setup guide](docs/application-guide.md#configuration).
OpenAI API billing is separate from a ChatGPT subscription.

## Tests

After installing dependencies and generating the Prisma client:

```sh
npx prisma generate
npm run typecheck
npm test
```

Integration and browser tests require a **disposable, migrated PostgreSQL database**.
See [test setup](docs/application-guide.md#tests). CI runs checks, dependency
auditing, integration tests and isolated Chromium suites.

## Security and documentation

Registration requires the team code, and new accounts always receive the WORKER
role. Use HTTPS in production and keep `.env` and secrets out of Git.
**Logout does not yet revoke issued tokens; they expire after eight hours.**

- [Application guide](docs/application-guide.md): setup, updates, troubleshooting, API and feature details.
- [Security assessment](docs/reviews/2026-10-24-security-assessment.md): tested boundaries, fixes and remaining risks.
- [Contribution conventions](docs/application-guide.md#contribution-language): English documentation and `AtaK/` working branches.
