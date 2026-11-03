# Implementation status

Built from `docs/planning/` (Revision 3). Verified on macOS (Node 24); **not yet verified on Windows 11 or on real phones/tablets**.

## What is built
| Roadmap phase | Status | Where / how verified |
|---|---|---|
| 0 Scaffold | done | npm workspaces, `npm run check` |
| 1 Shared contracts, permissions, scoring engine | done | `packages/shared`; 60 tests incl. the §12 catalogue, `fast-check` properties, permission matrix, time-zone/booking helpers |
| 2 Server foundation | done | embedded migrations, startup/shutdown, recovery mode, health, loopback shutdown |
| 3 Users, auth, sessions, audit | done | `auth.test.ts` (lockout, idle expiry, forced password change, last-Admin, 40 staff) |
| 4 Courts, device assignment, sockets | done | `courts.test.ts`, `realtime.test.ts` (reconnection restores court + match) |
| 5 Matches and command pipeline | done | `matches.test.ts`, `sim.test.ts` (24 courts, invariants, p95 latency) |
| 6 Booking backend | done | `bookings.test.ts` (overlap, validation, warn-never-block, deactivation flow) |
| 7 Web shell + Court page / console | done | browser tests on a phone viewport |
| 8 Dashboard + Court Management | done | browser tests |
| 9 Booking Schedule UI | done | browser tests (create, conflict message, Staff read-only); drag-to-move/resize implemented, **not** covered by an automated test |
| 10 Histories, Players, presets, Users, corrections | done | `players.test.ts`, `matches.test.ts`, browser tests |
| 11 Analytics | done | `ops.test.ts` |
| 12 Settings, backups, restore, recovery, CLI | done | `ops.test.ts` (restore, corrupt DB recovery, restart persistence) |
| 13 Windows packaging | **files written, never run** | `packaging/` (WinSW XML, Inno Setup, `setup-master.ps1`, `stage.mjs`) |
| Open Play (added after Rev 3) | done | `docs/planning/OPEN_PLAY.md`; shared pairing/standings/time-up tests, migration upgrade test, server integration test (20 players, 4 courts, staggered starts), browser flow |
| 14 Hardening | partly | simulator + route-table authorization tests done; real-device, Windows, power-cut and usability tests **not done** |

## Test inventory (`npm run check`: 166 tests, `npm run e2e`: 15 browser tests)
shared 60 · server integration 68 (auth, route-table permissions for every route × Admin/Staff/anonymous, courts, bookings, matches, players, sockets, reports, backup/restore/recovery, static serving, 24-court simulation) · browser 13 (first-run setup, Admin creates Staff, phone assigned to Court 1, full match with undo, live update on another device, real press-and-hold End match + confirmation, offline → reconnect, booking + overlap rejection, Staff read-only, role gating, Players page typed names, histories, analytics, zero console errors) · Open Play: 20 players on 4 courts, Staff start one court at a time, a finished court waits, round 2 is drawn after the last court, Staff blocked from Admin controls, TV board, end session with final standings, history filter, session length in hours/minutes, player import from .csv and .xlsx.

Open Play tests also include property tests (2–64 players, 1–24 courts, singles and doubles), same-seed determinism, rematch avoidance, time-up/tie rules in the engine, and the upgrade of a populated version-1 database.

## Known gaps / not verified
- Windows 11 install, service start-at-boot, graceful stop, firewall rule, power settings: **unverified**.
- iPhone/iPad Safari, Android Chrome on real devices, Guided Access / kiosk: **unverified** (Chromium phone/tablet viewports only).
- `endMatchHoldMs` default (2 s) is untuned: needs the Phase 14 usability test.
- Load beyond the simulator (100 sockets, 1 000 users, 3-year data sets) is not measured.
- Booking drag-to-move/resize has no automated test.
- HTTPS mode, offline scoring queue, recurring bookings, spectator display: not built (out of scope in the plan).
- Open Play: not yet added to the 24-court simulator (no disconnect/leaving-player stress run); tested on Chromium viewports only; TV board layout checked at desktop width only.
- Open Play fixes after the first browser run: win wording, standings columns, a hidden top-bar badge on phones. Re-check on a real phone.
- Time is displayed in 12-hour format everywhere (UI spec §2.7); time entry in Settings and Backups uses the custom 12-hour picker (`TimeInput12`).
- Open owner decisions Q25–Q36 still run on their documented defaults.
