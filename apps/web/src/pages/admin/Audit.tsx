import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Card, Empty, ErrorBox, Field, Input, PageHeader, Pagination, Select, Spinner, Table, Td, Th } from '../../ui';
import { get, qs } from '../../lib/api';
import { fmtDateTime } from '../../lib/time';

interface Row { id: number; at: number; actorType: string; actor: string | null; actorRole: string | null; actorCourt: string | null; action: string; entityType: string | null; entityId: string | null; details: unknown; ip: string | null }

export default function Audit() {
  const [f, setF] = useState({ from: '', to: '', action: '', entityType: '' }); const [page, setPage] = useState(1); const [open, setOpen] = useState<number | null>(null);
  const set = (k: keyof typeof f, v: string) => { setF({ ...f, [k]: v }); setPage(1); };
  const q = useQuery({ queryKey: ['audit', f, page], queryFn: () => get<{ items: Row[]; total: number; pageSize: number }>(`audit-logs${qs({ ...f, page, pageSize: 50 })}`), placeholderData: (p) => p });
  return (
    <div>
      <PageHeader title="Audit log" sub="Who changed what. Rally-by-rally scoring is in each match's timeline instead." />
      <Card className="mb-4 p-3"><div className="flex flex-wrap items-end gap-3">
        <Field label="From"><Input type="date" value={f.from} onChange={(e) => set('from', e.target.value)} /></Field><Field label="To"><Input type="date" value={f.to} onChange={(e) => set('to', e.target.value)} /></Field>
        <Field label="Action starts with"><Input placeholder="e.g. booking. or auth." value={f.action} onChange={(e) => set('action', e.target.value)} /></Field>
        <Field label="Item"><Select value={f.entityType} onChange={(e) => set('entityType', e.target.value)}><option value="">All</option>{['court', 'booking', 'match', 'player', 'format', 'user', 'settings', 'backup'].map((x) => <option key={x}>{x}</option>)}</Select></Field>
      </div></Card>
      <Card>
        {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} /> : !q.data?.items.length ? <Empty title="No entries" /> : (<>
          <Table><thead><tr><Th>Time</Th><Th>Who</Th><Th>Action</Th><Th>Item</Th><Th>From</Th><Th /></tr></thead>
            <tbody>{q.data.items.map((r) => (<>
              <tr key={r.id} className="hover:bg-surface2"><Td className="tnum whitespace-nowrap">{fmtDateTime(r.at)}</Td>
                <Td>{r.actorType === 'system' ? <Badge>System</Badge> : r.actorType === 'anonymous' ? <Badge tone="warn">Not signed in</Badge> : <>{r.actor ?? '—'} {r.actorRole && <Badge tone={r.actorRole === 'admin' ? 'primary' : 'info'}>{r.actorRole}</Badge>}{r.actorCourt && <span className="ml-1 text-xs text-muted">on {r.actorCourt}</span>}</>}</Td>
                <Td className="font-medium">{r.action}</Td><Td>{r.entityType ? `${r.entityType} ${r.entityId ?? ''}` : ''}</Td><Td className="text-muted">{r.ip}</Td>
                <Td>{r.details != null && <button className="text-primary underline" onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? 'Hide' : 'Details'}</button>}</Td></tr>
              {open === r.id && <tr key={`${r.id}d`}><td colSpan={6} className="bg-surface2 px-4 py-2"><pre className="max-h-64 overflow-auto text-xs">{JSON.stringify(r.details, null, 2)}</pre></td></tr>}
            </>))}</tbody></Table>
          <Pagination page={page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} />
        </>)}
      </Card>
    </div>
  );
}
