import {
  defaultPlayerLabel, deriveCourtStatus, deriveView, describeLastAction, createInitialState, replay,
  type BookingChip, type CourtSnapshot, type MatchConfig, type MatchRules, type MatchSnapshot, type MatchState, type OpenPlayInfo,
  type PlayType, type Slot, type Team, type EngineEvent, type EventType, type PlayerSlotDto, type GameDto,
} from '@pickle/shared';
import type { Ctx } from './context';

export interface MatchRow {
  id: number; match_code: string; court_id: number; format_id: number | null; booking_id: number | null; format_name: string;
  rules_customized: number; play_type: PlayType; scoring_type: 'side_out' | 'rally'; serving_mode: 'auto' | 'off';
  points_to_win: number; win_by: 1 | 2; point_cap: number | null; games_to_win: 1 | 2 | 3; deciding_game_points: number | null;
  first_server_rule: 'start_server_2' | 'both_servers'; switch_ends_prompt: 'off' | 'deciding_game' | 'every_game';
  time_limit_minutes: number | null; track_server_names: number; team_a_name: string; team_b_name: string;
  status: MatchState['status']; phase: MatchState['phase']; phase_changed_at: number | null; version: number;
  state_json: string | null; created_at: number; started_at: number | null; ended_at: number | null; paused_at: number | null;
  paused_total_ms: number; play_date: string; last_event_at: number; games_won_a: number; games_won_b: number;
  winner_team: Team | null; end_reason: string | null; end_note: string | null; needs_review: number;
  created_by_user_id: number; created_on_court_id: number | null; ended_by_user_id: number | null; corrected_at: number | null;
  open_play_round_id: number | null;
}

/** Open Play results are confirmed quickly so the round can move on; Undo is still possible during this window. */
export const OPEN_PLAY_CONFIRM_MS = 15_000;

export const rulesOf = (m: MatchRow): MatchRules => ({
  scoringType: m.scoring_type, servingMode: m.serving_mode, pointsToWin: m.points_to_win, winBy: m.win_by, pointCap: m.point_cap,
  gamesToWin: m.games_to_win, decidingGamePoints: m.deciding_game_points, firstServerRule: m.first_server_rule,
  switchEndsPrompt: m.switch_ends_prompt, timeLimitMinutes: m.time_limit_minutes, trackServerNames: !!m.track_server_names,
});
export const configOf = (m: MatchRow): MatchConfig => ({ playType: m.play_type, rules: rulesOf(m) });

export function loadMatchRow(ctx: Ctx, id: number): MatchRow | undefined {
  return ctx.db.prepare('SELECT * FROM matches WHERE id = ?').get(id) as MatchRow | undefined;
}

export function loadEvents(ctx: Ctx, matchId: number): EngineEvent[] {
  const rows = ctx.db.prepare(`SELECT e.seq, e.type, e.payload_json, e.at, e.voided_by_event_id, e.undoes_event_id,
      v.seq AS voided_by_seq, u.seq AS undoes_seq
    FROM match_events e
    LEFT JOIN match_events v ON v.id = e.voided_by_event_id
    LEFT JOIN match_events u ON u.id = e.undoes_event_id
    WHERE e.match_id = ? ORDER BY e.seq`).all(matchId) as
    { seq: number; type: EventType; payload_json: string; at: number; voided_by_seq: number | null; undoes_seq: number | null }[];
  return rows.map((r) => ({ seq: r.seq, type: r.type, payload: JSON.parse(r.payload_json), at: r.at, voidedBy: r.voided_by_seq, undoes: r.undoes_seq }));
}

export function loadState(ctx: Ctx, m: MatchRow): MatchState {
  if (m.state_json) { try { return JSON.parse(m.state_json) as MatchState; } catch { /* fall through to replay */ } }
  const ev = loadEvents(ctx, m.id);
  return ev.length ? replay(configOf(m), ev) : createInitialState();
}

interface PlayerRow { team: Team; slot: Slot; player_id: number | null; display_name: string | null }

export function loadPlayers(ctx: Ctx, matchId: number): PlayerRow[] {
  return ctx.db.prepare('SELECT team, slot, player_id, display_name FROM match_players WHERE match_id = ? ORDER BY team, slot').all(matchId) as PlayerRow[];
}

function slotsFor(playType: PlayType, team: Team, rows: PlayerRow[]): PlayerSlotDto[] {
  const n = playType === 'singles' ? 1 : 2;
  const out: PlayerSlotDto[] = [];
  for (let i = 1; i <= n; i++) {
    const r = rows.find((x) => x.team === team && x.slot === i);
    const name = r?.display_name ?? null;
    out.push({ slot: i as Slot, displayName: name ?? defaultPlayerLabel(playType, team, i as Slot), isDefaultLabel: name == null, playerId: r?.player_id ?? null });
  }
  return out;
}

const userName = (ctx: Ctx, id: number | null): string | null =>
  id == null ? null : ((ctx.db.prepare('SELECT display_name n FROM users WHERE id = ?').get(id) as { n: string } | undefined)?.n ?? null);

export function buildMatchSnapshot(ctx: Ctx, m: MatchRow): MatchSnapshot {
  const cfg = configOf(m);
  const st = loadState(ctx, m);
  const view = deriveView(st, cfg);
  const players = loadPlayers(ctx, m.id);
  const teams = {
    A: { name: m.team_a_name, players: slotsFor(m.play_type, 'A', players) },
    B: { name: m.team_b_name, players: slotsFor(m.play_type, 'B', players) },
  };
  const games: GameDto[] = st.games.map((g) => ({
    number: g.number, target: g.target, scoreA: g.score.A, scoreB: g.score.B, winner: g.winner,
    status: g.winner ? 'completed' : g.abandoned ? 'abandoned' : 'in_progress', startedAt: g.startedAt, endedAt: g.endedAt,
  }));
  let serverName: string | null = null;
  if (view.servingTeam && view.serverSlot && cfg.rules.trackServerNames && m.play_type === 'doubles' && cfg.rules.scoringType === 'side_out')
    serverName = teams[view.servingTeam].players.find((p) => p.slot === view.serverSlot)?.displayName ?? null;
  const canUndo = m.status === 'in_progress' && !!ctx.db.prepare(
    "SELECT 1 FROM match_events WHERE match_id = ? AND type IN ('RALLY_WON','ADJUST_SCORE','START_NEXT_GAME','RECORD_RESULT') AND voided_by_event_id IS NULL LIMIT 1").get(m.id);
  let end: MatchSnapshot['end'] = null;
  if (m.status === 'terminated' || m.status === 'completed') {
    const ev = ctx.db.prepare(`SELECT e.actor_user_id, e.actor_court_id FROM match_events e WHERE e.match_id = ? AND e.type = ?
      ORDER BY e.seq DESC LIMIT 1`).get(m.id, m.status === 'terminated' ? 'END_MATCH' : 'CONFIRM_MATCH_END') as { actor_user_id: number | null; actor_court_id: number | null } | undefined;
    end = {
      reason: (m.end_reason ?? 'completed') as NonNullable<MatchSnapshot['end']>['reason'], note: m.end_note, at: m.ended_at ?? m.last_event_at,
      byUser: userName(ctx, ev?.actor_user_id ?? m.ended_by_user_id), onCourt: ev?.actor_court_id
        ? ((ctx.db.prepare('SELECT name FROM courts WHERE id = ?').get(ev.actor_court_id) as { name: string } | undefined)?.name ?? null) : null,
    };
  }
  const la = st.lastAction;
  return {
    id: m.id, code: m.match_code, courtId: m.court_id, version: m.version, bookingId: m.booking_id,
    status: m.status, phase: m.phase, playType: m.play_type,
    rules: { ...cfg.rules, name: m.format_name, customized: !!m.rules_customized },
    teams, games,
    current: {
      gameNumber: view.gameNumber, score: view.score, servingTeam: view.servingTeam, serverNumber: view.serverNumber,
      serverSlot: view.serverSlot, serverName, serviceCourt: view.serviceCourt, rightSlot: view.rightSlot, scoreCall: view.scoreCall,
      gamePointTeam: view.gamePointTeam, matchPointTeam: view.matchPointTeam, isDecidingGame: view.isDecidingGame,
      switchEndsPending: st.switchEndsPending, timeUp: !!st.timeUp, suddenDeath: !!st.suddenDeath,
    },
    gamesWon: st.gamesWon, winner: st.winner, end, display: { leftTeam: st.leftTeam },
    timer: { startedAt: st.timer.startedAt, pausedAt: st.timer.pausedAt, pausedTotalMs: st.timer.pausedTotalMs, endedAt: st.timer.endedAt, timeLimitMinutes: m.time_limit_minutes },
    phaseChangedAt: m.phase_changed_at,
    autoConfirmAt: m.phase === 'match_over' && m.phase_changed_at ? m.phase_changed_at + (m.open_play_round_id != null ? OPEN_PLAY_CONFIRM_MS : ctx.settings().autoConfirmSeconds * 1000) : null,
    canUndo, lastAction: la ? { seq: la.seq, type: la.type, label: describeLastAction(la) } : null,
    needsReview: !!m.needs_review, createdBy: userName(ctx, m.created_by_user_id),
    openPlay: m.open_play_round_id != null ? openPlayInfo(ctx, m, st) : null,
  };
}

function openPlayInfo(ctx: Ctx, m: MatchRow, st: MatchState): OpenPlayInfo | null {
  const g = ctx.db.prepare(`SELECT g.id gid, r.id rid, r.number rnum, r.status rstatus, s.id sid, s.name sname FROM open_play_games g
    JOIN open_play_rounds r ON r.id = g.round_id JOIN open_play_sessions s ON s.id = r.session_id WHERE g.match_id = ?`).get(m.id) as
    { gid: number; rid: number; rnum: number; rstatus: string; sid: number; sname: string } | undefined;
  if (!g) return null;
  const decided = m.status === 'completed' || m.status === 'terminated' || m.phase === 'match_over';
  let waitingOn: OpenPlayInfo['waitingOn'] = [];
  if (decided && g.rstatus === 'active') {
    const now = ctx.now();
    const rows = ctx.db.prepare(`SELECT c.name, m2.status, m2.started_at, m2.paused_at, m2.paused_total_ms, m2.time_limit_minutes FROM open_play_games g2
      JOIN matches m2 ON m2.id = g2.match_id JOIN courts c ON c.id = g2.court_id
      WHERE g2.round_id = ? AND g2.id <> ? AND m2.status IN ('setup','in_progress','paused') ORDER BY c.display_order`).all(g.rid, g.gid) as
      { name: string; status: string; started_at: number | null; paused_at: number | null; paused_total_ms: number; time_limit_minutes: number | null }[];
    waitingOn = rows.map((r) => {
      const playing = r.status !== 'setup' && r.started_at != null;
      const el = playing ? now - r.started_at! - r.paused_total_ms - (r.paused_at ? now - r.paused_at : 0) : 0;
      return { courtName: r.name, status: playing ? 'playing' as const : 'scheduled' as const, timeLeftMs: playing && r.time_limit_minutes ? Math.max(0, r.time_limit_minutes * 60000 - el) : null };
    });
  }
  return { sessionId: g.sid, sessionName: g.sname, roundNumber: g.rnum, gameId: g.gid, waitingOn, decidedBy: st.decidedBy ?? null };
}

export interface CourtRow {
  id: number; name: string; short_code: string; description: string | null; display_order: number; is_active: number;
  maintenance_mode: number; maintenance_note: string | null; released_at: number | null;
}

export function bookingChip(ctx: Ctx, courtId: number): BookingChip {
  const now = ctx.now();
  const sel = 'SELECT id, booked_by_name, start_at, end_at FROM bookings';
  type R = { id: number; booked_by_name: string; start_at: number; end_at: number };
  const cur = ctx.db.prepare(`${sel} WHERE court_id = ? AND status = 'confirmed' AND start_at <= ? AND end_at > ? ORDER BY start_at LIMIT 1`).get(courtId, now, now) as R | undefined;
  const nxt = ctx.db.prepare(`${sel} WHERE court_id = ? AND status = 'confirmed' AND start_at > ? AND start_at < ? ORDER BY start_at LIMIT 1`).get(courtId, now, now + 86400_000) as R | undefined;
  const f = (r?: R) => (r ? { id: r.id, bookedByName: r.booked_by_name, startAt: r.start_at, endAt: r.end_at } : null);
  return { now: f(cur), next: f(nxt) };
}

export function deviceInfo(ctx: Ctx, courtId: number, details = false): CourtSnapshot['court']['device'] {
  const s = ctx.db.prepare(`SELECT s.id, s.last_seen_at, s.ip, s.client_label, u.display_name FROM user_sessions s JOIN users u ON u.id = s.user_id
    WHERE s.terminal_court_id = ?`).get(courtId) as { id: string; last_seen_at: number; ip: string | null; client_label: string | null; display_name: string } | undefined;
  if (!s) return null;
  const online = ctx.pub.isSessionOnline(s.id);
  const dto: NonNullable<CourtSnapshot['court']['device']> = { online, signedInUser: s.display_name, lastSeenAt: online ? ctx.now() : s.last_seen_at };
  if (details) { dto.ip = s.ip; dto.client = s.client_label; }
  return dto;
}

export function courtStatusOf(ctx: Ctx, c: CourtRow, activeMatch?: MatchRow | null, finished?: MatchRow | null) {
  const am = activeMatch === undefined ? (ctx.db.prepare("SELECT * FROM matches WHERE court_id = ? AND status IN ('setup','in_progress','paused')").get(c.id) as MatchRow | undefined) ?? null : activeMatch;
  const fin = finished === undefined ? (ctx.db.prepare("SELECT * FROM matches WHERE court_id = ? AND status IN ('completed','terminated') ORDER BY id DESC LIMIT 1").get(c.id) as MatchRow | undefined) ?? null : finished;
  const status = deriveCourtStatus({
    isActive: !!c.is_active, maintenanceMode: !!c.maintenance_mode, releasedAt: c.released_at, activeMatchStatus: am?.status as 'setup' | 'in_progress' | 'paused' | null ?? null,
    latestFinished: fin ? { status: fin.status, endedAt: fin.ended_at } : null, now: ctx.now(), completedDisplayMinutes: ctx.settings().completedDisplayMinutes,
  });
  return { status, am, fin };
}

export function buildCourtSnapshot(ctx: Ctx, courtId: number, opts: { deviceDetails?: boolean } = {}): CourtSnapshot | null {
  const c = ctx.db.prepare('SELECT * FROM courts WHERE id = ?').get(courtId) as CourtRow | undefined;
  if (!c) return null;
  const { status, am, fin } = courtStatusOf(ctx, c);
  const m = am ?? (status === 'completed' ? fin : null);
  return {
    snapshotSeq: ++ctx.snapshotSeq, serverTime: ctx.now(),
    court: {
      id: c.id, name: c.name, shortCode: c.short_code, isActive: !!c.is_active, status, maintenanceNote: c.maintenance_note,
      device: deviceInfo(ctx, c.id, opts.deviceDetails), booking: bookingChip(ctx, c.id),
    },
    match: m ? buildMatchSnapshot(ctx, m) : null,
  };
}
