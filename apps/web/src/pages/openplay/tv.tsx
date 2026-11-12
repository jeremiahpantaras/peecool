import { useId, useMemo, useState } from 'react';
import { Clock, Hourglass, Trophy } from 'lucide-react';
import { projectNextRound, type OpenPlayGameDto, type OpenPlaySessionDto, type Pool, type ProjectedGame, type ProjectedPlayer } from '@pickle/shared';
import { cx, fmtClock, useNow } from '../../ui';
import { fmtTime } from '../../lib/time';
import { useCourtClock, useLiveGame } from './parts';
import { POOL_LABEL } from './Bracket';
import { FitHeight } from './bracketKit';

/* The TV board: a light, high-contrast scoreboard. One row per court: the game now on the left, the next game on that court on the right.
   Numerals are Geist Bold (tabular); each player in the next round carries a compact W / L / waiting / ? chip. */

/** Three bold chevrons (">>>"): they light up in turn and a lime shine sweeps across, so the eye moves from "now" to "next". */
function NextChevrons({ className = 'h-12 w-16' }: { className?: string }) {
  const id = useId();
  const chev = (x: number) => `M${x},0 H${x + 9} L${x + 21},20 L${x + 9},40 H${x} L${x + 12},20 Z`;
  return (
    <svg viewBox="0 0 53 40" className={cx(className, 'text-primary')} aria-hidden>
      <defs>
        <clipPath id={`${id}-c`}><path d={chev(0)} /><path d={chev(16)} /><path d={chev(32)} /></clipPath>
        <linearGradient id={`${id}-s`} x1="0" x2="1" y1="0" y2="0"><stop offset="0" stopColor="var(--c-accent)" stopOpacity="0" /><stop offset=".5" stopColor="var(--c-accent)" stopOpacity=".95" /><stop offset="1" stopColor="var(--c-accent)" stopOpacity="0" /></linearGradient>
      </defs>
      <path className="chev" d={chev(0)} fill="currentColor" /><path className="chev" d={chev(16)} fill="currentColor" /><path className="chev" d={chev(32)} fill="currentColor" />
      <g clipPath={`url(#${id}-c)`}><g className="chev-shine"><rect x="-14" y="-4" width="16" height="48" transform="skewX(-20)" fill={`url(#${id}-s)`} /></g></g>
    </svg>
  );
}

const courtNo = (name: string) => /(\d+)\s*$/.exec(name)?.[1] ?? name.slice(0, 1).toUpperCase();

type GlyphKind = 'won' | 'lost' | 'wait' | 'open' | 'ended';
function Glyph({ kind, no, provisional, label }: { kind: GlyphKind; no?: string; provisional?: boolean; label: string }) {
  if (kind === 'wait') return <span role="img" aria-label={label} title={label} className="grid h-7 min-w-9 shrink-0 place-items-center rounded-full bg-mint text-primary"><Hourglass className="size-4" /></span>;
  const cls = {
    won: 'bg-accent text-accent-ink', lost: 'bg-[var(--st-inactive-bg)] text-[var(--st-inactive)]', ended: 'bg-surface2 text-muted',
    open: 'border-2 border-dashed border-line-strong text-muted',
  }[kind];
  const letter = kind === 'won' ? 'W' : kind === 'lost' ? 'L' : kind === 'open' ? '?' : '–';
  return <span role="img" aria-label={label} title={label} className={cx('num inline-flex h-7 min-w-9 shrink-0 items-center justify-center rounded-full px-1.5 text-sm font-bold', cls, provisional && 'mx-1 outline outline-2 outline-offset-1 outline-dashed outline-ink/60')}>{letter}{no}</span>;
}

function SourceChip({ p }: { p: ProjectedPlayer }) {
  const f = p.from;
  if (!f) return <Glyph kind="wait" label="Waiting now" />;
  const no = courtNo(f.courtName);
  if (f.state === 'pending') return <Glyph kind="open" no={no} label={`${f.courtName} not decided yet`} />;
  const kind: GlyphKind = f.outcome === 'won' ? 'won' : f.outcome === 'lost' ? 'lost' : 'ended';
  const word = kind === 'won' ? 'Won' : kind === 'lost' ? 'Lost' : 'Ended';
  return <Glyph kind={kind} no={no} provisional={f.state === 'leading'} label={`${f.state === 'leading' ? (kind === 'won' ? 'Leading' : 'Trailing') : word} on ${f.courtName}`} />;
}

const POOL_CLS: Record<Pool, string> = { winners: 'bg-accent text-accent-ink', losers: 'bg-[var(--st-inactive-bg)] text-[var(--st-inactive)]', even: 'bg-mint text-primary', mixed: 'bg-surface2 text-muted' };

function TeamLines({ names, side, dim }: { names: string[]; side: 'A' | 'B'; dim?: boolean }) {
  return <div className={cx('min-w-0 space-y-0.5 border-l-4 pl-2.5 text-lg', side === 'A' ? 'border-teamA' : 'border-teamB', dim && 'text-muted')}>{names.map((n) => <p key={n} className="truncate">{n}</p>)}</div>;
}

/** One court as a scoreboard tile: names either side of the score, and a bar for that court's own clock. */
function CourtTile({ g }: { g: OpenPlayGameDto }) {
  const v = useLiveGame(g);
  const playing = g.status === 'playing';
  const left = useCourtClock(v.timer, playing && !v.paused);
  const limit = (v.timer.timeLimitMinutes ?? 0) * 60_000;
  const frac = g.status === 'finished' ? 1 : playing && left != null && limit ? Math.min(1, Math.max(0, 1 - left / limit)) : 0;
  const win = g.status === 'finished' ? v.winner : null;
  const level = playing && v.timeUp && v.scoreA === v.scoreB && !v.winner;   // time is up and the score is level: waiting for the winner to be picked
  const low = playing && left != null && left < 120_000;
  const chip = g.status === 'finished' ? { t: g.endedEarly ? 'Ended early' : 'Final', c: 'bg-[var(--st-inactive-bg)] text-[var(--st-inactive)]' }
    : g.status === 'scheduled' ? { t: 'Ready', c: 'bg-info-tint text-info' }
    : v.paused ? { t: 'Paused', c: 'bg-warn-tint text-warn' }
    : v.timeUp ? { t: level ? 'Level: deciding' : 'Time up', c: level ? 'bg-danger-tint text-danger' : 'bg-warn-tint text-warn' }
    : { t: 'Live', c: 'bg-accent text-accent-ink' };
  const text = g.status === 'finished' ? 'Final' : g.status === 'scheduled' ? 'Not started' : v.timeUp ? (level ? 'Deciding' : 'Time up') : left != null ? `${fmtClock(Math.max(0, left))} left` : 'Playing';
  return (
    <div data-testid="game-card" className="rounded-3xl border border-line bg-surface p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-display text-2xl leading-none">{g.courtName}</h3>
        <span className={cx('inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-bold', chip.c)}>{chip.t === 'Live' && <span className="pulse-dot size-2.5 rounded-full bg-current" />}{chip.t}</span>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
        <TeamLines names={g.teamA.map((p) => p.name)} side="A" dim={!!win && win !== 'A'} />
        <div key={`${v.scoreA}-${v.scoreB}`} className="score-pop num flex items-center gap-1.5 text-5xl font-bold leading-none" aria-label={g.status === 'scheduled' ? 'Not started' : `Score ${v.scoreA} to ${v.scoreB}`}>
          {g.status === 'scheduled' ? <span className="text-2xl font-semibold text-muted">vs</span> : <>
            <span className={cx('text-teamA', win && win !== 'A' && 'opacity-50')}>{v.scoreA}</span><span className="text-2xl text-muted">–</span><span className={cx('text-teamB', win && win !== 'B' && 'opacity-50')}>{v.scoreB}</span></>}
        </div>
        <div className="flex min-w-0 items-center justify-end gap-2">
          <div className="min-w-0 flex-1"><TeamLines names={g.teamB.map((p) => p.name)} side="B" dim={!!win && win !== 'B'} /></div>
          {win && <Trophy className="size-6 shrink-0 text-leaf" aria-label="Winner" />}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface2"><div className={cx('h-full rounded-full transition-[width] duration-1000 ease-linear', low ? 'bg-warn' : 'bg-primary')} style={{ width: `${frac * 100}%` }} /></div>
        <span className={cx('num min-w-24 text-right text-lg font-bold', low && 'text-warn')}>{text}</span>
      </div>
    </div>
  );
}

function ColumnLabel({ title, sub, pill }: { title: string; sub: string; pill?: React.ReactNode }) {
  return <p className="mb-3 flex items-center gap-3 text-lg font-bold uppercase tracking-[.08em] text-muted"><span>{title}</span><span className="rounded-full bg-surface2 px-3 py-0.5 text-base normal-case tracking-normal text-ink">{sub}</span>{pill}</p>;
}

/** The next game on one court: both teams, each player with a chip that says where they come from. */
function NextCard({ g }: { g: ProjectedGame }) {
  const undecided = [...g.teamA, ...g.teamB].some((p) => p.from?.state === 'pending');
  return (
    <div data-testid="bracket-game" className="rounded-3xl border border-line bg-surface p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-display text-2xl leading-none">{g.courtName}</h3>
        {/* the pool tag is only true once everyone in the game is known */}
        <span className={cx('rounded-full px-3 py-1 text-sm font-bold', undecided ? 'bg-surface2 text-muted' : POOL_CLS[g.pool])}>{undecided ? 'Pending' : POOL_LABEL[g.pool]}</span>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
        {([['A', g.teamA], ['B', g.teamB]] as const).map(([side, team], i) => (
          <div key={side} className="contents">
            {i === 1 && <span className="text-sm font-bold uppercase tracking-[.08em] text-muted">vs</span>}
            <div className={cx('min-w-0 space-y-1 border-l-4 pl-2.5', side === 'A' ? 'border-teamA' : 'border-teamB')}>
              {team.map((p) => (
                // a player is named only when it is certain: waiting now, or coming off a finished game. Anyone else is "Undecided".
                <div key={p.id} className="flex items-center gap-1.5 text-lg"><SourceChip p={p} />{p.from?.state === 'pending' ? <span className="truncate pr-1 italic text-muted">Undecided</span> : <span className="truncate">{p.name}</span>}</div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A game that exists only as a slot: nobody is named until real results decide the pairing. */
function PendingCard({ court }: { court: string }) {
  const slot = <div className="grid min-h-[4.5rem] place-items-center rounded-2xl border border-dashed border-line-strong bg-surface2/60 px-2 text-center text-base text-muted"><span className="inline-flex items-center gap-1.5"><Hourglass className="size-4 shrink-0" aria-hidden />Waiting for the winner/loser</span></div>;
  return (
    <div data-testid="pending-game" className="rounded-3xl border-2 border-dashed border-line-strong bg-surface/70 p-4">
      <div className="mb-3 flex items-center justify-between gap-3"><h3 className="font-display text-2xl leading-none text-muted">{court}</h3><span className="rounded-full bg-surface2 px-3 py-1 text-sm font-bold text-muted">Waiting</span></div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">{slot}<span className="text-sm font-bold uppercase tracking-[.08em] text-muted">vs</span>{slot}</div>
    </div>
  );
}

/** A court with nothing on it on one side of the row. */
function EmptySlot({ court, text }: { court: string; text: string }) {
  return <div className="grid place-items-center rounded-3xl border-2 border-dashed border-line-strong p-4 text-center"><p><span className="font-display text-2xl">{court}</span><span className="block text-lg text-muted">{text}</span></p></div>;
}

/** Names of players who are waiting, as one quiet line (only used when there is no next round to project). */
function WaitingLine({ label, names }: { label: string; names: string[] }) {
  if (!names.length) return null;
  return <p className="rounded-2xl bg-surface2 px-4 py-3 text-xl text-muted"><span className="font-bold text-ink">{label}</span> {names.join(', ')}</p>;
}

/**
 * Three columns of match cards, one row per court: the game now, the next game on that court (projected from real results) and
 * the game after that, which is only a slot ("Waiting for the winner/loser"): it is never guessed, and its players are named
 * only once real results decide the pairing (at which point it becomes the Up-next column).
 */
export function TvBracket({ d }: { d: OpenPlaySessionDto }) {
  const proj = useMemo(() => projectNextRound(d, {}, { provisional: false }), [d]); // real results only: leaders are not counted
  const now = useNow(15_000);
  const [, setScale] = useState(1);
  const cur = d.currentRound; if (!cur) return null;
  const games = cur.games.filter((g) => g.status !== 'cancelled');
  const note = d.status !== 'running' ? 'Final games: the session ends when the games in progress finish.'
    : d.endsAt && now + d.gameMinutes * 60_000 > d.endsAt ? 'Not enough session time is left for another full game.'
    : !proj ? 'Not enough active players for another full game.' : null;
  if (note || !proj) return (
    <div className="space-y-4">
      <p className="rounded-2xl bg-warn-tint px-5 py-3 text-2xl font-semibold text-warn">{note}</p>
      <div className={cx('grid gap-4', games.length > 1 && 'lg:grid-cols-2')}>{games.map((g) => <CourtTile key={g.id} g={g} />)}</div>
      <WaitingLine label="Waiting:" names={cur.waiting.map((p) => p.name)} />
    </div>
  );
  // A round after the next only shows if one could still start: the earliest is after the next round (one game length plus a changeover each) and it needs a full game of session time.
  const later = !(d.endsAt && now + 2 * (d.gameMinutes + d.changeoverMinutes) * 60_000 > d.endsAt);
  // one row per court, in the session's court order; a court can be empty in any column
  const rows = d.courts.map((c) => ({ c, now: games.find((g) => g.courtId === c.id) ?? null, next: proj.games.find((g) => g.courtId === c.id) ?? null }))
    .filter((r) => r.now || r.next);
  const chev = <div className="grid place-items-center" data-testid="next-chevrons"><NextChevrons className="h-10 w-12" /></div>;
  return (
    <FitHeight onScale={setScale}>
      <div data-testid="tv-bracket">
        <div className={cx('grid gap-y-4', later ? 'grid-cols-[minmax(0,1fr)_3.25rem_minmax(0,1fr)_3.25rem_minmax(0,1fr)]' : 'grid-cols-[minmax(0,1fr)_5rem_minmax(0,1.05fr)]')}>
          <ColumnLabel title="Now playing" sub={`Round ${cur.number}`} />
          <div aria-hidden />
          <ColumnLabel title="Up next" sub={`Round ${proj.roundNumber}`} pill={proj.final
            ? <span className="rounded-full bg-accent px-3 py-0.5 text-base normal-case tracking-normal text-accent-ink">Locked</span>
            : <span className="inline-flex items-center gap-1.5 rounded-full bg-warn-tint px-3 py-0.5 text-base normal-case tracking-normal text-warn"><Clock className="size-4" aria-hidden />Projected</span>} />
          {later && <><div aria-hidden /><ColumnLabel title="After next" sub={`Round ${proj.roundNumber + 1}`} pill={<span className="rounded-full border-2 border-dashed border-line-strong px-3 py-0.5 text-base normal-case tracking-normal text-muted">Waiting for results</span>} /></>}
          {rows.map(({ c, now: g, next }) => (
            <div key={c.id} className="contents">
              {g ? <CourtTile g={g} /> : <EmptySlot court={c.name} text="Free this round" />}
              {chev}
              {next ? <NextCard g={next} /> : <EmptySlot court={c.name} text="No game next round" />}
              {later && <>{chev}{next ? <PendingCard court={c.name} /> : <EmptySlot court={c.name} text="No game" />}</>}
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-base text-muted" aria-label="Legend">
          <span className="inline-flex items-center gap-2"><Glyph kind="won" no="2" label="Won court 2" />won court 2</span>
          <span className="inline-flex items-center gap-2"><Glyph kind="lost" no="2" label="Lost court 2" />lost court 2</span>
          <span className="inline-flex items-center gap-2"><Glyph kind="open" no="2" label="Undecided: waiting for court 2" />undecided: waiting for court 2's result</span>
          <span className="inline-flex items-center gap-2"><Glyph kind="wait" label="Waiting now" />waiting, plays next</span>
          {later && <span className="inline-flex items-center gap-2"><Hourglass className="size-4" aria-hidden />After next: names appear only when real results decide the pairing</span>}
        </div>
      </div>
    </FitHeight>
  );
}

/** Slim leaderboard for beside the bracket (or full width when the session is over). */
export function TvStandings({ d, limit = 10 }: { d: OpenPlaySessionDto; limit?: number }) {
  const rows = d.standings.filter((p) => p.status !== 'left' || p.played > 0).slice(0, limit);
  return (
    <section className="rounded-3xl border border-line bg-surface shadow-card" aria-label="Standings">
      <header className="flex items-baseline justify-between gap-3 px-6 pt-5"><h2 className="font-display text-3xl">{d.status === 'finished' ? 'Final standings' : 'Standings'}</h2><span className="text-sm text-muted">W–L · avg points ±</span></header>
      <ol className="p-3">
        {rows.map((p) => (
          <li key={p.id} className="flex items-center gap-2.5 rounded-2xl px-2.5 py-2 odd:bg-surface2/60">
            <span className={cx('num grid size-8 shrink-0 place-items-center rounded-full text-base font-bold', p.rank === 1 ? 'bg-primary text-primary-ink' : 'bg-surface2 text-ink')}>{p.rank ?? '–'}</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-lg font-medium">{p.name}</span>{p.team && <span className="block truncate text-sm text-muted">{p.team}</span>}</span>
            <span className="num text-lg font-bold">{p.wins}–{p.losses}</span>
            <span className={cx('num w-11 text-right text-lg font-bold', p.avgDiff > 0 ? 'text-success' : p.avgDiff < 0 ? 'text-muted' : 'text-muted')}>{p.played ? `${p.avgDiff > 0 ? '+' : ''}${p.avgDiff}` : '–'}</span>
          </li>))}
        {!rows.length && <li className="px-3 py-6 text-center text-lg text-muted">Standings appear after the first results.</li>}
      </ol>
    </section>
  );
}

/** Session title, round, clock and a progress bar for the session time. */
export function TvHeader({ d, now }: { d: OpenPlaySessionDto; now: number }) {
  const round = d.currentRound;
  const live = d.status === 'running' || d.status === 'ending';
  const left = d.endsAt ? d.endsAt - now : null;
  const frac = d.startedAt && d.endsAt ? Math.min(1, Math.max(0, (now - d.startedAt) / (d.endsAt - d.startedAt))) : 0;
  return (
    <header>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <img src="/brand/app-icon.svg" alt="Peecool" className="size-16 rounded-2xl" />
        <div className="min-w-0"><p className="text-base font-bold uppercase tracking-[.08em] text-muted">Open Play · {d.playType}</p><h1 className="font-display truncate text-6xl leading-none">{d.name}</h1></div>
        {round && d.status !== 'finished' && <span className="num rounded-full bg-primary px-5 py-1.5 text-3xl font-bold text-primary-ink">Round {round.number}{d.awaitingBegin ? ' complete' : ''}</span>}
        {d.status === 'ending' && <span className="rounded-full bg-warn-tint px-5 py-1.5 text-2xl font-bold text-warn">Final games</span>}
        {d.status === 'finished' && <span className="rounded-full bg-[var(--st-inactive-bg)] px-5 py-1.5 text-2xl font-bold text-[var(--st-inactive)]">Finished</span>}
        <div className="ml-auto text-right">
          {live && left != null && <><p className="text-sm font-bold uppercase tracking-[.08em] text-muted">Session time left</p><p className={cx('num text-6xl font-bold leading-none', left < 0 && 'text-warn')}>{left > 0 ? fmtClock(left) : 'Final round'}</p></>}
          <p className="num mt-1 text-2xl text-muted">{fmtTime(now)}</p>
        </div>
      </div>
      {live && <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-label="Session time used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(frac * 100)}><div className="h-full rounded-full bg-accent transition-[width] duration-1000 ease-linear" style={{ width: `${frac * 100}%` }} /></div>}
    </header>
  );
}

export function TvChampions({ names }: { names: string[] }) {
  if (!names.length) return null;
  return <p className="flex items-center gap-4 rounded-3xl bg-primary px-8 py-6 text-4xl text-primary-ink"><Trophy className="size-12 text-accent" aria-hidden /><span><span className="block text-base font-bold uppercase tracking-[.08em] text-[#CBD9C9]">{names.length > 1 ? 'Sharing first place' : 'Champion'}</span><span className="font-display">{names.join(' & ')}</span></span></p>;
}
