# Functional Requirements

> Revision 3 — one login-based application for every device (Master PC, phones, tablets). Court devices are simply "Court 1", "Court 2", …; there is no pairing. Staff and Admin see the same five areas; Staff can change things only in Court Management. A Booking Schedule module is added.
> Requirement IDs (`FR-<AREA>-<NN>`) are referenced by the roadmap and tests. "MUST" = required for Release 1.0; "SHOULD" = include if it does not delay the release; "MAY" = optional.
> Defaults that depend on unconfirmed business decisions are marked **(Q#)** and listed in `OPEN_QUESTIONS.md`.

## 0. The product in one paragraph

The system is **one web application** served by the Master PC and opened in a browser on any device on the facility LAN. Everybody signs in with a username and password. There are exactly two roles, **Admin** and **Staff**. Both see the same five areas:

| Area | Admin | Staff |
|------|-------|-------|
| **Dashboard** (live overview + analytics) | view | view |
| **Booking Schedule** (court reservations) | view and manage | view only |
| **Court Management** (live courts, scoring, players on the court, game details, court status) | full | **operate** (the only area Staff can change) |
| **Game Histories** | view, correct, export | view |
| **Players** (all player names and their histories) | view and manage the directory | view |
| **Login / Logout** | ✔ | ✔ |

Admins additionally have an **Administration** area (Users, Settings, Rule presets, Audit log, Backups). The Admin creates Staff accounts; there is **no limit on the number of Staff**.

The **Master PC** is only the computer that hosts the server and database. It is not a different product from the tablets: the same app, with the same login, runs on it and on every phone or tablet. Each court has one phone or tablet; after signing in on it, the user chooses **"Use this device for Court N"** and from then on that device is called **Court N** everywhere (dashboard, audit log) and opens straight to that court.

## 1. User roles and permission matrix

Exactly **two user roles** exist (no Supervisor, Referee, Player or device accounts):

| Role | Who | Signs in with |
|------|-----|---------------|
| **Admin** | Facility owner/manager. Full access. | Username + password, on any device (Q9) |
| **Staff** | Facility personnel and referees. Operates courts. | Username + password, on any device |

Plus one non-user actor: **System** — scheduled jobs (auto-confirm, backups, cleanup, automatic court release).

**Principles**
- Players never start, score or end matches and have no accounts. Staff/referees do.
- Every action is attributed to a **named user** (and, when taken on a court device, the court: "Maria on Court 3"). There are no anonymous device actions.
- The permission model is enforced **on the server** for every REST call and socket join; the UI only hides what a role cannot use. Permission keys are the exact constants in `packages/shared/permissions` (`can(actor, key)`).
- Staff may *see* every area, but may *change* only what Court Management covers: **scoring, the players/names on a match, game details (type, rules, status) and court status.** They cannot change bookings, courts' configuration, the player directory, accounts, settings or finished results.

### 1.1 Permission matrix

✔ allowed · ✖ not allowed · "view" = read-only.

| Capability | Permission key | Admin | Staff |
|------------|---------------|:---:|:---:|
| Log in / out, change own password | `auth.self` | ✔ | ✔ |
| Create Staff/Admin accounts, edit, deactivate, reset passwords, change roles (no limit on count) | `users.manage` | ✔ | ✖ |
| View Dashboard: KPI tiles, live court grid, alerts, activity, analytics tab | `dashboard.view` | ✔ | ✔ |
| View court list, statuses, live scores, court-device online state | `courts.view` | ✔ | ✔ |
| Add/edit/reorder courts, change court count, activate/deactivate, sign a court device out | `courts.manage` | ✔ | ✖ |
| Court maintenance on/off (court status) | `courts.maintenance` | ✔ | ✔ |
| Release a finished court ("Done") | `courts.release` | ✔ | ✔ |
| Use this device as "Court N"; change or stop it | `courts.terminal` | ✔ | ✔ |
| View Booking Schedule (all views, search) | `bookings.view` | ✔ | ✔ |
| Create, edit, move, cancel bookings; mark no-show | `bookings.manage` | ✔ | ✖ |
| Create a match (Singles/Doubles, court, rules, names, optional booking link) | `matches.create` | ✔ any court | ✔ any court |
| Operate a match: start, score, undo, adjust score, pause/resume, next game, swap sides, edit names/team names, confirm result, edit type/rules while in setup, cancel before start | `matches.operate` | ✔ | ✔ |
| End a match early (press-and-hold + confirmation) | `matches.end` | ✔ | ✔ |
| Correct the result of a completed/ended-early match | `matches.correct` | ✔ | ✖ |
| View live matches | `matches.viewLive` | ✔ | ✔ |
| View Game Histories and match timelines | `matches.history` | ✔ | ✔ |
| Export Game Histories / bookings to CSV | `matches.export` | ✔ | ✖ |
| View Players page: all names, per-player history and stats; search players when entering names | `players.view` | ✔ | ✔ |
| Create/edit/deactivate directory players; add a typed name to the directory; link past typed names | `players.manage` | ✔ | ✖ |
| Select a rule preset | `formats.select` | ✔ | ✔ |
| Create/edit/deactivate rule presets | `formats.manage` | ✔ | ✖ |
| View analytics reports and print them | `reports.view` | ✔ | ✔ |
| Export reports to CSV | `reports.csv` | ✔ | ✖ |
| System settings, facility info, connection URL/QR | `settings.manage` | ✔ | ✖ |
| View audit log | `audit.view` | ✔ | ✖ |
| Create/download/delete backups, restore database | `backups.manage` | ✔ | ✖ |

Notes:
- This replaces Revision 2's "Staff cannot see reports" and "7-day history window" rules: the owner's Revision 3 decision is that Staff see **the same dashboards and features** and change only Court Management. (Resolves Q28; there is no `staffCanViewReports` or `staffHistoryDays` setting any more.)
- Staff never see the Administration area (Users, Settings, Rule presets management, Audit, Backups). Their sidebar does not show it and every corresponding endpoint returns `403 FORBIDDEN`.
- Staff **can** set a court to maintenance and release a finished court because "status" is part of their court management; they cannot add/remove/rename courts or change the court count.
- Staff cannot correct a finished result (`matches.correct`). Mid-match mistakes are fixed with Undo and Adjust score (Q30).
- Role changes and deactivation take effect immediately: the user's sessions are revoked and their sockets disconnected within 2 s (FR-AUTH-12). A court device whose user is signed out shows the sign-in screen; the match on that court is unaffected.

## 2. Authentication (FR-AUTH)

| ID | Requirement |
|----|------------|
| FR-AUTH-01 | MUST: On first start with no user in the database, the app shows a **First-run setup** screen to create the first **Admin** account (username, display name, password ×2). This endpoint MUST only accept requests from the Master PC itself (loopback address). |
| FR-AUTH-02 | MUST: **Login/Logout** — all users log in with username + password on the same login screen, from any device. Usernames are case-insensitive. The role determines navigation and API permissions. |
| FR-AUTH-03 | MUST: Passwords are stored only as salted `scrypt` hashes (NFR-SEC-01). Minimum length 8; no other composition rules. |
| FR-AUTH-04 | MUST: Successful login creates a server-side session; the browser receives an `HttpOnly`, `SameSite=Strict` cookie. Normal sessions expire after **8 h of inactivity** and **7 days absolute** (`sessionIdleMinutes`, `sessionMaxDays`). **Court-device sessions** (FR-TERM) have no idle timeout and expire after `terminalSessionDays` (default 30) so that a tablet stays signed in between shifts. |
| FR-AUTH-05 | MUST: Logout invalidates the session server-side immediately and returns the browser to the login screen. |
| FR-AUTH-06 | MUST: After 5 failed logins for a username within 15 minutes, that username is locked for 15 minutes. Failures are audit-logged. Error messages never reveal whether the username exists. |
| FR-AUTH-07 | MUST: Any user can change their own password (requires the current password). Changing it ends that user's other sessions. |
| FR-AUTH-08 | MUST: **Staff management (Admin only):** the Admin creates Staff (and additional Admin) accounts — username, display name, initial password, "must change password at first login" (default on) — edits display name, changes role, deactivates/reactivates, and resets passwords. **There is no limit on the number of Staff accounts** (the Users list is searchable and paginated). The system always keeps at least one active Admin. Users who appear in history are deactivated, never deleted. |
| FR-AUTH-09 | MUST: There are **no player logins and no device/pairing tokens.** Every request is made by a signed-in user. |
| FR-AUTH-10 | SHOULD: Setting `adminLoginMasterPcOnly` (default **off**) makes Admin logins accepted only from the Master PC, for owners who do not want admin credentials typed on tablets (Q9). Staff logins are unaffected. |
| FR-AUTH-11 | MUST: Recovery when every Admin password is lost: documented CLI command run on the Master PC (`pickle-scoring reset-admin-password`) — no email/online recovery. |
| FR-AUTH-12 | MUST: When a user is deactivated, has their role changed, or has their password reset, all their sessions are revoked and their live sockets disconnected within 2 s. |
| FR-AUTH-13 | MUST: Authorization is checked on the server per request against the permission matrix (§1.1). A request lacking permission returns `403 FORBIDDEN`; an unauthenticated one `401 UNAUTHENTICATED`. |

**Acceptance criteria**
- Given no users exist, when the app is opened on the Master PC, then setup is shown; from another LAN device the API returns `403 SETUP_LOCAL_ONLY` and the screen says "Complete setup on the Master PC".
- Given a Staff login, the sidebar shows Dashboard, Booking Schedule, Court Management, Game Histories and Players (all read-only except Court Management) and the profile menu; direct URL access to `/admin/users` redirects to the dashboard and `GET /api/v1/users` returns `403`.
- Given an Admin who creates 40 Staff accounts, all can sign in and the Users list pages and searches correctly; no error or limit appears.
- Given 5 bad passwords, the 6th attempt (even with the correct password) returns `423 ACCOUNT_LOCKED` until 15 minutes pass.
- Given a Staff user deactivated while signed in on a court phone, that phone's next request returns `401`, its socket closes within 2 s and it shows the sign-in screen; the match on that court is unchanged.

## 3. Dashboard (FR-DASH)

The Dashboard is **identical for Admin and Staff** and has two tabs: **Live** (default) and **Analytics**.

| ID | Requirement |
|----|------------|
| FR-DASH-01 | MUST (Live): KPI tiles for today (facility local day): **Total courts** (active), **Available courts**, **Active matches** (setup + in progress + paused), **Completed matches today**, **Total matches today** (all started today incl. ended early), **Bookings today** and **Next booking** (time + court). |
| FR-DASH-02 | MUST (Analytics tab): **Playing hours**, **Court utilization %**, **Average match duration**, peak-hours chart, matches per day — for a selectable range (Today default). Implemented by the reports in §10; same data and shared query code as the Reports tab. |
| FR-DASH-03 | MUST (Live): **Live court grid**: one card per active court in display order showing "Court N", derived status (§4.3), team names/players, current game score, games won, serving indicator, elapsed timer, **court device online/offline**, and a **booking chip** ("Reserved now – Maria 18:00–19:00" / "Next 19:00"). Updates in real time without reload. |
| FR-DASH-04 | MUST (Live): **Recent activity** feed (last 20): match started, game won, match completed, match ended early, court device signed in/out or connected/disconnected, court maintenance on/off, booking created/cancelled. |
| FR-DASH-05 | MUST (Live): **Alerts panel**: (a) court device offline while its court has an active match; (b) match exceeded its time limit; (c) stale match — no event for `staleMatchMinutes` (default 20); (d) match flagged `needs_review` after a restart; (e) a court's booking started more than 10 min ago and no match is running (informational). **Admin-only alerts:** last successful backup older than 26 h; backup copy to the extra path failed. |
| FR-DASH-06 | SHOULD: courts with a device online / total, courts in maintenance, longest running active match, matches per hour today, busiest court today. |
| FR-DASH-07 | MUST: Clicking a court card opens its Court Management page (FR-COURT-05). |

**Acceptance criteria**
- With 3 courts running matches, scoring a rally on Court 2 updates Court 2's card on every open dashboard within 1 s without affecting other cards.
- For the same moment, the dashboard KPI values equal the corresponding report values (shared query code).
- A Staff and an Admin user see exactly the same Dashboard content.

## 4. Court Management (FR-COURT)

### 4.1 Requirements

| ID | Requirement |
|----|------------|
| FR-COURT-01 | MUST (Admin): Register a court: name (unique, case-insensitive, ≤ 40 chars; default pattern "Court 1", "Court 2", …), short code (unique, ≤ 4 chars, used in match codes), optional description/location note, display order. Court identifiers are unique across active and inactive courts. |
| FR-COURT-02 | MUST (Admin): **Configure the number of courts.** A "Number of courts" control on the Court Management page shows the active count (0–24). Increasing it by *n* bulk-creates "Court k…" with the next free numbers and short codes; decreasing it asks which courts to deactivate (defaults to the highest-numbered idle ones) and refuses while any selected court has an active match. Individual add/deactivate remains available. |
| FR-COURT-03 | MUST (Admin): **Maximum 24 active courts** (`MAX_ACTIVE_COURTS`). Creating or reactivating a 25th active court returns `422 COURT_LIMIT_REACHED`. Inactive courts do not count. |
| FR-COURT-04 | MUST (Admin): Edit name, description, display order. `short_code` is editable only until the court's first match. |
| FR-COURT-05 | MUST: **Court page** (Admin and Staff) — the per-court management screen and scoring console: status, court-device panel (who is signed in, online state, last seen), live match panel with all match controls (FR-MATCH), the court's bookings for today (read-only for Staff), and today's matches on this court. On a phone/tablet used as the court device this is the screen the device opens to. |
| FR-COURT-06 | MUST (Admin): Activate/deactivate a court. A court with an active match cannot be deactivated. Deactivated courts are hidden from the dashboard grid, cannot receive matches or new bookings, and their device shows "Court not in service". Future confirmed bookings on the court are listed and the Admin chooses to keep or cancel them. **All historical matches and bookings of a deactivated court remain fully available** (shown with an "inactive" tag). A court with no matches or bookings MAY be deleted; one with any never. |
| FR-COURT-07 | MUST (Admin and Staff): Maintenance mode on/off with optional note — this is part of court *status*. A court in maintenance cannot start new matches; enabling it while a match is active requires the match to be ended first. The court device shows a full-screen "Under maintenance" notice. Future confirmed bookings are listed as a warning (not auto-cancelled). |
| FR-COURT-08 | MUST (Admin and Staff): Match controls on the Court page: create match (FR-MATCH-02), start, pause/resume, undo, adjust score, next game, swap sides, edit names, confirm result, **End match** (press-and-hold + confirmation), cancel before start. The controls are identical whether used on the court's own phone/tablet or from another device (e.g. the Master PC), and every action is attributed to the signed-in user. Using another device for a court is the fallback when its phone is broken or offline. |
| FR-COURT-09 | MUST: "Release court" — after a match completes or ends early, the court shows `completed` for `completedDisplayMinutes` (default 5) then automatically becomes `available`; staff can release it immediately with "Done" or by starting a new match. |
| FR-COURT-10 | MUST: Every court has its **own independent interface, match state, score and timer**; no data, query or socket event of one court is required to render another. |
| FR-COURT-11 | MUST: The Court Management list shows all active courts (as a grid on large screens, a list on phones) with status and live score; selecting a court opens its Court page. |

### 4.2 Court devices (FR-TERM) — replaces Revision 2 "pairing"

Each court has one phone or tablet. There is **no pairing, pairing code, approval step, device token or separate device name**: the device is identified by the signed-in session and the court it was assigned to.

| ID | Requirement |
|----|------------|
| FR-TERM-01 | MUST: A phone/tablet opens the app URL (`http://<master-ip>:8080`) and signs in like any other device (FR-AUTH-02). |
| FR-TERM-02 | MUST: After sign-in, any user (Admin or Staff) may choose **"Use this device for Court N"** from the profile menu or the first-run prompt (shown when the device is not yet assigned). The choice is stored on the **server-side session** (`user_sessions.terminal_court_id`). From then on the device is **named "Court N"** everywhere and the app opens directly on that court's page. |
| FR-TERM-03 | MUST: **Reconnection restores the correct court and match.** A refresh, browser restart, device reboot, Wi-Fi drop or Master restart returns the device to its court page via the session cookie, re-joins that court's socket room and renders the authoritative snapshot (exact screen incl. pause and interstitials). If the session has expired the device shows the sign-in screen and, after sign-in, returns to the same court (the last court is remembered in the browser as a hint and re-confirmed by the server). |
| FR-TERM-04 | MUST: Court-device sessions are long-lived (FR-AUTH-04) and survive shift changes: a different staff member can use "Switch user" (sign out + sign in) without losing the court assignment on the device (the assignment hint is kept in the browser and the user is offered "Continue as Court N"). |
| FR-TERM-05 | MUST: At most **one device is assigned to a court at a time**. Assigning a second device to Court N asks "Replace the current Court N device?" and, on confirmation, unassigns the old one (its session stays signed in and returns to the normal home page). Unassigned users and assigned devices can both see and operate any court if they navigate to it (Q32). |
| FR-TERM-06 | MUST: "Stop using this device for Court N" (profile menu) unassigns it. Audit-logged with who/when. |
| FR-TERM-07 | MUST: Admin and Staff see per court: device online/offline (heartbeat-based, offline detected within ≤ 15 s), the user signed in on it, last seen. Admin can additionally **sign the court's device out** (revokes that session; `courts.manage`). |
| FR-TERM-08 | MUST: Every action taken on a court device is attributed to the signed-in user and recorded with the court ("Maria — Court 3"). |
| FR-TERM-09 | SHOULD: Settings shows the app's fixed LAN URL and a **QR code** for quick setup of a new phone/tablet. |
| FR-TERM-10 | MAY (deferred): read-only scoreboard display mode for a spectator screen (Q11). |

**Acceptance criteria**
- Fresh tablet → open the URL → sign in → choose "Use this device for Court 3" → tablet shows "Court 3 — Available"; the dashboard card for Court 3 shows the device online.
- Refresh the tablet browser 10 times, or reboot it → it returns to Court 3 and shows the same in-progress match each time, without signing in again (session valid).
- A second tablet assigned to Court 3 prompts "Replace the current Court 3 device?"; after confirming, the first tablet shows the normal home page.
- A Staff user on the Court 3 tablet can open the Court 4 page and operate it (Q32 default), and the actions are recorded as that user on Court 4, not Court 3.

### 4.3 Court status model

Court status is **derived** (never stored) from court flags + the court's current match:

| Status | Rule (first match wins) | Colour token |
|--------|------------------------|-------------|
| `inactive` | `courts.is_active = 0` | `status-inactive` (grey) |
| `maintenance` | `courts.maintenance_mode = 1` | `status-maintenance` (rose) |
| `occupied` | active match with `status = setup` (match created, not started) | `status-occupied` (sky) |
| `in_progress` | active match `status = in_progress` | `status-live` (green-teal) |
| `paused` | active match `status = paused` | `status-paused` (amber) |
| `completed` | latest match completed/ended early less than `completedDisplayMinutes` ago and not released | `status-completed` (violet) |
| `available` | otherwise | `status-available` (green) |

Device connectivity (`online` / `offline` / `no device`) and the **booking chip** ("Reserved now" / "Next 19:00") are shown **alongside** the status, never instead of it. A court can be `in_progress` with its device `offline`, or `available` while reserved.

## 5. Booking Schedule (FR-BOOK) — new

The Booking Schedule is the facility's **court reservation calendar**. It is entered by the Admin on the LAN (walk-in/phone/desk bookings); there is no customer self-service, payment or online booking in 1.0. Staff can view everything.

| ID | Requirement |
|----|------------|
| FR-BOOK-01 | MUST (Admin): Create a booking: **court**, **date**, **start time**, **end time** (multiples of `bookingSlotMinutes`, default 30), **booked by** (name, required), optional phone, optional number of players, optional notes. Booking codes `B-YYMMDD-<seq>`. |
| FR-BOOK-02 | MUST: **No overlap.** Two `confirmed` bookings on the same court may not overlap in time (adjacent is fine: 18:00–19:00 then 19:00–20:00). Enforced by the server inside a transaction **and** by a database trigger; a conflict returns `409 BOOKING_CONFLICT` with the conflicting booking. Cancelled and no-show bookings do not block. |
| FR-BOOK-03 | MUST: A booking must be on an **active** court, inside that weekday's **operating hours**, no longer than `bookingMaxHours` (default 4), no more than `bookingAdvanceDays` (default 90) ahead, and must not start more than 15 minutes in the past. Violations return `422 BOOKING_INVALID` with the reason (`COURT_INACTIVE`, `OUTSIDE_HOURS`, `TOO_LONG`, `TOO_FAR_AHEAD`, `IN_PAST`). |
| FR-BOOK-04 | MUST: **Views** (Admin and Staff): **Day** — courts as columns × time as rows (on phones: one court at a time with a court picker); **Week** — one court across 7 days; **Agenda/List** — chronological, filterable by court, date range, status and a text search on booked-by/phone. Today / Previous / Next / date picker navigation. |
| FR-BOOK-05 | MUST (Admin): Edit (change court, time, details), cancel (optional reason) and mark **no-show**. Cancelled/no-show bookings stay visible in history views (greyed). Edits re-validate FR-BOOK-02/03. |
| FR-BOOK-06 | MUST: **Court deactivation / maintenance with future confirmed bookings** lists them and lets the Admin keep or cancel them; they are never silently cancelled. Bookings on an inactive court remain visible with a warning badge. |
| FR-BOOK-07 | MUST: **Link to matches.** When any user creates a match, the dialog offers the court's bookings that are current or start within `bookingWarnMinutes` (default 15), "No booking" being the default. Linking stores `matches.booking_id` and is the only thing Staff change about a booking (it does not edit the booking). The booking detail lists its linked matches. |
| FR-BOOK-08 | MUST: **Conflict warning, never a block.** Creating a match on a court that has someone else's confirmed booking starting within `bookingWarnMinutes`, or already running, shows a clear warning naming the booking; staff may continue (the override is recorded in the match's create event). The system never refuses play because of a reservation. |
| FR-BOOK-09 | MUST: Real-time: booking changes are pushed to all open clients so the schedule, dashboard chips and Court pages update within 1 s. |
| FR-BOOK-10 | MUST: Every booking action is audit-logged with the user; bookings are never deleted (cancel only). |
| FR-BOOK-11 | SHOULD (Admin): CSV export of bookings for a date range (`matches.export`). |
| FR-BOOK-12 | SHOULD: Print-friendly daily schedule page (browser print / PDF). |
| FR-BOOK-13 | OUT OF SCOPE for 1.0: recurring bookings, customer accounts, online/self-service booking, payments, reminders (SMS/email — no internet), holiday/closure calendars (Q33). |

**Acceptance criteria**
- Admin books Court 2, 18:00–19:00 for "Maria"; trying to book Court 2, 18:30–19:30 returns `409 BOOKING_CONFLICT`; booking 19:00–20:00 succeeds.
- A Staff user opening the Booking Schedule sees everything but has no create/edit/cancel controls; `POST /bookings` returns `403`.
- At 17:50 a Staff user creating a match on Court 2 sees "Court 2 is reserved by Maria from 18:00"; they can link the match to that booking, or continue without linking, or pick another court.
- Deactivating Court 2 with two future bookings lists them and requires the Admin to choose keep or cancel.

## 6. Players (FR-PLAYER)

**Principles:** names are optional, typing a name never creates a directory record, history keeps the names that were used — and the **Players page shows everybody who has played**, whether registered or typed.

| ID | Requirement |
|----|------------|
| FR-PLAYER-01 | MUST: Each match has exactly two teams, **A** and **B**. Each team has an optional team name (default "Team A"/"Team B") and 1 (singles) or 2 (doubles) player slots, according to the match type chosen at creation. |
| FR-PLAYER-02 | MUST: **Player names are never mandatory.** A match can be created and started with every name blank. Blank slots display default labels: **Singles** — Team A "Player 1", Team B "Player 2"; **Doubles** — each team "Player 1 and Player 2". (Shared function `defaultPlayerLabel`; DATABASE_SCHEMA §3.8.) There is no setting that makes names mandatory. |
| FR-PLAYER-03 | MUST: Staff (and Admin) can change any displayed name or team name at any time, before or during a match (`UPDATE_PLAYERS`); clearing a name restores the default label. |
| FR-PLAYER-04 | MUST: When entering a name, the UI offers autocomplete from active **directory** players after 2 typed characters. Selecting a suggestion links the slot to that player (`player_id`). A name typed and not selected is a **typed name**: it is stored with the match only and **never** creates, or is offered to create, a directory record automatically. |
| FR-PLAYER-05 | MUST: Every match stores a **snapshot** of each displayed name. Renaming, deactivating or deleting a directory player later never changes past matches. History, reports and exports read the snapshot. |
| FR-PLAYER-06 | MUST (Admin): Player directory management: create, edit, deactivate players (display name required; full name, notes optional; no contact details in 1.0). Staff can search and select but not manage (`players.manage`). |
| FR-PLAYER-07 | MUST (Admin): **Add to directory** from the Players page for a typed name — creates a directory player and (after a preview of how many past slots match) links all past slots with that exact name (case-insensitive, trimmed) to it. Audit-logged. This is the *only* way a typed name becomes a directory record. |
| FR-PLAYER-08 | MUST (Admin and Staff): **Players page** — a searchable, sortable list of **all players**: every active/inactive directory player **and** every distinct typed name that has appeared in a match (default labels such as "Player 1" are never listed). Columns: name, type (**Registered** / **Typed name**), matches played, wins, losses, last played. Filters: type, last-played range, text search. No limit on rows (paginated). |
| FR-PLAYER-09 | MUST: **Player history page**: all matches in which the player appears (date, court, partner/opponents, score, result — Won/Lost/Ended early/Cancelled) plus stats: matches played, wins, losses, win %, games won/lost, points for/against, last played. Stats count only `completed` matches; ended-early and cancelled matches are listed but not counted. For a **typed name** the page states "Grouped by the name as typed — different people with the same name appear together" and the Admin sees *Add to directory*. |
| FR-PLAYER-10 | MUST: The same player cannot occupy two slots in the same match; the same directory player in two active matches triggers a warning, which staff can override. |
| FR-PLAYER-11 | SHOULD (Admin): link a typed name on a completed match to an existing directory player (merge) so stats are correct. Audit-logged. |

## 7. Match types and scoring rules (FR-FORMAT)

| ID | Requirement |
|----|------------|
| FR-FORMAT-01 | MUST: The **match type — Singles (1 v 1) or Doubles (2 v 2) — is selected by staff when creating each match.** It is not part of a rule preset and cannot change after the match starts (it can be edited while the match is in `setup`). |
| FR-FORMAT-02 | MUST: **Rule presets** (Admin-managed, selectable by Staff and Admin). A preset holds only scoring rules: scoring type (side-out/rally), serving mode (auto/off), points to win (1–50, default **11**), win by (1 or 2, default **2**), optional point cap, games to win (1, 2 or 3 → best of 1/3/5; default **1**), optional deciding-game points, first-server rule, switch-ends prompt, optional time limit (minutes), track server names. |
| FR-FORMAT-03 | MUST: Seeded presets, usable for both singles and doubles: **Standard – 1 game to 11** (default), **Best of 3 – games to 11**, **1 game to 15**, **1 game to 21**, **Rally scoring – 1 game to 21**, **Score only – 1 game to 11** (no serving tracking). |
| FR-FORMAT-04 | MUST: Exactly one preset is the default. Presets can be hidden (`is_active = 0`) but not deleted once used. |
| FR-FORMAT-05 | MUST: A match copies the preset's rule values at creation (snapshot). Editing a preset never changes existing or historical matches. Different matches, including simultaneous ones on different courts, can use different rules. |
| FR-FORMAT-06 | MUST: **Per-match overrides:** while creating a match, staff may tap *Customize rules* to change target points, win-by, point cap, games to win, deciding-game target, scoring type, serving mode and time limit **for this match only**. Validated like presets; the match is flagged `rules_customized` and labelled "(custom)" in history. Controlled by setting `allowRuleOverrides` (default on). |
| FR-FORMAT-07 | MUST: Rules and match type are locked once the match starts. |

## 8. Match lifecycle and scoring (FR-MATCH)

### 8.1 Lifecycle

```
            create (Admin/Staff, any device)                      START_MATCH
   (none) ───────────────────────────────────────────► setup ───────────────────► in_progress ◄──────────┐
                                                          │                         │   ▲   │              │
                                                   CANCEL │                  PAUSE  │   │   │ RESUME       │
                                                          ▼                         ▼   │   │              │
                                                      cancelled                   paused ───┘              │
                                                                                                           │
   (deciding rally) phase = match_over ── CONFIRM_MATCH_END or auto-confirm ──► completed (winner set)    │
   UNDO of the deciding rally while phase = match_over ───────────────────────────────────────────────────┘
   END_MATCH (hold ~2 s + confirm) from in_progress / paused (phase playing or game_over)
                                                         ──────────────────────► terminated  ("Ended early", no winner)
```

Within `in_progress`, the match has a **phase**: `playing` → `game_over` (a game just ended, waiting for "Start next game") → `playing` … → `match_over` (match winner decided, waiting for confirmation). Details: `MATCH_SCORING_LOGIC.md` §6.

### 8.2 Requirements

| ID | Requirement |
|----|------------|
| FR-MATCH-01 | MUST: Only one active match (`setup`, `in_progress`, `paused`) per court, enforced by the database. A second create returns `409 COURT_BUSY`. Matches on different courts are fully independent. |
| FR-MATCH-02 | MUST: **Creating a match** (Admin or Staff, from any device) requires: **court** (a court device defaults to its own court; any active, non-maintenance court may be chosen), **match type** (Singles/Doubles — an explicit choice, no preselection), **rules** (a preset, default preselected, optionally customized), optional team names, optional player names, optional **booking link** (FR-BOOK-07). Court must be active and not in maintenance. A match cannot be moved to another court after creation (cancel it and create a new one). |
| FR-MATCH-03 | MUST: **Starting** a match (staff action) requires choosing the **first serving team** when serving mode is `auto` and, for doubles with "track server names", **which player starts on the right-hand (even) court for each team** (defaults: first-listed player). With serving mode `off` no serving questions are asked. The timer starts at START_MATCH. |
| FR-MATCH-04 | MUST: Scoring input is **"Rally won by Team A / Team B"** — two large buttons. With serving `auto`, the server engine decides point vs. second server vs. side out; with serving `off`, the button awards a point. Staff never work out the rules themselves. |
| FR-MATCH-05 | MUST: The display always shows: both scores, the **score call** (e.g. `4-2-1`), serving team, server number (side-out doubles), the server's name and the service court (right/left) when serving is tracked, current game number, games won per team, previous game scores, and the match timer. |
| FR-MATCH-06 | MUST: When a game ends, the court shows a **Game over** interstitial ("Game 1 — Team A wins 11–8"), with **Undo** and **Start Game 2**. Starting the next game asks which team serves first (default per `MATCH_SCORING_LOGIC.md` §5.6) and, if names tracked, who starts on the right for each team. |
| FR-MATCH-07 | MUST: When the match is decided, the court shows **Match over** with the final result, **Undo** and **Confirm result**. If nobody confirms within `autoConfirmSeconds` (default 120 s), the system confirms automatically. The match end time is the time of the deciding rally, not the confirmation time. A confirmed match is `completed` with a winner. |
| FR-MATCH-08 | MUST: In the deciding game of a multi-game match (and in single-game matches), when a team first reaches the switch-ends score (6 for 11, 8 for 15, 11 for 21), show a non-blocking "Switch ends" banner until the next rally (per `switchEndsPrompt`). |
| FR-MATCH-09 | MUST: "Swap sides" control flips which team appears on the left/right of the court display (visual only). Persisted in the match state so refreshes keep it. |
| FR-MATCH-10 | MUST: **Undo** reverses the most recent scoring action (rally, score adjustment, start-next-game). Repeated undo walks further back, down to the first rally of the match. Available to Staff and Admin. Undo cannot reverse match start, End match, or a confirmed (completed) match. |
| FR-MATCH-11 | MUST: **Adjust score** (Staff, Admin): set the current game's score and, when serving is tracked, serving team, server number, server and right-side players, with an optional reason. This is the referee's **manual override** of serving and score. Requires a confirmation step; stored as an event; undoable. |
| FR-MATCH-12 | MUST: **Pause / resume**. While paused: timer stopped, scoring disabled, large "Resume" button shown. Allowed in `playing` and `game_over` phases. |
| FR-MATCH-13 | MUST: **End match early** (Staff, Admin, on any device). Players may ask for it; only staff perform it. Flow: (1) open *End match* from the menu, (2) choose a reason (Time up, Injury, Players left, Other + note), (3) **press and hold the End match button for the configured duration — default 2 s (`endMatchHoldMs`, range 1–4 s, to be tuned by usability testing)**; a normal tap does nothing and releasing early cancels, (4) a **confirmation dialog** states the current score/games and "No winner will be recorded", (5) *Confirm end* finalizes. Result: status `terminated` (shown as **"Ended early"**), current scores and all game history **preserved**, termination timestamp recorded as `ended_at`, game in progress marked abandoned, **no winner declared** (even if one team is ahead). |
| FR-MATCH-14 | MUST: **Cancel** a match that is still in `setup` (Staff, Admin). Cancelled matches are kept in history but excluded from statistics. |
| FR-MATCH-15 | MUST: Accidental-press protection: rally buttons ignore a second tap within **600 ms**; while a command is in flight, all scoring buttons are disabled; the last action is always shown in a "Last: Rally → Team A (point)" line next to Undo. |
| FR-MATCH-16 | MUST: All score-changing actions are recorded as events with the acting **user**, the court device label where applicable, timestamp, and resulting score — viewable in the match timeline. |
| FR-MATCH-17 | MUST (Admin only): Correct the **final result** of a completed or ended-early match (per-game scores, winner) with a mandatory reason; the original events are preserved and an `ADMIN_CORRECTION` event is appended (Q30). |
| FR-MATCH-18 | SHOULD: "Game point" / "Match point" indicator for the team that would win with the next point. |
| FR-MATCH-19 | MUST: Staff can **edit the match type and rules only while the match is in `setup`** (`UPDATE_RULES`), and can edit player/team names at any time. |

**Acceptance criteria (selection; full rule tests in `MATCH_SCORING_LOGIC.md` §12)**
- Doubles side-out, new game, Team A serves: display shows `0-0-2`. Team B wins rally → side out → display shows Team B serving `0-0-1`.
- Score 10–9 Team A serving, Team A wins rally → Game over A 11–9 (single-game match → Match over). Undo → back to `10-9` with the same server.
- Pressing "Rally won A" twice within 300 ms records one rally.
- A tap on *End match* does nothing; holding for 2 s then confirming terminates; releasing at 1.9 s does nothing; the resulting match has status `terminated`, `winner = null`, `ended_at` = confirmation time and the unfinished game's score preserved.
- A match created with all names blank shows "Player 1 / Player 2" labels; no `players` rows were created; the Players page does not list "Player 1"; after the match, history shows the same labels.
- Singles and doubles matches run at the same time on two courts with different rules (e.g. 11 win-by-2 and 15 win-by-1) without interfering.
- A Staff user cannot call any `bookings.manage`, `courts.manage`, `players.manage` or `matches.correct` endpoint; every Court Management action above works for them.

## 9. Match timer (FR-TIMER)

| ID | Requirement |
|----|------------|
| FR-TIMER-01 | MUST: Each match records `created_at`, `started_at`, `ended_at`, `paused_at` (current pause), `paused_total_ms`. All are server timestamps. |
| FR-TIMER-02 | MUST: **Elapsed (playing) time** = `(ended_at ?? now) − started_at − paused_total_ms − (paused_at ? now − paused_at : 0)`. **Occupied time** = `(ended_at ?? now) − started_at` (includes pauses; used for utilization). |
| FR-TIMER-03 | MUST: Clients display the timer from server timestamps corrected by a measured server-clock offset, so it is correct after refresh, reconnection, or device clock skew (drift < 1 s). |
| FR-TIMER-04 | MUST: Pause/resume as FR-MATCH-12. |
| FR-TIMER-05 | MUST: The timer keeps running while a device is disconnected or the Master is restarting (real play continues). |
| FR-TIMER-06 | MUST: Optional **time limit** per preset/match (minutes). The court page shows remaining time; warning banner at 5 min and at 0 ("Time limit reached"). The system **does not** end the match automatically (Q6); the dashboard raises an alert. **Exception:** Open Play games follow the time-up rule in `OPEN_PLAY.md` (final rally, then the higher score wins; a tie goes to the next rally). |
| FR-TIMER-07 | MUST: Per-game start/end times are recorded for game-duration statistics. |

## 10. Game Histories (FR-HIST)

| ID | Requirement |
|----|------------|
| FR-HIST-01 | MUST (Admin and Staff, identical): Paginated, filterable list: date range, court, status, rule preset, match type, player (directory or typed name), linked booking, text search on names/team names/match code. Default sort: newest first. There is **no history time window for Staff**. |
| FR-HIST-02 | MUST: Columns: match code, date, court (with "inactive" tag if applicable), match type, teams/players (snapshot names, default labels where blank), rules, game scores (e.g. `11-8, 9-11, 11-7`), winner (blank for ended-early/cancelled), start, end, duration, status ("Completed", "Ended early – reason", "Cancelled"). |
| FR-HIST-03 | MUST: Match detail: everything above plus per-game durations, pauses, the full event timeline (with voided/undone events shown struck-through), who created/ended the match (user name and court), linked booking, corrections. |
| FR-HIST-04 | MUST: Match code format `YYMMDD-C<court short code>-<seq>` e.g. `261030-C3-004` (unique, human-friendly, sortable). Internal integer IDs are used in URLs. |
| FR-HIST-05 | MUST (Admin): CSV export of the filtered list. |
| FR-HIST-06 | MUST (Admin): Correct a finished match (FR-MATCH-17) from the match detail page. |

## 11. Reports and analytics (FR-REPORT)

Reports are the **Analytics** tab of the Dashboard and are **visible to Admin and Staff alike**; only **CSV export** is Admin-only.
All reports take a date range (presets: Today, Yesterday, This week, Last week, This month, Last month, Custom) and optional court filter, use the facility's local time, and exclude `cancelled` matches. Ended-early matches count toward utilization and durations but not toward win/loss. Deactivated courts are included in any range in which they had matches.

| ID | Report | Content |
|----|--------|---------|
| FR-REPORT-01 | Match volume | Matches per day / ISO week / month (grouping selectable); split by completed vs. ended early; by match type. Bar chart + table. |
| FR-REPORT-02 | Court utilization | Per court: occupied hours, playing hours, number of matches, utilization % = occupied time ÷ operating hours in range. Operating hours come from settings (per weekday open/close). Facility-wide total. |
| FR-REPORT-03 | Match duration | Average, median, min, max duration overall and by preset, by court, by match type; average game duration; distribution histogram (≤ 15, 15–30, 30–45, 45–60, > 60 min). |
| FR-REPORT-04 | Peak hours | Heatmap: weekday × hour, value = average courts occupied. |
| FR-REPORT-05 | Player participation | Directory players and typed names: matches, wins, losses, win %, points for/against, last played; sortable. Same data as the Players page. |
| FR-REPORT-06 | Court turnover (SHOULD) | Average gap between consecutive matches per court within operating hours. |
| FR-REPORT-07 | Booking utilization (SHOULD) | Booked hours vs. operating hours per court, no-show and cancellation counts, share of booked hours in which a match was actually played. |
| FR-REPORT-08 | Export | Every report: **CSV download** (Admin; UTF-8 with BOM for Excel) and **Print / Save as PDF** via a print-optimized page and the browser's print dialog (no server PDF library). |

## 12. Settings (FR-SET) — Admin only

| Key | Default | Purpose |
|-----|---------|---------|
| `facilityName` | "Pickleball Facility" | Shown in headers, reports, court idle screen |
| `operatingHours` | Mon–Sun 07:00–22:00 | Utilization denominator and booking limits |
| `completedDisplayMinutes` | 5 | Court shows `completed` before becoming `available` |
| `autoConfirmSeconds` | 120 | Auto-confirm match result |
| `staleMatchMinutes` | 20 | Alert when no events |
| `allowRuleOverrides` | true | FR-FORMAT-06: staff may customize rules per match |
| `endMatchHoldMs` | 2000 | Press-and-hold duration for End match (1000–4000) |
| `adminLoginMasterPcOnly` | false | FR-AUTH-10: Admin logins only from the Master PC |
| `sessionIdleMinutes` / `sessionMaxDays` | 480 / 7 | FR-AUTH-04 (normal sessions) |
| `terminalSessionDays` | 30 | FR-AUTH-04 (court-device sessions; no idle timeout) |
| `bookingSlotMinutes` | 30 | FR-BOOK-01 time granularity (15, 30 or 60) |
| `bookingMaxHours` | 4 | FR-BOOK-03 |
| `bookingAdvanceDays` | 90 | FR-BOOK-03 |
| `bookingWarnMinutes` | 15 | FR-BOOK-07/08 |
| `backupTime` / `backupRetention` / `backupExtraPath` | 23:30 / 30 / none | FR-BACKUP |
| `courtTheme` | `dark` | Default court UI theme; each device may override (Q17) |

All settings changes are audit-logged. (There is deliberately **no** "require player names", "staff can view reports", "staff history days" or "allow device match creation" setting: Staff always see the same areas and any signed-in user can create matches.)

## 13. Backup and restore (FR-BACKUP) — Admin only

| ID | Requirement |
|----|------------|
| FR-BACKUP-01 | MUST: Automatic daily backup at `backupTime` using SQLite's online backup API (consistent while running). Keep the newest `backupRetention` files. |
| FR-BACKUP-02 | MUST: Manual "Back up now". |
| FR-BACKUP-03 | MUST: Automatic backup before any schema migration and before any restore. |
| FR-BACKUP-04 | SHOULD: Copy each backup also to `backupExtraPath` (USB drive, NAS share) if configured and reachable; failure raises an alert but does not fail the backup. |
| FR-BACKUP-05 | MUST: List backups (date, type, size), download a backup file. |
| FR-BACKUP-06 | MUST: Restore from a listed backup or an uploaded file. Blocked while any match is active unless "force" is confirmed. Validates integrity and schema version, takes a pre-restore backup, swaps the database, notifies all clients to reload. Bookings and users are part of the database and restore with it. |
| FR-BACKUP-07 | MUST: Startup integrity check; if the database is corrupt the service starts in **Recovery mode** (the app shows only restore options to an Admin). |

## 14. Audit log (FR-AUDIT) — Admin view only

| ID | Requirement |
|----|------------|
| FR-AUDIT-01 | MUST: Record: login success/failure/logout, user create/role change/deactivate/password reset, court create/edit/count change/activate/deactivate/maintenance, device assign/replace/unassign/sign-out, booking create/edit/cancel/no-show, match create/cancel/end-early, admin result corrections, directory additions and name links, player and preset changes, settings changes, backups, restores, recovery mode entry. |
| FR-AUDIT-02 | MUST: Each entry: time, actor (user with role, or system), the court device where applicable, action key, entity type + id, details (JSON before/after where relevant), IP. |
| FR-AUDIT-03 | MUST: Viewable and filterable by Admin; read-only; not editable or deletable via UI. |
| FR-AUDIT-04 | Rally-level scoring events are **not** duplicated into the audit log; they live in `match_events` (visible in the match timeline). |

## 15. End-to-end workflows

### W1 — Facility opening
1. Master PC boots (Windows 11) → the Windows service auto-starts → integrity check → stale active matches from the previous day are flagged `needs_review`.
2. Staff or Admin opens the app (desktop shortcut) and signs in; the dashboard shows alerts for any `needs_review` matches → Staff end them (End match) or the Admin corrects them.
3. Court phones/tablets are switched on; each reopens on its court (session still valid) → the dashboard shows all court devices online. A device with an expired session shows the sign-in screen and, after sign-in, returns to its court.

### W2 — Staff-run match from the court phone
1. Referee at Court 3 signs in (once per shift/device) and sees "Court 3 — Available"; taps **New match**.
2. Step 1: chooses **Singles** or **Doubles** (explicit), then the rule preset (default preselected; *Customize rules* optional); picks the booking if one is shown.
3. Step 2: names (optional, autocomplete from directory; blank = "Player 1…").
4. Step 3: first serving team (and right-side players for doubles) → **Start match**.
5. Referee taps "Rally won" for the winning team after each rally; the score call and server update automatically; Undo and Adjust score fix mistakes.
6. Game ends → Game-over screen → **Start next game** → … → Match over → **Confirm result** (or auto-confirm). **Done** releases the court.

### W3 — Front-desk-prepared match
Staff opens the Court 4 page on the Master PC → New match (type, rules, names, booking) → the Court 4 phone immediately shows "Ready to start" → the referee taps Start.

### W4 — Mis-tap correction
Referee taps the wrong team → taps **Undo** (single tap) → taps the correct team.

### W5 — Early end requested by the players
Players tell the referee they must leave → referee opens *End match*, picks "Players left", holds the button for 2 s, reads the confirmation ("Game 2: 7–4, Game 1: Team A 11–8 — no winner will be recorded"), taps *Confirm end* → match is "Ended early" with the score preserved and the timestamp recorded.

### W6 — Lost connection
Wi-Fi drops → within ~10 s the court shows "Connection to Master lost — scoring paused. Keep the score on paper; you can correct it when reconnected." → reconnects automatically → state refreshes → the referee uses **Adjust score** if rallies were played meanwhile. A staff member on another device can also score that court meanwhile.

### W7 — Device replacement
The Court 2 phone breaks → a new phone opens the app URL, the staff member signs in and chooses "Use this device for Court 2" → confirms "Replace the current Court 2 device?" → the in-progress match appears on the new phone exactly where it was. (The Admin can also sign the old device out from the Court 2 page.)

### W8 — Adding courts and staff
Admin → Court Management → "Number of courts" 8 → 12 → four new courts "Court 9…12" are created active (limit 24); each new phone is assigned to its court after sign-in. Admin → Users → Add staff (as many as needed).

### W9 — Booking a court
Admin opens Booking Schedule → Day view → clicks the empty Court 5 cell at 18:00 → enters "Maria", 18:00–19:00 → saved; dashboards show "Next 18:00" on Court 5. At 18:00 the referee creates a match on Court 5 and links it to Maria's booking.

### W10 — End of day
Admin checks the dashboard (no active matches), reviews the Analytics tab, exports CSV if needed. Automatic backup runs at 23:30. The Master PC may stay on or be shut down normally (service stops gracefully).


## Open Play (FR-OPEN)

See `OPEN_PLAY.md`. Permissions: `openplay.view` (Admin, Staff) and `openplay.manage` (Admin only). Staff still change only the court they score.
