# Peecool: Design system

Source of truth in code: [tokens.css](tokens.css) (colour, type, space, shape, motion) and [fonts.css](fonts.css). This file explains it and specifies components. Nothing here has been applied to `apps/web` yet (that is the next phase).

## 1. Colour tokens
### 1.1 Primitives
`--peecool-court-950 #06150D` · `-900 #082015` · `-800 #0B2D1C` · `-700 #0D3F27` · `-600 #1A5435` · `--peecool-leaf-500 #41702E` · `--peecool-lime-300 #D9F27A` · `-400 #C4E94A` · `-500 #A8CF2C` · `--peecool-volt-300 #F4FB5A` · `--peecool-mint-100 #E8F4E7` · `-50 #F1F8EA` · `--peecool-cream-50 #F8FFEF` · `--peecool-sage-200 #CBD9C9` · `-300 #B2C6B0` · `--peecool-ink #0F1A13`. Components never use primitives directly.

### 1.2 Semantic tokens
| Token | Light | Dark |
|---|---|---|
| `--c-bg` | #F8FFEF | #06150D |
| `--c-surface` | #FFFFFF | #0B2D1C |
| `--c-surface2` | #EEF6E8 | #123B27 |
| `--c-border` / `--c-border-strong` | #D3E0CF / #AFC4AE | #27503A / #3A6B50 |
| `--c-text` | #0F1A13 | #F4FBEA |
| `--c-muted` | #46594C | #A9C0AE |
| `--c-primary` (+ `-ink`, `-hover`) | #0D3F27 (#FFFFFF, #0B3320) | #C4E94A (#06150D, #D9F27A) |
| `--c-accent` (+ `-ink`) | #C4E94A (#0F1A13) | #C4E94A (#06150D) |
| `--c-highlight` | #F4FB5A | #F4FB5A |
| `--c-teamA` / `--c-teamA-tint` | #1E3FAE / #DCE7FF | #8FC1FF / #102A52 |
| `--c-teamB` / `--c-teamB-tint` | #8A2E0E / #FFEEDD | #FFA36B / #4A2010 |
| `--c-success` / tint | #166534 / #DDF5E3 | #7DE39A / #0F3A22 |
| `--c-warn` / tint | #8A4B00 / #FFF0C9 | #FFC857 / #4A3406 |
| `--c-danger` / tint | #B42318 / #FDE4E1 | #FF8E83 / #4A1713 |
| `--c-info` / tint | #0B5CAD / #DCEEFC | #7FC0FF / #0E2F52 |
| `--focus` | #0D3F27 | #C4E94A |

### 1.3 Court and match status (foreground / background)
| Status | Light | Dark |
|---|---|---|
| Available | #166534 / #DDF5E3 | #7DE39A / #0F3A22 |
| Occupied | #0B5CAD / #DCEEFC | #7FC0FF / #0E2F52 |
| **Live** | #0F1A13 / #C4E94A | #06150D / #C4E94A |
| Paused | #8A4B00 / #FFF0C9 | #FFC857 / #4A3406 |
| Completed | #5B21B6 / #EDE5FF | #C9B8FF / #2A1A5C |
| Maintenance | #B42318 / #FDE4E1 | #FF8E83 / #4A1713 |
| Inactive | #4B5A52 / #E6ECE7 | #A6B8AC / #1A3326 |

Live is the only filled pill, so the brand green of the chrome is never confused with court state. Every status also carries an icon and a label.

### 1.4 Data visualisation (Dashboard charts use recharts)
Primary series `--c-primary` (court 700 light, lime dark); highlight series `--peecool-leaf-500`; comparison series team blue and orange; gridlines `--c-border`; labels `--c-muted`. Maximum five series; always direct labels or a legend, never colour alone.

### 1.5 Migration map from `apps/web/src/index.css`
| Existing | New |
|---|---|
| `--c-bg` #f8fafc / #0b1120 | #F8FFEF / #06150D |
| `--c-surface` #ffffff / #111827 | #FFFFFF / #0B2D1C |
| `--c-surface2` #f1f5f9 / #1f2937 | #EEF6E8 / #123B27 |
| `--c-border` #e2e8f0 / #334155 | #D3E0CF / #27503A |
| `--c-text` #0f172a / #f8fafc | #0F1A13 / #F4FBEA |
| `--c-muted` #475569 / #94a3b8 | #46594C / #A9C0AE |
| `--c-primary` #0f766e / #2dd4bf | #0D3F27 / #C4E94A |
| `--c-primary-ink` #ffffff / #04201c | #FFFFFF / #06150D |
| `--c-teamA-tint` #dbeafe / #172554 | #DCE7FF / #102A52 |
| `--c-teamB-tint` #ffedd5 / #431407 | #FFEEDD / #4A2010 |
| `--color-teamA` #2563eb (static) | **theme-aware** `--c-teamA` (register `--color-teamA: var(--c-teamA)`) |
| `--color-teamB` #ea580c (static) | **theme-aware** `--c-teamB` |
| `--color-danger` #dc2626, `--color-warn` #d97706 | theme-aware `--c-danger`, `--c-warn` |
| `--color-st-*` (single colours) | foreground/background pairs, section 1.3 |
| `--font-sans` Inter Variable | `'Geist'` / `'Geist Variable'` (replace Inter with Geist Sans; add `--font-display`, `--font-score`, `--font-mono`) |

The old team colours did not meet the 7:1 score requirement in NFR-UX-03 (measured on white: Team A #2563eb 5.17:1, Team B #ea580c 3.56:1, which fails even 4.5:1 text AA); the new ones do.

### 1.6 Contrast results (`source/contrast.mjs`, WCAG relative luminance)
All 54 token pairs and 14 status pairs pass. Selected: body text 17.8:1 · muted on white 7.5:1 · primary button label 11.95:1 (light) and 13.47:1 (dark) · Team A score on surface 8.83 (light) / 7.99 (dark) · Team B score 8.48 / 7.61 · lime on Court 900 12.3:1 · cream on Court 700 11.69:1. **Documented failure by design:** lime on cream 1.36:1, so lime is never text on light backgrounds.

## 2. Typography tokens
One family, **Geist** (Vercel; SIL OFL 1.1; variable fonts, self-hosted). `--font-sans` = `--font-display` = `--font-score` = Geist Sans (the stack lists both `'Geist'` and Fontsource's `'Geist Variable'`); `--font-mono` = Geist Mono. Weights: `--fw-display` 400, `--fw-body` 400, `--fw-strong` 600, `--fw-score` 700. Sizes `--fs-xs .75rem` … `--fs-6xl 3.75rem`; line heights tight 1.08, snug 1.25, normal 1.5, score .9; tracking display −.03em, caps +.08em, body and score 0.

| Role | Face / weight | Size / line | Tracking |
|---|---|---|---|
| Display | Geist Sans 400 | 36–84 / 1.08 | −.03em |
| Page title | Geist Sans 400 | 28–36 / 1.15 | −.02em |
| Section heading | Geist Sans 600 | 18–20 / 1.3 | 0 |
| Body | Geist Sans 400 | 14–16 / 1.5 | 0 |
| Overline, table head | Geist Sans 600, caps | 12 / 1.3 | +.08em |
| KPI, timer, rank | Geist Sans 700, tabular | 28–120 / 1.0 | 0 |
| Scoreboard | Geist Sans 700, tabular | `var(--score-size)` / .9 | 0 |
| Technical text | Geist Mono 400 | 13–14 / 1.5 | 0 |

Always set `font-variant-numeric: tabular-nums` on numerals (the existing `.tnum` class does this).

### Score-font test (headless Chromium, 2026-11-01)
| Font | `tnum` spread | Two digits (tnum) | Digit height | Worst blurred similarity | 0/8 | 6/8 | 5/6 | 1/7 |
|---|---|---|---|---|---|---|---|---|
| Geist Sans 600 | 0 | 1.25 em | 0.75 em | 0.78 | 0.64 | 0.75 | 0.76 | 0.24 |
| **Geist Sans 700** | **0** | **1.27 em** | **0.75 em** | **0.79** | 0.69 | 0.78 | 0.77 | 0.29 |
| Geist Sans 800 | 0 | 1.30 em | 0.75 em | 0.81 | 0.73 | 0.81 | 0.79 | 0.36 |
| Geist Mono 600 | 0 | 1.20 em | 0.75 em | 0.79 | 0.66 | 0.74 | 0.78 | 0.30 |
| Geist Mono 700 | 0 | 1.20 em | 0.75 em | 0.79 | 0.71 | 0.77 | 0.79 | 0.34 |
| Barlow Condensed 700 (earlier choice, now dropped) | 0 | 1.00 em | 0.73 em | 0.87 | 0.85 | 0.87 | 0.80 | 0.60 |

Similarity is the overlap of digit shapes after normalising and blurring (lower = more distinct). Decision: **Geist Sans 700**. Geist Mono shows no advantage and, being monospaced, gives colons and dots a full digit-width in timers, so it is reserved for technical text. Weight 800 lowers distinctness, so it is not used.

**Sizing:** `--score-size: clamp(56px, min(48cqh, 34cqw), 480px)`. At 16:10 and wider, height binds: 48cqh × 0.75 = **36% of container height** (NFR-UX-02 asks ≥ 30%), and two digits (1.27 em) fit a half-width team panel. **At 4:3 width binds**: a half panel is about 33cqh wide, so the font falls to about 26cqh and digits to about 20% of height, below the target (the condensed face would have reached about 24%, also below). **Rule: below a 3:2 aspect ratio (iPad landscape), stack the team panels** so each gets the full width and half the height. This layout has not been built or tested. The distinctness metric simulates distance by blurring; a physical check at 5 m is still required (0/8 and 6/8 are the closest pairs).

## 3. Space, shape, motion
Space (4 px base): `--sp-1 2` `-2 4` `-3 8` `-4 12` `-5 16` `-6 20` `-7 24` `-8 32` `-9 40` `-10 48` `-11 64` `-12 80` `-13 96`. Radius: xs 4, sm 8, md 12, lg 16, xl 24, pill 999. Shadows (green-tinted): sm `0 1px 2px rgba(6,21,13,.06)…`, md `0 4px 12px rgba(6,21,13,.08)…`, lg `0 16px 40px rgba(6,21,13,.14)…` (heavier black versions in dark). Motion: ease `cubic-bezier(.2,.7,.2,1)`, 120/180/320 ms; the existing `prefers-reduced-motion` rule stays; the live pulse (1.6 s) and score pop (160 ms) stay.

## 4. Layout and responsive
Keep Tailwind defaults: sm 640, md 768 (sidebar replaces the phone tab bar, as now), lg 1024, xl 1280, 2xl 1536. Page margin 16 px (phone), 24 px (md+); content max 1500 px (existing). Cards: 1 column phone, 2 tablet, 3–4 desktop; KPI row of 4. Test viewports: phone 390 wide, tablet landscape 1280 × 800 (console), desktop 1440.

## 5. Component specifications
| Component (existing primitive in `ui/index.tsx`) | Visual spec |
|---|---|
| Button | 44 px high (console 64), radius 12 (console 16), 650 weight. Primary = `--c-primary`; accent lime only for "go live"; secondary 1.5 px `--c-border-strong`; ghost; danger fill; disabled 45% opacity |
| HoldButton | Danger outline, 64 px, tint fills left to right while held |
| Card, CardHeader, PageHeader | `--c-surface`, 1 px `--c-border`, radius 16, padding 20, shadow-sm; page titles in Geist Regular (display) |
| Input, Select, Textarea, Field, Check, Segmented, TimeInput12 | 44 px, 1.5 px `--c-border-strong`, focus 2 px `--focus`, error border `--c-danger` plus message; segmented on `--c-surface2` with a raised active segment. Times are always 12-hour |
| Table, Th, Td, Pagination | Head 12 px caps on `--c-surface2`; cell 12 × 11; hairline rows; numbers right-aligned, tabular |
| Badge, RoleBadge, ViewOnlyTag | Pill, 12 px bold; Admin = filled primary; Staff = neutral; "New" = volt |
| StatusPill, DeviceDot, ConnectionBadge | Section 1.3 pairs, icon + label; Live pulses a dot |
| Sidebar (Shell) | 240 px, `--c-surface`; facility name first, nav items 40 px, active = primary fill; footer "Powered by Peecool" with the primary logo (16 px tall) |
| Phone tab bar | Six items, active = primary; safe-area padding kept |
| KpiTile | Geist Bold 52 px value, Geist 600 12 px caps label; one hero tile in court green with lime value per screen |
| Timer | Geist Bold, tabular; normal, warn (tint + label "Time-up soon"), over (tint + label "Time is up") |
| Court status card | Header (Geist Regular court name + pill), body (mini score or message), footer meta; live = lime outline |
| Modal, ConfirmDialog | Radius 24, shadow-lg, Geist Regular title, buttons right-aligned, danger last |
| Toast | Court 900 with a 4 px lime edge |
| Notice, ErrorBox, Empty | Tint backgrounds from section 1.2 with icon + text; empty states may use court lines at low opacity |

### Score display (console)
Container-query layout (`container-type: size`): top bar (court name in Geist Regular, format, timer + Live pill), two team panels (team-colour top bar, name in team colour, player names muted, score at `--score-size`, serving tag, game dots, previous games; stacked vertically below a 3:2 aspect ratio), bottom bar (Undo, Adjust, Swap sides, hold-to-end, score call in Barlow). The serving team's panel gets a soft team-tint gradient and the lime "Serving" tag. States to style: inactive, maintenance, ready, setup, live, paused, game over, completed, terminated, locked while reconnecting.

### Open Play components
Round card (court-green header, one row per court: court label in Geist Bold, teams, score with the winner in ink and the loser muted, status pill); Winners group (lime-tinted, labelled) and Losers group (neutral, labelled); Waiting list as chips; standings table with Barlow rank numerals (first place in court green); TV board in the dark theme at console scale.

## 6. Accessibility
WCAG 2.2 AA minimum, scores ≥ 7:1 (script-verified). Never colour alone. Targets ≥ 44 px (console ≥ 64). Focus ring 2 px with 2 px offset in `--focus`. Reduced motion honoured. Body text ≥ 14 px (12 px only for overlines). No hover-only information (tablets). Colour-blind safe: teams are blue and orange, brand lime is never a team colour.
