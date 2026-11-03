import type { BookingStatus, BookingTimeState } from './types';
import type { OperatingHours, Settings } from './settings';

/* ------------------------------------------------------------ time zones */

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    dtfCache.set(tz, f);
  }
  return f;
}

export interface ZonedParts { year: number; month: number; day: number; hour: number; minute: number; second: number }

export function zonedParts(ms: number, tz: string): ZonedParts {
  const parts: Record<string, number> = {};
  for (const p of dtf(tz).formatToParts(new Date(ms))) if (p.type !== 'literal') parts[p.type] = Number(p.value);
  return { year: parts.year!, month: parts.month!, day: parts.day!, hour: parts.hour! % 24, minute: parts.minute!, second: parts.second! };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Facility-local calendar date `YYYY-MM-DD` of an instant. */
export function localDate(ms: number, tz: string): string {
  const p = zonedParts(ms, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function minutesOfDay(ms: number, tz: string): number {
  const p = zonedParts(ms, tz);
  return p.hour * 60 + p.minute;
}

/** ISO weekday 1 (Mon) … 7 (Sun) of a local date string. */
export function isoWeekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Epoch ms of a facility-local date + minutes-after-midnight (DST-safe: two-pass offset). */
export function zonedToEpoch(date: string, minutes: number, tz: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const naive = Date.UTC(y, m - 1, d, 0, minutes, 0);
  let guess = naive;
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(guess, tz);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const diff = asUtc - guess; // offset
    const next = naive - diff;
    if (next === guess) break;
    guess = next;
  }
  return guess;
}

export function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

/* ---------------------------------------------------------------- bookings */

export interface TimeRange { startAt: number; endAt: number }

/** Half-open ranges: adjacent bookings (A.end == B.start) do not overlap. */
export function overlaps(a: TimeRange, b: TimeRange): boolean {
  return a.startAt < b.endAt && a.endAt > b.startAt;
}

export function bookingTimeState(b: TimeRange, now: number): BookingTimeState {
  if (now >= b.endAt) return 'past';
  if (now >= b.startAt) return 'now';
  return 'upcoming';
}

export function snapToSlot(ms: number, slotMinutes: number, tz: string): number {
  const date = localDate(ms, tz);
  const mins = minutesOfDay(ms, tz);
  const snapped = Math.round(mins / slotMinutes) * slotMinutes;
  return zonedToEpoch(date, snapped, tz);
}

export type BookingInvalidReason =
  | 'COURT_INACTIVE' | 'OUTSIDE_HOURS' | 'TOO_LONG' | 'TOO_FAR_AHEAD' | 'IN_PAST' | 'NOT_ON_SLOT' | 'BAD_RANGE' | 'SPANS_MIDNIGHT';

export interface BookingLimits {
  tz: string;
  hours: OperatingHours;
  slotMinutes: number;
  maxHours: number;
  advanceDays: number;
}
export const limitsFromSettings = (s: Settings, tz: string): BookingLimits => ({
  tz, hours: s.operatingHours, slotMinutes: s.bookingSlotMinutes, maxHours: s.bookingMaxHours, advanceDays: s.bookingAdvanceDays,
});

const LATE_ENTRY_GRACE_MS = 15 * 60 * 1000;

/** FR-BOOK-03. Returns the first violated rule or null. */
export function validateBookingTimes(r: TimeRange, lim: BookingLimits, now: number): BookingInvalidReason | null {
  if (!(r.endAt > r.startAt)) return 'BAD_RANGE';
  const startDate = localDate(r.startAt, lim.tz);
  const endDate = localDate(r.endAt - 1, lim.tz);
  if (startDate !== endDate) return 'SPANS_MIDNIGHT';
  const sm = minutesOfDay(r.startAt, lim.tz);
  const em = minutesOfDay(r.endAt - 1, lim.tz) + 1;
  if (sm % lim.slotMinutes !== 0 || (em % lim.slotMinutes !== 0 && em !== 1440)) return 'NOT_ON_SLOT';
  if (r.startAt < now - LATE_ENTRY_GRACE_MS) return 'IN_PAST';
  const day = lim.hours[String(isoWeekday(startDate)) as keyof OperatingHours];
  if (!day) return 'OUTSIDE_HOURS';
  if (sm < hhmmToMinutes(day.open) || em > hhmmToMinutes(day.close)) return 'OUTSIDE_HOURS';
  if ((r.endAt - r.startAt) > lim.maxHours * 3600_000) return 'TOO_LONG';
  if (r.startAt > now + lim.advanceDays * 86400_000) return 'TOO_FAR_AHEAD';
  return null;
}

export const bookingStatusLabel: Record<BookingStatus, string> = {
  confirmed: 'Confirmed', cancelled: 'Cancelled', no_show: 'No-show',
};

export function formatBookingCode(date: string, seq: number): string {
  return `B-${date.slice(2, 4)}${date.slice(5, 7)}${date.slice(8, 10)}-${String(seq).padStart(3, '0')}`;
}

export function formatMatchCode(date: string, courtShort: string, seq: number): string {
  return `${date.slice(2, 4)}${date.slice(5, 7)}${date.slice(8, 10)}-C${courtShort}-${String(seq).padStart(3, '0')}`;
}
