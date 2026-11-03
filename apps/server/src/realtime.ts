import type { FastifyInstance } from 'fastify';
import { Server, type Socket } from 'socket.io';
import { SESSION_COOKIE, type Role } from '@pickle/shared';
import type { Ctx, Publisher } from './context';
import { authenticateToken } from './auth';
import { buildCourtSnapshot, deviceInfo } from './snapshots';
import { computeAlerts } from './modules/dashboard';
import { terminalOf } from './modules/auth';
import { APP_VERSION } from './modules/settings';

interface SockData { userId: number; role: Role; sessionId: string; terminalCourtId: number | null; subscribed: Set<string> }

function parseCookies(h: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (h ?? '').split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
  return out;
}

export interface Realtime extends Publisher { io: Server; close(): Promise<void> }

export function attachRealtime(app: FastifyInstance, ctx: Ctx): Realtime {
  const io = new Server(app.server, {
    path: '/socket.io', pingInterval: 5000, pingTimeout: 5000, maxHttpBufferSize: 64 * 1024, serveClient: false, cors: undefined,
    transports: ['websocket', 'polling'],
  });
  const sessionSockets = new Map<string, Set<string>>();

  io.use((socket, next) => {
    const token = parseCookies(socket.handshake.headers.cookie)[SESSION_COOKIE];
    const auth = authenticateToken(ctx, token);
    if (!auth || auth.user.mustChangePassword) {
      const err = new Error('UNAUTHENTICATED') as Error & { data?: unknown };
      err.data = { code: 'UNAUTHENTICATED' };
      return next(err);
    }
    socket.data = { userId: auth.user.id, role: auth.user.role, sessionId: auth.sessionId, terminalCourtId: auth.terminalCourtId, subscribed: new Set<string>() } satisfies SockData;
    next();
  });

  const joinBase = (socket: Socket): void => {
    const d = socket.data as SockData;
    void socket.join([`user:${d.userId}`, `session:${d.sessionId}`, `role:${d.role}`, 'facility']);
    if (d.terminalCourtId) void socket.join(`court:${d.terminalCourtId}`);
  };

  const hello = (socket: Socket): void => {
    const d = socket.data as SockData;
    socket.emit('server:hello', {
      serverTime: ctx.now(), version: APP_VERSION, instanceId: ctx.instanceId, dbGeneration: ctx.dbGeneration, terminal: terminalOf(ctx, d.terminalCourtId),
    });
  };

  const snapshotsFor = (d: SockData): unknown[] => {
    const ids = new Set<number>();
    if (d.terminalCourtId) ids.add(d.terminalCourtId);
    let all = false;
    for (const r of d.subscribed) { if (r === 'courts:all') all = true; else if (r.startsWith('court:')) ids.add(Number(r.slice(6))); }
    if (all) for (const r of ctx.db.prepare('SELECT id FROM courts WHERE is_active = 1').all() as { id: number }[]) ids.add(r.id);
    return [...ids].map((id) => buildCourtSnapshot(ctx, id)).filter(Boolean);
  };

  io.on('connection', (socket) => {
    const d = socket.data as SockData;
    joinBase(socket);
    let set = sessionSockets.get(d.sessionId);
    if (!set) sessionSockets.set(d.sessionId, (set = new Set()));
    set.add(socket.id);
    if (d.terminalCourtId && set.size === 1) pub.deviceStatus(d.terminalCourtId);
    hello(socket);
    if (d.terminalCourtId) { const s = buildCourtSnapshot(ctx, d.terminalCourtId); if (s) socket.emit('court:snapshot', s); }

    socket.on('subscribe', (payload: { courts?: 'all' | number[] } | undefined, ack?: (r: unknown) => void) => {
      for (const r of d.subscribed) void socket.leave(r);
      d.subscribed.clear();
      const c = payload?.courts;
      if (c === 'all') { d.subscribed.add('courts:all'); void socket.join('courts:all'); }
      else if (Array.isArray(c)) for (const id of c.slice(0, 50)) if (Number.isInteger(id)) { d.subscribed.add(`court:${id}`); void socket.join(`court:${id}`); }
      if (d.terminalCourtId) void socket.join(`court:${d.terminalCourtId}`); // never lose the assigned court
      if (typeof ack === 'function') ack(snapshotsFor(d));
    });
    socket.on('sync', (_p: unknown, ack?: (r: unknown) => void) => { if (typeof ack === 'function') ack(snapshotsFor(d)); });
    socket.on('time:ping', (p: { t0?: number } | undefined, ack?: (r: unknown) => void) => { if (typeof ack === 'function') ack({ t0: p?.t0 ?? 0, serverTime: ctx.now() }); });
    socket.on('disconnect', () => {
      const s = sessionSockets.get(d.sessionId);
      s?.delete(socket.id);
      if (s && s.size === 0) { sessionSockets.delete(d.sessionId); if (d.terminalCourtId) pub.deviceStatus(d.terminalCourtId); }
    });
  });

  const pub: Realtime = {
    io,
    publishCourt(courtId) {
      const snap = buildCourtSnapshot(ctx, courtId);
      if (snap) io.to(`court:${courtId}`).to('courts:all').emit('court:snapshot', snap);
    },
    invalidate(keys) { io.to('facility').emit('invalidate', { keys }); },
    activity(a) { ctx.pushActivity(a); io.to('facility').emit('activity', ctx.activityLog[0]); },
    bookingChanged(p) { io.to('facility').emit('booking:changed', p); },
    settingsUpdated() { io.emit('settings:updated', ctx.publicSettings()); },
    alertsChanged() {
      io.to('role:admin').emit('alerts', computeAlerts(ctx, 'admin'));
      io.to('role:staff').emit('alerts', computeAlerts(ctx, 'staff'));
    },
    terminalChanged(sessionId, courtId, reason) { io.to(`session:${sessionId}`).emit('terminal:changed', { courtId, reason }); },
    disconnectUser(userId) { io.in(`user:${userId}`).disconnectSockets(true); },
    disconnectSession(sessionId) { io.in(`session:${sessionId}`).disconnectSockets(true); },
    deviceStatus(courtId) {
      const dev = deviceInfo(ctx, courtId);
      io.to('facility').emit('device:status', { courtId, online: dev?.online ?? false, signedInUser: dev?.signedInUser ?? null, lastSeenAt: dev?.lastSeenAt ?? null });
      pub.publishCourt(courtId);
      ctx.pushActivity({ kind: 'device', courtId, text: `${(ctx.db.prepare('SELECT name FROM courts WHERE id = ?').get(courtId) as { name: string } | undefined)?.name ?? 'Court'} device ${dev?.online ? 'connected' : dev ? 'disconnected' : 'removed'}` });
      io.to('facility').emit('activity', ctx.activityLog[0]);
    },
    isSessionOnline(sessionId) { return (sessionSockets.get(sessionId)?.size ?? 0) > 0; },
    refreshSession(sessionId) {
      const auth = ctx.db.prepare('SELECT terminal_court_id t FROM user_sessions WHERE id = ?').get(sessionId) as { t: number | null } | undefined;
      for (const sid of sessionSockets.get(sessionId) ?? []) {
        const s = io.sockets.sockets.get(sid);
        if (!s) continue;
        const d = s.data as SockData;
        if (d.terminalCourtId && d.terminalCourtId !== auth?.t && !d.subscribed.has(`court:${d.terminalCourtId}`)) void s.leave(`court:${d.terminalCourtId}`);
        d.terminalCourtId = auth?.t ?? null;
        if (d.terminalCourtId) { void s.join(`court:${d.terminalCourtId}`); const snap = buildCourtSnapshot(ctx, d.terminalCourtId); if (snap) s.emit('court:snapshot', snap); }
        hello(s);
      }
    },
    broadcast(event, payload) { io.emit(event, payload); },
    socketCount() { return io.engine.clientsCount; },
    async close() { await io.close(); },
  } as Realtime;
  return pub;
}
