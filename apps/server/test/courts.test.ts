import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createAndStart, seedEnv, type TestEnv } from './helpers';

let env: TestEnv; let admin: Client; let staff: Client;
beforeAll(async () => { ({ env, admin, staff } = await seedEnv(2)); });
afterAll(async () => { await env.destroy(); });

describe('court count and limit (FR-COURT-02/03)', () => {
  it('bulk-creates up to the 24-court maximum and refuses the 25th', async () => {
    const r = await admin.post('courts/bulk', { count: 22 });
    expect(r.status).toBe(201);
    expect(r.body.map((c: any) => c.court.name).slice(0, 3)).toEqual(['Court 3', 'Court 4', 'Court 5']);
    expect((await admin.get('courts')).body).toHaveLength(24);
    const over = await admin.post('courts', { name: 'Court 25', shortCode: '25' });
    expect(over.status).toBe(422); expect(over.body.error.code).toBe('COURT_LIMIT_REACHED');
    expect((await admin.post('courts/bulk', { count: 1 })).body.error.code).toBe('COURT_LIMIT_REACHED');
  });

  it('serialises concurrent creation: only one of two simultaneous requests gets the last slot', async () => {
    await admin.patch('courts/24', { isActive: false });
    const [a, b] = await Promise.all([
      admin.post('courts', { name: 'Show Court', shortCode: 'SC' }),
      admin.post('courts', { name: 'Back Court', shortCode: 'BC' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 422]);
    expect((await admin.get('courts')).body).toHaveLength(24);
  });

  it('keeps identifiers unique, case-insensitively, and locks the short code after the first match', async () => {
    const last = (await admin.get('courts')).body.at(-1).court.id;
    await admin.patch(`courts/${last}`, { isActive: false }); // make room under the 24 limit
    expect((await admin.post('courts', { name: 'court 1', shortCode: 'ZZ' })).status).toBe(409);
    expect((await admin.post('courts', { name: 'New One', shortCode: '1' })).status).toBe(409);
    const { id } = await createAndStart(staff, 1, { playType: 'singles' });
    expect((await admin.patch('courts/1', { shortCode: '77' })).body.error.code).toBe('SHORT_CODE_LOCKED');
    expect((await admin.patch('courts/1', { name: 'Center Court' })).status).toBe(200);
    expect((await admin.patch('courts/1', { isActive: false })).body.error.code).toBe('ACTIVE_MATCHES_EXIST');
    expect((await admin.del('courts/1')).status).toBe(409);
    expect(id).toBeGreaterThan(0);
  });

  it('keeps the history of a deactivated court', async () => {
    const act = (await staff.get('matches/live')).body.find((m: any) => m.courtId === 1);
    await staff.post(`matches/${act.id}/commands`, { commandId: 'end-cmd-0000000000001', expectedVersion: act.snapshot.version, type: 'END_MATCH', payload: { reason: 'time_up', confirmed: true } });
    expect((await admin.patch('courts/1', { isActive: false })).status).toBe(200);
    expect((await admin.get('courts')).body.some((c: any) => c.court.id === 1)).toBe(false);
    expect((await admin.get('courts?includeInactive=true')).body.find((c: any) => c.court.id === 1).court.status).toBe('inactive');
    const hist = (await staff.get('matches?courtId=1')).body;
    expect(hist.total).toBe(1); expect(hist.items[0]).toMatchObject({ courtName: 'Center Court', courtActive: false });
    expect((await staff.post('matches', { courtId: 1, playType: 'singles' })).body.error.code).toBe('COURT_UNAVAILABLE');
  });
});

describe('court devices: "Use this device for Court N" (FR-TERM)', () => {
  it('assigns, names the device after its court, and blocks a second device without confirmation', async () => {
    const phone = new Client(env, '10.0.0.60'); await phone.login('maria', 'maria-pass-1');
    const r = await phone.put('session/terminal', { courtId: 5 });
    expect(r.body.terminal).toEqual({ courtId: 5, courtName: 'Court 5' });
    expect((await phone.get('auth/me')).body.terminal.courtName).toBe('Court 5');
    const dash = (await staff.get('courts')).body.find((c: any) => c.court.id === 5).court.device;
    expect(dash).toMatchObject({ signedInUser: 'Maria', online: false });
    expect(dash.ip).toBeUndefined(); // Staff never see the IP
    expect((await admin.get('courts')).body.find((c: any) => c.court.id === 5).court.device.ip).toBeTruthy();

    const tablet = new Client(env, '10.0.0.61'); await tablet.login('owner', 'owner-pass-1');
    const conflict = await tablet.put('session/terminal', { courtId: 5 });
    expect(conflict.status).toBe(409); expect(conflict.body.error.code).toBe('COURT_HAS_DEVICE');
    expect(conflict.body.error.details.signedInUser).toBe('Maria');
    expect((await tablet.put('session/terminal', { courtId: 5, replaceExisting: true })).status).toBe(200);
    expect((await phone.get('auth/me')).body.terminal).toBeNull(); // the old device went back to normal
    expect((await admin.get('audit-logs?action=terminal')).body.items.map((i: any) => i.action)).toEqual(expect.arrayContaining(['terminal.assign', 'terminal.replace']));
  });

  it('is unassigned by "stop using", signed out by the Admin, and survives acting on another court', async () => {
    const t = new Client(env, '10.0.0.62'); await t.login('maria', 'maria-pass-1');
    await t.put('session/terminal', { courtId: 6 });
    // assigned to Court 6, but still allowed to operate Court 7 (any court)
    const m = await t.post('matches', { courtId: 7, playType: 'singles' });
    expect(m.status).toBe(201);
    const ev = (await t.get(`matches/${m.body.snapshot.match.id}`)).body;
    expect(ev.createdOnCourt).toBe('Court 6');
    expect((await staff.req('DELETE', 'courts/6/device')).status).toBe(403);
    expect((await admin.req('DELETE', 'courts/6/device')).status).toBe(204);
    expect((await t.get('auth/me')).status).toBe(401); // signed out
    expect((await admin.get('courts/6')).body.court.device).toBeNull();
    const t2 = new Client(env, '10.0.0.63'); await t2.login('maria', 'maria-pass-1');
    await t2.put('session/terminal', { courtId: 6 });
    expect((await t2.req('DELETE', 'session/terminal')).status).toBe(204);
    expect((await t2.get('auth/me')).body.terminal).toBeNull();
  });
});
