import type { FastifyInstance } from 'fastify';
import {
  MAX_ACTIVE_COURTS, bulkCourtsSchema, courtOrderSchema, createCourtSchema, idParam, maintenanceSchema, patchCourtSchema,
  type CourtSnapshot,
} from '@pickle/shared';
import type { Ctx } from '../context';
import { AppError, E } from '../lib/errors';
import { audit } from '../lib/audit';
import { actorOf, deleteSession } from '../auth';
import { buildCourtSnapshot, type CourtRow } from '../snapshots';
import { bookingDtoById, futureBookingsForCourt, cancelBookingRows } from './bookings';

const activeCount = (ctx: Ctx) => (ctx.db.prepare('SELECT count(*) c FROM courts WHERE is_active = 1').get() as { c: number }).c;

function limitError(): AppError {
  return new AppError('COURT_LIMIT_REACHED', 422, `A maximum of ${MAX_ACTIVE_COURTS} courts can be active at once`, { max: MAX_ACTIVE_COURTS });
}

function isUniqueErr(e: unknown): boolean { return e instanceof Error && /UNIQUE constraint failed/.test(e.message); }

export function insertCourt(ctx: Ctx, input: { name: string; shortCode: string; description?: string | null }): number {
  const now = ctx.now();
  const ord = (ctx.db.prepare('SELECT COALESCE(MAX(display_order), -1) + 1 o FROM courts').get() as { o: number }).o;
  try {
    return Number(ctx.db.prepare(`INSERT INTO courts (name, short_code, description, display_order, is_active, created_at, updated_at) VALUES (?,?,?,?,1,?,?)`)
      .run(input.name, input.shortCode, input.description ?? null, ord, now, now).lastInsertRowid);
  } catch (e) {
    if (isUniqueErr(e)) throw E.conflict('DUPLICATE_NAME', 'A court with that name or short code already exists');
    throw e;
  }
}

/** All-or-nothing creation of "Court k…" continuing from the highest existing number. */
export function createCourtsBulk(ctx: Ctx, count: number, prefix: string, _userId: number | null): number[] {
  return ctx.tx(() => {
    if (activeCount(ctx) + count > MAX_ACTIVE_COURTS) throw limitError();
    const rows = ctx.db.prepare('SELECT name, short_code FROM courts').all() as { name: string; short_code: string }[];
    let max = 0;
    for (const r of rows) {
      const m = /(\d+)\s*$/.exec(r.name); if (m) max = Math.max(max, Number(m[1]));
      if (/^\d+$/.test(r.short_code)) max = Math.max(max, Number(r.short_code));
    }
    const names = new Set(rows.map((r) => r.name.toLowerCase())); const codes = new Set(rows.map((r) => r.short_code.toLowerCase()));
    const ids: number[] = [];
    let k = max;
    while (ids.length < count) {
      k++;
      const name = `${prefix}${k}`;
      if (names.has(name.toLowerCase()) || codes.has(String(k))) continue;
      ids.push(insertCourt(ctx, { name, shortCode: String(k) }));
    }
    return ids;
  });
}

const rowOf = (ctx: Ctx, id: number): CourtRow => {
  const c = ctx.db.prepare('SELECT * FROM courts WHERE id = ?').get(id) as CourtRow | undefined;
  if (!c) throw E.notFound('Court not found', 'COURT_NOT_FOUND');
  return c;
};

export function registerCourtRoutes(app: FastifyInstance, ctx: Ctx): void {
  const isAdmin = (req: { auth?: { user: { role: string } } }) => req.auth?.user.role === 'admin';

  app.get('/api/v1/courts', { config: { perm: 'courts.view' } }, async (req) => {
    const q = req.query as { includeInactive?: string };
    const rows = ctx.db.prepare(`SELECT id FROM courts ${q.includeInactive === 'true' ? '' : 'WHERE is_active = 1'} ORDER BY is_active DESC, display_order, id`).all() as { id: number }[];
    return rows.map((r) => buildCourtSnapshot(ctx, r.id, { deviceDetails: isAdmin(req) })!);
  });

  app.post('/api/v1/courts', { config: { perm: 'courts.manage' } }, async (req, reply) => {
    const body = createCourtSchema.parse(req.body);
    const id = ctx.tx(() => {
      if (activeCount(ctx) >= MAX_ACTIVE_COURTS) throw limitError();
      return insertCourt(ctx, body);
    });
    audit(ctx, { actor: actorOf(req), action: 'court.create', entityType: 'court', entityId: id, details: body, ip: req.ip });
    ctx.pub.invalidate(['courts', 'dashboard']); ctx.pub.publishCourt(id);
    reply.code(201);
    return buildCourtSnapshot(ctx, id, { deviceDetails: true });
  });

  app.post('/api/v1/courts/bulk', { config: { perm: 'courts.manage' } }, async (req, reply) => {
    const body = bulkCourtsSchema.parse(req.body);
    const ids = createCourtsBulk(ctx, body.count, body.namePrefix ?? 'Court ', req.auth!.user.id);
    audit(ctx, { actor: actorOf(req), action: 'court.bulk_create', entityType: 'court', details: { ids }, ip: req.ip });
    ctx.pub.invalidate(['courts', 'dashboard']); ids.forEach((id) => ctx.pub.publishCourt(id));
    reply.code(201);
    return ids.map((id) => buildCourtSnapshot(ctx, id, { deviceDetails: true }));
  });

  app.put('/api/v1/courts/order', { config: { perm: 'courts.manage' } }, async (req) => {
    const { courtIds } = courtOrderSchema.parse(req.body);
    ctx.tx(() => courtIds.forEach((id, i) => ctx.db.prepare('UPDATE courts SET display_order = ?, updated_at = ? WHERE id = ?').run(i, ctx.now(), id)));
    audit(ctx, { actor: actorOf(req), action: 'court.reorder', entityType: 'court', details: { courtIds }, ip: req.ip });
    ctx.pub.invalidate(['courts', 'dashboard']);
    return { ok: true };
  });

  app.get('/api/v1/courts/:id', { config: { perm: 'courts.view' } }, async (req) => {
    const { id } = idParam.parse(req.params);
    rowOf(ctx, id);
    const snap = buildCourtSnapshot(ctx, id, { deviceDetails: isAdmin(req) })!;
    const today = ctx.db.prepare('SELECT id FROM bookings WHERE court_id = ? AND play_date = ? ORDER BY start_at').all(id,
      new Date(ctx.now()).toLocaleDateString('en-CA', { timeZone: ctx.timeZone })) as { id: number }[];
    const matchesToday = ctx.db.prepare(`SELECT id, match_code, status, play_type, team_a_name, team_b_name, games_won_a, games_won_b, started_at, ended_at, winner_team, end_reason
      FROM matches WHERE court_id = ? AND play_date = ? ORDER BY id DESC`).all(id,
      new Date(ctx.now()).toLocaleDateString('en-CA', { timeZone: ctx.timeZone }));
    return { ...snap, bookingsToday: today.map((b) => bookingDtoById(ctx, b.id)), matchesToday };
  });

  app.patch('/api/v1/courts/:id', { config: { perm: 'courts.manage' } }, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = patchCourtSchema.parse(req.body);
    const c = rowOf(ctx, id);
    const cancelledBookings: number[] = [];
    ctx.tx(() => {
      const now = ctx.now();
      if (body.shortCode !== undefined && body.shortCode !== c.short_code) {
        const used = ctx.db.prepare('SELECT 1 FROM matches WHERE court_id = ? LIMIT 1').get(id);
        if (used) throw E.conflict('SHORT_CODE_LOCKED', 'The short code cannot change after the court has had a match');
      }
      if (body.isActive !== undefined && body.isActive !== !!c.is_active) {
        if (!body.isActive) {
          if (ctx.db.prepare("SELECT 1 FROM matches WHERE court_id = ? AND status IN ('setup','in_progress','paused')").get(id))
            throw E.conflict('ACTIVE_MATCHES_EXIST', 'End or cancel the active match on this court first');
          const future = futureBookingsForCourt(ctx, id);
          if (future.length && !body.bookingAction)
            throw E.conflict('FUTURE_BOOKINGS_EXIST', 'This court has upcoming bookings', { bookings: future.map((b) => bookingDtoById(ctx, b.id)) });
          if (body.bookingAction === 'cancel') cancelledBookings.push(...cancelBookingRows(ctx, future.map((b) => b.id), 'Court deactivated', req.auth!.user.id));
        } else if (activeCount(ctx) >= MAX_ACTIVE_COURTS) throw limitError();
      }
      try {
        ctx.db.prepare(`UPDATE courts SET name = ?, short_code = ?, description = ?, is_active = ?, updated_at = ? WHERE id = ?`).run(
          body.name ?? c.name, body.shortCode ?? c.short_code, body.description === undefined ? c.description : body.description,
          body.isActive === undefined ? c.is_active : body.isActive ? 1 : 0, now, id);
      } catch (e) {
        if (isUniqueErr(e)) throw E.conflict('DUPLICATE_NAME', 'A court with that name or short code already exists');
        throw e;
      }
    });
    audit(ctx, { actor: actorOf(req), action: body.isActive === false ? 'court.deactivate' : body.isActive === true ? 'court.activate' : 'court.update', entityType: 'court', entityId: id, details: { ...body, cancelledBookings }, ip: req.ip });
    ctx.pub.invalidate(['courts', 'dashboard', 'bookings']); ctx.pub.publishCourt(id);
    cancelledBookings.forEach((b) => { const d = bookingDtoById(ctx, b); ctx.pub.bookingChanged({ bookingId: b, courtId: id, playDate: d.playDate, change: 'cancelled' }); });
    return buildCourtSnapshot(ctx, id, { deviceDetails: true });
  });

  app.post('/api/v1/courts/:id/maintenance', { config: { perm: 'courts.maintenance' } }, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = maintenanceSchema.parse(req.body);
    rowOf(ctx, id);
    if (body.enabled && ctx.db.prepare("SELECT 1 FROM matches WHERE court_id = ? AND status IN ('setup','in_progress','paused')").get(id))
      throw E.conflict('COURT_BUSY', 'End or cancel the active match before turning on maintenance');
    ctx.db.prepare('UPDATE courts SET maintenance_mode = ?, maintenance_note = ?, updated_at = ? WHERE id = ?').run(body.enabled ? 1 : 0, body.enabled ? (body.note ?? null) : null, ctx.now(), id);
    audit(ctx, { actor: actorOf(req), action: body.enabled ? 'court.maintenance_on' : 'court.maintenance_off', entityType: 'court', entityId: id, details: body, ip: req.ip });
    const c = rowOf(ctx, id);
    ctx.pub.activity({ kind: 'maintenance', courtId: id, text: `${c.name} maintenance ${body.enabled ? 'on' : 'off'}` });
    ctx.pub.invalidate(['courts', 'dashboard']); ctx.pub.publishCourt(id);
    const warnings = body.enabled ? futureBookingsForCourt(ctx, id).map((b) => bookingDtoById(ctx, b.id)) : [];
    return { snapshot: buildCourtSnapshot(ctx, id, { deviceDetails: isAdmin(req) }), warnings };
  });

  app.post('/api/v1/courts/:id/release', { config: { perm: 'courts.release' } }, async (req) => {
    const { id } = idParam.parse(req.params);
    rowOf(ctx, id);
    ctx.db.prepare('UPDATE courts SET released_at = ?, updated_at = ? WHERE id = ?').run(ctx.now(), ctx.now(), id);
    ctx.pub.invalidate(['courts', 'dashboard']); ctx.pub.publishCourt(id);
    return buildCourtSnapshot(ctx, id, { deviceDetails: isAdmin(req) });
  });

  app.delete('/api/v1/courts/:id/device', { config: { perm: 'courts.manage' } }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    rowOf(ctx, id);
    const s = ctx.db.prepare('SELECT id FROM user_sessions WHERE terminal_court_id = ?').get(id) as { id: string } | undefined;
    if (s) {
      deleteSession(ctx, s.id);
      ctx.pub.terminalChanged(s.id, null, 'signed_out');
      ctx.pub.disconnectSession(s.id);
    }
    audit(ctx, { actor: actorOf(req), action: 'terminal.sign_out', entityType: 'court', entityId: id, ip: req.ip });
    ctx.pub.deviceStatus(id); ctx.pub.publishCourt(id);
    reply.code(204);
  });

  app.delete('/api/v1/courts/:id', { config: { perm: 'courts.manage' } }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    rowOf(ctx, id);
    if (ctx.db.prepare('SELECT 1 FROM matches WHERE court_id = ? LIMIT 1').get(id) || ctx.db.prepare('SELECT 1 FROM bookings WHERE court_id = ? LIMIT 1').get(id))
      throw E.conflict('ACTIVE_MATCHES_EXIST', 'This court has history and cannot be deleted. Deactivate it instead.');
    ctx.db.prepare('DELETE FROM courts WHERE id = ?').run(id);
    audit(ctx, { actor: actorOf(req), action: 'court.delete', entityType: 'court', entityId: id, ip: req.ip });
    ctx.pub.invalidate(['courts', 'dashboard']);
    reply.code(204);
  });
}

export type { CourtSnapshot };
