import type { FastifyInstance } from 'fastify';
import {
  changePasswordSchema, createUserSchema, idParam, loginSchema, patchUserSchema, permissionsFor, resetPasswordSchema,
  setupSchema, terminalSchema, type MeDto, type UserDto,
} from '@pickle/shared';
import type { Ctx } from '../context';
import { AppError, E } from '../lib/errors';
import { hashPassword, verifyPassword } from '../lib/crypto';
import { audit } from '../lib/audit';
import { RateLimiter } from '../lib/ratelimit';
import {
  actorOf, createSession, deleteSession, isLoopback, revokeUserSessions, setSessionCookie,
} from '../auth';

const LOCK_MS = 15 * 60_000;
const MAX_FAILS = 5;

interface UserRow {
  id: number; username: string; display_name: string; password_hash: string; role: 'admin' | 'staff'; is_active: number;
  failed_login_count: number; last_failed_at: number | null; locked_until: number | null; last_login_at: number | null;
  must_change_password: number; created_at: number;
}

export const userDto = (r: UserRow): UserDto => ({
  id: r.id, username: r.username, displayName: r.display_name, role: r.role, isActive: !!r.is_active,
  lastLoginAt: r.last_login_at, mustChangePassword: !!r.must_change_password, createdAt: r.created_at,
});

export function terminalOf(ctx: Ctx, courtId: number | null) {
  if (courtId == null) return null;
  const c = ctx.db.prepare('SELECT id, name FROM courts WHERE id = ?').get(courtId) as { id: number; name: string } | undefined;
  return c ? { courtId: c.id, courtName: c.name } : null;
}

export function meDto(ctx: Ctx, auth: NonNullable<import('fastify').FastifyRequest['auth']>): MeDto {
  return {
    user: { id: auth.user.id, username: auth.user.username, displayName: auth.user.displayName, role: auth.user.role },
    permissions: permissionsFor(auth.user.role),
    publicSettings: ctx.publicSettings(),
    terminal: terminalOf(ctx, auth.terminalCourtId),
    mustChangePassword: auth.user.mustChangePassword,
  };
}

export function registerAuthRoutes(app: FastifyInstance, ctx: Ctx): void {
  const loginLimiter = new RateLimiter(20, 60_000, () => ctx.now());
  const hash = (pw: string) => (ctx.config.fastHash
    ? hashPassword(pw, { N: 2 ** 10, r: 8, p: 1 }) : hashPassword(pw));

  /* ------------------------------------------------------------- setup */
  app.get('/api/v1/setup/status', { config: { public: true } }, async (req) => {
    const n = (ctx.db.prepare('SELECT count(*) c FROM users').get() as { c: number }).c;
    return { needsSetup: n === 0, isLocalRequest: isLoopback(req.ip) };
  });

  app.post('/api/v1/setup', { config: { local: true } }, async (req, reply) => {
    const body = setupSchema.parse(req.body);
    const n = (ctx.db.prepare('SELECT count(*) c FROM users').get() as { c: number }).c;
    if (n > 0) throw E.conflict('ALREADY_SETUP', 'Setup has already been completed');
    const pwHash = await hash(body.password);
    const now = ctx.now();
    const userId = ctx.tx(() => {
      const r = ctx.db.prepare(`INSERT INTO users (username, display_name, password_hash, role, is_active, password_changed_at, must_change_password, created_at, updated_at)
        VALUES (?,?,?,?,1,?,0,?,?)`).run(body.username, body.displayName, pwHash, 'admin', now, now, now);
      if (body.facilityName) setSetting(ctx, 'facilityName', body.facilityName, Number(r.lastInsertRowid));
      return Number(r.lastInsertRowid);
    });
    if (body.courtCount) createCourtsBulk(ctx, body.courtCount, 'Court ', userId);
    audit(ctx, { actor: { userId }, action: 'setup.complete', entityType: 'user', entityId: userId, ip: req.ip });
    const { token, expiresAt } = createSession(ctx, userId, req.ip, req.headers['user-agent']);
    setSessionCookie(reply, token, expiresAt, now);
    reply.code(201);
    return { user: { id: userId, username: body.username, displayName: body.displayName, role: 'admin' } };
  });

  /* ------------------------------------------------------------ session */
  app.post('/api/v1/auth/login', { config: { public: true } }, async (req, reply) => {
    const wait = loginLimiter.hit(req.ip);
    if (wait) { reply.header('Retry-After', String(wait)); throw new AppError('RATE_LIMITED', 429, 'Too many attempts. Please wait.'); }
    const body = loginSchema.parse(req.body);
    const now = ctx.now();
    const u = ctx.db.prepare('SELECT * FROM users WHERE username = ?').get(body.username) as UserRow | undefined;
    if (!u || !u.is_active) {
      await verifyPassword(body.password, 'scrypt$1024$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86) + '==').catch(() => false); // equalise timing
      audit(ctx, { actor: 'anonymous', action: 'auth.login_failed', details: { username: body.username }, ip: req.ip });
      throw new AppError('INVALID_CREDENTIALS', 401, 'Wrong username or password');
    }
    if (u.locked_until && u.locked_until > now) {
      throw new AppError('ACCOUNT_LOCKED', 423, 'Too many failed attempts. Try again later.', { retryAfterSeconds: Math.ceil((u.locked_until - now) / 1000) });
    }
    const ok = await verifyPassword(body.password, u.password_hash);
    if (!ok) {
      const within = u.last_failed_at != null && now - u.last_failed_at < LOCK_MS;
      const count = (within ? u.failed_login_count : 0) + 1;
      const lock = count >= MAX_FAILS ? now + LOCK_MS : null;
      ctx.db.prepare('UPDATE users SET failed_login_count = ?, last_failed_at = ?, locked_until = ? WHERE id = ?').run(lock ? 0 : count, now, lock, u.id);
      audit(ctx, { actor: 'anonymous', action: lock ? 'auth.locked' : 'auth.login_failed', entityType: 'user', entityId: u.id, ip: req.ip });
      throw new AppError('INVALID_CREDENTIALS', 401, 'Wrong username or password');
    }
    if (u.role === 'admin' && ctx.settings().adminLoginMasterPcOnly && !isLoopback(req.ip))
      throw new AppError('ADMIN_LOGIN_RESTRICTED', 403, 'Administrators may only sign in on the Master PC');
    ctx.db.prepare('UPDATE users SET failed_login_count = 0, last_failed_at = NULL, locked_until = NULL, last_login_at = ? WHERE id = ?').run(now, u.id);
    const { token, expiresAt } = createSession(ctx, u.id, req.ip, req.headers['user-agent']);
    setSessionCookie(reply, token, expiresAt, now);
    audit(ctx, { actor: { userId: u.id }, action: 'auth.login', ip: req.ip });
    const auth = { user: { id: u.id, username: u.username, displayName: u.display_name, role: u.role, mustChangePassword: !!u.must_change_password }, sessionId: '', terminalCourtId: null };
    return meDto(ctx, auth);
  });

  app.post('/api/v1/auth/logout', { config: { perm: 'auth.self', allowPasswordChange: true } }, async (req, reply) => {
    const a = req.auth!;
    const courtId = a.terminalCourtId;
    deleteSession(ctx, a.sessionId);
    ctx.pub.disconnectSession(a.sessionId);
    if (courtId) ctx.pub.deviceStatus(courtId);
    audit(ctx, { actor: actorOf(req), action: 'auth.logout', ip: req.ip });
    reply.clearCookie('ps_session', { path: '/' });
    reply.code(204);
  });

  app.get('/api/v1/auth/me', { config: { perm: 'auth.self', allowPasswordChange: true } }, async (req) => meDto(ctx, req.auth!));

  app.post('/api/v1/auth/change-password', { config: { perm: 'auth.self', allowPasswordChange: true } }, async (req, reply) => {
    const body = changePasswordSchema.parse(req.body);
    const a = req.auth!;
    const u = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(a.user.id) as UserRow;
    if (!(await verifyPassword(body.currentPassword, u.password_hash)))
      throw new AppError('INVALID_CREDENTIALS', 401, 'Current password is wrong');
    const h = await hash(body.newPassword);
    const now = ctx.now();
    ctx.db.prepare('UPDATE users SET password_hash = ?, password_changed_at = ?, must_change_password = 0, updated_at = ? WHERE id = ?').run(h, now, now, u.id);
    revokeUserSessions(ctx, u.id, a.sessionId);
    audit(ctx, { actor: actorOf(req), action: 'auth.change_password', ip: req.ip });
    reply.code(204);
  });

  /* ----------------------------------------------- court-device assignment */
  app.put('/api/v1/session/terminal', { config: { perm: 'courts.terminal' } }, async (req) => {
    const body = terminalSchema.parse(req.body);
    const a = req.auth!;
    const court = ctx.db.prepare('SELECT id, name, is_active FROM courts WHERE id = ?').get(body.courtId) as { id: number; name: string; is_active: number } | undefined;
    if (!court) throw E.notFound('Court not found', 'COURT_NOT_FOUND');
    if (!court.is_active) throw E.conflict('COURT_UNAVAILABLE', 'That court is not in service');
    const other = ctx.db.prepare(`SELECT s.id, s.last_seen_at, u.display_name FROM user_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.terminal_court_id = ? AND s.id <> ?`).get(court.id, a.sessionId) as { id: string; last_seen_at: number; display_name: string } | undefined;
    if (other && !body.replaceExisting)
      throw E.conflict('COURT_HAS_DEVICE', `${court.name} already has a device`, { signedInUser: other.display_name, lastSeenAt: other.last_seen_at });
    const now = ctx.now();
    const prevCourt = a.terminalCourtId;
    ctx.tx(() => {
      if (other) ctx.db.prepare('UPDATE user_sessions SET terminal_court_id = NULL, terminal_assigned_at = NULL WHERE id = ?').run(other.id);
      ctx.db.prepare('UPDATE user_sessions SET terminal_court_id = ?, terminal_assigned_at = ?, expires_at = ?, last_seen_at = ? WHERE id = ?')
        .run(court.id, now, now + ctx.settings().terminalSessionDays * 86400_000, now, a.sessionId);
    });
    if (other) ctx.pub.terminalChanged(other.id, null, 'replaced');
    ctx.pub.refreshSession(a.sessionId);
    audit(ctx, { actor: actorOf(req), action: other ? 'terminal.replace' : 'terminal.assign', entityType: 'court', entityId: court.id, ip: req.ip });
    if (prevCourt && prevCourt !== court.id) ctx.pub.deviceStatus(prevCourt);
    ctx.pub.deviceStatus(court.id);
    ctx.pub.publishCourt(court.id);
    return { terminal: { courtId: court.id, courtName: court.name } };
  });

  app.delete('/api/v1/session/terminal', { config: { perm: 'courts.terminal' } }, async (req, reply) => {
    const a = req.auth!;
    const courtId = a.terminalCourtId;
    ctx.db.prepare('UPDATE user_sessions SET terminal_court_id = NULL, terminal_assigned_at = NULL, expires_at = ? WHERE id = ?')
      .run(ctx.now() + ctx.settings().sessionMaxDays * 86400_000, a.sessionId);
    ctx.pub.terminalChanged(a.sessionId, null, 'unassigned');
    ctx.pub.refreshSession(a.sessionId);
    if (courtId) { audit(ctx, { actor: { userId: a.user.id, courtId }, action: 'terminal.unassign', entityType: 'court', entityId: courtId, ip: req.ip }); ctx.pub.deviceStatus(courtId); ctx.pub.publishCourt(courtId); }
    reply.code(204);
  });

  /* ------------------------------------------------------------- users */
  app.get('/api/v1/users', { config: { perm: 'users.manage' } }, async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const page = Math.max(1, Number(q.page ?? 1)); const pageSize = Math.min(100, Math.max(1, Number(q.pageSize ?? 25)));
    const where: string[] = []; const args: unknown[] = [];
    if (q.q) { where.push('(username LIKE ? OR display_name LIKE ?)'); args.push(`%${q.q}%`, `%${q.q}%`); }
    if (q.role === 'admin' || q.role === 'staff') { where.push('role = ?'); args.push(q.role); }
    if (q.active === 'true' || q.active === 'false') { where.push('is_active = ?'); args.push(q.active === 'true' ? 1 : 0); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const sort = q.sort === 'lastLoginAt' ? 'last_login_at' : 'display_name COLLATE NOCASE';
    const total = (ctx.db.prepare(`SELECT count(*) c FROM users ${w}`).get(...args) as { c: number }).c;
    const rows = ctx.db.prepare(`SELECT * FROM users ${w} ORDER BY ${sort} ${q.order === 'desc' ? 'DESC' : 'ASC'} LIMIT ? OFFSET ?`).all(...args, pageSize, (page - 1) * pageSize) as UserRow[];
    const counts = ctx.db.prepare("SELECT role, count(*) c FROM users WHERE is_active = 1 GROUP BY role").all() as { role: string; c: number }[];
    return { items: rows.map(userDto), page, pageSize, total, activeStaff: counts.find((c) => c.role === 'staff')?.c ?? 0, activeAdmins: counts.find((c) => c.role === 'admin')?.c ?? 0 };
  });

  app.post('/api/v1/users', { config: { perm: 'users.manage' } }, async (req, reply) => {
    const body = createUserSchema.parse(req.body);
    if (ctx.db.prepare('SELECT 1 FROM users WHERE username = ?').get(body.username)) throw E.conflict('DUPLICATE_NAME', 'That username is already taken');
    const h = await hash(body.password);
    const now = ctx.now();
    const r = ctx.db.prepare(`INSERT INTO users (username, display_name, password_hash, role, is_active, password_changed_at, must_change_password, created_by_user_id, created_at, updated_at)
      VALUES (?,?,?,?,1,?,?,?,?,?)`).run(body.username, body.displayName, h, body.role, now, body.mustChangePassword ? 1 : 0, req.auth!.user.id, now, now);
    audit(ctx, { actor: actorOf(req), action: 'user.create', entityType: 'user', entityId: Number(r.lastInsertRowid), details: { username: body.username, role: body.role }, ip: req.ip });
    ctx.pub.invalidate(['users']);
    reply.code(201);
    return userDto(ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid) as UserRow);
  });

  app.patch('/api/v1/users/:id', { config: { perm: 'users.manage' } }, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = patchUserSchema.parse(req.body);
    const u = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    if (!u) throw E.notFound('User not found');
    const newRole = body.role ?? u.role;
    const newActive = body.isActive ?? !!u.is_active;
    if (u.role === 'admin' && u.is_active && (newRole !== 'admin' || !newActive)) {
      const admins = (ctx.db.prepare("SELECT count(*) c FROM users WHERE role='admin' AND is_active=1").get() as { c: number }).c;
      if (admins <= 1) throw E.conflict('LAST_ADMIN', 'There must always be at least one active Admin');
    }
    const now = ctx.now();
    ctx.db.prepare('UPDATE users SET display_name = ?, role = ?, is_active = ?, updated_at = ? WHERE id = ?')
      .run(body.displayName ?? u.display_name, newRole, newActive ? 1 : 0, now, id);
    if (newRole !== u.role || newActive !== !!u.is_active) revokeUserSessions(ctx, id);
    audit(ctx, { actor: actorOf(req), action: newRole !== u.role ? 'user.role_change' : newActive !== !!u.is_active ? (newActive ? 'user.reactivate' : 'user.deactivate') : 'user.update', entityType: 'user', entityId: id, details: body, ip: req.ip });
    ctx.pub.invalidate(['users']);
    return userDto(ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow);
  });

  app.post('/api/v1/users/:id/reset-password', { config: { perm: 'users.manage' } }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const body = resetPasswordSchema.parse(req.body);
    if (!ctx.db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) throw E.notFound('User not found');
    const h = await hash(body.newPassword);
    const now = ctx.now();
    ctx.db.prepare('UPDATE users SET password_hash = ?, password_changed_at = ?, must_change_password = 1, failed_login_count = 0, locked_until = NULL, updated_at = ? WHERE id = ?').run(h, now, now, id);
    revokeUserSessions(ctx, id);
    audit(ctx, { actor: actorOf(req), action: 'user.reset_password', entityType: 'user', entityId: id, ip: req.ip });
    reply.code(204);
  });
}

/* ----------------------------------------------------------- shared helpers */

import { createCourtsBulk } from './courts';
import { setSetting } from './settings';
