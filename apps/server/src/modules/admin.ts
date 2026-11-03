import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import { restoreSchema } from '@pickle/shared';
import type { Ctx } from '../context';
import { E } from '../lib/errors';
import { audit } from '../lib/audit';
import { actorOf } from '../auth';
import { backupPath, createBackup, deleteBackupFiles, listBackups, restoreFrom, testExtraPath } from '../backup';
import { randomToken } from '../lib/crypto';

export function registerAdminRoutes(app: FastifyInstance, ctx: Ctx): void {
  app.get('/api/v1/audit-logs', { config: { perm: 'audit.view' } }, async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const page = Math.max(1, Number(q.page ?? 1)); const pageSize = Math.min(200, Math.max(1, Number(q.pageSize ?? 50)));
    const where: string[] = []; const args: unknown[] = [];
    if (q.from) { where.push('a.occurred_at >= ?'); args.push(Date.parse(q.from)); }
    if (q.to) { where.push('a.occurred_at < ?'); args.push(Date.parse(q.to) + 86400_000); }
    if (q.action) { where.push('a.action LIKE ?'); args.push(`${q.action}%`); }
    if (q.entityType) { where.push('a.entity_type = ?'); args.push(q.entityType); }
    if (q.entityId) { where.push('a.entity_id = ?'); args.push(q.entityId); }
    if (q.actorUserId) { where.push('a.actor_user_id = ?'); args.push(Number(q.actorUserId)); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (ctx.db.prepare(`SELECT count(*) c FROM audit_logs a ${w}`).get(...args) as { c: number }).c;
    const rows = ctx.db.prepare(`SELECT a.id, a.occurred_at, a.actor_type, u.display_name actor, u.role actor_role, c.name actor_court, a.action, a.entity_type, a.entity_id, a.details_json, a.ip
      FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id LEFT JOIN courts c ON c.id = a.actor_court_id ${w} ORDER BY a.id DESC LIMIT ? OFFSET ?`).all(...args, pageSize, (page - 1) * pageSize) as any[];
    return { items: rows.map((r) => ({ id: r.id, at: r.occurred_at, actorType: r.actor_type, actor: r.actor, actorRole: r.actor_role, actorCourt: r.actor_court, action: r.action, entityType: r.entity_type, entityId: r.entity_id, details: r.details_json ? JSON.parse(r.details_json) : null, ip: r.ip })), page, pageSize, total };
  });

  app.get('/api/v1/backups', { config: { perm: 'backups.manage' } }, async () => listBackups(ctx));

  app.post('/api/v1/backups', { config: { perm: 'backups.manage' } }, async (req, reply) => {
    const b = await createBackup(ctx, 'manual');
    audit(ctx, { actor: actorOf(req), action: 'backup.create', entityType: 'backup', entityId: b.fileName, ip: req.ip });
    ctx.pub.invalidate(['dashboard']);
    reply.code(201);
    return b;
  });

  app.post('/api/v1/backups/test-extra-path', { config: { perm: 'backups.manage' } }, async (req) => {
    const p = (req.body as { path?: string } | undefined)?.path;
    if (!p) throw E.validation('A folder path is required');
    return testExtraPath(p);
  });

  app.get('/api/v1/backups/:fileName/download', { config: { perm: 'backups.manage' } }, async (req, reply) => {
    const file = backupPath(ctx, (req.params as { fileName: string }).fileName);
    reply.header('content-type', 'application/octet-stream').header('content-disposition', `attachment; filename="${path.basename(file)}"`);
    return reply.send(fs.createReadStream(file));
  });

  app.post('/api/v1/backups/:fileName/restore', { config: { perm: 'backups.manage' } }, async (req, reply) => {
    const body = restoreSchema.parse(req.body ?? {});
    const file = backupPath(ctx, (req.params as { fileName: string }).fileName);
    await restoreFrom(ctx, file, !!body.force);
    audit(ctx, { actor: 'system', action: 'backup.restore', entityType: 'backup', entityId: path.basename(file), details: { by: req.auth?.user.username ?? 'recovery' } });
    reply.code(202);
    return { restored: path.basename(file) };
  });

  app.post('/api/v1/backups/upload-restore', { config: { perm: 'backups.manage' } }, async (req, reply) => {
    const part = await (req as any).file();
    if (!part) throw E.validation('Choose a backup file');
    const tmp = path.join(ctx.config.dataDir, `upload-${randomToken(6)}.db`);
    try {
      await pipeline(part.file, fs.createWriteStream(tmp));
      const force = String((part.fields?.force as { value?: string } | undefined)?.value ?? '') === 'true';
      await restoreFrom(ctx, tmp, force);
    } finally { fs.rmSync(tmp, { force: true }); }
    audit(ctx, { actor: 'system', action: 'backup.restore_upload', entityType: 'backup', details: { by: req.auth?.user.username ?? 'recovery' } });
    reply.code(202);
    return { restored: 'uploaded file' };
  });

  app.delete('/api/v1/backups/:fileName', { config: { perm: 'backups.manage' } }, async (req, reply) => {
    deleteBackupFiles(ctx, (req.params as { fileName: string }).fileName);
    audit(ctx, { actor: actorOf(req), action: 'backup.delete', entityType: 'backup', entityId: (req.params as { fileName: string }).fileName, ip: req.ip });
    reply.code(204);
  });
}
