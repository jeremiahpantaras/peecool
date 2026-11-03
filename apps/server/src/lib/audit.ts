import type { Ctx } from '../context';

export interface AuditInput {
  actor: { userId: number | null; courtId?: number | null } | 'system' | 'anonymous';
  action: string;
  entityType?: string;
  entityId?: string | number;
  details?: unknown;
  ip?: string | null;
}

export function audit(ctx: Ctx, a: AuditInput): void {
  const actorType = a.actor === 'system' ? 'system' : a.actor === 'anonymous' ? 'anonymous' : 'user';
  const userId = typeof a.actor === 'object' ? a.actor.userId : null;
  const courtId = typeof a.actor === 'object' ? a.actor.courtId ?? null : null;
  ctx.db.prepare(`INSERT INTO audit_logs (occurred_at, actor_type, actor_user_id, actor_court_id, action, entity_type, entity_id, details_json, ip)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    ctx.now(), actorType, userId, courtId, a.action, a.entityType ?? null, a.entityId != null ? String(a.entityId) : null,
    a.details === undefined ? null : JSON.stringify(a.details), a.ip ?? null,
  );
}
