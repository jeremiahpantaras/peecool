# UI/UX Specification

> Revision 3 — **one application, one login, every device.** The same web app runs on the Master PC, on staff PCs and on the phone/tablet at each court. Both roles see the same five areas (Dashboard, Booking Schedule, Court Management, Game Histories, Players); Staff can change things only in Court Management. A device assigned to a court is simply called **"Court 3"** and opens straight to that court.
> Two layouts, one design system:
> - **Workspace layout** — information-dense, calm, sidebar navigation; desktop/laptop first, usable on tablets and phones (bottom tab bar). Used by every page.
> - **Console layout** — the Court page's scoring screen: glanceable from 5 m, touch-only, minimal, impossible to misread. Used full-screen on a court-assigned device and available full-screen from any device ("Full-screen scoring").
> Match type (Singles/Doubles) is chosen per match; End match is press-and-hold plus confirmation.

## 1. Design principles

1. **The score is the interface.** On the court, nothing competes with the score and the two rally buttons.
2. **Same screens, different powers.** Staff and Admin see the same pages. Controls a role cannot use are **not rendered** (the server still rejects them), and a read-only page says "View only" instead of showing dead buttons.
3. **Never colour alone.** Team identity = label + position + colour. Status = text + icon + colour.
4. **Every scoring action is reversible in one tap; every destructive action needs deliberate confirmation.**
5. **Honest connectivity.** If a device is not connected to the Master, it says so loudly and locks scoring (NFR-OFF-03).
6. **Calm workspace.** Neutral surfaces, colour reserved for status and alerts.
7. **Offline assets only.** Fonts and icons bundled; no external requests.
8. **A court device is named after its court.** Anywhere a device is mentioned the UI says "Court 3" (never a separate device name).

## 2. Design system

### 2.1 Tokens (Tailwind CSS 4 `@theme` CSS variables)

**Neutrals (slate-based)**

| Token | Light | Dark | Use |
|-------|-------|------|-----|
| `--color-bg` | `#F8FAFC` | `#0B1120` | App background |
| `--color-surface` | `#FFFFFF` | `#111827` | Cards, panels |
| `--color-surface-2` | `#F1F5F9` | `#1F2937` | Table header, subtle fills |
| `--color-border` | `#E2E8F0` | `#334155` | Dividers |
| `--color-text` | `#0F172A` | `#F8FAFC` | Primary text |
| `--color-text-muted` | `#475569` | `#94A3B8` | Secondary text |
| `--color-primary` | `#0F766E` (teal-700) | `#2DD4BF` (teal-400) | Primary actions, links, focus |

**Team colours** (colour-blind-safe blue/orange pair; each with a solid and a tint)

| Token | Value | Text on it |
|-------|-------|-----------|
| `--team-a` | `#2563EB` (blue-600) | white |
| `--team-a-tint` | light `#DBEAFE` / dark `#172554` | |
| `--team-b` | `#EA580C` (orange-600) | white |
| `--team-b-tint` | light `#FFEDD5` / dark `#431407` | |

**Status colours** (always paired with label + icon)

| Status | Token | Hue | Icon (lucide) |
|--------|-------|-----|---------------|
| available | `--status-available` | green-600 `#16A34A` | `circle-check` |
| occupied | `--status-occupied` | sky-600 `#0284C7` | `users` |
| in_progress | `--status-live` | emerald-500 `#10B981` + pulsing dot | `activity` |
| paused | `--status-paused` | amber-500 `#F59E0B` | `pause` |
| completed | `--status-completed` | violet-600 `#7C3AED` | `trophy` |
| maintenance | `--status-maintenance` | rose-600 `#E11D48` | `wrench` |
| inactive | `--status-inactive` | slate-400 `#94A3B8` | `circle-slash` |
| device offline | `--status-offline` | rose-600 | `wifi-off` |
| alert/error | `--color-danger` | red-600 `#DC2626` | `alert-triangle` |
| warning | `--color-warning` | amber-600 `#D97706` | `alert-circle` |

### 2.2 Typography
- Font: **Inter Variable**, bundled via `@fontsource-variable/inter`. System fallback stack.
- All numbers that change (scores, timers, KPIs, table numbers): `font-variant-numeric: tabular-nums` so digits do not jitter.

| Token | Workspace | Console (Court page) |
|-------|-------|-------|
| display | 30/36 semibold (KPI values) | score: `clamp(160px, 32vh, 420px)` weight 800, line-height 0.9 |
| h1 | 24/32 semibold | 40–56 px bold (court name / team names) |
| h2 | 18/28 semibold | 28–32 px semibold (score call, timer) |
| body | 14/20 regular | 22–24 px medium |
| small | 12/16 medium | 18 px (minimum on court) |

### 2.3 Spacing, radius, elevation
- 4 px base grid (Tailwind default spacing scale). Workspace page padding 24 px (16 px on phones); card padding 16–20 px; console outer padding 16–24 px.
- Radius: workspace `rounded-lg` (8 px) cards / `rounded-md` inputs; console `rounded-2xl` (16 px) buttons and panels.
- Elevation: workspace uses borders, not shadows (one subtle shadow for popovers/dialogs). Console uses none (high contrast flat).

### 2.4 Core components

| Component | Notes |
|-----------|-------|
| `Button` | Variants: primary, secondary, ghost, danger; sizes sm/md/lg (admin) and `xl` (court ≥ 64 px), `rally` (court, giant). Loading state with spinner; disabled state clearly dimmed. |
| `HoldButton` (console and workspace) | Press-and-hold for `endMatchHoldMs` (**default 2 s**, 1–4 s, to be tuned in usability testing) with a filling progress ring and the label "Hold to end match". A tap does nothing (shows a hint "Keep holding…"); releasing or sliding the finger off before completion cancels and resets the ring; completion triggers a haptic tick where supported and then opens the confirmation dialog (it never finalizes by itself). Used for End match; Cancel-before-start uses an ordinary confirmation dialog. |
| `StatusPill` | Icon + label + colour from §2.1. |
| `CourtCard` | Workspace grid tile (§4.2) with status, score, device state and booking chip. |
| `BookingBlock` | Schedule block (§4.3): confirmed / now / no-show / cancelled variants; text + border style, never colour alone. |
| `RoleBadge` | "Admin" / "Staff" pill in the user menu and Users table. |
| `ViewOnlyTag` | Small muted "View only" label shown on pages where the role cannot change anything (e.g. Staff on Booking Schedule). |
| `ScorePanel` | Console team half (§5.5). |
| `Timer` | Renders from server timestamps + clock offset; `mm:ss` < 1 h, `h:mm:ss` after; tabular. |
| `ConnectionBadge` | Console: green "Connected" / amber "Reconnecting…" / red "Not connected". |
| `ConfirmDialog` | Workspace: title, consequence text, typed reason when required. Console: full-screen sheet, 2 huge buttons. |
| `DataTable` | Workspace: sortable headers, pagination, empty/loading/error states, sticky header, row click → detail. |
| `KpiTile` | Label, value, optional delta vs. yesterday, optional sparkline. |
| `Toast` | Bottom-right (workspace) / top-center large (console); auto-dismiss 4 s; errors persist until dismissed. |
| `EmptyState` | Icon + one sentence + primary action. |

### 2.5 Motion
150–200 ms ease-out for state changes. Score change: number crossfade/scale 1.0→1.06→1.0 (120 ms). Respect `prefers-reduced-motion` (disable scale/pulse).

### 2.6 Accessibility
WCAG 2.2 AA (score text ≥ 7:1). Focus ring 2 px `--color-primary` offset 2 px (workspace). ARIA live region (polite) announces score changes on the console for assistive tech. Minimum console target 64 px (NFR-UX-01). The schedule grid is keyboard-navigable (arrow keys move between cells/blocks, Enter opens details) and exposes booking state in text for screen readers.

### 2.7 Time format

**All times are shown in the 12-hour format with AM/PM** (for example `5:05 PM`, `7:03 PM`), in the facility time zone, regardless of the device's language or region setting. This covers the Dashboard, Booking Schedule (grid labels and the Start/End pickers), booking and conflict messages, Game Histories, Open Play (session end time, TV board clock), the court console, and CSV exports (`2026-11-01, 5:05:00 p.m.`).

- Stored and transmitted values are unaffected: the database and API use epoch milliseconds and `HH:mm` (24-hour) strings. Only display changes.
- Countdowns and durations (`14:15 left`, `1:59:40`, `15 min`) are lengths of time, not clock times, so they are not 12-hour.
- Time entry (Settings → Operating hours for each day, Backups → Daily backup time) uses the app's own 12-hour picker (hour, minute, AM/PM) instead of the browser's native time box, so it never shows 24-hour. It saves the same `HH:mm` value as before.

## 3. Information architecture

### 3.1 Navigation (identical structure for both roles)

One SPA. `GET /auth/me` returns `permissions[]`; navigation and controls are built from them, and the server enforces the same rules. Administration entries are **not rendered** for Staff, and typing an `/admin/…` URL redirects to the dashboard.

**Desktop/tablet (≥ 768 px): left sidebar** (collapsible to icons < 1280 px). **Phone (< 768 px): bottom tab bar** with the five areas; Administration (Admin) sits under "More".

```
[Facility name]   top bar: connection dot · "Court 3 device" chip (when assigned) · user menu
├─ Dashboard             /dashboard            Admin, Staff   (tabs: Live | Analytics)
├─ Booking Schedule      /bookings             Admin (manage), Staff (view only)
├─ Court Management      /courts               Admin, Staff   → /courts/:id (Court page + scoring console)
├─ Game Histories        /history              Admin, Staff   → /history/:id
├─ Players               /players              Admin (manage directory), Staff (view)   → /players/:key
└─ Administration        (Admin only)
   ├─ Users              /admin/users
   ├─ Rule presets       /admin/presets
   ├─ Settings           /admin/settings
   ├─ Audit log          /admin/audit
   └─ Backups            /admin/backups
```

User menu: name + role badge (**Admin** | **Staff**), **My account** (`/account`: change password), **Use this device for Court…** / **Stop using this device for Court 3**, **Full-screen scoring** (on a Court page), **Sign out**.

| Page | Admin sees | Staff sees |
|------|-----------|-----------|
| Dashboard | everything | the same everything (no Admin-only backup alerts) |
| Booking Schedule | grid/agenda + **New booking**, click-to-create, edit, cancel, no-show, CSV | grid/agenda, booking details, "View only" label |
| Court Management | list/grid, **Number of courts**, add/reorder/activate/deactivate, **Sign device out**, plus all match controls and maintenance | list/grid and all match controls and maintenance and release |
| Game Histories | list, detail, **Correct result**, **Export CSV** | list and detail (read-only) |
| Players | list, history, **Add player**, **Add to directory**, **Link name**, edit/deactivate | list and history (read-only) |
| Administration | all | not shown |

### 3.2 Court-device behaviour

```
Sign in on a phone/tablet
  → first time on this device: prompt "Use this device for which court?" (court picker, big "Court 1…Court N" buttons) [Skip]
  → assigned: the app opens /courts/<id>; top bar shows "Court 3"; the user menu still reaches every other page the role may see
  → later visits: the session cookie reopens the same court and match (reconnection restores them)
  → session expired: sign-in screen; after sign-in a card offers "Continue as Court 3" (one tap), or "Choose another court"
```
A device assigned to Court 3 can still open and operate other courts (Q32) — the Court 4 page then shows a subtle "You are on Court 3's device" strip so mistakes are visible. `/courts/:id?debug=1` shows device/session id, version, latency and clock offset (support).

## 4. Workspace screens

### 4.1 Login / First-run setup
- Centered card (400 px). Facility name above. Username, password, "Sign in". Error inline. Lockout message with remaining time. The same screen is shown on every device and for both roles. Phone-friendly: 48 px inputs, `autocomplete` attributes set so staff can use the browser's password manager.
- If the account has `mustChangePassword`, the next screen is "Choose a new password".
- After sign-in on a device that remembers a court: card **"Continue as Court 3"** (primary) / "Choose another court" / "Not a court device". On a device with no memory: the assignment prompt of §3.2.
- First-run (Master PC only): 3 steps — Admin account → Facility name & operating hours → Create courts (number spinner 0–24; the same control later lives on Court Management) → done (shows the app URL + QR for setting up phones/tablets). Staff accounts are created afterwards under Administration → Users.

### 4.2 Dashboard (`/dashboard`) — identical for Admin and Staff

Tabs: **Live** (default) and **Analytics**.

```
┌───────────────────────────────────────────────────────────────────────────────────────────────┐
│ Dashboard   [Live | Analytics]                    Thu 30 Oct · 14:32        ● Live            │
├──────────┬──────────┬──────────┬──────────┬──────────┬──────────┬──────────┬──────────────────┤
│ Courts   │Available │ Active   │Completed │ Matches  │ Bookings │ Next     │ Court devices    │
│   12     │    4     │ matches 7│ today 38 │ today 41 │ today 15 │ 15:00 C5 │ 12 / 12 online   │
├──────────┴──────────┴──────────┴──────────┴──────────┴──────────┴──────────┴──────────────────┤
│ ALERTS (2)  ⚠ Court 5 device offline during match (2 min)   ⚠ Court 9 match idle 24 min  [View]│
├───────────────────────────────────────────────────────────────────┬───────────────────────────┤
│ COURTS                                    [All ▾] [Grid|List]     │ RECENT ACTIVITY           │
│ ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐       │ 14:31 C3 Game 1 → Team A  │
│ │Court 1 ●In prog.│ │Court 2 ○Avail.  │ │Court 3 ●In prog.│       │ 14:29 C7 Match completed  │
│ │A Alex/Jordan  7 │ │                 │ │A  …           11│       │ 14:27 C2 Match completed  │
│ │B Sam/Riley    4◄│ │  Ready for play │ │B  …            8│       │ 14:25 C5 Device offline   │
│ │G2 · 1–0 · 23:41 │ │ 🕒 Next 15:00   │ │ Game over       │       │ …                         │
│ │📶 online        │ │  📶 online      │ │📶 online · 🕒 R. │       │                           │
│ └─────────────────┘ └─────────────────┘ └─────────────────┘       │                           │
└───────────────────────────────────────────────────────────────────┴───────────────────────────┘
```
- KPI row: 8 tiles at ≥ 1440 px, wraps to 4×2 at 1280, 2×4 on tablets, 2-column on phones.
- Court card (min 240 px wide, grid `auto-fill`): header = name + StatusPill; body = two team rows (colour bar, names truncated, current game score large 28 px, ◄ serving marker), footer = game number, games won, timer, device state, **booking chip** ("Reserved now – Maria 18:00–19:00" / "Next 19:00"). Paused cards show an amber strip; maintenance cards show the note; offline device = red `wifi-off` icon + "Offline 2 min". Clicking a card opens the Court page.
- Live updates animate only the changed card.
- **Analytics tab:** date-range picker with presets, court filter, report sub-tabs (Volume · Utilization · Durations · Peak hours · Players · Turnover · Bookings). Each report: chart on top (Recharts: bar for volume, horizontal bar for utilization per court, histogram for durations, heatmap grid (CSS grid) for peak hours), table below. Buttons: **Print / PDF** (everyone), **Export CSV** (Admin only). Print stylesheet: white background, no sidebar, facility name + date range header, page breaks between chart and table.

### 4.3 Booking Schedule (`/bookings`)

**Toolbar:** date picker with ◀ Today ▶, view switch **Day | Week | Agenda**, court filter, search (booked-by / phone), and — **Admin only** — the primary button **New booking**.

**Day view (default):** courts as columns, time as rows (`bookingSlotMinutes` granularity, rows span the operating hours), a "now" line on today.

```
┌ Thu 30 Oct ──────────────────────────────────────────────────────────────────────────────┐
│        │ Court 1      │ Court 2        │ Court 3      │ Court 4 (maintenance) │ Court 5   │
│ 17:00  │              │ ┌────────────┐ │              │ ░░░░░░░░░░░░░░░░░░░░░ │           │
│ 17:30  │ ┌──────────┐ │ │ Maria      │ │              │ ░                     │           │
│ 18:00  │ │ Chen (4) │ │ │ 18:00-19:00│ │ ┌──────────┐ │ ░                     │ ┌───────┐ │
│ 18:30  │ └──────────┘ │ └────────────┘ │ │ Open play│ │ ░                     │ │ Lee   │ │
│ 19:00  │              │  (match ●)     │ └──────────┘ │ ░                     │ └───────┘ │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```
- A booking is a block spanning its time, showing booked-by name, time range, players count; a small ● appears when a match is linked/running. States: **confirmed** (primary tint), **now** (live accent border), **no-show** (rose outline + label), **cancelled** (grey, strikethrough, shown only when "Show cancelled" is on). Blocks on an inactive court carry a warning badge.
- **Admin:** click an empty cell → New booking dialog prefilled with court and start time; click a block → details drawer with Edit / Move / Cancel / Mark no-show; drag a block's edge to change its length and drag the block to move it (snaps to the slot grid; releases show the same validation errors as the dialog). **Staff:** click a block → details drawer (read-only, shows linked matches); empty cells are not clickable; a "View only" tag sits next to the title.
- Overlaps cannot be created: invalid drops snap back with "Court 2 is already booked 18:30–19:00 (Maria)". Past slots are dimmed.
- With 24 courts the grid scrolls horizontally with a sticky time column and sticky court headers. **Phone:** one court at a time with a court picker (swipe to change court) and a vertical timeline.
- **Week view:** one court (picker) × 7 days. **Agenda view:** chronological list grouped by day with court, time, booked-by, phone, status, linked-match chips; filters for status and date range; paginated.

**New/Edit booking dialog (Admin):** Court (active only), Date, Start, End (slot-snapped selectors; end defaults to start + 1 h), Booked by (required), Phone, Players (optional), Notes. Inline validation for overlap, operating hours, max length, advance limit. Footer: Save · Cancel. Edit adds **Cancel booking** (reason field) and **Mark no-show**.

**Dashboard/Court integration:** booking chips on court cards; the Court page has a "Today's bookings" strip; the New-match dialog offers the linkable booking (§5.4).

### 4.4 Court Management (`/courts`, `/courts/:id`)
- **List** (Admin and Staff): grid of court cards on large screens, list on phones, with status, live score, device state and booking chip. Clicking opens the Court page. A "Show inactive" toggle reveals deactivated courts (history one click away).
- **Admin-only controls** on the list page: **Add court**, drag-to-reorder, Activate/Deactivate, and the **Number of courts** stepper ("Active courts: 12 of 24 maximum"): increasing creates the next "Court N" rows after a preview dialog; decreasing opens a checklist of courts to deactivate (idle ones preselected, courts with active matches disabled, courts with future bookings flagged with a keep/cancel choice). At 24 the + button is disabled with the hint "Maximum 24 active courts".
- **Court page** — the scoring console in the workspace frame:
  - **Left (large):** the Live panel: both scores, score call, server name, timer, time-limit bar, games won — followed by the **match controls** (§5): New match · Start · Pause/Resume · Undo · Adjust score · Next game · Swap sides · Edit names · Confirm result · **End match** (hold button, §5.8) · Cancel. A **Full-screen scoring** button switches to the Console layout (§5).
  - **Right:** Court device card ("Court 3 device — online — Maria, last seen 14:32:07"; **Admin only:** IP, browser, **Sign device out**), **Maintenance** toggle with note (**Admin and Staff**), **Release court** (Done), today's bookings (read-only for Staff), today's matches table.
  - On a device assigned to this court the page opens directly in the Console layout.
- **Create match dialog** (Admin and Staff): step 1 Court (pre-selected on a court device; otherwise a picker of available, non-maintenance courts) → the wizard of §5.4: match type, rules, **booking link**, names, then "Create" (court shows "Ready to start") or "Create and start" (adds the serve step).

### 4.5 Game Histories (`/history`, `/history/:id`) — identical for Admin and Staff
- **List:** filter bar (date range presets, court, status, match type, rule preset, player [registered or typed], booking, search) + DataTable (FR-HIST-02 columns). A "Live now" chip links to the Court Management grid. **Export CSV** appears for Admin only. No date window for Staff. Status shows "Completed", "Ended early – Players left" or "Cancelled"; unnamed players show their default labels.
- **Match detail:** header (code, court [inactive tag if deactivated], status pill, match type, rules (custom tag), date, linked booking chip), result block (big game-by-game scores, winner badge — none for ended-early matches, which show "Ended early at 14:52 – final score preserved"), info grid (start, end, duration, playing time, pauses, created by "Maria on Court 3", ended by/reason), players (registered players link to their history; typed names link to their Players-page row), **Event timeline** (vertical list: time, actor "Maria · Court 3", event label, score after; voided events struck through with "undone at hh:mm"). **Admin only:** **Correct result** (dialog with per-game inputs + reason), Edit names / link typed names (finished matches). Print for everyone.

### 4.6 Players (`/players`, `/players/:key`)
- **List — everybody who has played.** Toolbar: search, filter chips **All | Registered | Typed names**, last-played range, sort. Columns: name, type badge (**Registered** or **Typed name**), matches, W–L, last played, status (active/inactive for registered). Paginated; no row limit. Default labels like "Player 1" never appear. Empty state: "No players yet — names appear here after matches are played."
- **History page** (`/players/:key`): header with name, type badge, last played; stat tiles (matches, wins, losses, win %, games W/L, points for/against); a match table (date, court, partner, opponents, score, result chip Won/Lost/Ended early/Cancelled) linking to Game Histories. For **typed names** a banner explains: "Grouped by the name as typed — different people with the same name appear together." (Stats count completed matches only.)
- **Admin only:** **Add player** (name, full name, notes; duplicate warning), edit/deactivate, **Add to directory** on a typed name (dialog previews "This will link 14 past matches"), **Link to existing player** (merge). **Staff:** no such buttons; they can still pick directory players when entering names at a court.

### 4.7 Rule presets (Administration, Admin)
Table of presets with default star; editor sheet with grouped fields (Basics: name, scoring type · Game: points, win by, cap · Match: games to win, deciding game points · Serving: serving mode (automatic / off), first-server rule, track names · Other: switch-ends prompt, time limit) and a live **summary sentence** ("Side-out scoring, best of 3 games to 11, win by 2; game 3 to 15; automatic serving"). There is **no singles/doubles field**: presets apply to both; the match type is chosen per match. Invalid combinations (e.g. side-out with serving off) are blocked inline. Staff see the presets only as choices in the New-match wizard.

### 4.8 Users (Administration → Users, Admin)
- Table (display name, username, role badge Admin/Staff, active, last login, "must change password") with a **search box**, role/active filters and pagination — the facility may have **any number of Staff**, so the list is built for hundreds of rows. Header text: "Staff accounts: 37 (no limit)".
- **Add user** sheet: username, display name, temporary password (with "Generate" button), role (default **Staff**), "Must change password at first login" (default on). Footer buttons **Create** and **Create and add another** (fast entry for onboarding many staff).
- Row actions: edit (name, role), deactivate/reactivate, reset password. The last active Admin's row has Deactivate/demote disabled with an explanation. A short "What can Staff do?" panel summarizes the permission matrix: *"Staff can see everything and run courts (scoring, players on the court, game details, court status). They cannot change bookings, courts' setup, the player directory, users, settings or finished results."*

### 4.9 Settings, Audit log, Backups (Administration, Admin)
Sectioned form pages with explicit Save per section (Facility · Operating hours · Court behaviour · Bookings · Security · Connect a device). **Connect a device** shows the fixed LAN URL ("On each court phone/tablet open **http://192.168.10.10:8080**") plus a QR code and all LAN URLs. Backups: last backup status, "Back up now", list with Download / Restore / Delete, upload-and-restore, extra backup path field with "Test" button. Audit log: filterable table (includes terminal assign/replace/unassign/sign-out and booking actions), JSON details expandable.

### 4.10 My account (`/account`) — both roles
Change password (current + new ×2), shows role, last sign-in, and this device's court assignment with **Stop using this device for Court 3**.

### 4.11 Recovery mode
Full-page red banner "Database problem detected — the system is in recovery mode". Shows integrity check output summary, list of backups with Restore (Admin), and support instructions. No other navigation.

## 5. Court Console (scoring layout of the Court page)

### 5.1 Global frame
- Used full-screen on a court-assigned device (phone or tablet) and on demand via **Full-screen scoring** from any device. No scrolling in any state (landscape 1024×600 minimum to 2560×1600; phones in portrait, §5.6).
- Top bar (56–72 px): court name (left; a ☰ menu opens the user menu — other pages for the role, Stop using this device, Sign out), connection badge, game indicator `Game 2 · Best of 3` (center), timer (right; with remaining time when a limit is set).
- Default **dark theme**; per-device theme toggle (long-press court name → court device menu → Theme) (Q17).

### 5.2 Court assignment and sign-in states
```
┌──────────────────────────────────────────────────────────────────┐
│                  Which court is this device for?                  │
│                                                                   │
│   [ Court 1 ] [ Court 2 ] [ Court 3 ] [ Court 4 ] [ Court 5 ] …   │  ← big buttons, one per active court
│                                                                   │
│   Courts that already have a device show "has a device" and ask   │
│   "Replace the current Court 3 device?" before taking over.       │
│                                      [ Skip – use as a normal PC ]│
└──────────────────────────────────────────────────────────────────┘
```
After choosing, the screen switches to that court's page within 1 s and the user menu reads "Stop using this device for Court 3". If the session has expired, the sign-in screen is shown with the **Continue as Court 3** card (§4.1). If the user's account is deactivated while signed in, the device shows the sign-in screen within 2 s; the match on that court keeps running.

### 5.3 Idle (court available)
Court name (h1), facility name, big **New match** button, the court's **booking chip** ("Reserved now – Maria 18:00–19:00" / "Next booking 19:00 – Chen"), last result summary card ("Last match: Team A def. Team B 11–8", or "Last match ended early"), clock. The phone/tablet is the referee's scoring console; nothing on it invites players to operate it. Maintenance and "Not in service" are full-screen notices with the note text and a wrench icon.

### 5.4 New-match wizard (3 steps; the same flow is used in every workspace dialog)
1. **Match type & rules** — two giant buttons **Singles (1 v 1)** and **Doubles (2 v 2)**: an explicit choice, nothing preselected, **Next** stays disabled until one is tapped. Below, large cards of active rule presets (default preselected and first; e.g. "Standard – 1 game to 11", "Best of 3 – games to 11"). A **Customize rules** link (when `allowRuleOverrides`) expands steppers for target points, win-by (1/2), games to win, point cap, scoring type, serving mode and time limit for this match only; a one-line summary sentence always shows the effective rules, and a "(custom)" tag appears when changed. If the court has a booking that is current or starts within `bookingWarnMinutes`, a **Booking** card appears under the rules: the booking(s) as selectable chips with "No booking" as default. When someone else's booking is current/imminent and none is selected, an amber banner reads "Court 3 is reserved by Maria from 18:00" with **Link to this booking**, **Continue anyway** and **Choose another court** — a warning, never a block.
2. **Players (optional)** — two team columns, each with a team name (optional) and 1 (singles) or 2 (doubles) name fields. Each field shows the default label as its placeholder (Singles: "Player 1" / "Player 2"; Doubles: "Player 1", "Player 2" under each team). Typing 2+ characters opens directory suggestions (rows 56 px); picking one links the player, otherwise the typed text is kept as a typed name (it will appear on the Players page as a "Typed name") and **nothing is added to the directory**. **Skip names** is the primary button when all fields are empty; names are never required.
3. **Serve** — only when serving mode is automatic: "Who serves first?" two giant team buttons. If doubles + track names: "Who starts on the right side?" for each team (two buttons per team with player names or default labels). "Which team is on the left of this screen?" toggle (default A). **Start match**. With serving mode off this step is replaced by a single **Start match** button.

A match created on another device (e.g. the Master PC's Court page → New match) arrives on the court's phone/tablet as step 3 ("Ready to start" with names and rules shown). Rules and match type are locked after Start; before Start the menu offers **Change rules / type** and **Cancel match**.

### 5.5 Live scoring (landscape, primary)

```
┌───────────────────────────────────────────────────────────────────────────────────────────┐
│ COURT 3          ● Connected            GAME 2 · Best of 3                ⏱ 23:41 / 60:00 │
├─────────────────────────────────────────────┬─────────────────────────────────────────────┤
│▌TEAM A                          ● SERVING   │▐                                    TEAM B  │
│▌Alex · Jordan                               │▐                              Sam · Riley   │
│▌Server: Jordan (2nd server) · right court   │▐                                            │
│▌                                            │▐                                            │
│▌               ███████                      │▐                ████                        │
│▌               ██   ██                      │▐               ██  ██                       │
│▌                    ██    ← score ~32vh     │▐                   ██                       │
│▌                    ██                      │▐                  ██                        │
│▌                                            │▐                                            │
│▌ Games ● ○                                  │▐ Games ○ ○                                  │
│▌┌────────────────────────────────────────┐  │▐┌────────────────────────────────────────┐  │
│▌│          RALLY WON — TEAM A            │  │▐│          RALLY WON — TEAM B            │  │
│▌└────────────────────────────────────────┘  │▐└────────────────────────────────────────┘  │
├─────────────────────────────────────────────┴─────────────────────────────────────────────┤
│  CALL  7 – 4 – 2      Last: Rally → Team B (2nd server)   [ ↶ UNDO ]  [ ⏸ PAUSE ]  [ ⋯ ]   │
│  G1: Team A 11–8                                                                          │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```
- Each half: left edge colour bar (team colour, 12 px), team name, player names (server's name bold + small "serving" ball icon), score digits in team colour on dark/neutral background, games-won dots, rally button (team colour, full half-width minus padding, height 18–22 vh, ≥ 140 px).
- **Serving team** half: subtle team-tint background + "● SERVING" label. Receiving half: neutral background.
- Bottom bar: **score call** (largest secondary text, e.g. `7 – 4 – 2`), last action line, Undo (≥ 64 px, always visible, disabled when `canUndo=false`), Pause, overflow menu (⋯: Adjust score, Swap sides, Edit names, **End match**, Court info, Menu). Match type shows as a small "Singles"/"Doubles" tag beside the game indicator.
- **Serving mode off:** no serving marker, server line or service court; the buttons read **POINT — TEAM A / TEAM B** and the call is `7 – 4`.
- **Game point / Match point** badge above the serving team's score.
- **Switch ends** banner: amber full-width strip below the top bar "Switch ends — tap to swap screen sides" (tap = SWAP_SIDES); clears on next rally.
- **Time limit**: timer turns amber at 5 min remaining, red at 0 with banner "Time limit reached".
- Tap feedback: button darkens instantly on pointer-down (< 50 ms), optional `navigator.vibrate(15)` where supported; spinner overlay on the button if the server has not answered within 300 ms.
- While a command is in flight: both rally buttons and Undo disabled (prevents double entry; ≤ 150 ms typical).
- Version conflict toast: "Score updated by Maria (Court 3)" — the acting user and the court their device is assigned to, from the snapshot.

### 5.6 Portrait layout
Teams stacked (Team on `display.leftTeam` → top). Each half: names + score (≈ 22 vh) side-by-side with a rally button. Bottom bar wraps to two rows. Minimum width 360 px (phones); below 600 px the rally buttons span the full width and the bottom bar uses two rows.

### 5.7 Interstitials
- **Game over** (full overlay on top of the score, team-colour accent): "GAME 1 — TEAM A WINS 11–8" · games won summary · buttons **↶ Undo last rally** (secondary) and **Start Game 2 ▶** (primary). Start Game 2 opens the Serve step (defaults: receiving-first team serves; same right-side players; "Teams switched ends — swap screen sides" toggle default ON).
- **Match over**: "TEAM A WINS THE MATCH" · game scores `11–8 · 9–11 · 11–7` · duration · **↶ Undo** and **Confirm result** · "Auto-confirming in 1:47" countdown.
- **Result** (after confirmation): final card (stays until Done or until `completedDisplayMinutes`), **Done** (releases court) and **New match**.
- **Ended early** (after End match): card "MATCH ENDED EARLY — Players left", the preserved game scores (including the unfinished game, e.g. `Game 2: 7–4 (not finished)`), duration and the end time; **no winner is shown**. Buttons **Done** and **New match**. Undo is not offered (the action was deliberate); an Admin can correct it from Game Histories.
- **Paused**: dimmed scoreboard, giant **▶ Resume** button, pause reason if any, paused duration counter.

### 5.8 Dialogs on the court
- **Adjust score**: two big steppers (− / value / +, buttons 80 px) per team, serving team toggle, server number toggle (doubles side-out), server name pick (if tracked), "Players on the right" pick (advanced, collapsed), reason chips ("Missed rallies", "Connection lost", "Wrong server", "Other"). Shows "Old 7–4–2 → New 8–4–1". **Save** / **Cancel**.
- **End match** (owner requirement; available to Staff and Admin on any device). Flow:
  1. Overflow menu → **End match**. A full-screen sheet opens (Cancel is the large, default-focused button) showing the current score summary and **reason chips**: Time up · Injury · Players left · Other (Other reveals a required one-line note).
  2. After a reason is chosen, the **Hold to end match** button becomes active. The referee must **press and hold for ~2 s** (`endMatchHoldMs`; the ring fills; a tap shows "Keep holding…" and does nothing; letting go early resets).
  3. On completion a **confirmation dialog** appears: "End this match? Game 1: Team A 11–8 · Game 2: 7–4 (in progress). The score is kept. **No winner will be recorded.**" with **Cancel** (large) and **Confirm end** (danger).
  4. *Confirm end* sends `END_MATCH` with `confirmed: true`; the status becomes "Ended early" and the tablet shows the Ended early card. The command carries the current `expectedVersion`, so a stale screen cannot end a match that has already moved on.
- **Edit names**: same fields as wizard step 2; clearing a field restores the default label ("Player 1"…). Never creates a directory record.

### 5.9 Connection states (court)

| State | Visual | Scoring |
|-------|--------|---------|
| Connected | Small green "● Connected" | Enabled |
| Blip (< 1.5 s) | No change | Command waits |
| Reconnecting | Amber full-width banner: "Reconnecting to the Master… Keep score on paper if play continues." Last known score dimmed + "last updated 14:31:07" | **Locked** (buttons greyed with lock icon) |
| Master restarting (`server:shutdown`) | Same banner, text "Master is restarting…" | Locked |
| Restored data (`system:restored`) | Full-screen "Reloading…" then reload | — |
| Reconnected | Green toast "Reconnected — score synced". If rallies were played during the outage, scorer uses Adjust score. | Enabled |

### 5.10 Court device menu (long-press court name 2 s)
Theme (dark/light), Screen orientation lock hint, Reload app, Court info (court, signed-in user, app version, Master URL, latency, clock offset), "Stop using this device for Court 3" (requires hold), Sign out.

## 6. Responsive requirements

| Surface | Breakpoints | Behaviour |
|---------|-------------|-----------|
| Workspace (all pages, both roles) | ≥ 1440 (wide), 1280–1439 (desktop, primary), 768–1279 (tablet), < 768 (phone: bottom tab bar, single-column cards, schedule shows one court at a time) | Sidebar collapses to icons < 1280; KPI grid reflows; tables scroll horizontally inside their card |
| Console (Court page full-screen) | Landscape ≥ 1024×600 (primary); portrait ≥ 360×640 (phones) and ≥ 600×960 (tablets); small laptops 1366×768 | Sizes based on `vh`/`vw` with clamps; never scroll; text never below 18 px; on a phone in portrait the teams are stacked (§5.6) |

Testing matrix (Playwright viewports + real devices): iPhone-size 390×844, Android phone 412×915, iPad 10.2" (1080×810 CSS), iPad Pro 11", Galaxy Tab A8 (1340×800), 1366×768 laptop, 1920×1080 desktop.

## 7. Content and tone
- Plain, short, action-first labels: "Rally won", "Undo", "Start Game 2", "Confirm result".
- Errors say what happened and what to do: "Couldn't reach the Master. Scoring is paused until the connection returns."
- Times shown in facility local time, 24 h or 12 h per OS locale (`Intl.DateTimeFormat`).
- Team names default "Team A"/"Team B". Blank players use the default labels: **Singles** — Team A "Player 1", Team B "Player 2"; **Doubles** — each team "Player 1 and Player 2". Exports and logs prefix the team ("Team B: Player 1").
- A device is called by its court ("Court 3"), never by a separate device name; people are called by display name ("Maria").
- Early termination is called **"Ended early"** in the UI (status `terminated` internally); it never uses the words "winner" or "forfeit".
