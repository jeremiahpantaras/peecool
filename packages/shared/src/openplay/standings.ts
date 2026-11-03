export type OpStatus = 'active' | 'resting' | 'left';

/** What the pairing and the standings need to know about one player in a session. */
export interface OpPlayerStat {
  id: number;
  name: string;
  status: OpStatus;
  /** games played for rotation purposes — includes games ended early (they still used court time) */
  played: number;
  /** games with a winner (the only ones that count toward wins, losses and points) */
  scored: number;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  /** round number the player last played in, or null */
  lastRound: number | null;
  joinedRound: number;
}

export interface StandingRow extends OpPlayerStat { net: number; avgDiff: number; avgFor: number; rank: number }

const r2 = (n: number) => Math.round(n * 100) / 100;

/** R24: net wins, then average point difference per game, then average points scored. Equal on all three → shared rank. */
export function rankPlayers(players: OpPlayerStat[]): StandingRow[] {
  const rows = players.map((p) => {
    const g = Math.max(1, p.scored);
    return { ...p, net: p.wins - p.losses, avgDiff: r2((p.pointsFor - p.pointsAgainst) / g), avgFor: r2(p.pointsFor / g), rank: 0 };
  });
  rows.sort((a, b) => b.net - a.net || b.avgDiff - a.avgDiff || b.avgFor - a.avgFor || a.name.localeCompare(b.name));
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    r.rank = prev && prev.net === r.net && prev.avgDiff === r.avgDiff && prev.avgFor === r.avgFor ? prev.rank : i + 1;
  });
  return rows;
}
