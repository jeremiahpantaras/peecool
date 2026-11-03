import type { MatchRules } from './types';

export const MAX_ACTIVE_COURTS = 24;
export const SESSION_COOKIE = 'ps_session';
export const CSRF_HEADER = 'X-Pickle-Client';

export const DEFAULT_RULES: MatchRules = {
  scoringType: 'side_out',
  servingMode: 'auto',
  pointsToWin: 11,
  winBy: 2,
  pointCap: null,
  gamesToWin: 1,
  decidingGamePoints: null,
  firstServerRule: 'start_server_2',
  switchEndsPrompt: 'deciding_game',
  timeLimitMinutes: null,
  trackServerNames: true,
};

export interface SeedPreset { name: string; isDefault: boolean; rules: MatchRules }
const r = (o: Partial<MatchRules>): MatchRules => ({ ...DEFAULT_RULES, ...o });
export const SEED_PRESETS: SeedPreset[] = [
  { name: 'Standard – 1 game to 11', isDefault: true, rules: r({}) },
  { name: 'Best of 3 – games to 11', isDefault: false, rules: r({ gamesToWin: 2 }) },
  { name: '1 game to 15', isDefault: false, rules: r({ pointsToWin: 15 }) },
  { name: '1 game to 21', isDefault: false, rules: r({ pointsToWin: 21 }) },
  { name: 'Rally scoring – 1 game to 21', isDefault: false, rules: r({ scoringType: 'rally', pointsToWin: 21 }) },
  { name: 'Score only – 1 game to 11', isDefault: false, rules: r({ scoringType: 'rally', servingMode: 'off' }) },
];
