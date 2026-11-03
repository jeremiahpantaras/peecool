import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarClock, Maximize2, Smartphone, Wrench } from 'lucide-react';
import type { BookingDto, CourtSnapshot, MeDto } from '@pickle/shared';
import { Badge, Button, Card, CardHeader, ConfirmDialog, DeviceDot, ErrorBox, Field, Input, Notice, PageHeader, Spinner, ToastHost, ViewOnlyTag } from '../ui';
import { ApiError, del, get, post } from '../lib/api';
import { applySnapshot, courtsStore, realtime } from '../lib/realtime';
import { useStore } from '../lib/store';
import { useMe } from '../lib/auth';
import { fmtDateTime, fmtTime } from '../lib/time';
import { toast, toastError } from '../lib/toast';
import { useConsoleTheme } from '../lib/theme';
import { CourtConsole, ConsoleMenu } from '../console/Console';
import { useConsoleMode } from '../layout/Shell';

interface Detail extends CourtSnapshot {
  bookingsToday: BookingDto[];
  matchesToday: { id: number; match_code: string; status: string; play_type: string; team_a_name: string; team_b_name: string; games_won_a: number; games_won_b: number; started_at: number | null; winner_team: string | null; end_reason: string | null }[];
}

export default function CourtPage() {
  const courtId = Number(useParams().id);
  const me = useMe().data as MeDto;
  const consoleMode = useConsoleMode(me);
  useEffect(() => realtime.want([courtId]), [courtId]);
  const detail = useQuery({ queryKey: ['courts', courtId], queryFn: async () => { const d = await get<Detail>(`courts/${courtId}`); applySnapshot(d); return d; }, retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2 });
  const live = useStore(courtsStore)[courtId];
  const snap = live ?? detail.data;
  if (detail.error && !snap) return <Card className="m-6"><ErrorBox error={detail.error} retry={() => detail.refetch()} /></Card>;
  if (!snap) return <div className="grid h-full place-items-center"><Spinner /></div>;
  return consoleMode ? <ConsoleScreen snap={snap} me={me} /> : <WorkspaceCourt snap={snap} detail={detail.data} me={me} />;
}

function ConsoleScreen({ snap, me }: { snap: CourtSnapshot; me: MeDto }) {
  useConsoleTheme(me.publicSettings.courtTheme);
  const [menu, setMenu] = useState(false);
  const otherCourt = me.terminal && me.terminal.courtId !== snap.court.id;
  return (
    <div className="flex h-dvh flex-col bg-bg">
      {otherCourt && <div className="flex items-center justify-between gap-3 bg-info px-4 py-2 text-sm font-semibold text-white"><span>You are on {me.terminal!.courtName}'s device, viewing {snap.court.name}.</span><Link to={`/courts/${me.terminal!.courtId}`} className="underline">Back to {me.terminal!.courtName}</Link></div>}
      <div className="min-h-0 flex-1"><CourtConsole snap={snap} me={me} variant="console" onMenu={() => setMenu(true)} /></div>
      <ConsoleMenu me={me} open={menu} onClose={() => setMenu(false)} />
      <ToastHost large />
    </div>
  );
}

function WorkspaceCourt({ snap, detail, me }: { snap: CourtSnapshot; detail?: Detail; me: MeDto }) {
  const admin = me.user.role === 'admin';
  const nav = useNavigate();
  const qc = useQueryClient();
  const c = snap.court;
  const [note, setNote] = useState('');
  const [signOut, setSignOut] = useState(false);
  const activeMatch = snap.match && ['setup', 'in_progress', 'paused'].includes(snap.match.status);
  const maint = useMutation({
    mutationFn: (enabled: boolean) => post<{ warnings: BookingDto[] }>(`courts/${c.id}/maintenance`, { enabled, note: enabled ? note || null : null }),
    onSuccess: (r, enabled) => { void qc.invalidateQueries({ queryKey: ['courts'] }); if (enabled && r.warnings?.length) toast(`${r.warnings.length} upcoming booking(s) on this court — they were not cancelled`, 'info'); },
    onError: toastError,
  });
  const dev = detail?.court.device ?? c.device;
  return (
    <div>
      <PageHeader title={c.name} sub={<span className="inline-flex flex-wrap items-center gap-2"><Link to="/courts" className="inline-flex items-center gap-1 text-primary"><ArrowLeft className="size-4" />All courts</Link></span>}
        actions={<Button icon={<Maximize2 className="size-4" />} onClick={() => nav(`/courts/${c.id}?fs=1`)}>Full-screen scoring</Button>} />
      {me.terminal && me.terminal.courtId !== c.id && <Notice className="mb-4">You are on {me.terminal.courtName}'s device and are operating {c.name}. Everything you do is recorded under your name.</Notice>}
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="min-w-0"><CourtConsole snap={snap} me={me} variant="workspace" /></div>
        <aside className="space-y-4">
          <Card>
            <CardHeader title="Court device" />
            <div className="space-y-2 p-4 text-sm">
              {dev ? (<>
                <div className="flex items-center justify-between"><span className="inline-flex items-center gap-2 font-medium"><Smartphone className="size-4" />{c.name} device</span><DeviceDot device={dev} /></div>
                <p className="text-muted">Signed in: <b className="text-ink">{dev.signedInUser}</b></p>
                {!dev.online && dev.lastSeenAt && <p className="text-muted">Last seen {fmtDateTime(dev.lastSeenAt)}</p>}
                {admin && (dev.ip || dev.client) && <p className="text-xs text-muted">{dev.client} · {dev.ip}</p>}
                {admin && <Button size="sm" variant="secondary" onClick={() => setSignOut(true)}>Sign this device out</Button>}
              </>) : <p className="text-muted">No device is assigned. Sign in on the court's phone or tablet and choose “Use this device for {c.name}”.</p>}
            </div>
          </Card>
          <Card>
            <CardHeader title="Court status" />
            <div className="space-y-3 p-4 text-sm">
              {c.status === 'maintenance'
                ? (<><p className="flex items-center gap-2 font-medium"><Wrench className="size-4 text-st-maintenance" />Under maintenance{c.maintenanceNote ? ` — ${c.maintenanceNote}` : ''}</p><Button loading={maint.isPending} onClick={() => maint.mutate(false)}>End maintenance</Button></>)
                : (<><Field label="Maintenance note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="e.g. Net repair" disabled={!!activeMatch} /></Field>
                  <Button disabled={!!activeMatch || !c.isActive} loading={maint.isPending} onClick={() => maint.mutate(true)}>Turn on maintenance</Button>
                  {activeMatch && <p className="text-xs text-muted">End or cancel the active match first.</p>}</>)}
              {c.status === 'completed' && <Button onClick={async () => { try { await post(`courts/${c.id}/release`); } catch (e) { toastError(e); } }}>Release court now</Button>}
            </div>
          </Card>
          <Card>
            <CardHeader title="Today's bookings" actions={!admin ? <ViewOnlyTag /> : undefined} />
            {detail?.bookingsToday.length ? (
              <ul className="divide-y divide-line text-sm">{detail.bookingsToday.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-2 px-4 py-2.5"><span className="inline-flex items-center gap-2"><CalendarClock className="size-4 text-muted" /><span className={b.status !== 'confirmed' ? 'line-through text-muted' : ''}>{fmtTime(b.startAt)}–{fmtTime(b.endAt)} · {b.bookedByName}</span></span>{b.status !== 'confirmed' && <Badge>{b.status === 'no_show' ? 'No-show' : 'Cancelled'}</Badge>}{b.timeState === 'now' && b.status === 'confirmed' && <Badge tone="warn">Now</Badge>}</li>
              ))}</ul>
            ) : <p className="p-4 text-sm text-muted">No bookings today.</p>}
          </Card>
          <Card>
            <CardHeader title="Today's matches" />
            {detail?.matchesToday.length ? (
              <ul className="divide-y divide-line text-sm">{detail.matchesToday.map((m) => (
                <li key={m.id}><Link to={`/history/${m.id}`} className="flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-surface2"><span className="min-w-0 truncate">{m.team_a_name} v {m.team_b_name}</span><span className="tnum shrink-0 text-muted">{m.games_won_a}–{m.games_won_b} · {m.status === 'terminated' ? 'ended early' : m.status.replace('_', ' ')}</span></Link></li>
              ))}</ul>
            ) : <p className="p-4 text-sm text-muted">No matches yet today.</p>}
          </Card>
        </aside>
      </div>
      <ConfirmDialog open={signOut} onClose={() => setSignOut(false)} title={`Sign out the ${c.name} device?`} confirmLabel="Sign out" danger
        onConfirm={async () => { try { await del(`courts/${c.id}/device`); setSignOut(false); void qc.invalidateQueries({ queryKey: ['courts'] }); } catch (e) { toastError(e); } }}>
        The phone or tablet will return to the sign-in screen. The match on the court is not affected.
      </ConfirmDialog>
    </div>
  );
}
