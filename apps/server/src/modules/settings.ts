import { clientIp, recentDevices } from '../lib/seenDevices';
import os from 'node:os';
import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import QRCode from 'qrcode';
import { DEFAULT_SETTINGS, settingsSchema, type Settings } from '@pickle/shared';
import type { Ctx } from '../context';
import { audit } from '../lib/audit';
import { actorOf } from '../auth';
import { E } from '../lib/errors';
import { lanAddresses } from '../config';

export function setSetting(ctx: Ctx, key: keyof Settings, value: unknown, userId: number | null): void {
  ctx.db.prepare(`INSERT INTO system_settings (key, value_json, updated_at, updated_by_user_id) VALUES (?,?,?,?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at, updated_by_user_id = excluded.updated_by_user_id`)
    .run(key, JSON.stringify(value), ctx.now(), userId);
  ctx.invalidateSettings();
}

export const APP_VERSION = '1.0.0';

export function registerSettingsRoutes(app: FastifyInstance, ctx: Ctx): void {
  app.get('/api/v1/settings', { config: { perm: 'settings.manage' } }, async () => ctx.settings());

  app.patch('/api/v1/settings', { config: { perm: 'settings.manage' } }, async (req) => {
    const patch = settingsSchema.partial().parse(req.body);
    const before = ctx.settings();
    const next = settingsSchema.safeParse({ ...before, ...patch });
    if (!next.success) throw E.validation('Invalid settings', next.error.issues);
    const changed: Record<string, { before: unknown; after: unknown }> = {};
    ctx.tx(() => {
      for (const [k, v] of Object.entries(patch)) {
        if (JSON.stringify((before as Record<string, unknown>)[k]) === JSON.stringify(v)) continue;
        setSetting(ctx, k as keyof Settings, v, req.auth!.user.id);
        changed[k] = { before: (before as Record<string, unknown>)[k], after: v };
      }
    });
    if (Object.keys(changed).length) audit(ctx, { actor: actorOf(req), action: 'settings.update', entityType: 'settings', details: changed, ip: req.ip });
    ctx.pub.settingsUpdated();
    ctx.pub.invalidate(['settings', 'dashboard']);
    return ctx.settings();
  });

  /**
   * What a phone should open. The port is the one this browser used (behind the Vite dev server that is :5173, not the API's :8080).
   * The address is, best first: the one this browser is already using if it is a LAN address (a staff phone showing the QR to
   * another phone), then this PC's private network addresses.
   */
  const connectInfo = async (req: import('fastify').FastifyRequest) => {
    const m = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(req.headers.host ?? '');
    const hostName = m?.[1] ?? '';
    const hostPort = Number(m?.[2]);
    const port = Number.isInteger(hostPort) && hostPort > 0 ? hostPort : ctx.config.port;
    const urls = lanAddresses().map((a) => `http://${a}:${port}`);
    const isLanHost = /^\d+\.\d+\.\d+\.\d+$/.test(hostName) && !hostName.startsWith('127.') && !hostName.startsWith('169.254.');
    if (isLanHost) { const own = `http://${hostName}:${port}`; urls.splice(0, urls.length, own, ...urls.filter((u) => u !== own)); }
    const primary = urls[0] ?? (req.headers.host ? `http://${req.headers.host}` : `http://localhost:${port}`);
    return {
      facilityName: ctx.settings().facilityName, lanUrls: urls, primaryUrl: primary, port,
      /** the app was opened through the development server, not the server's own port (so :8080 itself would show no app) */
      viaDevServer: port !== ctx.config.port,
      qrSvg: await QRCode.toString(primary, { type: 'svg', margin: 1 }),
      /** other devices that reached this server in the last 30 minutes (so a phone that opens the address shows up here) */
      devices: recentDevices(ctx.now()).map((d) => ({ ...d, you: d.ip === clientIp(req.ip, req.headers['x-forwarded-for']) })),
    };
  };

  /** Admin and Staff: the address and QR code for connecting a phone or tablet. */
  app.get('/api/v1/system/connect', { config: { perm: 'devices.connect' } }, async (req) => connectInfo(req));

  app.get('/api/v1/system/info', { config: { perm: 'settings.manage' } }, async (req) => {
    let dbSize = 0;
    try { dbSize = fs.statSync(ctx.config.dbFile).size; } catch { /* ignore */ }
    return {
      ...(await connectInfo(req)), version: APP_VERSION, dataDir: ctx.config.dataDir, node: process.version, platform: `${os.type()} ${os.release()}`,
      dbSizeBytes: dbSize, timeZone: ctx.timeZone, defaults: DEFAULT_SETTINGS.facilityName,
    };
  });
}
