import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Minus, Plus, User, Users } from 'lucide-react';
import {
  applyOverrides, defaultPlayerLabel, describeRules, validateRules,
  type CourtSnapshot, type MatchRules, type MatchSnapshot, type PlayType, type Slot, type SlotPlayerInput, type Team, type BookingDto,
} from '@pickle/shared';
import { Button, Check, Field, Input, Modal, Notice, Segmented, Select, cx } from '../ui';
import { ApiError, get, post } from '../lib/api';
import { applySnapshot } from '../lib/realtime';
import { sendCommand } from '../lib/commands';
import { fmtTime } from '../lib/time';
import { toastError } from '../lib/toast';
import { useMe } from '../lib/auth';

/* ---------------------------------------------------------------- names */
export interface NameDraft {
  teamAName: string; teamBName: string;
  slots: Record<'A1' | 'A2' | 'B1' | 'B2', { text: string; playerId: number | null }>;
}
export const emptyDraft = (): NameDraft => ({ teamAName: '', teamBName: '', slots: { A1: { text: '', playerId: null }, A2: { text: '', playerId: null }, B1: { text: '', playerId: null }, B2: { text: '', playerId: null } } });
export function draftFromMatch(m: MatchSnapshot): NameDraft {
  const d = emptyDraft();
  d.teamAName = m.teams.A.name === 'Team A' ? '' : m.teams.A.name; d.teamBName = m.teams.B.name === 'Team B' ? '' : m.teams.B.name;
  for (const t of ['A', 'B'] as Team[]) for (const p of m.teams[t].players) d.slots[`${t}${p.slot}` as 'A1'] = { text: p.isDefaultLabel ? '' : p.displayName, playerId: p.playerId };
  return d;
}
export function draftToSlots(d: NameDraft, playType: PlayType): SlotPlayerInput[] {
  const out: SlotPlayerInput[] = [];
  for (const t of ['A', 'B'] as Team[]) for (const s of (playType === 'singles' ? [1] : [1, 2]) as Slot[]) {
    const v = d.slots[`${t}${s}` as 'A1'];
    out.push({ team: t, slot: s, playerId: v.playerId, displayName: v.text.trim() || null });
  }
  return out;
}
export const draftIsEmpty = (d: NameDraft): boolean => !d.teamAName.trim() && !d.teamBName.trim() && Object.values(d.slots).every((s) => !s.text.trim());

function NameInput({ value, placeholder, onChange }: { value: { text: string; playerId: number | null }; placeholder: string; onChange: (v: { text: string; playerId: number | null }) => void }) {
  const [focus, setFocus] = useState(false);
  const [q, setQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setQ(value.text.trim()), 180); return () => clearTimeout(t); }, [value.text]);
  const res = useQuery({ queryKey: ['players', 'search', q], queryFn: () => get<{ id: number; displayName: string }[]>(`players/search?q=${encodeURIComponent(q)}`), enabled: focus && q.length >= 2 && value.playerId == null, staleTime: 30_000 });
  return (
    <div className="relative">
      <div className="relative">
        <Input value={value.text} placeholder={placeholder} maxLength={30} autoComplete="off" className="h-12 pr-10 text-base"
          onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)}
          onChange={(e) => onChange({ text: e.target.value, playerId: null })} />
        {value.playerId != null && <span title="Linked to a registered player" className="absolute right-3 top-1/2 -translate-y-1/2 text-primary"><User className="size-4" /></span>}
      </div>
      {focus && res.data && res.data.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-line bg-surface shadow-xl" role="listbox">
          {res.data.map((p) => (
            <li key={p.id}><button type="button" role="option" aria-selected={false} className="flex min-h-14 w-full items-center gap-2 px-3 text-left text-base hover:bg-surface2" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange({ text: p.displayName, playerId: p.id }); setFocus(false); }}><User className="size-4 text-primary" />{p.displayName}</button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function NamesFields({ playType, draft, onChange }: { playType: PlayType; draft: NameDraft; onChange: (d: NameDraft) => void }) {
  const per = playType === 'singles' ? 1 : 2;
  return (
    <div className="grid gap-5 md:grid-cols-2">
      {(['A', 'B'] as Team[]).map((t) => (
        <div key={t} className={cx('rounded-xl border-l-8 bg-surface2/50 p-4', t === 'A' ? 'border-teamA' : 'border-teamB')}>
          <Field label="Team name (optional)"><Input value={t === 'A' ? draft.teamAName : draft.teamBName} placeholder={`Team ${t}`} maxLength={30} className="h-11"
            onChange={(e) => onChange({ ...draft, [t === 'A' ? 'teamAName' : 'teamBName']: e.target.value })} /></Field>
          <div className="mt-3 space-y-3">
            {Array.from({ length: per }, (_, i) => i + 1).map((s) => (
              <Field key={s} label={playType === 'singles' ? 'Player' : `Player ${s}`}>
                <NameInput value={draft.slots[`${t}${s}` as 'A1']} placeholder={defaultPlayerLabel(playType, t, s as Slot)} onChange={(v) => onChange({ ...draft, slots: { ...draft.slots, [`${t}${s}`]: v } })} />
              </Field>
            ))}
          </div>
        </div>
      ))}
      <p className="md:col-span-2 text-sm text-muted">Names are optional. Leave a name blank to show “{defaultPlayerLabel(playType, 'A', 1)}” / “{defaultPlayerLabel(playType, 'B', 1)}”. Pick a suggestion to link a registered player; anything you type is kept for this match only.</p>
    </div>
  );
}

/* ----------------------------------------------------------- rules editor */
function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (n: number) => void; label: string }) {
  return (
    <div className="flex items-center gap-2" role="group" aria-label={label}>
      <Button size="lg" aria-label={`${label} minus`} onClick={() => onChange(Math.max(min, value - 1))}><Minus className="size-5" /></Button>
      <span className="tnum w-12 text-center text-2xl font-bold">{value}</span>
      <Button size="lg" aria-label={`${label} plus`} onClick={() => onChange(Math.min(max, value + 1))}><Plus className="size-5" /></Button>
    </div>
  );
}

export function RulesEditor({ rules, onChange, playType }: { rules: MatchRules; onChange: (r: MatchRules) => void; playType: PlayType }) {
  const set = <K extends keyof MatchRules>(k: K, v: MatchRules[K]) => {
    const next = { ...rules, [k]: v };
    if (k === 'scoringType' && v === 'side_out') next.servingMode = 'auto';
    if (k === 'winBy' && v === 1) next.pointCap = null;
    if (k === 'gamesToWin' && v === 1) next.decidingGamePoints = null;
    onChange(next);
  };
  const dsn = playType === 'doubles' && rules.scoringType === 'side_out' && rules.servingMode === 'auto';
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Scoring"><Segmented label="Scoring" value={rules.scoringType} onChange={(v) => set('scoringType', v)} options={[{ value: 'side_out', label: 'Side-out' }, { value: 'rally', label: 'Rally' }]} /></Field>
      <Field label="Serving" hint={rules.scoringType === 'side_out' ? 'Side-out scoring needs automatic serving' : undefined}>
        <Segmented label="Serving" value={rules.servingMode} onChange={(v) => set('servingMode', v)} options={[{ value: 'auto', label: 'Automatic' }, ...(rules.scoringType === 'rally' ? [{ value: 'off' as const, label: 'Not tracked' }] : [])]} />
      </Field>
      <Field label="Points to win"><Stepper label="Points" value={rules.pointsToWin} min={1} max={50} onChange={(n) => set('pointsToWin', n)} /></Field>
      <Field label="Win by"><Segmented label="Win by" value={rules.winBy} onChange={(v) => set('winBy', v)} options={[{ value: 1, label: '1 point' }, { value: 2, label: '2 points' }]} /></Field>
      <Field label="Games"><Segmented label="Games" value={rules.gamesToWin} onChange={(v) => set('gamesToWin', v)} options={[{ value: 1, label: '1 game' }, { value: 2, label: 'Best of 3' }, { value: 3, label: 'Best of 5' }]} /></Field>
      <Field label="Point cap (optional)" hint={rules.winBy === 1 ? 'Only with win-by-2' : undefined}>
        <Input type="number" min={2} inputMode="numeric" disabled={rules.winBy === 1} value={rules.pointCap ?? ''} placeholder="None" onChange={(e) => set('pointCap', e.target.value ? Number(e.target.value) : null)} /></Field>
      <Field label="Deciding-game target (optional)"><Input type="number" min={1} max={50} inputMode="numeric" disabled={rules.gamesToWin === 1} value={rules.decidingGamePoints ?? ''} placeholder="Same as above" onChange={(e) => set('decidingGamePoints', e.target.value ? Number(e.target.value) : null)} /></Field>
      <Field label="Time limit in minutes (optional)"><Input type="number" min={1} max={600} inputMode="numeric" value={rules.timeLimitMinutes ?? ''} placeholder="None" onChange={(e) => set('timeLimitMinutes', e.target.value ? Number(e.target.value) : null)} /></Field>
      <Field label="“Switch ends” reminder"><Select value={rules.switchEndsPrompt} onChange={(e) => set('switchEndsPrompt', e.target.value as MatchRules['switchEndsPrompt'])}><option value="deciding_game">In the deciding game</option><option value="every_game">Every game</option><option value="off">Never</option></Select></Field>
      {dsn && <Field label="First service turn"><Select value={rules.firstServerRule} onChange={(e) => set('firstServerRule', e.target.value as MatchRules['firstServerRule'])}><option value="start_server_2">Start at server 2 (standard 0-0-2)</option><option value="both_servers">Both partners serve (0-0-1)</option></Select></Field>}
      {playType === 'doubles' && rules.servingMode === 'auto' && <div className="sm:col-span-2"><Check checked={rules.trackServerNames} onChange={(v) => set('trackServerNames', v)} label="Ask who starts on the right and show the server's name" /></div>}
    </div>
  );
}

export interface PresetDto { id: number; name: string; rules: MatchRules; isDefault: boolean; isActive: boolean }

/** Match type (explicit, no preselection), preset, optional customization — shared by the wizard and "Change rules". */
export function TypeAndRules({ playType, setPlayType, presets, formatId, setFormatId, overrides, setOverrides, locked }: {
  playType: PlayType | null; setPlayType: (p: PlayType) => void; presets: PresetDto[]; formatId: number | null; setFormatId: (n: number) => void;
  overrides: Partial<MatchRules>; setOverrides: (o: Partial<MatchRules>) => void; locked?: boolean;
}) {
  const me = useMe().data;
  const allow = me?.publicSettings.allowRuleOverrides ?? true;
  const [custom, setCustom] = useState(Object.keys(overrides).length > 0);
  const preset = presets.find((p) => p.id === formatId);
  const eff = preset ? applyOverrides(preset.rules, overrides) : null;
  const issues = eff && playType ? validateRules(playType, eff) : [];
  const changed = Object.keys(overrides).length > 0;
  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-base font-semibold">Match type</p>
        <div className="grid grid-cols-2 gap-3">
          {([['singles', 'Singles', '1 v 1', User], ['doubles', 'Doubles', '2 v 2', Users]] as const).map(([v, label, sub, Icon]) => (
            <button key={v} type="button" disabled={locked} onClick={() => setPlayType(v)} aria-pressed={playType === v}
              className={cx('flex min-h-24 flex-col items-center justify-center gap-1 rounded-2xl border-2 p-3 text-2xl font-extrabold transition disabled:opacity-60', playType === v ? 'border-primary bg-primary/15 text-primary' : 'border-line bg-surface2')}>
              <Icon className="size-7" />{label}<span className="text-sm font-medium text-muted">{sub}</span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-2 text-base font-semibold">Rules</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {presets.filter((p) => p.isActive).map((p) => (
            <button key={p.id} type="button" onClick={() => { setFormatId(p.id); setOverrides({}); setCustom(false); }} aria-pressed={formatId === p.id}
              className={cx('min-h-16 rounded-xl border-2 p-3 text-left', formatId === p.id ? 'border-primary bg-primary/10' : 'border-line bg-surface2')}>
              <span className="block text-base font-semibold">{p.name}{p.isDefault && <span className="ml-2 text-xs font-medium text-muted">default</span>}</span>
              <span className="block text-xs text-muted">{describeRules(p.rules)}</span>
            </button>
          ))}
        </div>
        {allow && preset && (
          <div className="mt-3">
            <button type="button" className="text-sm font-medium text-primary underline" onClick={() => setCustom((c) => !c)}>{custom ? 'Hide' : 'Customize rules for this match only'}</button>
            {custom && playType && eff && <div className="mt-3 rounded-xl border border-line p-4"><RulesEditor playType={playType} rules={eff} onChange={(r) => { const o: Partial<MatchRules> = {}; for (const k of Object.keys(r) as (keyof MatchRules)[]) if (r[k] !== preset.rules[k]) (o as Record<string, unknown>)[k] = r[k]; setOverrides(o); }} /></div>}
          </div>
        )}
        {eff && <p className="mt-3 rounded-lg bg-surface2 p-3 text-sm"><b>{changed ? 'Custom: ' : ''}</b>{describeRules(eff)}</p>}
        {issues.length > 0 && <Notice tone="danger" className="mt-2">{issues.map((i) => i.message).join('. ')}</Notice>}
      </div>
    </div>
  );
}

export function usePresets() {
  return useQuery({ queryKey: ['formats'], queryFn: () => get<PresetDto[]>('formats'), staleTime: 60_000 });
}
export const diffOverrides = (eff: MatchRules, base: MatchRules): Partial<MatchRules> => { const o: Partial<MatchRules> = {}; for (const k of Object.keys(eff) as (keyof MatchRules)[]) if (eff[k] !== base[k]) (o as Record<string, unknown>)[k] = eff[k]; return o; };

/* ----------------------------------------------------------- New match */
export function NewMatchWizard({ snap, open, onClose, onCreated }: { snap: CourtSnapshot; open: boolean; onClose: () => void; onCreated: (startNow: boolean) => void }) {
  const qc = useQueryClient();
  const presets = usePresets();
  const courtId = snap.court.id;
  const ctxQ = useQuery({ queryKey: ['bookings', 'context', courtId], enabled: open, queryFn: () => get<{ linkable: BookingDto[] }>(`bookings/context?courtId=${courtId}`), staleTime: 0 });
  const [step, setStep] = useState(1);
  const [playType, setPlayType] = useState<PlayType | null>(null);
  const [formatId, setFormatId] = useState<number | null>(null);
  const [overrides, setOverrides] = useState<Partial<MatchRules>>({});
  const [draft, setDraft] = useState<NameDraft>(emptyDraft());
  const [bookingId, setBookingId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [warn, setWarn] = useState<{ booker: string; id: number; start: number; end: number } | null>(null);
  useEffect(() => { if (open) { setStep(1); setPlayType(null); setOverrides({}); setDraft(emptyDraft()); setBookingId(null); setWarn(null); } }, [open]);
  useEffect(() => { if (open && presets.data && formatId == null) setFormatId(presets.data.find((p) => p.isDefault)?.id ?? presets.data[0]?.id ?? null); }, [open, presets.data, formatId]);
  const linkable = ctxQ.data?.linkable ?? [];
  const preset = presets.data?.find((p) => p.id === formatId);
  const eff = preset ? applyOverrides(preset.rules, overrides) : null;
  const rulesOk = !!eff && !!playType && validateRules(playType, eff).length === 0;

  const create = async (startNow: boolean, force?: { bookingId?: number; ack?: boolean }) => {
    if (!playType || !formatId) return;
    setBusy(true);
    try {
      const body = {
        courtId, playType, formatId, ruleOverrides: Object.keys(overrides).length ? overrides : undefined,
        teamAName: draft.teamAName.trim() || undefined, teamBName: draft.teamBName.trim() || undefined,
        players: draftToSlots(draft, playType),
        bookingId: force?.bookingId ?? bookingId ?? undefined,
        acknowledgeBooking: force?.ack ?? (bookingId == null && linkable.length > 0),
        clientRequestId: `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      };
      const r = await post<{ snapshot: CourtSnapshot; warnings: string[] }>('matches', body);
      applySnapshot(r.snapshot);
      r.warnings.forEach((w) => toastError(new Error(w)));
      void qc.invalidateQueries({ queryKey: ['bookings'] });
      onClose(); onCreated(startNow);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'BOOKING_WARNING') { const b = e.details?.booking; setWarn({ booker: b.booked_by_name, id: b.id, start: b.start_at, end: b.end_at }); }
      else toastError(e);
    } finally { setBusy(false); }
  };

  const canNext1 = !!playType && rulesOk;
  return (
    <Modal open={open} onClose={onClose} wide title={`New match · ${snap.court.name}`} dismissible={!busy}
      footer={step === 1 ? <><Button size="lg" onClick={onClose}>Cancel</Button><Button size="lg" variant="primary" disabled={!canNext1} onClick={() => setStep(2)}>Next: players</Button></>
        : step === 2 ? <><Button size="lg" onClick={() => setStep(1)}>Back</Button><Button size="lg" disabled={!rulesOk} loading={busy} onClick={() => void create(false)}>Create match</Button><Button size="lg" variant="primary" disabled={!rulesOk} loading={busy} onClick={() => void create(true)}>{draftIsEmpty(draft) ? 'Skip names · create and start' : 'Create and start'}</Button></> : null}>
      <ol className="mb-5 flex gap-2 text-xs font-medium text-muted" aria-label="Steps">{['Match type & rules', 'Players (optional)'].map((s, i) => <li key={s} className={cx('flex-1 rounded-full px-3 py-1 text-center', step === i + 1 ? 'bg-primary/15 text-primary' : 'bg-surface2')}>{i + 1}. {s}</li>)}</ol>
      {step === 1 && (
        <div className="space-y-6">
          {presets.isLoading ? <p className="text-muted">Loading rules…</p> : (
            <TypeAndRules playType={playType} setPlayType={setPlayType} presets={presets.data ?? []} formatId={formatId} setFormatId={setFormatId} overrides={overrides} setOverrides={setOverrides} />
          )}
          {linkable.length > 0 && (
            <div>
              <p className="mb-2 text-base font-semibold">Booking</p>
              <Notice tone="warn" className="mb-2">{snap.court.name} is reserved{bookingId ? '' : ' by someone — link this match to the booking, or continue anyway'}.</Notice>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setBookingId(null)} aria-pressed={bookingId == null} className={cx('min-h-12 rounded-xl border-2 px-4 text-sm font-semibold', bookingId == null ? 'border-primary bg-primary/10' : 'border-line bg-surface2')}>No booking</button>
                {linkable.map((b) => <button key={b.id} type="button" onClick={() => setBookingId(b.id)} aria-pressed={bookingId === b.id} className={cx('min-h-12 rounded-xl border-2 px-4 text-sm font-semibold', bookingId === b.id ? 'border-primary bg-primary/10' : 'border-line bg-surface2')}>{b.bookedByName} · {fmtTime(b.startAt)}–{fmtTime(b.endAt)}</button>)}
              </div>
            </div>
          )}
        </div>
      )}
      {step === 2 && playType && <NamesFields playType={playType} draft={draft} onChange={setDraft} />}
      <Modal open={!!warn} onClose={() => setWarn(null)} title="This court is reserved"
        footer={warn ? <><Button onClick={() => { setWarn(null); onClose(); }}>Choose another court</Button><Button onClick={() => { setWarn(null); void create(false, { ack: true }); }}>Continue anyway</Button><Button variant="primary" onClick={() => { const id = warn.id; setWarn(null); void create(false, { bookingId: id }); }}>Link to this booking</Button></> : null}>
        {warn && <p className="text-base">{snap.court.name} is booked by <b>{warn.booker}</b> from {fmtTime(warn.start)} to {fmtTime(warn.end)}. You can still play, link this match to their booking, or use another court.</p>}
      </Modal>
    </Modal>
  );
}

/* ------------------------------------------------- change type / rules (setup) */
export function ChangeRulesDialog({ m, open, onClose }: { m: MatchSnapshot; open: boolean; onClose: () => void }) {
  const presets = usePresets();
  const [playType, setPlayType] = useState<PlayType>(m.playType);
  const [formatId, setFormatId] = useState<number | null>(null);
  const [overrides, setOverrides] = useState<Partial<MatchRules>>({});
  const [busy, setBusy] = useState(false);
  const base = useMemo(() => presets.data?.find((p) => p.id === formatId)?.rules ?? null, [presets.data, formatId]);
  useEffect(() => {
    if (!open || !presets.data) return;
    setPlayType(m.playType);
    const guess = presets.data.find((p) => m.rules.name.startsWith(p.name)) ?? presets.data.find((p) => p.isDefault) ?? presets.data[0]!;
    setFormatId(guess.id);
    const { name: _n, customized: _c, ...cur } = m.rules; void _n; void _c;
    setOverrides(diffOverrides(cur as MatchRules, guess.rules));
  }, [open, presets.data]); // eslint-disable-line react-hooks/exhaustive-deps
  void base;
  const save = async () => {
    setBusy(true);
    try { await sendCommand(m, 'UPDATE_RULES', { playType, formatId, ruleOverrides: overrides }); onClose(); }
    catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} wide title="Change match type / rules" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void save()}>Save changes</Button></>}>
      <TypeAndRules playType={playType} setPlayType={setPlayType} presets={presets.data ?? []} formatId={formatId} setFormatId={setFormatId} overrides={overrides} setOverrides={setOverrides} />
      <p className="mt-4 text-sm text-muted">Rules and match type are locked once the match starts.</p>
    </Modal>
  );
}
