import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Field, Input, Notice } from '../ui';
import { ApiError, get, post } from '../lib/api';

export default function Login() {
  const qc = useQueryClient();
  const setup = useQuery({ queryKey: ['setup'], queryFn: () => get<{ needsSetup: boolean; isLocalRequest: boolean }>('setup/status'), retry: 1 });
  const [u, setU] = useState(''); const [p, setP] = useState('');
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await post('auth/login', { username: u.trim(), password: p }); await qc.invalidateQueries({ queryKey: ['me'] }); }
    catch (x) { setErr(x instanceof ApiError ? (x.code === 'ACCOUNT_LOCKED' ? `Too many attempts. Try again in ${Math.ceil((x.details?.retryAfterSeconds ?? 900) / 60)} min.` : x.message) : 'Could not sign in'); }
    finally { setBusy(false); }
  };
  if (setup.data?.needsSetup) return <FirstRun local={setup.data.isLocalRequest} />;
  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-6"><img src="/brand/logo-primary.svg" alt="Peecool" className="h-11 w-auto" /><h1 className="font-display mt-5 text-3xl">Sign in</h1><p className="mt-1 text-sm text-muted">Every court. Every point.</p></div>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Username"><Input autoFocus autoComplete="username" autoCapitalize="none" autoCorrect="off" value={u} onChange={(e) => setU(e.target.value)} className="h-12 text-base" /></Field>
          <Field label="Password"><Input type="password" autoComplete="current-password" value={p} onChange={(e) => setP(e.target.value)} className="h-12 text-base" /></Field>
          {err && <Notice tone="danger">{err}</Notice>}
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={!u || !p}>Sign in</Button>
        </form>
      </Card>
    </div>
  );
}

function FirstRun({ local }: { local: boolean }) {
  const qc = useQueryClient();
  const [step, setStep] = useState(1);
  const [f, setF] = useState({ username: '', displayName: '', password: '', password2: '', facilityName: 'Pickleball Facility', courtCount: 4 });
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  if (!local) return (
    <div className="flex min-h-full items-center justify-center p-4"><Card className="max-w-md p-6"><h1 className="text-xl font-semibold">Complete setup on the Master PC</h1><p className="mt-2 text-sm text-muted">This system has not been set up yet. For security the first Admin account can only be created on the computer that runs the service. Open this address on that computer.</p></Card></div>
  );
  const set = (k: keyof typeof f, v: string | number) => setF((s) => ({ ...s, [k]: v }));
  const finish = async () => {
    setBusy(true); setErr(null);
    try { await post('setup', { username: f.username.trim(), displayName: f.displayName.trim(), password: f.password, facilityName: f.facilityName.trim() || undefined, courtCount: f.courtCount }); setDone(true); }
    catch (x) { setErr(x instanceof ApiError ? x.message : 'Setup failed'); } finally { setBusy(false); }
  };
  if (done) return (
    <div className="flex min-h-full items-center justify-center p-4"><Card className="max-w-md p-6 text-center"><h1 className="text-xl font-semibold">You're all set</h1><p className="mt-2 text-sm text-muted">Create Staff accounts under Administration → Users, then open this address on each court's phone or tablet and sign in.</p><Button className="mt-4" variant="primary" onClick={() => void qc.invalidateQueries()}>Open the dashboard</Button></Card></div>
  );
  const valid1 = f.username.trim().length >= 3 && f.displayName.trim() && f.password.length >= 8 && f.password === f.password2;
  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <Card className="w-full max-w-md p-6">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">First-run setup · step {step} of 2</p>
        {step === 1 ? (
          <div className="mt-2 space-y-4">
            <h1 className="text-xl font-semibold">Create the Admin account</h1>
            <Field label="Username" hint="Letters, digits, dot, dash"><Input value={f.username} onChange={(e) => set('username', e.target.value)} autoCapitalize="none" /></Field>
            <Field label="Your name"><Input value={f.displayName} onChange={(e) => set('displayName', e.target.value)} /></Field>
            <Field label="Password" hint="At least 8 characters"><Input type="password" value={f.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" /></Field>
            <Field label="Repeat password" error={f.password2 && f.password !== f.password2 ? "Passwords don't match" : null}><Input type="password" value={f.password2} onChange={(e) => set('password2', e.target.value)} autoComplete="new-password" /></Field>
            <Button variant="primary" className="w-full" disabled={!valid1} onClick={() => setStep(2)}>Next</Button>
          </div>
        ) : (
          <div className="mt-2 space-y-4">
            <h1 className="text-xl font-semibold">Your facility</h1>
            <Field label="Facility name"><Input value={f.facilityName} onChange={(e) => set('facilityName', e.target.value)} /></Field>
            <Field label="Number of courts" hint="0 to 24. You can change this any time under Court Management."><Input type="number" min={0} max={24} value={f.courtCount} onChange={(e) => set('courtCount', Math.max(0, Math.min(24, Number(e.target.value) || 0)))} /></Field>
            {err && <Notice tone="danger">{err}</Notice>}
            <div className="flex gap-2"><Button onClick={() => setStep(1)}>Back</Button><Button variant="primary" className="flex-1" loading={busy} onClick={() => void finish()}>Create and sign in</Button></div>
          </div>
        )}
      </Card>
    </div>
  );
}
