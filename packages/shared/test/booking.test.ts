import { describe, expect, it } from 'vitest';
import {
  addDays, bookingTimeState, formatBookingCode, formatMatchCode, isoWeekday, localDate, minutesOfDay, overlaps,
  snapToSlot, validateBookingTimes, zonedToEpoch, type BookingLimits,
} from '../src/booking';
import { DEFAULT_SETTINGS } from '../src/settings';
import { defaultPlayerLabel, normalizeTypedName } from '../src/labels';
import { deriveCourtStatus } from '../src/court';
import { validateRules, applyOverrides } from '../src/scoring/rules';
import { DEFAULT_RULES } from '../src/constants';

const TZ = 'America/New_York';
const lim: BookingLimits = { tz: TZ, hours: DEFAULT_SETTINGS.operatingHours, slotMinutes: 30, maxHours: 4, advanceDays: 90 };
const at = (date: string, hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return zonedToEpoch(date, h! * 60 + m!, TZ); };

describe('time zones', () => {
  it('round-trips local date + minutes through an instant', () => {
    const ms = at('2026-10-30', '18:30');
    expect(localDate(ms, TZ)).toBe('2026-10-30');
    expect(minutesOfDay(ms, TZ)).toBe(18 * 60 + 30);
  });
  it('is DST-safe (spring forward and fall back days)', () => {
    expect(minutesOfDay(at('2026-03-08', '09:00'), TZ)).toBe(540);
    expect(minutesOfDay(at('2026-11-01', '09:00'), TZ)).toBe(540);
    expect(at('2026-03-09', '00:00') - at('2026-03-08', '00:00')).toBe(23 * 3600_000);
    expect(at('2026-11-02', '00:00') - at('2026-11-01', '00:00')).toBe(25 * 3600_000);
  });
  it('weekday and day arithmetic', () => {
    expect(isoWeekday('2026-10-30')).toBe(5); // Friday
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('overlaps / slots', () => {
  const r = (a: number, b: number) => ({ startAt: a, endAt: b });
  it('adjacent ranges do not overlap; contained/enclosing/partial do', () => {
    expect(overlaps(r(18, 19), r(19, 20))).toBe(false);
    expect(overlaps(r(18, 19), r(17, 18))).toBe(false);
    expect(overlaps(r(18, 19), r(18.5, 19.5))).toBe(true);
    expect(overlaps(r(18, 19), r(18.2, 18.4))).toBe(true);
    expect(overlaps(r(18, 19), r(17, 20))).toBe(true);
  });
  it('snaps to the slot grid', () => {
    const ms = at('2026-10-30', '18:17');
    expect(minutesOfDay(snapToSlot(ms, 30, TZ), TZ)).toBe(18 * 60 + 30);
  });
  it('derives booking time state', () => {
    expect(bookingTimeState({ startAt: 10, endAt: 20 }, 5)).toBe('upcoming');
    expect(bookingTimeState({ startAt: 10, endAt: 20 }, 10)).toBe('now');
    expect(bookingTimeState({ startAt: 10, endAt: 20 }, 20)).toBe('past');
  });
});

describe('validateBookingTimes (FR-BOOK-03)', () => {
  const now = at('2026-10-30', '12:00');
  const v = (d: string, a: string, b: string, l = lim) => validateBookingTimes({ startAt: at(d, a), endAt: at(d, b) }, l, now);
  it('accepts a normal booking', () => expect(v('2026-10-30', '18:00', '19:00')).toBeNull());
  it('rejects off-slot, outside hours, too long, past, too far ahead, bad range', () => {
    expect(v('2026-10-30', '18:10', '19:00')).toBe('NOT_ON_SLOT');
    expect(v('2026-10-31', '06:30', '07:30')).toBe('OUTSIDE_HOURS');
    expect(v('2026-10-30', '21:30', '22:30')).toBe('OUTSIDE_HOURS');
    expect(v('2026-10-31', '08:00', '13:00')).toBe('TOO_LONG');
    expect(v('2026-10-30', '09:00', '10:00')).toBe('IN_PAST');
    expect(v('2027-03-30', '09:00', '10:00')).toBe('TOO_FAR_AHEAD');
    expect(v('2026-10-30', '19:00', '18:00')).toBe('BAD_RANGE');
  });
  it('allows a 15-minute late entry and ending exactly at closing time', () => {
    expect(validateBookingTimes({ startAt: now - 15 * 60_000, endAt: now + 45 * 60_000 }, { ...lim, slotMinutes: 15 }, now)).toBeNull();
    expect(v('2026-10-30', '21:00', '22:00')).toBeNull();
  });
  it('honours a closed day', () => {
    const closed = { ...lim, hours: { ...lim.hours, '5': null } };
    expect(v('2026-10-30', '18:00', '19:00', closed)).toBe('OUTSIDE_HOURS');
  });
});

describe('codes, labels, normalisation', () => {
  it('formats booking and match codes', () => {
    expect(formatBookingCode('2026-10-30', 4)).toBe('B-261030-004');
    expect(formatMatchCode('2026-10-30', '3', 4)).toBe('261030-C3-004');
  });
  it('T-LABEL default labels', () => {
    expect(defaultPlayerLabel('singles', 'A', 1)).toBe('Player 1');
    expect(defaultPlayerLabel('singles', 'B', 1)).toBe('Player 2');
    expect(defaultPlayerLabel('doubles', 'B', 2)).toBe('Player 2');
    expect(defaultPlayerLabel('doubles', 'A', 1)).toBe('Player 1');
  });
  it('normalises typed names', () => {
    expect(normalizeTypedName('  jordan   lee ')).toBe('jordan lee');
    expect(normalizeTypedName('   ')).toBeNull();
    expect(normalizeTypedName(null)).toBeNull();
  });
});

describe('court status derivation (first match wins)', () => {
  const base = { isActive: true, maintenanceMode: false, releasedAt: null, activeMatchStatus: null, latestFinished: null, now: 1_000_000, completedDisplayMinutes: 5 } as const;
  it('orders statuses correctly', () => {
    expect(deriveCourtStatus({ ...base, isActive: false, maintenanceMode: true })).toBe('inactive');
    expect(deriveCourtStatus({ ...base, maintenanceMode: true, activeMatchStatus: 'in_progress' })).toBe('maintenance');
    expect(deriveCourtStatus({ ...base, activeMatchStatus: 'setup' })).toBe('occupied');
    expect(deriveCourtStatus({ ...base, activeMatchStatus: 'in_progress' })).toBe('in_progress');
    expect(deriveCourtStatus({ ...base, activeMatchStatus: 'paused' })).toBe('paused');
    expect(deriveCourtStatus(base)).toBe('available');
  });
  it('shows completed for the display window unless released', () => {
    const f = { status: 'completed' as const, endedAt: 1_000_000 - 60_000 };
    expect(deriveCourtStatus({ ...base, latestFinished: f })).toBe('completed');
    expect(deriveCourtStatus({ ...base, latestFinished: f, releasedAt: 1_000_000 - 1000 })).toBe('available');
    expect(deriveCourtStatus({ ...base, latestFinished: { ...f, endedAt: 1_000_000 - 6 * 60_000 } })).toBe('available');
  });
});

describe('validateRules (T-CFG)', () => {
  it('accepts defaults and rejects invalid combinations', () => {
    expect(validateRules('doubles', DEFAULT_RULES)).toEqual([]);
    expect(validateRules('doubles', { ...DEFAULT_RULES, servingMode: 'off' }).length).toBe(1); // side-out + off
    expect(validateRules('doubles', { ...DEFAULT_RULES, pointCap: 11 }).length).toBeGreaterThan(0);
    expect(validateRules('doubles', { ...DEFAULT_RULES, winBy: 1, pointCap: 15 }).length).toBeGreaterThan(0);
    expect(validateRules('doubles', { ...DEFAULT_RULES, decidingGamePoints: 15 }).length).toBeGreaterThan(0);
    expect(validateRules('doubles', { ...DEFAULT_RULES, gamesToWin: 2, decidingGamePoints: 15 })).toEqual([]);
    expect(validateRules('singles', { ...DEFAULT_RULES, pointsToWin: 99 }).length).toBeGreaterThan(0);
  });
  it('applies overrides without mutating the preset', () => {
    const o = applyOverrides(DEFAULT_RULES, { pointsToWin: 15, winBy: 1 });
    expect(o).toMatchObject({ pointsToWin: 15, winBy: 1 });
    expect(DEFAULT_RULES.pointsToWin).toBe(11);
  });
});
