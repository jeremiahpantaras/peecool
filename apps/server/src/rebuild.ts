import { replay, type EngineEvent, type MatchConfig, type EventType } from '@pickle/shared';
import type { Db } from './db/client';

/** Support tool: rebuild matches.state_json from the event log (the source of truth). */
export function rebuildMatchState(db: Db, matchId: number): void {
  const m = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId) as Record<string, any> | undefined;
  if (!m) throw new Error(`Match ${matchId} not found`);
  const cfg: MatchConfig = { playType: m.play_type, rules: {
    scoringType: m.scoring_type, servingMode: m.serving_mode, pointsToWin: m.points_to_win, winBy: m.win_by, pointCap: m.point_cap, gamesToWin: m.games_to_win,
    decidingGamePoints: m.deciding_game_points, firstServerRule: m.first_server_rule, switchEndsPrompt: m.switch_ends_prompt, timeLimitMinutes: m.time_limit_minutes, trackServerNames: !!m.track_server_names } };
  const rows = db.prepare(`SELECT e.seq, e.type, e.payload_json, e.at, v.seq vs, u.seq us FROM match_events e
    LEFT JOIN match_events v ON v.id = e.voided_by_event_id LEFT JOIN match_events u ON u.id = e.undoes_event_id WHERE e.match_id = ? ORDER BY e.seq`).all(matchId) as any[];
  const events: EngineEvent[] = rows.map((r) => ({ seq: r.seq, type: r.type as EventType, payload: JSON.parse(r.payload_json), at: r.at, voidedBy: r.vs, undoes: r.us }));
  const state = replay(cfg, events);
  db.prepare('UPDATE matches SET state_json = ?, games_won_a = ?, games_won_b = ? WHERE id = ?').run(JSON.stringify(state), state.gamesWon.A, state.gamesWon.B, matchId);
}
