import { localDate, hhmmToMinutes, minutesOfDay } from '@pickle/shared';
import type { Ctx } from './context';
import { AppError } from './lib/errors';
import { randomToken } from './lib/crypto';
import { runCommand } from './modules/matches';
import { computeAlerts } from './modules/dashboard';
import { courtStatusOf, OPEN_PLAY_CONFIRM_MS, type CourtRow } from './snapshots';
import { createBackup, todayHasScheduledBackup } from './backup';
import { runOpenPlayTick } from './modules/openplay';

const sysId = (p: string) => `sys-${p}-${randomToken(10)}`;

/** FR-MATCH-07: confirm results nobody confirmed. Uses the version it read, so a concurrent Undo wins. */
export function runAutoConfirm(ctx: Ctx): number {
  const due = ctx.db.prepare(`SELECT id, version FROM matches WHERE status = 'in_progress' AND phase = 'match_over'
      AND phase_changed_at + (CASE WHEN open_play_round_id IS NOT NULL THEN ? ELSE ? END) <= ?`)
    .all(OPEN_PLAY_CONFIRM_MS, ctx.settings().autoConfirmSeconds * 1000, ctx.now()) as { id: number; version: number }[];
  let n = 0;
  for (const m of due) {
    try { runCommand(ctx, m.id, 'system', { commandId: sysId('confirm'), expectedVersion: m.version, type: 'CONFIRM_MATCH_END', payload: {} }); n++; }
    catch (e) { if (!(e instanceof AppError) || !['VERSION_CONFLICT', 'INVALID_STATE'].includes(e.code)) ctx.log.error({ err: e }, 'auto-confirm failed'); }
  }
  return n;
}

/** Flag matches left running across a restart (FR-DASH-05 d). */
export function runStartupReview(ctx: Ctx): number {
  const stale = ctx.settings().staleMatchMinutes * 60_000;
  const r = ctx.db.prepare("UPDATE matches SET needs_review = 1 WHERE status IN ('in_progress','paused') AND last_event_at < ? AND needs_review = 0").run(ctx.now() - stale);
  return r.changes;
}

export function runCleanup(ctx: Ctx): number {
  return ctx.db.prepare('DELETE FROM user_sessions WHERE expires_at <= ?').run(ctx.now()).changes;
}

const lastStatus = new Map<number, string>();
/** Status derivation is time-based; re-publish courts whose derived status changed without an event. */
export function runCourtRelease(ctx: Ctx): void {
  const courts = ctx.db.prepare('SELECT * FROM courts WHERE is_active = 1').all() as CourtRow[];
  for (const c of courts) {
    const s = courtStatusOf(ctx, c).status;
    const prev = lastStatus.get(c.id);
    lastStatus.set(c.id, s);
    if (prev && prev !== s) ctx.pub.publishCourt(c.id);
  }
}

const lastBoundary = { at: 0 };
export function runBookingWatch(ctx: Ctx): void {
  const now = ctx.now();
  const from = lastBoundary.at || now - 60_000;
  const rows = ctx.db.prepare("SELECT DISTINCT court_id FROM bookings WHERE status = 'confirmed' AND ((start_at > ? AND start_at <= ?) OR (end_at > ? AND end_at <= ?))").all(from, now, from, now) as { court_id: number }[];
  for (const r of rows) ctx.pub.publishCourt(r.court_id);
  lastBoundary.at = now;
}

export async function runDailyBackup(ctx: Ctx): Promise<boolean> {
  const st = ctx.settings();
  if (minutesOfDay(ctx.now(), ctx.timeZone) < hhmmToMinutes(st.backupTime)) return false;
  if (todayHasScheduledBackup(ctx)) return false;
  await createBackup(ctx, 'scheduled');
  void localDate;
  return true;
}

export function startJobs(ctx: Ctx): () => void {
  const wrap = (name: string, fn: () => unknown | Promise<unknown>) => async () => {
    try { await fn(); } catch (e) { ctx.log.error({ err: e, job: name }, 'job failed'); }
  };
  const timers = [
    setInterval(wrap('autoConfirm', () => runAutoConfirm(ctx)), 5_000),
    setInterval(wrap('openPlay', () => runOpenPlayTick(ctx)), 1_000),
    setInterval(wrap('courtRelease', () => runCourtRelease(ctx)), 15_000),
    setInterval(wrap('bookingWatch', () => runBookingWatch(ctx)), 60_000),
    setInterval(wrap('alerts', () => ctx.pub.alertsChanged()), 30_000),
    setInterval(wrap('cleanup', () => runCleanup(ctx)), 15 * 60_000),
    setInterval(wrap('dailyBackup', () => runDailyBackup(ctx)), 60_000),
  ];
  timers.forEach((t) => t.unref());
  return () => timers.forEach(clearInterval);
}

export { computeAlerts };
