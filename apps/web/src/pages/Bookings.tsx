import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CalendarDays, ChevronLeft, ChevronRight, Download, Plus, Printer } from 'lucide-react';
import type { BookingDto, CourtSnapshot, MeDto } from '@pickle/shared';
import { Badge, Button, Card, Check, Empty, ErrorBox, Field, Input, Modal, Notice, PageHeader, Pagination, Segmented, Select, Spinner, Table, Td, Textarea, Th, ViewOnlyTag, cx } from '../ui';
import { ApiError, downloadUrl, get, patch, post, qs } from '../lib/api';
import { useIsAdmin, useMe } from '../lib/auth';
import { addDays, fmtDay, fmtTime, hhmm, isoWeekday, minutesOfDay, today, toMinutes, zonedToEpoch } from '../lib/time';
import { serverNow } from '../lib/clock';
import { toast, toastError } from '../lib/toast';

type View = 'day' | 'week' | 'agenda';
interface Schedule { days: { date: string; openAt: number | null; closeAt: number | null }[]; bookings: BookingDto[] }
const ROW = 44; // px per slot

function hoursFor(me: MeDto, date: string): { open: number; close: number } | null {
  const h = me.publicSettings.operatingHours[String(isoWeekday(date)) as '1'];
  return h ? { open: toMinutes(h.open), close: toMinutes(h.close) } : null;
}

export default function Bookings() {
  const admin = useIsAdmin();
  const me = useMe().data as MeDto;
  const [view, setView] = useState<View>(() => (window.innerWidth < 768 ? 'day' : 'day'));
  const [date, setDate] = useState(today());
  const [courtId, setCourtId] = useState<number | ''>('');
  const [showCancelled, setShowCancelled] = useState(false);
  const [q, setQ] = useState('');
  const [dialog, setDialog] = useState<{ booking?: BookingDto; courtId?: number; date?: string; startMin?: number } | null>(null);
  const [detail, setDetail] = useState<number | null>(null);
  const courts = useQuery({ queryKey: ['courts', 'bookings'], queryFn: () => get<CourtSnapshot[]>('courts'), staleTime: 30_000 });
  const list = courts.data ?? [];
  const phone = typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;
  const selCourt = courtId || list[0]?.court.id || '';
  const weekStart = addDays(date, -(isoWeekday(date) - 1));
  const range = view === 'week' ? { from: weekStart, to: addDays(weekStart, 6) } : { from: date, to: date };
  const sched = useQuery({
    queryKey: ['bookings', 'schedule', range, view === 'week' ? selCourt : 'all'], enabled: view !== 'agenda' && (view !== 'week' || !!selCourt),
    queryFn: () => get<Schedule>(`bookings/schedule${qs({ ...range, courtIds: view === 'week' ? String(selCourt) : undefined })}`),
  });
  const step = view === 'week' ? 7 : 1;
  const bookings = (sched.data?.bookings ?? []).filter((b) => showCancelled || b.status === 'confirmed' || b.status === 'no_show').filter((b) => !q || `${b.bookedByName} ${b.phone ?? ''}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <PageHeader title="Booking Schedule" sub="Court reservations. A booking never stops a match from being played."
        actions={<>{!admin && <ViewOnlyTag />}<Button className="no-print" icon={<Printer className="size-4" />} onClick={() => window.print()}>Print</Button>
          {admin && <Button className="no-print" icon={<Download className="size-4" />} onClick={() => downloadUrl(`bookings/export.csv${qs(range)}`)}>CSV</Button>}
          {admin && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setDialog({ date })}>New booking</Button>}</>} />
      <Card className="no-print mb-4 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex items-center gap-1">
            <Button aria-label="Previous" onClick={() => setDate(addDays(date, -step))}><ChevronLeft className="size-4" /></Button>
            <Button onClick={() => setDate(today())}>Today</Button>
            <Button aria-label="Next" onClick={() => setDate(addDays(date, step))}><ChevronRight className="size-4" /></Button>
          </div>
          <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="w-44" aria-label="Date" />
          <Segmented value={view} onChange={setView} options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'agenda', label: 'Agenda' }]} />
          {(view === 'week' || (view === 'day' && phone)) && <Select value={selCourt} onChange={(e) => setCourtId(Number(e.target.value))} className="w-44" aria-label="Court">{list.map((c) => <option key={c.court.id} value={c.court.id}>{c.court.name}</option>)}</Select>}
          <Input placeholder="Search name or phone" value={q} onChange={(e) => setQ(e.target.value)} className="w-52" aria-label="Search bookings" />
          <Check checked={showCancelled} onChange={setShowCancelled} label="Show cancelled" />
        </div>
      </Card>
      <Legend />
      {view === 'agenda' ? <Agenda q={q} courts={list} onOpen={setDetail} date={date} />
        : sched.isLoading || courts.isLoading ? <Spinner /> : sched.error ? <ErrorBox error={sched.error} retry={() => sched.refetch()} />
        : view === 'day' ? <DayWeekGrid me={me} admin={admin} mode="day" date={date} courts={phone ? list.filter((c) => c.court.id === selCourt) : list} bookings={bookings} onOpen={setDetail} onCreate={(c, d, m) => setDialog({ courtId: c, date: d, startMin: m })} onMoved={() => void sched.refetch()} />
        : <DayWeekGrid me={me} admin={admin} mode="week" date={weekStart} courts={list.filter((c) => c.court.id === selCourt)} bookings={bookings} onOpen={setDetail} onCreate={(c, d, m) => setDialog({ courtId: c, date: d, startMin: m })} onMoved={() => void sched.refetch()} />}
      {dialog && <BookingDialog me={me} courts={list} init={dialog} onClose={() => setDialog(null)} />}
      {detail != null && <DetailDrawer id={detail} admin={admin} onClose={() => setDetail(null)} onEdit={(b) => { setDetail(null); setDialog({ booking: b }); }} />}
    </div>
  );
}

function Legend() {
  const Key = ({ cls, label }: { cls: string; label: string }) => <span className="inline-flex items-center gap-1"><i className={cx('inline-block size-3 rounded', cls)} />{label}</span>;
  return (
    <p className="no-print mb-3 flex flex-wrap items-center gap-3 text-xs text-muted">
      <Key cls="border-2 border-primary bg-primary/15" label="Confirmed" /><Key cls="border-2 border-st-live bg-st-live/25" label="Happening now" />
      <Key cls="border-2 border-dashed border-danger" label="No-show" /><Key cls="border border-line bg-surface2" label="Cancelled" />
    </p>
  );
}

interface Col { key: string; label: string; sub?: string; courtId: number; date: string; courtActive: boolean }

function DayWeekGrid({ me, admin, mode, date, courts, bookings, onOpen, onCreate, onMoved }: {
  me: MeDto; admin: boolean; mode: 'day' | 'week'; date: string; courts: CourtSnapshot[]; bookings: BookingDto[];
  onOpen: (id: number) => void; onCreate: (courtId: number, date: string, startMin: number) => void; onMoved: () => void;
}) {
  const slot = me.publicSettings.bookingSlotMinutes;
  const cols: Col[] = mode === 'day'
    ? courts.map((c) => ({ key: String(c.court.id), label: c.court.name, courtId: c.court.id, date, courtActive: c.court.isActive }))
    : Array.from({ length: 7 }, (_, i) => { const d = addDays(date, i); return { key: d, label: fmtDay(d), courtId: courts[0]?.court.id ?? 0, date: d, courtActive: true }; });
  const dates = [...new Set(cols.map((c) => c.date))];
  let open = 24 * 60, close = 0;
  for (const d of dates) { const h = hoursFor(me, d); if (h) { open = Math.min(open, h.open); close = Math.max(close, h.close); } }
  for (const b of bookings) { open = Math.min(open, Math.floor(minutesOfDay(b.startAt) / slot) * slot); close = Math.max(close, Math.ceil((minutesOfDay(b.endAt - 1) + 1) / slot) * slot); }
  if (close <= open) { open = 7 * 60; close = 22 * 60; }
  const rows = Math.ceil((close - open) / slot);
  const height = rows * ROW;
  const wrap = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<null | { id: number; mode: 'move' | 'resize'; dy: number; colIdx: number }>(null);
  const [now, setNow] = useState(serverNow());
  useEffect(() => { const t = setInterval(() => setNow(serverNow()), 30_000); return () => clearInterval(t); }, []);
  const qc = useQueryClient();
  const move = useMutation({ mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) => patch(`bookings/${id}`, body), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['bookings'] }); onMoved(); }, onError: (e) => { toastError(e); onMoved(); } });
  const colFor = (b: BookingDto): number => cols.findIndex((c) => (mode === 'day' ? c.courtId === b.courtId : c.date === b.playDate));
  const posOf = (b: BookingDto) => ({ top: ((minutesOfDay(b.startAt) - open) / slot) * ROW, h: Math.max(ROW * 0.6, ((b.endAt - b.startAt) / 60000 / slot) * ROW) });

  const onDown = (e: React.PointerEvent, b: BookingDto, m: 'move' | 'resize') => {
    if (!admin || b.status !== 'confirmed') return;
    e.stopPropagation();
    const startY = e.clientY, startX = e.clientX; const startCol = colFor(b);
    let moved = false;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const hMove = (ev: PointerEvent) => {
      const dy = ev.clientY - startY;
      if (Math.abs(dy) > 4 || Math.abs(ev.clientX - startX) > 6) moved = true;
      let ci = startCol;
      if (m === 'move' && wrap.current) { const rects = [...wrap.current.querySelectorAll<HTMLElement>('[data-col]')].map((el) => el.getBoundingClientRect()); const hit = rects.findIndex((r) => ev.clientX >= r.left && ev.clientX < r.right); if (hit >= 0) ci = hit; }
      setDrag({ id: b.id, mode: m, dy, colIdx: ci });
    };
    const hUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', hMove); window.removeEventListener('pointerup', hUp);
      setDrag(null);
      if (!moved) { onOpen(b.id); return; }
      const deltaSlots = Math.round((ev.clientY - startY) / ROW);
      let ci = startCol;
      if (m === 'move' && wrap.current) { const rects = [...wrap.current.querySelectorAll<HTMLElement>('[data-col]')].map((el) => el.getBoundingClientRect()); const hit = rects.findIndex((r) => ev.clientX >= r.left && ev.clientX < r.right); if (hit >= 0) ci = hit; }
      if (m === 'move') {
        const c = cols[ci]; if (!c) return;
        const startMin = minutesOfDay(b.startAt) + deltaSlots * slot;
        const dur = (b.endAt - b.startAt) / 60000;
        if (deltaSlots === 0 && ci === startCol) return;
        move.mutate({ id: b.id, body: { courtId: c.courtId, startAt: zonedToEpoch(c.date, startMin), endAt: zonedToEpoch(c.date, startMin + dur) } });
      } else {
        if (deltaSlots === 0) return;
        const endMin = minutesOfDay(b.endAt - 1) + 1 + deltaSlots * slot;
        move.mutate({ id: b.id, body: { endAt: zonedToEpoch(b.playDate, endMin) } });
      }
    };
    window.addEventListener('pointermove', hMove); window.addEventListener('pointerup', hUp);
  };

  const today0 = today();
  return (
    <Card className="overflow-hidden">
      <div ref={wrap} className="max-h-[75vh] overflow-auto" role="grid" aria-label={mode === 'day' ? 'Day schedule' : 'Week schedule'}>
        <div className="grid min-w-max" style={{ gridTemplateColumns: `64px repeat(${cols.length}, minmax(${mode === 'day' ? 150 : 130}px, 1fr))` }}>
          <div className="sticky left-0 top-0 z-30 border-b border-r border-line bg-surface2" />
          {cols.map((c) => <div key={c.key} role="columnheader" className={cx('sticky top-0 z-20 border-b border-r border-line bg-surface2 px-2 py-2 text-center text-sm font-semibold', mode === 'week' && c.date === today0 && 'text-primary')}>{c.label}{!c.courtActive && <Badge className="ml-1">inactive</Badge>}</div>)}
          <div className="sticky left-0 z-10 border-r border-line bg-surface" style={{ height }}>
            {Array.from({ length: rows }, (_, i) => <div key={i} className="relative border-t border-line/60 pr-2 text-right text-[11px] text-muted" style={{ height: ROW }}><span className={cx('absolute right-2 bg-surface px-0.5', i === 0 ? 'top-0.5' : '-top-2')}>{(open + i * slot) % 60 === 0 || slot < 60 && i % 2 === 0 ? hhmm(open + i * slot) : ''}</span></div>)}
          </div>
          {cols.map((c, ci) => {
            const mine = bookings.filter((b) => (mode === 'day' ? b.courtId === c.courtId : b.playDate === c.date));
            const h = hoursFor(me, c.date);
            return (
              <div key={c.key} data-col={ci} role="gridcell" className="relative border-r border-line" style={{ height }}
                onClick={(e) => {
                  if (!admin || !c.courtActive) return;
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  const idx = Math.floor((e.clientY - r.top) / ROW);
                  onCreate(c.courtId, c.date, open + idx * slot);
                }}>
                {Array.from({ length: rows }, (_, i) => <div key={i} className={cx('absolute inset-x-0 border-t', i % (60 / slot) === 0 ? 'border-line' : 'border-line/40', admin && c.courtActive && 'hover:bg-primary/5')} style={{ top: i * ROW, height: ROW }} />)}
                {h && <>
                  <div className="pointer-events-none absolute inset-x-0 top-0 bg-surface2/70" style={{ height: ((h.open - open) / slot) * ROW }} />
                  <div className="pointer-events-none absolute inset-x-0 bg-surface2/70" style={{ top: ((h.close - open) / slot) * ROW, bottom: 0 }} />
                </>}
                {!h && <div className="pointer-events-none absolute inset-0 grid place-items-center bg-surface2/80 text-sm text-muted">Closed</div>}
                {c.date === today0 && minutesOfDay(now) >= open && minutesOfDay(now) <= close && <div className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-danger" style={{ top: ((minutesOfDay(now) - open) / slot) * ROW }}><span className="absolute -left-0.5 -top-1.5 size-2.5 rounded-full bg-danger" /></div>}
                {mine.map((b) => {
                  const p = posOf(b);
                  const isDrag = drag?.id === b.id;
                  const dy = isDrag ? (drag.mode === 'move' ? Math.round(drag.dy / ROW) * ROW : 0) : 0;
                  const dh = isDrag && drag.mode === 'resize' ? Math.round(drag.dy / ROW) * ROW : 0;
                  const style = b.status === 'cancelled' ? 'border-line bg-surface2 text-muted line-through' : b.status === 'no_show' ? 'border-dashed border-danger bg-danger/10' : b.timeState === 'now' ? 'border-st-live bg-st-live/25' : 'border-primary bg-primary/15';
                  const tx = isDrag && drag.mode === 'move' && mode === 'day' ? (drag.colIdx - ci) * 100 : 0;
                  return (
                    <div key={b.id} role="button" tabIndex={0} aria-label={`${b.bookedByName} ${fmtTime(b.startAt)} to ${fmtTime(b.endAt)}, ${b.courtName}, ${b.status}`}
                      onClick={(e) => { e.stopPropagation(); if (!admin) onOpen(b.id); }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(b.id); } }}
                      onPointerDown={(e) => onDown(e, b, 'move')}
                      className={cx('absolute inset-x-1 z-10 overflow-hidden rounded-md border-2 px-2 py-1 text-xs shadow-sm', style, admin && b.status === 'confirmed' ? 'cursor-grab touch-none active:cursor-grabbing' : 'cursor-pointer', isDrag && 'z-30 opacity-80 shadow-lg')}
                      style={{ top: p.top + dy + 1, height: p.h + dh - 2, transform: tx ? `translateX(${tx}%)` : undefined }}>
                      <p className="truncate font-semibold">{b.bookedByName}{b.playersCount ? ` (${b.playersCount})` : ''}</p>
                      <p className="tnum truncate opacity-80">{fmtTime(b.startAt)}–{fmtTime(b.endAt)}</p>
                      {b.status === 'no_show' && <p className="font-semibold text-danger">No-show</p>}
                      {admin && b.status === 'confirmed' && <span onPointerDown={(e) => onDown(e, b, 'resize')} className="absolute inset-x-0 bottom-0 h-2.5 cursor-ns-resize touch-none bg-primary/30" aria-label="Resize" />}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      {bookings.length === 0 && <p className="border-t border-line p-4 text-center text-sm text-muted">No bookings {mode === 'day' ? 'on this day' : 'this week'}.{admin ? ' Click an empty slot to create one.' : ''}</p>}
    </Card>
  );
}

function Agenda({ q, courts, onOpen, date }: { q: string; courts: CourtSnapshot[]; onOpen: (id: number) => void; date: string }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState(''); const [court, setCourt] = useState(''); const [from, setFrom] = useState(date); const [to, setTo] = useState(addDays(date, 14));
  useEffect(() => setPage(1), [q, status, court, from, to]);
  const r = useQuery({ queryKey: ['bookings', 'agenda', { q, status, court, from, to, page }], queryFn: () => get<{ items: BookingDto[]; total: number; pageSize: number }>(`bookings${qs({ q, status, courtId: court, from, to, page, pageSize: 25 })}`) });
  const grouped = useMemo(() => { const m = new Map<string, BookingDto[]>(); for (const b of r.data?.items ?? []) (m.get(b.playDate) ?? m.set(b.playDate, []).get(b.playDate)!).push(b); return [...m.entries()]; }, [r.data]);
  return (
    <Card>
      <div className="no-print flex flex-wrap items-end gap-3 border-b border-line p-3">
        <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Court"><Select value={court} onChange={(e) => setCourt(e.target.value)}><option value="">All</option>{courts.map((c) => <option key={c.court.id} value={c.court.id}>{c.court.name}</option>)}</Select></Field>
        <Field label="Status"><Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option><option value="confirmed">Confirmed</option><option value="cancelled">Cancelled</option><option value="no_show">No-show</option></Select></Field>
      </div>
      {r.isLoading ? <Spinner /> : r.error ? <ErrorBox error={r.error} retry={() => r.refetch()} /> : !r.data?.items.length ? <Empty icon={<CalendarDays className="size-8" />} title="No bookings found" /> : (
        <>
          {grouped.map(([d, list]) => (
            <div key={d}><h3 className="bg-surface2 px-4 py-1.5 text-sm font-semibold">{fmtDay(d)}</h3>
              <Table><tbody>{list.map((b) => (
                <tr key={b.id} className="cursor-pointer hover:bg-surface2" onClick={() => onOpen(b.id)}>
                  <Td className="tnum w-36 font-medium">{fmtTime(b.startAt)}–{fmtTime(b.endAt)}</Td><Td>{b.courtName}</Td><Td className="font-medium">{b.bookedByName}</Td><Td className="text-muted">{b.phone ?? ''}</Td>
                  <Td><StatusBadge b={b} /></Td></tr>
              ))}</tbody></Table></div>
          ))}
          <Pagination page={page} pageSize={r.data.pageSize} total={r.data.total} onPage={setPage} />
        </>
      )}
    </Card>
  );
}
const StatusBadge = ({ b }: { b: BookingDto }) => b.status === 'cancelled' ? <Badge>Cancelled</Badge> : b.status === 'no_show' ? <Badge tone="danger">No-show</Badge> : b.timeState === 'now' ? <Badge tone="success">Now</Badge> : b.timeState === 'past' ? <Badge>Past</Badge> : <Badge tone="primary">Confirmed</Badge>;

function DetailDrawer({ id, admin, onClose, onEdit }: { id: number; admin: boolean; onClose: () => void; onEdit: (b: BookingDto) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['bookings', id], queryFn: () => get<BookingDto & { matches: { id: number; match_code: string; status: string; team_a_name: string; team_b_name: string; games_won_a: number; games_won_b: number }[] }>(`bookings/${id}`) });
  const [reason, setReason] = useState(''); const [cancelling, setCancelling] = useState(false);
  const act = useMutation({ mutationFn: ({ path, body }: { path: string; body?: unknown }) => post(path, body ?? {}), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['bookings'] }); onClose(); }, onError: toastError });
  const b = q.data;
  return (
    <Modal open onClose={onClose} title={b ? `Booking ${b.code}` : 'Booking'} footer={admin && b?.status === 'confirmed' ? (
      cancelling ? <><Button onClick={() => setCancelling(false)}>Back</Button><Button variant="danger" loading={act.isPending} onClick={() => act.mutate({ path: `bookings/${id}/cancel`, body: { reason: reason || undefined } })}>Cancel booking</Button></>
        : <><Button variant="danger" onClick={() => setCancelling(true)}>Cancel booking</Button><Button onClick={() => act.mutate({ path: `bookings/${id}/no-show` })}>Mark no-show</Button><span className="flex-1" /><Button variant="primary" onClick={() => onEdit(b)}>Edit / move</Button></>) : undefined}>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} /> : b && (
        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-sm">
          <dt className="text-muted">Court</dt><dd className="font-medium">{b.courtName}{!b.courtActive && ' (inactive)'}</dd>
          <dt className="text-muted">When</dt><dd>{fmtDay(b.playDate)}, {fmtTime(b.startAt)}–{fmtTime(b.endAt)}</dd>
          <dt className="text-muted">Booked by</dt><dd className="font-medium">{b.bookedByName}</dd>
          {b.phone && <><dt className="text-muted">Phone</dt><dd>{b.phone}</dd></>}
          {b.playersCount && <><dt className="text-muted">Players</dt><dd>{b.playersCount}</dd></>}
          {b.notes && <><dt className="text-muted">Notes</dt><dd>{b.notes}</dd></>}
          <dt className="text-muted">Status</dt><dd><StatusBadge b={b} />{b.cancelReason && <span className="ml-2 text-muted">{b.cancelReason}</span>}</dd>
          <dt className="text-muted">Entered by</dt><dd>{b.createdBy}</dd>
          <dt className="text-muted">Matches</dt>
          <dd>{b.matches.length ? <ul className="space-y-1">{b.matches.map((m) => <li key={m.id}><Link className="text-primary underline" to={`/history/${m.id}`}>{m.match_code}</Link> · {m.team_a_name} v {m.team_b_name} · {m.games_won_a}–{m.games_won_b}</li>)}</ul> : <span className="text-muted">None linked yet</span>}</dd>
          {cancelling && <><dt className="text-muted">Reason</dt><dd><Input autoFocus value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Optional" /></dd></>}
        </dl>
      )}
      {!admin && <p className="mt-4 text-xs text-muted">Only the Admin can change bookings.</p>}
    </Modal>
  );
}

function BookingDialog({ me, courts, init, onClose }: { me: MeDto; courts: CourtSnapshot[]; init: { booking?: BookingDto; courtId?: number; date?: string; startMin?: number }; onClose: () => void }) {
  const qc = useQueryClient();
  const slot = me.publicSettings.bookingSlotMinutes;
  const b = init.booking;
  const [court, setCourt] = useState<number>(b?.courtId ?? init.courtId ?? courts[0]?.court.id ?? 0);
  const [date, setDate] = useState(b?.playDate ?? init.date ?? today());
  const h = hoursFor(me, date);
  const defStart = b ? minutesOfDay(b.startAt) : init.startMin ?? (h ? h.open : 9 * 60);
  const [start, setStart] = useState(defStart);
  const [end, setEnd] = useState(b ? minutesOfDay(b.endAt - 1) + 1 : Math.min(defStart + 60, h?.close ?? defStart + 60));
  const [name, setName] = useState(b?.bookedByName ?? ''); const [phone, setPhone] = useState(b?.phone ?? ''); const [count, setCount] = useState(b?.playersCount ? String(b.playersCount) : ''); const [notes, setNotes] = useState(b?.notes ?? '');
  const [err, setErr] = useState<string | null>(null);
  const opts: number[] = []; if (h) for (let m = h.open; m <= h.close; m += slot) opts.push(m);
  const save = useMutation({
    mutationFn: () => {
      const body = { courtId: court, startAt: zonedToEpoch(date, start), endAt: zonedToEpoch(date, end), bookedByName: name.trim(), phone: phone.trim() || null, playersCount: count ? Number(count) : null, notes: notes.trim() || null };
      return b ? patch(`bookings/${b.id}`, body) : post('bookings', body);
    },
    onSuccess: () => { toast(b ? 'Booking updated' : 'Booking saved', 'success'); void qc.invalidateQueries({ queryKey: ['bookings'] }); onClose(); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Could not save'),
  });
  return (
    <Modal open onClose={onClose} title={b ? `Edit booking ${b.code}` : 'New booking'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!name.trim() || !h || end <= start} onClick={() => { setErr(null); save.mutate(); }}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Court"><Select value={court} onChange={(e) => setCourt(Number(e.target.value))}>{courts.filter((c) => c.court.isActive).map((c) => <option key={c.court.id} value={c.court.id}>{c.court.name}</option>)}</Select></Field>
        <Field label="Date"><Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></Field>
        {h ? <>
          <Field label="Start"><Select value={start} onChange={(e) => { const v = Number(e.target.value); setStart(v); if (end <= v) setEnd(Math.min(v + 60, h.close)); }}>{opts.slice(0, -1).map((m) => <option key={m} value={m}>{hhmm(m)}</option>)}</Select></Field>
          <Field label="End"><Select value={end} onChange={(e) => setEnd(Number(e.target.value))}>{opts.filter((m) => m > start).map((m) => <option key={m} value={m}>{hhmm(m)}</option>)}</Select></Field>
        </> : <Notice tone="warn" className="sm:col-span-2">The facility is closed on that day.</Notice>}
        <Field label="Booked by" className="sm:col-span-2"><Input autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Name of the person or group" /></Field>
        <Field label="Phone (optional)"><Input value={phone} maxLength={30} inputMode="tel" onChange={(e) => setPhone(e.target.value)} /></Field>
        <Field label="Players (optional)"><Input type="number" min={1} max={8} value={count} onChange={(e) => setCount(e.target.value)} /></Field>
        <Field label="Notes (optional)" className="sm:col-span-2"><Textarea value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      {err && <Notice tone="danger" className="mt-4">{err}</Notice>}
    </Modal>
  );
}
