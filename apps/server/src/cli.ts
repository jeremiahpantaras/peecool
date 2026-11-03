import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { addDays, localDate, zonedToEpoch } from '@pickle/shared';
import { loadConfig, lanAddresses } from './config';
import { openDb, migrate, seedPresets } from './db/client';
import { hashPassword } from './lib/crypto';
import { createServer } from './server';

const [, , cmd, ...args] = process.argv;
const flag = (name: string): string | undefined => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };

function usage(): never {
  console.log(`Pickle Scoring tools
  stop                                    stop the service gracefully (used by the Windows service wrapper)
  print-urls                              show the URLs and a QR code for phones/tablets
  reset-admin-password <username> [--password <new>]   reset an Admin password (run on the Master PC)
  backup                                  make a backup now (works while the service runs)
  restore <backup-file>                   restore a backup (stop the service first)
  seed-demo [--days 60] [--courts 8]      create demo data in an EMPTY database
  rebuild-match <id>                      rebuild a match's cached state from its events`);
  process.exit(cmd ? 1 : 0);
}

async function main(): Promise<void> {
  const config = loadConfig();
  switch (cmd) {
    case 'stop': {
      const secret = fs.readFileSync(path.join(config.dataDir, 'shutdown.secret'), 'utf8').trim();
      const res = await fetch(`http://127.0.0.1:${config.port}/internal/shutdown`, { method: 'POST', headers: { 'x-shutdown-secret': secret, 'x-pickle-client': '1' } }).catch(() => null);
      if (!res || !res.ok) { console.error('The service did not accept the stop request (is it running?)'); process.exit(1); }
      for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 250)); if (!fs.existsSync(path.join(config.dataDir, 'shutdown.secret'))) break; }
      console.log('Stopped.');
      return;
    }
    case 'print-urls': {
      const urls = lanAddresses().map((a) => `http://${a}:${config.port}`);
      const all = [`http://localhost:${config.port}`, ...urls];
      console.log('Open one of these in a browser on any device on the staff Wi-Fi:\n  ' + all.join('\n  '));
      if (urls[0]) console.log('\n' + (await QRCode.toString(urls[0], { type: 'terminal', small: true })));
      return;
    }
    case 'reset-admin-password': {
      const username = args.find((a) => !a.startsWith('--') && a !== flag('password'));
      if (!username) usage();
      const db = openDb(config.dbFile);
      const u = db.prepare("SELECT id, role FROM users WHERE username = ? AND role = 'admin'").get(username) as { id: number } | undefined;
      if (!u) { console.error(`No Admin named "${username}" was found.`); process.exit(1); }
      const pw = flag('password') ?? crypto.randomBytes(9).toString('base64url');
      const now = Date.now();
      db.prepare('UPDATE users SET password_hash = ?, password_changed_at = ?, must_change_password = 1, failed_login_count = 0, locked_until = NULL, is_active = 1, updated_at = ? WHERE id = ?').run(await hashPassword(pw), now, now, u.id);
      db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(u.id);
      db.prepare("INSERT INTO audit_logs (occurred_at, actor_type, action, entity_type, entity_id) VALUES (?, 'system', 'user.reset_password_cli', 'user', ?)").run(now, String(u.id));
      console.log(`Password for "${username}" is now: ${pw}\nYou will be asked to choose a new one at the next sign-in.`);
      return;
    }
    case 'backup': {
      const db = openDb(config.dbFile);
      const dir = path.join(config.dataDir, 'backups'); fs.mkdirSync(dir, { recursive: true });
      const d = new Date(); const p = (n: number) => String(n).padStart(2, '0');
      const file = path.join(dir, `pickle-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-manual.db`);
      await db.backup(file);
      console.log(`Backup written to ${file}`);
      return;
    }
    case 'restore': {
      const src = args[0];
      if (!src || !fs.existsSync(src)) usage();
      if (fs.existsSync(path.join(config.dataDir, 'shutdown.secret'))) { console.error('Stop the service before restoring (pickle-scoring stop).'); process.exit(1); }
      for (const ext of ['', '-wal', '-shm']) fs.rmSync(config.dbFile + ext, { force: true });
      fs.copyFileSync(src, config.dbFile);
      const db = openDb(config.dbFile); migrate(db); db.close();
      console.log('Restored. Start the service again.');
      return;
    }
    case 'rebuild-match': {
      const id = Number(args[0]);
      const db = openDb(config.dbFile);
      const { rebuildMatchState } = await import('./rebuild');
      rebuildMatchState(db, id);
      console.log(`Match ${id} rebuilt.`);
      return;
    }
    case 'seed-demo': return seedDemo(Number(flag('days') ?? 60), Number(flag('courts') ?? 8));
    default: usage();
  }
}

/** Drives the real API in-process with a stepped clock, so demo history is produced by the same pipeline as live play. */
async function seedDemo(days: number, courtCount: number): Promise<void> {
  const config = loadConfig();
  const probe = openDb(config.dbFile); migrate(probe); seedPresets(probe, Date.now());
  const existing = (probe.prepare('SELECT count(*) c FROM users').get() as { c: number }).c; probe.close();
  if (existing) { console.error('Refusing to seed: the database already has users.'); process.exit(1); }
  let now = Date.now() - days * 86400_000;
  const srv = await createServer({ clock: () => now, config: { fastHash: true } });
  const tz = srv.ctx.timeZone;
  let cookie = '';
  const call = async (method: string, url: string, body?: unknown) => {
    const r = await srv.app.inject({ method: method as 'GET', url: `/api/v1/${url}`, remoteAddress: '127.0.0.1', headers: { 'x-pickle-client': '1', 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, payload: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers['set-cookie']; if (sc) cookie = (Array.isArray(sc) ? sc[0]! : sc).split(';')[0]!;
    return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
  };
  await call('POST', 'setup', { username: 'admin', displayName: 'Demo Admin', password: 'admin-demo-1', facilityName: 'Demo Pickleball Club', courtCount });
  for (const [u, n] of [['maria', 'Maria'], ['sam', 'Sam']] as const) await call('POST', 'users', { username: u, displayName: n, password: 'staff-demo-1', role: 'staff', mustChangePassword: false });
  const names = ['Alex Rivera', 'Jordan Lee', 'Sam Patel', 'Riley Chen', 'Casey Kim', 'Taylor Nguyen', 'Morgan Diaz', 'Jamie Ortiz', 'Pat Brooks', 'Chris Lane'];
  const pids: number[] = [];
  for (const n of names.slice(0, 6)) pids.push((await call('POST', 'players', { displayName: n })).body.id);
  const presets = (await call('GET', 'formats')).body as { id: number }[];
  const rnd = (n: number) => Math.floor(Math.random() * n);
  let matches = 0, bookings = 0;
  for (let d = 0; d < days; d++) {
    const date = localDate(now, tz);
    await call('POST', 'auth/login', { username: d % 2 ? 'maria' : 'sam', password: 'staff-demo-1' });
    const per = 3 + rnd(6);
    for (let k = 0; k < per; k++) {
      now = zonedToEpoch(date, (8 + k * 2 + rnd(2)) * 60 + rnd(50), tz);
      const court = 1 + rnd(courtCount);
      const playType = rnd(3) ? 'doubles' : 'singles';
      const slots = (t: 'A' | 'B') => (playType === 'singles' ? [1] : [1, 2]).map((s) => rnd(3) === 0 ? { team: t, slot: s, displayName: rnd(2) ? names[6 + rnd(4)] : undefined } : { team: t, slot: s, playerId: pids[rnd(pids.length)] });
      const picked = [...slots('A'), ...slots('B')].filter((p, i, a) => !('playerId' in p) || a.findIndex((x: any) => x.playerId === (p as any).playerId) === i);
      const cr = await call('POST', 'matches', { courtId: court, playType, formatId: presets[rnd(2)]!.id, players: picked, acknowledgeBooking: true });
      if (cr.status !== 201) continue;
      const m = cr.body.snapshot.match; let v = m.version;
      let r = await call('POST', `matches/${m.id}/commands`, { commandId: crypto.randomBytes(12).toString('base64url'), expectedVersion: v, type: 'START_MATCH', payload: { servingTeam: 'A' } });
      v = r.body.snapshot.match.version;
      const early = rnd(10) === 0;
      for (let guard = 0; guard < 200; guard++) {
        const mm = r.body.snapshot.match;
        if (mm.phase === 'match_over' || mm.status !== 'in_progress') break;
        if (early && guard > 12) { r = await call('POST', `matches/${m.id}/commands`, { commandId: crypto.randomBytes(12).toString('base64url'), expectedVersion: v, type: 'END_MATCH', payload: { reason: 'time_up', confirmed: true } }); break; }
        now += (20 + rnd(25)) * 1000;
        const type = mm.phase === 'game_over' ? 'START_NEXT_GAME' : 'RALLY_WON';
        const payload = type === 'RALLY_WON' ? { team: rnd(100) < 55 ? 'A' : 'B' } : { servingTeam: 'B', swapDisplay: true };
        r = await call('POST', `matches/${m.id}/commands`, { commandId: crypto.randomBytes(12).toString('base64url'), expectedVersion: v, type, payload });
        if (r.status !== 200) break;
        v = r.body.snapshot.match.version;
      }
      if (r.body.snapshot?.match?.phase === 'match_over') { now += 20_000; await call('POST', `matches/${m.id}/commands`, { commandId: crypto.randomBytes(12).toString('base64url'), expectedVersion: v, type: 'CONFIRM_MATCH_END', payload: {} }); }
      matches++;
    }
  }
  // a week of bookings starting tomorrow
  now = Date.now();
  await call('POST', 'auth/login', { username: 'admin', password: 'admin-demo-1' });
  const today = localDate(now, tz);
  for (let d = 0; d < 7; d++) for (let c = 1; c <= courtCount; c++) for (const h of [17, 18, 19]) if (rnd(3) === 0) {
    const date = addDays(today, d + 1);
    const r = await call('POST', 'bookings', { courtId: c, startAt: zonedToEpoch(date, h * 60, tz), endAt: zonedToEpoch(date, (h + 1) * 60, tz), bookedByName: names[rnd(names.length)], playersCount: 4 });
    if (r.status === 201) bookings++;
  }
  now = Date.now();
  await srv.close();
  console.log(`Demo data created: ${courtCount} courts, 2 staff (maria, sam / staff-demo-1), admin (admin / admin-demo-1), ${matches} matches over ${days} days, ${bookings} bookings.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
