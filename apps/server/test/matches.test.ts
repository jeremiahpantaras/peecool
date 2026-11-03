import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, cid, createAndStart, rally, seedEnv, type TestEnv } from './helpers';
import { runAutoConfirm } from '../src/jobs';

let env: TestEnv; let admin: Client; let staff: Client;
beforeAll(async () => { ({ env, admin, staff } = await seedEnv(4)); });
afterAll(async () => { await env.destroy(); });

const cmd = (c: Client, id: number, version: number, type: string, payload: any = {}, commandId = cid()) =>
  c.post(`matches/${id}/commands`, { commandId, expectedVersion: version, type, payload });

describe('creating matches (FR-MATCH-02)', () => {
  it('requires an explicit match type and never creates directory players', async () => {
    const bad = await staff.post('matches', { courtId: 1 });
    expect(bad.status).toBe(422);
    const before = env.ctx.db.prepare('SELECT count(*) c FROM players').get() as { c: number };
    const r = await staff.post('matches', { courtId: 1, playType: 'doubles', players: [{ team: 'A', slot: 1, displayName: '  Jordan   Lee ' }] });
    expect(r.status).toBe(201);
    const m = r.body.snapshot.match;
    expect(m.status).toBe('setup');
    expect(m.teams.A.players[0]).toMatchObject({ displayName: 'Jordan Lee', isDefaultLabel: false, playerId: null });
    expect(m.teams.A.players[1]).toMatchObject({ displayName: 'Player 2', isDefaultLabel: true });
    expect(m.teams.B.players.map((p: any) => p.displayName)).toEqual(['Player 1', 'Player 2']);
    expect((env.ctx.db.prepare('SELECT count(*) c FROM players').get() as { c: number }).c).toBe(before.c);
    expect(r.body.snapshot.court.status).toBe('occupied');
    // one active match per court
    const dup = await staff.post('matches', { courtId: 1, playType: 'singles' });
    expect(dup.status).toBe(409); expect(dup.body.error.code).toBe('COURT_BUSY');
    expect((await cmd(staff, m.id, m.version, 'CANCEL')).status).toBe(200);
  });

  it('snapshots rule overrides and validates them', async () => {
    const bad = await staff.post('matches', { courtId: 1, playType: 'doubles', ruleOverrides: { servingMode: 'off' } });
    expect(bad.status).toBe(422); expect(bad.body.error.code).toBe('INVALID_RULES');
    const ok = await staff.post('matches', { courtId: 1, playType: 'singles', ruleOverrides: { pointsToWin: 15, winBy: 1 } });
    expect(ok.status).toBe(201);
    expect(ok.body.snapshot.match.rules).toMatchObject({ pointsToWin: 15, winBy: 1, customized: true });
    expect(ok.body.snapshot.match.rules.name).toMatch(/\(custom\)$/);
    await cmd(staff, ok.body.snapshot.match.id, ok.body.snapshot.match.version, 'CANCEL');
  });

  it('honours the allowRuleOverrides setting', async () => {
    await admin.patch('settings', { allowRuleOverrides: false });
    expect((await staff.post('matches', { courtId: 1, playType: 'singles', ruleOverrides: { pointsToWin: 15 } })).status).toBe(403);
    await admin.patch('settings', { allowRuleOverrides: true });
  });

  it('refuses inactive and maintenance courts', async () => {
    expect((await staff.post('courts/2/maintenance', { enabled: true, note: 'Net repair' })).status).toBe(200); // Staff may set status
    const r = await staff.post('matches', { courtId: 2, playType: 'singles' });
    expect(r.status).toBe(409); expect(r.body.error.code).toBe('COURT_UNAVAILABLE');
    await staff.post('courts/2/maintenance', { enabled: false });
  });
});

describe('command pipeline (MATCH_SCORING_LOGIC §10)', () => {
  it('plays doubles, applies idempotency and version checks', async () => {
    const { id, snap } = await createAndStart(staff, 1, { playType: 'doubles' });
    let v = snap.match.version;
    expect(snap.match.current.scoreCall).toBe('0-0-2');
    const id1 = cid();
    const r1 = await cmd(staff, id, v, 'RALLY_WON', { team: 'A' }, id1);
    expect(r1.status).toBe(200); expect(r1.body.duplicate).toBe(false);
    expect(r1.body.snapshot.match.current.scoreCall).toBe('1-0-2');
    // retry with the same commandId → no second point
    const r1b = await cmd(staff, id, v, 'RALLY_WON', { team: 'A' }, id1);
    expect(r1b.body.duplicate).toBe(true);
    expect(r1b.body.snapshot.match.current.score).toEqual({ A: 1, B: 0 });
    v = r1.body.snapshot.match.version;
    // stale version → 409 with the current snapshot
    const stale = await cmd(admin, id, v - 1, 'RALLY_WON', { team: 'B' });
    expect(stale.status).toBe(409); expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    expect(stale.body.snapshot.match.version).toBe(v);
    // side out
    const so = await cmd(staff, id, v, 'RALLY_WON', { team: 'B' });
    expect(so.body.snapshot.match.current).toMatchObject({ servingTeam: 'B', scoreCall: '0-1-1' });
    expect(so.body.snapshot.match.lastAction.label).toContain('side out');
    // undo restores the previous server
    const un = await cmd(staff, id, so.body.snapshot.match.version, 'UNDO');
    expect(un.body.snapshot.match.current).toMatchObject({ servingTeam: 'A', scoreCall: '1-0-2' });
    expect(un.body.snapshot.match.lastAction.label).toMatch(/^Undid/);
    const events = (await staff.get(`matches/${id}/events`)).body;
    expect(events.filter((e: any) => e.voided).map((e: any) => e.type)).toEqual(['RALLY_WON']);
    expect(events.at(-1)).toMatchObject({ type: 'UNDO', actor: 'Maria' });
    await cmd(staff, id, un.body.snapshot.match.version, 'END_MATCH', { reason: 'time_up', confirmed: true });
  });

  it('validates payloads and engine preconditions', async () => {
    const { id, snap } = await createAndStart(staff, 2, { playType: 'singles' });
    const v = snap.match.version;
    expect((await cmd(staff, id, v, 'RALLY_WON', { team: 'Z' })).status).toBe(422);
    expect((await cmd(staff, id, v, 'START_MATCH', { servingTeam: 'A' })).body.error.code).toBe('INVALID_STATE');
    expect((await cmd(staff, id, v, 'RESUME')).body.error.code).toBe('INVALID_STATE');
    expect((await cmd(staff, id, v, 'ADJUST_SCORE', { scoreA: 11, scoreB: 2, servingTeam: 'A' })).body.error.code).toBe('ADJUST_WOULD_END_GAME');
    const bad = await staff.post(`matches/${id}/commands`, { commandId: 'short', expectedVersion: v, type: 'PAUSE', payload: {} });
    expect(bad.status).toBe(422);
    await cmd(staff, id, v, 'CANCEL'); // not allowed once started
    expect((await cmd(staff, id, v, 'END_MATCH', { reason: 'injury', confirmed: true })).status).toBe(200);
  });

  it('completes a match: game over → match over → confirm; auto-confirm races Undo safely', async () => {
    const { id, snap } = await createAndStart(staff, 3, { playType: 'singles' });
    let v = snap.match.version; let last: any = snap;
    for (let i = 0; i < 11; i++) { last = (await rally(staff, id, v, 'A')).body.snapshot; v = last.match.version; }
    expect(last.match).toMatchObject({ status: 'in_progress', phase: 'match_over', winner: 'A' });
    expect(last.match.autoConfirmAt).toBeGreaterThan(env.now);
    // Undo wins over a pending auto-confirm
    const un = await cmd(staff, id, v, 'UNDO'); v = un.body.snapshot.match.version;
    env.advance(130_000);
    expect(runAutoConfirm(env.ctx)).toBe(0);
    const again = await rally(staff, id, v, 'A'); v = again.body.snapshot.match.version;
    env.advance(130_000);
    expect(runAutoConfirm(env.ctx)).toBe(1);
    const fin = (await staff.get(`matches/${id}`)).body;
    expect(fin.item).toMatchObject({ status: 'completed', winner: 'A', gamesWon: { A: 1, B: 0 } });
    expect(fin.snapshot.end).toMatchObject({ reason: 'completed' });
    const ev = (await staff.get(`matches/${id}/events`)).body.at(-1);
    expect(ev).toMatchObject({ type: 'CONFIRM_MATCH_END', actor: 'System' });
    expect((await staff.get('courts/3')).body.court.status).toBe('completed');
    expect((await staff.post('courts/3/release')).body.court.status).toBe('available');
  });

  it('END_MATCH: needs confirmed:true, records the time, keeps scores, never sets a winner', async () => {
    const { id, snap } = await createAndStart(staff, 4, { playType: 'singles', ruleOverrides: { gamesToWin: 2 } });
    let v = snap.match.version;
    for (let i = 0; i < 11; i++) v = (await rally(staff, id, v, 'A')).body.snapshot.match.version; // game 1 to A
    v = (await cmd(staff, id, v, 'START_NEXT_GAME', { servingTeam: 'B' })).body.snapshot.match.version;
    for (let i = 0; i < 3; i++) v = (await rally(staff, id, v, 'B')).body.snapshot.match.version;
    const noConfirm = await staff.post(`matches/${id}/commands`, { commandId: cid(), expectedVersion: v, type: 'END_MATCH', payload: { reason: 'players_left' } });
    expect(noConfirm.status).toBe(422);
    const other = await cmd(staff, id, v, 'END_MATCH', { reason: 'other', confirmed: true });
    expect(other.status).toBe(422); // note required
    env.advance(5000);
    const r = await cmd(staff, id, v, 'END_MATCH', { reason: 'players_left', confirmed: true });
    expect(r.status).toBe(200);
    const m = r.body.snapshot.match;
    expect(m).toMatchObject({ status: 'terminated', winner: null, gamesWon: { A: 1, B: 0 } });
    expect(m.end).toMatchObject({ reason: 'players_left', byUser: 'Maria', at: env.now });
    expect(m.games.map((g: any) => [g.scoreA, g.scoreB, g.status])).toEqual([[11, 0, 'completed'], [0, 3, 'abandoned']]);
    const row = env.ctx.db.prepare('SELECT status, winner_team, ended_at, end_reason FROM matches WHERE id = ?').get(id);
    expect(row).toMatchObject({ status: 'terminated', winner_team: null, ended_at: env.now, end_reason: 'players_left' });
    // cannot undo it, cannot end twice
    expect((await cmd(staff, id, m.version, 'UNDO')).status).toBe(409);
    expect((await cmd(staff, id, m.version, 'END_MATCH', { reason: 'injury', confirmed: true })).status).toBe(409);
    expect((await staff.get('courts/4')).body.court.status).toBe('completed');
  });

  it('lets a second user score the same court (any device) and attributes each action', async () => {
    await staff.post('courts/1/release');
    const { id, snap } = await createAndStart(staff, 1, { playType: 'singles' });
    const r = await rally(admin, id, snap.match.version, 'A');
    expect(r.status).toBe(200);
    const ev = (await admin.get(`matches/${id}/events`)).body;
    expect(ev.at(-1).actor).toBe('Owner'); expect(ev[1].actor).toBe('Maria');
    await cmd(admin, id, r.body.snapshot.match.version, 'END_MATCH', { reason: 'time_up', confirmed: true });
  });
});

describe('history, corrections and permissions (FR-HIST, FR-MATCH-17)', () => {
  it('lists with filters for both roles with no date window, but only Admin exports/corrects', async () => {
    const all = await staff.get('matches?pageSize=100');
    expect(all.status).toBe(200);
    expect(all.body.total).toBeGreaterThanOrEqual(5);
    expect((await staff.get('matches?status=terminated')).body.items.every((i: any) => i.status === 'terminated')).toBe(true);
    expect((await staff.get('matches?playType=singles&courtId=4')).body.items.length).toBeGreaterThan(0);
    expect((await staff.get('matches/export.csv')).status).toBe(403);
    const csv = await admin.get('matches/export.csv');
    expect(csv.status).toBe(200); expect(csv.raw.charCodeAt(0)).toBe(0xfeff);
    expect(csv.raw).toContain('Ended early reason');
  });

  it('Admin corrects an ended-early match into a completed result; Staff cannot', async () => {
    const ended = (await staff.get('matches?status=terminated&courtId=4')).body.items[0];
    const detail = (await staff.get(`matches/${ended.id}`)).body;
    const body = { commandId: cid(), expectedVersion: detail.snapshot.version, games: [{ number: 2, scoreA: 11, scoreB: 6 }], reason: 'Scorer left early' };
    expect((await staff.post(`matches/${ended.id}/correction`, body)).status).toBe(403);
    const bad = await admin.post(`matches/${ended.id}/correction`, { ...body, commandId: cid(), games: [{ number: 2, scoreA: 6, scoreB: 7 }] });
    expect(bad.status).toBe(422); expect(bad.body.error.code).toBe('INVALID_CORRECTION');
    const ok = await admin.post(`matches/${ended.id}/correction`, body);
    expect(ok.status).toBe(200);
    expect((await admin.get('audit-logs?action=match.correct')).body.total).toBe(1);
    expect((await admin.get(`matches/${ended.id}`)).body.item).toMatchObject({ status: 'completed', winner: 'A', corrected: true });
    const events = (await admin.get(`matches/${ended.id}/events`)).body;
    expect(events.at(-1)).toMatchObject({ type: 'ADMIN_CORRECTION' });
    expect((await admin.get('audit-logs?action=match.correct')).body.total).toBe(1);
  });
});
