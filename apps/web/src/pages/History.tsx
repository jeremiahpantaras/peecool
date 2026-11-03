import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import type { CourtSnapshot, Paged } from '@pickle/shared';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Pagination, PageHeader, Select, Spinner, Table, Td, Th, cx } from '../ui';
import { downloadUrl, get, qs } from '../lib/api';
import { useIsAdmin } from '../lib/auth';
import { addDays, fmtDay, fmtDuration, fmtTime, today } from '../lib/time';
import { endReasonLabel } from '../console/parts';

export interface MatchItem {
  id: number; code: string; playDate: string; courtName: string; courtActive: boolean; playType: 'singles' | 'doubles';
  teams: { A: { name: string; players: string[] }; B: { name: string; players: string[] } }; rulesName: string; customized: boolean;
  games: { a: number; b: number; status: string }[]; gamesWon: { A: number; B: number }; winner: 'A' | 'B' | null;
  status: string; endReason: string | null; endNote: string | null; startedAt: number | null; endedAt: number | null; durationMs: number | null; bookingCode: string | null; createdBy: string | null; corrected: boolean; openPlay?: boolean;
}

export function StatusBadge({ m }: { m: Pick<MatchItem, 'status' | 'endReason'> }) {
  switch (m.status) {
    case 'completed': return <Badge tone="success">Completed</Badge>;
    case 'terminated': return <Badge tone="warn">Ended early{m.endReason ? ` – ${endReasonLabel(m.endReason)}` : ''}</Badge>;
    case 'cancelled': return <Badge>Cancelled</Badge>;
    case 'in_progress': return <Badge tone="info">In progress</Badge>;
    case 'paused': return <Badge tone="warn">Paused</Badge>;
    case 'setup': return <Badge tone="info">Set up</Badge>;
    default: return <Badge>{m.status}</Badge>;
  }
}
export const teamLine = (m: MatchItem, t: 'A' | 'B'): string => `${m.teams[t].players.join(' / ')}`;
export const gamesLine = (m: MatchItem): string => (m.games.length ? m.games.map((g) => `${g.a}–${g.b}`).join(', ') : '—');

export default function History() {
  const admin = useIsAdmin();
  const nav = useNavigate();
  const [f, setF] = useState({ from: addDays(today(), -30), to: today(), courtId: '', status: '', playType: '', openPlay: '', q: '', playerKey: new URLSearchParams(location.search).get('playerKey') ?? '' });
  const [page, setPage] = useState(1);
  const set = (k: keyof typeof f, v: string) => { setF((s) => ({ ...s, [k]: v })); setPage(1); };
  const courts = useQuery({ queryKey: ['courts', 'filter'], queryFn: () => get<CourtSnapshot[]>('courts?includeInactive=true'), staleTime: 60_000 });
  const params = { ...f, page, pageSize: 25 };
  const q = useQuery({ queryKey: ['matches', params], queryFn: () => get<Paged<MatchItem>>(`matches${qs(params)}`), placeholderData: (p) => p });
  const preset = (n: number | 'all') => { setF((s) => ({ ...s, from: n === 'all' ? '' : addDays(today(), -n), to: n === 'all' ? '' : today() })); setPage(1); };
  return (
    <div>
      <PageHeader title="Game Histories" sub="Every match played, with game scores and a full event timeline."
        actions={admin ? <Button icon={<Download className="size-4" />} onClick={() => downloadUrl(`matches/export.csv${qs(f)}`)}>Export CSV</Button> : undefined} />
      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="From"><Input type="date" value={f.from} onChange={(e) => set('from', e.target.value)} /></Field>
          <Field label="To"><Input type="date" value={f.to} onChange={(e) => set('to', e.target.value)} /></Field>
          <div className="flex gap-1 pb-0.5">{([['Today', 0], ['7 days', 7], ['30 days', 30], ['All', 'all']] as const).map(([l, n]) => <Button key={l} size="sm" onClick={() => preset(n)}>{l}</Button>)}</div>
          <Field label="Court"><Select value={f.courtId} onChange={(e) => set('courtId', e.target.value)}><option value="">All courts</option>{courts.data?.map((c) => <option key={c.court.id} value={c.court.id}>{c.court.name}{c.court.isActive ? '' : ' (inactive)'}</option>)}</Select></Field>
          <Field label="Status"><Select value={f.status} onChange={(e) => set('status', e.target.value)}><option value="">All</option><option value="completed">Completed</option><option value="terminated">Ended early</option><option value="cancelled">Cancelled</option><option value="in_progress,paused,setup">Live</option></Select></Field>
          <Field label="Type"><Select value={f.playType} onChange={(e) => set('playType', e.target.value)}><option value="">All</option><option value="singles">Singles</option><option value="doubles">Doubles</option></Select></Field>
          <Field label="Kind"><Select value={f.openPlay} onChange={(e) => set('openPlay', e.target.value)}><option value="">All games</option><option value="1">Open Play only</option></Select></Field>
          <Field label="Search"><Input placeholder="Name, team or match code" value={f.q} onChange={(e) => set('q', e.target.value)} className="w-56" /></Field>
        </div>
        {f.playerKey && <p className="mt-2 text-sm">Filtered to one player. <button className="text-primary underline" onClick={() => set('playerKey', '')}>Clear</button></p>}
      </Card>
      <Card>
        {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} retry={() => q.refetch()} /> : !q.data?.items.length ? <Empty title="No matches found" >Try widening the dates or clearing filters.</Empty> : (
          <>
            <Table>
              <thead><tr><Th>Match</Th><Th>Date</Th><Th>Court</Th><Th>Type</Th><Th>Team A</Th><Th>Team B</Th><Th>Games</Th><Th>Winner</Th><Th>Duration</Th><Th>Status</Th></tr></thead>
              <tbody>{q.data.items.map((m) => (
                <tr key={m.id} className="cursor-pointer hover:bg-surface2" onClick={() => nav(`/history/${m.id}`)}>
                  <Td className="font-medium"><Link to={`/history/${m.id}`} className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{m.code}</Link></Td>
                  <Td>{fmtDay(m.playDate)} <span className="text-muted">{fmtTime(m.startedAt)}</span></Td>
                  <Td>{m.openPlay && <Badge tone="info" className="mr-1">Open Play</Badge>}{m.courtName}{!m.courtActive && <Badge className="ml-1">inactive</Badge>}</Td>
                  <Td className="capitalize">{m.playType}{m.customized && <span className="ml-1 text-xs text-muted">(custom)</span>}</Td>
                  <Td className="max-w-48 truncate" title={teamLine(m, 'A')}><span className="mr-1 inline-block h-3 w-1 rounded bg-teamA align-middle" />{teamLine(m, 'A')}</Td>
                  <Td className="max-w-48 truncate" title={teamLine(m, 'B')}><span className="mr-1 inline-block h-3 w-1 rounded bg-teamB align-middle" />{teamLine(m, 'B')}</Td>
                  <Td className="tnum">{gamesLine(m)}</Td>
                  <Td className={cx('font-medium', m.winner === 'A' ? 'text-teamA' : 'text-teamB')}>{m.winner ? m.teams[m.winner].name : ''}</Td>
                  <Td className="tnum">{fmtDuration(m.durationMs)}</Td>
                  <Td><StatusBadge m={m} />{m.corrected && <Badge className="ml-1">corrected</Badge>}</Td>
                </tr>
              ))}</tbody>
            </Table>
            <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
