import { describe, expect, it } from 'vitest';
import { ADMIN_ONLY_KEYS, PERMISSION_KEYS, can, permissionsFor } from '../src/permissions';

/** FUNCTIONAL_REQUIREMENTS §1.1 — every row, both roles. */
const STAFF_ALLOWED = [
  'auth.self', 'dashboard.view', 'courts.view', 'courts.maintenance', 'courts.release', 'courts.terminal', 'bookings.view', 'openplay.view',
  'matches.create', 'matches.operate', 'matches.end', 'matches.viewLive', 'matches.history', 'players.view', 'formats.select', 'reports.view',
];
const ADMIN_ONLY = [
  'users.manage', 'courts.manage', 'bookings.manage', 'openplay.manage', 'matches.correct', 'matches.export', 'players.manage',
  'formats.manage', 'reports.csv', 'settings.manage', 'audit.view', 'backups.manage',
];

describe('permission matrix', () => {
  it('covers every key exactly once', () => {
    expect([...STAFF_ALLOWED, ...ADMIN_ONLY].sort()).toEqual([...PERMISSION_KEYS].sort());
  });
  it('Admin can do everything', () => {
    for (const k of PERMISSION_KEYS) expect(can({ kind: 'user', role: 'admin' }, k), k).toBe(true);
  });
  it('Staff can see everything but change only Court Management', () => {
    for (const k of STAFF_ALLOWED) expect(can({ kind: 'user', role: 'staff' }, k as any), k).toBe(true);
    for (const k of ADMIN_ONLY) expect(can({ kind: 'user', role: 'staff' }, k as any), k).toBe(false);
    expect(ADMIN_ONLY_KEYS.sort()).toEqual([...ADMIN_ONLY].sort());
  });
  it('nobody else is allowed', () => {
    expect(can(null, 'auth.self')).toBe(false);
    expect(can({ kind: 'system' }, 'auth.self')).toBe(false);
    expect(permissionsFor('staff')).toHaveLength(STAFF_ALLOWED.length);
  });
});
