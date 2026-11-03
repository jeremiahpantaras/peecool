import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Card, Field, Input, Notice } from '../ui';
import { ApiError, post } from '../lib/api';
import { toast } from '../lib/toast';
import { useLogout } from '../lib/auth';

export function PasswordForm({ forced, onDone }: { forced?: boolean; onDone?: () => void }) {
  const qc = useQueryClient();
  const [cur, setCur] = useState(''); const [n1, setN1] = useState(''); const [n2, setN2] = useState('');
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await post('auth/change-password', { currentPassword: cur, newPassword: n1 }); toast('Password changed', 'success'); setCur(''); setN1(''); setN2(''); await qc.invalidateQueries({ queryKey: ['me'] }); onDone?.(); }
    catch (x) { setErr(x instanceof ApiError ? x.message : 'Could not change the password'); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label={forced ? 'Temporary password' : 'Current password'}><Input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
      <Field label="New password" hint="At least 8 characters"><Input type="password" autoComplete="new-password" value={n1} onChange={(e) => setN1(e.target.value)} /></Field>
      <Field label="Repeat new password" error={n2 && n1 !== n2 ? "Passwords don't match" : null}><Input type="password" autoComplete="new-password" value={n2} onChange={(e) => setN2(e.target.value)} /></Field>
      {err && <Notice tone="danger">{err}</Notice>}
      <Button type="submit" variant="primary" loading={busy} disabled={!cur || n1.length < 8 || n1 !== n2}>Change password</Button>
    </form>
  );
}

export default function ForcedChangePassword() {
  const logout = useLogout();
  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <Card className="w-full max-w-sm p-6">
        <h1 className="text-xl font-semibold">Choose a new password</h1>
        <p className="mb-4 mt-1 text-sm text-muted">Your administrator gave you a temporary password. Please choose your own before continuing.</p>
        <PasswordForm forced />
        <button className="mt-4 text-sm text-muted underline" onClick={() => void logout()}>Sign out</button>
      </Card>
    </div>
  );
}
