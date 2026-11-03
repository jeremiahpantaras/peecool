import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { localDate, type Activity, type Alert, type DashboardDto, type Role } from '@pickle/shared';
import type { Ctx } from '../context';
import { openPlayAlerts } from './openplay';
import { buildCourtSnapshot } from '../snapshots';

export function lastBackupAt(ctx: Ctx): number | null {
  try {
    const dir = path.join(ctx.config.dataDir, 'backups');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.db'));
    return files.reduce<number | null>((m, f) => Math.max(m ?? 0, fs.statSync(path.join(dir, f)).mtimeMs), null);
  } catch { return ctx.backupState.lastAt; }
}

export function computeAlerts(ctx: Ctx, role: Role): Alert[] {
  const now = ctx.now();
  const st = ctx.settings();
  const alerts: Alert[] = [];
  const act = ctx.db.prepare(`SELECT m.id, m.court_id, m.status, m.last_event_at, m.started_at, m.paused_at, m.paused_total_ms, m.time_limit_minutes, m.needs_review, c.name court_name
    FROM matches m JOIN courts c ON c.id = m.court_id WHERE m.status IN ('setup','in_progress','paused')`).all() as
    { id: number; court_id: number; status: string; last_event_at: number; started_at: number | null; paused_at: number | null; paused_total_ms: number; time_limit_minutes: number | null; needs_review: number; court_name: string }[];
  for (const m of act) {
    const dev = ctx.db.prepare('SELECT id FROM user_sessions WHERE terminal_court_id = ?').get(m.court_id) as { id: string } | undefined;
    if (dev && !ctx.pub.isSessionOnline(dev.id) && m.status !== 'setup')
      alerts.push({ id: `dev-${m.court_id}`, level: 'danger', text: `${m.court_name}: the court's device is offline during a match`, courtId: m.court_id });
    if (m.status === 'in_progress' && m.started_at && m.time_limit_minutes) {
      const el = now - m.started_at - m.paused_total_ms;
      if (el > m.time_limit_minutes * 60_000) alerts.push({ id: `limit-${m.id}`, level: 'warning', text: `${m.court_name}: match exceeded its ${m.time_limit_minutes}-minute limit`, courtId: m.court_id });
    }
    if (m.status !== 'paused' && now - m.last_event_at > st.staleMatchMinutes * 60_000)
      alerts.push({ id: `stale-${m.id}`, level: 'warning', text: `${m.court_name}: no activity for ${Math.round((now - m.last_event_at) / 60000)} min`, courtId: m.court_id });
    if (m.needs_review) alerts.push({ id: `review-${m.id}`, level: 'warning', text: `${m.court_name}: match left running from before a restart — check and end it`, courtId: m.court_id });
  }
  // booking started but nobody playing (informational)
  const late = ctx.db.prepare(`SELECT b.id, b.court_id, b.booked_by_name, c.name court_name FROM bookings b JOIN courts c ON c.id = b.court_id
    WHERE b.status = 'confirmed' AND b.start_at <= ? AND b.end_at > ? AND c.is_active = 1
      AND NOT EXISTS (SELECT 1 FROM matches m WHERE m.court_id = b.court_id AND m.status IN ('setup','in_progress','paused'))
      AND NOT EXISTS (SELECT 1 FROM matches m WHERE m.court_id = b.court_id AND m.booking_id = b.id AND m.status <> 'cancelled')`).all(now - 10 * 60_000, now) as { id: number; court_id: number; booked_by_name: string; court_name: string }[];
  for (const b of late) alerts.push({ id: `booking-${b.id}`, level: 'info', text: `${b.court_name}: ${b.booked_by_name}'s booking started but no match is running`, courtId: b.court_id });
  alerts.push(...openPlayAlerts(ctx));
  if (role === 'admin') {
    const lb = lastBackupAt(ctx);
    if (lb == null || now - lb > 26 * 3600_000) alerts.push({ id: 'backup-old', level: 'warning', text: lb == null ? 'No backup has been made yet' : 'The last backup is more than 26 hours old', adminOnly: true });
    if (ctx.backupState.extraError) alerts.push({ id: 'backup-extra', level: 'warning', text: `Copy to the extra backup location failed: ${ctx.backupState.extraError}`, adminOnly: true });
  }
  return alerts;
}

export function registerDashboardRoutes(app: FastifyInstance, ctx: Ctx): void {
  app.get('/api/v1/dashboard', { config: { perm: 'dashboard.view' } }, async (req): Promise<DashboardDto> => {
    const now = ctx.now();
    const today = localDate(now, ctx.timeZone);
    const ids = ctx.db.prepare('SELECT id FROM courts WHERE is_active = 1 ORDER BY display_order, id').all() as { id: number }[];
    const courts = ids.map((r) => buildCourtSnapshot(ctx, r.id, { deviceDetails: req.auth!.user.role === 'admin' })!);
    const count = (sql: string, ...a: unknown[]) => (ctx.db.prepare(sql).get(...a) as { c: number }).c;
    const nb = ctx.db.prepare(`SELECT b.start_at, b.booked_by_name, c.name court_name FROM bookings b JOIN courts c ON c.id = b.court_id
      WHERE b.status = 'confirmed' AND b.start_at > ? AND c.is_active = 1 ORDER BY b.start_at LIMIT 1`).get(now) as { start_at: number; booked_by_name: string; court_name: string } | undefined;
    const devices = courts.filter((c) => c.court.device);
    const activity: Activity[] = ctx.activityLog.slice(0, 20);
    return {
      kpis: {
        totalCourts: courts.length,
        availableCourts: courts.filter((c) => c.court.status === 'available').length,
        activeMatches: count("SELECT count(*) c FROM matches WHERE status IN ('setup','in_progress','paused')"),
        completedToday: count("SELECT count(*) c FROM matches WHERE play_date = ? AND status = 'completed'", today),
        matchesToday: count("SELECT count(*) c FROM matches WHERE play_date = ? AND status IN ('in_progress','paused','completed','terminated')", today),
        bookingsToday: count("SELECT count(*) c FROM bookings WHERE play_date = ? AND status = 'confirmed'", today),
        nextBooking: nb ? { courtName: nb.court_name, startAt: nb.start_at, bookedByName: nb.booked_by_name } : null,
        devicesOnline: devices.filter((c) => c.court.device?.online).length, devicesTotal: devices.length,
      },
      courts, recentActivity: activity, alerts: computeAlerts(ctx, req.auth!.user.role),
    };
  });
}
