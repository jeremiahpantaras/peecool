# Implementation Roadmap

> Revision 3. For the implementing developer/AI (Claude Sonnet 5.5). Build in this order; each phase ends with green checks (`npm run check`) and its completion criteria met. Do not start a phase whose dependencies are incomplete. Where a decision is not covered by the planning documents, record it in `docs/decisions/NNN-title.md` (short ADR) rather than silently choosing.
>
> Revision 3 changes: one login-based web app for every device (no pairing/device tokens, no separate court app); Staff read all areas and change only Court Management; **Booking Schedule** (new backend phase 6 and UI phase 9); Players page for all names; unlimited Staff accounts. Phase numbers 6+ shifted accordingly.
>
> Estimates assume one experienced developer; an AI-assisted build will differ but the ordering still holds.

> **Implementation status:** Phases 0–12 are built and tested; Phase 13 files are written but unrun; Phase 14 is partial. See `docs/IMPLEMENTATION_STATUS.md`.

## 0. Ground rules for implementation

1. **Spec sources**: requirement IDs from `FUNCTIONAL_REQUIREMENTS.md` / `NON_FUNCTIONAL_REQUIREMENTS.md`; data from `DATABASE_SCHEMA.md`; contracts from `API_SPECIFICATION.md`; rules from `MATCH_SCORING_LOGIC.md`; screens from `UI_UX_SPECIFICATION.md`; environment from `DEPLOYMENT_AND_OFFLINE.md`. Unresolved decisions are in `OPEN_QUESTIONS.md`; use the stated defaults and keep them configurable.
2. **Shared contracts first**: define Zod schemas, enums and the permission table in `packages/shared` before writing the route or UI that uses them.
3. **No business rules in the UI.** The app renders `MatchSnapshot` and `Booking` data; it never decides points, servers, game ends, booking overlaps, or what a role may do (the server does).
4. **One permission table** (`FUNCTIONAL_REQUIREMENTS.md` §1.1) implemented once as `can(actor, key, ctx)`. Two roles only: `admin` and `staff`. No device, player or other account types.
5. **No `await` between reading match state and committing** in the command pipeline.
6. **No outbound network requests** anywhere (lint rule: forbid absolute `http(s)://` URLs in `apps/web/src` except via config).
7. **Insecure-context safe**: no `crypto.randomUUID`, service workers, Wake Lock, Clipboard API anywhere in the web app (plain HTTP on the LAN).
8. **Players never operate matches**; the Court page is used by signed-in staff. Names are never mandatory and never create directory records automatically.
9. **Windows 11 is the only packaged target**; develop on any OS but test the packaged service on Windows 11.
10. Every phase updates tests; scoring engine coverage 100 % branches.
11. **A court device is a session, not a credential.** Never add a device token, pairing table or device-specific authorization path.

## 1. Phase overview

| Phase | Name | Depends on | Est. |
|------:|------|-----------|-----:|
| 0 | Repository scaffold & tooling | — | 1 d |
| 1 | Shared contracts, permissions & scoring engine | 0 | 5 d |
| 2 | Server foundation (config, DB, migrations, errors, health, logging) | 0 | 2 d |
| 3 | Users, roles, authentication & sessions, permission enforcement, audit | 1 (permissions), 2 | 3 d |
| 4 | Courts (dynamic count), court-device assignment, Socket.IO rooms & presence | 3 | 3 d |
| 5 | Matches: creation (match type + rules), command pipeline incl. END_MATCH, snapshots, jobs | 1, 4 | 5 d |
| 6 | **Booking Schedule backend** (bookings, overlap rules, context, links, alerts) | 4, 5 | 3 d |
| 7 | Web app shell & **Court page**: login, role navigation, scoring console, device assignment | 5 (6 for booking chip) | 8 d |
| 8 | Dashboard & Court Management workspace (court list, Number of courts, Create match dialog) | 7 | 4 d |
| 9 | **Booking Schedule UI** (Day/Week/Agenda, booking dialog) | 6, 8 | 4 d |
| 10 | Game Histories, **Players page**, rule presets, Users, corrections | 8 | 5 d |
| 11 | Analytics: reports, exports, print | 10 | 3 d |
| 12 | Settings, backups, restore, recovery mode, CLI | 3 (backend), 8 (UI) | 3 d |
| 13 | Windows 11 packaging & installer | 12 | 4 d |
| 14 | Hardening, simulation, device testing, Windows acceptance | all | 5 d |

Critical path: 0 → 1 → 5 → 7 → 14. Phases 2–4 can run in parallel with 1 (after the Phase 1 permission table exists); Phase 6 can run in parallel with Phase 7.

**Decision gates (see OPEN_QUESTIONS.md):** the defaults let every phase start immediately. Q25–Q28 only change preset seed data and defaults (confirmable any time before Phase 5 ships). Q32 (Staff court restriction) is checked before Phase 7; Q34 (Staff booking visibility) before Phase 9; Q33/Q31 before Phase 13.

## 2. Phase details

### Phase 0 — Repository scaffold & tooling
**Tasks**
- npm workspaces: `packages/shared`, `apps/server`, `apps/web`; `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`), project references.
- ESLint (typescript-eslint, react-hooks), Prettier, Vitest workspace config, Playwright config (`e2e/`).
- Root scripts: `dev` (server with `tsx watch` + Vite dev server proxying `/api` and `/socket.io` to the server), `build`, `check` (typecheck + lint + unit tests), `e2e`, `package`.
- `.gitignore`, `.editorconfig`, `README.md` (dev quick start), `docs/decisions/` folder. Pin Node 24 via `.nvmrc` and `engines`.

**Completion criteria**: `npm install && npm run check` passes on a clean clone; `npm run dev` serves a placeholder SPA at `/` through the server port.

### Phase 1 — Shared contracts, permissions & scoring engine
**Tasks**
- `types`: enums (MatchStatus, Phase, CourtStatus, BookingStatus, CommandType, Outcome, ErrorCode, EndReason, Role = `admin|staff`, PlayType = `singles|doubles`, ServingMode, ScoringType).
- `permissions`: the permission keys and role table from `FUNCTIONAL_REQUIREMENTS.md` §1.1; `can(actor, key, ctx)`; `permissionsFor(role)` for `/auth/me`.
- `constants`: `MAX_ACTIVE_COURTS = 24`.
- `schemas/`: Zod schemas for all request/response bodies and socket payloads in `API_SPECIFICATION.md` (including `playType`, `ruleOverrides`, `bookingId`, `END_MATCH` with `confirmed: true`, `Booking`, the Players-page list item and `playerKey`).
- `scoring/`: `createInitialState`, `applyEvent`, `replay`, `undo` helper, `deriveView`, `validateRules(playType, rules)`, `isGameWon`, `defaultPlayerLabel(playType, team, slot)`, timer helpers (`elapsedMs`, `occupiedMs`).
- `booking/`: pure helpers `overlaps(a, b)`, `snapToSlot`, `validateBookingTimes(booking, hours, settings, now)` (reasons `OUTSIDE_HOURS`, `TOO_LONG`, `TOO_FAR_AHEAD`, `IN_PAST`, `NOT_ON_SLOT`), `bookingTimeState(booking, now)` (upcoming/now/past), `normalizeTypedName`.
- Full test catalogue from `MATCH_SCORING_LOGIC.md` §12 (including T-END-*, T-LABEL-*, T-CFG-*, T-OFF-*), property tests (`fast-check`, dev dependency), booking helper tests (adjacent vs overlapping, DST-day boundaries, midnight).
- Permission matrix unit test: every row of §1.1 × {admin, staff}.

**Completion criteria**: every test ID in the catalogue exists and passes; engine has zero imports outside `scoring/` and `types/`; the permission table test covers every key.

### Phase 2 — Server foundation
**Tasks**
- `config.ts` (data dir default `C:\ProgramData\PickleScoring`, dev `./.data`; `config.json`; env overrides), directory bootstrap.
- DB client with pragmas; Drizzle schema for **all** tables in `DATABASE_SCHEMA.md` (partial unique indexes, CHECKs and the `tr_bookings_no_overlap_*` triggers via SQL in migrations, including the `terminated ⇒ winner IS NULL` constraint and `ux_user_sessions_terminal_court`); migration runner with `pre_migration` backup; seed (six rule presets, settings).
- Startup/shutdown sequence (SYSTEM_ARCHITECTURE §12) incl. `quick_check`, recovery-mode flag, and the loopback `POST /internal/shutdown` + `cli stop`.
- Fastify app: static serving + SPA fallback, error envelope, `X-Request-Id`, `X-Server-Time`, CSRF header check, security headers, rate limiter, pino logging with rotation.
- `GET /health`, `GET /setup/status`; settings service (typed, cached); injectable clock.

**Tests**: migration from empty DB; constraint tests (insert violating each CHECK/unique/trigger → fails, including terminated-with-winner, overlapping bookings, second device on a court; the 25th-court rule is app-level so tested in Phase 4); startup with corrupted file → recovery mode; health endpoint; shutdown endpoint rejects non-loopback and missing secret.
**Completion criteria**: server boots, creates DB, seeds, serves health; kill -9 and restart works; schema matches the document table by table.

### Phase 3 — Users, roles, authentication & sessions, permission enforcement, audit
**Tasks**: scrypt util; first-run setup (loopback-only, creates the first **admin**); login/logout/me (returns `permissions[]`, public settings, `terminal`, `mustChangePassword`)/change-password; session store with idle/absolute expiry (ordinary sessions) and `terminalSessionDays` for court-assigned sessions; lockout; `adminLoginMasterPcOnly`; **user management** (`/users`: search, role/active filters, pagination, **no staff limit**; `mustChangePassword`; Admin only) with last-admin protection and session revocation on role change/deactivate/reset; the single Fastify auth `preHandler` (session + `can()`); audit service + `GET /audit-logs`; CLI `reset-admin-password`.
**Tests**: FR-AUTH acceptance criteria; setup rejected from non-loopback; session expiry with fake clock; lockout timing; creating 300 staff accounts and listing/searching them; staff cannot call any Admin-only route (generated from the route table); deactivated user's next request is `401` and sockets close; last admin cannot be removed; `PASSWORD_CHANGE_REQUIRED` gate.
**Completion criteria**: all FR-AUTH-* MUST items verified; **route-table test** (every route has a scheme and permission; outcomes equal the §1.1 matrix) is in place and green for the routes that exist so far, and is extended in each later phase.

### Phase 4 — Courts, court-device assignment, Socket.IO rooms & presence
**Tasks**: courts CRUD, ordering, maintenance (**Admin and Staff**), release (both), **bulk create**, **24-active-court limit** inside one transaction, unique name/short-code, short-code lock after first match, deactivate with history preserved (the future-bookings check is wired in Phase 6); derived status function (shared, pure); **court-device assignment** (`PUT/DELETE /session/terminal`, replace flow in one transaction, `COURT_HAS_DEVICE`, Admin `DELETE /courts/:id/device`); Socket.IO server (cookie handshake; rooms `user:`, `session:`, `role:`, `facility`, `court:`, `courts:all`; `subscribe`/`sync`; `server:hello` incl. assignment; `terminal:changed`; `device:status`; heartbeat → online/offline for assigned sessions); publisher (builds `CourtSnapshot`, emits to rooms, `snapshotSeq`).
**Tests**: assignment + replace flow via `inject` + socket client; unique device per court; sign-out frees the court; **reconnection re-joins the same court** and returns the snapshot, also after the server restarts; a session without an assignment gets no court room until it subscribes; online/offline transitions within 15 s (fake timers); concurrent creation of the 24th/25th court; deactivated court's history still queryable; Staff can set maintenance but not create courts (route-table).
**Completion criteria**: FR-COURT-01..04,06,07,09..11 and FR-TERM-01..08 pass API tests.

### Phase 5 — Matches & command pipeline
**Tasks**: create match (`playType` required, preset + `ruleOverrides` validated and snapshotted, `rules_customized`, match code generation, optional players with trimmed typed names, `clientRequestId` idempotency, `bookingId` link and `BOOKING_WARNING` handshake stubbed until Phase 6, never touches the `players` table); command endpoint with the exact pipeline in `MATCH_SCORING_LOGIC.md` §10 including the permission check (`matches.operate`/`matches.end`) and `actor_user_id` + `actor_court_id` attribution; `match_games` mirroring; undo voiding; `UPDATE_PLAYERS` (default labels), `UPDATE_RULES` (setup only), **`END_MATCH`** (reason, note for `other`, `confirmed: true`, status `terminated`, game abandoned with preserved score, no winner, `ended_at`); correction endpoint (Admin); finished-match players edit (Admin); detail & events endpoints (no history window); history list with filters (incl. `playerKey`, `bookingId`) + CSV (Admin); jobs: autoConfirm, courtRelease, staleCheck, needs_review at startup; activity + alerts generation (Admin-only alerts separated); invalidate hints.
**Tests**: duplicate `commandId` → applied once; stale `expectedVersion` → 409 with snapshot; two concurrent creates → one `COURT_BUSY`; auto-confirm vs. undo race; `END_MATCH` rejected without `confirmed`, from `match_over`, or on a stale version; early end during pause; singles and doubles matches with different rules running concurrently on different courts; blank names → default labels and zero `players` rows; renaming a directory player leaves past snapshots unchanged; Staff can operate any court and Admin-only corrections return `403` for Staff; snapshot published to correct rooms only; dev-mode replay assertion on; crash-consistency test (kill the process mid-sequence, restart, verify events == acknowledged commands).
**Completion criteria**: a scripted client can play a full best-of-3 doubles match and a singles match via the API; results, games, events and durations are correct; an early-ended match preserves scores and has no winner.

### Phase 6 — Booking Schedule backend
**Tasks**: bookings repository/service/routes per `API_SPECIFICATION.md` §3.4: create/edit/cancel/no-show (Admin), `GET /bookings/schedule`, `GET /bookings` (agenda, search), `GET /bookings/context`, `GET /bookings/:id` with linked matches, CSV; overlap check in `BEGIN IMMEDIATE` plus the DB triggers mapped to `409 BOOKING_CONFLICT`; validation through the shared helpers (`BOOKING_INVALID` reasons); booking codes; court deactivation/maintenance integration (`FUTURE_BOOKINGS_EXIST`, `bookingAction`, warnings); `matches.booking_id` link and the `409 BOOKING_WARNING` handshake in match creation; booking chip data (`now`/`next`) in `CourtSnapshot` and `GET /courts`; `booking:changed` events; `bookingWatch` job + "booking started, no match" alert; dashboard KPIs (bookings today, next booking); audit entries.
**Tests**: adjacent vs. overlapping vs. enclosing vs. contained; two concurrent conflicting creates → one `409`; edit/move re-validation; cancelled/no-show do not block; operating-hours, max-length, advance and past rules; Staff can read everything and get `403` on every write; deactivating a court with future bookings requires keep/cancel; creating a match 10 minutes before someone else's booking → `BOOKING_WARNING`, proceeds with `acknowledgeBooking` or `bookingId`; booking changes never block scoring.
**Completion criteria**: FR-BOOK-01..10 verified at the API level; booking tests added to the route-table suite.

### Phase 7 — Web app shell & Court page (scoring console)
**Tasks**
- Design tokens, layouts (workspace sidebar/top bar/bottom tab bar; console layout), login + first-run setup wizard, forced password change, auth guard, **permission-driven navigation** from `/auth/me`, TanStack Query + socket invalidation bridge, API client + command queue (single in-flight, retry with same `commandId`, no auto-retry for `END_MATCH`), socket client + reconnection state machine (API_SPECIFICATION §6.4), clock offset, court store (`useSyncExternalStore`, version-guarded).
- **Court device assignment UI**: "Use this device for which court?" picker, "Continue as Court N" after sign-in, user-menu actions, redirect of `/` to the assigned court, `terminal:changed` handling.
- **Court page**: workspace layout and full-screen **console layout** with all views — Idle (with booking chip), Not in service, Maintenance, New-match wizard (**match type first**, presets, Customize rules, booking link and warning, optional names with autocomplete and default-label placeholders, serve step; sessionStorage draft), Ready-to-start, Live (landscape + portrait + phone, serving-off variant), Game over, Match over (auto-confirm countdown), Result, **Ended early card**, Paused, dialogs (Adjust score, **End match: reason → HoldButton (`endMatchHoldMs`, default 2 s) → confirmation dialog → `END_MATCH`**, Edit names, Change rules before start), connection banners, court-device menu, debug overlay, themes.
**Tests**: component tests for ScorePanel/HoldButton (tap does nothing; release at 1.9 s cancels; 2.0 s opens confirmation; never sends by itself)/Timer; Playwright: sign in → assign Court 3 → full singles and doubles matches, undo, double-tap guard, refresh and device reboot mid-match restore the exact view, session expiry → "Continue as Court 3", server restart mid-match (banner → reconnect), offline mid-tap → exactly-once, version-conflict toast with "Maria (Court 3)", early-end flow end to end, replace-device flow.
**Completion criteria**: FR-TERM-*, FR-MATCH-*, FR-TIMER-*, FR-PLAYER-01..05, NFR-UX-01/02/04/05 verified on a 390×844 phone, 1024×768 and 1340×800 tablets; console chunk ≤ 350 KB gz.

### Phase 8 — Dashboard & Court Management workspace
**Tasks**: Dashboard (Live tab: KPIs incl. bookings, court grid with booking chips and device state, activity, alerts; identical for both roles; Admin-only alerts), Court Management list/grid (both roles) with **Add court, reorder, activate/deactivate, Number of courts (Admin)**, maintenance and release (both), device panel with Admin **Sign device out**, Create-match dialog on any device, "You are on Court 3's device" strip when operating another court (Q32), "Full-screen scoring" toggle.
**Tests**: Playwright two-context test — a phone assigned to Court 3 scores, a desktop dashboard card updates < 1 s; Staff can create and run a match from the Court page on a PC; Staff has no Add-court/Number-of-courts/Users/Settings controls and gets `403` on direct API calls; Admin adds courts up to 24 and is blocked at 25.
**Completion criteria**: FR-DASH-01,03..07, FR-COURT-* UI items verified for both roles.

### Phase 9 — Booking Schedule UI
**Tasks**: Day grid (courts × time, sticky headers, now-line, 24-court horizontal scroll, phone one-court mode), Week and Agenda views, filters/search, booking blocks (confirmed / now / no-show / cancelled variants with text + border, not colour alone), details drawer with linked matches, **Admin-only** New/Edit booking dialog, click-to-create, drag to move/resize with slot snapping and server validation, cancel and no-show actions, "View only" Staff mode, print view, CSV, real-time updates from `booking:changed`, keyboard navigation and screen-reader labels.
**Tests**: Playwright — Admin creates, moves, resizes, cancels; conflicting drop snaps back with the server's message; Staff sees the same grid without write controls; a booking created on one browser appears on another < 1 s; phone viewport usable; 24-court grid renders < 300 ms (NFR-CAP-06).
**Completion criteria**: FR-BOOK-04, 05, 09, 12 and NFR-UX-06/07 verified; Dashboard and Court-page booking chips match the schedule.

### Phase 10 — Game Histories, Players page, rule presets, Users, corrections
**Tasks**: Game Histories list/detail (identical for both roles; ended-early presentation; event timeline with voided events struck through; linked booking), Admin result correction dialog and finished-match name editing/linking, **Players page** (all registered players + typed names, filters, sort, pagination; history page with stats and the typed-name banner; Admin: Add player, **Add to directory** with dry-run preview, link/merge), Rule presets editor (no play type field, serving mode, summary sentence, validation), **Users** (Administration → Users: search/filter/pagination, add with "Create and add another", edit/deactivate/reset, `mustChangePassword`, last-admin guard), My account page.
**Tests**: correction recomputes winner and appears in timeline + audit; editing a preset doesn't change old matches; player stats exclude ended-early/cancelled; "jordan" and "JORDAN" appear as one typed-name row and "Player 1" never appears; *Add to directory* links the right slots and nothing else; Staff sees all pages with no write controls; role change takes effect immediately; Users list with 300 accounts is responsive.
**Completion criteria**: FR-HIST-*, FR-PLAYER-*, FR-FORMAT-*, FR-MATCH-17, FR-AUTH-08/12 verified.

### Phase 11 — Analytics: reports & exports
**Tasks**: report queries (shared date-range util in facility local time, operating-hours calculator incl. partial days; deactivated courts included; booking utilization), endpoints + CSV (Admin), Dashboard **Analytics tab** with charts and tables, print stylesheet, `reports.view` for both roles.
**Tests**: fixtures with known answers (e.g. 2 courts, 3 matches spanning operating-hour boundaries → expected utilization; bookings with a no-show → expected booking utilization); ended-early matches counted for utilization but not win/loss; CSV opens in Excel with correct UTF-8; 3-year synthetic dataset < 2 s per report (NFR-CAP-05); Staff can view but not export.
**Completion criteria**: FR-REPORT-01..08 verified; dashboard KPIs equal the "Today" report values.

### Phase 12 — Settings, backups, restore, recovery, CLI
**Tasks**: settings pages (Admin) incl. Bookings and Connect-a-device (URL + QR); backup service (online backup, verify, retention, extra path with **Test**, config copy), scheduler jobs (daily, weekly verify), download/delete, restore flow (gate, pre-restore backup, swap, dbGeneration, `system:restored`), upload-restore, recovery-mode UI, remaining CLI commands.
**Tests**: backup during active scoring is consistent; restore with active matches requires force; restore of a newer-schema file refused; bookings and users survive a restore; corrupt DB → recovery → restore → normal; Staff `403` on every backup/settings/audit endpoint.
**Completion criteria**: FR-BACKUP-*, FR-SET, FR-AUDIT-* verified.

### Phase 13 — Windows 11 packaging & installer
**Tasks**: production build (Vite assets into server `public/`), server bundle, bundled portable Node 24 (win32-x64), prebuilt `better-sqlite3` win32-x64, WinSW definition (Automatic-Delayed, restart on failure, `stopexecutable` graceful stop, LocalService account), Inno Setup script (program files, data dir ACLs, service registration, **subnet-scoped firewall rule**, shortcuts), `setup-master.ps1` (power settings, adapter power management, optional Defender exclusion, network profile, checklist output), `print-urls` with QR, upgrade path, uninstall that keeps data, printed quick-reference card (PDF from Markdown) covering Admin password reset, restore, adding Staff and setting up a court phone/tablet.
**Tests (on a clean Windows 11 VM and one physical PC)**: install → first-run setup → Staff account → sign in from a phone browser → assign it to a court → score; service starts at boot with no user logged in; kill the process → restarts in ≤ 10 s; `Stop-Service` shows graceful path; upgrade preserves data; uninstall leaves the data dir; firewall rule reachable from a second machine, **not** from a different subnet/guest; behaviour when Windows labels the network Public.
**Completion criteria**: NFR-OPS-01 (< 20 min install by following the doc) verified by someone who did not write it; NFR-OPS-05/06 checklist passes.

### Phase 14 — Hardening, simulation, device testing, Windows acceptance
**Tasks**
- **Multi-court simulator** (`e2e/sim`): up to 24 virtual courts (Socket.IO + REST clients signed in as Staff users) playing random singles and doubles matches with different rules at accelerated pace, with random disconnects, duplicate sends, early ends, concurrent booking creation, and Admin interventions; validates invariants (events == acknowledged commands; replay == stored state; one active match per court; early-ended matches never have winners; no overlapping confirmed bookings; at most one device per court).
- Load: 24 court devices + 50 other sockets (100 total), 10 cmd/s → verify NFR-PERF-01/02, event-loop lag < 50 ms; 1 000 Staff accounts listing (NFR-CAP-06).
- Chaos: kill -9 the service every few minutes during simulation; power-cut test on the real Windows PC with the UPS bypassed (scripted client) → zero acknowledged loss.
- Offline audit: block WAN at the firewall, run the full E2E; check no external requests in browser network logs.
- Real devices: iPhone and iPad (Safari, Home Screen, Guided Access), Android phone and tablet (Chrome, screen pinning), Windows laptop (Edge kiosk) on the real staff-only SSID — run the scenario playbook in `DEPLOYMENT_AND_OFFLINE.md` §8.2, one row at a time.
- **Usability**: 3 first-time referees sign in, assign the device and start and score a doubles and a singles match without help (NFR-UX-04); **tune `endMatchHoldMs`** (test 1.5 / 2 / 2.5 s: no accidental terminations in 100 normal-use taps, deliberate holds succeed on first try ≥ 95 %); the Admin books and moves courts on the Day grid without help.
- **Security review**: route-table test complete; Staff privilege-boundary suite (NFR-SEC-14); no secrets in logs; guest SSID cannot reach the Master; password-over-HTTP mitigations from NFR-SEC-17 documented and verified.

**Completion criteria (release gate)**
- All MUST requirements traced to at least one passing test (`docs/TRACEABILITY.md`).
- Simulator runs 2 hours with chaos enabled with zero invariant violations.
- Scenario playbook rows 1–9 pass on all three device types on site.
- The route-table and privilege-boundary suites are green.
- Business owner sign-off on remaining OPEN_QUESTIONS answers reflected in the build.

## 3. Testing strategy summary

| Level | Tool | Scope |
|-------|------|-------|
| Unit | Vitest | Scoring engine (100 % branches), permissions, booking helpers, utilities, derive functions, report calculators |
| Property | fast-check (dev) | Engine invariants, replay equivalence |
| API/integration | Vitest + Fastify `inject` + temp SQLite file | Every endpoint: auth per role, validation, happy path, error codes; pipeline and booking concurrency |
| Authorization | Generated from the route table | Admin × Staff outcomes equal §1.1 |
| Socket | Vitest + `socket.io-client` against an in-process server | Rooms, subscriptions, auth, reconnection restoring the assigned court, hello/instanceId |
| E2E | Playwright (multiple contexts = court phone + PC Admin + PC Staff) | Workflows W1–W10 from FUNCTIONAL_REQUIREMENTS §15 |
| Simulation/chaos | Custom Node script | Multi-court invariants under failure |
| Manual | Checklists | Windows 11 install, real devices, usability, offline playbook |

Test data: a `seed:demo` script creates 8 courts, 40 players, typed names, two staff users, 3 months of realistic matches and a week of bookings for UI and report development.

## 4. Risks and mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|-----------|
| K1 | Poor Wi-Fi coverage at some courts | High | High | Site survey + AP placement (deployment §5), debug overlay, lock-and-reconcile UX, Staff can score from any other device |
| K2 | Master PC power loss / Windows Update reboot | Medium | High | UPS + graceful shutdown policy, BIOS power-on after AC loss, Active Hours, `synchronous=FULL`, auto-start service, `needs_review` flow |
| K3 | Scorer errors (wrong team, forgot rallies) | High | Medium | Rally-winner input, Undo, Adjust score, Last-action line, Admin correction |
| K4 | Rule misinterpretation (server rotation, 0-0-2) | Medium | High | Engine built and tested first with the explicit catalogue; owner reviews worked example §8; presets configurable; serving can be turned off |
| K5 | Insecure-context API limits over HTTP | Medium | Medium | NFR-COMPAT-04 rules, lint checks, optional HTTPS later |
| K6 | Browser data cleared / session expired on a court device | Low–Med | Low | Server-side court assignment survives refresh/reboot; after expiry sign-in + one-tap "Continue as Court N" (≈ 10 s); match unaffected; any other device can score meanwhile |
| K7 | Phones/tablets sleeping or leaving the app | Medium | Medium | Setup guide (Guided Access, screen pinning, stay awake), kiosk browser |
| K8 | Native module (`better-sqlite3`) packaging issues | Medium | Medium | Bundle Node ourselves (fixed ABI), prebuilt win32-x64 binary, clean-VM installer tests |
| K9 | Master IP changes → every device must re-open the new URL and sign in | Low (fixed IP confirmed) | Medium | Fixed IP via reservation/static; documented recovery |
| K10 | Forgotten matches left running (inflated utilization) | High | Medium | Stale alerts, `needs_review` at startup, time limits, End match by Staff |
| K11 | Scope creep (payments, recurring bookings, queues, tournaments) | High | Medium | Out-of-scope list in PROJECT_OVERVIEW and FR-BOOK-13; schema leaves room |
| K12 | Report queries blocking scoring as data grows | Low | Medium | Indexes, bounded ranges, NFR-PERF-07 monitor, worker-thread fallback |
| K13 | Public guests tampering with scoring | Low | Medium | Staff-only SSID, subnet-scoped firewall, login lockout, rate limiting, audit |
| K14 | Single Master PC is a single point of failure | Medium | High | Fast restore to a replacement PC from extra-path backups, same IP; users, sessions and bookings are in the backup |
| K15 | **Privilege leak: Staff reaching Admin functions** | Low | High | Single permission table, route-table + privilege-boundary tests, server-side payload shaping, immediate session revocation |
| K16 | **Shared logins** (one "court3" account on a tablet) defeating attribution | Medium | Medium | Unlimited Staff accounts make per-person logins easy; Users page guidance; audit shows user + court; "Switch user" is two taps |
| K17 | **Windows service stop kills Node without graceful path** | Medium | Low | WinSW `stopexecutable` + loopback shutdown endpoint; forced kill still data-safe |
| K18 | **SmartScreen/Defender warnings on unsigned installer** | High | Low | Documented "Run anyway", optional code-signing certificate (Q31) |
| K19 | **Windows classifies the internet-less network as Public** | Medium | Medium | Subnet-scoped firewall rule independent of profile; set profile Private |
| K20 | **Hold duration wrong** (too short → accidents, too long → frustration) | Medium | Low | Default 2 s, configurable 1–4 s, plus reason selection and confirmation dialog; tuned in Phase 14 usability |
| K21 | **Passwords typed on phones/tablets over plain HTTP** | Medium | Medium | Strong staff-only passphrase, lockout, `must_change_password`, optional `adminLoginMasterPcOnly`, optional HTTPS mode (NFR-SEC-17) |
| K22 | **Booking time bugs** (DST, midnight, time zone, off-by-one on adjacency) | Medium | Medium | Epoch-ms storage + facility-local `play_date`, pure shared helpers with boundary tests, DB overlap triggers as a backstop |
| K23 | **Reservations ignored on the court** (booked group finds a match in progress) | Medium | Low | Booking chips on cards and Court page, `BOOKING_WARNING` handshake, "booking started, no match" alert; reservations deliberately never block play |
| K24 | **Typed names merged wrongly** on the Players page (two people, same name) | Medium | Low | Clearly labelled "Typed name — grouped by the name as typed", Admin-only *Add to directory* with preview, never automatic |

## 5. Definition of done (per feature)
Code + tests merged; requirement IDs referenced in test names; API matches spec (schema shared); permission behaviour covered for Admin and Staff; UI matches spec at the primary viewports (phone 390×844, tablet 1024×768/1340×800, desktop 1366×768 and 1920×1080); no new runtime dependency without an entry in SYSTEM_ARCHITECTURE §4; docs updated if behaviour differs from the plan (with an ADR).
