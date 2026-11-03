import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, CalendarClock, Minus, Plus } from 'lucide-react';
import { MAX_ACTIVE_COURTS, type BookingDto, type CourtSnapshot } from '@pickle/shared';
import { Badge, Button, Card, CardHeader, Check, ConfirmDialog, DeviceDot, ErrorBox, Field, Input, Modal, PageHeader, Spinner, StatusPill, Timer, ViewOnlyTag, cx } from '../ui';
import { ApiError, del, get, patch, post, put } from '../lib/api';
import { courtsStore, realtime, applySnapshot } from '../lib/realtime';
import { useStore } from '../lib/store';
import { useIsAdmin } from '../lib/auth';
import { fmtTime } from '../lib/time';
import { toast, toastError } from '../lib/toast';

export function CourtCard({ s }: { s: CourtSnapshot }) {
  const m = s.match; const c = s.court;
  const live = m && (m.status === 'in_progress' || m.status === 'paused' || m.status === 'setup');
  const b = c.booking;
  return (
    <Link to={`/courts/${c.id}`} className={cx('group block rounded-2xl border bg-surface p-4 shadow-card transition hover:border-primary hover:shadow-pop', m?.status === 'in_progress' ? 'border-accent ring-2 ring-accent' : 'border-line', !c.isActive && 'opacity-60')}>
      <div className="mb-2 flex items-center justify-between gap-2"><h3 className="font-display truncate text-xl">{c.name}</h3><StatusPill status={c.status} size="sm" /></div>
      {m && (live || c.status === 'completed') ? (
        <div className="space-y-1">
          {(['A', 'B'] as const).map((t) => (
            <div key={t} className="flex items-center gap-2">
              <span className={cx('h-7 w-1.5 rounded-full', t === 'A' ? 'bg-teamA' : 'bg-teamB')} />
              <span className="min-w-0 flex-1 truncate text-sm">{m.teams[t].players.map((p) => p.displayName).join(' / ')}</span>
              {m.rules.servingMode === 'auto' && m.current.servingTeam === t && m.status === 'in_progress' && <span title="Serving" className="text-xs">◄</span>}
              <span className="num tnum text-3xl font-bold">{m.status === 'setup' ? '–' : (m.games.at(-1) ? (t === 'A' ? m.games.at(-1)!.scoreA : m.games.at(-1)!.scoreB) : 0)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between pt-1 text-xs text-muted"><span>{m.status === 'setup' ? 'Ready to start' : `G${m.current.gameNumber ?? 1} · ${m.gamesWon.A}–${m.gamesWon.B}`}</span>{m.timer.startedAt && <Timer match={m} />}</div>
        </div>
      ) : <p className="py-4 text-center text-sm text-muted">{c.status === 'maintenance' ? (c.maintenanceNote ?? 'Maintenance') : c.status === 'inactive' ? 'Not in service' : 'Ready for play'}</p>}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-1 border-t border-line pt-2">
        <DeviceDot device={c.device} />
        {b.now ? <Badge tone="warn"><CalendarClock className="size-3" />Reserved · {b.now.bookedByName} {fmtTime(b.now.startAt)}–{fmtTime(b.now.endAt)}</Badge>
          : b.next ? <Badge><CalendarClock className="size-3" />Next {fmtTime(b.next.startAt)}</Badge> : null}
      </div>
    </Link>
  );
}

export default function Courts() {
  const admin = useIsAdmin();
  const qc = useQueryClient();
  useEffect(() => realtime.want('all'), []);
  const [showInactive, setShowInactive] = useState(false);
  const q = useQuery({ queryKey: ['courts', 'list', showInactive], queryFn: async () => { const r = await get<CourtSnapshot[]>(`courts?includeInactive=${showInactive}`); r.forEach(applySnapshot); return r; } });
  const live = useStore(courtsStore);
  const list = (q.data ?? []).map((c) => live[c.court.id] ?? c);
  const active = list.filter((c) => c.court.isActive);
  const [addOpen, setAddOpen] = useState(false); const [countOpen, setCountOpen] = useState(false);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['courts'] }); };
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  return (
    <div>
      <PageHeader title="Court Management" sub={`${active.length} active court${active.length === 1 ? '' : 's'}${admin ? ` of ${MAX_ACTIVE_COURTS} maximum` : ''}. Select a court to score, set up a match or change its status.`}
        actions={admin ? <><Button onClick={() => setCountOpen(true)}>Number of courts</Button><Button variant="primary" onClick={() => setAddOpen(true)} icon={<Plus className="size-4" />}>Add court</Button></> : <ViewOnlyTag />} />
      {list.length === 0 ? <Card className="p-8 text-center text-muted">No courts yet.{admin ? ' Use “Number of courts” to create them.' : ''}</Card> : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">{list.map((s) => <CourtCard key={s.court.id} s={s} />)}</div>
      )}
      <div className="mt-4"><Check checked={showInactive} onChange={setShowInactive} label="Show inactive courts" /></div>
      {admin && <ManageCourts list={list} onChange={refresh} />}
      <AddCourt open={addOpen} onClose={() => setAddOpen(false)} onDone={refresh} />
      <CountDialog open={countOpen} onClose={() => setCountOpen(false)} courts={list} onDone={refresh} />
    </div>
  );
}

function ManageCourts({ list, onChange }: { list: CourtSnapshot[]; onChange: () => void }) {
  const [edit, setEdit] = useState<CourtSnapshot | null>(null);
  const move = async (i: number, d: -1 | 1) => {
    const ids = list.map((c) => c.court.id); const j = i + d; if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    try { await put('courts/order', { courtIds: ids }); onChange(); } catch (e) { toastError(e); }
  };
  return (
    <Card className="mt-6">
      <CardHeader title="Manage courts" sub="Order, rename, activate or deactivate. History is always kept." />
      <ul className="divide-y divide-line">
        {list.map((s, i) => (
          <li key={s.court.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
            <div className="flex gap-1"><button aria-label="Move up" disabled={i === 0} onClick={() => void move(i, -1)} className="rounded p-1 hover:bg-surface2 disabled:opacity-30"><ArrowUp className="size-4" /></button><button aria-label="Move down" disabled={i === list.length - 1} onClick={() => void move(i, 1)} className="rounded p-1 hover:bg-surface2 disabled:opacity-30"><ArrowDown className="size-4" /></button></div>
            <span className="w-32 font-medium">{s.court.name}</span><span className="text-muted">code {s.court.shortCode}</span>
            <StatusPill status={s.court.status} size="sm" /><span className="flex-1" />
            <Button size="sm" onClick={() => setEdit(s)}>Edit</Button>
          </li>
        ))}
      </ul>
      {edit && <EditCourt s={edit} onClose={() => setEdit(null)} onDone={onChange} />}
    </Card>
  );
}

function AddCourt({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(''); const [code, setCode] = useState(''); const [desc, setDesc] = useState('');
  const m = useMutation({ mutationFn: () => post('courts', { name, shortCode: code, description: desc || null }), onSuccess: () => { toast('Court added', 'success'); setName(''); setCode(''); setDesc(''); onClose(); onDone(); }, onError: toastError });
  return (
    <Modal open={open} onClose={onClose} title="Add a court" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} disabled={!name.trim() || !code.trim()} onClick={() => m.mutate()}>Add court</Button></>}>
      <div className="space-y-4"><Field label="Name"><Input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Court 7" /></Field>
        <Field label="Short code" hint="Up to 4 characters; used in match codes. Cannot be changed after the court's first match."><Input value={code} maxLength={4} onChange={(e) => setCode(e.target.value)} placeholder="7" /></Field>
        <Field label="Location note (optional)"><Input value={desc} maxLength={200} onChange={(e) => setDesc(e.target.value)} /></Field></div>
    </Modal>
  );
}

function EditCourt({ s, onClose, onDone }: { s: CourtSnapshot; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(s.court.name); const [code, setCode] = useState(s.court.shortCode);
  const [future, setFuture] = useState<BookingDto[] | null>(null);
  const save = useMutation({ mutationFn: () => patch(`courts/${s.court.id}`, { name, shortCode: code }), onSuccess: () => { toast('Saved', 'success'); onClose(); onDone(); }, onError: toastError });
  const toggle = async (bookingAction?: 'keep' | 'cancel') => {
    try { await patch(`courts/${s.court.id}`, { isActive: !s.court.isActive, bookingAction }); toast(s.court.isActive ? 'Court deactivated — history kept' : 'Court activated', 'success'); onClose(); onDone(); }
    catch (e) { if (e instanceof ApiError && e.code === 'FUTURE_BOOKINGS_EXIST') setFuture(e.details.bookings); else toastError(e); }
  };
  return (
    <>
      <Modal open={!future} onClose={onClose} title={`Edit ${s.court.name}`} footer={<><Button variant={s.court.isActive ? 'danger' : 'secondary'} onClick={() => void toggle()}>{s.court.isActive ? 'Deactivate' : 'Activate'}</Button><span className="flex-1" /><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
        <div className="space-y-4"><Field label="Name"><Input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></Field><Field label="Short code"><Input value={code} maxLength={4} onChange={(e) => setCode(e.target.value)} /></Field></div>
      </Modal>
      <Modal open={!!future} onClose={() => setFuture(null)} title="This court has upcoming bookings"
        footer={<><Button onClick={() => setFuture(null)}>Back</Button><Button onClick={() => void toggle('keep')}>Keep the bookings</Button><Button variant="danger" onClick={() => void toggle('cancel')}>Cancel the bookings</Button></>}>
        <p className="mb-3 text-sm">Bookings are never cancelled automatically. Choose what to do with these {future?.length}:</p>
        <ul className="max-h-60 space-y-1 overflow-auto text-sm">{future?.map((b) => <li key={b.id} className="rounded bg-surface2 px-3 py-1.5">{b.playDate} · {fmtTime(b.startAt)}–{fmtTime(b.endAt)} · {b.bookedByName}</li>)}</ul>
      </Modal>
    </>
  );
}

function CountDialog({ open, onClose, courts, onDone }: { open: boolean; onClose: () => void; courts: CourtSnapshot[]; onDone: () => void }) {
  const active = courts.filter((c) => c.court.isActive);
  const [target, setTarget] = useState(active.length);
  const [drop, setDrop] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setTarget(active.length); setDrop([]); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const delta = target - active.length;
  useEffect(() => {
    if (delta < 0) {
      const idle = [...active].reverse().filter((c) => !c.match || !['setup', 'in_progress', 'paused'].includes(c.match.status));
      setDrop(idle.slice(0, -delta).map((c) => c.court.id));
    } else setDrop([]);
  }, [delta]); // eslint-disable-line react-hooks/exhaustive-deps
  const apply = async () => {
    setBusy(true);
    try {
      if (delta > 0) await post('courts/bulk', { count: delta });
      else for (const id of drop) await patch(`courts/${id}`, { isActive: false, bookingAction: 'keep' });
      toast('Court count updated', 'success'); onClose(); onDone();
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Number of courts" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={delta === 0 || (delta < 0 && drop.length !== -delta)} loading={busy} onClick={() => void apply()}>Apply</Button></>}>
      <p className="mb-4 text-sm text-muted">Active courts: <b className="text-ink">{active.length}</b> of {MAX_ACTIVE_COURTS} maximum.</p>
      <div className="flex items-center justify-center gap-4">
        <Button size="lg" aria-label="Fewer courts" disabled={target <= 0} onClick={() => setTarget((t) => t - 1)}><Minus className="size-5" /></Button>
        <span className="tnum w-16 text-center text-5xl font-extrabold">{target}</span>
        <Button size="lg" aria-label="More courts" disabled={target >= MAX_ACTIVE_COURTS} onClick={() => setTarget((t) => t + 1)}><Plus className="size-5" /></Button>
      </div>
      {target >= MAX_ACTIVE_COURTS && <p className="mt-2 text-center text-xs text-muted">Maximum {MAX_ACTIVE_COURTS} active courts</p>}
      {delta > 0 && <p className="mt-4 rounded-lg bg-surface2 p-3 text-sm">{delta} new court{delta > 1 ? 's' : ''} will be created and activated, numbered after your highest existing court.</p>}
      {delta < 0 && (
        <div className="mt-4"><p className="mb-2 text-sm font-medium">Choose {-delta} court{-delta > 1 ? 's' : ''} to deactivate (history is kept):</p>
          <div className="grid grid-cols-2 gap-2">{active.map((c) => {
            const busyCourt = !!c.match && ['setup', 'in_progress', 'paused'].includes(c.match.status);
            return <label key={c.court.id} className={cx('flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm', busyCourt && 'opacity-50')}><input type="checkbox" disabled={busyCourt} checked={drop.includes(c.court.id)} onChange={(e) => setDrop((d) => e.target.checked ? [...d, c.court.id] : d.filter((x) => x !== c.court.id))} />{c.court.name}{busyCourt && <span className="text-xs text-muted"> (in use)</span>}</label>;
          })}</div></div>
      )}
    </Modal>
  );
}
export { ConfirmDialog };
