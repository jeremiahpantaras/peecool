import { serverNow } from './clock';

let tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
export const setFacilityTimeZone = (z: string): void => { tz = z; };
export const facilityTz = (): string => tz;

export const fmtTime = (ms: number | null | undefined): string => ms == null ? '—' : new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(ms);
export const fmtDate = (ms: number): string => new Intl.DateTimeFormat([], { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(ms);
export const fmtDateTime = (ms: number): string => `${fmtDate(ms)} ${fmtTime(ms)}`;
export const fmtDay = (date: string): string => new Intl.DateTimeFormat([], { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(Date.parse(`${date}T00:00:00Z`));

export function fmtDuration(ms: number | null | undefined, withSeconds = false): string {
  if (ms == null) return '—';
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  if (withSeconds) return h ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
  return h ? `${h} h ${m} min` : `${m} min`;
}

/** Local (facility) date string YYYY-MM-DD for an instant. */
export function ymd(ms: number): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
  return p;
}
export const today = (): string => ymd(serverNow());

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export function minutesOfDay(ms: number): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(ms);
  const h = Number(parts.find((p) => p.type === 'hour')?.value), m = Number(parts.find((p) => p.type === 'minute')?.value);
  return h * 60 + m;
}

/** Epoch ms of a facility-local date + minutes after midnight (DST-safe two-pass). */
export function zonedToEpoch(date: string, minutes: number): number {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const naive = Date.UTC(y, mo - 1, d, 0, minutes, 0);
  let guess = naive;
  for (let i = 0; i < 3; i++) {
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(guess);
    const g = (t: string) => Number(f.find((p) => p.type === t)?.value);
    const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second'));
    const next = naive - (asUtc - guess);
    if (next === guess) break;
    guess = next;
  }
  return guess;
}

/** 12-hour clock label for minutes after midnight, e.g. 17:05 → "5:05 PM". All displayed times in the app are 12-hour. */
export const hhmm = (mins: number): string => { const h = Math.floor(mins / 60) % 24; return `${h % 12 || 12}:${String(mins % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
export const toMinutes = (s: string): number => { const [h, m] = s.split(':').map(Number) as [number, number]; return h * 60 + m; };
export function isoWeekday(date: string): number { const w = new Date(`${date}T00:00:00Z`).getUTCDay(); return w === 0 ? 7 : w; }
