# Implementation Readiness Report (Planning Gate, Revision 3)

> Purpose: confirm the twelve planning documents are consistent with the owner's confirmed decisions (Revision 2 and the Revision 3 changes) and with each other, and state what remains open before Claude Sonnet 5.5 starts building.
> Scope of this review: documents only. **No application code was written.** The verification programs mentioned below were run from a temporary scratch folder outside the project and are not part of the repository.

## 1. Verdict

**Ready to start implementation (Phases 0–5 can begin immediately).**
Revision 3 changes the shape of the system (one login-based app for every device, a new Booking Schedule module, a different Staff scope), and every document was revised to match. The decisions that still need the owner's confirmation all have defaults that the documents already assume, and none blocks Phases 0–5. Two should be answered before specific later phases: **Q32** (can Staff run any court?) before Phase 7, and **Q34** (can Staff see the Booking Schedule?) before Phase 9.

## 2. Revision 3 decisions → where they are implemented

| Owner statement | Implemented in |
|---|---|
| Each court has a phone or tablet; call each device "Court 1", "Court 2", … | `user_sessions.terminal_court_id` (DATABASE §3.2); FR-TERM-02; device named after its court everywhere (UI §1 principle 8, §3.2); API `PUT /session/terminal` |
| "Change the logic of the Master PC and other device": the Master PC is only the host; every device runs the same app | FR §0; SYSTEM_ARCH §3.7 (one SPA, one route tree), §6.2 (one kind of socket client), §6.5; DEPLOYMENT §1, §7; PROJECT_OVERVIEW §5–§6; **removed:** pairing, `court_devices`, device tokens, `/master` + `/court`, `consoleAccess` |
| Admins and Staff log in with the same dashboards and features | FR §1.1 matrix (Staff hold every `*.view` key); UI §3.1 nav table; Dashboard identical for both roles (FR-DASH, API §3.8) |
| Staff manage only Court Management: scoring, players, game details, status — not the overall game, not the booking schedule | Staff column of the matrix: `matches.create/operate/end`, `courts.maintenance/release/terminal`, `formats.select`; Admin-only: `bookings.manage`, `courts.manage`, `players.manage`, `matches.correct/export`, `reports.csv`, `users.manage`, `settings.manage`, `audit.view`, `backups.manage`, `formats.manage` |
| Feature: **Dashboards** | FR-DASH-01..07 (Live + Analytics tabs), FR-REPORT-01..08 |
| Feature: **Booking Schedule / reservation** | FR-BOOK-01..13; `bookings` table + overlap triggers (DATABASE §3.4); API §3.4; UI §4.3; roadmap Phases 6 and 9 |
| Feature: **Court Management** | FR-COURT-01..11, FR-TERM-01..10; UI §4.4 + §5 (console); roadmap Phases 4, 7, 8 |
| Feature: **Game Histories** | FR-HIST-01..06 (identical for both roles, no window); UI §4.5 |
| Feature: **Players** — all player names and player histories | FR-PLAYER-08/09 (Registered + Typed names), DATABASE §5a query, API `GET /players`, `GET /players/:key`; UI §4.6 |
| Feature: **Login / Logout of Admin and Staff** | FR-AUTH-01..13; API §3.2 |
| Admin creates Staff, **no limit** | FR-AUTH-08; `users` has no count constraint (tested with 201 staff rows); API `GET /users` search + pagination; NFR-CAP-02/06; UI §4.8 |
| Revision 2 decisions (match type per match, per-match rules, optional names, `END_MATCH` hold + confirmation with no winner, ≤ 24 courts, Windows 11, fixed IP, LAN-only, reconnection restores court and match) | Unchanged in substance; see the requirement IDs in the documents. Reconnection now works through the server-side session assignment (SYSTEM_ARCH §6.2, API §6.4, FR-TERM-03) |

### Interpretations I made (please confirm — all listed in OPEN_QUESTIONS)

1. **"Same dashboards and features" = the same areas are visible to both roles; "Staff only manage Court Management" = Staff can change only that area.** So Staff see bookings, histories, players and analytics read-only. (Reverses Revision 2's "Staff cannot see reports; 7-day history window".) → R14, Q34.
2. **Staff can operate any court**, not only a specific one; a court's device simply opens on its court. → Q32.
3. **The Players page lists typed names too** (grouped by name as typed, labelled "Typed name"); only the Admin can add one to the directory, so "typed names never auto-register" still holds. → Q35.
4. **Reservations warn but never block play.** → Q33.
5. **Every action is attributed to a named person** (no anonymous device). A shared login on a tablet is possible but discouraged; this resolves Revision 2's Q29 (no PIN needed).

## 3. What changed (and what stayed)

**Preserved:** all twelve documents, the server-authoritative event-sourced design, Socket.IO + REST split, SQLite only on the Master, idempotent versioned commands, scoring rules and engine specification, offline behaviour, backup/restore design, Windows 11 deployment.

**Removed / replaced (searched across all documents for leftovers):**

| Before (Revision 2) | After (Revision 3) |
|---|---|
| Court devices paired by an Admin; device token; `court_devices` table; `/device/*` endpoints; `FR-DEV-*` | A court device is a signed-in session assigned to "Court N": `user_sessions.terminal_court_id` (unique per court); `PUT/DELETE /session/terminal`; `FR-TERM-*` |
| Two UIs: `/master` (login) and `/court` (no login) | One SPA, one login, routes `/dashboard`, `/bookings`, `/courts/:id`, `/history`, `/players`, `/admin/*`; Court page with workspace and console layouts |
| Actors: user, device, system | Actors: user, system (+ the court context `actor_court_id`) |
| Staff: operate courts, last 7 days of history, no reports unless enabled | Staff: see everything, change only Court Management |
| Settings `staffCanViewReports`, `staffHistoryDays`, `allowDeviceMatchCreation`, `consoleAccess` | removed; `adminLoginMasterPcOnly`, `terminalSessionDays`, `booking*` settings added |
| Error codes `DEVICE_*`, `FORBIDDEN_COURT`, `HISTORY_WINDOW`, `CONSOLE_LOCAL_ONLY`, `COURT_HAS_SCORER` | `COURT_HAS_DEVICE`, `BOOKING_CONFLICT`, `BOOKING_WARNING`, `BOOKING_INVALID`, `FUTURE_BOOKINGS_EXIST`, `PASSWORD_CHANGE_REQUIRED`, `ADMIN_LOGIN_RESTRICTED` |
| Socket rooms `console`, `device:<id>` | `user:`, `session:`, `role:`, `facility`, `court:<id>`, `courts:all` + client `subscribe` |
| Roadmap Phases 0–12 (≈ 45 d) | Phases 0–14 (≈ 58 d): added Booking backend (6) and UI (9), merged the court UI into the Court page (7), Players page work in Phase 10 |
| Bookings out of scope | Basic Booking Schedule in scope (payments, recurring, self-service still out) |

**Added:** `bookings` with DB-enforced no-overlap; `matches.booking_id` and the `BOOKING_WARNING` handshake; booking chips on courts; Players page (registered + typed names) with histories; `must_change_password`; searchable paginated Users list; new-device flow ("Use this device for Court N", "Continue as Court N"); optional `adminLoginMasterPcOnly`; NFR-SEC-17/18 for passwords typed over plain HTTP; risks K21–K24.

## 4. Validation results

### 4.1 Cross-document consistency — passed
- Terminology sweep for 25+ stale terms (pairing, device tokens, `court_devices`, `/master`, `/court`, the four removed settings, removed error codes, `FR-DEV`, device actors): only intentional historical mentions remain (revision tables and "replaces the former…" notes).
- Reference check across all twelve files: **123 functional requirement IDs and 71 non-functional IDs defined; every cited ID resolves** (ranges such as `FR-COURT-01..04` expanded); every question ID cited exists (Q4/Q5/Q7/Q8/Q23 appear only as "earlier question, now resolved"); **0 broken document-qualified `§` references**.
- **26 permission keys** in the matrix; every key used in the API, architecture, roadmap and UI documents exists in the matrix, and every matrix key is used by at least one endpoint.
- The document map and roadmap phase numbers were updated (Phase 11→13 packaging, Phase 12→14 hardening) in every document that cites them.

### 4.2 Database relationships — passed (executed)
The affected tables (`users`, `user_sessions`, `courts`, `bookings`, `players`, `match_formats`, `matches`, `match_players`, `match_games`, `match_events`) were created in SQLite from the documented DDL and **70 checks** were run, all passing, including:
- everything from Revision 2 (one active match per court, `terminated` has no winner but a reason and timestamp, `completed` has a winner, side-out needs serving, unique court identifiers, name snapshots survive directory edits and deletion, idempotency/ordering indexes, retired event type and third role rejected);
- **bookings:** overlapping, contained and enclosing bookings are rejected by the triggers; adjacent bookings (18:00–19:00 then 19:00–20:00) are accepted; the same time on another court is accepted; cancelled bookings do not block, and re-confirming one onto an occupied slot is rejected; moving a booking onto another (UPDATE trigger) is rejected; end-before-start and an empty "booked by" are rejected; a court with bookings cannot be deleted; linking a match leaves the booking unchanged;
- **court devices:** a second device assigned to the same court is rejected; unlimited unassigned sessions are accepted; the "replace" flow (clear old, set new) works in one transaction; signing a device out frees the court;
- **actors:** user events require a user, system events carry none and no court context, the former `device` actor type is rejected, and a match cannot be created without a creating user;
- **unlimited Staff:** 201 staff accounts inserted without any constraint;
- **Players page:** the union query lists registered players (including one with zero matches) and typed names grouped case-insensitively (`jordan` and `JORDAN` become one row) and never lists blank/default-label slots.

Not executable at the database level (enforced and tested in application code, as documented): the 24-active-court limit, last-active-admin protection, singles-vs-doubles slot counts, rule validation, and the booking business limits (operating hours, maximum length, advance window).

### 4.3 Match-scoring workflows — passed (executable model of the written rules)
Revision 3 does not change the scoring rules, so the Revision 2 model was re-run as a regression and still passes completely: the worked example (score calls and servers), the 0-0-2 start and first-fault side-out, the `both_servers` variant, singles, win-by-2/win-by-1/point cap, best-of-3 with a different deciding-game target, rally scoring, serving off, `END_MATCH` (no winner, abandoned game keeps its score, rejected from `match_over`), undo as replay, and the property checks over thousands of random matches. This validates the **specification**; the real engine and its test catalogue (MATCH_SCORING_LOGIC §12) are still to be built.
What did change in the scoring documents: only who may issue commands (any signed-in Staff/Admin, no per-court restriction) and attribution (user + court).

### 4.4 Admin/Staff permission model — passed by review, to be proven by test
One table (FR §1.1) drives the API, UI navigation and the roadmap's route-table test (extended every phase, complete in Phase 14). Boundaries checked: Staff can *view* all five areas but cannot change bookings, court configuration, the player directory, rule presets, users, settings, backups, the audit log, exports or finished results; the only role-shaped payloads are the Admin-only alert list and Admin-only device IP/browser; role changes revoke sessions and sockets within 2 s; the last active Admin is protected; a court assignment grants no authority.
**New exposure to note:** passwords are now typed on phones and tablets over plain HTTP. Mitigations are specified and mandatory in the install guide (NFR-SEC-17): staff-only WPA2/WPA3 SSID, login lockout, forced password change for new accounts, optional Admin-login restriction to the Master PC, optional HTTPS with a local CA (recommended if Admins sign in on tablets).

### 4.5 24-court scalability — passed by analysis
≈ 1–2 scoring commands/s at peak versus a designed 10 cmd/s; ≈ 35 sockets versus 100 designed (24 court devices + other browsers); < 4 KB snapshots with ≈ 6–11 messages per command, and a court device receives only its own court plus low-rate facility events; one indexed query per Booking Schedule day/week; unlimited Staff accounts add rows, not load; < 50 MB database growth per year. Races R19–R21 added (concurrent overlapping bookings, booking changes during a match, shared tablets). **To be measured** in Phase 14 (simulator, NFR-PERF/CAP-01/02/05/06).

### 4.6 Windows 11 deployment — passed by design review, to be proven on a clean VM
Unchanged in substance (WinSW service, graceful stop, power plan, BIOS/UPS/Update hardening, fixed IP, subnet-scoped firewall rule independent of the Windows network profile). Revision 3 simplified it: no pairing step, one URL for every device, the QR code simply opens the app. Commands were written from standard Windows 11 PowerShell/`powercfg` usage and are to be executed and verified in roadmap Phase 13 on a real Windows 11 machine — they could not be run on this Mac.

### 4.7 LAN-only communication and offline behaviour — passed by review
No outbound requests by design; internet loss has no effect; local-network and Master loss are handled by the 9-row scenario playbook, now covering sign-in and bookings (which live on the Master). **Reconnection restores the correct court and match:** the court assignment is stored on the server-side session and derived from the session cookie, never from client-supplied state; a refresh, reboot, Wi-Fi drop or Master restart returns the device to the same court and live snapshot; if the session expired, one tap on "Continue as Court N" after sign-in restores it. Exactly-once command application via `commandId`; `END_MATCH` is never auto-retried; scoring is locked while disconnected (offline queue deferred).

## 5. Remaining unresolved decisions

None blocks Phases 0–5. Defaults are already built into the documents.

| # | Decision | Needed before | Default assumed |
|---|---|---|---|
| Q32 | May Staff run any court, or only assigned courts? | Phase 7 | Any court (the device opens on its own court) |
| Q34 | May Staff see the Booking Schedule? | Phase 9 | Yes, view-only |
| Q33 | Booking scope: Admin-only entry; no recurring/closures/payments/self-service; required fields; 30-min slots, ≤ 4 h, ≤ 90 days; warn-never-block | Phase 6 | As listed |
| Q35 | Players page shows typed names grouped by the name as typed; Admin-only *Add to directory* | Phase 10 | Yes |
| Q36 | Staff forgot password: Admin resets; no self-service | Phase 3 | Admin reset only |
| Q9 | Admin sign-in from tablets/other PCs or Master PC only; HTTPS | Phase 3 | Anywhere on the staff network; `adminLoginMasterPcOnly` available; HTTPS recommended for tablet Admin sign-in |
| Q30 | May Staff correct a *finished* match? | Phase 5 | No (Admin only) |
| Q31 | Windows x64 vs ARM; code-signed installer; UPS; backup target | Phase 13 | x64; unsigned; USB-connected UPS; USB drive |
| Q25–Q27 | Match length, scoring method, serving management | Before Phase 5 ships (config only) | 1 game to 11 default + best-of-3 preset; side-out default with rally available; automatic serving with manual override |
| Q3, Q28, Q29 | *(Answered by Revision 3)* creation from any device; Staff see all areas; no tablet PIN needed | — | — |
| Q2, Q6, Q10, Q12–Q14, Q16, Q22 | Seed presets, time limits, timeouts, rally variants, serve rotation default, operating hours, backup destinations, stale alerts | Phase 5–11 | See OPEN_QUESTIONS Part 4 |
| Q1, Q11, Q15, Q17–Q19, Q21, Q24 | Wording, spectator screens, retention, theme, naming, rankings, branding | Polish | Defaults listed |

## 6. Residual risks (full table in IMPLEMENTATION_ROADMAP §4)

Top five: (1) Wi-Fi coverage at courts; (2) Master PC power/Windows Update restarts; (3) passwords typed on phones/tablets over plain HTTP (K21) and shared logins defeating attribution (K16) — mitigated by the staff-only SSID, lockout, forced password change, unlimited per-person accounts and optional HTTPS; (4) booking time/overlap bugs around DST and midnight (K22) — pure shared helpers with boundary tests and DB triggers as a backstop; (5) wrong hold duration for End match — default 2 s, configurable, tuned in usability testing.

## 7. Assumptions in this review (stated, not hidden)
- The hold duration of 2 s, the booking limits (30-min slots, 4 h, 90 days), the six preset names and the default-label wording ("Player 1 and Player 2" under each doubles team, as the owner specified; exports prefix the team) are starting values.
- Windows commands and the installer behaviour have not been executed yet.
- Performance and capacity figures are estimates until the Phase 14 simulator runs.
- The roadmap estimate (≈ 58 days for one experienced developer) grew by ≈ 13 days with Revision 3, mostly the Booking Schedule (≈ 7 d) and the Players page and Users scale work.

## 8. Go / no-go checklist for the implementer

- [x] Owner decisions (Revision 2 and 3) incorporated and traceable (§2)
- [x] Documents mutually consistent; references resolve (§4.1)
- [x] Schema constraints executed and passing — 70/70 (§4.2)
- [x] Scoring rules validated against an executable model (§4.3)
- [x] Permission matrix single-sourced; test strategy defined (§4.4)
- [x] 24-court and Windows 11 approaches reviewed (§4.5–4.6)
- [ ] Owner to acknowledge the interpretations in §2 and the defaults for Q25–Q27, and answer Q32–Q36, Q9, Q30, Q31 (non-blocking for Phases 0–5)
