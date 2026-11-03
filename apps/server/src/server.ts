import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import pino, { type Logger } from 'pino';
import { loadConfig, lanAddresses, type Config } from './config';
import { Ctx } from './context';
import { openDb, migrate, seedPresets, latestMigrationId, type Db } from './db/client';
import { buildApp, type RouteInfo } from './app';
import { attachRealtime, type Realtime } from './realtime';
import { runStartupReview, startJobs } from './jobs';
import { registerOpenPlayHooks } from './modules/openplay';
import { randomSecret } from './lib/crypto';
import { createBackup } from './backup';
import type { FastifyInstance } from 'fastify';

export interface ServerOptions {
  config?: Partial<Config>;
  clock?: () => number;
  timeZone?: string;
  listen?: boolean;
  jobs?: boolean;
  logger?: Logger;
  onShutdown?: () => void;
}

export interface RunningServer {
  app: FastifyInstance; ctx: Ctx; routes: RouteInfo[]; rt: Realtime; url: string; close(): Promise<void>;
}

function makeLogger(config: Config): Logger {
  if (config.logLevel === 'silent') return pino({ level: 'silent' });
  const logDir = path.join(config.dataDir, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const d = new Date();
  const file = path.join(logDir, `pickle-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.log`);
  return pino({ level: config.logLevel, redact: ['req.headers.cookie', 'req.headers.authorization'] },
    pino.multistream([{ stream: process.stdout }, { stream: pino.destination({ dest: file, sync: false, mkdir: true }) }]));
}

function integrityOk(db: Db): { ok: boolean; detail?: string } {
  try {
    const r = db.pragma('quick_check', { simple: true });
    return r === 'ok' ? { ok: true } : { ok: false, detail: String(r) };
  } catch (e) { return { ok: false, detail: (e as Error).message }; }
}

/** SYSTEM_ARCHITECTURE §12 startup sequence. */
export async function createServer(opts: ServerOptions = {}): Promise<RunningServer> {
  const config = loadConfig(opts.config);
  const log = opts.logger ?? makeLogger(config);
  let db: Db;
  let ic: { ok: boolean; detail?: string };
  try { db = openDb(config.dbFile); ic = integrityOk(db); }
  catch (e) { db = new Database(':memory:'); ic = { ok: false, detail: (e as Error).message }; } // unreadable file → recovery mode on a placeholder handle
  const ctx = new Ctx(config, db, log, { clock: opts.clock, timeZone: opts.timeZone });
  if (!ic.ok) {
    ctx.recovery = { corrupt: true, detail: ic.detail };
    log.error({ detail: ic.detail }, 'database failed integrity check — starting in RECOVERY mode');
  } else {
    migrate(db, () => {
      try {
        db.pragma('wal_checkpoint(TRUNCATE)');
        const dir = path.join(config.dataDir, 'backups'); fs.mkdirSync(dir, { recursive: true });
        fs.copyFileSync(config.dbFile, path.join(dir, `pickle-${new Date().toISOString().replace(/\D/g, '').slice(0, 8)}-${new Date().toISOString().replace(/\D/g, '').slice(8, 14)}-pre_migration.db`));
      } catch (e) { log.warn({ err: e }, 'pre-migration backup failed'); }
    });
    seedPresets(db, ctx.now());
    runStartupReview(ctx);
  }

  registerOpenPlayHooks(ctx);
  const secretFile = path.join(config.dataDir, 'shutdown.secret');
  fs.writeFileSync(secretFile, randomSecret(), { mode: 0o600 });

  let closing: Promise<void> | null = null;
  let stopJobs = () => {};
  const server: Partial<RunningServer> = {};
  const { app, routes } = await buildApp(ctx, { onShutdown: opts.onShutdown ?? (() => { void server.close?.(); }) });
  const rt = attachRealtime(app, ctx);
  ctx.pub = rt;
  if (opts.jobs) stopJobs = startJobs(ctx);

  let url = '';
  if (opts.listen) {
    await app.listen({ port: config.port, host: config.host });
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : config.port;
    url = `http://localhost:${port}`;
    log.info({ port, urls: lanAddresses().map((a) => `http://${a}:${port}`), schema: latestMigrationId() }, 'Pickle Scoring is running');
  } else await app.ready();

  server.close = () => {
    closing ??= (async () => {
      stopJobs();
      try { rt.broadcast('server:shutdown', { reason: 'stop' }); } catch { /* ignore */ }
      await new Promise((r) => setTimeout(r, 50));
      await rt.close().catch(() => {});
      await app.close().catch(() => {});
      try { ctx.db.pragma('wal_checkpoint(TRUNCATE)'); ctx.db.close(); } catch { /* already closed */ }
      fs.rmSync(secretFile, { force: true });
    })();
    return closing;
  };
  Object.assign(server, { app, ctx, routes, rt, url });
  return server as RunningServer;
}

export { createBackup };
