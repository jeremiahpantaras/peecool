import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus, Wand2 } from 'lucide-react';
import type { Paged, UserDto } from '@pickle/shared';
import { Badge, Button, Card, Check, Empty, ErrorBox, Field, Input, Modal, Notice, PageHeader, Pagination, RoleBadge, Select, Spinner, Table, Td, Th } from '../../ui';
import { ApiError, get, patch, post, qs } from '../../lib/api';
import { useMe } from '../../lib/auth';
import { fmtDateTime } from '../../lib/time';
import { randomId } from '../../lib/ids';
import { toast, toastError } from '../../lib/toast';

type Page = Paged<UserDto> & { activeStaff: number; activeAdmins: number };
const genPassword = () => { const a = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'; const b = new Uint8Array(10); crypto.getRandomValues(b); return Array.from(b, (x) => a[x % a.length]).join(''); };

export default function Users() {
  const me = useMe().data!;
  const [q, setQ] = useState(''); const [role, setRole] = useState(''); const [active, setActive] = useState(''); const [page, setPage] = useState(1);
  const [add, setAdd] = useState(false); const [edit, setEdit] = useState<UserDto | null>(null); const [reset, setReset] = useState<UserDto | null>(null);
  const params = { q, role, active, page, pageSize: 25 };
  const r = useQuery({ queryKey: ['users', params], queryFn: () => get<Page>(`users${qs(params)}`), placeholderData: (p) => p });
  return (
    <div>
      <PageHeader title="Users" sub={r.data ? `Staff accounts: ${r.data.activeStaff} active (no limit) · Admins: ${r.data.activeAdmins}` : undefined} actions={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdd(true)}>Add user</Button>} />
      <Notice className="mb-4"><b>What can Staff do?</b> Staff can see everything and run courts: scoring, the players on a match, game details and court status. They cannot change bookings, courts' setup, the player directory, presets, users, settings, backups or finished results, and cannot export data. Give each person their own account so every action is recorded under their name.</Notice>
      <Card className="mb-4 p-3"><div className="flex flex-wrap items-end gap-3">
        <Field label="Search"><Input placeholder="Name or username" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="w-60" /></Field>
        <Field label="Role"><Select value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }}><option value="">All</option><option value="staff">Staff</option><option value="admin">Admin</option></Select></Field>
        <Field label="Status"><Select value={active} onChange={(e) => { setActive(e.target.value); setPage(1); }}><option value="">All</option><option value="true">Active</option><option value="false">Deactivated</option></Select></Field>
      </div></Card>
      <Card>
        {r.isLoading ? <Spinner /> : r.error ? <ErrorBox error={r.error} retry={() => r.refetch()} /> : !r.data?.items.length ? <Empty title="No users match" /> : (
          <>
            <Table><thead><tr><Th>Name</Th><Th>Username</Th><Th>Role</Th><Th>Status</Th><Th>Last sign-in</Th><Th /></tr></thead>
              <tbody>{r.data.items.map((u) => (
                <tr key={u.id} className="hover:bg-surface2"><Td className="font-medium">{u.displayName}{u.id === me.user.id && <span className="ml-1 text-xs text-muted">(you)</span>}</Td><Td>{u.username}</Td><Td><RoleBadge role={u.role} /></Td>
                  <Td>{u.isActive ? <Badge tone="success">Active</Badge> : <Badge>Deactivated</Badge>}{u.mustChangePassword && <Badge tone="warn" className="ml-1">must change password</Badge>}</Td>
                  <Td>{u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : <span className="text-muted">Never</span>}</Td>
                  <Td className="text-right"><span className="inline-flex gap-2"><Button size="sm" onClick={() => setEdit(u)}>Edit</Button><Button size="sm" icon={<KeyRound className="size-3.5" />} onClick={() => setReset(u)}>Reset password</Button></span></Td></tr>))}</tbody></Table>
            <Pagination page={r.data.page} pageSize={r.data.pageSize} total={r.data.total} onPage={setPage} />
          </>
        )}
      </Card>
      {add && <AddUser onClose={() => setAdd(false)} />}
      {edit && <EditUser u={edit} self={edit.id === me.user.id} onClose={() => setEdit(null)} />}
      {reset && <ResetPw u={reset} onClose={() => setReset(null)} />}
    </div>
  );
}

function AddUser({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const blank = () => ({ username: '', displayName: '', password: genPassword(), role: 'staff' as 'staff' | 'admin', must: true });
  const [f, setF] = useState(blank()); const [made, setMade] = useState<{ username: string; password: string }[]>([]); const [err, setErr] = useState<string | null>(null);
  const m = useMutation({ mutationFn: (again: boolean) => post('users', { username: f.username.trim(), displayName: f.displayName.trim(), password: f.password, role: f.role, mustChangePassword: f.must }).then(() => again),
    onSuccess: (again) => { setMade((l) => [...l, { username: f.username.trim(), password: f.password }]); void qc.invalidateQueries({ queryKey: ['users'] }); toast(`Created ${f.displayName}`, 'success'); if (again) { setF({ ...blank(), role: f.role }); setErr(null); } else onClose(); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Could not create the user') });
  const ok = f.username.trim().length >= 3 && f.displayName.trim() && f.password.length >= 8;
  return (
    <Modal open onClose={onClose} title="Add user" footer={<><Button onClick={onClose}>{made.length ? 'Done' : 'Cancel'}</Button><Button disabled={!ok} loading={m.isPending} onClick={() => m.mutate(true)}>Create and add another</Button><Button variant="primary" disabled={!ok} loading={m.isPending} onClick={() => m.mutate(false)}>Create</Button></>}>
      <div className="space-y-4">
        {made.length > 0 && <Notice tone="info"><b>Created so far</b> (write the temporary passwords down — they are not shown again):<ul className="mt-1">{made.map((x) => <li key={x.username} className="tnum">{x.username} · {x.password}</li>)}</ul></Notice>}
        <Field label="Username" hint="Letters, digits, dot, dash"><Input value={f.username} autoCapitalize="none" onChange={(e) => setF({ ...f, username: e.target.value })} /></Field>
        <Field label="Display name"><Input value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} /></Field>
        <Field label="Temporary password"><div className="flex gap-2"><Input aria-label="Temporary password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} className="tnum" /><Button icon={<Wand2 className="size-4" />} onClick={() => setF({ ...f, password: genPassword() })}>Generate</Button></div></Field>
        <Field label="Role"><Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as 'staff' | 'admin' })}><option value="staff">Staff</option><option value="admin">Admin</option></Select></Field>
        <Check checked={f.must} onChange={(v) => setF({ ...f, must: v })} label="Must change password at first sign-in" />
        {err && <Notice tone="danger">{err}</Notice>}
      </div>
    </Modal>
  );
}

function EditUser({ u, self, onClose }: { u: UserDto; self: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(u.displayName); const [role, setRole] = useState(u.role); const [active, setActive] = useState(u.isActive); const [err, setErr] = useState<string | null>(null);
  const m = useMutation({ mutationFn: () => patch(`users/${u.id}`, { displayName: name.trim(), role, isActive: active }), onSuccess: () => { toast('Saved', 'success'); void qc.invalidateQueries({ queryKey: ['users'] }); onClose(); }, onError: (e) => setErr(e instanceof ApiError ? e.message : 'Could not save') });
  return (
    <Modal open onClose={onClose} title={`Edit ${u.displayName}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>Save</Button></>}>
      <div className="space-y-4">
        <Field label="Display name"><Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Role" hint={self ? 'You cannot demote yourself if you are the last active Admin.' : 'Changing the role signs the user out immediately.'}><Select value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'staff')}><option value="staff">Staff</option><option value="admin">Admin</option></Select></Field>
        <Check checked={active} onChange={setActive} label="Active (can sign in)" />
        {err && <Notice tone="danger">{err}</Notice>}
      </div>
    </Modal>
  );
}

function ResetPw({ u, onClose }: { u: UserDto; onClose: () => void }) {
  const [pw, setPw] = useState(genPassword()); const [done, setDone] = useState(false);
  const m = useMutation({ mutationFn: () => post(`users/${u.id}/reset-password`, { newPassword: pw }), onSuccess: () => setDone(true), onError: toastError });
  return (
    <Modal open onClose={onClose} title={`Reset password for ${u.displayName}`} footer={done ? <Button variant="primary" onClick={onClose}>Done</Button> : <><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} disabled={pw.length < 8} onClick={() => m.mutate()}>Reset password</Button></>}>
      {done ? <Notice tone="info">Password reset. Tell {u.displayName} the temporary password <b className="tnum">{pw}</b> — they must choose a new one when they sign in, and they have been signed out everywhere.</Notice>
        : <Field label="New temporary password"><div className="flex gap-2"><Input aria-label="New temporary password" value={pw} onChange={(e) => setPw(e.target.value)} className="tnum" /><Button onClick={() => setPw(genPassword())}>Generate</Button></div></Field>}
    </Modal>
  );
}
void randomId;
