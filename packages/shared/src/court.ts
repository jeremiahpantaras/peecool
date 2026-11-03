import type { CourtStatus, MatchStatus } from './types';

export interface CourtStatusInput {
  isActive: boolean;
  maintenanceMode: boolean;
  releasedAt: number | null;
  activeMatchStatus: MatchStatus | null; // setup | in_progress | paused
  latestFinished: { status: MatchStatus; endedAt: number | null } | null; // completed | terminated
  now: number;
  completedDisplayMinutes: number;
}

/** FUNCTIONAL_REQUIREMENTS §4.3 — derived, never stored. First match wins. */
export function deriveCourtStatus(i: CourtStatusInput): CourtStatus {
  if (!i.isActive) return 'inactive';
  if (i.maintenanceMode) return 'maintenance';
  if (i.activeMatchStatus === 'setup') return 'occupied';
  if (i.activeMatchStatus === 'in_progress') return 'in_progress';
  if (i.activeMatchStatus === 'paused') return 'paused';
  const f = i.latestFinished;
  if (f && f.endedAt != null && i.now - f.endedAt < i.completedDisplayMinutes * 60_000 && (i.releasedAt == null || i.releasedAt < f.endedAt))
    return 'completed';
  return 'available';
}

export function playersPerTeam(playType: 'singles' | 'doubles'): 1 | 2 { return playType === 'singles' ? 1 : 2; }
