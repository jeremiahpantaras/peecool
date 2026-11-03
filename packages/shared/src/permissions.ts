import type { Role } from './types';

/** Single source of truth: FUNCTIONAL_REQUIREMENTS.md §1.1 */
export const PERMISSION_KEYS = [
  'auth.self', 'users.manage', 'dashboard.view',
  'courts.view', 'courts.manage', 'courts.maintenance', 'courts.release', 'courts.terminal',
  'bookings.view', 'bookings.manage', 'openplay.view', 'openplay.manage',
  'matches.create', 'matches.operate', 'matches.end', 'matches.correct', 'matches.viewLive',
  'matches.history', 'matches.export',
  'players.view', 'players.manage',
  'formats.select', 'formats.manage',
  'reports.view', 'reports.csv',
  'settings.manage', 'audit.view', 'backups.manage',
] as const;
export type PermissionKey = (typeof PERMISSION_KEYS)[number];

const STAFF: ReadonlySet<PermissionKey> = new Set<PermissionKey>([
  'auth.self', 'dashboard.view', 'courts.view', 'courts.maintenance', 'courts.release', 'courts.terminal',
  'bookings.view', 'openplay.view', 'matches.create', 'matches.operate', 'matches.end', 'matches.viewLive', 'matches.history',
  'players.view', 'formats.select', 'reports.view',
]);

export type Actor = { kind: 'user'; role: Role } | { kind: 'system' };

export function can(actor: Actor | null | undefined, key: PermissionKey): boolean {
  if (!actor) return false;
  if (actor.kind === 'system') return false; // system acts only through internal code paths
  if (actor.role === 'admin') return true;
  return STAFF.has(key);
}

export function permissionsFor(role: Role): PermissionKey[] {
  return PERMISSION_KEYS.filter((k) => can({ kind: 'user', role }, k));
}

export const ADMIN_ONLY_KEYS: PermissionKey[] = PERMISSION_KEYS.filter((k) => !STAFF.has(k));
