import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { MIGRATIONS } from '../src/db/migrations';
import { latestMigrationId, migrate } from '../src/db/client';

/** An existing facility's database (schema v1, with history and undo links) must upgrade without losing a single event. */
describe('migration 1 → 2 (Open Play)', () => {
  it('rebuilds match_events keeping ids, undo links and constraints, and adds the new tables', () => {
    const db = new Database(':memory:'); db.pragma('foreign_keys = ON');
    db.exec(MIGRATIONS[0]!.sql); db.pragma('user_version = 1');
    const T = 1_700_000_000_000;
    db.prepare("INSERT INTO users (id, username, display_name, password_hash, role, password_changed_at, created_at, updated_at) VALUES (1,'owner','Owner','h','admin',?,?,?)").run(T, T, T);
    db.prepare("INSERT INTO courts (id, name, short_code, created_at, updated_at) VALUES (1,'Court 1','1',?,?)").run(T, T);
    db.prepare(`INSERT INTO matches (id, match_code, court_id, format_name, play_type, scoring_type, serving_mode, points_to_win, win_by, games_to_win, first_server_rule, switch_ends_prompt,
      team_a_name, team_b_name, status, created_at, play_date, last_event_at, created_by_user_id, updated_at)
      VALUES (1,'261030-C1-001',1,'x','singles','side_out','auto',11,2,1,'start_server_2','deciding_game','Team A','Team B','cancelled',?, '2026-10-30', ?, 1, ?)`).run(T, T, T);
    const ev = db.prepare("INSERT INTO match_events (id, match_id, seq, command_id, type, payload_json, actor_type, actor_user_id, at, created_at) VALUES (?,?,?,?,?,'{}','user',1,?,?)");
    ev.run(10, 1, 1, 'c1-aaaaaaaaaaaaaaaa', 'MATCH_CREATED', T, T); ev.run(11, 1, 2, 'c2-aaaaaaaaaaaaaaaa', 'RALLY_WON', T, T); ev.run(12, 1, 3, 'c3-aaaaaaaaaaaaaaaa', 'UNDO', T, T);
    db.prepare('UPDATE match_events SET voided_by_event_id = 12 WHERE id = 11').run();
    db.prepare('UPDATE match_events SET undoes_event_id = 11 WHERE id = 12').run();

    let backedUp = 0;
    expect(migrate(db, () => { backedUp++; })).toEqual([2, 3]);
    expect(backedUp).toBe(1); // the pre-migration backup hook ran because the database had data
    expect(db.pragma('user_version', { simple: true })).toBe(latestMigrationId());
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1); // restored after the rebuild

    const rows = db.prepare('SELECT id, seq, type, voided_by_event_id v, undoes_event_id u FROM match_events ORDER BY id').all();
    expect(rows).toEqual([{ id: 10, seq: 1, type: 'MATCH_CREATED', v: null, u: null }, { id: 11, seq: 2, type: 'RALLY_WON', v: 12, u: null }, { id: 12, seq: 3, type: 'UNDO', v: null, u: 11 }]);

    // new event types are accepted, retired/invalid ones still rejected, uniqueness indexes survive
    const add = (seq: number, type: string, cmd: string) => db.prepare("INSERT INTO match_events (match_id, seq, command_id, type, payload_json, actor_type, at, created_at) VALUES (1,?,?,?,'{}','system',?,?)").run(seq, cmd, type, T, T);
    expect(() => add(4, 'TIME_UP', 'c4-aaaaaaaaaaaaaaaa')).not.toThrow();
    expect(() => add(5, 'RECORD_RESULT', 'c5-aaaaaaaaaaaaaaaa')).not.toThrow();
    expect(() => add(6, 'TERMINATE', 'c6-aaaaaaaaaaaaaaaa')).toThrow(/CHECK/);
    expect(() => add(4, 'TIME_UP', 'c7-aaaaaaaaaaaaaaaa')).toThrow(/UNIQUE/);
    expect(() => add(8, 'TIME_UP', 'c4-aaaaaaaaaaaaaaaa')).toThrow(/UNIQUE/);

    for (const t of ['open_play_sessions', 'open_play_courts', 'open_play_players', 'open_play_rounds', 'open_play_games', 'open_play_game_players'])
      expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(t), t).toBeTruthy();
    expect((db.prepare("SELECT count(*) c FROM pragma_table_info('matches') WHERE name = 'open_play_round_id'").get() as { c: number }).c).toBe(1);
  });

  it('is a no-op on an up-to-date database and creates a fresh one directly at the latest version', () => {
    const fresh = new Database(':memory:');
    expect(migrate(fresh)).toEqual([1, 2, 3]);
    expect(migrate(fresh)).toEqual([]);
  });
});
