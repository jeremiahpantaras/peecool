import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import type { Paged, PlayerListItem } from '@pickle/shared';
import { Badge, Button, Card, CardHeader, Check, ErrorBox, Field, Input, KpiTile, Modal, Notice, PageHeader, Pagination, Select, Spinner, Table, Td, Th } from '../ui';
import { get, patch, post } from '../lib/api';
import { useIsAdmin } from '../lib/auth';
import { fmtDay, fmtTime } from '../lib/time';
import { toast, toastError } from '../lib/toast';
import { TypeBadge } from './Players';

interface Hist {
  player: { key: string; kind: 'registered' | 'typed'; playerId: number | null; name: string; fullName?: string | null; notes?: string | null; isActive: boolean };
  stats: { matches: number; wins: number; losses: number; winPct: number; gamesWon: number; gamesLost: number; pointsFor: number; pointsAgainst: number; lastPlayedAt: number | null };
  matches: Paged<{ matchId: number; code: string; playedAt: number | null; playDate: string; courtName: string; partner: string | null; opponents: string[]; games: string[]; result: 'won' | 'lost' | 'ended_early' | 'cancelled' | 'in_progress' }>;
  note?: string;
}
const RESULT = { won: <Badge tone="success">Won</Badge>, lost: <Badge tone="danger">Lost</Badge>, ended_early: <Badge tone="warn">Ended early</Badge>, cancelled: <Badge>Cancelled</Badge>, in_progress: <Badge tone="info">In progress</Badge> };

export default function PlayerDetail() {
  const key = decodeURIComponent(useParams().key ?? '');
  const admin = useIsAdmin();
  const [page, setPage] = useState(1);
  const [dir, setDir] = useState(false); const [link, setLink] = useState(false); const [edit, setEdit] = useState(false);
  const q = useQuery({ queryKey: ['players', 'detail', key, page], queryFn: () => get<Hist>(`players/${encodeURIComponent(key)}?page=${page}&pageSize=20`), placeholderData: (p) => p });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  const { player: p, stats: s } = q.data!;
  return (
    <div>
      <PageHeader title={<span className="flex flex-wrap items-center gap-3">{p.name}<TypeBadge kind={p.kind} />{!p.isActive && <Badge tone="warn">inactive</Badge>}</span>}
        sub={<Link to="/players" className="inline-flex items-center gap-1 text-primary"><ArrowLeft className="size-4" />All players</Link>}
        actions={admin ? (p.kind === 'typed' ? <><Button onClick={() => setLink(true)}>Link to existing player</Button><Button variant="primary" onClick={() => setDir(true)}>Add to directory</Button></> : <Button onClick={() => setEdit(true)}>Edit player</Button>) : undefined} />
      {q.data!.note && <Notice className="mb-4">{q.data!.note}</Notice>}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <KpiTile label="Matches" value={s.matches} /><KpiTile label="Wins" value={s.wins} /><KpiTile label="Losses" value={s.losses} /><KpiTile label="Win %" value={`${s.winPct}%`} />
        <KpiTile label="Games W–L" value={`${s.gamesWon}–${s.gamesLost}`} /><KpiTile label="Points for" value={s.pointsFor} /><KpiTile label="Points against" value={s.pointsAgainst} /><KpiTile label="Last played" value={s.lastPlayedAt ? fmtDay(new Date(s.lastPlayedAt).toISOString().slice(0, 10)) : '—'} />
      </div>
      <p className="mb-3 text-xs text-muted">Statistics count completed matches only. Ended-early and cancelled matches are listed but not counted.</p>
      {p.fullName && <p className="mb-3 text-sm">Full name: {p.fullName}</p>}{p.notes && <p className="mb-3 text-sm text-muted">{p.notes}</p>}
      <Card><CardHeader title="Match history" />
        <Table><thead><tr><Th>Date</Th><Th>Court</Th><Th>Partner</Th><Th>Opponents</Th><Th>Games</Th><Th>Result</Th><Th>Match</Th></tr></thead>
          <tbody>{q.data!.matches.items.map((m) => (
            <tr key={m.matchId} className="hover:bg-surface2"><Td>{fmtDay(m.playDate)} <span className="text-muted">{fmtTime(m.playedAt)}</span></Td><Td>{m.courtName}</Td><Td>{m.partner ?? <span className="text-muted">—</span>}</Td><Td>{m.opponents.join(' / ')}</Td><Td className="tnum">{m.games.join(', ') || '—'}</Td><Td>{RESULT[m.result]}</Td><Td><Link className="text-primary hover:underline" to={`/history/${m.matchId}`}>{m.code}</Link></Td></tr>
          ))}</tbody></Table>
        <Pagination page={q.data!.matches.page} pageSize={q.data!.matches.pageSize} total={q.data!.matches.total} onPage={setPage} />
      </Card>
      {dir && <AddToDirectory name={p.name} onClose={() => setDir(false)} />}
      {link && <LinkTyped name={p.name} onClose={() => setLink(false)} />}
      {edit && p.playerId && <EditPlayer id={p.playerId} p={p} onClose={() => setEdit(false)} />}
    </div>
  );
}

function AddToDirectory({ name, onClose }: { name: string; onClose: () => void }) {
  const qc = useQueryClient(); const nav = useNavigate();
  const [display, setDisplay] = useState(name);
  const dry = useQuery({ queryKey: ['players', 'dry', name], queryFn: () => post<{ matchesToLink: number }>('players/typed/add-to-directory', { name, dryRun: true }) });
  const m = useMutation({ mutationFn: () => post<{ key: string }>('players/typed/add-to-directory', { name, displayName: display.trim() }), onSuccess: (r) => { toast('Added to the directory', 'success'); void qc.invalidateQueries({ queryKey: ['players'] }); onClose(); nav(`/players/${encodeURIComponent(r.key)}`); }, onError: toastError });
  return (
    <Modal open onClose={onClose} title="Add to the player directory" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} disabled={!display.trim()} onClick={() => m.mutate()}>Add to directory</Button></>}>
      <div className="space-y-4"><Field label="Display name"><Input value={display} maxLength={30} onChange={(e) => setDisplay(e.target.value)} /></Field>
        <Notice>{dry.isLoading ? 'Checking…' : <>This will link <b>{dry.data?.matchesToLink ?? 0}</b> past match{dry.data?.matchesToLink === 1 ? '' : 'es'} where “{name}” was typed. The names shown in those matches do not change.</>}</Notice>
        <p className="text-sm text-muted">Different people who happen to share this name would be combined. Only do this when you are sure.</p></div>
    </Modal>
  );
}

function LinkTyped({ name, onClose }: { name: string; onClose: () => void }) {
  const qc = useQueryClient(); const nav = useNavigate();
  const players = useQuery({ queryKey: ['players', 'registered-all'], queryFn: () => get<Paged<PlayerListItem>>('players?kind=registered&pageSize=200') });
  const [id, setId] = useState('');
  const m = useMutation({ mutationFn: () => post<{ linkedMatches: number }>(`players/${id}/link-typed`, { name }), onSuccess: (r) => { toast(`Linked ${r.linkedMatches} match(es)`, 'success'); void qc.invalidateQueries({ queryKey: ['players'] }); onClose(); nav(`/players/r:${id}`); }, onError: toastError });
  return (
    <Modal open onClose={onClose} title={`Link “${name}” to an existing player`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!id} loading={m.isPending} onClick={() => m.mutate()}>Link</Button></>}>
      <Field label="Registered player"><Select value={id} onChange={(e) => setId(e.target.value)}><option value="">Choose…</option>{players.data?.items.map((p) => <option key={p.key} value={p.playerId!}>{p.name}</option>)}</Select></Field>
    </Modal>
  );
}

function EditPlayer({ id, p, onClose }: { id: number; p: Hist['player']; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(p.name); const [full, setFull] = useState(p.fullName ?? ''); const [notes, setNotes] = useState(p.notes ?? ''); const [active, setActive] = useState(p.isActive);
  const m = useMutation({ mutationFn: () => patch(`players/${id}`, { displayName: name.trim(), fullName: full.trim() || null, notes: notes.trim() || null, isActive: active }), onSuccess: () => { toast('Saved', 'success'); void qc.invalidateQueries({ queryKey: ['players'] }); onClose(); }, onError: toastError });
  return (
    <Modal open onClose={onClose} title="Edit player" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>Save</Button></>}>
      <div className="space-y-4"><Field label="Display name"><Input value={name} maxLength={30} onChange={(e) => setName(e.target.value)} /></Field><Field label="Full name"><Input value={full} maxLength={80} onChange={(e) => setFull(e.target.value)} /></Field><Field label="Notes"><Input value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} /></Field>
        <Check checked={active} onChange={setActive} label="Active (shown in name suggestions)" /><p className="text-xs text-muted">Renaming never changes past matches — they keep the name used at the time.</p></div>
    </Modal>
  );
}
