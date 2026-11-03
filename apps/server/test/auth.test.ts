import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, makeEnv, type TestEnv } from './helpers';

let env: TestEnv;
beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.destroy(); });

describe('first-run setup and login (FR-AUTH)', () => {
  it('reports that setup is needed and only accepts it from the Master PC', async () => {
    const lan = new Client(env, '10.0.0.9');
    expect((await lan.get('setup/status')).body).toMatchObject({ needsSetup: true, isLocalRequest: false });
    const denied = await lan.post('/api/v1/setup', { username: 'owner', displayName: 'Owner', password: 'owner-pass-1' });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('SETUP_LOCAL_ONLY');
  });

  it('creates the first Admin on loopback, with courts, then refuses a second setup', async () => {
    const local = new Client(env, '127.0.0.1');
    const r = await local.post('/api/v1/setup', { username: 'Owner', displayName: 'Owner', password: 'owner-pass-1', facilityName: 'Test Club', courtCount: 4 });
    expect(r.status).toBe(201);
    expect((await local.get('auth/me')).body.user).toMatchObject({ username: 'Owner', role: 'admin' });
    expect((await local.get('courts')).body.map((c: any) => c.court.name)).toEqual(['Court 1', 'Court 2', 'Court 3', 'Court 4']);
    const again = await new Client(env, '127.0.0.1').post('/api/v1/setup', { username: 'x1234', displayName: 'X', password: 'password123' });
    expect(again.status).toBe(409);
  });

  it('requires the CSRF header on mutations', async () => {
    const r = await env.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'owner', password: 'owner-pass-1' }, headers: { 'content-type': 'application/json' } });
    expect(r.statusCode).toBe(403);
    expect(JSON.parse(r.body).error.code).toBe('CSRF_HEADER_MISSING');
  });

  it('logs in case-insensitively, hides whether a username exists, and logs out', async () => {
    const c = new Client(env);
    const bad = await c.login('owner', 'wrong-password');
    const none = await c.login('nobody', 'wrong-password');
    expect(bad.status).toBe(401); expect(none.status).toBe(401);
    expect(bad.body.error.message).toBe(none.body.error.message);
    const ok = await c.login('OWNER', 'owner-pass-1');
    expect(ok.status).toBe(200);
    expect(ok.body.permissions).toContain('users.manage');
    expect((await c.get('auth/me')).status).toBe(200);
    expect((await c.post('auth/logout')).status).toBe(204);
    expect((await c.get('auth/me')).status).toBe(401);
  });

  it('locks a username after 5 failures for 15 minutes (even with the right password)', async () => {
    const c = new Client(env, '10.0.0.77');
    const admin = new Client(env, '127.0.0.1'); await admin.login('owner', 'owner-pass-1');
    await admin.post('users', { username: 'locky', displayName: 'Locky', password: 'right-pass-1', role: 'staff', mustChangePassword: false });
    for (let i = 0; i < 5; i++) expect((await c.login('locky', 'nope-nope-1')).status).toBe(401);
    const locked = await c.login('locky', 'right-pass-1');
    expect(locked.status).toBe(423);
    expect(locked.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
    env.advance(16 * 60_000);
    expect((await c.login('locky', 'right-pass-1')).status).toBe(200);
  });

  it('expires idle ordinary sessions but keeps a court-assigned session alive', async () => {
    const admin = new Client(env, '127.0.0.1'); await admin.login('owner', 'owner-pass-1');
    const idle = new Client(env, '10.0.0.88'); await idle.login('owner', 'owner-pass-1');
    const term = new Client(env, '10.0.0.89'); await term.login('owner', 'owner-pass-1');
    expect((await term.put('session/terminal', { courtId: 1 })).status).toBe(200);
    env.advance(9 * 3600_000); // > 8 h idle
    expect((await idle.get('auth/me')).status).toBe(401);
    expect((await term.get('auth/me')).status).toBe(200);
    env.advance(31 * 86400_000);
    expect((await term.get('auth/me')).status).toBe(401); // terminal sessions still expire after terminalSessionDays
  });
});

describe('users and forced password change (FR-AUTH-08)', () => {
  it('lets the Admin create unlimited Staff; new accounts must change the temporary password', async () => {
    const admin = new Client(env, '127.0.0.1'); await admin.login('owner', 'owner-pass-1');
    for (let i = 0; i < 40; i++) {
      const r = await admin.post('users', { username: `staff${i}`, displayName: `Staff ${i}`, password: 'temp-pass-1', role: 'staff' });
      expect(r.status).toBe(201);
    }
    const list = await admin.get('users?role=staff&pageSize=100');
    expect(list.body.total).toBeGreaterThanOrEqual(40);
    expect((await admin.get('users?q=staff3&pageSize=100')).body.items.length).toBeGreaterThan(0);

    const s = new Client(env, '10.0.0.40');
    const l = await s.login('staff7', 'temp-pass-1');
    expect(l.body.mustChangePassword).toBe(true);
    const blocked = await s.get('courts');
    expect(blocked.status).toBe(403); expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await s.post('auth/change-password', { currentPassword: 'temp-pass-1', newPassword: 'brand-new-pass' })).status).toBe(204);
    expect((await s.get('courts')).status).toBe(200);
  });

  it('protects the last Admin and revokes sessions on deactivation', async () => {
    const admin = new Client(env, '127.0.0.1'); await admin.login('owner', 'owner-pass-1');
    const me = (await admin.get('auth/me')).body.user.id;
    expect((await admin.patch(`users/${me}`, { isActive: false })).body.error.code).toBe('LAST_ADMIN');
    expect((await admin.patch(`users/${me}`, { role: 'staff' })).body.error.code).toBe('LAST_ADMIN');
    const u = (await admin.post('users', { username: 'temp.staff', displayName: 'Temp', password: 'temp-pass-1', mustChangePassword: false })).body;
    const s = new Client(env, '10.0.0.41'); await s.login('temp.staff', 'temp-pass-1');
    expect((await s.get('auth/me')).status).toBe(200);
    await admin.patch(`users/${u.id}`, { isActive: false });
    expect((await s.get('auth/me')).status).toBe(401);
    expect((await s.login('temp.staff', 'temp-pass-1')).status).toBe(401);
  });

  it('can restrict Admin sign-in to the Master PC', async () => {
    const admin = new Client(env, '127.0.0.1'); await admin.login('owner', 'owner-pass-1');
    await admin.patch('settings', { adminLoginMasterPcOnly: true });
    const lan = new Client(env, '10.0.0.50');
    const r = await lan.login('owner', 'owner-pass-1');
    expect(r.status).toBe(403); expect(r.body.error.code).toBe('ADMIN_LOGIN_RESTRICTED');
    await admin.patch('settings', { adminLoginMasterPcOnly: false });
    expect((await lan.login('owner', 'owner-pass-1')).status).toBe(200);
  });
});
