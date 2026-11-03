import type { FastifyInstance } from 'fastify';
import { addDays, hhmmToMinutes, isoWeekday, localDate } from '@pickle/shared';
import type { Ctx } from '../context';
import { E } from '../lib/errors';
import { toCsv } from '../lib/csv';
import { playerIndex } from './players';

interface Range { from: string; to: string }

function range(ctx: Ctx, q: Record<string, string | undefined>): Range {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const today = localDate(ctx.now(), ctx.timeZone);
  const from = q.from && re.test(q.from) ? q.from : today;
  const to = q.to && re.test(q.to) ? q.to : from;
  if (to < from) throw E.validation('The end date is before the start date');
  return { from, to };
}

function daysIn(r: Range): string[] { const out: string[] = []; for (let d = r.from; d <= r.to && out.length < 4000; d = addDays(d, 1)) out.push(d); return out; }

function operatingMinutes(ctx: Ctx, r: Range): number {
  let total = 0;
  for (const d of daysIn(r)) {
    const h = ctx.settings().operatingHours[String(isoWeekday(d)) as '1'];
    if (h) total += Math.max(0, hhmmToMinutes(h.close) - hhmmToMinutes(h.open));
  }
  return total;
}

interface M { id: number; court_id: number; court_name: string; court_active: number; play_type: string; status: string; format_name: string; started_at: number; ended_at: number | null; paused_total_ms: number; play_date: string; winner_team: string | null; games_won_a: number; games_won_b: number }

function matchesIn(ctx: Ctx, r: Range, courtId?: number): M[] {
  const now = ctx.now();
  const rows = ctx.db.prepare(`SELECT m.id, m.court_id, c.name court_name, c.is_active court_active, m.play_type, m.status, m.format_name, m.started_at, m.ended_at, m.paused_total_ms, m.play_date, m.winner_team, m.games_won_a, m.games_won_b
    FROM matches m JOIN courts c ON c.id = m.court_id WHERE m.play_date BETWEEN ? AND ? AND m.started_at IS NOT NULL AND m.status IN ('in_progress','paused','completed','terminated') ${courtId ? 'AND m.court_id = ?' : ''}`)
    .all(...(courtId ? [r.from, r.to, courtId] : [r.from, r.to])) as M[];
  return rows.map((m) => ({ ...m, ended_at: m.ended_at ?? now }));
}

const occupied = (m: M) => Math.max(0, m.ended_at! - m.started_at);
const playing = (m: M) => Math.max(0, occupied(m) - m.paused_total_ms);
const minutes = (ms: number) => Math.round((ms / 60000) * 10) / 10;

function periodKey(date: string, g: string): string {
  if (g === 'month') return date.slice(0, 7);
  if (g === 'week') { const wd = isoWeekday(date); return addDays(date, -(wd - 1)); }
  return date;
}

export function buildReport(ctx: Ctx, name: string, q: Record<string, string | undefined>): any {
  const r = range(ctx, q);
  const courtId = q.courtId ? Number(q.courtId) : undefined;
  switch (name) {
    case 'volume': {
      const g = q.groupBy === 'week' || q.groupBy === 'month' ? q.groupBy : 'day';
      const map = new Map<string, { period: string; completed: number; endedEarly: number; singles: number; doubles: number }>();
      for (const m of matchesIn(ctx, r, courtId)) {
        if (m.status === 'in_progress' || m.status === 'paused') continue;
        const k = periodKey(m.play_date, g);
        const row = map.get(k) ?? { period: k, completed: 0, endedEarly: 0, singles: 0, doubles: 0 };
        if (m.status === 'completed') row.completed++; else row.endedEarly++;
        if (m.play_type === 'singles') row.singles++; else row.doubles++;
        map.set(k, row);
      }
      return { rows: [...map.values()].sort((a, b) => a.period.localeCompare(b.period)) };
    }
    case 'utilization': {
      const opMin = operatingMinutes(ctx, r);
      const courts = ctx.db.prepare('SELECT id, name, is_active FROM courts ORDER BY display_order, id').all() as { id: number; name: string; is_active: number }[];
      const ms = matchesIn(ctx, r, courtId);
      const rows = courts.filter((c) => !courtId || c.id === courtId).map((c) => {
        const mine = ms.filter((m) => m.court_id === c.id);
        const occ = mine.reduce((s, m) => s + occupied(m), 0); const pl = mine.reduce((s, m) => s + playing(m), 0);
        return { courtId: c.id, courtName: c.name, courtActive: !!c.is_active, matches: mine.length, occupiedMinutes: minutes(occ), playingMinutes: minutes(pl), operatingMinutes: opMin, utilizationPct: opMin ? Math.round((occ / 60000 / opMin) * 1000) / 10 : 0, _active: c.is_active, _has: mine.length };
      }).filter((x) => x._active || x._has).map(({ _active, _has, ...x }) => x);
      const tOcc = rows.reduce((s, x) => s + x.occupiedMinutes, 0); const tPl = rows.reduce((s, x) => s + x.playingMinutes, 0);
      const activeCourts = rows.filter((x) => x.courtActive).length || 1;
      return { rows, total: { matches: rows.reduce((s, x) => s + x.matches, 0), occupiedMinutes: Math.round(tOcc * 10) / 10, playingMinutes: Math.round(tPl * 10) / 10, operatingMinutes: opMin * activeCourts, utilizationPct: opMin ? Math.round((tOcc / (opMin * activeCourts)) * 1000) / 10 : 0 } };
    }
    case 'durations': {
      const ms = matchesIn(ctx, r, courtId).filter((m) => m.status === 'completed' || m.status === 'terminated');
      const filt = ms.filter((m) => (!q.playType || m.play_type === q.playType));
      const stat = (xs: number[]) => {
        if (!xs.length) return { avg: 0, median: 0, min: 0, max: 0, count: 0 };
        const s = [...xs].sort((a, b) => a - b); const mid = s.length >> 1;
        return { avg: minutes(s.reduce((a, b) => a + b, 0) / s.length), median: minutes(s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2), min: minutes(s[0]!), max: minutes(s.at(-1)!), count: s.length };
      };
      const by = (key: (m: M) => string) => { const mp = new Map<string, number[]>(); for (const m of filt) { const k = key(m); (mp.get(k) ?? mp.set(k, []).get(k)!).push(playing(m)); } return [...mp.entries()].map(([k, v]) => ({ key: k, ...stat(v) })); };
      const bins = [15, 30, 45, 60]; const labels = ['≤ 15', '15–30', '30–45', '45–60', '> 60'];
      const hist = labels.map((l) => ({ bucket: l, count: 0 }));
      for (const m of filt) { const mm = playing(m) / 60000; hist[mm <= bins[0]! ? 0 : mm <= bins[1]! ? 1 : mm <= bins[2]! ? 2 : mm <= bins[3]! ? 3 : 4]!.count++; }
      const g = ctx.db.prepare(`SELECT avg(g.ended_at - g.started_at) a FROM match_games g JOIN matches m ON m.id = g.match_id WHERE m.play_date BETWEEN ? AND ? AND g.status = 'completed'`).get(r.from, r.to) as { a: number | null };
      return { overall: stat(filt.map(playing)), byFormat: by((m) => m.format_name), byCourt: by((m) => m.court_name), byPlayType: by((m) => m.play_type), histogram: hist, avgGameMinutes: g.a ? minutes(g.a) : 0 };
    }
    case 'peak-hours': {
      const sums = new Map<string, number>();
      for (const m of matchesIn(ctx, r, courtId)) {
        let t = m.started_at; const end = m.ended_at!;
        while (t < end) {
          const d = new Date(t); const hourEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime();
          const slice = Math.min(end, hourEnd) - t;
          const wd = d.getDay() === 0 ? 7 : d.getDay(); const key = `${wd}-${d.getHours()}`;
          sums.set(key, (sums.get(key) ?? 0) + slice / 3600000);
          t = Math.min(end, hourEnd);
        }
      }
      const counts = new Map<number, number>(); for (const d of daysIn(r)) counts.set(isoWeekday(d), (counts.get(isoWeekday(d)) ?? 0) + 1);
      const cells = [...sums.entries()].map(([k, v]) => { const [wd, hr] = k.split('-').map(Number) as [number, number]; return { weekday: wd, hour: hr, avgOccupiedCourts: Math.round((v / (counts.get(wd) ?? 1)) * 100) / 100 }; });
      return { cells };
    }
    case 'players': {
      const items = playerIndex(ctx, r).filter((i) => i.matches > 0 || i.lastPlayedAt != null);
      return { rows: items.sort((a, b) => b.matches - a.matches || a.name.localeCompare(b.name)) };
    }
    case 'turnover': {
      const ms = matchesIn(ctx, r, courtId).filter((m) => m.status === 'completed' || m.status === 'terminated').sort((a, b) => a.started_at - b.started_at);
      const byCourt = new Map<number, M[]>(); for (const m of ms) (byCourt.get(m.court_id) ?? byCourt.set(m.court_id, []).get(m.court_id)!).push(m);
      const rows = [...byCourt.entries()].map(([cid, list]) => {
        const gaps: number[] = [];
        for (let i = 1; i < list.length; i++) if (list[i]!.play_date === list[i - 1]!.play_date) { const gap = list[i]!.started_at - list[i - 1]!.ended_at!; if (gap >= 0) gaps.push(gap); }
        return { courtId: cid, courtName: list[0]!.court_name, matches: list.length, avgGapMinutes: gaps.length ? minutes(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null };
      });
      return { rows };
    }
    case 'bookings': {
      const opMin = operatingMinutes(ctx, r);
      const courts = ctx.db.prepare('SELECT id, name, is_active FROM courts ORDER BY display_order, id').all() as { id: number; name: string; is_active: number }[];
      const bs = ctx.db.prepare(`SELECT id, court_id, start_at, end_at, status, (SELECT count(*) FROM matches m WHERE m.booking_id = bookings.id) linked FROM bookings WHERE play_date BETWEEN ? AND ?`).all(r.from, r.to) as { id: number; court_id: number; start_at: number; end_at: number; status: string; linked: number }[];
      const now = ctx.now();
      const rows = courts.filter((c) => !courtId || c.id === courtId).map((c) => {
        const mine = bs.filter((b) => b.court_id === c.id);
        const conf = mine.filter((b) => b.status === 'confirmed');
        const booked = conf.reduce((s, b) => s + (b.end_at - b.start_at), 0) / 60000;
        const past = conf.filter((b) => b.end_at <= now);
        return { courtId: c.id, courtName: c.name, bookings: conf.length, bookedMinutes: Math.round(booked), operatingMinutes: opMin, bookedPct: opMin ? Math.round((booked / opMin) * 1000) / 10 : 0,
          cancelled: mine.filter((b) => b.status === 'cancelled').length, noShow: mine.filter((b) => b.status === 'no_show').length,
          playedPct: past.length ? Math.round((past.filter((b) => b.linked > 0).length / past.length) * 100) : null, _show: c.is_active || mine.length };
      }).filter((x) => x._show).map(({ _show, ...x }) => x);
      return { rows };
    }
    default: throw E.notFound('Unknown report');
  }
}

function csvOf(name: string, data: any): string {
  switch (name) {
    case 'volume': return toCsv(['Period', 'Completed', 'Ended early', 'Singles', 'Doubles'], data.rows.map((r: any) => [r.period, r.completed, r.endedEarly, r.singles, r.doubles]));
    case 'utilization': return toCsv(['Court', 'Active', 'Matches', 'Occupied min', 'Playing min', 'Operating min', 'Utilization %'], data.rows.map((r: any) => [r.courtName, r.courtActive ? 'yes' : 'no', r.matches, r.occupiedMinutes, r.playingMinutes, r.operatingMinutes, r.utilizationPct]));
    case 'durations': return toCsv(['Group', 'Key', 'Matches', 'Avg min', 'Median min', 'Min', 'Max'], [['overall', '', data.overall.count, data.overall.avg, data.overall.median, data.overall.min, data.overall.max],
      ...['byFormat', 'byCourt', 'byPlayType'].flatMap((g) => data[g].map((r: any) => [g, r.key, r.count, r.avg, r.median, r.min, r.max]))]);
    case 'peak-hours': return toCsv(['Weekday (1=Mon)', 'Hour', 'Avg occupied courts'], data.cells.map((c: any) => [c.weekday, c.hour, c.avgOccupiedCourts]));
    case 'players': return toCsv(['Name', 'Type', 'Matches', 'Wins', 'Losses', 'Last played'], data.rows.map((r: any) => [r.name, r.kind, r.matches, r.wins, r.losses, r.lastPlayedAt ? new Date(r.lastPlayedAt).toISOString() : '']));
    case 'turnover': return toCsv(['Court', 'Matches', 'Avg gap min'], data.rows.map((r: any) => [r.courtName, r.matches, r.avgGapMinutes]));
    case 'bookings': return toCsv(['Court', 'Bookings', 'Booked min', 'Operating min', 'Booked %', 'Cancelled', 'No-show', 'Played %'], data.rows.map((r: any) => [r.courtName, r.bookings, r.bookedMinutes, r.operatingMinutes, r.bookedPct, r.cancelled, r.noShow, r.playedPct]));
    default: return '';
  }
}

export function registerReportRoutes(app: FastifyInstance, ctx: Ctx): void {
  for (const name of ['volume', 'utilization', 'durations', 'peak-hours', 'players', 'turnover', 'bookings'])
    app.get(`/api/v1/reports/${name}`, { config: { perm: 'reports.view' } }, async (req) => buildReport(ctx, name, req.query as Record<string, string>));
  app.get('/api/v1/reports/:name.csv', { config: { perm: 'reports.csv' } }, async (req, reply) => {
    const name = (req.params as { name: string }).name;
    const data = buildReport(ctx, name, req.query as Record<string, string>);
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${name}.csv"`);
    return csvOf(name, data);
  });
}
