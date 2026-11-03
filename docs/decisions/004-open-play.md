# ADR 004 — Open Play as a layer over ordinary matches

**Decision.** Each Open Play game is a normal `matches` row linked to a round. Sessions, rounds and players are new tables. Pairing is pure, seeded code in `packages/shared`.
**Why.** Scoring, undo, reconnection, history and reports keep working with no parallel system, and every draw can be reproduced from its seed.
**Consequences.** `END_MATCH` still records no winner; two new events (`TIME_UP`, `RECORD_RESULT`) cover time-up and Admin-entered results, so `match_events` was rebuilt in migration 2. Open Play is the one place a game can end without a point target being reached. Courts used by a running session are held.
