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
const cmd = (c: Client, matchId: number, version: number, type: string, payload: object = {}) => c.post(`matches/${matchId}/commands`, { commandId: cid(), expectedVersion: version, type, payload });
const matchVersion = (matchId: number): number => (env.ctx.db.prepare('SELECT version v FROM matches WHERE id = ?').get(matchId) as { v: number }).v;
const tick = () => { runOpenPlayTick(env.ctx); runAutoConfirm(env.ctx); };

/** Staff starts a court (serving team A) and plays `a`–`b` rallies, A scoring first (A serves, so every A rally is a point). */
async function startAndScore(g: OpenPlayGameDto, aPoints: number) {
  const s = await cmd(staff, g.matchId!, matchVersion(g.matchId!), 'START_MATCH', { servingTeam: 'A' });
  expect(s.status).toBe(200);
  for (let i = 0; i < aPoints; i++) expect((await cmd(staff, g.matchId!, matchVersion(g.matchId!), 'RALLY_WON', { team: 'A' })).status).toBe(200);
}

describe('permissions and court holding', () => {
  it('Staff can see Open Play but only the Admin can create or run it; setup validates players', async () => {
    expect((await staff.get('open-play')).status).toBe(200);
    expect((await staff.post('open-play', { name: 'x', playType: 'doubles', courtIds: [1] })).status).toBe(403);
    const cr = await admin.post('open-play', { name: 'Tiny', playType: 'doubles', courtIds: [1], players: names(3) });
    expect(cr.status).toBe(201);
    const start = await admin.post(`open-play/${cr.body.id}/start`);
    expect(start.status).toBe(422); expect(start.body.error.message).toMatch(/At least 4 players/);
    expect((await admin.post('open-play', { name: 'Bad', playType: 'doubles', courtIds: [1], players: [{ displayName: '  ' }] })).status).toBe(422);
    expect((await admin.post(`open-play/${cr.body.id}/end`)).status).toBe(200); // cancel a session that never started
    expect((await get(cr.body.id)).status).toBe('cancelled');
  });
});

describe('player first name, last name and optional team', () => {
  it('stores them separately, builds the display name, and requires both names', async () => {
    const cr = await admin.post('open-play', { name: 'Named', playType: 'doubles', courtIds: [1], players: [
      { firstName: ' Alex ', lastName: 'Rivera', team: 'Red' }, { firstName: 'Sam', lastName: 'Lee' }] });
    expect(cr.status).toBe(201);
    const [a, b] = cr.body.players;
    expect(a).toMatchObject({ name: 'Alex Rivera', firstName: 'Alex', lastName: 'Rivera', team: 'Red' });
    expect(b).toMatchObject({ name: 'Sam Lee', team: null });
    expect((await admin.post('open-play', { name: 'Bad', playType: 'doubles', courtIds: [1], players: [{ firstName: 'Solo' }] })).status).toBe(422);
    const add = await admin.post(`open-play/${cr.body.id}/players`, { players: [{ firstName: 'Kim', lastName: 'Ng', team: 'Blue' }] });
    expect(add.status).toBe(200); expect(add.body.players.map((p: { name: string }) => p.name)).toContain('Kim Ng');
    await admin.post(`open-play/${cr.body.id}/end`);
  });
});

describe('the owner scenario: 20 players, 4 courts, doubles, courts starting at different times', () => {
  let id: number; let t0: number; let r1: OpenPlayGameDto[];

  it('creates the session, then Start draws round 1 across the 4 courts and holds them', async () => {
    const cr = await admin.post('open-play', { name: 'Friday open play', playType: 'doubles', courtIds: [1, 2, 3, 4], sessionMinutes: 120, gameMinutes: 15, changeoverMinutes: 3, players: names(20) });
    expect(cr.status).toBe(201); id = cr.body.id;
    expect(cr.body.players).toHaveLength(20);
    t0 = env.now;
    const s = await admin.post(`open-play/${id}/start`);
    expect(s.status).toBe(200);
    const d = s.body as OpenPlaySessionDto;
    expect(d.status).toBe('running'); expect(d.roundCount).toBe(1);
    r1 = d.currentRound!.games;
    expect(r1.map((g) => g.courtName)).toEqual(['Court 1', 'Court 2', 'Court 3', 'Court 4']);
    expect(r1.every((g) => g.status === 'scheduled' && g.teamA.length === 2 && g.teamB.length === 2)).toBe(true);
    const ids = r1.flatMap((g) => [...g.teamA, ...g.teamB].map((p) => p.id));
    expect(new Set(ids).size).toBe(16); expect(d.currentRound!.waiting).toHaveLength(4);
    // each court has an ordinary match, 15-minute limit, one game, ready to start
    const m = (await staff.get(`matches/${r1[0]!.matchId}`)).body.snapshot;
    expect(m).toMatchObject({ status: 'setup', playType: 'doubles', rules: { gamesToWin: 1, timeLimitMinutes: 15 }, openPlay: { sessionId: id, roundNumber: 1 } });
    expect((await staff.get('courts/1')).body.court.status).toBe('occupied');
  });

  it('courts 1–4 are held: ordinary matches there are refused, courts 5–6 are still free', async () => {
    const r = await staff.post('matches', { courtId: 1, playType: 'singles' });
    expect(r.status).toBe(409); expect(r.body.error.code).toBe('COURT_IN_OPEN_PLAY');
    expect((await staff.post('matches', { courtId: 5, playType: 'singles' })).status).toBe(201);
  });

  it('each court runs on its own clock: Court 1 starts now, Court 2 two minutes later', async () => {
    await startAndScore(r1[0]!, 3);            // Court 1: A leads 3–0
    env.advance(2 * 60_000);
    await startAndScore(r1[1]!, 2);            // Court 2: A leads 2–0, started 2 minutes after Court 1
    env.advance(13 * 60_000);                  // = Court 1's 15:00
    tick();
    let d = await get(id); const g = d.currentRound!.games;
    expect(g[0]!.timeUp).toBe(true); expect(g[1]!.timeUp).toBe(false); // Court 2 still has 2 minutes
    expect((await staff.get('courts/1')).body.match.current.timeUp).toBe(true);
    env.advance(2 * 60_000); tick();
    d = await get(id);
    expect(d.currentRound!.games[1]!.timeUp).toBe(true);
    expect(d.currentRound!.games[2]!.timeUp).toBe(false); // Court 3 was never started
  });

  it('after time-up the final rally decides for the leader; the round waits for the other courts', async () => {
    const g1 = r1[0]!;
    const fin = await cmd(staff, g1.matchId!, matchVersion(g1.matchId!), 'RALLY_WON', { team: 'A' });
    expect(fin.body.snapshot.match).toMatchObject({ status: 'in_progress', phase: 'match_over', winner: 'A' });
    env.advance(16_000); tick();
    const m = (await staff.get(`matches/${g1.matchId}`)).body.snapshot;
    expect(m).toMatchObject({ status: 'completed', winner: 'A', openPlay: { decidedBy: 'time' } });
    expect(m.openPlay.waitingOn.map((w: { courtName: string }) => w.courtName)).toEqual(['Court 2', 'Court 3', 'Court 4']);
    expect(m.openPlay.waitingOn[0]).toMatchObject({ status: 'playing' }); expect(m.openPlay.waitingOn[1]).toMatchObject({ status: 'scheduled' });
    expect((await get(id)).roundCount).toBe(1); // nothing new until everyone has finished
  });

  it('a court that never started is resolved by the Admin; Staff are refused; a late-start alert appears', async () => {
    expect((await staff.get('dashboard')).body.alerts.some((a: { id: string }) => a.id.startsWith('op-late-'))).toBe(true);
    const g3 = r1[2]!;
    expect((await staff.post(`open-play/${id}/games/${g3.id}/result`, { scoreA: 11, scoreB: 4 })).status).toBe(403);
    expect((await admin.post(`open-play/${id}/games/${g3.id}/result`, { scoreA: 4, scoreB: 4 })).status).toBe(422); // level, no winner
    const r = await admin.post(`open-play/${id}/games/${g3.id}/result`, { scoreA: 11, scoreB: 4 });
    expect(r.status).toBe(200);
    expect((await staff.get(`matches/${g3.matchId}`)).body.snapshot).toMatchObject({ status: 'in_progress', phase: 'match_over', winner: 'A', openPlay: { decidedBy: 'result' } });
  });

  it('the Admin can extend a running court, swap players before a game starts, and cancel an unstarted game', async () => {
    const g2 = (await get(id)).currentRound!.games[1]!;
    expect((await admin.post(`open-play/${id}/games/${g2.id}/extend`, { minutes: 5 })).status).toBe(409); // already past time-up
    const g4 = r1[3]!;
    const before = (await get(id)).currentRound!;
    const waiting = before.waiting[0]!, out = g4.teamA[0]!;
    const sw = await admin.post(`open-play/${id}/swap`, { playerA: out.id, playerB: waiting.id });
    expect(sw.status).toBe(200);
    const after = (sw.body as OpenPlaySessionDto).currentRound!;
    expect(after.games[3]!.teamA.map((p) => p.id)).toContain(waiting.id);
    expect(after.waiting.map((p) => p.id)).toContain(out.id);
    const m = (await staff.get(`matches/${g4.matchId}`)).body.snapshot;
    expect(m.teams.A.players.map((p: { displayName: string }) => p.displayName)).toContain(waiting.name); // the court shows the new player
    expect((await admin.post(`open-play/${id}/swap`, { playerA: r1[0]!.teamA[0]!.id, playerB: waiting.id })).status).toBe(409); // that game already started
    expect((await admin.post(`open-play/${id}/games/${r1[0]!.id}/cancel`)).status).toBe(409);
  });

  it('when the last court finishes, round 2 is drawn: the 4 who waited play, partners rotate, winners meet winners', async () => {
    const waited = (await get(id)).currentRound!.waiting.map((p) => p.id);
    await admin.post(`open-play/${id}/games/${r1[3]!.id}/result`, { scoreA: 11, scoreB: 9 });
    const g2 = r1[1]!;
    await cmd(staff, g2.matchId!, matchVersion(g2.matchId!), 'RALLY_WON', { team: 'A' });   // Court 2: final rally after time-up
    env.advance(20_000); tick();
    const d = await get(id);
    expect(d.roundCount).toBe(2);
    const round2 = d.currentRound!; expect(round2.number).toBe(2);
    const playing2 = new Set(round2.games.flatMap((g) => [...g.teamA, ...g.teamB].map((p) => p.id)));
    for (const id_ of waited) expect(playing2.has(id_), `waiting player ${id_} should play round 2`).toBe(true); // fair rotation
    // nobody partners the same person twice
    const pairs = (games: OpenPlayGameDto[]) => games.flatMap((g) => [g.teamA, g.teamB].map((t) => t.map((p) => p.id).sort().join('-')));
    const r1pairs = new Set(pairs(d.rounds[0]!.games)); for (const p of pairs(round2.games)) expect(r1pairs.has(p)).toBe(false);
    // court 1 hosts the strongest game: all four have a win
    const wins = new Map(d.players.map((p) => [p.id, p.wins]));
    const top = round2.games[0]!;
    expect([...top.teamA, ...top.teamB].every((p) => (wins.get(p.id) ?? 0) === 1)).toBe(true);
    expect((await staff.get('courts/1')).body.court.status).toBe('occupied'); // new ready-to-start match on the same court
    // R1 results are all in the standings
    expect(d.standings.filter((p) => p.wins === 1)).toHaveLength(8); expect(d.standings.filter((p) => p.losses === 1)).toHaveLength(8);
  });

  it('a late player starts level with the least-played, and resting players are skipped', async () => {
    const add = await admin.post(`open-play/${id}/players`, { players: [{ displayName: 'Latecomer' }] });
    expect(add.status).toBe(200);
    const d = add.body as OpenPlaySessionDto; const late = d.players.find((p) => p.name === 'Latecomer')!;
    expect(late.played).toBe(Math.min(...d.players.filter((p) => p.id !== late.id && p.status === 'active').map((p) => p.played)));
    const target = d.currentRound!.waiting[0]!;
    const rest = await admin.patch(`open-play/${id}/players/${target.id}`, { status: 'resting' });
    expect((rest.body as OpenPlaySessionDto).players.find((p) => p.id === target.id)!.now).toBe('resting');
    const inGame = d.currentRound!.games[0]!.teamA[0]!;
    expect((await admin.patch(`open-play/${id}/players/${inGame.id}`, { status: 'left' })).status).toBe(409); // game not started yet: swap first
  });

  it('ending the session cancels unstarted games and finishes once the running ones are done', async () => {
    const d0 = await get(id);
    const games = d0.currentRound!.games;
    await startAndScore(games[0]!, 5);
    const end = await admin.post(`open-play/${id}/end`, {});
    expect(end.status).toBe(200);
    let d = end.body as OpenPlaySessionDto;
    expect(d.status).toBe('ending');
    expect(d.currentRound!.games.filter((g) => g.status === 'cancelled')).toHaveLength(games.length - 1);
    const forced = await admin.post(`open-play/${id}/end`, { force: true });
    d = forced.body as OpenPlaySessionDto;
    expect(d.status).toBe('finished'); expect(d.champions.length).toBeGreaterThan(0);
    expect((await staff.get('courts/1')).body.court.status).not.toBe('occupied');
    expect((await staff.post('matches', { courtId: 1, playType: 'singles' })).status).not.toBe(409); // the court is free again
    // cancelled and ended-early games never count as results
    const ended = (await get(id)).rounds.at(-1)!.games.find((g) => g.endedEarly);
    expect(ended).toBeTruthy(); expect(ended!.winner).toBeNull();
  });
});

describe('small session: winners play winners, final standings, running out of time', () => {
  it('4 singles players on 2 courts: round 2 is winners v winners and losers v losers; time up finishes the session', async () => {
    env.advance(3 * 3600_000); await admin.login('owner', 'owner-pass-1'); await staff.login('maria', 'maria-pass-1');
    for (const c of [1, 2]) { const m = env.ctx.db.prepare("SELECT id FROM matches WHERE court_id = ? AND status IN ('setup','in_progress','paused')").get(c) as { id: number } | undefined; if (m) await cmd(admin, m.id, matchVersion(m.id), 'CANCEL'); }
    const cr = await admin.post('open-play', { name: 'Mini', playType: 'singles', courtIds: [1, 2], sessionMinutes: 40, gameMinutes: 15, players: names(4) });
    const id = cr.body.id as number; const t0 = env.now;
    const d1 = (await admin.post(`open-play/${id}/start`)).body as OpenPlaySessionDto;
    expect(d1.currentRound!.games).toHaveLength(2);
    const winners: number[] = [], losers: number[] = [];
    for (const g of d1.currentRound!.games) { await admin.post(`open-play/${id}/games/${g.id}/result`, { scoreA: 11, scoreB: 6 }); winners.push(g.teamA[0]!.id); losers.push(g.teamB[0]!.id); }
    env.advance(20_000); tick();
    const d2 = await get(id); expect(d2.currentRound!.number).toBe(2);
    const g2 = d2.currentRound!.games.map((g) => [g.teamA[0]!.id, g.teamB[0]!.id].sort((a, b) => a - b));
    expect(g2).toEqual(expect.arrayContaining([[...winners].sort((a, b) => a - b), [...losers].sort((a, b) => a - b)]));
    expect(d2.currentRound!.games[0]!.teamA.concat(d2.currentRound!.games[0]!.teamB).every((p) => winners.includes(p.id))).toBe(true); // Court 1 = the winners
    // not enough time left for another full game when round 2 ends → the session finishes
    env.setNow(t0 + 30 * 60_000);
    for (const g of d2.currentRound!.games) await admin.post(`open-play/${id}/games/${g.id}/result`, { scoreA: 11, scoreB: 8 });
    env.advance(20_000); tick();
    const fin = await get(id);
    expect(fin.status).toBe('finished'); expect(fin.roundCount).toBe(2);
    const top = fin.standings[0]!;
    expect(top).toMatchObject({ rank: 1, wins: 2, losses: 0 }); expect(fin.champions).toEqual([top.name]);
    expect(fin.standings.map((p) => p.rank)).toEqual([1, 2, 3, 4]);   // 2-0, then the two 1-1 players split on point difference (+2 v −2), then 0-2
    expect(fin.standings.map((p) => p.wins)).toEqual([2, 1, 1, 0]); expect(fin.standings[1]!.avgDiff).toBeGreaterThan(fin.standings[2]!.avgDiff);
    expect(fin.standings.at(-1)).toMatchObject({ wins: 0, losses: 2 });
    // Open Play games are ordinary matches in Game Histories and on the Players page
    const hist = (await staff.get('matches?openPlay=1&pageSize=100')).body;
    expect(hist.items.filter((m: { openPlay: boolean }) => m.openPlay).length).toBeGreaterThanOrEqual(4);
    expect((await staff.get('players?kind=typed&q=P0')).body.items.length).toBeGreaterThan(0);
  });

  it('a session whose time has run out cancels games that never started', async () => {
    const cr = await admin.post('open-play', { name: 'Late', playType: 'singles', courtIds: [3, 4], sessionMinutes: 30, gameMinutes: 15, players: names(4) });
    const id = cr.body.id as number; const t0 = env.now;
    await admin.post(`open-play/${id}/start`);
    env.setNow(t0 + 31 * 60_000); tick();
    const d = await get(id);
    expect(d.status).toBe('finished');
    expect(d.rounds[0]!.games.every((g) => g.status === 'cancelled')).toBe(true);
    expect(d.players.every((p) => p.played === 0)).toBe(true); // cancelled games count as sitting out
  });
});
