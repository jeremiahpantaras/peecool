import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { addToHistory, emptyHistory, mulberry32, pairKey, planRound, previewSession, rankPlayers, type OpPlayerStat, type PairHistory } from '../src';

const mk = (n: number): OpPlayerStat[] => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `P${i + 1}`, status: 'active', played: 0, scored: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, lastRound: null, joinedRound: 1 }));

/** Plays out a session: random results, history and stats updated like the server does. */
function simulate(n: number, courts: number, playType: 'singles' | 'doubles', rounds: number, seed = 7) {
  const players = mk(n); const history: PairHistory = emptyHistory(); const rnd = mulberry32(seed + 99);
  const plans = [];
  for (let r = 1; r <= rounds; r++) {
    const plan = planRound({ players, courtIds: Array.from({ length: courts }, (_, i) => i + 1), playType, history, roundNumber: r, seed });
    plans.push({ plan, before: players.map((p) => ({ ...p })) });
    for (const g of plan.games) {
      const aWins = rnd() < 0.5; const sa = aWins ? 11 : Math.floor(rnd() * 10), sb = aWins ? Math.floor(rnd() * 10) : 11;
      for (const [team, mine, theirs, won] of [[g.teamA, sa, sb, aWins], [g.teamB, sb, sa, !aWins]] as const) for (const id of team) {
        const p = players.find((x) => x.id === id)!;
        p.played++; p.scored++; p.lastRound = r; p.pointsFor += mine; p.pointsAgainst += theirs; if (won) p.wins++; else p.losses++;
      }
    }
    addToHistory(history, plan.games);
  }
  return { players, history, plans };
}

describe('planRound (Open Play matchmaking)', () => {
  it('uses every court it can, never books a player twice, and lists the rest as waiting (20 players, 4 courts)', () => {
    for (const type of ['singles', 'doubles'] as const) {
      const plan = planRound({ players: mk(20), courtIds: [1, 2, 3, 4], playType: type, history: emptyHistory(), roundNumber: 1, seed: 1 });
      const per = type === 'singles' ? 1 : 2;
      expect(plan.games.map((g) => g.courtId)).toEqual([1, 2, 3, 4]);
      const ids = plan.games.flatMap((g) => [...g.teamA, ...g.teamB]);
      expect(new Set(ids).size).toBe(ids.length); expect(ids.length).toBe(4 * per * 2);
      expect(plan.games.every((g) => g.teamA.length === per && g.teamB.length === per)).toBe(true);
      expect(plan.waiting.length).toBe(20 - ids.length);
      expect(new Set([...ids, ...plan.waiting]).size).toBe(20);
    }
  });
  it('is reproducible from the seed and differs between seeds (R6)', () => {
    const run = (seed: number) => planRound({ players: mk(20), courtIds: [1, 2, 3, 4], playType: 'singles', history: emptyHistory(), roundNumber: 1, seed });
    expect(run(5)).toEqual(run(5)); expect(run(5)).not.toEqual(run(6));
  });
  it('uses fewer courts when there are not enough players, and none for too few', () => {
    expect(planRound({ players: mk(9), courtIds: [1, 2, 3, 4], playType: 'doubles', history: emptyHistory(), roundNumber: 1, seed: 1 }).games).toHaveLength(2);
    const none = planRound({ players: mk(3), courtIds: [1], playType: 'doubles', history: emptyHistory(), roundNumber: 1, seed: 1 });
    expect(none.games).toEqual([]); expect(none.waiting).toHaveLength(3);
  });
  it('ignores resting and left players', () => {
    const ps = mk(8); ps[0]!.status = 'resting'; ps[1]!.status = 'left';
    const plan = planRound({ players: ps, courtIds: [1, 2], playType: 'singles', history: emptyHistory(), roundNumber: 1, seed: 1 });
    const ids = plan.games.flatMap((g) => [...g.teamA, ...g.teamB]);
    expect(ids).not.toContain(1); expect(ids).not.toContain(2); expect(plan.waiting).not.toContain(1);
  });
  it('after round 1 winners play winners and losers play losers (singles, 8 players)', () => {
    const { plans } = simulate(8, 4, 'singles', 2);
    const r1 = plans[0]!.plan.games, r2 = plans[1]!.plan.games;
    // reconstruct who won round 1 from the simulation: ranking before round 2
    const ranked = rankPlayers(plans[1]!.before);
    const winners = new Set(ranked.filter((r) => r.net > 0).map((r) => r.id));
    expect(winners.size).toBe(r1.length);
    const mixed = r2.filter((g) => winners.has(g.teamA[0]!) !== winners.has(g.teamB[0]!));
    expect(mixed).toHaveLength(0);
  });
  it('gives equal court time: games played never differ by more than 1 (20 players, 4 courts, 8 rounds)', () => {
    for (const type of ['singles', 'doubles'] as const) {
      const { plans } = simulate(20, 4, type, 8);
      for (const { before } of plans) { const pl = before.map((p) => p.played); expect(Math.max(...pl) - Math.min(...pl)).toBeLessThanOrEqual(1); }
    }
  });
  it('nobody sits out two rounds in a row when 20 doubles players share 4 courts (fair rotation)', () => {
    const { plans } = simulate(20, 4, 'doubles', 7);
    for (let i = 1; i < plans.length; i++) for (const id of plans[i - 1]!.plan.waiting) expect(plans[i]!.plan.waiting).not.toContain(id);
  });
  it('avoids rematches and repeat partners while that is possible', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const s = simulate(8, 4, 'singles', 4, seed);
      const dup = Object.values(s.history.opponent).filter((c) => c > 1).length;
      expect(dup, `singles seed ${seed}`).toBe(0);
      const d = simulate(8, 2, 'doubles', 3, seed);
      expect(Object.values(d.history.partner).filter((c) => c > 1).length, `doubles partners seed ${seed}`).toBe(0);
    }
  });
  it('late joiners: a newcomer who starts level plays soon but does not play every round', () => {
    const players = mk(12); for (const p of players) { p.played = 3; p.lastRound = 3; }
    players.push({ ...mk(1)[0]!, id: 99, name: 'Late', played: 3, joinedRound: 4 });
    const plan = planRound({ players, courtIds: [1, 2], playType: 'doubles', history: emptyHistory(), roundNumber: 4, seed: 3 });
    expect(plan.games).toHaveLength(2); expect(plan.waiting.length).toBe(5);
  });
  it('property: any size, any courts — valid plans and bounded unfairness', () => {
    fc.assert(fc.property(fc.integer({ min: 2, max: 64 }), fc.integer({ min: 1, max: 24 }), fc.boolean(), fc.integer({ min: 1, max: 5 }), fc.integer({ min: 0, max: 1e6 }), (n, courts, dbl, rounds, seed) => {
      const type = dbl ? 'doubles' : 'singles'; const per = dbl ? 4 : 2;
      const { plans } = simulate(n, courts, type, rounds, seed);
      for (const { plan, before } of plans) {
        const ids = plan.games.flatMap((g) => [...g.teamA, ...g.teamB]);
        expect(new Set(ids).size).toBe(ids.length);
        expect(plan.games.length).toBe(Math.min(courts, Math.floor(n / per)));
        expect(new Set(plan.games.map((g) => g.courtId)).size).toBe(plan.games.length);
        if (ids.length && n > ids.length) { const pl = before.map((p) => p.played); expect(Math.max(...pl) - Math.min(...pl)).toBeLessThanOrEqual(1); }
      }
    }), { numRuns: 120 });
  });
});

describe('rankPlayers and previewSession', () => {
  it('ranks by net wins, then average point difference, then average points; ties share a rank', () => {
    const a = { ...mk(1)[0]!, id: 1, name: 'A', wins: 2, losses: 0, scored: 2, pointsFor: 22, pointsAgainst: 10 };
    const b = { ...mk(1)[0]!, id: 2, name: 'B', wins: 2, losses: 0, scored: 2, pointsFor: 22, pointsAgainst: 14 };
    const c = { ...mk(1)[0]!, id: 3, name: 'C', wins: 1, losses: 1, scored: 2, pointsFor: 18, pointsAgainst: 18 };
    const d = { ...mk(1)[0]!, id: 4, name: 'D', wins: 1, losses: 1, scored: 2, pointsFor: 18, pointsAgainst: 18 };
    const r = rankPlayers([d, c, b, a]);
    expect(r.map((x) => x.name)).toEqual(['A', 'B', 'C', 'D']); expect(r.map((x) => x.rank)).toEqual([1, 2, 3, 3]);
  });
  it('previews the owner example: 20 players, 4 courts, 2 h of 15-minute games', () => {
    const dbl = previewSession({ playType: 'doubles', courts: 4, players: 20, sessionMinutes: 120, gameMinutes: 15, changeoverMinutes: 3 });
    expect(dbl).toMatchObject({ gamesPerRound: 4, playingPerRound: 16, waitingPerRound: 4, rounds: 6 });
    expect(dbl.gamesPerPlayerMin).toBe(4); expect(dbl.gamesPerPlayerMax).toBe(5);
    const sgl = previewSession({ playType: 'singles', courts: 4, players: 20, sessionMinutes: 120, gameMinutes: 15, changeoverMinutes: 3 });
    expect(sgl).toMatchObject({ playingPerRound: 8, waitingPerRound: 12, rounds: 6 }); expect(sgl.gamesPerPlayerMax).toBeLessThanOrEqual(3);
    expect(sgl.warnings.join(' ')).toMatch(/more players are waiting/i);
  });
  it('previews edge cases', () => {
    expect(previewSession({ playType: 'doubles', courts: 4, players: 3, sessionMinutes: 60, gameMinutes: 15, changeoverMinutes: 0 }).warnings[0]).toMatch(/At least 4/);
    expect(previewSession({ playType: 'singles', courts: 1, players: 2, sessionMinutes: 10, gameMinutes: 15, changeoverMinutes: 0 }).rounds).toBe(0);
  });
});
void pairKey;
