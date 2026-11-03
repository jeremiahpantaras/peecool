# Match Scoring Logic

> This document is the specification for the pure scoring engine in `packages/shared/src/scoring`. The engine is the most important piece of business logic in the system: build it first, test it exhaustively (§12), and keep it free of I/O and clocks.

## 1. Pickleball scoring rules used (summary)

Based on the USA Pickleball rulebook conventions for recreational and tournament play. Anything a facility may want to vary is a **format setting** (§3), not hard-coded.

### 1.1 Traditional side-out scoring (default)
1. Only the **serving side** can score a point.
2. Games are normally played to **11, win by 2** (also common: 15 or 21, win by 2).
3. **Doubles:** each player on the serving team serves in turn until their team commits a fault — "server 1" then "server 2". When server 2's team faults, it is a **side out** and serve passes to the opponents.
4. **Start-of-game exception:** the team serving first in a game gets only **one** server before the first side out. The opening score is called `0-0-2`.
5. On a side out, the first server of the new serving team is the player standing in the **right-hand (even) service court**.
6. When the serving team scores, the server **switches sides** with their partner and serves again from the other court. The receiving team never switches sides.
7. Consequence (used by the engine): each team's player who started the game on the right is on the right whenever that team's score is **even**, and on the left when it is **odd**.
8. **Score call (doubles):** serving team score – receiving team score – server number, e.g. `4-2-1`.
9. **Singles:** no server number. The server serves from the right when **the server's own score** is even, from the left when odd. A serving fault is an immediate side out. Score call: `server score – receiver score`.
10. **Switching ends:** teams switch ends between games; in the deciding game of a match (and in a one-game match) teams switch ends when the first team reaches 6 (game to 11), 8 (to 15) or 11 (to 21).

### 1.2 Rally scoring (optional format)
1. A point is scored on **every** rally by whichever side wins it.
2. If the receiving side wins the rally, it scores **and** gains the serve.
3. There is no server number; each side has one service turn per side out.
4. Typical games: to 21 (win by 2) or 15. Variants used by leagues (e.g. "freeze" rules where game point can only be won on serve) are **not supported in 1.0** (OPEN_QUESTIONS Q12).
5. In 1.0, rally-scoring formats identify the **serving team and service court** (right when the serving team's score is even, left when odd) but **not the individual server's name** (Q12).

## 2. Scorer input model

**Who scores.** Scores are recorded by authorized court staff or a referee — never by the players. The referee normally uses the phone/tablet at the court (a device signed in as staff and assigned to "Court N"), and exactly the same controls are available to any signed-in Staff or Admin on any other device (the Court page). Every command is recorded under the signed-in user. The engine does not care who the actor is; authorization is enforced by the API (`FUNCTIONAL_REQUIREMENTS.md` §1).

The scorer records only **who won each rally**: two large buttons, "Rally won — Team A" / "Rally won — Team B". With serving tracking on (`servingMode = auto`, the default) the engine converts each rally result into a point, a second-server change or a side out; the scorer never decides which of those it was, which removes the most common scoring mistakes. With serving tracking off the same two buttons simply award a point to that team (§5.3, "Serving off").

**Serving management (owner question 3 — default: automatic with manual override).** The application manages server rotation and side-outs automatically. The referee is never *required* to pick the server after the opening serve; they can override at any moment with **Adjust score** (set serving team, server number, server and who stands on the right), and presets with `servingMode = off` drop serving tracking entirely for facilities that do not want it (Q27).

Additional staff commands: Undo, Adjust score, Pause/Resume, Swap sides (display), Start next game, Confirm result, **End match** (press-and-hold + confirmation; §5.9), Cancel (before start), Update players, Update rules (before start).

## 3. Match configuration: match type + scoring rules

A match is configured by two independent choices made when staff create it:

1. **Match type** (`playType`): `singles` (1 v 1) or `doubles` (2 v 2). Chosen per match; **not** part of a preset; immutable once the match is created (change it in `setup` with `UPDATE_RULES`, or cancel and recreate).
2. **Scoring rules**: copied from a preset (`match_formats`) and optionally overridden for this match. Every rule below is snapshotted onto the match (DATABASE_SCHEMA §3.7), so different matches, even simultaneously on different courts, can use entirely different rules and a later preset edit never changes them.

| Field | Values | Default | Meaning |
|-------|--------|---------|---------|
| `playType` (per match, not in presets) | `singles` \| `doubles` | none — staff must choose | Players per team (1 or 2) |
| `scoringType` | `side_out` \| `rally` | side_out | §1.1 or §1.2 (Q26) |
| `servingMode` | `auto` \| `off` | auto | `auto`: engine tracks serving team/server/rotation. `off`: no serving state; any team may score each rally (Q27). `side_out` requires `auto`. |
| `pointsToWin` | 1–50 | 11 | Target score of a (non-deciding) game |
| `winBy` | 1 \| 2 | 2 | Minimum winning margin |
| `pointCap` | null \| > pointsToWin | null | If set, the first team to reach the cap wins regardless of margin (e.g. to 11, win by 2, cap 15) |
| `gamesToWin` | 1 \| 2 \| 3 | **1** | Best of 1 / 3 / 5. Default is a single game; best-of-3 is a one-tap preset (Q25) |
| `decidingGamePoints` | null \| 1–50 | null | Target for the deciding game if different (e.g. best of 3 to 11, third game to 15) |
| `firstServerRule` | `start_server_2` \| `both_servers` | start_server_2 | Doubles + side-out + `servingMode = auto` only. `both_servers` = recreational variant where both partners serve in the first service turn |
| `switchEndsPrompt` | `off` \| `deciding_game` \| `every_game` | deciding_game | When to show the mid-game "Switch ends" banner |
| `timeLimitMinutes` | null \| 1–600 | null | Display/alert only (FR-TIMER-06) |
| `trackServerNames` | bool | true | Doubles + `servingMode = auto`: ask who starts on the right and show the server's name. The engine tracks slots either way. |

**Seeded presets** (FR-FORMAT-02), all usable for singles *and* doubles: **Standard – 1 game to 11** (default) · Best of 3 – games to 11 · 1 game to 15 · 1 game to 21 · Rally scoring – 1 game to 21 · Score only – 1 game to 11 (rally scoring, serving off).

**Per-match overrides.** In the new-match wizard staff may tap **Customize rules** to change, for this match only: `scoringType`, `servingMode`, `pointsToWin`, `winBy`, `pointCap`, `gamesToWin`, `decidingGamePoints`, `timeLimitMinutes`, `switchEndsPrompt`, `firstServerRule`, `trackServerNames`. The result is validated by the same `validateRules` function as presets; the match is flagged `rules_customized` and shown as "Custom" in history. (Setting `allowRuleOverrides`, default on.)

Validation rules (`validateRules(playType, rules)`, shared by server and UI): `pointCap` > `pointsToWin` (and > `decidingGamePoints` if set); `winBy = 1` makes `pointCap` meaningless (reject the combination); `scoringType = side_out` ⇒ `servingMode = auto`; `firstServerRule`/`trackServerNames` are ignored unless doubles + side_out/auto-serving.

## 4. Engine state model (specification)

The engine state below is a **specification, not code**. Field names should be used as-is in `packages/shared` so all documents stay aligned.

```
Team = "A" | "B"
Slot = 1 | 2                          // player position in team as entered (A1, A2, B1, B2)

MatchState
  status            "setup" | "in_progress" | "paused" | "completed" | "terminated" | "cancelled"
  phase             "playing" | "game_over" | "match_over" | null      // non-null only when in_progress/paused
  phaseBeforePause  "playing" | "game_over" | null
  phaseChangedAt    epoch ms | null
  games             GameState[]       // index 0 = game 1; last element = current/last game
  servingTeam       Team | null       // null only when servingMode = off
  serverNumber      1 | 2 | null      // doubles side-out only
  serverSlot        Slot | null       // who is serving on servingTeam (singles: always 1); null when servingMode = off
  gamesWon          { A: int, B: int }
  winner            Team | null
  switchEndsPending bool              // show banner; cleared by next scoring event
  leftTeam          Team              // which team is drawn on the left of the court display
  timer             { startedAt, pausedAt, pausedTotalMs, endedAt }   // epoch ms or null
  endReason         string | null
  lastAction        { seq, type, team?, outcome? } | null             // for the "Last:" line

GameState
  number            int (1-based)
  target            int               // pointsToWin or decidingGamePoints
  score             { A: int, B: int }
  firstServingTeam  Team | null            // null when servingMode = off
  startRight        { A: Slot, B: Slot }   // player on the right-hand court at game start (ignored when servingMode = off)
  switchEndsTriggered bool
  winner            Team | null
  startedAt         epoch ms
  endedAt           epoch ms | null
```

**Derived values** (pure functions of state + config, recomputed for every snapshot; never stored independently):

| Derived | Rule |
|---------|------|
| `currentGame` | last element of `games` |
| `isDecidingGame` | `gamesToWin == 1` OR (`gamesWon.A == gamesToWin−1` AND `gamesWon.B == gamesToWin−1`) |
| `rightSlot(team)` | `score[team]` even → `startRight[team]`; odd → the other slot. (Doubles only; singles always slot 1.) |
| `serviceCourt` | `servingMode = off`: null. Doubles side-out: `"right"` if `rightSlot(servingTeam) == serverSlot` else `"left"`; singles: server's score even → right; rally: serving team's score even → right |
| `scoreCall` | `servingMode = off`: `${scoreA}-${scoreB}` (Team A first). Doubles side-out: `${serving}-${receiving}-${serverNumber}`; singles side-out and rally: `${serving}-${receiving}` |
| `serverName` | display name (or default label, `DATABASE_SCHEMA` §3.8) of `servingTeam`'s `serverSlot` (only when `trackServerNames`, doubles, and not rally/off) |
| `gamePointTeam` | team T such that awarding T one point would end the game — side-out: only the serving team qualifies; rally/off: either team (if both could, neither is shown — impossible with winBy ≥ 1 except with cap edge cases; then show the serving team, or none when off) |
| `matchPointTeam` | `gamePointTeam` whose game win would also win the match |
| `canUndo` | status is `in_progress` (not paused) and at least one non-voided undoable event exists after START_MATCH |

## 5. Events and transition rules

Each accepted command becomes an event `{ seq, type, payload, at, actor }`. `applyEvent(state, event, config)` returns a new state or throws a typed `EngineError(code)`. The server maps engine errors to API errors (`409 INVALID_STATE`, `422 VALIDATION_ERROR`).

### 5.1 Precondition matrix

| Event | Allowed when | Undoable |
|-------|-------------|:--------:|
| `MATCH_CREATED` | (first event, written at creation) | – |
| `START_MATCH` | status `setup` | ✗ |
| `RALLY_WON` | status `in_progress`, phase `playing` | ✔ |
| `UNDO` | status `in_progress` (not paused), an undoable non-voided event exists | – |
| `ADJUST_SCORE` | status `in_progress`, phase `playing` | ✔ |
| `START_NEXT_GAME` | status `in_progress`, phase `game_over` | ✔ |
| `PAUSE` | status `in_progress`, phase `playing` or `game_over` | ✗ |
| `RESUME` | status `paused` | ✗ |
| `SWAP_SIDES` | status `setup`, `in_progress` or `paused` | ✗ |
| `UPDATE_PLAYERS` | status `setup`, `in_progress` or `paused` | ✗ |
| `UPDATE_RULES` | status `setup` only (match type and/or rules, before the match starts) | ✗ |
| `CONFIRM_MATCH_END` | status `in_progress`, phase `match_over` | ✗ |
| `END_MATCH` (Staff or Admin, on any device) | status `in_progress` or `paused`, phase `playing` or `game_over` (not `match_over`: there Confirm or Undo instead) | ✗ |
| `CANCEL` | status `setup` | ✗ |
| `ADMIN_CORRECTION` | status `completed` or `terminated` | ✗ |

Anything else → `INVALID_STATE` with the current status/phase in the error details.

### 5.2 `START_MATCH`
Payload: `{ servingTeam?: Team, startRight?: { A: Slot, B: Slot }, leftTeam?: Team }`. `servingTeam` is **required when `servingMode = auto`** and **forbidden when `off`**.
1. `status = in_progress`, `phase = playing`, `timer.startedAt = at`.
2. Create game 1: `target = isDecidingGame ? (decidingGamePoints ?? pointsToWin) : pointsToWin`, score 0–0, `firstServingTeam = servingTeam` (null when off), `startRight` = payload or `{A:1, B:1}`.
3. `servingTeam` = payload (null when off); `serverSlot = startRight[servingTeam]` (singles: 1; null when off).
4. `serverNumber` = doubles side-out: `start_server_2` → **2**, `both_servers` → 1; otherwise null.

### 5.3 `RALLY_WON` — payload `{ team: Team }`

Let `S = servingTeam`, `R = other(S)`, `W = payload.team`, `g = currentGame`.

**Side-out scoring, doubles**
| Case | Effect | Outcome |
|------|--------|---------|
| `W == S` | `g.score[S] += 1`. Server stays the same person (`serverSlot` unchanged); they switch court automatically because `rightSlot` is parity-based. | `point` |
| `W == R` and `serverNumber == 1` | `serverNumber = 2`; `serverSlot = other(serverSlot)` (partner serves from where they stand). | `second_server` |
| `W == R` and `serverNumber == 2` | Side out: `servingTeam = R`; `serverNumber = 1`; `serverSlot = rightSlot(R)` (computed with R's current score). | `side_out` |

**Side-out scoring, singles**
| Case | Effect | Outcome |
|------|--------|---------|
| `W == S` | `g.score[S] += 1` | `point` |
| `W == R` | `servingTeam = R` | `side_out` |

**Rally scoring (singles and doubles)**
| Case | Effect | Outcome |
|------|--------|---------|
| `W == S` | `g.score[S] += 1` (doubles: server unchanged) | `point` |
| `W == R` | `g.score[R] += 1`; `servingTeam = R`; doubles: `serverSlot = rightSlot(R)` after the point (display only, Q12) | `point_side_out` |

**Serving off (`servingMode = off`, rally-style, either match type)**
| Case | Effect | Outcome |
|------|--------|---------|
| any `W` | `g.score[W] += 1`; no serving state exists or changes | `point` |

**After any point** (in this order):
1. Clear `switchEndsPending` (a banner from the previous rally disappears on the next rally).
2. Switch-ends check (§7): may set `switchEndsPending = true`.
3. Game-end check (§6.1). If the game is won → §6.2.
4. `lastAction = { seq, type: "RALLY_WON", team: W, outcome }`.

(For non-point outcomes only steps 1 and 4 apply.)

### 5.4 `UNDO` — payload `{}`
1. Find the latest event with `type ∈ {RALLY_WON, ADJUST_SCORE, START_NEXT_GAME}` and `voidedBy == null`. None → `NOTHING_TO_UNDO`.
2. Mark it voided by this UNDO event (persisted: `voided_by_event_id`; the UNDO row gets `undoes_event_id`).
3. **Rebuild** state: `replay(config, events.filter(e => !e.voided && e.type != "UNDO"))`.
4. `lastAction = { seq, type: "UNDO", undoneType, undoneOutcome }` — the court shows "Undid: Rally → Team A (point)".

Why replay instead of reversing: it is trivially correct across side outs, server changes, game boundaries, match-over, timer `endedAt`, and earlier score adjustments. Replay of a match is < 1 ms (< 500 events).

Undo **cannot**: undo `START_MATCH` (use Adjust score at 0-0 to fix the serving team/server, or Cancel/End match), act while paused (resume first), or act on a `completed` match (admin uses `ADMIN_CORRECTION`). There is no Redo in 1.0: re-enter the rally instead.

### 5.5 `ADJUST_SCORE`
Payload: `{ scoreA, scoreB, servingTeam?, serverNumber?, serverSlot?, rightSlot?: {A?: Slot, B?: Slot}, reason? }`. This is the referee's **manual override** for score and serving (owner question 3): staff can set any score and any serving state at any moment during play.

Rules:
1. Applies to the **current game** only; phase must be `playing`.
2. Scores ≥ 0 and must **not** represent a finished game under the format (otherwise `ADJUST_WOULD_END_GAME` — record the final point with the rally button so game/match completion follows the normal path).
3. `servingTeam` required when `servingMode = auto`, forbidden when `off`. `serverNumber` required for doubles side-out (1 or 2), forbidden otherwise.
4. `serverSlot` optional (default: `rightSlot(servingTeam)` for server 1, partner for server 2).
5. `rightSlot` optional per team: if given, set `startRight[team]` so that the parity rule yields the given right-side player at the new score (`startRight = (score even) ? rightSlot : other(rightSlot)`). This fixes position mistakes.
6. Clears `switchEndsPending`; recomputes `switchEndsTriggered` as `max(scoreA, scoreB) ≥ midpoint`.
7. Outcome `adjusted`; reason stored in the payload.

### 5.6 `START_NEXT_GAME`
Payload: `{ servingTeam?: Team, startRight?: {A: Slot, B: Slot}, swapDisplay?: bool }` (`servingTeam` required when `servingMode = auto`, forbidden when `off`).
1. Append a new `GameState` with number+1, target per `isDecidingGame`, score 0–0.
2. Serving setup exactly as `START_MATCH` steps 3–4 (including `0-0-2` for `start_server_2`).
3. If `swapDisplay` (UI default **true**, because teams switch ends between games) → flip `leftTeam`.
4. `phase = playing`.

Default serving team offered by the UI: the team that **received first** in the previous game (alternating first serve) — Q13. Default `startRight`: same as previous game.

### 5.7 `PAUSE` / `RESUME`
- `PAUSE`: `phaseBeforePause = phase`; `status = paused`; `timer.pausedAt = at`. Payload may include `reason` (free text, ≤ 60).
- `RESUME`: `timer.pausedTotalMs += at − pausedAt`; `pausedAt = null`; `status = in_progress`; `phase = phaseBeforePause`.

### 5.8 `CONFIRM_MATCH_END`
`status = completed`; `phase = null`; `endReason = "completed"`. `timer.endedAt` is already set from the deciding rally (§6.2). Actor may be `system` (auto-confirm after `autoConfirmSeconds`).

### 5.9 `END_MATCH` (early termination)
Replaces the former END_EARLY/TERMINATE pair: one command, available to Staff and Admins on any device. Players may *ask* for the match to end, but only staff/referee perform it.

Payload: `{ reason: "time_up" | "injury" | "players_left" | "other", note?, confirmed: true }`. `note` is required when `reason = "other"` (≤ 200 chars). `confirmed` must be the literal `true` — it asserts that the client completed the press-and-hold **and** the confirmation dialog (UI flow in `UI_UX_SPECIFICATION.md` §5.8); the server rejects the command otherwise (`422 VALIDATION_ERROR`), so a stray API call cannot end a match.

Effect:
1. If paused, close the pause first (`pausedTotalMs += at − pausedAt`, `pausedAt = null`).
2. `timer.endedAt = at` — the **termination timestamp** (also stored as `matches.ended_at`).
3. `status = terminated`, `phase = null`, `endReason = reason`, `endNote = note`.
4. The game in progress (if any) gets `endedAt = at` and is persisted with game status `abandoned`, **keeping its current score**; if the phase was `game_over` (the last game already has a winner) nothing is abandoned. All completed games, their scores and the games-won tally are preserved untouched.
5. **`winner = null` always.** An early-ended match never declares a winner, even if one team is ahead on games or points. (An admin can still record a real result later with `ADMIN_CORRECTION`, §5.12, which is audited.)

Not allowed from `setup` (use `CANCEL`) or `match_over` (the result is already decided: Confirm or Undo). Not undoable. Resulting history label: "Ended early – <reason>".

### 5.10 `CANCEL`
`status = cancelled` (from setup only). No timer values.

### 5.11 `SWAP_SIDES`, `UPDATE_PLAYERS`, `UPDATE_RULES`
`SWAP_SIDES` flips `leftTeam`. `UPDATE_PLAYERS` (payload: team names and/or slots `{team, slot, displayName, playerId}`) changes names at any time; a blank/null `displayName` restores the default label ("Player 1"/"Player 2", `DATABASE_SCHEMA` §3.8); engine state is unaffected; the pipeline updates `match_players`. `UPDATE_RULES` (setup only; payload `{ playType?, formatId?, overrides? }`) changes the match type and/or rules before the match starts; it re-runs `validateRules`, rewrites the snapshotted rule columns, resizes `match_players` when the play type changes (dropping/adding slot-2 rows) and sets `rules_customized`. After `START_MATCH` the rules and match type are fixed.

### 5.12 `ADMIN_CORRECTION`
Payload: `{ games: [{ number, scoreA, scoreB }], reason, force?: bool }`.
1. Replace the scores of listed games; recompute each game's `winner` using the format rules (§6.1). Games without a valid winner → `INVALID_CORRECTION` unless `force` (then the admin must also pass `winner` per game).
2. Recompute `gamesWon` and `winner`. If a `terminated` match now has a winner with `gamesWon == gamesToWin`, status becomes `completed` (`endReason` kept for history in the event payload).
3. Timer values unchanged. `matches.corrected_at = at`. Audit-logged.
4. **Admin only.** Staff correct scores *during* a match (Undo, Adjust score) and before the result is confirmed (Undo on Match over); correcting a confirmed or terminated match is an admin action (Q30).

## 6. Game and match completion

### 6.1 Game won?
After a point to team `T` in game `g` (opponent `O`):
```
won = (pointCap != null AND g.score[T] >= pointCap)
   OR (g.score[T] >= g.target AND g.score[T] - g.score[O] >= winBy)
```
With side-out scoring only the serving team can reach this.

### 6.2 On game won
1. `g.winner = T`, `g.endedAt = at`, `gamesWon[T] += 1`, `phaseChangedAt = at`, `switchEndsPending = false`.
2. If `gamesWon[T] == gamesToWin` → `winner = T`, `phase = match_over`, `timer.endedAt = at`.
3. Else → `phase = game_over`.

Undoing the winning rally (§5.4) automatically reverts all of this through replay.

### 6.3 Match result confirmation
- `match_over` shows the result with **Undo** and **Confirm result**.
- Auto-confirm: the scheduler issues `CONFIRM_MATCH_END` as `system` when `now − phaseChangedAt ≥ autoConfirmSeconds` (default 120), using the version it read (so a concurrent Undo wins).
- The official end time is the deciding rally's time, so auto-confirm delay never inflates durations.

## 7. Switch-ends prompt

- Applies when `switchEndsPrompt == "every_game"`, or `== "deciding_game"` and `isDecidingGame` (a one-game match counts as deciding).
- Midpoint = `ceil(target / 2)` → 6 for 11, 8 for 15, 11 for 21.
- When a point makes `max(score.A, score.B) == midpoint` for the first time in the game (`!switchEndsTriggered`): set `switchEndsTriggered = true`, `switchEndsPending = true`.
- The court shows a non-blocking banner "Switch ends" with a **Swap screen sides** shortcut. It clears on the next scoring event. Replay recomputes it correctly after undo.

## 8. Worked example — doubles, side-out, `start_server_2`, to 11

Team A: A1, A2 (A1 starts right). Team B: B1, B2 (B1 starts right). Team A serves first.

| # | Rally won by | Outcome | Score A–B | Serving | Server # | Server (court) | Call |
|---|-------------|---------|-----------|---------|----------|----------------|------|
| 0 | — (start) | — | 0–0 | A | 2 | A1 (right) | `0-0-2` |
| 1 | A | point | 1–0 | A | 2 | A1 (left) | `1-0-2` |
| 2 | B | side_out | 1–0 | B | 1 | B1 (right; B score 0 even → B1 right) | `0-1-1` |
| 3 | B | point | 1–1 | B | 1 | B1 (left) | `1-1-1` |
| 4 | A | second_server | 1–1 | B | 2 | B2 (right) | `1-1-2` |
| 5 | B | point | 1–2 | B | 2 | B2 (left) | `2-1-2` |
| 6 | A | side_out | 1–2 | A | 1 | A2 (right; A score 1 odd → A2 right) | `1-2-1` |
| 7 | A | point | 2–2 | A | 1 | A2 (left) | `2-2-1` |
| 8 | B | second_server | 2–2 | A | 2 | A1 (right) | `2-2-2` |

This table is test case `T-DBL-SEQ-01`.

## 9. Score correction and accidental-press handling

| Problem | Handling |
|---------|----------|
| Double tap / touch bounce | Client ignores a second tap on the same button within 600 ms; one command in flight at a time; server idempotency on `commandId`. |
| Tapped the wrong team | **Undo** (one tap, no confirmation dialog — speed matters, and Undo is itself reversible by re-entering the rally). The "Last:" line under the score shows what will be undone. |
| Several rallies wrong or missed | **Adjust score** (confirmation dialog showing old → new values, optional reason). Undoable. |
| Wrong serving team/server chosen at start | Adjust score at `0-0` with the correct serving team, server number and right-side players. |
| Players physically in the wrong positions vs. display | Adjust score with `rightSlot` per team. |
| Final point recorded by mistake | Undo on the Game over / Match over screen (before confirmation / auto-confirm). |
| Mistake noticed after match confirmed | Admin **Result correction** (§5.12) from Match detail. Original events preserved. |
| Staff accidentally end a match early | **End match** requires a ~2 s press-and-hold (a tap does nothing), then a confirmation dialog stating the score and "no winner will be recorded", then the API's `confirmed: true`; if it still happens, an admin can correct it (§5.12) to record a real result. |
| Two people scoring on two devices | At most one device is *assigned* to a court, but any signed-in Staff/Admin can also operate it from another device; simultaneous commands are resolved by `expectedVersion` conflicts (the loser sees "Updated by Maria (Court 3)"). |

All of these leave a complete trail in `match_events`: the voided event remains, linked to the UNDO that voided it, and the admin timeline shows it struck through.

## 10. Server-side command pipeline (per command)

```
validate payload (Zod)                         → 422 VALIDATION_ERROR
authorize actor: role/permission for this command (`matches.operate` or `matches.end`; admin|staff) — no court restriction, a court assignment grants no authority
                                               → 403 FORBIDDEN
BEGIN IMMEDIATE
  match = load(matchId)                        → 404 MATCH_NOT_FOUND
  if exists(match_id, commandId): COMMIT; return { snapshot(match), duplicate: true }
  if expectedVersion != match.version          → 409 VERSION_CONFLICT (+ snapshot)
  check maintenance gate                       → 503 SERVICE_UNAVAILABLE
  state = parse(match.state_json)  (or replay if null/corrupt)
  event = { seq: version+1, type, payload, at: now(), actor }
  newState = (type == UNDO) ? undoAndReplay(...) : applyEvent(state, event, config)   → 409 INVALID_STATE / 422
  INSERT match_events (with *_after summary columns, outcome)
  (UNDO) UPDATE match_events SET voided_by_event_id
  UPDATE matches (status, phase, version=seq, state_json, timer columns, games_won_*, winner, last_event_at, …)
  UPSERT/DELETE match_games rows to mirror newState.games
COMMIT
publish court snapshot (+ invalidate hints)
return { snapshot, event: { seq, type, outcome } }
```

Development builds additionally assert after every command that `replay(all non-voided events) deepEquals newState` (catches incremental/replay divergence early).

## 11. Snapshot view model sent to clients

See `API_SPECIFICATION.md` §5 (`MatchSnapshot`). It contains the raw state plus all derived values (§4) so no screen does any rule logic.

## 12. Required engine test catalogue

All in Vitest, table-driven. 100 % branch coverage required (NFR-MAINT-03).

| ID | Scenario | Expected |
|----|----------|----------|
| T-DBL-START-01 | Doubles side-out, `start_server_2`, A serves | call `0-0-2`, server = startRight A |
| T-DBL-START-02 | Same with `both_servers` | call `0-0-1`; first fault → server 2, not side out |
| T-DBL-START-03 | First fault at `0-0-2` | immediate side out to B, `0-0-1`, server = B's right player |
| T-DBL-SEQ-01 | §8 table | every row matches |
| T-DBL-POS-01 | Serving team scores 3 in a row | server alternates court right/left/right; `rightSlot` parity correct |
| T-DBL-POS-02 | Receiving team positions never change while receiving | `rightSlot(R)` constant |
| T-SGL-01 | Singles serve court | server even score → right, odd → left |
| T-SGL-02 | Singles serving fault | immediate side out, no server number, call has 2 numbers |
| T-RAL-01 | Rally scoring, receiver wins | receiver +1 and gains serve |
| T-RAL-02 | Rally scoring, either team can win the game on any rally | game ends on receiving-team point |
| T-WIN-01 | 11–9 | game won |
| T-WIN-02 | 11–10 | not won; continues; 12–10 won |
| T-WIN-03 | winBy 1, 11–10 | won |
| T-WIN-04 | cap 15, 15–14 | won |
| T-WIN-05 | Deciding game uses `decidingGamePoints` (best of 3 to 11, game 3 to 15) | game 3 target 15; games 1–2 target 11 |
| T-MATCH-01 | Best of 3: A, B, A | match won by A after game 3; phase `match_over`; `endedAt` = rally time |
| T-MATCH-02 | Best of 3: A, A | match ends after game 2; no game 3 |
| T-MATCH-03 | Single game | game won → `match_over` directly (no `game_over`) |
| T-SWITCH-01 | Deciding game to 11 | banner when first team reaches 6; once only; clears next rally |
| T-SWITCH-02 | Game to 15/21 | midpoint 8/11 |
| T-SWITCH-03 | `switchEndsPrompt=off` | never |
| T-UNDO-01 | Undo a point | score −1, same server, same court parity |
| T-UNDO-02 | Undo a side out | serving team, server number, server slot restored |
| T-UNDO-03 | Undo second-server change | server 1 restored |
| T-UNDO-04 | Undo game-winning rally | phase `playing`, game winner cleared, gamesWon restored |
| T-UNDO-05 | Undo match-winning rally | phase `playing`, `endedAt` null, winner null |
| T-UNDO-06 | Undo `START_NEXT_GAME` | back to `game_over` of previous game |
| T-UNDO-07 | Undo across game boundary repeatedly | walks back into previous game's rallies |
| T-UNDO-08 | Undo an `ADJUST_SCORE` | prior state restored |
| T-UNDO-09 | Undo with only PAUSE/RESUME/SWAP after start | `NOTHING_TO_UNDO` |
| T-UNDO-10 | Undo while paused | `INVALID_STATE` |
| T-UNDO-11 | Undo then new rally then undo | undoes the new rally, not the previously voided one |
| T-UNDO-12 | Undo un-triggers switch-ends | switchEnds flags recomputed |
| T-ADJ-01 | Adjust to 7–5 server 2 | call `7-5-2`; parity positions consistent |
| T-ADJ-02 | Adjust to a winning score | `ADJUST_WOULD_END_GAME` |
| T-ADJ-03 | Adjust with `rightSlot` override | `rightSlot` returns the given slot at the new score |
| T-ADJ-04 | Adjust at 0–0 to change first server | first fault behaviour follows new server number |
| T-PAUSE-01 | Pause/resume twice | `pausedTotalMs` sums both intervals; elapsed correct |
| T-PAUSE-02 | Rally while paused | `INVALID_STATE` |
| T-END-01 | `END_MATCH` while paused, mid-game 7–4 | pause closed, `endedAt` = termination time, game 2 `abandoned` with score 7–4 preserved, completed game 1 unchanged, `winner = null` |
| T-END-02 | `END_MATCH` when one team leads 1–0 in games and 10–2 in the current game | still `winner = null`, `status = terminated` (never infers a winner) |
| T-END-03 | `END_MATCH` in phase `game_over` | no game abandoned; all games completed; `winner = null` |
| T-END-04 | `END_MATCH` in `match_over` or `setup` | `INVALID_STATE` |
| T-END-05 | `END_MATCH` without `confirmed: true`, or `other` without `note` | `VALIDATION_ERROR` |
| T-END-06 | `END_MATCH` is not undoable; `UNDO` afterwards | `INVALID_STATE` |
| T-LABEL-01 | `defaultPlayerLabel` singles | A → "Player 1", B → "Player 2" |
| T-LABEL-02 | `defaultPlayerLabel` doubles | each team: slot 1 → "Player 1", slot 2 → "Player 2" |
| T-LABEL-03 | `UPDATE_PLAYERS` with blank name | label returns to the default; no `players` row created |
| T-CFG-01 | `validateRules`: side_out + serving off | rejected |
| T-CFG-02 | Same preset used for singles and doubles | both valid; engine behaves per match type |
| T-CFG-03 | Two matches with different rules replayed independently | no shared state |
| T-CFG-04 | `UPDATE_RULES` in `setup`, then after start | allowed, then `INVALID_STATE` |
| T-OFF-01 | Serving off: either team scores | no serving fields; call `A-B`; win-by-2 works for both teams |
| T-OFF-02 | Serving off: `START_MATCH` with `servingTeam` | `VALIDATION_ERROR` |
| T-CORR-01 | Correction to valid scores | winner recomputed |
| T-CORR-02 | Correction of terminated match with full result | becomes `completed` |
| T-CORR-03 | Correction with invalid game score, no force | `INVALID_CORRECTION` |
| T-PRE-* | Every row of the precondition matrix §5.1 | allowed/denied exactly as listed |
| T-PROP-01 | Property test: random valid event sequences (incl. undo) | `replay(events) == incremental state`; scores never negative; at most one game in progress; `gamesWon` ≤ `gamesToWin` |
| T-PROP-02 | Property test: side-out doubles | a team's score only increases while it is serving |
