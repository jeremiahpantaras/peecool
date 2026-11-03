# Open Play — requirements, design and rules

Added after Revision 3. Status: **built and tested** (see `docs/IMPLEMENTATION_STATUS.md`). This document is the specification for the feature; where it differs from an older document (`FR-TIMER-06`, `OPEN_QUESTIONS` Q6, `PROJECT_OVERVIEW` §4.2), this document wins.

## 1. What it is

A timed session on several courts. The Admin creates it, enters the players, and presses Start. The system draws round 1 at random, and after each round pairs winners with winners and losers with losers. Nobody is eliminated: everyone keeps playing until the session time runs out. "Bracket" means the round-by-round pairing board, not a knockout tree.

Owner decisions: each court starts on its own and its time limit counts from its own start · a court that finishes first waits, and the next round is paired once the **last** court finishes · when there are more players than spots, fair rotation decides who plays · pairing is by total record (Swiss-style) · in doubles, partners change every round and each player has an individual record.

## 2. Rules the system follows

| Topic | Rule |
|---|---|
| Players per round | Spots = min(courts × players per match, active players rounded down to a full match). Extra courts stay free. |
| Who plays | Fewest games played, then longest wait, then a seeded random draw. Games played stay within 1 of each other unless someone joined late or rested. |
| Round 1 | Random draw; the seed is stored so any draw can be reproduced. |
| Later rounds | Those playing are ranked by net wins (wins minus losses), then average point difference, then random. Neighbours are grouped, then swaps remove rematches and repeated partners (costs: rematch 1000, repeat partner 1000, repeat opponent 300, rank imbalance 10). A rematch happens only when nothing else is possible. The best-ranked game goes on the first court. |
| Court clock | Each match has its own clock from its own Start. Pausing one court does not touch the others. |
| Time up | The court shows "TIME IS UP". The rally in progress is played; then the higher score wins. If the score is level, the next rally won wins the game (the server does not matter). The system never ends a game by itself except through that rule. |
| Finishing | Staff can use **Finish at this score**. The Admin can enter a result for any game (for example when a device was offline), extend a court by 5 minutes, cancel a game that has not started, or swap players between games that have not started. |
| Round closes | Only when every game has a result. The Admin gets an alert if a court has not started 3 minutes after the round was published. |
| New round | Published only if a full game still fits in the remaining session time; otherwise the session finishes after the last game. Games not started when the session time ends are cancelled. A game already running keeps its full limit. |
| Early end | A game ended early counts as played (for rotation) but records no win or loss. A cancelled game counts as sitting out. |
| People changes | Add a late player any time (they start level with the lowest games-played count). Mark Resting or Left; results stay. Players can only be removed before the session starts. |
| Standings | Net wins, then average point difference per game, then points per game; ties share a rank. The champion is the top of the final standings; a tie for first is shared. |
| Courts held | While a session is running or ending its courts return `COURT_IN_OPEN_PLAY` for ordinary matches. |
| Confirmation | Open Play results confirm automatically after 15 seconds (Undo is available during that time). |
| Restarts | Court clocks run on the server; after a restart any court whose time ran out gets its time-up on the next one-second tick. |

### Entering players and the session length
- **Session length** is entered with a Minutes / Hours dropdown (hours accept quarters, e.g. 1.5). It is stored as whole minutes, 10 minutes to 12 hours.
- **Each player has First name, Last name and Team (optional).** First and last name are required; the display name is "First Last" (cut at 30 characters). Team is a label shown in the player and standings tables. It does **not** affect matchmaking.
- **Import:** an **Import .xlsx or .csv** button on the create screen, the session setup screen and the late-player form reads the file in the browser. It uses the heading row (First Name, Last Name, Team; also accepts First/Last/Surname/Club, or a single Name/Full name column, which is split at the last space). With no recognisable heading it reads the columns as First, Last, Team. Empty rows are skipped and rows missing a name are flagged to fix before saving. A **Download template** link gives a sample .csv. Only the first sheet of an .xlsx is read; old .xls is not supported.
- The registered Players directory (Players page) is unchanged: it keeps its single display-name field.

## 3. Roles

Admin: creates and controls sessions (`openplay.manage`). Staff: view sessions (`openplay.view`) and keep scoring their own court, which is all that is needed for rounds to keep running. Players have no logins. The TV board at `/open-play/:id/board` is read-only and works on any signed-in device.

## 4. Design

- **Games are ordinary matches.** `matches.open_play_round_id` links a match to a round, so scoring, undo, history, reports and the Players page work unchanged. Open Play is a session → rounds → games layer around them.
- **Pure logic** lives in `packages/shared/src/openplay/` (`random`, `standings`, `pairing`, `preview`) with a seeded generator and property tests.
- **Engine events** (`packages/shared/src/scoring/engine.ts`): `TIME_UP` sets the flag; `RECORD_RESULT` finishes a game at a given score. `END_MATCH` is unchanged, so an ordinary early end still records no winner.
- **Database** migrations 2 and 3 (`open_play_sessions`, `open_play_courts`, `open_play_players`, `open_play_rounds`, `open_play_games`, `open_play_game_players`, `matches.open_play_round_id`, rebuilt `match_events` CHECK list). The migration runner turns foreign keys off for that step and checks them afterwards; a populated version-1 upgrade test covers it.
- **Server** `apps/server/src/modules/openplay.ts`; a one-second tick (`runOpenPlayTick`) drives time-up, round closing, the next round and the late-start alert.
- **API** `GET/POST /open-play`, `GET/PATCH /open-play/:id`, `POST /:id/players`, `PATCH/DELETE /:id/players/:pid`, `POST /:id/start|end|start-all|swap`, `POST /:id/games/:gid/result|cancel|extend`. Errors: `COURT_IN_OPEN_PLAY`, `OPEN_PLAY_INVALID`.
- **Web** `/open-play` (list + create with a live plan), `/open-play/:id` (control), `/open-play/:id/board` (TV), the court console states, and an Open Play filter in Game Histories.

## 5. What 20 players on 4 courts really gives

2-hour session, 15-minute games, about 3 minutes between rounds → about 6 rounds. **Doubles:** 16 play and 4 wait each round, 4–5 games per player, true winner-vs-winner from round 2. **Singles:** 8 play and 12 wait, 2–3 games per player, and a real bracket only from round 3. Singles works best with 8–12 players on 4 courts. The create screen shows this plan before you start.

## 6. Not included

Skill tiers, mixed-doubles rules, fixed teams or linked partners, player self check-in, knockout finals, pausing a whole session, and shortening a final round to fit.

## 7. Evidence and its limits

Open play formats are house rules without a governing standard. The research (paddle-rack rotation, PB Queue's longest-wait-first order, CourtControl timed rounds, Swiss and Mexicano pairing, one event's timed-game tie rule) came from guides and vendor pages, some marketing. The rules in §2 are this system's own design, not a published standard.

Migration 3 adds `first_name`, `last_name` and `team` to `open_play_players`.
