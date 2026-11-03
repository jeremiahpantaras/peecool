# Peecool: Brand guidelines

The full visual version is the 16:9 deck [Peecool_Brand_Guidelines.pdf](Peecool_Brand_Guidelines.pdf); the interactive version is [brand-preview.html](brand-preview.html). Machine-readable tokens: [tokens.css](tokens.css). Details: [LOGO_SPECIFICATION.md](LOGO_SPECIFICATION.md), [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md), [APPLICATION_BRANDING.md](APPLICATION_BRANDING.md).

## 1. Logo usage
Use the version for the background ([LOGO_SPECIFICATION.md](LOGO_SPECIFICATION.md) has the table). Keep the clear space (the ball's diameter) and the minimum sizes (horizontal 120 px, stacked 80 px, symbol 32 px, favicon form 16 px). Never stretch, rotate, recolour, shadow, outline, rearrange or retype. The facility's own name leads in the product; Peecool credits quietly ("Powered by").

## 2. Colour palette
Sampled from the reference page (deep green #0D3F27, mid green #1A5435, leaf #41702E, lime, volt #FAFF45, cream #F8FFEF, mint #E8F4E7, sage #CBD9C9) and refined for screens. Lime was shifted to #C4E94A and volt to #F4FB5A for text contrast and screen comfort.

| Name | Hex | Role |
|---|---|---|
| Court 950 / 900 / 800 | #06150D / #082015 / #0B2D1C | Dark theme background, deep surfaces |
| **Court 700 (primary)** | **#0D3F27** | Brand, primary button (light theme), headlines |
| Court 600 | #1A5435 | Raised on court green |
| Leaf 500 | #41702E | Banners, row accents |
| **Rally Lime (accent)** | **#C4E94A** | Live, serving, primary action on dark. **Fill only; never text on light backgrounds** (1.36:1 on cream) |
| Volt | #F4FB5A | Stickers and "new"; at most one per screen |
| Cream 50 / Mint / Surface 2 | #F8FFEF / #E8F4E7 / #EEF6E8 | Light backgrounds and panels |
| Sage 200 | #CBD9C9 | Page frames, dividers |
| Ink / Muted | #0F1A13 / #46594C | Text (17.8:1 / 7.5:1 on white) |

Proportion: about 60% cream, white and neutrals; 30% court greens; 8% lime; 2% volt. The full light/dark semantic set, team and status colours are in [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md). **Every text pair was checked by script** (`source/contrast.mjs`): all 54 token pairs and 14 status pairs pass (text ≥ 4.5:1, scores ≥ 7:1).

## 3. Typography (one family: Geist, SIL OFL, self-hosted)
| Role | Face |
|---|---|
| Display (brand and page headlines, dialog titles, court names) | **Geist Sans Regular 400**, tracking −0.03em, large sizes only |
| Body (everything read: tables, forms, names) | **Geist Sans 400**; 600 for emphasis, buttons and overlines |
| Score and numerals (scores, timers, clock times, KPIs, ranks) | **Geist Sans Bold 700**, always with tabular figures |
| Technical text (IDs, file names, colour codes, logs) | **Geist Mono** |

Why Geist Sans Bold for scores (measured, see DESIGN_SYSTEM.md §2): zero digit-width drift with `tnum`; digits are 0.75 em tall so a `48cqh` font size gives 36% of screen height (spec asks for ≥ 30%); and its digits are more distinct when blurred (worst pair 0.79 against 0.87 for the condensed face considered earlier). **Cost:** two digits are 1.27 em wide, 27% wider than a condensed face, so at 4:3 (for example an iPad in landscape) the digits become width-limited at about 20% of height. Rule: below a 3:2 aspect ratio, stack the team panels. **Not yet verified:** legibility at 5 m on a real 10-inch tablet.

## 4. Spacing, shape, layout
4 px base scale; radius 4/8/12/16/24; green-tinted shadows (sm cards, md menus, lg dialogs); Tailwind's default breakpoints stay (the 240 px sidebar appears at `md` 768); page margin 16 px phone and 24 px from `md`; content max 1500 px. Touch targets ≥ 44 px (workspace) and ≥ 64 px (console).

## 5. Visual identity and design principles
1. **Numbers first.** The most important thing on any screen is a score, a time or a count: large, bold, high-contrast.
2. **Green is chrome, lime is live.** Lime appears only for the live moment, the serving team and primary actions on dark.
3. **Calm density.** Administrative screens are compact: white cards on cream, hairline borders, 16 px gaps.
4. **Never colour alone.** Status is colour plus icon plus label; teams are colour plus name plus a serving tag.
5. **Sparse graphic language.** Court lines (15–30% opacity), perforation dots, numbered stacked rows, the bounce divider, the lime ticker (marketing only). Never behind data.
6. **Clock times are 12-hour** (5:05 PM), set explicitly, never by device locale (owner decision; see UI spec §2.7).

## 6. Brand consistency
- Name: **Peecool**, capital P only in running text; never "PC", "Pee-Cool", "PEECOOL" outside the logo.
- One status vocabulary (Available, Occupied, Live, Paused, Completed, Maintenance, Inactive) across courts, matches and Open Play.
- Tokens only: no raw hex values in components.
- Taglines: "Every court. Every point." is primary; "Keep your cool. Keep count." for marketing only.

## 7. Incorrect logo usage
Stretching or squashing; rotating or tilting; off-palette backgrounds; the primary version on lime; drop shadows or effects; low-contrast backgrounds; rearranging symbol and wordmark; outlining the letters; retyping the name in another font; adding a tagline inside the clear space.

## 8. Background treatments
| Treatment | Use |
|---|---|
| Cream #F8FFEF | Default workspace and documents |
| Court green #0D3F27 with perforation dots | Hero, loading, marketing |
| Court 950 #06150D | Dark theme and the court console |
| Mint #E8F4E7 | Feature panels, Open Play |
| Lime #C4E94A | Ticker band and dark-logo fields only |
| Photography | Dark overlay; light logo |
