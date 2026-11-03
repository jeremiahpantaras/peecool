import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, cid, seedEnv, type TestEnv } from './helpers';
import { runAutoConfirm } from '../src/jobs';

let env: TestEnv; let admin: Client; let staff: Client;
beforeAll(async () => { ({ env, admin, staff } = await seedEnv(2)); });
afterAll(async () => { await env.destroy(); });

/** Singles match where A wins 11–x; names optional. */
async function playSingles(c: Client, courtId: number, a: { name?: string; playerId?: number } | null, b: { name?: string; playerId?: number } | null, aWins = true) {
  const players = [
    ...(a ? [{ team: 'A', slot: 1, ...(a.playerId ? { playerId: a.playerId } : { displayName: a.name }) }] : []),
    ...(b ? [{ team: 'B', slot: 1, ...(b.playerId ? { playerId: b.playerId } : { displayName: b.name }) }] : []),
  ];
  const cr = await c.post('matches', { courtId, playType: 'singles', players });
  let m = cr.body.snapshot.match;
  let r = await c.post(`matches/${m.id}/commands`, { commandId: cid(), expectedVersion: m.version, type: 'START_MATCH', payload: { servingTeam: aWins ? 'A' : 'B' } });
  let v = r.body.snapshot.match.version;
  for (let i = 0; i < 11; i++) { r = await c.post(`matches/${m.id}/commands`, { commandId: cid(), expectedVersion: v, type: 'RALLY_WON', payload: { team: aWins ? 'A' : 'B' } }); v = r.body.snapshot.match.version; }
  env.advance(130_000); runAutoConfirm(env.ctx);
  await admin.post(`courts/${courtId}/release`);
  return m.id as number;
}

describe('Players page: every name, registered or typed (FR-PLAYER-08/09)', () => {
  it('lists typed names grouped case-insensitively, never default labels, with stats and history', async () => {
    await playSingles(staff, 1, { name: 'jordan' }, { name: 'Riley' });
    await playSingles(staff, 1, { name: 'JORDAN' }, { name: 'Sam' }, false); // Jordan loses
    await playSingles(staff, 1, null, null); // nobody named
    const list = (await staff.get('players?pageSize=100')).body;
    const names = list.items.map((i: any) => i.name.toLowerCase());
    expect(names.filter((n: string) => n === 'jordan')).toHaveLength(1);
    expect(names).toEqual(expect.arrayContaining(['riley', 'sam']));
    expect(names.some((n: string) => /^player \d/.test(n))).toBe(false);
    const j = list.items.find((i: any) => i.name.toLowerCase() === 'jordan');
    expect(j).toMatchObject({ kind: 'typed', matches: 2, wins: 1, losses: 1 });
    const hist = (await staff.get(`players/${j.key}`)).body;
    expect(hist.stats).toMatchObject({ matches: 2, wins: 1, losses: 1, winPct: 50, pointsFor: 11, pointsAgainst: 11 });
    expect(hist.matches.items).toHaveLength(2);
    expect(hist.matches.items.map((m: any) => m.result).sort()).toEqual(['lost', 'won']);
    expect(hist.note).toMatch(/Grouped by the name as typed/);
    expect((await staff.get('players?kind=typed&q=ril')).body.items.map((i: any) => i.name)).toEqual(['Riley']);
  });

  it('Admin registers a typed name (with a dry-run preview) and nothing else changes; Staff cannot', async () => {
    const dir0 = (env.ctx.db.prepare('SELECT count(*) c FROM players').get() as { c: number }).c;
    expect(dir0).toBe(0); // typing names created no directory records
    expect((await staff.post('players/typed/add-to-directory', { name: 'jordan' })).status).toBe(403);
    const dry = await admin.post('players/typed/add-to-directory', { name: 'jordan', dryRun: true });
    expect(dry.body.matchesToLink).toBe(2);
    expect((env.ctx.db.prepare('SELECT count(*) c FROM players').get() as { c: number }).c).toBe(0); // dry run changes nothing
    const r = await admin.post('players/typed/add-to-directory', { name: 'jordan', displayName: 'Jordan Lee' });
    expect(r.body).toMatchObject({ linkedMatches: 2, key: expect.stringMatching(/^r:/) });
    const list = (await staff.get('players?pageSize=100')).body.items;
    expect(list.filter((i: any) => i.name.toLowerCase().startsWith('jordan'))).toHaveLength(1);
    const reg = list.find((i: any) => i.kind === 'registered');
    expect(reg).toMatchObject({ name: 'Jordan Lee', matches: 2, wins: 1, losses: 1 });
    // history still shows the name that was typed at the time
    const m = (await staff.get(`matches?playerKey=${reg.key}`)).body.items;
    expect(m).toHaveLength(2);
    expect(m.flatMap((x: any) => x.teams.A.players.concat(x.teams.B.players))).toEqual(expect.arrayContaining(['jordan', 'JORDAN']));
  });

  it('autocomplete offers registered players only, after 2 characters; selecting links the slot', async () => {
    const created = await admin.post('players', { displayName: 'Alexandra' });
    expect(created.status).toBe(201);
    expect((await staff.get('players/search?q=a')).body).toEqual([]);
    const hit = (await staff.get('players/search?q=al')).body;
    expect(hit).toEqual([{ id: created.body.id, displayName: 'Alexandra' }]);
    const id = await playSingles(staff, 2, { playerId: created.body.id }, { name: 'Pat' });
    const detail = (await staff.get(`matches/${id}`)).body.snapshot;
    expect(detail.teams.A.players[0]).toMatchObject({ displayName: 'Alexandra', playerId: created.body.id });
    // renaming the directory entry never rewrites history
    await admin.patch(`players/${created.body.id}`, { displayName: 'Alex R.' });
    expect((await staff.get(`matches/${id}`)).body.snapshot.teams.A.players[0].displayName).toBe('Alexandra');
    expect((await staff.get('players?kind=registered')).body.items.map((i: any) => i.name)).toContain('Alex R.');
    // deactivated players leave autocomplete but stay listed with history
    await admin.patch(`players/${created.body.id}`, { isActive: false });
    expect((await staff.get('players/search?q=al')).body).toEqual([]);
  });

  it('refuses the same player twice in one match and warns about another active match', async () => {
    const p = (await admin.post('players', { displayName: 'Taylor Z' })).body.id;
    const dup = await staff.post('matches', { courtId: 1, playType: 'doubles', players: [{ team: 'A', slot: 1, playerId: p }, { team: 'B', slot: 1, playerId: p }] });
    expect(dup.status).toBe(422);
    const first = await staff.post('matches', { courtId: 1, playType: 'singles', players: [{ team: 'A', slot: 1, playerId: p }] });
    expect(first.status).toBe(201);
    const second = await staff.post('matches', { courtId: 2, playType: 'singles', players: [{ team: 'A', slot: 1, playerId: p }] });
    expect(second.status).toBe(201); expect(second.body.warnings[0]).toMatch(/also in an active match/);
  });
});

describe('editing names mid-match (FR-PLAYER-03)', () => {
  it('UPDATE_PLAYERS changes names; clearing restores the default label; never creates directory records', async () => {
    const before = (env.ctx.db.prepare('SELECT count(*) c FROM players').get() as { c: number }).c;
    const live = (await staff.get('matches/live')).body.find((m: any) => m.courtId === 2);
    const r = await staff.post(`matches/${live.id}/commands`, { commandId: cid(), expectedVersion: live.snapshot.version, type: 'UPDATE_PLAYERS',
      payload: { teamBName: 'Visitors', players: [{ team: 'B', slot: 1, displayName: 'Chris' }, { team: 'A', slot: 1, playerId: null, displayName: '' }] } });
    expect(r.status).toBe(200);
    const m = r.body.snapshot.match;
    expect(m.teams.B).toMatchObject({ name: 'Visitors' });
    expect(m.teams.B.players[0]).toMatchObject({ displayName: 'Chris', isDefaultLabel: false });
    expect(m.teams.A.players[0]).toMatchObject({ displayName: 'Player 1', isDefaultLabel: true, playerId: null });
    expect((env.ctx.db.prepare('SELECT count(*) c FROM players').get() as { c: number }).c).toBe(before);
  });
});
