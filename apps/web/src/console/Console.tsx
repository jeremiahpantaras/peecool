import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, Clock, Menu, MoreHorizontal, Pause, Play, Undo2, Wrench, WifiOff } from 'lucide-react';
import type { CourtSnapshot, MatchSnapshot, MeDto, Team } from '@pickle/shared';
import { Badge, Button, ConnectionBadge, Modal, Notice, StatusPill, Timer, cx, fmtClock, matchElapsed, useNow } from '../ui';
import { busyStore, sendCommand } from '../lib/commands';
import { connStore } from '../lib/realtime';
import { useStore } from '../lib/store';
import { fmtDuration, fmtTime } from '../lib/time';
import { toastError } from '../lib/toast';
import { post } from '../lib/api';
import { clockOffset } from '../lib/clock';
import { useLogout } from '../lib/auth';
import { useAssignCourt } from '../pages/AssignCourt';
import { NAV, ADMIN_NAV } from '../layout/Shell';
import { ScorePanel, endReasonLabel, gameScoresLine, playersLine, teamText, type Variant } from './parts';
import { AdjustDialog, CancelMatchDialog, EditNamesDialog, EndMatchSheet, ServeDialog } from './Dialogs';
import { ChangeRulesDialog, NewMatchWizard } from './Wizard';

/** NFR-OFF-03: scoring is locked (after a 1.5 s grace) whenever the Master is unreachable. */
export function useScoringLocked(): { locked: boolean; status: string } {
  const c = useStore(connStore);
  const [grace, setGrace] = useState(false);
  useEffect(() => {
    if (c.status === 'connected') { setGrace(false); return; }
    const t = setTimeout(() => setGrace(true), 1500);
    return () => clearTimeout(t);
  }, [c.status]);
  return { locked: c.status !== 'connected' && grace, status: c.status };
}

export function CourtConsole({ snap, me, variant, onMenu }: { snap: CourtSnapshot; me: MeDto; variant: Variant; onMenu?: () => void }) {
  const m = snap.match;
  const { locked, status } = useScoringLocked();
  const busy = useStore(busyStore);
  const conn = useStore(connStore);
  const holdMs = me.publicSettings.endMatchHoldMs;
  const [wizard, setWizard] = useState(false);
  const [serve, setServe] = useState<'start' | 'next' | null>(null);
  const [adjust, setAdjust] = useState(false); const [endOpen, setEndOpen] = useState(false); const [names, setNames] = useState(false);
  const [rules, setRules] = useState(false); const [cancel, setCancel] = useState(false); const [more, setMore] = useState(false);
  const big = variant === 'console';
  const disabled = locked || busy;

  const run = async (type: Parameters<typeof sendCommand>[1], payload: Record<string, unknown> = {}) => {
    if (!m) return;
    try { await sendCommand(m, type, payload); } catch (e) { toastError(e); }
  };

  const c = snap.court;
  const wrap = cx('relative flex min-h-0 flex-col bg-bg text-ink', big ? 'h-full' : 'overflow-hidden rounded-xl border border-line');
  const wrapStyle = big ? undefined : { height: 'max(640px, calc(100dvh - 190px))' };
  let body: React.ReactNode;
  if (c.status === 'inactive') body = <Center big={big}><h2 className="text-3xl font-bold">{c.name} is not in service</h2><p className="mt-2 text-lg text-muted">Please see the front desk.</p></Center>;
  else if (c.status === 'maintenance') body = (
    <Center big={big}><Wrench className="mb-3 size-14 text-st-maintenance" /><h2 className="text-3xl font-bold">Under maintenance</h2>{c.maintenanceNote && <p className="mt-2 text-xl">{c.maintenanceNote}</p>}
      <Button className="mt-6" size="lg" onClick={async () => { try { await post(`courts/${c.id}/maintenance`, { enabled: false }); } catch (e) { toastError(e); } }}>End maintenance</Button></Center>);
  else if (!m) body = <IdleView snap={snap} big={big} disabled={locked} onNew={() => setWizard(true)} />;
  else if (m.status === 'setup') body = <ReadyView m={m} big={big} disabled={disabled} onStart={() => setServe('start')} onNames={() => setNames(true)} onRules={() => setRules(true)} onCancel={() => setCancel(true)} />;
  else if (m.status === 'completed') body = <ResultView m={m} snap={snap} big={big} disabled={locked} onNew={() => setWizard(true)} />;
  else if (m.status === 'terminated') body = <EndedEarlyView m={m} snap={snap} big={big} disabled={locked} onNew={() => setWizard(true)} />;
  else body = (
    <LiveView m={m} variant={variant} disabled={disabled} locked={locked}
      onRally={(t) => void run('RALLY_WON', { team: t })} onUndo={() => void run('UNDO')} onPause={() => void run('PAUSE')} onResume={() => void run('RESUME')}
      onSwap={() => void run('SWAP_SIDES')} onNextGame={() => setServe('next')} onConfirm={() => void run('CONFIRM_MATCH_END')} onMore={() => setMore(true)} />
  );

  return (
    <div className={wrap} style={wrapStyle}>
      <TopBar snap={snap} variant={variant} onMenu={onMenu} />
      {status !== 'connected' && (
        <div className="flex items-center gap-3 bg-warn-tint px-4 py-3 text-base font-semibold text-warn" role="alert">
          <WifiOff className="size-6 shrink-0" />
          <span>{status === 'restarting' ? 'Master is restarting…' : 'Reconnecting to the Master…'} Scoring is paused{locked ? '' : ' (checking the connection)'}. Keep the score on paper if play continues — you can fix it with “Adjust score” afterwards.
            {conn.lastSyncAt && <span className="ml-2 font-normal">Last updated {fmtTime(conn.lastSyncAt)}</span>}</span>
        </div>
      )}
      <div className={cx('relative flex min-h-0 flex-1 flex-col', locked && 'opacity-80')}>{body}</div>

      {m && (m.status === 'in_progress' || m.status === 'paused') && (
        <>
          <ServeDialog m={m} mode="next" open={serve === 'next'} onClose={() => setServe(null)} big={big} />
          <AdjustDialog m={m} open={adjust} onClose={() => setAdjust(false)} />
          <EndMatchSheet m={m} open={endOpen} onClose={() => setEndOpen(false)} holdMs={holdMs} />
        </>
      )}
      {m && m.status === 'setup' && <ServeDialog m={m} mode="start" open={serve === 'start'} onClose={() => setServe(null)} big={big} />}
      {m && ['setup', 'in_progress', 'paused'].includes(m.status) && <EditNamesDialog m={m} open={names} onClose={() => setNames(false)} />}
      {m && m.status === 'setup' && (<><ChangeRulesDialog m={m} open={rules} onClose={() => setRules(false)} /><CancelMatchDialog m={m} open={cancel} onClose={() => setCancel(false)} /></>)}
      <NewMatchWizard snap={snap} open={wizard} onClose={() => setWizard(false)} onCreated={(startNow) => { if (startNow) setTimeout(() => setServe('start'), 50); }} />
      {m && (
        <Modal open={more} onClose={() => setMore(false)} title="More">
          <div className="grid gap-3">
            <Button size="xl" disabled={disabled || m.phase !== 'playing'} onClick={() => { setMore(false); setAdjust(true); }}>Adjust score</Button>
            {m.openPlay && m.status === 'in_progress' && m.phase === 'playing' && (
              <Button size="xl" variant="primary" disabled={disabled || m.current.score.A === m.current.score.B} onClick={() => { setMore(false); void run('RECORD_RESULT', {}); }}>
                Finish at this score ({m.current.score.A}–{m.current.score.B}){m.current.score.A === m.current.score.B ? ' — level' : ''}
              </Button>
            )}
            <Button size="xl" disabled={locked} onClick={() => { setMore(false); void run('SWAP_SIDES'); }}>Swap screen sides</Button>
            <Button size="xl" disabled={locked} onClick={() => { setMore(false); setNames(true); }}>Edit names</Button>
            <Button size="xl" variant="danger" disabled={locked || m.phase === 'match_over'} onClick={() => { setMore(false); setEndOpen(true); }}>End match early…</Button>
            <p className="text-center text-xs text-muted">{c.name} · {m.code} · v{m.version} · clock offset {Math.round(clockOffset())} ms</p>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Center({ children, big }: { children: React.ReactNode; big: boolean }) {
  return <div className={cx('flex flex-1 flex-col items-center justify-center p-6 text-center', big && 'text-xl')}>{children}</div>;
}

/* ----------------------------------------------------------------- top bar */
function TopBar({ snap, variant, onMenu }: { snap: CourtSnapshot; variant: Variant; onMenu?: () => void }) {
  const m = snap.match;
  const active = m && (m.status === 'in_progress' || m.status === 'paused');
  const now = useNow(1000);
  const limit = m?.timer.timeLimitMinutes ?? null;
  const remaining = active && limit && m ? limit * 60_000 - matchElapsed(m, now) : null;
  const best = m ? (m.rules.gamesToWin === 1 ? '1 game' : `Best of ${m.rules.gamesToWin * 2 - 1}`) : '';
  return (
    <>
      <header className={cx('flex items-center justify-between gap-3 border-b border-t-4 border-line border-t-court bg-surface px-4', variant === 'console' ? 'h-16' : 'h-14')}>
        <div className="flex min-w-0 items-center gap-3">
          {onMenu && <button aria-label="Menu" onClick={onMenu} className="grid size-11 place-items-center rounded-lg bg-surface2"><Menu className="size-6" /></button>}
          <img src="/brand/app-icon.svg" alt="Peecool" className="size-8 shrink-0" /><h1 className={cx('font-display truncate', variant === 'console' ? 'text-3xl' : 'text-2xl')}>{snap.court.name}</h1>
          {m?.openPlay && <span className="hidden whitespace-nowrap sm:inline-flex"><Badge tone="info" className="!text-sm">Open Play · Round {m.openPlay.roundNumber}</Badge></span>}
          <span className="hidden sm:block"><ConnectionBadge /></span>
        </div>
        {m && m.current.gameNumber != null && active && (
          <div className="hidden text-center sm:block"><p className="text-lg font-bold">GAME {m.current.gameNumber} · {best}</p><p className="text-xs text-muted">{m.playType === 'singles' ? 'Singles' : 'Doubles'} · {m.rules.name}</p></div>
        )}
        <div className="flex items-center gap-3">
          {m && m.timer.startedAt != null && (
            <span className={cx('tnum flex items-center gap-1.5 font-bold', variant === 'console' ? 'text-2xl' : 'text-lg', remaining != null && remaining <= 0 ? 'text-danger' : remaining != null && remaining <= 5 * 60_000 ? 'text-warn' : '')}>
              <Clock className="size-5 text-muted" /><Timer match={m} />{limit && <span className="text-base font-medium text-muted">/ {fmtClock(limit * 60_000)}</span>}
            </span>
          )}
          {!active && <StatusPill status={snap.court.status} />}
        </div>
      </header>
      {m?.openPlay && active && m.current.timeUp ? (
        <div className={cx('px-4 py-2 text-center text-base font-bold', m.current.suddenDeath ? 'bg-danger text-white' : 'bg-warn-tint text-warn')} role="alert">
          {m.current.suddenDeath ? 'TIED — the next rally won decides the game' : 'TIME IS UP — play out this rally; then the higher score wins'}
        </div>
      ) : (
        <>
          {remaining != null && remaining <= 0 && <div className="bg-danger px-4 py-2 text-center text-base font-bold text-white" role="alert">Time limit reached</div>}
          {remaining != null && remaining > 0 && remaining <= 5 * 60_000 && <div className="bg-warn-tint px-4 py-1.5 text-center text-sm font-bold text-warn">Less than 5 minutes left</div>}
        </>
      )}
    </>
  );
}

/* -------------------------------------------------------------------- idle */
function IdleView({ snap, big, disabled, onNew }: { snap: CourtSnapshot; big: boolean; disabled: boolean; onNew: () => void }) {
  const b = snap.court.booking;
  return (
    <Center big={big}>
      <p className="text-lg text-muted">Ready for play</p>
      <h2 className={cx('mb-6 font-bold', big ? 'text-6xl' : 'text-4xl')}>{snap.court.name}</h2>
      <Button variant="primary" size="xl" className={big ? '!min-h-24 !px-14 !text-3xl' : ''} disabled={disabled} onClick={onNew}>New match</Button>
      {b.now && <BookingNote kind="now" b={b.now} />}
      {!b.now && b.next && <BookingNote kind="next" b={b.next} />}
    </Center>
  );
}
function BookingNote({ kind, b }: { kind: 'now' | 'next'; b: { bookedByName: string; startAt: number; endAt: number } }) {
  return <p className="mt-6 inline-flex items-center gap-2 rounded-full bg-warn-tint px-4 py-2 text-base font-medium text-warn"><CalendarClock className="size-5" />{kind === 'now' ? 'Reserved now' : 'Next booking'} — {b.bookedByName}, {fmtTime(b.startAt)}–{fmtTime(b.endAt)}</p>;
}

/* ------------------------------------------------------------ ready (setup) */
function ReadyView({ m, big, disabled, onStart, onNames, onRules, onCancel }: { m: MatchSnapshot; big: boolean; disabled: boolean; onStart: () => void; onNames: () => void; onRules: () => void; onCancel: () => void }) {
  return (
    <Center big={big}>
      <Badge tone="info" className="mb-3 !text-base">Ready to start</Badge>
      <p className="mb-4 text-lg text-muted">{m.playType === 'singles' ? 'Singles' : 'Doubles'} · {m.rules.name}</p>
      <div className="mb-8 grid w-full max-w-3xl grid-cols-2 gap-4">
        {(['A', 'B'] as Team[]).map((t) => (
          <div key={t} className={cx('rounded-2xl border-l-8 bg-surface p-4 text-left', t === 'A' ? 'border-teamA' : 'border-teamB')}>
            <p className={cx('text-2xl font-bold', teamText(t))}>{m.teams[t].name}</p><p className="mt-1 text-lg">{playersLine(m, t)}</p>
          </div>
        ))}
      </div>
      {m.openPlay && <p className="mb-4 text-lg font-semibold">Open Play · Round {m.openPlay.roundNumber} — start when all four are on court. Your {m.rules.timeLimitMinutes}-minute clock begins when you tap Start.</p>}
      <Button variant="primary" size="xl" className={big ? '!min-h-24 !px-16 !text-3xl' : ''} disabled={disabled} onClick={onStart}>{m.openPlay ? 'Start game' : 'Start match'}</Button>
      <div className="mt-6 flex flex-wrap justify-center gap-3"><Button size="lg" disabled={disabled} onClick={onNames}>Edit names</Button>{!m.openPlay && <><Button size="lg" disabled={disabled} onClick={onRules}>Change rules / type</Button><Button size="lg" variant="ghost" disabled={disabled} onClick={onCancel}>Cancel match</Button></>}</div>
    </Center>
  );
}

/* -------------------------------------------------------------------- live */
function LiveView({ m, variant, disabled, locked, onRally, onUndo, onPause, onResume, onSwap, onNextGame, onConfirm, onMore }: {
  m: MatchSnapshot; variant: Variant; disabled: boolean; locked: boolean; onRally: (t: Team) => void; onUndo: () => void; onPause: () => void; onResume: () => void;
  onSwap: () => void; onNextGame: () => void; onConfirm: () => void; onMore: () => void;
}) {
  const paused = m.status === 'paused';
  const playing = m.phase === 'playing' && !paused;
  const left = m.display.leftTeam; const right: Team = left === 'A' ? 'B' : 'A';
  const now = useNow(1000);
  const lastGame = m.games.at(-1);
  const lastWinner = lastGame?.winner;
  const prev = m.games.filter((g) => g.status === 'completed' && g.number !== m.current.gameNumber);
  return (
    <>
      {m.current.switchEndsPending && playing && (
        <button onClick={onSwap} disabled={locked} className="w-full bg-warn-tint px-4 py-3 text-lg font-bold text-warn">Switch ends — tap to swap the screen sides</button>
      )}
      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-2 landscape:grid-cols-2 landscape:grid-rows-1 md:grid-cols-2 md:grid-rows-1">
        <ScorePanel m={m} team={left} disabled={disabled || !playing} onRally={onRally} variant={variant} />
        <ScorePanel m={m} team={right} disabled={disabled || !playing} onRally={onRally} variant={variant} />
      </div>
      <footer className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 border-t border-line bg-surface px-3 py-2 sm:px-4 sm:py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted">{m.rules.servingMode === 'auto' ? 'Call' : 'Score'}</p>
          <p className={cx('num font-bold leading-none', variant === 'console' ? 'text-4xl sm:text-5xl' : 'text-3xl')}>{m.current.scoreCall.split('-').join(' – ')}</p>
        </div>
        <div className="min-w-0 flex-[2] text-sm text-muted">
          {m.lastAction?.label && <p className="truncate"><span className="font-medium text-ink">Last:</span> {m.lastAction.label}</p>}
          {prev.length > 0 && <p className="truncate tnum">Previous games: {prev.map((g) => `G${g.number} ${g.scoreA}–${g.scoreB}`).join(' · ')}</p>}
        </div>
        <div className="flex items-center gap-2">
          <Button size="xl" className="!min-h-14 min-w-28" disabled={disabled || !m.canUndo || paused} onClick={onUndo} icon={<Undo2 className="size-6" />}>Undo</Button>
          <Button size="xl" className="!min-h-14" disabled={locked} onClick={paused ? onResume : onPause} icon={paused ? <Play className="size-6" /> : <Pause className="size-6" />}>{paused ? 'Resume' : 'Pause'}</Button>
          <Button size="xl" className="!min-h-14 !px-4" aria-label="More actions" disabled={locked} onClick={onMore}><MoreHorizontal className="size-7" /></Button>
        </div>
      </footer>

      {paused && (
        <Overlay>
          <Pause className="mb-2 size-14 text-st-paused" /><h2 className="text-4xl font-bold">Paused</h2>
          <p className="tnum mb-6 mt-1 text-lg text-muted">Paused for {fmtClock(m.timer.pausedAt ? now - m.timer.pausedAt : 0)}</p>
          <Button variant="primary" size="xl" className="!min-h-24 !px-16 !text-3xl" disabled={locked} onClick={onResume} icon={<Play className="size-8" />}>Resume</Button>
        </Overlay>
      )}
      {!paused && m.phase === 'game_over' && lastGame && lastWinner && (
        <Overlay>
          <p className="text-lg font-semibold text-muted">GAME {lastGame.number}</p>
          <h2 className={cx('text-5xl font-bold', teamText(lastWinner))}>{m.teams[lastWinner].name} wins {lastWinner === 'A' ? lastGame.scoreA : lastGame.scoreB}–{lastWinner === 'A' ? lastGame.scoreB : lastGame.scoreA}</h2>
          <p className="mt-2 text-xl text-muted">Games: {m.teams.A.name} {m.gamesWon.A} – {m.gamesWon.B} {m.teams.B.name}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-4"><Button size="xl" disabled={disabled || !m.canUndo} onClick={onUndo} icon={<Undo2 className="size-6" />}>Undo last rally</Button><Button variant="primary" size="xl" disabled={locked} onClick={onNextGame}>Start Game {m.games.length + 1}</Button></div>
        </Overlay>
      )}
      {!paused && m.phase === 'match_over' && m.winner && (
        <Overlay>
          <p className="text-lg font-semibold text-muted">{m.openPlay ? 'GAME OVER' : 'MATCH OVER'}{m.openPlay?.decidedBy === 'time' ? ' · decided on time' : m.openPlay?.decidedBy === 'tiebreak' ? ' · decided by the next rally' : ''}</p>
          <h2 className={cx('text-5xl font-bold', teamText(m.winner))}>{m.openPlay ? m.teams[m.winner].players.map((p) => p.displayName).join(' & ') || m.teams[m.winner].name : m.teams[m.winner].name} {m.openPlay ? 'win' : 'wins the match'}</h2>
          <p className="tnum mt-2 text-2xl">{gameScoresLine(m)}</p>
          <p className="mt-1 text-muted">Duration {fmtDuration(matchElapsed(m, now))}</p>
          {m.autoConfirmAt && <p className="tnum mt-3 text-base text-muted">Auto-confirming in {fmtClock(Math.max(0, m.autoConfirmAt - now))}</p>}
          <div className="mt-8 flex flex-wrap justify-center gap-4"><Button size="xl" disabled={disabled || !m.canUndo} onClick={onUndo} icon={<Undo2 className="size-6" />}>Undo</Button><Button variant="primary" size="xl" disabled={locked} onClick={onConfirm}>Confirm result</Button></div>
        </Overlay>
      )}
    </>
  );
}
function Overlay({ children }: { children: React.ReactNode }) {
  return <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-bg/95 p-6 text-center backdrop-blur-sm">{children}</div>;
}

/* ------------------------------------------------------------ finished cards */
function useDone(snap: CourtSnapshot) {
  const [busy, setBusy] = useState(false);
  return { busy, done: async () => { setBusy(true); try { await post(`courts/${snap.court.id}/release`); } catch (e) { toastError(e); } finally { setBusy(false); } } };
}
/** Open Play: this court's game is decided; the next round is drawn when the last court finishes. */
function WaitingForOthers({ m, snap }: { m: MatchSnapshot; snap: CourtSnapshot }) {
  const now = useNow(1000);
  const op = m.openPlay!;
  return (
    <div className="mt-8 w-full max-w-xl rounded-2xl border border-line bg-surface p-4 text-left">
      <p className="text-lg font-bold">Waiting for the other courts</p>
      <p className="mb-3 text-sm text-muted">Round {op.roundNumber + 1} is drawn when the last court finishes — winners play winners.</p>
      {op.waitingOn.length === 0 ? <p className="text-base font-medium text-st-live">All courts are done — drawing the next round…</p> : (
        <ul className="space-y-1.5">{op.waitingOn.map((w) => {
          const left = w.timeLeftMs == null ? null : Math.max(0, w.timeLeftMs - (now - snap.serverTime));
          return <li key={w.courtName} className="flex items-center justify-between text-base"><span className="font-medium">{w.courtName}</span><span className="tnum text-muted">{w.status === 'scheduled' ? 'not started yet' : left != null ? `${fmtClock(left)} left` : 'playing'}</span></li>;
        })}</ul>
      )}
    </div>
  );
}

function ResultView({ m, snap, big, disabled, onNew }: { m: MatchSnapshot; snap: CourtSnapshot; big: boolean; disabled: boolean; onNew: () => void }) {
  const { busy, done } = useDone(snap);
  const w = m.winner;
  if (m.openPlay) return (
    <Center big={big}>
      <p className="text-lg text-muted">GAME OVER{m.openPlay.decidedBy === 'time' ? ' · decided on time' : m.openPlay.decidedBy === 'tiebreak' ? ' · decided by the next rally' : ''}</p>
      {w && <h2 className={cx('text-5xl font-bold', teamText(w))}>{m.teams[w].players.map((p) => p.displayName).join(' & ')} win</h2>}
      <p className="tnum mt-2 text-4xl font-bold">{gameScoresLine(m)}</p>
      <WaitingForOthers m={m} snap={snap} />
    </Center>
  );
  return (
    <Center big={big}>
      <p className="text-lg text-muted">FINAL</p>
      {w && <h2 className={cx('text-5xl font-bold', teamText(w))}>{m.teams[w].name} wins</h2>}
      <p className="tnum mt-2 text-3xl font-bold">{gameScoresLine(m)}</p>
      <p className="mt-1 text-lg text-muted">{playersLine(m, 'A')} v {playersLine(m, 'B')} · {fmtDuration(matchElapsed(m, m.timer.endedAt ?? 0))}</p>
      <div className="mt-8 flex flex-wrap justify-center gap-4"><Button size="xl" loading={busy} disabled={disabled} onClick={() => void done()}>Done</Button><Button variant="primary" size="xl" disabled={disabled} onClick={onNew}>New match</Button></div>
    </Center>
  );
}
function EndedEarlyView({ m, snap, big, disabled, onNew }: { m: MatchSnapshot; snap: CourtSnapshot; big: boolean; disabled: boolean; onNew: () => void }) {
  const { busy, done } = useDone(snap);
  if (m.openPlay) return (
    <Center big={big}>
      <Badge tone="warn" className="mb-3 !text-base">GAME ENDED EARLY{m.end ? ` — ${endReasonLabel(m.end.reason)}` : ''}</Badge>
      <p className="text-muted">No winner is recorded; the players count as having played.</p>
      <p className="tnum mt-3 text-3xl font-bold">{gameScoresLine(m) || '—'}</p>
      <WaitingForOthers m={m} snap={snap} />
    </Center>
  );
  return (
    <Center big={big}>
      <Badge tone="warn" className="mb-3 !text-base">MATCH ENDED EARLY{m.end ? ` — ${endReasonLabel(m.end.reason)}` : ''}</Badge>
      <p className="text-muted">No winner is recorded</p>
      <div className="tnum mt-4 space-y-1 text-3xl font-bold">
        {m.games.map((g) => <p key={g.number}>Game {g.number}: {g.scoreA}–{g.scoreB}{g.status === 'abandoned' && <span className="ml-2 text-lg font-medium text-muted">(not finished)</span>}</p>)}
        {m.games.length === 0 && <p className="text-xl text-muted">No points were played</p>}
      </div>
      {m.end && <p className="mt-3 text-base text-muted">Ended at {fmtTime(m.end.at)}{m.end.byUser ? ` by ${m.end.byUser}` : ''}{m.end.note ? ` · ${m.end.note}` : ''}</p>}
      <div className="mt-8 flex flex-wrap justify-center gap-4"><Button size="xl" loading={busy} disabled={disabled} onClick={() => void done()}>Done</Button><Button variant="primary" size="xl" disabled={disabled} onClick={onNew}>New match</Button></div>
    </Center>
  );
}

/* ----------------------------------------------------- menu for console mode */
export function ConsoleMenu({ me, open, onClose }: { me: MeDto; open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const logout = useLogout();
  const { unassign } = useAssignCourt();
  const go = (to: string) => { onClose(); nav(to); };
  const conn = useStore(connStore);
  return (
    <Modal open={open} onClose={onClose} title={`${me.user.displayName} · ${me.user.role === 'admin' ? 'Admin' : 'Staff'}`}>
      <div className="grid gap-2">
        {NAV.map((n) => <Button key={n.to} size="lg" className="justify-start" onClick={() => go(n.to)} icon={<n.icon className="size-5" />}>{n.label}</Button>)}
        {me.user.role === 'admin' && ADMIN_NAV.map((n) => <Button key={n.to} size="lg" variant="ghost" className="justify-start" onClick={() => go(n.to)} icon={<n.icon className="size-5" />}>{n.label}</Button>)}
        <hr className="my-2 border-line" />
        <Button size="lg" className="justify-start" onClick={() => go('/account')}>My account</Button>
        {me.terminal && <Button size="lg" className="justify-start" onClick={async () => { await unassign(); onClose(); }}>Stop using this device for {me.terminal.courtName}</Button>}
        <Button size="lg" variant="danger" className="justify-start" onClick={() => void logout()}>Sign out</Button>
        <p className="mt-2 text-center text-xs text-muted">Connection: {conn.status}{conn.lastSyncAt ? ` · synced ${fmtTime(conn.lastSyncAt)}` : ''} · clock offset {Math.round(clockOffset())} ms</p>
      </div>
    </Modal>
  );
}
export { Notice, useMemo };
