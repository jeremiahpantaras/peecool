import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { MIGRATIONS } from './migrations';
import { SEED_PRESETS } from '@pickle/shared';

export type Db = Database.Database;

export function openDb(file: string): Db {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

export function latestMigrationId(): number { return MIGRATIONS[MIGRATIONS.length - 1]!.id; }

export function currentSchemaVersion(db: Db): number {
  return db.pragma('user_version', { simple: true }) as number;
}

/** Applies pending migrations in order; returns the ids applied. `beforeMigrate` runs only if something is pending. */
export function migrate(db: Db, beforeMigrate?: () => void): number[] {
  const current = currentSchemaVersion(db);
  const pending = MIGRATIONS.filter((m) => m.id > current);
  if (!pending.length) return [];
  const hasData = db.prepare("SELECT count(*) c FROM sqlite_master WHERE type='table'").get() as { c: number };
  if (hasData.c > 0) beforeMigrate?.();
  const applied: number[] = [];
  for (const m of pending) {
    if (m.foreignKeysOff) db.pragma('foreign_keys = OFF'); // must be set outside the transaction
    try {
      db.transaction(() => {
        db.exec(m.sql);
        if (m.foreignKeysOff) {
          const bad = db.pragma('foreign_key_check') as unknown[];
          if (bad.length) throw new Error(`migration ${m.id} left ${bad.length} foreign-key violation(s)`);
        }
        db.pragma(`user_version = ${m.id}`);
      })();
    } finally { if (m.foreignKeysOff) db.pragma('foreign_keys = ON'); }
    applied.push(m.id);
  }
  return applied;
}

/** Seeds the six rule presets if none exist (first start only). */
export function seedPresets(db: Db, now: number): void {
  const n = (db.prepare('SELECT count(*) c FROM match_formats').get() as { c: number }).c;
  if (n > 0) return;
  const ins = db.prepare(`INSERT INTO match_formats (name, scoring_type, serving_mode, points_to_win, win_by, point_cap, games_to_win,
    deciding_game_points, first_server_rule, switch_ends_prompt, time_limit_minutes, track_server_names, is_default, is_active, display_order, created_at, updated_at)
    VALUES (@name,@scoring_type,@serving_mode,@points_to_win,@win_by,@point_cap,@games_to_win,@deciding,@first,@switch,@limit,@track,@is_default,1,@ord,@now,@now)`);
  db.transaction(() => {
    SEED_PRESETS.forEach((p, i) => ins.run({
      name: p.name, scoring_type: p.rules.scoringType, serving_mode: p.rules.servingMode, points_to_win: p.rules.pointsToWin,
      win_by: p.rules.winBy, point_cap: p.rules.pointCap, games_to_win: p.rules.gamesToWin, deciding: p.rules.decidingGamePoints,
      first: p.rules.firstServerRule, switch: p.rules.switchEndsPrompt, limit: p.rules.timeLimitMinutes,
      track: p.rules.trackServerNames ? 1 : 0, is_default: p.isDefault ? 1 : 0, ord: i, now,
    }));
  })();
}
