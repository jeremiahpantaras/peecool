# System Architecture

> Revision 3 — **one application for every device.** The Master PC hosts the single Node service and database; the Master PC, staff PCs and each court's phone/tablet all open the same web app and sign in with a username and password (Admin or Staff). There is no device pairing and no device token: a court device is a session assigned to "Court N". New module: Booking Schedule.

## 1. Recommended stack (final)

| Layer | Choice | Version policy |
|-------|--------|---------------|
| Runtime | **Node.js 24 LTS** (bundled with installer) | LTS until Apr 2028 |
| Language | **TypeScript** (strict) everywhere | current 5.x |
| HTTP server | **Fastify 5** + `@fastify/static`, `@fastify/cookie`, `@fastify/multipart` (backup upload) | current major |
| Validation / types | **Zod** + `fastify-type-provider-zod` | current major |
| Real-time | **Socket.IO 4** (server + `socket.io-client`) | current 4.x |
| Database | **SQLite** via **better-sqlite3** | current major |
| ORM / migrations | ~~Drizzle~~ → plain `better-sqlite3` + embedded SQL migrations (ADR 001) | current |
| Logging | **pino** (built into Fastify) + `pino-roll` for daily file rotation | |
| Frontend | **React 19**, **Vite**, **TypeScript**, **Tailwind CSS 4** | current majors |
| Routing | **React Router** (library/SPA mode) | current major |
| Server-state cache | **TanStack Query** | current major |
| UI primitives | **shadcn/ui** pattern (Radix primitives + Tailwind; components copied into repo) | |
| Icons | **lucide-react** | |
| Charts | **Recharts** | |
| Fonts | **Inter** via `@fontsource-variable/inter` (bundled, offline) | |
| QR code (connecting phones/tablets, Admin) | `qrcode` (generates SVG locally) | |
| Testing | **Vitest** (unit/integration), Fastify `inject` (API), **Playwright** (E2E, multi-browser contexts) | |
| Packaging | Bundled Node runtime + app folder; **Windows 11** service via **WinSW** (v2/3 service wrapper); installer built with **Inno Setup**. Windows 11 x64 is the only supported Master platform in 1.0 (development on macOS/Linux is fine) | |

Nothing else is needed at runtime. Explicitly **not** used: Redis, Postgres, Docker (optional for dev only), Electron, Tauri, cloud auth, CDN assets, service workers (see §9).

## 2. Architecture style

**Modular monolith, single process, server-authoritative, event-sourced scoring.**

```
┌──────────────────────────────────────── Master service (one Node.js process) ─────────────────────────────────────────┐
│                                                                                                                         │
│  HTTP layer (Fastify)                         Real-time layer (Socket.IO, same HTTP server/port)                        │
│  ├─ static: SPA (/, /dashboard, /bookings, …)  ├─ handshake auth: user session cookie (admin|staff)                      │
│  ├─ /api/v1/* REST (Zod-validated)            ├─ rooms: user:<id>, session:<id>, role:<r>, facility, courts:all, court:<id> │
│  └─ auth hook: session + permission           └─ server → client pushes only (plus `subscribe`/`sync` requests with ack)  │
│            │                                               ▲                                                             │
│            ▼                                               │ publish(snapshot)                                           │
│  Application services (modules) ───────────────────────────┘                                                             │
│  ├─ auth+users  ├─ courts (+court devices)    ├─ matches (command pipeline) ├─ players                                │
│  ├─ bookings    ├─ formats      ├─ reports      ├─ settings     ├─ backups     ├─ audit                                  │
│            │                    ▲                                                                                        │
│            ▼                    │ pure function                                                                          │
│  Data layer (Drizzle + better-sqlite3)    Scoring engine (packages/shared/scoring — no I/O)                              │
│            │                                                                                                             │
│            ▼                                                                                                             │
│  SQLite file  <dataDir>/pickle.db  (WAL)                    Scheduler (setInterval jobs): auto-confirm, stale check,    │
│                                                               session cleanup, daily backup, backup verify      │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Why a single process
- SQLite is designed for one writer; one Node process with a synchronous driver gives **natural serialization** of writes with no locking code.
- One port, one service to install, one thing to monitor and restart.
- Capacity needs (NFR-CAP) are ~3 orders of magnitude below what this handles.

## 3. Key decisions and justifications

### 3.1 Fastify over Express
TypeScript-first, built-in schema validation hooks, built-in pino logging, `inject()` for fast API tests without a network, better performance. Express would also work; Fastify reduces boilerplate.

### 3.2 Socket.IO over native WebSocket (`ws`)
Court phones/tablets sit on Wi-Fi that drops. Socket.IO gives, out of the box: automatic reconnection with backoff, heartbeats with configurable timeouts (fast disconnect detection), rooms for per-court fan-out, acknowledgements, and HTTP long-polling fallback for restrictive networks/older browsers. Re-implementing these on `ws` is error-prone. Cost: ~45 KB client bundle — acceptable.

Configuration: `pingInterval: 5000`, `pingTimeout: 5000`, client `reconnectionDelay: 1000`, `reconnectionDelayMax: 5000`, `randomizationFactor: 0.3`, `transports: ['websocket', 'polling']`.

### 3.3 REST for every mutation; Socket.IO for pushes
- **One write path**: every state change is `POST`/`PATCH`/`DELETE` over HTTP → validated → executed in a transaction → response contains the new state. Easy to test (`inject`), easy to retry idempotently, works identically for every client.
- **Socket.IO only pushes** authoritative snapshots and invalidation hints, and serves one read request (`sync`).
- LAN round-trip for an HTTP POST is 5–30 ms; there is no latency reason to send commands over the socket.

### 3.4 better-sqlite3 over `node:sqlite`
`node:sqlite` is still marked as under active development in Node 24; better-sqlite3 is mature, ships prebuilt binaries for Windows/macOS/Linux (x64, arm64), has the online **backup API** we need, and its synchronous API makes "read → validate → write" atomic within one tick. Revisit `node:sqlite` when it is stable (it would remove the native dependency).

### 3.5 Drizzle ORM
Typed schema in TypeScript shared by queries and migration generation, thin over SQL (reports can use raw SQL via `sql` template where clearer), migrations as plain SQL files applied by `migrate()` at startup. Kysely or raw SQL would also be acceptable; do not mix approaches.

### 3.6 Deployment model: OS service + browser, not Electron/Tauri/PWA-only

| Option | Verdict | Reason |
|--------|---------|--------|
| **Node service + browsers (chosen)** | ✅ | Service survives closing the browser window, auto-starts at boot (before anyone logs in to Windows), auto-restarts on crash. Every device — Master PC, staff PCs, court phones/tablets — only needs a browser. One codebase, one login, for all devices. |
| Electron Master app | ❌ for 1.0 | Server lifetime tied to a window (closing it stops every court), larger installer, native-module rebuilds for Electron's Node ABI. Could wrap the web app later as a convenience; not needed. |
| Tauri | ❌ | Requires Rust toolchain plus a Node sidecar for our TypeScript backend — two runtimes for no benefit. |
| Full PWA with service worker | ⚠️ partial | Service workers require a secure context; on `http://192.168.x.x` they are unavailable. We ship a web manifest (home-screen icon, standalone display where supported) but **no service worker** in 1.0. See §9 for the optional HTTPS path. |

### 3.7 One web app, one route tree, two layouts
`apps/web` builds one Vite SPA. Pages are lazily loaded per area (`dashboard`, `bookings`, `courts`, `history`, `players`, `admin`), sharing the design tokens and UI primitives. The **Court page** has two layouts: the *workspace* layout (sidebar frame) and the *console* layout (full-screen scoring, used on court-assigned devices). The console layout must not import heavy workspace-only libraries (Recharts, large table components) — enforced by keeping them in separate lazy chunks (`src/pages/**`, `src/console/**`) and checking the console chunk size in CI (NFR-PERF-03), because phones load it over Wi-Fi.

The server serves `index.html` for every non-API, non-asset path (SPA fallback; routes in `API_SPECIFICATION.md` §7). `/` is resolved on the client: a session assigned to a court goes to `/courts/<id>`, otherwise `/dashboard`, and signed-out visitors to `/login`.

## 4. Dependency justification register

| Runtime dependency | Justification |
|--------------------|---------------|
| fastify, @fastify/static, @fastify/cookie, @fastify/multipart | HTTP server, static UI, cookies, backup upload |
| socket.io / socket.io-client | Real-time with reconnection (§3.2) |
| better-sqlite3, drizzle-orm | Database (§3.4, §3.5) |
| zod, fastify-type-provider-zod | Shared validation |
| pino-roll | Log rotation |
| react, react-dom, react-router | UI |
| @tanstack/react-query | Data fetching/caching/invalidation |
| radix primitives (via shadcn/ui), lucide-react | Accessible UI components, icons |
| recharts | Dashboard analytics charts |
| @fontsource-variable/inter | Offline font |
| qrcode | Offline QR for connecting phones/tablets |

Dev only: typescript, vite, tailwindcss, vitest, fast-check (property tests), playwright, eslint, prettier, drizzle-kit, tsx.

## 5. Repository layout

```
pickle-scoring/
├─ package.json                 # npm workspaces, root scripts: dev, build, check, test, e2e, package
├─ tsconfig.base.json
├─ docs/planning/               # these documents
├─ packages/
│  └─ shared/
│     └─ src/
│        ├─ scoring/            # PURE scoring engine: types, initialState, applyEvent, replay, derive (no I/O, no Date.now)
│        ├─ schemas/            # Zod schemas for every API request/response and socket payload
│        ├─ types/              # inferred TS types, enums (MatchStatus, CourtStatus, CommandType, ErrorCode…)
│        └─ constants.ts
├─ apps/
│  ├─ server/
│  │  ├─ src/
│  │  │  ├─ main.ts             # boot: config → data dir → db open + pragmas → integrity → backup → migrate → app → listen
│  │  │  ├─ app.ts              # Fastify instance, plugins, routes, error handler
│  │  │  ├─ config.ts           # config.json + env overrides (port, host, dataDir, https)
│  │  │  ├─ db/                 # schema.ts (Drizzle), client.ts, migrations/ (SQL)
│  │  │  ├─ modules/<name>/     # routes.ts, service.ts, repo.ts per module
│  │  │  ├─ realtime/           # socket server, auth, rooms, publisher (snapshot builder)
│  │  │  ├─ jobs/               # scheduler + individual jobs
│  │  │  ├─ lib/                # crypto (scrypt, tokens), clock, errors, ids (match code)
│  │  │  └─ cli.ts              # reset-admin-password, backup, restore, print-urls, stop
│  │  └─ test/
│  └─ web/
│     ├─ index.html
│     ├─ public/                # manifest.webmanifest, icons
│     └─ src/
│        ├─ main.tsx, router.tsx
│        ├─ styles/             # tailwind entry + design tokens (@theme)
│        ├─ ui/                 # shared primitives (Button, Dialog, Badge, StatusPill, Timer)
│        ├─ lib/                # api client, socket client, clock offset, ids
│        ├─ pages/              # dashboard, bookings, courts, history, players, admin/* (role-aware, TanStack Query)
│        └─ console/            # full-screen scoring layout, court store (useSyncExternalStore), device assignment
├─ e2e/                         # Playwright tests (multi-court simulations)
└─ packaging/                   # WinSW XML, Inno Setup script, PowerShell setup scripts (firewall, power, IP), build scripts
```

## 6. Communication design

### 6.1 Flows

**Scoring command (any signed-in user; typically the referee on the court's phone/tablet):**
```
Console / Court page               Server                                         Other clients
  │ tap "Rally won A"              │                                              │
  │ disable buttons, pressed state │                                              │
  │ POST /api/v1/matches/42/commands                                              │
  │ {commandId, expectedVersion:17, type:RALLY_WON, payload:{team:"A"}} ─────────►│
  │                                │ 1 authenticate session, check permission     │
  │                                │ 2 BEGIN IMMEDIATE                            │
  │                                │ 3 commandId seen? → return current snapshot  │
  │                                │ 4 version == 17? else 409 VERSION_CONFLICT   │
  │                                │ 5 engine.apply(state, event) (pure)          │
  │                                │ 6 INSERT match_events, UPDATE matches(v=18), │
  │                                │   UPSERT match_games                         │
  │                                │ 7 COMMIT                                     │
  │ ◄──────────── 200 {snapshot v18} │ 8 publish court:snapshot → court:3, courts:all►│
  │ render v18 (ignore socket copy  │                                              │ render v18
  │   if version ≤ current)         │                                              │
```

Steps 2–7 run synchronously (no `await` between read and commit) — with better-sqlite3 this guarantees no interleaving with another command, even without the explicit transaction. Use `db.transaction(fn).immediate()` anyway for clarity and future-proofing.

**Snapshot push**: after any change affecting a court (match command, court edit, device status, maintenance), the publisher builds a `CourtSnapshot` and emits it to `court:<id>` and `courts:all` (sockets that subscribed to every court, e.g. the Dashboard). Pages also receive lightweight `invalidate` hints (e.g. `{keys:["dashboard","matches"]}`) that trigger TanStack Query refetches, so lists and KPIs stay fresh without bespoke socket payloads.

### 6.2 Socket authentication, rooms and subscriptions

Every socket authenticates with the user session cookie (same origin). There is one kind of client.

| Room | Who joins | What flows |
|------|-----------|-----------|
| `user:<userId>` | every socket of that user | forced disconnect on deactivation / role change / password reset |
| `session:<sessionId>` | the sockets of one session | `terminal:changed` (device replaced, unassigned, signed out) |
| `role:admin` / `role:staff` | by role | alerts (Admin gets the full list, Staff the operational subset) |
| `facility` | every socket | low-rate events: `booking:changed`, `activity`, `invalidate`, `settings:updated`, `server:shutdown`, `device:status` |
| `court:<id>` | automatically for the session's **assigned court**; by `subscribe` for any other court the page is showing | `court:snapshot` for that court only |
| `courts:all` | by `subscribe { courts: "all" }` (Dashboard, Court list) | `court:snapshot` for every court |

A phone assigned to Court 3 therefore receives only Court 3's snapshots plus the low-rate `facility` events, which keeps battery and bandwidth small; opening the Dashboard on it subscribes to `courts:all`. Because every signed-in user may *read* every court, subscriptions need only the `courts.view` permission; nothing is written over a socket.

When a user is deactivated, has their role changed or password reset, the server closes that user's sockets (FR-AUTH-12). When a court's device is replaced or signed out, only that session's sockets receive `terminal:changed` / are closed.

**Reconnection restores the right court and match.** The assigned court lives on the server-side session (`user_sessions.terminal_court_id`). It is derived on the server from the session cookie, never from anything the client sends. On every (re)connection the server re-authenticates the cookie, re-joins `user`/`session`/`role`/`facility` and the assigned `court:<id>` room, emits `server:hello` (including the assignment) and pushes the current snapshot, so a refreshed, rebooted or reconnected phone shows the exact match state of its own court. If the session itself has expired, the device shows the sign-in screen and — using the court id remembered in `localStorage` only as a *hint* — offers "Continue as Court N", which calls `PUT /session/terminal` and lands on the same court and match.

On every (re)connection the server immediately emits `server:hello` (server time, version, `instanceId`) and the current `court:snapshot`(s) for the socket's subscriptions. **Clients never rely on having received every intermediate event**; the latest snapshot is always sufficient.

### 6.3 Snapshot-not-diff principle
Snapshots are small (< 4 KB). Sending the whole court state on every change removes an entire class of sync bugs (missed/reordered deltas). Each snapshot carries `match.version` and `snapshotSeq` (monotonic per server instance); clients discard any snapshot older than what they have.

### 6.4 Clock synchronization
Every snapshot and `server:hello` includes `serverTime` (epoch ms). Clients compute `offset = serverTime − (sendLocalTime + receiveLocalTime)/2` for HTTP responses (using `Date.now()` before and after) and `serverTime − Date.now()` for pushes, smoothing with the median of the last 5 samples. Timers render from server timestamps + offset. Device clocks may be wrong; it does not matter.

### 6.5 Authorization model (Admin and Staff)

One module, one table, no scattered role checks:

- `packages/shared/permissions` exports the permission keys of `FUNCTIONAL_REQUIREMENTS.md` §1.1 and a pure `can(actor, key, ctx?)` where `actor` is `{ kind: 'user', role: 'admin' | 'staff' } | { kind: 'system' }`. There is no device actor; `ctx` carries the target resource only where a rule needs it.
- The server resolves the actor in a single Fastify `preHandler`: cookie → `user_sessions` → `users` (role read from the DB row on every request). Each route declares its permission key; the hook calls `can()`; failure → `401`/`403`. A route that declares no permission fails the **route-table test** (completed in Phase 14, extended in every phase), which also asserts the whole Admin × Staff matrix against the documented table.
- **Staff read everything, write only Court Management.** The matrix gives Staff the `*.view`/`*.viewLive`/`matches.history`/`reports.view`/`players.view`/`bookings.view` keys and the court-operation keys (`matches.create|operate|end`, `courts.maintenance|release|terminal`, `formats.select`). Everything else (`bookings.manage`, `courts.manage`, `players.manage`, `matches.correct|export`, `reports.csv`, `users.manage`, `settings.manage`, `audit.view`, `backups.manage`, `formats.manage`) is Admin-only.
- The few payload-shaping rules live in the service layer, not the UI: Admin-only alerts omitted for Staff, and device IP/browser hidden from Staff.
- The UI gets `permissions[]` from `/auth/me` only to render navigation and hide buttons; it is a convenience, never the control.
- Credentials: Admin and Staff authenticate with a username and password (session cookie) on any device. The server never trusts a role sent by the client. A court assignment grants no authority; it only names the device and chooses its start page.
- Sessions are server-side and revocable; deactivation, role change and password reset delete the user's sessions and close their sockets in the same transaction/tick.
- Actor attribution: every `match_events` row and `audit_logs` row names the **user** (`actor_user_id`) and, as context, the court the user's device is assigned to (`actor_court_id`). There are no anonymous device actions, which also resolves the old "who held the tablet?" question (Q29).

## 7. Concurrency, consistency and race conditions

| # | Race / failure | Mitigation |
|---|----------------|-----------|
| R1 | Double tap / bouncing touch on a rally button | Client: 600 ms per-button guard + single in-flight command (buttons disabled until response). Server: `commandId` idempotency. |
| R2 | Request reached server, response lost (Wi-Fi blip), client retries | Same `commandId` reused for the retry; server finds it in `match_events (match_id, command_id)` unique index and returns the current snapshot with `duplicate: true`. Check `commandId` **before** `expectedVersion`. |
| R3 | Two users (e.g. a referee on the court phone and staff on the Master PC) act on the same match simultaneously | `expectedVersion` optimistic concurrency; loser gets `409 VERSION_CONFLICT` + current snapshot; the UI shows an "Updated by <name> (Court N)" toast and re-renders; the user re-taps if still needed. |
| R4 | Two clients create a match on the same court at once | Partial unique index `ux_matches_active_court` → second gets `409 COURT_BUSY`. |
| R5 | Two devices assigned to one court | Partial unique index `ux_user_sessions_terminal_court`; "Replace current device" clears the old assignment and sets the new one in one transaction. |
| R6 | Auto-confirm job vs. user Undo at match end | Job submits `CONFIRM_MATCH_END` through the same pipeline with the version it read; if Undo landed first, the job's command fails with version conflict and is dropped. |
| R7 | Out-of-order socket deliveries / snapshot after HTTP response | Version comparison on the client; never render an older version. |
| R8 | A court's device is replaced or unassigned while scoring | The old session gets `terminal:changed` and returns to the normal home page; commands are authorized by user, not by assignment, so an in-flight command from the old device still succeeds or fails on `expectedVersion` like any other — nothing is lost or duplicated (idempotent `commandId`). |
| R9 | Commands arriving during restore/shutdown | Global `maintenanceGate` flag: new commands get `503 SERVICE_UNAVAILABLE` (retryable); clients show reconnecting state. |
| R10 | Long report query blocking scoring | All report queries indexed and bounded by date range; target < 50 ms; if any exceeds 200 ms in tests, move reports to a `worker_threads` worker with a read-only connection (WAL allows concurrent readers). |
| R11 | Master clock changed (manual or DST) | Store epoch ms (UTC) — DST irrelevant. Manual clock jumps can distort a running timer; documented; admin can correct durations via result correction. |
| R12 | Undo crossing a game boundary or a score adjustment | Undo voids the last undoable event and **rebuilds state by replaying** all non-voided events from match start — never by "reverse-applying" — so any history is handled uniformly. |
| R13 | Stale `localStorage` state on device after server restore | `server:hello.instanceId` / `dbGeneration` change → client discards all cached state and refetches. |
| R14 | Same directory player in two active matches | Soft check with warning (FR-PLAYER-09); not a hard constraint (names can collide legitimately during data entry). |
| R15 | User deactivated or demoted while their browser is open (e.g. Staff → deactivated) | Session row deleted in the same transaction as the change; sockets closed; next REST call `401`. Permission checks read the role from the session's user row on every request (no role cached in the cookie). |
| R16 | Two admins edit the same court/preset/setting/booking | Last write wins for courts/presets/settings; **bookings are protected by the overlap check**, so two simultaneous conflicting bookings cannot both be saved (R19). In all cases the audit log records who changed what (before/after). Not worth optimistic locking for a one-owner facility. |
| R17 | 25th active court created concurrently by two admins | Limit check and insert inside one `BEGIN IMMEDIATE` transaction (single-process write serialization) → second gets `COURT_LIMIT_REACHED`. |
| R19 | Two overlapping bookings saved at the same moment (or a move onto a freshly created booking) | Overlap check inside `BEGIN IMMEDIATE` plus the `tr_bookings_no_overlap_*` triggers; the loser gets `409 BOOKING_CONFLICT` with the winner's details. |
| R20 | A booking is cancelled or edited while its linked match is in progress | The link is a plain foreign key; play is never affected. The match keeps `booking_id`; the booking detail shows the status change. |
| R21 | Staff sign in on a shared tablet one after another | Each login is its own session; the court assignment is cleared on logout; the next staff member sees "Continue as Court N" (one tap) from the browser's hint. Actions are always attributed to whoever is signed in. |
| R18 | Early End match pressed on a stale screen | `expectedVersion` rejects it with the current snapshot (e.g. someone already confirmed the result), so a stale hold-to-end can never terminate a match that has moved on. |

## 8. Scoring engine placement

- Lives in `packages/shared/src/scoring`, pure functions: `createInitialState(config, startParams)`, `applyEvent(state, event, config) → state`, `replay(config, events) → state`, `deriveView(state, config) → { scoreCall, serverName, gamePoint, … }`.
- **Authoritative execution only on the server.** The client imports only `deriveView`-style helpers and types for display; it never computes the next official state.
- Timestamps are passed in on events (`event.at`); the engine never calls `Date.now()` → fully deterministic and testable.
- Details: `MATCH_SCORING_LOGIC.md`.

## 9. Network & transport security choice: HTTP by default, optional HTTPS

Default: plain HTTP on the LAN (port 8080). Rationale: no certificate distribution to every phone/tablet; closed network; threat model in NFR-SEC.

**Revision 3 consequence:** because everyone now signs in with a password from phones and tablets, passwords travel over the staff-only Wi-Fi in clear text. Mitigations, in order: (1) the staff-only SSID uses WPA2/WPA3 with a strong passphrase and is separate from guest Wi-Fi; (2) rate-limited logins with lockout (FR-AUTH-06); (3) Admins may enable `adminLoginMasterPcOnly` so the more powerful credential is never typed on a tablet (FR-AUTH-10); (4) the optional HTTPS mode below is **recommended** for facilities that sign Admins in from tablets (Q9).

Consequences the implementation must respect (NFR-COMPAT-04): no service worker, no `crypto.randomUUID`, no Wake Lock API, cookies without `Secure`.

**Optional HTTPS mode (post-1.0 or for security-sensitive facilities):** the service can be configured with a certificate signed by a facility-local CA (generated by a CLI command); the CA must be installed and trusted on every phone/tablet. Enables service worker app-shell caching (the app loads even while the Master is down) and Wake Lock. Document as an advanced option; not required.

## 10. Local network topology

```
            [ISP modem] (optional — system never needs it)
                 │
          ┌──────┴───────┐
          │  Router /    │ DHCP: reservation for Master PC (e.g. 192.168.10.10)
          │  firewall    │
          └──────┬───────┘
                 │ Ethernet
          ┌──────┴────────────────────┐
          │ Switch                    │
          ├───────────┬───────────────┤
     Ethernet│     PoE  │           PoE │
   ┌─────────┴─┐  ┌─────┴────┐   ┌─────┴────┐
   │ Master PC │  │ AP (zone1)│   │ AP (zone2)│  … more APs as needed (1 per ~4–6 courts, by site survey)
   │ Win 11    │  └─────┬────┘   └─────┬────┘   SSID "Courts-Staff" (WPA2/3, staff-only, no client isolation)
   │ 192.168.10.10 :8080 │ phones/tablets C1–C6   C7–C12 …C24      separate from the public "Guest" SSID
   └───────────┘   (optional front-desk laptop on the same LAN: the same web app, signed in as Staff or Admin)
```

- Master PC **wired** to the switch (confirmed by the owner); each court's phone/tablet on the **staff-only Wi-Fi**; the Master PC has a **fixed IP** (owner-confirmed) — either a Windows static address outside the DHCP pool or a router DHCP reservation. All devices and the Master are on the same subnet.
- App URL (the same for every device): `http://<master-ip>:8080` (or a local DNS name if the router supports static DNS entries, e.g. `http://scoring.lan:8080`). mDNS `.local` names are not reliable on all Android versions; IP is the default.
- Coverage: every court must have reliable signal (≥ −67 dBm) — the single biggest real-world risk (see roadmap risks).

## 11. Configuration

`<dataDir>/config.json` (created at install, editable; env vars override):

| Key | Default | Notes |
|-----|---------|-------|
| `port` | 8080 | |
| `host` | `0.0.0.0` | Listen on all interfaces |
| `dataDir` | `C:\ProgramData\PickleScoring` (Windows 11). Dev default: `./.data` | Contains `pickle.db`, `backups\`, `logs\`, `config.json`. Grant the service account modify rights; exclude from real-time antivirus scanning if it slows SQLite |
| `https` | `null` | `{ certFile, keyFile }` when enabled |
| `logLevel` | `info` | |

Business settings live in the database (`system_settings`), not in this file.

## 12. Startup and shutdown sequence

**Startup**
1. Load config; ensure `dataDir`, `backups/`, `logs/` exist.
2. Open SQLite; set pragmas: `journal_mode=WAL`, `synchronous=FULL`, `foreign_keys=ON`, `busy_timeout=5000`.
3. `PRAGMA quick_check` → if not `ok`: start in **Recovery mode** (only health, auth, backups list/restore routes; the app shows the Admin a recovery screen).
4. If pending migrations: create `pre_migration` backup, then run migrations in a transaction.
5. Seed defaults if empty (presets, settings).
6. Mark active matches whose `last_event_at` is older than `staleMatchMinutes` as `needs_review = 1`.
7. Generate `instanceId` (random) for this run.
8. Start Fastify + Socket.IO; start scheduler.
9. Log the LAN URLs (all non-internal IPv4 interfaces).

**Shutdown (SIGINT/SIGTERM/Windows service stop)**
1. Set `maintenanceGate` (reject new commands with 503).
2. Emit `server:shutdown` to all sockets; close Socket.IO.
3. Close Fastify (waits for in-flight requests, max 5 s).
4. Stop scheduler; `PRAGMA wal_checkpoint(TRUNCATE)`; close DB; exit 0.

**Windows specifics.** Node on Windows does not reliably receive SIGTERM when a service is stopped. The WinSW definition therefore uses `<stopexecutable>` to run `node dist\cli.js stop`, which calls a loopback-only `POST /internal/shutdown` guarded by a random secret file in `dataDir`; WinSW waits up to 15 s (`<stoptimeout>`) before killing the process. A forced kill is still safe for data (SQLite WAL + `synchronous=FULL`, NFR-REL-01); the graceful path only adds the "Master restarting" notice to the tablets and a clean WAL checkpoint. Windows shutdown/restart triggers the same stop path.

## 13. Scheduler jobs

| Job | Interval | Action |
|-----|----------|--------|
| autoConfirm | 5 s | Matches in `match_over` phase with `phase_since + autoConfirmSeconds < now` → submit `CONFIRM_MATCH_END` as `system` |
| courtRelease | 15 s | Re-publish snapshots for courts whose `completed` window expired (status derivation is time-based) |
| staleCheck | 60 s | Raise/clear stale-match alerts |
| deviceHeartbeat | 5 s | For sessions with a court assignment: update `last_seen_at` (batched) and publish online/offline changes (`device:status`) |
| cleanup | 15 min | Delete expired sessions (ordinary sessions past `sessionMaxDays` or idle past `sessionIdleMinutes`; court-assigned sessions past `terminalSessionDays`) |
| bookingWatch | 60 s | Raise/clear the "booking started but no match running" informational alert; re-publish court booking chips when a booking starts or ends |
| dailyBackup | 60 s check | If local time ≥ `backupTime` and no scheduled backup today → backup, prune, copy to extra path |
| backupVerify | weekly | Restore latest backup to temp file, `integrity_check`, delete temp |

All jobs catch and log their own errors; a failing job never crashes the process.

## 14. Error handling strategy

- Domain errors are thrown as `AppError(code, httpStatus, message, details?)`; a global Fastify error handler maps them to the error envelope in `API_SPECIFICATION.md` §2.
- Validation errors (Zod) → `422 VALIDATION_ERROR` with field paths.
- Unexpected errors → `500 INTERNAL_ERROR`, logged with request ID; the client shows a generic message and the request ID.
- Client: a single `apiFetch` wrapper handles the envelope, retries **only** idempotent requests (GET, and commands carrying a `commandId`) on network failure/503 with backoff (max 3 attempts, then surface "Connection problem").

## 15. Scalability validation (24 courts)

| Dimension | Expected at 24 courts | Headroom reasoning |
|-----------|----------------------|--------------------|
| Concurrent matches | 24 (one per court, DB-enforced) | No shared mutable state between courts; each command touches one match's rows |
| Scoring commands | ≈ 1 rally per 15–30 s per court → 1–2 commands/s facility-wide at peak | Target capacity 10 cmd/s (NFR-CAP-03); a command is a few indexed statements, < 5 ms of synchronous DB work |
| Accounts | Unlimited Staff (hundreds are fine: a `users` row each, indexed lookups) | Only *concurrent signed-in sockets* matter for load |
| Socket connections | 24 court phones/tablets + ≈ 10 other signed-in browsers ≈ 35 (design and load-test for 100) | A single Node process handles thousands |
| Broadcast fan-out | A court change → 1 snapshot (< 4 KB) to `court:<id>` (1 device) + `courts:all` (dashboard/list viewers, ≈ 5–10) | ≈ 6–11 messages per command; ≈ 22 messages/s at peak |
| Booking Schedule | ≤ 24 courts × ≈ 30 bookings/day; a day grid is one indexed range query (`ix_bookings_court_time`) | Negligible; overlap check is O(log n) per write |
| Database size | ≈ 6 MB/month; < 50 MB/year (NFR-CAP-04) | SQLite handles GBs; reports are indexed and bounded |
| Wi-Fi | Each tablet needs < 1 kbit/s average; the constraint is **coverage and roaming**, not bandwidth | Site survey; 1 enterprise AP per ≈ 4–6 courts; staff-only SSID so guests cannot compete |
| Single points of failure | Master PC, its power, the switch | UPS, auto-restart service, daily backups, documented replacement procedure |

Conclusion: the single-process design has roughly two orders of magnitude of headroom for 24 courts; the real risks are radio coverage and power, both addressed operationally in `DEPLOYMENT_AND_OFFLINE.md`.
