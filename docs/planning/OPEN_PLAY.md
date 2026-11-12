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
| Players who sat out the last round | **Paired with each other first, on the first courts.** Whoever sat out the previous round (or has never played) is grouped into full games with the others who sat out, never-played first if there are not enough for whole games, then by record with level players in random order. Their opponents and courts are therefore known before any result comes in, instead of depending on finishers still on court. If there are not enough for a whole game, the leftover (the ones who have played most) are paired with the others by record. Round 1 is the same rule: everyone is new, so it is a random draw. Decision 2026-11-11: this replaces pairing the waiting players strictly by record, and the rule that the best-ranked game goes on Court 1. Cost: a game of waiting players can mix records (it is tagged Mixed on the board); the Swiss ordering by record still applies to everyone else. |
| Later rounds | Everyone else is ranked by net wins (wins minus losses), then average point difference, then random. Neighbours are grouped, then swaps remove rematches and repeated partners (costs: rematch 1000, repeat partner 1000, repeat opponent 300, rank imbalance 10). A rematch happens only when nothing else is possible. The best-ranked of these games goes on the first court after the waiting players' games. |
| Court clock | Each match has its own clock from its own Start. Pausing one court does not touch the others. |
| Time up | **The result is read from the score the moment a court's time is up** (owner decision 2026-11-11, replacing the earlier "final rally" rule): the side ahead wins and the game closes (*decided on time*); nothing to enter and no final rally. A **level** score stays open and asks a person: the court's staff (on the court screen) or the Admin (on the session page) **pick the winner**, or the court plays **one more rally and whoever wins it wins** (whoever served; it counts as a point). The board shows *Level: deciding*. Staff can still tap **Finish at this score** earlier. A result decided by time cannot be undone on the court; the Admin corrects it with **Edit result**. |
| Edit result | The Admin can fix a mis-recorded score or winner on any finished game (**Edit result…** on its card, in the "Ready for Round N" panel, and in the Rounds list). The winner follows the score (a level score needs the winner chosen), a reason is required, and the edit is audit-logged and marked *edited*. The standings update immediately (they are derived from the matches); later rounds are **not** drawn again. Same engine event as the Game Histories correction (`ADMIN_CORRECTION`), via `POST /open-play/:id/games/:gid/correct`. |
| Enter result… | Still there for a court whose device was offline or that never started: type both scores, and choose the winner only if they are level. |
| Finishing | Staff can use **Finish at this score**. The Admin can enter a result for any game (for example when a device was offline), extend a court by 5 minutes, cancel a game that has not started, or swap players between games that have not started. |
| Round closes | Only when every game has a result. The Admin gets an alert if a court has not started 3 minutes after the round was published. |
| New round | Published only if a full game still fits in the remaining session time; otherwise the session finishes after the last game. Games not started when the session time ends are cancelled. A game already running keeps its full limit. **Who starts it is a per-session choice, "Start of each new round":** *Press Begin* (the default for sessions created in the web app) or *Automatic* (the API default, and how every session behaved before migration 4). |
| Begin Round N | In *Press Begin* mode, when every game of the round has a result and is confirmed, the round closes and **no new round is drawn**. The session page shows "Round N is complete / Ready for Round N+1" with **Begin Round N+1** (draws the round; the courts show Ready to start) and **Begin Round N+1 and start all courts** (draws it and starts every court at once). The TV board shows "Round N complete" with the next round locked, and a banner. Only the Admin can begin. If nobody presses Begin and a full game no longer fits, the session finishes on its own. Begin is refused while a round is still being played (409), when too few players are active (422), or when there is no time left (409). The Admin can switch between *Press Begin* and *Automatic* at any time, including while running; switching to Automatic while waiting draws the round at once. |
| Starting courts | Staff tap Start on a court's own device. The Admin can also start one game from the session page (**Start** on its card) or all waiting games (**Start all waiting courts**). Courts keep their own clocks, so starting them at different times is still fine. |
| Early end | A game ended early counts as played (for rotation) but records no win or loss. A cancelled game counts as sitting out. |
| People changes | Add a late player any time (they start level with the lowest games-played count). Mark Resting or Left; results stay. Players can only be removed before the session starts. |
| Standings | Net wins, then average point difference per game, then points per game; ties share a rank. The champion is the top of the final standings; a tie for first is shared. |
| Courts held | While a session is running or ending its courts return `COURT_IN_OPEN_PLAY` for ordinary matches. |
| Confirmation | Open Play results confirm automatically after 15 seconds (Undo is available during that time). |
| Restarts | Court clocks run on the server; after a restart any court whose time ran out gets its time-up on the next one-second tick. |

### Next-round bracket (session page)
Below "Waiting for the next round" the session page draws the next round as a bracket: this round's games and the waiting players on the left, the projected games on the right, with a line into each game from the waiting players and from every game that has a result or a leader. It is a **projection**, not a lock: the rules are unchanged, and the real round is still drawn from the real results when the last court finishes.
- Who plays next does not depend on results (fewest games, longest wait, then the session's seeded random), so the **waiting players' places and opponents are already shown**. Only the ordering by record depends on results.
- Games still being played count their current leader provisionally (tagged *Leading* / *Trailing*); games not decided yet are tagged *Court N not decided* and draw no line. The projection moves with every point (it reads the live court scores).
- Once every result is in, the bracket shows *Locked*, and it is exactly the round the server then publishes (`projectNextRound` in `packages/shared/src/openplay/projection.ts` runs the same `planRound` with the same seed; test: `apps/server/test/openplay-projection.test.ts`).
- Hidden when a further round will not be published (not enough session time for a full game, or not enough active players). Lines show from the `lg` breakpoint; on tablets and phones the games stack and each player's tag says where they come from.
- **TV board** (`/open-play/:id/board`), light Peecool style, built for reading across a room (`apps/web/src/pages/openplay/tv.tsx`):
  - *Header*: logo, session name, round, a large session clock, and a thin progress bar for the session time used.
  - *Three columns of match cards, one row per court* (the other courts' matches sit in the rows below): **Now playing** (a scoreboard tile: team names either side of a large score, a Live / Ready / Final pill, and a bar for that court's own clock), **Up next** (the game that follows on that same court, projected from real results) and **After next** (slots only, see below). An animated ">>>" mark joins each column to the next. A court that is free in a column shows a dashed placeholder.
  - *After next* is **never guessed**. The round after the next depends on results that do not exist yet, so that column only shows slots: one dashed card per court reading **Waiting for the winner/loser** for each team, with no names, chips or pool tag. Players are named only when real results decide the pairing, which happens when the Up-next round's turn comes: it then moves to the Up-next column and a new After-next column of slots follows. It is hidden when there is less than two rounds' worth of session time left (2 x (game time + changeover)).
  - *Up next is precise about players.* It uses real results only (`projectNextRound(..., { provisional: false })`: the leader of an unfinished game is not counted). A player is **named** only when that is certain: waiting now (always plays next, hourglass chip) or coming off a **finished** game (**W2** won court 2, **L2** lost it). Everyone coming off a game that is still being played or not started reads **Undecided**, with a **?2** chip saying which court they wait on, and the game's pool tag shows **Pending** until everyone in it is known. Names fill in as each court finishes; when every result is in the column is *Locked* and fully named. Pool tags (Winners, Losers, Even, Mixed) say whether the players meeting are all ahead, all behind, all level, or a mix.
  - There is no separate waiting box or list on the TV while a next round is projected: waiting players show as hourglass chips in the game they play. Only when there is no next round to project (final games, not enough time or players) does the board show a one-line *Waiting:* list.
  - *Standings*: a slim leaderboard (rank, name, W-L, average point difference). When the session finishes the board shows the champion banner and the full standings.
  - The diagram is scaled down (never up) to fit the screen height so the TV never needs to scroll; with many courts the text gets smaller. When there is no next round to draw (final games, not enough time or players) the board shows the court tiles with a notice.
  - Shared logic for the lines and the fit-to-screen scaling is in `bracketKit.tsx`; the admin page's bracket (`Bracket.tsx`) uses the same projection and helpers.

### Setup is three steps
Creating a session, and editing one before it starts, use three steps: **1 Session setup** (name, doubles/singles, session length, game time limit, changeover, scoring rules), **2 Courts to use** (with Select all available / Clear), **3 Players** (type or import). The plan preview ("what to expect") sits under the courts and players steps. When creating, a step opens once the earlier ones are filled in (a name; at least one court) and Create session appears on step 3. On an existing session the steps are tabs you can open in any order; Save settings, Start session and Cancel session stay visible under all of them.

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
- **API** `GET/POST /open-play`, `GET/PATCH /open-play/:id`, `POST /:id/begin` (`{ startAll? }`), `POST /:id/games/:gid/start`, `POST /:id/players`, `PATCH/DELETE /:id/players/:pid`, `POST /:id/start|end|begin|start-all|swap`, `POST /:id/games/:gid/result|correct|cancel|extend|start`. Errors: `COURT_IN_OPEN_PLAY`, `OPEN_PLAY_INVALID`.
- **Web** `/open-play` (list + create with a live plan), `/open-play/:id` (control), `/open-play/:id/board` (TV), the court console states, and an Open Play filter in Game Histories.

## 5. What 20 players on 4 courts really gives

2-hour session, 15-minute games, about 3 minutes between rounds → about 6 rounds. **Doubles:** 16 play and 4 wait each round, 4–5 games per player, true winner-vs-winner from round 2. **Singles:** 8 play and 12 wait, 2–3 games per player, and a real bracket only from round 3. Singles works best with 8–12 players on 4 courts. The create screen shows this plan before you start.

## 6. Not included

Skill tiers, mixed-doubles rules, fixed teams or linked partners, player self check-in, knockout finals, pausing a whole session, and shortening a final round to fit.

## 7. Evidence and its limits

Open play formats are house rules without a governing standard. The research (paddle-rack rotation, PB Queue's longest-wait-first order, CourtControl timed rounds, Swiss and Mexicano pairing, one event's timed-game tie rule) came from guides and vendor pages, some marketing. The rules in §2 are this system's own design, not a published standard.

Migration 3 adds `first_name`, `last_name` and `team` to `open_play_players`.
