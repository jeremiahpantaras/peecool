import type { PlayType, Slot, Team } from './types';

/** Default label for an unnamed player slot (owner decision; DATABASE_SCHEMA §3.8). */
export function defaultPlayerLabel(playType: PlayType, team: Team, slot: Slot): string {
  if (playType === 'singles') return team === 'A' ? 'Player 1' : 'Player 2';
  return slot === 1 ? 'Player 1' : 'Player 2';
}

/** Team-level label used in exports: "Player 1 and Player 2" for unnamed doubles. */
export function defaultTeamPlayersLabel(playType: PlayType, team: Team): string {
  if (playType === 'singles') return team === 'A' ? 'Player 1' : 'Player 2';
  return 'Player 1 and Player 2';
}

/** Trim + collapse inner whitespace; empty string → null. */
export function normalizeTypedName(input: string | null | undefined): string | null {
  if (input == null) return null;
  const s = input.replace(/\s+/g, ' ').trim();
  return s.length === 0 ? null : s.slice(0, 30);
}

export function normalizeForSearch(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
