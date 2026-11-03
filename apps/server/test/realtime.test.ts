import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { Client, cid, makeEnv, rally, type TestEnv } from './helpers';

let env: TestEnv; let admin: Client; let staff: Client; let url: string;
const sockets: Socket[] = [];
beforeAll(async () => {
  env = await makeEnv({ listen: true });
  url = `http://127.0.0.1:${(env.app.server.address() as { port: number }).port}`;
  admin = new Client(env, '127.0.0.1');
  await admin.post('/api/v1/setup', { username: 'owner', displayName: 'Owner', password: 'owner-pass-1', courtCount: 3 });
  await admin.post('users', { username: 'maria', displayName: 'Maria', password: 'maria-pass-1', mustChangePassword: false });
  staff = new Client(env, '127.0.0.1'); await staff.login('maria', 'maria-pass-1');
});
afterAll(async () => { sockets.forEach((s) => s.close()); await env.destroy(); });

const open = (c: Client): Promise<{ s: Socket; hello: any; buf: any[] }> => new Promise((resolve, reject) => {
  const s = connect(url, { transports: ['websocket'], extraHeaders: { cookie: c.cookie }, forceNew: true, reconnection: false });
  sockets.push(s);
  const buf: any[] = []; // snapshots are buffered from the first frame so none are missed
  s.on('court:snapshot', (p) => buf.push(p));
  s.once('server:hello', (hello) => resolve({ s, hello, buf }));
  s.once('connect_error', reject);
});
const snapWhere = async (buf: any[], pred: (p: any) => boolean, ms = 2000) => { let f: any; await waitFor(() => (f = buf.find(pred)) != null, ms); return f; };
const next = <T = any>(s: Socket, ev: string, pred: (p: T) => boolean = () => true, ms = 2000): Promise<T> => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`timeout waiting for ${ev}`)), ms);
  const h = (p: T) => { if (pred(p)) { clearTimeout(t); s.off(ev, h); resolve(p); } };
  s.on(ev, h);
});
const waitFor = async (fn: () => Promise<boolean> | boolean, ms = 2000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return; await new Promise((r) => setTimeout(r, 25)); } throw new Error('condition not met'); };

describe('Socket.IO (API_SPECIFICATION §6)', () => {
  it('rejects unauthenticated sockets with a UNAUTHENTICATED code', async () => {
    await expect(open(new Client(env))).rejects.toMatchObject({ message: 'UNAUTHENTICATED', data: { code: 'UNAUTHENTICATED' } });
  });

  it('a device assigned to Court 2 gets only that court until it subscribes, and is marked online', async () => {
    const phone = new Client(env, '10.1.1.2'); await phone.login('maria', 'maria-pass-1');
    await phone.put('session/terminal', { courtId: 2 });
    const { s, hello, buf } = await open(phone);
    expect(hello.terminal).toEqual({ courtId: 2, courtName: 'Court 2' });
    const first = await snapWhere(buf, () => true);
    expect(first.court.id).toBe(2);
    await waitFor(async () => (await staff.get('courts/2')).body.court.device.online === true);

    const m = await staff.post('matches', { courtId: 1, playType: 'singles' });   // Court 1: not subscribed
    await new Promise((r) => setTimeout(r, 150));
    expect(buf.map((p) => p.court.id)).not.toContain(1);
    const m2 = await staff.post('matches', { courtId: 2, playType: 'singles' });  // Court 2: its own court
    const snap = await snapWhere(buf, (p: any) => p.court.id === 2 && p.match != null);
    void s;
    expect(snap.match.id).toBe(m2.body.snapshot.match.id);
    expect(m.status).toBe(201);
  });

  it('subscribe("all") gives dashboards every court, in real time, within a second', async () => {
    const { s, buf } = await open(staff);
    const snaps: any[] = await new Promise((resolve) => s.emit('subscribe', { courts: 'all' }, resolve));
    expect(snaps.map((c) => c.court.id).sort()).toEqual([1, 2, 3]);
    const live = (await staff.get('matches/live')).body.find((x: any) => x.courtId === 1);
    const t0 = Date.now();
    await staff.post(`matches/${live.id}/commands`, { commandId: cid(), expectedVersion: live.snapshot.version, type: 'START_MATCH', payload: { servingTeam: 'A' } });
    const got = await snapWhere(buf, (x: any) => x.court.id === 1 && x.match?.status === 'in_progress');
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(got.match.current.scoreCall).toBe('0-0');
  });

  it('reconnection restores the correct court and match (FR-TERM-03)', async () => {
    const phone = new Client(env, '10.1.1.3'); await phone.login('maria', 'maria-pass-1');
    await phone.put('session/terminal', { courtId: 3 });
    let { s } = await open(phone);
    const m = await phone.post('matches', { courtId: 3, playType: 'doubles' });
    const mm = m.body.snapshot.match;
    let r = await phone.post(`matches/${mm.id}/commands`, { commandId: cid(), expectedVersion: mm.version, type: 'START_MATCH', payload: { servingTeam: 'B' } });
    r = await rally(phone, mm.id, r.body.snapshot.match.version, 'B'); // 1-0-2 for B
    s.close(); // Wi-Fi drops
    await waitFor(async () => (await staff.get('courts/3')).body.court.device.online === false);
    // a rally is scored from another device meanwhile
    await rally(staff, mm.id, r.body.snapshot.match.version, 'B');
    const again = await open(phone); // device comes back with the same cookie
    s = again.s;
    const snap = await snapWhere(again.buf, (p: any) => p.court.id === 3);
    expect(snap.match.id).toBe(mm.id);
    expect(snap.match.current.scoreCall).toBe('2-0-2');
    const synced: any[] = await new Promise((resolve) => s.emit('sync', {}, resolve));
    expect(synced.map((c) => c.court.id)).toEqual([3]);
  });

  it('tells a replaced device and closes sockets of deactivated users within 2 s', async () => {
    const a = new Client(env, '10.1.1.4'); await a.login('maria', 'maria-pass-1');
    await a.put('session/terminal', { courtId: 1 });
    const { s } = await open(a);
    const changed = next(s, 'terminal:changed');
    const b = new Client(env, '10.1.1.5'); await b.login('owner', 'owner-pass-1');
    await b.put('session/terminal', { courtId: 1, replaceExisting: true });
    expect(await changed).toMatchObject({ courtId: null, reason: 'replaced' });

    const victim = (await admin.post('users', { username: 'leaver', displayName: 'Leaver', password: 'leaver-pass-1', mustChangePassword: false })).body;
    const lc = new Client(env, '10.1.1.6'); await lc.login('leaver', 'leaver-pass-1');
    const { s: ls } = await open(lc);
    const gone = new Promise((resolve) => ls.once('disconnect', resolve));
    const t0 = Date.now();
    await admin.patch(`users/${victim.id}`, { isActive: false });
    await gone;
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('sends Admin-only alerts to Admin sockets only', async () => {
    const { s: sa } = await open(admin); const { s: ss } = await open(staff);
    const pa = next<any[]>(sa, 'alerts'); const ps = next<any[]>(ss, 'alerts');
    env.ctx.pub.alertsChanged();
    expect((await pa).some((a) => a.id === 'backup-old')).toBe(true);
    expect((await ps).some((a) => a.adminOnly)).toBe(false);
  });
});
