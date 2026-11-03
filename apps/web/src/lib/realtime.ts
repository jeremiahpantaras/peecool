import { io, type Socket } from 'socket.io-client';
import type { QueryClient } from '@tanstack/react-query';
import type { Activity, Alert, CourtSnapshot, TerminalDto } from '@pickle/shared';
import { Store } from './store';
import { addClockSample } from './clock';

export type ConnStatus = 'connecting' | 'connected' | 'reconnecting' | 'restarting';
export interface Conn { status: ConnStatus; since: number; lastSyncAt: number | null; terminal: TerminalDto | null }

export const courtsStore = new Store<Record<number, CourtSnapshot>>({});
export const connStore = new Store<Conn>({ status: 'connecting', since: Date.now(), lastSyncAt: null, terminal: null });
export const activityStore = new Store<Activity[]>([]);
export const alertsStore = new Store<Alert[] | null>(null);

type Scope = 'all' | number[];

/** Never render an older version of the same match (SYSTEM_ARCHITECTURE §6.3). */
export function applySnapshot(s: CourtSnapshot): void {
  courtsStore.set((cur) => {
    const ex = cur[s.court.id];
    if (ex?.match && s.match && ex.match.id === s.match.id && s.match.version < ex.match.version) return cur;
    if (ex && s.snapshotSeq < ex.snapshotSeq && ex.match?.id === s.match?.id && (ex.match?.version ?? 0) >= (s.match?.version ?? 0)) return cur;
    return { ...cur, [s.court.id]: s };
  });
}

class Realtime {
  private socket: Socket | null = null;
  private qc: QueryClient | null = null;
  private wants = new Map<symbol, Scope>();
  private instanceId: string | null = null;
  private dbGeneration: number | null = null;
  private version: string | null = null;

  start(qc: QueryClient): void {
    if (this.socket) return;
    this.qc = qc;
    const s = io({ path: '/socket.io', transports: ['websocket', 'polling'], reconnectionDelay: 1000, reconnectionDelayMax: 5000, randomizationFactor: 0.3, withCredentials: true });
    this.socket = s;
    connStore.set((c) => ({ ...c, status: 'connecting', since: Date.now() }));
    s.on('connect', () => { this.emitSubscribe(); });
    s.on('disconnect', (reason) => {
      if (reason === 'io client disconnect') return;
      connStore.set((c) => (c.status === 'restarting' ? c : { ...c, status: 'reconnecting', since: Date.now() }));
    });
    s.on('connect_error', (err: Error & { data?: { code?: string } }) => {
      if (err.data?.code === 'UNAUTHENTICATED') { this.stop(); void qc.invalidateQueries({ queryKey: ['me'] }); return; }
      connStore.set((c) => (c.status === 'connected' ? { ...c, status: 'reconnecting', since: Date.now() } : c));
    });
    s.on('server:hello', (h: { serverTime: number; version: string; instanceId: string; dbGeneration: number; terminal: TerminalDto | null }) => {
      addClockSample(h.serverTime);
      if (this.dbGeneration != null && h.dbGeneration !== this.dbGeneration) { location.reload(); return; }
      if (this.version != null && h.version !== this.version) { location.reload(); return; }
      if (this.instanceId != null && h.instanceId !== this.instanceId) { courtsStore.set({}); void qc.invalidateQueries(); } // server restarted: drop cached state, refetch
      this.instanceId = h.instanceId; this.dbGeneration = h.dbGeneration; this.version = h.version;
      connStore.set({ status: 'connected', since: Date.now(), lastSyncAt: Date.now(), terminal: h.terminal });
    });
    s.on('court:snapshot', (snap: CourtSnapshot) => { applySnapshot(snap); connStore.set((c) => ({ ...c, lastSyncAt: Date.now() })); });
    s.on('terminal:changed', () => { void qc.invalidateQueries({ queryKey: ['me'] }); });
    s.on('invalidate', (p: { keys: string[] }) => { for (const k of p.keys) void qc.invalidateQueries({ queryKey: [k] }); });
    s.on('booking:changed', () => { void qc.invalidateQueries({ queryKey: ['bookings'] }); void qc.invalidateQueries({ queryKey: ['dashboard'] }); });
    s.on('activity', (a: Activity) => activityStore.set((l) => [a, ...l].slice(0, 20)));
    s.on('alerts', (a: Alert[]) => alertsStore.set(a));
    s.on('device:status', (p: { courtId: number; online: boolean; signedInUser: string | null; lastSeenAt: number | null }) => {
      courtsStore.set((cur) => {
        const c = cur[p.courtId]; if (!c) return cur;
        return { ...cur, [p.courtId]: { ...c, court: { ...c.court, device: p.signedInUser ? { ...(c.court.device ?? {}), online: p.online, signedInUser: p.signedInUser, lastSeenAt: p.lastSeenAt } : null } } };
      });
    });
    s.on('settings:updated', () => { void qc.invalidateQueries({ queryKey: ['me'] }); });
    s.on('server:shutdown', () => connStore.set((c) => ({ ...c, status: 'restarting', since: Date.now() })));
    s.on('system:restored', () => location.reload());
  }

  stop(): void {
    this.socket?.close(); this.socket = null;
    courtsStore.set({}); alertsStore.set(null);
    connStore.set({ status: 'connecting', since: Date.now(), lastSyncAt: null, terminal: null });
    this.instanceId = null; this.dbGeneration = null;
  }

  /** Register interest in courts; returns an unsubscribe. Scopes are merged into one `subscribe`. */
  want(scope: Scope): () => void {
    const id = Symbol('want');
    this.wants.set(id, scope);
    this.emitSubscribe();
    return () => { this.wants.delete(id); this.emitSubscribe(); };
  }

  private emitSubscribe(): void {
    const s = this.socket;
    if (!s?.connected) return;
    let all = false; const ids = new Set<number>();
    for (const w of this.wants.values()) { if (w === 'all') all = true; else w.forEach((i) => ids.add(i)); }
    s.emit('subscribe', { courts: all ? 'all' : [...ids] }, (snaps: CourtSnapshot[]) => { snaps?.forEach(applySnapshot); connStore.set((c) => ({ ...c, lastSyncAt: Date.now() })); });
  }

  resync(): void {
    this.socket?.emit('sync', {}, (snaps: CourtSnapshot[]) => snaps?.forEach(applySnapshot));
  }
}

export const realtime = new Realtime();
