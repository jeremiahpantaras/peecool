import type { FastifyReply, FastifyRequest } from 'fastify';
import { CSRF_HEADER, SESSION_COOKIE, can, type PermissionKey, type Role } from '@pickle/shared';
import type { Ctx } from './context';
import { E, AppError } from './lib/errors';
import { randomToken, sha256Hex } from './lib/crypto';

export interface AuthUser { id: number; username: string; displayName: string; role: Role; mustChangePassword: boolean }
export interface AuthInfo { user: AuthUser; sessionId: string; terminalCourtId: number | null }

declare module 'fastify' {
  interface FastifyRequest { auth?: AuthInfo }
  interface FastifyContextConfig { perm?: PermissionKey; public?: true; local?: true; allowPasswordChange?: true }
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
export const isLoopback = (ip: string | undefined): boolean => !!ip && LOOPBACK.has(ip);

export interface SessionRow {
  id: string; user_id: number; terminal_court_id: number | null; created_at: number; last_seen_at: number; expires_at: number;
}

export function createSession(ctx: Ctx, userId: number, ip: string | undefined, ua: string | undefined): { token: string; expiresAt: number } {
  const token = randomToken(32);
  const now = ctx.now();
  const expiresAt = now + ctx.settings().sessionMaxDays * 86400_000;
  ctx.db.prepare(`INSERT INTO user_sessions (id, user_id, created_at, last_seen_at, expires_at, ip, user_agent, client_label)
    VALUES (?,?,?,?,?,?,?,?)`).run(sha256Hex(token), userId, now, now, expiresAt, ip ?? null, (ua ?? '').slice(0, 200), clientLabel(ua));
  return { token, expiresAt };
}

export function clientLabel(ua: string | undefined): string | null {
  if (!ua) return null;
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown OS';
  const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${br} on ${os}`;
}

export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: number, now: number): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: 'strict', path: '/', maxAge: Math.max(60, Math.floor((expiresAt - now) / 1000)),
  });
}

export function deleteSession(ctx: Ctx, sessionId: string): void {
  ctx.db.prepare('DELETE FROM user_sessions WHERE id = ?').run(sessionId);
}

/** Revokes every session of a user and closes their sockets (FR-AUTH-12). */
export function revokeUserSessions(ctx: Ctx, userId: number, exceptSessionId?: string): void {
  const rows = ctx.db.prepare('SELECT id, terminal_court_id FROM user_sessions WHERE user_id = ?').all(userId) as { id: string; terminal_court_id: number | null }[];
  for (const r of rows) {
    if (r.id === exceptSessionId) continue;
    deleteSession(ctx, r.id);
    ctx.pub.disconnectSession(r.id);
    if (r.terminal_court_id) ctx.pub.deviceStatus(r.terminal_court_id);
  }
}

/** Resolves a raw cookie token to the authenticated user, applying idle/absolute expiry. */
export function authenticateToken(ctx: Ctx, token: string | undefined, touch = true): AuthInfo | null {
  if (!token) return null;
  const id = sha256Hex(token);
  const row = ctx.db.prepare(`SELECT s.id, s.user_id, s.terminal_court_id, s.last_seen_at, s.expires_at,
      u.username, u.display_name, u.role, u.is_active, u.must_change_password
    FROM user_sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`).get(id) as
    | (SessionRow & { username: string; display_name: string; role: Role; is_active: number; must_change_password: number })
    | undefined;
  if (!row) return null;
  const now = ctx.now();
  const st = ctx.settings();
  const idleMs = st.sessionIdleMinutes * 60_000;
  const expired = row.expires_at <= now || !row.is_active || (row.terminal_court_id == null && now - row.last_seen_at > idleMs);
  if (expired) { deleteSession(ctx, id); return null; }
  if (touch && now - row.last_seen_at > 60_000) {
    const exp = row.terminal_court_id != null ? now + st.terminalSessionDays * 86400_000 : row.expires_at;
    ctx.db.prepare('UPDATE user_sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?').run(now, exp, id);
  } else if (touch && row.terminal_court_id == null) {
    // idle clock is also kept fresh by the activity of shorter intervals
  }
  return {
    user: { id: row.user_id, username: row.username, displayName: row.display_name, role: row.role, mustChangePassword: !!row.must_change_password },
    sessionId: id, terminalCourtId: row.terminal_court_id,
  };
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Global preHandler: CSRF header, maintenance gate, session, permission. */
export function makeAuthHook(ctx: Ctx) {
  return async function authHook(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (req.is404) return; // unknown paths get a plain 404 from the not-found handler
    const cfg = req.routeOptions.config ?? {};
    const url = req.url.split('?')[0] ?? '';
    // The web app itself (index.html, /assets/*, icons) is public; only /api and /internal are protected.
    if (!url.startsWith('/api/') && !url.startsWith('/internal/')) return;
    if (ctx.maintenanceGate && url !== '/api/v1/health' && !url.startsWith('/internal/'))
      throw new AppError('SERVICE_UNAVAILABLE', 503, 'The system is restarting. Please wait a moment.');
    if (ctx.recovery?.corrupt && url.startsWith('/api/')) {
      // Recovery mode: only health, and backup list/restore from the Master PC itself
      if (url === '/api/v1/health') return;
      if (url.startsWith('/api/v1/backups') && isLoopback(req.ip)) {
        req.auth = { user: { id: 0, username: 'recovery', displayName: 'Recovery', role: 'admin', mustChangePassword: false }, sessionId: '', terminalCourtId: null };
        return;
      }
      throw new AppError('SERVICE_UNAVAILABLE', 503, 'The database needs to be restored from a backup (open the app on the Master PC).');
    }
    if (MUTATING.has(req.method) && url.startsWith('/api/') && req.headers[CSRF_HEADER.toLowerCase()] !== '1')
      throw new AppError('CSRF_HEADER_MISSING', 403, 'Missing request header');
    if (cfg.local) {
      if (!isLoopback(req.ip)) throw new AppError('SETUP_LOCAL_ONLY', 403, 'Complete setup on the Master PC');
      return;
    }
    if (cfg.public) return;
    const auth = authenticateToken(ctx, req.cookies?.[SESSION_COOKIE]);
    if (!auth) throw E.unauthenticated();
    req.auth = auth;
    if (auth.user.mustChangePassword && !cfg.allowPasswordChange)
      throw new AppError('PASSWORD_CHANGE_REQUIRED', 403, 'You must choose a new password first');
    if (!cfg.perm) throw E.forbidden();
    if (!can({ kind: 'user', role: auth.user.role }, cfg.perm)) throw E.forbidden();
  };
}

export const actorOf = (req: FastifyRequest) => ({ userId: req.auth!.user.id, courtId: req.auth!.terminalCourtId });
