import type {
  DecidedBy, EarlyEndReason, EventType, MatchConfig, MatchRules, MatchStatus, Outcome, Phase, Slot, Team,
} from '../types';

/* ------------------------------------------------------------------ types */

export type EngineErrorCode =
  | 'INVALID_STATE' | 'VALIDATION_ERROR' | 'NOTHING_TO_UNDO' | 'ADJUST_WOULD_END_GAME' | 'INVALID_CORRECTION';

export class EngineError extends Error {
  constructor(public code: EngineErrorCode, message: string, public details?: Record<string, unknown>) {
    super(message);
    this.name = 'EngineError';
  }
}

export interface GameState {
  number: number;
  target: number;
  score: { A: number; B: number };
  firstServingTeam: Team | null;
  startRight: { A: Slot; B: Slot };
  switchEndsTriggered: boolean;
  winner: Team | null;
  abandoned: boolean;
  startedAt: number;
  endedAt: number | null;
}

export interface LastAction {
  seq: number;
  type: EventType;
  team?: Team;
  outcome?: Outcome | string;
  undoneType?: EventType;
  undoneOutcome?: string;
}

export interface MatchState {
  status: MatchStatus;
  phase: Phase | null;
  phaseBeforePause: 'playing' | 'game_over' | null;
  phaseChangedAt: number | null;
  games: GameState[];
  servingTeam: Team | null;
  serverNumber: 1 | 2 | null;
  serverSlot: Slot | null;
  gamesWon: { A: number; B: number };
  winner: Team | null;
  switchEndsPending: boolean;
  leftTeam: Team;
  timer: { startedAt: number | null; pausedAt: number | null; pausedTotalMs: number; endedAt: number | null };
  endReason: string | null;
  endNote: string | null;
  /** Open Play: this game's time limit has passed — the rally in progress is the last one (see RALLY_WON) */
  timeUp: boolean;
  /** Open Play: scores were level after the final rally — the next rally won decides the game */
  suddenDeath: boolean;
  decidedBy: DecidedBy | null;
  lastAction: LastAction | null;
}

export interface EngineEvent {
  seq: number;
  type: EventType;
  payload: Record<string, any>;
  at: number;
  /** seq of the UNDO that voided this event (replay skips voided events) */
  voidedBy?: number | null;
  /** for an UNDO event: seq of the event it voided */
  undoes?: number | null;
}

export const UNDOABLE: ReadonlySet<EventType> = new Set<EventType>(['RALLY_WON', 'ADJUST_SCORE', 'START_NEXT_GAME', 'RECORD_RESULT']);

/* --------------------------------------------------------------- helpers */

export const other = (t: Team): Team => (t === 'A' ? 'B' : 'A');
const otherSlot = (s: Slot): Slot => (s === 1 ? 2 : 1);

export function isDoublesSideOutAuto(c: MatchConfig): boolean {
  return c.playType === 'doubles' && c.rules.scoringType === 'side_out' && c.rules.servingMode === 'auto';
}

export function createInitialState(): MatchState {
  return {
    status: 'setup', phase: null, phaseBeforePause: null, phaseChangedAt: null, games: [],
    servingTeam: null, serverNumber: null, serverSlot: null, gamesWon: { A: 0, B: 0 }, winner: null,
    switchEndsPending: false, leftTeam: 'A',
    timer: { startedAt: null, pausedAt: null, pausedTotalMs: 0, endedAt: null },
    endReason: null, endNote: null, timeUp: false, suddenDeath: false, decidedBy: null, lastAction: null,
  };
}

export function currentGame(s: MatchState): GameState | null {
  return s.games.length ? (s.games[s.games.length - 1] as GameState) : null;
}

export function isDecidingGame(s: MatchState, r: MatchRules): boolean {
  return r.gamesToWin === 1 || (s.gamesWon.A === r.gamesToWin - 1 && s.gamesWon.B === r.gamesToWin - 1);
}

function gameTarget(s: MatchState, r: MatchRules): number {
  return isDecidingGame(s, r) ? (r.decidingGamePoints ?? r.pointsToWin) : r.pointsToWin;
}

/** MATCH_SCORING_LOGIC §6.1 */
export function isGameWonBy(score: { A: number; B: number }, t: Team, target: number, r: MatchRules): boolean {
  const o = other(t);
  if (r.pointCap != null && score[t] >= r.pointCap) return true;
  return score[t] >= target && score[t] - score[o] >= r.winBy;
}

export function rightSlot(g: GameState, team: Team, playType: MatchConfig['playType']): Slot {
  if (playType === 'singles') return 1;
  return g.score[team] % 2 === 0 ? g.startRight[team] : otherSlot(g.startRight[team]);
}

function midpoint(target: number): number { return Math.ceil(target / 2); }

function switchEndsApplies(s: MatchState, r: MatchRules): boolean {
  return r.switchEndsPrompt === 'every_game' || (r.switchEndsPrompt === 'deciding_game' && isDecidingGame(s, r));
}

const clone = <T>(v: T): T => structuredClone(v);

function assertState(cond: boolean, s: MatchState, what: string): void {
  if (!cond) throw new EngineError('INVALID_STATE', `${what} is not allowed now`, { status: s.status, phase: s.phase });
}

/* ----------------------------------------------------------- apply event */

function setupServing(s: MatchState, c: MatchConfig, g: GameState, payload: Record<string, any>): void {
  if (c.rules.servingMode === 'off') {
    if (payload.servingTeam != null) throw new EngineError('VALIDATION_ERROR', 'servingTeam is not allowed when serving is off');
    s.servingTeam = null; s.serverNumber = null; s.serverSlot = null; g.firstServingTeam = null;
    return;
  }
  const st = payload.servingTeam as Team | undefined;
  if (st !== 'A' && st !== 'B') throw new EngineError('VALIDATION_ERROR', 'servingTeam is required');
  g.firstServingTeam = st;
  s.servingTeam = st;
  s.serverSlot = c.playType === 'singles' ? 1 : g.startRight[st];
  s.serverNumber = isDoublesSideOutAuto(c) ? (c.rules.firstServerRule === 'both_servers' ? 1 : 2) : null;
}

function newGame(s: MatchState, c: MatchConfig, payload: Record<string, any>, at: number, prev?: GameState): GameState {
  const startRight: { A: Slot; B: Slot } = {
    A: (payload.startRight?.A ?? prev?.startRight.A ?? 1) as Slot,
    B: (payload.startRight?.B ?? prev?.startRight.B ?? 1) as Slot,
  };
  const g: GameState = {
    number: s.games.length + 1, target: gameTarget(s, c.rules), score: { A: 0, B: 0 }, firstServingTeam: null,
    startRight, switchEndsTriggered: false, winner: null, abandoned: false, startedAt: at, endedAt: null,
  };
  setupServing(s, c, g, payload);
  return g;
}

/** Ends the current game in favour of `team` (shared by normal wins, time-up wins and recorded results). */
function winGame(s: MatchState, c: MatchConfig, g: GameState, team: Team, at: number, by: DecidedBy): Outcome {
  g.winner = team; g.endedAt = at; s.gamesWon[team] += 1; s.phaseChangedAt = at; s.switchEndsPending = false; s.decidedBy = by;
  if (s.gamesWon[team] === c.rules.gamesToWin) {
    s.winner = team; s.phase = 'match_over'; s.timer.endedAt = at;
    return 'match_won';
  }
  s.phase = 'game_over';
  return 'game_won';
}

function pointScored(s: MatchState, c: MatchConfig, g: GameState, team: Team, at: number): Outcome | null {
  // switch-ends banner (§7)
  if (switchEndsApplies(s, c.rules) && !g.switchEndsTriggered && Math.max(g.score.A, g.score.B) >= midpoint(g.target)) {
    g.switchEndsTriggered = true;
    s.switchEndsPending = true;
  }
  if (isGameWonBy(g.score, team, g.target, c.rules)) return winGame(s, c, g, team, at, 'target');
  return null;
}

export function applyEvent(prev: MatchState, ev: EngineEvent, c: MatchConfig): MatchState {
  const s = clone(prev);
  const p = ev.payload ?? {};
  const g = currentGame(s);
  const at = ev.at;
  const last = (extra: Partial<LastAction> = {}) => { s.lastAction = { seq: ev.seq, type: ev.type, ...extra }; };

  switch (ev.type) {
    case 'MATCH_CREATED':
      return s;

    case 'START_MATCH': {
      assertState(s.status === 'setup', s, 'START_MATCH');
      s.status = 'in_progress'; s.phase = 'playing'; s.phaseChangedAt = at; s.timer.startedAt = at;
      if (p.leftTeam === 'A' || p.leftTeam === 'B') s.leftTeam = p.leftTeam;
      const ng = newGame(s, c, p, at);
      s.games.push(ng);
      last();
      return s;
    }

    case 'RALLY_WON': {
      assertState(s.status === 'in_progress' && s.phase === 'playing' && g != null, s, 'RALLY_WON');
      const W = p.team as Team;
      if (W !== 'A' && W !== 'B') throw new EngineError('VALIDATION_ERROR', 'team must be A or B');
      const game = g as GameState;
      s.switchEndsPending = false;
      let outcome: Outcome;
      let scored = false;
      const serving = c.rules.servingMode === 'auto';
      if (!serving) {
        game.score[W] += 1; outcome = 'point'; scored = true;
      } else {
        const S = s.servingTeam as Team;
        const R = other(S);
        if (c.rules.scoringType === 'rally') {
          if (W === S) { game.score[S] += 1; outcome = 'point'; }
          else {
            game.score[R] += 1; s.servingTeam = R; outcome = 'point_side_out';
            if (c.playType === 'doubles') s.serverSlot = rightSlot(game, R, c.playType);
          }
          scored = true;
        } else if (c.playType === 'singles') {
          if (W === S) { game.score[S] += 1; outcome = 'point'; scored = true; }
          else { s.servingTeam = R; outcome = 'side_out'; }
        } else {
          if (W === S) { game.score[S] += 1; outcome = 'point'; scored = true; }
          else if (s.serverNumber === 1) {
            s.serverNumber = 2; s.serverSlot = otherSlot(s.serverSlot as Slot); outcome = 'second_server';
          } else {
            s.servingTeam = R; s.serverNumber = 1; s.serverSlot = rightSlot(game, R, c.playType); outcome = 'side_out';
          }
        }
      }
      let end: Outcome | null = scored ? pointScored(s, c, game, W, at) : null;
      // Open Play time-up (R17): the rally in progress is the last one, then the higher score wins;
      // if level, the next rally won decides the game — whoever served.
      if (!end && s.timeUp && game.winner == null) {
        if (s.suddenDeath) {
          if (!scored) game.score[W] += 1;
          end = winGame(s, c, game, W, at, 'tiebreak');
        } else if (game.score.A !== game.score.B) {
          end = winGame(s, c, game, game.score.A > game.score.B ? 'A' : 'B', at, 'time');
        } else s.suddenDeath = true;
      }
      last({ team: W, outcome: end ?? outcome });
      return s;
    }

    case 'TIME_UP': {
      assertState(s.status === 'in_progress' && s.phase === 'playing' && !s.timeUp, s, 'TIME_UP');
      s.timeUp = true;
      last({ outcome: 'time_up' });
      return s;
    }

    case 'RECORD_RESULT': {
      assertState(s.status === 'in_progress' && s.phase === 'playing' && g != null, s, 'RECORD_RESULT');
      const game = g as GameState;
      const a = p.scoreA ?? game.score.A, b = p.scoreB ?? game.score.B;
      if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) throw new EngineError('VALIDATION_ERROR', 'Scores must be whole numbers ≥ 0');
      const w: Team | null = p.winner === 'A' || p.winner === 'B' ? p.winner : a > b ? 'A' : b > a ? 'B' : null;
      if (!w) throw new EngineError('VALIDATION_ERROR', 'The score is level — play on, or choose the winner');
      game.score = { A: a, B: b };
      last({ team: w, outcome: winGame(s, c, game, w, at, 'result') });
      return s;
    }

    case 'ADJUST_SCORE': {
      assertState(s.status === 'in_progress' && s.phase === 'playing' && g != null, s, 'ADJUST_SCORE');
      const game = g as GameState;
      const a = p.scoreA, b = p.scoreB;
      if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) throw new EngineError('VALIDATION_ERROR', 'Scores must be whole numbers ≥ 0');
      const sc = { A: a as number, B: b as number };
      if (isGameWonBy(sc, 'A', game.target, c.rules) || isGameWonBy(sc, 'B', game.target, c.rules))
        throw new EngineError('ADJUST_WOULD_END_GAME', 'That score would end the game; record the final point with the rally button');
      game.score = sc;
      if (c.rules.servingMode === 'auto') {
        const st = p.servingTeam as Team | undefined;
        if (st !== 'A' && st !== 'B') throw new EngineError('VALIDATION_ERROR', 'servingTeam is required');
        if (p.rightSlot) {
          for (const t of ['A', 'B'] as Team[]) {
            const rs = p.rightSlot[t] as Slot | undefined;
            if (rs === 1 || rs === 2) game.startRight[t] = sc[t] % 2 === 0 ? rs : otherSlot(rs);
          }
        }
        s.servingTeam = st;
        if (isDoublesSideOutAuto(c)) {
          const sn = p.serverNumber;
          if (sn !== 1 && sn !== 2) throw new EngineError('VALIDATION_ERROR', 'serverNumber (1 or 2) is required');
          s.serverNumber = sn;
          const rs = rightSlot(game, st, c.playType);
          s.serverSlot = (p.serverSlot === 1 || p.serverSlot === 2) ? p.serverSlot : (sn === 1 ? rs : otherSlot(rs));
        } else {
          if (p.serverNumber != null) throw new EngineError('VALIDATION_ERROR', 'serverNumber is only used in doubles side-out');
          s.serverNumber = null;
          s.serverSlot = c.playType === 'singles' ? 1 : rightSlot(game, st, c.playType);
        }
      } else if (p.servingTeam != null) throw new EngineError('VALIDATION_ERROR', 'Serving is not tracked in this match');
      s.switchEndsPending = false;
      game.switchEndsTriggered = switchEndsApplies(s, c.rules) && Math.max(sc.A, sc.B) >= midpoint(game.target);
      last({ outcome: 'adjusted' });
      return s;
    }

    case 'START_NEXT_GAME': {
      assertState(s.status === 'in_progress' && s.phase === 'game_over' && g != null, s, 'START_NEXT_GAME');
      s.phase = 'playing'; s.phaseChangedAt = at; s.timeUp = false; s.suddenDeath = false; s.decidedBy = null;
      const ng = newGame(s, c, p, at, g as GameState);
      s.games.push(ng);
      if (p.swapDisplay) s.leftTeam = other(s.leftTeam);
      last();
      return s;
    }

    case 'PAUSE': {
      assertState(s.status === 'in_progress' && (s.phase === 'playing' || s.phase === 'game_over'), s, 'PAUSE');
      s.phaseBeforePause = s.phase as 'playing' | 'game_over';
      s.status = 'paused'; s.timer.pausedAt = at;
      last();
      return s;
    }

    case 'RESUME': {
      assertState(s.status === 'paused', s, 'RESUME');
      s.timer.pausedTotalMs += at - (s.timer.pausedAt ?? at);
      s.timer.pausedAt = null; s.status = 'in_progress'; s.phase = s.phaseBeforePause ?? 'playing'; s.phaseBeforePause = null;
      last();
      return s;
    }

    case 'SWAP_SIDES': {
      assertState(['setup', 'in_progress', 'paused'].includes(s.status), s, 'SWAP_SIDES');
      s.leftTeam = other(s.leftTeam);
      return s; // intentionally leaves lastAction untouched
    }

    case 'UPDATE_PLAYERS': {
      assertState(['setup', 'in_progress', 'paused'].includes(s.status), s, 'UPDATE_PLAYERS');
      return s;
    }

    case 'UPDATE_RULES': {
      assertState(s.status === 'setup', s, 'UPDATE_RULES');
      return s;
    }

    case 'CONFIRM_MATCH_END': {
      assertState(s.status === 'in_progress' && s.phase === 'match_over', s, 'CONFIRM_MATCH_END');
      s.status = 'completed'; s.phase = null; s.endReason = 'completed'; s.phaseChangedAt = at;
      last();
      return s;
    }

    case 'END_MATCH': {
      assertState((s.status === 'in_progress' || s.status === 'paused') && s.phase !== 'match_over', s, 'END_MATCH');
      if (p.confirmed !== true) throw new EngineError('VALIDATION_ERROR', 'END_MATCH must be confirmed');
      const reason = p.reason as EarlyEndReason;
      if (!['time_up', 'injury', 'players_left', 'other'].includes(reason)) throw new EngineError('VALIDATION_ERROR', 'Invalid end reason');
      if (reason === 'other' && !(typeof p.note === 'string' && p.note.trim())) throw new EngineError('VALIDATION_ERROR', 'A note is required for "other"');
      if (s.status === 'paused') { s.timer.pausedTotalMs += at - (s.timer.pausedAt ?? at); s.timer.pausedAt = null; }
      s.timer.endedAt = at;
      s.status = 'terminated'; s.phase = null; s.phaseBeforePause = null;
      s.endReason = reason; s.endNote = p.note ? String(p.note).slice(0, 200) : null;
      s.winner = null;
      const game = g;
      if (game && game.winner == null) { game.endedAt = at; game.abandoned = true; }
      last();
      return s;
    }

    case 'CANCEL': {
      assertState(s.status === 'setup', s, 'CANCEL');
      s.status = 'cancelled';
      last();
      return s;
    }

    case 'ADMIN_CORRECTION': {
      assertState(s.status === 'completed' || s.status === 'terminated', s, 'ADMIN_CORRECTION');
      const list = (p.games ?? []) as { number: number; scoreA: number; scoreB: number; winner?: Team }[];
      if (!list.length) throw new EngineError('INVALID_CORRECTION', 'No games supplied');
      for (const item of list) {
        const game = s.games.find((x) => x.number === item.number);
        if (!game) throw new EngineError('INVALID_CORRECTION', `Game ${item.number} does not exist`);
        if (!Number.isInteger(item.scoreA) || !Number.isInteger(item.scoreB) || item.scoreA < 0 || item.scoreB < 0)
          throw new EngineError('INVALID_CORRECTION', 'Scores must be whole numbers ≥ 0');
        game.score = { A: item.scoreA, B: item.scoreB };
        const aw = isGameWonBy(game.score, 'A', game.target, c.rules);
        const bw = isGameWonBy(game.score, 'B', game.target, c.rules);
        let w: Team | null = aw && !bw ? 'A' : bw && !aw ? 'B' : null;
        if (w == null) {
          if (!p.force || (item.winner !== 'A' && item.winner !== 'B'))
            throw new EngineError('INVALID_CORRECTION', `Game ${item.number} has no valid winner under the match rules`);
          w = item.winner;
        }
        game.winner = w; game.abandoned = false; game.endedAt = game.endedAt ?? at;
      }
      s.gamesWon = { A: s.games.filter((x) => x.winner === 'A').length, B: s.games.filter((x) => x.winner === 'B').length };
      const winner = s.gamesWon.A >= c.rules.gamesToWin ? 'A' : s.gamesWon.B >= c.rules.gamesToWin ? 'B' : null;
      if (s.status === 'completed' && !winner) throw new EngineError('INVALID_CORRECTION', 'The corrected scores do not decide the match');
      if (winner) { s.winner = winner; s.status = 'completed'; }
      last({ outcome: 'corrected' });
      return s;
    }

    case 'UNDO':
      throw new EngineError('INVALID_STATE', 'UNDO is applied through replay');
  }
}

/* ---------------------------------------------------------------- replay */

/** Rebuild state from the full event list; voided events and UNDO events are handled here. */
export function replay(c: MatchConfig, events: EngineEvent[]): MatchState {
  let s = createInitialState();
  const byseq = new Map(events.map((e) => [e.seq, e]));
  for (const e of [...events].sort((a, b) => a.seq - b.seq)) {
    if (e.type === 'UNDO') {
      const target = e.undoes != null ? byseq.get(e.undoes) : undefined;
      s = { ...s, lastAction: { seq: e.seq, type: 'UNDO', undoneType: target?.type, undoneOutcome: undefined } };
      continue;
    }
    if (e.voidedBy != null) continue;
    s = applyEvent(s, e, c);
  }
  return s;
}

/** The event an UNDO would void, or null. */
export function findUndoTarget(events: EngineEvent[]): EngineEvent | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i] as EngineEvent;
    if (e.voidedBy == null && UNDOABLE.has(e.type)) return e;
  }
  return null;
}

export function canUndo(state: MatchState, events: EngineEvent[]): boolean {
  return state.status === 'in_progress' && findUndoTarget(events) != null;
}

/**
 * Apply an UNDO: returns the voided event's seq and the rebuilt state.
 * Throws NOTHING_TO_UNDO / INVALID_STATE per the precondition matrix.
 */
export function applyUndo(state: MatchState, events: EngineEvent[], c: MatchConfig, undoSeq: number, at: number):
  { voided: EngineEvent; state: MatchState; undoEvent: EngineEvent } {
  if (state.status !== 'in_progress') throw new EngineError('INVALID_STATE', 'UNDO is not allowed now', { status: state.status, phase: state.phase });
  const target = findUndoTarget(events);
  if (!target) throw new EngineError('NOTHING_TO_UNDO', 'Nothing to undo');
  const undoEvent: EngineEvent = { seq: undoSeq, type: 'UNDO', payload: {}, at, undoes: target.seq };
  const next = events.map((e) => (e.seq === target.seq ? { ...e, voidedBy: undoSeq } : e));
  next.push(undoEvent);
  const ns = replay(c, next);
  // describe what was undone for the "Undid:" line
  ns.lastAction = { seq: undoSeq, type: 'UNDO', undoneType: target.type };
  return { voided: target, state: ns, undoEvent };
}

/* ------------------------------------------------------------- view model */

export interface DerivedView {
  gameNumber: number | null;
  score: { A: number; B: number };
  servingTeam: Team | null;
  serverNumber: 1 | 2 | null;
  serverSlot: Slot | null;
  serviceCourt: 'right' | 'left' | null;
  rightSlot: { A: Slot; B: Slot } | null;
  scoreCall: string;
  gamePointTeam: Team | null;
  matchPointTeam: Team | null;
  isDecidingGame: boolean;
}

export function deriveView(s: MatchState, c: MatchConfig): DerivedView {
  const g = currentGame(s);
  const score = g ? { ...g.score } : { A: 0, B: 0 };
  const auto = c.rules.servingMode === 'auto';
  const view: DerivedView = {
    gameNumber: g?.number ?? null, score,
    servingTeam: auto ? s.servingTeam : null, serverNumber: auto ? s.serverNumber : null,
    serverSlot: auto ? s.serverSlot : null, serviceCourt: null, rightSlot: null, scoreCall: `${score.A}-${score.B}`,
    gamePointTeam: null, matchPointTeam: null, isDecidingGame: isDecidingGame(s, c.rules),
  };
  if (!g) return view;
  if (auto && s.servingTeam) {
    const st = s.servingTeam;
    view.rightSlot = { A: rightSlot(g, 'A', c.playType), B: rightSlot(g, 'B', c.playType) };
    if (isDoublesSideOutAuto(c)) {
      view.serviceCourt = view.rightSlot[st] === s.serverSlot ? 'right' : 'left';
      view.scoreCall = `${score[st]}-${score[other(st)]}-${s.serverNumber}`;
    } else {
      view.serviceCourt = score[st] % 2 === 0 ? 'right' : 'left';
      view.scoreCall = `${score[st]}-${score[other(st)]}`;
    }
  }
  // game point / match point (only while a game is being played)
  if (s.status === 'in_progress' && s.phase === 'playing' && g.winner == null) {
    const cands: Team[] = [];
    for (const t of ['A', 'B'] as Team[]) {
      if (auto && c.rules.scoringType === 'side_out' && s.servingTeam !== t) continue;
      const trial = { ...score, [t]: score[t] + 1 } as { A: number; B: number };
      if (isGameWonBy(trial, t, g.target, c.rules)) cands.push(t);
    }
    const gp = cands.length === 1 ? cands[0]! : cands.length === 2 ? (auto ? s.servingTeam : null) : null;
    view.gamePointTeam = gp ?? null;
    if (gp && s.gamesWon[gp] + 1 === c.rules.gamesToWin) view.matchPointTeam = gp;
  }
  return view;
}

/* ----------------------------------------------------------------- timer */

export function elapsedMs(s: MatchState, now: number): number {
  const t = s.timer;
  if (t.startedAt == null) return 0;
  const end = t.endedAt ?? now;
  const pausedNow = t.pausedAt != null && t.endedAt == null ? now - t.pausedAt : 0;
  return Math.max(0, end - t.startedAt - t.pausedTotalMs - pausedNow);
}

export function occupiedMs(s: MatchState, now: number): number {
  const t = s.timer;
  if (t.startedAt == null) return 0;
  return Math.max(0, (t.endedAt ?? now) - t.startedAt);
}

/** Human label for the "Last:" line. */
export function describeLastAction(a: LastAction | null): string | null {
  if (!a) return null;
  switch (a.type) {
    case 'RALLY_WON': {
      const o = a.outcome === 'second_server' ? '2nd server' : a.outcome === 'side_out' ? 'side out'
        : a.outcome === 'game_won' ? 'game won' : a.outcome === 'match_won' ? 'match won'
        : a.outcome === 'point_side_out' ? 'point, serve changes' : 'point';
      return `Rally → Team ${a.team} (${o})`;
    }
    case 'UNDO': return `Undid: ${a.undoneType === 'RALLY_WON' ? 'last rally' : (a.undoneType ?? 'last action').toLowerCase().replace(/_/g, ' ')}`;
    case 'ADJUST_SCORE': return 'Score adjusted';
    case 'START_NEXT_GAME': return 'Next game started';
    case 'TIME_UP': return 'Time is up';
    case 'RECORD_RESULT': return `Result recorded: Team ${a.team} wins`;
    case 'START_MATCH': return 'Match started';
    case 'PAUSE': return 'Paused';
    case 'RESUME': return 'Resumed';
    case 'CONFIRM_MATCH_END': return 'Result confirmed';
    case 'END_MATCH': return 'Match ended early';
    default: return null;
  }
}
