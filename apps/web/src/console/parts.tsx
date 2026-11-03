import { useRef } from 'react';
import { Circle, Dot } from 'lucide-react';
import type { MatchSnapshot, Team } from '@pickle/shared';
import { cx } from '../ui';

export const other = (t: Team): Team => (t === 'A' ? 'B' : 'A');
export const teamText = (t: Team) => (t === 'A' ? 'text-teamA' : 'text-teamB');
export const teamBg = (t: Team) => (t === 'A' ? 'bg-teamA' : 'bg-teamB');
export const teamTint = (t: Team) => (t === 'A' ? 'bg-teamA-tint' : 'bg-teamB-tint');
export const teamBorder = (t: Team) => (t === 'A' ? 'border-teamA' : 'border-teamB');

export type Variant = 'console' | 'workspace';

/** Two games-won dots per team (best of 1/3/5 → 1/2/3 dots). */
export function GamesDots({ won, need, team }: { won: number; need: number; team: Team }) {
  return (
    <span className="inline-flex items-center gap-1.5" aria-label={`Games won: ${won}`}>
      {Array.from({ length: need }, (_, i) => (i < won ? <Circle key={i} className={cx('size-5 fill-current', teamText(team))} /> : <Circle key={i} className="size-5 text-muted/60" />))}
    </span>
  );
}

export function playersLine(m: MatchSnapshot, t: Team): string {
  return m.teams[t].players.map((p) => p.displayName).join(' · ');
}

export function teamTitle(m: MatchSnapshot, t: Team): string {
  const n = m.teams[t].name;
  return n;
}

export function ServingTag({ m, team }: { m: MatchSnapshot; team: Team }) {
  if (m.rules.servingMode !== 'auto' || m.current.servingTeam !== team) return null;
  return <span className="inline-flex items-center gap-1 rounded-full bg-accent px-3 py-1 text-base font-bold tracking-wide text-accent-ink" aria-label="Serving"><Dot className="size-6 -mx-1 fill-current" />SERVING</span>;
}

/** FR-MATCH-15: ignores a second tap within 600 ms; disabled while a command is in flight or the link is down. */
export function RallyButton({ m, team, disabled, onTap }: { m: MatchSnapshot; team: Team; disabled: boolean; onTap: (t: Team) => void }) {
  const last = useRef(0);
  const label = m.rules.servingMode === 'off' ? `POINT — ${m.teams[team].name.toUpperCase()}` : `RALLY WON — ${m.teams[team].name.toUpperCase()}`;
  return (
    <button type="button" disabled={disabled}
      onClick={() => { const now = Date.now(); if (now - last.current < 600) return; last.current = now; onTap(team); }}
      className={cx('w-full shrink-0 rounded-2xl font-extrabold tracking-wide text-white transition active:scale-[.985] active:brightness-90 disabled:cursor-not-allowed disabled:opacity-40', teamBg(team))}
      style={{ height: 'clamp(64px, 22cqh, 210px)', fontSize: 'clamp(15px, min(4.4cqw, 5cqh), 34px)' }}>
      {label}
    </button>
  );
}

/**
 * Each half sizes itself from its own box (container-query units), so both teams always fit on screen —
 * phone portrait, phone landscape, tablets and the workspace preview — without scrolling (UI spec §5.1).
 */
export function ScorePanel({ m, team, disabled, onRally }: { m: MatchSnapshot; team: Team; disabled: boolean; onRally: (t: Team) => void; variant?: Variant }) {
  const serving = m.rules.servingMode === 'auto' && m.current.servingTeam === team;
  const gp = m.current.gamePointTeam === team;
  const mp = m.current.matchPointTeam === team;
  const score = m.current.score[team];
  const left = m.display.leftTeam === team;
  return (
    <section aria-label={`${m.teams[team].name} ${score}`} style={{ containerType: 'size' }}
      className={cx('min-h-0 min-w-0 overflow-hidden border-l-[12px]', teamBorder(team), serving ? teamTint(team) : 'bg-surface', !left && 'order-last')}>
      <div className="flex h-full min-h-0 flex-col justify-between" style={{ padding: 'clamp(8px, 2.4cqh, 24px) clamp(12px, 3cqw, 28px)', gap: '1cqh' }}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className={cx('truncate font-bold leading-tight', teamText(team))} style={{ fontSize: 'clamp(20px, min(7.5cqh, 8cqw), 54px)' }}>{m.teams[team].name}</h2>
            <p className="truncate text-muted" style={{ fontSize: 'clamp(14px, min(4.4cqh, 4.6cqw), 28px)' }}>
              {m.teams[team].players.map((p, i) => (
                <span key={p.slot}>{i > 0 && ' · '}<span className={cx(m.current.serverSlot === p.slot && serving && m.rules.trackServerNames && m.playType === 'doubles' && 'font-bold text-ink')}>{p.displayName}</span></span>
              ))}
            </p>
            {serving && (m.current.serverName || m.current.serviceCourt) && (
              <p className="truncate font-medium text-ink" style={{ fontSize: 'clamp(12px, min(3.6cqh, 4cqw), 22px)' }}>
                {m.current.serverName ? `Server: ${m.current.serverName}${m.current.serverNumber ? ` (${m.current.serverNumber === 1 ? '1st' : '2nd'})` : ''} · ` : ''}{m.current.serviceCourt} court
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <ServingTag m={m} team={team} />
            {(gp || mp) && <span className="rounded-full bg-highlight px-3 py-0.5 text-sm font-extrabold text-ink ring-1 ring-ink/20">{mp ? 'MATCH POINT' : 'GAME POINT'}</span>}
          </div>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <div key={score} className={cx('score-pop num text-center font-bold leading-[.85]', teamText(team))} style={{ fontSize: 'clamp(56px, min(48cqh, 44cqw), 480px)' }}>{score}</div>
        </div>
        <div className="flex items-center justify-between"><GamesDots won={m.gamesWon[team]} need={m.rules.gamesToWin} team={team} /><span className="text-xs text-muted">Games won</span></div>
        <RallyButton m={m} team={team} disabled={disabled} onTap={onRally} />
      </div>
    </section>
  );
}

export function gameScoresLine(m: MatchSnapshot): string {
  return m.games.map((g) => `${g.scoreA}–${g.scoreB}`).join('  ·  ');
}

export function endReasonLabel(r: string): string {
  return ({ time_up: 'Time up', injury: 'Injury', players_left: 'Players left', other: 'Other', completed: 'Completed' } as Record<string, string>)[r] ?? r;
}
