import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { replay, type EngineEvent, type MatchConfig } from '@pickle/shared';
import { Client, at, cid, seedEnv, type TestEnv } from './helpers';
import { configOf, loadEvents, loadMatchRow, loadState } from '../src/snapshots';
import { runAutoConfirm } from '../src/jobs';

/** Phase 14: 24 courts, random play with duplicates / stale versions / undo / early ends, then invariants. */
let env: TestEnv; let admin: Client; const staff: Client[] = [];
beforeAll(async () => {
  const s = await seedEnv(24); env = s.env; admin = s.admin; staff.push(s.staff);
  for (let i = 0; i < 5; i++) { await admin.post('users', { username: `ref${i}`, displayName: `Ref ${i}`, password: 'ref-pass-123', mustChangePassword: false }); const c = new Client(env, `10.2.0.${i + 1}`); await c.login(`ref${i}`, 'ref-pass-123'); staff.push(c); }
});
afterAll(async () => { await env.destroy(); });

// small deterministic PRNG so failures are reproducible
let seed = 20261030; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)]!;

describe('24-court simulation (roadmap Phase 14)', () => {
  it('keeps every invariant under concurrent random play and measures latency', async () => {
    const lat: number[] = [];
    const timed = async <T,>(f: () => Promise<T>): Promise<T> => { const t = performance.now(); const r = await f(); lat.push(performance.now() - t); return r; };

    const play = async (court: number): Promise<void> => {
      const c = pick(staff);
      const playType = rnd() < 0.6 ? 'doubles' : 'singles';
      const cr = await c.post('matches', { courtId: court, playType, ruleOverrides: rnd() < 0.3 ? { pointsToWin: 7, winBy: 1 } : undefined });
      if (cr.status !== 201) throw new Error(`create ${cr.status} ${cr.raw}`);
      const id = cr.body.snapshot.match.id; let v = cr.body.snapshot.match.version;
      let r = await c.post(`matches/${id}/commands`, { commandId: cid(), expectedVersion: v, type: 'START_MATCH', payload: { servingTeam: pick(['A', 'B']) } });
      v = r.body.snapshot.match.version;
      const early = rnd() < 0.15;
      for (let i = 0; i < 400; i++) {
        const m = r.body.snapshot?.match; if (!m || m.status !== 'in_progress') break;
        const who = pick(staff); let body: any;
        if (m.phase === 'match_over') { env.advance(1000); body = { type: 'CONFIRM_MATCH_END', payload: {} }; }
        else if (m.phase === 'game_over') body = { type: 'START_NEXT_GAME', payload: { servingTeam: pick(['A', 'B']), swapDisplay: true } };
        else if (early && i > 15) body = { type: 'END_MATCH', payload: { reason: 'time_up', confirmed: true } };
        else if (rnd() < 0.07 && m.canUndo) body = { type: 'UNDO', payload: {} };
        else if (rnd() < 0.03) body = { type: 'PAUSE', payload: {} };
        else body = { type: 'RALLY_WON', payload: { team: rnd() < 0.55 ? 'A' : 'B' } };
        if (m.status === 'paused') body = { type: 'RESUME', payload: {} };
        const commandId = cid();
        const send = () => timed(() => who.post(`matches/${id}/commands`, { commandId, expectedVersion: v, ...body }));
        let res = await send();
        if (rnd() < 0.1) { const dup = await send(); expect(dup.body.duplicate ?? dup.status).toBeTruthy(); res = dup.status === 200 ? dup : res; } // retry with the same commandId
        if (rnd() < 0.05) { const stale = await who.post(`matches/${id}/commands`, { commandId: cid(), expectedVersion: v - 1, type: 'RALLY_WON', payload: { team: 'A' } }); expect(stale.status).toBe(409); }
        if (res.status === 200) { r = res; v = res.body.snapshot.match.version; }
        else if (res.status === 409) { r = { ...res, body: { snapshot: res.body.snapshot } } as never; v = res.body.snapshot.match.version; }
        else throw new Error(`unexpected ${res.status} ${res.raw}`);
        if (r.body.snapshot.match.status === 'paused') { const rr = await who.post(`matches/${id}/commands`, { commandId: cid(), expectedVersion: r.body.snapshot.match.version, type: 'RESUME', payload: {} }); r = rr; v = rr.body.snapshot.match.version; }
      }
    };

    const t0 = performance.now();
    await Promise.all(Array.from({ length: 24 }, (_, i) => play(i + 1))); // all 24 courts at once
    const wall = performance.now() - t0;
    runAutoConfirm(env.ctx);

    // ---- invariants ----
    const db = env.ctx.db;
    const rows = db.prepare('SELECT id FROM matches').all() as { id: number }[];
    expect(rows.length).toBe(24);
    for (const { id } of rows) {
      const m = loadMatchRow(env.ctx, id)!;
      const cfg: MatchConfig = configOf(m);
      const events: EngineEvent[] = loadEvents(env.ctx, id);
      // 1. replay of the event log equals the cached state
      expect(replay(cfg, events), `match ${id} replay`).toEqual(loadState(env.ctx, m));
      // 2. event seq is dense and equals the version
      expect(events.map((e) => e.seq)).toEqual(Array.from({ length: events.length }, (_, i) => i + 1));
      expect(m.version).toBe(events.length);
      // 3. an early-ended match never has a winner and keeps its timestamp + reason
      if (m.status === 'terminated') { expect(m.winner_team).toBeNull(); expect(m.ended_at).not.toBeNull(); expect(m.end_reason).toBe('time_up'); }
      if (m.status === 'completed') expect(m.winner_team).not.toBeNull();
      // 4. mirrored game rows match the engine state
      const st = loadState(env.ctx, m);
      const g = db.prepare('SELECT game_number n, score_a a, score_b b FROM match_games WHERE match_id = ? ORDER BY game_number').all(id) as { n: number; a: number; b: number }[];
      expect(g.map((x) => [x.a, x.b])).toEqual(st.games.map((x) => [x.score.A, x.score.B]));
    }
    // 5. at most one active match per court
    const dup = db.prepare("SELECT court_id, count(*) c FROM matches WHERE status IN ('setup','in_progress','paused') GROUP BY court_id HAVING c > 1").all();
    expect(dup).toEqual([]);
    // 6. events attributed to users only
    expect((db.prepare("SELECT count(*) c FROM match_events WHERE actor_type = 'user' AND actor_user_id IS NULL").get() as { c: number }).c).toBe(0);

    lat.sort((a, b) => a - b);
    const p = (q: number) => lat[Math.floor(lat.length * q)]!;
    console.log(`24 courts · ${lat.length} commands in ${(wall / 1000).toFixed(1)} s (${(lat.length / (wall / 1000)).toFixed(0)} cmd/s) · p50 ${p(0.5).toFixed(1)} ms · p95 ${p(0.95).toFixed(1)} ms · p99 ${p(0.99).toFixed(1)} ms`);
    expect(p(0.95)).toBeLessThan(150); // NFR-PERF-01
  });

  it('never double-books under concurrent booking pressure on all courts', async () => {
    env.setNow(at('2026-10-30', '12:00'));
    await admin.login('owner', 'owner-pass-1');
    const date = '2026-11-02';
    const attempts: Promise<number>[] = [];
    for (let c = 1; c <= 24; c++) for (let k = 0; k < 6; k++) {
      const start = 8 + Math.floor(rnd() * 8), len = 1 + Math.floor(rnd() * 2);
      attempts.push(admin.post('bookings', { courtId: c, startAt: at(date, `${String(start).padStart(2, '0')}:00`), endAt: at(date, `${String(start + len).padStart(2, '0')}:00`), bookedByName: `G${c}-${k}` }).then((r) => r.status));
    }
    const statuses = await Promise.all(attempts);
    expect(statuses.every((s) => s === 201 || s === 409)).toBe(true);
    const rows = env.ctx.db.prepare("SELECT court_id, start_at, end_at FROM bookings WHERE status = 'confirmed' ORDER BY court_id, start_at").all() as { court_id: number; start_at: number; end_at: number }[];
    for (let i = 1; i < rows.length; i++) if (rows[i]!.court_id === rows[i - 1]!.court_id) expect(rows[i]!.start_at).toBeGreaterThanOrEqual(rows[i - 1]!.end_at);
  });
});
