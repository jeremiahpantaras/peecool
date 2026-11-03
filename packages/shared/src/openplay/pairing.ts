import type { PlayType } from '../types';
import { hashSeed, mulberry32, shuffle } from './random';
import { rankPlayers, type OpPlayerStat } from './standings';

/** Count of times two players have partnered / opposed each other. Keyed by `pairKey`. */
export interface PairHistory { partner: Record<string, number>; opponent: Record<string, number> }
export const emptyHistory = (): PairHistory => ({ partner: {}, opponent: {} });
export const pairKey = (a: number, b: number): string => (a < b ? `${a}-${b}` : `${b}-${a}`);

export interface PlannedGame { courtId: number; teamA: number[]; teamB: number[] }
export interface RoundPlan { games: PlannedGame[]; waiting: number[] }

export interface PlanInput {
  players: OpPlayerStat[];
  courtIds: number[];
  playType: PlayType;
  history: PairHistory;
  roundNumber: number;
  seed: number;
}

const REMATCH = 1000, PARTNER_REPEAT = 1000, OPPONENT_REPEAT = 300, BALANCE = 10;

/** The three ways to split four ranked players into two teams, as [teamA, teamB] index pairs. */
const SPLITS: [[number, number], [number, number]][] = [[[0, 3], [1, 2]], [[0, 2], [1, 3]], [[0, 1], [2, 3]]];

interface GroupEval { cost: number; teamA: number[]; teamB: number[] }

/**
 * Open Play matchmaking (plan §3, R6–R11).
 * 1. Who plays: fewest games played → longest wait → random (so court time stays even).
 * 2. Round 1 (no results yet) is a random draw; later rounds sort those playing by record and group neighbours,
 *    i.e. winners meet winners and losers meet losers (Swiss-style).
 * 3. A seeded local search swaps players between games to remove repeat opponents/partners at minimal cost to that grouping.
 * 4. Best-ranked game gets the first court.
 */
export function planRound(input: PlanInput): RoundPlan {
  const { players, courtIds, playType, history, roundNumber } = input;
  const rnd = mulberry32(hashSeed(input.seed, roundNumber));
  const perMatch = playType === 'singles' ? 2 : 4;
  const active = players.filter((p) => p.status === 'active');
  const gameCount = Math.min(courtIds.length, Math.floor(active.length / perMatch));
  if (gameCount === 0) return { games: [], waiting: active.map((p) => p.id) };

  // 1. selection
  const jitter = new Map(active.map((p) => [p.id, rnd()]));
  const waited = (p: OpPlayerStat) => roundNumber - (p.lastRound ?? p.joinedRound - 1);
  const byFairness = [...active].sort((a, b) => a.played - b.played || waited(b) - waited(a) || jitter.get(a.id)! - jitter.get(b.id)!);
  const selected = byFairness.slice(0, gameCount * perMatch);
  const selectedIds = new Set(selected.map((p) => p.id));
  const waiting = byFairness.filter((p) => !selectedIds.has(p.id)).map((p) => p.id);

  // 2. order by record (or randomly before any result exists)
  const hasResults = selected.some((p) => p.scored > 0);
  const order: number[] = hasResults
    ? rankPlayers(selected).map((r) => r.id)
    : shuffle(selected.map((p) => p.id), rnd);
  const pos = new Map(order.map((id, i) => [id, i]));

  const evalGroup = (ids: number[]): GroupEval => {
    if (playType === 'singles') {
      const [a, b] = ids as [number, number];
      const cost = (history.opponent[pairKey(a, b)] ?? 0) * REMATCH + Math.abs(pos.get(a)! - pos.get(b)!);
      return { cost, teamA: [a], teamB: [b] };
    }
    const sorted = [...ids].sort((x, y) => pos.get(x)! - pos.get(y)!);
    const spread = pos.get(sorted[3]!)! - pos.get(sorted[0]!)!;
    let best: GroupEval | null = null;
    for (const [sa, sb] of SPLITS) {
      const A = sa.map((i) => sorted[i]!), B = sb.map((i) => sorted[i]!);
      let cost = ((history.partner[pairKey(A[0]!, A[1]!)] ?? 0) + (history.partner[pairKey(B[0]!, B[1]!)] ?? 0)) * PARTNER_REPEAT;
      for (const x of A) for (const y of B) cost += (history.opponent[pairKey(x, y)] ?? 0) * OPPONENT_REPEAT;
      const sumA = A.reduce((s, id) => s + pos.get(id)!, 0), sumB = B.reduce((s, id) => s + pos.get(id)!, 0);
      cost += Math.abs(sumA - sumB) * BALANCE + spread;
      if (!best || cost < best.cost) best = { cost, teamA: A, teamB: B };
    }
    return best!;
  };

  let groups: number[][] = Array.from({ length: gameCount }, (_, g) => order.slice(g * perMatch, (g + 1) * perMatch));
  let evals = groups.map(evalGroup);

  // 3. seeded local search: swap two players between two games when it lowers the cost
  const rounds = Math.min(4000, 150 * gameCount * perMatch);
  for (let it = 0; it < rounds && gameCount > 1; it++) {
    const gi = Math.floor(rnd() * gameCount);
    let gj = Math.floor(rnd() * (gameCount - 1)); if (gj >= gi) gj++;
    const pi = Math.floor(rnd() * perMatch), pj = Math.floor(rnd() * perMatch);
    const a = groups[gi]!.slice(), b = groups[gj]!.slice();
    [a[pi], b[pj]] = [b[pj]!, a[pi]!];
    const ea = evalGroup(a), eb = evalGroup(b);
    if (ea.cost + eb.cost < evals[gi]!.cost + evals[gj]!.cost - 1e-9) { groups[gi] = a; groups[gj] = b; evals[gi] = ea; evals[gj] = eb; }
  }

  // 4. best-ranked game first, onto the first court
  const idx = groups.map((g, i) => ({ i, mean: g.reduce((s, id) => s + pos.get(id)!, 0) / g.length }));
  idx.sort((x, y) => x.mean - y.mean);
  const games: PlannedGame[] = idx.map(({ i }, k) => ({ courtId: courtIds[k]!, teamA: evals[i]!.teamA, teamB: evals[i]!.teamB }));
  void groups;
  return { games, waiting };
}

/** Folds the teams of a played round into the partner/opponent counters. */
export function addToHistory(h: PairHistory, games: { teamA: number[]; teamB: number[] }[]): void {
  for (const g of games) {
    for (const team of [g.teamA, g.teamB]) if (team.length === 2) { const k = pairKey(team[0]!, team[1]!); h.partner[k] = (h.partner[k] ?? 0) + 1; }
    for (const a of g.teamA) for (const b of g.teamB) { const k = pairKey(a, b); h.opponent[k] = (h.opponent[k] ?? 0) + 1; }
  }
}
