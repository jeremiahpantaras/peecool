# Phase 1 progress: Peecool brand, light-only UI

Plan: [PHASE_1_IMPLEMENTATION_PLAN.md](PHASE_1_IMPLEMENTATION_PLAN.md). Last updated 2026-11-01.

## Done
**Foundation.** `apps/web/src/index.css` now holds the Peecool light token set (ported from `docs/branding/tokens.css`; the dark set is deliberately not shipped), registered as Tailwind colours incl. status pairs, team colours, `font-display` (Geist 400, -0.03em), `font-score` / `.num` (Geist 700, tabular), `font-mono` (Geist Mono). Type follows the revised brand docs (one family, Geist; earlier Gloock/Barlow/Inter choice superseded 2026-11-01). Fonts are bundled from `src/assets/fonts` (SIL OFL licences included); no CDN; `@fontsource-variable/inter` removed. `lib/theme.ts` always sets `data-theme="light"`. Theme toggles removed (top-bar menu, console menu); the Settings "Court screen theme" control is removed (the `courtTheme` setting remains in the API and is ignored).

**Brand assets.** Favicon, apple-touch-icon, manifest (name, colours, PNG + maskable icons), `<title>Peecool</title>`, Login (primary logo, "Every court. Every point."), sidebar (facility name in Geist 400, app icon, "Powered by Peecool" logo, "by Elpisoft"), phone header icon, console header icon, branded loading screen (`BrandLoader`: court green, perforation dots, lime progress bar).

**Components (`ui/index.tsx`).** Button (44 px, 1.5 px border secondary, primary hover token), Card (radius 16, green-tinted shadow), PageHeader (Geist 400), Badge (token tints), StatusPill (brand status pairs; Live is the only lime pill), inputs (44 px, error border), Segmented, Notice/ErrorBox, Toast (court-900 with lime edge), Modal (radius 24, Geist 400 title, fade-in), KpiTile (Geist Bold numerals; `hero` court-green tile with lime value), Table head, Timer (Geist Bold).

**Screens.** Shell (grouped sidebar Overview / Operations / System, active item filled court green, page fade-in), Dashboard (hero KPI), Court cards (Geist display names, Geist Bold scores, lime ring when live), Court console (Geist Bold scores at 48cqh, lime serving tag, volt game/match-point tag, warn-tint banners, court-green top rule, Geist display court name), Open Play (Geist display court names, Geist Bold scores and ranks, TV board title), Analytics chart colours (brand series), Presets default star.

**Tests (executed 2026-11-01).** `npm run check`: typecheck clean, 166 unit/integration tests passed. `npm run e2e`: 16 Chromium tests passed, incl. new test "Peecool brand": 8 pages x 5 viewports (1920x1080, 1366x768, 1280x800, 820x1180, 390x844) with no horizontal overflow, `data-theme=light`, body background `#F8FFEF`, Geist and Geist Mono load, Peecool logo loads on Login, title is "Peecool". Existing e2e changed only for the court heading (now "Court 1" instead of "COURT 1").

## Decisions and conflicts
- Brand docs specify a dark console and TV board; this brief says light only. Light wins everywhere. The only dark-green full areas are the loading screen, the hero KPI tile, toasts and the active nav item (brand-approved accents).
- Nav uses real routes only (no Reports, Matches or Staff & Accounts pages exist; reports are the Dashboard Analytics tab, accounts are Users).

## Not done / known gaps
- Brief items the server does not support, deliberately not faked: Open Play "scheduled" sessions, session date/start-time fields, player check-in, a "draw pool", winners/losers pool visuals, breadcrumbs, notifications, tooltips. Open Play session summary shows standings and rounds only.
- Pages beyond the ones above (Bookings, History, Players, Match detail, Users, Audit, Backups, Account, Wizard dialogs) inherit the new tokens and primitives but were not individually redesigned.
- Packaging display names (installer, Windows service display name, CLI banner) still say "Pickle Scoring" (APPLICATION_BRANDING §6). Ids, paths, `pickle-*.db` and `ps_theme` are intentionally unchanged.
- The brand PDF could not be rendered here (no poppler); the markdown docs and `tokens.css` were used.
- Not verified: real tablets/phones, 5 m score legibility, Windows 11, Safari/Firefox, keyboard/screen-reader pass, reduced-motion check (CSS rule exists, not tested).
- `docs/branding/*` still describes a dark theme; update it if light-only is permanent.
