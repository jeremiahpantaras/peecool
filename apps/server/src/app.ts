import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fstatic from '@fastify/static';
import { ZodError } from 'zod';
import { AppError } from './lib/errors';
import type { Ctx } from './context';
import { makeAuthHook, isLoopback } from './auth';
import { timingSafeEqualStr } from './lib/crypto';
import { registerAuthRoutes } from './modules/auth';
import { registerSettingsRoutes, APP_VERSION } from './modules/settings';
import { registerCourtRoutes } from './modules/courts';
import { registerBookingRoutes } from './modules/bookings';
import { registerMatchRoutes } from './modules/matches';
import { registerPlayerRoutes } from './modules/players';
import { registerFormatRoutes } from './modules/formats';
import { registerDashboardRoutes, lastBackupAt } from './modules/dashboard';
import { registerReportRoutes } from './modules/reports';
import { registerAdminRoutes } from './modules/admin';
import { registerOpenPlayRoutes } from './modules/openplay';

export interface RouteInfo { method: string; url: string; perm?: string; public?: boolean; local?: boolean }

export async function buildApp(ctx: Ctx, opts: { onShutdown?: () => void } = {}): Promise<{ app: FastifyInstance; routes: RouteInfo[] }> {
  const app = Fastify({ loggerInstance: ctx.log as unknown as FastifyBaseLogger, trustProxy: false, bodyLimit: 1024 * 1024, requestIdHeader: false });
  const routes: RouteInfo[] = [];

  // Every /api route must declare how it is protected (route-table rule, NFR-SEC-13).
  app.addHook('onRoute', (r) => {
    const url = r.url;
    if (!url.startsWith('/api/') && !url.startsWith('/internal/')) return;
    if (r.method === 'HEAD' || (Array.isArray(r.method) && r.method.every((m) => m === 'HEAD'))) return;
    const c = (r.config ?? {}) as { perm?: string; public?: true; local?: true };
    if (!c.perm && !c.public && !c.local) throw new Error(`Route ${String(r.method)} ${url} declares no permission`);
    for (const m of Array.isArray(r.method) ? r.method : [r.method]) if (m !== 'HEAD') routes.push({ method: m, url, perm: c.perm, public: c.public, local: c.local });
  });

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 500 * 1024 * 1024, files: 1 } });

  app.addHook('onRequest', async (req, reply) => {
    reply.header('X-Request-Id', req.id).header('X-Server-Time', String(ctx.now()));
    reply.header('Content-Security-Policy', "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'");
    reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer').header('X-Frame-Options', 'DENY');
  });
  app.addHook('preHandler', makeAuthHook(ctx));

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    const requestId = req.id as string;
    if (err instanceof AppError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message, details: err.details, requestId }, ...(err.extra ?? {}) });
    }
    if (err instanceof ZodError) {
      return reply.code(422).send({ error: { code: 'VALIDATION_ERROR', message: 'Please check the highlighted fields', details: { issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) }, requestId } });
    }
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ error: { code: err.statusCode === 400 ? 'BAD_REQUEST' : err.statusCode === 429 ? 'RATE_LIMITED' : 'BAD_REQUEST', message: err.message, requestId } });
    }
    if (err instanceof Error && /UNIQUE constraint failed/.test(err.message)) {
      return reply.code(409).send({ error: { code: 'DUPLICATE_NAME', message: 'That value already exists', requestId } });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.', requestId } });
  });

  /* ---- system ---- */
  app.get('/api/v1/health', { config: { public: true } }, async () => ({
    status: ctx.recovery?.corrupt ? 'recovery' : 'ok', version: APP_VERSION, uptimeSeconds: Math.round(process.uptime()), serverTime: ctx.now(),
    db: ctx.recovery?.corrupt ? 'corrupt' : 'ok', lastBackupAt: ctx.recovery?.corrupt ? null : lastBackupAt(ctx), instanceId: ctx.instanceId, dbGeneration: ctx.dbGeneration,
  }));

  app.post('/internal/shutdown', { config: { public: true } }, async (req, reply) => {
    // loopback only + secret file (WinSW stopexecutable → `cli stop`)
    const secretFile = path.join(ctx.config.dataDir, 'shutdown.secret');
    let secret = '';
    try { secret = fs.readFileSync(secretFile, 'utf8').trim(); } catch { /* none */ }
    const given = String(req.headers['x-shutdown-secret'] ?? '');
    if (!isLoopback(req.ip) || !secret || !timingSafeEqualStr(secret, given)) return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Not allowed' } });
    reply.code(202).send({ stopping: true });
    setTimeout(() => opts.onShutdown?.(), 50);
  });

  registerAuthRoutes(app, ctx);
  registerSettingsRoutes(app, ctx);
  registerCourtRoutes(app, ctx);
  registerBookingRoutes(app, ctx);
  registerMatchRoutes(app, ctx);
  registerPlayerRoutes(app, ctx);
  registerFormatRoutes(app, ctx);
  registerDashboardRoutes(app, ctx);
  registerReportRoutes(app, ctx);
  registerAdminRoutes(app, ctx);
  registerOpenPlayRoutes(app, ctx);

  /* ---- static web app (SPA) ---- */
  const root = ctx.config.webRoot;
  if (root) {
    await app.register(fstatic, { root, wildcard: false, index: false, cacheControl: false, setHeaders: (res, p) => {
      if (p.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      else res.setHeader('Cache-Control', 'no-cache');
    } });
  }
  app.setNotFoundHandler(async (req, reply) => {
    const url = req.url.split('?')[0] ?? '';
    if (url.startsWith('/api/') || url.startsWith('/socket.io')) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found', requestId: req.id } });
    if (root && req.method === 'GET') {
      const file = path.join(root, url);
      if (file.startsWith(root) && url !== '/' && fs.existsSync(file) && fs.statSync(file).isFile()) return reply.sendFile(url.slice(1));
      reply.header('Cache-Control', 'no-cache');
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found', requestId: req.id } });
  });

  return { app, routes };
}
