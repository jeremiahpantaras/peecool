import type {
  BookingStatus, BookingTimeState, CourtStatus, EarlyEndReason, MatchRules, MatchStatus, Phase, PlayType, Role, Slot, Team,
} from './types';
import type { PermissionKey } from './permissions';
import type { PublicSettings } from './settings';

export interface UserDto {
  id: number; username: string; displayName: string; role: Role; isActive: boolean;
  lastLoginAt: number | null; mustChangePassword: boolean; createdAt: number;
}
export interface TerminalDto { courtId: number; courtName: string }
export interface MeDto {
  user: Pick<UserDto, 'id' | 'username' | 'displayName' | 'role'>;
  permissions: PermissionKey[];
  publicSettings: PublicSettings;
  terminal: TerminalDto | null;
  mustChangePassword: boolean;
}

export interface BookingDto {
  id: number; code: string; courtId: number; courtName: string; courtActive: boolean;
  startAt: number; endAt: number; playDate: string; bookedByName: string; phone: string | null;
  playersCount: number | null; notes: string | null; status: BookingStatus; timeState: BookingTimeState;
  createdBy: string; createdAt: number; cancelReason: string | null;
}
export interface BookingChip {
  now: Pick<BookingDto, 'id' | 'bookedByName' | 'startAt' | 'endAt'> | null;
  next: Pick<BookingDto, 'id' | 'bookedByName' | 'startAt' | 'endAt'> | null;
}

export interface CourtDeviceDto { online: boolean; signedInUser: string | null; lastSeenAt: number | null; ip?: string | null; client?: string | null }

export interface PlayerSlotDto { slot: Slot; displayName: string; isDefaultLabel: boolean; playerId: number | null }

export interface GameDto {
  number: number; target: number; scoreA: number; scoreB: number; winner: Team | null;
  status: 'in_progress' | 'completed' | 'abandoned'; startedAt: number; endedAt: number | null;
}

export interface MatchSnapshot {
  id: number; code: string; courtId: number; version: number; bookingId: number | null;
  status: MatchStatus; phase: Phase | null; playType: PlayType;
  rules: MatchRules & { name: string; customized: boolean };
  teams: { A: { name: string; players: PlayerSlotDto[] }; B: { name: string; players: PlayerSlotDto[] } };
  games: GameDto[];
  current: {
    gameNumber: number | null; score: { A: number; B: number };
    servingTeam: Team | null; serverNumber: 1 | 2 | null; serverSlot: Slot | null; serverName: string | null;
    serviceCourt: 'right' | 'left' | null; rightSlot: { A: Slot; B: Slot } | null; scoreCall: string;
    gamePointTeam: Team | null; matchPointTeam: Team | null; isDecidingGame: boolean; switchEndsPending: boolean;
    timeUp: boolean; suddenDeath: boolean;
  };
  gamesWon: { A: number; B: number };
  winner: Team | null;
  end: { reason: EarlyEndReason | 'completed'; note: string | null; at: number; byUser: string | null; onCourt: string | null } | null;
  display: { leftTeam: Team };
  timer: { startedAt: number | null; pausedAt: number | null; pausedTotalMs: number; endedAt: number | null; timeLimitMinutes: number | null };
  phaseChangedAt: number | null;
  autoConfirmAt: number | null;
  canUndo: boolean;
  lastAction: { seq: number; type: string; label: string | null } | null;
  needsReview: boolean;
  createdBy: string | null;
  openPlay: OpenPlayInfo | null;
}

/** Present when a match is a game of an Open Play session. */
export interface OpenPlayInfo {
  sessionId: number; sessionName: string; roundNumber: number; gameId: number;
  /** this game is decided but other courts of the round are still playing */
  waitingOn: { courtName: string; status: 'scheduled' | 'playing'; timeLeftMs: number | null }[];
  decidedBy: 'target' | 'time' | 'tiebreak' | 'result' | null;
}

export interface CourtSnapshot {
  snapshotSeq: number; serverTime: number;
  court: {
    id: number; name: string; shortCode: string; isActive: boolean; status: CourtStatus;
    maintenanceNote: string | null; device: CourtDeviceDto | null; booking: BookingChip;
  };
  match: MatchSnapshot | null;
}

export interface Paged<T> { items: T[]; page: number; pageSize: number; total: number }

export interface PlayerListItem {
  key: string; kind: 'registered' | 'typed'; playerId: number | null; name: string; isActive: boolean;
  matches: number; wins: number; losses: number; lastPlayedAt: number | null;
}

export interface Activity { at: number; kind: string; courtId?: number; matchId?: number; text: string }
export interface Alert { id: string; level: 'info' | 'warning' | 'danger'; text: string; courtId?: number; adminOnly?: boolean }

export interface DashboardDto {
  kpis: {
    totalCourts: number; availableCourts: number; activeMatches: number; completedToday: number;
    matchesToday: number; bookingsToday: number; nextBooking: { courtName: string; startAt: number; bookedByName: string } | null;
    devicesOnline: number; devicesTotal: number;
  };
  courts: CourtSnapshot[];
  recentActivity: Activity[];
  alerts: Alert[];
}

export interface ApiErrorBody { error: { code: string; message: string; details?: any; requestId?: string }; snapshot?: CourtSnapshot }

/* ---- Open Play ---- */
export type OpenPlayStatus = 'setup' | 'running' | 'ending' | 'finished' | 'cancelled';
export type OpenPlayGameStatus = 'scheduled' | 'playing' | 'finished' | 'cancelled';

export interface OpenPlayPlayerDto {
  id: number; name: string; firstName: string | null; lastName: string | null; team: string | null; playerId: number | null; status: 'active' | 'resting' | 'left';
  played: number; wins: number; losses: number; pointsFor: number; pointsAgainst: number;
  net: number; avgDiff: number; rank: number | null; joinedRound: number;
  /** playing in the active round / waiting for the next one */
  now: 'playing' | 'waiting' | 'resting' | 'left';
}
export interface OpenPlayGameDto {
  id: number; courtId: number; courtName: string; matchId: number | null; matchCode: string | null; status: OpenPlayGameStatus;
  teamA: { id: number; name: string }[]; teamB: { id: number; name: string }[];
  scoreA: number; scoreB: number; winner: Team | null; decidedBy: 'target' | 'time' | 'tiebreak' | 'result' | null;
  timer: { startedAt: number | null; pausedAt: number | null; pausedTotalMs: number; timeLimitMinutes: number | null };
  timeUp: boolean; suddenDeath: boolean; matchStatus: MatchStatus | null; phase: Phase | null; endedEarly: boolean;
}
export interface OpenPlayRoundDto {
  id: number; number: number; status: 'active' | 'closed'; publishedAt: number; closedAt: number | null; games: OpenPlayGameDto[];
  waiting: { id: number; name: string }[];
}
export interface OpenPlaySessionSummary {
  id: number; name: string; playType: PlayType; status: OpenPlayStatus; startedAt: number | null; endsAt: number | null; endedAt: number | null;
  roundCount: number; playerCount: number; courtNames: string[]; sessionMinutes: number; gameMinutes: number;
}
export interface OpenPlaySessionDto extends OpenPlaySessionSummary {
  changeoverMinutes: number; formatName: string; rulesSummary: string; seed: number;
  courts: { id: number; name: string }[];
  players: OpenPlayPlayerDto[];
  currentRound: OpenPlayRoundDto | null;
  rounds: OpenPlayRoundDto[];
  standings: OpenPlayPlayerDto[];
  champions: string[];
  waitingForPlayers: boolean;
  /** time left in the session window (a new round only starts if a full game still fits) */
  warnings: string[];
}
