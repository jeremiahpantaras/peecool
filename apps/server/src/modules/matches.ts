import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  EngineError, applyEvent, applyOverrides, applyUndo, can, commandSchema, correctionSchema, createInitialState, createMatchSchema,
  defaultPlayerLabel, finishedPlayersSchema, formatMatchCode, idParam, localDate, normalizeTypedName, payloadSchemas, rulesEqual,
  validateRules, type CommandType, type CourtSnapshot, type EngineEvent, type EventType, type MatchConfig, type MatchRules,
  type MatchState, type PlayType, type Slot, type SlotPlayerInput, type Team,
} from '@pickle/shared';
import type { Ctx } from '../context';
import { AppError, E } from '../lib/errors';
import { audit } from '../lib/audit';
import { actorOf } from '../auth';
import { toCsv } from '../lib/csv';
import {
  buildCourtSnapshot, buildMatchSnapshot, configOf, loadEvents, loadMatchRow, loadState, rulesOf, type MatchRow,
} from '../snapshots';

type Actor = { userId: number; courtId: number | null } | 'system';
const ACTIVE = "('setup','in_progress','paused')";

/* ------------------------------------------------------------------ presets */

interface PresetRow {
  id: number; name: string; scoring_type: MatchRules['scoringType']; serving_mode: MatchRules['servingMode']; points_to_win: number; win_by: 1 | 2;
  point_cap: number | null; games_to_win: 1 | 2 | 3; deciding_game_points: number | null; first_server_rule: MatchRules['firstServerRule'];
  switch_ends_prompt: MatchRules['switchEndsPrompt']; time_limit_minutes: number | null; track_server_names: number; is_default: number; is_active: number;
}
export const presetRules = (p: PresetRow): MatchRules => ({
  scoringType: p.scoring_type, servingMode: p.serving_mode, pointsToWin: p.points_to_win, winBy: p.win_by, pointCap: p.point_cap,
  gamesToWin: p.games_to_win, decidingGamePoints: p.deciding_game_points, firstServerRule: p.first_server_rule,
  switchEndsPrompt: p.switch_ends_prompt, timeLimitMinutes: p.time_limit_minutes, trackServerNames: !!p.track_server_names,
});

function loadPreset(ctx: Ctx, formatId?: number): PresetRow {
  const p = (formatId
    ? ctx.db.prepare('SELECT * FROM match_formats WHERE id = ?').get(formatId)
    : ctx.db.prepare('SELECT * FROM match_formats WHERE is_default = 1').get()) as PresetRow | undefined;
  if (!p) throw E.validation('Rule preset not found');
  if (!p.is_active) throw E.validation('That rule preset is hidden');
  return p;
}

function resolveRules(ctx: Ctx, playType: PlayType, formatId: number | undefined, overrides: unknown, force = false): { rules: MatchRules; preset: PresetRow; customized: boolean } {
  const preset = loadPreset(ctx, formatId);
  const base = presetRules(preset);
  const hasOverrides = !!overrides && Object.keys(overrides as object).length > 0;
  if (hasOverrides && !force && !ctx.settings().allowRuleOverrides) throw new AppError('FORBIDDEN', 403, 'Custom rules are turned off');
  const rules = applyOverrides(base, overrides as Partial<MatchRules>);
  const issues = validateRules(playType, rules);
  if (issues.length) throw new AppError('INVALID_RULES', 422, issues.map((i) => i.message).join('; '), { issues });
  return { rules, preset, customized: !rulesEqual(rules, base) };
}

/* ------------------------------------------------------------------ players */

interface ResolvedSlot { team: Team; slot: Slot; playerId: number | null; displayName: string | null }

function resolveSlots(ctx: Ctx, playType: PlayType, input: SlotPlayerInput[] | undefined): ResolvedSlot[] {
  const per = playType === 'singles' ? 1 : 2;
  const out: ResolvedSlot[] = [];
  for (const team of ['A', 'B'] as Team[]) for (let s = 1; s <= per; s++) out.push({ team, slot: s as Slot, playerId: null, displayName: null });
  for (const p of input ?? []) {
    const target = out.find((o) => o.team === p.team && o.slot === p.slot);
    if (!target) throw E.validation(`Slot ${p.team}${p.slot} does not exist in a ${playType} match`);
    if (p.playerId) {
      const pl = ctx.db.prepare('SELECT id, display_name, is_active FROM players WHERE id = ?').get(p.playerId) as { id: number; display_name: string; is_active: number } | undefined;
      if (!pl) throw E.validation('Player not found');
      target.playerId = pl.id; target.displayName = pl.display_name;
    } else target.displayName = normalizeTypedName(p.displayName ?? null);
  }
  const ids = out.filter((o) => o.playerId).map((o) => o.playerId);
  if (new Set(ids).size !== ids.length) throw E.validation('The same player cannot be in two slots');
  return out;
}

function writeSlots(ctx: Ctx, matchId: number, slots: ResolvedSlot[]): void {
  const up = ctx.db.prepare(`INSERT INTO match_players (match_id, team, slot, player_id, display_name) VALUES (?,?,?,?,?)
    ON CONFLICT(match_id, team, slot) DO UPDATE SET player_id = excluded.player_id, display_name = excluded.display_name`);
  for (const s of slots) up.run(matchId, s.team, s.slot, s.playerId, s.displayName);
}

/** FR-PLAYER-09: same directory player in another active match → warning (never a block). */
function duplicateWarnings(ctx: Ctx, matchId: number, slots: ResolvedSlot[]): string[] {
  const w: string[] = [];
  for (const s of slots) {
    if (!s.playerId) continue;
    const r = ctx.db.prepare(`SELECT c.name FROM match_players mp JOIN matches m ON m.id = mp.match_id JOIN courts c ON c.id = m.court_id
      WHERE mp.player_id = ? AND m.id <> ? AND m.status IN ${ACTIVE} LIMIT 1`).get(s.playerId, matchId) as { name: string } | undefined;
    if (r) w.push(`${s.displayName} is also in an active match on ${r.name}`);
  }
  return w;
}

/* ------------------------------------------------------------------ create */

export function courtHeldByOpenPlay(ctx: Ctx, courtId: number): { sessionId: number; name: string } | null {
  const r = ctx.db.prepare(`SELECT s.id, s.name FROM open_play_courts oc JOIN open_play_sessions s ON s.id = oc.session_id
    WHERE oc.court_id = ? AND s.status IN ('running','ending') LIMIT 1`).get(courtId) as { id: number; name: string } | undefined;
  return r ? { sessionId: r.id, name: r.name } : null;
}

/** `opts.openPlayRoundId` marks a game created by an Open Play session: it may use held courts and skips booking prompts and the rule-override setting. */
export function createMatch(ctx: Ctx, actor: { userId: number; courtId: number | null }, raw: unknown, opts: { openPlayRoundId?: number } = {}): { snapshot: CourtSnapshot; warnings: string[] } {
  const body = createMatchSchema.parse(raw);
  const court = ctx.db.prepare('SELECT * FROM courts WHERE id = ?').get(body.courtId) as
    { id: number; name: string; short_code: string; is_active: number; maintenance_mode: number } | undefined;
  if (!court) throw E.notFound('Court not found', 'COURT_NOT_FOUND');
  if (body.clientRequestId) {
    const prev = ctx.db.prepare('SELECT match_id FROM create_requests WHERE user_id = ? AND client_request_id = ? AND created_at > ?')
      .get(actor.userId, body.clientRequestId, ctx.now() - 600_000) as { match_id: number } | undefined;
    if (prev) return { snapshot: buildCourtSnapshot(ctx, body.courtId)!, warnings: [] };
  }
  if (!court.is_active || court.maintenance_mode) throw E.conflict('COURT_UNAVAILABLE', `${court.name} is ${court.is_active ? 'under maintenance' : 'not in service'}`);
  if (opts.openPlayRoundId == null) {
    const held = courtHeldByOpenPlay(ctx, court.id);
    if (held) throw E.conflict('COURT_IN_OPEN_PLAY', `${court.name} is being used by the Open Play session “${held.name}”`, { sessionId: held.sessionId });
  }
  const { rules, preset, customized } = resolveRules(ctx, body.playType, body.formatId, body.ruleOverrides, opts.openPlayRoundId != null);
  const slots = resolveSlots(ctx, body.playType, body.players);
  const now = ctx.now();
  const settings = ctx.settings();

  const matchId = ctx.tx(() => {
    if (ctx.db.prepare(`SELECT 1 FROM matches WHERE court_id = ? AND status IN ${ACTIVE}`).get(court.id))
      throw E.conflict('COURT_BUSY', `${court.name} already has a match`);
    // booking link / warning handshake (FR-BOOK-07/08)
    let bookingId: number | null = null;
    let bookingOverride = false;
    if (opts.openPlayRoundId != null) { /* Open Play games never prompt about reservations */ }
    else if (body.bookingId) {
      const b = ctx.db.prepare("SELECT id, court_id, status FROM bookings WHERE id = ?").get(body.bookingId) as { id: number; court_id: number; status: string } | undefined;
      if (!b || b.court_id !== court.id || b.status !== 'confirmed') throw E.validation('That booking cannot be linked to this match');
      bookingId = b.id;
    } else {
      const warnMs = settings.bookingWarnMinutes * 60_000;
      const conflict = ctx.db.prepare(`SELECT b.id, b.booked_by_name, b.start_at, b.end_at, b.booking_code FROM bookings b WHERE b.court_id = ? AND b.status = 'confirmed'
        AND b.end_at > ? AND b.start_at <= ? ORDER BY b.start_at LIMIT 1`).get(court.id, now, now + warnMs) as { id: number; booked_by_name: string; start_at: number; end_at: number; booking_code: string } | undefined;
      if (conflict) {
        if (!body.acknowledgeBooking) throw E.conflict('BOOKING_WARNING', `${court.name} is reserved by ${conflict.booked_by_name}`, { booking: conflict });
        bookingOverride = true;
      }
    }
    const date = localDate(now, ctx.timeZone);
    let seq = (ctx.db.prepare('SELECT count(*) c FROM matches WHERE court_id = ? AND play_date = ?').get(court.id, date) as { c: number }).c + 1;
    let code = formatMatchCode(date, court.short_code, seq);
    while (ctx.db.prepare('SELECT 1 FROM matches WHERE match_code = ?').get(code)) code = formatMatchCode(date, court.short_code, ++seq);
    const state = createInitialState();
    const r = ctx.db.prepare(`INSERT INTO matches (match_code, court_id, format_id, booking_id, format_name, rules_customized, play_type, scoring_type, serving_mode,
        points_to_win, win_by, point_cap, games_to_win, deciding_game_points, first_server_rule, switch_ends_prompt, time_limit_minutes, track_server_names,
        team_a_name, team_b_name, status, version, state_json, created_at, play_date, last_event_at, created_by_user_id, created_on_court_id, updated_at, open_play_round_id)
      VALUES (@code,@court,@format,@booking,@fname,@cust,@pt,@st,@sm,@ptw,@wb,@cap,@gtw,@dgp,@fsr,@sep,@tl,@tsn,@ta,@tb,'setup',1,@state,@now,@date,@now,@user,@ucourt,@now,@oprid)`).run({
      oprid: opts.openPlayRoundId ?? null,
      code, court: court.id, format: preset.id, booking: bookingId, fname: customized ? `${preset.name} (custom)` : preset.name, cust: customized ? 1 : 0, pt: body.playType,
      st: rules.scoringType, sm: rules.servingMode, ptw: rules.pointsToWin, wb: rules.winBy, cap: rules.pointCap, gtw: rules.gamesToWin, dgp: rules.decidingGamePoints,
      fsr: rules.firstServerRule, sep: rules.switchEndsPrompt, tl: rules.timeLimitMinutes, tsn: rules.trackServerNames ? 1 : 0,
      ta: (body.teamAName ?? '').trim() || 'Team A', tb: (body.teamBName ?? '').trim() || 'Team B', state: JSON.stringify(state), now, date,
      user: actor.userId, ucourt: actor.courtId,
    });
    const id = Number(r.lastInsertRowid);
    writeSlots(ctx, id, slots);
    ctx.db.prepare(`INSERT INTO match_events (match_id, seq, command_id, type, payload_json, actor_type, actor_user_id, actor_court_id, at, created_at)
      VALUES (?,1,?,?,?,'user',?,?,?,?)`).run(id, `create-${id}`, 'MATCH_CREATED', JSON.stringify({ playType: body.playType, rules, bookingId, bookingOverride }), actor.userId, actor.courtId, now, now);
    if (body.clientRequestId) ctx.db.prepare('INSERT OR REPLACE INTO create_requests (user_id, client_request_id, match_id, created_at) VALUES (?,?,?,?)').run(actor.userId, body.clientRequestId, id, now);
    return id;
  });
  const warnings = duplicateWarnings(ctx, matchId, slots);
  audit(ctx, { actor: actor, action: 'match.create', entityType: 'match', entityId: matchId, details: { court: court.name, playType: body.playType, preset: preset.name, customized }, ip: null });
  ctx.pub.activity({ kind: 'match_created', courtId: court.id, matchId, text: `${court.name}: new ${body.playType} match` });
  ctx.pub.invalidate(['courts', 'dashboard', 'matches']); ctx.pub.publishCourt(court.id);
  return { snapshot: buildCourtSnapshot(ctx, court.id)!, warnings };
}

/* ----------------------------------------------------------------- command */

function mapEngineError(e: unknown, snapshot: () => CourtSnapshot | null): never {
  if (e instanceof EngineError) {
    const extra = { snapshot: snapshot() };
    switch (e.code) {
      case 'INVALID_STATE': throw new AppError('INVALID_STATE', 409, e.message, e.details, extra);
      case 'NOTHING_TO_UNDO': throw new AppError('NOTHING_TO_UNDO', 409, e.message, e.details, extra);
      case 'ADJUST_WOULD_END_GAME': throw new AppError('ADJUST_WOULD_END_GAME', 422, e.message, e.details);
      case 'INVALID_CORRECTION': throw new AppError('INVALID_CORRECTION', 422, e.message, e.details);
      default: throw new AppError('VALIDATION_ERROR', 422, e.message, e.details);
    }
  }
  throw e;
}

function describeEvent(type: EventType, p: Record<string, any>, outcome: string | null): string {
  switch (type) {
    case 'MATCH_CREATED': return 'Match created';
    case 'START_MATCH': return p.servingTeam ? `Match started, Team ${p.servingTeam} serving` : 'Match started';
    case 'RALLY_WON': return `Rally → Team ${p.team}${outcome ? ` (${outcome.replace(/_/g, ' ')})` : ''}`;
    case 'UNDO': return 'Undo';
    case 'ADJUST_SCORE': return `Score adjusted to ${p.scoreA}–${p.scoreB}${p.reason ? ` (${p.reason})` : ''}`;
    case 'START_NEXT_GAME': return 'Next game started';
    case 'PAUSE': return `Paused${p.reason ? ` (${p.reason})` : ''}`;
    case 'RESUME': return 'Resumed';
    case 'SWAP_SIDES': return 'Sides swapped';
    case 'UPDATE_PLAYERS': return 'Names updated';
    case 'UPDATE_RULES': return 'Match type / rules changed';
    case 'CONFIRM_MATCH_END': return 'Result confirmed';
    case 'END_MATCH': return `Ended early – ${String(p.reason).replace(/_/g, ' ')}${p.note ? `: ${p.note}` : ''}`;
    case 'CANCEL': return 'Match cancelled';
    case 'ADMIN_CORRECTION': return `Result corrected: ${p.reason}`;
    case 'TIME_UP': return 'Time is up';
    case 'RECORD_RESULT': return `Result recorded${p.scoreA != null ? `: ${p.scoreA}–${p.scoreB}` : ''}`;
  }
}
export { describeEvent };

export interface PipelineBody { commandId: string; expectedVersion: number; type: CommandType | 'ADMIN_CORRECTION' | 'TIME_UP'; payload: Record<string, any> }
export interface CommandResult { snapshot: CourtSnapshot; event: { seq: number; type: string; outcome: string | null }; duplicate: boolean; warnings: string[] }

/** Applies one command through the pipeline of MATCH_SCORING_LOGIC §10. */
export function runCommand(ctx: Ctx, matchId: number, actor: Actor, body: PipelineBody): CommandResult {
  const m0 = loadMatchRow(ctx, matchId);
  if (!m0) throw E.notFound('Match not found', 'MATCH_NOT_FOUND');
  const snapshotOf = () => buildCourtSnapshot(ctx, m0.court_id);
  let warnings: string[] = [];
  let publishedCourt = m0.court_id;

  const result = ctx.tx<CommandResult>(() => {
    const m = loadMatchRow(ctx, matchId)!;
    const dup = ctx.db.prepare('SELECT seq, type, outcome FROM match_events WHERE match_id = ? AND command_id = ?').get(matchId, body.commandId) as { seq: number; type: string; outcome: string | null } | undefined;
    if (dup) return { snapshot: snapshotOf()!, event: { seq: dup.seq, type: dup.type, outcome: dup.outcome }, duplicate: true, warnings: [] };
    if (m.version !== body.expectedVersion)
      throw new AppError('VERSION_CONFLICT', 409, 'The match was updated by someone else', { currentVersion: m.version }, { snapshot: snapshotOf() });

    if (body.type === 'RECORD_RESULT' && m.open_play_round_id == null) throw new AppError('INVALID_STATE', 409, 'Recording a result is only available in Open Play games');
    const cfg = configOf(m);
    const state = loadState(ctx, m);
    const at = ctx.now();
    const seq = m.version + 1;
    const type = body.type;
    const payload = body.payload ?? {};
    let next: MatchState;
    let eventPayload: Record<string, any> = payload;
    let undoTarget: EngineEvent | null = null;

    try {
      if (type === 'UNDO') {
        const r = applyUndo(state, loadEvents(ctx, matchId), cfg, seq, at);
        next = r.state; undoTarget = r.voided;
      } else {
        const ev: EngineEvent = { seq, type, payload, at };
        next = applyEvent(state, ev, cfg);
      }
    } catch (e) { mapEngineError(e, snapshotOf); }

    // side effects that live outside the engine
    let updatedCfg: MatchConfig = cfg;
    if (type === 'UPDATE_PLAYERS') {
      const slots = resolveSlots(ctx, m.play_type, readCurrentSlots(ctx, m, payload.players));
      writeSlots(ctx, matchId, slots);
      if (payload.teamAName !== undefined || payload.teamBName !== undefined)
        ctx.db.prepare('UPDATE matches SET team_a_name = ?, team_b_name = ? WHERE id = ?').run(
          ((payload.teamAName ?? m.team_a_name) as string).trim() || 'Team A', ((payload.teamBName ?? m.team_b_name) as string).trim() || 'Team B', matchId);
      warnings = duplicateWarnings(ctx, matchId, slots);
    }
    if (type === 'UPDATE_RULES') {
      const playType = (payload.playType ?? m.play_type) as PlayType;
      const { rules, preset, customized } = resolveRules(ctx, playType, payload.formatId ?? m.format_id ?? undefined, payload.ruleOverrides ?? (payload.formatId ? undefined : diffFromPreset(ctx, m)));
      ctx.db.prepare(`UPDATE matches SET play_type=?, format_id=?, format_name=?, rules_customized=?, scoring_type=?, serving_mode=?, points_to_win=?, win_by=?, point_cap=?,
        games_to_win=?, deciding_game_points=?, first_server_rule=?, switch_ends_prompt=?, time_limit_minutes=?, track_server_names=? WHERE id=?`).run(
        playType, preset.id, customized ? `${preset.name} (custom)` : preset.name, customized ? 1 : 0, rules.scoringType, rules.servingMode, rules.pointsToWin, rules.winBy, rules.pointCap,
        rules.gamesToWin, rules.decidingGamePoints, rules.firstServerRule, rules.switchEndsPrompt, rules.timeLimitMinutes, rules.trackServerNames ? 1 : 0, matchId);
      if (playType !== m.play_type) {
        if (playType === 'singles') ctx.db.prepare('DELETE FROM match_players WHERE match_id = ? AND slot = 2').run(matchId);
        else for (const t of ['A', 'B']) ctx.db.prepare('INSERT OR IGNORE INTO match_players (match_id, team, slot) VALUES (?,?,2)').run(matchId, t);
      }
      updatedCfg = { playType, rules };
      eventPayload = { playType, rules, customized };
    }
    void updatedCfg;

    const g = next.games.at(-1) ?? null;
    const outcome = next.lastAction?.outcome ?? null;
    const ins = ctx.db.prepare(`INSERT INTO match_events (match_id, seq, command_id, type, payload_json, game_number, score_a_after, score_b_after, serving_team_after,
        server_number_after, outcome, undoes_event_id, actor_type, actor_user_id, actor_court_id, at, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      matchId, seq, body.commandId, type, JSON.stringify(eventPayload), g?.number ?? null, g?.score.A ?? null, g?.score.B ?? null,
      next.servingTeam, next.serverNumber, typeof outcome === 'string' ? outcome : null,
      undoTarget ? (ctx.db.prepare('SELECT id FROM match_events WHERE match_id = ? AND seq = ?').get(matchId, undoTarget.seq) as { id: number }).id : null,
      actor === 'system' ? 'system' : 'user', actor === 'system' ? null : actor.userId, actor === 'system' ? null : actor.courtId, at, at);
    if (undoTarget) ctx.db.prepare('UPDATE match_events SET voided_by_event_id = ? WHERE match_id = ? AND seq = ?').run(ins.lastInsertRowid, matchId, undoTarget.seq);

    persistState(ctx, m, next, seq, at, type, actor, payload);
    if (type === 'UPDATE_PLAYERS' || type === 'UPDATE_RULES') { /* snapshot built fresh below */ }
    return { snapshot: null as unknown as CourtSnapshot, event: { seq, type, outcome: typeof outcome === 'string' ? outcome : null }, duplicate: false, warnings };
  });

  if (!result.duplicate) {
    result.snapshot = buildCourtSnapshot(ctx, publishedCourt)!;
    ctx.pub.publishCourt(publishedCourt);
    ctx.pub.invalidate(['courts', 'dashboard', 'matches']);
    activityFor(ctx, m0, body.type, body.payload ?? {}, result.snapshot);
    if (m0.open_play_round_id != null) ctx.onMatchChanged?.(matchId);
    if (body.type === 'END_MATCH' || body.type === 'ADMIN_CORRECTION' || body.type === 'CANCEL')
      audit(ctx, { actor: actor === 'system' ? 'system' : actor, action: body.type === 'END_MATCH' ? 'match.end' : body.type === 'CANCEL' ? 'match.cancel' : 'match.correct',
        entityType: 'match', entityId: matchId, details: body.type === 'ADMIN_CORRECTION' ? { reason: body.payload.reason, games: body.payload.games } : body.payload });
  }
  return result;
}

/** Fill unspecified slots from the payload only (UPDATE_PLAYERS touches just what it lists). */
function readCurrentSlots(ctx: Ctx, m: MatchRow, incoming: SlotPlayerInput[] | undefined): SlotPlayerInput[] {
  const cur = ctx.db.prepare('SELECT team, slot, player_id, display_name FROM match_players WHERE match_id = ?').all(m.id) as { team: Team; slot: Slot; player_id: number | null; display_name: string | null }[];
  const merged = new Map<string, SlotPlayerInput>();
  for (const c of cur) merged.set(`${c.team}${c.slot}`, { team: c.team, slot: c.slot, playerId: c.player_id, displayName: c.display_name });
  for (const p of incoming ?? []) merged.set(`${p.team}${p.slot}`, p);
  return [...merged.values()];
}

function diffFromPreset(ctx: Ctx, m: MatchRow): Partial<MatchRules> | undefined {
  // keep customised values when only the match type changes
  if (!m.rules_customized || !m.format_id) return undefined;
  const p = ctx.db.prepare('SELECT * FROM match_formats WHERE id = ?').get(m.format_id) as PresetRow | undefined;
  if (!p) return rulesOf(m);
  const base = presetRules(p), cur = rulesOf(m);
  const d: Record<string, unknown> = {};
  for (const k of Object.keys(base) as (keyof MatchRules)[]) if (base[k] !== cur[k]) d[k] = cur[k];
  return d as Partial<MatchRules>;
}

function persistState(ctx: Ctx, m: MatchRow, s: MatchState, seq: number, at: number, type: string, actor: Actor, payload: Record<string, any>): void {
  const started = s.timer.startedAt;
  const finished = s.status === 'completed' || s.status === 'terminated';
  const endReason = s.status === 'terminated' ? s.endReason : s.status === 'completed' ? 'completed' : null;
  const date = started && type === 'START_MATCH' ? localDate(started, ctx.timeZone) : m.play_date;
  ctx.db.prepare(`UPDATE matches SET status=@status, phase=@phase, phase_changed_at=@pca, version=@v, state_json=@state, started_at=@started, ended_at=@ended,
      paused_at=@paused, paused_total_ms=@ptm, play_date=@date, last_event_at=@at, games_won_a=@ga, games_won_b=@gb, winner_team=@winner,
      end_reason=@reason, end_note=@note, needs_review=0, ended_by_user_id=@endedBy, corrected_at=@corrected, updated_at=@at WHERE id=@id`).run({
    status: s.status, phase: s.status === 'in_progress' || s.status === 'paused' ? s.phase : null, pca: s.phaseChangedAt, v: seq,
    state: JSON.stringify(s), started, ended: s.timer.endedAt, paused: s.timer.pausedAt, ptm: s.timer.pausedTotalMs, date, at,
    ga: s.gamesWon.A, gb: s.gamesWon.B, winner: s.winner, reason: endReason, note: s.status === 'terminated' ? s.endNote : null,
    endedBy: finished && actor !== 'system' ? actor.userId : (finished ? null : m.ended_by_user_id), corrected: type === 'ADMIN_CORRECTION' ? at : m.corrected_at, id: m.id,
  });
  void payload;
  // mirror games
  ctx.db.prepare('DELETE FROM match_games WHERE match_id = ? AND game_number > ?').run(m.id, s.games.length);
  const up = ctx.db.prepare(`INSERT INTO match_games (match_id, game_number, points_to_win, score_a, score_b, first_serving_team, status, winner_team, started_at, ended_at)
    VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(match_id, game_number) DO UPDATE SET points_to_win=excluded.points_to_win, score_a=excluded.score_a, score_b=excluded.score_b,
    first_serving_team=excluded.first_serving_team, status=excluded.status, winner_team=excluded.winner_team, started_at=excluded.started_at, ended_at=excluded.ended_at`);
  for (const g of s.games) up.run(m.id, g.number, g.target, g.score.A, g.score.B, g.firstServingTeam, g.winner ? 'completed' : g.abandoned ? 'abandoned' : 'in_progress', g.winner, g.startedAt, g.endedAt);
}

function activityFor(ctx: Ctx, m: MatchRow, type: string, payload: Record<string, any>, snap: CourtSnapshot): void {
  const name = snap.court.name;
  const mm = snap.match;
  const push = (kind: string, text: string) => ctx.pub.activity({ kind, courtId: m.court_id, matchId: m.id, text });
  if (type === 'START_MATCH') push('match_started', `${name}: match started`);
  else if (type === 'RALLY_WON' && mm?.lastAction && payload.team) {
    if (mm.status === 'in_progress' && mm.phase === 'game_over') push('game_won', `${name}: game ${mm.current.gameNumber} won by Team ${mm.games.at(-1)?.winner}`);
    else if (mm.phase === 'match_over') push('match_over', `${name}: Team ${mm.winner} wins the match`);
  } else if (type === 'CONFIRM_MATCH_END') push('match_completed', `${name}: match completed`);
  else if (type === 'END_MATCH') push('match_ended_early', `${name}: match ended early`);
  else if (type === 'CANCEL') push('match_cancelled', `${name}: match cancelled`);
  else if (type === 'ADMIN_CORRECTION') push('match_corrected', `${name}: result corrected`);
}

/* ----------------------------------------------------------------- routes */

export interface MatchListItem {
  id: number; code: string; playDate: string; courtId: number; courtName: string; courtActive: boolean; playType: PlayType;
  teams: { A: { name: string; players: string[] }; B: { name: string; players: string[] } };
  rulesName: string; customized: boolean; games: { a: number; b: number; status: string }[]; gamesWon: { A: number; B: number };
  winner: Team | null; status: MatchRow['status']; endReason: string | null; endNote: string | null;
  startedAt: number | null; endedAt: number | null; durationMs: number | null; bookingCode: string | null; createdBy: string | null; corrected: boolean;
  openPlay: boolean;
}

function playersLine(ctx: Ctx, m: MatchRow): { A: string[]; B: string[] } {
  const rows = ctx.db.prepare('SELECT team, slot, display_name FROM match_players WHERE match_id = ? ORDER BY team, slot').all(m.id) as { team: Team; slot: Slot; display_name: string | null }[];
  const per = m.play_type === 'singles' ? 1 : 2;
  const mk = (t: Team) => Array.from({ length: per }, (_, i) => rows.find((r) => r.team === t && r.slot === i + 1)?.display_name ?? defaultPlayerLabel(m.play_type, t, (i + 1) as Slot));
  return { A: mk('A'), B: mk('B') };
}

export function matchListItem(ctx: Ctx, m: MatchRow & { court_name: string; court_active: number; booking_code: string | null; created_by: string | null }): MatchListItem {
  const pl = playersLine(ctx, m);
  const games = ctx.db.prepare('SELECT score_a a, score_b b, status FROM match_games WHERE match_id = ? ORDER BY game_number').all(m.id) as { a: number; b: number; status: string }[];
  let durationMs: number | null = null;
  if (m.started_at) durationMs = Math.max(0, (m.ended_at ?? ctx.now()) - m.started_at - m.paused_total_ms);
  return {
    id: m.id, code: m.match_code, playDate: m.play_date, courtId: m.court_id, courtName: m.court_name, courtActive: !!m.court_active, playType: m.play_type,
    teams: { A: { name: m.team_a_name, players: pl.A }, B: { name: m.team_b_name, players: pl.B } }, rulesName: m.format_name, customized: !!m.rules_customized,
    games, gamesWon: { A: m.games_won_a, B: m.games_won_b }, winner: m.winner_team, status: m.status, endReason: m.end_reason, endNote: m.end_note,
    startedAt: m.started_at, endedAt: m.ended_at, durationMs, bookingCode: m.booking_code, createdBy: m.created_by, corrected: !!m.corrected_at, openPlay: m.open_play_round_id != null,
  };
}

const LIST_SELECT = `SELECT m.*, c.name AS court_name, c.is_active AS court_active, b.booking_code AS booking_code, u.display_name AS created_by
  FROM matches m JOIN courts c ON c.id = m.court_id LEFT JOIN bookings b ON b.id = m.booking_id LEFT JOIN users u ON u.id = m.created_by_user_id`;

function listFilters(q: Record<string, string | undefined>): { sql: string; args: unknown[] } {
  const where: string[] = []; const args: unknown[] = [];
  if (q.from) { where.push('m.play_date >= ?'); args.push(q.from); }
  if (q.to) { where.push('m.play_date <= ?'); args.push(q.to); }
  if (q.courtId) { where.push('m.court_id = ?'); args.push(Number(q.courtId)); }
  if (q.status) { const st = q.status.split(',').filter(Boolean); if (st.length) { where.push(`m.status IN (${st.map(() => '?').join(',')})`); args.push(...st); } }
  if (q.formatId) { where.push('m.format_id = ?'); args.push(Number(q.formatId)); }
  if (q.playType === 'singles' || q.playType === 'doubles') { where.push('m.play_type = ?'); args.push(q.playType); }
  if (q.bookingId) { where.push('m.booking_id = ?'); args.push(Number(q.bookingId)); }
  if (q.openPlay === '1') where.push('m.open_play_round_id IS NOT NULL');
  if (q.playerKey) {
    if (q.playerKey.startsWith('r:')) { where.push('EXISTS (SELECT 1 FROM match_players mp WHERE mp.match_id = m.id AND mp.player_id = ?)'); args.push(Number(q.playerKey.slice(2))); }
    else if (q.playerKey.startsWith('t:')) { where.push('EXISTS (SELECT 1 FROM match_players mp WHERE mp.match_id = m.id AND mp.player_id IS NULL AND mp.display_name = ? COLLATE NOCASE)'); args.push(decodeURIComponent(q.playerKey.slice(2))); }
  }
  if (q.q) {
    where.push(`(m.match_code LIKE ? OR m.team_a_name LIKE ? OR m.team_b_name LIKE ? OR EXISTS (SELECT 1 FROM match_players mp WHERE mp.match_id = m.id AND mp.display_name LIKE ?))`);
    args.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`, `%${q.q}%`);
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', args };
}

const SORTS: Record<string, string> = { startedAt: 'COALESCE(m.started_at, m.created_at)', duration: '(COALESCE(m.ended_at, m.last_event_at) - COALESCE(m.started_at, m.created_at) - m.paused_total_ms)', court: 'c.display_order' };

export function registerMatchRoutes(app: FastifyInstance, ctx: Ctx): void {
  const user = (req: FastifyRequest) => ({ userId: req.auth!.user.id, courtId: req.auth!.terminalCourtId });

  app.post('/api/v1/matches', { config: { perm: 'matches.create' } }, async (req, reply) => {
    const out = createMatch(ctx, user(req), req.body);
    reply.code(201);
    return out;
  });

  app.get('/api/v1/matches', { config: { perm: 'matches.history' } }, async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const page = Math.max(1, Number(q.page ?? 1)); const pageSize = Math.min(100, Math.max(1, Number(q.pageSize ?? 25)));
    const f = listFilters(q);
    const total = (ctx.db.prepare(`SELECT count(*) c FROM matches m JOIN courts c ON c.id = m.court_id ${f.sql}`).get(...f.args) as { c: number }).c;
    const sort = SORTS[q.sort ?? 'startedAt'] ?? SORTS.startedAt!;
    const rows = ctx.db.prepare(`${LIST_SELECT} ${f.sql} ORDER BY ${sort} ${q.order === 'asc' ? 'ASC' : 'DESC'}, m.id DESC LIMIT ? OFFSET ?`).all(...f.args, pageSize, (page - 1) * pageSize) as Parameters<typeof matchListItem>[1][];
    return { items: rows.map((r) => matchListItem(ctx, r)), page, pageSize, total };
  });

  app.get('/api/v1/matches/live', { config: { perm: 'matches.viewLive' } }, async () => {
    const rows = ctx.db.prepare(`${LIST_SELECT} WHERE m.status IN ${ACTIVE} ORDER BY c.display_order`).all() as Parameters<typeof matchListItem>[1][];
    return rows.map((r) => ({ ...matchListItem(ctx, r), snapshot: buildMatchSnapshot(ctx, r) }));
  });

  app.get('/api/v1/matches/export.csv', { config: { perm: 'matches.export' } }, async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const f = listFilters(q);
    const rows = ctx.db.prepare(`${LIST_SELECT} ${f.sql} ORDER BY m.id DESC`).all(...f.args) as Parameters<typeof matchListItem>[1][];
    const fmt = (ms: number | null) => (ms ? new Date(ms).toLocaleString('en-CA', { timeZone: ctx.timeZone, hour12: true }) : '');
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="game-histories.csv"');
    return toCsv(['Code', 'Date', 'Court', 'Type', 'Team A', 'Team B', 'Rules', 'Games', 'Winner', 'Status', 'Ended early reason', 'Start', 'End', 'Duration (min)', 'Booking'],
      rows.map((r) => { const i = matchListItem(ctx, r); return [
        i.code, i.playDate, i.courtName, i.playType, `${i.teams.A.name}: ${i.teams.A.players.join(' / ')}`, `${i.teams.B.name}: ${i.teams.B.players.join(' / ')}`,
        i.rulesName, i.games.map((g) => `${g.a}-${g.b}`).join(', '), i.winner ? `Team ${i.winner}` : '', i.status, i.endReason ?? '',
        fmt(i.startedAt), fmt(i.endedAt), i.durationMs != null ? Math.round(i.durationMs / 60000) : '', i.bookingCode ?? ''] ; }));
  });

  app.get('/api/v1/matches/:id', { config: { perm: 'matches.history' } }, async (req) => {
    const { id } = idParam.parse(req.params);
    const m = ctx.db.prepare(`${LIST_SELECT} WHERE m.id = ?`).get(id) as (Parameters<typeof matchListItem>[1]) | undefined;
    if (!m) throw E.notFound('Match not found', 'MATCH_NOT_FOUND');
    const games = ctx.db.prepare('SELECT game_number n, points_to_win target, score_a a, score_b b, status, winner_team winner, started_at s, ended_at e FROM match_games WHERE match_id = ? ORDER BY game_number').all(id);
    const onCourt = m.created_on_court_id ? (ctx.db.prepare('SELECT name FROM courts WHERE id = ?').get(m.created_on_court_id) as { name: string } | undefined)?.name ?? null : null;
    const booking = m.booking_id ? ctx.db.prepare('SELECT id, booking_code, booked_by_name, start_at, end_at, status FROM bookings WHERE id = ?').get(m.booking_id) : null;
    return { item: matchListItem(ctx, m), snapshot: buildMatchSnapshot(ctx, m), games, createdOnCourt: onCourt, booking, pausedTotalMs: m.paused_total_ms, correctedAt: m.corrected_at };
  });

  app.get('/api/v1/matches/:id/events', { config: { perm: 'matches.history' } }, async (req) => {
    const { id } = idParam.parse(req.params);
    if (!loadMatchRow(ctx, id)) throw E.notFound('Match not found', 'MATCH_NOT_FOUND');
    const rows = ctx.db.prepare(`SELECT e.seq, e.type, e.payload_json, e.at, e.outcome, e.score_a_after a, e.score_b_after b, e.game_number gn, e.voided_by_event_id,
        v.seq voided_by_seq, v.at voided_at, e.actor_type, u.display_name actor_name, c.name actor_court
      FROM match_events e LEFT JOIN users u ON u.id = e.actor_user_id LEFT JOIN courts c ON c.id = e.actor_court_id LEFT JOIN match_events v ON v.id = e.voided_by_event_id
      WHERE e.match_id = ? ORDER BY e.seq`).all(id) as any[];
    return rows.map((r) => ({
      seq: r.seq, type: r.type, at: r.at, label: describeEvent(r.type, JSON.parse(r.payload_json), r.outcome), outcome: r.outcome,
      scoreA: r.a, scoreB: r.b, gameNumber: r.gn, voided: r.voided_by_event_id != null, voidedAt: r.voided_at ?? null,
      actor: r.actor_type === 'system' ? 'System' : r.actor_name, actorCourt: r.actor_court ?? null,
    }));
  });

  app.post('/api/v1/matches/:id/commands', { config: { perm: 'matches.operate' } }, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = commandSchema.parse(req.body);
    const role = req.auth!.user.role;
    if (body.type === 'END_MATCH' && !can({ kind: 'user', role }, 'matches.end')) throw E.forbidden();
    const schema = payloadSchemas[body.type];
    const parsed = schema.safeParse(body.payload ?? {});
    if (!parsed.success) throw E.validation('Invalid command', parsed.error.issues);
    return runCommand(ctx, id, user(req), { ...body, payload: parsed.data as Record<string, any> });
  });

  app.patch('/api/v1/matches/:id/players', { config: { perm: 'matches.correct' } }, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = finishedPlayersSchema.parse(req.body);
    const m = loadMatchRow(ctx, id);
    if (!m) throw E.notFound('Match not found', 'MATCH_NOT_FOUND');
    if (!['completed', 'terminated'].includes(m.status)) throw E.conflict('INVALID_STATE', 'Use the match controls while the match is in progress');
    const slots = resolveSlots(ctx, m.play_type, readCurrentSlots(ctx, m, body.players));
    ctx.tx(() => {
      writeSlots(ctx, id, slots);
      if (body.teamAName !== undefined || body.teamBName !== undefined)
        ctx.db.prepare('UPDATE matches SET team_a_name = ?, team_b_name = ? WHERE id = ?').run(body.teamAName?.trim() || m.team_a_name, body.teamBName?.trim() || m.team_b_name, id);
    });
    audit(ctx, { actor: actorOf(req), action: 'match.edit_players', entityType: 'match', entityId: id, details: body, ip: req.ip });
    ctx.pub.invalidate(['matches', 'players']);
    return { snapshot: buildMatchSnapshot(ctx, loadMatchRow(ctx, id)!) };
  });

  app.post('/api/v1/matches/:id/correction', { config: { perm: 'matches.correct' } }, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = correctionSchema.parse(req.body);
    return runCommand(ctx, id, user(req), {
      commandId: body.commandId, expectedVersion: body.expectedVersion, type: 'ADMIN_CORRECTION',
      payload: { games: body.games, reason: body.reason, force: body.force },
    });
  });
}
