import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CourtSnapshot, MeDto } from '@pickle/shared';
import { Button, Card, ErrorBox, Modal, Spinner } from '../ui';
import { ApiError, del, get, put } from '../lib/api';
import { getHint, setHint } from '../lib/terminalHint';
import { toast, toastError } from '../lib/toast';

/** FR-TERM-02: "Use this device for Court N". Shown once per session on a device with no assignment. */
export const ASSIGN_DONE_KEY = 'ps_assign_done';

export function useAssignCourt() {
  const qc = useQueryClient();
  const [conflict, setConflict] = useState<{ courtId: number; courtName: string; user: string } | null>(null);
  const assign = async (courtId: number, courtName: string, replace = false): Promise<boolean> => {
    try {
      const r = await put<{ terminal: { courtId: number; courtName: string } }>('session/terminal', { courtId, replaceExisting: replace });
      setHint(r.terminal); setConflict(null); toast(`This device is now ${r.terminal.courtName}`, 'success');
      await qc.invalidateQueries({ queryKey: ['me'] });
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'COURT_HAS_DEVICE') { setConflict({ courtId, courtName, user: e.details?.signedInUser ?? 'someone' }); return false; }
      toastError(e); return false;
    }
  };
  const unassign = async () => { try { await del('session/terminal'); setHint(null); await qc.invalidateQueries({ queryKey: ['me'] }); toast('This device no longer belongs to a court'); } catch (e) { toastError(e); } };
  const dialog = conflict && (
    <Modal open onClose={() => setConflict(null)} title={`Replace the current ${conflict.courtName} device?`} footer={<><Button onClick={() => setConflict(null)}>Cancel</Button><Button variant="primary" onClick={() => void assign(conflict.courtId, conflict.courtName, true)}>Replace</Button></>}>
      <p className="text-sm">{conflict.courtName} already has a device (signed in as {conflict.user}). If you continue, that device goes back to the normal home page. The match on the court is not affected.</p>
    </Modal>
  );
  return { assign, unassign, dialog };
}

export function CourtPicker({ onPicked, onSkip }: { onPicked: () => void; onSkip: () => void }) {
  const courts = useQuery({ queryKey: ['courts', 'picker'], queryFn: () => get<CourtSnapshot[]>('courts') });
  const { assign, dialog } = useAssignCourt();
  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <Card className="w-full max-w-3xl p-6">
        <h1 className="text-2xl font-semibold">Which court is this device for?</h1>
        <p className="mb-5 mt-1 text-sm text-muted">Choose the court this phone or tablet stays at. It will be called by that name and open straight to that court.</p>
        {courts.isLoading ? <Spinner /> : courts.error ? <ErrorBox error={courts.error} retry={() => courts.refetch()} /> : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {courts.data!.map((c) => (
              <button key={c.court.id} onClick={async () => { if (await assign(c.court.id, c.court.name)) onPicked(); }}
                className="min-h-20 rounded-xl border border-line bg-surface2 p-3 text-left text-lg font-semibold hover:border-primary">
                {c.court.name}{c.court.device && <span className="mt-1 block text-xs font-normal text-muted">has a device ({c.court.device.signedInUser})</span>}
              </button>
            ))}
          </div>
        )}
        <div className="mt-6"><Button onClick={onSkip}>Skip – use as a normal computer</Button></div>
      </Card>
      {dialog}
    </div>
  );
}

/** Wraps the app after sign-in: offers "Continue as Court N" or the court picker, once per session. */
export function AssignGate({ me, children }: { me: MeDto; children: React.ReactNode }) {
  const [done, setDone] = useState(() => { try { return sessionStorage.getItem(ASSIGN_DONE_KEY) === '1'; } catch { return false; } });
  const [picking, setPicking] = useState(false);
  const { assign, dialog } = useAssignCourt();
  const finish = () => { try { sessionStorage.setItem(ASSIGN_DONE_KEY, '1'); } catch { /* ignore */ } setDone(true); };
  if (me.terminal) { try { setHint(me.terminal); } catch { /* ignore */ } return <>{children}</>; }
  if (done || !me.permissions.includes('courts.terminal')) return <>{children}</>;
  const hint = getHint();
  if (hint && !picking) return (
    <div className="flex min-h-full items-center justify-center p-4">
      <Card className="w-full max-w-sm p-6 text-center">
        <p className="text-sm text-muted">Welcome back, {me.user.displayName}</p>
        <h1 className="mt-1 text-2xl font-semibold">Continue as {hint.courtName}?</h1>
        <p className="mt-1 text-sm text-muted">This device was last used at {hint.courtName}.</p>
        <div className="mt-5 space-y-2">
          <Button variant="primary" size="xl" className="w-full" onClick={async () => { if (await assign(hint.courtId, hint.courtName)) finish(); }}>Continue as {hint.courtName}</Button>
          <Button size="lg" className="w-full" onClick={() => setPicking(true)}>Choose another court</Button>
          <Button variant="ghost" className="w-full" onClick={() => { setHint(null); finish(); }}>This is not a court device</Button>
        </div>
      </Card>
      {dialog}
    </div>
  );
  return <CourtPicker onPicked={finish} onSkip={() => { finish(); }} />;
}
