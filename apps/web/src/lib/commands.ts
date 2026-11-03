import type { CommandType, CourtSnapshot, MatchSnapshot } from '@pickle/shared';
import { ApiError, post } from './api';
import { applySnapshot } from './realtime';
import { Store } from './store';
import { newCommandId } from './ids';
import { toast } from './toast';

export const busyStore = new Store<boolean>(false);
const BACKOFF = [500, 1000, 2000];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface CommandOutcome { snapshot: CourtSnapshot; duplicate: boolean; warnings: string[] }

/**
 * API_SPECIFICATION §4.3: one command in flight; retry network errors with the SAME commandId and
 * expectedVersion (END_MATCH is never auto-retried); on 409 show the returned snapshot; never apply optimistically.
 */
export async function sendCommand(match: MatchSnapshot, type: CommandType, payload: Record<string, unknown> = {}): Promise<CommandOutcome> {
  if (busyStore.get()) throw new ApiError(0, 'BUSY', 'Please wait for the last action to finish');
  busyStore.set(true);
  const body = { commandId: newCommandId(), expectedVersion: match.version, type, payload };
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await post<CommandOutcome & { event: unknown }>(`matches/${match.id}/commands`, body);
        applySnapshot(r.snapshot);
        return r;
      } catch (e) {
        const retryable = e instanceof ApiError && (e.status === 0 || e.status === 503) && type !== 'END_MATCH';
        if (retryable && attempt < BACKOFF.length) { await sleep(BACKOFF[attempt]!); continue; }
        if (e instanceof ApiError && e.snapshot) {
          applySnapshot(e.snapshot);
          if (e.code === 'VERSION_CONFLICT') toast('Updated on another device — showing the latest score', 'info');
        }
        throw e;
      }
    }
  } finally { busyStore.set(false); }
}
