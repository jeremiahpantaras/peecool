import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Clock } from 'lucide-react';
import { Badge, ErrorBox, Spinner, cx, fmtClock, useNow } from '../ui';
import { realtime } from '../lib/realtime';
import { fmtTime } from '../lib/time';
import { GameCard, StandingsCard, WaitingChips } from './openplay/parts';
import { useSession } from './OpenPlaySession';

/** Full-screen, read-only board for a TV in the lounge. Players have no logins; any signed-in device can show it. */
export default function OpenPlayBoard() {
  const id = Number(useParams().id);
  const q = useSession(id);
  const now = useNow(1000);
  useEffect(() => realtime.want('all'), []);
  const d = q.data;
  if (q.isLoading) return <Spinner />;
  if (q.error || !d) return <div className="p-8"><ErrorBox error={q.error} retry={() => q.refetch()} /></div>;
  const round = d.currentRound;
  const left = d.endsAt ? d.endsAt - now : null;
  return (
    <div className="min-h-full bg-bg p-6 text-fg">
      <header className="mb-6 flex flex-wrap items-center gap-x-8 gap-y-2">
        <h1 className="font-display text-5xl">{d.name}</h1>
        {round && d.status !== 'finished' && <Badge tone="primary" className="!text-xl">Round {round.number}</Badge>}
        {d.status === 'finished' && <Badge className="!text-xl">Finished</Badge>}
        {d.status === 'ending' && <Badge tone="warn" className="!text-xl">Final games</Badge>}
        <div className="ml-auto flex items-center gap-6 text-2xl">
          {left != null && (d.status === 'running' || d.status === 'ending') && <span className={cx('tnum inline-flex items-center gap-2 font-bold', left < 0 && 'text-warn')}><Clock className="size-7" />{left > 0 ? fmtClock(left) : 'Final round'}</span>}
          <span className="tnum text-muted">{fmtTime(now)}</span>
        </div>
      </header>
      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          {round && d.status !== 'finished' ? (
            <>
              <div className={cx('grid gap-4', round.games.length > 1 ? 'md:grid-cols-2' : '')}>{round.games.map((g) => <GameCard key={g.id} g={g} big />)}</div>
              <section><h2 className="mb-2 text-2xl font-bold">Waiting for the next round</h2><WaitingChips names={round.waiting.map((p) => p.name)} big /></section>
            </>
          ) : d.status === 'setup' ? <p className="text-3xl text-muted">Starting soon…</p> : d.status === 'finished' ? null : <p className="text-3xl text-muted">Next round coming up…</p>}
        </div>
        <StandingsCard d={d} limit={d.status === 'finished' ? 40 : 16} big />
      </div>
    </div>
  );
}
