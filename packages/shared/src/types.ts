export type Role = 'admin' | 'staff';
export type Team = 'A' | 'B';
export type Slot = 1 | 2;
export type PlayType = 'singles' | 'doubles';
export type ScoringType = 'side_out' | 'rally';
export type ServingMode = 'auto' | 'off';
export type FirstServerRule = 'start_server_2' | 'both_servers';
export type SwitchEndsPrompt = 'off' | 'deciding_game' | 'every_game';

export type MatchStatus = 'setup' | 'in_progress' | 'paused' | 'completed' | 'terminated' | 'cancelled';
export type Phase = 'playing' | 'game_over' | 'match_over';
export type CourtStatus =
  | 'inactive' | 'maintenance' | 'occupied' | 'in_progress' | 'paused' | 'completed' | 'available';
export type BookingStatus = 'confirmed' | 'cancelled' | 'no_show';
export type BookingTimeState = 'upcoming' | 'now' | 'past';
export type EndReason = 'completed' | 'time_up' | 'injury' | 'players_left' | 'other';
export type EarlyEndReason = Exclude<EndReason, 'completed'>;

export const COMMAND_TYPES = [
  'START_MATCH', 'RALLY_WON', 'UNDO', 'ADJUST_SCORE', 'START_NEXT_GAME', 'PAUSE', 'RESUME',
  'SWAP_SIDES', 'UPDATE_PLAYERS', 'UPDATE_RULES', 'CONFIRM_MATCH_END', 'END_MATCH', 'CANCEL', 'RECORD_RESULT',
] as const;
export type CommandType = (typeof COMMAND_TYPES)[number];
export type EventType = CommandType | 'MATCH_CREATED' | 'ADMIN_CORRECTION' | 'TIME_UP';

export type DecidedBy = 'target' | 'time' | 'tiebreak' | 'result';

export type Outcome =
  | 'point' | 'second_server' | 'side_out' | 'point_side_out' | 'adjusted'
  | 'game_won' | 'match_won';

export const ERROR_CODES = [
  'BAD_REQUEST', 'UNAUTHENTICATED', 'INVALID_CREDENTIALS', 'FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED',
  'SETUP_LOCAL_ONLY', 'ADMIN_LOGIN_RESTRICTED', 'CSRF_HEADER_MISSING', 'NOT_FOUND', 'MATCH_NOT_FOUND',
  'COURT_NOT_FOUND', 'BOOKING_NOT_FOUND', 'VERSION_CONFLICT', 'INVALID_STATE', 'NOTHING_TO_UNDO',
  'COURT_BUSY', 'COURT_UNAVAILABLE', 'COURT_HAS_DEVICE', 'BOOKING_CONFLICT', 'BOOKING_WARNING',
  'DUPLICATE_NAME', 'ACTIVE_MATCHES_EXIST', 'FUTURE_BOOKINGS_EXIST', 'LAST_ADMIN', 'SHORT_CODE_LOCKED',
  'VALIDATION_ERROR', 'BOOKING_INVALID', 'COURT_LIMIT_REACHED', 'ADJUST_WOULD_END_GAME',
  'INVALID_CORRECTION', 'INVALID_RULES', 'ACCOUNT_LOCKED', 'RATE_LIMITED', 'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR', 'SETUP_DONE', 'ALREADY_SETUP', 'COURT_IN_OPEN_PLAY', 'OPEN_PLAY_INVALID',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Rule fields snapshotted onto every match (and held by presets). */
export interface MatchRules {
  scoringType: ScoringType;
  servingMode: ServingMode;
  pointsToWin: number;
  winBy: 1 | 2;
  pointCap: number | null;
  gamesToWin: 1 | 2 | 3;
  decidingGamePoints: number | null;
  firstServerRule: FirstServerRule;
  switchEndsPrompt: SwitchEndsPrompt;
  timeLimitMinutes: number | null;
  trackServerNames: boolean;
}

export interface MatchConfig {
  playType: PlayType;
  rules: MatchRules;
}
