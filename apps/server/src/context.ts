import type { Logger } from 'pino';
import {
  DEFAULT_SETTINGS, PUBLIC_SETTING_KEYS, MAX_ACTIVE_COURTS, settingsSchema, type PublicSettings, type Settings,
} from '@pickle/shared';
import type { Config } from './config';
import type { Db } from './db/client';
import { randomToken } from './lib/crypto';

export interface Publisher {
  publishCourt(courtId: number): void;
  invalidate(keys: string[]): void;
  activity(a: { kind: string; courtId?: number; matchId?: number; text: string }): void;
  bookingChanged(p: { bookingId: number; courtId: number; playDate: string; change: string }): void;
  settingsUpdated(): void;
  alertsChanged(): void;
  terminalChanged(sessionId: string, courtId: number | null, reason: 'replaced' | 'unassigned' | 'signed_out'): void;
  disconnectUser(userId: number): void;
  disconnectSession(sessionId: string): void;
  deviceStatus(courtId: number): void;
  isSessionOnline(sessionId: string): boolean;
  /** re-evaluate the rooms of a session's sockets (after a court assignment change) */
  refreshSession(sessionId: string): void;
  broadcast(event: string, payload?: unknown): void;
  /** socket count, for diagnostics */
  socketCount(): number;
}

export const noopPublisher: Publisher = {
  publishCourt() {}, invalidate() {}, activity() {}, bookingChanged() {}, settingsUpdated() {}, alertsChanged() {},
  terminalChanged() {}, disconnectUser() {}, disconnectSession() {}, deviceStatus() {}, isSessionOnline: () => false, refreshSession() {},
  broadcast() {}, socketCount: () => 0,
};

export class Ctx {
  /** Replaceable on restore */
  db: Db;
  pub: Publisher = noopPublisher;
  /** set by the Open Play module: called after any command on a match that belongs to a session */
  onMatchChanged?: (matchId: number) => void;
  readonly instanceId = randomToken(9);
  dbGeneration = 1;
  maintenanceGate = false;
  recovery: { corrupt: boolean; detail?: string } | null = null;
  readonly timeZone: string;
  private settingsCache: Settings | null = null;
  clock: () => number;
  snapshotSeq = 0;
  activityLog: { at: number; kind: string; courtId?: number; matchId?: number; text: string }[] = [];
  backupState: { lastAt: number | null; extraError: string | null } = { lastAt: null, extraError: null };

  pushActivity(a: { kind: string; courtId?: number; matchId?: number; text: string }): void {
    this.activityLog.unshift({ at: this.now(), ...a });
    if (this.activityLog.length > 50) this.activityLog.length = 50;
  }

  constructor(public config: Config, db: Db, public log: Logger, opts: { clock?: () => number; timeZone?: string } = {}) {
    this.db = db;
    this.clock = opts.clock ?? Date.now;
    this.timeZone = opts.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  now(): number { return this.clock(); }

  settings(): Settings {
    if (this.settingsCache) return this.settingsCache;
    const rows = this.db.prepare('SELECT key, value_json FROM system_settings').all() as { key: string; value_json: string }[];
    const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    for (const r of rows) { try { merged[r.key] = JSON.parse(r.value_json); } catch { /* ignore bad row */ } }
    const parsed = settingsSchema.safeParse(merged);
    this.settingsCache = parsed.success ? parsed.data : { ...DEFAULT_SETTINGS };
    return this.settingsCache;
  }

  invalidateSettings(): void { this.settingsCache = null; }

  publicSettings(): PublicSettings {
    const s = this.settings();
    const out: Record<string, unknown> = {};
    for (const k of PUBLIC_SETTING_KEYS) out[k] = s[k];
    return { ...(out as Omit<PublicSettings, 'maxActiveCourts' | 'timeZone'>), maxActiveCourts: MAX_ACTIVE_COURTS, timeZone: this.timeZone };
  }

  /** Transaction helper with BEGIN IMMEDIATE semantics. */
  tx<T>(fn: () => T): T { return this.db.transaction(fn).immediate(); }
}
