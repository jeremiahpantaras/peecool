# Decisions: Resolved, To Validate, and Remaining

> Revision 3. Part 1 lists what the facility owner has **confirmed** (Revision 2 and Revision 3). Part 2 holds the five items the owner asked us to validate in Revision 2, with a recommended default and the impact of each alternative (Q3, Q28 and Q29 are now answered by the Revision 3 decisions). Part 3 lists the decisions raised by Revision 3 and by the Windows environment. Part 4 carries over the earlier questions that are still open.
> Every default stated here is already what the other planning documents assume; nothing is silently invented. Priority: **P1** = answer before the related phase starts · **P2** = before release · **P3** = can be decided during testing.

## Part 1 — Resolved by the owner (implemented in the documents)

| # | Decision | Applied in |
|---|----------|-----------|
| R1 | Two match types, **Singles (1 v 1) and Doubles (2 v 2)**, selected when each match is created. | FR-FORMAT-01, `matches.play_type`, wizard step 1, API `playType` |
| R2 | Points start at 0; default target **11**, **win by 2**; separate score per team; each game keeps its own score; multiple games per match; match completion detection; undo and correction. Target and winning condition configurable; **matches may use different configurations**. | MATCH_SCORING_LOGIC §3, FR-FORMAT-05/06 (per-match overrides) |
| R3 | **Referee/authorized staff** create, start, score, pause, advance games, correct, complete and end matches. Players never start or control matches. | FR §1, FR-MATCH-02, Court page |
| R4 | Full match-management controls (create for any court, control any match) are available on every device, including the Master PC, not only at the court. | FR-COURT-08, UI §4.4 |
| R5 | **Player names optional** with default labels (Singles: Player 1 / Player 2; Doubles: Player 1 and Player 2 per team); staff can change names; new names **never** auto-create directory records; directory players can be selected; past matches keep their names. | FR-PLAYER-02..05, `match_players.display_name` snapshot |
| R6 | **Early termination** by staff only: press-and-hold End match (~**2 s**, to be usability-tested) + confirmation; recorded as ended early/terminated; scores and game history preserved; timestamp recorded; **no winner declared**. | FR-MATCH-13, `END_MATCH`, SCORING §5.9, UI §5.8 |
| R7 | Court count configurable by the Admin, **max 24**, unique identifiers, independent scoring interface/state per court, activate/deactivate, **history kept for deactivated courts**. | FR-COURT-01..05,10, DATABASE §3.3 |
| R8 | Master PC: **Windows 11**, desktop/laptop, **wired Ethernet**, **UPS**; optimized for Windows 11. | DEPLOYMENT §2–§6, NFR-COMPAT-03, NFR-OPS-05 |
| R9 | **Two roles only: Admin and Staff**; no Supervisor/Referee account types; documented permission matrix; no player logins. (Revision 3: court devices no longer use pairing — see R13.) | FR §1.1, DATABASE `users`, API §1.1, SYSTEM_ARCH §6.5 |
| R10 | Network: wired Master with **fixed local IP**; court devices on **staff-only Wi-Fi** on the same network; no internet required; firewall, IP and device-setup procedures documented. | DEPLOYMENT §3–§7 |
| R11 | (Earlier Q4) Optional names with directory autocomplete — confirmed by R5. (Earlier Q5) Players may *request* an early end but staff perform it — confirmed by R6. (Earlier Q7) up to 24 courts, Windows 11, wired, UPS — R7/R8. (Earlier Q8) Owner + limited Staff role — R9. (Earlier Q23) staff-only Wi-Fi + fixed IP — R10. | — |
| R12 | **Each court has one phone or tablet, and each device is simply called "Court 1", "Court 2", …** — no separate device names. | FR-TERM-02, DATABASE `user_sessions.terminal_court_id`, UI §3.2 |
| R13 | **Change the logic of the Master PC and the other devices:** the Master PC only *hosts* the service; the **same web app, with the same login, runs on every device** (Master PC, staff PCs, court phones/tablets). There is no pairing, no device token and no separate court interface. | FR §0, SYSTEM_ARCH §3.7/§6.2/§6.5, API §1.1/§3.2, DEPLOYMENT §1/§7 |
| R14 | The system is **logged in by Admins and Staff with the same dashboards and features** (same areas visible). **Staff manage only Court Management** — scoring, players, game details and status — **not "the overall game" and not the booking schedule.** | FR §1.1 (matrix), UI §3.1 |
| R15 | Features: **Dashboards · Booking Schedule/reservation · Court Management · Game Histories · Players (all player names and player histories) · Login/Logout of Admin and Staff.** | FR §3–§6, §10–§11, UI §4 |
| R16 | **The Admin creates Staff accounts, with no limit on the number of Staff.** | FR-AUTH-08, API `POST /users`, NFR-CAP-02/06 |

## Part 2 — Items to validate (owner's list) — recommended defaults and impact

Q25–Q27 remain open for confirmation. **Q3 and Q28 were answered by the Revision 3 decisions** (R13, R14) and are kept below only to show the new outcome.

### Q25 — Match length (owner item 1)
**Question:** Is one game to 11 the default, or should matches support a configurable best-of-three?
**Recommended default:** **Both.** The default preset is **Standard – 1 game to 11 (win by 2)**; **Best of 3 – games to 11** is a seeded one-tap alternative; staff can also customize games-to-win (1, 2 or 3 → best of 1/3/5) and the target for one match. A deciding-game target (e.g. third game to 15) is optional.
| If the owner instead says… | Impact |
|---|---|
| "Best of 3 is the default" | Change which preset is `is_default`; nothing else. |
| "Only one game ever" | Hide `gamesToWin` in the UI/validation; engine unchanged. |
| "Best of 5 needed" | Already supported (`gamesToWin = 3`). |

### Q26 — Scoring method (owner item 2)
**Question:** Enforce traditional side-out scoring, rally scoring, or both?
**Recommended default:** **Provide both, default side-out.** Side-out (server numbers, 0-0-2 start, side outs) is the default and matches standard pickleball rules; rally scoring is a preset/override option (point on every rally). A "Score only" preset (no serving tracking) exists for facilities that want just points.
| If the owner instead says… | Impact |
|---|---|
| "Side-out only" | Remove the rally-scoring preset and hide the scoring-type field; engine keeps the code path unused. |
| "Rally only" | Make *Rally scoring – 1 game to 21* the default and hide side-out; the server-number UI is then never shown. |
| Rally variants (freeze at game point, two server turns) | **Not supported in 1.0** (see Q12); would add engine rules and tests (~2–3 days). |

### Q27 — Serving management (owner item 3)
**Question:** Should the application automatically manage server rotations and side-outs, or should the referee select the server manually?
**Recommended default:** **Automatic, with manual override.** Staff choose only the first server/side at the start; thereafter the engine rotates servers and side-outs from the "rally won" taps. At any moment the referee can override with **Adjust score** (set serving team, server number, server, right-side players). Serving tracking can be switched off per preset/match (`servingMode = off`) for a points-only mode (not allowed with side-out scoring).
| If the owner instead says… | Impact |
|---|---|
| "Referee manages serving manually" | Use the *Score only* preset as the default; the referee tracks the server verbally. No engine change. |
| "Always automatic, no off switch" | Remove `servingMode` from presets; small simplification. |
| "Referee must pick the server each rally" | Not recommended (slower, more error-prone); would require a new input model. |

### Q3 — Match creation (owner item 4) — **answered by R13**
**Outcome:** with one login on every device, **any signed-in Admin or Staff user can create matches on any court from any device** (the court's phone/tablet, the Master PC or any other PC). The former `allowDeviceMatchCreation` setting no longer exists. The creating user and the court of their device are recorded.
| If the owner later wants… | Impact |
|---|---|
| "Only the front desk may create matches; referees only score" | Add a permission key (e.g. `matches.createOnCourt`) and a Staff sub-role — a larger change than a setting; not recommended. |

### Q28 — Staff access to reports and history (owner item 5) — **answered by R14**
**Outcome:** Staff have the **same dashboards and features** as the Admin: they see the Dashboard and its Analytics tab, Game Histories (no date window) and the Players page, all read-only. Only **CSV export** stays Admin-only. The settings `staffCanViewReports` and `staffHistoryDays` were removed.
| If the owner later wants… | Impact |
|---|---|
| "Hide analytics/reports from Staff" | Re-add `reports.view` as an Admin-only key (one table row) and hide the Analytics tab for Staff. |
| "Limit Staff history to recent days" | Re-add a server-side date clamp on `GET /matches` for Staff (small; was implemented in Revision 2). |
| "Staff may export" | Add `matches.export`/`reports.csv` to the Staff column — not recommended (data leaves the system). |

## Part 3 — Decisions raised by Revision 3 and the Windows environment

| # | Pri | Question | Recommended default | Impact if different |
|---|-----|----------|--------------------|---------------------|
| Q29 | — | *(Revision 2)* How is "authorized court staff" identified on the tablet? | **Resolved by R13:** everyone signs in with their own account on every device, so every action is attributed to a named person; no PIN needed. | — |
| Q30 | P2 (before Phase 5) | **Edge permissions (reduced):** may Staff correct the final result of a *finished* match? (Pairing no longer exists; Staff *can* switch maintenance and release courts because "status" is part of their court management.) | **No** — correcting a confirmed or ended-early match is Admin-only; Staff fix mistakes with Undo/Adjust before the result is confirmed. | Making it a Staff right is a one-cell change in the permission table (`matches.correct`) plus tests. |
| Q31 | P1 (before Phase 13) | **Windows details:** (a) Is the Master PC **x64** (not Windows-on-ARM)? (b) Do you want a **code-signed** installer (an annual certificate cost) to avoid SmartScreen warnings, or accept the "Run anyway" prompt? (c) Which UPS model/software? (d) Backup target: USB stick, network share, or both? | (a) x64 assumed. (b) Unsigned, with a documented one-time "Run anyway" step. (c) USB-connected UPS handled by Windows' battery policy (vendor software optional). (d) USB drive. | ARM64 requires an ARM64 Node + native module build (≈ 1–2 days and a test machine). Signing needs a purchased certificate; the build adds a signing step. A network share needs a service account (see deployment §6). |
| Q32 | P1 (before Phase 7) | **Can a Staff user operate any court, or only specific courts?** The owner said Staff manage "the specific court management". | **Any court.** A Staff member can open and run any court (useful for covering a broken phone or a busy desk). A device assigned to "Court 3" opens on Court 3 and shows a "You are on Court 3's device" strip if they operate another court. | Restricting Staff to assigned courts needs a `user_courts` table, a Users-page picker and a `can(…, ctx.courtId)` check (≈ 2–3 days); lock the device's court so it cannot navigate elsewhere (≈ 0.5 day). |
| Q33 | P2 (before Phase 6) | **Booking Schedule scope.** Confirm: (a) entered by the Admin only; (b) no recurring bookings, closure/holiday calendar, deposits/payments, customer accounts or reminders in 1.0; (c) required fields are court, date, start, end and *booked-by name* (phone optional); (d) bookings must fall inside operating hours, ≤ 4 h, ≤ 90 days ahead, 30-min slots; (e) a reservation **warns but never blocks** play. | As listed (a)–(e). | Recurring bookings ≈ 3 days (series table + exceptions); closure calendar ≈ 1 day; self-service booking is a different product (needs customer-facing access). |
| Q34 | P1 (before Phase 9) | **Can Staff *see* the Booking Schedule?** The owner said Staff do not manage it; seeing it lets them know who has reserved a court. | **View-only for Staff** (the same areas are visible to both roles). | Hiding it from Staff: remove the nav item for Staff and `bookings.view` from their column — but then the booking chip/warning on courts would also need hiding (Phase 6/8 change). Letting Staff edit: add `bookings.manage` to Staff — not recommended per the owner. |
| Q35 | P2 (before Phase 10) | **Players page and typed names.** The owner wants the Players page to display *all* player names with histories while typed names must not auto-register. Confirm that typed names are **listed grouped by the name as typed** (case-insensitive), clearly labelled "Typed name", with Admin-only *Add to directory*. | As described. | "Directory only" would hide every name that was typed; "auto-register" contradicts R5. A "merge two typed names" tool would be a small extra. |
| Q36 | P2 (before Phase 3) | **Staff password handling.** Admin sets a temporary password and the new Staff must change it at first login. Should Staff be able to reset their own forgotten password? | **No self-service reset** (no email/internet); the Admin resets it. | Self-service needs a recovery mechanism (security questions or a one-time code printed by the Admin) — not recommended on a LAN-only system. |

## Part 4 — Carried-over questions still open

| # | Pri | Question | Recommended default | Affects |
|---|-----|----------|--------------------|---------|
| Q1 | P3 | The brief says "game/set". Which word should the screens use? | **"Game"** (rules-correct). The database also uses "games". | UI text, reports |
| Q2 | P2 | Final list of rule presets the facility wants seeded? | The six seeded presets (FR-FORMAT-03); Admin can edit/add. | Seed data |
| Q6 | P2 | Time limits per session: warn only, or end automatically? | Optional per preset/match; **warn only** (banner + dashboard alert). Never auto-end (**except Open Play**, see `OPEN_PLAY.md`). | Timer, alerts |
| Q9 | P2 | Should **Admin** sign-in be allowed from phones/tablets and other PCs, or only on the Master PC? (Staff always sign in anywhere.) | **Anywhere on the staff network**; `adminLoginMasterPcOnly` restricts Admin logins to the Master PC; HTTPS (local CA) recommended if Admins sign in on tablets (NFR-SEC-17). | Security, Admin workflow |
| Q10 | P2 | Track timeouts per team? | **No** in 1.0 — "Pause" covers breaks. | Scoring UI |
| Q11 | P3 | Read-only spectator/TV scoreboards later? | Not in 1.0; schema allows it. | Future |
| Q12 | P2 | Rally-scoring variants (freeze rule, server names)? | Plain rally scoring, win by 2, no freeze; serving team and court shown, not the server's name. | Engine |
| Q13 | P2 | Who serves first in games 2 and 3? | The team that **received first** in the previous game; referee can change it. | Game-over screen |
| — | P2 | Is the `0-0-2` start-at-server-2 rule always used? | Yes; `both_servers` available as a preset option. | Presets |
| Q14 | P2 | Operating hours per weekday (utilization %)? | Mon–Sun 07:00–22:00 placeholder; set at first-run setup. | Reports |
| Q15 | P3 | Retention of history and audit logs? | **Forever.** | Retention |
| Q16 | P2 | Backup copy destinations? | Daily on the Master PC (30 kept) plus a USB drive; weekly off-site swap recommended. | Backups |
| Q17 | P3 | Court screen theme default? | **Dark**, switchable per device (outdoor courts may prefer light). | Console UI |
| Q18 | P3 | English-only for 1.0? | **Yes**; text centralized for later translation. | UI |
| Q19 | P3 | Court naming? | "Court 1…N" at setup; editable. | Setup |
| Q20 | P2 | May finished matches be corrected? | Yes, **Admin only**, with a required reason (original kept). See Q30. | Match detail |
| Q21 | P3 | Leaderboards/rankings beyond basic win/loss? | Basic stats only in 1.0. | Reports |
| Q22 | P2 | Alerting for abandoned matches? | Alert after **20 min** without activity; never auto-close; leftovers from yesterday flagged at start-up. | Jobs |
| Q24 | P3 | Branding on court screens/reports? | Facility name only in 1.0. | UI |
| — | P3 | HTTP vs HTTPS on the LAN? | **HTTP** in 1.0; HTTPS optional later. | Deployment |
| — | P2 | After a match ends, how long is the court "Completed" before "Available"? Auto-confirm time? | **5 minutes**; **2 minutes**. | Court status |
| — | P2 | Privacy rules for player names? | Names only, stored locally; no contact details; directory players can be deactivated. | Players |

## Part 5 — Assumptions made in the plan (flag any that are wrong)

1. One facility, one Master PC, up to 24 active courts, unlimited Staff accounts.
2. A basic Booking Schedule is in scope; payments, memberships, recurring bookings, customer self-service, queues and tournaments are not (Q33).
3. A court's phone/tablet is used by the signed-in referee/staff for that court; each person signs in with their own account (shared logins are possible but discouraged — attribution then names the shared account).
4. If the connection to the Master is lost, the device **stops accepting scores** until it reconnects; the referee keeps score on paper and reconciles with "Adjust score"; Staff can score the court from any other device in the meantime.
5. The Master PC's time zone is the facility's time zone.
6. Recreational and club play is the main use, so the scoring console favours speed and simplicity over full referee features (faults, line calls, timeouts).
7. "Ended early" matches never carry a winner; if a result is wanted, the Admin records it by correction.
8. The press-and-hold duration (2 s) and the wizard flow will be tuned during Phase 14 usability testing.
9. "Same dashboards and features" for both roles means the same screens are **visible**; Staff **change** only Court Management (R14, Q34).
10. A reservation never blocks a match (it warns), because stopping a game in progress is worse than a double-booking conversation at the desk.
