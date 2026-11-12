import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OpenPlaySessionDto } from '@pickle/shared';
import { Client, seedEnv, type TestEnv } from './helpers';
import { runAutoConfirm } from '../src/jobs';
import { runOpenPlayTick } from '../src/modules/openplay';

let env: TestEnv; let admin: Client; let staff: Client;
beforeAll(async () => { ({ env, admin, staff } = await seedEnv(6)); });
afterAll(async () => { await env.destroy(); });

const names = (n: number) => Array.from({ length: n }, (_, i) => ({ displayName: `P${String(i + 1).padStart(2, '0')}` }));
const get = async (id: number): Promise<OpenPlaySessionDto> => (await admin.get(`open-play/${id}`)).body;
const tick = () => { runOpenPlayTick(env.ctx); runAutoConfirm(env.ctx); };

describe('"Begin Round N" (roundStart: manual)', () => {
  it('waits for the Admin after every result is in, then Begin draws the round (optionally starting every court)', async () => {
    const cr = await admin.post('open-play', { name: 'Manual rounds', playType: 'doubles', courtIds: [4, 5], sessionMinutes: 120, gameMinutes: 15, changeoverMinutes: 3, roundStart: 'manual', players: names(8) });
    expect(cr.status).toBe(201); expect(cr.body.roundStart).toBe('manual');
    const id = cr.body.id as number;
    expect((await admin.post(`open-play/${id}/start`)).status).toBe(200);
    let d = await get(id);
    expect(d.currentRound!.games).toHaveLength(2); expect(d.awaitingBegin).toBe(false);

    // Begin is refused while a round is being played, and only the Admin may use it
    const early = await admin.post(`open-play/${id}/begin`, {});
    expect(early.status).toBe(409); expect(early.body.error.message).toMatch(/Round 1 is still being played/);
    expect((await staff.post(`open-play/${id}/begin`, {})).status).toBe(403);

    // the Admin can start one court from the session page (once)
    const [g1, g2] = d.currentRound!.games;
    expect((await admin.post(`open-play/${id}/games/${g1!.id}/start`)).status).toBe(200);
    expect((await get(id)).currentRound!.games[0]!.status).toBe('playing');
    expect((await admin.post(`open-play/${id}/games/${g1!.id}/start`)).status).toBe(409);
    expect((await staff.post(`open-play/${id}/games/${g2!.id}/start`)).status).toBe(403);

    // every game gets a result: the round closes but round 2 is NOT drawn on its own
    for (const g of [g1!, g2!]) expect((await admin.post(`open-play/${id}/games/${g.id}/result`, { scoreA: 11, scoreB: 5 })).status).toBe(200);
    env.advance(20_000); tick(); tick();
    d = await get(id);
    expect(d.roundCount).toBe(1); expect(d.currentRound).toBeNull(); expect(d.awaitingBegin).toBe(true); expect(d.waitingForPlayers).toBe(false);
    env.advance(60_000); tick();
    expect((await get(id)).roundCount).toBe(1);                 // still waiting a minute later

    // Begin Round 2, and start every court in the same step
    const begin = await admin.post(`open-play/${id}/begin`, { startAll: true });
    expect(begin.status).toBe(200);
    d = begin.body as OpenPlaySessionDto;
    expect(d.roundCount).toBe(2); expect(d.awaitingBegin).toBe(false);
    expect(d.currentRound!.number).toBe(2);
    expect(d.currentRound!.games.every((g) => g.status === 'playing')).toBe(true);
    expect((await admin.post(`open-play/${id}/begin`, {})).status).toBe(409);   // Round 2 is now active

    // finish round 2, then switch to automatic while waiting: the next round is drawn at once
    for (const g of d.currentRound!.games) expect((await admin.post(`open-play/${id}/games/${g.id}/result`, { scoreA: 11, scoreB: 7 })).status).toBe(200);
    env.advance(20_000); tick(); tick();
    expect((await get(id)).awaitingBegin).toBe(true);
    const auto = await admin.patch(`open-play/${id}`, { roundStart: 'auto' });
    expect(auto.status).toBe(200); expect(auto.body.roundStart).toBe('auto');
    expect(auto.body.awaitingBegin).toBe(false); expect(auto.body.currentRound.number).toBe(3);
    expect((await staff.patch(`open-play/${id}`, { roundStart: 'manual' })).status).toBe(403);
    await admin.post(`open-play/${id}/end`, { force: true });
  });

  it('Begin refuses with too few players; waiting too long ends the session; the API default stays automatic', async () => {
    const auto = await admin.post('open-play', { name: 'Auto', playType: 'doubles', courtIds: [4], players: names(4) });
    expect(auto.body.roundStart).toBe('auto');                // sessions created without the option behave as they always did
    await admin.post(`open-play/${auto.body.id}/end`);
    const cr = await admin.post('open-play', { name: 'Short', playType: 'doubles', courtIds: [4], sessionMinutes: 20, gameMinutes: 15, roundStart: 'manual', players: names(4) });
    const id = cr.body.id as number;
    expect((await admin.post(`open-play/${id}/start`)).status).toBe(200);
    let d = await get(id);
    expect((await admin.post(`open-play/${id}/games/${d.currentRound!.games[0]!.id}/result`, { scoreA: 11, scoreB: 2 })).status).toBe(200);
    env.advance(16_000); tick(); tick();
    d = await get(id);
    expect(d.awaitingBegin).toBe(true);                        // 20-minute session, 16 s in: another 15-minute game still fits
    // one player leaves: a doubles game needs four, so Begin explains why it cannot
    const pid = d.players[0]!.id;
    expect((await admin.patch(`open-play/${id}/players/${pid}`, { status: 'left' })).status).toBe(200);
    const few = await admin.post(`open-play/${id}/begin`, {});
    expect(few.status).toBe(422); expect(few.body.error.message).toMatch(/Not enough active players/);
    // nobody presses Begin: once a full game no longer fits, the session finishes on its own
    expect((await admin.patch(`open-play/${id}/players/${pid}`, { status: 'active' })).status).toBe(200);
    env.advance(6 * 60_000); tick();
    d = await get(id);
    expect(d.status).toBe('finished');
    expect((await admin.post(`open-play/${id}/begin`, {})).status).toBe(409);
  });
});
