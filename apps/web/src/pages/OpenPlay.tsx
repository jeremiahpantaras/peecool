import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, Shuffle } from 'lucide-react';
import { previewSession, type CourtSnapshot, type OpenPlaySessionSummary, type PlayType } from '@pickle/shared';
import { Badge, Button, Card, Check, Empty, ErrorBox, Field, Input, Notice, PageHeader, Segmented, Select, Spinner, ViewOnlyTag } from '../ui';
import { ApiError, get, post } from '../lib/api';
import { useIsAdmin } from '../lib/auth';
import { fmtDateTime } from '../lib/time';
import { toastError } from '../lib/toast';
import { STATUS_BADGE } from './openplay/parts';
import { PlayerEntry, draftComplete, draftsToApi, emptyDraft, type PlayerDraft } from './openplay/PlayerEntry';

export default function OpenPlayPage() {
  const admin = useIsAdmin();
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ['openplay', 'list'], queryFn: () => get<OpenPlaySessionSummary[]>('open-play'), refetchInterval: 15_000 });
  return (
    <div>
      <PageHeader title="Open Play" sub="Timed sessions: players are matched automatically, and after each round winners play winners and losers play losers."
        actions={admin ? <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>New session</Button> : <ViewOnlyTag />} />
      {creating && <CreateSession onClose={() => setCreating(false)} />}
      <Card>
        {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} retry={() => q.refetch()} /> : !q.data?.length ? <Empty icon={<Shuffle className="size-8" />} title="No Open Play sessions yet">{admin ? 'Create one, add the players, and press Start.' : 'The Admin creates sessions.'}</Empty> : (
          <ul className="divide-y divide-line">{q.data.map((s) => (
            <li key={s.id}><Link to={`/open-play/${s.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-surface2">
              <span className="min-w-48 flex-1 font-semibold">{s.name}</span>
              <Badge tone={STATUS_BADGE[s.status].tone}>{STATUS_BADGE[s.status].label}</Badge>
              <span className="text-sm capitalize text-muted">{s.playType}</span>
              <span className="text-sm text-muted">{s.playerCount} players · {s.courtNames.length} court{s.courtNames.length === 1 ? '' : 's'} · {s.roundCount} round{s.roundCount === 1 ? '' : 's'}</span>
              <span className="text-sm text-muted">{s.startedAt ? fmtDateTime(s.startedAt) : 'Not started'}</span>
            </Link></li>))}</ul>
        )}
      </Card>
    </div>
  );
}

/** A length of time entered in hours or minutes; the value itself is always whole minutes. */
export function DurationInput({ minutes, onChange, label }: { minutes: number; onChange: (m: number) => void; label: string }) {
  const [unit, setUnit] = useState<'hours' | 'minutes'>(minutes >= 60 && minutes % 60 === 0 ? 'hours' : 'minutes');
  const [text, setText] = useState(String(unit === 'hours' ? minutes / 60 : minutes));
  const commit = (t: string, u: 'hours' | 'minutes') => { const n = Number(t); if (t.trim() !== '' && Number.isFinite(n)) onChange(Math.round(u === 'hours' ? n * 60 : n)); };
  return (
    <div className="flex gap-2">
      <Input aria-label={label} type="number" inputMode="decimal" min={u0(unit, 10)} max={unit === 'hours' ? 12 : 720} step={unit === 'hours' ? 0.25 : 5} value={text} onChange={(e) => { setText(e.target.value); commit(e.target.value, unit); }} className="min-w-0 flex-1" />
      <Select aria-label={`${label} unit`} className="!w-32" value={unit} onChange={(e) => { const u = e.target.value as 'hours' | 'minutes'; setUnit(u); const t = String(u === 'hours' ? Math.round((minutes / 60) * 100) / 100 : minutes); setText(t); }}>
        <option value="minutes">Minutes</option><option value="hours">Hours</option>
      </Select>
    </div>
  );
}
const u0 = (unit: 'hours' | 'minutes', mins: number) => (unit === 'hours' ? Math.round((mins / 60) * 100) / 100 : mins);

export interface FormValue { name: string; playType: PlayType; courtIds: number[]; sessionMinutes: number; gameMinutes: number; changeoverMinutes: number; formatId?: number }

/** Session settings with the live preview from the plan (rounds, who waits, games per player). */
export function SessionForm({ value, onChange, playerCount }: { value: FormValue; onChange: (v: FormValue) => void; playerCount: number }) {
  const courts = useQuery({ queryKey: ['courts', 'openplay'], queryFn: () => get<CourtSnapshot[]>('courts') });
  const presets = useQuery({ queryKey: ['formats'], queryFn: () => get<{ id: number; name: string; isDefault: boolean }[]>('formats') });
  const set = <K extends keyof FormValue>(k: K, v: FormValue[K]) => onChange({ ...value, [k]: v });
  const p = useMemo(() => previewSession({ playType: value.playType, courts: value.courtIds.length, players: playerCount, sessionMinutes: value.sessionMinutes, gameMinutes: value.gameMinutes, changeoverMinutes: value.changeoverMinutes }), [value, playerCount]);
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Session name"><Input value={value.name} maxLength={60} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Type"><Segmented label="Match type" value={value.playType} onChange={(v) => set('playType', v)} options={[{ value: 'doubles', label: 'Doubles' }, { value: 'singles', label: 'Singles' }]} /></Field>
        <Field label="Session length" hint="Choose hours or minutes (10 minutes to 12 hours)"><DurationInput label="Session length" minutes={value.sessionMinutes} onChange={(m) => set('sessionMinutes', m)} /></Field>
        <Field label="Time limit per game (minutes)" hint="Each court's clock starts when staff tap Start on that court"><Input type="number" min={3} max={120} value={value.gameMinutes} onChange={(e) => set('gameMinutes', Number(e.target.value))} /></Field>
        <Field label="Changeover between rounds (minutes)" hint="Only used for the estimate below"><Input type="number" min={0} max={30} value={value.changeoverMinutes} onChange={(e) => set('changeoverMinutes', Number(e.target.value))} /></Field>
        <Field label="Scoring rules" hint="Open Play is always one game per round"><Select value={value.formatId ?? ''} onChange={(e) => set('formatId', e.target.value ? Number(e.target.value) : undefined)}><option value="">Default preset</option>{presets.data?.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select></Field>
      </div>
      <div><p className="mb-2 text-sm font-medium">Courts to use</p>
        {courts.isLoading ? <Spinner /> : <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{courts.data?.map((c) => (
          <Check key={c.court.id} checked={value.courtIds.includes(c.court.id)} label={c.court.name + (['inactive', 'maintenance', 'in_progress', 'paused', 'occupied'].includes(c.court.status) ? ` (${c.court.status.replace('_', ' ')})` : '')} onChange={(on) => set('courtIds', on ? [...value.courtIds, c.court.id] : value.courtIds.filter((x) => x !== c.court.id))} />))}</div>}
      </div>
      <Card className="bg-surface2/50 p-4">
        <p className="mb-2 text-sm font-semibold">What to expect with {playerCount} player{playerCount === 1 ? '' : 's'} on {value.courtIds.length} court{value.courtIds.length === 1 ? '' : 's'}</p>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div><dt className="text-muted">Playing each round</dt><dd className="tnum text-xl font-bold">{p.playingPerRound}</dd></div>
          <div><dt className="text-muted">Waiting each round</dt><dd className="tnum text-xl font-bold">{p.waitingPerRound}</dd></div>
          <div><dt className="text-muted">Rounds that fit</dt><dd className="tnum text-xl font-bold">about {p.rounds}</dd></div>
          <div><dt className="text-muted">Games per player</dt><dd className="tnum text-xl font-bold">{p.gamesPerPlayerMin === p.gamesPerPlayerMax ? p.gamesPerPlayerMin : `${p.gamesPerPlayerMin}–${p.gamesPerPlayerMax}`}</dd></div>
        </dl>
        {p.warnings.map((w) => <Notice key={w} tone="warn" className="mt-3">{w}</Notice>)}
      </Card>
    </div>
  );
}

function CreateSession({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const [v, setV] = useState<FormValue>({ name: `Open play ${new Intl.DateTimeFormat([], { weekday: 'long' }).format(new Date())}`, playType: 'doubles', courtIds: [], sessionMinutes: 120, gameMinutes: 15, changeoverMinutes: 3 });
  const [rows, setRows] = useState<PlayerDraft[]>([emptyDraft(), emptyDraft(), emptyDraft(), emptyDraft()]);
  const filled = useMemo(() => draftsToApi(rows), [rows]);
  const incomplete = rows.some((d) => (d.firstName || d.lastName || d.team) && !draftComplete(d));
  const courts = useQuery({ queryKey: ['courts', 'openplay'], queryFn: () => get<CourtSnapshot[]>('courts') });
  const [err, setErr] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => post<{ id: number }>('open-play', { ...v, players: filled }),
    onSuccess: (r) => nav(`/open-play/${r.id}`), onError: (e) => { setErr(e instanceof ApiError ? e.message : 'Could not create the session'); toastError(e); },
  });
  return (
    <Card className="mb-4">
      <div className="border-b border-line px-4 py-3"><h2 className="text-lg font-semibold">New Open Play session</h2></div>
      <div className="space-y-5 p-4">
        <SessionForm value={v} onChange={setV} playerCount={filled.length} />
        <div><p className="mb-1 text-sm font-medium">Players ({filled.length})</p><p className="mb-2 text-xs text-muted">First name and last name for everyone; team is optional. Import a list, or type them in. You can add, rest or remove players later.</p><PlayerEntry rows={rows} onChange={setRows} /></div>
        {err && <Notice tone="danger">{err}</Notice>}
        <div className="flex gap-2"><Button variant="primary" loading={create.isPending} disabled={!v.name.trim() || v.courtIds.length === 0 || incomplete} onClick={() => { setErr(null); create.mutate(); }}>Create session</Button><Button onClick={onClose}>Cancel</Button>
          {courts.data && v.courtIds.length === 0 && <span className="self-center text-sm text-muted">Choose at least one court.</span>}{incomplete && <span className="self-center text-sm text-danger">Every player needs a first and last name.</span>}</div>
      </div>
    </Card>
  );
}
