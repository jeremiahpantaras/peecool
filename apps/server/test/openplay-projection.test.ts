import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { projectNextRound, type OpenPlayGameDto, type OpenPlaySessionDto } from '@pickle/shared';
import { Client, cid, seedEnv, type TestEnv } from './helpers';
import { runAutoConfirm } from '../src/jobs';
import { runOpenPlayTick } from '../src/modules/openplay';

let env: TestEnv; let admin: Client; let staff: Client;
beforeAll(async () => { ({ env, admin, staff } = await seedEnv(6)); });
afterAll(async () => { await env.destroy(); });

const names = (n: number) => Array.from({ length: n }, (_, i) => ({ displayName: `P${String(i + 1).padStart(2, '0')}` }));
const cmd = (matchId: number, type: string, payload: object = {}) => staff.post(`matches/${matchId}/commands`, { commandId: cid(), expectedVersion: (env.ctx.db.prepare('SELECT version v FROM matches WHERE id = ?').get(matchId) as { v: number }).v, type, payload });
const tick = () => { runOpenPlayTick(env.ctx); runAutoConfirm(env.ctx); };
const get = async (id: number) => (await admin.get(`open-play/${id}`)).body as OpenPlaySessionDto;
const teams = (g: { teamA: { id: number }[]; teamB: { id: number }[] }) => [g.teamA.map((p) => p.id).sort(), g.teamB.map((p) => p.id).sort()].sort();

/** Staff plays one court to its target with team A scoring every rally (A serves first, so each rally is a point). */
async function playOut(g: OpenPlayGameDto) {
  expect((await cmd(g.matchId!, 'START_MATCH', { servingTeam: 'A' })).status).toBe(200);
  for (let i = 0; i < 11; i++) expect((await cmd(g.matchId!, 'RALLY_WON', { team: 'A' })).status).toBe(200);
}

describe('next-round bracket projection', () => {
  it('names the waiting players\' opponents now, and matches the round the server then publishes', async () => {
    const cr = await admin.post('open-play', { name: 'Bracket', playType: 'doubles', courtIds: [1, 2], sessionMinutes: 120, gameMinutes: 15, changeoverMinutes: 3, players: names(12) });
    expect(cr.status).toBe(201); const id = cr.body.id as number;
    expect((await admin.post(`open-play/${id}/start`)).status).toBe(200);
    let s = await get(id);
    expect(s.currentRound!.games).toHaveLength(2); expect(s.currentRound!.waiting).toHaveLength(4);

    // nothing decided yet: the four waiting players are already placed in the next round, and they have opponents
    const p0 = projectNextRound(s)!;
    expect(p0.roundNumber).toBe(2); expect(p0.final).toBe(false); expect(p0.games).toHaveLength(2);
    const waitingIds = new Set(s.currentRound!.waiting.map((p) => p.id));
    const placed = p0.games.flatMap((g) => [...g.teamA, ...g.teamB]);
    for (const id of waitingIds) { const pl = placed.find((x) => x.id === id)!; expect(pl, 'waiting players play next (fewest games first)').toBeTruthy(); expect(pl.from).toBeNull(); }
    for (const g of p0.games) { expect(g.teamA).toHaveLength(2); expect(g.teamB).toHaveLength(2); expect(g.pool, 'nobody has a result yet').toBe('even'); }

    // one court finishes; the other is mid-game with team A leading. The projection counts both, and flags the unfinished source.
    const [g1, g2] = s.currentRound!.games;
    await playOut(g1!); env.advance(16_000); tick(); // results auto-confirm after 15 s
    expect((await cmd(g2!.matchId!, 'START_MATCH', { servingTeam: 'A' })).status).toBe(200);
    for (let i = 0; i < 3; i++) expect((await cmd(g2!.matchId!, 'RALLY_WON', { team: 'A' })).status).toBe(200);
    s = await get(id);
    const mid = projectNextRound(s)!;
    expect(mid.final).toBe(false);
    // Court 1's winners (+1) and losers (-1) are known, so a game of only winners / only losers is labelled as such, anything else is mixed or even
    expect(mid.games.every((g) => ['winners', 'losers', 'even', 'mixed'].includes(g.pool))).toBe(true);
    for (const p of mid.games.flatMap((g) => [...g.teamA, ...g.teamB]).filter((x) => x.from?.gameId === g1!.id)) expect(p.net).toBe(p.from!.outcome === 'won' ? 1 : -1);
    const fromG2 = [...mid.games.flatMap((g) => [...g.teamA, ...g.teamB])].filter((p) => p.from?.gameId === g2!.id);
    expect(fromG2.every((p) => p.from!.state === 'leading')).toBe(true);
    // real results only (the TV board): the leader of an unfinished game is not counted, so those players are pending and level on record
    const real = projectNextRound(s, {}, { provisional: false })!;
    for (const p of real.games.flatMap((g) => [...g.teamA, ...g.teamB]).filter((x) => x.from?.gameId === g2!.id)) { expect(p.from!.state).toBe('pending'); expect(p.net).toBe(0); }
    for (const p of real.games.flatMap((g) => [...g.teamA, ...g.teamB]).filter((x) => x.from?.gameId === g1!.id)) expect(p.from!.state).toBe('final'); // a finished game is a real result
    // 8 finishers, 4 waiting players already placed: exactly 4 finishers play next (which 4 is the seeded random draw, so Court 2's may all sit out)
    expect(mid.games.flatMap((g) => [...g.teamA, ...g.teamB]).filter((p) => p.from).length).toBe(4);
    // live scores override the stale session data: with the lead flipped to B, Court 2's players who play next are tagged the other way round
    const flipped = projectNextRound(s, { [g2!.id]: { scoreA: 1, scoreB: 5 } })!;
    const outcomeOf = (r: typeof mid) => new Map(r.games.flatMap((g) => [...g.teamA, ...g.teamB]).filter((p) => p.from?.gameId === g2!.id).map((p) => [p.id, p.from!.outcome]));
    for (const [pid, o] of outcomeOf(flipped)) { const before = outcomeOf(mid).get(pid); if (before !== undefined) expect(o).not.toBe(before); }

    // finish the last court (A leading wins); the projection made once every result is in is exactly what the server publishes
    for (let i = 0; i < 8; i++) expect((await cmd(g2!.matchId!, 'RALLY_WON', { team: 'A' })).status).toBe(200);
    const last = projectNextRound(await get(id))!; // all results are in, round 2 is not published yet (the result confirms after 15 s)
    expect(last.roundNumber).toBe(2);
    env.advance(16_000); tick(); s = await get(id);
    expect(s.currentRound!.number).toBe(2);
    expect(last.games.map(teams)).toEqual(s.currentRound!.games.map(teams));
    expect(last.games.map((g) => g.courtName)).toEqual(s.currentRound!.games.map((g) => g.courtName));
  });
});
