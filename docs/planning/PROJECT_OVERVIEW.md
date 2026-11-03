# Project Overview — Pickleball Court Management & Scoring System

> Status: **Phase 1 planning — Revision 3 (one login-based app for every device; Booking Schedule added), ready for implementation sign-off** (see `IMPLEMENTATION_READINESS.md`)
> Audience: the business owner (for approval) and the implementing developer/AI (for build).
> Read this first. Every other document in `docs/planning/` refines a section of this one.

## 1. Document map

| # | Document | Use it for |
|---|----------|-----------|
| 1 | `PROJECT_OVERVIEW.md` | Objectives, scope, boundaries, glossary (this file) |
| 2 | `FUNCTIONAL_REQUIREMENTS.md` | Every feature, workflow and acceptance criterion, with IDs (`FR-xxx`) |
| 3 | `NON_FUNCTIONAL_REQUIREMENTS.md` | Performance, reliability, security, maintainability targets (`NFR-xxx`) |
| 4 | `SYSTEM_ARCHITECTURE.md` | Stack, process model, repo layout, real-time design, concurrency |
| 5 | `DATABASE_SCHEMA.md` | Every table, column, constraint and index |
| 6 | `API_SPECIFICATION.md` | REST endpoints, Socket.IO events, payloads, error codes |
| 7 | `MATCH_SCORING_LOGIC.md` | Pickleball rules, scoring state machine, undo/correction |
| 8 | `UI_UX_SPECIFICATION.md` | Screens, layouts, design system, responsive rules |
| 9 | `DEPLOYMENT_AND_OFFLINE.md` | Installation, LAN setup, offline scenarios, backup/restore, recovery |
| 10 | `IMPLEMENTATION_ROADMAP.md` | Build phases, tasks, dependencies, tests, completion criteria |
| 11 | `OPEN_QUESTIONS.md` | Resolved owner decisions, remaining decisions, and the default assumed in these docs |
| 12 | `IMPLEMENTATION_READINESS.md` | Final consistency review, validation results and go/no-go checklist |

Where documents conflict, the precedence is: `OPEN_QUESTIONS.md` answers (once approved) > `MATCH_SCORING_LOGIC.md` > `API_SPECIFICATION.md` > `DATABASE_SCHEMA.md` > others.

## 2. Problem statement

A pickleball facility runs several courts at once. Today scores are kept verbally or on paper, court usage is not measured, and staff cannot see at a glance which courts are free, busy, or finished. The facility needs:

1. A **phone or tablet on every court** (called "Court 1", "Court 2", …) that the referee/staff signs in on and uses to score the match.
2. **One web application** — the same on the Master PC, staff PCs and every court device — where **Admin and Staff** sign in; both see the Dashboard, Booking Schedule, Court Management, Game Histories and Players; Staff operate courts, the Admin manages everything else (bookings, setup, accounts).
3. All of this working on the **local network only**, with no dependency on the internet or any cloud service.

## 3. Objectives

| ID | Objective | Measured by |
|----|-----------|-------------|
| O1 | Accurate, rule-correct live scoring per court | Scoring engine passes the rule test suite in `MATCH_SCORING_LOGIC.md` §12 |
| O2 | Real-time facility overview | Court status/score change visible on Master within 1 s (NFR-PERF-02) |
| O3 | Reliable offline operation | Full functionality with internet unplugged; no acknowledged score lost on Master crash |
| O4 | Fast, error-tolerant court UX | A new doubles match can be started in < 30 s; every scoring action is undoable |
| O5 | Useful operational data | Daily/weekly/monthly match counts, utilization, durations, player stats, CSV export |
| O6 | Simple to install and run | One installer/service on the Master PC; every other device needs only a browser |
| O7 | Court reservations on the LAN | Admin books courts without overlaps; everyone sees the schedule and which courts are reserved right now |

## 4. Scope

### 4.1 In scope (Release 1.0)

One web application, one login screen, used on every device. Six capabilities:

1. **Login / Logout** for **Admin** and **Staff**. The Admin creates Staff accounts — **no limit on the number of Staff**. First-run setup, session management, password change, forced password change for new accounts.
2. **Dashboard** (same for both roles): live court grid, KPIs, alerts, activity feed, and an Analytics tab (match volume, court utilization, durations, peak hours, player participation, booking utilization; print-to-PDF; CSV for Admin).
3. **Booking Schedule / court reservation** (Admin manages, Staff view): day/week/agenda views, no double-booking, link a match to a reservation, reserved-now and next-booking chips on every court.
4. **Court Management** (the area Staff operate): configurable court count (up to 24 active, Admin), unique identifiers, activate/deactivate with history preserved, maintenance (Admin and Staff); the **Court page** for each court — create a match (Singles/Doubles, rule preset, per-match customization, optional names), start, score with automatic serving, pause/resume, next game, undo/adjust, complete, **End match** (press-and-hold + confirmation), release — plus each court's phone/tablet, assigned to "Court N" so it reopens on its court after any reconnection.
5. **Game Histories** (same for both roles): filterable list, per-game scores, full event timeline, linked booking; Admin can correct results and export CSV.
6. **Players**: one page listing **every player name** — registered directory players and names typed at the courts — with each player's **history and stats**. Typed names never become directory records automatically; the Admin can add them.

Supporting capabilities: rule presets, system settings, audit log, scheduled and manual database backup/restore (Admin).

- Backend service (Node.js + TypeScript) owning the SQLite database, all business rules and all real-time broadcasting
- Installation packaging for the Master PC on **Windows 11** (installer, Windows service, firewall rule, setup scripts) and setup guides for the fixed-IP, staff-only-Wi-Fi network and the phones/tablets

### 4.2 Out of scope (Release 1.0) — candidates for later releases

| Item | Why deferred |
|------|-------------|
| Payments, memberships, customer accounts, online/self-service booking, recurring reservations, booking reminders (SMS/email), holiday/closure calendars | Beyond a LAN-only desk schedule; see Q33. (The basic Booking Schedule itself **is** in scope.) |
| Tournament brackets, ladders and knockout draws. (Timed **Open Play** rotation with winner-vs-winner pairing was added later: see `OPEN_PLAY.md`.) | Valuable but not required for scoring + monitoring; schema leaves room |
| Offline scoring queue on court phones/tablets (scoring while Master unreachable) | Requires conflict resolution; see `DEPLOYMENT_AND_OFFLINE.md` §6 for the deferred design |
| Spectator/TV scoreboard displays | Read-only display mode deferred (OPEN_QUESTIONS Q11) |
| Timeout tracking, referee fault codes, line-call logging | Not requested; adds UI friction for recreational play (Q10) |
| Cloud sync, multi-facility, remote access over the internet | Contradicts offline-first, local-only requirement |
| Native mobile apps | Browser delivery covers all listed device types |
| External rating integrations (e.g. DUPR) | Requires internet and third-party agreements |
| Localization (non-English UI) | Strings are centralized to make it possible later (Q18) |

## 5. System boundaries and context

```
                    ┌──────────────────────── Facility LAN (no internet required) ───────────────────────┐
                    │                                                                                     │
                    │  MASTER PC (Windows 11, wired, fixed IP, UPS)                                       │
                    │  ┌────────────────────────────────────────────────────────────┐                     │
                    │  │  Pickle Scoring Service (Node.js, runs as an OS service)   │                     │
                    │  │   • HTTP server: serves the one web app                    │                     │
                    │  │   • REST API  /api/v1/*   • Socket.IO real-time channel    │                     │
                    │  │   • Scoring engine (authoritative)                         │                     │
                    │  │   • Scheduler (backups, auto-confirm, cleanup)             │                     │
                    │  │   • SQLite database file (only this process opens it)      │                     │
                    │  └────────────────────────────────────────────────────────────┘                     │
                    │       ▲                ▲                 ▲                   ▲                      │
                    │       │ browser        │ Wi-Fi           │ Wi-Fi             │ Wi-Fi                │
  Admin / Staff ───►│  Master PC or     ┌────┴─────┐     ┌─────┴────┐         ┌────┴─────┐                  │
  (login)           │  staff PCs        │ "Court 1"│     │ "Court 2"│   …     │ "Court N"│                  │
                    │                   │ phone or │     │ phone or │         │ phone or │                  │
  Referee (Staff)──►│                   │ tablet   │     │ tablet   │         │ tablet   │                  │
  (login)           │                   └──────────┘     └──────────┘         └──────────┘                  │
                    │   All devices open the same URL and sign in; a court device is a session assigned   │
                    │   to its court.                                                                     │
                    └─────────────────────────────────────────────────────────────────────────────────────┘
```

**Inside the system boundary:** the Master service, its SQLite database and backup files, and the web app.

**Outside the boundary (environment the system depends on but does not manage):** the facility router/Wi-Fi access points, the Master PC operating system, court device hardware/OS/browser, power supply (UPS recommended).

**No external integrations** in Release 1.0. The service makes **zero outbound internet requests** at runtime (no CDNs, web fonts, telemetry, update checks or licence checks).

## 6. Main components

| Component | Runs on | Responsibility |
|-----------|---------|---------------|
| **Master service** (`apps/server`) | Master PC | Single source of truth. Owns SQLite. Validates and applies every command. Broadcasts state. Runs scheduled jobs. Serves the web app. |
| **Web app** (`apps/web`) | Any browser on the LAN: the Master PC, staff PCs, and each court's phone/tablet | One login-protected SPA. Navigation and controls depend on the user's role (Admin or Staff). The **Court page** has a workspace layout and a full-screen scoring console layout; a device assigned to "Court N" opens straight to its console. |
| **Shared package** (`packages/shared`) | Compiled into both | Types, validation schemas, the pure scoring engine, permissions, constants. |

## 7. Key architectural decisions (summary)

Full justification is in `SYSTEM_ARCHITECTURE.md`.

1. **One Node.js process on the Master PC is the only thing that touches SQLite.** Court devices never access the database; they call the API.
2. **The server is authoritative.** Court devices send *commands* ("Team A won the rally"); the server applies pickleball rules and returns/broadcasts the resulting *state*. Devices never compute the official score.
3. **Event-sourced scoring.** Every scoring action is stored as an immutable event. Current state is derived from events, which makes undo, audit and correction safe.
4. **REST for commands, Socket.IO for pushing state.** One mutation path (HTTP, easy to test and retry idempotently), one live update path.
5. **Idempotent, versioned commands.** Each command carries a client-generated `commandId` and the `expectedVersion` of the match; duplicates are ignored and stale commands are rejected.
6. **Plain browser delivery, no Electron/Tauri.** The Master runs as an OS background service so courts keep working even if someone closes the browser window. On Windows 11 it is a Windows service (WinSW) that starts at boot.
7. **Two roles, enforced on the server, one login for everything.** Admin and Staff, from one permission table (`FUNCTIONAL_REQUIREMENTS.md` §1.1): both *see* the same five areas, Staff *change* only Court Management. There are no device tokens or pairing: a court's phone/tablet is a normal signed-in session assigned to "Court N". Every action is attributed to a named person. Players never operate matches.
8. **Match type per match, rules per match.** Singles/Doubles is chosen when a match is created; scoring rules come from a preset and may be customized for that one match; both are snapshotted on the match.
9. **Early termination is deliberate and never invents a winner.** `END_MATCH` needs a ~2 s press-and-hold plus a confirmation; the match becomes "Ended early" with scores preserved.
10. **No offline scoring queue in 1.0.** When a court device cannot reach the Master, scoring is locked with a clear message; the score is reconciled on reconnect with "Adjust score". This is honest and conflict-free (see `DEPLOYMENT_AND_OFFLINE.md`).

## 8. User roles

Exactly two user roles, plus one non-user actor (System). The full permission matrix (with permission keys) is `FUNCTIONAL_REQUIREMENTS.md` §1.1.

| Role / actor | Authentication | Summary of access |
|--------------|---------------|-------------------|
| **Admin** | Username + password, any device | Everything. Manages bookings, courts (count, activate), Staff/Admin accounts (unlimited Staff), the player directory, rule presets, settings, audit log, backup/restore, result corrections and CSV exports; plus everything Staff can do. Created at first-run setup. |
| **Staff** (facility personnel and referees) | Username + password, any device | **Sees** the Dashboard, Booking Schedule, Court Management, Game Histories and Players. **Operates courts**: create/start/score/pause/undo/adjust/complete/end matches, edit the players and game details of a match, set a court's status (maintenance, release) and use a phone/tablet as "Court N". **Cannot** change bookings, court setup, the player directory, presets, users, settings, backups, finished results, or export data. |
| **System** | Internal | Scheduled jobs (auto-confirm finished matches, backups, cleanup); appears as actor `system` in logs. |

There is no Supervisor, Referee, Player or device account type; "referee" is a job performed by Staff (or an Admin), and a court's phone/tablet is simply a device a Staff member is signed in on.

## 9. Glossary

| Term | Meaning in this system |
|------|-----------------------|
| **Match** | One contest between Team A and Team B on one court, consisting of one or more games. |
| **Game** | A single race to N points (e.g. 11, win by 2). The brief calls these "sets"; pickleball rules call them "games". The system uses **game** everywhere (Q1). |
| **Rally** | One exchange of shots ending in a fault. The court scorer records only *who won the rally*. |
| **Side-out scoring** | Traditional scoring: only the serving side can score. |
| **Rally scoring** | Alternative format: the winner of every rally scores. |
| **Side out** | Serve passes to the other team. |
| **Server number** | In doubles side-out scoring, "1" or "2": which partner is serving in the current service turn. |
| **Score call** | The spoken score, e.g. `4-2-1` (serving score, receiving score, server number). |
| **Match type** | Singles (1 v 1) or Doubles (2 v 2), chosen for each match when it is created. |
| **Preset / rules** | A named, reusable set of scoring rules (points to win, win-by, games, scoring type, serving mode…). Independent of the match type; copied onto each match and optionally customized for it. |
| **End match / Ended early** | Deliberate early termination by staff (press-and-hold + confirmation). Status `terminated`; scores kept; no winner. |
| **Staff / Admin** | The two user roles. Both sign in with a username and password on any device. |
| **Court N / court device** | The phone or tablet at a court. It is named after its court; technically a signed-in session assigned to that court (`user_sessions.terminal_court_id`). |
| **Booking** | A reservation of one court for a time range, entered by the Admin in the Booking Schedule. Never blocks play. |
| **Typed name** | A player name entered by hand in a match (not selected from the directory). Listed on the Players page, grouped by the name as typed. |
| **Command** | A request from a client to change match state (e.g. `RALLY_WON`). |
| **Event** | A persisted, accepted command in `match_events`; the audit trail and source of truth for scoring. |
| **Snapshot** | The full current state of a court and its match, pushed to clients. |
| **Version** | Integer on each match, incremented on every accepted command; used for optimistic concurrency. |
| **Master / Master PC** | The single computer hosting the service and database. |

## 10. Assumptions this plan relies on

Each is also tracked in `OPEN_QUESTIONS.md` with the default shown here.

- A1. One facility, one Master PC, up to **24 courts**, unlimited Staff accounts and **100 simultaneously connected browsers**. **Court count owner-confirmed (R7).**
- A2. The Master PC is a **Windows 11** desktop or laptop (x64, Q31) on **wired Ethernet** behind a **UPS**; it stays powered on during opening hours. **Owner-confirmed.**
- A3. Each court's phone/tablet is on a **staff-only Wi-Fi** on the same LAN as the Master PC, which has a **fixed local IP**. **Owner-confirmed.**
- A4. Recreational play is the main use; the default format is **doubles, side-out scoring, one game to 11, win by 2** (Q2).
- A5. Player names are **optional** with default labels; a player directory exists for facilities that want stats; typed names never become directory records. **Owner-confirmed.**
- A6. Matches are created and run by signed-in staff on any device — the court's phone/tablet or any other PC. Players never start or control matches. **Owner-confirmed.**
- A10. Staff can see all five areas and change only Court Management; Booking Schedule changes are Admin-only (Revision 3 reading of the owner's statement — Q34 asks to confirm Staff view access to bookings).
- A7. English-only UI in Release 1.0 (Q18).
- A8. The facility's local time zone equals the Master PC's OS time zone.
- A9. Up to **24 active courts**; court count is configured by the Admin. **Owner-confirmed.**

## 11. Revision history

| Rev | Change |
|-----|--------|
| 1 | Initial planning set. |
| 2 | Owner decisions incorporated: Singles/Doubles per match; configurable per-match rules; staff-operated scoring; optional names with default labels and no auto-registration; early-end by press-and-hold + confirmation (no winner declared); up to 24 configurable courts; Windows 11 Master PC, wired, UPS, fixed IP, staff-only Wi-Fi; two roles (Admin/Owner, Staff) with a documented permission matrix. Renames: `administrators` → `users`, `/admin` → `/master`, `END_EARLY`+`TERMINATE` → `END_MATCH`. Five validation items answered with recommended defaults (Q3, Q25–Q28). |
| 3 | Owner revisions: every court has a phone/tablet called "Court N"; **one login-based app for every device** (no pairing, no device tokens, no separate court interface, `/master` and `/court` removed); Staff and Admin see the same Dashboard, Booking Schedule, Court Management, Game Histories and Players, Staff change only Court Management; **Booking Schedule added**; Players page lists all names with histories; Admin creates unlimited Staff. Tables: `court_devices` removed, `bookings` added, `user_sessions.terminal_court_id`, `matches.booking_id`. Settings removed: `staffCanViewReports`, `staffHistoryDays`, `allowDeviceMatchCreation`, `consoleAccess` (replaced by `adminLoginMasterPcOnly`). |
