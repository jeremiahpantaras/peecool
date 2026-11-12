import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OpenPlayGameDto, OpenPlaySessionDto } from '@pickle/shared';
import { Client, cid, seedEnv, type TestEnv } from './helpers';
import { runAutoConfirm } from '../src/jobs';
import { runOpenPlayTick } from '../src/modules/openplay';

let env: TestEnv; let admin: Client; let staff: Client;
beforeAll(async () => { ({ env, admin, staff } = await seedEnv(6)); });
afterAll(async () => { await env.destroy(); });

const names = (n: number) => Array.from({ length: n }, (_, i) => ({ displayName: `P${String(i + 1).padStart(2, '0')}` }));
const get = async (id: number): Promise<OpenPlaySessionDto> => (await admin.get(`open-play/${id}`)).body;
const version = (matchId: number): number => (env.ctx.db.prepare('SELECT version v FROM matches WHERE id = ?').get(matchId) as { v: number }).v;
const cmd = (matchId: number, type: string, payload: object = {}) => staff.post(`matches/${matchId}/commands`, { commandId: cid(), expectedVersion: version(matchId), type, payload });
const tick = () => { runOpenPlayTick(env.ctx); runAutoConfirm(env.ctx); };
const game = (d: OpenPlaySessionDto, id: number, round = d.currentRound!.number): OpenPlayGameDto => d.rounds.find((r) => r.number === round)!.games.find((g) => g.id === id)!;

describe('results are read from the score; a tie is decided by a person; Admin can edit a result', () => {
  let id: number; let g1: OpenPlayGameDto; let g2: OpenPlayGameDto;

  it('at time-up the side ahead wins automatically; a level game waits for a decision', async () => {
    const cr = await admin.post('open-play', { name: 'Results', playType: 'doubles', courtIds: [1, 2], sessionMinutes: 120, gameMinutes: 15, roundStart: 'manual', players: names(8) });
    id = cr.body.id; expect((await admin.post(`open-play/${id}/start`)).status).toBe(200);
    [g1, g2] = (await get(id)).currentRound!.games as [OpenPlayGameDto, OpenPlayGameDto];
    for (const g of [g1, g2]) expect((await cmd(g.matchId!, 'START_MATCH', { servingTeam: 'A' })).status).toBe(200);
    for (let i = 0; i < 3; i++) expect((await cmd(g1.matchId!, 'RALLY_WON', { team: 'A' })).status).toBe(200);   // Court 1: A 3–0, Court 2 stays 0–0
    env.advance(16 * 60_000); tick();                                                                            // both courts' 15 minutes are up
    const d = await get(id);
    expect(game(d, g1.id)).toMatchObject({ status: 'finished', winner: 'A', decidedBy: 'time', scoreA: 3, scoreB: 0, timeUp: true });
    // Court 2 is level: still open, nothing decided for them, and the next rally would decide it
    expect(game(d, g2.id)).toMatchObject({ status: 'playing', winner: null, scoreA: 0, scoreB: 0, timeUp: true, suddenDeath: true });
    expect(d.currentRound!.status).toBe('active');                                                               // the round waits for the tie
  });

  it('court staff pick the winner of the level game (or the Admin does); the round then closes', async () => {
    const pick = await cmd(g2.matchId!, 'RECORD_RESULT', { winner: 'B' });
    expect(pick.status).toBe(200);
    env.advance(16_000); tick(); tick();
    const d = await get(id);
    expect(d.awaitingBegin).toBe(true);
    expect(game(d, g2.id, 1)).toMatchObject({ status: 'finished', winner: 'B', decidedBy: 'result', scoreA: 0, scoreB: 0 });
    const wins = (ids: number[]) => ids.map((pid) => d.players.find((p) => p.id === pid)!.wins);
    expect(wins(game(d, g1.id, 1).teamA.map((p) => p.id))).toEqual([1, 1]);
    expect(wins(game(d, g2.id, 1).teamB.map((p) => p.id))).toEqual([1, 1]);
  });

  it('Edit result: only the Admin, a reason is needed, the winner must follow the score, and the standings follow', async () => {
    const url = `open-play/${id}/games/${g1.id}/correct`;
    expect((await staff.post(url, { scoreA: 5, scoreB: 7, reason: 'Wrong score' })).status).toBe(403);
    expect((await admin.post(url, { scoreA: 5, scoreB: 7, reason: 'x' })).status).toBe(422);                       // a reason is required
    expect((await admin.post(url, { scoreA: 4, scoreB: 4, reason: 'Wrong score' })).status).toBe(422);              // level: choose the winner
    expect((await admin.post(url, { scoreA: 5, scoreB: 7, winner: 'A', reason: 'Wrong score' })).status).toBe(422); // the winner must have the higher score
    const ok = await admin.post(url, { scoreA: 5, scoreB: 7, reason: 'Staff mis-recorded the score' });
    expect(ok.status).toBe(200);
    const d = ok.body as OpenPlaySessionDto;
    expect(game(d, g1.id, 1)).toMatchObject({ scoreA: 5, scoreB: 7, winner: 'B', corrected: true });
    const a = game(d, g1.id, 1).teamA.map((p) => d.players.find((x) => x.id === p.id)!);
    const b = game(d, g1.id, 1).teamB.map((p) => d.players.find((x) => x.id === p.id)!);
    expect(a.map((p) => [p.wins, p.losses])).toEqual([[0, 1], [0, 1]]);                                              // the former winners now lost
    expect(b.map((p) => [p.wins, p.losses])).toEqual([[1, 0], [1, 0]]);
    expect(a.map((p) => p.pointsFor)).toEqual([5, 5]);
    expect(d.awaitingBegin).toBe(true);                                                                              // correcting an old round does not draw anything
    // a level game's winner can be flipped too, and a level correction with a chosen winner is accepted
    const lvl = await admin.post(`open-play/${id}/games/${g2.id}/correct`, { scoreA: 6, scoreB: 6, winner: 'A', reason: 'They played to 6-6, A won the replay' });
    expect(lvl.status).toBe(200); expect(game(lvl.body, g2.id, 1)).toMatchObject({ winner: 'A', scoreA: 6, scoreB: 6 });
  });

  it('a game that has no result yet cannot be edited', async () => {
    const begin = await admin.post(`open-play/${id}/begin`, {});
    expect(begin.status).toBe(200);
    const g = (begin.body as OpenPlaySessionDto).currentRound!.games[0]!;
    const r = await admin.post(`open-play/${id}/games/${g.id}/correct`, { scoreA: 11, scoreB: 3, reason: 'Entered by mistake' });
    expect(r.status).toBe(409);
    await admin.post(`open-play/${id}/end`, { force: true });
  });
});
