import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Star } from 'lucide-react';
import { DEFAULT_RULES, describeRules, validateRules, type MatchRules } from '@pickle/shared';
import { Badge, Button, Card, ErrorBox, Field, Input, Modal, Notice, PageHeader, Spinner, Table, Td, Th } from '../../ui';
import { ApiError, del, get, patch, post } from '../../lib/api';
import { toast, toastError } from '../../lib/toast';
import { RulesEditor } from '../../console/Wizard';

interface Preset { id: number; name: string; rules: MatchRules; isDefault: boolean; isActive: boolean; used: boolean }

export default function Presets() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['formats', 'admin'], queryFn: () => get<Preset[]>('formats?includeInactive=true') });
  const [edit, setEdit] = useState<Preset | 'new' | null>(null);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['formats'] }); };
  const makeDefault = useMutation({ mutationFn: (id: number) => post(`formats/${id}/make-default`), onSuccess: refresh, onError: toastError });
  const toggle = useMutation({ mutationFn: (p: Preset) => patch(`formats/${p.id}`, { isActive: !p.isActive }), onSuccess: refresh, onError: toastError });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  return (
    <div>
      <PageHeader title="Rule presets" sub="Scoring rules that Staff pick from when they set up a match. Singles or Doubles is chosen per match, not here." actions={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit('new')}>New preset</Button>} />
      <Card>
        <Table><thead><tr><Th /><Th>Name</Th><Th>Rules</Th><Th>Status</Th><Th /></tr></thead>
          <tbody>{q.data!.map((p) => (
            <tr key={p.id} className="hover:bg-surface2">
              <Td className="w-10">{p.isDefault ? <Star className="size-4 fill-accent text-leaf" aria-label="Default" /> : <button className="text-muted hover:text-leaf" title="Make default" disabled={!p.isActive} onClick={() => makeDefault.mutate(p.id)}><Star className="size-4" /></button>}</Td>
              <Td className="font-medium">{p.name}</Td><Td className="max-w-md text-muted">{describeRules(p.rules)}</Td>
              <Td>{p.isActive ? <Badge tone="success">Available</Badge> : <Badge>Hidden</Badge>}{p.used && <Badge className="ml-1">used</Badge>}</Td>
              <Td className="text-right"><span className="inline-flex gap-2"><Button size="sm" onClick={() => setEdit(p)}>Edit</Button>{!p.isDefault && <Button size="sm" onClick={() => toggle.mutate(p)}>{p.isActive ? 'Hide' : 'Show'}</Button>}</span></Td>
            </tr>))}</tbody></Table>
      </Card>
      <p className="mt-3 text-sm text-muted">Editing a preset never changes matches that were already created — each match keeps its own copy of the rules.</p>
      {edit && <Editor p={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onDone={refresh} />}
    </div>
  );
}

function Editor({ p, onClose, onDone }: { p: Preset | null; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(p?.name ?? ''); const [rules, setRules] = useState<MatchRules>(p?.rules ?? DEFAULT_RULES); const [err, setErr] = useState<string | null>(null);
  const issues = validateRules('doubles', rules);
  const save = useMutation({
    mutationFn: () => (p ? patch(`formats/${p.id}`, { name: name.trim(), rules }) : post('formats', { name: name.trim(), rules })),
    onSuccess: () => { toast('Preset saved', 'success'); onDone(); onClose(); }, onError: (e) => setErr(e instanceof ApiError ? e.message : 'Could not save'),
  });
  const remove = useMutation({ mutationFn: () => del(`formats/${p!.id}`), onSuccess: () => { toast('Deleted', 'success'); onDone(); onClose(); }, onError: toastError });
  return (
    <Modal open onClose={onClose} wide title={p ? `Edit “${p.name}”` : 'New rule preset'} footer={<>{p && !p.isDefault && !p.used && <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>Delete</Button>}<span className="flex-1" /><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!name.trim() || issues.length > 0} onClick={() => { setErr(null); save.mutate(); }}>Save</Button></>}>
      <div className="space-y-5">
        <Field label="Name"><Input value={name} maxLength={50} onChange={(e) => setName(e.target.value)} /></Field>
        <RulesEditor playType="doubles" rules={rules} onChange={setRules} />
        <Notice>{describeRules(rules)}</Notice>
        {issues.length > 0 && <Notice tone="danger">{issues.map((i) => i.message).join('. ')}</Notice>}
        {err && <Notice tone="danger">{err}</Notice>}
      </div>
    </Modal>
  );
}
