# API Specification

> Revision 3 — one login for every device (no pairing or device tokens), court devices are sessions assigned to "Court N", Booking Schedule endpoints, Players page endpoints, Staff read access to all areas with write access to Court Management only.
> Base URL: `http://<master-ip>:8080/api/v1`. All bodies are JSON (`Content-Type: application/json`) except backup upload (multipart) and CSV downloads.
> Every request/response shape here must exist as a Zod schema in `packages/shared/src/schemas` and be used by both server (validation) and client (typing). Permission keys (`users.manage`, `matches.operate`, …) are defined in `FUNCTIONAL_REQUIREMENTS.md` §1.1 and implemented once in `packages/shared/permissions`.

## 1. Conventions

| Topic | Rule |
|-------|------|
| Versioning | Path prefix `/api/v1`. Breaking changes → `/api/v2`. |
| IDs | Integers in paths and bodies. Match and booking codes are display-only. |
| Timestamps | Epoch milliseconds (UTC) as numbers. Dates for filters: `YYYY-MM-DD` (facility local date). |
| Pagination | `?page=1&pageSize=25` (max 100). Response: `{ items, page, pageSize, total }`. |
| Sorting | `?sort=field&order=asc|desc` on list endpoints that document it. |
| Required header on mutations | `X-Pickle-Client: 1` (CSRF defence; NFR-SEC-04). Missing → `403 CSRF_HEADER_MISSING`. |
| Server time | Every JSON response includes header `X-Server-Time: <epoch ms>` (clock offset). |
| Request ID | Every response includes `X-Request-Id`; error bodies repeat it. |

### 1.1 Authentication schemes and authorization

There is **one** authentication mechanism for every device — a login session. There are no device tokens, pairing codes or device endpoints.

| Scheme | How sent | Meaning |
|--------|----------|---------|
| `session` | Cookie `ps_session` (HttpOnly) | Any signed-in user, role **admin** or **staff**; the endpoint's permission key then decides |
| `session[A]` | `session` with role `admin` | Admin only |
| `public` | none | Health, setup status, login |
| `local` | Request from loopback (127.0.0.1/::1) | First-run setup |

Authorization is evaluated as `can(user, permissionKey, resource)` in a single server hook. A route-table test (roadmap Phase 3, extended each phase, complete in Phase 14) asserts that every route declares a scheme and a permission, and that the Admin/Staff outcomes equal the matrix in `FUNCTIONAL_REQUIREMENTS.md` §1.1.

**Court assignment is not authorization.** A session assigned to "Court 3" (`PUT /session/terminal`) can still read and operate any court the user's role allows; the assignment only decides which page the device opens and what its name is (Q32).

Role changes and deactivations revoke sessions immediately (the next request is `401`, sockets are closed). While `mustChangePassword` is true, every endpoint except `POST /auth/change-password`, `POST /auth/logout` and `GET /auth/me` returns `403 PASSWORD_CHANGE_REQUIRED`.

## 2. Error model

```json
HTTP 409
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "The match was updated by someone else.",
    "details": { "currentVersion": 18 },
    "requestId": "r-7f3a9c"
  },
  "snapshot": { "...current CourtSnapshot when relevant..." }
}
```

| HTTP | Code | When | Client behaviour |
|------|------|------|-----------------|
| 400 | `BAD_REQUEST` | Malformed JSON | Bug — log |
| 401 | `UNAUTHENTICATED` | No/expired/revoked session | Show the login screen (a court device remembers its court and offers "Continue as Court N" after sign-in) |
| 401 | `INVALID_CREDENTIALS` | Wrong username/password | Inline error |
| 403 | `FORBIDDEN` | Role/permission insufficient (e.g. Staff calling `POST /bookings`) | Show "You don't have access" |
| 403 | `PASSWORD_CHANGE_REQUIRED` | `mustChangePassword` is set | Show the change-password screen |
| 403 | `SETUP_LOCAL_ONLY` | First-run setup requested from a LAN device | Show "Complete setup on the Master PC" |
| 403 | `ADMIN_LOGIN_RESTRICTED` | `adminLoginMasterPcOnly` is on and an Admin signs in from another device | Message |
| 403 | `CSRF_HEADER_MISSING` | Missing `X-Pickle-Client` | Bug |
| 404 | `NOT_FOUND` / `MATCH_NOT_FOUND` / `COURT_NOT_FOUND` / `BOOKING_NOT_FOUND` | | |
| 409 | `VERSION_CONFLICT` | `expectedVersion` stale | Render returned snapshot; toast "Updated elsewhere" |
| 409 | `INVALID_STATE` | Command not allowed in current status/phase | Render returned snapshot |
| 409 | `NOTHING_TO_UNDO` | | Disable Undo |
| 409 | `COURT_BUSY` | Court already has an active match | Show active match |
| 409 | `COURT_UNAVAILABLE` | Court inactive or in maintenance | Show message |
| 409 | `COURT_HAS_DEVICE` | Assigning a device to a court that already has one, without `replaceExisting` | "Replace the current Court N device?" (details: signed-in user, last seen) |
| 409 | `BOOKING_CONFLICT` | Booking overlaps a confirmed booking on the same court | Show the conflicting booking (`details.conflict`) |
| 409 | `BOOKING_WARNING` | Match created on a court whose booking is current/imminent, without a `bookingId` or `acknowledgeBooking: true` | Show the warning; the user may link, proceed, or pick another court (never a hard block) |
| 409 | `DUPLICATE_NAME` | Court name/short code, preset name, username exists | Field error |
| 409 | `ACTIVE_MATCHES_EXIST` | Restore/deactivate with active matches and no `force` | Confirm dialog |
| 409 | `FUTURE_BOOKINGS_EXIST` | Deactivating a court that has future confirmed bookings and no `bookingAction` | Dialog: keep or cancel them (`details.bookings[]`) |
| 409 | `LAST_ADMIN` | Deactivating or demoting the last active Admin | Message |
| 409 | `SHORT_CODE_LOCKED` | Changing a court's short code after it has matches | Field error |
| 422 | `VALIDATION_ERROR` | Zod failure; `details.issues[]` with `path` and `message` (also: `END_MATCH` without `confirmed: true`) | Field errors |
| 422 | `BOOKING_INVALID` | `details.reason` ∈ `COURT_INACTIVE`, `OUTSIDE_HOURS`, `TOO_LONG`, `TOO_FAR_AHEAD`, `IN_PAST`, `NOT_ON_SLOT` | Field error |
| 422 | `COURT_LIMIT_REACHED` | Creating/reactivating would exceed 24 active courts | Message with count |
| 422 | `ADJUST_WOULD_END_GAME` / `INVALID_CORRECTION` / `INVALID_RULES` | Domain validation | Message |
| 423 | `ACCOUNT_LOCKED` | Too many failed logins; `details.retryAfterSeconds` | Message |
| 429 | `RATE_LIMITED` | `Retry-After` header | Back off |
| 503 | `SERVICE_UNAVAILABLE` | Restoring / shutting down / recovery mode | Retry with backoff (idempotent requests only) |
| 500 | `INTERNAL_ERROR` | Unexpected | Show request ID |

## 3. REST endpoints

### 3.1 System

| Method & path | Auth | Description |
|---------------|------|-------------|
| `GET /health` | public | `{ status: "ok"|"recovery", version, uptimeSeconds, serverTime, db: "ok"|"corrupt", lastBackupAt }` |
| `GET /system/info` | `session[A]` (`settings.manage`) | Facility name, version, data dir, LAN URLs `["http://192.168.10.10:8080"]`, URL QR (SVG string) for setting up phones/tablets, Node version, DB size |
| `GET /setup/status` | public | `{ needsSetup: boolean, isLocalRequest: boolean }` |
| `POST /setup` | local | Create the first Admin. Body `{ username, displayName, password, facilityName, courtCount? }` → `201 { user }` + sets session cookie. Fails `409` if any user exists. `courtCount` (0–24) creates "Court 1..N". |

### 3.2 Authentication, court-device assignment and users

| Method & path | Auth | Body → Response |
|---------------|------|-----------------|
| `POST /auth/login` | public | `{ username, password }` → `200 { user: {id, username, displayName, role}, permissions: string[], publicSettings, terminal: { courtId, courtName } | null, mustChangePassword }` + `Set-Cookie: ps_session`. Errors: `401 INVALID_CREDENTIALS`, `423 ACCOUNT_LOCKED`, `403 ADMIN_LOGIN_RESTRICTED`. A new login is never assigned to a court; the client offers "Continue as Court N" from its remembered hint. |
| `POST /auth/logout` | session | → `204`, clears cookie, ends the session (and any court assignment on it) |
| `GET /auth/me` | session | → `{ user, permissions, publicSettings, terminal, mustChangePassword }`. `permissions` is the resolved list of permission keys (the UI uses it to show/hide controls; the server still enforces). `publicSettings` = `{ facilityName, allowRuleOverrides, endMatchHoldMs, autoConfirmSeconds, bookingSlotMinutes, bookingMaxHours, bookingWarnMinutes, operatingHours, maxActiveCourts: 24 }` |
| `POST /auth/change-password` | session (`auth.self`) | `{ currentPassword, newPassword }` → `204` (own other sessions revoked; clears `mustChangePassword`) |
| `PUT /session/terminal` | session (`courts.terminal`) | `{ courtId, replaceExisting?: boolean }` → `200 { terminal: { courtId, courtName } }`. Makes **this device "Court N"**. `409 COURT_HAS_DEVICE` when another session is already assigned and `replaceExisting` is not true; with it, the old assignment is cleared and that device gets `terminal:changed`. Audit `terminal.assign` / `terminal.replace`. |
| `DELETE /session/terminal` | session (`courts.terminal`) | → `204` — "Stop using this device for Court N". Audit `terminal.unassign`. |
| `GET /users` | `session[A]` (`users.manage`) | `?q=&role=&active=&page&pageSize&sort=displayName|lastLoginAt` → paginated users (id, username, displayName, role, isActive, lastLoginAt, mustChangePassword). **No cap on the number of users.** |
| `POST /users` | `session[A]` | `{ username, displayName, password, role: "admin"|"staff", mustChangePassword?: boolean (default true) }` → `201` |
| `PATCH /users/:id` | `session[A]` | `{ displayName?, role?, isActive? }`. `409 LAST_ADMIN` if it would leave no active Admin. Changing role/active revokes that user's sessions and closes their sockets. |
| `POST /users/:id/reset-password` | `session[A]` | `{ newPassword }` → `204`; sets `mustChangePassword`; revokes that user's sessions |

### 3.3 Courts

| Method & path | Auth | Description |
|---------------|------|-------------|
| `GET /courts` | `session` (`courts.view`) | `?includeInactive=false` → `CourtSummary[]`: derived status, `device` `{ online, signedInUser, lastSeenAt } | null`, `booking` `{ now, next }` chip data, current match snapshot. Admin additionally receives the device's IP and browser label. |
| `POST /courts` | `session[A]` (`courts.manage`) | `{ name, shortCode, description?, displayOrder? }` → `201 Court`. `422 COURT_LIMIT_REACHED` if 24 are active. |
| `POST /courts/bulk` | `session[A]` | `{ count: 1-24, namePrefix?: "Court " }` → `201 Court[]`; names/short codes continue from the highest existing number; all-or-nothing; `422 COURT_LIMIT_REACHED` if active + count > 24. Used by the "Number of courts" control and first-run setup. |
| `GET /courts/:id` | `session` | `CourtDetail` = summary + device + today's bookings + today's matches |
| `PATCH /courts/:id` | `session[A]` | `{ name?, shortCode?, description?, isActive?, bookingAction?: "keep"|"cancel" }` (`isActive:false` with active match → `409 ACTIVE_MATCHES_EXIST`; with future confirmed bookings and no `bookingAction` → `409 FUTURE_BOOKINGS_EXIST`; reactivating beyond 24 → `422 COURT_LIMIT_REACHED`; shortCode after first match → `409 SHORT_CODE_LOCKED`) |
| `PUT /courts/order` | `session[A]` | `{ courtIds: number[] }` sets display order |
| `POST /courts/:id/maintenance` | `session` (`courts.maintenance`) | **Admin and Staff.** `{ enabled: boolean, note? }` (`enabled:true` with active match → `409 COURT_BUSY`; future confirmed bookings are returned as `warnings[]`, never cancelled) |
| `POST /courts/:id/release` | `session` (`courts.release`) | Marks the completed court available now (`released_at = now`) |
| `DELETE /courts/:id/device` | `session[A]` (`courts.manage`) | Signs out the device assigned to this court (deletes that session; its browser shows the sign-in screen). Audit `terminal.sign_out`. |
| `DELETE /courts/:id` | `session[A]` | Only if no matches or bookings ever; else `409` |

### 3.4 Booking Schedule

Read access for both roles; changes are Admin only. Bookings are never deleted (`cancel` only).

| Method & path | Auth | Description |
|---------------|------|-------------|
| `GET /bookings/schedule` | `session` (`bookings.view`) | `?from=YYYY-MM-DD&to=YYYY-MM-DD&courtIds=1,2,3` (max 7 days) → `{ days: [{ date, openAt, closeAt }], bookings: Booking[] }` — the data for the Day and Week grids. Includes cancelled/no-show (flagged) so the UI can grey them out. |
| `GET /bookings` | `session` (`bookings.view`) | Agenda/list: `?from&to&courtId&status&q&page&pageSize&sort=startAt` (`q` searches booked-by and phone) |
| `GET /bookings/context` | `session` (`bookings.view`) | `?courtId=3` → `{ now: Booking|null, next: Booking|null, linkable: Booking[] }` — bookings of that court that are current or start within `bookingWarnMinutes`, for the New-match dialog's link/warning |
| `GET /bookings/:id` | `session` (`bookings.view`) | `Booking` + linked matches (id, code, status, score summary) |
| `POST /bookings` | `session[A]` (`bookings.manage`) | `{ courtId, startAt, endAt, bookedByName, phone?, playersCount?, notes? }` → `201 Booking`. Errors: `409 BOOKING_CONFLICT`, `422 BOOKING_INVALID`. |
| `PATCH /bookings/:id` | `session[A]` | Partial update (court, times, details); re-validates overlap and limits; only for `confirmed` bookings |
| `POST /bookings/:id/cancel` | `session[A]` | `{ reason? }` → `200 Booking` (status `cancelled`) |
| `POST /bookings/:id/no-show` | `session[A]` | → `200 Booking` (status `no_show`) |
| `GET /bookings/export.csv` | `session[A]` (`matches.export`) | `?from&to&courtId&status` → `text/csv` |

`Booking`:
```json
{ "id": 18, "code": "B-261030-004", "courtId": 5, "courtName": "Court 5", "courtActive": true,
  "startAt": 1793383200000, "endAt": 1793386800000, "playDate": "2026-10-30",
  "bookedByName": "Maria", "phone": "555-0102", "playersCount": 4, "notes": null,
  "status": "confirmed", "timeState": "upcoming",   // derived: upcoming | now | past
  "createdBy": "Owner", "createdAt": 1793300000000, "cancelReason": null }
```

Bookings never block play: no match endpoint rejects because of a reservation, apart from the soft `409 BOOKING_WARNING` handshake in §3.7.

### 3.5 Players (Players page)

All signed-in users see the page; only Admin manages the directory. A **player key** identifies a row: `r:<playerId>` for a registered player, `t:<urlencoded normalized name>` for a typed name.

| Method & path | Auth | Description |
|---------------|------|-------------|
| `GET /players` | `session` (`players.view`) | **The Players page list: every registered player and every distinct typed name.** `?kind=all|registered|typed&q=&active=&lastPlayedFrom&lastPlayedTo&sort=name|matches|wins|lastPlayed&order&page&pageSize` → `{ items: [{ key, kind: "registered"|"typed", playerId|null, name, isActive, matches, wins, losses, lastPlayedAt }], page, pageSize, total }`. Default labels ("Player 1") are never listed. |
| `GET /players/search` | `session` (`players.view`) | `?q=al&limit=8` → `[{ id, displayName }]` active registered players; min 2 chars. Autocomplete only; never creates anything. |
| `GET /players/:key` | `session` (`players.view`) | Player history page: `{ player: { key, kind, name, fullName?, notes?, isActive }, stats: { matches, wins, losses, winPct, gamesWon, gamesLost, pointsFor, pointsAgainst, lastPlayedAt }, matches: [{ matchId, code, playedAt, courtName, partner, opponents, games, result: "won"|"lost"|"ended_early"|"cancelled" }], note?: "Grouped by the name as typed…" }` (matches paginated: `?page&pageSize`). Stats count `completed` matches only. |
| `POST /players` | `session[A]` (`players.manage`) | `{ displayName, fullName?, notes? }` → `201` (response includes `possibleDuplicates[]`) |
| `PATCH /players/:id` | `session[A]` | `{ displayName?, fullName?, notes?, isActive? }` — never alters past matches (snapshots) |
| `POST /players/typed/add-to-directory` | `session[A]` | `{ name, displayName?, dryRun?: boolean }` — creates a registered player and links every past slot whose typed name equals `name` (case-insensitive, trimmed). `dryRun:true` returns `{ matchesToLink }` only. Audit `player.add_to_directory`. This is the only way a typed name becomes a registered player. |
| `POST /players/:id/link-typed` | `session[A]` | `{ name }` — merge a typed name's past slots into an existing registered player (FR-PLAYER-11) |

### 3.6 Rule presets (match formats)

A preset contains **rules only**; the match type is chosen per match.

| Method & path | Auth | Description |
|---------------|------|-------------|
| `GET /formats` | `session` (`formats.select`) | Staff receive active presets only; Admin may pass `?includeInactive=true` |
| `POST /formats` | `session[A]` (`formats.manage`) | `RulePreset` body (MATCH_SCORING_LOGIC §3, without `playType`). `422 INVALID_RULES` for invalid combinations (e.g. side-out with serving off). |
| `PATCH /formats/:id` | `session[A]` | Partial; affects future matches only |
| `POST /formats/:id/make-default` | `session[A]` | |
| `DELETE /formats/:id` | `session[A]` | Only if never used; else `409` → deactivate instead |

### 3.7 Matches (Court Management and Game Histories)

| Method & path | Auth | Description |
|---------------|------|-------------|
| `POST /matches` | `session` (`matches.create`) | Create (status `setup`) on any active, non-maintenance court. Body below. → `201 { snapshot }`. If the court has someone else's confirmed booking that is current or starts within `bookingWarnMinutes` and the body has neither `bookingId` nor `acknowledgeBooking: true` → `409 BOOKING_WARNING` (`details.booking`); retry with either to proceed. |
| `GET /matches` | `session` (`matches.history`) | Game Histories (**identical for Admin and Staff, no date window**). Filters: `from`, `to` (local dates), `courtId`, `status` (multi), `formatId`, `playType`, `playerKey` (registered or typed), `bookingId`, `q`, `page`, `pageSize`, `sort=startedAt|duration|court`, `order`. |
| `GET /matches/live` | `session` (`matches.viewLive`) | Active matches (setup/in_progress/paused) across all courts |
| `GET /matches/export.csv` | `session[A]` (`matches.export`) | Same filters → `text/csv` |
| `GET /matches/:id` | `session` (`matches.history`) | `MatchDetail` (snapshot + games + players + creator + court device + termination/correction info + linked booking) |
| `GET /matches/:id/events` | `session` (`matches.history`) | Event timeline (incl. voided flags, actor names, court device) |
| `POST /matches/:id/commands` | `session` (`matches.operate` / `matches.end`) | **The single scoring/lifecycle mutation endpoint** (§4). Admin and Staff may act on any court. |
| `PATCH /matches/:id/players` | `session[A]` (`matches.correct`) | Edit names / link typed names to directory players on a **finished** match (audit-logged). During a match staff use the `UPDATE_PLAYERS` command. |
| `POST /matches/:id/correction` | `session[A]` (`matches.correct`) | `ADMIN_CORRECTION` (§4.2) |

Create body:
```json
{
  "courtId": 3,
  "playType": "doubles",                              // REQUIRED: "singles" | "doubles" — chosen per match
  "formatId": 1,                                      // preset (defaults to the default preset when omitted)
  "ruleOverrides": { "pointsToWin": 15, "winBy": 1 }, // optional; only when allowRuleOverrides; validated; sets rules_customized
  "teamAName": "Team A",                              // optional, default "Team A"
  "teamBName": "Team B",                              // optional, default "Team B"
  "players": [                                        // optional entirely; slots not sent are unnamed
    { "team": "A", "slot": 1, "playerId": 12, "displayName": "Alex" },   // selected from the directory
    { "team": "A", "slot": 2, "playerId": null, "displayName": "Jordan" }, // typed name: listed on the Players page, not in the directory
    { "team": "B", "slot": 1, "playerId": null, "displayName": null }    // blank → default label
  ],
  "bookingId": 18,                                    // optional link to a reservation (FR-BOOK-07)
  "acknowledgeBooking": false,                        // true = proceed despite another party's booking (recorded in MATCH_CREATED payload)
  "clientRequestId": "c-01HF…"                        // idempotency for create (unique per user for 10 min)
}
```
`players` slots must be consistent with `playType` (singles: slot 1 only). Names are optional and are trimmed with inner whitespace collapsed; nothing is ever created in the player directory by this call. The creating user and the court their device is assigned to (if any) are stored automatically. Errors: `409 COURT_BUSY`, `409 COURT_UNAVAILABLE`, `409 BOOKING_WARNING`, `422 VALIDATION_ERROR`, `422 INVALID_RULES`.

### 3.8 Dashboard and reports

The Dashboard and its Analytics tab are **identical for Admin and Staff**; only the CSV exports are Admin-only.

| Method & path | Auth | Description |
|---------------|------|-------------|
| `GET /dashboard` | `session` (`dashboard.view`) | `{ kpis: {...incl. bookingsToday, nextBooking}, courts: CourtSummary[], recentActivity: Activity[], alerts: Alert[] }`. Admin-only alerts (backup) are included only for Admin. |
| `GET /reports/volume` | `session` (`reports.view`) | `?from&to&groupBy=day|week|month&courtId` → `{ rows: [{ period, completed, endedEarly, singles, doubles }] }` |
| `GET /reports/utilization` | `session` | `?from&to` → `{ rows: [{ courtId, courtName, courtActive, matches, occupiedMinutes, playingMinutes, operatingMinutes, utilizationPct }], total }` |
| `GET /reports/durations` | `session` | `?from&to&courtId&formatId&playType` → `{ overall: {avg, median, min, max}, byFormat, byCourt, byPlayType, histogram, avgGameMinutes }` |
| `GET /reports/peak-hours` | `session` | `?from&to` → `{ cells: [{ weekday: 1-7, hour: 0-23, avgOccupiedCourts }] }` |
| `GET /reports/players` | `session` | `?from&to&sort` → same rows as `GET /players` for the range |
| `GET /reports/turnover` | `session` | `?from&to` → per-court average gap minutes |
| `GET /reports/bookings` | `session` | `?from&to&courtId` → `{ rows: [{ courtId, courtName, bookedMinutes, operatingMinutes, bookedPct, cancelled, noShow, playedPct }] }` |
| `GET /reports/:name.csv` | `session[A]` (`reports.csv`) | Same query params → CSV (UTF-8 BOM, header row, local-time dates, team-prefixed player names) |

### 3.9 Settings, audit, backups (Admin only)

| Method & path | Auth | Description |
|---------------|------|-------------|
| `GET /settings` | `session[A]` (`settings.manage`) | Full typed settings object |
| `PATCH /settings` | `session[A]` | Partial update, validated; audit-logged with before/after |
| `GET /audit-logs` | `session[A]` (`audit.view`) | `?from&to&action&entityType&entityId&actorUserId&page&pageSize` |
| `GET /backups` | `session[A]` (`backups.manage`) | `[{ fileName, type, createdAt, sizeBytes, schemaVersion }]` |
| `POST /backups` | `session[A]` | Manual backup → `201 { fileName }` |
| `GET /backups/:fileName/download` | `session[A]` | Binary download (`fileName` validated against the list; no path traversal) |
| `POST /backups/:fileName/restore` | `session[A]` | `{ force?: boolean }` → `202`; service enters maintenance gate, restores, emits `system:restored`, clients reload |
| `POST /backups/upload-restore` | `session[A]` | multipart `file` (max 500 MB) + `force` → validates then restores as above |
| `DELETE /backups/:fileName` | `session[A]` | |

## 4. Match commands

### 4.1 Request

`POST /matches/:id/commands`
```json
{
  "commandId": "01JBZ3Q4K8X2M5N7P9R1T3V5W7",
  "expectedVersion": 17,
  "type": "RALLY_WON",
  "payload": { "team": "A" }
}
```
- `commandId`: 16–64 chars `[A-Za-z0-9_-]`, generated by the client with `crypto.getRandomValues` (ULID or base64url random). Reused verbatim on retries of the same action.
- `expectedVersion`: the `version` of the snapshot the user acted on.
- Permission: every type except `END_MATCH` needs `matches.operate`; `END_MATCH` needs `matches.end`. Admin and Staff both hold both keys and may act on any court; the acting user, and the court their device is assigned to, are stored on the event.

| `type` | `payload` | Notes |
|--------|-----------|-------|
| `START_MATCH` | `{ servingTeam?, startRight?: {A,B}, leftTeam? }` | `servingTeam` required if the match's serving mode is `auto`, forbidden if `off` |
| `RALLY_WON` | `{ team }` | serving `auto`: rally result; serving `off`: point to `team` |
| `UNDO` | `{}` | |
| `ADJUST_SCORE` | `{ scoreA, scoreB, servingTeam?, serverNumber?, serverSlot?, rightSlot?, reason? }` | referee's manual override |
| `START_NEXT_GAME` | `{ servingTeam?, startRight?, swapDisplay? }` | |
| `PAUSE` | `{ reason? }` | |
| `RESUME` | `{}` | |
| `SWAP_SIDES` | `{}` | |
| `UPDATE_PLAYERS` | `{ teamAName?, teamBName?, players?: [{team, slot, playerId, displayName}] }` | blank/null `displayName` → default label; never creates directory records |
| `UPDATE_RULES` | `{ playType?, formatId?, ruleOverrides? }` | `setup` status only |
| `CONFIRM_MATCH_END` | `{}` | (system internally after `autoConfirmSeconds`) |
| `END_MATCH` | `{ reason: "time_up"\|"injury"\|"players_left"\|"other", note?, confirmed: true }` | `note` required for `other`; `confirmed` must be literal `true` (the client asserts press-and-hold + confirmation dialog were completed) → status `terminated`, no winner, scores preserved, `ended_at` = now |
| `CANCEL` | `{}` | `setup` status only |

### 4.2 Responses

Success `200`:
```json
{
  "snapshot": { "...CourtSnapshot with match.version = 18..." },
  "event": { "seq": 18, "type": "RALLY_WON", "outcome": "side_out" },
  "duplicate": false
}
```
Duplicate (same `commandId` already applied) → `200` with `"duplicate": true` and the **current** snapshot.

Conflict `409 VERSION_CONFLICT` / `INVALID_STATE` → error envelope **plus** `snapshot`.

Admin correction `POST /matches/:id/correction` (Admin only):
```json
{ "commandId": "…", "expectedVersion": 52, "games": [ { "number": 1, "scoreA": 11, "scoreB": 8 }, { "number": 2, "scoreA": 9, "scoreB": 11 }, { "number": 3, "scoreA": 11, "scoreB": 7 } ], "reason": "Scorer missed final rallies of game 3", "force": false }
```

### 4.3 Client rules for commands
1. One command in flight per client; scoring buttons disabled until resolved.
2. On network error/timeout (5 s) or `503`: retry with the **same** `commandId` and `expectedVersion` — up to 3 attempts at 0.5 s, 1 s, 2 s; then keep the pending command and retry once more automatically after the socket reconnects, then discard with a message if still failing.
3. On `409`: discard the pending command, render the returned snapshot, show a toast.
4. Never apply the command locally before the server answers (no optimistic score).
5. `END_MATCH` is never auto-retried after a reconnect (it is a deliberate, confirmed action): if the answer is lost, the client refetches the snapshot to see whether it took effect.

## 5. Snapshot shapes

### 5.1 `CourtSnapshot`
```json
{
  "snapshotSeq": 4411,
  "serverTime": 1793350000000,
  "court": {
    "id": 3, "name": "Court 3", "shortCode": "3", "isActive": true,
    "status": "in_progress",
    "maintenanceNote": null,
    "device": { "online": true, "signedInUser": "Maria", "lastSeenAt": 1793349999000 },
    "booking": { "now": null, "next": { "id": 18, "bookedByName": "Maria", "startAt": 1793383200000, "endAt": 1793386800000 } }
  },
  "match": { "...MatchSnapshot or null..." }
}
```
`court.device` is `null` when no device is assigned to the court. `match` is the active match, or the most recent match while the court is in `completed` status, otherwise `null`. A snapshot contains only that one court's data, so each court synchronizes independently.

### 5.2 `MatchSnapshot`
```json
{
  "id": 42, "code": "261030-C3-004", "courtId": 3, "version": 18, "bookingId": 18,
  "status": "in_progress", "phase": "playing",
  "playType": "doubles",
  "rules": { "name": "Best of 3 – games to 11", "customized": false, "scoringType": "side_out", "servingMode": "auto",
             "pointsToWin": 11, "winBy": 2, "pointCap": null, "gamesToWin": 2, "decidingGamePoints": null,
             "firstServerRule": "start_server_2", "switchEndsPrompt": "deciding_game",
             "timeLimitMinutes": 60, "trackServerNames": true },
  "teams": {
    "A": { "name": "Team A", "players": [
            { "slot": 1, "displayName": "Alex", "isDefaultLabel": false, "playerId": 12 },
            { "slot": 2, "displayName": "Jordan", "isDefaultLabel": false, "playerId": null } ] },
    "B": { "name": "Team B", "players": [
            { "slot": 1, "displayName": "Player 1", "isDefaultLabel": true, "playerId": null },
            { "slot": 2, "displayName": "Riley", "isDefaultLabel": false, "playerId": 30 } ] }
  },
  "games": [
    { "number": 1, "target": 11, "scoreA": 11, "scoreB": 8, "winner": "A", "status": "completed", "startedAt": 1793347000000, "endedAt": 1793348200000 },
    { "number": 2, "target": 11, "scoreA": 4, "scoreB": 2, "winner": null, "status": "in_progress", "startedAt": 1793348300000, "endedAt": null }
  ],
  "current": {
    "gameNumber": 2,
    "score": { "A": 4, "B": 2 },
    "servingTeam": "A", "serverNumber": 1, "serverSlot": 2,
    "serverName": "Jordan", "serviceCourt": "right",
    "rightSlot": { "A": 2, "B": 1 },
    "scoreCall": "4-2-1",
    "gamePointTeam": null, "matchPointTeam": null,
    "isDecidingGame": false,
    "switchEndsPending": false
  },
  "gamesWon": { "A": 1, "B": 0 },
  "winner": null,
  "end": null,
  "display": { "leftTeam": "B" },
  "timer": { "startedAt": 1793347000000, "pausedAt": null, "pausedTotalMs": 120000, "endedAt": null, "timeLimitMinutes": 60 },
  "phaseChangedAt": 1793348300000,
  "autoConfirmAt": null,
  "canUndo": true,
  "lastAction": { "seq": 18, "type": "RALLY_WON", "team": "A", "outcome": "point", "label": "Rally → Team A (point)" },
  "needsReview": false
}
```
- When `rules.servingMode = "off"`, `servingTeam`, `serverNumber`, `serverSlot`, `serverName`, `serviceCourt`, `rightSlot` are `null` and `scoreCall` is `"4-2"` (Team A first).
- For an early-ended match `status = "terminated"`, `winner = null`, `end = { "reason": "players_left", "note": null, "at": 1793350100000, "byUser": "Maria", "onCourt": "Court 3" }`, and the abandoned game appears in `games` with `status: "abandoned"` and its preserved score.

## 6. Socket.IO

Path `/socket.io` on the same port. Namespace: default `/`. The socket carries **no scoring** (REST only — SYSTEM_ARCHITECTURE §3.3).

### 6.1 Handshake, rooms and subscriptions
- **Handshake:** the session cookie authenticates the socket. Rejected → `connect_error` with `data.code = "UNAUTHENTICATED"`. Every socket joins `user:<userId>`, `session:<sessionId>`, `role:<admin|staff>` and `facility` (low-rate events: settings, bookings, activity, shutdown).
- **Court assignment:** if the session has `terminal_court_id`, the server also joins `court:<courtId>` — the court is derived **on the server from the session**, never from client-supplied state. A device therefore receives only its own court's snapshots until it asks for more.
- **Subscriptions:** `subscribe { courts: "all" | number[] }` (ack: current snapshots) joins `courts:all` (dashboard, court list) or the listed `court:<id>` rooms. Any signed-in user may subscribe to any court (`courts.view`). The Court page subscribes to its one court; the Dashboard to `all`.
- On user deactivation/role change/password reset the server disconnects that user's sockets (FR-AUTH-12). "Replace the current Court N device" and "sign the court's device out" emit `terminal:changed` / disconnect only the affected `session:<id>`.
- Server options: `pingInterval 5000`, `pingTimeout 5000`, `maxHttpBufferSize 64 KB`, CORS off.

### 6.2 Server → client events

| Event | Rooms | Payload | Purpose |
|-------|-------|---------|---------|
| `server:hello` | each socket on connect | `{ serverTime, version, instanceId, dbGeneration, terminal }` | Clock sync; detect restart/restore (instanceId/dbGeneration change → full refetch); confirms the court assignment |
| `court:snapshot` | `court:<id>`, `courts:all` | `CourtSnapshot` | Any change to one court or its match. Courts are independent: an event carries exactly one court. |
| `terminal:changed` | `session:<id>` | `{ courtId|null, reason: "replaced"|"unassigned"|"signed_out" }` | This device is no longer "Court N" → client returns to the normal home page / login |
| `device:status` | `courts:all`, `facility` | `{ courtId, online, signedInUser, lastSeenAt }` | Court-device online/offline (heartbeat ≤ 15 s) |
| `booking:changed` | `facility` | `{ bookingId, courtId, playDate, change: "created"|"updated"|"cancelled"|"no_show" }` | Schedule grids, dashboard chips and Court pages refetch within 1 s |
| `activity` | `facility` | `Activity` `{ at, kind, courtId?, matchId?, text }` | Dashboard feed |
| `alerts` | `role:admin` (full list), `role:staff` (operational subset) | `Alert[]` (full current list) | Alerts panel |
| `invalidate` | `facility` | `{ keys: ("dashboard"|"matches"|"courts"|"bookings"|"players"|"reports"|"settings"|"users")[] }` | TanStack Query invalidation (the refetch is authorized by REST, so a Staff client refetching an Admin-only key simply gets `403`) |
| `settings:updated` | all | public subset of settings | Behaviour flags (hold duration, rule overrides, booking limits) |
| `server:shutdown` | all | `{ reason: "restart"|"restore"|"stop" }` | Show "Master restarting" immediately |
| `system:restored` | all | `{}` | Hard reload |

### 6.3 Client → server events

| Event | Payload | Ack | Purpose |
|-------|---------|-----|---------|
| `subscribe` | `{ courts: "all" | number[] }` | `CourtSnapshot[]` | Choose which courts this client follows |
| `sync` | `{}` | `CourtSnapshot[]` for the current subscriptions | Explicit resync (e.g. after visibility change) |
| `time:ping` | `{ t0 }` | `{ t0, serverTime }` | Precise clock-offset sample (optional; HTTP header also works) |

### 6.4 Client reconnection algorithm (court device)
```
on disconnect → state = "reconnecting"; lock scoring UI after 1.5 s grace (avoid flicker on brief blips)
Socket.IO auto-reconnects (1 s → 5 s backoff, jittered)
on connect → the session cookie authenticates → server re-joins user/session/role/facility rooms and court:<terminal_court_id>
             → receive server:hello (carries `terminal` = the assigned court, from the server)
   if instanceId/dbGeneration changed → discard local caches
   subscribe(current scope) → receive the authoritative CourtSnapshot → render the exact court/match state → state = "connected" → unlock UI
   if a pending command exists → resend once with same commandId (see §4.3; not for END_MATCH)
on connect_error UNAUTHENTICATED (session expired/revoked) → login screen; after sign-in, offer "Continue as Court N" (court id remembered in localStorage as a hint) → PUT /session/terminal → same court page, same match
```
Because the assignment lives on the server-side session, a refresh, reboot, Wi-Fi drop or Master restart brings the device back to the **correct court and match** without any user action while the session is valid.

## 7. Static routes (non-API)

| Path | Serves |
|------|--------|
| `/` | SPA index.html — redirects (client-side) to `/courts/<terminalCourtId>` for a court device, otherwise `/dashboard`, or `/login` when signed out |
| `/login`, `/dashboard`, `/bookings`, `/courts`, `/courts/:id`, `/history`, `/history/:id`, `/players`, `/players/:key`, `/account` | SPA index.html — the five areas plus login and the user's own account/password page (same SPA for both roles; it reads `permissions` from `/auth/me` to decide which controls to show) |
| `/admin/users`, `/admin/settings`, `/admin/presets`, `/admin/audit`, `/admin/backups` | SPA index.html — Administration (Admin only; Staff are redirected to `/dashboard`, and the APIs return `403`) |
| `/assets/*` | Hashed Vite assets, `Cache-Control: public, max-age=31536000, immutable` |
| `/manifest.webmanifest`, icons | Web manifest (`start_url: /`, `display: standalone`, `orientation: any`) |
| index.html | `Cache-Control: no-cache` (so upgrades are picked up on reload) |
