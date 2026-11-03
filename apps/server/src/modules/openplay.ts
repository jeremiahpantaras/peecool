import type { FastifyInstance } from 'fastify';
import {
  addOpenPlayPlayersSchema, addToHistory, applyOverrides, createOpenPlaySchema, describeRules, emptyHistory, hashSeed, idParam, mulberry32,
  normalizeTypedName, openPlayEndSchema, openPlayExtendSchema, openPlayPlayerStatusSchema, openPlayResultSchema, openPlaySwapSchema,
  patchOpenPlaySchema, planRound, rankPlayers, validateRules,
  type MatchRules, type OpenPlayGameDto, type OpenPlayGameStatus, type OpenPlayPlayerDto, type OpenPlayRoundDto, type OpenPlaySessionDto,
  type OpenPlaySessionSummary, type OpPlayerStat, type PairHistory, type PlayType, type Team,
} from '@pickle/shared';
import type { Ctx } from '../context';
import { AppError, E } from '../lib/errors';
import { audit } from '../lib/audit';
import { randomToken } from '../lib/crypto';
import { actorOf } from '../auth';
import { createMatch, courtHeldByOpenPlay, presetRules, runCommand } from './matches';
import { loadMatchRow, loadState } from '../snapshots';

export const LATE_START_MS = 3 * 60_000;

interface SessionRow {
  id: number; name: string; play_type: PlayType; format_id: number | null; format_name: string; rules_json: string; session_minutes: number;
  game_minutes: number; changeover_minutes: number; status: 'setup' | 'running' | 'ending' | 'finished' | 'cancelled'; seed: number; round_count: number;
  started_at: number | null; ended_at: number | null; created_by_user_id: number; created_at: number;
}
interface OpPlayerRow { id: number; display_name: string; player_id: number | null; status: 'active' | 'resting' | 'left'; joined_round: number; base_played: number }
interface RoundRow { id: number; number: number; status: 'active' | 'closed'; published_at: number; closed_at: number | null }

const sysId = (p: string) => `op-${p}-${randomToken(10)}`;
const endsAt = (s: SessionRow): number | null => (s.started_at ? s.started_at + s.session_minutes * 60_000 : null);

function loadSession(ctx: Ctx, id: number): SessionRow {
  const s = ctx.db.prepare('SELECT * FROM open_play_sessions WHERE id = ?').get(id) as SessionRow | undefined;
  if (!s) throw E.notFound('Open Play session not found');
  return s;
}
const sessionCourts = (ctx: Ctx, sid: number) =>
  ctx.db.prepare('SELECT c.id, c.name, c.is_active, c.maintenance_mode FROM open_play_courts oc JOIN courts c ON c.id = oc.court_id WHERE oc.session_id = ? ORDER BY oc.position').all(sid) as
    { id: number; name: string; is_active: number; maintenance_mode: number }[];

/* ------------------------------------------------------------------ stats */

interface Loaded { players: OpPlayerStat[]; history: PairHistory; rows: Map<number, OpPlayerRow> }

/** Everything the pairing and standings need, derived from the finished/ongoing games (single source of truth: the matches). */
function loadStats(ctx: Ctx, sid: number): Loaded {
  const rows = ctx.db.prepare('SELECT * FROM open_play_players WHERE session_id = ? ORDER BY id').all(sid) as OpPlayerRow[];
  const stat = new Map<number, OpPlayerStat>(rows.map((r) => [r.id, {
    id: r.id, name: r.display_name, status: r.status, played: r.base_played, scored: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, lastRound: null, joinedRound: r.joined_round,
  }]));
  const parts = ctx.db.prepare(`SELECT gp.game_id gid, gp.op_player_id pid, gp.team, r.number rnum, m.status mstatus, m.winner_team, mg.score_a sa, mg.score_b sb
    FROM open_play_game_players gp JOIN open_play_games g ON g.id = gp.game_id JOIN open_play_rounds r ON r.id = g.round_id
    JOIN matches m ON m.id = g.match_id LEFT JOIN match_games mg ON mg.match_id = m.id AND mg.game_number = 1
    WHERE r.session_id = ?`).all(sid) as { gid: number; pid: number; team: Team; rnum: number; mstatus: string; winner_team: Team | null; sa: number | null; sb: number | null }[];
  const history = emptyHistory();
  const byGame = new Map<number, { teamA: number[]; teamB: number[] }>();
  for (const p of parts) {
    if (p.mstatus === 'cancelled') continue; // a cancelled game counts as sitting out
    const st = stat.get(p.pid); if (!st) continue;
    st.played++; st.lastRound = Math.max(st.lastRound ?? 0, p.rnum);
    if (p.mstatus === 'completed' && p.winner_team) {
      const mine = p.team === 'A' ? p.sa ?? 0 : p.sb ?? 0, theirs = p.team === 'A' ? p.sb ?? 0 : p.sa ?? 0;
      st.scored++; st.pointsFor += mine; st.pointsAgainst += theirs;
      if (p.winner_team === p.team) st.wins++; else st.losses++;
    }
    const g = byGame.get(p.gid) ?? { teamA: [], teamB: [] };
    (p.team === 'A' ? g.teamA : g.teamB).push(p.pid); byGame.set(p.gid, g);
  }
  addToHistory(history, [...byGame.values()]);
  return { players: [...stat.values()], history, rows: new Map(rows.map((r) => [r.id, r])) };
}

/* --------------------------------------------------------------- publishing */

function rulesOf(s: SessionRow): MatchRules { return JSON.parse(s.rules_json) as MatchRules; }

function presetFor(ctx: Ctx, s: SessionRow): MatchRules {
  const p = ctx.db.prepare('SELECT * FROM match_formats WHERE id = ?').get(s.format_id) as Parameters<typeof presetRules>[0] | undefined;
  return p ? presetRules(p) : rulesOf(s);
}

function diff(eff: MatchRules, base: MatchRules): Partial<MatchRules> {
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(eff) as (keyof MatchRules)[]) if (eff[k] !== base[k]) o[k] = eff[k];
  return o as Partial<MatchRules>;
}

function availableCourts(ctx: Ctx, s: SessionRow): number[] {
  return sessionCourts(ctx, s.id).filter((c) => c.is_active && !c.maintenance_mode
    && !ctx.db.prepare("SELECT 1 FROM matches WHERE court_id = ? AND status IN ('setup','in_progress','paused')").get(c.id)).map((c) => c.id);
}

/** Draws and creates the next round; returns the round number, or null when not enough players are available. */
export function publishRound(ctx: Ctx, sid: number): number | null {
  const s = loadSession(ctx, sid);
  if (s.status !== 'running') return null;
  const { players, history } = loadStats(ctx, sid);
  const number = s.round_count + 1;
  const plan = planRound({ players, courtIds: availableCourts(ctx, s), playType: s.play_type, history, roundNumber: number, seed: s.seed });
  if (!plan.games.length) return null;
  const rules = rulesOf(s);
  const overrides = diff(rules, presetFor(ctx, s));
  const now = ctx.now();
  const names = new Map(players.map((p) => [p.id, p.name]));
  const opRows = ctx.db.prepare('SELECT id, player_id FROM open_play_players WHERE session_id = ?').all(sid) as { id: number; player_id: number | null }[];
  const dir = new Map(opRows.map((r) => [r.id, r.player_id]));
  const courtIds: number[] = [];
  ctx.tx(() => {
    const rid = Number(ctx.db.prepare("INSERT INTO open_play_rounds (session_id, number, status, published_at) VALUES (?,?, 'active', ?)").run(sid, number, now).lastInsertRowid);
    ctx.db.prepare('UPDATE open_play_sessions SET round_count = ?, updated_at = ? WHERE id = ?').run(number, now, sid);
    for (const g of plan.games) {
      const slots = [...g.teamA.map((id, i) => ({ id, team: 'A' as const, slot: i + 1 })), ...g.teamB.map((id, i) => ({ id, team: 'B' as const, slot: i + 1 }))];
      const r = createMatch(ctx, { userId: s.created_by_user_id, courtId: null }, {
        courtId: g.courtId, playType: s.play_type, formatId: s.format_id ?? undefined, ruleOverrides: Object.keys(overrides).length ? overrides : undefined,
        players: slots.map((x) => ({ team: x.team, slot: x.slot, playerId: dir.get(x.id) ?? null, displayName: names.get(x.id) ?? null })),
      }, { openPlayRoundId: rid });
      const matchId = r.snapshot.match!.id;
      const gid = Number(ctx.db.prepare('INSERT INTO open_play_games (round_id, match_id, court_id, created_at) VALUES (?,?,?,?)').run(rid, matchId, g.courtId, now).lastInsertRowid);
      for (const x of slots) ctx.db.prepare('INSERT INTO open_play_game_players (game_id, op_player_id, team, slot) VALUES (?,?,?,?)').run(gid, x.id, x.team, x.slot);
      courtIds.push(g.courtId);
    }
  });
  audit(ctx, { actor: 'system', action: 'openplay.round', entityType: 'open_play_session', entityId: sid, details: { round: number, games: plan.games.length, waiting: plan.waiting.length } });
  ctx.pub.activity({ kind: 'open_play', text: `Open Play “${s.name}”: round ${number} is ready (${plan.games.length} game${plan.games.length > 1 ? 's' : ''})` });
  courtIds.forEach((c) => ctx.pub.publishCourt(c));
  ctx.pub.invalidate(['openplay', 'courts', 'dashboard', 'matches']);
  return number;
}

const advancing = new Set<number>();

/** Closes the round when its last game has a result, then publishes the next one — or finishes the session. */
export function advance(ctx: Ctx, sid: number): void {
  if (advancing.has(sid)) return;
  advancing.add(sid);
  try {
    let s = loadSession(ctx, sid);
    if (s.status !== 'running' && s.status !== 'ending') return;
    const now = ctx.now(); const end = endsAt(s)!;
    const round = ctx.db.prepare("SELECT * FROM open_play_rounds WHERE session_id = ? AND status = 'active'").get(sid) as RoundRow | undefined;
    if (round) {
      if (s.status === 'ending' || now >= end) cancelUnstarted(ctx, round.id);   // games that never started when time ran out
      const open = ctx.db.prepare(`SELECT count(*) c FROM open_play_games g JOIN matches m ON m.id = g.match_id
        WHERE g.round_id = ? AND m.status IN ('setup','in_progress','paused')`).get(round.id) as { c: number };
      if (open.c > 0) return;
      ctx.db.prepare("UPDATE open_play_rounds SET status = 'closed', closed_at = ? WHERE id = ?").run(now, round.id);
      ctx.pub.invalidate(['openplay']);
    }
    s = loadSession(ctx, sid);
    if (s.status === 'ending' || now + s.game_minutes * 60_000 > end) { finishSession(ctx, s); return; }
    publishRound(ctx, sid);
  } finally { advancing.delete(sid); }
}

function cancelUnstarted(ctx: Ctx, roundId: number): void {
  const games = ctx.db.prepare(`SELECT g.match_id id, m.version, m.court_id FROM open_play_games g JOIN matches m ON m.id = g.match_id WHERE g.round_id = ? AND m.status = 'setup'`).all(roundId) as { id: number; version: number; court_id: number }[];
  for (const g of games) {
    try { runCommand(ctx, g.id, 'system', { commandId: sysId('cancel'), expectedVersion: g.version, type: 'CANCEL', payload: {} }); }
    catch (e) { if (!(e instanceof AppError) || !['VERSION_CONFLICT', 'INVALID_STATE'].includes(e.code)) throw e; }
  }
}

function finishSession(ctx: Ctx, s: SessionRow): void {
  const now = ctx.now();
  ctx.db.prepare("UPDATE open_play_sessions SET status = 'finished', ended_at = ?, updated_at = ? WHERE id = ?").run(now, now, s.id);
  const { players } = loadStats(ctx, s.id);
  const champs = rankPlayers(players.filter((p) => p.status !== 'left' || p.played > 0)).filter((r) => r.rank === 1 && r.scored > 0).map((r) => r.name);
  audit(ctx, { actor: 'system', action: 'openplay.finish', entityType: 'open_play_session', entityId: s.id, details: { rounds: s.round_count, champions: champs } });
  ctx.pub.activity({ kind: 'open_play', text: `Open Play “${s.name}” finished${champs.length ? ` — ${champs.join(' & ')} on top` : ''}` });
  for (const c of sessionCourts(ctx, s.id)) ctx.pub.publishCourt(c.id);
  ctx.pub.invalidate(['openplay', 'courts', 'dashboard']);
}

/** The once-a-second job: per-court time-up (each game on its own clock) and round advancement. */
export function runOpenPlayTick(ctx: Ctx): void {
  const now = ctx.now();
  const live = ctx.db.prepare(`SELECT m.id, m.version, m.started_at, m.paused_total_ms, m.time_limit_minutes FROM matches m
    WHERE m.open_play_round_id IS NOT NULL AND m.status = 'in_progress' AND m.phase = 'playing' AND m.time_limit_minutes IS NOT NULL AND m.started_at IS NOT NULL`).all() as
    { id: number; version: number; started_at: number; paused_total_ms: number; time_limit_minutes: number }[];
  for (const m of live) {
    if (now - m.started_at - m.paused_total_ms < m.time_limit_minutes * 60_000) continue;
    const row = loadMatchRow(ctx, m.id); if (!row || loadState(ctx, row).timeUp) continue;
    try { runCommand(ctx, m.id, 'system', { commandId: sysId('timeup'), expectedVersion: m.version, type: 'TIME_UP', payload: {} }); }
    catch (e) { if (!(e instanceof AppError) || !['VERSION_CONFLICT', 'INVALID_STATE'].includes(e.code)) ctx.log.error({ err: e }, 'time-up failed'); }
  }
  const sessions = ctx.db.prepare("SELECT id FROM open_play_sessions WHERE status IN ('running','ending')").all() as { id: number }[];
  for (const s of sessions) { try { advance(ctx, s.id); } catch (e) { ctx.log.error({ err: e, session: s.id }, 'open play advance failed'); } }
}

export function registerOpenPlayHooks(ctx: Ctx): void {
  ctx.onMatchChanged = (matchId) => {
    const g = ctx.db.prepare('SELECT r.session_id sid FROM open_play_games g JOIN open_play_rounds r ON r.id = g.round_id WHERE g.match_id = ?').get(matchId) as { sid: number } | undefined;
    if (g) { ctx.pub.invalidate(['openplay']); advance(ctx, g.sid); }
  };
}

/** Alerts for the dashboard: games that have not been started (plan R19). */
export function openPlayAlerts(ctx: Ctx): { id: string; level: 'warning' | 'info'; text: string; courtId?: number }[] {
  const now = ctx.now();
  const rows = ctx.db.prepare(`SELECT g.id gid, c.id cid, c.name court, s.name sname, r.published_at pub FROM open_play_games g
    JOIN open_play_rounds r ON r.id = g.round_id AND r.status = 'active' JOIN open_play_sessions s ON s.id = r.session_id AND s.status IN ('running','ending')
    JOIN matches m ON m.id = g.match_id AND m.status = 'setup' JOIN courts c ON c.id = g.court_id`).all() as { gid: number; cid: number; court: string; sname: string; pub: number }[];
  return rows.filter((r) => now - r.pub >= LATE_START_MS).map((r) => ({
    id: `op-late-${r.gid}`, level: 'warning' as const, courtId: r.cid,
    text: `${r.court}: the Open Play game (“${r.sname}”) has not started — ${Math.round((now - r.pub) / 60000)} min since the round was ready`,
  }));
}

/* -------------------------------------------------------------------- dto */

function gameDtos(ctx: Ctx, roundId: number): OpenPlayGameDto[] {
  const games = ctx.db.prepare(`SELECT g.id, g.court_id, g.match_id, c.name court, c.display_order FROM open_play_games g JOIN courts c ON c.id = g.court_id WHERE g.round_id = ? ORDER BY c.display_order, g.id`).all(roundId) as
    { id: number; court_id: number; match_id: number | null; court: string }[];
  return games.map((g) => {
    const people = ctx.db.prepare(`SELECT gp.team, gp.slot, p.id, p.display_name FROM open_play_game_players gp JOIN open_play_players p ON p.id = gp.op_player_id WHERE gp.game_id = ? ORDER BY gp.team, gp.slot`).all(g.id) as { team: Team; slot: number; id: number; display_name: string }[];
    const m = g.match_id ? loadMatchRow(ctx, g.match_id) : undefined;
    const st = m ? loadState(ctx, m) : null;
    const game1 = st?.games[0];
    const status: OpenPlayGameStatus = !m ? 'cancelled' : m.status === 'cancelled' ? 'cancelled' : m.status === 'setup' ? 'scheduled'
      : m.status === 'completed' || m.status === 'terminated' || m.phase === 'match_over' ? 'finished' : 'playing';
    return {
      id: g.id, courtId: g.court_id, courtName: g.court, matchId: m?.id ?? null, matchCode: m?.match_code ?? null, status,
      teamA: people.filter((p) => p.team === 'A').map((p) => ({ id: p.id, name: p.display_name })), teamB: people.filter((p) => p.team === 'B').map((p) => ({ id: p.id, name: p.display_name })),
      scoreA: game1?.score.A ?? 0, scoreB: game1?.score.B ?? 0, winner: st?.winner ?? null, decidedBy: st?.decidedBy ?? null,
      timer: { startedAt: m?.started_at ?? null, pausedAt: m?.paused_at ?? null, pausedTotalMs: m?.paused_total_ms ?? 0, timeLimitMinutes: m?.time_limit_minutes ?? null },
      timeUp: !!st?.timeUp, suddenDeath: !!st?.suddenDeath, matchStatus: m?.status ?? null, phase: m?.phase ?? null, endedEarly: m?.status === 'terminated',
    };
  });
}

function summary(ctx: Ctx, s: SessionRow): OpenPlaySessionSummary {
  const courts = sessionCourts(ctx, s.id);
  return {
    id: s.id, name: s.name, playType: s.play_type, status: s.status, startedAt: s.started_at, endsAt: endsAt(s), endedAt: s.ended_at, roundCount: s.round_count,
    playerCount: (ctx.db.prepare("SELECT count(*) c FROM open_play_players WHERE session_id = ? AND status <> 'left'").get(s.id) as { c: number }).c,
    courtNames: courts.map((c) => c.name), sessionMinutes: s.session_minutes, gameMinutes: s.game_minutes,
  };
}

export function sessionDto(ctx: Ctx, id: number): OpenPlaySessionDto {
  const s = loadSession(ctx, id);
  const { players } = loadStats(ctx, id);
  const rounds = (ctx.db.prepare('SELECT * FROM open_play_rounds WHERE session_id = ? ORDER BY number').all(id) as RoundRow[]);
  const roundDtos: OpenPlayRoundDto[] = rounds.map((r) => {
    const games = gameDtos(ctx, r.id);
    const inRound = new Set(games.flatMap((g) => [...g.teamA, ...g.teamB].map((p) => p.id)));
    const waiting = players.filter((p) => p.status === 'active' && !inRound.has(p.id) && p.joinedRound <= r.number).map((p) => ({ id: p.id, name: p.name }));
    return { id: r.id, number: r.number, status: r.status, publishedAt: r.published_at, closedAt: r.closed_at, games, waiting };
  });
  const current = roundDtos.find((r) => r.status === 'active') ?? null;
  const playingIds = new Set(current?.games.filter((g) => g.status !== 'cancelled').flatMap((g) => [...g.teamA, ...g.teamB].map((p) => p.id)) ?? []);
  const ranked = rankPlayers(players);
  const rankOf = new Map(ranked.map((r) => [r.id, r]));
  const dto = (p: OpPlayerStat): OpenPlayPlayerDto => {
    const r = rankOf.get(p.id)!;
    const row = ctx.db.prepare('SELECT player_id, first_name, last_name, team FROM open_play_players WHERE id = ?').get(p.id) as { player_id: number | null; first_name: string | null; last_name: string | null; team: string | null };
    return {
      id: p.id, name: p.name, firstName: row.first_name, lastName: row.last_name, team: row.team, playerId: row.player_id, status: p.status, played: p.played, wins: p.wins, losses: p.losses, pointsFor: p.pointsFor, pointsAgainst: p.pointsAgainst,
      net: r.net, avgDiff: r.avgDiff, rank: p.scored > 0 || ranked.some((x) => x.scored > 0) ? r.rank : null, joinedRound: p.joinedRound,
      now: p.status === 'left' ? 'left' : p.status === 'resting' ? 'resting' : playingIds.has(p.id) ? 'playing' : 'waiting',
    };
  };
  const playerDtos = players.map(dto);
  const standings = ranked.map((r) => playerDtos.find((p) => p.id === r.id)!);
  const warnings: string[] = [];
  if (s.status === 'setup' || s.status === 'running') {
    const from = s.started_at ?? ctx.now(), to = from + s.session_minutes * 60_000;
    const cs = sessionCourts(ctx, id).map((c) => c.id);
    if (cs.length) {
      const b = ctx.db.prepare(`SELECT b.booked_by_name, b.start_at, c.name FROM bookings b JOIN courts c ON c.id = b.court_id WHERE b.status = 'confirmed' AND b.court_id IN (${cs.map(() => '?').join(',')}) AND b.start_at < ? AND b.end_at > ? ORDER BY b.start_at LIMIT 5`).all(...cs, to, from) as { booked_by_name: string; start_at: number; name: string }[];
      for (const x of b) warnings.push(`${x.name} is booked by ${x.booked_by_name} during this session.`);
    }
  }
  const waitingForPlayers = s.status === 'running' && !current && s.round_count > 0;
  return {
    ...summary(ctx, s), changeoverMinutes: s.changeover_minutes, formatName: s.format_name, rulesSummary: describeRules(rulesOf(s)), seed: s.seed,
    courts: sessionCourts(ctx, id).map((c) => ({ id: c.id, name: c.name })), players: playerDtos,
    currentRound: current, rounds: roundDtos, standings,
    champions: s.status === 'finished' ? standings.filter((p) => p.rank === 1 && (rankOf.get(p.id)?.scored ?? 0) > 0).map((p) => p.name) : [], waitingForPlayers, warnings,
  };
}

/* ----------------------------------------------------------------- routes */

interface NewPlayer { name: string; playerId: number | null; firstName: string | null; lastName: string | null; team: string | null }
const clean = (v: string | null | undefined, max = 40): string | null => { const t = (v ?? '').replace(/\s+/g, ' ').trim().slice(0, max); return t || null; };

function resolveNames(ctx: Ctx, input: { firstName?: string | null; lastName?: string | null; team?: string | null; displayName?: string | null; playerId?: number | null }[]): NewPlayer[] {
  return input.map((p) => {
    const team = clean(p.team);
    if (p.playerId) {
      const r = ctx.db.prepare('SELECT display_name, is_active FROM players WHERE id = ?').get(p.playerId) as { display_name: string; is_active: number } | undefined;
      if (!r) throw E.validation('A selected player no longer exists');
      return { name: r.display_name, playerId: p.playerId, firstName: clean(p.firstName), lastName: clean(p.lastName), team };
    }
    const first = clean(p.firstName), last = clean(p.lastName);
    const n = first && last ? normalizeTypedName(`${first} ${last}`) : normalizeTypedName(p.displayName ?? null);
    if (!n) throw E.validation('Every player needs a first and last name');
    return { name: n, playerId: null, firstName: first, lastName: last, team };
  });
}

function insertPlayers(ctx: Ctx, sid: number, list: NewPlayer[], joinedRound: number, basePlayed: number): void {
  const st = ctx.db.prepare("INSERT INTO open_play_players (session_id, display_name, first_name, last_name, team, player_id, status, joined_round, base_played, created_at) VALUES (?,?,?,?,?,?,'active',?,?,?)");
  for (const p of list) st.run(sid, p.name, p.firstName, p.lastName, p.team, p.playerId, joinedRound, basePlayed, ctx.now());
}

function buildRules(ctx: Ctx, playType: PlayType, formatId: number | undefined, gameMinutes: number): { rules: MatchRules; formatId: number; formatName: string } {
  const preset = (formatId
    ? ctx.db.prepare('SELECT * FROM match_formats WHERE id = ?').get(formatId)
    : ctx.db.prepare('SELECT * FROM match_formats WHERE is_default = 1').get()) as (Parameters<typeof presetRules>[0] & { name: string; id: number }) | undefined;
  if (!preset || !preset.is_active) throw E.validation('Choose an available rule preset');
  const rules = applyOverrides(presetRules(preset), { gamesToWin: 1, decidingGamePoints: null, timeLimitMinutes: gameMinutes });
  const issues = validateRules(playType, rules);
  if (issues.length) throw new AppError('INVALID_RULES', 422, issues.map((i) => i.message).join('; '));
  return { rules, formatId: preset.id, formatName: `${preset.name} · Open Play` };
}

function validateCourts(ctx: Ctx, ids: number[]): void {
  const uniq = [...new Set(ids)];
  for (const id of uniq) {
    const c = ctx.db.prepare('SELECT name, is_active FROM courts WHERE id = ?').get(id) as { name: string; is_active: number } | undefined;
    if (!c) throw E.notFound('Court not found', 'COURT_NOT_FOUND');
    if (!c.is_active) throw E.conflict('COURT_UNAVAILABLE', `${c.name} is not in service`);
  }
}

const gameOf = (ctx: Ctx, sid: number, gid: number) => {
  const g = ctx.db.prepare(`SELECT g.id, g.match_id, g.round_id, r.status rstatus FROM open_play_games g JOIN open_play_rounds r ON r.id = g.round_id WHERE g.id = ? AND r.session_id = ?`).get(gid, sid) as
    { id: number; match_id: number | null; round_id: number; rstatus: string } | undefined;
  if (!g || !g.match_id) throw E.notFound('Game not found');
  return { ...g, match_id: g.match_id };
};

export function registerOpenPlayRoutes(app: FastifyInstance, ctx: Ctx): void {
  const base = '/api/v1/open-play';
  const changed = () => { ctx.pub.invalidate(['openplay', 'courts', 'dashboard']); };
  const asUser = (req: import('fastify').FastifyRequest) => ({ userId: req.auth!.user.id, courtId: null as number | null });

  app.get(base, { config: { perm: 'openplay.view' } }, async () => {
    const rows = ctx.db.prepare('SELECT * FROM open_play_sessions ORDER BY (status IN (\'running\',\'ending\',\'setup\')) DESC, COALESCE(started_at, created_at) DESC LIMIT 100').all() as SessionRow[];
    return rows.map((s) => summary(ctx, s));
  });

  app.post(base, { config: { perm: 'openplay.manage' } }, async (req, reply) => {
    const body = createOpenPlaySchema.parse(req.body);
    validateCourts(ctx, body.courtIds);
    const { rules, formatId, formatName } = buildRules(ctx, body.playType, body.formatId, body.gameMinutes);
    const players = resolveNames(ctx, body.players ?? []);
    const now = ctx.now();
    const id = ctx.tx(() => {
      const sid = Number(ctx.db.prepare(`INSERT INTO open_play_sessions (name, play_type, format_id, format_name, rules_json, session_minutes, game_minutes, changeover_minutes, status, seed, created_by_user_id, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?, 'setup', ?, ?, ?, ?)`).run(body.name, body.playType, formatId, formatName, JSON.stringify(rules), body.sessionMinutes, body.gameMinutes, body.changeoverMinutes,
        Math.floor(Math.random() * 2 ** 31), req.auth!.user.id, now, now).lastInsertRowid);
      [...new Set(body.courtIds)].forEach((c, i) => ctx.db.prepare('INSERT INTO open_play_courts (session_id, court_id, position) VALUES (?,?,?)').run(sid, c, i));
      insertPlayers(ctx, sid, players, 1, 0);
      return sid;
    });
    audit(ctx, { actor: actorOf(req), action: 'openplay.create', entityType: 'open_play_session', entityId: id, details: { name: body.name, players: players.length }, ip: req.ip });
    changed();
    reply.code(201);
    return sessionDto(ctx, id);
  });

  app.get(`${base}/:id`, { config: { perm: 'openplay.view' } }, async (req) => sessionDto(ctx, idParam.parse(req.params).id));

  app.patch(`${base}/:id`, { config: { perm: 'openplay.manage' } }, async (req) => {
    const { id } = idParam.parse(req.params);
    const s = loadSession(ctx, id);
    if (s.status !== 'setup') throw E.conflict('INVALID_STATE', 'A session can only be edited before it starts');
    const b = patchOpenPlaySchema.parse(req.body);
    const playType = b.playType ?? s.play_type;
    const gameMinutes = b.gameMinutes ?? s.game_minutes;
    const { rules, formatId, formatName } = buildRules(ctx, playType, b.formatId ?? s.format_id ?? undefined, gameMinutes);
    if (b.courtIds) validateCourts(ctx, b.courtIds);
    ctx.tx(() => {
      ctx.db.prepare(`UPDATE open_play_sessions SET name=?, play_type=?, format_id=?, format_name=?, rules_json=?, session_minutes=?, game_minutes=?, changeover_minutes=?, updated_at=? WHERE id=?`)
        .run(b.name ?? s.name, playType, formatId, formatName, JSON.stringify(rules), b.sessionMinutes ?? s.session_minutes, gameMinutes, b.changeoverMinutes ?? s.changeover_minutes, ctx.now(), id);
      if (b.courtIds) { ctx.db.prepare('DELETE FROM open_play_courts WHERE session_id = ?').run(id); [...new Set(b.courtIds)].forEach((c, i) => ctx.db.prepare('INSERT INTO open_play_courts (session_id, court_id, position) VALUES (?,?,?)').run(id, c, i)); }
    });
    audit(ctx, { actor: actorOf(req), action: 'openplay.update', entityType: 'open_play_session', entityId: id, details: b, ip: req.ip });
    changed();
    return sessionDto(ctx, id);
  });

  app.post(`${base}/:id/players`, { config: { perm: 'openplay.manage' } }, async (req) => {
    const { id } = idParam.parse(req.params);
    const s = loadSession(ctx, id);
    if (!['setup', 'running'].includes(s.status)) throw E.conflict('INVALID_STATE', 'Players cannot be added now');
    const list = resolveNames(ctx, addOpenPlayPlayersSchema.parse(req.body).players);
    let joined = 1, base_ = 0;
    if (s.status === 'running') {
      // a late player starts level with the lowest games-played count so they neither dominate nor are starved (R21)
      const active = loadStats(ctx, id).players.filter((p) => p.status === 'active');
      base_ = active.length ? Math.min(...active.map((p) => p.played)) : 0; joined = s.round_count + 1;
    }
    insertPlayers(ctx, id, list, joined, base_);
    audit(ctx, { actor: actorOf(req), action: 'openplay.add_players', entityType: 'open_play_session', entityId: id, details: { names: list.map((p) => p.name) }, ip: req.ip });
    changed();
    if (s.status === 'running') advance(ctx, id); // a session that was waiting for players can continue
    return sessionDto(ctx, id);
  });

  app.patch(`${base}/:id/players/:pid`, { config: { perm: 'openplay.manage' } }, async (req) => {
    const { id } = idParam.parse(req.params);
    const pid = Number((req.params as { pid: string }).pid);
    const { status } = openPlayPlayerStatusSchema.parse(req.body);
    loadSession(ctx, id);
    if (!ctx.db.prepare('SELECT 1 FROM open_play_players WHERE id = ? AND session_id = ?').get(pid, id)) throw E.notFound('Player not found');
    if (status !== 'active' && ctx.db.prepare(`SELECT 1 FROM open_play_game_players gp JOIN open_play_games g ON g.id = gp.game_id JOIN matches m ON m.id = g.match_id WHERE gp.op_player_id = ? AND m.status = 'setup'`).get(pid))
      throw E.conflict('INVALID_STATE', 'This player is in a game that has not started — swap them out of it first');
    ctx.db.prepare('UPDATE open_play_players SET status = ? WHERE id = ?').run(status, pid);
    audit(ctx, { actor: actorOf(req), action: 'openplay.player_status', entityType: 'open_play_session', entityId: id, details: { player: pid, status }, ip: req.ip });
    changed();
    return sessionDto(ctx, id);
  });

  app.delete(`${base}/:id/players/:pid`, { config: { perm: 'openplay.manage' } }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const s = loadSession(ctx, id);
    if (s.status !== 'setup') throw E.conflict('INVALID_STATE', 'Players can only be removed before the session starts — mark them as left instead');
    ctx.db.prepare('DELETE FROM open_play_players WHERE id = ? AND session_id = ?').run(Number((req.params as { pid: string }).pid), id);
    changed();
    reply.code(204);
  });

  app.post(`${base}/:id/start`, { config: { perm: 'openplay.manage' } }, async (req) => {
    const { id } = idParam.parse(req.params);
    const s = loadSession(ctx, id);
    if (s.status !== 'setup') throw E.conflict('INVALID_STATE', 'This session has already started');
    const { players } = loadStats(ctx, id);
    const need = s.play_type === 'singles' ? 2 : 4;
    if (players.filter((p) => p.status === 'active').length < need) throw new AppError('OPEN_PLAY_INVALID', 422, `At least ${need} players are needed for ${s.play_type}`);
    const busy: string[] = [];
    for (const c of sessionCourts(ctx, id)) {
      const held = courtHeldByOpenPlay(ctx, c.id);
      if (held) busy.push(`${c.name} (used by “${held.name}”)`);
      else if (!c.is_active || c.maintenance_mode) busy.push(`${c.name} (not available)`);
      else if (ctx.db.prepare("SELECT 1 FROM matches WHERE court_id = ? AND status IN ('setup','in_progress','paused')").get(c.id)) busy.push(`${c.name} (has a match)`);
    }
    if (busy.length) throw E.conflict('COURT_BUSY', `These courts are not free: ${busy.join(', ')}`, { courts: busy });
    ctx.db.prepare("UPDATE open_play_sessions SET status = 'running', started_at = ?, updated_at = ? WHERE id = ?").run(ctx.now(), ctx.now(), id);
    audit(ctx, { actor: actorOf(req), action: 'openplay.start', entityType: 'open_play_session', entityId: id, ip: req.ip });
    if (publishRound(ctx, id) == null) throw new AppError('OPEN_PLAY_INVALID', 422, 'No game could be created');
    changed();
    return sessionDto(ctx, id);
  });

  app.post(`${base}/:id/end`, { config: { perm: 'openplay.manage' } }, async (req) => {
    const { id } = idParam.parse(req.params);
    const { force } = openPlayEndSchema.parse(req.body ?? {});
    const s = loadSession(ctx, id);
    if (s.status === 'setup') {
      ctx.db.prepare("UPDATE open_play_sessions SET status = 'cancelled', ended_at = ?, updated_at = ? WHERE id = ?").run(ctx.now(), ctx.now(), id);
    } else if (s.status === 'running' || s.status === 'ending') {
      ctx.db.prepare("UPDATE open_play_sessions SET status = 'ending', updated_at = ? WHERE id = ?").run(ctx.now(), id);
      if (force) {
        const live = ctx.db.prepare(`SELECT m.id, m.version FROM open_play_games g JOIN open_play_rounds r ON r.id = g.round_id JOIN matches m ON m.id = g.match_id
          WHERE r.session_id = ? AND m.status IN ('in_progress','paused') AND m.phase <> 'match_over'`).all(id) as { id: number; version: number }[];
        for (const m of live) { try { runCommand(ctx, m.id, asUser(req), { commandId: sysId('end'), expectedVersion: m.version, type: 'END_MATCH', payload: { reason: 'time_up', confirmed: true } }); } catch { /* finished meanwhile */ } }
      }
      advance(ctx, id);
    } else throw E.conflict('INVALID_STATE', 'This session has already finished');
    audit(ctx, { actor: actorOf(req), action: 'openplay.end', entityType: 'open_play_session', entityId: id, details: { force: !!force }, ip: req.ip });
    changed();
    return sessionDto(ctx, id);
  });

  app.post(`${base}/:id/start-all`, { config: { perm: 'openplay.manage' } }, async (req) => {
    const { id } = idParam.parse(req.params);
    const s = loadSession(ctx, id);
    if (s.status !== 'running') throw E.conflict('INVALID_STATE', 'The session is not running');
    const rnd = mulberry32(hashSeed(s.seed, s.round_count, 77));
    const games = ctx.db.prepare(`SELECT m.id, m.version, m.serving_mode FROM open_play_games g JOIN open_play_rounds r ON r.id = g.round_id AND r.status = 'active' JOIN matches m ON m.id = g.match_id
      WHERE r.session_id = ? AND m.status = 'setup'`).all(id) as { id: number; version: number; serving_mode: string }[];
    for (const g of games) runCommand(ctx, g.id, asUser(req), { commandId: sysId('start'), expectedVersion: g.version, type: 'START_MATCH', payload: g.serving_mode === 'auto' ? { servingTeam: rnd() < 0.5 ? 'A' : 'B' } : {} });
    audit(ctx, { actor: actorOf(req), action: 'openplay.start_all', entityType: 'open_play_session', entityId: id, details: { games: games.length }, ip: req.ip });
    changed();
    return sessionDto(ctx, id);
  });

  app.post(`${base}/:id/games/:gid/result`, { config: { perm: 'openplay.manage' } }, async (req) => {
    const { id } = idParam.parse(req.params);
    const g = gameOf(ctx, id, Number((req.params as { gid: string }).gid));
    const body = openPlayResultSchema.parse(req.body);
    if (body.scoreA === body.scoreB && !body.winner) throw E.validation('The score is level — choose the winner');
    let m = loadMatchRow(ctx, g.match_id)!;
    if (['completed', 'terminated', 'cancelled'].includes(m.status) || m.phase === 'match_over') throw E.conflict('INVALID_STATE', 'This game already has a result');
    const actor = asUser(req);
    if (m.status === 'setup') {
      runCommand(ctx, m.id, actor, { commandId: sysId('start'), expectedVersion: m.version, type: 'START_MATCH', payload: m.serving_mode === 'auto' ? { servingTeam: 'A' } : {} });
      m = loadMatchRow(ctx, m.id)!;
    }
    if (m.status === 'paused') { runCommand(ctx, m.id, actor, { commandId: sysId('resume'), expectedVersion: m.version, type: 'RESUME', payload: {} }); m = loadMatchRow(ctx, m.id)!; }
    runCommand(ctx, m.id, actor, { commandId: sysId('result'), expectedVersion: m.version, type: 'RECORD_RESULT', payload: body });
    audit(ctx, { actor: actorOf(req), action: 'openplay.result', entityType: 'match', entityId: m.id, details: body, ip: req.ip });
    changed();
    return sessionDto(ctx, id);
  });

  app.post(`${base}/:id/games/:gid/cancel`, { config: { perm: 'openplay.manage' } }, async (req) => {
    const { id } = idParam.parse(req.params);
    const g = gameOf(ctx, id, Number((req.params as { gid: string }).gid));
    const m = loadMatchRow(ctx, g.match_id)!;
    if (m.status !== 'setup') throw E.conflict('INVALID_STATE', 'Only a game that has not started can be cancelled');
    runCommand(ctx, m.id, asUser(req), { commandId: sysId('cancel'), expectedVersion: m.version, type: 'CANCEL', payload: {} });
    audit(ctx, { actor: actorOf(req), action: 'openplay.cancel_game', entityType: 'match', entityId: m.id, ip: req.ip });
    changed();
    return sessionDto(ctx, id);
  });

  app.post(`${base}/:id/games/:gid/extend`, { config: { perm: 'openplay.manage' } }, async (req) => {
    const { id } = idParam.parse(req.params);
    const g = gameOf(ctx, id, Number((req.params as { gid: string }).gid));
    const { minutes } = openPlayExtendSchema.parse(req.body);
    const m = loadMatchRow(ctx, g.match_id)!;
    if (!['setup', 'in_progress', 'paused'].includes(m.status) || loadState(ctx, m).timeUp) throw E.conflict('INVALID_STATE', 'This game can no longer be extended');
    ctx.db.prepare('UPDATE matches SET time_limit_minutes = COALESCE(time_limit_minutes, 0) + ? WHERE id = ?').run(minutes, m.id);
    audit(ctx, { actor: actorOf(req), action: 'openplay.extend', entityType: 'match', entityId: m.id, details: { minutes }, ip: req.ip });
    ctx.pub.publishCourt(m.court_id); changed();
    return sessionDto(ctx, id);
  });

  /** Swap a player of a game that has not started with another player (in another unstarted game, or waiting) — R12. */
  app.post(`${base}/:id/swap`, { config: { perm: 'openplay.manage' } }, async (req) => {
    const { id } = idParam.parse(req.params);
    const { playerA, playerB } = openPlaySwapSchema.parse(req.body);
    loadSession(ctx, id);
    const where = (pid: number) => {
      if (!ctx.db.prepare('SELECT 1 FROM open_play_players WHERE id = ? AND session_id = ?').get(pid, id)) throw E.notFound('Player not found');
      return ctx.db.prepare(`SELECT gp.game_id gid, gp.team, gp.slot, m.status ms, m.id mid FROM open_play_game_players gp JOIN open_play_games g ON g.id = gp.game_id
        JOIN open_play_rounds r ON r.id = g.round_id AND r.status = 'active' JOIN matches m ON m.id = g.match_id WHERE gp.op_player_id = ?`).get(pid) as { gid: number; team: Team; slot: number; ms: string; mid: number } | undefined;
    };
    const a = where(playerA), b = where(playerB);
    if (!a && !b) throw E.validation('At least one of the two players must be in a game');
    if ((a && a.ms !== 'setup') || (b && b.ms !== 'setup')) throw E.conflict('INVALID_STATE', 'Players can only be swapped between games that have not started');
    const target = a ?? b!;
    const moving = a ? playerB : playerA;  // the other player takes the first one's place
    ctx.tx(() => {
      if (a && b) {
        ctx.db.prepare('UPDATE open_play_game_players SET op_player_id = -1 WHERE game_id = ? AND op_player_id = ?').run(a.gid, playerA);
        ctx.db.prepare('UPDATE open_play_game_players SET op_player_id = ? WHERE game_id = ? AND op_player_id = ?').run(playerA, b.gid, playerB);
        ctx.db.prepare('UPDATE open_play_game_players SET op_player_id = ? WHERE game_id = ? AND op_player_id = -1').run(playerB, a.gid);
      } else {
        const out = a ? playerA : playerB;
        ctx.db.prepare('UPDATE open_play_game_players SET op_player_id = ? WHERE game_id = ? AND op_player_id = ?').run(moving, target.gid, out);
      }
    });
    const gids = new Set([a?.gid, b?.gid].filter((x): x is number => x != null));
    for (const gid of gids) {
      const people = ctx.db.prepare(`SELECT gp.team, gp.slot, p.display_name, p.player_id FROM open_play_game_players gp JOIN open_play_players p ON p.id = gp.op_player_id WHERE gp.game_id = ?`).all(gid) as { team: Team; slot: number; display_name: string; player_id: number | null }[];
      const mid = (ctx.db.prepare('SELECT match_id FROM open_play_games WHERE id = ?').get(gid) as { match_id: number }).match_id;
      const m = loadMatchRow(ctx, mid)!;
      runCommand(ctx, mid, asUser(req), { commandId: sysId('swap'), expectedVersion: m.version, type: 'UPDATE_PLAYERS', payload: { players: people.map((p) => ({ team: p.team, slot: p.slot, playerId: p.player_id, displayName: p.display_name })) } });
    }
    audit(ctx, { actor: actorOf(req), action: 'openplay.swap', entityType: 'open_play_session', entityId: id, details: { playerA, playerB }, ip: req.ip });
    changed();
    return sessionDto(ctx, id);
  });
}
