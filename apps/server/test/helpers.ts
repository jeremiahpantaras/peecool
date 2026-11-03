import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zonedToEpoch } from '@pickle/shared';
import { createServer, type RunningServer } from '../src/server';

export const TZ = 'America/New_York';
export const at = (date: string, hhmm: string): number => { const [h, m] = hhmm.split(':').map(Number); return zonedToEpoch(date, h! * 60 + m!, TZ); };

export interface TestEnv extends RunningServer {
  dir: string;
  now: number;
  setNow(ms: number): void;
  advance(ms: number): void;
  destroy(): Promise<void>;
}

export async function makeEnv(opts: { listen?: boolean; start?: number } = {}): Promise<TestEnv> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pickle-test-'));
  const state = { now: opts.start ?? at('2026-10-30', '12:00') };
  const srv = await createServer({
    config: { dataDir: dir, dbFile: path.join(dir, 'pickle.db'), fastHash: true, logLevel: 'silent', webRoot: null, port: 0, host: '127.0.0.1' },
    clock: () => state.now, timeZone: TZ, listen: opts.listen ?? false, jobs: false,
  });
  const env = srv as TestEnv;
  env.dir = dir;
  Object.defineProperty(env, 'now', { get: () => state.now });
  env.setNow = (ms) => { state.now = ms; };
  env.advance = (ms) => { state.now += ms; };
  env.destroy = async () => { await srv.close(); fs.rmSync(dir, { recursive: true, force: true }); };
  return env;
}

export interface Res<T = any> { status: number; body: T; headers: Record<string, any>; raw: string }

/** Cookie-aware API client around fastify.inject. */
export class Client {
  cookie = '';
  constructor(public env: TestEnv, public ip = '10.0.0.20') {}
  async req<T = any>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res<T>> {
    const r = await this.env.app.inject({
      method: method as 'GET', url: url.startsWith('/') ? url : `/api/v1/${url}`, remoteAddress: this.ip,
      headers: { 'x-pickle-client': '1', ...(this.cookie ? { cookie: this.cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      payload: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = r.headers['set-cookie'];
    if (set) { const c = (Array.isArray(set) ? set[0]! : set).split(';')[0]!; this.cookie = c.endsWith('=') ? '' : c; }
    let parsed: any = r.body;
    try { parsed = r.body ? JSON.parse(r.body) : null; } catch { /* csv / text */ }
    return { status: r.statusCode, body: parsed, headers: r.headers, raw: r.body };
  }
  get = <T = any>(u: string, h?: Record<string, string>) => this.req<T>('GET', u, undefined, h);
  post = <T = any>(u: string, b: unknown = {}, h?: Record<string, string>) => this.req<T>('POST', u, b, h);
  put = <T = any>(u: string, b: unknown = {}) => this.req<T>('PUT', u, b);
  patch = <T = any>(u: string, b: unknown = {}) => this.req<T>('PATCH', u, b);
  del = <T = any>(u: string) => this.req<T>('DELETE', u);
  login = async (username: string, password: string) => this.post('auth/login', { username, password });
}

let n = 0;
export const cid = (): string => `cmd-${String(++n).padStart(6, '0')}-testcommandid`;

/** Boots an env with an Admin and a Staff user, N courts, and signed-in clients. */
export async function seedEnv(courts = 3): Promise<{ env: TestEnv; admin: Client; staff: Client; staffId: number }> {
  const env = await makeEnv();
  const admin = new Client(env, '127.0.0.1');
  const r = await admin.post('/api/v1/setup', { username: 'owner', displayName: 'Owner', password: 'owner-pass-1', facilityName: 'Test Club', courtCount: courts });
  if (r.status !== 201) throw new Error(`setup failed: ${r.status} ${r.raw}`);
  const u = await admin.post('users', { username: 'maria', displayName: 'Maria', password: 'maria-pass-1', role: 'staff', mustChangePassword: false });
  if (u.status !== 201) throw new Error(`staff create failed: ${u.raw}`);
  const staff = new Client(env, '10.0.0.31');
  const l = await staff.login('maria', 'maria-pass-1');
  if (l.status !== 200) throw new Error(`staff login failed: ${l.raw}`);
  return { env, admin, staff, staffId: u.body.id };
}

/** Plays a match end-to-end helper: create → start. Returns ids/versions. */
export async function createAndStart(c: Client, courtId: number, o: { playType?: 'singles' | 'doubles'; formatId?: number; ruleOverrides?: any; serving?: 'A' | 'B' } = {}) {
  const cr = await c.post('matches', { courtId, playType: o.playType ?? 'doubles', formatId: o.formatId, ruleOverrides: o.ruleOverrides });
  if (cr.status !== 201) throw new Error(`create failed ${cr.status} ${cr.raw}`);
  const m = cr.body.snapshot.match;
  const st = await c.post(`matches/${m.id}/commands`, { commandId: cid(), expectedVersion: m.version, type: 'START_MATCH', payload: o.serving === undefined && o.ruleOverrides?.servingMode === 'off' ? {} : { servingTeam: o.serving ?? 'A' } });
  if (st.status !== 200) throw new Error(`start failed ${st.status} ${st.raw}`);
  return { id: m.id as number, snap: st.body.snapshot };
}

export async function rally(c: Client, id: number, version: number, team: 'A' | 'B') {
  const r = await c.post(`matches/${id}/commands`, { commandId: cid(), expectedVersion: version, type: 'RALLY_WON', payload: { team } });
  return r;
}
