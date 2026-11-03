import type { PlayType } from '../types';

export interface PreviewInput { playType: PlayType; courts: number; players: number; sessionMinutes: number; gameMinutes: number; changeoverMinutes: number }
export interface Preview {
  perMatch: number; gamesPerRound: number; playingPerRound: number; waitingPerRound: number; rounds: number;
  gamesPerPlayerMin: number; gamesPerPlayerMax: number; warnings: string[];
}

/** The numbers shown on the setup screen before the Admin starts a session (R5, plan §2). */
export function previewSession(i: PreviewInput): Preview {
  const perMatch = i.playType === 'singles' ? 2 : 4;
  const gamesPerRound = Math.min(i.courts, Math.floor(i.players / perMatch));
  const playingPerRound = gamesPerRound * perMatch;
  const waitingPerRound = Math.max(0, i.players - playingPerRound);
  const roundLen = i.gameMinutes + i.changeoverMinutes;
  // a new round starts only if a full game still fits (R20a)
  const rounds = i.sessionMinutes < i.gameMinutes || roundLen <= 0 ? 0 : Math.floor((i.sessionMinutes - i.gameMinutes) / roundLen) + 1;
  const total = rounds * playingPerRound;
  const gamesPerPlayerMin = i.players ? Math.floor(total / i.players) : 0;
  const gamesPerPlayerMax = i.players ? Math.ceil(total / i.players) : 0;
  const warnings: string[] = [];
  if (i.players < perMatch) warnings.push(`At least ${perMatch} players are needed for ${i.playType}.`);
  if (i.courts < 1) warnings.push('Choose at least one court.');
  if (gamesPerRound > 0 && gamesPerRound < i.courts) warnings.push(`Only ${gamesPerRound} of ${i.courts} courts can be used with this many players.`);
  if (waitingPerRound > playingPerRound && playingPerRound > 0) warnings.push('More players are waiting than playing each round — consider more courts or Doubles.');
  if (gamesPerPlayerMax > 0 && gamesPerPlayerMax <= 2) warnings.push(`Each player will get only about ${gamesPerPlayerMax} game${gamesPerPlayerMax > 1 ? 's' : ''}; results will mix little before the session ends.`);
  return { perMatch, gamesPerRound, playingPerRound, waitingPerRound, rounds, gamesPerPlayerMin, gamesPerPlayerMax, warnings };
}
