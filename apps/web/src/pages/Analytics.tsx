import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Download, Printer } from 'lucide-react';
import type { CourtSnapshot } from '@pickle/shared';
import { Badge, Button, Card, CardHeader, Empty, ErrorBox, Field, Input, Segmented, Select, Spinner, Table, Td, Th } from '../ui';
import { downloadUrl, get, qs } from '../lib/api';
import { useIsAdmin } from '../lib/auth';
import { addDays, fmtDateTime, isoWeekday, today } from '../lib/time';
import { Link } from 'react-router-dom';

type Report = 'volume' | 'utilization' | 'durations' | 'peak-hours' | 'players' | 'turnover' | 'bookings';
const REPORTS: { value: Report; label: string }[] = [
  { value: 'volume', label: 'Volume' }, { value: 'utilization', label: 'Utilization' }, { value: 'durations', label: 'Durations' }, { value: 'peak-hours', label: 'Peak hours' },
  { value: 'players', label: 'Players' }, { value: 'turnover', label: 'Turnover' }, { value: 'bookings', label: 'Bookings' },
];
const PRESETS = ['Today', 'Yesterday', 'This week', 'Last week', 'This month', 'Last month', 'Custom'] as const;
type Preset = (typeof PRESETS)[number];

function presetRange(p: Preset): { from: string; to: string } {
  const t = today();
  const weekStart = addDays(t, -(isoWeekday(t) - 1));
  const monthStart = `${t.slice(0, 8)}01`;
  const prevMonthEnd = addDays(monthStart, -1);
  switch (p) {
    case 'Yesterday': return { from: addDays(t, -1), to: addDays(t, -1) };
    case 'This week': return { from: weekStart, to: addDays(weekStart, 6) };
    case 'Last week': return { from: addDays(weekStart, -7), to: addDays(weekStart, -1) };
    case 'This month': { const [y, m] = t.split('-').map(Number) as [number, number]; const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); return { from: monthStart, to: `${t.slice(0, 8)}${String(last).padStart(2, '0')}` }; }
    case 'Last month': return { from: `${prevMonthEnd.slice(0, 8)}01`, to: prevMonthEnd };
    default: return { from: t, to: t };
  }
}
/** Brand chart series (DESIGN_SYSTEM §1.4). Recharts needs literal colours; these mirror the tokens in index.css. */
const COLORS = { teal: '#0D3F27', amber: '#8A4B00', blue: '#1E3FAE', orange: '#8A2E0E', violet: '#41702E' };

export default function Analytics() {
  const admin = useIsAdmin();
  const [report, setReport] = useState<Report>('volume');
  const [preset, setPreset] = useState<Preset>('Today');
  const [custom, setCustom] = useState(presetRange('Today'));
  const [courtId, setCourtId] = useState('');
  const [groupBy, setGroupBy] = useState<'day' | 'week' | 'month'>('day');
  const range = preset === 'Custom' ? custom : presetRange(preset);
  const courts = useQuery({ queryKey: ['courts', 'filter'], queryFn: () => get<CourtSnapshot[]>('courts?includeInactive=true'), staleTime: 60_000 });
  const params = { ...range, courtId, groupBy: report === 'volume' ? groupBy : undefined };
  const q = useQuery({ queryKey: ['reports', report, params], queryFn: () => get<any>(`reports/${report}${qs(params)}`) });
  return (
    <div className="space-y-4">
      <Card className="no-print p-3">
        <div className="flex flex-wrap items-end gap-3">
          <Segmented value={report} onChange={setReport} options={REPORTS} className="max-w-full overflow-x-auto" />
          <Field label="Period"><Select value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>{PRESETS.map((p) => <option key={p}>{p}</option>)}</Select></Field>
          {preset === 'Custom' && <><Field label="From"><Input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /></Field><Field label="To"><Input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></Field></>}
          <Field label="Court"><Select value={courtId} onChange={(e) => setCourtId(e.target.value)}><option value="">All courts</option>{courts.data?.map((c) => <option key={c.court.id} value={c.court.id}>{c.court.name}{c.court.isActive ? '' : ' (inactive)'}</option>)}</Select></Field>
          {report === 'volume' && <Field label="Group by"><Select value={groupBy} onChange={(e) => setGroupBy(e.target.value as 'day')}><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option></Select></Field>}
          <span className="flex-1" />
          <Button icon={<Printer className="size-4" />} onClick={() => window.print()}>Print / PDF</Button>
          {admin && <Button icon={<Download className="size-4" />} onClick={() => downloadUrl(`reports/${report}.csv${qs(params)}`)}>Export CSV</Button>}
        </div>
      </Card>
      <p className="hidden text-sm print:block">Report: {REPORTS.find((r) => r.value === report)?.label} · {range.from} to {range.to}</p>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} retry={() => q.refetch()} /> : <ReportBody report={report} data={q.data} />}
    </div>
  );
}

function ReportBody({ report, data }: { report: Report; data: any }) {
  switch (report) {
    case 'volume': return <Volume rows={data.rows} />;
    case 'utilization': return <Utilization data={data} />;
    case 'durations': return <Durations d={data} />;
    case 'peak-hours': return <Peak cells={data.cells} />;
    case 'players': return <PlayersReport rows={data.rows} />;
    case 'turnover': return <Simple title="Court turnover" sub="Average gap between consecutive matches on the same court (same day)" head={['Court', 'Matches', 'Average gap (min)']} rows={data.rows.map((r: any) => [r.courtName, r.matches, r.avgGapMinutes ?? '—'])} />;
    case 'bookings': return <Simple title="Booking utilization" sub="Booked hours against operating hours, cancellations and no-shows" head={['Court', 'Bookings', 'Booked (min)', 'Booked %', 'Cancelled', 'No-show', 'Matches played in booking %']} rows={data.rows.map((r: any) => [r.courtName, r.bookings, r.bookedMinutes, `${r.bookedPct}%`, r.cancelled, r.noShow, r.playedPct == null ? '—' : `${r.playedPct}%`])} />;
  }
}

function Simple({ title, sub, head, rows }: { title: string; sub: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <Card><CardHeader title={title} sub={sub} />
      {rows.length === 0 ? <Empty title="No data for this period" /> : <Table><thead><tr>{head.map((h) => <Th key={h}>{h}</Th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <Td key={j} className={j ? 'tnum' : 'font-medium'}>{c}</Td>)}</tr>)}</tbody></Table>}
    </Card>
  );
}

function Volume({ rows }: { rows: { period: string; completed: number; endedEarly: number; singles: number; doubles: number }[] }) {
  if (!rows.length) return <Card><Empty title="No matches in this period" /></Card>;
  return (
    <Card><CardHeader title="Match volume" sub="Completed matches and matches ended early" />
      <div className="h-72 p-4"><ResponsiveContainer><BarChart data={rows}><CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} /><XAxis dataKey="period" fontSize={12} /><YAxis allowDecimals={false} fontSize={12} /><Tooltip /><Legend />
        <Bar dataKey="completed" name="Completed" stackId="a" fill={COLORS.teal} /><Bar dataKey="endedEarly" name="Ended early" stackId="a" fill={COLORS.amber} /></BarChart></ResponsiveContainer></div>
      <Table><thead><tr><Th>Period</Th><Th>Completed</Th><Th>Ended early</Th><Th>Singles</Th><Th>Doubles</Th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.period}><Td className="font-medium">{r.period}</Td><Td className="tnum">{r.completed}</Td><Td className="tnum">{r.endedEarly}</Td><Td className="tnum">{r.singles}</Td><Td className="tnum">{r.doubles}</Td></tr>)}</tbody></Table>
    </Card>
  );
}

function Utilization({ data }: { data: { rows: any[]; total: any } }) {
  if (!data.rows.length) return <Card><Empty title="No courts" /></Card>;
  const h = Math.max(220, data.rows.length * 32);
  return (
    <Card><CardHeader title="Court utilization" sub={`Facility total: ${data.total.utilizationPct}% of operating hours (${Math.round(data.total.occupiedMinutes / 60 * 10) / 10} h occupied)`} />
      <div className="p-4" style={{ height: h }}><ResponsiveContainer><BarChart data={data.rows} layout="vertical" margin={{ left: 20 }}><CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} /><XAxis type="number" unit="%" fontSize={12} domain={[0, 100]} /><YAxis type="category" dataKey="courtName" width={90} fontSize={12} /><Tooltip /><Bar dataKey="utilizationPct" name="Utilization %" fill={COLORS.teal} /></BarChart></ResponsiveContainer></div>
      <Table><thead><tr><Th>Court</Th><Th>Matches</Th><Th>Occupied (min)</Th><Th>Playing (min)</Th><Th>Operating (min)</Th><Th>Utilization</Th></tr></thead>
        <tbody>{data.rows.map((r) => <tr key={r.courtId}><Td className="font-medium">{r.courtName} {!r.courtActive && <Badge>inactive</Badge>}</Td><Td className="tnum">{r.matches}</Td><Td className="tnum">{r.occupiedMinutes}</Td><Td className="tnum">{r.playingMinutes}</Td><Td className="tnum">{r.operatingMinutes}</Td><Td className="tnum font-semibold">{r.utilizationPct}%</Td></tr>)}</tbody></Table>
    </Card>
  );
}

function Durations({ d }: { d: any }) {
  return (
    <div className="space-y-4">
      <Card><CardHeader title="Match duration" sub="Playing time (pauses excluded)" />
        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-5">{[['Matches', d.overall.count], ['Average', `${d.overall.avg} min`], ['Median', `${d.overall.median} min`], ['Shortest', `${d.overall.min} min`], ['Longest', `${d.overall.max} min`]].map(([l, v]) => <div key={l as string}><p className="text-xs uppercase text-muted">{l}</p><p className="tnum text-2xl font-semibold">{v}</p></div>)}</div>
        <p className="px-4 pb-4 text-sm text-muted">Average game: {d.avgGameMinutes} min</p>
      </Card>
      <Card><CardHeader title="Distribution" /><div className="h-64 p-4"><ResponsiveContainer><BarChart data={d.histogram}><CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} /><XAxis dataKey="bucket" fontSize={12} unit=" min" /><YAxis allowDecimals={false} fontSize={12} /><Tooltip /><Bar dataKey="count" name="Matches" fill={COLORS.violet} /></BarChart></ResponsiveContainer></div></Card>
      {([['By rule preset', d.byFormat], ['By court', d.byCourt], ['By match type', d.byPlayType]] as const).map(([t, rows]) => (
        <Card key={t}><CardHeader title={t} />{rows.length === 0 ? <Empty title="No data" /> : <Table><thead><tr><Th>{t.replace('By ', '')}</Th><Th>Matches</Th><Th>Avg</Th><Th>Median</Th><Th>Min</Th><Th>Max</Th></tr></thead><tbody>{rows.map((r: any) => <tr key={r.key}><Td className="font-medium capitalize">{r.key}</Td><Td className="tnum">{r.count}</Td><Td className="tnum">{r.avg}</Td><Td className="tnum">{r.median}</Td><Td className="tnum">{r.min}</Td><Td className="tnum">{r.max}</Td></tr>)}</tbody></Table>}</Card>
      ))}
    </div>
  );
}

function Peak({ cells }: { cells: { weekday: number; hour: number; avgOccupiedCourts: number }[] }) {
  if (!cells.length) return <Card><Empty title="No matches in this period" /></Card>;
  const max = Math.max(...cells.map((c) => c.avgOccupiedCourts), 0.01);
  const hours = Array.from({ length: 24 }, (_, i) => i).filter((h) => cells.some((c) => c.hour === h) || (h >= 7 && h <= 21));
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const val = (d: number, h: number) => cells.find((c) => c.weekday === d && c.hour === h)?.avgOccupiedCourts ?? 0;
  return (
    <Card><CardHeader title="Peak hours" sub="Average number of courts in use, by weekday and hour" />
      <div className="overflow-x-auto p-4"><div className="inline-grid gap-1" style={{ gridTemplateColumns: `48px repeat(${hours.length}, minmax(34px, 1fr))` }}>
        <span />{hours.map((h) => <span key={h} className="text-center text-[11px] text-muted">{h}</span>)}
        {days.map((dn, di) => (<><span key={dn} className="self-center text-xs font-medium">{dn}</span>{hours.map((h) => { const v = val(di + 1, h); return <span key={dn + h} title={`${dn} ${h}:00 — ${v} courts`} className="grid h-8 place-items-center rounded text-[10px] tnum" style={{ background: `color-mix(in srgb, #0D3F27 ${Math.round((v / max) * 100)}%, var(--c-surface2))`, color: v / max > 0.55 ? '#fff' : 'inherit' }}>{v ? v.toFixed(1) : ''}</span>; })}</>))}
      </div></div>
    </Card>
  );
}

function PlayersReport({ rows }: { rows: any[] }) {
  if (!rows.length) return <Card><Empty title="No player activity in this period" /></Card>;
  return (
    <Card><CardHeader title="Player participation" sub="Completed matches only. Typed names are grouped by the name as typed." />
      <Table><thead><tr><Th>Player</Th><Th>Type</Th><Th>Matches</Th><Th>Wins</Th><Th>Losses</Th><Th>Last played</Th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.key}><Td className="font-medium"><Link className="text-primary hover:underline" to={`/players/${encodeURIComponent(r.key)}`}>{r.name}</Link></Td><Td>{r.kind === 'registered' ? <Badge tone="primary">Registered</Badge> : <Badge>Typed name</Badge>}</Td><Td className="tnum">{r.matches}</Td><Td className="tnum">{r.wins}</Td><Td className="tnum">{r.losses}</Td><Td>{r.lastPlayedAt ? fmtDateTime(r.lastPlayedAt) : '—'}</Td></tr>)}</tbody></Table>
    </Card>
  );
}
