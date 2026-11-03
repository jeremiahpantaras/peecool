import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Info, OctagonAlert } from 'lucide-react';
import type { Alert, DashboardDto } from '@pickle/shared';
import { Card, CardHeader, ErrorBox, KpiTile, PageHeader, Segmented, Spinner, cx } from '../ui';
import { get } from '../lib/api';
import { activityStore, alertsStore, applySnapshot, courtsStore, realtime } from '../lib/realtime';
import { useStore } from '../lib/store';
import { fmtTime } from '../lib/time';
import { CourtCard } from './Courts';
import Analytics from './Analytics';

export default function Dashboard() {
  const [tab, setTab] = useState<'live' | 'analytics'>(() => (sessionStorage.getItem('ps_dash_tab') as 'live' | 'analytics') || 'live');
  const pick = (t: 'live' | 'analytics') => { setTab(t); try { sessionStorage.setItem('ps_dash_tab', t); } catch { /* ignore */ } };
  return (
    <div>
      <PageHeader title="Dashboard" sub={new Intl.DateTimeFormat([], { dateStyle: 'full' }).format(new Date())} actions={<Segmented value={tab} onChange={pick} options={[{ value: 'live', label: 'Live' }, { value: 'analytics', label: 'Analytics' }]} />} />
      {tab === 'live' ? <Live /> : <Analytics />}
    </div>
  );
}

const ICON = { info: Info, warning: AlertTriangle, danger: OctagonAlert };

function Live() {
  useEffect(() => realtime.want('all'), []);
  const q = useQuery({ queryKey: ['dashboard'], queryFn: async () => { const d = await get<DashboardDto>('dashboard'); d.courts.forEach(applySnapshot); return d; }, refetchInterval: 30_000 });
  const live = useStore(courtsStore);
  const pushedAlerts = useStore(alertsStore);
  const pushedActivity = useStore(activityStore);
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  const d = q.data!;
  const courts = d.courts.map((c) => live[c.court.id] ?? c);
  const alerts: Alert[] = pushedAlerts ?? d.alerts;
  const activity = pushedActivity.length ? pushedActivity : d.recentActivity;
  const k = d.kpis;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-8">
        <KpiTile label="Courts" value={k.totalCourts} />
        <KpiTile label="Available" value={k.availableCourts} />
        <KpiTile hero label="Active matches" value={k.activeMatches} sub="live right now" />
        <KpiTile label="Completed today" value={k.completedToday} />
        <KpiTile label="Matches today" value={k.matchesToday} />
        <KpiTile label="Bookings today" value={k.bookingsToday} />
        <KpiTile label="Next booking" value={k.nextBooking ? fmtTime(k.nextBooking.startAt) : '—'} sub={k.nextBooking ? `${k.nextBooking.courtName} · ${k.nextBooking.bookedByName}` : 'None upcoming'} />
        <KpiTile label="Court devices" value={`${k.devicesOnline} / ${k.devicesTotal}`} sub="online" tone={k.devicesTotal > k.devicesOnline ? 'warn' : undefined} />
      </div>
      {alerts.length > 0 && (
        <Card><CardHeader title={`Alerts (${alerts.length})`} />
          <ul className="divide-y divide-line">{alerts.map((a) => { const I = ICON[a.level]; return (
            <li key={a.id} className="flex items-start gap-3 px-4 py-2.5 text-sm"><I className={cx('mt-0.5 size-4 shrink-0', a.level === 'danger' ? 'text-danger' : a.level === 'warning' ? 'text-warn' : 'text-info')} />
              <span className="flex-1">{a.text}</span>{a.courtId && <Link className="shrink-0 text-primary underline" to={`/courts/${a.courtId}`}>Open</Link>}</li>
          ); })}</ul></Card>
      )}
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div>
          <h2 className="mb-2 text-lg font-bold">Courts</h2>
          {courts.length === 0 ? <Card className="p-8 text-center text-muted">No courts set up yet.</Card> : <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">{courts.map((c) => <CourtCard key={c.court.id} s={c} />)}</div>}
        </div>
        <Card className="h-fit"><CardHeader title="Recent activity" />
          {activity.length === 0 ? <p className="p-4 text-sm text-muted">Nothing yet today.</p> : (
            <ul className="divide-y divide-line text-sm">{activity.map((a, i) => <li key={`${a.at}-${i}`} className="flex gap-3 px-4 py-2"><span className="tnum shrink-0 text-muted">{fmtTime(a.at)}</span><span>{a.text}</span></li>)}</ul>
          )}
        </Card>
      </div>
    </div>
  );
}
