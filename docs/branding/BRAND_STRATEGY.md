# Peecool: Brand strategy

> Status: proposed official customer-facing brand, **pending owner approval**. The repository and technical identifiers keep the name `pickle-scoring`. Companion files: [PRODUCT_NAMING.md](PRODUCT_NAMING.md), [BRAND_GUIDELINES.md](BRAND_GUIDELINES.md), the 16:9 deck [Peecool_Brand_Guidelines.pdf](Peecool_Brand_Guidelines.pdf).

## What the product actually is (from the repository)
Pickleball court management and scoring for a facility of up to 24 courts. LAN-only and offline-first: one Windows 11 **Master PC** hosts the service and database; Admin, Staff and each court's phone or tablet open the same web app. Built today (see `docs/IMPLEMENTATION_STATUS.md`): Dashboard (live view plus an Analytics tab with seven reports), Booking Schedule, Court Management and the scoring console, Game Histories, Players, Open Play (with a TV board), Users, Presets, Settings, Backups, Audit. Two roles: Admin and Staff.

**Corrections to the brief's feature list:** there is no separate Reports or Analytics page (both are Dashboard tabs), and no standalone Match Management page (it is split across the console, History and Match detail). Not built: recurring bookings, HTTPS mode, offline scoring queue, spectator display. Unverified: Windows 11 install and real phones and tablets.

## Positioning
For pickleball facilities that need to run many courts without losing a point, Peecool is the all-in-one management and scoring platform. Unlike booking-only tools or standalone scorekeepers, it runs on the facility's own network, so scoring never depends on the internet.

## Purpose, mission, vision
- **Purpose:** make every game at a facility count: accurately scored, fairly organised, easy to run.
- **Mission:** give facilities one dependable system to run their courts, score every match and keep players moving.
- **Vision:** the system facilities trust to run the game: pickleball first, ready for every court sport.

## Personality and voice
Composed, competitive, precise, quick, organised, welcoming. A professional sports-technology product, not wellness, retail or hospitality. "Cool" in the name means composure under pressure.
- Short, direct sentences. Real numbers, no hype.
- In errors: say what happened and what to do next.
- Friendly but never cutesy inside the product; playful only in marketing.
- Avoid: "revolutionary", "seamless", "next-generation", "all-in-one solution" as filler. Say what it does.

## Audience (by role in the product)
| Audience | Role | What they need |
|---|---|---|
| Facility owners and managers | Admin | See everything, run everything, analytics, backups |
| Front-desk and court staff | Staff | Operate courts, bookings, Open Play; read-only elsewhere |
| Players | not users | Read scores on court devices and the TV board |
| The integrator (Elpisoft, Bacolod) | deploys | A brand that sits under the facility's own name |

## Core values
Accuracy (every point can be corrected, nothing is lost) · Speed (one tap, live on every screen) · Fair play (transparent rules and rotations) · Always on (your network, no internet needed) · Everyone's game (readable, accessible, easy to learn).

## Brand story
Pickleball facilities fill up fast: a dozen courts, a front desk, a queue of players, and a score someone has to get right. Peecool began as the system behind that moment. One Master PC, every court in sync, scores that survive a dropped Wi-Fi signal, and Open Play that sorts itself. The "P" is for pickleball. The "cool" is what it gives a facility on its busiest night.

## Taglines
1. **Every court. Every point.** (recommended: covers management and scoring)
2. Keep your cool. Keep count. (plays on the name; best for marketing)
3. Run the whole facility. Score every point.
4. Call it. Count it. Run it.
5. Cool under pressure, point after point.

## Brand architecture (assumption, to confirm)
The sidebar in `apps/web/src/layout/Shell.tsx` shows the **facility's** name, not the product's. Peecool therefore co-brands: facility name first, "Powered by Peecool" as a quiet footer credit. The client facility is unnamed in the repository (the proposal says "[CLIENT / BUSINESS NAME]"). Whether the Elpisoft credit also appears is undecided.

## Room to grow
Nothing in the name, symbol or palette is specific to scoring, so the identity still holds if the product adds leagues, tournaments, memberships or other racquet sports.
