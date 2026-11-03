# Non-Functional Requirements

> Revision 3 — one login-based app on every device (no device tokens or pairing); unlimited Staff accounts; Booking Schedule.
> IDs `NFR-<AREA>-<NN>`. Each has a verification method so it can be tested, not just aspired to.
> Reference environment: Master PC = Windows 11 x64 desktop or laptop, 4-core, 8 GB RAM, SSD, wired Ethernet, on a UPS; court device = a 2019-or-newer mid-range Android phone/tablet or iPhone/iPad on 5 GHz Wi-Fi (phones are supported; tablets are preferred for legibility).

## 1. Capacity and scalability (NFR-CAP)

| ID | Requirement | Verification |
|----|------------|-------------|
| NFR-CAP-01 | Support **24 courts** with simultaneous active matches. | Load-simulation script (roadmap Phase 14) |
| NFR-CAP-02 | Support **100 concurrent Socket.IO connections** (24 court phones/tablets + up to 24 future displays + up to 50 other signed-in browsers of Admin/Staff). The **number of Staff accounts is unlimited**; only concurrent connections are bounded. | Same (load test opens 100 sockets) |
| NFR-CAP-03 | Sustain **10 scoring commands/second** aggregate (≈ 40× realistic peak) without breaching NFR-PERF-01. | Same |
| NFR-CAP-04 | Database growth: < 50 MB per year at 24 courts × 14 h/day. (Estimate: ~40 events/game, ~1 KB/event incl. indexes, ~150 matches/day → ~6 MB/month.) No archiving needed in 1.0. | Measure after load test; extrapolate |
| NFR-CAP-05 | History queries, the Players page and reports over **3 years** of data return in < 2 s. | Seed 3 years of synthetic data (incl. 5 000 distinct typed names); time reports |
| NFR-CAP-06 | Booking Schedule: the Day grid for 24 courts and the Week view render from one indexed query in < 300 ms with 3 years of bookings (≈ 24 courts × 30 bookings/day). The Users list (searchable, paginated) stays responsive with 1 000 staff accounts. | Seed synthetic bookings/users; time endpoints |

Scaling beyond one facility or ~50 courts is explicitly **not** a goal; the single-process, single-SQLite design is deliberate.

## 2. Performance (NFR-PERF)

| ID | Requirement | Verification |
|----|------------|-------------|
| NFR-PERF-01 | Scoring command round trip (tap → updated score on the same device) **p95 < 150 ms, p99 < 400 ms** on the LAN. | Instrumented E2E test; server logs command latency |
| NFR-PERF-02 | Broadcast latency (command committed → dashboard card updated on another device) **< 1 s p99**. | E2E test with two browsers |
| NFR-PERF-03 | Court page (console) initial load **< 3 s** on the reference tablet/phone over Wi-Fi (console chunk ≤ 350 KB gzipped JS incl. React and Socket.IO client; workspace-only libraries such as charts are lazy-loaded and never in this chunk). | Lighthouse / bundle analyzer |
| NFR-PERF-04 | Dashboard initial load < 3 s; page navigations < 500 ms with cached data. | Manual + Lighthouse |
| NFR-PERF-05 | Visible tap feedback (pressed state) **< 50 ms** regardless of network; spinner shown if no server response after 300 ms. | Manual on device |
| NFR-PERF-06 | Server cold start (service start → accepting requests) < 10 s including migrations check and integrity quick-check. | Timed start |
| NFR-PERF-07 | No single synchronous database operation on the request path may block the event loop > 50 ms (report queries are the risk; must be indexed and bounded). | Event-loop-lag monitor in dev; log warning if lag > 50 ms |

## 3. Reliability and data integrity (NFR-REL)

| ID | Requirement | Verification |
|----|------------|-------------|
| NFR-REL-01 | **Zero loss of acknowledged commands.** Once the server responds success, the change survives process crash, OS crash and power loss. (SQLite WAL + `synchronous=FULL`; commit before responding.) | Kill-9 and power-cut test during scripted scoring |
| NFR-REL-02 | **Exactly-once command application.** Retried/duplicated commands (same `commandId`) are never applied twice. | Automated duplicate-submission tests |
| NFR-REL-03 | **No lost updates.** Concurrent commands on the same match are serialized; stale ones rejected via `expectedVersion`. | Concurrency tests |
| NFR-REL-04 | Service auto-restarts within 10 s after a crash (OS service manager) and auto-starts at boot. | Kill process, observe |
| NFR-REL-05 | Court devices reconnect automatically within 5 s of the Master becoming reachable again, without user action, **return to their assigned court and show the authoritative match state** (the assignment is server-side on the session; FR-TERM-03). | Restart server during E2E test |
| NFR-REL-06 | Timer accuracy: displayed elapsed time within **±1 s** of server-computed time, across refreshes and reconnects. | E2E test with skewed device clock |
| NFR-REL-07 | Database integrity is checked at every start (`PRAGMA quick_check`) and before each backup; failures enter Recovery mode instead of serving corrupted data. | Corrupt-file test |
| NFR-REL-08 | Scoring-engine determinism: replaying a match's events always produces the identical state. Verified by property tests and on every undo (rebuild-and-compare in development builds). | Property-based tests |
| NFR-REL-09 | Backups are restorable: automated test restores the latest backup into a temp file and runs integrity check weekly (scheduled job) — failure raises an alert. | Job + alert test |

## 4. Offline operation (NFR-OFF)

| ID | Requirement | Verification |
|----|------------|-------------|
| NFR-OFF-01 | **No internet dependency.** All functionality works with the WAN disconnected. The application makes zero outbound requests outside the LAN (fonts, icons, JS all bundled). | Run full E2E suite with outbound traffic blocked; check browser network panel for non-LAN requests |
| NFR-OFF-02 | Loss of Master connectivity is detected by a court device within **≤ 15 s** (Socket.IO heartbeat 5 s interval / 5 s timeout + immediate detection on failed HTTP). | Pull Wi-Fi during test |
| NFR-OFF-03 | While disconnected, the court device **never** shows an editable score that could be mistaken for the official one: scoring buttons locked, prominent banner, last known score dimmed with "last synced hh:mm:ss". | Manual test |
| NFR-OFF-04 | Behaviour in each offline scenario matches `DEPLOYMENT_AND_OFFLINE.md` §5. | Scenario test checklist |

## 5. Security (NFR-SEC)

Threat model: a trusted-ish local network where members of the public may be present and may join Wi-Fi. Goals: stop casual tampering with scores, bookings and system data; protect Admin and Staff credentials (which are now typed on phones/tablets over plain HTTP — see NFR-SEC-17); keep player data on-premises. Not in scope: defending against an attacker with physical access to the Master PC or full control of the LAN.

| ID | Requirement |
|----|------------|
| NFR-SEC-01 | User passwords (Admin and Staff) hashed with Node's built-in `crypto.scrypt` (N=2^15, r=8, p=1, 16-byte random salt, 64-byte key), stored as `scrypt$N$r$p$saltB64$hashB64`; compared with `timingSafeEqual`. No third-party crypto dependency. |
| NFR-SEC-02 | Session tokens: 32 random bytes (base64url). Only their **SHA-256 hashes** are stored in the database. |
| NFR-SEC-03 | Cookies: `HttpOnly`, `SameSite=Strict`, `Path=/`. `Secure` only when HTTPS is enabled (default HTTP on LAN; see `SYSTEM_ARCHITECTURE.md` §9). |
| NFR-SEC-04 | CSRF: state-changing endpoints require `Content-Type: application/json` and the custom header `X-Pickle-Client: 1`; CORS is disabled (same-origin only); `SameSite=Strict`. |
| NFR-SEC-05 | Authorization enforced server-side on every endpoint and socket room join, from the single permission table in `FUNCTIONAL_REQUIREMENTS.md` §1.1: every route requires a valid session and the role's permission (Admin or Staff — never a role claimed by the client). A court assignment grants no authority. |
| NFR-SEC-06 | All inputs validated with shared Zod schemas; unknown fields rejected; string lengths bounded; SQL only via parameterized queries (ORM/query builder). |
| NFR-SEC-07 | Login rate limiting (FR-AUTH-06) and a global per-IP limit on unauthenticated endpoints (login: 20/min/IP). In-memory limiter, no external store. |
| NFR-SEC-08 | Security headers: `Content-Security-Policy: default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; style-src 'self' 'unsafe-inline'` (inline style allowed only for Tailwind runtime-free output if needed), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`. |
| NFR-SEC-09 | First-run setup and the `reset-admin-password` CLI restricted to the Master PC (loopback / local CLI). |
| NFR-SEC-10 | Personal data minimization: only names (and optional notes) for players. No email/phone/photo in 1.0. Data stays on the Master PC and its backups. |
| NFR-SEC-11 | Logs never contain passwords, raw tokens, or full cookie values. |
| NFR-SEC-12 | Network guidance (documented, not enforced): all devices and the Master on a staff/private SSID or VLAN, not the public guest Wi-Fi; Windows firewall rule for the service port scoped to the **local subnet** (profile-independent, so it survives Windows re-classifying an internet-less network as Public). |
| NFR-SEC-13 | **Two roles only** (`admin`, `staff`). A route-table test enumerates every route and asserts that Admin and Staff outcomes match the permission matrix; a route without a declared permission fails the build. |
| NFR-SEC-14 | Privilege boundaries: Staff can **view** every area but can never change bookings, court configuration, the player directory or presets, finished results, users, settings, backups or the audit log, and can never use CSV exports — enforced by the API, not just hidden in the UI. Staff can change only what Court Management covers (scoring, players on a match, game details, court status). |
| NFR-SEC-15 | Role changes, deactivation and password resets revoke the user's sessions and close their sockets within 2 s. The last active Admin can never be removed. |
| NFR-SEC-17 | Because passwords are typed on phones/tablets over plain HTTP, the documented mitigations are mandatory in the install guide: strong WPA2/WPA3 passphrase on a staff-only SSID, login lockout, optional `adminLoginMasterPcOnly`, and an optional HTTPS mode (local CA) recommended when Admins sign in from tablets. A pre-set `must_change_password` flag forces new Staff to replace the temporary password the Admin typed. |
| NFR-SEC-18 | Every action is attributed to a named user (no shared anonymous device identity); the Users page encourages one account per person, and the audit log shows user and court. |
| NFR-SEC-16 | `END_MATCH` requires the explicit `confirmed: true` field and a current `expectedVersion`, so neither a stray request nor a stale screen can terminate a match. |

## 6. Usability and accessibility (NFR-UX)

| ID | Requirement |
|----|------------|
| NFR-UX-01 | Console (court scoring) touch targets **≥ 64 × 64 px**; primary rally buttons ≥ 40 % of screen width and ≥ 140 px tall on a 10" tablet (full width and ≥ 120 px tall on a phone in portrait). Workspace targets ≥ 40 px (44 px on phones). |
| NFR-UX-02 | Score digits legible from **5 m** on a 10" tablet: score font height ≥ 30 % of viewport height in landscape. |
| NFR-UX-03 | Colour contrast WCAG 2.2 AA minimum (score text ≥ 7:1). Team identity never conveyed by colour alone (always label + position + colour). Team colours colour-blind safe (blue vs. orange). |
| NFR-UX-04 | New doubles match startable in **≤ 30 s** by a first-time user with no names, ≤ 60 s with four names. |
| NFR-UX-05 | Every court action that changes the score is reversible with one tap (Undo). Destructive non-scoring actions require explicit confirmation: **End match** requires a deliberate press-and-hold (default **2 s**, configurable 1–4 s, to be tuned in usability testing) **and** a confirmation dialog; cancel-before-start uses a confirmation dialog. A plain tap on End match must never end a match. |
| NFR-UX-06 | Console usable in landscape (primary) and portrait, on tablets and on phones ≥ 360 px wide; workspace pages usable from 1280 px (primary) down to phone width (bottom tab bar, single column; Booking Schedule shows one court at a time on phones). |
| NFR-UX-07 | Workspace UI keyboard-navigable (including the Booking Schedule grid); focus visible; form errors announced (ARIA live regions). |
| NFR-UX-08 | Console supports dark (default) and light high-contrast themes per device. |

## 7. Compatibility (NFR-COMPAT)

| ID | Requirement |
|----|------------|
| NFR-COMPAT-01 | Every page on court phones/tablets: Chrome/Edge (Android 10+, Windows 10+, ChromeOS), Safari (iOS/iPadOS 16+), Firefox (latest 2 versions). |
| NFR-COMPAT-02 | Workspace on PCs: latest 2 versions of Chrome, Edge, Firefox on Windows 11 (the Master PC and front-desk PCs); Safari on macOS best effort. |
| NFR-COMPAT-03 | Master service: **Windows 11 x64** (owner-confirmed deployment target; Pro or Home; desktop or laptop; wired Ethernet). Node.js **24 LTS** is bundled with the installer so no separate runtime install is needed. macOS/Linux are supported for **development only** and are not packaged in 1.0. |
| NFR-COMPAT-04 | The whole app must work over plain **HTTP** on a LAN IP (an insecure context): it must not rely on APIs that require a secure context — `crypto.randomUUID`, Service Workers, Screen Wake Lock, Clipboard API. Use `crypto.getRandomValues` for IDs. |

## 8. Maintainability (NFR-MAINT)

| ID | Requirement |
|----|------------|
| NFR-MAINT-01 | TypeScript `strict: true` across all packages; no `any` in shared/engine code (lint-enforced). |
| NFR-MAINT-02 | Single monorepo (npm workspaces) with `apps/server`, `apps/web`, `packages/shared`. Shared types and Zod schemas are the single definition of API payloads. |
| NFR-MAINT-03 | Scoring engine is a pure, framework-free module with **100 % branch coverage**. |
| NFR-MAINT-04 | Server modules ≥ 80 % line coverage on business logic (services); critical flows covered by E2E tests (Playwright). |
| NFR-MAINT-05 | ESLint + Prettier enforced; `npm run check` (typecheck + lint + test) must pass before merge. |
| NFR-MAINT-06 | Database schema changes only through versioned migrations committed to the repo; migrations run automatically at start after a pre-migration backup. |
| NFR-MAINT-07 | Structured JSON logs (pino) with request IDs, written to the data directory with daily rotation, 14 days retained. |
| NFR-MAINT-08 | All user-visible strings in one module per app to enable later localization. |
| NFR-MAINT-09 | Dependencies minimal and pinned via lockfile; each new runtime dependency must be justified in `SYSTEM_ARCHITECTURE.md` §4. |

## 9. Operability (NFR-OPS)

| ID | Requirement |
|----|------------|
| NFR-OPS-01 | Installation by a non-developer in < 20 minutes following `DEPLOYMENT_AND_OFFLINE.md`. |
| NFR-OPS-02 | `GET /api/v1/health` reports service version, uptime, DB status, last backup time. |
| NFR-OPS-03 | Upgrades preserve data: install new version over old → service restarts → backup → migrations → running. Rollback = reinstall previous version + restore pre-migration backup. |
| NFR-OPS-04 | Clean shutdown on Windows service stop/restart/shutdown: stop accepting commands, finish in-flight transactions, close sockets with a "server restarting" reason, checkpoint WAL, close DB. Implemented through the WinSW `stopexecutable` + loopback shutdown endpoint (`SYSTEM_ARCHITECTURE.md` §12); a forced kill must still lose no acknowledged data. |
| NFR-OPS-05 | **Windows 11 hardening for an unattended server:** service starts at boot without a user logged in; automatic restart on failure; sleep, hibernate and network-adapter power saving disabled; Windows Update Active Hours set; firewall rule for the service port restricted to the local subnet; fixed IP; UPS monitored with a graceful-shutdown policy. Documented as a scripted checklist (`DEPLOYMENT_AND_OFFLINE.md` §2–4). |
| NFR-OPS-06 | Installer and binaries run on a stock Windows 11 machine with Microsoft Defender/SmartScreen enabled (code-signing decision: Q31); no Visual C++ or .NET runtime beyond what Windows 11 ships (WinSW uses the inbox .NET Framework). |
