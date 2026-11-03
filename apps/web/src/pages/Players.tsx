import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import type { Paged, PlayerListItem } from '@pickle/shared';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, Notice, PageHeader, Pagination, Segmented, Select, Spinner, Table, Td, Textarea, Th, ViewOnlyTag } from '../ui';
import { ApiError, get, post, qs } from '../lib/api';
import { useIsAdmin } from '../lib/auth';
import { fmtDate } from '../lib/time';
import { toast, toastError } from '../lib/toast';

export const TypeBadge = ({ kind }: { kind: 'registered' | 'typed' }) => kind === 'registered' ? <Badge tone="primary">Registered</Badge> : <Badge>Typed name</Badge>;

export default function Players() {
  const admin = useIsAdmin();
  const [kind, setKind] = useState<'all' | 'registered' | 'typed'>('all');
  const [q, setQ] = useState(''); const [sort, setSort] = useState('name'); const [order, setOrder] = useState<'asc' | 'desc'>('asc'); const [page, setPage] = useState(1);
  const [add, setAdd] = useState(false);
  const params = { kind, q, sort, order, page, pageSize: 25 };
  const r = useQuery({ queryKey: ['players', params], queryFn: () => get<Paged<PlayerListItem>>(`players${qs(params)}`), placeholderData: (p) => p });
  const head = (key: string, label: string) => <Th><button className="font-semibold uppercase" onClick={() => { if (sort === key) setOrder(order === 'asc' ? 'desc' : 'asc'); else { setSort(key); setOrder(key === 'name' ? 'asc' : 'desc'); } setPage(1); }}>{label}{sort === key ? (order === 'asc' ? ' ↑' : ' ↓') : ''}</button></Th>;
  return (
    <div>
      <PageHeader title="Players" sub="Everyone who has played — registered players and names typed at the courts — with their history."
        actions={admin ? <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdd(true)}>Add player</Button> : <ViewOnlyTag />} />
      <Card className="mb-4 p-3"><div className="flex flex-wrap items-end gap-3">
        <Segmented value={kind} onChange={(v) => { setKind(v); setPage(1); }} options={[{ value: 'all', label: 'All' }, { value: 'registered', label: 'Registered' }, { value: 'typed', label: 'Typed names' }]} />
        <Field label="Search"><Input placeholder="Search players" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="w-64" /></Field>
        <Field label="Sort"><Select value={`${sort}`} onChange={(e) => { setSort(e.target.value); setPage(1); }}><option value="name">Name</option><option value="matches">Matches</option><option value="wins">Wins</option><option value="lastPlayed">Last played</option></Select></Field>
      </div></Card>
      <Card>
        {r.isLoading ? <Spinner /> : r.error ? <ErrorBox error={r.error} retry={() => r.refetch()} /> : !r.data?.items.length ? <Empty title="No players yet">Names appear here after matches are played.</Empty> : (
          <>
            <Table><thead><tr>{head('name', 'Name')}<Th>Type</Th>{head('matches', 'Matches')}<Th>W–L</Th>{head('lastPlayed', 'Last played')}<Th /></tr></thead>
              <tbody>{r.data.items.map((p) => (
                <tr key={p.key} className="hover:bg-surface2">
                  <Td className="font-medium"><Link to={`/players/${encodeURIComponent(p.key)}`} className="text-primary hover:underline">{p.name}</Link></Td>
                  <Td><TypeBadge kind={p.kind} /> {!p.isActive && <Badge tone="warn">inactive</Badge>}</Td>
                  <Td className="tnum">{p.matches}</Td><Td className="tnum">{p.wins}–{p.losses}</Td>
                  <Td>{p.lastPlayedAt ? fmtDate(p.lastPlayedAt) : <span className="text-muted">—</span>}</Td>
                  <Td className="text-right"><Link to={`/history?playerKey=${encodeURIComponent(p.key)}`} className="text-sm text-muted hover:text-primary">Matches</Link></Td>
                </tr>))}</tbody></Table>
            <Pagination page={r.data.page} pageSize={r.data.pageSize} total={r.data.total} onPage={setPage} />
          </>
        )}
      </Card>
      {add && <AddPlayer onClose={() => setAdd(false)} />}
    </div>
  );
}

function AddPlayer({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(''); const [full, setFull] = useState(''); const [notes, setNotes] = useState(''); const [dups, setDups] = useState<{ id: number; displayName: string }[]>([]);
  const m = useMutation({
    mutationFn: () => post<{ possibleDuplicates: { id: number; displayName: string }[] }>('players', { displayName: name.trim(), fullName: full.trim() || null, notes: notes.trim() || null }),
    onSuccess: (r) => { if (r.possibleDuplicates.length) { setDups(r.possibleDuplicates); toast('Added — but another active player has the same name', 'info'); } else { toast('Player added', 'success'); onClose(); } void qc.invalidateQueries({ queryKey: ['players'] }); },
    onError: toastError,
  });
  return (
    <Modal open onClose={onClose} title="Add player" footer={<><Button onClick={onClose}>{dups.length ? 'Close' : 'Cancel'}</Button>{!dups.length && <Button variant="primary" loading={m.isPending} disabled={!name.trim()} onClick={() => m.mutate()}>Add player</Button>}</>}>
      <div className="space-y-4">
        <Field label="Display name" hint="Shown on the court. Up to 30 characters."><Input autoFocus value={name} maxLength={30} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Full name (optional)"><Input value={full} maxLength={80} onChange={(e) => setFull(e.target.value)} /></Field>
        <Field label="Notes (optional)"><Textarea value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} /></Field>
        {dups.length > 0 && <Notice tone="warn">Another active player is also called “{dups[0]!.displayName}”. Both are kept; rename one if they are different people.</Notice>}
      </div>
    </Modal>
  );
}
export { ApiError };
