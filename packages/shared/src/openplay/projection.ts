import type { OpenPlayGameDto, OpenPlayRoundDto, OpenPlaySessionDto } from '../api';
import { addToHistory, emptyHistory, planRound, type PairHistory, type RoundPlan } from './pairing';
import type { OpPlayerStat } from './standings';

/** Where a projected player comes from: a game in the current round (with how settled it is), or null when waiting now. */
export interface ProjectedSource { gameId: number; courtName: string; state: 'final' | 'leading' | 'pending'; outcome: 'won' | 'lost' | null }
export interface ProjectedPlayer { id: number; name: string; from: ProjectedSource | null; /** net wins (wins minus losses) including the provisional results of unfinished games */ net: number }
/** Who is meeting: everyone ahead on record (winners), everyone behind (losers), everyone level (even), or a mix. */
export type Pool = 'winners' | 'losers' | 'even' | 'mixed';
export interface ProjectedGame { courtId: number; courtName: string; teamA: ProjectedPlayer[]; teamB: ProjectedPlayer[]; pool: Pool }
export interface NextRoundProjection {
  roundNumber: number;
  games: ProjectedGame[];
  /** still waiting after the next round is drawn */
  waitingAfter: { id: number; name: string }[];
  /** true when every game of the current round has a result: this is then exactly the round that will be published */
  final: boolean;
}

/** Live score overrides by game id (the court consoles update faster than the session data). */
export type LiveScores = Record<number, { scoreA: number; scoreB: number }>;

interface Prepared {
  cur: OpenPlayRoundDto;
  stats: Map<number, OpPlayerStat>;
  history: PairHistory;
  source: Map<number, ProjectedSource>;
  courtName: Map<number, string>;
}

function prepare(s: OpenPlaySessionDto, live: LiveScores, provisional: boolean): Prepared | null {
  const cur = s.currentRound;
  if (!cur || s.status !== 'running') return null;
  const gamesOf = (g: OpenPlayGameDto) => [...g.teamA, ...g.teamB].map((p) => p.id);

  const lastRound = new Map<number, number>();
  const history = emptyHistory();
  for (const r of s.rounds) {
    const played = r.games.filter((g) => g.status !== 'cancelled');
    for (const g of played) for (const id of gamesOf(g)) lastRound.set(id, Math.max(lastRound.get(id) ?? 0, r.number));
    addToHistory(history, played.map((g) => ({ teamA: g.teamA.map((p) => p.id), teamB: g.teamB.map((p) => p.id) })));
  }

  const stats = new Map<number, OpPlayerStat>(s.players.map((p) => [p.id, {
    id: p.id, name: p.name, status: p.status, played: p.played, scored: p.wins + p.losses, wins: p.wins, losses: p.losses,
    pointsFor: p.pointsFor, pointsAgainst: p.pointsAgainst, lastRound: lastRound.get(p.id) ?? null, joinedRound: p.joinedRound,
  }]));

  // Player stats only include a game once its match is `completed` (the result is confirmed). Any other current-round result,
  // decided or merely leading, is added here exactly once so the projection never double-counts or misses one.
  const source = new Map<number, ProjectedSource>();
  for (const g of cur.games) {
    if (g.status === 'cancelled') continue;
    const a = live[g.id]?.scoreA ?? g.scoreA, b = live[g.id]?.scoreB ?? g.scoreB;
    const decided = g.winner ?? (provisional && g.status === 'playing' && a !== b ? (a > b ? 'A' : 'B') : null);
    const settled = g.status === 'finished';
    const counted = g.matchStatus === 'completed';
    for (const [team, list, mine, theirs] of [['A', g.teamA, a, b], ['B', g.teamB, b, a]] as const) for (const p of list) {
      source.set(p.id, { gameId: g.id, courtName: g.courtName, state: settled ? 'final' : decided ? 'leading' : 'pending', outcome: decided ? (decided === team ? 'won' : 'lost') : null });
      const st = stats.get(p.id);
      if (decided && st && !counted) { st.scored++; st.pointsFor += mine; st.pointsAgainst += theirs; if (decided === team) st.wins++; else st.losses++; }
    }
  }
  return { cur, stats, history, source, courtName: new Map(s.courts.map((c) => [c.id, c.name])) };
}

const poolOf = (nets: number[]): Pool => nets.every((n) => n > 0) ? 'winners' : nets.every((n) => n < 0) ? 'losers' : nets.every((n) => n === 0) ? 'even' : 'mixed';

function toProjection(pr: Prepared, plan: RoundPlan, roundNumber: number, source: Map<number, ProjectedSource>, final: boolean): NextRoundProjection {
  const pp = (id: number): ProjectedPlayer => { const st = pr.stats.get(id)!; return { id, name: st.name, from: source.get(id) ?? null, net: st.wins - st.losses }; };
  return {
    roundNumber,
    games: plan.games.map((g) => { const teamA = g.teamA.map(pp), teamB = g.teamB.map(pp); return { courtId: g.courtId, courtName: pr.courtName.get(g.courtId) ?? `Court ${g.courtId}`, teamA, teamB, pool: poolOf([...teamA, ...teamB].map((p) => p.net)) }; }),
    waitingAfter: plan.waiting.map((id) => ({ id, name: pr.stats.get(id)!.name })),
    final,
  };
}

/**
 * Projects the next round from the session as it is right now (plan R8-R11, same `planRound` the server uses, same seed).
 * Who plays next does not depend on results (fewest games, longest wait, seeded random); only the pairing order does.
 * Unfinished games are provisionally counted for whoever leads, so the projection moves as the scores move.
 * With `provisional: false` (the TV board) only real results count: an unfinished game is `pending` for everyone in it,
 * leaders are not counted, and the caller shows those players as undecided instead of naming them.
 * Only the next round is projected: rounds after it depend on results that do not exist yet, so they are never guessed.
 */
export function projectNextRound(s: OpenPlaySessionDto, live: LiveScores = {}, opts: { provisional?: boolean } = {}): NextRoundProjection | null {
  const pr = prepare(s, live, opts.provisional ?? true); if (!pr) return null;
  const roundNumber = pr.cur.number + 1;
  const plan = planRound({ players: [...pr.stats.values()], courtIds: s.courts.map((c) => c.id), playType: s.playType, history: pr.history, roundNumber, seed: s.seed });
  if (!plan.games.length) return null;
  return toProjection(pr, plan, roundNumber, pr.source, pr.cur.games.every((g) => g.status === 'finished' || g.status === 'cancelled'));
}
