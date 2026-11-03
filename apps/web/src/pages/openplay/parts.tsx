import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, Clock, Trophy } from 'lucide-react';
import type { OpenPlayGameDto, OpenPlayPlayerDto, OpenPlaySessionDto, OpenPlayStatus } from '@pickle/shared';
import { Badge, Button, Card, CardHeader, Field, Input, Modal, Notice, Select, Table, Td, Th, cx, fmtClock, useNow } from '../../ui';
import { courtsStore } from '../../lib/realtime';
import { useStore } from '../../lib/store';

export const teamNames = (t: { name: string }[]) => t.map((p) => p.name).join(' & ') || '—';

/** Live view of one game: the court's own snapshot (scores update instantly) merged over the session data. */
export function useLiveGame(g: OpenPlayGameDto) {
  const live = useStore(courtsStore)[g.courtId]?.match;
  const same = live && g.matchId === live.id ? live : null;
  const timer = same ? { startedAt: same.timer.startedAt, pausedAt: same.timer.pausedAt, pausedTotalMs: same.timer.pausedTotalMs, timeLimitMinutes: same.timer.timeLimitMinutes } : g.timer;
  const game1 = same?.games[0];
  return {
    scoreA: same ? (game1?.scoreA ?? 0) : g.scoreA, scoreB: same ? (game1?.scoreB ?? 0) : g.scoreB,
    timeUp: same ? same.current.timeUp : g.timeUp, suddenDeath: same ? same.current.suddenDeath : g.suddenDeath, timer,
    paused: same ? same.status === 'paused' : g.matchStatus === 'paused',
    winner: same ? same.winner : g.winner,
  };
}

/** Time left on one court's own clock (each court starts independently). */
export function useCourtClock(timer: { startedAt: number | null; pausedAt: number | null; pausedTotalMs: number; timeLimitMinutes: number | null }, running: boolean): number | null {
  const now = useNow(running ? 1000 : 10_000);
  if (!timer.startedAt || !timer.timeLimitMinutes) return null;
  const elapsed = now - timer.startedAt - timer.pausedTotalMs - (timer.pausedAt ? now - timer.pausedAt : 0);
  return timer.timeLimitMinutes * 60_000 - elapsed;
}

const STATUS: Record<OpenPlayGameDto['status'], { label: string; tone: 'info' | 'success' | 'neutral' | 'warn' }> = {
  scheduled: { label: 'Ready to start', tone: 'info' }, playing: { label: 'Playing', tone: 'success' }, finished: { label: 'Finished', tone: 'neutral' }, cancelled: { label: 'Cancelled', tone: 'warn' },
};

export function GameCard({ g, big, actions }: { g: OpenPlayGameDto; big?: boolean; actions?: React.ReactNode }) {
  const v = useLiveGame(g);
  const left = useCourtClock(v.timer, g.status === 'playing' && !v.paused);
  const win = g.status === 'finished' ? v.winner : null;
  return (
    <div data-testid="game-card" className={cx('rounded-xl border bg-surface p-4', g.status === 'playing' && v.timeUp ? 'border-warn' : 'border-line', big && 'p-6')}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className={cx('font-display', big ? 'text-4xl' : 'text-xl')}>{g.courtName}</h3>
        <Badge tone={STATUS[g.status].tone} className={big ? '!text-base' : ''}>{g.status === 'playing' && v.paused ? 'Paused' : g.endedEarly ? 'Ended early' : STATUS[g.status].label}</Badge>
      </div>
      {([['A', g.teamA, v.scoreA], ['B', g.teamB, v.scoreB]] as const).map(([t, team, score]) => (
        <div key={t} className={cx('flex items-center gap-3 border-l-4 py-1 pl-3', t === 'A' ? 'border-teamA' : 'border-teamB')}>
          <span className={cx('min-w-0 flex-1 truncate', big ? 'text-2xl' : 'text-base', win === t && 'font-bold', win && win !== t && 'text-muted')}>{teamNames(team)}</span>
          {win === t && <Trophy className="size-4 shrink-0 text-leaf" aria-label="Winner" />}
          <span className={cx('num font-bold', big ? 'text-6xl' : 'text-3xl')}>{g.status === 'scheduled' ? '–' : score}</span>
        </div>
      ))}
      <div className={cx('mt-2 flex items-center justify-between gap-2', big ? 'text-xl' : 'text-sm')}>
        {g.status === 'playing' ? (
          v.timeUp ? <span className={cx('font-bold', v.suddenDeath ? 'text-danger' : 'text-warn')}>{v.suddenDeath ? 'Tied — next rally wins' : 'Time up — final rally'}</span>
            : <span className={cx('tnum inline-flex items-center gap-1.5 font-semibold', left != null && left < 120_000 && 'text-warn')}><Clock className={big ? 'size-5' : 'size-4'} />{left != null ? `${fmtClock(Math.max(0, left))} left` : 'playing'}</span>
        ) : g.status === 'scheduled' ? <span className="inline-flex items-center gap-1.5 text-muted"><CalendarClock className="size-4" />{v.timer.timeLimitMinutes} min · starts when staff tap Start</span>
          : g.status === 'finished' && g.decidedBy ? <span className="text-muted">{({ target: 'Reached the target', time: 'Decided on time', tiebreak: 'Decided by the next rally', result: 'Result entered' } as const)[g.decidedBy]}</span> : <span />}
        {g.matchId && !big && <Link to={`/courts/${g.courtId}`} className="text-primary hover:underline">Open court</Link>}
      </div>
      {actions && <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">{actions}</div>}
    </div>
  );
}

export const STATUS_BADGE: Record<OpenPlayStatus, { label: string; tone: 'info' | 'success' | 'neutral' | 'warn' }> = {
  setup: { label: 'Setting up', tone: 'info' }, running: { label: 'Running', tone: 'success' }, ending: { label: 'Ending', tone: 'warn' }, finished: { label: 'Finished', tone: 'neutral' }, cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export function StandingsCard({ d, limit, big }: { d: OpenPlaySessionDto; limit?: number; big?: boolean }) {
  const rows = d.standings.filter((p) => p.status !== 'left' || p.played > 0).slice(0, limit ?? 200);
  return (
    <Card>
      <CardHeader title={d.status === 'finished' ? 'Final standings' : 'Standings'} sub="Net wins, then average point difference, then points per game" />
      {d.status === 'finished' && d.champions.length > 0 && <p className="flex items-center gap-2 border-b border-line bg-highlight/40 px-4 py-2 font-semibold"><Trophy className="size-5 text-leaf" />{d.champions.join(' & ')} {d.champions.length > 1 ? 'share first place' : 'wins'}</p>}
      <Table>
        <thead><tr><Th>#</Th><Th>Player</Th><Th>Team</Th><Th>W–L</Th><Th>Games</Th><Th>Avg ±</Th></tr></thead>
        <tbody>{rows.map((p) => (
          <tr key={p.id} className={cx(p.status !== 'active' && 'text-muted')}>
            <Td className={cx('num text-2xl font-bold', p.rank === 1 && 'text-primary', big && 'text-3xl')}>{p.rank ?? '–'}</Td><Td className={cx('font-medium', big && 'text-xl')}>{p.name}{p.status !== 'active' && <Badge className="ml-2">{p.status}</Badge>}</Td>
            <Td className={cx(big && 'text-xl', 'text-muted')}>{p.team ?? ''}</Td>
            <Td className={cx('tnum', big && 'text-xl')}>{p.wins}–{p.losses}</Td><Td className={cx('tnum', big && 'text-xl')}>{p.wins + p.losses}</Td><Td className={cx('tnum', big && 'text-xl')}>{p.wins + p.losses ? (p.avgDiff > 0 ? `+${p.avgDiff}` : p.avgDiff) : '–'}</Td>
          </tr>))}</tbody>
      </Table>
    </Card>
  );
}

export function WaitingChips({ names, big }: { names: string[]; big?: boolean }) {
  return names.length ? <div className="flex flex-wrap gap-2">{names.map((n) => <span key={n} className={cx('rounded-full border border-line bg-surface2 px-3 py-1 font-medium', big ? 'text-xl' : 'text-sm')}>{n}</span>)}</div> : <p className="text-sm text-muted">Nobody is waiting.</p>;
}

/* ---- Admin dialogs ---- */
export function ResultDialog({ g, onClose, onSave, busy }: { g: OpenPlayGameDto; onClose: () => void; onSave: (b: { scoreA: number; scoreB: number; winner?: 'A' | 'B' }) => void; busy: boolean }) {
  const [a, setA] = useState(String(g.scoreA)); const [b, setB] = useState(String(g.scoreB)); const [w, setW] = useState<'' | 'A' | 'B'>('');
  const level = a !== '' && a === b;
  return (
    <Modal open onClose={onClose} title={`Enter the result — ${g.courtName}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={a === '' || b === '' || (level && !w)} onClick={() => onSave({ scoreA: Number(a), scoreB: Number(b), winner: w || undefined })}>Save result</Button></>}>
      <div className="space-y-4">
        <p className="text-sm text-muted">Use this for a court whose device was offline, or one that never started. The game is recorded as played.</p>
        <div className="grid grid-cols-2 gap-4">
          <Field label={teamNames(g.teamA)}><Input type="number" min={0} inputMode="numeric" value={a} onChange={(e) => setA(e.target.value)} /></Field>
          <Field label={teamNames(g.teamB)}><Input type="number" min={0} inputMode="numeric" value={b} onChange={(e) => setB(e.target.value)} /></Field>
        </div>
        {level && <Field label="The score is level — who won?"><Select value={w} onChange={(e) => setW(e.target.value as 'A' | 'B')}><option value="">Choose…</option><option value="A">{teamNames(g.teamA)}</option><option value="B">{teamNames(g.teamB)}</option></Select></Field>}
      </div>
    </Modal>
  );
}

export function SwapDialog({ d, g, onClose, onSwap, busy }: { d: OpenPlaySessionDto; g: OpenPlayGameDto; onClose: () => void; onSwap: (a: number, b: number) => void; busy: boolean }) {
  const mine = [...g.teamA, ...g.teamB];
  const [out, setOut] = useState(mine[0]?.id ?? 0); const [inn, setInn] = useState(0);
  const others = d.currentRound!.games.filter((x) => x.id !== g.id && x.status === 'scheduled').flatMap((x) => [...x.teamA, ...x.teamB].map((p) => ({ ...p, where: x.courtName })));
  const options = [...d.currentRound!.waiting.map((p) => ({ ...p, where: 'waiting' })), ...others];
  return (
    <Modal open onClose={onClose} title={`Swap a player — ${g.courtName}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!out || !inn} onClick={() => onSwap(out, inn)}>Swap</Button></>}>
      <div className="space-y-4">
        <Field label="Take out"><Select value={out} onChange={(e) => setOut(Number(e.target.value))}>{mine.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        <Field label="Put in (from the waiting list or another game that has not started)"><Select value={inn} onChange={(e) => setInn(Number(e.target.value))}><option value={0}>Choose…</option>{options.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.where})</option>)}</Select></Field>
        <Notice>The two players change places; the court's screen updates straight away.</Notice>
      </div>
    </Modal>
  );
}

export function PlayerStatusBadge({ p }: { p: OpenPlayPlayerDto }) {
  return p.now === 'playing' ? <Badge tone="success">Playing</Badge> : p.now === 'waiting' ? <Badge tone="info">Waiting</Badge> : p.now === 'resting' ? <Badge tone="warn">Resting</Badge> : <Badge>Left</Badge>;
}
