import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import type { MatchSnapshot } from '@pickle/shared';
import { Badge, Button, Card, CardHeader, ErrorBox, Field, Input, Modal, Notice, PageHeader, Spinner, cx } from '../ui';
import { get, post } from '../lib/api';
import { useIsAdmin } from '../lib/auth';
import { fmtDateTime, fmtDay, fmtDuration, fmtTime } from '../lib/time';
import { newCommandId } from '../lib/ids';
import { toast, toastError } from '../lib/toast';
import { endReasonLabel } from '../console/parts';
import { StatusBadge, gamesLine, teamLine, type MatchItem } from './History';
import { EditNamesDialogFinished } from './MatchNames';

interface Detail { item: MatchItem; snapshot: MatchSnapshot; games: { n: number; target: number; a: number; b: number; status: string; winner: string | null; s: number; e: number | null }[]; createdOnCourt: string | null; booking: { id: number; booking_code: string; booked_by_name: string; start_at: number; end_at: number; status: string } | null; pausedTotalMs: number; correctedAt: number | null }
interface Ev { seq: number; type: string; at: number; label: string; scoreA: number | null; scoreB: number | null; gameNumber: number | null; voided: boolean; voidedAt: number | null; actor: string | null; actorCourt: string | null }

export default function MatchDetail() {
  const id = Number(useParams().id);
  const admin = useIsAdmin();
  const q = useQuery({ queryKey: ['matches', 'detail', id], queryFn: () => get<Detail>(`matches/${id}`) });
  const ev = useQuery({ queryKey: ['matches', 'events', id], queryFn: () => get<Ev[]>(`matches/${id}/events`) });
  const [correct, setCorrect] = useState(false); const [names, setNames] = useState(false);
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  const d = q.data!; const m = d.item; const s = d.snapshot;
  const finished = m.status === 'completed' || m.status === 'terminated';
  return (
    <div>
      <PageHeader title={<span className="flex flex-wrap items-center gap-3">{m.code}<StatusBadge m={m} />{m.corrected && <Badge>corrected</Badge>}</span>}
        sub={<Link to="/history" className="inline-flex items-center gap-1 text-primary"><ArrowLeft className="size-4" />Game Histories</Link>}
        actions={<><Button className="no-print" icon={<Printer className="size-4" />} onClick={() => window.print()}>Print</Button>
          {admin && finished && <><Button className="no-print" onClick={() => setNames(true)}>Edit names / link players</Button><Button className="no-print" variant="primary" onClick={() => setCorrect(true)}>Correct result</Button></>}</>} />
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <Card className="p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              {(['A', 'B'] as const).map((t) => (
                <div key={t} className={cx('rounded-xl border-l-8 bg-surface2/60 p-4', t === 'A' ? 'border-teamA' : 'border-teamB')}>
                  <p className={cx('text-lg font-bold', t === 'A' ? 'text-teamA' : 'text-teamB')}>{m.teams[t].name} {m.winner === t && <Badge tone="success" className="ml-1">Winner</Badge>}</p>
                  <ul className="mt-1 space-y-0.5">{s.teams[t].players.map((p) => (
                    <li key={p.slot} className="text-base">{p.playerId ? <Link className="text-primary hover:underline" to={`/players/r:${p.playerId}`}>{p.displayName}</Link> : p.isDefaultLabel ? <span className="text-muted">{p.displayName}</span> : <Link className="hover:underline" to={`/players/t:${encodeURIComponent(p.displayName.toLowerCase())}`}>{p.displayName}</Link>}</li>
                  ))}</ul>
                  <p className="tnum mt-2 text-3xl font-extrabold">{m.gamesWon[t]} <span className="text-base font-medium text-muted">games</span></p>
                </div>
              ))}
            </div>
            <div className="mt-4"><p className="mb-1 text-sm font-semibold text-muted">Game scores</p>
              <div className="flex flex-wrap gap-2">{d.games.length ? d.games.map((g) => (
                <span key={g.n} className={cx('tnum rounded-lg border px-3 py-1.5 text-lg font-bold', g.status === 'abandoned' ? 'border-dashed border-warn' : 'border-line')}>G{g.n} {g.a}–{g.b}{g.status === 'abandoned' && <span className="ml-1 text-xs font-medium text-warn">not finished</span>}</span>
              )) : <span className="text-muted">No points were played</span>}</div></div>
            {m.status === 'terminated' && <Notice tone="warn" className="mt-4"><b>Ended early at {fmtTime(m.endedAt)}</b> — {s.end ? endReasonLabel(s.end.reason) : ''}{s.end?.note ? ` (${s.end.note})` : ''}. The score is preserved and no winner is recorded.</Notice>}
          </Card>
          <Card><CardHeader title="Event timeline" sub="Undone actions are struck through" />
            {ev.isLoading ? <Spinner /> : ev.error ? <ErrorBox error={ev.error} /> : (
              <ol className="divide-y divide-line text-sm">{ev.data!.map((e) => (
                <li key={e.seq} className={cx('flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2', e.voided && 'text-muted')}>
                  <span className="tnum w-14 shrink-0 text-muted">{fmtTime(e.at)}</span>
                  <span className={cx('flex-1', e.voided && 'line-through')}>{e.label}</span>
                  {e.scoreA != null && <span className="tnum text-muted">G{e.gameNumber} {e.scoreA}–{e.scoreB}</span>}
                  <span className="text-xs text-muted">{e.actor}{e.actorCourt ? ` · ${e.actorCourt}` : ''}{e.voided && e.voidedAt ? ` · undone ${fmtTime(e.voidedAt)}` : ''}</span>
                </li>
              ))}</ol>
            )}
          </Card>
        </div>
        <aside className="space-y-4">
          <Card><CardHeader title="Details" />
            <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-2 p-4 text-sm">
              <dt className="text-muted">Court</dt><dd>{m.courtName}{!m.courtActive && ' (inactive)'}</dd>
              <dt className="text-muted">Date</dt><dd>{fmtDay(m.playDate)}</dd>
              <dt className="text-muted">Type</dt><dd className="capitalize">{m.playType}</dd>
              <dt className="text-muted">Rules</dt><dd>{m.rulesName}</dd>
              <dt className="text-muted">Started</dt><dd>{fmtTime(m.startedAt)}</dd>
              <dt className="text-muted">Ended</dt><dd>{fmtTime(m.endedAt)}</dd>
              <dt className="text-muted">Playing time</dt><dd>{fmtDuration(m.durationMs)}</dd>
              <dt className="text-muted">Paused</dt><dd>{fmtDuration(d.pausedTotalMs)}</dd>
              <dt className="text-muted">Created by</dt><dd>{m.createdBy ?? '—'}{d.createdOnCourt ? ` on ${d.createdOnCourt}` : ''}</dd>
              {s.end && <><dt className="text-muted">Ended by</dt><dd>{s.end.byUser ?? 'System'}{s.end.onCourt ? ` on ${s.end.onCourt}` : ''}</dd></>}
              <dt className="text-muted">Booking</dt><dd>{d.booking ? <>{d.booking.booking_code} · {d.booking.booked_by_name} {fmtTime(d.booking.start_at)}</> : <span className="text-muted">None</span>}</dd>
              {d.correctedAt && <><dt className="text-muted">Corrected</dt><dd>{fmtDateTime(d.correctedAt)}</dd></>}
            </dl>
            <p className="border-t border-line px-4 py-2 text-xs text-muted">{teamLine(m, 'A')} v {teamLine(m, 'B')} · {gamesLine(m)}</p>
          </Card>
        </aside>
      </div>
      {correct && <CorrectDialog d={d} onClose={() => setCorrect(false)} />}
      {names && <EditNamesDialogFinished d={d.snapshot} onClose={() => setNames(false)} />}
    </div>
  );
}

function CorrectDialog({ d, onClose }: { d: Detail; onClose: () => void }) {
  const qc = useQueryClient();
  const [scores, setScores] = useState(d.games.map((g) => ({ number: g.n, a: String(g.a), b: String(g.b), winner: (g.winner as 'A' | 'B' | null) ?? '' })));
  const [reason, setReason] = useState(''); const [force, setForce] = useState(false); const [err, setErr] = useState<string | null>(null);
  const mut = useMutation({
    mutationFn: () => post(`matches/${d.item.id}/correction`, { commandId: newCommandId(), expectedVersion: d.snapshot.version, reason, force: force || undefined,
      games: scores.map((s) => ({ number: s.number, scoreA: Number(s.a), scoreB: Number(s.b), winner: s.winner || undefined })) }),
    onSuccess: () => { toast('Result corrected', 'success'); void qc.invalidateQueries({ queryKey: ['matches'] }); void qc.invalidateQueries({ queryKey: ['players'] }); onClose(); },
    onError: (e) => { setErr(e instanceof Error ? e.message : 'Could not correct'); toastError(e); },
  });
  return (
    <Modal open onClose={onClose} wide title="Correct the final result" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={reason.trim().length < 3} loading={mut.isPending} onClick={() => mut.mutate()}>Save correction</Button></>}>
      <div className="space-y-4">
        <Notice>The original events are kept. A correction entry with your reason is added to the timeline and the audit log.</Notice>
        <table className="w-full text-sm"><thead><tr className="text-left text-muted"><th className="py-1">Game</th><th>{d.item.teams.A.name}</th><th>{d.item.teams.B.name}</th>{force && <th>Winner</th>}</tr></thead>
          <tbody>{scores.map((s, i) => (
            <tr key={s.number}><td className="py-1 font-medium">Game {s.number}</td>
              <td><Input type="number" min={0} className="w-24" value={s.a} onChange={(e) => setScores(scores.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)))} /></td>
              <td><Input type="number" min={0} className="w-24" value={s.b} onChange={(e) => setScores(scores.map((x, j) => (j === i ? { ...x, b: e.target.value } : x)))} /></td>
              {force && <td><select className="h-10 rounded-md border border-line bg-surface px-2" value={s.winner} onChange={(e) => setScores(scores.map((x, j) => (j === i ? { ...x, winner: e.target.value as 'A' | 'B' } : x)))}><option value="">—</option><option value="A">A</option><option value="B">B</option></select></td>}
            </tr>))}</tbody></table>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />These scores do not follow the normal rules (choose the winner of each game myself)</label>
        <Field label="Reason (required)"><Input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Scorer missed the final rallies" /></Field>
        {err && <Notice tone="danger">{err}</Notice>}
      </div>
    </Modal>
  );
}
