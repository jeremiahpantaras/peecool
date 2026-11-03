import type { FastifyInstance } from 'fastify';
import {
  addDays, bookingTimeState, cancelBookingSchema, createBookingSchema, formatBookingCode, hhmmToMinutes, idParam,
  isoWeekday, limitsFromSettings, localDate, patchBookingSchema, validateBookingTimes, zonedToEpoch, type BookingDto, type BookingStatus,
} from '@pickle/shared';
import type { Ctx } from '../context';
import { AppError, E } from '../lib/errors';
import { audit } from '../lib/audit';
import { actorOf } from '../auth';
import { toCsv } from '../lib/csv';

interface BookingRow {
  id: number; booking_code: string; court_id: number; start_at: number; end_at: number; play_date: string; booked_by_name: string;
  phone: string | null; players_count: number | null; notes: string | null; status: BookingStatus; cancel_reason: string | null;
  created_by_user_id: number; created_at: number; court_name: string; court_active: number; created_by: string;
}

const SELECT = `SELECT b.*, c.name AS court_name, c.is_active AS court_active, u.display_name AS created_by
  FROM bookings b JOIN courts c ON c.id = b.court_id JOIN users u ON u.id = b.created_by_user_id`;

function toDto(ctx: Ctx, r: BookingRow): BookingDto {
  return {
    id: r.id, code: r.booking_code, courtId: r.court_id, courtName: r.court_name, courtActive: !!r.court_active, startAt: r.start_at, endAt: r.end_at,
    playDate: r.play_date, bookedByName: r.booked_by_name, phone: r.phone, playersCount: r.players_count, notes: r.notes, status: r.status,
    timeState: bookingTimeState({ startAt: r.start_at, endAt: r.end_at }, ctx.now()), createdBy: r.created_by, createdAt: r.created_at, cancelReason: r.cancel_reason,
  };
}

export function bookingDtoById(ctx: Ctx, id: number): BookingDto {
  const r = ctx.db.prepare(`${SELECT} WHERE b.id = ?`).get(id) as BookingRow | undefined;
  if (!r) throw E.notFound('Booking not found', 'BOOKING_NOT_FOUND');
  return toDto(ctx, r);
}

export function futureBookingsForCourt(ctx: Ctx, courtId: number): { id: number }[] {
  return ctx.db.prepare("SELECT id FROM bookings WHERE court_id = ? AND status = 'confirmed' AND end_at > ? ORDER BY start_at").all(courtId, ctx.now()) as { id: number }[];
}

export function cancelBookingRows(ctx: Ctx, ids: number[], reason: string, userId: number): number[] {
  const now = ctx.now();
  const st = ctx.db.prepare("UPDATE bookings SET status = 'cancelled', cancel_reason = ?, cancelled_at = ?, cancelled_by_user_id = ?, updated_at = ?, updated_by_user_id = ? WHERE id = ? AND status = 'confirmed'");
  for (const id of ids) st.run(reason, now, userId, now, userId, id);
  return ids;
}

function conflictWith(ctx: Ctx, courtId: number, startAt: number, endAt: number, exceptId?: number): BookingDto | null {
  const r = ctx.db.prepare(`${SELECT} WHERE b.court_id = ? AND b.status = 'confirmed' AND b.start_at < ? AND b.end_at > ? AND b.id <> ? LIMIT 1`)
    .get(courtId, endAt, startAt, exceptId ?? -1) as BookingRow | undefined;
  return r ? toDto(ctx, r) : null;
}

function nextCode(ctx: Ctx, date: string): string {
  let seq = (ctx.db.prepare('SELECT count(*) c FROM bookings WHERE play_date = ?').get(date) as { c: number }).c + 1;
  for (;;) {
    const code = formatBookingCode(date, seq);
    if (!ctx.db.prepare('SELECT 1 FROM bookings WHERE booking_code = ?').get(code)) return code;
    seq++;
  }
}

function validateOrThrow(ctx: Ctx, courtId: number, startAt: number, endAt: number): void {
  const court = ctx.db.prepare('SELECT is_active FROM courts WHERE id = ?').get(courtId) as { is_active: number } | undefined;
  if (!court) throw E.notFound('Court not found', 'COURT_NOT_FOUND');
  if (!court.is_active) throw new AppError('BOOKING_INVALID', 422, 'That court is not in service', { reason: 'COURT_INACTIVE' });
  const reason = validateBookingTimes({ startAt, endAt }, limitsFromSettings(ctx.settings(), ctx.timeZone), ctx.now());
  if (reason) throw new AppError('BOOKING_INVALID', 422, bookingReasonText(reason), { reason });
}

export function bookingReasonText(r: string): string {
  return ({
    OUTSIDE_HOURS: 'The booking must be inside the facility\'s operating hours', TOO_LONG: 'The booking is longer than the allowed maximum',
    TOO_FAR_AHEAD: 'The booking is too far in the future', IN_PAST: 'The booking starts in the past', NOT_ON_SLOT: 'Times must fall on the slot grid',
    BAD_RANGE: 'The end time must be after the start time', SPANS_MIDNIGHT: 'A booking cannot span midnight', COURT_INACTIVE: 'That court is not in service',
  } as Record<string, string>)[r] ?? 'Invalid booking';
}

export function registerBookingRoutes(app: FastifyInstance, ctx: Ctx): void {
  const emit = (b: BookingDto, change: string) => {
    ctx.pub.bookingChanged({ bookingId: b.id, courtId: b.courtId, playDate: b.playDate, change });
    ctx.pub.invalidate(['bookings', 'dashboard']);
    ctx.pub.publishCourt(b.courtId);
  };

  app.get('/api/v1/bookings/schedule', { config: { perm: 'bookings.view' } }, async (req) => {
    const q = req.query as { from?: string; to?: string; courtIds?: string };
    const today = localDate(ctx.now(), ctx.timeZone);
    const from = q.from && /^\d{4}-\d{2}-\d{2}$/.test(q.from) ? q.from : today;
    let to = q.to && /^\d{4}-\d{2}-\d{2}$/.test(q.to) ? q.to : from;
    if (to < from) to = from;
    const maxTo = addDays(from, 6);
    if (to > maxTo) to = maxTo;
    const args: unknown[] = [from, to];
    let courtSql = '';
    const ids = (q.courtIds ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (ids.length) { courtSql = ` AND b.court_id IN (${ids.map(() => '?').join(',')})`; args.push(...ids); }
    const rows = ctx.db.prepare(`${SELECT} WHERE b.play_date BETWEEN ? AND ?${courtSql} ORDER BY b.start_at`).all(...args) as BookingRow[];
    const days: { date: string; openAt: number | null; closeAt: number | null }[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const h = ctx.settings().operatingHours[String(isoWeekday(d)) as '1'];
      days.push({ date: d, openAt: h ? zonedToEpoch(d, hhmmToMinutes(h.open), ctx.timeZone) : null, closeAt: h ? zonedToEpoch(d, hhmmToMinutes(h.close), ctx.timeZone) : null });
    }
    return { days, bookings: rows.map((r) => toDto(ctx, r)) };
  });

  app.get('/api/v1/bookings/context', { config: { perm: 'bookings.view' } }, async (req) => {
    const courtId = Number((req.query as { courtId?: string }).courtId);
    if (!Number.isInteger(courtId) || courtId < 1) throw E.validation('courtId is required');
    const now = ctx.now();
    const warnMs = ctx.settings().bookingWarnMinutes * 60_000;
    const rows = ctx.db.prepare(`${SELECT} WHERE b.court_id = ? AND b.status = 'confirmed' AND b.end_at > ? ORDER BY b.start_at LIMIT 8`).all(courtId, now) as BookingRow[];
    const dtos = rows.map((r) => toDto(ctx, r));
    const cur = dtos.find((b) => b.startAt <= now) ?? null;
    const next = dtos.find((b) => b.startAt > now) ?? null;
    return { now: cur, next, linkable: dtos.filter((b) => b.startAt <= now || b.startAt - now <= warnMs) };
  });

  app.get('/api/v1/bookings', { config: { perm: 'bookings.view' } }, async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const page = Math.max(1, Number(q.page ?? 1)); const pageSize = Math.min(100, Math.max(1, Number(q.pageSize ?? 25)));
    const where: string[] = []; const args: unknown[] = [];
    if (q.from) { where.push('b.play_date >= ?'); args.push(q.from); }
    if (q.to) { where.push('b.play_date <= ?'); args.push(q.to); }
    if (q.courtId) { where.push('b.court_id = ?'); args.push(Number(q.courtId)); }
    if (q.status === 'confirmed' || q.status === 'cancelled' || q.status === 'no_show') { where.push('b.status = ?'); args.push(q.status); }
    if (q.q) { where.push('(b.booked_by_name LIKE ? OR b.phone LIKE ? OR b.booking_code LIKE ?)'); args.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (ctx.db.prepare(`SELECT count(*) c FROM bookings b ${w}`).get(...args) as { c: number }).c;
    const rows = ctx.db.prepare(`${SELECT} ${w} ORDER BY b.start_at ${q.order === 'desc' ? 'DESC' : 'ASC'} LIMIT ? OFFSET ?`).all(...args, pageSize, (page - 1) * pageSize) as BookingRow[];
    return { items: rows.map((r) => toDto(ctx, r)), page, pageSize, total };
  });

  app.get('/api/v1/bookings/export.csv', { config: { perm: 'matches.export' } }, async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const where: string[] = []; const args: unknown[] = [];
    if (q.from) { where.push('b.play_date >= ?'); args.push(q.from); }
    if (q.to) { where.push('b.play_date <= ?'); args.push(q.to); }
    if (q.courtId) { where.push('b.court_id = ?'); args.push(Number(q.courtId)); }
    if (q.status) { where.push('b.status = ?'); args.push(q.status); }
    const rows = ctx.db.prepare(`${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY b.start_at`).all(...args) as BookingRow[];
    const fmt = (ms: number) => new Date(ms).toLocaleString('en-CA', { timeZone: ctx.timeZone, hour12: true });
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="bookings.csv"');
    return toCsv(['Code', 'Court', 'Date', 'Start', 'End', 'Booked by', 'Phone', 'Players', 'Status', 'Notes', 'Created by'],
      rows.map((r) => [r.booking_code, r.court_name, r.play_date, fmt(r.start_at), fmt(r.end_at), r.booked_by_name, r.phone, r.players_count, r.status, r.notes, r.created_by]));
  });

  app.get('/api/v1/bookings/:id', { config: { perm: 'bookings.view' } }, async (req) => {
    const { id } = idParam.parse(req.params);
    const dto = bookingDtoById(ctx, id);
    const matches = ctx.db.prepare('SELECT id, match_code, status, team_a_name, team_b_name, games_won_a, games_won_b, started_at FROM matches WHERE booking_id = ? ORDER BY id').all(id);
    return { ...dto, matches };
  });

  app.post('/api/v1/bookings', { config: { perm: 'bookings.manage' } }, async (req, reply) => {
    const body = createBookingSchema.parse(req.body);
    validateOrThrow(ctx, body.courtId, body.startAt, body.endAt);
    const id = ctx.tx(() => {
      const c = conflictWith(ctx, body.courtId, body.startAt, body.endAt);
      if (c) throw E.conflict('BOOKING_CONFLICT', `${c.courtName} is already booked ${fmtRange(ctx, c)} (${c.bookedByName})`, { conflict: c });
      const date = localDate(body.startAt, ctx.timeZone);
      const now = ctx.now();
      try {
        return Number(ctx.db.prepare(`INSERT INTO bookings (booking_code, court_id, start_at, end_at, play_date, booked_by_name, phone, players_count, notes, status, created_by_user_id, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?,?, 'confirmed', ?,?,?)`).run(nextCode(ctx, date), body.courtId, body.startAt, body.endAt, date, body.bookedByName, body.phone ?? null, body.playersCount ?? null, body.notes ?? null, req.auth!.user.id, now, now).lastInsertRowid);
      } catch (e) { throw mapConflict(ctx, e, body.courtId, body.startAt, body.endAt); }
    });
    const dto = bookingDtoById(ctx, id);
    audit(ctx, { actor: actorOf(req), action: 'booking.create', entityType: 'booking', entityId: id, details: { court: dto.courtName, code: dto.code }, ip: req.ip });
    ctx.pub.activity({ kind: 'booking', courtId: dto.courtId, text: `Booking ${dto.code}: ${dto.courtName} for ${dto.bookedByName}` });
    emit(dto, 'created');
    reply.code(201);
    return dto;
  });

  app.patch('/api/v1/bookings/:id', { config: { perm: 'bookings.manage' } }, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = patchBookingSchema.parse(req.body);
    const cur = bookingDtoById(ctx, id);
    if (cur.status !== 'confirmed') throw E.conflict('INVALID_STATE', 'Only confirmed bookings can be edited');
    const next = {
      courtId: body.courtId ?? cur.courtId, startAt: body.startAt ?? cur.startAt, endAt: body.endAt ?? cur.endAt,
      bookedByName: body.bookedByName ?? cur.bookedByName, phone: body.phone === undefined ? cur.phone : body.phone,
      playersCount: body.playersCount === undefined ? cur.playersCount : body.playersCount, notes: body.notes === undefined ? cur.notes : body.notes,
    };
    if (next.courtId !== cur.courtId || next.startAt !== cur.startAt || next.endAt !== cur.endAt) validateOrThrow(ctx, next.courtId, next.startAt, next.endAt);
    ctx.tx(() => {
      const c = conflictWith(ctx, next.courtId, next.startAt, next.endAt, id);
      if (c) throw E.conflict('BOOKING_CONFLICT', `${c.courtName} is already booked ${fmtRange(ctx, c)} (${c.bookedByName})`, { conflict: c });
      try {
        ctx.db.prepare(`UPDATE bookings SET court_id=?, start_at=?, end_at=?, play_date=?, booked_by_name=?, phone=?, players_count=?, notes=?, updated_at=?, updated_by_user_id=? WHERE id=?`)
          .run(next.courtId, next.startAt, next.endAt, localDate(next.startAt, ctx.timeZone), next.bookedByName, next.phone, next.playersCount, next.notes, ctx.now(), req.auth!.user.id, id);
      } catch (e) { throw mapConflict(ctx, e, next.courtId, next.startAt, next.endAt, id); }
    });
    const dto = bookingDtoById(ctx, id);
    audit(ctx, { actor: actorOf(req), action: 'booking.update', entityType: 'booking', entityId: id, details: { before: cur, after: body }, ip: req.ip });
    emit(dto, 'updated');
    if (cur.courtId !== dto.courtId) ctx.pub.publishCourt(cur.courtId);
    return dto;
  });

  const setStatus = (status: 'cancelled' | 'no_show', action: string) => async (req: import('fastify').FastifyRequest) => {
    const { id } = idParam.parse(req.params);
    const body = cancelBookingSchema.parse(req.body ?? {});
    const cur = bookingDtoById(ctx, id);
    if (cur.status !== 'confirmed') throw E.conflict('INVALID_STATE', 'Only confirmed bookings can be changed');
    const now = ctx.now();
    ctx.db.prepare(`UPDATE bookings SET status = ?, cancel_reason = ?, cancelled_at = ?, cancelled_by_user_id = ?, updated_at = ?, updated_by_user_id = ? WHERE id = ?`)
      .run(status, body.reason ?? null, status === 'cancelled' ? now : null, status === 'cancelled' ? req.auth!.user.id : null, now, req.auth!.user.id, id);
    const dto = bookingDtoById(ctx, id);
    audit(ctx, { actor: actorOf(req), action, entityType: 'booking', entityId: id, details: { reason: body.reason }, ip: req.ip });
    emit(dto, status);
    return dto;
  };
  app.post('/api/v1/bookings/:id/cancel', { config: { perm: 'bookings.manage' } }, setStatus('cancelled', 'booking.cancel'));
  app.post('/api/v1/bookings/:id/no-show', { config: { perm: 'bookings.manage' } }, setStatus('no_show', 'booking.no_show'));
}

function fmtRange(ctx: Ctx, b: BookingDto): string {
  const f = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { timeZone: ctx.timeZone, hour: 'numeric', minute: '2-digit', hour12: true });
  return `${f(b.startAt)}–${f(b.endAt)}`;
}

/** The overlap triggers are a backstop; translate their abort into the same API error. */
function mapConflict(ctx: Ctx, e: unknown, courtId: number, startAt: number, endAt: number, exceptId?: number): unknown {
  if (e instanceof Error && /BOOKING_CONFLICT/.test(e.message)) {
    const c = conflictWith(ctx, courtId, startAt, endAt, exceptId);
    return E.conflict('BOOKING_CONFLICT', 'That time overlaps another booking on this court', { conflict: c });
  }
  return e;
}
