import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { ErrorBox, Spinner, useNow } from '../ui';
import { realtime } from '../lib/realtime';
import { TvBracket, TvChampions, TvHeader, TvStandings } from './openplay/tv';
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
  // between rounds (manual mode) the last round is shown as finished, with the next one locked, until the Admin presses Begin
  const last = d.rounds.at(-1) ?? null;
  const view = d.awaitingBegin && last ? { ...d, currentRound: last } : d;
  const round = view.currentRound;
  return (
    <div className="min-h-full bg-bg p-6 text-ink">
      <TvHeader d={view} now={now} />
      {d.awaitingBegin && last && <p className="mt-4 rounded-2xl bg-accent px-6 py-3 text-2xl font-bold text-accent-ink" data-testid="tv-awaiting">Round {last.number} is complete. Round {last.number + 1} begins when the Admin presses Begin.</p>}
      {d.status === 'finished' ? (
        <div className="mx-auto mt-6 max-w-4xl space-y-6"><TvChampions names={d.champions} /><TvStandings d={d} limit={40} /></div>
      ) : (
        <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <main>{round ? <TvBracket d={view} /> : <p className="text-4xl text-muted">{d.status === 'setup' ? 'Starting soon…' : 'Next round coming up…'}</p>}</main>
          <TvStandings d={d} limit={10} />
        </div>
      )}
    </div>
  );
}
