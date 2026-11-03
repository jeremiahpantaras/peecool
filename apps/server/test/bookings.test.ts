import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, at, cid, createAndStart, seedEnv, type TestEnv } from './helpers';

let env: TestEnv; let admin: Client; let staff: Client;
beforeAll(async () => { ({ env, admin, staff } = await seedEnv(3)); });
afterAll(async () => { await env.destroy(); });

const D = '2026-10-31'; // "now" is 2026-10-30 12:00
const book = (c: Client, court: number, s: string, e: string, name = 'Maria', date = D) =>
  c.post('bookings', { courtId: court, startAt: at(date, s), endAt: at(date, e), bookedByName: name });

describe('no double-booking (FR-BOOK-02)', () => {
  it('accepts adjacent bookings, rejects overlapping ones with the conflicting booking', async () => {
    const a = await book(admin, 2, '18:00', '19:00', 'Maria');
    expect(a.status).toBe(201); expect(a.body.code).toMatch(/^B-261031-\d{3}$/);
    const o = await book(admin, 2, '18:30', '19:30', 'Chen');
    expect(o.status).toBe(409); expect(o.body.error.code).toBe('BOOKING_CONFLICT');
    expect(o.body.error.details.conflict.bookedByName).toBe('Maria');
    expect((await book(admin, 2, '19:00', '20:00', 'Chen')).status).toBe(201);
    expect((await book(admin, 2, '17:00', '18:00', 'Lee')).status).toBe(201);
    expect((await book(admin, 3, '18:00', '19:00', 'Other court')).status).toBe(201);
  });

  it('serialises two simultaneous conflicting requests', async () => {
    const [x, y] = await Promise.all([book(admin, 1, '10:00', '11:00', 'X'), book(admin, 1, '10:30', '11:30', 'Y')]);
    expect([x.status, y.status].sort()).toEqual([201, 409]);
  });

  it('cancelled bookings free the slot; edits are re-validated', async () => {
    const a = (await book(admin, 1, '14:00', '15:00', 'Temp')).body;
    expect((await admin.post(`bookings/${a.id}/cancel`, { reason: 'Rain' })).body).toMatchObject({ status: 'cancelled', cancelReason: 'Rain' });
    const re = await book(admin, 1, '14:00', '15:00', 'Replacement');
    expect(re.status).toBe(201);
    const mv = await admin.patch(`bookings/${re.body.id}`, { startAt: at(D, '10:00'), endAt: at(D, '11:00') });
    expect(mv.status).toBe(409);
    expect((await admin.patch(`bookings/${re.body.id}`, { startAt: at(D, '15:00'), endAt: at(D, '16:00') })).body.startAt).toBe(at(D, '15:00'));
    expect((await admin.patch(`bookings/${a.id}`, { notes: 'x' })).status).toBe(409); // cancelled bookings are read-only
    const ns = await admin.post(`bookings/${re.body.id}/no-show`);
    expect(ns.body.status).toBe('no_show');
  });
});

describe('validation (FR-BOOK-03)', () => {
  const reason = (r: any) => r.body.error?.details?.reason;
  it('enforces slots, operating hours, length, advance window, past and inactive courts', async () => {
    expect(reason(await book(admin, 1, '18:10', '19:00'))).toBe('NOT_ON_SLOT');
    expect(reason(await book(admin, 1, '06:00', '07:00'))).toBe('OUTSIDE_HOURS');
    expect(reason(await book(admin, 1, '21:30', '22:30'))).toBe('OUTSIDE_HOURS');
    expect(reason(await book(admin, 1, '08:00', '13:00'))).toBe('TOO_LONG');
    expect(reason(await book(admin, 1, '10:00', '11:00', 'Late', '2027-03-01'))).toBe('TOO_FAR_AHEAD');
    expect(reason(await book(admin, 1, '08:00', '09:00', 'Past', '2026-10-30'))).toBe('IN_PAST');
    expect(reason(await book(admin, 1, '19:00', '18:00'))).toBe('BAD_RANGE');
    await admin.patch('courts/3', { isActive: false, bookingAction: 'cancel' });
    expect(reason(await book(admin, 3, '12:00', '13:00'))).toBe('COURT_INACTIVE');
    await admin.patch('courts/3', { isActive: true });
  });
});

describe('Staff can see, not change (FR-BOOK-04/05, Q34)', () => {
  it('shows schedule/agenda/context to Staff and refuses every write', async () => {
    const sch = await staff.get(`bookings/schedule?from=${D}&to=${D}`);
    expect(sch.status).toBe(200); expect(sch.body.days).toHaveLength(1);
    expect(sch.body.bookings.length).toBeGreaterThanOrEqual(4);
    expect((await staff.get(`bookings?from=${D}&q=Maria`)).body.items.length).toBeGreaterThan(0);
    const id = sch.body.bookings[0].id;
    expect((await staff.get(`bookings/${id}`)).status).toBe(200);
    for (const [m, p] of [['POST', 'bookings'], ['PATCH', `bookings/${id}`], ['POST', `bookings/${id}/cancel`], ['POST', `bookings/${id}/no-show`]] as const)
      expect((await staff.req(m, p, {})).status).toBe(403);
  });
});

describe('reservations warn but never block (FR-BOOK-07/08)', () => {
  it('warns when a booking is current or imminent, links on request, and lets staff proceed', async () => {
    env.setNow(at(D, '17:50'));
    await admin.login('owner', 'owner-pass-1'); await staff.login('maria', 'maria-pass-1'); // sessions idled out overnight
    await admin.post('courts/2/release');
    const ctxRes = (await staff.get('bookings/context?courtId=2')).body;
    expect(ctxRes.linkable.map((b: any) => b.bookedByName)).toEqual(['Lee', 'Maria']); // Lee's hour is ending, Maria's starts in 10 min
    env.setNow(at(D, '18:10'));
    const ctx2 = (await staff.get('bookings/context?courtId=2')).body;
    expect(ctx2.linkable.map((b: any) => b.bookedByName)).toEqual(['Maria']);
    const warn = await staff.post('matches', { courtId: 2, playType: 'doubles' });
    expect(warn.status).toBe(409); expect(warn.body.error.code).toBe('BOOKING_WARNING');
    expect(warn.body.error.details.booking.booked_by_name).toBe('Maria');
    const chip = (await staff.get('courts/2')).body.court.booking;
    expect(chip.now.bookedByName).toBe('Maria');
    expect(chip.next.bookedByName).toBe('Chen');

    const linked = await staff.post('matches', { courtId: 2, playType: 'doubles', bookingId: ctx2.linkable[0].id });
    expect(linked.status).toBe(201);
    expect(linked.body.snapshot.match.bookingId).toBe(ctx2.linkable[0].id);
    const b = (await staff.get(`bookings/${ctx2.linkable[0].id}`)).body;
    expect(b.status).toBe('confirmed'); expect(b.matches).toHaveLength(1);
    const m = linked.body.snapshot.match;
    await staff.post(`matches/${m.id}/commands`, { commandId: cid(), expectedVersion: m.version, type: 'CANCEL', payload: {} });

    const over = await staff.post('matches', { courtId: 2, playType: 'singles', acknowledgeBooking: true });
    expect(over.status).toBe(201); // never a hard block
    const m2 = over.body.snapshot.match;
    await staff.post(`matches/${m2.id}/commands`, { commandId: cid(), expectedVersion: m2.version, type: 'CANCEL', payload: {} });
    const ev = env.ctx.db.prepare("SELECT payload_json FROM match_events WHERE match_id = ? AND type = 'MATCH_CREATED'").get(m2.id) as { payload_json: string };
    expect(JSON.parse(ev.payload_json).bookingOverride).toBe(true);
  });

  it('shows "reserved now" and raises an info alert if nobody starts a match', async () => {
    env.setNow(at(D, '18:20'));
    expect((await staff.get('courts/2')).body.court.booking.now.bookedByName).toBe('Maria');
    const alerts = (await staff.get('dashboard')).body.alerts;
    expect(alerts.some((a: any) => a.id.startsWith('booking-') && a.level === 'info')).toBe(true);
  });
});

describe('court deactivation with future bookings (FR-BOOK-06)', () => {
  it('requires an explicit keep/cancel choice and never cancels silently', async () => {
    env.setNow(at('2026-10-30', '13:00'));
    await admin.login('owner', 'owner-pass-1'); await staff.login('maria', 'maria-pass-1');
    const r = await admin.patch('courts/2', { isActive: false });
    expect(r.status).toBe(409); expect(r.body.error.code).toBe('FUTURE_BOOKINGS_EXIST');
    expect(r.body.error.details.bookings.length).toBeGreaterThanOrEqual(3);
    const keep = await admin.patch('courts/2', { isActive: false, bookingAction: 'keep' });
    expect(keep.status).toBe(200);
    expect((await staff.get(`bookings?courtId=2&status=confirmed&from=${D}`)).body.total).toBeGreaterThanOrEqual(3);
    await admin.patch('courts/2', { isActive: true });
    const m = await admin.post('courts/2/maintenance', { enabled: true, note: 'Lines' });
    expect(m.body.warnings.length).toBeGreaterThanOrEqual(3); // warned, not cancelled
    await admin.post('courts/2/maintenance', { enabled: false });
  });

  it('exports bookings as CSV for Admin only', async () => {
    expect((await staff.get('bookings/export.csv')).status).toBe(403);
    const csv = await admin.get(`bookings/export.csv?from=${D}`);
    expect(csv.status).toBe(200); expect(csv.raw).toContain('Booked by');
  });
});
