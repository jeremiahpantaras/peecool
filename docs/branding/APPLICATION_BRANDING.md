# Peecool: Applying the identity to the product

Phase 0 changed **no application code, schema, API or business logic**. The only additions are `apps/web/public/brand/` (assets, unreferenced) and `docs/branding/`. This file is the handoff for the implementation phase.

## 1. What exists today (verified in the repository)
| Area | Status |
|---|---|
| Shell: 240 px sidebar (`md+`), phone tab bar; shows the **facility name** (`layout/Shell.tsx:42`) | built |
| Login with first-run setup (`pages/Login.tsx`) | built |
| Dashboard (live view + Analytics tab: 7 reports, Print/PDF, Admin-only CSV) | built. **No separate Reports or Analytics page** |
| Booking Schedule (drag-to-move/resize has no automated test) | built |
| Court Management, Court page, scoring console (`console/Console.tsx`, `parts.tsx`, `Dialogs.tsx`, `Wizard.tsx`, `pages/CourtPage.tsx`) | built |
| Game Histories, Match detail | built (**no standalone "Match Management" page**) |
| Players, Player detail, spreadsheet import | built |
| Open Play: sessions, session page, TV board | built |
| Users, Presets, Settings, Audit, Backups | built (Admin) |
| Recurring bookings, HTTPS mode, offline scoring queue, spectator display | **not built** (out of scope in the plan) |
| Windows 11 install and service, real phones and tablets, load beyond the 24-court simulator | **unverified** |

Theming: `lib/theme.ts` sets `data-theme`; the workspace defaults to the system theme, the court console to the dark theme (`courtTheme`), and the `ps_theme` device preference overrides both.

## 2. Master System (Windows 11 Master PC, Admin and Staff workspace)
Information-dense: white cards on cream, hairline borders, 16 px gaps; Geist Regular page titles; one hero KPI tile in court green with a lime value per screen; Geist Bold (tabular) for every number; Geist Regular for labels. Sidebar: facility name first, active item filled with primary, footer "Powered by Peecool". Dashboard charts follow DESIGN_SYSTEM §1.4. Tables: compact, right-aligned tabular numbers, status pills. Read-only Staff views keep the "View only" tag.

## 3. Court Scoring System (court phone/tablet)
Dark theme by default, light optional. Score digits at `--score-size` (48cqh) in team colours; team = colour + name + serving tag; lime marks the serving team and Live only; all targets ≥ 64 px; ending a match stays press-and-hold. Keep the existing `score-pop` and reconnecting lock. Show the facility's court label ("Court 4") in Geist Regular. Below a 3:2 aspect ratio (iPad landscape) stack the two team panels so the digits stay large (see DESIGN_SYSTEM §2).

## 4. Open Play Management
Round cards, winners/losers groups, waiting chips, standings with Geist Bold ranks, and the TV board in the dark theme at console scale. Same status vocabulary as courts.

## 5. Application icon, favicon, loading, website
- **Icons:** replace `apps/web/public/icon.svg` and the `/icon.svg` references (`index.html`, `Shell.tsx:87`, `Login.tsx:21`) with `/brand/app-icon.svg` / `/brand/favicon.svg`; `index.html` gets `apple-touch-icon` → `/brand/apple-touch-icon.png`.
- **Manifest:** `name` "Peecool", `short_name` "Peecool", `theme_color` #0D3F27, `background_color` #06150D; icons: 192, 512, 512 maskable PNG plus the SVG.
- **Loading screen:** Court 800 background, perforation-dot field fading toward the centre, app icon, lime progress bar; bounce loop disabled under reduced motion.
- **Website and marketing (future):** Geist Regular headlines on court green, one lime ticker, perforation dots, product shots on the dark theme; tagline "Every court. Every point."

## 6. Where the old name appears (change after the name is approved)
| Location | What |
|---|---|
| `apps/web/index.html:12` | `<title>Pickle Scoring</title>` |
| `apps/web/public/manifest.webmanifest:1` | `name`, `short_name` |
| `apps/web/src/pages/Login.tsx:21` | hard-coded product name beside the icon |
| `packaging/installer.iss` lines 3, 35–37, 45 | `AppName`, shortcuts, post-install text |
| `packaging/PickleScoring.xml:4` | service display name "Pickle Scoring Service" |
| `packaging/setup-master.ps1:2, 41, 42` | header and firewall rule names |
| `apps/server/src/cli.ts:15`, `backup.ts:85`, `server.ts:89` | CLI banner, error message, log line |
| `packages/shared/src/settings.ts:37`, `Login.tsx:36` | default facility name "Pickleball Facility" (not the product; leave or replace) |

## 7. Do NOT rename (would break things)
- Workspace packages `@pickle/*`, the repository folder `pickle-scoring`, `PICKLE_*` environment variables, `X-Pickle` headers.
- **`pickle-*.db` backup files**: the restore pattern `NAME_RE` in `apps/server/src/backup.ts:12` would stop recognising every existing backup.
- **`C:\ProgramData\PickleScoring`** data folder and the Windows service id `PickleScoring` (`installer.iss`, `PickleScoring.xml`): renaming strands data and duplicates the service on machines already installed. Change only the display names.
- `ps_theme` storage key (device preferences).

## 8. Suggested implementation order and acceptance
1. Adopt `tokens.css` in `index.css` (replace the two theme blocks; register `--color-teamA/B` and status pairs); replace Inter with Geist Sans and add Geist Mono (`@fontsource-variable/geist` and `@fontsource-variable/geist-mono`, or files in `public/fonts`), self-hosted.
2. Icons, manifest, titles, `Login.tsx` name.
3. Shell and the UI primitives in `ui/index.tsx`.
4. Court console, then Dashboard, then Open Play and the TV board.
5. Packaging display names (not ids or paths).
Acceptance after each step: `npm run check` (typecheck + unit/integration tests) and `npm run e2e` (real-Chromium flows) stay green; no raw hex in components; the contrast script still passes; screenshots at 390 px, 1280 × 800 and 1440 px; zero console errors; times still 12-hour.

## 9. Assumptions
- The product name is customer-facing and pending approval; the facility's name leads in the UI.
- The client facility's name and logo are unknown ("[CLIENT / BUSINESS NAME]" in the proposal).
- Whether the Elpisoft credit appears alongside "Powered by Peecool" is undecided.
- Print colour (Pantone, CMYK) is not yet specified.
- All screens in the preview and deck are illustrative; no application screen was modified.
