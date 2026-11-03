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

  app.get('/api/v1/system/info', { config: { perm: 'settings.manage' } }, async (req) => {
    const port = ctx.config.port;
    const urls = lanAddresses().map((a) => `http://${a}:${port}`);
    const hostHeader = req.headers.host;
    const primary = urls[0] ?? (hostHeader ? `http://${hostHeader}` : `http://localhost:${port}`);
    let dbSize = 0;
    try { dbSize = fs.statSync(ctx.config.dbFile).size; } catch { /* ignore */ }
    return {
      facilityName: ctx.settings().facilityName, version: APP_VERSION, dataDir: ctx.config.dataDir, lanUrls: urls, primaryUrl: primary,
      qrSvg: await QRCode.toString(primary, { type: 'svg', margin: 1 }), node: process.version, platform: `${os.type()} ${os.release()}`,
      dbSizeBytes: dbSize, timeZone: ctx.timeZone, defaults: DEFAULT_SETTINGS.facilityName,
    };
  });
}
