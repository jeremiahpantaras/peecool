import type { FastifyInstance } from 'fastify';
import { idParam, patchPresetSchema, presetSchema, validateRules, type MatchRules } from '@pickle/shared';
import type { Ctx } from '../context';
import { AppError, E } from '../lib/errors';
import { audit } from '../lib/audit';
import { actorOf } from '../auth';
import { presetRules } from './matches';

interface Row {
  id: number; name: string; scoring_type: MatchRules['scoringType']; serving_mode: MatchRules['servingMode']; points_to_win: number; win_by: 1 | 2;
  point_cap: number | null; games_to_win: 1 | 2 | 3; deciding_game_points: number | null; first_server_rule: MatchRules['firstServerRule'];
  switch_ends_prompt: MatchRules['switchEndsPrompt']; time_limit_minutes: number | null; track_server_names: number; is_default: number; is_active: number; display_order: number;
}
const dto = (ctx: Ctx, r: Row) => ({
  id: r.id, name: r.name, rules: presetRules(r as never), isDefault: !!r.is_active && !!r.is_default, isActive: !!r.is_active, displayOrder: r.display_order,
  used: !!ctx.db.prepare('SELECT 1 FROM matches WHERE format_id = ? LIMIT 1').get(r.id),
});

function assertRules(rules: MatchRules): void {
  const issues = validateRules('doubles', rules);
  if (issues.length) throw new AppError('INVALID_RULES', 422, issues.map((i) => i.message).join('; '), { issues });
}

function cols(name: string, r: MatchRules) {
  return { name, st: r.scoringType, sm: r.servingMode, ptw: r.pointsToWin, wb: r.winBy, cap: r.pointCap, gtw: r.gamesToWin, dgp: r.decidingGamePoints, fsr: r.firstServerRule, sep: r.switchEndsPrompt, tl: r.timeLimitMinutes, tsn: r.trackServerNames ? 1 : 0 };
}

export function registerFormatRoutes(app: FastifyInstance, ctx: Ctx): void {
  app.get('/api/v1/formats', { config: { perm: 'formats.select' } }, async (req) => {
    const inc = (req.query as { includeInactive?: string }).includeInactive === 'true' && req.auth!.user.role === 'admin';
    const rows = ctx.db.prepare(`SELECT * FROM match_formats ${inc ? '' : 'WHERE is_active = 1'} ORDER BY display_order, id`).all() as Row[];
    return rows.map((r) => dto(ctx, r));
  });

  app.post('/api/v1/formats', { config: { perm: 'formats.manage' } }, async (req, reply) => {
    const body = presetSchema.parse(req.body);
    assertRules(body.rules);
    const c = cols(body.name, body.rules); const now = ctx.now();
    try {
      const ord = (ctx.db.prepare('SELECT COALESCE(MAX(display_order),-1)+1 o FROM match_formats').get() as { o: number }).o;
      const r = ctx.db.prepare(`INSERT INTO match_formats (name, scoring_type, serving_mode, points_to_win, win_by, point_cap, games_to_win, deciding_game_points, first_server_rule,
        switch_ends_prompt, time_limit_minutes, track_server_names, is_default, is_active, display_order, created_at, updated_at) VALUES (@name,@st,@sm,@ptw,@wb,@cap,@gtw,@dgp,@fsr,@sep,@tl,@tsn,0,1,${ord},${now},${now})`).run(c);
      audit(ctx, { actor: actorOf(req), action: 'format.create', entityType: 'format', entityId: Number(r.lastInsertRowid), ip: req.ip });
      reply.code(201);
      return dto(ctx, ctx.db.prepare('SELECT * FROM match_formats WHERE id = ?').get(r.lastInsertRowid) as Row);
    } catch (e) {
      if (e instanceof Error && /UNIQUE/.test(e.message)) throw E.conflict('DUPLICATE_NAME', 'A preset with that name already exists');
      throw e;
    }
  });

  app.patch('/api/v1/formats/:id', { config: { perm: 'formats.manage' } }, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = patchPresetSchema.parse(req.body);
    const cur = ctx.db.prepare('SELECT * FROM match_formats WHERE id = ?').get(id) as Row | undefined;
    if (!cur) throw E.notFound('Preset not found');
    const rules = body.rules ?? presetRules(cur as never);
    assertRules(rules);
    if (body.isActive === false && cur.is_default) throw E.validation('Choose another default preset before hiding this one');
    const c = cols(body.name ?? cur.name, rules);
    try {
      ctx.db.prepare(`UPDATE match_formats SET name=@name, scoring_type=@st, serving_mode=@sm, points_to_win=@ptw, win_by=@wb, point_cap=@cap, games_to_win=@gtw,
        deciding_game_points=@dgp, first_server_rule=@fsr, switch_ends_prompt=@sep, time_limit_minutes=@tl, track_server_names=@tsn, is_active=${body.isActive === undefined ? cur.is_active : body.isActive ? 1 : 0}, updated_at=${ctx.now()} WHERE id=${id}`).run(c);
    } catch (e) {
      if (e instanceof Error && /UNIQUE/.test(e.message)) throw E.conflict('DUPLICATE_NAME', 'A preset with that name already exists');
      throw e;
    }
    audit(ctx, { actor: actorOf(req), action: 'format.update', entityType: 'format', entityId: id, ip: req.ip });
    return dto(ctx, ctx.db.prepare('SELECT * FROM match_formats WHERE id = ?').get(id) as Row);
  });

  app.post('/api/v1/formats/:id/make-default', { config: { perm: 'formats.manage' } }, async (req) => {
    const { id } = idParam.parse(req.params);
    const cur = ctx.db.prepare('SELECT * FROM match_formats WHERE id = ?').get(id) as Row | undefined;
    if (!cur) throw E.notFound('Preset not found');
    ctx.tx(() => { ctx.db.prepare('UPDATE match_formats SET is_default = 0 WHERE is_default = 1').run(); ctx.db.prepare('UPDATE match_formats SET is_default = 1, is_active = 1 WHERE id = ?').run(id); });
    audit(ctx, { actor: actorOf(req), action: 'format.make_default', entityType: 'format', entityId: id, ip: req.ip });
    return dto(ctx, ctx.db.prepare('SELECT * FROM match_formats WHERE id = ?').get(id) as Row);
  });

  app.delete('/api/v1/formats/:id', { config: { perm: 'formats.manage' } }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const cur = ctx.db.prepare('SELECT * FROM match_formats WHERE id = ?').get(id) as Row | undefined;
    if (!cur) throw E.notFound('Preset not found');
    if (cur.is_default) throw E.validation('The default preset cannot be deleted');
    if (ctx.db.prepare('SELECT 1 FROM matches WHERE format_id = ? LIMIT 1').get(id)) throw E.conflict('ACTIVE_MATCHES_EXIST', 'This preset has been used; hide it instead');
    ctx.db.prepare('DELETE FROM match_formats WHERE id = ?').run(id);
    audit(ctx, { actor: actorOf(req), action: 'format.delete', entityType: 'format', entityId: id, ip: req.ip });
    reply.code(204);
  });
}
