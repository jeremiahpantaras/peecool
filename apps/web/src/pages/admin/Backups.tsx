import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DatabaseBackup, Download, Trash2, Upload } from 'lucide-react';
import type { Settings } from '@pickle/shared';
import { Badge, Button, Card, CardHeader, ConfirmDialog, Empty, ErrorBox, Field, Input, Notice, PageHeader, Spinner, Table, Td, Th, TimeInput12 } from '../../ui';
import { ApiError, del, downloadUrl, get, patch, post } from '../../lib/api';
import { fmtDateTime } from '../../lib/time';
import { toast, toastError } from '../../lib/toast';

interface B { fileName: string; type: string; createdAt: number; sizeBytes: number; schemaVersion: number | null }
const TYPE: Record<string, string> = { scheduled: 'Daily', manual: 'Manual', pre_migration: 'Before upgrade', pre_restore: 'Before restore' };

export default function Backups() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['backups'], queryFn: () => get<B[]>('backups') });
  const st = useQuery({ queryKey: ['settings'], queryFn: () => get<Settings>('settings') });
  const [restore, setRestore] = useState<{ b?: B; file?: File } | null>(null); const [force, setForce] = useState(false); const [busy, setBusy] = useState(false);
  const [extra, setExtra] = useState<string | null>(null); const [test, setTest] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const now = useMutation({ mutationFn: () => post('backups'), onSuccess: () => { toast('Backup created', 'success'); void qc.invalidateQueries({ queryKey: ['backups'] }); void qc.invalidateQueries({ queryKey: ['dashboard'] }); }, onError: toastError });
  const doRestore = async (f: boolean) => {
    if (!restore) return; setBusy(true);
    try {
      if (restore.b) await post(`backups/${restore.b.fileName}/restore`, { force: f });
      else { const fd = new FormData(); fd.append('force', String(f)); fd.append('file', restore.file!); await post('backups/upload-restore', fd); }
      toast('Restored — reloading', 'success'); setTimeout(() => location.reload(), 800);
    } catch (e) { if (e instanceof ApiError && e.code === 'ACTIVE_MATCHES_EXIST') setForce(true); else toastError(e); setBusy(false); }
  };
  const save = useMutation({ mutationFn: (b: Partial<Settings>) => patch('settings', b), onSuccess: () => { toast('Saved', 'success'); void qc.invalidateQueries({ queryKey: ['settings'] }); }, onError: toastError });
  return (
    <div className="max-w-5xl space-y-4">
      <PageHeader title="Backups" sub="The database is backed up automatically every night. Keep a copy on a USB drive or network folder too."
        actions={<><Button icon={<Upload className="size-4" />} onClick={() => fileRef.current?.click()}>Restore from file…</Button><input ref={fileRef} type="file" accept=".db" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setRestore({ file: f }); e.target.value = ''; }} />
          <Button variant="primary" icon={<DatabaseBackup className="size-4" />} loading={now.isPending} onClick={() => now.mutate()}>Back up now</Button></>} />
      {st.data && (
        <Card><CardHeader title="Backup settings" actions={<Button size="sm" variant="primary" onClick={() => save.mutate({ backupTime: st.data!.backupTime, backupRetention: st.data!.backupRetention, backupExtraPath: extra === null ? st.data!.backupExtraPath : extra || null })}>Save</Button>} />
          <div className="grid gap-4 p-4 sm:grid-cols-3">
            <Field label="Daily backup time"><BackupTime initial={st.data.backupTime} onChange={(v) => (st.data!.backupTime = v)} /></Field>
            <Field label="Keep daily backups"><Input type="number" min={1} max={365} defaultValue={st.data.backupRetention} onChange={(e) => (st.data!.backupRetention = Number(e.target.value))} /></Field>
            <Field label="Extra copy folder" hint="USB drive or network folder, e.g. E:\Backups"><div className="flex gap-2"><Input aria-label="Extra copy folder" defaultValue={st.data.backupExtraPath ?? ''} onChange={(e) => setExtra(e.target.value)} placeholder="Not set" /><Button onClick={async () => { const p = extra ?? st.data!.backupExtraPath; if (!p) return; try { const r = await post<{ ok: boolean; error?: string }>('backups/test-extra-path', { path: p }); setTest(r.ok ? 'Folder is writable ✓' : `Cannot write: ${r.error}`); } catch (e) { toastError(e); } }}>Test</Button></div>{test && <span className="mt-1 block text-xs">{test}</span>}</Field>
          </div></Card>
      )}
      <Card><CardHeader title="Saved backups" />
        {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} retry={() => q.refetch()} /> : !q.data?.length ? <Empty title="No backups yet" /> : (
          <Table><thead><tr><Th>When</Th><Th>Type</Th><Th>Size</Th><Th /></tr></thead>
            <tbody>{q.data.map((b) => (
              <tr key={b.fileName} className="hover:bg-surface2"><Td className="tnum">{fmtDateTime(b.createdAt)}</Td><Td><Badge tone={b.type === 'scheduled' ? 'primary' : 'neutral'}>{TYPE[b.type] ?? b.type}</Badge></Td><Td className="tnum">{(b.sizeBytes / 1048576).toFixed(2)} MB</Td>
                <Td className="text-right"><span className="inline-flex gap-2"><Button size="sm" icon={<Download className="size-3.5" />} onClick={() => downloadUrl(`backups/${b.fileName}/download`)}>Download</Button><Button size="sm" onClick={() => setRestore({ b })}>Restore</Button>
                  <Button size="sm" variant="ghost" aria-label="Delete" onClick={async () => { try { await del(`backups/${b.fileName}`); void qc.invalidateQueries({ queryKey: ['backups'] }); } catch (e) { toastError(e); } }}><Trash2 className="size-4" /></Button></span></Td></tr>))}</tbody></Table>
        )}
      </Card>
      <ConfirmDialog open={!!restore && !force} onClose={() => setRestore(null)} title="Restore this backup?" confirmLabel="Restore" danger loading={busy} onConfirm={() => doRestore(false)}>
        <p>Everything entered after {restore?.b ? fmtDateTime(restore.b.createdAt) : 'this file was made'} will be replaced — matches, bookings and users. A safety backup of the current data is made first. All devices will reload.</p>
      </ConfirmDialog>
      <ConfirmDialog open={force} onClose={() => { setForce(false); setRestore(null); }} title="Matches are in progress" confirmLabel="Restore anyway" danger loading={busy} onConfirm={() => doRestore(true)}>
        <Notice tone="warn">There are matches being played right now. Restoring will replace them with the backup's data. Only continue if you are sure.</Notice>
      </ConfirmDialog>
    </div>
  );
}

/** The picker is controlled; the page keeps the value on the query object, so hold the displayed value here. */
function BackupTime({ initial, onChange }: { initial: string; onChange: (v: string) => void }) {
  const [v, setV] = useState(initial);
  return <TimeInput12 label="Daily backup time" value={v} onChange={(x) => { setV(x); onChange(x); }} />;
}
