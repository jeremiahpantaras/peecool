import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PERMISSION_KEYS, can, type PermissionKey } from '@pickle/shared';
import { Client, seedEnv, type TestEnv } from './helpers';

let env: TestEnv; let admin: Client; let staff: Client;
beforeAll(async () => { ({ env, admin, staff } = await seedEnv(2)); });
afterAll(async () => { await env.destroy(); });

const fill = (url: string) => url.replace(':fileName', 'nope.db').replace(':key', 'r:999999').replace(':name.csv', 'volume.csv').replace(':name', 'volume').replace(/:id/g, '999999');
const SKIP = new Set(['POST /api/v1/auth/logout']);

describe('route table (NFR-SEC-13): every route × Admin × Staff × anonymous equals the permission matrix', () => {
  it('registers a permission for every API route and uses only known keys', () => {
    const api = env.routes.filter((r) => r.url.startsWith('/api/'));
    expect(api.length).toBeGreaterThan(70);
    for (const r of api) expect(r.perm || r.public || r.local, `${r.method} ${r.url}`).toBeTruthy();
    for (const r of api) if (r.perm) expect(PERMISSION_KEYS).toContain(r.perm);
    const used = new Set(api.map((r) => r.perm).filter(Boolean));
    // matches.end is checked inside POST /matches/:id/commands for the END_MATCH command type
    const indirect = new Set(['matches.end']);
    for (const k of PERMISSION_KEYS) expect(used.has(k) || indirect.has(k), `permission ${k} is used by no route`).toBe(true);
  });

  it('anonymous callers get 401 on every protected route', async () => {
    const anon = new Client(env, '10.0.0.200');
    for (const r of env.routes.filter((x) => x.perm)) {
      const res = await anon.req(r.method, fill(r.url), r.method === 'GET' ? undefined : {});
      expect(res.status, `${r.method} ${r.url}`).toBe(401);
    }
  });

  it('Staff is rejected (403) exactly where the matrix says and never elsewhere; Admin is never rejected', async () => {
    for (const r of env.routes.filter((x) => x.perm)) {
      if (SKIP.has(`${r.method} ${r.url}`)) continue;
      const body = r.method === 'GET' ? undefined : {};
      const s = await staff.req(r.method, fill(r.url), body);
      const a = await admin.req(r.method, fill(r.url), body);
      const staffAllowed = can({ kind: 'user', role: 'staff' }, r.perm as PermissionKey);
      if (staffAllowed) expect(s.status, `staff ${r.method} ${r.url}`).not.toBe(403);
      else { expect(s.status, `staff ${r.method} ${r.url}`).toBe(403); expect(s.body.error.code).toBe('FORBIDDEN'); }
      expect([401, 403], `admin ${r.method} ${r.url}`).not.toContain(a.status);
    }
  });

  it('public routes need no session; setup is loopback-only', async () => {
    const anon = new Client(env, '10.0.0.201');
    expect((await anon.get('health')).status).toBe(200);
    expect((await anon.get('setup/status')).status).toBe(200);
    expect((await anon.post('/api/v1/setup', {})).status).toBe(403);
    expect((await anon.post('/internal/shutdown', {})).status).toBe(403);
  });

  it('a Staff user can see every area but change only Court Management', async () => {
    for (const path of ['dashboard', 'courts', 'bookings/schedule', 'bookings', 'matches', 'players', 'reports/volume', 'formats']) {
      expect((await staff.get(path)).status, path).toBe(200);
    }
    for (const [m, path] of [['POST', 'bookings'], ['POST', 'courts'], ['POST', 'players'], ['POST', 'users'], ['PATCH', 'settings'], ['GET', 'users'], ['GET', 'audit-logs'], ['GET', 'backups'], ['POST', 'formats']] as const) {
      expect((await staff.req(m, path, m === 'GET' ? undefined : {})).status, `${m} ${path}`).toBe(403);
    }
  });
});
