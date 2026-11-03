# Phase 1 implementation plan: Peecool brand, light-only UI

Source of truth: `docs/branding/` (BRAND_GUIDELINES, DESIGN_SYSTEM, LOGO_SPECIFICATION, APPLICATION_BRANDING, `tokens.css`, `fonts.css`, `public/brand/*`). The PDF could not be rendered in this environment (no poppler); the markdown files and `tokens.css` carry the same values and were used instead.

## 1. Conflicts found before changing anything
| Brand docs say | This brief says | Resolution |
|---|---|---|
| Dark theme exists; court console defaults to dark (Court 950); TV board dark | **Light theme only**, no toggle, no dark modules | Brief wins (newer, explicit). Dark token set is not shipped. Console and TV board use the light tokens with court-green (#0D3F27) header bars and lime for live. The `courtTheme` setting stays in the API for compatibility but no longer has any effect, and its Settings control is removed. |
| "Powered by Peecool"; facility name leads | "product developed and maintained by Elpisoft" | Facility name leads in the sidebar; Peecool logo on login/loading; footer reads "Peecool · by Elpisoft". Elpisoft credit was an open question in APPLICATION_BRANDING §9. |
| Suggested nav has Matches, Reports & Analytics, Staff & Accounts | Brief: "do not introduce nonfunctional navigation items" | Real routes only. Grouped: Overview (Dashboard), Operations (Booking Schedule, Court Management, Open Play, Game Histories, Players), System (Users, Rule presets, Settings, Audit, Backups; Admin only). Reports live in the Dashboard's Analytics tab; there is no standalone Match Management page. |
| Brief asks for features such as Open Play "scheduled sessions", "draw pool", date/start-time on session creation, player check-in | Brief: "do not invent features" | Only what the server supports is surfaced. Gaps are listed in PHASE_1_PROGRESS.md, not faked. |

## 2. Current architecture (verified)
npm workspaces: `packages/shared` (Zod, scoring engine, Open Play pairing), `apps/server` (Fastify 5, Socket.IO, better-sqlite3), `apps/web` (React 19, Vite 7, Tailwind 4, React Router 7, TanStack Query, recharts), `e2e` (Playwright). Web already uses semantic Tailwind tokens (`bg-surface`, `text-ink`, `border-line`, `text-primary`) defined in `index.css`, so a token swap restyles most screens.

Screens: Login (+first-run setup), Dashboard (live + Analytics tab), Booking Schedule, Court Management, Court page + scoring console, Game Histories, Match detail, Players, Player detail, Open Play (list, session, TV board), Admin (Users, Presets, Settings, Audit, Backups), Account.

## 3. Strategy
1. **Tokens**: replace the two theme blocks in `index.css` with the Peecool light set (port from `tokens.css`, light only), register `--color-*` incl. theme-aware team and status colours, bundle Geist and Geist Mono (woff2 in `src/assets/fonts`, no CDN).
2. **Light-only**: `lib/theme.ts` always sets `data-theme="light"`; remove theme toggles (Shell menu, Console menu); drop `dark:` variants.
3. **Assets**: favicon, apple-touch-icon, manifest, `<title>`, logo on Login, Shell, loading screen.
4. **Primitives** (`ui/index.tsx`): Button, Card, PageHeader (Geist 400), Badge, StatusPill (token pairs), inputs (44 px), Modal, Toast, KpiTile (Geist Bold), Table, Timer/score font.
5. **Shell**: grouped sidebar, header with breadcrumb-style page title, footer credit.
6. **Console**: Geist Bold scores, light surfaces, court-green top bar, lime for live/serving only, keep 64 px targets, hold-to-end, 600 ms double-tap guard.
7. **Dashboard / Courts / Players / Reports**: restyle with primitives; charts use brand series colours.
8. **Open Play**: round cards with court-green header, winners/losers groups, waiting chips, standings with Geist Bold rank; TV board light.
9. Docs, tests, screenshots.

## 4. Must be preserved
All API contracts, DB schema, scoring rules, auth/roles, terminal pairing, 12-hour time, Socket.IO sync, Open Play pairing, existing test ids and aria-labels used by e2e.

## 5. Risks
- Tailwind opacity utilities on CSS-variable colours (`bg-primary/15`) rely on `color-mix`; fine in current Chromium/Safari.
- Team colours change (#2563eb → #1E3FAE, #ea580c → #8A2E0E): e2e must not assert colours.
- Lime (#C4E94A) fails as text on light; use only as fill with ink text.
- Display text is Geist 400 with tight tracking, only at title sizes.
- Real tablets, 5 m legibility and Windows 11 remain unverified.

## 6. Sequence
Foundation → Master shell/primitives → Console → Dashboard/Courts/Players/History/Reports/Admin → Open Play → QA (typecheck, unit, e2e, screenshots at 390 / 768 / 1280×800 / 1440) → docs.
