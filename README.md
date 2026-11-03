# Peecool: Pickleball court management and scoring

> Every court. Every point.

Pickleball court management and scoring for a facility of up to 24 courts. (Internal package names, folders and data paths still say `pickle`; see [Naming](#naming).) **LAN-only, offline-first.** One Windows 11 PC (the *Master PC*) hosts the service and database; everyone else — Admin, Staff, and each court's phone or tablet — opens the same web app and signs in.

- **Dashboard** (live + analytics) · **Booking Schedule** · **Court Management** (scoring console) · **Open Play** (timed sessions with automatic round pairing and a TV board) · **Game Histories** · **Players**
- Light-only interface with the Peecool brand (Geist type, court-green palette). Times use the 12-hour format.
- Two roles: **Admin** (everything) and **Staff** (see everything, operate courts). Unlimited Staff accounts.
- Each court's device is simply **"Court 1", "Court 2", …** — sign in, choose the court, done.

Planning documents (the specification) are in [`docs/planning/`](docs/planning/) — start with `PROJECT_OVERVIEW.md`. What is built and what is not yet verified: [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md).

## Develop

Requires Node 22.12+ (24 LTS recommended, see `.nvmrc`).

```bash
npm install
npm run dev          # server on :8080 + Vite on :5173 (proxy). First visit on this machine runs first-run setup.
npm run seed:demo    # optional: 8 courts, players, 60 days of matches, a week of bookings (needs an EMPTY database; data in ./.data)
npm run check        # typecheck all workspaces + 166 unit/integration/simulation tests
npm run e2e          # builds the web app, boots the server on a clean DB, drives real Chromium (17 flows: phone, tablet, desktop)
```

`npm run seed:demo` creates `admin / admin-demo-1`, `maria / staff-demo-1`, `sam / staff-demo-1`.

> Times are shown in the 12-hour format (AM/PM). See `docs/planning/UI_UX_SPECIFICATION.md` §2.7.
> The demo accounts above are for local testing only. Never use them on a real installation.

## Layout

```
packages/shared   scoring engine (pure), permissions, booking helpers, Zod schemas, API types
apps/server       Fastify + Socket.IO + SQLite (better-sqlite3); the only process that opens the database
apps/web          React 19 + Vite + Tailwind 4 single-page app (workspace layout + full-screen scoring console)
e2e               Playwright flows
packaging         Windows 11: WinSW service definition, Inno Setup script, setup-master.ps1, stage.mjs
docs/planning     the specification (Open Play: `OPEN_PLAY.md`); docs/decisions: ADRs
docs/branding     Peecool brand guidelines, design tokens, logos' spec and fonts
docs/implementation  brand rollout plan and progress
```

## Run in production (any OS, for testing)

```bash
npm run build
PICKLE_DATA_DIR=./.data node apps/server/dist/main.js     # http://localhost:8080
node apps/server/dist/cli.js print-urls | stop | backup | restore <file> | reset-admin-password <user>
```

Environment: `PICKLE_DATA_DIR`, `PICKLE_PORT` (8080), `PICKLE_HOST` (0.0.0.0), `PICKLE_LOG_LEVEL`, `PICKLE_WEB_ROOT`.

## Install on the Master PC (Windows 11)

See `docs/planning/DEPLOYMENT_AND_OFFLINE.md`. In short: `npm run package` on a build machine → compile `packaging/installer.iss` with Inno Setup → run the installer as Administrator on the Master PC → open `http://localhost:8080` and complete first-run setup. **These Windows steps have not been run on a real Windows 11 machine yet.**

## Documentation

| Where | What |
|---|---|
| [`docs/planning/`](docs/planning/) | Requirements, architecture, API, database, scoring rules, Open Play |
| [`docs/decisions/`](docs/decisions/) | Architecture decision records |
| [`docs/branding/`](docs/branding/) | Brand guidelines, design system, `tokens.css`, fonts |
| [`docs/implementation/`](docs/implementation/) | Phase 1 brand and UI rollout: plan and progress |
| [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md) | What is built and what is unverified |

Logo files used by the app are in `apps/web/public/brand/`. Fonts are bundled from `apps/web/src/assets/fonts/` (SIL OFL licences alongside); nothing loads from a CDN.

## Naming

The product is **Peecool**. Package names (`@pickle/*`), the repository folder, `PICKLE_*` environment variables, the `pickle-*.db` backup file names and the Windows data folder `C:\ProgramData\PickleScoring` keep the earlier name on purpose: renaming them would strand existing backups and installs. See `docs/branding/APPLICATION_BRANDING.md` §7.

## Contributing and repository notes

- Run `npm run check` and `npm run e2e` before pushing.
- Local databases, backups and logs live in `.data/` and are git-ignored. Do not commit them.
- Large marketing files (`production/`, `exports/`) are git-ignored; they are not part of the application.
- No licence file has been added yet. Choose one before making the repository public.
