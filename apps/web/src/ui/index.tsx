import { createPortal } from 'react-dom';
import { cloneElement, forwardRef, isValidElement, useCallback, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactElement, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { AlertTriangle, Activity, CheckCircle2, CircleSlash, Loader2, Pause, Trophy, Users, Wifi, WifiOff, Wrench, X } from 'lucide-react';
import type { CourtStatus, MatchSnapshot } from '@pickle/shared';
import { useStore } from '../lib/store';
import { toastStore, dismissToast } from '../lib/toast';
import { serverNow } from '../lib/clock';
import { connStore } from '../lib/realtime';

export const cx = (...c: (string | false | null | undefined)[]): string => c.filter(Boolean).join(' ');

/* ------------------------------------------------------------------ buttons */
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg' | 'xl';
const VARIANT: Record<Variant, string> = {
  primary: 'bg-primary text-primary-ink shadow-card hover:bg-[var(--c-primary-hover)] disabled:opacity-45',
  secondary: 'bg-surface text-ink border-[1.5px] border-line-strong hover:bg-surface2 disabled:opacity-45',
  ghost: 'bg-transparent text-ink hover:bg-surface2 disabled:opacity-45',
  danger: 'bg-danger text-white shadow-card hover:brightness-110 disabled:opacity-45',
};
const SIZE: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm rounded-lg', md: 'h-11 px-4 text-sm rounded-xl', lg: 'h-12 px-5 text-base rounded-xl', xl: 'min-h-16 px-6 text-xl font-semibold rounded-2xl',
};
export interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> { variant?: Variant; size?: Size; loading?: boolean; icon?: ReactNode }
export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button({ variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...p }, ref) {
  return (
    <button ref={ref} type="button" disabled={disabled || loading} className={cx('inline-flex items-center justify-center gap-2 font-semibold transition-[background-color,filter,transform] duration-150 select-none active:scale-[.98] disabled:cursor-not-allowed', VARIANT[variant], SIZE[size], className)} {...p}>
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

/* -------------------------------------------------------------------- cards */
export function Card({ className, children, ...p }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('rounded-2xl border border-line bg-surface shadow-card', className)} {...p}>{children}</div>;
}
export function CardHeader({ title, actions, sub }: { title: ReactNode; actions?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
      <div><h2 className="text-lg font-bold leading-snug">{title}</h2>{sub && <p className="text-sm text-muted">{sub}</p>}</div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
export function PageHeader({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="font-display text-[1.75rem] leading-[1.15] sm:text-4xl">{title}</h1>{sub && <p className="mt-1 text-sm text-muted">{sub}</p>}</div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'primary' | 'warn' | 'danger' | 'info' | 'success'; className?: string }) {
  const t = { neutral: 'bg-[var(--st-inactive-bg)] text-[var(--st-inactive)]', primary: 'bg-primary text-primary-ink', warn: 'bg-warn-tint text-warn', danger: 'bg-danger-tint text-danger', info: 'bg-info-tint text-info', success: 'bg-success-tint text-success' }[tone];
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-sans text-xs font-bold tracking-normal', t, className)}>{children}</span>;
}
export const RoleBadge = ({ role }: { role: 'admin' | 'staff' }) => <Badge tone={role === 'admin' ? 'primary' : 'neutral'}>{role === 'admin' ? 'Admin' : 'Staff'}</Badge>;
export const ViewOnlyTag = () => <Badge tone="neutral">View only</Badge>;

/* ------------------------------------------------------------- status pills */
/** `color` is the foreground, `bg` the paired background (brand status pairs, contrast-checked). Live is the only lime pill. */
export const STATUS: Record<CourtStatus, { label: string; color: string; bg: string; Icon: typeof Activity }> = {
  available: { label: 'Available', color: 'var(--st-available)', bg: 'var(--st-available-bg)', Icon: CheckCircle2 },
  occupied: { label: 'Match set up', color: 'var(--st-occupied)', bg: 'var(--st-occupied-bg)', Icon: Users },
  in_progress: { label: 'In progress', color: 'var(--st-live)', bg: 'var(--st-live-bg)', Icon: Activity },
  paused: { label: 'Paused', color: 'var(--st-paused)', bg: 'var(--st-paused-bg)', Icon: Pause },
  completed: { label: 'Completed', color: 'var(--st-completed)', bg: 'var(--st-completed-bg)', Icon: Trophy },
  maintenance: { label: 'Maintenance', color: 'var(--st-maintenance)', bg: 'var(--st-maintenance-bg)', Icon: Wrench },
  inactive: { label: 'Not in service', color: 'var(--st-inactive)', bg: 'var(--st-inactive-bg)', Icon: CircleSlash },
};
export function StatusPill({ status, size = 'md' }: { status: CourtStatus; size?: 'sm' | 'md' | 'lg' }) {
  const s = STATUS[status];
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full font-medium', size === 'sm' ? 'px-2 py-0.5 text-xs font-bold' : size === 'lg' ? 'px-4 py-1.5 text-lg font-bold' : 'px-2.5 py-1 text-xs font-bold')} style={{ background: s.bg, color: s.color }}>
      {status === 'in_progress' ? <span className="pulse-dot size-2 rounded-full" style={{ background: s.color }} /> : <s.Icon className={size === 'lg' ? 'size-5' : 'size-3.5'} />}
      {s.label}
    </span>
  );
}
export function DeviceDot({ device }: { device: { online: boolean } | null | undefined }) {
  if (!device) return <span className="inline-flex items-center gap-1 text-xs text-muted"><WifiOff className="size-3.5" />No device</span>;
  return device.online
    ? <span className="inline-flex items-center gap-1 text-xs font-medium text-success"><Wifi className="size-3.5" />Online</span>
    : <span className="inline-flex items-center gap-1 text-xs text-danger"><WifiOff className="size-3.5" />Offline</span>;
}

/* --------------------------------------------------------------------- forms */
export function Field({ label, hint, error, children, className }: { label?: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string }) {
  const id = useId();
  const hintId = `${id}-hint`;
  // Inputs get a real <label for>, hints/errors are linked with aria-describedby (so they are not part of the accessible name).
  const only = isValidElement(children) ? (children as ReactElement<Record<string, unknown>>) : null;
  const isControl = !!only && (only.type === Input || only.type === Select || only.type === Textarea || only.type === 'input' || only.type === 'select' || only.type === 'textarea');
  const control = isControl && only
    ? cloneElement(only, { id: (only.props.id as string | undefined) ?? id, 'aria-describedby': hint || error ? hintId : undefined, 'aria-invalid': error ? true : undefined })
    : children;
  const forId = isControl && only ? ((only.props.id as string | undefined) ?? id) : undefined;
  return (
    <div className={cx('block text-sm', className)}>
      {label && (isControl ? <label htmlFor={forId} className="mb-1 block font-medium">{label}</label> : <span className="mb-1 block font-medium">{label}</span>)}
      {control}
      {hint && !error && <span id={hintId} className="mt-1 block text-xs text-muted">{hint}</span>}
      {error && <span id={hintId} className="mt-1 block text-xs text-danger" role="alert">{error}</span>}
    </div>
  );
}
const inputCls = 'h-11 rounded-xl border-[1.5px] border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-muted/70 focus:border-primary disabled:opacity-60 aria-[invalid=true]:border-danger';
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) { return <input ref={ref} className={cx(inputCls, className)} {...p} />; });
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...p }, ref) { return <select ref={ref} className={cx(inputCls, 'pr-8', className)} {...p} />; });
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) { return <textarea ref={ref} className={cx(inputCls, 'h-auto min-h-20 py-2', className)} {...p} />; });
/** 12-hour time picker (hour, minute, AM/PM). `value` and `onChange` use 24-hour "HH:mm", which is what the API stores. */
export function TimeInput12({ value, onChange, label, className }: { value: string; onChange: (v: string) => void; label: string; className?: string }) {
  const [hh, mm] = value.split(':').map(Number) as [number, number];
  const pm = hh >= 12, h12 = hh % 12 || 12;
  const minutes = [...new Set([...Array.from({ length: 12 }, (_, i) => i * 5), mm])].sort((a, b) => a - b);
  const emit = (h: number, m: number, isPm: boolean) => onChange(`${String((h % 12) + (isPm ? 12 : 0)).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  return (
    <div role="group" aria-label={label} className={cx('flex items-center gap-1.5', className)}>
      <Select aria-label={`${label} hour`} className="!w-[5.25rem] !pr-7" value={h12} onChange={(e) => emit(Number(e.target.value), mm, pm)}>{Array.from({ length: 12 }, (_, i) => i + 1).map((h) => <option key={h} value={h}>{h}</option>)}</Select>
      <span aria-hidden>:</span>
      <Select aria-label={`${label} minute`} className="!w-[5.25rem] !pr-7" value={mm} onChange={(e) => emit(h12, Number(e.target.value), pm)}>{minutes.map((m) => <option key={m} value={m}>{String(m).padStart(2, '0')}</option>)}</Select>
      <Select aria-label={`${label} AM or PM`} className="!w-[5.75rem] !pr-7" value={pm ? 'PM' : 'AM'} onChange={(e) => emit(h12, mm, e.target.value === 'PM')}><option>AM</option><option>PM</option></Select>
    </div>
  );
}

export function Check({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
  const id = useId();
  return <label htmlFor={id} className="flex items-center gap-2 text-sm"><input id={id} type="checkbox" className="size-4 accent-[var(--c-primary)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />{label}</label>;
}
export function Segmented<T extends string | number>({ value, options, onChange, className, label }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; className?: string; label?: string }) {
  return (
    <div role="tablist" aria-label={label} className={cx('inline-flex rounded-xl border border-line bg-surface2 p-0.5', className)}>
      {options.map((o) => (
        <button key={String(o.value)} role="tab" aria-selected={o.value === value} type="button" onClick={() => onChange(o.value)}
          className={cx('rounded-lg px-3 py-1.5 text-sm font-semibold transition', o.value === value ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink')}>{o.label}</button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- feedback */
/** Full-screen branded loading screen (court green, symbol, lime progress). Used while the app and each page load. */
export function BrandLoader() {
  return (
    <div className="court-lines grid h-full min-h-[60vh] place-items-center bg-court" role="status" aria-label="Loading">
      <div className="flex flex-col items-center gap-6">
        <img src="/brand/logo-light.svg" alt="Peecool" className="h-14 w-auto" />
        <div className="h-1 w-40 overflow-hidden rounded-full bg-white/15"><div className="h-full w-2/5 rounded-full bg-accent" style={{ animation: 'bar-load 1.2s var(--ease) infinite' }} /></div>
      </div>
    </div>
  );
}
export const Spinner = () => <div className="flex justify-center p-8 text-muted"><Loader2 className="size-6 animate-spin" aria-label="Loading" /></div>;
export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-muted">{icon}<p className="font-medium text-ink">{title}</p>{children && <div className="text-sm">{children}</div>}</div>;
}
export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="m-4 flex items-start gap-3 rounded-xl border border-danger/30 bg-danger-tint p-4 text-sm" role="alert">
      <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" />
      <div className="flex-1"><p className="font-medium">{error instanceof Error ? error.message : 'Something went wrong'}</p>{retry && <button className="mt-1 text-primary underline" onClick={retry}>Try again</button>}</div>
    </div>
  );
}
export function Notice({ tone = 'info', children, className }: { tone?: 'info' | 'warn' | 'danger'; children: ReactNode; className?: string }) {
  const t = { info: 'border-info/30 bg-info-tint', warn: 'border-warn/30 bg-warn-tint', danger: 'border-danger/30 bg-danger-tint' }[tone];
  return <div className={cx('rounded-xl border p-3 text-sm', t, className)} role={tone === 'info' ? 'status' : 'alert'}>{children}</div>;
}

export function ToastHost({ large }: { large?: boolean }) {
  const list = useStore(toastStore);
  return createPortal(
    <div className={cx('pointer-events-none fixed z-[100] flex flex-col gap-2', large ? 'left-1/2 top-4 w-[min(92vw,640px)] -translate-x-1/2' : 'bottom-4 right-4 left-4 sm:left-auto sm:w-96')} aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={cx('pointer-events-auto flex items-start gap-2 rounded-xl border-l-4 bg-[var(--peecool-court-900)] px-4 py-3 text-[#F8FFEF] shadow-pop', large ? 'text-lg' : 'text-sm',
          t.kind === 'error' ? 'border-[#FF8E83]' : 'border-accent')}>
          <span className="flex-1">{t.text}</span>
          <button aria-label="Dismiss" onClick={() => dismissToast(t.id)} className="text-[#CBD9C9] hover:text-white"><X className="size-4" /></button>
        </div>
      ))}
    </div>, document.body);
}

/* ------------------------------------------------------------------- modal */
export function Modal({ open, onClose, title, children, footer, wide, fullOnPhone = true, dismissible = true }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean; fullOnPhone?: boolean; dismissible?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && dismissible) onClose(); };
    document.addEventListener('keydown', k);
    ref.current?.focus();
    return () => { document.removeEventListener('keydown', k); prev?.focus?.(); };
  }, [open, onClose, dismissible]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(6,21,13,.55)] sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && dismissible) onClose(); }}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}
        className={cx('page-in flex max-h-[92vh] w-full flex-col overflow-hidden border border-line bg-surface shadow-dialog outline-none sm:rounded-3xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg', fullOnPhone ? 'rounded-t-3xl' : 'rounded-3xl')}>
        {title && <div className="flex items-center justify-between border-b border-line px-5 py-3"><h2 className="font-display text-xl">{title}</h2>{dismissible && <button aria-label="Close" onClick={onClose} className="rounded p-1 text-muted hover:bg-surface2"><X className="size-5" /></button>}</div>}
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-surface2/50 px-5 py-3">{footer}</div>}
      </div>
    </div>, document.body);
}

export function ConfirmDialog({ open, title, children, confirmLabel = 'Confirm', danger, onConfirm, onClose, loading }: { open: boolean; title: string; children?: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void | Promise<void>; onClose: () => void; loading?: boolean }) {
  return (
    <Modal open={open} onClose={onClose} title={title} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={() => void onConfirm()}>{confirmLabel}</Button></>}>
      <div className="text-sm">{children}</div>
    </Modal>
  );
}

/* ------------------------------------------------------------- data display */
/** `hero` = the one court-green tile per screen, with a lime value. */
export function KpiTile({ label, value, sub, tone, hero }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'warn'; hero?: boolean }) {
  return (
    <Card className={cx('p-4', hero && '!border-court !bg-court')}>
      <p className={cx('text-xs font-bold uppercase tracking-[.08em]', hero ? 'text-[#CBD9C9]' : 'text-muted')}>{label}</p>
      <p className={cx('num mt-1 text-[2.75rem] font-bold leading-none', hero ? 'text-accent' : tone === 'warn' && 'text-warn')}>{value}</p>
      {sub && <p className={cx('mt-1 truncate text-xs', hero ? 'text-[#CBD9C9]' : 'text-muted')}>{sub}</p>}
    </Card>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return <p className="px-4 py-2 text-xs text-muted">{total} {total === 1 ? 'result' : 'results'}</p>;
  return (
    <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-2 text-sm">
      <span className="text-muted tnum">{(page - 1) * pageSize + 1}–{Math.min(total, page * pageSize)} of {total}</span>
      <div className="flex gap-2"><Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button><Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button></div>
    </div>
  );
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('overflow-x-auto', className)}><table className="w-full min-w-max text-left text-sm">{children}</table></div>;
}
export const Th = ({ children, className }: { children?: ReactNode; className?: string }) => <th className={cx('whitespace-nowrap bg-surface2 px-4 py-2.5 text-xs font-bold uppercase tracking-[.08em] text-muted', className)}>{children}</th>;
export const Td = ({ children, className, ...p }: { children?: ReactNode; className?: string } & React.TdHTMLAttributes<HTMLTableCellElement>) => <td className={cx('border-t border-line px-4 py-2.5 align-middle', className)} {...p}>{children}</td>;

/* -------------------------------------------------------------------- timer */
export function useNow(intervalMs = 1000): number {
  const [n, setN] = useState(serverNow());
  useEffect(() => { const t = setInterval(() => setN(serverNow()), intervalMs); return () => clearInterval(t); }, [intervalMs]);
  return n;
}
export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = (x: number) => String(x).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
}
export function matchElapsed(m: MatchSnapshot, now: number): number {
  const t = m.timer;
  if (t.startedAt == null) return 0;
  const end = t.endedAt ?? now;
  const pausedNow = t.pausedAt != null && t.endedAt == null ? now - t.pausedAt : 0;
  return Math.max(0, end - t.startedAt - t.pausedTotalMs - pausedNow);
}
export function Timer({ match, className }: { match: MatchSnapshot; className?: string }) {
  const running = match.status === 'in_progress';
  const now = useNow(running ? 500 : 5000);
  return <span className={cx('num', className)}>{fmtClock(matchElapsed(match, now))}</span>;
}

/* ------------------------------------------------------------- hold button */
/** FR-MATCH-13: a tap does nothing; completing the hold only opens the confirmation (never finalizes). */
export function HoldButton({ holdMs, onComplete, label = 'Hold to end match', disabled, size = 'xl', variant = 'danger' }: { holdMs: number; onComplete: () => void; label?: string; disabled?: boolean; size?: Size; variant?: Variant }) {
  const [p, setP] = useState(0);
  const [hint, setHint] = useState(false);
  const raf = useRef(0); const start = useRef(0); const done = useRef(false);
  const cancel = useCallback(() => { cancelAnimationFrame(raf.current); start.current = 0; setP(0); }, []);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  const tick = useCallback(() => {
    const e = performance.now() - start.current;
    if (e >= holdMs) {
      setP(1); start.current = 0; done.current = true;
      try { navigator.vibrate?.(30); } catch { /* not supported */ }
      onComplete(); setTimeout(() => { setP(0); done.current = false; }, 250);
      return;
    }
    setP(e / holdMs); raf.current = requestAnimationFrame(tick);
  }, [holdMs, onComplete]);
  const down = (e: React.PointerEvent) => {
    if (disabled || done.current) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    start.current = performance.now(); setHint(false); raf.current = requestAnimationFrame(tick);
  };
  const up = () => { if (start.current && performance.now() - start.current < 400) { setHint(true); setTimeout(() => setHint(false), 1800); } cancel(); };
  const R = 14, C = 2 * Math.PI * R;
  return (
    <div className="relative">
      <button type="button" disabled={disabled} aria-label={`${label} (press and hold ${(holdMs / 1000).toFixed(1)} seconds)`}
        onPointerDown={down} onPointerUp={up} onPointerCancel={cancel} onPointerLeave={() => start.current && cancel()} onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) down({ currentTarget: e.currentTarget, pointerId: 0 } as unknown as React.PointerEvent); }}
        onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') up(); }}
        className={cx('relative inline-flex w-full touch-none items-center justify-center gap-3 overflow-hidden font-semibold select-none disabled:opacity-40', VARIANT[variant], SIZE[size])}>
        <span className="absolute inset-y-0 left-0 bg-white/25" style={{ width: `${p * 100}%` }} aria-hidden />
        <svg viewBox="0 0 32 32" className="relative size-8 -rotate-90" aria-hidden><circle cx="16" cy="16" r={R} fill="none" stroke="currentColor" strokeOpacity=".3" strokeWidth="3" /><circle cx="16" cy="16" r={R} fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray={C} strokeDashoffset={C * (1 - p)} strokeLinecap="round" /></svg>
        <span className="relative">{label}</span>
      </button>
      {hint && <p className="absolute -top-8 left-0 right-0 text-center text-sm font-medium text-warn" role="status">Keep holding…</p>}
    </div>
  );
}

/* ------------------------------------------------------------ connectivity */
export function ConnectionBadge() {
  const c = useStore(connStore);
  const tone = c.status === 'connected' ? 'text-success' : c.status === 'connecting' ? 'text-muted' : 'text-warn';
  const label = { connected: 'Connected', connecting: 'Connecting…', reconnecting: 'Reconnecting…', restarting: 'Master restarting…' }[c.status];
  return <span className={cx('inline-flex items-center gap-1.5 text-xs font-medium', tone)} role="status"><span className={cx('size-2 rounded-full bg-current', c.status !== 'connected' && 'pulse-dot')} />{label}</span>;
}
