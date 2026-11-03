import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Settings as S, hhmmToMinutes, type OperatingHours } from '@pickle/shared';
import { Button, Card, CardHeader, Check, ErrorBox, Field, Input, Notice, PageHeader, Select, Spinner, TimeInput12 } from '../../ui';
import { get, patch } from '../../lib/api';
import { toast, toastError } from '../../lib/toast';

type Settings = S;
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export default function SettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => get<Settings>('settings') });
  const info = useQuery({ queryKey: ['system-info'], queryFn: () => get<{ lanUrls: string[]; primaryUrl: string; qrSvg: string; version: string; dataDir: string; dbSizeBytes: number; timeZone: string; node: string; platform: string }>('system/info') });
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => { if (q.data) setS(q.data); }, [q.data]);
  const save = useMutation({ mutationFn: (patchBody: Partial<Settings>) => patch<Settings>('settings', patchBody), onSuccess: (r) => { toast('Saved', 'success'); qc.setQueryData(['settings'], r); void qc.invalidateQueries({ queryKey: ['me'] }); }, onError: toastError });
  if (q.isLoading || !s) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v });
  const num = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value) as never);
  const Section = ({ title, sub, keys, children }: { title: string; sub?: string; keys: (keyof Settings)[]; children: ReactNode }) => {
    const dirty = keys.some((k) => JSON.stringify(s[k]) !== JSON.stringify(q.data![k]));
    return (
      <Card><CardHeader title={title} sub={sub} actions={<Button variant="primary" size="sm" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate(Object.fromEntries(keys.map((k) => [k, s[k]])) as Partial<Settings>)}>Save</Button>} />
        <div className="grid gap-4 p-4 sm:grid-cols-2">{children}</div></Card>
    );
  };
  const hours = s.operatingHours;
  const setDay = (i: number, v: { open: string; close: string } | null) => set('operatingHours', { ...hours, [String(i + 1)]: v } as OperatingHours);
  return (
    <div className="max-w-4xl space-y-4">
      <PageHeader title="Settings" />
      <Section title="Facility" keys={['facilityName']}>
        <Field label="Facility name"><Input value={s.facilityName} maxLength={80} onChange={(e) => set('facilityName', e.target.value)} /></Field>
      </Section>
      <Section title="Operating hours" sub="Used for court utilization and to limit when courts can be booked." keys={['operatingHours']}>
        <div className="sm:col-span-2 space-y-2">{DAYS.map((d, i) => { const h = hours[String(i + 1) as '1']; return (
          <div key={d} className="flex flex-wrap items-center gap-3"><span className="w-28 text-sm font-medium">{d}</span>
            <Check checked={!!h} onChange={(v) => setDay(i, v ? { open: '07:00', close: '22:00' } : null)} label="Open" />
            {h && <><TimeInput12 label={`${d} opens`} value={h.open} onChange={(v) => setDay(i, { ...h, open: v })} /><span className="text-muted">to</span><TimeInput12 label={`${d} closes`} value={h.close} onChange={(v) => setDay(i, { ...h, close: v })} />{hhmmToMinutes(h.close) <= hhmmToMinutes(h.open) && <span className="text-xs text-danger">Closing must be after opening</span>}</>}</div>); })}</div>
      </Section>
      <Section title="Court behaviour" keys={['completedDisplayMinutes', 'autoConfirmSeconds', 'staleMatchMinutes', 'endMatchHoldMs', 'allowRuleOverrides']}>
        <Field label="Show “Completed” for (minutes)" hint="Then the court becomes available again"><Input type="number" min={0} max={120} value={s.completedDisplayMinutes} onChange={num('completedDisplayMinutes')} /></Field>
        <Field label="Auto-confirm results after (seconds)"><Input type="number" min={10} max={3600} value={s.autoConfirmSeconds} onChange={num('autoConfirmSeconds')} /></Field>
        <Field label="Alert when a match is idle for (minutes)"><Input type="number" min={1} max={600} value={s.staleMatchMinutes} onChange={num('staleMatchMinutes')} /></Field>
        <Field label="Hold duration for “End match” (milliseconds)" hint="1000–4000. Default 2000. Longer is safer against accidents."><Input type="number" min={1000} max={4000} step={100} value={s.endMatchHoldMs} onChange={num('endMatchHoldMs')} /></Field>
        <div className="sm:col-span-2"><Check checked={s.allowRuleOverrides} onChange={(v) => set('allowRuleOverrides', v)} label="Staff may customize the rules for a single match" /></div>
      </Section>
      <Section title="Bookings" keys={['bookingSlotMinutes', 'bookingMaxHours', 'bookingAdvanceDays', 'bookingWarnMinutes']}>
        <Field label="Time slot"><Select value={s.bookingSlotMinutes} onChange={(e) => set('bookingSlotMinutes', Number(e.target.value) as 15 | 30 | 60)}><option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={60}>60 minutes</option></Select></Field>
        <Field label="Longest booking (hours)"><Input type="number" min={0.5} max={12} step={0.5} value={s.bookingMaxHours} onChange={num('bookingMaxHours')} /></Field>
        <Field label="Book up to (days ahead)"><Input type="number" min={1} max={730} value={s.bookingAdvanceDays} onChange={num('bookingAdvanceDays')} /></Field>
        <Field label="Warn when a booking starts within (minutes)"><Input type="number" min={0} max={240} value={s.bookingWarnMinutes} onChange={num('bookingWarnMinutes')} /></Field>
      </Section>
      <Section title="Security & sessions" keys={['adminLoginMasterPcOnly', 'sessionIdleMinutes', 'sessionMaxDays', 'terminalSessionDays']}>
        <div className="sm:col-span-2"><Check checked={s.adminLoginMasterPcOnly} onChange={(v) => set('adminLoginMasterPcOnly', v)} label="Admins may only sign in on the Master PC" />
          <p className="ml-6 mt-1 text-xs text-muted">Recommended if you do not want an Admin password typed on court phones/tablets. Staff are not affected.</p></div>
        <Field label="Sign out after inactivity (minutes)"><Input type="number" min={5} value={s.sessionIdleMinutes} onChange={num('sessionIdleMinutes')} /></Field>
        <Field label="Sign out after (days)"><Input type="number" min={1} max={90} value={s.sessionMaxDays} onChange={num('sessionMaxDays')} /></Field>
        <Field label="Court devices stay signed in for (days)" hint="Court phones/tablets have no inactivity timeout."><Input type="number" min={1} max={365} value={s.terminalSessionDays} onChange={num('terminalSessionDays')} /></Field>
      </Section>
      <Card><CardHeader title="Connect a phone or tablet" sub="Open this address in a browser on any device connected to the staff Wi-Fi, sign in, and choose “Use this device for Court N”." />
        <div className="grid gap-4 p-4 sm:grid-cols-[1fr_180px]">
          {info.data ? <><div className="space-y-2 text-sm"><p className="text-xs uppercase text-muted">App address</p><ul className="space-y-1">{(info.data.lanUrls.length ? info.data.lanUrls : [info.data.primaryUrl]).map((u) => <li key={u} className="tnum text-xl font-semibold">{u}</li>)}</ul>
            <p className="text-muted">Version {info.data.version} · {info.data.platform} · Node {info.data.node} · time zone {info.data.timeZone}</p><p className="text-muted">Data folder: {info.data.dataDir} · database {(info.data.dbSizeBytes / 1048576).toFixed(1)} MB</p>
            <Notice tone="warn">Passwords are typed over the facility Wi-Fi without encryption. Keep the staff Wi-Fi private with a strong password and separate from guest Wi-Fi.</Notice></div>
            <div className="w-44 rounded-lg bg-white p-2" dangerouslySetInnerHTML={{ __html: info.data.qrSvg }} aria-label="QR code for the app address" /></> : info.isLoading ? <Spinner /> : <ErrorBox error={info.error} />}
        </div></Card>
    </div>
  );
}
