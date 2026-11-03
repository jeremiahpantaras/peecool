import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, at, cid, createAndStart, rally, seedEnv, TZ, type TestEnv } from './helpers';
import { createServer } from '../src/server';
import { createBackup } from '../src/backup';
import { latestMigrationId } from '../src/db/client';
import { runAutoConfirm, runDailyBackup, runStartupReview } from '../src/jobs';

let env: TestEnv; let admin: Client; let staff: Client;
beforeAll(async () => { ({ env, admin, staff } = await seedEnv(3)); });
afterAll(async () => { await env.destroy(); });

async function finish(c: Client, courtId: number, playType: 'singles' | 'doubles', mins: number) {
  const { id, snap } = await createAndStart(c, courtId, { playType });
  let v = snap.match.version;
  env.advance(mins * 60_000);
  for (let i = 0; i < 11; i++) v = (await rally(c, id, v, 'A')).body.snapshot.match.version;
  runAutoConfirm(env.ctx) || (env.advance(130_000), runAutoConfirm(env.ctx));
  await admin.post(`courts/${courtId}/release`);
  return id;
}

describe('dashboard and analytics (FR-DASH, FR-REPORT)', () => {
  beforeAll(async () => {
    await admin.login('owner', 'owner-pass-1');
    await finish(staff, 1, 'doubles', 20); env.advance(10 * 60_000);
    await finish(staff, 1, 'singles', 40); env.advance(5 * 60_000);
    await finish(staff, 2, 'doubles', 30);
    const e = await createAndStart(staff, 3, { playType: 'singles' });
    env.advance(60_000);
    await staff.post(`matches/${e.id}/commands`, { commandId: cid(), expectedVersion: e.snap.match.version, type: 'END_MATCH', payload: { reason: 'injury', confirmed: true } });
    await admin.login('owner', 'owner-pass-1'); await staff.login('maria', 'maria-pass-1');
  });

  it('gives Staff and Admin the same dashboard (only Admin-only alerts differ)', async () => {
    const a = (await admin.get('dashboard')).body; const s = (await staff.get('dashboard')).body;
    expect(s.kpis).toEqual(a.kpis);
    expect(a.kpis).toMatchObject({ totalCourts: 3, completedToday: 3, matchesToday: 4, activeMatches: 0, bookingsToday: 0 });
    expect(s.courts).toHaveLength(3);
    expect(a.alerts.some((x: any) => x.adminOnly)).toBe(true);
    expect(s.alerts.some((x: any) => x.adminOnly)).toBe(false);
    expect(s.recentActivity.length).toBeGreaterThan(0);
    expect(s.recentActivity[0].text).toBeTruthy();
  });

  it('volume: completed vs ended early, singles vs doubles', async () => {
    const r = (await staff.get('reports/volume?from=2026-10-30&to=2026-10-30')).body.rows;
    expect(r).toEqual([{ period: '2026-10-30', completed: 3, endedEarly: 1, singles: 2, doubles: 2 }]);
    expect((await staff.get('reports/volume?groupBy=month&from=2026-10-01&to=2026-10-31')).body.rows[0].period).toBe('2026-10');
  });

  it('utilization uses operating hours; ended-early matches count toward occupied time', async () => {
    const u = (await staff.get('reports/utilization?from=2026-10-30&to=2026-10-30')).body;
    const c1 = u.rows.find((x: any) => x.courtName === 'Court 1');
    expect(c1).toMatchObject({ matches: 2, operatingMinutes: 15 * 60 });
    expect(c1.occupiedMinutes).toBeGreaterThanOrEqual(60);
    expect(c1.utilizationPct).toBeCloseTo((c1.occupiedMinutes / 900) * 100, 0);
    expect(u.total.matches).toBe(4);
  });

  it('durations, peak hours, players, turnover and bookings reports respond for Staff; CSV is Admin-only', async () => {
    const q = 'from=2026-10-30&to=2026-10-30';
    const d = (await staff.get(`reports/durations?${q}`)).body;
    expect(d.overall.count).toBe(4); expect(d.byPlayType.map((x: any) => x.key).sort()).toEqual(['doubles', 'singles']);
    expect(d.histogram.reduce((s: number, h: any) => s + h.count, 0)).toBe(4);
    const p = (await staff.get(`reports/peak-hours?${q}`)).body;
    expect(p.cells.length).toBeGreaterThan(0); expect(p.cells[0]).toHaveProperty('avgOccupiedCourts');
    expect(Array.isArray((await staff.get(`reports/players?${q}`)).body.rows)).toBe(true);
    expect((await staff.get(`reports/turnover?${q}`)).body.rows.find((r: any) => r.courtName === 'Court 1').matches).toBe(2);
    expect(Array.isArray((await staff.get(`reports/bookings?${q}`)).body.rows)).toBe(true);
    expect((await staff.get('reports/utilization.csv')).status).toBe(403);
    const csv = await admin.get(`reports/utilization.csv?${q}`);
    expect(csv.status).toBe(200); expect(csv.raw.startsWith('﻿')).toBe(true); expect(csv.raw).toContain('Court 1');
    expect((await admin.get('reports/nope')).status).toBe(404);
  });

  it('keeps the dashboard KPI equal to the Today report', async () => {
    const k = (await staff.get('dashboard')).body.kpis;
    const v = (await staff.get('reports/volume?from=2026-10-30&to=2026-10-30')).body.rows[0];
    expect(k.completedToday).toBe(v.completed);
  });
});

describe('backup and restore (FR-BACKUP)', () => {
  it('creates a consistent backup, lists it, and restores to the earlier state (with a pre-restore backup)', async () => {
    const b = (await admin.post('backups')).body;
    expect(b.fileName).toMatch(/-manual\.db$/);
    expect(b.schemaVersion).toBe(latestMigrationId());
    const countBefore = (await admin.get('courts?includeInactive=true')).body.length;
    await admin.post('courts', { name: 'Extra Court', shortCode: 'EX' });
    expect((await admin.get('courts?includeInactive=true')).body.length).toBe(countBefore + 1);

    // restore refuses while a match is active unless forced
    const act = await createAndStart(staff, 1, { playType: 'singles' });
    const blocked = await admin.post(`backups/${b.fileName}/restore`, {});
    expect(blocked.status).toBe(409); expect(blocked.body.error.code).toBe('ACTIVE_MATCHES_EXIST');
    expect(act.id).toBeGreaterThan(0);
    const gen = env.ctx.dbGeneration;
    const ok = await admin.post(`backups/${b.fileName}/restore`, { force: true });
    expect(ok.status).toBe(202);
    expect(env.ctx.dbGeneration).toBe(gen + 1);
    expect((await admin.get('courts?includeInactive=true')).body.length).toBe(countBefore);
    expect((await admin.get('backups')).body.some((x: any) => x.type === 'pre_restore')).toBe(true);
    // users and sessions are part of the restored database, so Staff can still sign in
    expect((await new Client(env, '10.0.0.5').login('maria', 'maria-pass-1')).status).toBe(200);
  });

  it('validates names (no path traversal), downloads, deletes, and is Admin-only', async () => {
    expect((await admin.get('backups/..%2F..%2Fetc%2Fpasswd/download')).status).toBe(404);
    expect((await admin.post('backups/not-a-backup.db/restore', {})).status).toBe(404);
    const list = (await admin.get('backups')).body;
    const dl = await admin.get(`backups/${list[0].fileName}/download`);
    expect(dl.status).toBe(200); expect(dl.raw.length).toBeGreaterThan(1000);
    expect((await staff.get('backups')).status).toBe(403);
    expect((await admin.del(`backups/${list.find((b: any) => b.type === 'pre_restore').fileName}`)).status).toBe(204);
  });

  it('copies to the extra path and reports a failure as an alert, without failing the backup', async () => {
    const extra = fs.mkdtempSync(path.join(os.tmpdir(), 'pickle-extra-'));
    await admin.patch('settings', { backupExtraPath: extra });
    const b = (await admin.post('backups')).body;
    expect(fs.existsSync(path.join(extra, b.fileName))).toBe(true);
    expect((await admin.post('backups/test-extra-path', { path: extra })).body.ok).toBe(true);
    await admin.patch('settings', { backupExtraPath: path.join(extra, b.fileName, 'impossible') }); // a file, not a folder
    expect((await admin.post('backups')).status).toBe(201);
    expect((await admin.get('dashboard')).body.alerts.some((a: any) => a.id === 'backup-extra')).toBe(true);
    await admin.patch('settings', { backupExtraPath: null });
    fs.rmSync(extra, { recursive: true, force: true });
  });

  it('runs the daily scheduled backup once, after the configured time', async () => {
    env.setNow(at('2026-10-30', '23:00')); expect(await runDailyBackup(env.ctx)).toBe(false);
    env.setNow(at('2026-10-30', '23:31')); expect(await runDailyBackup(env.ctx)).toBe(true);
    expect(await runDailyBackup(env.ctx)).toBe(false);
    expect((await createBackup(env.ctx, 'manual')).fileName).toBeTruthy();
  });
});

describe('restart, crash and recovery', () => {
  const boot = (dir: string, now: () => number) => createServer({ config: { dataDir: dir, dbFile: path.join(dir, 'pickle.db'), fastHash: true, logLevel: 'silent', webRoot: null, port: 0, host: '127.0.0.1' }, clock: now, timeZone: TZ });

  it('keeps every acknowledged command, the live match and the sessions across a restart; flags stale matches', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pickle-restart-'));
    let now = at('2026-10-30', '12:00');
    let s = await boot(dir, () => now);
    const a = new Client({ ...s, dir, now, setNow() {}, advance() {}, destroy: async () => {} } as unknown as TestEnv, '127.0.0.1');
    await a.post('/api/v1/setup', { username: 'owner', displayName: 'Owner', password: 'owner-pass-1', courtCount: 2 });
    const { id, snap } = await createAndStart(a, 1, { playType: 'doubles' });
    let v = snap.match.version;
    for (const t of ['A', 'B', 'B', 'A', 'A'] as const) v = (await rally(a, id, v, t)).body.snapshot.match.version;
    const before = (await a.get(`matches/${id}`)).body.snapshot;
    await s.close(); // like a service restart
    now += 60 * 60_000;
    s = await boot(dir, () => now);
    const a2 = new Client({ ...s } as unknown as TestEnv, '127.0.0.1'); a2.cookie = a.cookie;
    const after = await a2.get(`matches/${id}`);
    expect(after.status).toBe(200); // session survived
    expect(after.body.snapshot.current).toEqual(before.current);
    expect(after.body.snapshot.version).toBe(before.version);
    expect(after.body.snapshot.needsReview).toBe(true); // idle > staleMatchMinutes across the restart
    expect(runStartupReview(s.ctx)).toBe(0);
    // continuing play clears the flag
    const r = await rally(a2, id, before.version, 'A');
    expect(r.body.snapshot.match.needsReview).toBe(false);
    await s.close(); fs.rmSync(dir, { recursive: true, force: true });
  });

  it('starts in recovery mode on a corrupt database, then restores from a backup on the Master PC only', async () => {
    const good = fs.mkdtempSync(path.join(os.tmpdir(), 'pickle-good-'));
    const gs = await boot(good, () => at('2026-10-30', '12:00'));
    await new Client({ ...gs } as unknown as TestEnv, '127.0.0.1').post('/api/v1/setup', { username: 'owner', displayName: 'Owner', password: 'owner-pass-1', courtCount: 5 });
    const bak = await createBackup(gs.ctx, 'manual');
    const bakPath = path.join(good, 'backups', bak.fileName);
    await gs.close();

    const bad = fs.mkdtempSync(path.join(os.tmpdir(), 'pickle-bad-'));
    fs.writeFileSync(path.join(bad, 'pickle.db'), Buffer.alloc(8192, 7));
    fs.mkdirSync(path.join(bad, 'backups'));
    fs.copyFileSync(bakPath, path.join(bad, 'backups', bak.fileName));
    const rs = await boot(bad, () => at('2026-10-30', '12:00'));
    const lan = new Client({ ...rs } as unknown as TestEnv, '10.0.0.5'); const local = new Client({ ...rs } as unknown as TestEnv, '127.0.0.1');
    expect((await lan.get('health')).body).toMatchObject({ status: 'recovery', db: 'corrupt' });
    expect((await local.get('courts')).status).toBe(503);
    expect((await lan.get('backups')).status).toBe(503); // not from the LAN
    expect((await local.get('backups')).body.map((b: any) => b.fileName)).toEqual([bak.fileName]);
    expect((await local.post(`backups/${bak.fileName}/restore`, {})).status).toBe(202);
    expect((await local.get('health')).body.status).toBe('ok');
    expect((await local.login('owner', 'owner-pass-1')).status).toBe(200);
    expect((await local.get('courts')).body).toHaveLength(5);
    expect(fs.readdirSync(bad).some((f) => f.startsWith('pickle.corrupt-'))).toBe(true); // the damaged file was kept aside
    await rs.close();
    fs.rmSync(good, { recursive: true, force: true }); fs.rmSync(bad, { recursive: true, force: true });
  });

  it('refuses a backup made by a newer version and a file that is not a database', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pickle-up-'));
    const junk = path.join(dir, 'junk.db'); fs.writeFileSync(junk, 'not a database at all');
    const { restoreFrom } = await import('../src/backup');
    await expect(restoreFrom(env.ctx, junk, true)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('stops gracefully only for a loopback request carrying the secret', async () => {
    const secret = fs.readFileSync(path.join(env.dir, 'shutdown.secret'), 'utf8').trim();
    const lan = new Client(env, '10.0.0.5'); const local = new Client(env, '127.0.0.1');
    expect((await lan.post('/internal/shutdown', {}, { 'x-shutdown-secret': secret })).status).toBe(403);
    expect((await local.post('/internal/shutdown', {}, { 'x-shutdown-secret': 'wrong' })).status).toBe(403);
    expect((await local.get('health')).status).toBe(200);
  });
});
