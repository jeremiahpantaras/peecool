# Database Schema (SQLite)

## 1. Conventions

| Convention | Rule |
|-----------|------|
| Engine | SQLite 3 via better-sqlite3; one file `<dataDir>/pickle.db`; accessed **only** by the Master service process |
| Pragmas (every connection) | `journal_mode=WAL`, `synchronous=FULL`, `foreign_keys=ON`, `busy_timeout=5000` |
| Primary keys | `INTEGER PRIMARY KEY` (rowid alias) unless noted; exposed in API as numbers |
| Timestamps | `INTEGER` **epoch milliseconds UTC**, columns suffixed `_at`. Local-day grouping uses a stored `play_date` (facility local date at match start) |
| Booleans | `INTEGER NOT NULL DEFAULT 0 CHECK (col IN (0,1))` |
| Enums | `TEXT` + `CHECK (col IN (...))`; values match TypeScript enums in `packages/shared/types` |
| JSON | `TEXT` holding JSON, validated by Zod in application code; `CHECK (json_valid(col))` |
| Case-insensitive uniqueness | `COLLATE NOCASE` on the column |
| Deletion | Soft (flags/status) for anything referenced by history. Hard delete only for unreferenced rows (e.g. a court with no matches, expired sessions) |
| Migrations | Drizzle-generated SQL files in `apps/server/src/db/migrations`, tracked by Drizzle's `__drizzle_migrations` table; `PRAGMA user_version` mirrors the latest migration number for quick checks in backups |
| Naming | `snake_case` tables (plural) and columns; indexes `ix_<table>_<cols>`, unique `ux_<table>_<cols>` |

> Mapping to the brief's proposed entities: `sets` → **`match_games`**; `score_events` → **`match_events`** (also holds lifecycle events); `match_settings` → **format columns snapshotted on `matches`** plus presets in **`match_formats`**; added **`users`** (two roles: `admin`, `staff`), **`user_sessions`**, **`match_players`** and **`bookings`**. Revision 2 (owner decisions): `administrators` became `users`; `play_type` moved from the format preset to the match; END_EARLY/TERMINATE merged into `END_MATCH`. **Revision 3:** the `court_devices` table (pairing tokens) is **removed** — a court's phone/tablet is a signed-in session assigned to a court (`user_sessions.terminal_court_id`); every event/match/audit actor is a user or the system (no `device` actor); `bookings` added; `matches.booking_id` added.

## 2. Entity-relationship overview

```
users 1──* user_sessions                 (session may be assigned to one court: terminal_court_id)
users 1──* audit_logs (actor, nullable)
users 1──* bookings (created_by)
courts         1──* user_sessions        (at most ONE assigned session per court)
courts         1──* matches
courts         1──* bookings
bookings       1──* matches              (matches.booking_id nullable: optional link)
match_formats  1──* matches              (format_id nullable: source preset, values snapshotted)
matches        1──* match_players        (exactly 2 or 4 rows)
players        1──* match_players        (player_id nullable: typed names)
matches        1──* match_games
matches        1──* match_events
match_events   1──1 match_events         (voided_by_event_id → UNDO event)
system_settings (key/value)
```

## 3. Tables

### 3.1 `users`
Purpose: user accounts for the single application. Exactly two roles exist: **`admin`** (the facility owner; full access) and **`staff`** (referees/front-desk; operates courts, read-only elsewhere). The permission matrix is in `FUNCTIONAL_REQUIREMENTS.md` §1; the database stores only the role, and the server derives permissions from it (`packages/shared/permissions`). There are **no device accounts**: a court phone/tablet is just a session of a normal user. **There is no limit on the number of `staff` rows.**

| Column | Type | Constraints | Notes |
|--------|------|------------|-------|
| id | INTEGER | PK | |
| username | TEXT | NOT NULL, UNIQUE, COLLATE NOCASE, CHECK length 3–32 | |
| display_name | TEXT | NOT NULL, CHECK length 1–60 | |
| password_hash | TEXT | NOT NULL | `scrypt$N$r$p$salt$hash` (NFR-SEC-01) |
| role | TEXT | NOT NULL, CHECK IN ('admin','staff') | no other role types in 1.0 |
| is_active | INTEGER | bool, DEFAULT 1 | |
| failed_login_count | INTEGER | NOT NULL DEFAULT 0 | reset on success |
| locked_until | INTEGER | NULL | epoch ms |
| last_login_at | INTEGER | NULL | |
| password_changed_at | INTEGER | NOT NULL | |
| must_change_password | INTEGER | bool DEFAULT 0 | set when an Admin creates the account or resets the password; forces a change at next login |
| created_by_user_id | INTEGER | NULL FK → users(id) | NULL for the first-run Admin |
| created_at / updated_at | INTEGER | NOT NULL | |

Indexes: `ux_users_username` (implicit by UNIQUE), `ix_users_role_active (role, is_active)`.
Rules (app-level, in one transaction): at least one active `admin` must always exist (cannot deactivate or demote the last one). Users are never hard-deleted once they appear in `match_events`, `matches` or `audit_logs`; they are deactivated (`is_active = 0`), which ends their sessions. A role change also ends the user's sessions.

### 3.2 `user_sessions`
Purpose: server-side login sessions for admins and staff (survive restarts). A session optionally carries the **court assignment** that makes the browser "Court N" (FR-TERM).

| Column | Type | Constraints | Notes |
|--------|------|------------|-------|
| id | TEXT | PK | SHA-256 hex of the session token (raw token only in cookie) |
| user_id | INTEGER | NOT NULL, FK → users(id) ON DELETE CASCADE | |
| terminal_court_id | INTEGER | NULL, FK → courts(id) ON DELETE SET NULL | the court this phone/tablet is assigned to ("Use this device for Court N"); NULL = ordinary session |
| terminal_assigned_at | INTEGER | NULL | |
| created_at | INTEGER | NOT NULL | |
| last_seen_at | INTEGER | NOT NULL | updated at most once per minute; the device-online state itself comes from the socket registry |
| expires_at | INTEGER | NOT NULL | absolute expiry: `sessionMaxDays` for ordinary sessions; for court-assigned sessions `terminalSessionDays`, extended on use |
| ip | TEXT | NULL | |
| user_agent | TEXT | NULL | truncated to 200 |
| client_label | TEXT | NULL, ≤ 120 | parsed browser/OS shown in the court's device panel |

Indexes: `ix_user_sessions_user_id`, `ix_user_sessions_expires_at`, and **`ux_user_sessions_terminal_court` UNIQUE `(terminal_court_id)` WHERE `terminal_court_id IS NOT NULL`** — at most one device is assigned to a court (FR-TERM-05). The "Replace current Court N device" flow clears the old row's `terminal_court_id` and sets the new one in a single transaction.
Idle timeout (`sessionIdleMinutes`) applies only when `terminal_court_id IS NULL`; assigned sessions are exempt (FR-AUTH-04). Signing a court's device out deletes that session row. Deactivating a court sets nothing here; the device simply shows "Court not in service".

### 3.3 `courts`
Purpose: physical courts.

| Column | Type | Constraints | Notes |
|--------|------|------------|-------|
| id | INTEGER | PK | |
| name | TEXT | NOT NULL, UNIQUE COLLATE NOCASE, CHECK length 1–40 | "Court 1", "Center Court" |
| short_code | TEXT | NOT NULL, UNIQUE COLLATE NOCASE, CHECK length 1–4 | used in match codes, e.g. "3", "CC" |
| description | TEXT | NULL, ≤ 200 | location note |
| display_order | INTEGER | NOT NULL DEFAULT 0 | |
| is_active | INTEGER | bool DEFAULT 1 | |
| maintenance_mode | INTEGER | bool DEFAULT 0 | |
| maintenance_note | TEXT | NULL, ≤ 200 | |
| released_at | INTEGER | NULL | set by "Done"/release; suppresses `completed` status for the latest match |
| created_at / updated_at | INTEGER | NOT NULL | |

Indexes: `ix_courts_display_order (is_active, display_order)`.
Status is **derived**, not stored (FUNCTIONAL_REQUIREMENTS §4.3).

Rules (app-level):
- **Naming:** default names are "Court 1", "Court 2", … Because each court has exactly one phone/tablet, **the device is named after its court** — there is no separate device name.
- **Dynamic court count:** courts are rows, not configuration. The admin adds courts (singly or in bulk) and deactivates them; there is no fixed table of 24. **At most 24 courts may be active at once** (`MAX_ACTIVE_COURTS = 24`, a constant in `packages/shared`); creating or reactivating beyond that returns `COURT_LIMIT_REACHED`. Inactive courts do not count toward the limit.
- **Unique identifiers:** `name` and `short_code` are both unique (case-insensitive) across active *and* inactive courts, so a deactivated court's identifier is never reused by a different physical court.
- `short_code` becomes **immutable** once the court has any match (it is embedded in stored `match_code` values; changing it could create code collisions). `name` stays editable.
- Courts referenced by matches are never deleted (`matches.court_id` is `ON DELETE RESTRICT`); deactivation keeps all history queryable (history/report queries never filter on `courts.is_active`).

### 3.4 `bookings`
Purpose: the Booking Schedule — court reservations entered by the Admin (FR-BOOK). A booking reserves a court for a time range; it never blocks play (FR-BOOK-08) and never creates a match by itself. Bookings are **never deleted**; they are cancelled (status), so the schedule is also an audit-friendly record.

| Column | Type | Constraints | Notes |
|--------|------|------------|-------|
| id | INTEGER | PK | |
| booking_code | TEXT | NOT NULL UNIQUE | `B-YYMMDD-<seq3>`; the date is the booking's local date, `seq` = bookings created for that date + 1 |
| court_id | INTEGER | NOT NULL FK → courts(id) ON DELETE RESTRICT | |
| start_at | INTEGER | NOT NULL | epoch ms UTC |
| end_at | INTEGER | NOT NULL, CHECK `end_at > start_at` | exclusive end; adjacent bookings (A ends when B starts) do not overlap |
| play_date | TEXT | NOT NULL | `YYYY-MM-DD` facility-local date of `start_at` (bookings may not span midnight; operating hours are within one day) |
| booked_by_name | TEXT | NOT NULL, CHECK length 1–60 | the customer/group name (free text; not a login, not a directory link) |
| phone | TEXT | NULL, ≤ 30 | |
| players_count | INTEGER | NULL CHECK 1–8 | |
| notes | TEXT | NULL, ≤ 300 | |
| status | TEXT | NOT NULL DEFAULT 'confirmed' CHECK IN ('confirmed','cancelled','no_show') | "upcoming / now / past" is **derived** from the clock, not stored |
| cancel_reason | TEXT | NULL, ≤ 200 | |
| cancelled_at | INTEGER | NULL | |
| cancelled_by_user_id | INTEGER | NULL FK → users(id) | |
| created_by_user_id | INTEGER | NOT NULL FK → users(id) | always an Admin in 1.0 (`bookings.manage`) |
| updated_by_user_id | INTEGER | NULL FK → users(id) | |
| created_at / updated_at | INTEGER | NOT NULL | |

Constraints:
- CHECK `status <> 'cancelled' OR cancelled_at IS NOT NULL`.
- **No overlap among `confirmed` bookings on the same court** — enforced by two triggers (SQLite has no exclusion constraints), in addition to the application's transactional check:
  `tr_bookings_no_overlap_ins` BEFORE INSERT and `tr_bookings_no_overlap_upd` BEFORE UPDATE OF `court_id, start_at, end_at, status` — each `RAISE(ABORT, 'BOOKING_CONFLICT')` when `NEW.status = 'confirmed'` and a different `confirmed` booking on `NEW.court_id` exists with `existing.start_at < NEW.end_at AND existing.end_at > NEW.start_at`. The service maps this error to `409 BOOKING_CONFLICT`.
- Business limits (operating hours, `bookingMaxHours`, `bookingAdvanceDays`, slot granularity, court active) are validated in the application from settings (they change over time, so they are not CHECKs).

Indexes: `ix_bookings_court_time (court_id, start_at)` (overlap check, court day view), `ix_bookings_play_date (play_date, status)` (day/week views, dashboard "bookings today"), `ix_bookings_booked_by (booked_by_name COLLATE NOCASE)` (search).

Court deactivation or maintenance does **not** touch bookings; the application lists future `confirmed` bookings of that court and the Admin explicitly keeps or cancels them (FR-BOOK-06).

### 3.5 `players`
Purpose: optional player directory.

| Column | Type | Constraints | Notes |
|--------|------|------------|-------|
| id | INTEGER | PK | |
| display_name | TEXT | NOT NULL, ≤ 30 | shown on court |
| normalized_name | TEXT | NOT NULL | lower-case, trimmed, collapsed spaces, diacritics stripped — for search |
| full_name | TEXT | NULL, ≤ 80 | |
| notes | TEXT | NULL, ≤ 500 | |
| is_active | INTEGER | bool DEFAULT 1 | inactive = hidden from autocomplete |
| created_at / updated_at | INTEGER | NOT NULL | |

Indexes: `ix_players_normalized_name (normalized_name)`, `ix_players_active_name (is_active, normalized_name)`.
Not unique: two members can share a name; UI warns on create when an active duplicate exists.

### 3.6 `match_formats`
Purpose: reusable scoring-rule presets (semantics in `MATCH_SCORING_LOGIC.md` §3). A preset is **only a set of scoring rules**; it does **not** contain singles/doubles. The match type (singles or doubles) is chosen separately for every match, so the same preset ("Best of 3 to 11") serves both. Staff may also override individual rules for one match (stored on the match, `rules_customized = 1`).

| Column | Type | Constraints | Default |
|--------|------|------------|---------|
| id | INTEGER | PK | |
| name | TEXT | NOT NULL UNIQUE COLLATE NOCASE, ≤ 50 | |
| scoring_type | TEXT | NOT NULL CHECK IN ('side_out','rally') | side_out |
| serving_mode | TEXT | NOT NULL CHECK IN ('auto','off') | auto |
| points_to_win | INTEGER | NOT NULL CHECK 1–50 | 11 |
| win_by | INTEGER | NOT NULL CHECK IN (1,2) | 2 |
| point_cap | INTEGER | NULL CHECK (point_cap IS NULL OR point_cap > points_to_win) | NULL |
| games_to_win | INTEGER | NOT NULL CHECK IN (1,2,3) | 1 |
| deciding_game_points | INTEGER | NULL CHECK 1–50 | NULL |
| first_server_rule | TEXT | NOT NULL CHECK IN ('start_server_2','both_servers') | start_server_2 |
| switch_ends_prompt | TEXT | NOT NULL CHECK IN ('off','deciding_game','every_game') | deciding_game |
| time_limit_minutes | INTEGER | NULL CHECK 1–600 | NULL |
| track_server_names | INTEGER | bool | 1 |
| is_default | INTEGER | bool | 0 |
| is_active | INTEGER | bool | 1 |
| display_order | INTEGER | NOT NULL DEFAULT 0 | |
| created_at / updated_at | INTEGER | NOT NULL | |

Indexes: `ux_match_formats_default` UNIQUE `(is_default)` WHERE `is_default = 1` (exactly one default enforced by app + this index).
Rules:
- CHECK `scoring_type <> 'side_out' OR serving_mode = 'auto'` — side-out scoring is defined by who is serving, so it cannot be combined with serving tracking off. (`rally` may use either.)
- `first_server_rule` only has an effect for **doubles + side_out + serving_mode auto** (known only at match creation, when play type is chosen); `track_server_names` only has an effect when `serving_mode = 'auto'` and the match is doubles side-out.
- Seeded presets (DATABASE_SCHEMA §6) are ordinary rows; none are hard-coded in application logic.

### 3.7 `matches`
Purpose: one row per match; holds the **match type**, the **snapshotted scoring rules**, lifecycle, timer fields, denormalized result and a cached state. Two matches never share configuration by reference: every rule value is copied onto the match, so presets can change freely and different matches (even on the same court, same day) can use different rules.

| Column | Type | Constraints | Notes |
|--------|------|------------|-------|
| id | INTEGER | PK | |
| match_code | TEXT | NOT NULL UNIQUE | `YYMMDD-C<court.short_code>-<seq3>`; `seq` = count of matches on that court that local day + 1 |
| court_id | INTEGER | NOT NULL FK → courts(id) ON DELETE RESTRICT | |
| format_id | INTEGER | NULL FK → match_formats(id) ON DELETE SET NULL | source preset (informational) |
| booking_id | INTEGER | NULL FK → bookings(id) ON DELETE SET NULL | optional link to a reservation (FR-BOOK-07); setting it never edits the booking |
| format_name | TEXT | NOT NULL | snapshot; "Custom" suffix when `rules_customized` (e.g. "Best of 3 to 11 (custom)") |
| rules_customized | INTEGER | bool DEFAULT 0 | staff overrode one or more preset values for this match |
| play_type | TEXT | NOT NULL CHECK IN ('singles','doubles') | **chosen by staff at creation** (not taken from the preset); immutable afterwards |
| scoring_type | TEXT | NOT NULL CHECK IN ('side_out','rally') | snapshot |
| serving_mode | TEXT | NOT NULL CHECK IN ('auto','off') | snapshot; CHECK `scoring_type <> 'side_out' OR serving_mode = 'auto'` |
| points_to_win | INTEGER | NOT NULL | snapshot |
| win_by | INTEGER | NOT NULL | snapshot |
| point_cap | INTEGER | NULL | snapshot |
| games_to_win | INTEGER | NOT NULL | snapshot |
| deciding_game_points | INTEGER | NULL | snapshot |
| first_server_rule | TEXT | NOT NULL | snapshot |
| switch_ends_prompt | TEXT | NOT NULL | snapshot |
| time_limit_minutes | INTEGER | NULL | snapshot |
| track_server_names | INTEGER | bool | snapshot |
| team_a_name | TEXT | NOT NULL, ≤ 30 | default "Team A" |
| team_b_name | TEXT | NOT NULL, ≤ 30 | default "Team B" |
| status | TEXT | NOT NULL CHECK IN ('setup','in_progress','paused','completed','terminated','cancelled') | |
| phase | TEXT | NULL CHECK IN ('playing','game_over','match_over') | NULL unless in_progress/paused |
| phase_changed_at | INTEGER | NULL | drives auto-confirm |
| version | INTEGER | NOT NULL DEFAULT 0 | +1 per accepted command |
| state_json | TEXT | NULL, json_valid | cached engine state (rebuildable from events) |
| created_at | INTEGER | NOT NULL | |
| started_at | INTEGER | NULL | |
| ended_at | INTEGER | NULL | for `completed`: time of the deciding rally (set provisionally in `match_over`, cleared if undone); for `terminated`: **the termination timestamp** (the moment `END_MATCH` was accepted) |
| paused_at | INTEGER | NULL | non-null iff currently paused |
| paused_total_ms | INTEGER | NOT NULL DEFAULT 0 | completed pauses |
| play_date | TEXT | NOT NULL | `YYYY-MM-DD` local date at creation (updated to start date at START_MATCH) |
| last_event_at | INTEGER | NOT NULL | |
| games_won_a / games_won_b | INTEGER | NOT NULL DEFAULT 0 | denormalized |
| winner_team | TEXT | NULL CHECK IN ('A','B') | stays NULL for `terminated` and `cancelled` matches (see constraints) |
| end_reason | TEXT | NULL CHECK IN ('completed','time_up','injury','players_left','other') | `completed` = played to a result; the other values are the reasons offered by **End match** |
| end_note | TEXT | NULL, ≤ 200 | required by the API when `end_reason = 'other'` |
| needs_review | INTEGER | bool | flagged at startup if stale |
| created_by_user_id | INTEGER | NOT NULL FK → users(id) | every match is created by a named Admin or Staff user |
| created_on_court_id | INTEGER | NULL FK → courts(id) | the court the creating device was assigned to ("Court 3 phone"), NULL when created from an unassigned device such as the Master PC |
| corrected_at | INTEGER | NULL | set when an admin corrects the result after the fact |
| updated_at | INTEGER | NOT NULL | |

Constraints:
- `ux_matches_active_court` UNIQUE `(court_id)` **WHERE** `status IN ('setup','in_progress','paused')` — one active match per court (FR-MATCH-01).
- CHECK `(status IN ('in_progress','paused')) = (phase IS NOT NULL)`.
- CHECK `(status = 'paused') = (paused_at IS NOT NULL)`.
- CHECK `status <> 'completed' OR (winner_team IS NOT NULL AND ended_at IS NOT NULL)`.
- CHECK `status <> 'terminated' OR (winner_team IS NULL AND ended_at IS NOT NULL AND end_reason IS NOT NULL AND end_reason <> 'completed')` — an early-ended match records its timestamp and reason and **never** carries a winner (an admin correction that supplies a full valid result converts it to `completed`; see MATCH_SCORING_LOGIC §5.12).
- CHECK `status <> 'cancelled' OR winner_team IS NULL`.
- CHECK `play_type IN ('singles','doubles') AND games_to_win IN (1,2,3)`.

Indexes:
- `ix_matches_court_created (court_id, created_at DESC)` — court detail, latest match per court
- `ix_matches_play_date (play_date, status)` — reports, dashboard
- `ix_matches_status (status)` — active matches
- `ix_matches_started_at (started_at)` — range queries for utilization
- `ix_matches_booking (booking_id) WHERE booking_id IS NOT NULL` — matches linked to a booking

### 3.8 `match_players`
Purpose: player slots per match (2 rows singles, 4 rows doubles).

| Column | Type | Constraints | Notes |
|--------|------|------------|-------|
| id | INTEGER | PK | |
| match_id | INTEGER | NOT NULL FK → matches(id) ON DELETE CASCADE | |
| team | TEXT | NOT NULL CHECK IN ('A','B') | |
| slot | INTEGER | NOT NULL CHECK IN (1,2) | |
| player_id | INTEGER | NULL FK → players(id) ON DELETE SET NULL | NULL = typed name or blank |
| display_name | TEXT | NULL, ≤ 30 | **snapshot of the name shown for this slot.** NULL = no name was entered → the UI shows the default label (below) |

Constraints: `ux_match_players_slot` UNIQUE `(match_id, team, slot)`; `ux_match_players_player` UNIQUE `(match_id, player_id)` WHERE `player_id IS NOT NULL` (same player not twice in a match); CHECK `player_id IS NULL OR display_name IS NOT NULL` (a directory-linked slot always snapshots the name that was shown). App-level: singles matches have exactly the slot-1 rows of A and B; doubles have slots 1–2 for both.
Indexes: `ix_match_players_player (player_id)`; **`ix_match_players_typed_name (display_name COLLATE NOCASE) WHERE player_id IS NULL AND display_name IS NOT NULL`** — groups *typed names* for the Players page (FR-PLAYER-08). The application stores `display_name` trimmed with inner whitespace collapsed, so case-insensitive equality is the grouping key.

**Optional names and default labels (owner decision).** Names are never required. When `display_name IS NULL` the label is computed, never stored, by the shared pure function `defaultPlayerLabel(playType, team, slot)`:

| Match type | Team A | Team B |
|---|---|---|
| Singles | "Player 1" | "Player 2" |
| Doubles | slot 1 "Player 1", slot 2 "Player 2" (shown "Player 1 and Player 2") | slot 1 "Player 1", slot 2 "Player 2" (shown "Player 1 and Player 2") |

(In doubles the same two labels appear under each team; they are always displayed beside the team name/colour, so they are unambiguous in context. Exports, CSV and logs always prefix the team: "Team B: Player 1".) Staff can overwrite any slot at any time (`UPDATE_PLAYERS`), blank again returns to the default label.

**Names and the player directory.** Typing a name creates **no** `players` row. The **Players page** nevertheless lists typed names: it is the union of all `players` rows and the distinct `display_name` values of slots with `player_id IS NULL` (query in §5); default labels are never stored, so they never appear. Only the Admin action *Add to directory* (FR-PLAYER-07) creates a `players` row and back-links the matching slots (`UPDATE match_players SET player_id = ?` for the exact, case-insensitive name). Selecting an existing directory player sets `player_id` and snapshots its `display_name`. Because history reads `match_players.display_name` (never `players.display_name`), renaming, deactivating or even deleting a directory player never alters past matches. `ON DELETE SET NULL` on `player_id` means a deleted directory record leaves the historical name intact (the directory UI only offers deactivate, not delete, for players with matches).

### 3.9 `match_games`
Purpose: per-game results (the brief's "sets"). Maintained by the command pipeline from engine state; one row created when a game starts.

| Column | Type | Constraints | Notes |
|--------|------|------------|-------|
| id | INTEGER | PK | |
| match_id | INTEGER | NOT NULL FK → matches(id) ON DELETE CASCADE | |
| game_number | INTEGER | NOT NULL CHECK 1–5 | |
| points_to_win | INTEGER | NOT NULL | this game's target (deciding game may differ) |
| score_a / score_b | INTEGER | NOT NULL DEFAULT 0 CHECK ≥ 0 | |
| first_serving_team | TEXT | NULL CHECK IN ('A','B') | NULL when `matches.serving_mode = 'off'` |
| status | TEXT | NOT NULL CHECK IN ('in_progress','completed','abandoned') | `abandoned` when the match was ended early (END_MATCH) during this game; its score is preserved as the final score of that game |
| winner_team | TEXT | NULL CHECK IN ('A','B') | |
| started_at | INTEGER | NOT NULL | |
| ended_at | INTEGER | NULL | |

Constraints: `ux_match_games_number` UNIQUE `(match_id, game_number)`.
When undo removes a game start, the pipeline **deletes** that game's row (it is derived data; the events remain the record).

### 3.10 `match_events`
Purpose: append-only log of every accepted command for a match — source of truth for scoring, undo, audit and timeline.

| Column | Type | Constraints | Notes |
|--------|------|------------|-------|
| id | INTEGER | PK | |
| match_id | INTEGER | NOT NULL FK → matches(id) ON DELETE CASCADE | |
| seq | INTEGER | NOT NULL | 1,2,3… per match (equals `matches.version` after the event) |
| command_id | TEXT | NOT NULL | client-generated id (≤ 64 chars); server-generated for system-originated events |
| type | TEXT | NOT NULL CHECK IN ('MATCH_CREATED','START_MATCH','RALLY_WON','UNDO','ADJUST_SCORE','START_NEXT_GAME','PAUSE','RESUME','SWAP_SIDES','CONFIRM_MATCH_END','END_MATCH','CANCEL','ADMIN_CORRECTION','UPDATE_PLAYERS','UPDATE_RULES') | `END_MATCH` replaces the former END_EARLY/TERMINATE pair: one command, performed by staff or admin, reason recorded in `payload_json` |
| payload_json | TEXT | NOT NULL DEFAULT '{}' json_valid | command payload |
| game_number | INTEGER | NULL | game the event applied to |
| score_a_after / score_b_after | INTEGER | NULL | current-game score after applying (readability for timeline/audit) |
| serving_team_after | TEXT | NULL CHECK IN ('A','B') | |
| server_number_after | INTEGER | NULL CHECK IN (1,2) | |
| outcome | TEXT | NULL | engine outcome label: `point`, `second_server`, `side_out`, `game_won`, `match_won`, … |
| voided_by_event_id | INTEGER | NULL FK → match_events(id) | set on the undone event, pointing at the UNDO event |
| undoes_event_id | INTEGER | NULL FK → match_events(id) | set on an UNDO event |
| actor_type | TEXT | NOT NULL CHECK IN ('user','system') | `user` = an Admin or Staff member (their role is read from `users.role`); `system` = auto-confirm, auto-release, restart recovery |
| actor_user_id | INTEGER | NULL FK → users(id) | set when `actor_type = 'user'` |
| actor_court_id | INTEGER | NULL FK → courts(id) | the court the acting device was assigned to at that moment ("Maria on Court 3"); NULL for unassigned devices and system events. This is context only — authorization never depends on it |
| created_at | INTEGER | NOT NULL | server time; also passed to engine as `event.at` |

CHECK: `(actor_type = 'user') = (actor_user_id IS NOT NULL)` and `actor_type = 'user' OR actor_court_id IS NULL`.

Constraints: `ux_match_events_seq` UNIQUE `(match_id, seq)`; `ux_match_events_command` UNIQUE `(match_id, command_id)` (idempotency).
Indexes: `ix_match_events_match_seq (match_id, seq)` (covered by unique), `ix_match_events_created_at (created_at)`.
Rules: rows are never updated except setting `voided_by_event_id` once; never deleted (except cascade if a whole match is purged — not exposed in 1.0).

### 3.11 `system_settings`
Purpose: business settings (keys listed in FUNCTIONAL_REQUIREMENTS §12).

| Column | Type | Constraints |
|--------|------|------------|
| key | TEXT | PK |
| value_json | TEXT | NOT NULL json_valid |
| updated_at | INTEGER | NOT NULL |
| updated_by_user_id | INTEGER | NULL FK → users(id) |

The application holds a typed, Zod-validated settings object cached in memory and refreshed on write. Unknown keys are ignored; missing keys fall back to defaults in code.

### 3.12 `audit_logs`
Purpose: administrative and security audit trail (not rally events).

| Column | Type | Constraints | Notes |
|--------|------|------------|-------|
| id | INTEGER | PK | |
| occurred_at | INTEGER | NOT NULL | |
| actor_type | TEXT | NOT NULL CHECK IN ('user','system','anonymous') | anonymous = failed login |
| actor_user_id | INTEGER | NULL FK → users(id) ON DELETE SET NULL | |
| actor_court_id | INTEGER | NULL FK → courts(id) ON DELETE SET NULL | court device the user was on, if any |
| action | TEXT | NOT NULL | dotted key, e.g. `auth.login_failed`, `user.create`, `user.role_change`, `court.create`, `court.update`, `terminal.assign`, `terminal.replace`, `terminal.unassign`, `terminal.sign_out`, `booking.create`, `booking.update`, `booking.cancel`, `booking.no_show`, `player.add_to_directory`, `match.end`, `match.correct`, `settings.update`, `backup.restore` |
| entity_type | TEXT | NULL | `court`, `booking`, `match`, `player`, `format`, `user`, `settings`, `backup` |
| entity_id | TEXT | NULL | |
| details_json | TEXT | NULL json_valid | before/after for edits |
| ip | TEXT | NULL | |

Indexes: `ix_audit_logs_occurred_at (occurred_at DESC)`, `ix_audit_logs_entity (entity_type, entity_id)`, `ix_audit_logs_action (action)`.

### 3.13 Backups (no table)
Backups are files in `<dataDir>/backups/` named `pickle-<YYYYMMDD-HHmmss>-<type>.db` (`type` ∈ scheduled, manual, pre_migration, pre_restore). The file system is the source of truth for the backup list; a table would itself be overwritten by a restore. Each backup carries `PRAGMA user_version` for schema-compatibility checks.

## 4. Derived data and consistency rules

| Data | Source of truth | Derived copies | Rebuild procedure |
|------|----------------|----------------|-------------------|
| Current score/server/phase | `match_events` (non-voided, in `seq` order) + match config | `matches.state_json`, `matches.phase`, `match_games.*`, `matches.games_won_*`, `winner_team` | `replay(config, events)` and rewrite derived rows inside one transaction. A CLI command `rebuild-match <id>` exists for support. |
| Court status | `courts` flags + active/latest match + settings | none (computed per request) | — |
| Court device online | in-memory socket registry (sockets of sessions with `terminal_court_id`) | `user_sessions.last_seen_at` | — |
| Court "Reserved now / Next booking" chip | `bookings` (confirmed) ⨝ clock | none (computed per request) | — |
| Player stats | `match_players` ⨝ `matches` (completed) ⨝ `match_games` | none in 1.0 (queries are fast at this scale) | — |

All derived writes happen in the **same transaction** as the event insert.

## 5. Key queries (index coverage check)

| Query | Index used |
|-------|-----------|
| Active match for court X | `ux_matches_active_court` |
| Latest match for court X | `ix_matches_court_created` |
| Today's matches | `ix_matches_play_date` |
| Utilization in range | `ix_matches_started_at` |
| Events for match (replay) | `ux_match_events_seq` |
| Idempotency lookup | `ux_match_events_command` |
| Player's matches | `ix_match_players_player` |
| Session by token | `user_sessions` PK |
| Device assigned to court X | `ux_user_sessions_terminal_court` |
| Bookings for a court/day (day view), overlap check | `ix_bookings_court_time` |
| Bookings for a date range, all courts | `ix_bookings_play_date` |
| Matches linked to a booking | `ix_matches_booking` |
| Players page (directory ∪ typed names) | `ix_players_normalized_name`, `ix_match_players_player`, `ix_match_players_typed_name` |

### 5a. Players page query (directory ∪ typed names)

```sql
-- Registered players (all, including zero matches)
SELECT 'registered' AS kind, p.id AS player_id, p.display_name AS name,
       COUNT(DISTINCT mp.match_id) AS matches, MAX(m.started_at) AS last_played
FROM players p
LEFT JOIN match_players mp ON mp.player_id = p.id
LEFT JOIN matches m        ON m.id = mp.match_id AND m.status IN ('completed','terminated')
GROUP BY p.id
UNION ALL
-- Typed names (never linked to the directory); default labels are never stored
SELECT 'typed', NULL, mp.display_name COLLATE NOCASE,
       COUNT(DISTINCT mp.match_id), MAX(m.started_at)
FROM match_players mp JOIN matches m ON m.id = mp.match_id AND m.status IN ('completed','terminated')
WHERE mp.player_id IS NULL AND mp.display_name IS NOT NULL
GROUP BY mp.display_name COLLATE NOCASE;
```
Win/loss counts use `completed` matches only (`matches.winner_team` vs. the slot's team); the final SQL is built in the repository layer and covered by tests. Typed-name rows are grouped by name only, which is why the UI labels them "grouped by the name as typed".

## 6. Seed data (first start)

- `match_formats`: the six presets from FR-FORMAT-02, all independent of singles/doubles: **Standard – 1 game to 11** (`is_default=1`: side-out, auto serving, win by 2), **Best of 3 – games to 11**, **1 game to 15**, **1 game to 21**, **Rally scoring – 1 game to 21**, **Score only – 1 game to 11** (rally scoring, `serving_mode = off`).
- `system_settings`: all defaults from FUNCTIONAL_REQUIREMENTS §12.
- No courts, no users (the first `admin` is created via first-run setup; its last step offers "Create courts 1–N", 0–24).

## 6a. Entity checklist against the owner's requirements

| Requirement | Where it lives |
|---|---|
| Two roles (Admin/Owner, Staff) | `users.role IN ('admin','staff')` |
| Dynamic court count (≤ 24 active), activate/deactivate, history kept | `courts` rows; `is_active`; limit rule in §3.3; `matches.court_id ON DELETE RESTRICT` |
| Independent matches per court | `matches` + `ux_matches_active_court`; all events keyed by `match_id` |
| Singles or doubles per match | `matches.play_type`; 2 or 4 `match_players` rows |
| Optional player names, retained history | `match_players.display_name` snapshot (nullable), `player_id` nullable |
| Per-match configuration | rule columns snapshotted on `matches`, `rules_customized` |
| Individual game/set records | `match_games` |
| Score events, undo, audit | `match_events` (+ `voided_by_event_id`) |
| Court device = "Court N", reconnect restores court + match | `user_sessions.terminal_court_id` (server-side), `ux_user_sessions_terminal_court`; match state rebuilt from `matches`/`match_events` |
| Unlimited Staff accounts | `users` has no count constraint (`role = 'staff'` rows unbounded) |
| Booking Schedule | `bookings` + overlap triggers + `matches.booking_id` |
| Players page (all names + histories) | `players` ∪ typed `match_players.display_name` (§5a); `ix_match_players_typed_name` |
| Every action attributed to a person | `matches.created_by_user_id NOT NULL`, `match_events.actor_user_id`, `actor_court_id` |
| Early termination | `matches.status = 'terminated'`, `ended_at`, `end_reason`, `end_note`, `END_MATCH` event, `match_games.status = 'abandoned'`, no winner (CHECK) |

## 6b. Additions made during implementation

`users.last_failed_at` (lockout window), `matches.ended_by_user_id`, `match_events.at` (event time, = `created_at`), and table `create_requests(user_id, client_request_id, match_id, created_at)` for create-match idempotency. See `docs/decisions/003-implementation-details.md`.

## 7. Data retention

Keep everything indefinitely in 1.0 (NFR-CAP-04 shows growth is small). Expired `user_sessions` rows are deleted by the cleanup job. Bookings (including cancelled and no-show) are retained indefinitely. Audit logs are retained indefinitely (Q15).
