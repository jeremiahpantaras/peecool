import { useMemo, useRef } from 'react';
import { Clock, Hourglass, Lock, Trophy } from 'lucide-react';
import { projectNextRound, type OpenPlaySessionDto, type Pool, type ProjectedPlayer } from '@pickle/shared';
import { Badge, Card, CardHeader, cx, useNow } from '../../ui';
import { WAIT, buildLinks, useConnectors, useLiveScores } from './bracketKit';

export const POOL_LABEL: Record<Pool, string> = { winners: 'Winners', losers: 'Losers', even: 'Even', mixed: 'Mixed' };

function tag(p: ProjectedPlayer): { text: string; tone: 'wait' | 'won' | 'lost' | 'open' } {
  const f = p.from;
  if (!f) return { text: 'Waiting now', tone: 'wait' };
  if (f.state === 'pending') return { text: `${f.courtName} not decided`, tone: 'open' };
  const word = f.outcome === 'won' ? 'Won' : f.outcome === 'lost' ? 'Lost' : 'Ended';
  return { text: `${f.state === 'leading' ? (f.outcome === 'won' ? 'Leading' : 'Trailing') : word} · ${f.courtName}`, tone: f.outcome === 'lost' ? 'lost' : f.outcome === 'won' ? 'won' : 'open' };
}

function Chip({ p }: { p: ProjectedPlayer }) {
  const t = tag(p);
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="min-w-0 truncate font-medium">{p.name}</span>
      <span className={cx('inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold',
        t.tone === 'wait' ? 'bg-mint text-primary' : t.tone === 'won' ? 'bg-success-tint text-success' : t.tone === 'lost' ? 'bg-[var(--st-inactive-bg)] text-[var(--st-inactive)]' : 'bg-warn-tint text-warn')}>
        {t.tone === 'wait' ? <Hourglass className="size-3" aria-hidden /> : t.tone === 'open' ? <Clock className="size-3" aria-hidden /> : null}{t.text}
      </span>
    </div>
  );
}

/** Elbow connector with rounded corners (the admin page; the TV board uses curves). */
function elbow(e: { x1: number; y1: number; x2: number; y2: number; lane: number }): string {
  const { x1, y1, x2, y2 } = e;
  const xm = x1 + (x2 - x1) * (0.35 + 0.1 * Math.min(e.lane, 4)); const r = Math.min(10, Math.abs(y2 - y1) / 2); const dir = y2 >= y1 ? 1 : -1;
  return Math.abs(y2 - y1) < 2 ? `M${x1},${y1} H${x2}` : `M${x1},${y1} H${xm - r} Q${xm},${y1} ${xm},${y1 + dir * r} V${y2 - dir * r} Q${xm},${y2} ${xm + r},${y2} H${x2}`;
}

/**
 * The next round drawn as a bracket: this round's games and the waiting players on the left, the projected games on the right,
 * with a line from each source to the game its players move into. Non-elimination: nobody is knocked out, everyone keeps playing.
 */
export function NextRoundBracket({ d }: { d: OpenPlaySessionDto }) {
  const live = useLiveScores(d);
  const liveKey = JSON.stringify(live);
  const proj = useMemo(() => projectNextRound(d, live), [d, liveKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const now = useNow(15_000);
  const wrap = useRef<HTMLDivElement>(null);
  const src = useRef(new Map<number, HTMLElement>()); const tgt = useRef(new Map<number, HTMLElement>());
  const links = useMemo(() => buildLinks(proj), [proj]);
  const edges = useConnectors(wrap, links, proj, src, tgt);

  if (!d.currentRound || d.status !== 'running') return null;
  if (d.endsAt && now + d.gameMinutes * 60_000 > d.endsAt) return (
    <Card><CardHeader title="Next round" /><p className="p-5 text-sm text-muted">There is not enough session time left for another full game, so the session ends when the games in progress finish.</p></Card>
  );
  if (!proj) return (
    <Card><CardHeader title="Next round" /><p className="p-5 text-sm text-muted">Not enough active players for another full game. Add players to continue.</p></Card>
  );
  const cur = d.currentRound;
  const waiting = cur.waiting;
  const scoreOf = (gid: number, fallbackA: number, fallbackB: number) => live[gid] ?? { scoreA: fallbackA, scoreB: fallbackB };
  return (
    <Card data-testid="next-bracket">
      <CardHeader title={`Round ${proj.roundNumber} bracket`}
        sub={proj.final ? 'Every result is in. This is the round about to start.' : 'Waiting players already have their opponents. Names tagged Leading or not decided can still change until the last court finishes.'}
        actions={proj.final ? <Badge tone="success"><Lock className="size-3" />Locked</Badge> : <Badge tone="warn"><Clock className="size-3" />Projected, updates live</Badge>} />
      <div ref={wrap} className="relative p-5">
        <svg className="pointer-events-none absolute inset-0 hidden size-full lg:block" aria-hidden>
          {edges.map((e) => <path key={e.key} d={elbow(e)} fill="none" strokeWidth={2} strokeLinecap="round" className={e.solid ? 'stroke-primary' : 'stroke-leaf'} strokeDasharray={e.solid ? undefined : '5 5'} opacity={e.solid ? 0.9 : 0.7} />)}
        </svg>
        <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)_minmax(0,1.2fr)] lg:gap-0">
          {/* this round */}
          <div className="space-y-2 lg:pr-4">
            <p className="text-xs font-bold uppercase tracking-[.08em] text-muted">Round {cur.number}, now</p>
            {cur.games.filter((g) => g.status !== 'cancelled').map((g) => {
              const sc = scoreOf(g.id, g.scoreA, g.scoreB);
              return (
                <div key={g.id} ref={(el) => { if (el) src.current.set(g.id, el); else src.current.delete(g.id); }} className="rounded-xl border border-line bg-surface px-3 py-2 text-sm">
                  <div className="mb-1 flex items-center justify-between gap-2"><span className="text-base">{g.courtName}</span><Badge tone={g.status === 'finished' ? 'neutral' : g.status === 'playing' ? 'success' : 'info'}>{g.status === 'finished' ? 'Finished' : g.status === 'playing' ? 'Playing' : 'Not started'}</Badge></div>
                  {([['A', g.teamA, sc.scoreA], ['B', g.teamB, sc.scoreB]] as const).map(([t, team, score]) => (
                    <div key={t} className={cx('flex items-center gap-2 border-l-4 py-0.5 pl-2', t === 'A' ? 'border-teamA' : 'border-teamB', g.winner && g.winner !== t && 'text-muted')}>
                      <span className="min-w-0 flex-1 truncate">{team.map((p) => p.name).join(' & ')}</span>
                      {g.winner === t && <Trophy className="size-3.5 shrink-0 text-leaf" aria-label="Winner" />}
                      <span className="num tnum text-lg font-bold">{g.status === 'scheduled' ? '–' : score}</span>
                    </div>))}
                </div>
              );
            })}
            <div ref={(el) => { if (el) src.current.set(WAIT, el); else src.current.delete(WAIT); }} className="rounded-xl border border-dashed border-line-strong bg-mint px-3 py-2 text-sm">
              <p className="mb-1 flex items-center gap-1.5 font-bold text-primary"><Hourglass className="size-4" aria-hidden />Waiting now ({waiting.length})</p>
              <p className="text-muted">{waiting.length ? waiting.map((p) => p.name).join(', ') : 'Nobody is waiting.'}</p>
            </div>
          </div>
          {/* gap where the connector lines run */}
          <div className="hidden lg:block" aria-hidden />
          {/* next round */}
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-[.08em] text-muted">Round {proj.roundNumber}, {proj.final ? 'next' : 'projected'}</p>
            {proj.games.map((g, gi) => (
              <div key={g.courtId} data-testid="bracket-game" ref={(el) => { if (el) tgt.current.set(gi, el); else tgt.current.delete(gi); }} className="rounded-xl border-[1.5px] border-primary bg-surface px-3 py-2 text-sm shadow-card">
                <div className="mb-1 flex items-center justify-between gap-2"><p className="text-base">{g.courtName}</p><Badge tone={g.pool === 'winners' ? 'success' : g.pool === 'even' ? 'primary' : 'neutral'}>{POOL_LABEL[g.pool]}</Badge></div>
                {([['A', g.teamA], ['B', g.teamB]] as const).map(([t, team]) => (
                  <div key={t} className={cx('border-l-4 pl-2', t === 'A' ? 'border-teamA' : 'border-teamB')}>{team.map((p) => <Chip key={p.id} p={p} />)}</div>
                ))}
              </div>))}
            {proj.waitingAfter.length > 0 && <p className="rounded-xl bg-surface2 px-3 py-2 text-sm text-muted"><span className="font-bold text-ink">Then waiting ({proj.waitingAfter.length}):</span> {proj.waitingAfter.map((p) => p.name).join(', ')}</p>}
          </div>
        </div>
      </div>
      <p className="border-t border-line px-5 py-3 text-xs text-muted">Lines: solid = the result is final or the player is waiting; dashed = the game is still being played and the leader is counted for now. Games not decided yet draw no line; their players are tagged instead. The pool tag says whether the players meeting are all ahead (Winners), all behind (Losers), all level (Even) or a mix. Nobody is eliminated, and the round is drawn again from the real results when the last court finishes.</p>
    </Card>
  );
}
