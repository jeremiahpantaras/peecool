/** SQL migrations are embedded so the bundled service has no loose files to lose. DATABASE_SCHEMA.md is the spec. */
export interface Migration {
  id: number; name: string; sql: string;
  /** table rebuilds need foreign keys off (a PRAGMA that cannot change inside a transaction); the runner re-checks them afterwards */
  foreignKeysOff?: boolean;
}

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'init',
    sql: `
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(username) BETWEEN 3 AND 32),
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 60),
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','staff')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  last_failed_at INTEGER,
  locked_until INTEGER,
  last_login_at INTEGER,
  password_changed_at INTEGER NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0,1)),
  created_by_user_id INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX ix_users_role_active ON users(role, is_active);

CREATE TABLE courts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(name) BETWEEN 1 AND 40),
  short_code TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(short_code) BETWEEN 1 AND 4),
  description TEXT CHECK (description IS NULL OR length(description) <= 200),
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  maintenance_mode INTEGER NOT NULL DEFAULT 0 CHECK (maintenance_mode IN (0,1)),
  maintenance_note TEXT CHECK (maintenance_note IS NULL OR length(maintenance_note) <= 200),
  released_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX ix_courts_display_order ON courts(is_active, display_order);

CREATE TABLE user_sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  terminal_court_id INTEGER REFERENCES courts(id) ON DELETE SET NULL,
  terminal_assigned_at INTEGER,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip TEXT,
  user_agent TEXT,
  client_label TEXT
);
CREATE INDEX ix_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX ix_user_sessions_expires_at ON user_sessions(expires_at);
CREATE UNIQUE INDEX ux_user_sessions_terminal_court ON user_sessions(terminal_court_id) WHERE terminal_court_id IS NOT NULL;

CREATE TABLE bookings (
  id INTEGER PRIMARY KEY,
  booking_code TEXT NOT NULL UNIQUE,
  court_id INTEGER NOT NULL REFERENCES courts(id) ON DELETE RESTRICT,
  start_at INTEGER NOT NULL,
  end_at INTEGER NOT NULL CHECK (end_at > start_at),
  play_date TEXT NOT NULL,
  booked_by_name TEXT NOT NULL CHECK (length(booked_by_name) BETWEEN 1 AND 60),
  phone TEXT CHECK (phone IS NULL OR length(phone) <= 30),
  players_count INTEGER CHECK (players_count IS NULL OR players_count BETWEEN 1 AND 8),
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 300),
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled','no_show')),
  cancel_reason TEXT CHECK (cancel_reason IS NULL OR length(cancel_reason) <= 200),
  cancelled_at INTEGER,
  cancelled_by_user_id INTEGER REFERENCES users(id),
  created_by_user_id INTEGER NOT NULL REFERENCES users(id),
  updated_by_user_id INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL)
);
CREATE INDEX ix_bookings_court_time ON bookings(court_id, start_at);
CREATE INDEX ix_bookings_play_date ON bookings(play_date, status);
CREATE INDEX ix_bookings_booked_by ON bookings(booked_by_name COLLATE NOCASE);
CREATE TRIGGER tr_bookings_no_overlap_ins BEFORE INSERT ON bookings
WHEN NEW.status = 'confirmed' AND EXISTS (
  SELECT 1 FROM bookings b WHERE b.court_id = NEW.court_id AND b.status = 'confirmed' AND b.start_at < NEW.end_at AND b.end_at > NEW.start_at)
BEGIN SELECT RAISE(ABORT, 'BOOKING_CONFLICT'); END;
CREATE TRIGGER tr_bookings_no_overlap_upd BEFORE UPDATE OF court_id, start_at, end_at, status ON bookings
WHEN NEW.status = 'confirmed' AND EXISTS (
  SELECT 1 FROM bookings b WHERE b.id <> NEW.id AND b.court_id = NEW.court_id AND b.status = 'confirmed' AND b.start_at < NEW.end_at AND b.end_at > NEW.start_at)
BEGIN SELECT RAISE(ABORT, 'BOOKING_CONFLICT'); END;

CREATE TABLE players (
  id INTEGER PRIMARY KEY,
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 30),
  normalized_name TEXT NOT NULL,
  full_name TEXT CHECK (full_name IS NULL OR length(full_name) <= 80),
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 500),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX ix_players_normalized_name ON players(normalized_name);
CREATE INDEX ix_players_active_name ON players(is_active, normalized_name);

CREATE TABLE match_formats (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(name) BETWEEN 1 AND 50),
  scoring_type TEXT NOT NULL DEFAULT 'side_out' CHECK (scoring_type IN ('side_out','rally')),
  serving_mode TEXT NOT NULL DEFAULT 'auto' CHECK (serving_mode IN ('auto','off')),
  points_to_win INTEGER NOT NULL DEFAULT 11 CHECK (points_to_win BETWEEN 1 AND 50),
  win_by INTEGER NOT NULL DEFAULT 2 CHECK (win_by IN (1,2)),
  point_cap INTEGER CHECK (point_cap IS NULL OR point_cap > points_to_win),
  games_to_win INTEGER NOT NULL DEFAULT 1 CHECK (games_to_win IN (1,2,3)),
  deciding_game_points INTEGER CHECK (deciding_game_points IS NULL OR deciding_game_points BETWEEN 1 AND 50),
  first_server_rule TEXT NOT NULL DEFAULT 'start_server_2' CHECK (first_server_rule IN ('start_server_2','both_servers')),
  switch_ends_prompt TEXT NOT NULL DEFAULT 'deciding_game' CHECK (switch_ends_prompt IN ('off','deciding_game','every_game')),
  time_limit_minutes INTEGER CHECK (time_limit_minutes IS NULL OR time_limit_minutes BETWEEN 1 AND 600),
  track_server_names INTEGER NOT NULL DEFAULT 1 CHECK (track_server_names IN (0,1)),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (scoring_type <> 'side_out' OR serving_mode = 'auto')
);
CREATE UNIQUE INDEX ux_match_formats_default ON match_formats(is_default) WHERE is_default = 1;

CREATE TABLE matches (
  id INTEGER PRIMARY KEY,
  match_code TEXT NOT NULL UNIQUE,
  court_id INTEGER NOT NULL REFERENCES courts(id) ON DELETE RESTRICT,
  format_id INTEGER REFERENCES match_formats(id) ON DELETE SET NULL,
  booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
  format_name TEXT NOT NULL,
  rules_customized INTEGER NOT NULL DEFAULT 0 CHECK (rules_customized IN (0,1)),
  play_type TEXT NOT NULL CHECK (play_type IN ('singles','doubles')),
  scoring_type TEXT NOT NULL CHECK (scoring_type IN ('side_out','rally')),
  serving_mode TEXT NOT NULL CHECK (serving_mode IN ('auto','off')),
  points_to_win INTEGER NOT NULL,
  win_by INTEGER NOT NULL,
  point_cap INTEGER,
  games_to_win INTEGER NOT NULL CHECK (games_to_win IN (1,2,3)),
  deciding_game_points INTEGER,
  first_server_rule TEXT NOT NULL,
  switch_ends_prompt TEXT NOT NULL,
  time_limit_minutes INTEGER,
  track_server_names INTEGER NOT NULL DEFAULT 1,
  team_a_name TEXT NOT NULL CHECK (length(team_a_name) <= 30),
  team_b_name TEXT NOT NULL CHECK (length(team_b_name) <= 30),
  status TEXT NOT NULL CHECK (status IN ('setup','in_progress','paused','completed','terminated','cancelled')),
  phase TEXT CHECK (phase IN ('playing','game_over','match_over')),
  phase_changed_at INTEGER,
  version INTEGER NOT NULL DEFAULT 0,
  state_json TEXT CHECK (state_json IS NULL OR json_valid(state_json)),
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  ended_at INTEGER,
  paused_at INTEGER,
  paused_total_ms INTEGER NOT NULL DEFAULT 0,
  play_date TEXT NOT NULL,
  last_event_at INTEGER NOT NULL,
  games_won_a INTEGER NOT NULL DEFAULT 0,
  games_won_b INTEGER NOT NULL DEFAULT 0,
  winner_team TEXT CHECK (winner_team IN ('A','B')),
  end_reason TEXT CHECK (end_reason IN ('completed','time_up','injury','players_left','other')),
  end_note TEXT CHECK (end_note IS NULL OR length(end_note) <= 200),
  needs_review INTEGER NOT NULL DEFAULT 0 CHECK (needs_review IN (0,1)),
  created_by_user_id INTEGER NOT NULL REFERENCES users(id),
  created_on_court_id INTEGER REFERENCES courts(id),
  ended_by_user_id INTEGER REFERENCES users(id),
  corrected_at INTEGER,
  updated_at INTEGER NOT NULL,
  CHECK (scoring_type <> 'side_out' OR serving_mode = 'auto'),
  CHECK ((status IN ('in_progress','paused')) = (phase IS NOT NULL)),
  CHECK ((status = 'paused') = (paused_at IS NOT NULL)),
  CHECK (status <> 'completed' OR (winner_team IS NOT NULL AND ended_at IS NOT NULL)),
  CHECK (status <> 'terminated' OR (winner_team IS NULL AND ended_at IS NOT NULL AND end_reason IS NOT NULL AND end_reason <> 'completed')),
  CHECK (status <> 'cancelled' OR winner_team IS NULL)
);
CREATE UNIQUE INDEX ux_matches_active_court ON matches(court_id) WHERE status IN ('setup','in_progress','paused');
CREATE INDEX ix_matches_court_created ON matches(court_id, created_at DESC);
CREATE INDEX ix_matches_play_date ON matches(play_date, status);
CREATE INDEX ix_matches_status ON matches(status);
CREATE INDEX ix_matches_started_at ON matches(started_at);
CREATE INDEX ix_matches_booking ON matches(booking_id) WHERE booking_id IS NOT NULL;

CREATE TABLE match_players (
  id INTEGER PRIMARY KEY,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  team TEXT NOT NULL CHECK (team IN ('A','B')),
  slot INTEGER NOT NULL CHECK (slot IN (1,2)),
  player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  display_name TEXT CHECK (display_name IS NULL OR length(display_name) <= 30),
  CHECK (player_id IS NULL OR display_name IS NOT NULL)
);
CREATE UNIQUE INDEX ux_match_players_slot ON match_players(match_id, team, slot);
CREATE UNIQUE INDEX ux_match_players_player ON match_players(match_id, player_id) WHERE player_id IS NOT NULL;
CREATE INDEX ix_match_players_player ON match_players(player_id);
CREATE INDEX ix_match_players_typed_name ON match_players(display_name COLLATE NOCASE) WHERE player_id IS NULL AND display_name IS NOT NULL;

CREATE TABLE match_games (
  id INTEGER PRIMARY KEY,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  game_number INTEGER NOT NULL CHECK (game_number BETWEEN 1 AND 5),
  points_to_win INTEGER NOT NULL,
  score_a INTEGER NOT NULL DEFAULT 0 CHECK (score_a >= 0),
  score_b INTEGER NOT NULL DEFAULT 0 CHECK (score_b >= 0),
  first_serving_team TEXT CHECK (first_serving_team IN ('A','B')),
  status TEXT NOT NULL CHECK (status IN ('in_progress','completed','abandoned')),
  winner_team TEXT CHECK (winner_team IN ('A','B')),
  started_at INTEGER NOT NULL,
  ended_at INTEGER
);
CREATE UNIQUE INDEX ux_match_games_number ON match_games(match_id, game_number);

CREATE TABLE match_events (
  id INTEGER PRIMARY KEY,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  command_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('MATCH_CREATED','START_MATCH','RALLY_WON','UNDO','ADJUST_SCORE','START_NEXT_GAME','PAUSE','RESUME','SWAP_SIDES','CONFIRM_MATCH_END','END_MATCH','CANCEL','ADMIN_CORRECTION','UPDATE_PLAYERS','UPDATE_RULES')),
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  game_number INTEGER,
  score_a_after INTEGER,
  score_b_after INTEGER,
  serving_team_after TEXT CHECK (serving_team_after IN ('A','B')),
  server_number_after INTEGER CHECK (server_number_after IN (1,2)),
  outcome TEXT,
  voided_by_event_id INTEGER REFERENCES match_events(id),
  undoes_event_id INTEGER REFERENCES match_events(id),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user','system')),
  actor_user_id INTEGER REFERENCES users(id),
  actor_court_id INTEGER REFERENCES courts(id),
  at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  CHECK ((actor_type = 'user') = (actor_user_id IS NOT NULL) AND (actor_type = 'user' OR actor_court_id IS NULL))
);
CREATE UNIQUE INDEX ux_match_events_seq ON match_events(match_id, seq);
CREATE UNIQUE INDEX ux_match_events_command ON match_events(match_id, command_id);
CREATE INDEX ix_match_events_created_at ON match_events(created_at);

CREATE TABLE system_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  updated_at INTEGER NOT NULL,
  updated_by_user_id INTEGER REFERENCES users(id)
);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY,
  occurred_at INTEGER NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user','system','anonymous')),
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_court_id INTEGER REFERENCES courts(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  details_json TEXT CHECK (details_json IS NULL OR json_valid(details_json)),
  ip TEXT
);
CREATE INDEX ix_audit_logs_occurred_at ON audit_logs(occurred_at DESC);
CREATE INDEX ix_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX ix_audit_logs_action ON audit_logs(action);

CREATE TABLE create_requests (
  user_id INTEGER NOT NULL,
  client_request_id TEXT NOT NULL,
  match_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, client_request_id)
);
`,
  },
  {
    id: 2,
    name: 'open_play',
    foreignKeysOff: true,
    sql: `
-- Open Play sessions: timed, auto-matched rounds across several courts. Each game is an ordinary match.
CREATE TABLE open_play_sessions (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  play_type TEXT NOT NULL CHECK (play_type IN ('singles','doubles')),
  format_id INTEGER REFERENCES match_formats(id) ON DELETE SET NULL,
  format_name TEXT NOT NULL,
  rules_json TEXT NOT NULL CHECK (json_valid(rules_json)),
  session_minutes INTEGER NOT NULL CHECK (session_minutes BETWEEN 10 AND 720),
  game_minutes INTEGER NOT NULL CHECK (game_minutes BETWEEN 3 AND 120),
  changeover_minutes INTEGER NOT NULL DEFAULT 3 CHECK (changeover_minutes BETWEEN 0 AND 30),
  status TEXT NOT NULL CHECK (status IN ('setup','running','ending','finished','cancelled')),
  seed INTEGER NOT NULL,
  round_count INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER,
  ended_at INTEGER,
  created_by_user_id INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX ix_open_play_sessions_status ON open_play_sessions(status);

CREATE TABLE open_play_courts (
  session_id INTEGER NOT NULL REFERENCES open_play_sessions(id) ON DELETE CASCADE,
  court_id INTEGER NOT NULL REFERENCES courts(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL,
  PRIMARY KEY (session_id, court_id)
);

CREATE TABLE open_play_players (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES open_play_sessions(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 30),
  player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','resting','left')),
  joined_round INTEGER NOT NULL DEFAULT 1,
  base_played INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX ix_open_play_players_session ON open_play_players(session_id);

CREATE TABLE open_play_rounds (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES open_play_sessions(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','closed')),
  published_at INTEGER NOT NULL,
  closed_at INTEGER,
  UNIQUE (session_id, number)
);

CREATE TABLE open_play_games (
  id INTEGER PRIMARY KEY,
  round_id INTEGER NOT NULL REFERENCES open_play_rounds(id) ON DELETE CASCADE,
  match_id INTEGER UNIQUE REFERENCES matches(id) ON DELETE SET NULL,
  court_id INTEGER NOT NULL REFERENCES courts(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL
);
CREATE INDEX ix_open_play_games_round ON open_play_games(round_id);

CREATE TABLE open_play_game_players (
  game_id INTEGER NOT NULL REFERENCES open_play_games(id) ON DELETE CASCADE,
  op_player_id INTEGER NOT NULL REFERENCES open_play_players(id) ON DELETE CASCADE,
  team TEXT NOT NULL CHECK (team IN ('A','B')),
  slot INTEGER NOT NULL CHECK (slot IN (1,2)),
  PRIMARY KEY (game_id, op_player_id)
);
CREATE INDEX ix_open_play_game_players_player ON open_play_game_players(op_player_id);

ALTER TABLE matches ADD COLUMN open_play_round_id INTEGER REFERENCES open_play_rounds(id) ON DELETE SET NULL;
CREATE INDEX ix_matches_open_play ON matches(open_play_round_id) WHERE open_play_round_id IS NOT NULL;

-- match_events.type gains TIME_UP and RECORD_RESULT: SQLite cannot alter a CHECK, so rebuild the table (ids preserved).
CREATE TABLE match_events_new (
  id INTEGER PRIMARY KEY,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  command_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('MATCH_CREATED','START_MATCH','RALLY_WON','UNDO','ADJUST_SCORE','START_NEXT_GAME','PAUSE','RESUME','SWAP_SIDES','CONFIRM_MATCH_END','END_MATCH','CANCEL','ADMIN_CORRECTION','UPDATE_PLAYERS','UPDATE_RULES','TIME_UP','RECORD_RESULT')),
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  game_number INTEGER,
  score_a_after INTEGER,
  score_b_after INTEGER,
  serving_team_after TEXT CHECK (serving_team_after IN ('A','B')),
  server_number_after INTEGER CHECK (server_number_after IN (1,2)),
  outcome TEXT,
  voided_by_event_id INTEGER REFERENCES match_events_new(id),
  undoes_event_id INTEGER REFERENCES match_events_new(id),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user','system')),
  actor_user_id INTEGER REFERENCES users(id),
  actor_court_id INTEGER REFERENCES courts(id),
  at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  CHECK ((actor_type = 'user') = (actor_user_id IS NOT NULL) AND (actor_type = 'user' OR actor_court_id IS NULL))
);
INSERT INTO match_events_new (id, match_id, seq, command_id, type, payload_json, game_number, score_a_after, score_b_after, serving_team_after, server_number_after, outcome, voided_by_event_id, undoes_event_id, actor_type, actor_user_id, actor_court_id, at, created_at)
  SELECT id, match_id, seq, command_id, type, payload_json, game_number, score_a_after, score_b_after, serving_team_after, server_number_after, outcome, voided_by_event_id, undoes_event_id, actor_type, actor_user_id, actor_court_id, at, created_at FROM match_events;
DROP TABLE match_events;
ALTER TABLE match_events_new RENAME TO match_events;
CREATE UNIQUE INDEX ux_match_events_seq ON match_events(match_id, seq);
CREATE UNIQUE INDEX ux_match_events_command ON match_events(match_id, command_id);
CREATE INDEX ix_match_events_created_at ON match_events(created_at);
`,
  },
  {
    id: 3,
    name: 'open_play_player_names',
    sql: `
ALTER TABLE open_play_players ADD COLUMN first_name TEXT CHECK (first_name IS NULL OR length(first_name) <= 40);
ALTER TABLE open_play_players ADD COLUMN last_name TEXT CHECK (last_name IS NULL OR length(last_name) <= 40);
ALTER TABLE open_play_players ADD COLUMN team TEXT CHECK (team IS NULL OR length(team) <= 40);
`,
  },
];
