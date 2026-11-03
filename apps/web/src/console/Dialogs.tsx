import { useEffect, useMemo, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import type { MatchSnapshot, Slot, Team } from '@pickle/shared';
import { Button, ConfirmDialog, HoldButton, Modal, Notice, cx } from '../ui';
import { sendCommand } from '../lib/commands';
import { toastError } from '../lib/toast';
import { endReasonLabel, other, teamBg, teamText } from './parts';
import { NamesFields, type NameDraft, draftToSlots, draftFromMatch } from './Wizard';

/* ------------------------------------------------------------------ Serve */
export function ServeDialog({ m, mode, open, onClose, big }: { m: MatchSnapshot; mode: 'start' | 'next'; open: boolean; onClose: () => void; big?: boolean }) {
  const auto = m.rules.servingMode === 'auto';
  const prevGame = m.games.at(-1);
  // default server: the team that received first in the previous game (alternating first serve, Q13)
  const defaultServe: Team = mode === 'next' && prevGame ? (m.games.length % 2 === 1 ? 'B' : 'A') : 'A';
  const [serving, setServing] = useState<Team>(defaultServe);
  const [right, setRight] = useState<{ A: Slot; B: Slot }>({ A: 1, B: 1 });
  const [swap, setSwap] = useState(mode === 'next');
  const [leftTeam, setLeftTeam] = useState<Team>(m.display.leftTeam);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setServing(defaultServe); setSwap(mode === 'next'); setLeftTeam(m.display.leftTeam); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const askRight = auto && m.playType === 'doubles' && m.rules.trackServerNames && m.rules.scoringType === 'side_out';
  const go = async () => {
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {};
      if (auto) payload.servingTeam = serving;
      if (askRight) payload.startRight = right;
      if (mode === 'start') payload.leftTeam = leftTeam; else payload.swapDisplay = swap;
      await sendCommand(m, mode === 'start' ? 'START_MATCH' : 'START_NEXT_GAME', payload);
      onClose();
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  const title = mode === 'start' ? 'Start match' : `Start Game ${m.games.length + 1}`;
  return (
    <Modal open={open} onClose={onClose} title={title} footer={<><Button size={big ? 'lg' : 'md'} onClick={onClose}>Cancel</Button><Button variant="primary" size={big ? 'lg' : 'md'} loading={busy} onClick={() => void go()}>{title}</Button></>}>
      <div className="space-y-5">
        {auto ? (
          <div>
            <p className="mb-2 font-medium">Who serves first?</p>
            <div className="grid grid-cols-2 gap-3">{(['A', 'B'] as Team[]).map((t) => (
              <button key={t} onClick={() => setServing(t)} aria-pressed={serving === t} className={cx('min-h-16 rounded-xl border-2 px-3 text-lg font-bold', serving === t ? `${teamBg(t)} border-transparent text-white` : 'border-line bg-surface2')}>{m.teams[t].name}</button>
            ))}</div>
          </div>
        ) : <p className="text-sm text-muted">Serving is not tracked in this match — just tap the team that wins each point.</p>}
        {askRight && (['A', 'B'] as Team[]).map((t) => (
          <div key={t}>
            <p className="mb-2 font-medium">{m.teams[t].name}: who starts on the right-hand side?</p>
            <div className="grid grid-cols-2 gap-3">{m.teams[t].players.map((p) => (
              <button key={p.slot} onClick={() => setRight((r) => ({ ...r, [t]: p.slot }))} aria-pressed={right[t] === p.slot} className={cx('min-h-14 rounded-xl border-2 px-3 text-base font-semibold', right[t] === p.slot ? 'border-primary bg-primary/15' : 'border-line bg-surface2')}>{p.displayName}</button>
            ))}</div>
          </div>
        ))}
        {mode === 'start' ? (
          <div>
            <p className="mb-2 font-medium">Which team is on the left of this screen?</p>
            <div className="grid grid-cols-2 gap-3">{(['A', 'B'] as Team[]).map((t) => (
              <button key={t} onClick={() => setLeftTeam(t)} aria-pressed={leftTeam === t} className={cx('min-h-12 rounded-xl border-2 px-3 font-semibold', leftTeam === t ? 'border-primary bg-primary/15' : 'border-line bg-surface2')}>{m.teams[t].name}</button>
            ))}</div>
          </div>
        ) : (
          <label className="flex items-center gap-3 text-base"><input type="checkbox" className="size-5 accent-[var(--c-primary)]" checked={swap} onChange={(e) => setSwap(e.target.checked)} />Teams switched ends — swap screen sides</label>
        )}
      </div>
    </Modal>
  );
}

/* ----------------------------------------------------------------- Adjust */
export function AdjustDialog({ m, open, onClose }: { m: MatchSnapshot; open: boolean; onClose: () => void }) {
  const auto = m.rules.servingMode === 'auto';
  const dsn = m.playType === 'doubles' && m.rules.scoringType === 'side_out' && auto;
  const [a, setA] = useState(m.current.score.A); const [b, setB] = useState(m.current.score.B);
  const [serving, setServing] = useState<Team>(m.current.servingTeam ?? 'A');
  const [sn, setSn] = useState<1 | 2>(m.current.serverNumber ?? 1);
  const [right, setRight] = useState<{ A?: Slot; B?: Slot }>({});
  const [reason, setReason] = useState<string>('');
  const [adv, setAdv] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) { setA(m.current.score.A); setB(m.current.score.B); setServing(m.current.servingTeam ?? 'A'); setSn(m.current.serverNumber ?? 1); setRight({}); setReason(''); setErr(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const oldCall = m.current.scoreCall;
  const newCall = auto ? (dsn ? `${serving === 'A' ? a : b}-${serving === 'A' ? b : a}-${sn}` : `${serving === 'A' ? a : b}-${serving === 'A' ? b : a}`) : `${a}-${b}`;
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const payload: Record<string, unknown> = { scoreA: a, scoreB: b, reason: reason || undefined };
      if (auto) payload.servingTeam = serving;
      if (dsn) { payload.serverNumber = sn; if (Object.keys(right).length) payload.rightSlot = right; }
      await sendCommand(m, 'ADJUST_SCORE', payload); onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not adjust'); } finally { setBusy(false); }
  };
  const Stepper = ({ label, v, set, team }: { label: string; v: number; set: (n: number) => void; team: Team }) => (
    <div className="rounded-xl border border-line p-3 text-center">
      <p className={cx('mb-2 font-semibold', teamText(team))}>{label}</p>
      <div className="flex items-center justify-between gap-2">
        <Button size="xl" className="!min-h-14 w-16" aria-label={`Decrease ${label}`} onClick={() => set(Math.max(0, v - 1))}><Minus className="size-6" /></Button>
        <span className="tnum text-5xl font-extrabold">{v}</span>
        <Button size="xl" className="!min-h-14 w-16" aria-label={`Increase ${label}`} onClick={() => set(v + 1)}><Plus className="size-6" /></Button>
      </div>
    </div>
  );
  return (
    <Modal open={open} onClose={onClose} title="Adjust score" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void save()}>Save</Button></>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3"><Stepper label={m.teams.A.name} v={a} set={setA} team="A" /><Stepper label={m.teams.B.name} v={b} set={setB} team="B" /></div>
        {auto && <div><p className="mb-2 text-sm font-medium">Serving team</p><div className="grid grid-cols-2 gap-2">{(['A', 'B'] as Team[]).map((t) => <button key={t} onClick={() => setServing(t)} aria-pressed={serving === t} className={cx('min-h-12 rounded-lg border-2 font-semibold', serving === t ? 'border-primary bg-primary/15' : 'border-line bg-surface2')}>{m.teams[t].name}</button>)}</div></div>}
        {dsn && <div><p className="mb-2 text-sm font-medium">Server number</p><div className="grid grid-cols-2 gap-2">{([1, 2] as const).map((n) => <button key={n} onClick={() => setSn(n)} aria-pressed={sn === n} className={cx('min-h-12 rounded-lg border-2 font-semibold', sn === n ? 'border-primary bg-primary/15' : 'border-line bg-surface2')}>Server {n}</button>)}</div></div>}
        {dsn && <button className="text-sm text-primary underline" onClick={() => setAdv((x) => !x)}>{adv ? 'Hide' : 'Show'} player positions</button>}
        {dsn && adv && (['A', 'B'] as Team[]).map((t) => (
          <div key={t}><p className="mb-1 text-sm font-medium">{m.teams[t].name}: who is on the right-hand side now?</p>
            <div className="grid grid-cols-2 gap-2">{m.teams[t].players.map((p) => <button key={p.slot} onClick={() => setRight((r) => ({ ...r, [t]: p.slot }))} aria-pressed={right[t] === p.slot} className={cx('min-h-11 rounded-lg border-2 text-sm font-semibold', right[t] === p.slot ? 'border-primary bg-primary/15' : 'border-line bg-surface2')}>{p.displayName}</button>)}</div></div>
        ))}
        <div><p className="mb-2 text-sm font-medium">Reason (optional)</p><div className="flex flex-wrap gap-2">{['Missed rallies', 'Connection lost', 'Wrong server', 'Other'].map((r) => <button key={r} onClick={() => setReason(reason === r ? '' : r)} aria-pressed={reason === r} className={cx('rounded-full border px-3 py-1.5 text-sm', reason === r ? 'border-primary bg-primary/15' : 'border-line bg-surface2')}>{r}</button>)}</div></div>
        <div className="rounded-lg bg-surface2 p-3 text-center"><span className="text-sm text-muted">Call:</span> <span className="tnum text-lg font-semibold">{oldCall}</span> <span className="text-muted">→</span> <span className="tnum text-lg font-bold text-primary">{newCall}</span></div>
        {err && <Notice tone="danger">{err}</Notice>}
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------- End match */
const REASONS = ['time_up', 'injury', 'players_left', 'other'] as const;
/** FR-MATCH-13: reason → press-and-hold → confirmation dialog → END_MATCH {confirmed:true}. */
export function EndMatchSheet({ m, open, onClose, holdMs }: { m: MatchSnapshot; open: boolean; onClose: () => void; holdMs: number }) {
  const [reason, setReason] = useState<(typeof REASONS)[number] | null>(null);
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setReason(null); setNote(''); setConfirm(false); } }, [open]);
  const ready = reason != null && (reason !== 'other' || note.trim().length > 0);
  const done = m.games.filter((g) => g.status === 'completed').map((g) => `Game ${g.number}: ${g.scoreA}–${g.scoreB}`);
  const cur = m.games.find((g) => g.status === 'in_progress');
  const summary = [...done, cur ? `Game ${cur.number}: ${cur.scoreA}–${cur.scoreB} (in progress)` : null].filter(Boolean).join(' · ') || 'No points yet';
  const end = async () => {
    if (!reason) return;
    setBusy(true);
    try { await sendCommand(m, 'END_MATCH', { reason, note: reason === 'other' ? note.trim() : undefined, confirmed: true }); setConfirm(false); onClose(); }
    catch (e) { toastError(e); setConfirm(false); } finally { setBusy(false); }
  };
  return (
    <>
      <Modal open={open && !confirm} onClose={onClose} title="End match early">
        <div className="space-y-5">
          <p className="text-base text-muted">{summary}</p>
          <div><p className="mb-2 font-medium">Why is the match ending?</p>
            <div className="grid grid-cols-2 gap-3">{REASONS.map((r) => <button key={r} onClick={() => setReason(r)} aria-pressed={reason === r} className={cx('min-h-14 rounded-xl border-2 px-3 text-base font-semibold', reason === r ? 'border-danger bg-danger/10' : 'border-line bg-surface2')}>{endReasonLabel(r)}</button>)}</div></div>
          {reason === 'other' && <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Describe the reason" className="h-12 w-full rounded-lg border border-line bg-surface px-3 text-base" />}
          <HoldButton holdMs={holdMs} disabled={!ready} onComplete={() => setConfirm(true)} />
          <p className="text-center text-sm text-muted">Press and hold for {(holdMs / 1000).toFixed(holdMs % 1000 ? 1 : 0)} seconds. A quick tap does nothing.</p>
          <Button size="lg" className="w-full" onClick={onClose}>Cancel – keep playing</Button>
        </div>
      </Modal>
      <Modal open={confirm} onClose={() => setConfirm(false)} title="End this match?" dismissible={false}
        footer={<><Button size="lg" autoFocus onClick={() => setConfirm(false)}>Cancel</Button><Button size="lg" variant="danger" loading={busy} onClick={() => void end()}>Confirm end</Button></>}>
        <p className="text-base">{summary}.</p>
        <p className="mt-3 rounded-lg bg-danger/10 p-3 text-base font-semibold">The score is kept. <u>No winner will be recorded.</u></p>
        <p className="mt-2 text-sm text-muted">Reason: {reason ? endReasonLabel(reason) : ''}{note ? ` – ${note}` : ''}</p>
      </Modal>
    </>
  );
}

/* ------------------------------------------------------------ Edit names */
export function EditNamesDialog({ m, open, onClose }: { m: MatchSnapshot; open: boolean; onClose: () => void }) {
  const [d, setD] = useState<NameDraft>(() => draftFromMatch(m));
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setD(draftFromMatch(m)); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    setBusy(true);
    try {
      const r = await sendCommand(m, 'UPDATE_PLAYERS', { teamAName: d.teamAName, teamBName: d.teamBName, players: draftToSlots(d, m.playType) });
      r.warnings.forEach((w) => toastError(new Error(w))); onClose();
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} wide title="Team and player names" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void save()}>Save names</Button></>}>
      <NamesFields playType={m.playType} draft={d} onChange={setD} />
    </Modal>
  );
}

export function CancelMatchDialog({ m, open, onClose }: { m: MatchSnapshot; open: boolean; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <ConfirmDialog open={open} onClose={onClose} title="Cancel this match?" confirmLabel="Cancel match" danger loading={busy}
      onConfirm={async () => { setBusy(true); try { await sendCommand(m, 'CANCEL'); onClose(); } catch (e) { toastError(e); } finally { setBusy(false); } }}>
      The match has not started. It stays in the history as cancelled and is not counted in statistics.
    </ConfirmDialog>
  );
}

export { other, useMemo };
